/**
 * lojas-ia.js — Edge Function do módulo Lojas IA.
 *
 * Roteia 2 ações:
 *   - gerar_sugestoes: monta prompt A com carteira + produtos + promoções,
 *     chama Claude, parseia JSON de 7 sugestões, salva em
 *     lojas_sugestoes_diarias (idempotente: deleta as do dia antes de inserir).
 *
 *   - gerar_mensagem: monta prompt B com 1 sugestão expandida, chama Claude,
 *     retorna texto puro pronto pra copiar. Cacheia em
 *     lojas_sugestoes_diarias.mensagem_gerada (TTL 5 min).
 *
 * Padrão técnico:
 *   - SUPABASE_KEY (service role) — bypassa RLS pra deletar/inserir
 *   - ANTHROPIC_API_KEY — chamada via fetch direto (sem SDK)
 *   - Prompt caching ativado (cache_control: ephemeral)
 *   - Modelo lido de lojas_config.modelo_ia (default claude-sonnet-4-6)
 *   - Rate limit por vendedora (lojas_config.rate_limit_ms, default 3000ms)
 *   - Orçamento global compartilhado com IA Pergunta (ia_config.orcamento_brl_mensal)
 *
 * Frontend chama via:
 *   POST /api/lojas-ia
 *   Headers: { 'X-User': '<userId>' }
 *   Body: { action, vendedora_id?, sugestao_id?, contexto? }
 */

import {
  supabase,
  setCors,
  validarUsuario,
  ehAdminLojas,
  getLojasConfig,
  temOrcamento,
  checarRateLimit,
  chamarClaude,
  parseJsonTolerante,
  logarChamadaIA,
  refSemZero,
  diasDesde,
} from './_lojas-helpers.js';

import {
  SYSTEM_PROMPT_SUGESTOES,
  SYSTEM_PROMPT_MENSAGENS,
  EXEMPLOS_FEW_SHOT,
} from './lojas-ia-prompts.js';

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Valida usuário
  const auth = await validarUsuario(req);
  if (!auth.ok) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  // Checa orçamento mensal global
  const orc = await temOrcamento();
  if (!orc.ok) {
    return res.status(429).json({
      error: 'Orçamento mensal de IA esgotado',
      gasto: orc.gasto.toFixed(2),
      limite: orc.limite.toFixed(2),
      mensagem: 'Aguarda virar o mês ou aumenta o orçamento em ia_config.orcamento_brl_mensal.',
    });
  }

  const action = req.body?.action;

  try {
    if (action === 'gerar_sugestoes') {
      return await handleGerarSugestoes(req, res, auth);
    }
    if (action === 'gerar_mensagem') {
      return await handleGerarMensagem(req, res, auth);
    }
    // Geracao avulsa — cliente_id direto, sem precisar de sugestao_id pre-existente
    // Ailson 08/05/2026: pra vendedora pedir mensagem direto do card da carteira
    if (action === 'gerar_mensagem_avulsa') {
      return await handleGerarMensagemAvulsa(req, res, auth);
    }
    if (action === 'gerar_resumo_semanal') {
      return await handleGerarResumoSemanal(req, res, auth);
    }
    if (action === 'conversoes_dashboard') {
      return await handleConversoesDashboard(req, res, auth);
    }
    if (action === 'metas_dashboard') {
      return await handleMetasDashboard(req, res, auth);
    }
    return res.status(400).json({ error: `Action desconhecida: ${action}` });
  } catch (e) {
    console.error('[lojas-ia] erro fatal:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 1: gerar_sugestoes (Prompt A)
// ═══════════════════════════════════════════════════════════════════════════

async function handleGerarSugestoes(req, res, auth) {
  const vendedoraIdAlvo = req.body?.vendedora_id;
  if (!vendedoraIdAlvo) {
    return res.status(400).json({ error: 'vendedora_id obrigatório' });
  }

  // Permissão: vendedora só pode regenerar PRÓPRIAS sugestões. Admin pode regenerar de qualquer.
  if (!auth.isAdmin && auth.vendedoraId !== vendedoraIdAlvo) {
    return res.status(403).json({ error: 'Sem permissão pra regenerar sugestões de outra vendedora' });
  }

  // Rate limit
  const rl = await checarRateLimit(vendedoraIdAlvo);
  if (!rl.ok) {
    return res.status(429).json({
      error: 'Aguarda alguns segundos antes de regerar',
      ms_espera: rl.msEspera,
    });
  }

  // 1. Carrega contexto: vendedora, carteira, produtos, promoções, regras
  const ctx = await montarContextoSugestoes(vendedoraIdAlvo);
  if (ctx.erro) {
    return res.status(400).json({ error: ctx.erro });
  }

  // 2. Monta system prompt em blocos (com cache)
  const systemBlocks = montarSystemSugestoes(ctx.regrasCustomizadas);

  // 3. Monta messages (few-shot + user input)
  const messages = montarMessagesSugestoes(ctx);

  // 4. Modelo
  const modelo = String(await getLojasConfig('modelo_ia', 'claude-sonnet-4-6'));

  // 5. Chama Claude
  // max_tokens=8000 (era 4000): com schema v2 (top_refs_cliente,
  // mais_vendidos, refs_reposicao, parágrafos com \n\n), JSON de 7
  // sugestoes pode passar de 4000 tokens facilmente. Sintoma: erro
  // "Unterminated string in JSON" porque resposta foi truncada.
  const r = await chamarClaude({
    modelo,
    systemBlocks,
    messages,
    max_tokens: 8000,
    temperature: 0.7,
    timeoutMs: 75000,
  });

  // 6. Loga (independente de sucesso)
  await logarChamadaIA({
    vendedoraId: vendedoraIdAlvo,
    userId: auth.userId,
    tipoPrompt: 'sugestoes',
    modelo,
    usage: r.usage,
    latencia_ms: r.latencia_ms,
    requestSummary: `vendedora=${ctx.vendedoraNome} carteira=${ctx.clientes.length} produtos=${ctx.produtos.length}`,
    responseSummary: r.ok ? r.texto.slice(0, 500) : null,
    erro: r.ok ? null : r.erro,
  });

  if (!r.ok) {
    return res.status(502).json({ error: 'Erro ao chamar IA', detalhe: r.erro });
  }

  // 7. Parse JSON tolerante
  const parsed = parseJsonTolerante(r.texto);
  if (!parsed.ok) {
    return res.status(502).json({
      error: 'IA retornou JSON inválido',
      detalhe: parsed.erro,
      raw: parsed.raw,
    });
  }

  // 8. Valida estrutura mínima
  const sugestoesIA = parsed.parsed?.sugestoes;
  if (!Array.isArray(sugestoesIA) || sugestoesIA.length === 0) {
    return res.status(502).json({
      error: 'IA não retornou sugestões válidas',
      raw: parsed.parsed,
    });
  }

  // 9. Persiste (idempotente: apaga as PENDENTES do dia da vendedora primeiro)
  // FIX 07/05/2026 (Ailson): adicionado .eq('status', 'pendente') pra
  // PRESERVAR sugestoes que a vendedora ja executou ou dispensou. Antes,
  // qualquer regerar (botao 'Atualizar' clicado pela vendedora durante o
  // dia) apagava TUDO incluindo trabalho concluido. Caso real Celia 06/05:
  // ela executou 7 sugestoes ao longo do dia e clicou 'Atualizar' por
  // engano 3 vezes — cada clique apagava as executadas e gerava 7 novas
  // pendentes. Vendedora pensava que 'nao salvou'.
  // Com este fix, executadas/dispensadas ficam imutaveis no historico.
  const hoje = new Date().toISOString().slice(0, 10);
  await supabase
    .from('lojas_sugestoes_diarias')
    .delete()
    .eq('vendedora_id', vendedoraIdAlvo)
    .eq('data_geracao', hoje)
    .eq('status', 'pendente');

  // 10. Insere as novas
  const linhas = sugestoesIA.map((s, idx) => ({
    vendedora_id: vendedoraIdAlvo,
    data_geracao: hoje,
    prioridade: s.prioridade ?? (idx + 1),
    tipo: validarTipo(s.tipo),
    subtipo_sacola: s.subtipo_sacola || null,
    alvo_tipo: s.alvo_tipo === 'grupo' ? 'grupo' : 'cliente',
    cliente_id: s.alvo_tipo === 'cliente' ? s.alvo_id : null,
    grupo_id: s.alvo_tipo === 'grupo' ? s.alvo_id : null,
    alvo_nome_display: s.alvo_nome_display || null,
    titulo: s.titulo || 'Sugestão',
    contexto: s.contexto || null,
    fatos: Array.isArray(s.fatos) ? s.fatos : null,
    acao_sugerida: s.acao_sugerida || null,
    produto_ref: s.produto_ref || null,
    produto_nome: s.produto_nome || null,
    promocao_id: s.promocao_id || null,
    fallback_used: !!s.fallback_used,
    metadados_ia: parsed.parsed?.metadados || null,
    status: 'pendente',
  }));

  const { error: errIns } = await supabase
    .from('lojas_sugestoes_diarias')
    .insert(linhas);

  if (errIns) {
    console.error('[lojas-ia] erro inserir sugestões:', errIns);
    return res.status(500).json({ error: 'Erro ao salvar sugestões', detalhe: errIns.message });
  }

  // ─── Marca aviso como consumido (se havia um) ─────────────────────────
  // Decisão: só marca consumido APOS o INSERT das sugestoes ter dado certo.
  // Se IA falhou ou banco recusou, aviso fica pendente pra retry.
  if (ctx?.avisosDestaVendedora?.length > 0) {
    const avisoId = ctx.avisosDestaVendedora[0].id;
    await supabase
      .from('lojas_avisos')
      .update({ status: 'consumido', consumido_em: new Date().toISOString() })
      .eq('id', avisoId);
  }

  return res.json({
    ok: true,
    sugestoes_criadas: linhas.length,
    metadata: parsed.parsed?.metadados || null,
    usage: r.usage,
    latencia_ms: r.latencia_ms,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 2: gerar_mensagem (Prompt B)
// ═══════════════════════════════════════════════════════════════════════════

async function handleGerarMensagem(req, res, auth) {
  const sugestaoId = req.body?.sugestao_id;
  const contextoExtra = req.body?.contexto || {};

  if (!sugestaoId) {
    return res.status(400).json({ error: 'sugestao_id obrigatório' });
  }

  // Carrega sugestão
  const { data: sug, error: errSug } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('*')
    .eq('id', sugestaoId)
    .maybeSingle();

  if (errSug) return res.status(500).json({ error: errSug.message });
  if (!sug) return res.status(404).json({ error: 'Sugestão não encontrada' });

  // Permissão
  if (!auth.isAdmin && auth.vendedoraId !== sug.vendedora_id) {
    return res.status(403).json({ error: 'Sem permissão' });
  }

  // Cache: se já tem mensagem gerada nos últimos 5min E sem contextoExtra novo, retorna ela
  const cacheTtlSeg = Number(await getLojasConfig('cache_ttl_seconds', 300));
  if (
    sug.mensagem_gerada &&
    sug.mensagem_gerada_em &&
    !contextoExtra.regerar &&
    Object.keys(contextoExtra).length === 0
  ) {
    const ageSec = (Date.now() - new Date(sug.mensagem_gerada_em).getTime()) / 1000;
    if (ageSec < cacheTtlSeg) {
      return res.json({ ok: true, mensagem: sug.mensagem_gerada, cached: true });
    }
  }

  // Rate limit
  const rl = await checarRateLimit(sug.vendedora_id);
  if (!rl.ok) {
    return res.status(429).json({
      error: 'Aguarda alguns segundos antes de pedir outra mensagem',
      ms_espera: rl.msEspera,
    });
  }

  // Carrega cliente OU grupo (depende de alvo_tipo) com KPIs
  const ctx = await montarContextoMensagem(sug, contextoExtra);
  if (ctx.erro) return res.status(400).json({ error: ctx.erro });

  // System blocks com cache
  const systemBlocks = montarSystemMensagens(ctx.regrasCustomizadas);

  // Messages (few-shot do tipo da sugestão + user)
  const messages = montarMessagesMensagem(sug, ctx, contextoExtra);

  const modelo = String(await getLojasConfig('modelo_ia', 'claude-sonnet-4-6'));

  const r = await chamarClaude({
    modelo,
    systemBlocks,
    messages,
    max_tokens: 600,
    temperature: 0.85,
    timeoutMs: 30000,
  });

  await logarChamadaIA({
    vendedoraId: sug.vendedora_id,
    userId: auth.userId,
    tipoPrompt: 'mensagem',
    modelo,
    usage: r.usage,
    latencia_ms: r.latencia_ms,
    requestSummary: `sug=${sug.id} tipo=${sug.tipo}`,
    responseSummary: r.ok ? r.texto.slice(0, 500) : null,
    erro: r.ok ? null : r.erro,
  });

  if (!r.ok) {
    return res.status(502).json({ error: 'Erro ao chamar IA', detalhe: r.erro });
  }

  // Texto puro (sem cercas markdown)
  const mensagem = r.texto.replace(/^```(?:[a-z]+)?\s*|\s*```$/g, '').trim();

  // Cacheia
  await supabase
    .from('lojas_sugestoes_diarias')
    .update({
      mensagem_gerada: mensagem,
      mensagem_gerada_em: new Date().toISOString(),
    })
    .eq('id', sugestaoId);

  return res.json({
    ok: true,
    mensagem,
    cached: false,
    usage: r.usage,
    latencia_ms: r.latencia_ms,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// MONTAGEM DE CONTEXTO — gerar_sugestoes
// ═══════════════════════════════════════════════════════════════════════════

async function montarContextoSugestoes(vendedoraId) {
  // Vendedora
  const { data: vendedora, error: errV } = await supabase
    .from('lojas_vendedoras')
    .select('*')
    .eq('id', vendedoraId)
    .maybeSingle();
  if (errV) return { erro: errV.message };
  if (!vendedora) return { erro: 'Vendedora não encontrada' };

  // Carteira (clientes ativos com KPIs)
  const { data: clientes } = await supabase
    .from('lojas_clientes')
    .select('id, documento, tipo_documento, razao_social, nome_fantasia, apelido, comprador_nome, telefone_principal, vendedora_id, grupo_id, pular_ate, canal_cadastro')
    .eq('vendedora_id', vendedoraId)
    .is('arquivado_em', null);

  const clienteIds = (clientes || []).map(c => c.id);

  // KPIs em chunks (limite Supabase)
  const kpis = {};
  for (let i = 0; i < clienteIds.length; i += 200) {
    const chunk = clienteIds.slice(i, i + 200);
    const { data: kpisChunk } = await supabase
      .from('lojas_clientes_kpis')
      .select('*')
      .in('cliente_id', chunk);
    (kpisChunk || []).forEach(k => { kpis[k.cliente_id] = k; });
  }

  // ATENCAO ESPECIAL — view vw_lojas_clientes_atencao_especial (Ailson 06/05/2026)
  // Cliente ativo+confiavel com sinais de mudanca de comportamento (score>=3).
  // IA usa pra priorizar e personalizar mensagem com motivos.
  const atencaoEspecial = {};
  try {
    const { data: aeData } = await supabase
      .from('vw_lojas_clientes_atencao_especial')
      .select('cliente_id, score, motivos, tem_atraso_ciclo, tem_queda_volume, tem_queda_ticket, tem_devolucao')
      .eq('vendedora_id', vendedoraId);
    (aeData || []).forEach(a => { atencaoEspecial[a.cliente_id] = a; });
  } catch (e) {
    console.error('[lojas-ia] erro carregar atencao_especial:', e.message);
  }

  // JANELA DE COMPRA — view vw_lojas_clientes_janela (Ailson 06/05/2026)
  // GAP 1 da auditoria 07/05/2026: IA precisa saber quem esta CONFORTAVEL
  // no ciclo natural (faltam X dias pra entrar na janela = nao precisa mensagem)
  // vs quem PASSOU da janela (esta atrasando o ciclo proprio = ja precisa).
  //
  // Antes da auditoria a IA recebia status_atual mas nao sabia diferenciar:
  //   - cliente media 90d, 60 dias sem comprar = ATIVO (faltam 12d pra atencao)
  //     → NAO mandar mensagem, vai comprar naturalmente
  //   - cliente media 30d, 35 dias sem comprar = ATIVO (passou 5d da janela)
  //     → MANDAR, ele esta atrasando
  //
  // View ja calcula:
  //   - dentro_janela_compra (true/false)
  //   - dias_ate_janela_atencao (positivo = ainda confortavel, negativo = passou)
  //   - media_confiavel
  const janela = {};
  try {
    const { data: jData } = await supabase
      .from('vw_lojas_clientes_janela')
      .select('cliente_id, dias_ate_janela_atencao, dentro_janela_compra, media_confiavel, media_dias_compras')
      .eq('vendedora_id', vendedoraId);
    (jData || []).forEach(j => { janela[j.cliente_id] = j; });
  } catch (e) {
    console.error('[lojas-ia] erro carregar janela:', e.message);
  }

  // CONVERSOES — Ailson 07/05/2026 (auditoria GAP 2)
  // Cliente que recebeu mensagem em status atencao/semAtividade/inativo e
  // voltou a comprar em ate 15d. Pra IA saber:
  //   1) por cliente: ja converteu antes? quanto tempo demorou?
  //   2) geral da vendedora: total de conversoes ultimos 60d (numero/valor)
  // Usa pra:
  //   - priorizar clientes que historicamente convertem
  //   - tom diferente pra quem ja teve historico de mensagem→compra
  //     ('boa, voltei pra dar uma olhada nas novidades — tem aquele estilo
  //      que vc gosta' em vez de 'oi sumida').
  const conversoesPorCliente = {};
  let conversoesGeral = { qtd_60d: 0, valor_60d: 0, qtd_30d: 0 };
  try {
    const dataLimite = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const { data: convData } = await supabase
      .from('lojas_conversoes')
      .select('cliente_id, data_mensagem, data_venda, dias_ate_compra, valor_venda, status_no_envio')
      .eq('vendedora_id', vendedoraId)
      .gte('data_venda', dataLimite);

    const data30d = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    (convData || []).forEach(c => {
      // Por cliente
      if (!conversoesPorCliente[c.cliente_id]) {
        conversoesPorCliente[c.cliente_id] = {
          total: 0,
          ultima_data_venda: null,
          ultimo_dias_ate_compra: null,
          ultimo_valor: null,
        };
      }
      const slot = conversoesPorCliente[c.cliente_id];
      slot.total++;
      if (!slot.ultima_data_venda || c.data_venda > slot.ultima_data_venda) {
        slot.ultima_data_venda = c.data_venda;
        slot.ultimo_dias_ate_compra = c.dias_ate_compra;
        slot.ultimo_valor = c.valor_venda;
      }
      // Geral
      conversoesGeral.qtd_60d++;
      conversoesGeral.valor_60d += parseFloat(c.valor_venda || 0);
      if (c.data_venda >= data30d) conversoesGeral.qtd_30d++;
    });
    conversoesGeral.valor_60d = Math.round(conversoesGeral.valor_60d * 100) / 100;
  } catch (e) {
    console.error('[lojas-ia] erro carregar conversoes:', e.message);
  }

  // HISTORICO DE SUGESTOES EXECUTADAS — Ailson 07/05/2026 (auditoria GAP 4)
  // Ultimas 28 dias por cliente — IA usa pra NAO REPETIR conteudo:
  //   - mesma REF que ja foi oferecida ha 5 dias
  //   - mesmo tipo (followup, novidade) repetido em sequencia
  //   - mesmo titulo/tema
  // Cooldown geral (7-10d) ja existia mas era binario (pulava cliente).
  // Agora a IA pode SUGERIR a cliente de novo MAS com conteudo DIFERENTE.
  const historicoSugestoes = {};
  try {
    const dataLimiteHist = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
    const { data: histData } = await supabase
      .from('lojas_sugestoes_diarias')
      .select('cliente_id, grupo_id, data_geracao, tipo, titulo, produto_ref, status')
      .eq('vendedora_id', vendedoraId)
      .gte('data_geracao', dataLimiteHist)
      .in('status', ['executada', 'pendente']) // ignora dispensadas/expiradas
      .order('data_geracao', { ascending: false });

    (histData || []).forEach(h => {
      const key = h.cliente_id || h.grupo_id;
      if (!key) return;
      if (!historicoSugestoes[key]) historicoSugestoes[key] = [];
      // Limita a 5 mais recentes por cliente — suficiente pra IA evitar repetir
      if (historicoSugestoes[key].length < 5) {
        historicoSugestoes[key].push({
          data: h.data_geracao,
          tipo: h.tipo,
          ref: h.produto_ref || null,
          titulo: h.titulo,
        });
      }
    });
  } catch (e) {
    console.error('[lojas-ia] erro carregar historico sugestoes:', e.message);
  }

  // Sacolas ativas dessa vendedora
  const { data: sacolasRaw } = await supabase
    .from('lojas_pedidos_sacola')
    .select('*')
    .eq('vendedora_id', vendedoraId)
    .eq('ativo', true);

  // ANTI-REPETIÇÃO sacola: cliente_id sugerido como sacola nos ULTIMOS 7 DIAS
  // fica em cooldown. Decisao Ailson 06/05/2026: ajustado de 5→7d pra alinhar
  // com os outros tipos. Sem isso, mesmo cliente aparecia todo dia.
  const data7diasSacola = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data: sacolasRecentes } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('cliente_id')
    .eq('vendedora_id', vendedoraId)
    .eq('tipo', 'sacola')
    .gte('data_geracao', data7diasSacola)
    .not('cliente_id', 'is', null);
  const clientesEmCooldownSacola = new Set(
    (sacolasRecentes || []).map(s => s.cliente_id)
  );

  // ANTI-REPETIÇÃO geral (Ailson 06/05/2026): cliente sugerido em qualquer
  // tipo (exceto sacola — tem regra propria) nos ULTIMOS N DIAS fica em
  // cooldown.
  //
  // N varia conforme tamanho da carteira:
  //   - Carteira >= 100 clientes ativos: cooldown = 10 dias
  //   - Carteira < 100  (ex: Fran tem 78): cooldown = 7 dias
  //     (caso contrario fica sem opcoes pra variar)
  //
  // Conta carteira ANTES dos filtros de pular_ate/kpi_inutil porque o que
  // importa eh o pool disponivel da vendedora, nao o filtrado naquele dia.
  const totalCarteira = (clientes || []).filter(c => !c.arquivado_em).length;
  const cooldownGeralDias = totalCarteira < 100 ? 7 : 10;
  const dataCooldownGeral = new Date(Date.now() - cooldownGeralDias * 86400000).toISOString().slice(0, 10);

  const { data: sugestoesRecentes } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('cliente_id, tipo')
    .eq('vendedora_id', vendedoraId)
    .neq('tipo', 'sacola')
    .gte('data_geracao', dataCooldownGeral)
    .not('cliente_id', 'is', null);
  const clientesEmCooldownGeral = new Set(
    (sugestoesRecentes || []).map(s => s.cliente_id)
  );

  // FIX 07/05/2026: garantir que clientes ja TRABALHADOS hoje
  // (executada ou dispensada) NAO voltem em regerar do mesmo dia.
  // Caso real: vendedora executa 6 sugestoes, clica 'Atualizar' por
  // engano, e a IA podia sugerir os mesmos 6 clientes de novo. Com este
  // bloco, os clientes ja contatados/dispensados HOJE entram em cooldown
  // forte.
  const hojeData = new Date().toISOString().slice(0, 10);
  const { data: sugestoesTrabalhadas } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('cliente_id')
    .eq('vendedora_id', vendedoraId)
    .eq('data_geracao', hojeData)
    .in('status', ['executada', 'dispensada'])
    .not('cliente_id', 'is', null);
  (sugestoesTrabalhadas || []).forEach(s => clientesEmCooldownGeral.add(s.cliente_id));

  console.log('[lojas-ia]', vendedora.nome, 'carteira=' + totalCarteira,
    'cooldown_geral=' + cooldownGeralDias + 'd',
    'em_cooldown=' + clientesEmCooldownGeral.size);

  // FILTRO SACOLAS (28/04/2026, decisão Ailson):
  //   - valor_total <= 0 → dado faltante do PDF, descarta
  //   - dias < 6 → muito recente, vendedora ainda monta a sacola
  //   - cliente em cooldown sacola (5 dias) → descarta (decisao 05/05)
  // Telemetria pra debug em metadados_ia
  const sacolasDescartadas = { sem_valor: 0, muito_recente: 0, em_cooldown: 0 };
  const hojeMs = Date.now();
  const sacolas = (sacolasRaw || []).filter(s => {
    const valor = Number(s.valor_total) || 0;
    if (valor <= 0) { sacolasDescartadas.sem_valor++; return false; }
    if (!s.data_cadastro_sacola) { sacolasDescartadas.sem_valor++; return false; }
    const dias = Math.floor((hojeMs - new Date(s.data_cadastro_sacola).getTime()) / 86400000);
    if (dias < 6) { sacolasDescartadas.muito_recente++; return false; }
    if (s.cliente_id && clientesEmCooldownSacola.has(s.cliente_id)) {
      sacolasDescartadas.em_cooldown++;
      return false;
    }
    return true;
  });

  // Grupos da vendedora — Ailson 07/05/2026:
  // Carrega grupos + AGREGADOS calculados a partir dos KPIs dos CNPJs do grupo.
  // BUG REAL ANTERIOR: backend mandava so id+nome+apelido. IA recebia grupo
  // sem dados (sem lifetime, sem ultima_compra, sem qtd_compras, sem status)
  // e nao conseguia gerar sugestao tipo 'grupo'. Resultado: cada CNPJ do
  // grupo virava sugestao separada — Vanessa reportou 4 sugestoes do grupo
  // Sandra em vez de 1.
  // Mesmos calculos que o frontend (Lojas_Telas_Vendedora.jsx linha 2224).
  const { data: gruposRaw } = await supabase
    .from('lojas_grupos')
    .select('id, nome_grupo, apelido, vendedora_id, observacao')
    .eq('vendedora_id', vendedoraId)
    .is('arquivado_em', null);

  // Mapa de cliente_id → kpi pra calcular agregados rapido
  const clientePorId = new Map((clientes || []).map(c => [c.id, c]));

  const grupos = (gruposRaw || []).map(g => {
    const docsDoGrupo = (clientes || []).filter(c => c.grupo_id === g.id);
    if (docsDoGrupo.length === 0) return null;

    const docsKpi = docsDoGrupo.map(c => ({
      cliente_id: c.id,
      apelido: c.apelido || c.comprador_nome || c.razao_social?.split(' ').slice(0, 3).join(' '),
      documento: c.documento,
      kpi: kpis[c.id] || {},
    }));

    const lifetimeGrupo = docsKpi.reduce((s, d) => s + (d.kpi.lifetime_total || 0), 0);
    const qtdComprasGrupo = docsKpi.reduce((s, d) => s + (d.kpi.qtd_compras || 0), 0);
    const qtdPecasGrupo = docsKpi.reduce((s, d) => s + (d.kpi.qtd_pecas || 0), 0);

    // Dias da compra mais recente do grupo (= MIN dos dias_sem_comprar)
    const diasArr = docsKpi.map(d => d.kpi.dias_sem_comprar).filter(v => v != null);
    const diasSemGrupo = diasArr.length ? Math.min(...diasArr) : null;

    // Ultima compra do grupo (= MAX das ultimas_compras)
    const ultimasArr = docsKpi.map(d => d.kpi.ultima_compra).filter(Boolean);
    const ultimaCompraGrupo = ultimasArr.length ? ultimasArr.sort().reverse()[0] : null;

    // Status agregado: pega o MELHOR (mais ativo) dos status individuais
    // Mesma logica do frontend (Ailson 28/04/2026)
    const ordemStatus = ['ativo', 'separandoSacola', 'atencao', 'semAtividade', 'inativo', 'arquivo'];
    const statusGrupo = ordemStatus.find(s =>
      docsKpi.some(d => d.kpi.status_atual === s)
    ) || 'ativo';

    // Doc principal: o que tem maior lifetime
    const docPrincipal = [...docsKpi].sort((a, b) =>
      (b.kpi.lifetime_total || 0) - (a.kpi.lifetime_total || 0)
    )[0];

    return {
      id: g.id,
      nome_grupo: g.nome_grupo,
      apelido: g.apelido,
      observacao: g.observacao,
      // Agregados — mesmo nome dos campos que o prompt usa
      lifetime_grupo: Math.round(lifetimeGrupo * 100) / 100,
      qtd_compras_grupo: qtdComprasGrupo,
      qtd_pecas_grupo: qtdPecasGrupo,
      ticket_medio_grupo: qtdComprasGrupo > 0 ? Math.round(lifetimeGrupo / qtdComprasGrupo) : 0,
      dias_sem_grupo: diasSemGrupo,
      ultima_compra_grupo: ultimaCompraGrupo,
      status_grupo: statusGrupo,
      doc_principal_id: docPrincipal?.cliente_id,
      doc_principal_apelido: docPrincipal?.apelido,
      // Lista de docs (pra IA poder mencionar uma loja especifica se quiser)
      docs: docsKpi.map(d => ({
        cliente_id: d.cliente_id,
        apelido: d.apelido,
        dias_sem_comprar: d.kpi.dias_sem_comprar,
        status: d.kpi.status_atual,
        lifetime: Math.round((d.kpi.lifetime_total || 0) * 100) / 100,
        qtd_compras: d.kpi.qtd_compras || 0,
      })),
    };
  }).filter(Boolean);

  // Produtos oferecíveis (view já filtrada)
  const { data: produtos } = await supabase
    .from('vw_lojas_produtos_oferecveis')
    .select('*')
    .order('score_relevancia', { ascending: false })
    .limit(150);

  // Curadoria ativa
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: curadoria } = await supabase
    .from('lojas_produtos_curadoria')
    .select('ref, tipo, motivo, data_fim')
    .eq('ativo', true)
    .or(`data_fim.is.null,data_fim.gte.${hoje}`);

  // Best sellers e em_alta automáticos.
  // Decisão Ailson 28/04/2026: derivado das vendas REAIS da loja física Amícia
  // (lojas_vendas_itens, populado pelo Relatório BI do Mire). NÃO MISTURAR com
  // vendas Bling (marketplaces, fonte completamente diferente).
  //
  // REGRA REVISADA Ailson 04/05/2026 (sprint curadoria):
  //   • best_sellers = SO MANUAL (Ailson cadastra) — sem auto
  //   • em_alta automatico = curva A (top 10) — não curva B
  //   • curva B nao entra em nada
  //
  // Plus: novidades automaticas (5-12 dias apos entrega da oficina) tambem
  // entram, lidas da view vw_lojas_novidades_auto.
  //
  // Plus: refs em lojas_curadoria_exclusoes nao entram (admin "vetou").
  let bestSellersAuto = [];
  let emAltaAuto = [];
  let novidadesAuto = [];
  let produtosExtras = [];
  try {
    // Carrega exclusoes do admin pra filtrar todos os automaticos
    const { data: excluidasRaw } = await supabase
      .from('lojas_curadoria_exclusoes')
      .select('ref, tipo');
    const excluidas = excluidasRaw || [];
    const setExclEm = new Set(excluidas.filter(e => e.tipo === 'em_alta').map(e => e.ref));
    const setExclNov = new Set(excluidas.filter(e => e.tipo === 'novidade_manual').map(e => e.ref));

    // Em alta = curva A (top 10) — REVISADO 04/05/2026
    const { data: topVendas } = await supabase
      .from('vw_lojas_top_vendas_loja_fisica')
      .select('ref, curva, posicao_ranking, pecas_45d')
      .eq('curva', 'a')
      .order('posicao_ranking', { ascending: true })
      .limit(10);
    emAltaAuto = (topVendas || [])
      .map(r => r.ref)
      .filter(ref => !setExclEm.has(ref));
    // bestSellersAuto fica vazio — best_seller e SO manual agora

    // Novidades automaticas — refs entregues pela oficina ha 5-12 dias.
    // View criada em sql/lojas-curadoria-exclusoes.sql.
    const { data: novidadesRaw } = await supabase
      .from('vw_lojas_novidades_auto')
      .select('ref');
    novidadesAuto = (novidadesRaw || [])
      .map(n => n.ref)
      .filter(ref => !setExclNov.has(ref));

    // A view vw_lojas_produtos_oferecveis filtra por estoque>100. REFs top
    // que vendem muito podem ter estoque BAIXO justamente por isso. Tambem
    // REFs antigas (descontinuadas mas ainda em estoque) ficam fora da view.
    // Buscamos direto em lojas_produtos pra IA enxergar.
    //
    // INCLUI tambem REFs da CURADORIA MANUAL (best_seller/em_alta/novidade_manual).
    // Sem isso, REFs marcadas pelo Ailson como best_seller mas que cairam fora
    // da view (peças classicas, sem destaque recente) ficavam invisiveis pra IA
    // — bug detectado 30/04/2026: dos 8 best_sellers manuais cadastrados,
    // todos estavam fora de vw_lojas_produtos_oferecveis.
    const refsCuradoriaManual = (curadoria || []).map(c => c.ref);
    const todasExtras = [...new Set([
      ...emAltaAuto,
      ...novidadesAuto,
      ...refsCuradoriaManual,
    ])];

    // Map ref -> tipo de curadoria (pra setar motivo_oferta correto)
    const curadoriaTipoPorRef = new Map(
      (curadoria || []).map(c => [c.ref, c.tipo])
    );

    if (todasExtras.length > 0) {
      const { data: extras } = await supabase
        .from('lojas_produtos')
        .select('ref, descricao, categoria, qtd_estoque')
        .in('ref', todasExtras);
      produtosExtras = (extras || [])
        .filter(p => p.descricao)
        .map(p => {
          // Curadoria manual tem PRIORIDADE no motivo_oferta.
          const tipoCurMan = curadoriaTipoPorRef.get(p.ref);
          let motivo;
          if (tipoCurMan === 'novidade_manual') motivo = 'novidade_oficina';
          else if (tipoCurMan === 'best_seller') motivo = 'best_seller';
          else if (tipoCurMan === 'em_alta') motivo = 'em_alta';
          else if (novidadesAuto.includes(p.ref)) motivo = 'novidade_oficina';
          else if (emAltaAuto.includes(p.ref)) motivo = 'em_alta';
          else motivo = 'em_alta';

          return {
            ref: p.ref,
            descricao: p.descricao,
            categoria: p.categoria,
            qtd_estoque: p.qtd_estoque,
            motivo_oferta: motivo,
          };
        });
    }
  } catch (e) {
    console.warn('[lojas-ia] sem top vendas loja fisica (view ausente?):', e?.message);
  }

  // Junta produtos da view + extras da loja fisica. Dedup por REF.
  const refsView = new Set((produtos || []).map(p => p.ref));
  const produtosFinal = [
    ...(produtos || []),
    ...produtosExtras.filter(p => !refsView.has(p.ref)),
  ];

  // ─── TOP 3 REFs POR CLIENTE (decisão Ailson 28/04/2026) ───────────────
  // Cliente compra "bem" uma REF se ela está no top 3 dela (score mesclado
  // peças×0.7 + recorrência×3.0). Usado pra:
  //   1. IA saber quando dizer "esse modelo vende bem pra você"
  //   2. Detectar reposição: REF do top do cliente disponível em estoque
  //   3. Alternar entre os 3 ao longo dos dias (anti-monotonia)
  //
  // Mapa REF -> estoque (pra anotar em_estoque em cada top_ref do cliente).
  // Decisão Ailson 30/04/2026: ampliar conceito de reposicao — não precisa
  // ser novidade da oficina; basta a REF estar em estoque relevante hoje.
  const ESTOQUE_MIN_REPOSICAO = 50;
  const estoqueDisponivelPorRef = new Map();
  for (const p of produtosFinal) {
    estoqueDisponivelPorRef.set(p.ref, p.qtd_estoque || 0);
  }

  const topRefsPorCliente = {};
  if (clienteIds.length > 0) {
    try {
      // Em chunks pra não estourar limite Supabase
      for (let i = 0; i < clienteIds.length; i += 200) {
        const chunk = clienteIds.slice(i, i + 200);
        const { data: tops } = await supabase
          .from('vw_lojas_top_refs_por_cliente')
          .select('cliente_id, ref, posicao, pecas_total, vezes_comprou')
          .in('cliente_id', chunk)
          .order('posicao', { ascending: true });
        for (const r of tops || []) {
          if (!topRefsPorCliente[r.cliente_id]) topRefsPorCliente[r.cliente_id] = [];
          const estoqueAtual = estoqueDisponivelPorRef.get(r.ref) || 0;
          topRefsPorCliente[r.cliente_id].push({
            ref: r.ref,
            posicao: r.posicao,
            pecas_total: r.pecas_total,
            vezes_comprou: r.vezes_comprou,
            // em_estoque=true → IA pode oferecer essa REF como REPOSICAO
            // (cliente compra bem + temos estoque hoje). Sinal explícito
            // pra IA não ter que cruzar listas mentalmente.
            em_estoque: estoqueAtual >= ESTOQUE_MIN_REPOSICAO,
            qtd_estoque: estoqueAtual,
          });
        }
      }
    } catch (e) {
      console.warn('[lojas-ia] sem top refs por cliente (view ausente?):', e?.message);
    }
  }

  // ─── CATEGORIAS FREQUENTES POR CLIENTE (decisão Ailson 30/04/2026) ────
  // Além das top 3 REFs específicas, IA também precisa saber em quais
  // CATEGORIAS (calça, blusa, vestido, macacão...) cada cliente compra
  // muito. Isso permite oferecer uma novidade/best_seller que é dessa
  // categoria mesmo quando a REF não está no top 3 específico dela.
  // Threshold "dominante" = pct >= 30% (config DOMINANTE_PCT_MIN).
  const DOMINANTE_PCT_MIN = 30;
  const categoriasFreqPorCliente = {}; // { cliente_id: [{categoria, pct, pecas}, ...] }
  if (clienteIds.length > 0) {
    try {
      for (let i = 0; i < clienteIds.length; i += 200) {
        const chunk = clienteIds.slice(i, i + 200);
        const { data: cats } = await supabase
          .from('vw_lojas_categorias_freq_por_cliente')
          .select('cliente_id, categoria, pct, pecas')
          .in('cliente_id', chunk)
          .order('pct', { ascending: false });
        for (const r of cats || []) {
          if (!categoriasFreqPorCliente[r.cliente_id]) categoriasFreqPorCliente[r.cliente_id] = [];
          categoriasFreqPorCliente[r.cliente_id].push({
            categoria: r.categoria,
            pct: Number(r.pct) || 0,
            pecas: r.pecas,
            // dominante = cliente compra MUITO essa categoria. Sinal pro
            // prompt usar como gatilho de "oferecer novidade da categoria
            // mesmo sem REF específica no top".
            dominante: Number(r.pct) >= DOMINANTE_PCT_MIN,
          });
        }
      }
    } catch (e) {
      console.warn('[lojas-ia] sem categorias freq por cliente (view ausente?):', e?.message);
    }
  }

  // ─── MAIS VENDIDOS 45d (categoria de produtos no payload) ─────────────
  // Decisão Ailson 28/04/2026: top 10 vendas 45d (loja física) entra como
  // categoria PRÓPRIA no produtos_disponiveis (não vira slot, é só repertório).
  // Texto sugerido: "Esse modelo tá saindo super bem na loja, quer ver?"
  // ATUALIZADO 04/05/2026: emAltaAuto agora e o top 10 curva A (era curva B
  // antes da correcao da regra). Usamos emAltaAuto que tem o top 10 real.
  const maisVendidos45d = emAltaAuto.slice(0, 10);

  // ─── REPOSIÇÃO: REFs ja vendidas, em janela de reposicao ─────────
  //
  // Decisão Ailson 28/04/2026: tipo NOVO de sugestão. Quando IA pega uma
  // novidade da oficina e essa REF já existe em vendas anteriores, é
  // REPOSIÇÃO (não novidade pura). Substitui 1 slot de novidade ou followup.
  //
  // BUG CRITICO CORRIGIDO 04/05/2026:
  // Codigo anterior lia de 'produtos' (vw_lojas_produtos_oferecveis) filtrando
  // motivo_oferta='novidade_oficina'. MAS:
  //   - lojas_produtos.data_entrega_oficina NUNCA foi populado (NULL pra todos)
  //   - lojas_produtos.motivo_pode_oferecer NUNCA recebeu 'novidade_oficina'
  // Resultado: refsReposicao=[] sempre.
  //
  // SOLUCAO 04/05/2026: view vw_lojas_reposicoes_auto faz tudo:
  //   - Cortes Amícia entregues
  //   - Janela 5-10d (sem caseado) ou 7-12d (com caseado, lido da ficha técnica)
  //   - REF tem que ter vendido alguma vez antes (EXISTS lojas_vendas_itens)
  // Plus: refs em curadoria manual 'novidade_manual' que ja venderam tambem
  // entram (admin marcou como novidade, mas ja tinha historico → reposição).
  let refsReposicao = [];
  try {
    const { data: repoRaw } = await supabase
      .from('vw_lojas_reposicoes_auto')
      .select('ref');
    refsReposicao = (repoRaw || []).map(r => r.ref);

    // Inclui curadoria manual de novidade que ja vendeu antes.
    const refsCuradoriaNovidade = (curadoria || [])
      .filter(c => c.tipo === 'novidade_manual')
      .map(c => c.ref);
    if (refsCuradoriaNovidade.length > 0) {
      const { data: vendaAnt } = await supabase
        .from('lojas_vendas_itens')
        .select('ref')
        .in('ref', refsCuradoriaNovidade)
        .limit(500);
      const refsManualComVenda = new Set((vendaAnt || []).map(v => v.ref));
      // Adiciona sem duplicar
      const setRepo = new Set(refsReposicao);
      for (const r of refsCuradoriaNovidade) {
        if (refsManualComVenda.has(r) && !setRepo.has(r)) {
          refsReposicao.push(r);
        }
      }
    }
  } catch (e) {
    console.warn('[lojas-ia] sem reposicoes (view ausente?):', e?.message);
  }

  // Promoções ativas
  const { data: promocoes } = await supabase
    .from('lojas_promocoes')
    .select('id, nome_curto, descricao_completa, categoria, data_inicio, data_fim, pedido_minimo, desconto_pct')
    .eq('ativo', true)
    .gte('data_fim', hoje)
    .order('data_fim');

  // ─── AÇÕES VIGENTES (Ailson 30/04/2026) ───────────────────────────────
  // Mensagens contextuais que a IA INCORPORA nas sugestões (não consome
  // slot). Ex: "feliz dia das mulheres", "loja fecha mais cedo na quinta".
  const { data: acoesVigentes } = await supabase
    .from('lojas_contextos_ia')
    .select('id, texto, data_inicio, data_fim')
    .eq('ativa', true)
    .lte('data_inicio', hoje)
    .gte('data_fim', hoje);

  // ─── AVISO DEDICADO PRO DIA ───────────────────────────────────────────
  // Disparo único pra essa vendedora (ou todas) hoje. IA cria sugestão
  // dedicada no slot 1 e marca como consumido após o cron.
  // vendedoras_ids vazio/null = todas; senão filtra.
  const { data: avisosHoje } = await supabase
    .from('lojas_avisos')
    .select('id, texto, vendedoras_ids, cliente_id')
    .eq('status', 'pendente')
    .eq('data_disparo', hoje);

  // Filtra avisos que pertencem a essa vendedora (todas OU explicitamente
  // selecionada). Pode ter mais de 1, mas só consideramos o primeiro como
  // slot dedicado — outros viram "ver também" no contexto.
  const avisosDestaVendedora = (avisosHoje || []).filter(a =>
    !a.vendedoras_ids
    || a.vendedoras_ids.length === 0
    || a.vendedoras_ids.includes(vendedoraId)
  );

  // ─── CORES EM ALTA (Ailson 30/04/2026, semantica opt-in) ──────────────
  // IA usa APENAS cores em lojas_cores_curadoria_manual. Top Bling
  // (vw_ranking_cores_catalogo) é so visualizacao na admin — admin precisa
  // clicar pra ativar uma cor (que entra na tabela manual com
  // motivo='top_bling_selecionada').
  // Cores adicionadas livremente pela admin (sem motivo especial) tambem
  // entram. Sem nada selecionado, IA nao menciona cores (so se pedido
  // explicitamente em ações).
  const coresEmAlta = [];
  try {
    const { data: coresManuais } = await supabase
      .from('lojas_cores_curadoria_manual')
      .select('cor, cor_key, motivo')
      .eq('ativa', true);
    for (const c of coresManuais || []) {
      coresEmAlta.push({
        cor: c.cor,
        cor_key: c.cor_key,
        fonte: c.motivo === 'top_bling_selecionada' ? 'bling_auto' : 'manual',
        motivo: c.motivo,
      });
    }
  } catch (e) {
    console.warn('[lojas-ia] lojas_cores_curadoria_manual indisponivel:', e?.message);
  }

  // Regras customizadas (do RegrasScreen)
  const [tomGeral, posicionamento, sempre, nunca, descontoReat, descontoAten, saudacao, fechamento] = await Promise.all([
    getLojasConfig('regras_ia.tom_geral', null),
    getLojasConfig('regras_ia.posicionamento', null),
    getLojasConfig('regras_ia.sempre', null),
    getLojasConfig('regras_ia.nunca', null),
    getLojasConfig('parametros.desconto_reativacao', 10),
    getLojasConfig('parametros.desconto_atencao', 5),
    getLojasConfig('parametros.saudacao_padrao', null),
    getLojasConfig('parametros.fechamento_padrao', null),
  ]);

  // ─── RAIO-X PRODUTOS — acrescimos no cardapio (Ailson 06/05/2026) ─────
  // Carrega dados das views do raio-x pra IA usar como gatilhos extras:
  //   1. top_recompra: refs com mais ocorrencias (90d) — usar em followup_nova
  //      (cliente que comprou 1a vez ha 15d)
  //   2. matches_por_ref: pra cada uma das top 30 refs, suas top 5 matches
  //      (a IA usa pra reposicao + cliente ativa + match dos top 3 do cliente)
  //
  // Essas views sao admin-only no endpoint /api/lojas-produtos-raiox, mas
  // aqui estamos no backend com service_role — pode ler direto.
  let topRecompra = [];
  let matchesPorRef = {};
  try {
    // Top 10 refs em recompra (agregado todas lojas)
    const { data: recRows } = await supabase
      .from('vw_lojas_recompra_90d')
      .select('ref, ocorrencias');
    if (recRows) {
      const aggMap = new Map();
      for (const r of recRows) {
        aggMap.set(r.ref, (aggMap.get(r.ref) || 0) + Number(r.ocorrencias || 0));
      }
      topRecompra = [...aggMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([ref, ocorr]) => {
          const p = produtosFinal.find(pp => pp.ref === ref);
          return {
            ref,
            ocorrencias: ocorr,
            descricao: p?.descricao || null,
            categoria: p?.categoria || null,
            qtd_estoque: p?.qtd_estoque || 0,
          };
        });
    }

    // Matches da materialized view (top 5 por ref)
    const { data: matchRows } = await supabase
      .from('mv_lojas_matches_90d')
      .select('ref_top, ref_match, pct, coocorrencias')
      .order('ref_top')
      .order('pct', { ascending: false });
    if (matchRows) {
      for (const m of matchRows) {
        if (!matchesPorRef[m.ref_top]) matchesPorRef[m.ref_top] = [];
        if (matchesPorRef[m.ref_top].length < 5) {
          const p = produtosFinal.find(pp => pp.ref === m.ref_match);
          matchesPorRef[m.ref_top].push({
            ref_match: m.ref_match,
            pct: m.pct,
            coocorrencias: m.coocorrencias,
            descricao: p?.descricao || null,
            categoria: p?.categoria || null,
            qtd_estoque: p?.qtd_estoque || 0,
          });
        }
      }
    }
  } catch (e) {
    console.warn('[lojas-ia] sem dados raiox (views ausentes?):', e?.message);
  }

  return {
    vendedoraNome: vendedora.nome,
    vendedoraId,
    vendedora: { id: vendedora.id, nome: vendedora.nome, loja: vendedora.loja },
    clientes: clientes || [],
    kpis,
    atencaoEspecial,         // { cliente_id: {score, motivos, tem_atraso_ciclo, ...} } — Ailson 06/05/2026
    janela,                  // { cliente_id: {dias_ate_janela_atencao, dentro_janela_compra, media_confiavel} } — Ailson 07/05/2026 (auditoria GAP 1)
    conversoesPorCliente,    // { cliente_id: {total, ultima_data_venda, ultimo_dias_ate_compra, ultimo_valor} } — Ailson 07/05/2026 (auditoria GAP 2)
    conversoesGeral,         // { qtd_60d, valor_60d, qtd_30d } — agregado da vendedora
    historicoSugestoes,      // { cliente_id|grupo_id: [{data, tipo, ref, titulo}, ...max 5] } — Ailson 07/05/2026 GAP 4
    sacolas: sacolas || [],
    sacolasDescartadas,
    grupos: grupos || [],
    produtos: produtosFinal,
    curadoria: curadoria || [],
    bestSellersAuto,
    emAltaAuto,
    maisVendidos45d,         // top 10 vendas 45d (categoria mais_vendidos)
    topRefsPorCliente,       // { cliente_id: [{ref, posicao, pecas, vezes}] }
    categoriasFreqPorCliente, // { cliente_id: [{categoria, pct, pecas, dominante}] }
    refsReposicao,           // [ref] — novidades que já tinham venda passada
    topRecompra,             // top 10 refs com mais ocorrencias (90d) — Ailson 06/05/2026
    matchesPorRef,           // { ref: [{ref_match, pct, coocorrencias, ...}] } — Ailson 06/05/2026
    clientesEmCooldownGeral, // Set<cliente_id> sugeridos nos ultimos N dias (nao-sacola) — Ailson 06/05/2026
    cooldownGeralDias,       // 7 ou 10 dependendo do tamanho da carteira
    totalCarteira,           // tamanho da carteira da vendedora (pra IA priorizar conversao em carteiras pequenas)
    promocoes: promocoes || [],
    acoesVigentes: acoesVigentes || [],
    avisosDestaVendedora,
    coresEmAlta,
    // Link Vesti escolhido pela vendedora (pode ser null = livre)
    vestiLinkAtivo: vendedora.vesti_link_ativo
      ? (vendedora[`vesti_link_${vendedora.vesti_link_ativo}`] || null)
      : null,
    regrasCustomizadas: {
      tomGeral, posicionamento, sempre, nunca,
      descontoReat, descontoAten, saudacao, fechamento,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MONTAGEM DE CONTEXTO — gerar_mensagem
// ═══════════════════════════════════════════════════════════════════════════

async function montarContextoMensagem(sug, contextoExtra) {
  let cliente = null, grupo = null, kpi = null, docsGrupo = [];

  if (sug.alvo_tipo === 'cliente' && sug.cliente_id) {
    const { data: c } = await supabase
      .from('lojas_clientes')
      .select('*')
      .eq('id', sug.cliente_id)
      .maybeSingle();
    cliente = c;

    const { data: k } = await supabase
      .from('lojas_clientes_kpis')
      .select('*')
      .eq('cliente_id', sug.cliente_id)
      .maybeSingle();
    kpi = k;
  } else if (sug.alvo_tipo === 'grupo' && sug.grupo_id) {
    const { data: g } = await supabase
      .from('lojas_grupos')
      .select('*')
      .eq('id', sug.grupo_id)
      .maybeSingle();
    grupo = g;

    const { data: docs } = await supabase
      .from('lojas_clientes')
      .select('*')
      .eq('grupo_id', sug.grupo_id);
    docsGrupo = docs || [];
  } else {
    return { erro: 'Sugestão sem cliente/grupo válido' };
  }

  // Produto referenciado (se houver)
  let produto = null;
  if (sug.produto_ref) {
    const refNorm = refSemZero(sug.produto_ref);
    const { data: p } = await supabase
      .from('lojas_produtos')
      .select('ref, descricao, categoria, qtd_estoque, preco_medio')
      .eq('ref', refNorm)
      .maybeSingle();
    produto = p;
  }

  // Promoção referenciada (se houver)
  let promocao = null;
  if (sug.promocao_id) {
    const { data: p } = await supabase
      .from('lojas_promocoes')
      .select('id, nome_curto, descricao_completa, categoria, data_fim, desconto_pct, pedido_minimo')
      .eq('id', sug.promocao_id)
      .maybeSingle();
    promocao = p;
  }

  // Top 6 cores do ranking Bling — pra IA mencionar UMA cor real na mensagem
  // (gancho do tipo "tem cor que tá acabando").
  // Fonte: vw_ranking_cores_catalogo (mesma view usada pelo OS Amícia).
  let coresTop = [];
  try {
    const { data: cores } = await supabase
      .from('vw_ranking_cores_catalogo')
      .select('cor, vendas_45d')
      .order('vendas_45d', { ascending: false })
      .limit(6);
    coresTop = (cores || []).map(c => c.cor).filter(Boolean);
  } catch (e) {
    console.warn('[lojas-ia/mensagem] sem cores top:', e?.message);
  }

  // Regras customizadas (mesmas que sugestões)
  const [tomGeral, posicionamento, sempre, nunca, saudacao, fechamento] = await Promise.all([
    getLojasConfig('regras_ia.tom_geral', null),
    getLojasConfig('regras_ia.posicionamento', null),
    getLojasConfig('regras_ia.sempre', null),
    getLojasConfig('regras_ia.nunca', null),
    getLojasConfig('parametros.saudacao_padrao', null),
    getLojasConfig('parametros.fechamento_padrao', null),
  ]);

  // Estilo aprendido da vendedora (Ailson 04/05/2026): IA usa as edicoes
  // anteriores dela como referencia pra gerar mensagem mais parecida com o
  // jeito dela escrever. So entra no prompt se houver pelo menos 1 edicao.
  //
  // REFERENCIA VIVA — Ailson 07/05/2026:
  // Se vendedora B tem chave aprende_com.<B> = <A>, IA busca estilo de A
  // em vez de B. Permite admin definir vendedora top como referencia
  // pra outras imitarem. Estilo de A continua evoluindo (A continua
  // editando), B sempre acompanha automaticamente.
  let estiloVendedora = null;
  let estiloVendedoraOrigemId = sug.vendedora_id; // por default usa o proprio
  try {
    const { data: aprendeRow } = await supabase
      .from('lojas_config')
      .select('valor')
      .eq('chave', `aprende_com.${sug.vendedora_id}`)
      .maybeSingle();
    if (aprendeRow?.valor) {
      estiloVendedoraOrigemId = aprendeRow.valor; // redireciona pra referencia
    }

    const { data: estilo } = await supabase
      .from('lojas_estilo_vendedora')
      .select('*')
      .eq('vendedora_id', estiloVendedoraOrigemId)
      .maybeSingle();

    if (estilo && (estilo.qtd_edicoes || 0) > 0) {
      // Pega top 3 de cada categoria
      const top3 = (counterObj) => {
        const entries = Object.entries(counterObj || {});
        return entries
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k]) => k);
      };

      // Ultimas 3 edicoes (few-shot pra IA "imitar" o tom)
      // Usa estiloVendedoraOrigemId (proprio OU referencia, conforme aprende_com)
      const { data: edicoes } = await supabase
        .from('lojas_edicoes_mensagens')
        .select('texto_original, texto_editado')
        .eq('vendedora_id', estiloVendedoraOrigemId)
        .order('criado_em', { ascending: false })
        .limit(3);

      estiloVendedora = {
        qtd_edicoes: estilo.qtd_edicoes,
        saudacao_inicial_top: top3(estilo.saudacao_inicial),
        saudacao_final_top: top3(estilo.saudacao_final),
        tratamento_top: top3(estilo.tratamento),
        emojis_top: top3(estilo.emojis),
        ultimas_edicoes: edicoes || [],
        eh_de_referencia: estiloVendedoraOrigemId !== sug.vendedora_id, // sinaliza se vem de outra vendedora
      };
    }
  } catch (e) {
    console.warn('[ia-mensagem] estilo vendedora indisponivel:', e?.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXTO RICO — Ailson 07/05/2026
  // Dados que ja existem mas nao estavam indo pra geracao individual de
  // mensagem. Trazendo paridade com as sugestoes diarias.
  // ═══════════════════════════════════════════════════════════════════════════

  let janelaCompra = null;
  let conversoesCliente = null;
  let historicoSugestoes = [];
  let topCategorias = [];
  let ultimaCompra = null;
  let perfilCanal = null;
  let statusEfetivo = null;
  let pecaInfo = null; // novidade? reposição? combina com estilo dela?

  if (cliente && cliente.id) {
    // 1. JANELA DE COMPRA
    try {
      const { data: jData } = await supabase
        .from('vw_lojas_clientes_janela')
        .select('dias_ate_janela_atencao, dentro_janela_compra, media_confiavel, media_dias_compras')
        .eq('cliente_id', cliente.id)
        .maybeSingle();
      if (jData?.media_confiavel) {
        janelaCompra = {
          estado: jData.dentro_janela_compra
            ? 'na_janela'
            : (jData.dias_ate_janela_atencao > 0 ? 'confortavel' : 'passou_janela'),
          media_dias: Math.round(jData.media_dias_compras || 0),
          dias_ate_janela: jData.dias_ate_janela_atencao,
        };
      }
    } catch (e) { /* silent */ }

    // 2. CONVERSOES anteriores (60d)
    try {
      const dataLimite = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
      const { data: conv } = await supabase
        .from('lojas_conversoes')
        .select('data_venda, dias_ate_compra, valor_venda')
        .eq('cliente_id', cliente.id)
        .gte('data_venda', dataLimite)
        .order('data_venda', { ascending: false });
      if (conv?.length > 0) {
        conversoesCliente = {
          total: conv.length,
          ultima_data: conv[0].data_venda,
          ultimo_dias_ate_compra: conv[0].dias_ate_compra,
          ultimo_valor: conv[0].valor_venda,
        };
      }
    } catch (e) { /* silent */ }

    // 3. HISTORICO de sugestoes (28d, max 5) — anti-repeticao
    try {
      const dataLimiteHist = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);
      const { data: hist } = await supabase
        .from('lojas_sugestoes_diarias')
        .select('data_geracao, tipo, titulo, produto_ref')
        .eq('cliente_id', cliente.id)
        .gte('data_geracao', dataLimiteHist)
        .in('status', ['executada', 'pendente'])
        .order('data_geracao', { ascending: false })
        .limit(5);
      historicoSugestoes = (hist || []).map(h => ({
        data: h.data_geracao,
        tipo: h.tipo,
        ref: h.produto_ref || null,
        titulo: h.titulo,
      }));
    } catch (e) { /* silent */ }

    // 4. TOP CATEGORIAS — o que cliente mais compra
    try {
      const { data: itens } = await supabase
        .from('lojas_vendas_itens')
        .select('categoria, qtd, lojas_vendas!inner(cliente_id)')
        .eq('lojas_vendas.cliente_id', cliente.id);
      if (itens?.length) {
        const counts = {};
        itens.forEach(i => {
          const cat = i.categoria || 'outros';
          counts[cat] = (counts[cat] || 0) + (i.qtd || 1);
        });
        topCategorias = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([cat, qtd]) => ({ categoria: cat, qtd }));
      }
    } catch (e) { /* silent */ }

    // 5. ULTIMA COMPRA — data + REFs principais
    try {
      const { data: ultima } = await supabase
        .from('lojas_vendas')
        .select('id, data_venda, valor_total')
        .eq('cliente_id', cliente.id)
        .order('data_venda', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultima) {
        const { data: itensUlt } = await supabase
          .from('lojas_vendas_itens')
          .select('ref, descricao, categoria')
          .eq('venda_id', ultima.id)
          .limit(5);
        const diasAtras = Math.round((Date.now() - new Date(ultima.data_venda).getTime()) / 86400000);
        ultimaCompra = {
          data: ultima.data_venda,
          dias_atras: diasAtras,
          valor: parseFloat(ultima.valor_total || 0),
          itens: (itensUlt || []).map(i => ({
            ref: i.ref,
            descricao: (i.descricao || '').slice(0, 50),
            categoria: i.categoria,
          })),
        };
      }
    } catch (e) { /* silent */ }

    // 6. PERFIL CANAL — granular (igual gap 3)
    if (kpi) {
      const fis = kpi.qtd_compras_fisicas || 0;
      const ves = kpi.qtd_compras_vesti || 0;
      const con = kpi.qtd_compras_convertr || 0;
      const total = fis + ves + con;
      if (total === 0) {
        perfilCanal = cliente.canal_cadastro === 'vesti' ? 'so_cadastro_vesti' : 'sem_dados';
      } else {
        const pctF = fis / total, pctV = ves / total, pctC = con / total;
        if (pctF >= 0.9) perfilCanal = 'so_presencial';
        else if (pctV >= 0.9) perfilCanal = 'so_vesti';
        else if (pctC >= 0.9) perfilCanal = 'so_online';
        else if (pctF >= 0.5 && pctV > 0) perfilCanal = 'hibrido_loja_vesti';
        else if (pctF >= 0.5 && pctC > 0) perfilCanal = 'hibrido_loja_online';
        else perfilCanal = 'misto';
      }
    }

    // 7. STATUS EFETIVO (dias_sem_comprar -> categoria)
    if (kpi?.dias_sem_comprar != null) {
      const d = kpi.dias_sem_comprar;
      if (d <= 30) statusEfetivo = 'ativo';
      else if (d <= 60) statusEfetivo = 'atencao';
      else if (d <= 120) statusEfetivo = 'sem_atividade';
      else statusEfetivo = 'inativo';
    }

    // 8. PECA INFO — a peca da sugestao eh novidade? reposicao? combina?
    if (sug.produto_ref) {
      const refSemZ = String(sug.produto_ref).replace(/^0+/, '') || '0';
      try {
        // Verifica se eh novidade
        const { data: nov } = await supabase
          .from('vw_lojas_novidades_auto')
          .select('ref')
          .eq('ref', refSemZ)
          .maybeSingle();
        // Verifica se eh reposicao
        const { data: rep } = await supabase
          .from('vw_lojas_reposicoes_auto')
          .select('ref')
          .eq('ref', refSemZ)
          .maybeSingle();
        // Cruza com top categorias da cliente
        const categoriaSug = produto?.categoria || null;
        const combinaEstilo = categoriaSug && topCategorias.some(t => t.categoria === categoriaSug);
        pecaInfo = {
          eh_novidade: !!nov,
          eh_reposicao: !!rep,
          combina_estilo_cliente: !!combinaEstilo,
          categoria: categoriaSug,
        };
      } catch (e) { /* silent */ }
    }
  }

  return {
    cliente, grupo, kpi, docsGrupo,
    produto, promocao, coresTop,
    regrasCustomizadas: { tomGeral, posicionamento, sempre, nunca, saudacao, fechamento },
    estiloVendedora,
    // Contexto rico — Ailson 07/05/2026
    janelaCompra, conversoesCliente, historicoSugestoes,
    topCategorias, ultimaCompra, perfilCanal, statusEfetivo, pecaInfo,
    // Observações da vendedora — Ailson 07/05/2026 (etapa B)
    observacoesVendedora: cliente?.observacoes_ia || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUÇÃO DE PROMPTS COM CACHE_CONTROL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Anthropic prompt caching: blocos com cache_control viram cache.
 *
 * Estrutura: [base, regras_dinamicas]
 *  - base = SYSTEM_PROMPT_SUGESTOES (estável, hash quase nunca muda) → CACHED
 *  - regras_dinamicas = inject das config customizadas → não cacheada
 *
 * Anthropic mantém o cache por 5min. Sucessivas chamadas dentro desse prazo
 * pagam só 10% do input pra parte cacheada.
 */
function montarSystemSugestoes(regras) {
  const blocks = [
    {
      type: 'text',
      text: SYSTEM_PROMPT_SUGESTOES,
      cache_control: { type: 'ephemeral' },
    },
  ];

  // Bloco dinâmico: regras customizadas + parâmetros (NÃO cacheia — muda toda hora)
  const dinamico = construirBlocoDinamico(regras);
  if (dinamico) {
    blocks.push({ type: 'text', text: dinamico });
  }

  return blocks;
}

function montarSystemMensagens(regras) {
  const blocks = [
    {
      type: 'text',
      text: SYSTEM_PROMPT_MENSAGENS,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const dinamico = construirBlocoDinamico(regras);
  if (dinamico) {
    blocks.push({ type: 'text', text: dinamico });
  }

  return blocks;
}

function construirBlocoDinamico(r) {
  if (!r) return null;
  const linhas = [];

  if (r.tomGeral) linhas.push(`## Tom personalizado pela equipe\n\n${r.tomGeral}`);
  if (r.posicionamento) linhas.push(`## Posicionamento da marca\n\n${r.posicionamento}`);

  if (Array.isArray(r.sempre) && r.sempre.length > 0) {
    linhas.push(`## Regras adicionais — A IA SEMPRE deve\n\n${r.sempre.map(x => `- ${x}`).join('\n')}`);
  }
  if (Array.isArray(r.nunca) && r.nunca.length > 0) {
    linhas.push(`## Regras adicionais — A IA NUNCA deve\n\n${r.nunca.map(x => `- ${x}`).join('\n')}`);
  }

  if (r.descontoReat != null) {
    linhas.push(`## Parâmetros\n\n- Desconto reativação (cliente 90+ dias): ${r.descontoReat}%\n- Desconto atenção (cliente 45-90 dias): ${r.descontoAten || 5}%`);
  }

  if (r.saudacao) linhas.push(`## Saudação padrão\n\n${r.saudacao}`);
  if (r.fechamento) linhas.push(`## Fechamento padrão\n\n${r.fechamento}`);

  return linhas.length > 0 ? linhas.join('\n\n') : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MENSAGENS (few-shot + user input)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pra Prompt A: few-shot ensina a IA a gerar JSON de qualidade. Não
 * mandamos os 23 exemplos — só os 2-3 mais relevantes ao tipo de carteira.
 *
 * Pra Prompt A na verdade os exemplos são de mensagem (Prompt B) — então
 * eles servem mais pra calibrar o "tom" das sugestões. Vou enviar só 2
 * exemplos de tipos diferentes pra IA pegar o vibe.
 */
function montarMessagesSugestoes(ctx) {
  // Set de clientes com sacola ativa (preservar mesmo se KPI fraco)
  const clientesComSacola = new Set((ctx.sacolas || []).map(s => s.cliente_id));

  // FILTROS DE CARTEIRA (28/04/2026, decisão Ailson):
  //   - Cliente sem dias_sem_comprar E sem ultima_compra → KPI inutilizável pra
  //     reativar/atenção/followup. Remove (a menos que tenha sacola).
  //   - pular_ate futuro → vendedora marcou pra pular agora
  //
  // ACRESCIMO 06/05/2026: cooldown geral
  //   - Cliente sugerido nos ultimos N dias (10 padrao, 7 pra carteiras <100):
  //     remove. Excecao: cliente com sacola ativa passa (sacola tem regra propria)
  const carteiraFiltradaInfo = { sem_kpi: 0, pulando: 0, kpi_parcial: 0, em_cooldown: 0 };
  const hojeISO = new Date().toISOString().slice(0, 10);

  const carteira = ctx.clientes
    .filter(c => {
      // Pular_ate
      if (c.pular_ate && c.pular_ate >= hojeISO) {
        carteiraFiltradaInfo.pulando++;
        return false;
      }
      // KPI inutilizável — descarta SE não tiver sacola ativa
      const k = ctx.kpis[c.id] || {};
      const kpiInutil = (k.dias_sem_comprar == null && !k.ultima_compra);
      if (kpiInutil && !clientesComSacola.has(c.id)) {
        carteiraFiltradaInfo.sem_kpi++;
        return false;
      }
      // Cooldown geral — descarta SE não tiver sacola ativa
      // (sacolas têm cooldown próprio mais curto via clientesEmCooldownSacola)
      if (ctx.clientesEmCooldownGeral?.has(c.id) && !clientesComSacola.has(c.id)) {
        carteiraFiltradaInfo.em_cooldown++;
        return false;
      }
      return true;
    })
    .map(c => {
      const k = ctx.kpis[c.id] || {};
      // Flag kpi_incompleto: cliente passou no filtro mas falta dado importante
      const kpiIncompleto = (k.dias_sem_comprar == null || !k.ultima_compra);
      if (kpiIncompleto) carteiraFiltradaInfo.kpi_parcial++;
      // Cliente usa Vesti se: comprou pelo Vesti antes (vendas físicas registram
      // canal_dominante=vesti_dominante OU qtd_compras_vesti>0) OU foi importada
      // como contato Vesti (canal_cadastro='vesti', mesmo sem vendas físicas).
      // Decisão Ailson 30/04/2026: import de pedidos Vesti ultimos 75d gera
      // clientes com canal_cadastro=vesti — IA precisa enxergar como Vesti pra
      // sugerir mandar link/video do app.
      const usaVestiCli = c.canal_cadastro === 'vesti'
        || k.canal_dominante === 'vesti_dominante'
        || (k.qtd_compras_vesti || 0) > 0;

      // PERFIL DE CANAL CONSOLIDADO — Ailson 07/05/2026 (auditoria GAP 3)
      // Combina qtd_compras_fisicas/vesti/convertr pra escolher tom/canal:
      //   so_presencial: 90%+ veio na loja — fala "passa aqui pra ver"
      //   so_vesti:      90%+ comprou Vesti — sempre manda link Vesti
      //   so_online:     90%+ Convertr/sacola — manda fotos+link, nao convida loja
      //   hibrido_loja_vesti: vai na loja MAS tambem usa Vesti
      //   hibrido_loja_online: vai na loja MAS tambem compra online
      //   so_cadastro_vesti: tem canal_cadastro=vesti mas ZERO compra (nova)
      //   sem_dados: cliente sem compras — usa canal_cadastro raw
      const fis = k.qtd_compras_fisicas || 0;
      const ves = k.qtd_compras_vesti || 0;
      const con = k.qtd_compras_convertr || 0;
      const totalCompras = fis + ves + con;
      let perfilCanal;
      if (totalCompras === 0) {
        perfilCanal = c.canal_cadastro === 'vesti' ? 'so_cadastro_vesti' : 'sem_dados';
      } else {
        const pctFis = fis / totalCompras;
        const pctVes = ves / totalCompras;
        const pctCon = con / totalCompras;
        if (pctFis >= 0.9) perfilCanal = 'so_presencial';
        else if (pctVes >= 0.9) perfilCanal = 'so_vesti';
        else if (pctCon >= 0.9) perfilCanal = 'so_online';
        else if (pctFis >= 0.5 && pctVes > 0) perfilCanal = 'hibrido_loja_vesti';
        else if (pctFis >= 0.5 && pctCon > 0) perfilCanal = 'hibrido_loja_online';
        else perfilCanal = 'misto';
      }

      return {
        id: c.id,
        apelido: c.apelido || c.comprador_nome || c.razao_social?.split(' ').slice(0, 3).join(' '),
        documento_tipo: c.tipo_documento,
        grupo_id: c.grupo_id,
        pular_ate: c.pular_ate,
        kpi_incompleto: kpiIncompleto, // ⚠️ NÃO use pra reativar/atenção/followup se true
        // ATENCAO ESPECIAL — Ailson 06/05/2026.
        // Cliente ATIVO mas com mudanca de comportamento (atrasou ciclo,
        // queda volume, queda ticket, devolucao). IA deve PRIORIZAR este
        // cliente e MENCIONAR motivos discretamente na mensagem.
        // null = cliente nao tem score >=3.
        atencao_especial: ctx.atencaoEspecial?.[c.id] ? {
          score: ctx.atencaoEspecial[c.id].score,
          motivos: ctx.atencaoEspecial[c.id].motivos,
        } : null,
        // JANELA DE COMPRA — Ailson 07/05/2026 (auditoria GAP 1).
        // Indica se cliente esta confortavel no ciclo natural ou se passou
        // do prazo. IA deve usar pra DESPRIORIZAR cliente que vai comprar
        // sozinho. NAO eh filtro absoluto — IA ainda pode sugerir se houver
        // razao forte (sacola, atencao_especial, novidade do top_ref).
        // null = cliente sem media confiavel (<5 visitas) — usa regra fixa.
        janela_compra: ctx.janela?.[c.id]?.media_confiavel ? {
          dentro_janela: ctx.janela[c.id].dentro_janela_compra,
          dias_ate_janela: ctx.janela[c.id].dias_ate_janela_atencao,
          media_dias: Math.round(ctx.janela[c.id].media_dias_compras || 0),
          // Estado humano-legivel pra IA usar:
          //   'confortavel'   = ainda no ciclo natural (faltam dias pra janela)
          //   'na_janela'     = entrou na janela ideal de compra
          //   'passou_janela' = ja passou da janela (atrasando ciclo proprio)
          estado: ctx.janela[c.id].dentro_janela_compra
            ? 'na_janela'
            : (ctx.janela[c.id].dias_ate_janela_atencao > 0 ? 'confortavel' : 'passou_janela'),
        } : null,
        // CONVERSOES — Ailson 07/05/2026 (auditoria GAP 2).
        // Indica se cliente ja respondeu a mensagem com compra antes (60d).
        // total: quantas vezes converteu
        // ultima_dias_ate_compra: tempo de resposta (0-15d)
        // ultimo_valor: valor da ultima conversao
        // null = nunca converteu (ou nao tem registro nos ultimos 60d)
        conversoes: ctx.conversoesPorCliente?.[c.id] ? {
          total: ctx.conversoesPorCliente[c.id].total,
          ultima_data: ctx.conversoesPorCliente[c.id].ultima_data_venda,
          ultimo_dias_ate_compra: ctx.conversoesPorCliente[c.id].ultimo_dias_ate_compra,
          ultimo_valor: ctx.conversoesPorCliente[c.id].ultimo_valor,
        } : null,
        // HISTORICO recente de sugestoes (28 dias) — Ailson 07/05/2026 GAP 4.
        // IA usa pra evitar repetir conteudo: mesma REF, mesmo tipo, mesmo
        // tema. Lista vem ordenada (mais recente primeiro). Maximo 5 itens.
        // Vazio = cliente novo no fluxo IA OU nao foi sugerido nos ultimos
        // 28 dias.
        historico_sugestoes: ctx.historicoSugestoes?.[c.id] || [],
        // Cliente Vesti? Combina vendas físicas (KPIs) + cadastro Vesti
        // (canal_cadastro). True = priorizar sugerir link/video do app.
        usa_vesti: usaVestiCli,
        canal_cadastro: c.canal_cadastro || null,
        perfil_canal: perfilCanal,    // Ailson 07/05/2026 GAP 3 — granularidade Vesti/presencial/online/hibrido
        // Top 3 REFs que essa cliente compra bem (score peças+recorrência).
        // IA usa pra: detectar reposição, dizer "vende bem pra você",
        // alternar recomendações sem repetir.
        // ACRESCIMO 06/05/2026: cada top_ref vem com .matches[] (top 5 refs
        // que aparecem juntas com ela em outras compras). IA pode oferecer
        // o match em vez de buscar peca da mesma categoria.
        top_refs_cliente: (ctx.topRefsPorCliente?.[c.id] || []).map(tr => ({
          ...tr,
          matches: ctx.matchesPorRef?.[tr.ref] || [],
        })),
        // Distribuicao de compras por CATEGORIA (calça, blusa, vestido,
        // macacão...). Categoria com dominante=true (pct>=30%) sinaliza pra
        // IA: pode oferecer novidade/best_seller dessa categoria mesmo sem
        // REF específica no top 3 da cliente. Item: {categoria, pct,
        // pecas, dominante}.
        categorias_freq: ctx.categoriasFreqPorCliente?.[c.id] || [],
        kpi: {
          dias_sem_comprar: k.dias_sem_comprar,
          ultima_compra: k.ultima_compra,
          lifetime_total: k.lifetime_total,
          qtd_compras: k.qtd_compras,
          ticket_medio: k.ticket_medio,
          fase_ciclo_vida: k.fase_ciclo_vida,
          status_atual: k.status_atual,
          canal_dominante: k.canal_dominante,
          perfil_presenca: k.perfil_presenca,
          paga_com_cheque: k.paga_com_cheque,
          estilo_dominante: k.estilo_dominante,
          tamanhos_frequentes: k.tamanhos_frequentes,
        },
      };
    });

  // Classifica produtos uma vez só (usado no payload e na telemetria)
  const produtosClassificados = classificarProdutos(
    ctx.produtos, ctx.curadoria, ctx.bestSellersAuto, ctx.emAltaAuto, ctx.maisVendidos45d
  );

  // Constrói payload enxuto pra IA — só dados que ela usa
  const userPayload = {
    data_geracao: new Date().toISOString(),
    vendedora: ctx.vendedora,
    carteira,
    grupos: ctx.grupos,
    sacolas_ativas: ctx.sacolas.map(s => ({
      cliente_id: s.cliente_id,
      data_cadastro_sacola: s.data_cadastro_sacola,
      valor_total: s.valor_total,
      qtd_pecas: s.qtd_pecas,
      subtipo_sugerido: s.subtipo_sugerido,
      observacao: s.observacao,
    })),
    produtos_disponiveis: produtosClassificados,
    // REFs que aparecem em "novidades" mas JÁ FORAM vendidas antes — são
    // candidatas a sugestão tipo "reposicao" (decisão Ailson 28/04/2026).
    // IA usa: se uma novidade da oficina está nessa lista E está no top 3 da
    // cliente, vira sugestão de reposição (substitui novidade ou followup).
    refs_reposicao: ctx.refsReposicao || [],
    // Top 10 refs com MAIS RECOMPRA (90d, agregado todas lojas).
    // ACRESCIMO 06/05/2026: IA usa em followup_nova (cliente que comprou 1a
    // vez ha 15d) pra oferecer "recompra certeira" — peca que outros clientes
    // levam de volta toda hora. Cada item tem ref, ocorrencias, descricao,
    // categoria, qtd_estoque.
    top_recompra: ctx.topRecompra || [],
    promocoes_ativas: ctx.promocoes.map(p => ({
      id: p.id,
      nome: p.nome_curto,
      descricao: p.descricao_completa,
      categoria: p.categoria,
      vence_em: p.data_fim,
      desconto_pct: p.desconto_pct,
      pedido_minimo: p.pedido_minimo,
    })),
    // Mensagens contextuais admin pra incorporar nas sugestoes durante o
    // periodo. NAO consome slot. Ex: "feliz dia das mulheres".
    acoes_vigentes: (ctx.acoesVigentes || []).map(a => ({
      id: a.id,
      texto: a.texto,
      vence_em: a.data_fim,
    })),
    // Aviso DEDICADO pra essa vendedora hoje. Se presente, IA DEVE criar a
    // sugestao prioridade=1 baseada no texto, em vez do reativar usual.
    aviso_dedicado_hoje: (ctx.avisosDestaVendedora || []).length > 0
      ? {
          id: ctx.avisosDestaVendedora[0].id,
          texto: ctx.avisosDestaVendedora[0].texto,
          cliente_id_alvo: ctx.avisosDestaVendedora[0].cliente_id || null,
        }
      : null,
    // Cores em alta (top Bling + manuais). IA pode mencionar nas mensagens
    // mesmo sem REF especifica. Ex: "chegou varios modelos de Marrom, ta
    // super em alta!"
    cores_em_alta: (ctx.coresEmAlta || []).map(c => ({
      cor: c.cor,
      fonte: c.fonte,  // 'bling_auto' ou 'manual'
    })),
    // Link Vesti que a vendedora cadastrou e marcou como ativo. Se null,
    // IA fica livre pra mencionar Vesti sem link, ou nao mencionar.
    vesti_link_vendedora: ctx.vestiLinkAtivo,
    diagnostico_filtros: {
      ...carteiraFiltradaInfo,
      sacolas_descartadas: ctx.sacolasDescartadas || {},
      cooldown_geral: {
        dias: ctx.cooldownGeralDias || null,
        clientes_em_cooldown: ctx.clientesEmCooldownGeral?.size || 0,
        carteira_total: ctx.totalCarteira || null,
      },
      produtos: {
        novidades: produtosClassificados.novidades.length,
        best_sellers: produtosClassificados.best_sellers.length,
        em_alta: produtosClassificados.em_alta.length,
        mais_vendidos: produtosClassificados.mais_vendidos.length,
        estoque_geral: produtosClassificados.estoque_geral.length,
        best_sellers_auto_loja_fisica: ctx.bestSellersAuto?.length || 0,
        em_alta_auto_loja_fisica: ctx.emAltaAuto?.length || 0,
        refs_reposicao: ctx.refsReposicao?.length || 0,
      },
      clientes_com_top_refs: Object.keys(ctx.topRefsPorCliente || {}).length,
      // Quantos clientes da carteira tem ao menos 1 categoria DOMINANTE
      // (pct>=30%). Sinal pra IA poder oferecer novidade dessa categoria
      // mesmo sem REF especifica no top 3 da cliente.
      clientes_com_categoria_dominante: Object.values(ctx.categoriasFreqPorCliente || {})
        .filter(arr => arr.some(c => c.dominante)).length,
      // Quantos clientes da carteira tem AO MENOS 1 REF do seu top em
      // estoque hoje — esses sao candidatos fortes pra sugestao tipo
      // "reposicao" ampla. Se esse numero for alto e a IA nao gerar
      // nenhuma "reposicao", o prompt nao esta sendo seguido.
      clientes_com_top_ref_em_estoque: (carteira || [])
        .filter(c => (c.top_refs_cliente || []).some(t => t.em_estoque)).length,
      // Vesti unificado: vendas físicas + import de cadastro Vesti
      clientes_vesti_na_carteira: (ctx.clientes || [])
        .filter(c => c.canal_cadastro === 'vesti'
          || ctx.kpis[c.id]?.canal_dominante === 'vesti_dominante'
          || (ctx.kpis[c.id]?.qtd_compras_vesti || 0) > 0).length,
      // Detalhamento: quantos vieram de cada origem (debug do import 30/04)
      clientes_vesti_por_canal_cadastro: (ctx.clientes || [])
        .filter(c => c.canal_cadastro === 'vesti').length,
      clientes_vesti_por_compras_fisicas: (ctx.clientes || [])
        .filter(c => ctx.kpis[c.id]?.canal_dominante === 'vesti_dominante'
          || (ctx.kpis[c.id]?.qtd_compras_vesti || 0) > 0).length,
    },
    instrucao: 'Gere as 7 sugestões priorizadas conforme o schema do system prompt. Responda APENAS o JSON.',
    // CONVERSOES da vendedora ultimos 60d — Ailson 07/05/2026 (auditoria GAP 2)
    // Sinal pra IA calibrar tom geral (vendedora produtiva ou nao).
    conversoes_vendedora: ctx.conversoesGeral || { qtd_60d: 0, valor_60d: 0, qtd_30d: 0 },
  };

  return [
    {
      role: 'user',
      content: JSON.stringify(userPayload, null, 2),
    },
  ];
}

/**
 * Pra Prompt B: few-shot do tipo da sugestão + user com 1 sugestão expandida.
 */
function montarMessagesMensagem(sug, ctx, contextoExtra) {
  // Pega 2-3 exemplos few-shot do mesmo tipo (ou similares)
  const exemplosDoTipo = EXEMPLOS_FEW_SHOT
    .filter(e => e.tipo === sug.tipo || (sug.subtipo_sacola && e.tipo === sug.subtipo_sacola))
    .slice(0, 3);

  const messages = [];

  for (const ex of exemplosDoTipo) {
    messages.push({ role: 'user', content: JSON.stringify(ex.input, null, 2) });
    messages.push({ role: 'assistant', content: ex.output });
  }

  // User input real
  const userPayload = {
    sugestao: {
      tipo: sug.tipo,
      subtipo_sacola: sug.subtipo_sacola,
      titulo: sug.titulo,
      contexto: sug.contexto,
      fatos: sug.fatos,
      acao_sugerida: sug.acao_sugerida,
      alvo_tipo: sug.alvo_tipo,
    },
    cliente: ctx.cliente ? (() => {
      // Decisão Ailson 28/04/2026: na mensagem WhatsApp, IA deve tratar a
      // cliente pelo PRIMEIRO NOME (ex: "Rosana Ruiva" → "Rosana"). O nome
      // completo fica na UI das 7 sugestões; mensagem fica mais próxima
      // usando só o primeiro nome.
      const nomeCompleto = (ctx.cliente.apelido || ctx.cliente.comprador_nome || '').trim();
      const palavras = nomeCompleto.split(/\s+/).filter(p => p.length >= 2);
      const apelidoCurto = palavras[0] || nomeCompleto || null;
      // Vesti = app de vendas usado SÓ no Bom Retiro. Cliente é Vesti se:
      // 1. Comprou via Vesti (canal_dominante=vesti_dominante OU qtd>0) OU
      // 2. Foi importada como contato Vesti (canal_cadastro='vesti', mesmo
      //    sem vendas físicas — caso de cliente que só comprou pelo app).
      // Decisão Ailson 30/04/2026: import de pedidos Vesti 75d gera contatos
      // novos com canal_cadastro=vesti — IA precisa enxergar como Vesti pra
      // sugerir link/video do app.
      const usaVesti = ctx.cliente?.canal_cadastro === 'vesti'
        || ctx.kpi?.canal_dominante === 'vesti_dominante'
        || (ctx.kpi?.qtd_compras_vesti || 0) > 0;
      return {
        apelido: apelidoCurto,
        nome_completo_comprador: nomeCompleto || null,
        razao_social: ctx.cliente.razao_social,
        perfil_presenca: ctx.kpi?.perfil_presenca,
        canal_dominante: ctx.kpi?.canal_dominante,
        usa_vesti: usaVesti,
        loja_origem: ctx.cliente.loja_origem,
        paga_com_cheque: ctx.kpi?.paga_com_cheque,
        dias_sem_comprar: ctx.kpi?.dias_sem_comprar,
        lifetime_total: ctx.kpi?.lifetime_total,
        qtd_compras: ctx.kpi?.qtd_compras,
        estilo_dominante: ctx.kpi?.estilo_dominante,
        fase_ciclo_vida: ctx.kpi?.fase_ciclo_vida,
      };
    })() : null,
    grupo: ctx.grupo ? {
      nome_grupo: ctx.grupo.nome_grupo,
      qtd_documentos: ctx.docsGrupo.length,
    } : null,
    produto: ctx.produto ? {
      nome: ctx.produto.descricao,
      categoria: ctx.produto.categoria,
    } : null,
    cores_top_bling: ctx.coresTop && ctx.coresTop.length > 0 ? ctx.coresTop : null,
    promocao: ctx.promocao ? {
      nome: ctx.promocao.nome_curto,
      descricao: ctx.promocao.descricao_completa,
      vence_em: ctx.promocao.data_fim,
    } : null,
    // Estilo aprendido da vendedora (Ailson 04/05/2026): aprende com edicoes
    // anteriores. Inclui top tratamentos, saudacoes e emojis preferidos.
    estilo_vendedora: ctx.estiloVendedora ? {
      qtd_edicoes_aprendidas: ctx.estiloVendedora.qtd_edicoes,
      saudacao_inicial_preferida: ctx.estiloVendedora.saudacao_inicial_top,
      saudacao_final_preferida: ctx.estiloVendedora.saudacao_final_top,
      tratamento_preferido: ctx.estiloVendedora.tratamento_top,
      emojis_preferidos: ctx.estiloVendedora.emojis_top,
      instrucao: 'IMITE o estilo desta vendedora — use os tratamentos, saudações e emojis preferidos dela quando fizer sentido.',
    } : null,
    // CONTEXTO RICO — Ailson 07/05/2026 (auditoria mensagem individual)
    // Mesmos sinais que a IA das sugestoes diarias usa — agora disponiveis
    // pra geracao de mensagem individual tambem.
    status_cliente: ctx.statusEfetivo, // 'ativo' | 'atencao' | 'sem_atividade' | 'inativo' | null
    perfil_canal: ctx.perfilCanal,     // 'so_presencial' | 'so_vesti' | 'so_online' | 'hibrido_*' | 'misto' | 'so_cadastro_vesti' | 'sem_dados'
    janela_compra: ctx.janelaCompra,   // {estado, media_dias, dias_ate_janela}
    top_categorias_cliente: ctx.topCategorias?.length > 0 ? ctx.topCategorias : null,
    ultima_compra: ctx.ultimaCompra,
    conversoes_anteriores: ctx.conversoesCliente,
    historico_sugestoes_28d: ctx.historicoSugestoes,
    peca_info: ctx.pecaInfo, // { eh_novidade, eh_reposicao, combina_estilo_cliente }
    // Observacoes da vendedora — Ailson 07/05/2026 (etapa B)
    // Persistidas em lojas_clientes.observacoes_ia. Vendedora preenche modal
    // (perguntas guiadas + texto livre). IA usa pra calibrar TOM e CONTEUDO,
    // mas NUNCA menciona o conteudo na mensagem.
    observacoes_vendedora: ctx.observacoesVendedora,
    contexto_extra: contextoExtra && Object.keys(contextoExtra).length > 0 ? contextoExtra : null,
    instrucao: 'Gere a mensagem WhatsApp pronta pra copiar. APENAS o texto, sem aspas ao redor.',
  };

  // Few-shot REAL: ultimas edicoes da vendedora (mostra original->editada
  // pra IA "ver" o que ela costuma mudar)
  if (ctx.estiloVendedora?.ultimas_edicoes?.length > 0) {
    for (const ed of ctx.estiloVendedora.ultimas_edicoes.slice(0, 2)) {
      messages.push({
        role: 'user',
        content: 'Exemplo: a IA havia gerado esta mensagem...\n\n' + ed.texto_original,
      });
      messages.push({
        role: 'assistant',
        content: ed.texto_editado,
      });
    }
  }

  messages.push({
    role: 'user',
    content: JSON.stringify(userPayload, null, 2),
  });

  return messages;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Classifica produtos em listas: novidades, best_sellers, em_alta, estoque_geral.
 * A view vw_lojas_produtos_oferecveis já calcula motivo_oferta — só agrupar.
 */
function classificarProdutos(produtos, curadoria, bestSellersAuto = [], emAltaAuto = [], maisVendidos45d = []) {
  // Curadoria manual tem PRIORIDADE sobre auto.
  const curBs = new Set(curadoria.filter(c => c.tipo === 'best_seller').map(c => c.ref));
  const curAlta = new Set(curadoria.filter(c => c.tipo === 'em_alta').map(c => c.ref));
  const curNov = new Set(curadoria.filter(c => c.tipo === 'novidade_manual').map(c => c.ref));

  // Auto (vw_lojas_top_vendas_loja_fisica) — só aplica se REF não tiver
  // curadoria manual.
  const autoBs = new Set(bestSellersAuto || []);
  const autoAlta = new Set(emAltaAuto || []);
  const setMaisVendidos = new Set(maisVendidos45d || []);

  const out = {
    novidades: [],
    best_sellers: [],
    em_alta: [],
    mais_vendidos: [], // top 10 vendas 45d loja física (categoria nova)
    estoque_geral: [],
  };

  for (const p of produtos) {
    const item = {
      ref: p.ref,
      nome: p.descricao,
      categoria: p.categoria,
      estoque: p.qtd_estoque,
    };
    const motivo = p.motivo_oferta;

    if (motivo === 'novidade_oficina' || curNov.has(p.ref)) {
      out.novidades.push(item);
    } else if (curBs.has(p.ref) || motivo === 'best_seller' || autoBs.has(p.ref)) {
      out.best_sellers.push(item);
    } else if (curAlta.has(p.ref) || motivo === 'em_alta' || autoAlta.has(p.ref)) {
      out.em_alta.push(item);
    } else if (motivo === 'estoque') {
      out.estoque_geral.push(item);
    }

    // mais_vendidos é categoria PARALELA — uma REF pode estar em best_sellers
    // E em mais_vendidos (são contextos diferentes pra IA usar).
    if (setMaisVendidos.has(p.ref)) {
      out.mais_vendidos.push(item);
    }
  }

  // Limita pra não estourar contexto
  out.novidades = out.novidades.slice(0, 25);
  out.best_sellers = out.best_sellers.slice(0, 15);
  out.em_alta = out.em_alta.slice(0, 15);
  out.mais_vendidos = out.mais_vendidos.slice(0, 10);
  out.estoque_geral = out.estoque_geral.slice(0, 30);

  return out;
}

const TIPOS_VALIDOS = ['reativar', 'atencao', 'novidade', 'followup', 'followup_nova', 'sacola', 'reposicao', 'aviso_admin', 'inativo', 'semAtividade'];
function validarTipo(t) {
  return TIPOS_VALIDOS.includes(t) ? t : 'followup';
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 2.5: gerar_mensagem_avulsa (Ailson 08/05/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Vendedora pede mensagem direto do card da carteira, sem ter sugestao
// pre-existente das 7 diarias. Backend:
//   1. Cria sugestao "fantasma" em lojas_sugestoes_diarias com tipo='avulsa'
//   2. Escolhe peca via cascata:
//      a. Novidade que combina com categoria dominante da cliente (preferida)
//      b. Reposicao que combina com categoria dominante
//      c. Novidade qualquer da semana
//      d. Followup sem peca (fallback final)
//   3. Reusa handleGerarMensagem normal
//
// Decisao Ailson 08/05/2026:
//   Q1=A (IA escolhe peca sozinha)
//   Q2=2 (novidade na categoria dominante prioridade)
//   Q3=C (salva como tipo='avulsa', entra no anti-repeticao)

async function handleGerarMensagemAvulsa(req, res, auth) {
  const clienteId = req.body?.cliente_id;
  const contextoExtra = req.body?.contexto || {};

  if (!clienteId) {
    return res.status(400).json({ error: 'cliente_id obrigatório' });
  }

  // 1. Carrega cliente + KPIs
  const { data: cliente, error: errCli } = await supabase
    .from('lojas_clientes')
    .select('*')
    .eq('id', clienteId)
    .maybeSingle();
  if (errCli) return res.status(500).json({ error: errCli.message });
  if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });

  // Permissão: vendedora dona OU admin
  if (!auth.isAdmin && cliente.vendedora_id !== auth.vendedoraId) {
    return res.status(403).json({ error: 'Sem permissão pra esse cliente' });
  }

  // 2. Cascata pra escolher peça
  // Top categorias da cliente (mesmo calculo do montarContextoMensagem)
  let topCategoria = null;
  try {
    const { data: itens } = await supabase
      .from('lojas_vendas_itens')
      .select('categoria, qtd, lojas_vendas!inner(cliente_id)')
      .eq('lojas_vendas.cliente_id', clienteId);
    if (itens?.length) {
      const counts = {};
      itens.forEach(i => {
        const cat = i.categoria || 'outros';
        counts[cat] = (counts[cat] || 0) + (i.qtd || 1);
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      topCategoria = sorted[0]?.[0] || null;
    }
  } catch (e) { /* silent */ }

  // Helper: pega 1 ref de view + filtra por categoria se categoria_alvo informada
  async function escolherDaView(viewName, categoriaAlvo) {
    try {
      const { data } = await supabase
        .from(viewName)
        .select('ref')
        .limit(50);
      if (!data?.length) return null;
      // Cruza com lojas_produtos pra ter categoria + estoque
      const refs = data.map(r => r.ref);
      const { data: prods } = await supabase
        .from('lojas_produtos')
        .select('ref, categoria, qtd_estoque')
        .in('ref', refs);
      if (!prods?.length) return null;
      // Filtra: tem estoque > 5 (vai dar pra falar com tranquilidade)
      let candidatos = prods.filter(p => (p.qtd_estoque || 0) > 5);
      // Se categoria_alvo, prefere ela
      if (categoriaAlvo) {
        const matchCat = candidatos.filter(p => p.categoria === categoriaAlvo);
        if (matchCat.length) candidatos = matchCat;
      }
      return candidatos[0]?.ref || null;
    } catch (e) {
      return null;
    }
  }

  // Cascata
  let refEscolhida = null;
  let tipoSug = 'followup'; // default fallback
  // (a) Novidade na categoria dominante
  if (topCategoria) {
    refEscolhida = await escolherDaView('vw_lojas_novidades_auto', topCategoria);
    if (refEscolhida) tipoSug = 'novidade';
  }
  // (b) Reposicao na categoria dominante
  if (!refEscolhida && topCategoria) {
    refEscolhida = await escolherDaView('vw_lojas_reposicoes_auto', topCategoria);
    if (refEscolhida) tipoSug = 'reposicao';
  }
  // (c) Novidade qualquer
  if (!refEscolhida) {
    refEscolhida = await escolherDaView('vw_lojas_novidades_auto', null);
    if (refEscolhida) tipoSug = 'novidade';
  }
  // (d) Sem peça — followup puro

  // Status da cliente pra ajustar tipo
  const dias = cliente.kpi_dias_sem_comprar; // pode não existir; usa fallback
  // Vou usar lojas_clientes_kpis pra precisão
  let diasSemComprar = null;
  try {
    const { data: kpi } = await supabase
      .from('lojas_clientes_kpis')
      .select('dias_sem_comprar')
      .eq('cliente_id', clienteId)
      .maybeSingle();
    diasSemComprar = kpi?.dias_sem_comprar;
  } catch (e) { /* silent */ }

  // Se cliente está em atenção/inativo e não pegou peça, vira reativar
  if (!refEscolhida && diasSemComprar != null) {
    if (diasSemComprar > 60) tipoSug = 'reativar';
    else if (diasSemComprar > 30) tipoSug = 'atencao';
  }

  // 3. Cria sugestao avulsa em lojas_sugestoes_diarias
  // Marca origem='avulsa' em metadados_ia pra distinguir das 7 diarias do cron
  // FIX 08/05/2026 (Ailson): INSERT estava usando 3 nomes de coluna errados
  // que nao existem no schema (ordem→prioridade, subtipo→nao existe), e
  // faltava alvo_tipo NOT NULL. Resultado: erro 500 PostgREST schema cache.
  // FIX 08/05/2026 (Ailson 2a leva): inclui nome do cliente no titulo e
  // popula alvo_nome_display — antes saia "Mensagem avulsa" anonimo na
  // lista de sugestoes do dia.
  const nomeCliente = cliente.apelido
    || cliente.comprador_nome
    || (cliente.razao_social ? cliente.razao_social.split(' ').slice(0, 3).join(' ') : 'Cliente');
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: sugCriada, error: errCriar } = await supabase
    .from('lojas_sugestoes_diarias')
    .insert({
      vendedora_id: cliente.vendedora_id,
      alvo_tipo: 'cliente',                      // NOT NULL no schema
      cliente_id: clienteId,
      grupo_id: null,
      alvo_nome_display: nomeCliente,
      data_geracao: hoje,
      tipo: tipoSug,
      titulo: refEscolhida
        ? `Mensagem avulsa — ${nomeCliente} · REF ${refEscolhida}`
        : `Mensagem avulsa — ${nomeCliente}`,
      produto_ref: refEscolhida,
      status: 'pendente',
      prioridade: 99,                             // 99 = avulsa, fora das 7 do dia
      fatos: { origem: 'avulsa', escolhida_via: refEscolhida ? 'cascata' : 'sem_peca' },
      metadados_ia: { origem: 'avulsa' },        // marca pra relatorios filtrarem
    })
    .select()
    .single();

  if (errCriar) {
    console.error('[avulsa] erro criar sugestao:', errCriar);
    return res.status(500).json({ error: 'Erro ao criar sugestão: ' + errCriar.message });
  }

  // 4. Reusa handleGerarMensagem injetando o sugestao_id criado
  // Modifica req.body em place pra reaproveitar a logica
  req.body = { ...req.body, sugestao_id: sugCriada.id, contexto: contextoExtra };
  return await handleGerarMensagem(req, res, auth);
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 3: gerar_resumo_semanal (semana finalizada → resumo + motivacional)
// ═══════════════════════════════════════════════════════════════════════════
//
// Roda toda terça 07:00 BRT (cron). Pra cada vendedora ATIVA, calcula:
//   • Mensagens enviadas na semana (seg-dom anterior)
//   • Sugestões geradas / dispensadas
//   • Conversões com sucesso (regra dos 15 dias):
//     - mensagens enviadas em clientes "atenção" (45-90d sem comprar) ou
//       "inativo" (180-365d) nas últimas 4 semanas
//     - se cliente comprou da MESMA vendedora em até 15 dias após msg
//     → conta como conversão de sucesso
//   • Top 3 clientes que compraram da vendedora na semana
//   • Mensagem motivacional gerada por Claude (tom otimista)
//
// Salva em lojas_resumos_semanais. Vendedora vê no app.
// ═══════════════════════════════════════════════════════════════════════════

async function handleGerarResumoSemanal(req, res, auth) {
  const vendedoraIdAlvo = req.body?.vendedora_id;
  // Pode rodar pra 1 vendedora específica ou pra todas (modo cron)
  const modoTodas = !vendedoraIdAlvo;

  // Permissão: admin pode rodar pra qualquer uma. Vendedora só pra si mesma.
  if (!modoTodas && !auth.isAdmin && auth.vendedoraId !== vendedoraIdAlvo) {
    return res.status(403).json({ error: 'Sem permissão' });
  }
  if (modoTodas && !auth.isAdmin) {
    return res.status(403).json({ error: 'Modo todas: apenas admin' });
  }

  // Carrega vendedoras alvo
  let { data: vendedoras, error: errVend } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, loja, ativa, is_placeholder')
    .eq('ativa', true);
  if (errVend) {
    return res.status(500).json({ error: errVend.message });
  }
  vendedoras = (vendedoras || []).filter(v => !v.is_placeholder);  // pula placeholders
  if (!modoTodas) {
    vendedoras = vendedoras.filter(v => v.id === vendedoraIdAlvo);
  }
  if (vendedoras.length === 0) {
    return res.status(404).json({ error: 'Nenhuma vendedora ativa elegível' });
  }

  // Janela: segunda anterior → domingo anterior
  const { semana_inicio, semana_fim } = calcularSemanaPassada();

  const resultados = [];
  for (const v of vendedoras) {
    try {
      const r = await gerarResumoVendedora(v, semana_inicio, semana_fim);
      resultados.push({ vendedora_id: v.id, nome: v.nome, ...r });
    } catch (e) {
      console.error(`[resumo-semanal] erro ${v.nome}:`, e);
      resultados.push({ vendedora_id: v.id, nome: v.nome, erro: e.message });
    }
  }

  return res.status(200).json({
    semana_inicio, semana_fim,
    total: vendedoras.length,
    sucessos: resultados.filter(r => !r.erro).length,
    erros: resultados.filter(r => r.erro).length,
    resultados,
  });
}

/**
 * Calcula segunda → domingo da semana ANTERIOR (não a atual).
 * Ex: se hoje é terça 28/04, retorna { inicio: 21/04, fim: 27/04 }
 */
function calcularSemanaPassada() {
  const hoje = new Date();
  const diaDaSemana = hoje.getDay(); // 0=dom, 1=seg, ..., 6=sab
  // Quantos dias voltar pra chegar na segunda anterior:
  //   se hoje é seg(1) → voltar 7 dias
  //   se hoje é ter(2) → voltar 8 dias
  //   se hoje é dom(0) → voltar 6 dias
  const diasParaSegundaAnterior = diaDaSemana === 0 ? 6 : diaDaSemana + 6;
  const segAnterior = new Date(hoje);
  segAnterior.setDate(hoje.getDate() - diasParaSegundaAnterior);
  segAnterior.setHours(0, 0, 0, 0);

  const domAnterior = new Date(segAnterior);
  domAnterior.setDate(segAnterior.getDate() + 6);
  domAnterior.setHours(23, 59, 59, 999);

  return {
    semana_inicio: segAnterior.toISOString().split('T')[0],
    semana_fim: domAnterior.toISOString().split('T')[0],
  };
}

async function gerarResumoVendedora(vendedora, semana_inicio, semana_fim) {
  const inicioISO = `${semana_inicio}T00:00:00Z`;
  const fimISO = `${semana_fim}T23:59:59Z`;

  // ─── 1. Métricas brutas da semana ──────────────────────────────────────
  const { data: acoesSemana } = await supabase
    .from('lojas_acoes')
    .select('tipo_acao, resultado')
    .eq('vendedora_id', vendedora.id)
    .gte('created_at', inicioISO)
    .lte('created_at', fimISO);

  const mensagens_enviadas = (acoesSemana || [])
    .filter(a => a.tipo_acao === 'mensagem_enviada').length;
  const sugestoes_dispensadas = (acoesSemana || [])
    .filter(a => a.tipo_acao === 'dispensada').length;

  const { count: sugestoes_geradas } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('*', { count: 'exact', head: true })
    .eq('vendedora_id', vendedora.id)
    .gte('data_referencia', semana_inicio)
    .lte('data_referencia', semana_fim);

  // ─── 2. Conversões com sucesso (regra dos 15 dias) ────────────────────
  // Pega mensagens enviadas nas últimas 4 semanas pra clientes atenção/inativo
  const quatroSemanasAtras = new Date(inicioISO);
  quatroSemanasAtras.setDate(quatroSemanasAtras.getDate() - 21); // semana_inicio - 21d = 4 semanas total

  const { data: msgs4semanas } = await supabase
    .from('lojas_acoes')
    .select(`
      id, cliente_id, created_at, observacao,
      lojas_clientes!inner(id, razao_social, fantasia, status_atual)
    `)
    .eq('vendedora_id', vendedora.id)
    .eq('tipo_acao', 'mensagem_enviada')
    .gte('created_at', quatroSemanasAtras.toISOString())
    .lte('created_at', fimISO);

  const msgs_atencao_inativo = (msgs4semanas || []).filter(m => {
    const status = m.lojas_clientes?.status_atual;
    // Inclui as 3 faixas que disparam mensagem de reativação
    return status === 'atencao' || status === 'semAtividade' || status === 'inativo';
  });

  const mensagens_atencao_inativo = msgs_atencao_inativo.length;

  // Pra cada msg atenção/semAtividade/inativo, ver se houve compra em até 15d
  // (regra Ailson 01/05/2026: era 30d, ajustada pra 15d).
  const JANELA_CONVERSAO_DIAS = 15;
  const conversoes_detalhe = [];
  for (const msg of msgs_atencao_inativo) {
    const dataMsg = new Date(msg.created_at);
    const dataFimJanela = new Date(dataMsg);
    dataFimJanela.setDate(dataMsg.getDate() + JANELA_CONVERSAO_DIAS);

    const { data: vendasPosMsg } = await supabase
      .from('lojas_vendas')
      .select('id, data_venda, valor_liquido')
      .eq('vendedora_id', vendedora.id)
      .eq('cliente_id', msg.cliente_id)
      .gte('data_venda', dataMsg.toISOString().split('T')[0])
      .lte('data_venda', dataFimJanela.toISOString().split('T')[0])
      .order('data_venda', { ascending: true })
      .limit(1);

    if (vendasPosMsg && vendasPosMsg.length > 0) {
      const venda = vendasPosMsg[0];
      const dias = Math.round((new Date(venda.data_venda) - dataMsg) / 86400000);
      const statusEnvio = msg.lojas_clientes?.status_atual;
      const clienteNome = msg.lojas_clientes?.fantasia || msg.lojas_clientes?.razao_social;
      conversoes_detalhe.push({
        cliente_id: msg.cliente_id,
        cliente_nome: clienteNome,
        data_msg: msg.created_at.split('T')[0],
        data_venda: venda.data_venda,
        dias,
        valor: Number(venda.valor_liquido),
      });

      // ─── Arquiva conversão (idempotente via unique key msg+venda) ──────
      // Mesmo se a mensagem ou venda forem deletadas/arquivadas depois,
      // o histórico de conversão fica preservado pra dashboard.
      try {
        await supabase
          .from('lojas_conversoes')
          .upsert({
            vendedora_id: vendedora.id,
            cliente_id: msg.cliente_id,
            mensagem_id: msg.id,
            data_mensagem: msg.created_at.split('T')[0],
            status_no_envio: statusEnvio,
            venda_id: venda.id,
            data_venda: venda.data_venda,
            dias_ate_compra: dias,
            valor_venda: Number(venda.valor_liquido),
            cliente_nome: clienteNome,
          }, { onConflict: 'mensagem_id,venda_id' });
      } catch (e) {
        // Não bloqueia o fluxo se arquivamento falhar (tabela pode não existir
        // antes do SQL ser rodado). Loga e segue.
        console.warn('[lojas-conversao] erro arquivar:', e?.message);
      }
    }
  }
  const conversoes_sucesso = conversoes_detalhe.length;
  const taxa_conversao = mensagens_atencao_inativo > 0
    ? Math.round((conversoes_sucesso / mensagens_atencao_inativo) * 10000) / 100
    : 0;

  // ─── 3. Top 3 clientes da semana ──────────────────────────────────────
  const { data: vendasSemana } = await supabase
    .from('lojas_vendas')
    .select(`
      cliente_id, valor_liquido,
      lojas_clientes!inner(id, razao_social, fantasia)
    `)
    .eq('vendedora_id', vendedora.id)
    .gte('data_venda', semana_inicio)
    .lte('data_venda', semana_fim);

  const agregado = new Map();
  for (const v of (vendasSemana || [])) {
    const k = v.cliente_id;
    if (!k) continue;
    const cur = agregado.get(k) || {
      cliente_id: k,
      nome: v.lojas_clientes?.fantasia || v.lojas_clientes?.razao_social || 'Cliente sem nome',
      qtd_pedidos: 0, total_comprado: 0,
    };
    cur.qtd_pedidos++;
    cur.total_comprado += Number(v.valor_liquido) || 0;
    agregado.set(k, cur);
  }
  const top_clientes = Array.from(agregado.values())
    .sort((a, b) => b.total_comprado - a.total_comprado)
    .slice(0, 3);

  // ─── 4. Gera mensagem motivacional via Claude ─────────────────────────
  const promptMotivacional = montarPromptMotivacional(vendedora, {
    mensagens_enviadas, sugestoes_geradas, sugestoes_dispensadas,
    mensagens_atencao_inativo, conversoes_sucesso, taxa_conversao,
    top_clientes, semana_inicio, semana_fim,
  });

  const modeloIA = await getLojasConfig('modelo_ia', 'claude-sonnet-4-6');
  let mensagem_motivacional = null;
  let tokens_input = 0, tokens_output = 0, custo_brl = 0;
  try {
    const resp = await chamarClaude({
      model: modeloIA,
      max_tokens: 400,
      system: 'Você é uma coach motivacional pra vendedoras de moda. Tom: otimista, próximo, brasileiro descontraído. Frases curtas (máximo 3-4 frases). Use emojis com moderação. Valoriza o esforço sem ser piegas.',
      messages: [{ role: 'user', content: promptMotivacional }],
    });
    mensagem_motivacional = resp?.content?.[0]?.text?.trim() || null;
    tokens_input = resp?.usage?.input_tokens || 0;
    tokens_output = resp?.usage?.output_tokens || 0;
    // logarChamadaIA já calcula custo
    await logarChamadaIA({
      contexto: 'lojas_resumo_semanal',
      vendedora_id: vendedora.id,
      modelo: modeloIA,
      tokens_input, tokens_output,
    });
  } catch (e) {
    console.error('[resumo-semanal] erro Claude:', e);
    mensagem_motivacional = `Olá ${vendedora.nome}! Mais uma semana se foi. Bora pra próxima! 💪`;
  }

  // ─── 5. Salva (upsert pela chave única vendedora_id+semana_inicio) ────
  const { data: salvo, error: errSalvar } = await supabase
    .from('lojas_resumos_semanais')
    .upsert({
      vendedora_id: vendedora.id,
      semana_inicio, semana_fim,
      mensagens_enviadas: mensagens_enviadas || 0,
      sugestoes_geradas: sugestoes_geradas || 0,
      sugestoes_dispensadas: sugestoes_dispensadas || 0,
      mensagens_atencao_inativo,
      conversoes_sucesso,
      taxa_conversao,
      top_clientes,
      conversoes_detalhe,
      mensagem_motivacional,
      modelo_ia: modeloIA,
      tokens_input, tokens_output,
      gerado_em: new Date().toISOString(),
    }, { onConflict: 'vendedora_id,semana_inicio' })
    .select()
    .single();

  if (errSalvar) throw new Error(`Erro salvando resumo: ${errSalvar.message}`);

  return {
    resumo_id: salvo.id,
    metricas: {
      mensagens_enviadas, sugestoes_geradas, sugestoes_dispensadas,
      mensagens_atencao_inativo, conversoes_sucesso, taxa_conversao,
    },
    top_clientes_qtd: top_clientes.length,
    mensagem_preview: mensagem_motivacional?.substring(0, 100),
  };
}

function montarPromptMotivacional(vendedora, dados) {
  const {
    mensagens_enviadas, sugestoes_geradas, sugestoes_dispensadas,
    mensagens_atencao_inativo, conversoes_sucesso, taxa_conversao,
    top_clientes,
  } = dados;

  const topClientesTxt = top_clientes.length === 0
    ? 'Nenhum.'
    : top_clientes.map((c, i) =>
      `${i + 1}. ${c.nome}: ${c.qtd_pedidos} pedido(s), R$ ${c.total_comprado.toFixed(2)}`
    ).join('\n');

  return `Vendedora: ${vendedora.nome} (${vendedora.loja})

Métricas da semana passada:
- Mensagens enviadas: ${mensagens_enviadas}
- Sugestões geradas pra você pela IA: ${sugestoes_geradas}
- Sugestões dispensadas: ${sugestoes_dispensadas}
- Mensagens enviadas pra clientes em atenção/inativo (últimas 4 sem): ${mensagens_atencao_inativo}
- Dessas, converteram em compra (até 15 dias): ${conversoes_sucesso}
- Taxa de conversão: ${taxa_conversao}%

Top clientes da semana:
${topClientesTxt}

Gere uma mensagem motivacional curta (3-4 frases máximo) chamando pelo nome dela. Use os números reais quando relevante. Tom otimista mas honesto — se foi uma semana fraca, encoraja sem fingir. Se foi forte, celebra com ela. Brasileiro descontraído, sem ser piegas.`;
}


// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 4: conversoes_dashboard (KPI card no Dashboard Lojas)
// ═══════════════════════════════════════════════════════════════════════════
//
// Retorna agregado de conversoes pra o card Conversoes.
// Filtros suportados:
//   - vendedora_id (opcional, default = todas)
//   - periodo: 'mes_atual' (default) | '7d' | 'mes_passado' | 'all'
//
// Resposta: { periodo, periodo_label, total, valor_total, por_status,
// por_vendedora, detalhe (top 50) }
// ═══════════════════════════════════════════════════════════════════════════

function _calcularRangeConversoes(periodo) {
  const hoje = new Date();
  const fim = hoje.toISOString().slice(0, 10);
  let inicio;
  let label;
  switch (periodo) {
    case '7d': {
      const d = new Date(hoje);
      d.setDate(d.getDate() - 7);
      inicio = d.toISOString().slice(0, 10);
      label = 'Últimos 7 dias';
      break;
    }
    case 'mes_passado': {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
      const fimMes = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
      inicio = d.toISOString().slice(0, 10);
      const fimMesStr = fimMes.toISOString().slice(0, 10);
      label = 'Mês passado';
      return { inicio, fim: fimMesStr, label };
    }
    case 'all': {
      inicio = '2024-01-01';
      label = 'Todo período';
      break;
    }
    case 'mes_atual':
    default: {
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      inicio = d.toISOString().slice(0, 10);
      label = 'Mês atual';
      break;
    }
  }
  return { inicio, fim, label };
}

async function handleConversoesDashboard(req, res, _auth) {
  const vendedora_id = req.body?.vendedora_id || null;
  const periodo = req.body?.periodo || 'mes_atual';
  const { inicio, fim, label } = _calcularRangeConversoes(periodo);

  let query = supabase
    .from('lojas_conversoes')
    .select('vendedora_id, cliente_id, cliente_nome, status_no_envio, dias_ate_compra, valor_venda, data_venda, data_mensagem')
    .gte('data_venda', inicio)
    .lte('data_venda', fim)
    .order('data_venda', { ascending: false });

  if (vendedora_id) {
    query = query.eq('vendedora_id', vendedora_id);
  }

  const { data: conversoes, error } = await query;
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Carrega nomes das vendedoras (pra agregado)
  const { data: vendedoras } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome');
  const nomeVendedora = (vid) => {
    const v = (vendedoras || []).find(x => x.id === vid);
    return v?.nome || '?';
  };

  const total = (conversoes || []).length;
  const valor_total = (conversoes || []).reduce((s, c) => s + Number(c.valor_venda || 0), 0);

  const por_status = { atencao: 0, semAtividade: 0, inativo: 0 };
  for (const c of conversoes || []) {
    if (por_status[c.status_no_envio] !== undefined) {
      por_status[c.status_no_envio]++;
    }
  }

  const mapaVendedora = new Map();
  for (const c of conversoes || []) {
    const k = c.vendedora_id;
    if (!mapaVendedora.has(k)) {
      mapaVendedora.set(k, { vendedora_id: k, vendedora_nome: nomeVendedora(k), total: 0, valor: 0 });
    }
    const v = mapaVendedora.get(k);
    v.total++;
    v.valor += Number(c.valor_venda || 0);
  }
  const por_vendedora = Array.from(mapaVendedora.values()).sort((a, b) => b.total - a.total);

  return res.json({
    periodo,
    periodo_label: label,
    data_inicio: inicio,
    data_fim: fim,
    vendedora_id: vendedora_id || null,
    total,
    valor_total: Math.round(valor_total * 100) / 100,
    por_status,
    por_vendedora,
    detalhe: (conversoes || []).slice(0, 50),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 5: metas_dashboard (Card de metas vendedora — Sprint A 04/05/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Retorna progresso da meta de cada vendedora ATIVA no período (default: mes
// corrente em BRT, mas aceita filtros).
//
// Uso:
//   POST /api/lojas-ia { action: 'metas_dashboard', periodo: 'mes_atual' | '2026-04' }
//
// Lê de vw_lojas_vendas_completo (UNION atacado + varejo). Soma agrupado
// por vendedora_id + categoria. Filtra mês corrente em BRT. Calcula
// checkpoints batidos (sem dispara push, só info pro frontend).
//
// Estrutura de resposta:
//   {
//     periodo: '2026-05',
//     periodo_label: 'Maio/2026',
//     data_inicio: '2026-05-01',
//     data_fim: '2026-05-31',
//     vendedoras: [
//       { vendedora_id, nome, loja, atacado, varejo, total,
//         meta_principal, percentual, checkpoints_batidos: [35000, 50000] }
//     ],
//     loja_BR: { total, vendedoras_ativas },
//     loja_ST: { total, vendedoras_ativas },
//   }

const METAS_BR = {
  // Bom Retiro: 70/80/90/100k metas, com checkpoints intermediários
  meta_principal: 100000,
  checkpoints: [35000, 50000, 60000, 70000, 80000, 90000, 100000],
  metas: [70000, 80000, 90000, 100000],  // metas que dão bônus
};

const METAS_ST = {
  // Silva Teles: 70k 1ª meta (contida) / 140k grande
  meta_principal: 140000,
  checkpoints: [60000, 70000, 80000, 90000, 100000, 140000],
  metas: [70000, 140000],
};

function metasDaLoja(loja) {
  if (loja === 'Bom Retiro') return METAS_BR;
  if (loja === 'Silva Teles') return METAS_ST;
  return METAS_BR;  // fallback
}

async function handleMetasDashboard(req, res, _auth) {
  const { periodo = 'mes_atual', vendedora_id } = req.body || {};

  // Calcula intervalo de datas em BRT
  const agora = new Date();
  const agoraBRT = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  let ano, mes;  // 1-indexed
  if (periodo === 'mes_atual') {
    ano = agoraBRT.getFullYear();
    mes = agoraBRT.getMonth() + 1;
  } else if (/^\d{4}-\d{2}$/.test(periodo)) {
    [ano, mes] = periodo.split('-').map(Number);
  } else {
    return res.status(400).json({ error: 'periodo invalido (use "mes_atual" ou "AAAA-MM")' });
  }

  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  // Ultimo dia do mes:
  const fimDate = new Date(ano, mes, 0);  // dia 0 do mês seguinte = último dia do mês
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(fimDate.getDate()).padStart(2, '0')}`;
  const periodo_label = fimDate.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
    .replace(/^\w/, c => c.toUpperCase());

  // Busca vendas no periodo (atacado + varejo via view)
  let query = supabase
    .from('vw_lojas_vendas_completo')
    .select('vendedora_id, categoria, valor_liquido, loja')
    .gte('data_venda', inicio)
    .lte('data_venda', fim);

  if (vendedora_id) {
    query = query.eq('vendedora_id', vendedora_id);
  }

  const { data: vendas, error } = await query;
  if (error) {
    return res.status(500).json({ error: 'erro buscar vendas', detalhe: error.message });
  }

  // Busca vendedoras ativas (filtra placeholders)
  const { data: vendedorasRaw } = await supabase
    .from('lojas_vendedoras')
    .select('id, nome, loja')
    .eq('ativa', true)
    .eq('is_placeholder', false)
    .order('loja')
    .order('nome');

  const vendedoras = vendedorasRaw || [];

  // Agrupa vendas por vendedora_id + categoria
  const mapa = new Map();  // vendedora_id → { atacado, varejo, total }
  for (const v of vendas || []) {
    if (!v.vendedora_id) continue;  // venda sem vendedora não conta meta
    if (!mapa.has(v.vendedora_id)) {
      mapa.set(v.vendedora_id, { atacado: 0, varejo: 0, total: 0 });
    }
    const valor = Number(v.valor_liquido || 0);
    const acc = mapa.get(v.vendedora_id);
    if (v.categoria === 'atacado') acc.atacado += valor;
    else if (v.categoria === 'varejo') acc.varejo += valor;
    acc.total += valor;
  }

  // Monta resposta vendedora a vendedora
  const respVend = vendedoras.map(vd => {
    const totais = mapa.get(vd.id) || { atacado: 0, varejo: 0, total: 0 };
    const cfg = metasDaLoja(vd.loja);
    const checkpointsBatidos = cfg.checkpoints.filter(c => totais.total >= c);
    const percentual = cfg.meta_principal > 0
      ? Math.round((totais.total / cfg.meta_principal) * 100)
      : 0;
    return {
      vendedora_id: vd.id,
      nome: vd.nome,
      loja: vd.loja,
      atacado: Math.round(totais.atacado * 100) / 100,
      varejo: Math.round(totais.varejo * 100) / 100,
      total: Math.round(totais.total * 100) / 100,
      meta_principal: cfg.meta_principal,
      checkpoints_loja: cfg.checkpoints,
      checkpoints_batidos: checkpointsBatidos,
      percentual,
    };
  });

  // Totais por loja
  // FIX 06/05/2026 (Ailson): somar direto da `vendas` (view) em vez de
  // somar de respVend.filter(...). Razao: respVend so tem vendedoras
  // fixas (is_placeholder=false). Vendas que caem em:
  //   - placeholders Vendedora_3/Vendedora_4 (vendedoras antigas absorvidas)
  //   - vendedora_id=NULL (caso extremo)
  //   - vendedora teste com nome novo que cair na padrao da loja (ja entra,
  //     mas eh redundancia ok)
  // ficavam fora do total. Agora o total da loja eh a soma REAL daquele
  // dia/mes, batendo com o relatorio Mire.
  // Card de metas individual continua mostrando so as fixas.
  const somarLoja = (nomeLoja) => (vendas || [])
    .filter(v => v.loja === nomeLoja)
    .reduce((s, v) => s + Number(v.valor_liquido || 0), 0);

  const lojaBR = {
    total: Math.round(somarLoja('Bom Retiro') * 100) / 100,
    vendedoras_ativas: respVend.filter(r => r.loja === 'Bom Retiro').length,
    meta_principal_individual: METAS_BR.meta_principal,
  };

  const lojaST = {
    total: Math.round(somarLoja('Silva Teles') * 100) / 100,
    vendedoras_ativas: respVend.filter(r => r.loja === 'Silva Teles').length,
    meta_principal_individual: METAS_ST.meta_principal,
  };

  return res.json({
    periodo: `${ano}-${String(mes).padStart(2, '0')}`,
    periodo_label,
    data_inicio: inicio,
    data_fim: fim,
    vendedoras: respVend,
    loja_BR: lojaBR,
    loja_ST: lojaST,
  });
}
