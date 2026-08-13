/**
 * ml-ads-diag.js — SOMENTE LEITURA (Ailson 13/08/2026)
 *
 * O custo de ads do Detalhar está travado: o cron lê o EXTRATO de faturamento
 * e os gastos recentes ficam além do teto de 10.000 registros (só aparecem
 * quando a fatura fecha, ~dia 18). Aqui testo a API de Product Ads, que dá
 * gasto POR PERÍODO e resolveria o filtro 30/60/90 também.
 *
 * GET ?conta=exitus[&de=2026-08-01&ate=2026-08-13]
 */
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 60 };
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus');
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const de = String(req.query?.de || `${hoje.slice(0, 8)}01`);
  const ate = String(req.query?.ate || hoje);

  try {
    const token = await getValidToken(BRAND[conta]);
    const h = { Authorization: `Bearer ${token}`, 'Api-Version': '2', Accept: 'application/json' };
    const out = { conta, periodo: { de, ate }, testes: {} };

    const ler = async (tag, url, extraH = {}) => {
      try {
        const r = await fetch(url, { headers: { ...h, ...extraH } });
        const txt = await r.text();
        let j = {}; try { j = JSON.parse(txt); } catch { /* html/erro */ }
        out.testes[tag] = { http: r.status, corpo: JSON.stringify(j).slice(0, 700) || txt.slice(0, 200) };
        return j;
      } catch (e) { out.testes[tag] = { erro: String(e.message).slice(0, 150) }; return {}; }
    };

    // 1. quem sou / advertisers
    const me = await (await fetch('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${token}` } })).json();
    out.seller_id = me?.id;
    const adv = await ler('advertisers', 'https://api.mercadolibre.com/advertising/advertisers?product_id=PADS');
    const advertiserId = adv?.advertisers?.[0]?.advertiser_id;
    out.advertiser_id = advertiserId;
    await new Promise(r => setTimeout(r, 300));

    if (advertiserId) {
      // grade de rotas candidatas de métricas (a documentação do PADS mudou
      // várias vezes; testo as formas conhecidas e vejo qual traz "cost")
      const cands = [
        ['g_camp_metrics', `https://api.mercadolibre.com/advertising/advertisers/${advertiserId}/product_ads/campaigns?limit=5&offset=0&metrics_summary=true&date_from=${de}&date_to=${ate}&channel=marketplace`],
        ['h_camp_search_num', `https://api.mercadolibre.com/advertising/product_ads/campaigns/search?limit=5&offset=0`],
        ['i_camp_search_adv', `https://api.mercadolibre.com/advertising/product_ads/campaigns/search?advertiser_id=${advertiserId}&limit=5&offset=0&date_from=${de}&date_to=${ate}&metrics=cost,clicks,prints`],
        ['j_lower_header', `https://api.mercadolibre.com/advertising/advertisers/${advertiserId}/product_ads/campaigns?limit=5&offset=0&metrics_summary=true&date_from=${de}&date_to=${ate}`],
        ['a_ads_search', `https://api.mercadolibre.com/advertising/product_ads/ads/search?advertiser_id=${advertiserId}&date_from=${de}&date_to=${ate}&limit=3`],
        ['b_campaigns_adv', `https://api.mercadolibre.com/advertising/advertisers/${advertiserId}/campaigns?date_from=${de}&date_to=${ate}&limit=3`],
        ['c_pads_campaigns', `https://api.mercadolibre.com/advertising/product_ads/campaigns?advertiser_id=${advertiserId}&date_from=${de}&date_to=${ate}&limit=3`],
        ['d_seller_metrics', `https://api.mercadolibre.com/advertising/product_ads/seller/${out.seller_id}/metrics?date_from=${de}&date_to=${ate}`],
        ['e_users_ads', `https://api.mercadolibre.com/users/${out.seller_id}/product_ads/ads/search?date_from=${de}&date_to=${ate}&limit=3`],
        ['f_billing_ads', `https://api.mercadolibre.com/advertising/advertisers/${advertiserId}/product_ads/metrics?date_from=${de}&date_to=${ate}`],
      ];
      for (const [tag, url] of cands) {
        await ler(tag, url, tag.startsWith('j_') ? { 'api-version': '2', 'Api-Version': undefined } : {});
        await new Promise(r => setTimeout(r, 350));
      }
    }
    if (false) {
      // 2. métricas do advertiser no período (é aqui que mora o custo)
      await ler('advertiser_metrics',
        `https://api.mercadolibre.com/advertising/advertisers/${advertiserId}/product_ads/campaigns?date_from=${de}&date_to=${ate}&limit=5`);
      await new Promise(r => setTimeout(r, 300));
      await ler('metrics_summary',
        `https://api.mercadolibre.com/advertising/product_ads/metrics/summary?advertiser_id=${advertiserId}&date_from=${de}&date_to=${ate}`);
      await new Promise(r => setTimeout(r, 300));
      await ler('campanhas_v1',
        `https://api.mercadolibre.com/advertising/product_ads/campaigns/search?advertiser_id=${advertiserId}&limit=5`);
    }
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
