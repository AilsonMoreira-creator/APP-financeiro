/**
 * ml-reviews-mlb-map-popular.js — Popula ml_reviews_mlb_map pra Exitus + Muniam
 *
 * Sessao Ailson 15/05/2026 — Sprint 4.1 do projeto Reviews ML.
 *
 * Contexto:
 *   ml_estoque_ref_atual so guarda MLBs Lumia (decisao do ml-estoque-cron pq
 *   Ideris espelha o estoque entre as 3 contas). Mas Exitus e Muniam tem
 *   MLBs PROPRIOS (anuncios diferentes) — esses ficavam orfaos na sync de
 *   reviews. Este endpoint resolve REF deles consultando os mapas globais
 *   ml_sku_ref_map e ml_scf_ref_map, SEM tocar em nada do Bling/Estoque.
 *
 * Fluxo:
 *   1. Carrega mapas globais em memoria (sku_map, scf_map)
 *   2. Pra cada brand alvo (Exitus, Muniam por padrao):
 *      a. Lista MLBs ativos via /users/{seller_id}/items/search
 *      b. Multiget em batches de 20 (/items?ids=...)
 *      c. Pra cada item, resolve REF na ordem:
 *           1) regex no SCF "(02277)" ou "(ref 02851)"
 *           2) SCF numerico puro "02277"
 *           3) scf_map[scf]
 *           4) sku_map[sku] (qualquer variacao)
 *           5) orfao (ref=NULL, registra titulo+thumb pra resolucao manual)
 *      d. UPSERT em batch em ml_reviews_mlb_map
 *
 * MODO MANUAL:
 *   GET /api/ml-reviews-mlb-map-popular?user=ailson
 *   GET /api/ml-reviews-mlb-map-popular?user=ailson&brand=Exitus
 *
 * Idempotente: roda quantas vezes precisar, reaproveita tabela.
 * Custo: 0 (so consulta API ML, sem IA).
 */
import { supabase, getValidToken, BRANDS } from './_ml-helpers.js';

export const config = { maxDuration: 300 };

const ML_API = 'https://api.mercadolibre.com';
const DELAY_MS = 200;
const MULTIGET_BATCH = 20;
const SAFETY_CAP_MLBS = 5000;
const DEFAULT_BRANDS = ['Exitus', 'Muniam'];  // Lumia ja vem via estoque
const ADMINS = ['ailson', 'amicia-admin', 'tamara'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const normRef = (r) => String(r || '').replace(/\D/g, '').replace(/^0+/, '').trim();

// ═════════════════════════════════════════════════════════════════════
// Helpers de extracao (espelham os de ml-estoque-cron pra manter padrao)
// ═════════════════════════════════════════════════════════════════════
function extractSellerSku(attrs) {
  for (const a of (attrs || [])) {
    if (a.id === 'SELLER_SKU') return (a.value_name || '').trim() || null;
  }
  return null;
}

function extrairTodosSkus(item) {
  const skus = [];
  const skuTopo = extractSellerSku(item.attributes);
  if (skuTopo) skus.push(skuTopo);
  for (const v of (item.variations || [])) {
    const skuV = extractSellerSku(v.attributes);
    if (skuV && !skus.includes(skuV)) skus.push(skuV);
  }
  return skus;
}

function resolverRef(item, scfMap, skuMap) {
  const scf = (item.seller_custom_field || '').trim();
  const skus = extrairTodosSkus(item);
  const skuPrim = skus[0] || null;

  // 1) Regex parenteses: "(02277)", "(ref 02851)", "(REF 1500)"
  if (scf) {
    const m = scf.match(/\(\s*(?:ref\s*)?(\d{3,5})\s*\)/i);
    if (m) return { ref: normRef(m[1]), fonte: 'scf_regex', sku_origem: skuPrim, scf_origem: scf };

    // 2) SCF numerico puro: "02277"
    const m2 = scf.match(/^\s*0*(\d{3,5})\s*$/);
    if (m2) return { ref: normRef(m2[1]), fonte: 'scf_numerico', sku_origem: skuPrim, scf_origem: scf };

    // 3) SCF batendo no mapa global
    if (scfMap.has(scf)) {
      return { ref: scfMap.get(scf), fonte: 'scf_map', sku_origem: skuPrim, scf_origem: scf };
    }
  }

  // 4) Qualquer SKU das variacoes bate no mapa global
  for (const sku of skus) {
    if (skuMap.has(sku)) {
      return { ref: skuMap.get(sku), fonte: 'sku_map', sku_origem: sku, scf_origem: scf || null };
    }
  }

  // 5) Orfao remanescente — guarda titulo+thumb pra resolucao manual
  return { ref: null, fonte: 'orfao', sku_origem: skuPrim, scf_origem: scf || null };
}

// ═════════════════════════════════════════════════════════════════════
// Carrega mapas globais em memoria (Map<chave, ref>)
// ═════════════════════════════════════════════════════════════════════
async function carregarMapas() {
  const skuMap = new Map();
  const scfMap = new Map();

  // Pagina ml_sku_ref_map (pode ter 2k+ linhas, paginacao por seguranca)
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('ml_sku_ref_map')
      .select('sku, ref')
      .range(offset, offset + 999);
    if (error) throw new Error('sku_map:' + error.message);
    if (!data || data.length === 0) break;
    for (const r of data) if (r.sku && r.ref) skuMap.set(r.sku, r.ref);
    if (data.length < 1000) break;
    offset += 1000;
  }

  const { data: scfRows, error: errScf } = await supabase
    .from('ml_scf_ref_map')
    .select('scf, ref');
  if (errScf) throw new Error('scf_map:' + errScf.message);
  for (const r of (scfRows || [])) if (r.scf && r.ref) scfMap.set(r.scf, r.ref);

  return { skuMap, scfMap };
}

// ═════════════════════════════════════════════════════════════════════
// Lista TODOS MLBs ativos de um seller
// ═════════════════════════════════════════════════════════════════════
async function fetchAllActiveItems(sellerId, token) {
  const ids = [];
  let offset = 0;
  while (offset < SAFETY_CAP_MLBS) {
    const r = await fetch(
      `${ML_API}/users/${sellerId}/items/search?status=active&offset=${offset}&limit=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) {
      console.error(`[mlb-map-popular] items/search HTTP ${r.status}`);
      break;
    }
    const d = await r.json();
    const results = d.results || [];
    if (results.length === 0) break;
    ids.push(...results);
    const total = d.paging?.total || 0;
    if (ids.length >= total || results.length < 100) break;
    offset += 100;
    await sleep(DELAY_MS);
  }
  return ids;
}

// ═════════════════════════════════════════════════════════════════════
// Multiget — pega detalhes de um batch de MLBs
// ═════════════════════════════════════════════════════════════════════
async function multiget(ids, token) {
  const url = `${ML_API}/items?ids=${ids.join(',')}&attributes=id,title,thumbnail,seller_custom_field,attributes,variations`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    console.warn(`[mlb-map-popular] multiget HTTP ${r.status}`);
    return [];
  }
  const arr = await r.json();
  const items = [];
  for (const entry of arr) {
    if (entry?.code === 200 && entry?.body) items.push(entry.body);
  }
  return items;
}

// ═════════════════════════════════════════════════════════════════════
// Processa UMA brand inteira
// ═════════════════════════════════════════════════════════════════════
async function processarBrand(brand, mapas) {
  const stats = {
    brand,
    mlbs_listados: 0,
    multiget_ok: 0,
    resolvidos_scf_regex: 0,
    resolvidos_scf_numerico: 0,
    resolvidos_scf_map: 0,
    resolvidos_sku_map: 0,
    orfaos: 0,
    refs_novas: new Set(),
    erros: 0,
  };

  let token, sellerId;
  try {
    token = await getValidToken(brand);
    const { data: tokRec } = await supabase
      .from('ml_tokens').select('seller_id').eq('brand', brand).single();
    sellerId = tokRec?.seller_id;
    if (!sellerId) throw new Error(`${brand} sem seller_id em ml_tokens`);
  } catch (e) {
    console.error(`[mlb-map-popular] auth ${brand}:`, e.message);
    stats.erros++;
    stats.erro_auth = e.message;
    return stats;
  }

  const mlbs = await fetchAllActiveItems(sellerId, token);
  stats.mlbs_listados = mlbs.length;

  const rowsParaUpsert = [];

  for (let i = 0; i < mlbs.length; i += MULTIGET_BATCH) {
    const batch = mlbs.slice(i, i + MULTIGET_BATCH);
    try {
      const items = await multiget(batch, token);
      stats.multiget_ok += items.length;

      for (const item of items) {
        const resolucao = resolverRef(item, mapas.scfMap, mapas.skuMap);
        rowsParaUpsert.push({
          mlb_id: item.id,
          brand,
          ref: resolucao.ref,
          sku_origem: resolucao.sku_origem,
          scf_origem: resolucao.scf_origem,
          fonte: resolucao.fonte,
          titulo: item.title || null,
          thumbnail: item.thumbnail || null,
          atualizado_em: new Date().toISOString(),
        });

        if (resolucao.fonte === 'scf_regex') stats.resolvidos_scf_regex++;
        else if (resolucao.fonte === 'scf_numerico') stats.resolvidos_scf_numerico++;
        else if (resolucao.fonte === 'scf_map') stats.resolvidos_scf_map++;
        else if (resolucao.fonte === 'sku_map') stats.resolvidos_sku_map++;
        else if (resolucao.fonte === 'orfao') stats.orfaos++;

        if (resolucao.ref) stats.refs_novas.add(resolucao.ref);
      }
    } catch (e) {
      stats.erros++;
      console.warn(`[mlb-map-popular] batch ${brand} #${i}:`, e.message);
    }
    await sleep(DELAY_MS);
  }

  // UPSERT em chunks de 500 pra nao explodir payload
  for (let i = 0; i < rowsParaUpsert.length; i += 500) {
    const chunk = rowsParaUpsert.slice(i, i + 500);
    const { error } = await supabase
      .from('ml_reviews_mlb_map')
      .upsert(chunk, { onConflict: 'mlb_id' });
    if (error) {
      console.error('[mlb-map-popular] upsert:', error.message);
      stats.erros++;
    }
  }

  stats.refs_novas = stats.refs_novas.size;  // serializa pra resposta
  stats.resolvidos_total = stats.resolvidos_scf_regex + stats.resolvidos_scf_numerico
                        + stats.resolvidos_scf_map + stats.resolvidos_sku_map;
  stats.taxa_cobertura = stats.multiget_ok > 0
    ? Math.round((stats.resolvidos_total / stats.multiget_ok) * 100) + '%'
    : 'n/a';

  return stats;
}

// ═════════════════════════════════════════════════════════════════════
// HANDLER
// ═════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth admin
  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  const userId = req.query?.user || req.headers['x-user'];
  const ehAdmin = ADMINS.includes(userId);
  if (!ehCron && !ehAdmin) {
    return res.status(403).json({
      error: 'Apenas cron ou admin',
      uso_manual: '/api/ml-reviews-mlb-map-popular?user=ailson',
      uso_por_brand: '/api/ml-reviews-mlb-map-popular?user=ailson&brand=Exitus',
    });
  }

  const tInicio = Date.now();
  const brandFiltro = req.query?.brand;
  const brandsAlvo = brandFiltro
    ? [brandFiltro]
    : DEFAULT_BRANDS.filter(b => BRANDS.includes(b));

  // Health log
  let healthId = null;
  try {
    const { data: hl } = await supabase
      .from('lojas_cron_health')
      .insert({
        cron_name: 'ml-reviews-mlb-map-popular',
        origem: ehCron ? 'vercel-cron' : 'manual-admin',
        user_agent: userAgent,
        triggered_by: userId || 'vercel',
        status: 'iniciada',
      })
      .select('id').single();
    healthId = hl?.id || null;
  } catch {}

  const finalizar = async (status, detalhes = {}) => {
    if (!healthId) return;
    try {
      await supabase.from('lojas_cron_health').update({
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - tInicio,
        status,
        ...detalhes,
      }).eq('id', healthId);
    } catch {}
  };

  try {
    const mapas = await carregarMapas();
    const sizes = { sku_map_carregado: mapas.skuMap.size, scf_map_carregado: mapas.scfMap.size };

    const resultados = [];
    for (const brand of brandsAlvo) {
      console.log(`[mlb-map-popular] === ${brand} ===`);
      const stats = await processarBrand(brand, mapas);
      resultados.push(stats);
    }

    const totalMlbs = resultados.reduce((s, r) => s + (r.multiget_ok || 0), 0);
    const totalResolvidos = resultados.reduce((s, r) => s + (r.resolvidos_total || 0), 0);
    const totalOrfaos = resultados.reduce((s, r) => s + (r.orfaos || 0), 0);

    await finalizar('sucesso', {
      detalhes: {
        ...sizes,
        brands_alvo: brandsAlvo,
        total_mlbs_processados: totalMlbs,
        total_resolvidos: totalResolvidos,
        total_orfaos: totalOrfaos,
        por_brand: resultados,
      },
    });

    return res.json({
      ok: true,
      duracao_ms: Date.now() - tInicio,
      ...sizes,
      brands_alvo: brandsAlvo,
      total_mlbs_processados: totalMlbs,
      total_resolvidos: totalResolvidos,
      total_orfaos: totalOrfaos,
      taxa_cobertura_global: totalMlbs > 0 ? Math.round((totalResolvidos / totalMlbs) * 100) + '%' : 'n/a',
      por_brand: resultados,
    });
  } catch (e) {
    console.error('[mlb-map-popular]', e);
    await finalizar('erro', { erro_msg: e.message });
    return res.status(500).json({ error: e.message });
  }
}
