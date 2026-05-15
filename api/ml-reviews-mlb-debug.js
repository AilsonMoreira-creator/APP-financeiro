/**
 * ml-reviews-mlb-debug.js — Diagnostico de MLBs orfaos
 *
 * Sessao Ailson 15/05/2026 — investigar hipotese de "ML mudou modelo"
 * (cada SKU vira 1 MLB independente, sem variations, sem SELLER_SKU
 * tradicional). Pega JSON cru do /items/{mlb} SEM filtro de attributes
 * pra ver tudo que o ML retorna hoje.
 *
 * USO:
 *   /api/ml-reviews-mlb-debug?user=ailson&mlbs=MLB5161743566,MLB3899911281
 *   /api/ml-reviews-mlb-debug?user=ailson&orfaos=5   # pega 5 orfaos aleatorios
 *
 * Auth: admin only.
 * Retorna campos relevantes pra resolucao de REF + JSON completo.
 */
import { supabase, getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 60 };

const ML_API = 'https://api.mercadolibre.com';
const ADMINS = ['ailson', 'amicia-admin', 'tamara'];

function extractSellerSku(attrs) {
  for (const a of (attrs || [])) {
    if (a.id === 'SELLER_SKU') return (a.value_name || '').trim() || null;
  }
  return null;
}

// Resume um item retornando os campos relevantes pra REF + um snippet do JSON cru
function resumirItem(item) {
  const sellerSkuTopo = extractSellerSku(item.attributes);
  const skusVariacoes = (item.variations || []).map(v => ({
    variation_id: v.id,
    seller_sku: extractSellerSku(v.attributes),
    seller_custom_field: v.seller_custom_field || null,
    available_quantity: v.available_quantity,
  }));

  // Procura SELLER_SKU em qualquer lugar dos attributes do item (pode estar
  // em formato diferente no novo modelo)
  const todosAttrIds = (item.attributes || []).map(a => ({
    id: a.id,
    name: a.name,
    value_name: (a.value_name || '').slice(0, 100),
  }));

  return {
    id: item.id,
    title: item.title,
    status: item.status,
    catalog_listing: item.catalog_listing,
    catalog_product_id: item.catalog_product_id,
    user_product_id: item.user_product_id,
    parent_item_id: item.parent_item_id,
    family_name: item.family_name,
    seller_custom_field: item.seller_custom_field,
    domain_id: item.domain_id,
    listing_type_id: item.listing_type_id,
    variations_count: (item.variations || []).length,
    has_variations: (item.variations || []).length > 0,
    seller_sku_no_item: sellerSkuTopo,
    skus_nas_variacoes: skusVariacoes,
    todos_attributes_ids: todosAttrIds,
    // JSON completo pra inspecao
    json_cru: item,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query?.user || req.headers['x-user'];
  if (!ADMINS.includes(userId)) {
    return res.status(403).json({ error: 'Apenas admin' });
  }

  // Define quais MLBs olhar
  let mlbsAlvo = [];
  const mlbsParam = String(req.query?.mlbs || '').trim();
  if (mlbsParam) {
    mlbsAlvo = mlbsParam.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    const orfaosQtd = Math.min(parseInt(req.query?.orfaos || '5', 10), 20);
    const { data: orfaos } = await supabase
      .from('ml_reviews_mlb_map')
      .select('mlb_id, brand, titulo, scf_origem')
      .is('ref', null)
      .order('brand')
      .limit(orfaosQtd);
    mlbsAlvo = (orfaos || []).map(o => o.mlb_id);
  }

  if (mlbsAlvo.length === 0) {
    return res.status(400).json({ error: 'Nenhum MLB pra inspecionar (passe ?mlbs=A,B ou ?orfaos=N)' });
  }

  // Descobre brand de cada MLB pra usar token correto
  const { data: rowsMap } = await supabase
    .from('ml_reviews_mlb_map')
    .select('mlb_id, brand, titulo, scf_origem, sku_origem, fonte')
    .in('mlb_id', mlbsAlvo);
  const brandPorMlb = new Map((rowsMap || []).map(r => [r.mlb_id, r.brand]));

  // Cache de tokens por brand
  const tokens = {};
  async function getToken(brand) {
    if (!tokens[brand]) tokens[brand] = await getValidToken(brand);
    return tokens[brand];
  }

  const resultados = [];
  for (const mlb of mlbsAlvo) {
    const brand = brandPorMlb.get(mlb) || 'Lumia';
    try {
      const token = await getToken(brand);
      const r = await fetch(`${ML_API}/items/${mlb}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        resultados.push({ mlb, brand, erro: `HTTP ${r.status}`, txt: (await r.text()).slice(0, 300) });
        continue;
      }
      const item = await r.json();
      const resumo = resumirItem(item);
      // Adiciona contexto do mapa
      const ctxMapa = (rowsMap || []).find(x => x.mlb_id === mlb);
      resumo.contexto_mapa_reviews = ctxMapa || null;
      resultados.push({ mlb, brand, ...resumo });
    } catch (e) {
      resultados.push({ mlb, brand, erro: e.message });
    }
  }

  return res.json({
    ok: true,
    qtd_inspecionados: resultados.length,
    resultados,
  });
}
