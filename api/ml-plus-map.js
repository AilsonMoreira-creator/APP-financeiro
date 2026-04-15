// api/ml-plus-map.js — Teste: mapeia anúncios regulares → plus size por similaridade de título
// Roda: GET /api/ml-plus-map (ou /api/ml-plus-map?brand=exitus)

import { getValidToken } from './_ml-helpers.js';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
const ML_API = 'https://api.mercadolibre.com';

// Palavras que NÃO identificam o produto (remover antes de comparar)
const STOP_WORDS = new Set([
  'feminina','feminino','masculina','masculino','fem','masc',
  'bom','retiro','brás','bras','são','sao','paulo',
  'com','sem','de','do','da','dos','das','e','em','para','pra',
  'tamanho','tam','plus','size','plussize',
  'moda','roupa','roupas','nova','novo','lançamento',
  'pronta','entrega','envio','rápido','rapido','imediato',
]);

// Extrai palavras-chave do título (o que IDENTIFICA o produto)
function extractKeywords(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

// Calcula similaridade entre dois conjuntos de keywords (Jaccard index)
function similarity(kw1, kw2) {
  const s1 = new Set(kw1);
  const s2 = new Set(kw2);
  const intersection = [...s1].filter(w => s2.has(w)).length;
  const union = new Set([...s1, ...s2]).size;
  return union === 0 ? 0 : intersection / union;
}

// Busca todos os item_ids ativos de um seller
async function fetchAllItemIds(sellerId, token) {
  const ids = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await fetch(
      `${ML_API}/users/${sellerId}/items/search?status=active&offset=${offset}&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) break;
    const data = await res.json();
    if (!data.results || data.results.length === 0) break;
    ids.push(...data.results);
    if (ids.length >= (data.paging?.total || 0)) break;
    offset += limit;
  }
  return ids;
}

// Busca títulos em lote (API suporta multiget de até 20)
async function fetchItemTitles(itemIds, token) {
  const items = [];
  for (let i = 0; i < itemIds.length; i += 20) {
    const batch = itemIds.slice(i, i + 20);
    const res = await fetch(
      `${ML_API}/items?ids=${batch.join(',')}&attributes=id,title,available_quantity,price`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) continue;
    const data = await res.json();
    for (const item of data) {
      if (item.code === 200 && item.body) {
        items.push({
          id: item.body.id,
          title: item.body.title,
          price: item.body.price,
          qty: item.body.available_quantity,
        });
      }
    }
  }
  return items;
}

export default async function handler(req, res) {
  try {
    const brandFilter = req.query?.brand; // opcional: Exitus, Lumia, Muniam
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

      // 1. Busca todos os IDs ativos
      const allIds = await fetchAllItemIds(sellerId, token);
      
      // 2. Busca títulos
      const allItems = await fetchItemTitles(allIds, token);
      
      // 3. Separa regular vs plus size
      const plusItems = allItems.filter(i => i.title.toLowerCase().includes('plus size') || i.title.toLowerCase().includes('plussize'));
      const regularItems = allItems.filter(i => !i.title.toLowerCase().includes('plus size') && !i.title.toLowerCase().includes('plussize'));
      
      // 4. Pra cada plus, encontra o regular mais similar
      const pairs = [];
      const usedRegulars = new Set();
      
      for (const plus of plusItems) {
        const plusKw = extractKeywords(plus.title);
        let bestMatch = null;
        let bestScore = 0;
        
        for (const reg of regularItems) {
          if (usedRegulars.has(reg.id)) continue;
          const regKw = extractKeywords(reg.title);
          const score = similarity(plusKw, regKw);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = reg;
          }
        }
        
        if (bestMatch && bestScore >= 0.6) { // 60%+ de similaridade = match
          pairs.push({
            regular_id: bestMatch.id,
            regular_title: bestMatch.title,
            plus_id: plus.id,
            plus_title: plus.title,
            similarity: Math.round(bestScore * 100) + '%',
            match_quality: bestScore >= 0.8 ? '✅ FORTE' : bestScore >= 0.7 ? '🟡 BOM' : '🟠 FRACO',
          });
          usedRegulars.add(bestMatch.id);
        } else {
          pairs.push({
            regular_id: null,
            regular_title: '❌ SEM PAR ENCONTRADO',
            plus_id: plus.id,
            plus_title: plus.title,
            similarity: bestScore ? Math.round(bestScore * 100) + '%' : '0%',
            match_quality: '❌ SEM MATCH',
          });
        }
      }
      
      // Plus items que não tem par regular (ex: exclusivo plus)
      const orphanRegulars = regularItems.filter(r => !usedRegulars.has(r.id));
      
      results[brand] = {
        total_anuncios: allItems.length,
        regulares: regularItems.length,
        plus_size: plusItems.length,
        pares_encontrados: pairs.filter(p => p.regular_id).length,
        sem_par: pairs.filter(p => !p.regular_id).length,
        pares: pairs,
        // Amostra de regulares sem par plus (pra ver quais poderiam ter)
        regulares_sem_plus: orphanRegulars.slice(0, 10).map(r => ({ id: r.id, title: r.title })),
      };
    }

    return res.status(200).json({ 
      ok: true, 
      timestamp: new Date().toISOString(),
      results 
    });
    
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
