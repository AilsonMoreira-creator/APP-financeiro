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
    if (action === 'gerar_resumo_semanal') {
      return await handleGerarResumoSemanal(req, res, auth);
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

  // Sacolas ativas dessa vendedora
  const { data: sacolasRaw } = await supabase
    .from('lojas_pedidos_sacola')
    .select('*')
    .eq('vendedora_id', vendedoraId)
    .eq('ativo', true);

  // FILTRO SACOLAS (28/04/2026, decisão Ailson):
  //   - valor_total <= 0 → dado faltante do PDF, descarta
  //   - dias < 6 → muito recente, vendedora ainda monta a sacola
  // Telemetria pra debug em metadados_ia
  const sacolasDescartadas = { sem_valor: 0, muito_recente: 0 };
  const hojeMs = Date.now();
  const sacolas = (sacolasRaw || []).filter(s => {
    const valor = Number(s.valor_total) || 0;
    if (valor <= 0) { sacolasDescartadas.sem_valor++; return false; }
    if (!s.data_cadastro_sacola) { sacolasDescartadas.sem_valor++; return false; }
    const dias = Math.floor((hojeMs - new Date(s.data_cadastro_sacola).getTime()) / 86400000);
    if (dias < 6) { sacolasDescartadas.muito_recente++; return false; }
    return true;
  });

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

  // Best sellers e em_alta automáticos (fallback quando curadoria vazia).
  // Decisão Ailson 28/04/2026: derivado das vendas REAIS da loja física Amícia
  // (lojas_vendas_itens, populado pelo Relatório BI do Mire). NÃO MISTURAR com
  // vendas Bling (marketplaces, fonte completamente diferente).
  //   Curva A (top 10) → best_sellers
  //   Curva B (11-20)  → em_alta
  // Curadoria manual tem PRIORIDADE.
  let bestSellersAuto = [];
  let emAltaAuto = [];
  let produtosExtras = [];
  try {
    const { data: topVendas } = await supabase
      .from('vw_lojas_top_vendas_loja_fisica')
      .select('ref, curva, posicao_ranking, pecas_45d')
      .in('curva', ['a', 'b'])
      .order('posicao_ranking', { ascending: true })
      .limit(20);
    bestSellersAuto = (topVendas || []).filter(r => r.curva === 'a').map(r => r.ref);
    emAltaAuto = (topVendas || []).filter(r => r.curva === 'b').map(r => r.ref);

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
    const todasExtras = [...new Set([...bestSellersAuto, ...emAltaAuto, ...refsCuradoriaManual])];

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
          // Curadoria manual tem PRIORIDADE no motivo_oferta — mesma regra
          // de classificarProdutos (linha ~996-1004).
          const tipoCurMan = curadoriaTipoPorRef.get(p.ref);
          let motivo;
          if (tipoCurMan === 'novidade_manual') motivo = 'novidade_oficina';
          else if (tipoCurMan === 'best_seller') motivo = 'best_seller';
          else if (tipoCurMan === 'em_alta') motivo = 'em_alta';
          else if (bestSellersAuto.includes(p.ref)) motivo = 'best_seller';
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
  // Já temos bestSellersAuto = top 10 da view → usamos isso direto.
  const maisVendidos45d = bestSellersAuto.slice(0, 10);

  // ─── REPOSIÇÃO: novidades da oficina cuja REF já vendeu antes ─────────
  // Decisão Ailson 28/04/2026: tipo NOVO de sugestão. Quando IA pega uma
  // novidade da oficina e essa REF já existe em vendas anteriores, é
  // REPOSIÇÃO (não novidade pura). Substitui 1 slot de novidade ou followup.
  const novidadesRefs = (produtos || [])
    .filter(p => p.motivo_oferta === 'novidade_oficina')
    .map(p => p.ref);

  let refsComVendaPassada = new Set();
  if (novidadesRefs.length > 0) {
    try {
      const { data: vendaAnt } = await supabase
        .from('lojas_vendas_itens')
        .select('ref')
        .in('ref', novidadesRefs)
        .limit(500);
      refsComVendaPassada = new Set((vendaAnt || []).map(v => v.ref));
    } catch (e) {
      console.warn('[lojas-ia] sem checagem repo (view ausente?):', e?.message);
    }
  }

  // Lista de REFs que SÃO reposições (chegaram novas mas já tem histórico)
  const refsReposicao = novidadesRefs.filter(r => refsComVendaPassada.has(r));

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

  return {
    vendedoraNome: vendedora.nome,
    vendedoraId,
    vendedora: { id: vendedora.id, nome: vendedora.nome, loja: vendedora.loja },
    clientes: clientes || [],
    kpis,
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

  return {
    cliente, grupo, kpi, docsGrupo,
    produto, promocao, coresTop,
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
  // Set de clientes com sacola ativa (preservar mesmo se KPI fraco)
  const clientesComSacola = new Set((ctx.sacolas || []).map(s => s.cliente_id));

  // FILTROS DE CARTEIRA (28/04/2026, decisão Ailson):
  //   - Cliente sem dias_sem_comprar E sem ultima_compra → KPI inutilizável pra
  //     reativar/atenção/followup. Remove (a menos que tenha sacola).
  //   - pular_ate futuro → vendedora marcou pra pular agora
  const carteiraFiltradaInfo = { sem_kpi: 0, pulando: 0, kpi_parcial: 0 };
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
      return {
        id: c.id,
        apelido: c.apelido || c.comprador_nome || c.razao_social?.split(' ').slice(0, 3).join(' '),
        documento_tipo: c.tipo_documento,
        grupo_id: c.grupo_id,
        pular_ate: c.pular_ate,
        kpi_incompleto: kpiIncompleto, // ⚠️ NÃO use pra reativar/atenção/followup se true
        // Cliente Vesti? Combina vendas físicas (KPIs) + cadastro Vesti
        // (canal_cadastro). True = priorizar sugerir link/video do app.
        usa_vesti: usaVestiCli,
        canal_cadastro: c.canal_cadastro || null,
        // Top 3 REFs que essa cliente compra bem (score peças+recorrência).
        // IA usa pra: detectar reposição, dizer "vende bem pra você",
        // alternar recomendações sem repetir.
        top_refs_cliente: ctx.topRefsPorCliente?.[c.id] || [],
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

const TIPOS_VALIDOS = ['reativar', 'atencao', 'novidade', 'followup', 'followup_nova', 'sacola'];
function validarTipo(t) {
  return TIPOS_VALIDOS.includes(t) ? t : 'followup';
}

// ═══════════════════════════════════════════════════════════════════════════
// AÇÃO 3: gerar_resumo_semanal (semana finalizada → resumo + motivacional)
// ═══════════════════════════════════════════════════════════════════════════
//
// Roda toda terça 07:00 BRT (cron). Pra cada vendedora ATIVA, calcula:
//   • Mensagens enviadas na semana (seg-dom anterior)
//   • Sugestões geradas / dispensadas
//   • Conversões com sucesso (regra dos 30 dias):
//     - mensagens enviadas em clientes "atenção" (45-90d sem comprar) ou
//       "inativo" (180-365d) nas últimas 4 semanas
//     - se cliente comprou da MESMA vendedora em até 30 dias após msg
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

  // ─── 2. Conversões com sucesso (regra dos 30 dias) ────────────────────
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
    return status === 'atencao' || status === 'inativo';
  });

  const mensagens_atencao_inativo = msgs_atencao_inativo.length;

  // Pra cada msg atenção/inativo, ver se houve compra em até 30d
  const conversoes_detalhe = [];
  for (const msg of msgs_atencao_inativo) {
    const dataMsg = new Date(msg.created_at);
    const data30dDepois = new Date(dataMsg);
    data30dDepois.setDate(dataMsg.getDate() + 30);

    const { data: vendasPosMsg } = await supabase
      .from('lojas_vendas')
      .select('id, data_venda, valor_liquido')
      .eq('vendedora_id', vendedora.id)
      .eq('cliente_id', msg.cliente_id)
      .gte('data_venda', dataMsg.toISOString().split('T')[0])
      .lte('data_venda', data30dDepois.toISOString().split('T')[0])
      .order('data_venda', { ascending: true })
      .limit(1);

    if (vendasPosMsg && vendasPosMsg.length > 0) {
      const venda = vendasPosMsg[0];
      const dias = Math.round((new Date(venda.data_venda) - dataMsg) / 86400000);
      conversoes_detalhe.push({
        cliente_id: msg.cliente_id,
        cliente_nome: msg.lojas_clientes?.fantasia || msg.lojas_clientes?.razao_social,
        data_msg: msg.created_at.split('T')[0],
        data_venda: venda.data_venda,
        dias,
        valor: Number(venda.valor_liquido),
      });
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
- Dessas, converteram em compra (até 30 dias): ${conversoes_sucesso}
- Taxa de conversão: ${taxa_conversao}%

Top clientes da semana:
${topClientesTxt}

Gere uma mensagem motivacional curta (3-4 frases máximo) chamando pelo nome dela. Use os números reais quando relevante. Tom otimista mas honesto — se foi uma semana fraca, encoraja sem fingir. Se foi forte, celebra com ela. Brasileiro descontraído, sem ser piegas.`;
}
