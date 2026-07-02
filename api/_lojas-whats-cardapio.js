// ═══════════════════════════════════════════════════════════════════════════
// _lojas-whats-cardapio.js — Cardapio dinamico de produtos pra Sofia
// ═══════════════════════════════════════════════════════════════════════════
// Monta o "menu" que a Sofia tem disponivel pra sugerir/mencionar em conversas:
//
//   1. EM ALTA          → lojas_produtos_curadoria tipo='em_alta'
//   2. BEST SELLERS     → lojas_produtos_curadoria tipo='best_seller'
//   3. NOVIDADES        → lojas_produtos_curadoria tipo='novidade_manual'
//                         + vw_lojas_novidades_auto (novidades automaticas)
//   4. MATCHES (carrinho) → mv_lojas_matches_90d filtrado pelas REFs do
//                          carrinho do cliente
//
// REGRA DE OURO: so retorna o que tem CERTEZA.
//   - Curadoria precisa ter ativo=true E data_fim valida
//   - Matches do carrinho so vem se REFs foram resolvidas com threshold
//     alto (extrair_refs_carrinho usa 0.65)
//
// Cache em memoria 5min por chave (refs do carrinho).
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro } from './_lojas-whats-helpers.js';
import { MODELOS_POR_REF } from './_lojas-modelos-data.js';

const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── BASE DE CONHECIMENTO DE PRODUTOS (ficha tecnica por REF) ──────────────
// Vem do manual versionado (_lojas-modelos-data.js). A Sofia consulta pra SE
// BASEAR; usa so o relevante e NAO cola literal. Ailson 06/06/2026.

// Ficha resumida (fatos curtos) — enriquece a lista de refs ativas (barato).
function fichaCurtaModelo(refNorm) {
  const m = MODELOS_POR_REF[refNorm];
  if (!m) return null;
  const partes = [];
  if (m.tecido) partes.push(m.tecido);
  if (m.composicao) partes.push(m.composicao);
  if (m.forro) partes.push(`forro: ${m.forro}`);
  if (Array.isArray(m.detalhes) && m.detalhes.length) partes.push(m.detalhes.join(', '));
  if (Array.isArray(m.combina_com) && m.combina_com.length) partes.push(`combina com ${m.combina_com.join(', ')}`);
  if (m.tamanho_modelo) partes.push(`modelo veste ${m.tamanho_modelo}`);
  if (m.preco_atacado) partes.push(`atacado R$${Number(m.preco_atacado).toFixed(0)}`);
  return partes.join(' · ');
}

// Ficha DETALHADA (inclui descricao_completa) — so pras refs em foco (ex:
// carrinho), pra Sofia falar da peca que a cliente esta vendo com profundidade.
export function montarFichasDetalhadas(refs) {
  if (!refs || !refs.length) return '';
  const blocos = [];
  for (const r of refs) {
    const refNorm = String(r).replace(/^0+/, '') || '0';
    const m = MODELOS_POR_REF[refNorm];
    if (!m) continue;
    const linhas = [`REF ${m.ref} — ${m.nome}`];
    const ficha = fichaCurtaModelo(refNorm);
    if (ficha) linhas.push(ficha);
    if (m.descricao_completa) linhas.push(m.descricao_completa);
    blocos.push(linhas.join('\n'));
  }
  return blocos.join('\n\n');
}
const cacheCardapioGeral = { data: null, expiresAt: 0 };
const cacheMatches = new Map(); // key: refs joined → { data, expiresAt }

// ─── CARDAPIO GERAL (sem matches) ─────────────────────────────────────────

async function getCardapioGeral(limite = 8) {
  if (cacheCardapioGeral.data && cacheCardapioGeral.expiresAt > Date.now()) {
    return cacheCardapioGeral.data;
  }

  const hoje = new Date().toISOString().slice(0, 10);

  // Em alta + Best sellers + Novidade manual (lojas_produtos_curadoria)
  const [{ data: emAlta }, { data: bestSellers }, { data: novidadesManual }, { data: novidadesAuto }] = await Promise.all([
    supabase.from('lojas_produtos_curadoria')
      .select('ref, motivo, ordem_prioridade, data_fim')
      .eq('tipo', 'em_alta').eq('ativo', true)
      .or(`data_fim.is.null,data_fim.gte.${hoje}`)
      .order('ordem_prioridade', { ascending: true, nullsFirst: false })
      .limit(limite),
    supabase.from('lojas_produtos_curadoria')
      .select('ref, motivo, ordem_prioridade, data_fim')
      .eq('tipo', 'best_seller').eq('ativo', true)
      .or(`data_fim.is.null,data_fim.gte.${hoje}`)
      .order('ordem_prioridade', { ascending: true, nullsFirst: false })
      .limit(limite),
    supabase.from('lojas_produtos_curadoria')
      .select('ref, motivo, ordem_prioridade, data_fim')
      .eq('tipo', 'novidade_manual').eq('ativo', true)
      .or(`data_fim.is.null,data_fim.gte.${hoje}`)
      .order('ordem_prioridade', { ascending: true, nullsFirst: false })
      .limit(limite),
    supabase.from('vw_lojas_novidades_auto')
      .select('ref, qtd_entregue')
      .limit(limite),
  ]);

  // Combina novidades (manual primeiro, depois auto, dedup)
  const novidadesRefsOrdenadas = [];
  for (const n of [...(novidadesManual || []), ...(novidadesAuto || [])]) {
    if (!novidadesRefsOrdenadas.includes(n.ref)) novidadesRefsOrdenadas.push(n.ref);
    if (novidadesRefsOrdenadas.length >= limite) break;
  }

  // Hidrata todas as refs com descricao + categoria + preco_medio
  const todasRefs = Array.from(new Set([
    ...(emAlta || []).map(r => r.ref),
    ...(bestSellers || []).map(r => r.ref),
    ...novidadesRefsOrdenadas,
  ]));

  let descricoesPorRef = {};
  if (todasRefs.length > 0) {
    const { data: produtos } = await supabase
      .from('lojas_produtos')
      .select('ref, descricao, categoria, preco_medio, pode_oferecer')
      .in('ref', todasRefs);
    for (const p of produtos || []) descricoesPorRef[p.ref] = p;
  }

  const hidratar = (lista) => (lista || [])
    .map(r => ({
      ref: r.ref,
      descricao: descricoesPorRef[r.ref]?.descricao,
      categoria: descricoesPorRef[r.ref]?.categoria,
      pode_oferecer: descricoesPorRef[r.ref]?.pode_oferecer,
    }))
    .filter(r => r.descricao && r.pode_oferecer !== false); // exclui pode_oferecer=false

  const resultado = {
    em_alta: hidratar(emAlta),
    best_sellers: hidratar(bestSellers),
    novidades: hidratar(novidadesRefsOrdenadas.map(ref => ({ ref }))),
  };

  cacheCardapioGeral.data = resultado;
  cacheCardapioGeral.expiresAt = Date.now() + CACHE_TTL_MS;
  return resultado;
}

// ─── MATCHES POR REF (do carrinho do cliente) ─────────────────────────────

async function getMatches(refsDoCarrinho, limite = 5) {
  if (!refsDoCarrinho || refsDoCarrinho.length === 0) return [];
  const key = [...refsDoCarrinho].sort().join(',');
  const cached = cacheMatches.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // Pega top matches por cada ref do carrinho
  const { data: matchesRows, error } = await supabase
    .from('mv_lojas_matches_90d')
    .select('ref_top, ref_match, pct, coocorrencias, total_compras')
    .in('ref_top', refsDoCarrinho)
    .order('pct', { ascending: false })
    .limit(refsDoCarrinho.length * limite);

  if (error) {
    logErro('cardapio/matches', error);
    return [];
  }

  // Hidrata descrições
  const refsMatch = Array.from(new Set((matchesRows || []).map(m => m.ref_match)));
  let descrPorRef = {};
  if (refsMatch.length > 0) {
    const { data: prods } = await supabase
      .from('lojas_produtos')
      .select('ref, descricao, categoria, preco_medio, pode_oferecer')
      .in('ref', refsMatch);
    for (const p of prods || []) descrPorRef[p.ref] = p;
  }

  // Agrupa por ref_top, mantém só os melhores e com descrição válida
  const porRefTop = {};
  for (const m of matchesRows || []) {
    const d = descrPorRef[m.ref_match];
    if (!d || !d.descricao) continue;       // sem descrição = não confio
    if (d.pode_oferecer === false) continue; // produto bloqueado
    if (!porRefTop[m.ref_top]) porRefTop[m.ref_top] = [];
    if (porRefTop[m.ref_top].length < limite) {
      porRefTop[m.ref_top].push({
        ref: m.ref_match,
        descricao: d.descricao,
        categoria: d.categoria,
        pct: Number(m.pct),
        coocorrencias: m.coocorrencias,
      });
    }
  }

  const resultado = Object.entries(porRefTop).map(([refTop, sugestoes]) => ({
    ref_carrinho: refTop,
    sugestoes,
  }));

  cacheMatches.set(key, { data: resultado, expiresAt: Date.now() + CACHE_TTL_MS });
  return resultado;
}

// ─── REFs RESOLVIDAS DO CARRINHO DE UMA CONVERSA ──────────────────────────

export async function getRefsCarrinhoDeConversa(carrinhoId) {
  if (!carrinhoId) return [];
  try {
    // Pega evento mais recente desse lead
    const { data: evento } = await supabase
      .from('lojas_lead_carrinho_eventos')
      .select('items_html_raw, items_parsed')
      .eq('lead_id', carrinhoId)
      .order('created_at_convertr', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!evento) return [];

    // 1. items_parsed já traz ref (formato novo `produtos` do Convertr,
    //    importador deriva REF = 4 primeiros dígitos do SKU). Ailson 02/07/2026.
    const parsed = Array.isArray(evento.items_parsed) ? evento.items_parsed : [];
    const refsParsed = parsed.map(i => i?.ref).filter(Boolean);
    if (refsParsed.length) return [...new Set(refsParsed)];

    if (!evento.items_html_raw) return [];

    // 2. Formato texto "Nx SKU" cru (evento antigo reimportado sem parse).
    //    REF = SKU menos os 5 últimos dígitos (cor 3 + tam 2). Ailson 02/07/2026.
    const setNovo = new Set();
    const reTexto = /\d+\s*x\s+(\d{6,})/g;
    let m;
    while ((m = reTexto.exec(evento.items_html_raw)) !== null) {
      setNovo.add(m[1].slice(0, -5).replace(/^0+/, '') || '0');
    }
    if (setNovo.size) return Array.from(setNovo);

    // 3. HTML legado → função SQL extrair_refs_carrinho
    const { data: refs, error } = await supabase.rpc('extrair_refs_carrinho', {
      p_items_html: evento.items_html_raw,
    });
    if (error) {
      logErro('cardapio/extrair', error);
      return [];
    }
    // Dedup
    const setRefs = new Set();
    for (const r of refs || []) setRefs.add(r.ref);
    return Array.from(setRefs);
  } catch (e) {
    logErro('cardapio/refs-carrinho', e);
    return [];
  }
}

// ─── FOTO DA PEÇA DO CARRINHO (biblioteca Mídias da Sofia) ─────────────────
// Correção Ailson 02/07/2026: a fonte de fotos do módulo Sofia é a biblioteca
// do botão Mídias (lojas_whats_midias, tipo='foto', já referenciada por REF,
// bucket privado sofia-midias) — NÃO o bucket produtos de outros módulos.
// Extrai as REFs do último evento de carrinho e devolve a primeira mídia foto
// ativa que existir na biblioteca. Retorna null se nada rastreável.

export async function resolverMidiaFotoCarrinho(carrinhoId) {
  const refs = await getRefsCarrinhoDeConversa(carrinhoId);
  if (!refs.length) return null;

  // Normaliza sem zero à esquerda, mas a biblioteca tem REFs como '0020' —
  // então busca as variantes (norm/pad4/pad5) e compara normalizado dos 2 lados.
  const refsNorm = [...new Set(refs.slice(0, 10).map(r => String(r).replace(/^0+/, '') || '0'))];
  const variantes = [...new Set(refsNorm.flatMap(r => [r, r.padStart(4, '0'), r.padStart(5, '0')]))];

  const { data } = await supabase
    .from('lojas_whats_midias')
    .select('id, tipo, ref, nome_arquivo, storage_path, mime_type, size_bytes')
    .eq('tipo', 'foto')
    .eq('ativa', true)
    .in('ref', variantes)
    .limit(variantes.length);

  if (!data?.length) return null;
  const normalizar = r => String(r || '').replace(/^0+/, '') || '0';
  // Respeita a ordem das REFs no carrinho (primeira peça com foto ganha)
  for (const ref of refsNorm) {
    const m = data.find(d => normalizar(d.ref) === ref);
    if (m) return m;
  }
  return data[0];
}

// ─── MONTAGEM COMPLETA DO CARDAPIO ────────────────────────────────────────

export async function montarCardapio({ refsDoCarrinho = [], limite = 6 } = {}) {
  const [geral, matches] = await Promise.all([
    getCardapioGeral(limite),
    getMatches(refsDoCarrinho, 4),
  ]);
  return { ...geral, matches };
}

// ─── FORMATACAO PRA INJETAR NO SYSTEM PROMPT DA IA ────────────────────────

export function formatarCardapioPraIA(cardapio) {
  if (!cardapio) return '';
  const linhas = [];

  if (cardapio.em_alta?.length) {
    linhas.push('EM ALTA AGORA:');
    for (const p of cardapio.em_alta.slice(0, 5)) {
      linhas.push(`- ${p.descricao}${p.categoria ? ` (${p.categoria.toLowerCase()})` : ''}`);
    }
    linhas.push('');
  }

  if (cardapio.best_sellers?.length) {
    linhas.push('BEST SELLERS (classicos da Amicia):');
    for (const p of cardapio.best_sellers.slice(0, 5)) {
      linhas.push(`- ${p.descricao}${p.categoria ? ` (${p.categoria.toLowerCase()})` : ''}`);
    }
    linhas.push('');
  }

  if (cardapio.novidades?.length) {
    linhas.push('NOVIDADES:');
    for (const p of cardapio.novidades.slice(0, 5)) {
      linhas.push(`- ${p.descricao}${p.categoria ? ` (${p.categoria.toLowerCase()})` : ''}`);
    }
    linhas.push('');
  }

  if (cardapio.matches?.length) {
    linhas.push('PECAS QUE CASAM COM O CARRINHO DESSE CLIENTE (clientes que levaram juntos nos ultimos 90 dias):');
    for (const m of cardapio.matches) {
      const top3 = m.sugestoes.slice(0, 3);
      const sugStr = top3.map(s => `${s.descricao} (${Math.round(s.pct)}% das vezes)`).join(' · ');
      linhas.push(`- com o item do carrinho dela, combina: ${sugStr}`);
    }
    linhas.push('');
  }

  if (linhas.length === 0) {
    return 'CATALOGO HOJE: sem produtos curados ativos (use apenas conhecimento geral da marca).';
  }
  return linhas.join('\n').trim();
}

// ─── LISTA DE REFERENCIAS ATIVAS (reconhecer print / pergunta por modelo) ─────
// Diferente do cardapio (destaques pra OFERECER), esta e a base AMPLA do que tem
// estoque agora, pra Sofia RECONHECER qualquer peca que a cliente mandar (print,
// foto, nome). Traz estoque-semaforo (qtd_estoque do Mire, por REF) + as cores do
// corte mais recente conhecido daquela ref. Ailson 05/06/2026.
const cacheRefsAtivas = { data: null, expiresAt: 0 };

function semaforoEstoque(q) {
  const n = Number(q) || 0;
  if (n >= 40) return 'bastante';
  if (n >= 12) return 'tem disponivel';
  if (n >= 1) return 'pouco (ta saindo)';
  return 'sem estoque';
}

export async function montarListaReferenciasAtivas() {
  if (cacheRefsAtivas.data && cacheRefsAtivas.expiresAt > Date.now()) {
    return cacheRefsAtivas.data;
  }
  try {
    // 1. Produtos com estoque (base ampla do que da pra reconhecer/vender)
    const { data: prods } = await supabase
      .from('lojas_produtos')
      .select('ref, descricao, categoria, qtd_estoque')
      .gt('qtd_estoque', 0)
      .order('qtd_estoque', { ascending: false })
      .range(0, 199);

    // 2. Cores DISPONIVEIS por ref (planilha do dia, disponivel>0) — fonte
    //    autoritativa pro casamento foto->peca; sai INLINE em cada linha pra
    //    facilitar a Sofia reconhecer pela cor. Ailson 13/06/2026.
    const mapaCoresDisp = {};
    try {
      const { data: grade } = await supabase
        .from('lojas_estoque_grade').select('ref, cor').gt('disponivel', 0);
      for (const g of grade || []) {
        const refN = String(g.ref).replace(/^0+/, '') || '0';
        if (!mapaCoresDisp[refN]) mapaCoresDisp[refN] = new Set();
        if (g.cor) mapaCoresDisp[refN].add(String(g.cor).trim());
      }
    } catch (e) { logErro('cardapio/cores-grade', e); }

    // 2b. Cores do ultimo corte (fallback quando a ref nao esta na planilha do dia).
    const mapaCores = {};
    try {
      const { data: ac } = await supabase
        .from('amicia_data').select('payload').eq('user_id', 'ailson_cortes').maybeSingle();
      const cortes = ac?.payload?.cortes || [];
      const ordenados = [...cortes].sort((a, b) => String(a?.data || '').localeCompare(String(b?.data || '')));
      for (const c of ordenados) {
        const cores = (c?.detalhes?.cores || []).map(x => x?.nome).filter(Boolean);
        if (!c?.ref || cores.length === 0) continue;
        const refN = String(c.ref).replace(/^0+/, '') || '0';
        mapaCores[refN] = [...new Set(cores)]; // mais recente sobrescreve
      }
    } catch (e) { logErro('cardapio/cores-corte', e); }

    // 3. Formata uma linha por ref
    const linhas = (prods || []).map(p => {
      const refN = String(p.ref).replace(/^0+/, '') || '0';
      const partes = [
        `REF ${p.ref}`,
        `${p.descricao || 's/ descricao'}${p.categoria ? ` (${String(p.categoria).toLowerCase()})` : ''}`,
        `estoque: ${semaforoEstoque(p.qtd_estoque)}`,
      ];
      const coresDisp = mapaCoresDisp[refN] && mapaCoresDisp[refN].size ? [...mapaCoresDisp[refN]] : null;
      if (coresDisp) partes.push(`cores disponiveis: ${coresDisp.join(', ').toLowerCase()}`);
      else if (mapaCores[refN] && mapaCores[refN].length) partes.push(`cores do ultimo corte: ${mapaCores[refN].join(', ')}`);
      const ficha = fichaCurtaModelo(refN);
      if (ficha) partes.push(`ficha: ${ficha}`);
      return '- ' + partes.join(' | ');
    });

    const str = linhas.length ? linhas.join('\n') : '(sem referencias com estoque no momento)';
    cacheRefsAtivas.data = str;
    cacheRefsAtivas.expiresAt = Date.now() + CACHE_TTL_MS;
    return str;
  } catch (e) {
    logErro('cardapio/refs-ativas', e);
    return '';
  }
}

// ─── FOTOS DE REFERENCIA PRO CASAMENTO VISUAL (foto da cliente x catalogo) ──
// Retorna ate `limite` fotos (1 por REF) das pecas COM ESTOQUE que tem foto.
// Se `categorias` (array, ex: ['BLAZER','CASAQUINHO']) vier, filtra so essas —
// evita mandar dezenas de imagens (estoura contexto + custo). Cache da lista
// completa; o filtro/cap roda na volta. URL publica do bucket sofia-midias.
// Ailson 13/06/2026.
const cacheFotosRec = { data: null, expiresAt: 0 };
export async function montarFotosReconhecimento(limite = 16, categorias = null) {
  const lim = Math.max(1, Number(limite) || 16);
  const cats = Array.isArray(categorias) && categorias.length
    ? categorias.map(c => String(c).toUpperCase()) : null;
  let base = (cacheFotosRec.data && cacheFotosRec.expiresAt > Date.now()) ? cacheFotosRec.data : null;
  if (!base) {
    try {
      // Universo de RECONHECIMENTO = refs que a gente fotografou (tipo='foto').
      // NAO depende de estoque: identificar o modelo vem ANTES de checar
      // disponibilidade (essa a Sofia confirma no ESTOQUE FINO). Antes o pool
      // saia de lojas_produtos com qtd_estoque>0, entao ref vendendo mas com
      // estoque negativo/zerado (ex: 3213 = -63) ficava INVISIVEL ao match e a
      // Sofia casava com a mais parecida visivel (ex: 3210). Ailson 28/06/2026.
      const { data: fotos } = await supabase
        .from('lojas_whats_midias')
        .select('ref, storage_path, criada_em')
        .eq('tipo', 'foto')
        .not('ativa', 'is', false)
        .not('storage_path', 'is', null)
        .order('criada_em', { ascending: false });
      const fotoPorRef = new Map();
      for (const f of fotos || []) {
        const refN = String(f.ref).replace(/^0+/, '') || '0';
        if (!fotoPorRef.has(refN) && f.storage_path) fotoPorRef.set(refN, f.storage_path);
      }
      if (!fotoPorRef.size) return [];

      // categoria + estoque (so pra ORDENAR) de todas as refs — sem filtrar por
      // estoque. lojas_produtos eh bounded (~545 refs).
      const { data: prods } = await supabase
        .from('lojas_produtos')
        .select('ref, qtd_estoque, categoria');
      const catPorRef = {};
      const estPorRef = {};
      for (const p of prods || []) {
        const refN = String(p.ref).replace(/^0+/, '') || '0';
        if (!(refN in catPorRef)) {
          catPorRef[refN] = (p.categoria || '').toUpperCase();
          estPorRef[refN] = Number(p.qtd_estoque) || 0;
        }
      }

      // Refs fotografadas ordenadas por estoque desc (in-stock popular primeiro
      // quando o geral for capado), mas INCLUINDO as zeradas/negativas.
      const ordemRef = [...fotoPorRef.keys()].sort(
        (a, b) => (estPorRef[b] ?? -1e9) - (estPorRef[a] ?? -1e9)
      );

      base = [];
      for (const refN of ordemRef) {
        const sp = fotoPorRef.get(refN);
        if (!sp) continue;
        const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(sp);
        if (pub?.publicUrl) base.push({ ref: refN, url: pub.publicUrl, categoria: catPorRef[refN] || '' });
      }
      cacheFotosRec.data = base;
      cacheFotosRec.expiresAt = Date.now() + CACHE_TTL_MS;
    } catch (e) {
      logErro('cardapio/fotos-reconhecimento', e);
      return [];
    }
  }
  let lista = base;
  if (cats) {
    const filt = base.filter(x => cats.includes(x.categoria));
    if (filt.length) {
      // Categoria detectada vem PRIMEIRO (prioridade), mas completa com as
      // outras refs ate o limite — pra nao ESCONDER a peca que a Sofia
      // categorizou diferente (ex: viu "casaquinho" mas era CONJUNTO). O match
      // final eh pela imagem, entao candidato extra nao atrapalha. Ailson 28/06/2026.
      const resto = base.filter(x => !cats.includes(x.categoria));
      lista = [...filt, ...resto];
    }
  }
  return lista.slice(0, lim).map(({ ref, url }) => ({ ref, url }));
}

