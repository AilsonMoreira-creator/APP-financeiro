/**
 * ml-sku-bytes.js — Diagnóstico: retorna bytes/charCodes do primeiro caractere
 * dos SKUs que estão no snapshot com "tricoline" no título.
 *
 * GET /api/ml-sku-bytes
 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  try {
    const { data, error } = await supabase
      .from('ml_estoque_snapshot')
      .select('sku, ml_title, available')
      .ilike('ml_title', '%tricoline%')
      .limit(20);

    if (error) throw error;

    const detalhado = (data || []).map(r => {
      const sku = r.sku || '';
      const chars = [];
      for (let i = 0; i < Math.min(5, sku.length); i++) {
        chars.push({
          pos: i,
          char: sku[i],
          charCode: sku.charCodeAt(i),
          hex: '0x' + sku.charCodeAt(i).toString(16),
        });
      }
      return {
        sku_completo: sku,
        sku_length: sku.length,
        primeiros_5_chars: chars,
        qtd: r.available,
      };
    });

    return res.json({
      ok: true,
      total: data?.length || 0,
      skus: detalhado,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
