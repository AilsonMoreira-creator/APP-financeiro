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

  const skus = [...new Set(itens.map(i => i.sku))];
  const { data: estoque } = await supabase.from('bling_estoque')
    .select('bling_sku, ref, cor_label, tam, qtd').in('bling_sku', skus);
  const estBySku = new Map((estoque || []).map(r => [r.bling_sku, r]));

  const curados = await nomesCurados();

  // item principal (1o) -> contexto de cor alta / alternativas
  const sku = itens[0].sku;
  const b0 = estBySku.get(sku) || null;
  let ref = b0 ? refZ(b0.ref) : null, cor = b0?.cor_label || null;
  if (!ref) {
    const { data: ml } = await supabase.from('ml_sku_ref_map').select('ref').eq('sku', sku).limit(1).maybeSingle();
    if (ml) ref = refZ(ml.ref);
  }
  if (!ref) return '';

  const nome = curados.get(ref) || `Ref ${ref}`;
  const tipo = tipoDe(curados.get(ref) || nome);
  const corNorm = semAcc(cor || '').toLowerCase().trim();
  const corAlta = corNorm && (snap?.cores_alta || []).includes(corNorm);
  const mesmaCat = [...new Set(
    (snap?.por_categoria?.[tipo] || []).filter(p => p.ref !== ref).map(p => p.nome)
  )].filter(n => n !== nome).slice(0, 2);

  const linhas = [`CONTEXTO DESTE LEAD (veio de carrinho): peça ${nome}${cor ? `, cor escolhida ${cor}` : ''}.`];
  if (corAlta) linhas.push(`A cor ${cor} está entre as mais vendidas, vale comentar que tá saindo muito.`);
  if (mesmaCat.length) linhas.push(`Se fizer sentido oferecer alternativa da mesma categoria (${tipo}), as mais vendidas são: ${mesmaCat.join(', ')}.`);

  // ESTOQUE (Bling) por peça/cor/tamanho do carrinho
  const estLinhas = [];
  for (const it of itens.slice(0, 5)) {
    const b = estBySku.get(it.sku);
    if (!b) continue;
    const nm = curados.get(refZ(b.ref)) || `Ref ${refZ(b.ref)}`;
    const partes = [nm];
    if (b.cor_label) partes.push(`cor ${b.cor_label}`);
    if (b.tam) partes.push(`tam ${b.tam}`);
    const q = Number(b.qtd) || 0;
    estLinhas.push(`- ${partes.join(', ')}: ${q > 0 ? `${q} em estoque` : 'esgotado no Bling'}`);
  }
  if (estLinhas.length) {
    linhas.push(`\nESTOQUE (Bling = fonte de verdade do estoque; o site é atualizado na mão e pode estar errado):\n${estLinhas.join('\n')}`);
  }

  return linhas.join('\n');
}


// ── Cliente colou link do site? extrai a REF (dígitos no fim do último -segmento)
// e monta bloco ESTOQUE dessa peça (só cores/tam com saldo). Lara usa SÓ se a
// cliente perguntar (não despeja). Ailson 04/07/2026.
export async function contextoLinkProduto(msgs) {
  if (!Array.isArray(msgs) || !msgs.length) return '';
  const linkRe = /meluniloja\.com\.br\/([^\s/?#]+)/i;
  let ref = null, corLink = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.direcao !== 'entrada') continue;              // só mensagens da cliente
    const mm = (m.texto || '').match(linkRe);
    if (!mm) continue;
    const last = (mm[1].split('-').pop() || '');        // ex: azulmarinho2790
    const refM = last.match(/(\d+)$/);                  // dígitos no fim
    if (!refM) continue;
    ref = refZ(refM[1]);                                // 2790
    corLink = last.slice(0, last.length - refM[1].length) || null; // azulmarinho
    break;                                              // link mais recente
  }
  if (!ref) return '';

  const { data: est } = await supabase.from('bling_estoque')
    .select('cor_label, tam, qtd').eq('ref', ref);
  if (!est || !est.length) return '';

  const ordemTam = { P: 1, M: 2, G: 3, GG: 4, G1: 5, G2: 6, G3: 7 };
  const porCor = new Map();
  for (const r of est) {
    if (!r.cor_label || (Number(r.qtd) || 0) <= 0) continue;
    const k = r.cor_label.trim();
    if (!porCor.has(k)) porCor.set(k, new Set());
    if (r.tam) porCor.get(k).add(r.tam);
  }

  const curados = await nomesCurados();
  const nome = curados.get(ref) || 'essa peça';

  if (!porCor.size) {
    return `\nPEÇA DO LINK QUE A CLIENTE MANDOU: ${nome}. No momento está esgotada em todas as cores/tamanhos (fonte: Bling). USE SÓ SE a cliente perguntar sobre disponibilidade dessa peça: aí use a reposição padrão, sem prometer data. NUNCA fale de estoque/cor/tamanho sem ela perguntar.`;
  }

  const corLinkNorm = corLink ? semAcc(corLink).toLowerCase().replace(/[^a-z]/g, '') : null;
  let corLinkLabel = null;
  for (const c of porCor.keys()) {
    if (corLinkNorm && semAcc(c).toLowerCase().replace(/[^a-z]/g, '') === corLinkNorm) { corLinkLabel = c; break; }
  }

  const linhas = [];
  for (const [cor, tams] of porCor) {
    const ord = [...tams].sort((a, b) => (ordemTam[a] || 9) - (ordemTam[b] || 9));
    linhas.push(`- ${cor}: ${ord.join(', ')}`);
  }

  const cab = `PEÇA DO LINK QUE A CLIENTE MANDOU: ${nome}${corLinkLabel ? ` (a cor do link é ${corLinkLabel})` : ''}. Fonte de verdade = Bling; o site é atualizado na mão e pode estar errado. NÃO cite número interno de referência pra cliente.`;
  const corpo = `ESTOQUE dessa peça (só cores/tamanhos COM saldo; o que NÃO aparecer aqui está esgotado):\n${linhas.join('\n')}`;
  const regra = `USE ISSO SÓ SE a cliente perguntar sobre tamanho, cor ou disponibilidade dessa peça. NUNCA liste cores/tamanhos por conta própria, espere a pergunta. Tradução: 44=GG, 42=G, 40=M, 38=P. Se a cor que ela quer estiver esgotada, ofereça as outras cores que têm saldo.`;
  return `\n${cab}\n${corpo}\n${regra}`;
}
