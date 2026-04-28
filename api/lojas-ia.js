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
  const r = await chamarClaude({
    modelo,
    systemBlocks,
    messages,
    max_tokens: 4000,
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

  // 9. Persiste (idempotente: apaga as do dia da vendedora primeiro)
  const hoje = new Date().toISOString().slice(0, 10);
  await supabase
    .from('lojas_sugestoes_diarias')
    .delete()
    .eq('vendedora_id', vendedoraIdAlvo)
    .eq('data_geracao', hoje);

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
    .select('id, documento, tipo_documento, razao_social, nome_fantasia, apelido, comprador_nome, telefone_principal, vendedora_id, grupo_id, pular_ate')
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

  // Sacolas ativas dessa vendedora
  const { data: sacolas } = await supabase
    .from('lojas_pedidos_sacola')
    .select('*')
    .eq('vendedora_id', vendedoraId)
    .eq('ativo', true);

  // Grupos da vendedora
  const { data: grupos } = await supabase
    .from('lojas_grupos')
    .select('id, nome_grupo, apelido, vendedora_id')
    .eq('vendedora_id', vendedoraId)
    .is('arquivado_em', null);

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

  // Promoções ativas
  const { data: promocoes } = await supabase
    .from('lojas_promocoes')
    .select('id, nome_curto, descricao_completa, categoria, data_inicio, data_fim, pedido_minimo, desconto_pct')
    .eq('ativo', true)
    .gte('data_fim', hoje)
    .order('data_fim');

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

  return {
    vendedoraNome: vendedora.nome,
    vendedoraId,
    vendedora: { id: vendedora.id, nome: vendedora.nome, loja: vendedora.loja },
    clientes: clientes || [],
    kpis,
    sacolas: sacolas || [],
    grupos: grupos || [],
    produtos: produtos || [],
    curadoria: curadoria || [],
    promocoes: promocoes || [],
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

  // Regras customizadas (mesmas que sugestões)
  const [tomGeral, posicionamento, sempre, nunca, saudacao, fechamento] = await Promise.all([
    getLojasConfig('regras_ia.tom_geral', null),
    getLojasConfig('regras_ia.posicionamento', null),
    getLojasConfig('regras_ia.sempre', null),
    getLojasConfig('regras_ia.nunca', null),
    getLojasConfig('parametros.saudacao_padrao', null),
    getLojasConfig('parametros.fechamento_padrao', null),
  ]);

  return {
    cliente, grupo, kpi, docsGrupo,
    produto, promocao,
    regrasCustomizadas: { tomGeral, posicionamento, sempre, nunca, saudacao, fechamento },
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
  // Constrói payload enxuto pra IA — só dados que ela usa
  const userPayload = {
    data_geracao: new Date().toISOString(),
    vendedora: ctx.vendedora,
    carteira: ctx.clientes.map(c => {
      const k = ctx.kpis[c.id] || {};
      return {
        id: c.id,
        apelido: c.apelido || c.comprador_nome || c.razao_social?.split(' ').slice(0, 3).join(' '),
        documento_tipo: c.tipo_documento,
        grupo_id: c.grupo_id,
        pular_ate: c.pular_ate,
        kpi: {
          dias_sem_comprar: k.dias_sem_comprar,
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
    }),
    grupos: ctx.grupos,
    sacolas_ativas: ctx.sacolas.map(s => ({
      cliente_id: s.cliente_id,
      data_cadastro_sacola: s.data_cadastro_sacola,
      valor_total: s.valor_total,
      qtd_pecas: s.qtd_pecas,
      subtipo_sugerido: s.subtipo_sugerido,
      observacao: s.observacao,
    })),
    produtos_disponiveis: classificarProdutos(ctx.produtos, ctx.curadoria),
    promocoes_ativas: ctx.promocoes.map(p => ({
      id: p.id,
      nome: p.nome_curto,
      descricao: p.descricao_completa,
      categoria: p.categoria,
      vence_em: p.data_fim,
      desconto_pct: p.desconto_pct,
      pedido_minimo: p.pedido_minimo,
    })),
    instrucao: 'Gere as 7 sugestões priorizadas conforme o schema do system prompt. Responda APENAS o JSON.',
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
    cliente: ctx.cliente ? {
      apelido: ctx.cliente.apelido || ctx.cliente.comprador_nome,
      razao_social: ctx.cliente.razao_social,
      perfil_presenca: ctx.kpi?.perfil_presenca,
      paga_com_cheque: ctx.kpi?.paga_com_cheque,
      dias_sem_comprar: ctx.kpi?.dias_sem_comprar,
      lifetime_total: ctx.kpi?.lifetime_total,
      qtd_compras: ctx.kpi?.qtd_compras,
      estilo_dominante: ctx.kpi?.estilo_dominante,
      fase_ciclo_vida: ctx.kpi?.fase_ciclo_vida,
    } : null,
    grupo: ctx.grupo ? {
      nome_grupo: ctx.grupo.nome_grupo,
      qtd_documentos: ctx.docsGrupo.length,
    } : null,
    produto: ctx.produto ? {
      nome: ctx.produto.descricao,
      categoria: ctx.produto.categoria,
    } : null,
    promocao: ctx.promocao ? {
      nome: ctx.promocao.nome_curto,
      descricao: ctx.promocao.descricao_completa,
      vence_em: ctx.promocao.data_fim,
    } : null,
    contexto_extra: contextoExtra && Object.keys(contextoExtra).length > 0 ? contextoExtra : null,
    instrucao: 'Gere a mensagem WhatsApp pronta pra copiar. APENAS o texto, sem aspas ao redor.',
  };

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
function classificarProdutos(produtos, curadoria) {
  const curBs = new Set(curadoria.filter(c => c.tipo === 'best_seller').map(c => c.ref));
  const curAlta = new Set(curadoria.filter(c => c.tipo === 'em_alta').map(c => c.ref));
  const curNov = new Set(curadoria.filter(c => c.tipo === 'novidade_manual').map(c => c.ref));

  const out = {
    novidades: [],
    best_sellers: [],
    em_alta: [],
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
    } else if (curBs.has(p.ref) || motivo === 'best_seller') {
      out.best_sellers.push(item);
    } else if (curAlta.has(p.ref) || motivo === 'em_alta') {
      out.em_alta.push(item);
    } else if (motivo === 'estoque') {
      out.estoque_geral.push(item);
    }
  }

  // Limita pra não estourar contexto
  out.novidades = out.novidades.slice(0, 25);
  out.best_sellers = out.best_sellers.slice(0, 15);
  out.em_alta = out.em_alta.slice(0, 15);
  out.estoque_geral = out.estoque_geral.slice(0, 30);

  return out;
}

const TIPOS_VALIDOS = ['reativar', 'atencao', 'novidade', 'followup', 'followup_nova', 'sacola'];
function validarTipo(t) {
  return TIPOS_VALIDOS.includes(t) ? t : 'followup';
}
