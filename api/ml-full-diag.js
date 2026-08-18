/**
 * ml-full-diag.js — SOMENTE LEITURA (Ailson 17/08/2026)
 * O ML expõe as REMESSAS AO FULL (inbound)? Se sim, a chegada da mercadoria
 * é detectada com precisão, sem inferir por variação de saldo.
 */
import { getValidToken } from './_ml-helpers.js';
export const config = { maxDuration: 60 };
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus');
  try {
    const token = await getValidToken(BRAND[conta]);
    const h = { Authorization: `Bearer ${token}` };
    const me = await (await fetch('https://api.mercadolibre.com/users/me', { headers: h })).json();
    const sid = me?.id;
    const out = { conta, seller_id: sid, rotas: {} };
    const rotas = [
      ['inbound_search', `https://api.mercadolibre.com/inbound/shipments/search?seller_id=${sid}&limit=5`],
      ['stock_operations', `https://api.mercadolibre.com/stock/fulfillment/operations/search?seller_id=${sid}&limit=5`],
      ['inventories_ops', `https://api.mercadolibre.com/inventories/operations/search?seller_id=${sid}&limit=5`],
      ['fulfillment_inbound', `https://api.mercadolibre.com/fulfillment/inbound/shipments?seller_id=${sid}&limit=5`],
      ['shipments_inbound', `https://api.mercadolibre.com/shipments/inbound?seller_id=${sid}&limit=5`],
      ['stock_summary', `https://api.mercadolibre.com/users/${sid}/stock/fulfillment/summary`],
    ];
    for (const [tag, url] of rotas) {
      try {
        const r = await fetch(url, { headers: h });
        const txt = (await r.text()).slice(0, 300);
        out.rotas[tag] = { http: r.status, corpo: txt };
      } catch (e) { out.rotas[tag] = { erro: String(e.message).slice(0, 100) }; }
      await new Promise(x => setTimeout(x, 250));
    }
    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ erro: e.message }); }
}
