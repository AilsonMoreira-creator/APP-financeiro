/**
 * ml-full-replenishment-diag.js — SOMENTE LEITURA (14/09/2026)
 * Sonda o endpoint de PLANEJAMENTO DE REPOSICAO do Full (doc ML 08/09/2026):
 *   GET /marketplace/fbm/user-products/{user_product_id}/replenishment?country=BR
 * Pega um anuncio do Full (Exitus) no cache, descobre o user_product_id de ate 3
 * variacoes pelo /items e devolve as respostas cruas. Nao grava nada.
 */
import { getValidToken } from './_ml-helpers.js';
import { supabase } from './_bling-helpers.js';
export const config = { maxDuration: 60 };
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus');
  const anuncioQ = String(req.query?.anuncio || '').trim();
  const nVar = Math.min(Number(req.query?.n) || 3, 8);
  try {
    const token = await getValidToken(BRAND[conta]);
    const h = { Authorization: `Bearer ${token}` };
    const me = await (await fetch('https://api.mercadolibre.com/users/me', { headers: h })).json();
    const sid = me?.id;
    let anuncio = anuncioQ;
    if (!anuncio) {
      const { data } = await supabase.from('full_estoque_cache').select('anuncio').eq('conta', conta).not('inventory_id', 'is', null).limit(1);
      anuncio = data?.[0]?.anuncio;
    }
    const item = await (await fetch(`https://api.mercadolibre.com/items/${anuncio}?include_attributes=all`, { headers: h })).json();
    const vars = (item.variations || []).slice(0, nVar).map(v => ({
      variation_id: v.id, user_product_id: v.user_product_id, inventory_id: v.inventory_id,
      sku: v.seller_sku || (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name,
      attrs: (v.attribute_combinations || []).map(a => a.value_name).join(' / '),
    }));
    const hRep = { ...h, 'x-caller-id': String(sid), 'x-caller-siteId': 'MLB' };
    const out = { conta, seller_id: sid, anuncio, item_user_product_id: item.user_product_id, variacoes: [] };
    for (const v of vars) {
      const r = { ...v };
      if (v.user_product_id) {
        const rep = await fetch(`https://api.mercadolibre.com/marketplace/fbm/user-products/${v.user_product_id}/replenishment?country=BR`, { headers: hRep });
        r.replenishment = { http: rep.status, missing: rep.headers.get('x-content-missing'), corpo: (await rep.text()).slice(0, 1500) };
        await new Promise(x => setTimeout(x, 250));
        const st = await fetch(`https://api.mercadolibre.com/user-products/${v.user_product_id}/stock`, { headers: h });
        r.stock = { http: st.status, corpo: (await st.text()).slice(0, 400) };
        await new Promise(x => setTimeout(x, 250));
      }
      out.variacoes.push(r);
    }
    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ erro: e.message }); }
}
