/**
 * meta-ads-analise.js — Proxy autenticado pra Meta Marketing API.
 *
 * Permite ao Claude (via Vercel:web_fetch_vercel_url) analisar contas
 * Meta Ads sem depender do MCP da Anthropic (que tem rollout gradual
 * e bloqueia contas tipo Amícia B2B 338013328231048).
 *
 * Também pode ser chamado pelo frontend do módulo Marketing futuro.
 *
 * Query params:
 *   account   — id da conta (sem 'act_'). Allowlist abaixo.
 *   since     — YYYY-MM-DD (obrigatório)
 *   until     — YYYY-MM-DD (obrigatório)
 *   level     — 'account' | 'campaign' | 'adset' | 'ad'  (default: campaign)
 *   fields    — lista separada por vírgula (opcional, default depende do level)
 *   increment — '1' (por dia) | 'all_days' (agregado). Default: all_days
 *   limit     — max linhas (default 100, max 500)
 *
 * Segurança:
 *   - META_ADS_TOKEN server-side (System User permanente).
 *   - Allowlist hardcoded de 3 contas → ninguém consegue extrair dados
 *     de outras contas mesmo conhecendo a URL.
 *   - Cache em memória 5min → protege Meta rate limit + responde rápido
 *     se Claude fizer análises repetidas seguidas.
 *   - Janela máxima 90 dias (Meta exige <=37 meses na real, mas limito por sanity).
 *
 * Sessão Ailson 18/05/2026 — Endpoint criado pra desbloquear análise
 * Amícia B2B (conta WhatsApp) sem precisar de curl manual.
 */
import { setCors } from './_lojas-helpers.js';

const META_API_VERSION = 'v21.0';

// Allowlist: só contas atribuídas ao System User ailson_automation
const CONTAS_VALIDAS = {
  '943539471358534': 'Meluni B2C',
  '338013328231048': 'Amícia B2B',
  '626487585630124': 'Amícia Cartão',
};

const LEVELS_VALIDOS = ['account', 'campaign', 'adset', 'ad'];
const INCREMENTS_VALIDOS = ['1', 'all_days', 'monthly'];
const MAX_DIAS_JANELA = 90;
const MAX_LIMIT = 500;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
const CACHE_MAX_SIZE = 50;

// Cache em memória (sobrevive enquanto o serverless container ficar warm)
const cache = new Map();

/**
 * Campos default por level. Inclui:
 *  - identificadores (id, name) do nível
 *  - métricas core (spend, clicks, impressions, reach, frequency)
 *  - derivadas (ctr, cpc, cpm)
 *  - actions e action_values (pra puxar purchase, lead, messaging, etc)
 */
function defaultFieldsPorLevel(level) {
  const base = [
    'spend',
    'clicks',
    'impressions',
    'reach',
    'frequency',
    'ctr',
    'cpc',
    'cpm',
    'actions',
    'action_values',
  ];
  if (level === 'campaign') {
    return ['campaign_id', 'campaign_name', 'objective', ...base];
  }
  if (level === 'adset') {
    return ['adset_id', 'adset_name', 'campaign_id', 'campaign_name', ...base];
  }
  if (level === 'ad') {
    return ['ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', ...base];
  }
  // account
  return ['account_id', 'account_name', ...base];
}

function validarData(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function diasEntre(since, until) {
  const ms = new Date(until).getTime() - new Date(since).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function housekeepingCache() {
  if (cache.size <= CACHE_MAX_SIZE) return;
  // remove o mais antigo
  const oldestKey = cache.keys().next().value;
  if (oldestKey) cache.delete(oldestKey);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tInicio = Date.now();

  const META_ADS_TOKEN = process.env.META_ADS_TOKEN;
  if (!META_ADS_TOKEN) {
    return res.status(500).json({ error: 'META_ADS_TOKEN ausente nas env vars' });
  }

  const {
    account,
    since,
    until,
    level = 'campaign',
    fields: fieldsRaw,
    increment = 'all_days',
    limit: limitRaw,
  } = req.query;

  // ── Validações ──────────────────────────────────────────────────────────
  if (!account || !CONTAS_VALIDAS[account]) {
    return res.status(400).json({
      error: 'account inválido ou fora da allowlist',
      contas_validas: CONTAS_VALIDAS,
    });
  }

  if (!validarData(since) || !validarData(until)) {
    return res.status(400).json({
      error: 'since e until obrigatórios no formato YYYY-MM-DD',
    });
  }

  const dias = diasEntre(since, until);
  if (dias < 0) {
    return res.status(400).json({ error: 'until precisa ser >= since' });
  }
  if (dias > MAX_DIAS_JANELA) {
    return res.status(400).json({
      error: `janela máxima ${MAX_DIAS_JANELA} dias (recebido ${dias})`,
    });
  }

  if (!LEVELS_VALIDOS.includes(level)) {
    return res.status(400).json({
      error: 'level inválido',
      validos: LEVELS_VALIDOS,
    });
  }

  if (!INCREMENTS_VALIDOS.includes(increment)) {
    return res.status(400).json({
      error: 'increment inválido',
      validos: INCREMENTS_VALIDOS,
    });
  }

  const limit = Math.min(parseInt(limitRaw || '100', 10), MAX_LIMIT);
  if (isNaN(limit) || limit < 1) {
    return res.status(400).json({ error: 'limit inválido' });
  }

  const fields = fieldsRaw
    ? String(fieldsRaw).split(',').map(f => f.trim()).filter(Boolean)
    : defaultFieldsPorLevel(level);

  // ── Cache check ─────────────────────────────────────────────────────────
  const cacheKey = `${account}|${since}|${until}|${level}|${increment}|${limit}|${fields.join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.status(200).json({
      ...cached.data,
      _cached: true,
      _cache_age_seconds: Math.floor((Date.now() - cached.timestamp) / 1000),
      _duracao_ms: Date.now() - tInicio,
    });
  }

  // ── Chamada Meta API ────────────────────────────────────────────────────
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  let url =
    `https://graph.facebook.com/${META_API_VERSION}/act_${account}/insights?` +
    `fields=${fields.join(',')}` +
    `&time_range=${timeRange}` +
    `&level=${level}` +
    `&limit=${limit}` +
    `&access_token=${META_ADS_TOKEN}`;

  if (increment !== 'all_days') {
    url += `&time_increment=${increment}`;
  }

  try {
    const tMeta = Date.now();
    const metaResp = await fetch(url);
    const metaData = await metaResp.json();
    const duracaoMeta = Date.now() - tMeta;

    if (metaData.error) {
      return res.status(502).json({
        error: 'Meta API retornou erro',
        meta_error: metaData.error,
        duracao_ms: Date.now() - tInicio,
      });
    }

    const result = {
      ok: true,
      account_id: account,
      account_nome: CONTAS_VALIDAS[account],
      janela: { since, until, dias },
      level,
      increment,
      fields_pedidos: fields,
      total: metaData.data?.length || 0,
      data: metaData.data || [],
      paging: metaData.paging || null,
      _duracao_meta_ms: duracaoMeta,
      _duracao_total_ms: Date.now() - tInicio,
      _cached: false,
    };

    // Salva no cache
    cache.set(cacheKey, { data: result, timestamp: Date.now() });
    housekeepingCache();

    return res.status(200).json(result);
  } catch (err) {
    console.error('[meta-ads-analise] erro:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
      duracao_ms: Date.now() - tInicio,
    });
  }
}
