/** ml-sale-diag.js — SO LEITURA. Procura no ML todos os anuncios (qualquer status) da conta que usam os SKUs de uma REF. */
import { supabase } from './_ml-helpers.js';
import { skusDaRef, tokenDe, sellerIdDe, mlGet, normRef } from './_ml-sale-lib.js';
export const config = { maxDuration: 50 };
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus').toLowerCase(); const ref = normRef(req.query?.ref);
  try {
    const token = await tokenDe(conta); const sid = await sellerIdDe(conta);
    const skus = await skusDaRef(ref); const achados = {};
    const t0 = Date.now();
    for (const sku of skus) {
      if (Date.now() - t0 > 40000) break;
      for (const st of ['', '&status=paused', '&status=closed', '&status=under_review']) {
        const r = await mlGet(token, `/users/${sid}/items/search?seller_sku=${encodeURIComponent(sku)}${st}&limit=50`);
        for (const id of r.body?.results || []) (achados[id] = achados[id] || new Set()).add(sku);
      }
    }
    const ids = Object.keys(achados); const itens = [];
    for (let i = 0; i < ids.length; i += 20) {
      const r = await mlGet(token, `/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,title,status,sub_status,shipping,available_quantity,price,family_id`);
      for (const x of r.body || []) if (x.body) itens.push({ ...x.body, skus_batidos: [...achados[x.body.id]].slice(0, 5) });
    }
    return res.status(200).json({ conta, ref, skus_consultados: skus.length, anuncios: itens });
  } catch (e) { return res.status(500).json({ erro: String(e?.message || e) }); }
}
