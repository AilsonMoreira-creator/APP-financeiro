/**
 * ml-whose.js — Diagnóstico: descobre em qual conta ML (Exitus/Lumia/Muniam)
 * um MLB está ativo e quais SKUs ele tem.
 *
 * GET /api/ml-whose?mlb=MLB4919060970
 */
import { getValidToken, BRANDS } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  const mlb = String(req.query?.mlb || '').trim();
  if (!mlb) return res.status(400).json({ ok: false, erro: 'use ?mlb=MLBxxx' });

  const tentativas = [];

  for (const brand of BRANDS) {
    try {
      const token = await getValidToken(brand);
      const r = await fetch(`${ML_API}/items/${mlb}?attributes=id,title,status,available_quantity,variations,attributes,seller_custom_field,seller_id`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const tentativa = { brand, status_http: r.status };

      if (r.ok) {
        const item = await r.json();
        tentativa.achado = true;
        tentativa.resumo = {
          id: item.id,
          title: item.title,
          status: item.status,
          available_quantity: item.available_quantity,
          seller_id: item.seller_id,
          seller_custom_field: item.seller_custom_field,
          qtd_variacoes: (item.variations || []).length,
          amostra_variacoes: (item.variations || []).slice(0, 5).map(v => {
            const skuAttr = (v.attributes || []).find(a => a.id === 'SELLER_SKU');
            const combos = v.attribute_combinations || [];
            return {
              id: v.id,
              sku: skuAttr?.value_name || null,
              available: v.available_quantity,
              cor: combos.find(c => c.id === 'COLOR' || c.id === 'MAIN_COLOR')?.value_name || null,
              tam: combos.find(c => c.id === 'SIZE')?.value_name || null,
            };
          }),
        };
      } else {
        const body = await r.text().catch(() => '');
        tentativa.achado = false;
        tentativa.erro_body = body.slice(0, 200);
      }
      tentativas.push(tentativa);
    } catch (e) {
      tentativas.push({ brand, erro: e.message });
    }
  }

  const achadoEm = tentativas.find(t => t.achado)?.brand || null;
  return res.json({ ok: true, mlb, achado_em: achadoEm, tentativas });
}
