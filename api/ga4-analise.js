/**
 * ga4-analise.js — Proxy autenticado pra GA4 Data API (runReport).
 *
 * Usa o refresh_token salvo em amicia_data (user_id='ga4-oauth-tokens')
 * pra renovar access_tokens automaticamente.
 *
 * Query params:
 *   property      — Property ID (allowlist abaixo). Default: 529125151 (Meluni)
 *   start_date    — YYYY-MM-DD ou 'NdaysAgo' / 'today' / 'yesterday' (formato GA4)
 *   end_date      — idem
 *   metrics       — CSV (ex: 'sessions,activeUsers,screenPageViews')
 *   dimensions    — CSV (ex: 'date,country,deviceCategory')
 *   limit         — max linhas (default 100, max 1000)
 *   order_by      — métrica pra ordenar (ex: 'sessions'). Sempre DESC.
 *
 * Cache 5min. Allowlist de properties.
 */
import { setCors, supabase } from './_lojas-helpers.js';

const PROPERTIES_VALIDAS = {
  '529125151': 'Meluni Site (Convertr)',
  '529112329': 'Site Amicia (Convertr)',
  '529094498': 'Amicia Vesti (Convertr)',
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_LIMIT = 1000;
const cache = new Map();

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GA4_API = 'https://analyticsdata.googleapis.com/v1beta';

async function getAccessToken() {
  const { data, error } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', 'ga4-oauth-tokens')
    .single();

  if (error || !data?.payload?.refresh_token) {
    throw new Error('OAuth não configurado. Acesse /api/ga4-oauth-init primeiro.');
  }

  const tokens = data.payload;
  const expiresAt = new Date(tokens.expires_at).getTime();

  // Token ainda válido (margem de 1 min)
  if (Date.now() < expiresAt - 60000) {
    return tokens.access_token;
  }

  // Renova com refresh_token
  const resp = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokens.refresh_token,
      client_id: process.env.GA4_CLIENT_ID,
      client_secret: process.env.GA4_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });

  const newTokens = await resp.json();
  if (newTokens.error) {
    throw new Error(`Refresh falhou: ${newTokens.error} - ${newTokens.error_description || ''}`);
  }

  const updated = {
    ...tokens,
    access_token: newTokens.access_token,
    expires_at: new Date(Date.now() + (newTokens.expires_in || 3600) * 1000).toISOString(),
    refreshed_at: new Date().toISOString(),
  };

  await supabase
    .from('amicia_data')
    .update({ payload: updated })
    .eq('user_id', 'ga4-oauth-tokens');

  return newTokens.access_token;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const {
    property = '529125151',
    start_date,
    end_date,
    metrics = 'sessions,activeUsers,screenPageViews',
    dimensions = 'date',
    limit: limitRaw = '100',
    order_by,
    host, // CSV de hostNames pra filtrar (workaround bagunça Convertr)
  } = req.query;

  if (!PROPERTIES_VALIDAS[property]) {
    return res.status(400).json({
      error: 'property inválida',
      validas: PROPERTIES_VALIDAS,
    });
  }

  if (!start_date || !end_date) {
    return res.status(400).json({
      error: 'start_date e end_date obrigatórios (YYYY-MM-DD, "NdaysAgo", "today", "yesterday")',
    });
  }

  const limit = Math.min(parseInt(limitRaw, 10) || 100, MAX_LIMIT);

  const cacheKey = `${property}|${start_date}|${end_date}|${metrics}|${dimensions}|${limit}|${order_by || ''}|${host || ''}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.status(200).json({
      ...cached.data,
      _cached: true,
      _cache_age_seconds: Math.floor((Date.now() - cached.timestamp) / 1000),
    });
  }

  try {
    const t0 = Date.now();
    const accessToken = await getAccessToken();

    const body = {
      dateRanges: [{ startDate: start_date, endDate: end_date }],
      metrics: metrics.split(',').map(m => ({ name: m.trim() })).filter(m => m.name),
      dimensions: dimensions.split(',').map(d => ({ name: d.trim() })).filter(d => d.name),
      limit: String(limit),
    };

    if (order_by) {
      body.orderBys = [{ metric: { metricName: order_by }, desc: true }];
    }

    // Filtro por hostName (workaround pra bagunça de tagging da Convertr)
    if (host) {
      const hosts = host.split(',').map(h => h.trim()).filter(Boolean);
      if (hosts.length > 0) {
        body.dimensionFilter = {
          filter: {
            fieldName: 'hostName',
            inListFilter: { values: hosts },
          },
        };
      }
    }

    const ga4Resp = await fetch(
      `${GA4_API}/properties/${property}:runReport`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const ga4Data = await ga4Resp.json();
    if (ga4Data.error) {
      return res.status(502).json({
        error: 'GA4 API erro',
        ga4_error: ga4Data.error,
      });
    }

    // Transforma em formato mais legível: lista de objetos {dim1, dim2, metric1, metric2}
    const dimNames = (ga4Data.dimensionHeaders || []).map(h => h.name);
    const metricNames = (ga4Data.metricHeaders || []).map(h => h.name);
    const rows = (ga4Data.rows || []).map(r => {
      const obj = {};
      (r.dimensionValues || []).forEach((v, i) => { obj[dimNames[i]] = v.value; });
      (r.metricValues || []).forEach((v, i) => { obj[metricNames[i]] = isNaN(parseFloat(v.value)) ? v.value : parseFloat(v.value); });
      return obj;
    });

    const result = {
      ok: true,
      property_id: property,
      property_nome: PROPERTIES_VALIDAS[property],
      janela: { start_date, end_date },
      filtro_host: host || null,
      dimensions: dimNames,
      metrics: metricNames,
      row_count: ga4Data.rowCount || rows.length,
      rows,
      totals: ga4Data.totals,
      raw_metadata: ga4Data.metadata,
      _duracao_ms: Date.now() - t0,
      _cached: false,
    };

    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    if (cache.size > 50) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
