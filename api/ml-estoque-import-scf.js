/**
 * ml-estoque-import-scf.js — Importa um mapa scf → ref pra tabela ml_scf_ref_map
 *
 * POST /api/ml-estoque-import-scf
 *   body: { "mapping": { "2277": "z23071326203", "2410": "z23100673177", ... } }
 *   → upserta todos os pares na tabela ml_scf_ref_map
 *   → retorna quantos foram inseridos/atualizados
 *
 * GET /api/ml-estoque-import-scf
 *   → lista o mapa atual (pra auditoria)
 */
import { supabase } from './_ml-helpers.js';

function normRef(r) {
  return String(r || '').replace(/\D/g, '').replace(/^0+/, '').trim();
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      // Lista o mapa atual
      const { data, error } = await supabase
        .from('ml_scf_ref_map')
        .select('*')
        .order('ref');
      if (error) throw error;
      return res.json({ ok: true, total: data?.length || 0, rows: data });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = req.body || {};
    const mapping = body.mapping;
    const replaceAll = body.replace_all === true;

    if (!mapping || typeof mapping !== 'object') {
      return res.status(400).json({
        error: 'Body precisa ter { mapping: { ref: scf, ... } }',
        exemplo: { mapping: { '2277': 'z23071326203', '2410': 'z23100673177' } },
      });
    }

    // Opcional: limpa tabela antes de importar
    if (replaceAll) {
      await supabase.from('ml_scf_ref_map').delete().neq('scf', '__nada__');
    }

    // Monta rows (scf é a chave, ref é o valor)
    const rows = [];
    const invalidos = [];
    for (const [ref, scf] of Object.entries(mapping)) {
      const refN = normRef(ref);
      const scfT = String(scf || '').trim();
      if (!refN || !scfT) {
        invalidos.push({ ref, scf, motivo: 'ref ou scf vazio' });
        continue;
      }
      rows.push({
        scf: scfT,
        ref: refN,
        origem: body.origem || 'import',
        observacao: body.observacao || null,
        updated_at: new Date().toISOString(),
      });
    }

    // Upsert em lotes
    let inseridos = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase
        .from('ml_scf_ref_map')
        .upsert(batch, { onConflict: 'scf' });
      if (error) {
        console.error('[import-scf] erro:', error.message);
        return res.status(500).json({ error: error.message, inseridos });
      }
      inseridos += batch.length;
    }

    return res.json({
      ok: true,
      inseridos,
      invalidos,
      replace_all: replaceAll,
      observacao: 'Agora roda /api/ml-estoque-cron pra resolver as refs com o novo mapa',
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
