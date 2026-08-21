// /api/wms-ml-etiq-diag — raio-x do caminho da etiqueta ZPL2 do ML por
// pedido, SEM baixar a etiqueta (baixar marca "printed" no painel).
// ?numeros=9585,9586 — acha conta/numero_loja no espelho e testa:
// token → order → shipment (status/substatus). Com &baixar=1 tenta o
// download real e reporta o HTTP status do ML.
import { supabase, getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 120 };
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

export default async function handler(req, res) {
  const q = req.query || {};
  const numeros = String(q.numeros || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!numeros.length) return res.status(400).json({ erro: 'passa ?numeros=9585,9586' });
  const saida = [];
  try {
    const { data: peds } = await supabase.from('wms_pedidos')
      .select('pedido_id, numero, conta, numero_loja, canal_geral, ml_logistic_type, ml_ship_status, ml_ship_substatus')
      .in('numero', numeros);
    for (const p of (peds || [])) {
      const linha = { numero: p.numero, conta: p.conta, numero_loja: p.numero_loja, logistic: p.ml_logistic_type, espelho: `${p.ml_ship_status || '?'}/${p.ml_ship_substatus || '?'}` };
      const brand = BRAND[String(p.conta || '').toLowerCase()];
      if (!brand) { linha.erro = 'conta sem marca ML'; saida.push(linha); continue; }
      const token = await getValidToken(brand).catch(e => { linha.token_erro = String(e?.message || e); return null; });
      if (!token) { linha.erro = 'token ML indisponivel'; saida.push(linha); continue; }
      linha.token = 'ok';
      if (!p.numero_loja) { linha.erro = 'sem numero_loja no espelho'; saida.push(linha); continue; }
      const h = { Authorization: `Bearer ${token}` };
      const or = await fetch(`https://api.mercadolibre.com/orders/${p.numero_loja}`, { headers: h });
      const oj = await or.json().catch(() => ({}));
      linha.order_http = or.status;
      let sid = oj?.shipping?.id;
      if (!sid) {
        const pr = await fetch(`https://api.mercadolibre.com/packs/${p.numero_loja}`, { headers: h });
        const pj = await pr.json().catch(() => ({}));
        linha.pack_http = pr.status;
        const ordId = pj?.orders?.[0]?.id;
        linha.pack_order = ordId || null;
        if (ordId) {
          const ro = await fetch(`https://api.mercadolibre.com/orders/${ordId}`, { headers: h });
          if (ro.ok) sid = (await ro.json())?.shipping?.id || null;
        }
        if (!sid) sid = pj?.shipment?.id || null;
      }
      if (!sid) { linha.erro = 'sem shipment (order e pack)'; linha.order_msg = oj?.message || null; saida.push(linha); continue; }
      linha.shipment_id = sid;
      const sr = await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: h });
      const sj = await sr.json().catch(() => ({}));
      linha.shipment = `${sj?.status || '?'}/${sj?.substatus || '?'}`;
      linha.shipment_logistic = sj?.logistic_type || null;
      if (q.baixar === '1') {
        const lr = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${sid}&response_type=zpl2&label_type=label`, { headers: h });
        linha.label_http = lr.status;
        if (!lr.ok) linha.label_msg = (await lr.json().catch(() => ({})))?.message || null;
        else linha.label_bytes = (await lr.arrayBuffer()).byteLength;
      }
      saida.push(linha);
      await new Promise(r2 => setTimeout(r2, 150));
    }
    return res.status(200).json({ pedidos: saida });
  } catch (e) {
    return res.status(500).json({ erro: String(e?.message || e), parcial: saida });
  }
}
