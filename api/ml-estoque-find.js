/**
 * ml-estoque-find.js — Diagnóstico: acha anúncios Lumia por termo no título/SKU
 *
 * GET /api/ml-estoque-find?q=3186
 * GET /api/ml-estoque-find?q=tricoline
 * GET /api/ml-estoque-find?sku=l6a9cesqqp9sow036
 *
 * Retorna todas as linhas do snapshot que batem, incluindo item_id (MLB),
 * SKU, cor/tam, available, e o título completo do anúncio.
 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const q = String(req.query?.q || '').trim();
  const sku = String(req.query?.sku || '').trim();

  if (!q && !sku) {
    return res.status(400).json({ ok: false, erro: 'informe ?q= (termo no título) ou ?sku=' });
  }

  try {
    let query = supabase.from('ml_estoque_snapshot')
      .select('sku, item_id, variation_id, cor, tamanho, available, ml_title, updated_at')
      .limit(200);

    if (sku) query = query.ilike('sku', `%${sku}%`);
    else if (q) query = query.ilike('ml_title', `%${q}%`);

    const { data, error } = await query;
    if (error) throw error;

    // Agrupa por MLB pra resumo
    const porMLB = new Map();
    for (const row of (data || [])) {
      if (!porMLB.has(row.item_id)) {
        porMLB.set(row.item_id, { item_id: row.item_id, ml_title: row.ml_title, skus: [], total: 0 });
      }
      const entry = porMLB.get(row.item_id);
      entry.skus.push({ sku: row.sku, cor: row.cor, tam: row.tamanho, qtd: row.available });
      entry.total += row.available || 0;
    }

    return res.json({
      ok: true,
      filtro: { q: q || null, sku: sku || null },
      total_linhas: data?.length || 0,
      total_mlbs_distintos: porMLB.size,
      mlbs: Array.from(porMLB.values()),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
