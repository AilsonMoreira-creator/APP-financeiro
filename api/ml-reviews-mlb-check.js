/**
 * ml-reviews-mlb-check.js — Diagnostico por MLB: bate na API ML
 * e compara com o que temos em ml_reviews.
 *
 * Uso:
 *   GET /api/ml-reviews-mlb-check?user=ailson&ref=2277
 *   GET /api/ml-reviews-mlb-check?user=ailson&mlb=MLB5434196096,MLB1234
 *
 * Pra cada MLB retorna:
 *   - status do anuncio no ML (active/paused/closed)
 *   - qtd_reviews_ml (paging.total da API)
 *   - qtd_reviews_local (no nosso ml_reviews)
 *   - gap (delta entre ML e local)
 *   - http (codigo do status da chamada)
 *
 * Sessao Ailson 16/05/2026 — Sprint 6 Reviews ML.
 */
import { supabase, getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 120 };

const ML_API = 'https://api.mercadolibre.com';
const DELAY_MS = 100;
const ADMINS = ['ailson', 'amicia-admin', 'tamara'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query?.user || req.headers['x-user'];
  if (!ADMINS.includes(userId)) {
    return res.status(403).json({ error: 'Apenas admin' });
  }

  const ref = req.query?.ref;
  const mlbsParam = req.query?.mlb;

  // Monta lista de MLBs a checar
  let alvos = [];
  if (ref) {
    const { data, error } = await supabase
      .from('ml_reviews_mlb_map')
      .select('mlb_id, brand, ref, titulo, fonte')
      .eq('ref', ref);
    if (error) return res.status(500).json({ error: error.message });
    alvos = data || [];
  } else if (mlbsParam) {
    const ids = String(mlbsParam).split(',').map(s => s.trim()).filter(Boolean);
    const { data, error } = await supabase
      .from('ml_reviews_mlb_map')
      .select('mlb_id, brand, ref, titulo, fonte')
      .in('mlb_id', ids);
    if (error) return res.status(500).json({ error: error.message });
    alvos = data || [];
    // Se algum MLB nao estiver no map, adiciona com brand=null
    const encontrados = new Set(alvos.map(a => a.mlb_id));
    for (const id of ids) {
      if (!encontrados.has(id)) alvos.push({ mlb_id: id, brand: null, ref: null, titulo: null, fonte: 'NAO_MAPEADO' });
    }
  } else {
    return res.status(400).json({
      error: 'Passe ?ref=XXXX ou ?mlb=MLB1,MLB2',
    });
  }

  if (alvos.length === 0) {
    return res.json({ ok: true, qtd: 0, resultados: [] });
  }

  // Cache de tokens por brand
  const tokens = {};
  async function getToken(brand) {
    if (!brand) return null;
    if (!tokens[brand]) {
      try { tokens[brand] = await getValidToken(brand); }
      catch { tokens[brand] = null; }
    }
    return tokens[brand];
  }

  const resultados = [];

  for (const a of alvos) {
    const out = {
      mlb_id: a.mlb_id,
      brand: a.brand,
      ref: a.ref,
      titulo: a.titulo,
      fonte_map: a.fonte,
    };

    // Reviews ja coletadas localmente
    const { count: localCount } = await supabase
      .from('ml_reviews')
      .select('*', { count: 'exact', head: true })
      .eq('mlb_id', a.mlb_id);
    out.reviews_local = localCount || 0;

    const token = await getToken(a.brand);
    if (!token) {
      out.erro = 'Sem token p/ brand ' + a.brand;
      resultados.push(out);
      continue;
    }

    // 1) Status do anuncio
    try {
      const itemR = await fetch(
        `${ML_API}/items/${a.mlb_id}?attributes=status,sold_quantity,available_quantity,date_created,last_updated,permalink`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      out.item_http = itemR.status;
      if (itemR.ok) {
        const item = await itemR.json();
        out.status_ml = item.status;
        out.sold_quantity = item.sold_quantity;
        out.available_quantity = item.available_quantity;
        out.criado_em = item.date_created;
        out.permalink = item.permalink;
      }
    } catch (e) {
      out.erro_item = e.message;
    }

    // 2) Reviews via API
    try {
      const revR = await fetch(
        `${ML_API}/reviews/item/${a.mlb_id}?limit=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      out.reviews_http = revR.status;
      if (revR.ok) {
        const d = await revR.json();
        out.reviews_ml = d.paging?.total || 0;
        out.gap = (out.reviews_ml || 0) - (out.reviews_local || 0);
      }
    } catch (e) {
      out.erro_reviews = e.message;
    }

    resultados.push(out);
    await sleep(DELAY_MS);
  }

  // Agregados
  const totalML = resultados.reduce((s, r) => s + (r.reviews_ml || 0), 0);
  const totalLocal = resultados.reduce((s, r) => s + (r.reviews_local || 0), 0);

  return res.json({
    ok: true,
    qtd_mlbs: resultados.length,
    total_reviews_ml: totalML,
    total_reviews_local: totalLocal,
    gap_total: totalML - totalLocal,
    resultados,
  });
}
