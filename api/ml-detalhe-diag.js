/**
 * ml-detalhe-diag.js — raio-X financeiro de UM pedido do Mercado Livre
 * (Ailson 10/08/2026). Base do futuro "Detalhar" do card ML no OS Amícia.
 *
 * Abre, pra um pedido: o order da API do ML, o PAGAMENTO no Mercado Pago
 * (taxas, valor líquido, data e status de liberação do dinheiro), o custo de
 * frete do vendedor (shipment costs) e os descontos/campanhas aplicados.
 *
 * GET ?pedido=<ml_order_id>&conta=exitus|lumia|muniam
 */
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 120 };
const API = 'https://api.mercadolibre.com';
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

async function ml(path, token) {
  // pagamentos moram no host do Mercado Pago; o resto no do Mercado Livre
  const host = path.startsWith('/v1/payments') ? 'https://api.mercadopago.com' : API;
  const r = await fetch(`${host}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await r.json().catch(() => ({}));
  return r.ok ? body : { _erro: r.status, _msg: body?.message };
}

// só o que interessa: números != 0, e strings/datas de status
function enxuga(obj, profundidade = 0) {
  if (obj === null || obj === undefined || profundidade > 3) return undefined;
  if (Array.isArray(obj)) {
    const a = obj.map(x => enxuga(x, profundidade + 1)).filter(x => x !== undefined);
    return a.length ? a : undefined;
  }
  if (typeof obj === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(obj)) {
      const e = enxuga(v, profundidade + 1);
      if (e !== undefined) o[k] = e;
    }
    return Object.keys(o).length ? o : undefined;
  }
  if (typeof obj === 'number') return obj !== 0 ? obj : undefined;
  if (typeof obj === 'string') {
    if (!obj) return undefined;
    if (/^\d{4}-\d{2}-\d{2}T/.test(obj)) return obj.slice(0, 16);
    return obj.length > 60 ? obj.slice(0, 60) : obj;
  }
  if (typeof obj === 'boolean') return obj || undefined;
  return undefined;
}

async function mlH(path, token, headers = {}) {
  const host = path.startsWith('/v1/payments') ? 'https://api.mercadopago.com' : API;
  const r = await fetch(`${host}${path}`, { headers: { Authorization: `Bearer ${token}`, ...headers } });
  const body = await r.json().catch(() => ({}));
  return r.ok ? body : { _erro: r.status, _msg: (body?.message || '').slice(0, 80) };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus').toLowerCase();

  // ?ads=1 — descobrir a rota certa do investimento em publicidade (Product Ads)
  if (req.query?.ads === '1') {
    const token = await getValidToken(BRAND[conta] || 'Exitus');
    const me = await mlH('/users/me', token);
    const uid = me?.id;
    const ini = '2026-08-01', fim = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
    const tent = {};
    tent.advertisers_v1 = await mlH('/advertising/advertisers?product_id=PADS', token, { 'Api-Version': '1' });
    const advId = tent.advertisers_v1?.advertisers?.[0]?.advertiser_id;
    if (advId) {
      tent.metrics_v2 = await mlH(`/advertising/product_ads/metrics?date_from=${ini}&date_to=${fim}&metrics=cost,acos&aggregation=sum`, token, { 'Api-Version': '2', 'advertiser-id': String(advId) });
      tent.campaigns_v2 = await mlH(`/advertising/product_ads/campaigns?limit=3&date_from=${ini}&date_to=${fim}&metrics=cost`, token, { 'Api-Version': '2', 'advertiser-id': String(advId) });
    }
    tent.pads_user = await mlH(`/advertising/${uid}/product_ads/metrics?date_from=${ini}&date_to=${fim}&metrics=cost`, token, { 'Api-Version': '2' });
    if (advId) {
      tent.m1 = await mlH(`/advertising/${advId}/product_ads/metrics?date_from=${ini}&date_to=${fim}&metrics=cost`, token, { 'Api-Version': '2' });
      tent.m2 = await mlH(`/advertising/advertisers/${advId}/product_ads/metrics?date_from=${ini}&date_to=${fim}&metrics=cost`, token, { 'Api-Version': '2' });
      tent.m3 = await mlH(`/advertising/${advId}/product_ads/metrics/summary?date_from=${ini}&date_to=${fim}&metrics=cost`, token, { 'Api-Version': '2' });
      tent.m4 = await mlH(`/advertising/${advId}/campaigns?date_from=${ini}&date_to=${fim}&limit=2`, token, { 'Api-Version': '2' });
    }
    tent.billing2 = await mlH('/billing/integration/monthly/periods?group=ML&document_type=BILL&offset=0&limit=2', token);
    tent.pads_periods = await mlH('/billing/integration/monthly/periods?group=PADS&document_type=BILL&offset=0&limit=3', token);
    const kAds = tent.pads_periods?.results?.[0]?.key;
    if (kAds) tent.pads_details = await mlH(`/billing/integration/periods/key/${kAds}/group/PADS/details?document_type=BILL&limit=2&offset=0`, token);

    // caminho alternativo: BILLING (extrato de faturamento) — publicidade
    // aparece como cobrança; costuma vir com o escopo read normal
    tent.billing_periods = await mlH('/billing/integration/monthly/periods', token);
    const chave = tent.billing_periods?.results?.[0]?.key || tent.billing_periods?.periods?.[0]?.key;
    if (chave) {
      tent.billing_summary = await mlH(`/billing/integration/periods/key/${chave}/summary`, token);
      tent.billing_details_ml = await mlH(`/billing/integration/periods/key/${chave}/group/ML/details?limit=5&offset=0`, token);
    }
    return res.status(200).json({ conta, uid, advertiser: advId || null, chave_periodo: chave || null, tentativas: tent });
  }

  // ?mp_cru=1&pedido=<order_id> — payment do MP INTEIRO (sem enxugar), pra
  // achar financing/charges e entender o debito de frete
  if (req.query?.mp_cru === '1') {
    const token = await getValidToken(BRAND[conta] || 'Exitus');
    const oid = String(req.query?.pedido || '').trim();
    const o = await mlH(`/orders/${oid}`, token);
    if (o._erro) return res.status(400).json(o);
    const pid = o.payments?.[0]?.id;
    const mp = await mlH(`/v1/payments/${pid}`, token);
    // devolve só chaves de 1o nivel + objetos financeiros completos
    const foco = {};
    for (const k of ['transaction_amount', 'transaction_details', 'fee_details', 'charges_details', 'taxes_amount', 'shipping_amount', 'money_release_date', 'money_release_status', 'installments', 'payment_type_id', 'coupon_amount']) foco[k] = mp[k];
    return res.status(200).json({ pedido: oid, payment: String(pid), foco });
  }

  // ?ads_scan=1 — varre os details do billing e agrega por sub_type, pra
  // achar o rótulo dos charges de PUBLICIDADE (e validar a soma do mês)
  if (req.query?.ads_scan === '1') {
    const token = await getValidToken(BRAND[conta] || 'Exitus');
    const key = String(req.query?.key || '2026-08-01');
    const tipos = {};
    let offset = 0, total = null, paginas = 0;
    const t0 = Date.now();
    while ((total === null || offset < total) && paginas < 30 && Date.now() - t0 < 100000) {
      const d = await mlH(`/billing/integration/periods/key/${key}/group/ML/details?document_type=BILL&limit=1000&offset=${offset}`, token);
      if (d._erro) return res.status(400).json({ offset, erro: d._erro, msg: d._msg, tipos });
      total = d.total ?? total;
      for (const row of (d.results || [])) {
        const ci = row.charge_info || {};
        const chave = `${ci.detail_sub_type || '?'} · ${(ci.transaction_detail || '?').slice(0, 50)}`;
        const t = tipos[chave] || (tipos[chave] = { qtd: 0, soma: 0, ago: 0 });
        t.qtd++; t.soma += Number(ci.detail_amount) || 0;
        if (String(ci.creation_date_time || '').startsWith('2026-08')) t.ago += Number(ci.detail_amount) || 0;
      }
      offset += 1000; paginas++;
    }
    for (const t of Object.values(tipos)) { t.soma = Math.round(t.soma * 100) / 100; t.ago = Math.round(t.ago * 100) / 100; }
    return res.status(200).json({ key, total, paginas, tipos });
  }

  const id = String(req.query?.pedido || '').trim();
  if (!/^\d+$/.test(id)) return res.status(400).json({ erro: 'use ?pedido=<ml_order_id>&conta=exitus' });

  try {
    const token = await getValidToken(BRAND[conta] || 'Exitus');
    if (!token) return res.status(400).json({ erro: `sem token pra ${conta}` });

    const order = await ml(`/orders/${id}`, token);
    if (order._erro) return res.status(400).json({ etapa: 'order', ...order });

    const saida = {
      pedido: id, conta,
      order: {
        status: order.status,
        date_created: order.date_created?.slice(0, 16),
        total_amount: order.total_amount,
        paid_amount: order.paid_amount,
        coupon: enxuga(order.coupon),
        taxes: enxuga(order.taxes),
        itens: (order.order_items || []).map(it => ({
          sku: it.item?.seller_sku, titulo: (it.item?.title || '').slice(0, 40),
          qtd: it.quantity, unit_price: it.unit_price, full_unit_price: it.full_unit_price,
          sale_fee: it.sale_fee, listing_type: it.listing_type_id,
        })),
        payments_resumo: (order.payments || []).map(p => ({
          id: String(p.id), status: p.status, transaction_amount: p.transaction_amount,
          shipping_cost: p.shipping_cost, coupon_amount: p.coupon_amount,
          marketplace_fee: p.marketplace_fee, date_approved: p.date_approved?.slice(0, 16),
        })),
      },
    };

    // ── Mercado Pago: o pagamento de verdade (taxas, líquido, liberação) ─────
    saida.mercado_pago = [];
    for (const p of (order.payments || []).slice(0, 3)) {
      let mp = await ml(`/v1/payments/${p.id}`, token);
      if (mp._erro) {
        // fallback: busca por referencia externa (order_id) — alguns payments
        // de marketplace nao respondem no GET direto
        const busca = await ml(`/v1/payments/search?external_reference=${id}`, token);
        mp = (busca?.results || []).find(x => String(x.id) === String(p.id)) || (busca?.results || [])[0] || busca;
      }
      if (!mp || mp._erro) { saida.mercado_pago.push({ id: String(p.id), erro: mp?._erro || 'nao encontrado' }); continue; }
      saida.mercado_pago.push({
        id: String(p.id), status: mp.status, status_detail: mp.status_detail,
        transaction_amount: mp.transaction_amount,
        fee_details: enxuga(mp.fee_details),
        taxes: enxuga(mp.taxes_amount),
        net_received_amount: mp.transaction_details?.net_received_amount,
        total_paid_amount: mp.transaction_details?.total_paid_amount,
        date_approved: mp.date_approved?.slice(0, 16),
        money_release_date: mp.money_release_date?.slice(0, 16),
        money_release_status: mp.money_release_status,
      });
    }

    // ── frete: quanto O VENDEDOR paga ────────────────────────────────────────
    const shipId = order.shipping?.id;
    if (shipId) {
      const [ship, custos] = await Promise.all([
        ml(`/shipments/${shipId}`, token),
        ml(`/shipments/${shipId}/costs`, token),
      ]);
      saida.envio = ship._erro ? { erro: ship._erro } : {
        logistic_type: ship.logistic_type, status: ship.status,
        base_cost: ship.base_cost, order_cost: ship.order_cost,
      };
      saida.envio_custos = custos._erro ? { erro: custos._erro } : enxuga({
        gross_amount: custos.gross_amount,
        vendedor: (custos.senders || []).map(s => ({
          cost: s.cost, save: s.save, compensation: s.compensation,
          discounts: (s.discounts || []).map(d => ({ rate: d.rate, type: d.type, promoted_amount: d.promoted_amount })),
        })),
        comprador: { cost: custos.receiver?.cost, save: custos.receiver?.save },
      });
    }

    // ── descontos/campanhas do pedido (quem banca) ───────────────────────────
    const desc = await ml(`/orders/${id}/discounts`, token);
    saida.descontos = desc._erro ? { erro: desc._erro } : enxuga(desc?.details || desc);

    return res.status(200).json(saida);
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
