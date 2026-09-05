// /api/ml-flex-diag — one-off: conta na API DO MERCADO LIVRE quantos envios
// FLEX (self_service) estao esperando impressao (ready_to_ship/ready_to_print)
// nas 3 contas — pra bater com o contador do WMS.
import { getValidToken, supabase } from './_ml-helpers.js';

const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  // 01/09 (foto: flex saiu PDF invertido/miudo): ?testa_zpl=NUMERO_LOJA&conta=x
  // pergunta ao ML, pro shipment daquele pedido, o que ele devolve em zpl2 e
  // em pdf — pra saber se o ML esta NEGANDO zpl2 pro self_service.
  // 04/09 (Envios Agora): ?shipment=NUMERO_LOJA&conta=x — devolve os campos
  // do shipment que podem identificar a modalidade (tags, shipping_option,
  // logistic_type, service, datas).
  // 04/09: ?agora_teste=NUMERO_LOJA&conta=x — passa o pedido pelo mesmo
  // registro do webhook (registrarAgoraDeOrder) e devolve o resultado.
  // 05/09: ?quem=1 — testa o token de cada conta em /users/me (vale? de quem e?)
  if (req.query?.quem === '1') {
    const saida = {};
    for (const [conta, brand] of Object.entries(BRAND)) {
      try {
        const { data: rec } = await supabase.from('ml_tokens').select('access_token, seller_id, updated_at').eq('brand', brand).maybeSingle();
        if (!rec) { saida[conta] = { erro: 'sem registro' }; continue; }
        const r = await fetch('https://api.mercadolibre.com/users/me', { headers: { Authorization: `Bearer ${rec.access_token}` } });
        const j = await r.json().catch(() => ({}));
        saida[conta] = { http: r.status, seller_id_banco: rec.seller_id, id_ml: j.id, nickname: j.nickname, erro: j.message || null, token_atualizado: rec.updated_at };
      } catch (e) { saida[conta] = { erro: String(e?.message || e) }; }
    }
    return res.status(200).json(saida);
  }
  if (req.query?.agora_teste) {
    try {
      const { registrarAgoraDeOrder } = await import('./_wms-agora.js');
      const r = await registrarAgoraDeOrder(String(req.query.agora_teste), BRAND[req.query.conta || 'exitus']);
      return res.status(200).json(r);
    } catch (e) { return res.status(200).json({ ok: false, erro: String(e?.message || e) }); }
  }
  if (req.query?.shipment) {
    try {
      const conta = req.query.conta || 'exitus';
      const token = await getValidToken(BRAND[conta]);
      const h = { Authorization: `Bearer ${token}` };
      let ordId = req.query.shipment, sid = null, order = null;
      let ro = await fetch(`https://api.mercadolibre.com/orders/${ordId}`, { headers: h });
      if (ro.ok) { order = await ro.json(); sid = order?.shipping?.id; }
      else {
        const rp = await fetch(`https://api.mercadolibre.com/packs/${ordId}`, { headers: h });
        const jp = rp.ok ? await rp.json() : null;
        ordId = jp?.orders?.[0]?.id;
        if (ordId) { const ro2 = await fetch(`https://api.mercadolibre.com/orders/${ordId}`, { headers: h }); if (ro2.ok) { order = await ro2.json(); sid = order?.shipping?.id; } }
        if (!sid) sid = jp?.shipment?.id || null;
      }
      if (!sid) return res.status(200).json({ ok: false, passo: 'shipment nao achado' });
      const rs = await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: h, });
      const sh = rs.ok ? await rs.json() : { erro: rs.status };
      return res.status(200).json({
        sid, order_date_created: order?.date_created, order_tags: order?.tags,
        shipment: {
          status: sh.status, substatus: sh.substatus, logistic_type: sh.logistic_type, mode: sh.mode,
          tags: sh.tags, service_id: sh.service_id, shipping_option: sh.shipping_option,
          date_created: sh.date_created, lead_time: sh.lead_time,
          logistic: sh.logistic, sla: sh.sla,
        },
      });
    } catch (e) { return res.status(200).json({ ok: false, erro: String(e?.message || e) }); }
  }
  if (req.query?.testa_zpl) {
    try {
      const conta = req.query.conta || 'exitus';
      const token = await getValidToken(BRAND[conta]);
      const h = { Authorization: `Bearer ${token}` };
      const ro = await fetch(`https://api.mercadolibre.com/orders/${req.query.testa_zpl}`, { headers: h });
      const jo = ro.ok ? await ro.json() : null;
      let sid = jo?.shipping?.id;
      if (!sid) {  // carrinho: numero_loja e PACK id (mesmo fallback do _wms-ml-etiquetas)
        const rp = await fetch(`https://api.mercadolibre.com/packs/${req.query.testa_zpl}`, { headers: h });
        const jp = rp.ok ? await rp.json() : null;
        const ordId = jp?.orders?.[0]?.id;
        if (ordId) {
          const ro2 = await fetch(`https://api.mercadolibre.com/orders/${ordId}`, { headers: h });
          if (ro2.ok) sid = (await ro2.json())?.shipping?.id || null;
        }
        if (!sid) sid = jp?.shipment?.id || null;
      }
      if (!sid) return res.status(200).json({ ok: false, passo: 'order+pack', status: ro.status });
      const saidaT = { sid };
      for (const fmt of ['zpl2', 'pdf']) {
        const r2 = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${sid}&response_type=${fmt}&label_type=label`, { headers: h });
        const buf = new Uint8Array(await r2.arrayBuffer());
        let corpo = '';
        try { corpo = Buffer.from(buf.slice(0, 300)).toString('utf8'); } catch { /* binario */ }
        saidaT[fmt] = {
          status: r2.status,
          content_type: r2.headers.get('content-type'),
          bytes: buf.length,
          zip: buf[0] === 0x50 && buf[1] === 0x4b,
          inicio: corpo.replace(/[^\x20-\x7e]/g, '.').slice(0, 160),
        };
      }
      return res.status(200).json(saidaT);
    } catch (e) { return res.status(200).json({ ok: false, erro: String(e?.message || e) }); }
  }
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
