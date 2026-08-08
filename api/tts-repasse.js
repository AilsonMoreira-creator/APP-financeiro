/**
 * tts-repasse.js — quanto o TikTok REALMENTE paga por pedido (Ailson 08/08/2026).
 *
 * "Se você vir quanto eu vou receber (mais importante), dá pra saber o desconto
 * aplicado." É isso que este endpoint busca: o settlement por pedido, que já
 * vem líquido de comissão, taxa de transação, frete e do desconto que saiu do
 * bolso do vendedor.
 *
 * ?dias=30 · ?limite=N · ?cru=1 mostra a resposta bruta do TikTok
 */
import { authTts, chamarTts } from './_tts-api.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus').toLowerCase();
  const dias = Math.min(90, Math.max(1, parseInt(req.query?.dias) || 30));
  const limite = Math.min(100, Math.max(1, parseInt(req.query?.limite) || 50));

  const a = await authTts(conta);
  if (a.erro) return res.status(400).json(a);
  const { auth, ctx } = a;

  const fim = Math.floor(Date.now() / 1000);
  const ini = fim - dias * 86400;

  const d = await chamarTts('/finance/202309/orders/settlements', {
    page_size: String(limite),
    sort_field: 'order_create_time',
    'create_time_ge': String(ini),
    'create_time_lt': String(fim),
  }, auth, ctx);

  if (req.query?.cru === '1') return res.status(200).json({ resposta: d });
  if (d?.code !== 0) return res.status(400).json({ resposta: d });

  const linhas = (d.data?.settlements || []).map(s => ({
    pedido: s.order_id,
    receita_bruta: s.revenue_amount,
    taxas: s.fee_amount,
    liquido_a_receber: s.settlement_amount,
    ajustes: s.adjustment_amount,
    moeda: s.currency,
  }));
  const soma = (k) => linhas.reduce((t, x) => t + (Number(x[k]) || 0), 0);
  return res.status(200).json({
    ok: true, janela_dias: dias, pedidos: linhas.length,
    total_bruto: Math.round(soma('receita_bruta') * 100) / 100,
    total_taxas: Math.round(soma('taxas') * 100) / 100,
    total_liquido: Math.round(soma('liquido_a_receber') * 100) / 100,
    linhas: linhas.slice(0, 15),
  });
}
