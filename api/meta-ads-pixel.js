/**
 * meta-ads-pixel.js — Proxy autenticado pra endpoints de DATASET (pixel)
 * da Meta Marketing API.
 *
 * Complementa o /api/meta-ads-analise (que cobre insights de conta).
 *
 * Query params:
 *   pixel_id    — id do dataset/pixel. Allowlist abaixo.
 *   action      — 'stats' | 'details' | 'quality'  (default: stats)
 *   since       — ISO datetime ou unix timestamp em segundos (default: 24h atrás)
 *   until       — ISO datetime ou unix timestamp (default: agora)
 *   aggregation — 'event' | 'event_total_counts' | 'device_type' | 'event_source' (default: event)
 *
 * Segurança: allowlist hardcoded de pixels do business amicia.fashion.
 * Cache 3min (mais curto que /analise pra dar tempo real em validações).
 *
 * Sessão Ailson 18-19/05/2026 — validação separação pixels Convertr.
 */
import { setCors } from './_lojas-helpers.js';

const META_API_VERSION = 'v21.0';

// Allowlist: 6 pixels do business amicia.fashion (1100759877135589)
const PIXELS_VALIDOS = {
  '1313157280657207': 'Pixel Site Meluni B2C - Vesti (NOME ERRADO, é Convertr)',
  '1376423864502942': 'Pixel Site Amicia B2B - Convertr (NOME ERRADO, é Vesti+Convertr misturado)',
  '1926708664633242': 'Pixel Amicia - Vesti (parado desde 08/04)',
  '658719401878236':  'Pixel Amicia - Convertr (parado desde abr/2022)',
  '1909956539191797': 'Pixel - Amicia Fashion - Site Oficial',
  '984739628818257':  'Amícia [Eventos Offline] (parado desde abr/2022)',
};

const ACTIONS_VALIDAS = ['stats', 'details', 'quality'];
const AGGREGATIONS_VALIDAS = ['event', 'event_total_counts', 'device_type', 'event_source', 'url', 'host'];
const CACHE_TTL_MS = 3 * 60 * 1000;
const cache = new Map();

function parseTimestamp(s) {
  if (!s) return null;
  // unix seconds? (10 dígitos)
  if (/^\d{10}$/.test(s)) return parseInt(s, 10);
  // unix ms? (13 dígitos)
  if (/^\d{13}$/.test(s)) return Math.floor(parseInt(s, 10) / 1000);
  // ISO?
  const t = new Date(s).getTime();
  if (isNaN(t)) return null;
  return Math.floor(t / 1000);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const META_ADS_TOKEN = process.env.META_ADS_TOKEN;
  if (!META_ADS_TOKEN) {
    return res.status(500).json({ error: 'META_ADS_TOKEN ausente nas env vars' });
  }

  const {
    pixel_id,
    action = 'stats',
    since,
    until,
    aggregation = 'event',
    event_name,
    event_source,
  } = req.query;

  if (!pixel_id || !PIXELS_VALIDOS[pixel_id]) {
    return res.status(400).json({
      error: 'pixel_id inválido ou fora da allowlist',
      pixels_validos: PIXELS_VALIDOS,
    });
  }

  if (!ACTIONS_VALIDAS.includes(action)) {
    return res.status(400).json({
      error: 'action inválida',
      validas: ACTIONS_VALIDAS,
    });
  }

  // Cache check
  const cacheKey = `${pixel_id}|${action}|${since || ''}|${until || ''}|${aggregation}|${event_name || ''}|${event_source || ''}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.status(200).json({
      ...cached.data,
      _cached: true,
      _cache_age_seconds: Math.floor((Date.now() - cached.timestamp) / 1000),
    });
  }

  let url;
  try {
    if (action === 'details') {
      url = `https://graph.facebook.com/${META_API_VERSION}/${pixel_id}?` +
        `fields=name,id,creation_time,is_active,last_fired_time,server_last_fired_time,business,data_use_setting,first_party_cookie_status` +
        `&access_token=${META_ADS_TOKEN}`;
    } else if (action === 'quality') {
      url = `https://graph.facebook.com/${META_API_VERSION}/${pixel_id}/event_match_quality_metrics?` +
        `access_token=${META_ADS_TOKEN}`;
    } else {
      // stats
      if (!AGGREGATIONS_VALIDAS.includes(aggregation)) {
        return res.status(400).json({
          error: 'aggregation inválida',
          validas: AGGREGATIONS_VALIDAS,
        });
      }

      // Default: últimas 24h
      const nowSec = Math.floor(Date.now() / 1000);
      const startTs = since ? parseTimestamp(since) : nowSec - 86400;
      const endTs = until ? parseTimestamp(until) : nowSec;

      if (!startTs || !endTs) {
        return res.status(400).json({
          error: 'since/until inválidos (use ISO datetime ou unix timestamp em segundos)',
        });
      }

      if (endTs - startTs > 28 * 86400) {
        return res.status(400).json({
          error: 'janela máxima 28 dias',
        });
      }

      url = `https://graph.facebook.com/${META_API_VERSION}/${pixel_id}/stats?` +
        `aggregation=${aggregation}` +
        `&start_time=${startTs}` +
        `&end_time=${endTs}` +
        (event_name ? `&event_name=${encodeURIComponent(event_name)}` : '') +
        (event_source ? `&event_source=${event_source}` : '') +
        `&access_token=${META_ADS_TOKEN}`;
    }

    const tInicio = Date.now();
    const metaResp = await fetch(url);
    const metaData = await metaResp.json();

    if (metaData.error) {
      return res.status(502).json({
        error: 'Meta API retornou erro',
        meta_error: metaData.error,
      });
    }

    const result = {
      ok: true,
      pixel_id,
      pixel_nome: PIXELS_VALIDOS[pixel_id],
      action,
      ...(action === 'stats' && { aggregation }),
      ...(action === 'details' && { details: metaData }),
      ...(action === 'quality' && { quality: metaData }),
      ...(action === 'stats' && { data: metaData.data || [], paging: metaData.paging || null }),
      _duracao_ms: Date.now() - tInicio,
      _cached: false,
    };

    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    if (cache.size > 50) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[meta-ads-pixel] erro:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
    });
  }
}
