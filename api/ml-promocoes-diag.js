/**
 * ml-promocoes-diag.js — SÓ LEITURA. Levantamento pra tela "Sale" (Ailson 19/09).
 * O que o ML devolve de promoções pra uma conta e pra um anúncio:
 *   ?conta=exitus                 -> promoções do vendedor (Central de Promoções)
 *   ?conta=exitus&item=MLB123     -> promoções em que ESTE anúncio está/pode entrar
 *   &promo=P-MLB123&tipo=DEAL     -> itens de uma promoção (com preços sugeridos)
 */
import { supabase, getValidToken } from './_ml-helpers.js';
export const config = { maxDuration: 25 };
const BASE = 'https://api.mercadolibre.com';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus').toLowerCase();
  const item = String(req.query?.item || '').toUpperCase();
  const promo = String(req.query?.promo || '');
  const tipo = String(req.query?.tipo || '');
  try {
    const token = await getValidToken(conta);
    const { data: tk } = await supabase.from('ml_tokens').select('seller_id').eq('brand', conta).maybeSingle();
    const sid = tk?.seller_id;
    const h = { Authorization: `Bearer ${token}` };
    const get = async (url) => { const r = await fetch(url, { headers: h }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 400); } return { http: r.status, body: j }; };
    const out = { conta, seller_id: sid };
    out.promocoes_do_vendedor = await get(`${BASE}/seller-promotions/users/${sid}?app_version=v2`);
    if (item) out.promocoes_do_item = await get(`${BASE}/seller-promotions/items/${item}?app_version=v2`);
    if (promo && tipo) out.itens_da_promocao = await get(`${BASE}/seller-promotions/promotions/${promo}/items?promotion_type=${tipo}&app_version=v2&limit=20`);
    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ erro: String(e?.message || e) }); }
}
