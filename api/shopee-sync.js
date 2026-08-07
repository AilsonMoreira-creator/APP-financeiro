/**
 * shopee-sync.js — pedidos da Shopee com o rateio REAL de descontos
 * (Ailson 07/08/2026)
 *
 * Fluxo: order.get_order_list → order.get_order_detail (lote de 50) →
 *        payment.get_escrow_detail (1 a 1, é onde vem o dinheiro de verdade:
 *        comissão, taxa de serviço, VOUCHER DA SHOPEE separado do desconto do
 *        vendedor e subsídio de frete).
 *
 * Query:
 *   ?dias=7        janela (default 7, máx 15 — limite da própria Shopee)
 *   ?dry=1         não grava, devolve amostra crua pra inspeção
 *   ?limite=N      máximo de pedidos processados na rodada (default 50)
 */
import crypto from 'crypto';
import { supabase } from './_bling-helpers.js';

export const config = { maxDuration: 300 };
const HOST = 'https://partner.shopeemobile.com';

function assinarLoja(partnerKey, partnerId, path, ts, token, shopId) {
  return crypto.createHmac('sha256', partnerKey)
    .update(`${partnerId}${path}${ts}${token}${shopId}`).digest('hex');
}

async function chamar(path, params, auth, ctx) {
  const ts = Math.floor(Date.now() / 1000);
  const sign = assinarLoja(ctx.partnerKey, ctx.partnerId, path, ts, auth.access_token, auth.shop_id);
  const qs = new URLSearchParams({
    partner_id: String(ctx.partnerId), timestamp: String(ts), sign,
    access_token: auth.access_token, shop_id: String(auth.shop_id), ...params,
  });
  const r = await fetch(`${HOST}${path}?${qs}`);
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  if (!partnerId || !partnerKey) return res.status(500).json({ error: 'faltam SHOPEE_PARTNER_ID/KEY' });
  const ctx = { partnerId, partnerKey };

  const dias = Math.min(15, Math.max(1, parseInt(req.query?.dias) || 7));
  const dry = req.query?.dry === '1';
  const limite = Math.min(200, Math.max(1, parseInt(req.query?.limite) || 50));

  const { data: auth } = await supabase.from('shopee_auth').select('*').limit(1).maybeSingle();
  if (!auth) return res.status(400).json({ error: 'nenhuma loja autorizada' });

  // token expirado? renova pelo refresh
  if (auth.expira_em && new Date(auth.expira_em).getTime() < Date.now() + 60000) {
    const path = '/api/v2/auth/access_token/get';
    const ts = Math.floor(Date.now() / 1000);
    const sign = crypto.createHmac('sha256', partnerKey).update(`${partnerId}${path}${ts}`).digest('hex');
    const r = await fetch(`${HOST}${path}?partner_id=${partnerId}&timestamp=${ts}&sign=${sign}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: auth.refresh_token, shop_id: Number(auth.shop_id), partner_id: Number(partnerId) }),
    });
    const d = await r.json();
    if (d.access_token) {
      auth.access_token = d.access_token;
      await supabase.from('shopee_auth').update({
        access_token: d.access_token, refresh_token: d.refresh_token || auth.refresh_token,
        expira_em: new Date(Date.now() + (Number(d.expire_in) || 14400) * 1000).toISOString(),
        atualizado_em: new Date().toISOString(),
      }).eq('shop_id', auth.shop_id);
    } else {
      return res.status(400).json({ error: 'falha ao renovar token', detalhe: d });
    }
  }

  const fim = Math.floor(Date.now() / 1000);
  const ini = fim - dias * 86400;

  // 1. lista de pedidos
  const lista = await chamar('/api/v2/order/get_order_list', {
    time_range_field: 'create_time', time_from: String(ini), time_to: String(fim),
    page_size: '100', order_status: 'COMPLETED',
  }, auth, ctx);
  if (lista.error) return res.status(400).json({ etapa: 'get_order_list', erro: lista.error, mensagem: lista.message });

  const sns = (lista.response?.order_list || []).map(o => o.order_sn).slice(0, limite);
  if (!sns.length) return res.status(200).json({ ok: true, pedidos: 0, aviso: 'nenhum pedido na janela' });

  // 2b. modo cru: devolve o detalhe completo de 1 pedido pra inspecionar campos
  if (req.query?.raw === '1') {
    const d = await chamar('/api/v2/order/get_order_detail', {
      order_sn_list: sns.slice(0, 2).join(','),
      response_optional_fields: [
        'item_list','total_amount','create_time','order_status','payment_method',
        'shipping_carrier','buyer_user_id','actual_shipping_fee','goods_to_declare',
        'note','estimated_shipping_fee','pay_time','dropshipper','credit_card_number',
        'invoice_data','checkout_shipping_carrier','reverse_shipping_fee',
      ].join(','),
    }, auth, ctx);
    return res.status(200).json({ ok: true, detalhe: d.response?.order_list || d });
  }

  // 2. detalhe (lotes de 50)
  const detalhes = [];
  for (let i = 0; i < sns.length; i += 50) {
    const d = await chamar('/api/v2/order/get_order_detail', {
      order_sn_list: sns.slice(i, i + 50).join(','),
      response_optional_fields: 'item_list,total_amount,create_time,order_status',
    }, auth, ctx);
    if (d.error) return res.status(400).json({ etapa: 'get_order_detail', erro: d.error, mensagem: d.message });
    detalhes.push(...(d.response?.order_list || []));
  }

  // 3. escrow (1 a 1) — o rateio real
  const linhas = [];
  for (const sn of sns) {
    const e = await chamar('/api/v2/payment/get_escrow_detail', { order_sn: sn }, auth, ctx);
    if (e.error) {
      if (dry) return res.status(400).json({ etapa: 'get_escrow_detail', erro: e.error, mensagem: e.message, dica: 'se for permissão, habilite a API payment no console' });
      continue;
    }
    const oi = e.response?.order_income || {};
    const det = detalhes.find(d => d.order_sn === sn) || {};
    linhas.push({
      shop_id: auth.shop_id, conta: auth.conta, order_sn: sn,
      criado_em_shopee: det.create_time ? new Date(det.create_time * 1000).toISOString() : null,
      valor_bruto: oi.original_price ?? null,
      valor_recebido: oi.escrow_amount ?? null,
      desconto_vendedor: oi.seller_discount ?? null,
      desconto_shopee: oi.shopee_discount ?? null,
      voucher_vendedor: oi.voucher_from_seller ?? null,
      voucher_shopee: oi.voucher_from_shopee ?? null,
      comissao: oi.commission_fee ?? null,
      taxa_servico: oi.service_fee ?? null,
      taxa_transacao: oi.transaction_fee ?? null,
      frete_vendedor: oi.actual_shipping_fee ?? null,
      itens: det.item_list || [],
      bruto: dry ? oi : undefined,
    });
    await new Promise(r => setTimeout(r, 120));
  }

  if (dry) return res.status(200).json({ ok: true, total: linhas.length, amostra: linhas.slice(0, 3) });

  for (const l of linhas) { delete l.bruto; }
  const { error } = await supabase.from('shopee_pedidos').upsert(linhas, { onConflict: 'order_sn' });
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, gravados: linhas.length });
}
