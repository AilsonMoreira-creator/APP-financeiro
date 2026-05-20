/**
 * meta-ads-adsets.js — Lista adsets de uma conta com targeting completo
 * (idade, gênero, localizações, públicos, etc).
 *
 * Query params:
 *   account     — id da conta (allowlist)
 *   status      — 'ACTIVE' (default) | 'PAUSED' | 'ALL'
 *   campaign_id — opcional, filtra por campanha específica
 *   fields      — opcional, lista CSV. Default inclui targeting completo.
 *
 * Sessão Ailson 19/05/2026 — pra ver filtro de idade atual das campanhas.
 */
import { setCors } from './_lojas-helpers.js';

const META_API_VERSION = 'v21.0';
const CONTAS_VALIDAS = {
  '943539471358534': 'Meluni B2C',
  '338013328231048': 'Amícia B2B',
  '626487585630124': 'Amícia Cartão',
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const META_ADS_TOKEN = process.env.META_ADS_TOKEN;
  if (!META_ADS_TOKEN) {
    return res.status(500).json({ error: 'META_ADS_TOKEN ausente' });
  }

  const { account, status = 'ACTIVE', campaign_id, fields: fieldsRaw } = req.query;

  if (!account || !CONTAS_VALIDAS[account]) {
    return res.status(400).json({
      error: 'account inválido',
      contas_validas: CONTAS_VALIDAS,
    });
  }

  const fields = fieldsRaw || 'id,name,status,effective_status,campaign_id,campaign{name},daily_budget,lifetime_budget,targeting,optimization_goal,billing_event,bid_strategy,start_time,end_time,updated_time';

  const filters = [];
  if (status !== 'ALL') {
    filters.push({ field: 'effective_status', operator: 'IN', value: [status] });
  }
  if (campaign_id) {
    filters.push({ field: 'campaign.id', operator: 'EQUAL', value: campaign_id });
  }

  const cacheKey = `${account}|${status}|${campaign_id || ''}|${fields}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.status(200).json({ ...cached.data, _cached: true });
  }

  let url = `https://graph.facebook.com/${META_API_VERSION}/act_${account}/adsets?` +
    `fields=${fields}` +
    `&limit=100` +
    `&access_token=${META_ADS_TOKEN}`;

  if (filters.length > 0) {
    url += `&filtering=${encodeURIComponent(JSON.stringify(filters))}`;
  }

  try {
    const t0 = Date.now();
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.error) {
      return res.status(502).json({
        error: 'Meta API erro',
        meta_error: data.error,
      });
    }

    // Extrai sumário simplificado de targeting de cada adset
    const adsets = (data.data || []).map(a => {
      const t = a.targeting || {};
      return {
        id: a.id,
        name: a.name,
        status: a.status,
        effective_status: a.effective_status,
        campaign_id: a.campaign_id,
        campaign_name: a.campaign?.name,
        daily_budget: a.daily_budget ? parseFloat(a.daily_budget) / 100 : null,
        targeting_resumo: {
          age_min: t.age_min,
          age_max: t.age_max,
          genders: t.genders, // [1] = male, [2] = female
          geo_locations: t.geo_locations,
          excluded_geo_locations: t.excluded_geo_locations,
          custom_audiences: t.custom_audiences,
          excluded_custom_audiences: t.excluded_custom_audiences,
          flexible_spec: t.flexible_spec,
          exclusions: t.exclusions,
          publisher_platforms: t.publisher_platforms,
          facebook_positions: t.facebook_positions,
          instagram_positions: t.instagram_positions,
          targeting_optimization: t.targeting_optimization,
          locales: t.locales,
        },
        targeting_completo: a.targeting, // pra debug se precisar
        optimization_goal: a.optimization_goal,
        billing_event: a.billing_event,
        bid_strategy: a.bid_strategy,
        updated_time: a.updated_time,
      };
    });

    const result = {
      ok: true,
      account_id: account,
      account_nome: CONTAS_VALIDAS[account],
      total: adsets.length,
      adsets,
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
