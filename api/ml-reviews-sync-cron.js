/**
 * ml-reviews-sync-cron.js — Coleta automatica de reviews do Mercado Livre
 *
 * Sessao Ailson 14/05/2026 — Sprint 1 do sistema de Inteligencia de Reviews.
 *
 * Schedule: 0 6 * * * (03:00 BRT, diario)
 *
 * O QUE FAZ:
 *   1. Pra cada brand (Exitus, Lumia, Muniam):
 *      - Pega access_token valido + seller_id de ml_tokens
 *      - Lista TODOS anuncios ativos via /users/{sellerId}/items/search
 *      - Pra cada MLB ativo, pega reviews via /reviews/item/{mlb}
 *   2. Resolve REF Amicia via ml_reviews_resolver_ref(mlb)
 *      - MLB orfao (sem REF): pula silenciosamente conforme decisao Ailson
 *   3. UPSERT em ml_reviews por review_id (idempotente)
 *
 * MODO MANUAL — carga historica:
 *   GET /api/ml-reviews-sync-cron?user=ailson&force_full=1
 *   - Varre TODAS reviews historicas (paginacao completa)
 *   - Pode levar ~10min se tiver muitos reviews acumulados
 *
 * MODO PADRAO (cron diario):
 *   - So as primeiras 2 paginas de cada MLB (50 reviews mais recentes)
 *   - Idempotente — se review ja existe, atualiza valorization
 *
 * Logging: lojas_cron_health (mesma tabela dos outros crons).
 */
import { supabase, getValidToken, BRANDS } from './_ml-helpers.js';

export const config = { maxDuration: 800 };

const ML_API = 'https://api.mercadolibre.com';
const DELAY_MS = 80;                  // entre requests pra respeitar rate limit
const REVIEWS_PER_PAGE = 50;          // max permitido pelo ML
const SAFETY_CAP_PAGES_FULL = 100;    // max paginas por MLB no modo full
const SAFETY_CAP_PAGES_DAILY = 2;     // modo diario: so 100 reviews mais recentes
const SAFETY_CAP_MLBS = 5000;         // por brand

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ═════════════════════════════════════════════════════════════════════
// Lista TODOS itens ativos de um seller (paginacao)
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
      console.error(`[reviews-cron] items/search HTTP ${r.status}`);
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
// Pega reviews de um MLB (com paginacao)
// ═════════════════════════════════════════════════════════════════════
async function fetchReviewsForItem(mlb, token, maxPages) {
  const reviews = [];
  let offset = 0;
  let page = 0;
  while (page < maxPages) {
    const url = `${ML_API}/reviews/item/${mlb}?offset=${offset}&limit=${REVIEWS_PER_PAGE}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      // Alguns MLBs nao tem endpoint de reviews ativo (anuncios novos)
      // 404 e normal — silencia
      if (r.status !== 404) {
        console.warn(`[reviews-cron] /reviews/item/${mlb} HTTP ${r.status}`);
      }
      break;
    }
    const d = await r.json();
    const batch = d.reviews || [];
    if (batch.length === 0) break;
    reviews.push(...batch);
    const total = d.paging?.total || 0;
    if (reviews.length >= total || batch.length < REVIEWS_PER_PAGE) break;
    offset += REVIEWS_PER_PAGE;
    page++;
    await sleep(DELAY_MS);
  }
  return reviews;
}

// ═════════════════════════════════════════════════════════════════════
// Resolve MLB → REF via funcao SQL
// ═════════════════════════════════════════════════════════════════════
async function resolverRef(mlb) {
  const { data } = await supabase.rpc('ml_reviews_resolver_ref', { p_mlb: mlb });
  return data || null;
}

// ═════════════════════════════════════════════════════════════════════
// Salva reviews em ml_reviews (UPSERT por review_id)
// ═════════════════════════════════════════════════════════════════════
async function upsertReviews(reviewsArr, mlb, brand, refAmicia) {
  if (!reviewsArr || reviewsArr.length === 0) return 0;
  
  const rows = reviewsArr.map(r => ({
    review_id: String(r.id),
    mlb_id: mlb,
    brand,
    ref_amicia: refAmicia,
    rating: Number(r.rate) || 0,
    title: r.title || null,
    content: r.content || null,
    buying_date: r.buying_date || r.date_created || null,
    valorization: r.valorization || 0,
  }));
  
  // Idempotente: upsert por review_id (UNIQUE constraint)
  const { error } = await supabase
    .from('ml_reviews')
    .upsert(rows, { onConflict: 'review_id', ignoreDuplicates: false });
  
  if (error) {
    console.error('[reviews-cron] upsert erro:', error.message);
    return 0;
  }
  return rows.length;
}

// ═════════════════════════════════════════════════════════════════════
// Processa UMA brand inteira
// ═════════════════════════════════════════════════════════════════════
async function processarBrand(brand, modoFull) {
  const stats = {
    brand,
    mlbs_listados: 0,
    mlbs_processados: 0,
    mlbs_com_ref: 0,
    mlbs_orfaos: 0,
    reviews_coletados: 0,
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
    console.error(`[reviews-cron] auth ${brand}:`, e.message);
    stats.erros++;
    stats.erro_auth = e.message;
    return stats;
  }
  
  const mlbs = await fetchAllActiveItems(sellerId, token);
  stats.mlbs_listados = mlbs.length;
  
  const maxPages = modoFull ? SAFETY_CAP_PAGES_FULL : SAFETY_CAP_PAGES_DAILY;
  
  for (const mlb of mlbs) {
    try {
      // Resolve REF — se orfao, pula
      const ref = await resolverRef(mlb);
      if (!ref) {
        stats.mlbs_orfaos++;
        continue;
      }
      stats.mlbs_com_ref++;
      
      const reviews = await fetchReviewsForItem(mlb, token, maxPages);
      const salvos = await upsertReviews(reviews, mlb, brand, ref);
      stats.reviews_coletados += salvos;
      stats.mlbs_processados++;
      
      await sleep(DELAY_MS);
    } catch (e) {
      stats.erros++;
      console.warn(`[reviews-cron] ${brand}/${mlb}:`, e.message);
    }
  }
  
  return stats;
}

// ═════════════════════════════════════════════════════════════════════
// HANDLER
// ═════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  // CORS basico
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Auth: cron Vercel ou admin
  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  const userId = req.query?.user || req.headers['x-user'];
  const ehAdmin = userId === 'ailson' || userId === 'amicia-admin' || userId === 'tamara';
  if (!ehCron && !ehAdmin) {
    return res.status(403).json({
      error: 'Apenas cron Vercel ou admin',
      uso_manual: '/api/ml-reviews-sync-cron?user=ailson',
      carga_historica: '/api/ml-reviews-sync-cron?user=ailson&force_full=1',
    });
  }
  
  const modoFull = req.query?.force_full === '1';
  const brandFiltro = req.query?.brand;  // opcional: testar 1 brand so
  const tInicio = Date.now();
  
  // Log inicial
  let healthId = null;
  try {
    const { data: hl } = await supabase
      .from('lojas_cron_health')
      .insert({
        cron_name: 'ml-reviews-sync-cron',
        origem: ehCron ? 'vercel-cron' : 'manual-admin',
        user_agent: userAgent,
        triggered_by: userId || 'vercel',
        status: 'iniciada',
      })
      .select('id').single();
    healthId = hl?.id || null;
  } catch (e) {
    console.warn('[reviews-cron] health insert:', e?.message);
  }
  
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
    const brands = brandFiltro ? [brandFiltro] : BRANDS;
    const resultados = [];
    
    for (const brand of brands) {
      console.log(`[reviews-cron] === ${brand} ${modoFull ? '(FULL)' : '(daily)'} ===`);
      const stats = await processarBrand(brand, modoFull);
      resultados.push(stats);
    }
    
    const totalReviews = resultados.reduce((s, r) => s + r.reviews_coletados, 0);
    const totalMlbs = resultados.reduce((s, r) => s + r.mlbs_processados, 0);
    
    await finalizar('sucesso', {
      detalhes: {
        modo: modoFull ? 'force_full' : 'daily',
        total_reviews_coletados: totalReviews,
        total_mlbs_processados: totalMlbs,
        por_brand: resultados,
      },
    });
    
    return res.json({
      ok: true,
      duracao_ms: Date.now() - tInicio,
      modo: modoFull ? 'force_full' : 'daily',
      total_reviews_coletados: totalReviews,
      total_mlbs_processados: totalMlbs,
      por_brand: resultados,
    });
  } catch (e) {
    console.error('[reviews-cron]', e);
    await finalizar('erro', { erro_msg: e.message });
    return res.status(500).json({ error: e.message });
  }
}
