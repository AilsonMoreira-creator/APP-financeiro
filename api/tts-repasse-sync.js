/**
 * tts-repasse-sync.js — grava o repasse REAL do TikTok por pedido.
 *
 * Caminho: /finance/202309/statements (lista os repasses) →
 * /finance/202309/statements/{id}/statement_transactions (abre cada repasse em
 * linhas, uma por pedido, com todas as taxas separadas). As duas rotas exigem
 * sort_field.
 *
 * Cada linha é atribuída ao mês do PEDIDO (order_create_time) e não ao dia em
 * que o dinheiro caiu — o repasse chega ~3 semanas depois e, sem isso, o mês
 * corrente pareceria vazio. Ailson 08/08/2026.
 *
 * ?dias=90 · ?conta=exitus
 */
import { supabase } from './_bling-helpers.js';
import { authTts, chamarTts } from './_tts-api.js';

export const config = { maxDuration: 300 };
const n = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const dia = (ts) => ts ? new Date(ts * 1000).toISOString().slice(0, 10) : null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const inicio = Date.now();
  const conta = String(req.query?.conta || 'exitus').toLowerCase();
  const dias = Math.min(180, Math.max(1, parseInt(req.query?.dias) || 90));

  const a = await authTts(conta);
  if (a.erro) return res.status(400).json(a);
  const { auth, ctx } = a;

  const fim = Math.floor(Date.now() / 1000);
  const ini = fim - dias * 86400;

  // 1. lista os repasses da janela
  const statements = [];
  let token = null;
  for (let p = 0; p < 20; p++) {
    const r = await chamarTts('/finance/202309/statements', {
      page_size: '50', sort_field: 'statement_time',
      statement_time_ge: String(ini), statement_time_lt: String(fim),
      ...(token ? { page_token: token } : {}),
    }, auth, ctx);
    if (r?.code !== 0) return res.status(400).json({ etapa: 'statements', resposta: r });
    (r.data?.statements || []).forEach(s => statements.push(s));
    token = r.data?.next_page_token;
    if (!token) break;
  }

  // 2. abre cada repasse em linhas por pedido
  const resumo = { repasses: statements.length, pedidos: 0, gravados: 0, erros: 0 };
  for (const st of statements) {
    if (Date.now() - inicio > 275000) { resumo.parcial = 'tempo esgotado — rode de novo'; break; }
    let tk = null;
    for (let p = 0; p < 10; p++) {
      const r = await chamarTts(`/finance/202309/statements/${st.id}/statement_transactions`, {
        page_size: '50', sort_field: 'order_create_time', ...(tk ? { page_token: tk } : {}),
      }, auth, ctx);
      if (r?.code !== 0) { resumo.erros++; break; }
      for (const t of (r.data?.statement_transactions || [])) {
        if (!t.order_id) continue;
        resumo.pedidos++;
        const linha = {
          conta, order_id: String(t.order_id), statement_id: String(st.id),
          data_pedido: dia(t.order_create_time), data_repasse: dia(st.statement_time),
          venda: n(t.gross_sales_amount),
          desconto_vendedor: Math.abs(n(t.seller_discount_amount)),
          desconto_plataforma: Math.abs(n(t.platform_discount_amount)),
          comissao_plataforma: Math.abs(n(t.platform_commission_amount)),
          comissao_afiliado: Math.abs(n(t.affiliate_commission_amount))
            + Math.abs(n(t.affiliate_ads_commission_amount))
            + Math.abs(n(t.affiliate_partner_commission_amount)),
          taxa_transacao: Math.abs(n(t.transaction_fee_amount)) + Math.abs(n(t.referral_fee_amount)),
          frete_cobrado_cliente: n(t.customer_paid_shipping_fee_amount),
          frete_real: Math.abs(n(t.actual_shipping_fee_amount)) || Math.abs(n(t.fbm_shipping_cost_amount)),
          subsidio_frete: n(t.platform_shipping_fee_discount_amount) || n(t.shipping_cost_discount_amount),
          reembolsos: Math.abs(n(t.customer_refund_amount)) + Math.abs(n(t.gross_sales_refund_amount)),
          ajustes: n(t.adjustment_amount),
          settlement: n(t.settlement_amount),
          bruto: t,
          atualizado_em: new Date().toISOString(),
        };
        const { error } = await supabase.from('tts_repasse').upsert(linha, { onConflict: 'conta,order_id' });
        if (error) resumo.erros++; else resumo.gravados++;
      }
      tk = r.data?.next_page_token;
      if (!tk) break;
    }
  }

  return res.status(200).json({ ok: true, janela_dias: dias, ...resumo });
}
