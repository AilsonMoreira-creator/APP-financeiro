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
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus').toLowerCase();
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
