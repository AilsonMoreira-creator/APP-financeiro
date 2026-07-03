/**
 * meta-ads-bid.js — Lê a ESTRATÉGIA DE LANCE de cada campanha.
 *
 * O /api/meta-ads-adsets só expõe bid_strategy no nível do conjunto
 * (aparece só em campanhas ABO). A "meta de ROAS" mora no nível da
 * CAMPANHA (bid_strategy = LOWEST_COST_WITH_MIN_ROAS + bid_constraints
 * .roas_average_floor). Este endpoint puxa isso direto de /campaigns.
 *
 * Query params:
 *   account — id da conta (sem 'act_'). Allowlist abaixo.
 *   status  — 'ACTIVE' | 'PAUSED' | 'ALL' (default: ALL)
 *
 * Read-only. Token System User server-side.
 * Sessão Ailson 03/07/2026 — pergunta "alguma campanha tem meta de ROAS?".
 */
import { setCors } from './_lojas-helpers.js';

const META_API_VERSION = 'v21.0';
const CONTAS_VALIDAS = {
  '943539471358534': 'Meluni B2C',
  '338013328231048': 'Amícia B2B',
  '626487585630124': 'Amícia Cartão',
};

// tradução amigável das estratégias de lance
const BID_LABEL = {
  LOWEST_COST_WITHOUT_CAP: 'Maior volume/valor (automático, SEM meta)',
  LOWEST_COST_WITH_BID_CAP: 'Limite de lance',
  COST_CAP: 'Meta de custo (CPA alvo)',
  LOWEST_COST_WITH_MIN_ROAS: 'META DE ROAS (piso mínimo)',
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const TOKEN = process.env.META_ADS_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'META_ADS_TOKEN ausente' });

  const { account, status = 'ALL' } = req.query;
  if (!account || !CONTAS_VALIDAS[account]) {
    return res.status(400).json({ error: 'account fora da allowlist', contas_validas: CONTAS_VALIDAS });
  }

  const fields = 'id,name,objective,status,effective_status,bid_strategy,bid_constraints,daily_budget,lifetime_budget';
  let url = `https://graph.facebook.com/${META_API_VERSION}/act_${account}/campaigns?` +
    `fields=${fields}&limit=200&access_token=${encodeURIComponent(TOKEN)}`;
  if (status && status !== 'ALL') {
    url += `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: [status] }]))}`;
  }

  try {
    const r = await fetch(url);
    const data = await r.json();
    if (data.error) return res.status(502).json({ error: 'meta_api', detalhe: data.error });

    const campanhas = (data.data || []).map(c => {
      const bs = c.bid_strategy || '(herda da campanha/automático)';
      const floor = c.bid_constraints?.roas_average_floor;
      return {
        id: c.id,
        nome: c.name,
        objetivo: (c.objective || '').replace('OUTCOME_', ''),
        status: c.effective_status,
        bid_strategy: bs,
        bid_label: BID_LABEL[bs] || bs,
        meta_roas: floor ? (floor / 100).toFixed(2) + 'x' : null, // roas_average_floor vem *100
        daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : null,
        lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null,
      };
    });

    // resumo: quantas têm meta de ROAS
    const com_meta = campanhas.filter(c => c.bid_strategy === 'LOWEST_COST_WITH_MIN_ROAS');
    return res.status(200).json({
      ok: true,
      account_id: account,
      account_nome: CONTAS_VALIDAS[account],
      total: campanhas.length,
      qtd_com_meta_roas: com_meta.length,
      campanhas,
    });
  } catch (e) {
    return res.status(500).json({ error: 'fetch_falhou', detalhe: String(e) });
  }
}
