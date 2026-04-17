/**
 * ml-estoque-debug.js — Endpoint de diagnóstico temporário
 *
 * GET /api/ml-estoque-debug
 *   → retorna amostras dos dados pra entender por quê os joins não estão funcionando
 *   → NÃO é usado em produção. Apagar depois do diagnóstico.
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    // ── 1. Amostra do snapshot atual ──
    const { data: snapshot } = await supabase.from('ml_estoque_snapshot')
      .select('*').limit(10);

    // ── 2. Amostra do mapa SKU→ref ──
    const { data: mapa } = await supabase.from('ml_sku_ref_map')
      .select('sku, ref, fonte, qtd_pedidos').limit(10);

    // ── 3. Total de linhas em cada tabela ──
    const { count: snapCount } = await supabase.from('ml_estoque_snapshot')
      .select('sku', { count: 'exact', head: true });
    const { count: mapCount } = await supabase.from('ml_sku_ref_map')
      .select('sku', { count: 'exact', head: true });

    // ── 4. Checar se algum SKU do snapshot existe no mapa ──
    const skusDoSnapshot = (snapshot || []).map(s => s.sku);
    const { data: matches } = skusDoSnapshot.length > 0
      ? await supabase.from('ml_sku_ref_map').select('sku, ref').in('sku', skusDoSnapshot)
      : { data: [] };

    // ── 5. Buscar um anúncio "cru" da Lumia pra ver o formato real dos SKUs ──
    let anuncioRaw = null;
    let anuncioSemVarRaw = null;
    try {
      const token = await getValidToken('Lumia');
      const { data: tokRec } = await supabase.from('ml_tokens').select('seller_id').eq('brand', 'Lumia').single();
      const sellerId = tokRec?.seller_id;

      // Pega 1º anúncio ativo
      const sr = await fetch(
        `${ML_API}/users/${sellerId}/items/search?status=active&offset=0&limit=5`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const srData = await sr.json();
      const ids = (srData.results || []).slice(0, 5);

      if (ids.length > 0) {
        const multi = await fetch(
          `${ML_API}/items?ids=${ids.join(',')}&attributes=id,title,status,available_quantity,variations,attributes,seller_custom_field`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const arr = await multi.json();

        // Busca 1 com variação e 1 sem variação pra amostra
        for (const entry of arr) {
          if (entry.code === 200 && entry.body) {
            const item = entry.body;
            if (item.variations && item.variations.length > 0 && !anuncioRaw) {
              anuncioRaw = {
                id: item.id,
                title: item.title,
                status: item.status,
                seller_custom_field: item.seller_custom_field,
                item_attributes_sample: (item.attributes || []).filter(a =>
                  ['SELLER_SKU', 'GTIN'].includes(a.id)
                ).slice(0, 5),
                variation_count: item.variations.length,
                primeira_variacao: {
                  id: item.variations[0].id,
                  available_quantity: item.variations[0].available_quantity,
                  attribute_combinations: item.variations[0].attribute_combinations,
                  attributes: item.variations[0].attributes,  // aqui que deveria ter SELLER_SKU
                },
              };
            }
            if ((!item.variations || item.variations.length === 0) && !anuncioSemVarRaw) {
              anuncioSemVarRaw = {
                id: item.id,
                title: item.title,
                status: item.status,
                seller_custom_field: item.seller_custom_field,
                available_quantity: item.available_quantity,
                item_attributes: item.attributes,  // lista inteira pra procurar SKU
              };
            }
          }
        }
      }
    } catch (e) {
      anuncioRaw = { erro_busca: e.message };
    }

    // ── 6. Retorna ──
    return res.json({
      ok: true,
      totais: {
        snapshot_linhas: snapCount,
        mapa_linhas: mapCount,
      },
      snapshot_amostra: snapshot,
      mapa_amostra: mapa,
      intersecao_snapshot_x_mapa: {
        skus_snapshot_testados: skusDoSnapshot,
        encontrados_no_mapa: matches,
        qtd_encontrados: matches?.length || 0,
      },
      anuncio_com_variacao: anuncioRaw,
      anuncio_sem_variacao: anuncioSemVarRaw,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
