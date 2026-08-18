/** full-sku-diag.js — por que o estoque do Full aparece zerado? (17/08) */
import { supabase } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ref = String(req.query?.ref || '2782');
  try {
    const token = await getValidToken('Exitus');
    const h = { Authorization: `Bearer ${token}` };
    const me = await (await fetch('https://api.mercadolibre.com/users/me', { headers: h })).json();
    const { data: est } = await supabase.from('bling_estoque')
      .select('cor_label, tam, bling_sku').in('ref', [ref, ref.padStart(5, '0')]).limit(3);
    const out = { seller_id: me.id, testes: [] };

    // 1) todos os anúncios Full do vendedor (pra ver como o SKU aparece lá)
    const full = await (await fetch(`https://api.mercadolibre.com/users/${me.id}/items/search?logistic_type=fulfillment&limit=3`, { headers: h })).json();
    out.total_anuncios_full = full?.paging?.total;
    for (const id of (full?.results || []).slice(0, 2)) {
      const it = await (await fetch(`https://api.mercadolibre.com/items/${id}`, { headers: h })).json();
      out.testes.push({
        item: id, titulo: String(it.title || '').slice(0, 45),
        seller_custom_field: it.seller_custom_field,
        inventory_id: it.inventory_id,
        variacoes: (it.variations || []).slice(0, 3).map(v => ({
          id: v.id, sku: v.seller_custom_field, inventory_id: v.inventory_id,
          atributos: (v.attributes || []).filter(a => /SKU|SELLER/i.test(a.id)).map(a => `${a.id}=${a.value_name}`),
          qtd: v.available_quantity,
        })),
      });
      await new Promise(r => setTimeout(r, 200));
    }

    // 2) busca por um SKU do Bling desta REF
    for (const e of (est || [])) {
      if (!e.bling_sku) continue;
      const b1 = await (await fetch(`https://api.mercadolibre.com/users/${me.id}/items/search?seller_sku=${encodeURIComponent(e.bling_sku)}`, { headers: h })).json();
      const b2 = await (await fetch(`https://api.mercadolibre.com/users/${me.id}/items/search?seller_sku=${encodeURIComponent(e.bling_sku)}&logistic_type=fulfillment`, { headers: h })).json();
      out.testes.push({
        sku_bling: e.bling_sku, cor: e.cor_label, tam: e.tam,
        achou_sem_filtro: b1?.paging?.total, ids: (b1?.results || []).slice(0, 2),
        achou_com_full: b2?.paging?.total, erro: b1?.message || b2?.message || null,
      });
      await new Promise(r => setTimeout(r, 250));
    }
    return res.status(200).json(out);
  } catch (e) { return res.status(500).json({ erro: e.message }); }
}
