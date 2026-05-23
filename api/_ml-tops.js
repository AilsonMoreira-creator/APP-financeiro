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
 * Dado um MLB de parte de baixo, busca as 1-2 opcoes de PARTE DE CIMA do
 * anuncio + os MLBs especificos DA MESMA MARCA. Retorna null se nao mapeado.
 *
 * Retorno: {
 *   ref_baixo,        // ex '2277'
 *   marca,            // 'LUMIA' | 'EXITUS' | 'MUNIAM'
 *   opcoes: [         // 1 ou 2 itens
 *     { ref, tipo, descricao_curta, is_plus_size, mlb (MLB da mesma marca) },
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
      .select('ref_baixo, marca, ref_top_1, ref_top_2, mlb_top_1, mlb_top_2')
      .eq('mlb', mlb)
      .maybeSingle();
    if (!row) return null;

    const refs = await carregarRefs();
    const opcoes = [];
    const t1 = refs.find(r => r.ref === row.ref_top_1);
    if (t1) opcoes.push({ ...t1, mlb: row.mlb_top_1 || null });
    if (row.ref_top_2) {
      const t2 = refs.find(r => r.ref === row.ref_top_2);
      if (t2) opcoes.push({ ...t2, mlb: row.mlb_top_2 || null });
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
 * Texto sai com MLB DA MESMA MARCA do anuncio (Lumia/Exitus/Muniam):
 *
 *   PEÇAS DE CIMA QUE COMBINAM (anuncios separados — NAO sao conjunto):
 *     - REF 1628 cropped viscolinho — https://produto.mercadolivre.com.br/MLB4093923795
 *     - REF 395 body transpassado s/manga — https://produto.mercadolivre.com.br/MLB3708101322
 *
 * Se cliente esta em anuncio Exitus, link Exitus. Em Lumia, link Lumia. Idem Muniam.
 */
export async function gerarBlocoTops(mlbId) {
  const info = await buscarTopsDoAnuncio(mlbId);
  if (!info || info.opcoes.length === 0) return null;

  const linhas = info.opcoes.map(o => {
    const link = o.mlb
      ? ` — https://produto.mercadolivre.com.br/${o.mlb}`
      : '';
    return `  - REF ${o.ref} ${o.descricao_curta}${link}`;
  }).join('\n');

  return `\n\nPEÇAS DE CIMA QUE COMBINAM (anuncios separados — NAO sao conjunto):\n${linhas}`;
}

/**
 * Fallback dinamico pra quando o anuncio NAO esta mapeado em ml_top_anuncios_map.
 * Retorna lista de descricoes de tops genericos (1 por tipo) baseado em ml_top_refs.
 *
 * - isPlus=true:  prefere descricao plus size (ex: ref 2820 "cropped viscolinho plus size")
 *                 e usa normal pros tipos sem plus
 * - isPlus=false: so descricoes normais
 *
 * Retorna [] se tabela vazia (defensivo).
 */
export async function getFallbackTopsGenericos(isPlus = false) {
  const refs = await carregarRefs();
  if (!refs || refs.length === 0) return [];

  // Agrupa por tipo
  const porTipo = {};
  for (const r of refs) {
    if (!porTipo[r.tipo]) porTipo[r.tipo] = [];
    porTipo[r.tipo].push(r);
  }

  // Pra cada tipo, escolhe a melhor descricao (ordena por ref pra ser deterministico)
  const escolhidas = {};
  for (const [tipo, lista] of Object.entries(porTipo)) {
    const ordenadas = [...lista].sort((a, b) => String(a.ref).localeCompare(String(b.ref)));
    if (isPlus) {
      const plus = ordenadas.find(r => r.is_plus_size);
      const normal = ordenadas.find(r => !r.is_plus_size);
      escolhidas[tipo] = plus || normal;
    } else {
      escolhidas[tipo] = ordenadas.find(r => !r.is_plus_size);
    }
  }

  // Ordem: cropped, body, camisa (mesma ordem de prioridade do antigo hardcoded)
  const ordem = ['cropped', 'body', 'camisa'];
  return ordem.map(t => escolhidas[t]).filter(Boolean);
}

/**
 * Formata a lista de fallback como string pra colar no prompt:
 *   ["cropped viscolinho", "body transpassado s/ manga", "camisa tricoline"]
 *   → '"cropped viscolinho", "body transpassado s/ manga" ou "camisa tricoline"'
 *
 * Usa termos REAIS do banco (em vez do antigo hardcoded "body poliamida"
 * que NAO existia em nenhum anuncio — cliente nunca achava nada).
 *
 * Retorna null se nenhum top cadastrado (fallback ultra deve ser usado).
 */
export async function formatarBuscasPecaCima(isPlus = false) {
  const lista = await getFallbackTopsGenericos(isPlus);
  if (lista.length === 0) return null;

  const termos = lista.map(r => `"${r.descricao_curta}"`);
  if (termos.length === 1) return termos[0];
  if (termos.length === 2) return `${termos[0]} ou ${termos[1]}`;
  return `${termos.slice(0, -1).join(', ')} ou ${termos[termos.length - 1]}`;
}

/**
 * Regras pra colar no system prompt. Compartilhada por ml-ai e ml-webhook.
 */
export const REGRAS_TOPS_PROMPT = `PARTE DE CIMA QUE COMBINA (Ailson 22/05/2026): As peças que combinam com a parte de baixo deste anúncio SÃO PEÇAS DIFERENTES, vendidas em ANÚNCIOS SEPARADOS — NUNCA chame de "conjunto", "conjuntinho", "kit", "look completo" nem similar. São peças complementares que ficam bonitas juntas, mas o cliente compra cada uma em um anúncio.

Se o anúncio tem bloco "PEÇAS DE CIMA QUE COMBINAM" e cliente pergunta sobre top/blusa/cropped/body/camisa, USE essa tabela como fonte oficial. Regras:

  1. Cliente pergunta GENÉRICO ("qual a blusa?", "qual a parte de cima?", "tem peça pra cima?"):
     - Se há APENAS 1 opção -> indique a única com REF + descrição + link: "A peça de cima que combina é o cropped viscolinho (REF 1628), link do anúncio: https://produto.mercadolivre.com.br/MLB...".
     - Se há 2+ opções -> ofereça AS DUAS com link: "Tem 2 opções que combinam: body transpassado s/manga (https://produto.mercadolivre.com.br/MLB...) e body decote V (https://produto.mercadolivre.com.br/MLB...). Dá uma olhada nos dois e escolhe o que gostar mais!"

  2. Cliente especifica tipo:
     - "cropped"/"croped"/"top" -> indique REF(s) tipo=cropped com link. Se houver 2 (normal + plus), liste ambos.
     - "body"/"bodi"/"bori"/"bore" -> indique REF(s) tipo=body com link. SE HOUVER 2 BODIES disponíveis, OFEREÇA OS DOIS com descrição distinguindo (transpassado vs decote V) + link.
     - "camisa"/"tricoline" -> indique REF tipo=camisa com link.
     - "blusa"/"blusinha" -> ambíguo. Ofereça TODAS as opções que combinam (cropped + camisa + body) com links.

  3. REGRA DE OURO: sempre que houver DÚVIDA sobre o que o cliente quer, OFEREÇA AS 2-3 OPÇÕES com seus links. NUNCA pergunte "qual cor você tá vendo?" — o cliente já está vendo o anúncio, não temos como saber a cor pra ele, e perguntar cor não resolve a dúvida da peça. Mande os links e ele escolhe.

  4. Se cliente perguntou tipo que NÃO ESTÁ nas opções disponíveis:
     - "Esse modelo não tem [tipo] que combina pronto, mas as opções que combinam são [as opções com links]."

  5. SEMPRE inclua o LINK do anúncio (https://produto.mercadolivre.com.br/MLB...) que aparece na tabela. NUNCA invente REF nem link. Se não veio bloco "PEÇAS DE CIMA QUE COMBINAM" no contexto, responda: "Deixa eu confirmar com a equipe e te respondo em instantes" e marca pra handoff.`;
