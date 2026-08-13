/**
 * mapeamento-canais-diag.js — SOMENTE LEITURA (Ailson 13/08/2026)
 *
 * Testa o lado "por API" do mapeamento híbrido: dado um SKU (o código do
 * produto no Bling, que vem em cada item de pedido), o canal:
 *   1) tem um anúncio com esse SKU?           → existe
 *   2) esse anúncio tem estoque disponível?   → recebe estoque
 *
 * Mercado Livre: /users/{id}/items/search?seller_sku= (oficial) + /items/{id}
 * TikTok: /product/202309/products/search (POST, filtro por seller_sku)
 *
 * Só leitura — nenhuma rota de escrita aqui.
 * GET ?sku=A53I82gqdf40xdd225[&conta=exitus]
 */
import { getValidToken } from './_ml-helpers.js';
import { chamarTts, authTts } from './_tts-api.js';

export const config = { maxDuration: 60 };
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sku = String(req.query?.sku || '').trim();
  const conta = String(req.query?.conta || 'exitus');
  if (!sku) return res.status(400).json({ erro: 'use ?sku=' });

  const out = { sku, conta, mercado_livre: {}, tiktok: {} };

  // ── MERCADO LIVRE ──
  try {
    const token = await getValidToken(BRAND[conta]);
    const me = await (await fetch('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${token}` },
    })).json();
    out.mercado_livre.seller_id = me?.id;

    const busca = await (await fetch(
      `https://api.mercadolibre.com/users/${me.id}/items/search?seller_sku=${encodeURIComponent(sku)}`,
      { headers: { Authorization: `Bearer ${token}` } })).json();
    out.mercado_livre.busca = { total: busca?.paging?.total, ids: (busca?.results || []).slice(0, 3), erro: busca?.message || null };

    const itemId = (busca?.results || [])[0];
    if (itemId) {
      const it = await (await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
        headers: { Authorization: `Bearer ${token}` } })).json();
      const varComSku = (it.variations || []).find(v =>
        (v.attributes || []).some(a => a.id === 'SELLER_SKU' && String(a.value_name) === sku)
        || String(v.seller_custom_field || '') === sku);
      out.mercado_livre.anuncio = {
        id: it.id, status: it.status, titulo: String(it.title || '').slice(0, 60),
        estoque_anuncio: it.available_quantity,
        variacoes: (it.variations || []).length,
        variacao_do_sku: varComSku ? { id: varComSku.id, estoque: varComSku.available_quantity } : null,
        logistica: it.shipping?.logistic_type,
      };
    }
  } catch (e) { out.mercado_livre.erro = String(e.message).slice(0, 200); }

  // ── TIKTOK SHOP ──
  try {
    const a = await authTts(conta);
    if (a.erro) throw new Error(a.erro);
    const { auth, ctx } = a;
    const r = await chamarTts('/product/202309/products/search',
      { page_size: 10 }, auth, ctx,
      { method: 'POST', body: { seller_skus: [sku], status: 'ALL' } });
    const prods = r?.data?.products || [];
    out.tiktok.code = r?.code;
    out.tiktok.message = String(r?.message || '').slice(0, 160);
    out.tiktok.achou = prods.length;
    out.tiktok.exemplo = prods.slice(0, 1).map(p => ({
      id: p.id, status: p.status, titulo: String(p.title || '').slice(0, 50),
      skus: (p.skus || []).map(s => ({ seller_sku: s.seller_sku, estoque: (s.inventory || []).map(i => i.quantity) })),
    }));
  } catch (e) { out.tiktok.erro = String(e.message).slice(0, 200); }

  return res.status(200).json(out);
}
