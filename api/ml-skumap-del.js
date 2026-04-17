/**
 * ml-skumap-del.js — Deleta entradas do ml_sku_ref_map
 *
 * GET /api/ml-skumap-del?ref=3186&fonte=manual&dry=true
 *   → simula deleção dos SKUs da ref 3186 com fonte='manual'
 *
 * GET /api/ml-skumap-del?skus=sku1,sku2,sku3
 *   → deleta SKUs específicos
 *
 * Params:
 *   ref     — filtra por ref (obrigatório se não usar skus)
 *   fonte   — filtra por fonte ('manual' | 'bling_vendas' | 'bling_produtos')
 *   skus    — CSV de SKUs a deletar (alternativo a ref)
 *   dry     — "true" pra simular
 */
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function normRef(r) { return String(r || '').replace(/\D/g, '').replace(/^0+/, '').trim(); }

export default async function handler(req, res) {
  const ref = normRef(req.query?.ref);
  const fonte = String(req.query?.fonte || '').trim();
  const skusRaw = String(req.query?.skus || '').trim();
  const dry = req.query?.dry === 'true';

  if (!ref && !skusRaw) {
    return res.status(400).json({ ok: false, erro: 'informe ?ref= ou ?skus=' });
  }

  try {
    // Lista o que seria apagado
    let selQuery = supabase.from('ml_sku_ref_map').select('sku, ref, fonte');
    if (skusRaw) {
      const skus = skusRaw.split(',').map(s => s.trim()).filter(Boolean);
      selQuery = selQuery.in('sku', skus);
    } else {
      selQuery = selQuery.eq('ref', ref);
      if (fonte) selQuery = selQuery.eq('fonte', fonte);
    }
    const { data: alvos, error: selErr } = await selQuery;
    if (selErr) throw selErr;

    const resumo = {
      filtro: { ref: ref || null, fonte: fonte || null, skus: skusRaw || null },
      dry,
      total_encontrados: alvos?.length || 0,
      amostra: (alvos || []).slice(0, 10),
      deletados: 0,
    };

    if (dry || (alvos?.length || 0) === 0) {
      return res.json({ ok: true, resumo });
    }

    // Executa deleção com mesmo filtro
    let delQuery = supabase.from('ml_sku_ref_map').delete();
    if (skusRaw) {
      const skus = skusRaw.split(',').map(s => s.trim()).filter(Boolean);
      delQuery = delQuery.in('sku', skus);
    } else {
      delQuery = delQuery.eq('ref', ref);
      if (fonte) delQuery = delQuery.eq('fonte', fonte);
    }
    const { error: delErr } = await delQuery;
    if (delErr) throw delErr;

    resumo.deletados = alvos?.length || 0;
    return res.json({ ok: true, resumo });

  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
