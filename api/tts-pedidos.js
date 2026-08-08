/**
 * tts-pedidos.js — pedidos REAIS do TikTok Shop (Ailson 08/08/2026).
 *
 * A busca é POST /order/202309/orders/search (a listagem é POST, não GET — foi
 * o que o erro 36009010 "Invalid method" da sondagem mostrou) e o detalhe vem
 * de GET /order/202309/orders?ids=..., que traz o que interessa pro lucro:
 * preço do item, desconto do vendedor x desconto da plataforma e as taxas.
 *
 * ?dias=7  janela  ·  ?limite=N  ·  ?cru=1 devolve a resposta crua
 */
import { authTts, chamarTts } from './_tts-api.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus').toLowerCase();
  const dias = Math.min(90, Math.max(1, parseInt(req.query?.dias) || 7));
  const limite = Math.min(50, Math.max(1, parseInt(req.query?.limite) || 10));

  const a = await authTts(conta);
  if (a.erro) return res.status(400).json(a);
  const { auth, ctx } = a;

  const fim = Math.floor(Date.now() / 1000);
  const ini = fim - dias * 86400;

  const lista = await chamarTts('/order/202309/orders/search',
    { page_size: String(limite) }, auth, ctx,
    { method: 'POST', body: { create_time_ge: ini, create_time_lt: fim } });

  if (lista?.code !== 0) return res.status(400).json({ etapa: 'search', resposta: lista });
  const ids = (lista.data?.orders || []).map(o => o.id).slice(0, limite);
  if (!ids.length) return res.status(200).json({ ok: true, pedidos: 0, aviso: 'nenhum pedido na janela', total: lista.data?.total_count });

  const det = await chamarTts('/order/202309/orders', { ids: ids.join(',') }, auth, ctx);
  if (req.query?.cru === '1') return res.status(200).json({ busca: lista, detalhe: det });
  if (det?.code !== 0) return res.status(400).json({ etapa: 'detalhe', resposta: det });

  const pedidos = (det.data?.orders || []).map(o => ({
    id: o.id, status: o.status,
    criado: o.create_time ? new Date(o.create_time * 1000).toISOString().slice(0, 16) : null,
    total_pago: o.payment?.total_amount,
    subtotal: o.payment?.sub_total,
    frete: o.payment?.shipping_fee,
    desconto_vendedor: o.payment?.seller_discount,
    desconto_plataforma: o.payment?.platform_discount,
    itens: (o.line_items || []).map(i => ({
      sku: i.seller_sku, nome: i.product_name,
      preco_original: i.original_price, preco_vendido: i.sale_price,
      desc_vendedor: i.seller_discount, desc_plataforma: i.platform_discount,
    })),
  }));
  return res.status(200).json({ ok: true, total_na_janela: lista.data?.total_count, pedidos });
}
