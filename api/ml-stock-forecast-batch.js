/**
 * ml-stock-forecast-batch.js — Roda forecast em todos os candidatos
 *                              da fila ml-perguntas-com-cor de uma vez
 *
 * Faz exatamente o que ml-perguntas-com-cor faria + executar o forecast
 * em cada item_id+cor candidato. Output em uma única request.
 */
import { supabase, getValidToken, getStockColors, BRANDS, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const PRAZO_MEDIO_DIAS = 22;
const JANELA_BUSCA_DIAS = 30;

const TODAS_CORES = [
  'preto','preta','bege','figo','marrom','marron','azul marinho','marinho','vinho',
  'branco','branca','off white','off-white','natural','creme','nude',
  'azul','azul claro','azul bebê','azul bebe','azul royal','azul escuro',
  'verde','verde militar','verde oliva','verde menta','verde água','verde agua',
  'rosa','rose','pink','rosê','salmão','salmao','coral',
  'amarelo','mostarda','dourado',
  'vermelho','terracota','tijolo',
  'cinza','grafite','prata',
  'caramelo','cappuccino','chocolate','caqui','areia','marrom escuro',
  'lilás','lilas','roxo','lavanda',
];

function normCor(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function detectSize(t) { const m = String(t || '').match(/\b(PP|P|M|G|GG|G1|G2|G3|XG|XXG|EG|EGG)\b/i); return m ? m[1].toUpperCase() : null; }
function refMatch(a, b) { if (!a || !b) return false; return String(a).replace(/^0+/, '').trim() === String(b).replace(/^0+/, '').trim(); }
function corMatch(corCli, coresArr) {
  const norm = normCor(corCli);
  if (!norm) return null;
  for (const c of (coresArr || [])) {
    const nO = normCor(c.nome);
    if (!nO) continue;
    if (nO === norm || nO.includes(norm) || norm.includes(nO)) return c;
  }
  return null;
}
function extractRefFromCustomField(scf) {
  if (!scf) return null;
  const t = String(scf).trim();
  const m = t.match(/\(\s*(?:ref\s*)?(\d{3,5})\s*\)/i);
  if (m) return String(parseInt(m[1], 10)).padStart(5, '0');
  const m2 = t.match(/^\s*0*(\d{3,5})\s*$/);
  if (m2) return String(parseInt(m2[1], 10)).padStart(5, '0');
  return null;
}

async function runForecast(itemId, cor, tamanho, ailsonCortes) {
  const out = { input: { item_id: itemId, cor, tamanho }, encontrou: false };

  // Pega item ML
  let itemData = null;
  for (const brand of BRANDS) {
    try {
      const token = await getValidToken(brand);
      const r = await fetch(`${ML_API}/items/${itemId}?attributes=id,title,seller_custom_field`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) { itemData = await r.json(); break; }
    } catch {}
  }
  if (!itemData) { out.error = 'item nao encontrado no ML'; return out; }

  out.title = itemData.title;
  out.scf = itemData.seller_custom_field;
  const ref = extractRefFromCustomField(itemData.seller_custom_field);
  out.ref = ref;
  if (!ref) { out.error = 'ref nao extraida'; return out; }

  // Filtra cortes
  const desdeMs = Date.now() - JANELA_BUSCA_DIAS * 86400000;
  const ativos = ailsonCortes.filter(c => {
    if (!c || c.entregue) return false;
    if (!refMatch(c.ref, ref)) return false;
    const dt = new Date(c.data).getTime();
    if (isNaN(dt) || dt < desdeMs) return false;
    return true;
  }).sort((a, b) => new Date(b.data) - new Date(a.data));

  out.cortes_ativos = ativos.length;

  let escolhido = null;
  let semMatriz = 0;
  for (const c of ativos) {
    const det = c.detalhes;
    const temMatriz = det && Array.isArray(det.cores) && det.cores.length > 0;
    if (!temMatriz) { semMatriz++; if (!escolhido) escolhido = { ...c, _confianca: 'baixa' }; continue; }
    const m = corMatch(cor, det.cores);
    if (!m) continue;
    escolhido = { ...c, _confianca: 'alta', _cor_match: m };
    break;
  }
  out.cortes_sem_matriz = semMatriz;

  if (!escolhido) return out;

  out.encontrou = true;
  out.confianca = escolhido._confianca;
  out.corte_id = escolhido.id;
  out.data_corte = escolhido.data;
  out.qtd = escolhido.qtd;
  out.oficina = escolhido.oficina;
  if (escolhido._cor_match) out.cor_match = escolhido._cor_match;

  const dec = Math.floor((Date.now() - new Date(escolhido.data).getTime()) / 86400000);
  const rest = PRAZO_MEDIO_DIAS - dec;
  out.dias_decorridos = dec;
  out.dias_restantes = rest;

  if (rest <= 0) { out.faixa = 'ATRASADO'; out.mensagem_sugerida = null; }
  else if (rest <= 7) {
    out.faixa = 'ATE_7_DIAS';
    out.mensagem_sugerida = `Olá! Boa notícia: este modelo na cor ${escolhido._cor_match?.nome || cor} está em fase final de produção e a previsão é chegar nos próximos dias (até 7 dias). Fique de olho no anúncio que atualizamos assim que estiver disponível!`;
  } else {
    out.faixa = 'PROXIMAS_SEMANAS';
    out.mensagem_sugerida = `Olá! Este modelo na cor ${escolhido._cor_match?.nome || cor} está em produção e deve chegar nas próximas semanas. Fique de olho no anúncio que atualizamos assim que estiver disponível!`;
  }

  return out;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Carrega ailson_cortes 1 vez
  const { data: row } = await supabase.from('amicia_data')
    .select('payload').eq('user_id', 'ailson_cortes').maybeSingle();
  const ailsonCortes = row?.payload?.cortes || [];

  // Pega cores cadastradas
  const stockColors = await getStockColors();
  const stockColorsNomes = stockColors.map(c => c.nome.toLowerCase());

  // Busca últimas 30 perguntas
  const { data: qs } = await supabase.from('ml_pending_questions')
    .select('question_id, brand, item_id, question_text, received_at, status')
    .order('received_at', { ascending: false })
    .limit(30);

  // Identifica candidatas
  const tarefas = [];
  for (const q of (qs || [])) {
    const lower = String(q.question_text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const cores = [];
    for (const c of TODAS_CORES) {
      const cn = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (lower.includes(cn) && !cores.includes(c)) cores.push(c);
    }
    const tam = detectSize(q.question_text);
    const naoStock = cores.filter(c => !stockColorsNomes.some(s => c.includes(s) || s.includes(c)));
    if (naoStock.length === 0) continue;
    // Pega só a cor mais específica (mais longa) pra evitar duplicatas tipo "azul" + "azul claro"
    const corPrincipal = naoStock.sort((a, b) => b.length - a.length)[0];
    tarefas.push({
      brand: q.brand, item_id: q.item_id, question_id: q.question_id,
      pergunta: q.question_text, cor: corPrincipal, tamanho: tam,
    });
  }

  // Roda forecast em paralelo (com cap pra não estourar rate limit)
  const resultados = [];
  for (const t of tarefas) {
    const fc = await runForecast(t.item_id, t.cor, t.tamanho || '', ailsonCortes);
    resultados.push({ ...t, forecast: fc });
  }

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    total_cortes_payload: ailsonCortes.length,
    candidatas: tarefas.length,
    resultados,
  });
}
