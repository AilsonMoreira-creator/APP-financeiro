/**
 * ml-reviews-mlb-deep-fetch.js — Deep fetch CIRURGICO de 1 MLB
 *
 * Sessao Ailson 16/05/2026 — investigar gap de 1069 reviews em
 * MLB3780164715 (987 coletadas vs 2056 na API ML).
 *
 * Uso:
 *   GET /api/ml-reviews-mlb-deep-fetch?user=ailson&mlb=MLB3780164715&max_pages=50&persist=1
 *
 * Pra cada pagina (offset 0, 50, 100, ...) loga:
 *   - HTTP status
 *   - paging.total reportado pela API
 *   - batch length (quantas reviews vieram)
 *   - sample.first review_id e buying_date
 *   - sample.last review_id e buying_date
 *
 * Se persist=1, faz UPSERT no ml_reviews (igual sync). Senao so investiga.
 *
 * Custo: zero (so consulta API ML). Tempo: ~maxpages * 100ms.
 */
import { supabase, getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 300 };

const ML_API = 'https://api.mercadolibre.com';
const PER_PAGE = 50;
const DELAY_MS = 120;
const ADMINS = ['ailson', 'amicia-admin', 'tamara'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query?.user || req.headers['x-user'];
  if (!ADMINS.includes(userId)) {
    return res.status(403).json({ error: 'Apenas admin' });
  }

  const mlb = req.query?.mlb;
  const maxPages = Math.min(parseInt(req.query?.max_pages || '50', 10), 100);
  const persist = req.query?.persist === '1';

  if (!mlb) return res.status(400).json({ error: 'Passe ?mlb=MLB...' });

  // Pega brand do map
  const { data: mapRow } = await supabase
    .from('ml_reviews_mlb_map')
    .select('brand, ref')
    .eq('mlb_id', mlb)
    .maybeSingle();

  if (!mapRow) return res.status(404).json({ error: 'MLB nao mapeado' });

  let token;
  try { token = await getValidToken(mapRow.brand); }
  catch (e) { return res.status(500).json({ error: 'Token: ' + e.message }); }

  const paginas = [];
  const todosReviews = []; // pra deduplicar e persistir
  const reviewIdsVistos = new Set();
  let totalReportado = null;
  let pararPorVazio = false;
  let pararPorBatchPequeno = false;
  let pararPorHttpErro = false;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * PER_PAGE;
    const url = `${ML_API}/reviews/item/${mlb}?offset=${offset}&limit=${PER_PAGE}`;
    let httpStatus = null;
    let batchLen = 0;
    let total = null;
    let firstSample = null;
    let lastSample = null;
    let novosUnicos = 0;

    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      httpStatus = r.status;
      if (r.ok) {
        const d = await r.json();
        const batch = d.reviews || [];
        batchLen = batch.length;
        total = d.paging?.total || null;
        if (totalReportado === null) totalReportado = total;

        if (batch.length > 0) {
          firstSample = {
            review_id: String(batch[0].id),
            buying_date: batch[0].buying_date || batch[0].date_created,
          };
          lastSample = {
            review_id: String(batch[batch.length - 1].id),
            buying_date: batch[batch.length - 1].buying_date || batch[batch.length - 1].date_created,
          };
          for (const rev of batch) {
            const rid = String(rev.id);
            if (!reviewIdsVistos.has(rid)) {
              reviewIdsVistos.add(rid);
              novosUnicos++;
              todosReviews.push(rev);
            }
          }
        }
      }
    } catch (e) {
      httpStatus = -1;
      paginas.push({ page, offset, erro: e.message });
      pararPorHttpErro = true;
      break;
    }

    paginas.push({ page, offset, http: httpStatus, total, batch_len: batchLen, novos_unicos: novosUnicos, first: firstSample, last: lastSample });

    if (!httpStatus || httpStatus >= 400) { pararPorHttpErro = true; break; }
    if (batchLen === 0) { pararPorVazio = true; break; }
    if (batchLen < PER_PAGE) { pararPorBatchPequeno = true; break; }

    await sleep(DELAY_MS);
  }

  // Persiste se pedido
  let upsertResult = null;
  if (persist && todosReviews.length > 0) {
    const rows = todosReviews.map(r => ({
      review_id: String(r.id),
      mlb_id: mlb,
      brand: mapRow.brand,
      ref_amicia: mapRow.ref,
      rating: Number(r.rate) || 0,
      title: r.title || null,
      content: r.content || null,
      buying_date: r.buying_date || r.date_created || null,
      valorization: r.valorization || 0,
    }));
    const { error } = await supabase
      .from('ml_reviews')
      .upsert(rows, { onConflict: 'review_id', ignoreDuplicates: false });
    upsertResult = error ? { erro: error.message } : { ok: true, qtd: rows.length };
  }

  // Comparativo local
  const { count: localAposCount } = await supabase
    .from('ml_reviews')
    .select('*', { count: 'exact', head: true })
    .eq('mlb_id', mlb);

  return res.json({
    ok: true,
    mlb,
    brand: mapRow.brand,
    ref: mapRow.ref,
    persist,
    total_reportado_api: totalReportado,
    paginas_processadas: paginas.length,
    reviews_unicos_coletados: todosReviews.length,
    parou_por: pararPorVazio ? 'batch_vazio'
              : pararPorBatchPequeno ? 'batch_pequeno_fim_normal'
              : pararPorHttpErro ? 'http_erro'
              : 'max_pages',
    reviews_local_apos: localAposCount,
    upsert_result: upsertResult,
    paginas,
  });
}
