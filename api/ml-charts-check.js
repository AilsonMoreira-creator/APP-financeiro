// api/ml-charts-check.js — Verifica quais anúncios têm tabela de medidas vinculada
// GET /api/ml-charts-check?brand=Exitus  (ou sem filtro pra todas)

import { getValidToken } from './_ml-helpers.js';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const ML_API = 'https://api.mercadolibre.com';

async function fetchAllItemIds(sellerId, token) {
  const ids = [];
  let offset = 0;
  while (true) {
    const res = await fetch(
      `${ML_API}/users/${sellerId}/items/search?status=active&offset=${offset}&limit=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) break;
    const data = await res.json();
    if (!data.results || data.results.length === 0) break;
    ids.push(...data.results);
    if (ids.length >= (data.paging?.total || 0)) break;
    offset += 100;
  }
  return ids;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache');
  try {
    const brandFilter = req.query?.brand;
    const ALL_BRANDS = ['Exitus', 'Lumia', 'Muniam'];
    const brands = brandFilter
      ? ALL_BRANDS.filter(b => b.toLowerCase() === brandFilter.toLowerCase())
      : ALL_BRANDS;

    const results = {};

    for (const brand of brands) {
      let token, sellerId;
      try {
        token = await getValidToken(brand);
        const { data: rec } = await supabase.from('ml_tokens').select('seller_id').eq('brand', brand).single();
        sellerId = rec?.seller_id;
        if (!sellerId) { results[brand] = { error: 'sem seller_id' }; continue; }
      } catch (e) { results[brand] = { error: `token: ${e.message}` }; continue; }

      const allIds = await fetchAllItemIds(sellerId, token);

      // Busca títulos em lote
      const itemsMap = {};
      for (let i = 0; i < allIds.length; i += 20) {
        const batch = allIds.slice(i, i + 20);
        const r = await fetch(
          `${ML_API}/items?ids=${batch.join(',')}&attributes=id,title`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!r.ok) continue;
        const data = await r.json();
        for (const item of data) {
          if (item.code === 200 && item.body) {
            itemsMap[item.body.id] = item.body.title;
          }
        }
      }

      // Verifica chart pra cada anúncio
      const comTabela = [];
      const semTabela = [];
      let chartExemplo = null;

      // Checa em lotes de 5 (pra não estourar rate limit)
      for (let i = 0; i < allIds.length; i += 5) {
        const batch = allIds.slice(i, i + 5);
        const checks = await Promise.allSettled(
          batch.map(async (itemId) => {
            // Tenta buscar chart do item
            const chartRes = await fetch(
              `${ML_API}/items/${itemId}/charts`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (!chartRes.ok) return { itemId, hasChart: false, status: chartRes.status };
            const chartData = await chartRes.json();
            // Charts pode ser array ou objeto
            const charts = Array.isArray(chartData) ? chartData : chartData?.charts || [];
            return { itemId, hasChart: charts.length > 0, charts: charts.length, data: charts };
          })
        );

        for (const result of checks) {
          if (result.status !== 'fulfilled') continue;
          const { itemId, hasChart, charts, data } = result.value;
          const title = itemsMap[itemId] || itemId;
          if (hasChart) {
            comTabela.push({ id: itemId, title, charts_count: charts });
            if (!chartExemplo && data?.length > 0) {
              // Pega exemplo da primeira tabela encontrada
              chartExemplo = { item_id: itemId, title, chart: data[0] };
            }
          } else {
            semTabela.push({ id: itemId, title });
          }
        }
      }

      results[brand] = {
        total: allIds.length,
        com_tabela: comTabela.length,
        sem_tabela: semTabela.length,
        percentual_coberto: Math.round((comTabela.length / allIds.length) * 100) + '%',
        anuncios_com_tabela: comTabela.slice(0, 10),
        anuncios_sem_tabela: semTabela.slice(0, 15),
        exemplo_tabela: chartExemplo,
      };
    }

    return res.status(200).json({ ok: true, timestamp: new Date().toISOString(), results });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
