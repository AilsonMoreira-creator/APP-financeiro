/**
 * meta-ads-campanhas.js — Lista campanhas de uma conta com a ESTRATÉGIA DE LANCE
 * (bid_strategy), tipo de compra, orçamentos e, por campanha, um resumo dos
 * bid_constraints dos conjuntos (pra detectar META DE ROAS / ROAS mínimo).
 *
 * Complementa /api/meta-ads-analise (insights, que NÃO traz bid_strategy) e
 * /api/meta-ads-adsets (targeting, que só traz bid_strategy do adset).
 *
 * Query params:
 *   account — id da conta (sem 'act_'). Allowlist.
 *   status  — 'ACTIVE' | 'PAUSED' | 'ALL' (default ALL)
 *
 * Como ler "meta de ROAS":
 *   - bid_strategy LOWEST_COST_WITH_MIN_ROAS  → tem META DE ROAS (ROAS mínimo)
 *   - bid_strategy COST_CAP                   → meta de CUSTO por resultado
 *   - bid_strategy LOWEST_COST_WITH_BID_CAP   → limite de lance
 *   - bid_strategy LOWEST_COST_WITHOUT_CAP    → sem meta (maior volume / autobid)
 *   Em campanha CBO a estratégia fica na CAMPANHA; em ABO fica no CONJUNTO
 *   (e o piso de ROAS aparece em bid_constraints.roas_average_floor, em pontos:
 *    200 = 2,00x).
 *
 * Read-only. Sessão Ailson 03/07/2026 — pra responder "tem meta de ROAS?".
 */
import { setCors } from './_lojas-helpers.js';

const META_API_VERSION = 'v21.0';
const CONTAS_VALIDAS = {
  '943539471358534': 'Meluni B2C',
  '338013328231048': 'Amícia B2B',
  '626487585630124': 'Amícia Cartão',
};

function centavos(v) {
  return v == null || v === '' ? null : parseFloat(v) / 100;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const TOKEN = process.env.META_ADS_TOKEN;
  if (!TOKEN) return res.status(500).json({ error: 'META_ADS_TOKEN ausente' });

  const { account, status = 'ALL' } = req.query;
  if (!account || !CONTAS_VALIDAS[account]) {
    return res.status(400).json({ error: 'account inválido', contas_validas: CONTAS_VALIDAS });
  }

  const base = `https://graph.facebook.com/${META_API_VERSION}/act_${account}`;
  const filtro = status !== 'ALL'
    ? `&filtering=${encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: [status] }]))}`
    : '';

  const campUrl = `${base}/campaigns?fields=id,name,objective,status,effective_status,` +
    `bid_strategy,buying_type,daily_budget,lifetime_budget,spend_cap,created_time` +
    `&limit=200${filtro}&access_token=${TOKEN}`;

  // adsets: pra pegar bid_strategy + bid_constraints (piso de ROAS) por conjunto
  const adsetUrl = `${base}/adsets?fields=id,name,campaign_id,effective_status,` +
    `bid_strategy,bid_constraints,daily_budget,lifetime_budget` +
    `&limit=500&access_token=${TOKEN}`;

  try {
    const t0 = Date.now();
    const [cr, ar] = await Promise.all([fetch(campUrl), fetch(adsetUrl)]);
    const cd = await cr.json();
    const ad = await ar.json();
    if (cd.error) return res.status(502).json({ error: 'Meta erro (campaigns)', meta_error: cd.error });
    if (ad.error) return res.status(502).json({ error: 'Meta erro (adsets)', meta_error: ad.error });

    // agrupa adsets por campanha
    const porCamp = {};
    for (const a of (ad.data || [])) {
      const cid = a.campaign_id;
      (porCamp[cid] = porCamp[cid] || []).push({
        nome: a.name,
        status: a.effective_status,
        bid_strategy: a.bid_strategy || null,
        roas_floor: a.bid_constraints?.roas_average_floor
          ? a.bid_constraints.roas_average_floor / 100 : null,
        orc_diario: centavos(a.daily_budget),
      });
    }

    const campanhas = (cd.data || []).map(c => {
      const conj = porCamp[c.id] || [];
      const cbo = c.daily_budget != null || c.lifetime_budget != null;
      // meta de roas pode estar na campanha (CBO) ou em qualquer conjunto (ABO)
      const floors = conj.map(x => x.roas_floor).filter(x => x != null);
      const temMetaRoasCamp = c.bid_strategy === 'LOWEST_COST_WITH_MIN_ROAS';
      const temMetaRoasConj = conj.some(x => x.bid_strategy === 'LOWEST_COST_WITH_MIN_ROAS') || floors.length > 0;
      return {
        id: c.id,
        nome: c.name,
        objetivo: c.objective,
        status: c.effective_status,
        nivel_orcamento: cbo ? 'CBO (campanha)' : 'ABO (conjunto)',
        bid_strategy_campanha: c.bid_strategy || null,
        orc_diario_campanha: centavos(c.daily_budget),
        orc_total_campanha: centavos(c.lifetime_budget),
        spend_cap: centavos(c.spend_cap),
        tem_meta_roas: temMetaRoasCamp || temMetaRoasConj,
        roas_floor: temMetaRoasCamp ? null : (floors.length ? Math.min(...floors) : null),
        conjuntos: conj,
      };
    });

    // resumo
    const comMeta = campanhas.filter(c => c.tem_meta_roas).map(c => c.nome);
    const estrategias = {};
    for (const c of campanhas) {
      const k = c.bid_strategy_campanha || '(no conjunto/ABO)';
      estrategias[k] = (estrategias[k] || 0) + 1;
    }

    return res.status(200).json({
      ok: true,
      account_id: account,
      account_nome: CONTAS_VALIDAS[account],
      total: campanhas.length,
      resumo: {
        campanhas_com_meta_roas: comMeta,
        contagem_estrategia_lance: estrategias,
      },
      campanhas,
      _duracao_ms: Date.now() - t0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
