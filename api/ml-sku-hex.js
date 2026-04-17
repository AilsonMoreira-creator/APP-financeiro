/**
 * ml-sku-hex.js — Diagnóstico: retorna charCode do primeiro caractere dos SKUs
 *
 * GET /api/ml-sku-hex?prefixo=l6a9cesqqp9sow
 * GET /api/ml-sku-hex?prefixo=I6a9cesqqp9sow
 *
 * Útil pra desambiguar I (maiúsculo, charCode 73) vs l (minúsculo, charCode 108)
 * em fontes que renderizam ambos idênticos.
 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const prefixo = String(req.query?.prefixo || '').trim();
  if (!prefixo) return res.status(400).json({ ok: false, erro: 'informe ?prefixo=' });

  try {
    // Busca case-sensitive via like (não ilike)
    const [mapSnap, mapRefMap] = await Promise.all([
      supabase.from('ml_estoque_snapshot')
        .select('sku')
        .like('sku', `${prefixo}%`)
        .limit(5),
      supabase.from('ml_sku_ref_map')
        .select('sku, ref, fonte')
        .like('sku', `${prefixo}%`)
        .limit(5),
    ]);

    // E também busca case-insensitive pra comparar
    const [mapSnapI, mapRefMapI] = await Promise.all([
      supabase.from('ml_estoque_snapshot')
        .select('sku')
        .ilike('sku', `${prefixo}%`)
        .limit(5),
      supabase.from('ml_sku_ref_map')
        .select('sku, ref, fonte')
        .ilike('sku', `${prefixo}%`)
        .limit(5),
    ]);

    const describeSku = (s) => ({
      sku: s,
      primeiro_char: s?.[0],
      primeiro_charCode: s?.charCodeAt(0),
      interpretacao: s?.charCodeAt(0) === 73 ? 'I MAIÚSCULO' : s?.charCodeAt(0) === 108 ? 'l minúsculo' : 'outro',
    });

    return res.json({
      ok: true,
      prefixo_enviado: {
        valor: prefixo,
        primeiro_char: prefixo[0],
        primeiro_charCode: prefixo.charCodeAt(0),
        interpretacao: prefixo.charCodeAt(0) === 73 ? 'I MAIÚSCULO' : prefixo.charCodeAt(0) === 108 ? 'l minúsculo' : 'outro',
      },
      snapshot_case_sensitive: (mapSnap.data || []).map(r => describeSku(r.sku)),
      skumap_case_sensitive: (mapRefMap.data || []).map(r => ({ ...describeSku(r.sku), ref: r.ref, fonte: r.fonte })),
      snapshot_case_insensitive: (mapSnapI.data || []).map(r => describeSku(r.sku)),
      skumap_case_insensitive: (mapRefMapI.data || []).map(r => ({ ...describeSku(r.sku), ref: r.ref, fonte: r.fonte })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
