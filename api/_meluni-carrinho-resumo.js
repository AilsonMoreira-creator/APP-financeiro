// ============================================================================
// MELUNI — montador do resumo do carrinho ({{2}}) e do primeiro nome ({{1}})
// pros templates de carrinho abandonado da Lara.
// ----------------------------------------------------------------------------
// Resolução do nome da peça (cadeia, conforme meluni_config.lara_templates_carrinho
// -> fonte_nome_prioridade):
//   1) calculadora  -> amicia_data user_id='calc-meluni' payload.prods[].descricao (por ref)
//   2) ml_sku_ref_map.desc_limpa
//   3) Bling API por bling_produto_id
// Depois encurta pro núcleo title-case (ex "SAIA DE LINHO ELASTANO..." -> "Saia de Linho").
//
// sku -> ref via ml_sku_ref_map.sku; fallback bling_estoque.bling_sku.
// Item principal = 1º item (carrinho não tem preço por item, só valor total).
// Formato: 1 peça -> só o nome; 2 -> "X e mais 1 peça"; 3+ -> "X e mais N peças".
// Ailson 16/06/2026.
// ============================================================================
import { supabase, refreshBlingToken, blingFetch } from './_bling-helpers.js';
import { cfgMeluni } from './_meluni-whats-helpers.js';

const refSemZero = (r) => String(r ?? '').replace(/^0+/, '') || '0';

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normalizar(s) {
  return semAcento(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// peça (tipo) e tecido conhecidos — chave normalizada (sem acento) -> rótulo de exibição
const TIPOS = {
  vestido: 'Vestido', saia: 'Saia', blusa: 'Blusa', bermuda: 'Bermuda',
  short: 'Short', shorts: 'Short', calca: 'Calça', pantalona: 'Pantalona',
  pantacourt: 'Pantacourt', macacao: 'Macacão', macaquinho: 'Macaquinho',
  conjunto: 'Conjunto', cropped: 'Cropped', croped: 'Cropped', camisa: 'Camisa',
  camiseta: 'Camiseta', regata: 'Regata', colete: 'Colete', jaqueta: 'Jaqueta',
  casaco: 'Casaco', kimono: 'Kimono', blazer: 'Blazer', body: 'Body', top: 'Top',
  legging: 'Legging', tunica: 'Túnica', cardiga: 'Cardigã', cardigan: 'Cardigã',
  poncho: 'Poncho', saida: 'Saída', lenco: 'Lenço',
};
const TECIDOS = {
  linho: 'Linho', viscose: 'Viscose', malha: 'Malha', trico: 'Tricô', tricot: 'Tricô',
  alfaiataria: 'Alfaiataria', sarja: 'Sarja', jeans: 'Jeans', algodao: 'Algodão',
  crepe: 'Crepe', suede: 'Suede', couro: 'Couro', moletom: 'Moletom', cetim: 'Cetim',
  seda: 'Seda', chiffon: 'Chiffon', jacquard: 'Jacquard', lurex: 'Lurex',
  plush: 'Plush', neoprene: 'Neoprene', laise: 'Laise', lese: 'Laise',
};

function titleCase(s) {
  const menores = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'no', 'na']);
  return String(s || '').toLowerCase().split(/\s+/).filter(Boolean)
    .map((w, i) => (i > 0 && menores.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ').trim();
}

// "SAIA DE LINHO ELASTANO BOTÕES" -> "Saia de Linho"
export function nucleoNome(desc) {
  if (!desc || !String(desc).trim()) return null;
  const toks = normalizar(desc).split(' ');
  let tipo = null, tecido = null;
  for (const t of toks) { if (!tipo && TIPOS[t]) tipo = TIPOS[t]; if (!tecido && TECIDOS[t]) tecido = TECIDOS[t]; }
  if (tipo) return tecido ? `${tipo} de ${tecido}` : tipo;
  // sem tipo conhecido: title-case das 2 primeiras palavras significativas
  const sig = String(desc).split(/\s+/).filter(w => w.length > 2).slice(0, 2).join(' ');
  return titleCase(sig) || null;
}

// ── cache dos prods da calculadora (ref sem zero -> descricao) ──
let _prodsCache = { mapa: null, em: 0 };
async function prodsCalc() {
  if (_prodsCache.mapa && (Date.now() - _prodsCache.em) < 5 * 60 * 1000) return _prodsCache.mapa;
  const mapa = new Map();
  try {
    const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'calc-meluni').maybeSingle();
    for (const p of (data?.payload?.prods || [])) {
      const ref = refSemZero(p.ref);
      if (ref && p.descricao && !mapa.has(ref)) mapa.set(ref, p.descricao);
    }
  } catch { /* ignora */ }
  _prodsCache = { mapa, em: Date.now() };
  return mapa;
}

// ── curadoria ref -> nome curto (meluni_config.lara_carrinho_nomes_curto) ──
let _curadosCache = { mapa: null, em: 0 };
async function nomesCurados() {
  if (_curadosCache.mapa && (Date.now() - _curadosCache.em) < 5 * 60 * 1000) return _curadosCache.mapa;
  const obj = (await cfgMeluni('lara_carrinho_nomes_curto', {})) || {};
  const mapa = new Map();
  for (const [k, v] of Object.entries(obj)) { if (v) mapa.set(refSemZero(k), v); }
  _curadosCache = { mapa, em: Date.now() };
  return mapa;
}

async function blingNome(produtoId) {
  if (!produtoId) return null;
  try {
    const token = await refreshBlingToken('exitus');
    const r = await blingFetch(`https://api.bling.com.br/Api/v3/produtos/${produtoId}`, {
      Authorization: `Bearer ${token}`, Accept: 'application/json',
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data?.nome || null;
  } catch { return null; }
}

// sku[] -> Map sku -> { ref, desc_limpa, bling_produto_id }
async function mapearSkus(skus) {
  const mapa = new Map();
  if (!skus.length) return mapa;
  const [{ data: ml }, { data: bl }] = await Promise.all([
    supabase.from('ml_sku_ref_map').select('sku, ref, desc_limpa').in('sku', skus),
    supabase.from('bling_estoque').select('bling_sku, ref, bling_produto_id').in('bling_sku', skus),
  ]);
  for (const r of (ml || [])) mapa.set(r.sku, { ref: r.ref, desc_limpa: r.desc_limpa, bling_produto_id: null });
  for (const r of (bl || [])) {
    const cur = mapa.get(r.bling_sku) || {};
    mapa.set(r.bling_sku, { ref: cur.ref ?? r.ref, desc_limpa: cur.desc_limpa ?? null, bling_produto_id: r.bling_produto_id });
  }
  return mapa;
}

async function nomeDaPeca(info, calc, curados) {
  if (!info) return null;
  const ref = info.ref ? refSemZero(info.ref) : null;
  // 1) curadoria (nome pronto, não passa pela heurística)
  if (ref && curados.has(ref)) return curados.get(ref);
  // 2) calc -> 3) desc_limpa -> 4) Bling, tudo encurtado pro núcleo
  const fonte = (ref && calc.get(ref)) || info.desc_limpa || (await blingNome(info.bling_produto_id));
  return nucleoNome(fonte);
}

// itens = [{ sku, qtd }] -> { resumo, principalNome, nPecas }
// principalNome pode vir null (nenhuma fonte resolveu o nome).
export async function resolverResumoItens(itens) {
  const lista = Array.isArray(itens) ? itens.filter(i => i && i.sku) : [];
  const nPecas = lista.reduce((s, i) => s + (Number(i.qtd) || 1), 0);
  if (!lista.length) return { resumo: null, principalNome: null, nPecas: 0 };

  const skus = [...new Set(lista.map(i => i.sku))];
  const [skuMap, calc, curados] = await Promise.all([mapearSkus(skus), prodsCalc(), nomesCurados()]);

  const principal = lista[0]; // sem preço por item -> 1º
  const principalNome = await nomeDaPeca(skuMap.get(principal.sku), calc, curados);

  let resumo = null;
  if (principalNome) {
    if (nPecas <= 1) resumo = principalNome;
    else if (nPecas === 2) resumo = `${principalNome} e mais 1 peça`;
    else resumo = `${principalNome} e mais ${nPecas - 1} peças`;
  }
  return { resumo, principalNome, nPecas };
}

// primeiro nome ({{1}}) — carrinho não tem; vem de meluni_clientes, senão conversa.
export async function resolverPrimeiroNome(telefone, nomeCarrinho) {
  let bruto = (nomeCarrinho && nomeCarrinho.trim()) || null;
  if (!bruto) {
    const { data: cli } = await supabase.from('meluni_clientes').select('nome').eq('telefone', telefone)
      .not('nome', 'is', null).limit(1).maybeSingle();
    bruto = cli?.nome || null;
  }
  if (!bruto) {
    const { data: conv } = await supabase.from('meluni_conversas').select('nome_cliente').eq('telefone', telefone)
      .not('nome_cliente', 'is', null).order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle();
    bruto = conv?.nome_cliente || null;
  }
  if (!bruto) return null;
  const primeiro = String(bruto).trim().split(/\s+/)[0];
  if (!primeiro || primeiro.length < 2) return null;
  return titleCase(primeiro);
}
