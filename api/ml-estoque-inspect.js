/**
 * ml-estoque-inspect.js — Inspeção profunda de 1 anúncio específico
 * 
 * GET /api/ml-estoque-inspect?mlb=MLB3707206194
 *   → retorna TUDO do anúncio pra a gente ver onde o SKU está
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    const mlb = req.query?.mlb;
    if (!mlb) return res.json({ erro: 'use ?mlb=MLBxxx' });

    const token = await getValidToken('Lumia');

    // Busca SEM filtro de attributes, pra ver TUDO
    const r = await fetch(`${ML_API}/items/${mlb}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) return res.json({ erro: r.status, corpo: await r.text() });

    const item = await r.json();

    // Destaca os campos importantes
    const resumo = {
      id: item.id,
      title: item.title,
      status: item.status,
      available_quantity: item.available_quantity,
      seller_custom_field: item.seller_custom_field,
      
      item_attributes_com_SKU_ou_GTIN: (item.attributes || [])
        .filter(a => ['SELLER_SKU', 'GTIN', 'CUSTOM_SKU'].includes(a.id)),
      
      qtd_variacoes: (item.variations || []).length,
      
      primeiras_3_variacoes: (item.variations || []).slice(0, 3).map(v => ({
        id: v.id,
        available_quantity: v.available_quantity,
        attribute_combinations: v.attribute_combinations,
        attributes_lista_inteira: v.attributes,
        seller_custom_field: v.seller_custom_field,
      })),
    };

    return res.json({
      ok: true,
      resumo,
      item_raw_completo: item,
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
