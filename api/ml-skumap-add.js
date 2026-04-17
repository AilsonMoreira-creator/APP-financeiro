/**
 * ml-skumap-add.js — Import manual de SKU→ref + SCF→ref via query string
 *
 * Uso:
 *   GET /api/ml-skumap-add?ref=3186&skus=l6a9cesqqp9sow030,l6a9cesqqp9sow031&parent=z2304224544174521
 *
 * Params:
 *   ref    (obrigatório)  — número da ref sem zeros à esquerda (ex: "3186")
 *   skus   (obrigatório)  — códigos das variações filhas separados por vírgula
 *   parent (opcional)     — código do produto-pai (SCF) pra também mapear no scf_ref_map
 *   dry    (opcional)     — "true" pra simular sem gravar
 *
 * Comportamento:
 *   - INSERT-only no ml_sku_ref_map (não sobrescreve SKU já mapeado)
 *   - UPSERT no ml_scf_ref_map (apenas 1 linha por SCF, last-write-wins)
 *   - Fonte marcada como 'manual'
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function normRef(r) { return String(r || '').replace(/\D/g, '').replace(/^0+/, '').trim(); }

export default async function handler(req, res) {
  const ref = normRef(req.query?.ref);
  const skusRaw = String(req.query?.skus || '').trim();
  const parent = String(req.query?.parent || '').trim();
  const dry = req.query?.dry === 'true';

  if (!ref) return res.status(400).json({ ok: false, erro: 'parâmetro "ref" obrigatório' });
  if (!skusRaw && !parent) return res.status(400).json({ ok: false, erro: 'informe "skus" e/ou "parent"' });

  const skus = skusRaw.split(',').map(s => s.trim()).filter(Boolean);

  const resumo = {
    ref,
    parent: parent || null,
    total_skus_recebidos: skus.length,
    skus_ja_existentes: 0,
    skus_novos: 0,
    scf_inserido: false,
    scf_atualizado: false,
    dry,
  };

  try {
    // 1. Checa quais SKUs já existem
    if (skus.length > 0) {
      const { data: existentes } = await supabase
        .from('ml_sku_ref_map')
        .select('sku, ref')
        .in('sku', skus);
      const mapExist = new Map((existentes || []).map(r => [r.sku, r.ref]));
      resumo.skus_ja_existentes = mapExist.size;

      const novos = skus
        .filter(s => !mapExist.has(s))
        .map(s => ({ sku: s, ref, fonte: 'manual' }));

      if (!dry && novos.length > 0) {
        const { error } = await supabase.from('ml_sku_ref_map').insert(novos);
        if (error) throw new Error('insert sku_ref_map: ' + error.message);
      }
      resumo.skus_novos = novos.length;
      resumo.amostra_novos = novos.slice(0, 5).map(x => x.sku);

      // Detecta conflitos (SKU já mapeado pra OUTRA ref)
      const conflitos = [];
      for (const [sku, refExistente] of mapExist) {
        if (refExistente !== ref) conflitos.push({ sku, ref_existente: refExistente, ref_nova: ref });
      }
      if (conflitos.length > 0) resumo.conflitos = conflitos;
    }

    // 2. SCF → ref (upsert)
    if (parent) {
      const { data: existSCF } = await supabase
        .from('ml_scf_ref_map')
        .select('scf, ref')
        .eq('scf', parent)
        .maybeSingle();

      if (existSCF) {
        resumo.scf_atualizado = existSCF.ref !== ref;
        if (!dry && existSCF.ref !== ref) {
          const { error } = await supabase.from('ml_scf_ref_map')
            .update({ ref, origem: 'manual_ailson', updated_at: new Date().toISOString() })
            .eq('scf', parent);
          if (error) throw new Error('update scf_ref_map: ' + error.message);
        }
      } else {
        resumo.scf_inserido = true;
        if (!dry) {
          const { error } = await supabase.from('ml_scf_ref_map')
            .insert({ scf: parent, ref, origem: 'manual_ailson' });
          if (error) throw new Error('insert scf_ref_map: ' + error.message);
        }
      }
    }

    return res.json({ ok: true, resumo });

  } catch (e) {
    console.error('[ml-skumap-add] erro:', e);
    return res.status(500).json({ ok: false, resumo, erro: e.message });
  }
}
