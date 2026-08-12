/**
 * tts-diag.js — caça ao detalhamento financeiro ANTES da liquidação
 * (Ailson 11/08/2026). No ML conseguimos o líquido na aprovação; aqui o
 * objetivo é o equivalente: o que o TikTok já sabe sobre um pedido não
 * liquidado (comissões, frete, afiliado) antes do repasse cair.
 *
 * GET ?pedido=<order_id>&conta=exitus
 */
import { chamarTts, authTts } from './_tts-api.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const pedido = String(req.query?.pedido || '').trim();
  const conta = String(req.query?.conta || 'exitus');
  if (!pedido) return res.status(400).json({ erro: 'use ?pedido=<order_id>' });

  try {
    const a = await authTts(conta);
    if (a.erro) return res.status(400).json(a);
    const { auth, ctx } = a;
    const t = {};

    // 0. ?unsettled=1 — caça à rota "Get Unsettled Transactions" (doc 202501)
    if (req.query?.unsettled) {
      const t2 = {};
      for (const [nome, path, params] of [
        ['a_202501_unsettled', '/finance/202501/unsettled_transactions', { page_size: 10 }],
        ['b_202501_unsettled_search', '/finance/202501/unsettled_transactions/search', { page_size: 10 }],
        ['c_202309_unsettled', '/finance/202309/unsettled_transactions', { page_size: 10 }],
        ['d_202501_transactions', '/finance/202501/transactions', { page_size: 10 }],
      ]) {
        t2[nome] = await chamarTts(path, params, auth, ctx).catch(e => ({ erro: String(e.message).slice(0, 200) }));
        await new Promise(r => setTimeout(r, 300));
      }
      return res.status(200).json({ conta, tentativas: t2 });
    }

    // 1. transações do pedido na Finance (existe por ORDER, não só por statement?)
    t.txn_por_pedido = await chamarTts(`/finance/202309/orders/${pedido}/statement_transactions`, {}, auth, ctx)
      .catch(e => ({ erro: e.message }));

    // 2. detail do pedido (payment: o que o cliente pagou, subsídios)
    t.order_detail = await chamarTts('/order/202309/orders', { ids: pedido }, auth, ctx)
      .then(r => {
        const o = r.data?.orders?.[0];
        if (!o) return { vazio: true };
        return { status: o.status, payment: o.payment, create_time: o.create_time };
      })
      .catch(e => ({ erro: e.message }));

    // 3. versões mais novas da finance (estimated settlement?)
    for (const rota of [
      `/finance/202501/orders/${pedido}/statement_transactions`,
      `/finance/202309/orders/${pedido}/settlements`,
      `/finance/202309/transactions`,
    ]) {
      const chave = rota.replace(/\//g, '_').slice(1, 60);
      t[chave] = await chamarTts(rota, rota.endsWith('transactions') && !rota.includes(pedido) ? { order_id: pedido } : {}, auth, ctx)
        .catch(e => ({ erro: e.message }));
    }

    return res.status(200).json({ pedido, conta, tentativas: t });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
