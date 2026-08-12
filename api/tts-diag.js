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
      // path oficial trazido por ele 12/08: GET /finance/202507/orders/unsettled
      const r1 = await chamarTts('/finance/202507/orders/unsettled', { page_size: 20 }, auth, ctx)
        .catch(e => ({ erro: String(e.message).slice(0, 300) }));
      const resumo = { code: r1?.code, message: String(r1?.message || '').slice(0, 200) };
      const d = r1?.data || {};
      resumo.chaves_data = Object.keys(d);
      const lista = d.unsettled_transactions || d.transactions || d.orders || d.list || null;
      resumo.qtd = Array.isArray(lista) ? lista.length : null;
      resumo.total = d.total_count ?? d.total ?? null;
      resumo.next = d.next_page_token ? 'tem' : null;
      resumo.exemplos = Array.isArray(lista) ? lista.slice(0, 3) : d;
      return res.status(200).json({ conta, rota: '/finance/202507/orders/unsettled', resumo });
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
