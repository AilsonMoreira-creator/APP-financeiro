// ═══════════════════════════════════════════════════════════════════════════
// _ml-tops.js — Mapeamento MLB → PARTE DE CIMA + detector de pedido
// ═══════════════════════════════════════════════════════════════════════════
// Cliente do ML pergunta muito "qual a blusinha/cropped/body do conjunto?"
// em anuncios de PARTE DE BAIXO (calca, saia, bermuda). Cada anuncio tem 1
// ou 2 opcoes de parte de cima dependendo da cor.
//
// 5 REFs de top hoje (catalogadas pelo Ailson 22/05/2026):
//   395  = BODY transpassado s/ manga (67-70cm)
//   1628 = CROPPED viscolinho         (38-41cm)
//   2361 = BODY decote V              (70-74cm, PP/P/M/G/GG)
//   2820 = CROPPED viscolinho PLUS    (45-47cm, G1/G2/G3)
//   3186 = CAMISA tricoline           (sem MLB mapeado ainda)
//
// IMPORTANTE: alguns anuncios tem 2 BODIES diferentes (395 + 2361) ou 2
// CROPPEDS (normal + plus) como opcoes. Quando cliente pergunta "body",
// listar os 2 com descricao distinguindo (transpassado vs decote V).
//
// Compartilhado entre:
//   - api/ml-ai.js     (geracao de sugestao on-demand pelo admin)
//   - api/ml-webhook.js (auto-resposta via webhook ML)
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from './_ml-helpers.js';

// Cache em memoria (refs e palavras-chave mudam pouco)
let _cacheRefs = null;
let _cacheRefsAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5min

async function carregarRefs() {
  const agora = Date.now();
  if (_cacheRefs && (agora - _cacheRefsAt) < CACHE_TTL_MS) return _cacheRefs;
  try {
    const { data } = await supabase
      .from('ml_top_refs')
      .select('ref, tipo, descricao_curta, palavras_chave, is_plus_size');
    _cacheRefs = data || [];
    _cacheRefsAt = agora;
  } catch (e) {
    console.warn('[ml-tops] carregar refs falhou:', e?.message);
    _cacheRefs = _cacheRefs || [];
  }
  return _cacheRefs;
}

// Normaliza texto da pergunta pra detectar tops (lowercase, sem acento, sem pontuacao)
function normTexto(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detecta se o cliente perguntou sobre PARTE DE CIMA.
 * Retorna o tipo desejado: 'cropped' | 'body' | 'blusa' | 'qualquer' | null
 *   'qualquer' = perguntou generico ("qual a parte de cima?", "qual a blusa?"
 *                — mas sem especificar tipo).
 * Funciona pra variacoes comuns (cropped/croped/cropd; body/bodi/bori/bore).
 */
export async function detectarPedidoDeTop(textoCliente) {
  const t = normTexto(textoCliente);
  if (!t) return null;

  const refs = await carregarRefs();
  // Junta todas palavras-chave de cada tipo
  const porTipo = new Map();
  for (const r of refs) {
    if (!porTipo.has(r.tipo)) porTipo.set(r.tipo, new Set());
    (r.palavras_chave || []).forEach(p => porTipo.get(r.tipo).add(normTexto(p)));
  }

  // Procura match — prioriza tipo mais especifico
  // Se cliente disse "cropped" -> tipo=cropped (mesmo que body tbm tenha "parte de cima" como palavra)
  // Se disse so "blusa" -> pode ser cropped OU camisa (ambos tem 'blusa' como sinonimo)
  // Resolucao: tipo mais especifico ganha. body > cropped > camisa > generico.
  const ordemPrioridade = ['body', 'cropped', 'camisa'];

  for (const tipo of ordemPrioridade) {
    const palavras = porTipo.get(tipo) || new Set();
    for (const p of palavras) {
      // Match palavra inteira (evitar 'corpo' matchando 'cor' ou similar)
      const regex = new RegExp(`\\b${p.replace(/\s+/g, '\\s+')}\\b`, 'i');
      if (regex.test(t)) {
        // Se for palavra muito generica ('parte de cima', 'cima'), retorna 'qualquer'
        if (p === 'parte de cima' || p === 'cima') return 'qualquer';
        return tipo;
      }
    }
  }
  return null;
}

/**
 * Dado um MLB, busca as 1-2 opcoes de PARTE DE CIMA do anuncio.
 * Retorna null se o MLB nao esta mapeado (anuncio nao tem combinacao).
 *
 * Retorno: {
 *   ref_baixo,        // ex '2277'
 *   marca,            // 'LUMIA' | 'EXITUS' | 'MUNIAM'
 *   opcoes: [         // 1 ou 2 itens
 *     { ref, tipo, descricao_curta, ordem: 1|2, is_plus_size },
 *     ...
 *   ]
 * }
 */
export async function buscarTopsDoAnuncio(mlbId) {
  if (!mlbId) return null;
  const mlb = String(mlbId).startsWith('MLB') ? mlbId : `MLB${mlbId}`;
  try {
    const { data: row } = await supabase
      .from('ml_top_anuncios_map')
      .select('ref_baixo, marca, ref_top_1, ref_top_2')
      .eq('mlb', mlb)
      .maybeSingle();
    if (!row) return null;

    const refs = await carregarRefs();
    const opcoes = [];
    const t1 = refs.find(r => r.ref === row.ref_top_1);
    if (t1) opcoes.push({ ...t1, ordem: 1 });
    if (row.ref_top_2) {
      const t2 = refs.find(r => r.ref === row.ref_top_2);
      if (t2) opcoes.push({ ...t2, ordem: 2 });
    }
    return { ref_baixo: row.ref_baixo, marca: row.marca, opcoes };
  } catch (e) {
    console.warn('[ml-tops] buscarTopsDoAnuncio falhou:', e?.message);
    return null;
  }
}

/**
 * Gera bloco de texto pra injetar no itemContext do anuncio (parte de baixo).
 * Retorna null se o anuncio nao tem mapping.
 *
 * Texto sai assim:
 *
 *   PARTES DE CIMA DESTE ANUNCIO (tabela oficial):
 *     - REF 1628 (cropped curto) - opcao principal
 *     - REF 395 (body transpassado s/ manga) - 2a opcao
 *   Regras: se cliente perguntar generico "qual a parte de cima/blusa", liste
 *   as 2 opcoes. Se especificar (cropped/body/blusa) responda so o que bate.
 */
export async function gerarBlocoTops(mlbId) {
  const info = await buscarTopsDoAnuncio(mlbId);
  if (!info || info.opcoes.length === 0) return null;

  const linhas = info.opcoes.map(o => {
    const sufixo = info.opcoes.length > 1
      ? (o.ordem === 1 ? ' (opcao principal)' : ' (2a opcao)')
      : '';
    return `  - REF ${o.ref} (${o.descricao_curta})${sufixo}`;
  }).join('\n');

  return `\n\nPARTES DE CIMA DESTE ANUNCIO (tabela oficial):\n${linhas}`;
}

/**
 * Regras pra colar no system prompt. Compartilhada por ml-ai e ml-webhook.
 */
export const REGRAS_TOPS_PROMPT = `PARTE DE CIMA (Ailson 22/05/2026): Se o anuncio tem bloco "PARTES DE CIMA DESTE ANUNCIO" e cliente pergunta sobre top/blusa/cropped/body/camisa, USE essa tabela como fonte oficial. Regras:
  1. Cliente pergunta GENERICO ("qual a blusa do conjunto?", "qual a parte de cima?", "tem a peca de cima?"):
     - Se anuncio tem APENAS 1 opcao -> responde com essa REF + descricao: "A parte de cima desse conjunto e o cropped viscolinho (REF 1628), anuncio separado".
     - Se anuncio tem 2 opcoes -> liste as duas com descricao distinguindo: "Esse conjunto tem 2 opcoes de cima dependendo da cor: body transpassado s/ manga (REF 395) ou body decote V (REF 2361). Qual cor voce esta vendo?"
  2. Cliente especifica tipo:
     - "cropped"/"croped"/"top" -> responde com a REF tipo=cropped. Se houver 2 (normal + plus), liste ambos com descricao.
     - "body"/"bodi"/"bori"/"bore" -> responde com a REF tipo=body. SE HOUVER 2 BODIES no mesmo anuncio (transpassado + decote V), liste OS DOIS com descricao distinguindo: "Esse conjunto vem com 2 opcoes de body: body transpassado s/manga (REF 395) ou body decote V (REF 2361). Qual cor?"
     - "camisa"/"tricoline" -> responde com a REF tipo=camisa
     - "blusa"/"blusinha" -> ambigua. Se anuncio tem cropped -> indica o cropped. Se anuncio tem so camisa -> indica a camisa. Se ambos -> liste os 2.
  3. Se cliente perguntou tipo que NAO ESTA nas opcoes do anuncio:
     - "Esse conjunto nao acompanha [tipo], so [as opcoes que tem]. Posso te mostrar?"
  4. NUNCA invente REF de parte de cima. Se nao veio bloco "PARTES DE CIMA" no contexto, responda: "Deixa eu confirmar com a equipe e te respondo em instantes" e marca pra handoff.`;
