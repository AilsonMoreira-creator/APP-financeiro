// ============================================================================
// MELUNI — dados de venda pra estratégia de conversão da Lara.
// ----------------------------------------------------------------------------
// rankingSnapshot(): top de vendas dos últimos 60 dias (RPC fn_vendas_produtos),
//   cacheado 1x/dia em meluni_config.lara_ranking_vendas. Traz:
//     - cores_alta: 3ª a 7ª colocadas (preto e bege sempre lideram -> fora)
//     - por_categoria: top por tipo de peça (Saia, Vestido, Calça, ...)
//     - top15: mais vendidas no geral
// rankingBloco(snap): bloco de prompt com os dados + a diretriz de conversão.
// contextoCarrinho(telefone, snap): bloco com a peça/cor do carrinho do lead,
//   se a cor está em alta e as mais vendidas da mesma categoria.
// Ailson 17/06/2026.
// ============================================================================
import { supabase, cfgMeluni, setCfgMeluni } from './_meluni-whats-helpers.js';
import { nucleoNome } from './_meluni-carrinho-resumo.js';

const refZ = (r) => String(r ?? '').replace(/^0+/, '') || '0';
const hojeISO = () => new Date().toISOString().slice(0, 10);
const semAcc = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function tipoDe(nome) {
  const w = semAcc(nome || '').toLowerCase().trim().split(/\s+/)[0] || '';
  const map = {
    saia: 'Saia', vestido: 'Vestido', calca: 'Calça', pantalona: 'Calça',
    macacao: 'Macacão', macaquinho: 'Macacão', bermuda: 'Bermuda', short: 'Short',
    cropped: 'Cropped', croped: 'Cropped', body: 'Body', blusa: 'Blusa',
    camisa: 'Camisa', conjunto: 'Conjunto', kit: 'Conjunto',
  };
  return map[w] || (nome ? nome.split(/\s+/)[0] : 'Peça');
}

async function nomesCurados() {
  const obj = (await cfgMeluni('lara_carrinho_nomes_curto', {})) || {};
  const m = new Map();
  for (const [k, v] of Object.entries(obj)) if (v) m.set(refZ(k), v);
  return m;
}

export async function rankingSnapshot() {
  const cache = await cfgMeluni('lara_ranking_vendas', null);
  if (cache?.data === hojeISO()) return cache;

  const fim = hojeISO();
  const ini = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  let rows = [];
  try {
    const r = await supabase.rpc('fn_vendas_produtos', { p_data_inicio: ini, p_data_fim: fim });
    rows = r.data || [];
  } catch {
    return cache || { data: null, cores_alta: [], por_categoria: {}, top15: [] };
  }
  if (!rows.length) return cache || { data: fim, cores_alta: [], por_categoria: {}, top15: [] };

  // cores: 3ª–7ª (tira preto/bege que sempre lideram)
  const corQ = new Map();
  for (const p of rows) {
    const c = semAcc(p.cor || '').toLowerCase().trim();
    if (c) corQ.set(c, (corQ.get(c) || 0) + (parseInt(p.qtd) || 0));
  }
  const cores_alta = [...corQ.entries()].sort((a, b) => b[1] - a[1])
    .map(([c]) => c).filter(c => c !== 'preto' && c !== 'bege').slice(0, 5);

  // produtos por ref
  const refQ = new Map(), refDesc = new Map();
  for (const p of rows) {
    const ref = refZ(p.ref);
    if (!ref || ref === '0') continue;
    refQ.set(ref, (refQ.get(ref) || 0) + (parseInt(p.qtd) || 0));
    if (p.desc_limpa && !refDesc.has(ref)) refDesc.set(ref, p.desc_limpa);
  }
  const curados = await nomesCurados();
  const nomeRef = (ref) => curados.get(ref) || nucleoNome(refDesc.get(ref)) || `Ref ${ref}`;
  const ordenados = [...refQ.entries()].sort((a, b) => b[1] - a[1])
    .map(([ref, qtd]) => ({ ref, qtd, nome: nomeRef(ref), tipo: tipoDe(curados.get(ref) || nucleoNome(refDesc.get(ref))) }));

  const top15 = ordenados.slice(0, 15);
  const por_categoria = {};
  for (const p of ordenados) { (por_categoria[p.tipo] ||= []); if (por_categoria[p.tipo].length < 4) por_categoria[p.tipo].push(p); }

  const snap = { data: fim, cores_alta, por_categoria, top15 };
  try { await setCfgMeluni('lara_ranking_vendas', snap); } catch { /* */ }
  return snap;
}

export function rankingBloco(snap) {
  if (!snap || !snap.top15?.length) return '';
  const cores = (snap.cores_alta || []).join(', ');
  const cats = Object.entries(snap.por_categoria || {})
    .map(([tipo, arr]) => `${tipo}: ${[...new Set(arr.map(p => p.nome))].slice(0, 3).join(', ')}`).join(' | ');
  return `DADOS DE VENDAS (Bling, últimos 60 dias — use pra converter, nunca cite números):
- Cores em alta (preto e bege sempre lideram, então NÃO os cite; foque nestas): ${cores}.
- Mais vendidas por categoria: ${cats}.

ESTRATÉGIA DE CONVERSÃO: priorize sempre responder o que a cliente perguntou. Quando houver abertura (ela respondeu, demonstrou interesse, ou é lead de carrinho), aproveite a mensagem livre pra puxar a venda com UM gancho só, natural, sem empurrar e sem repetir: (a) reforçar um benefício concreto da peça (linho fresco, cai bem, versátil pro dia e pra noite), OU (b) se a cor que ela escolheu estiver entre as cores em alta acima, comentar que tá saindo muito, OU (c) sugerir 1 peça da mesma categoria que está no topo de vendas. Nunca diga que preto ou bege estão em alta. Nunca invente número de vendas. Em contexto de problema, reclamação ou devolução, NÃO tente vender — só ajude.`;
}

export async function contextoCarrinho(telefone, snap) {
  if (!telefone) return '';
  const { data: cart } = await supabase.from('meluni_carrinhos')
    .select('itens').eq('telefone', telefone)
    .not('itens', 'is', null).order('data_carrinho', { ascending: false, nullsFirst: false })
    .limit(1).maybeSingle();
  const itens = Array.isArray(cart?.itens) ? cart.itens.filter(i => i?.sku) : [];
  if (!itens.length) return '';

  const sku = itens[0].sku;
  let ref = null, cor = null;
  const { data: bl } = await supabase.from('bling_estoque').select('ref, cor_label').eq('bling_sku', sku).limit(1).maybeSingle();
  if (bl) { ref = refZ(bl.ref); cor = bl.cor_label || null; }
  if (!ref) {
    const { data: ml } = await supabase.from('ml_sku_ref_map').select('ref').eq('sku', sku).limit(1).maybeSingle();
    if (ml) ref = refZ(ml.ref);
  }
  if (!ref) return '';

  const curados = await nomesCurados();
  const nome = curados.get(ref) || `Ref ${ref}`;
  const tipo = tipoDe(curados.get(ref) || nome);
  const corNorm = semAcc(cor || '').toLowerCase().trim();
  const corAlta = corNorm && (snap?.cores_alta || []).includes(corNorm);
  const mesmaCat = [...new Set(
    (snap?.por_categoria?.[tipo] || []).filter(p => p.ref !== ref).map(p => p.nome)
  )].filter(n => n !== nome).slice(0, 2);

  const linhas = [`CONTEXTO DESTE LEAD (veio de carrinho): peça ${nome}${cor ? `, cor escolhida ${cor}` : ''}.`];
  if (corAlta) linhas.push(`A cor ${cor} está entre as mais vendidas — vale comentar que tá saindo muito.`);
  if (mesmaCat.length) linhas.push(`Se fizer sentido oferecer alternativa da mesma categoria (${tipo}), as mais vendidas são: ${mesmaCat.join(', ')}.`);
  return linhas.join('\n');
}
