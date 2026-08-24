// /api/ml-flex-diag — one-off: conta na API DO MERCADO LIVRE quantos envios
// FLEX (self_service) estao esperando impressao (ready_to_ship/ready_to_print)
// nas 3 contas — pra bater com o contador do WMS.
import { getValidToken } from './_ml-helpers.js';

const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  const inicio = Date.now();
  const saida = {};
  for (const conta of ['exitus', 'lumia', 'muniam']) {
    const r = { flex_pendentes: [], olhados: 0 };
    saida[conta] = r;
    try {
      const token = await getValidToken(BRAND[conta]);
      const h = { Authorization: `Bearer ${token}` };
      const me = await (await fetch('https://api.mercadolibre.com/users/me', { headers: h })).json();
      if (!me?.id) { r.erro = 'sem user id'; continue; }
      // pedidos pagos dos ultimos 4 dias (flex gira no dia; 4d cobre folga)
      const desde = new Date(Date.now() - 4 * 86400000).toISOString();
      let url = `https://api.mercadolibre.com/orders/search?seller=${me.id}&order.date_created.from=${encodeURIComponent(desde)}&sort=date_desc&limit=50`;
      const j = await (await fetch(url, { headers: h })).json();
      const ords = j?.results || [];
      r.total_pedidos_4d = j?.paging?.total ?? ords.length;
      const sids = [...new Set(ords.map(o => o?.shipping?.id).filter(Boolean))];
      for (const sid of sids) {
        if (Date.now() - inicio > 230000) { r.aviso = 'tempo'; break; }
        await espera(90);
        const s = await (await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: h })).json().catch(() => ({}));
        r.olhados++;
        if (s?.logistic_type !== 'self_service') continue;
        if (s?.status === 'ready_to_ship') {
          r.flex_pendentes.push({ shipment: sid, substatus: s?.substatus || null, criado: String(s?.date_created || '').slice(0, 10) });
        }
      }
      r.flex_pendentes_qtd = r.flex_pendentes.length;
    } catch (e) { r.erro = String(e?.message || e).slice(0, 80); }
  }
  return res.status(200).json(saida);
}
