// ============================================================================
// MELUNI — ações no card do SAC (POST). Ailson 18/06/2026.
// body: { id, mover?, prioridade? }
//   mover: 'conversando' | 'follow_up' | 'arquivo'
//     - follow_up  -> acompanhar=true,  resolvido_em=null
//     - conversando-> acompanhar=false, resolvido_em=null
//     - arquivo    -> resolvido_em=now, acompanhar=false
//   prioridade: boolean -> liga/desliga a estrela de prioridade
// (as abas do SAC são derivadas de acompanhar/resolvido_em, ver sac-list)
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Use POST' });

  try {
    const { id, mover, prioridade } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, erro: 'Falta id' });

    const patch = { atualizado_em: new Date().toISOString() };
    if (mover === 'follow_up') { patch.acompanhar = true; patch.resolvido_em = null; }
    else if (mover === 'conversando') { patch.acompanhar = false; patch.resolvido_em = null; }
    else if (mover === 'arquivo') { patch.resolvido_em = new Date().toISOString(); patch.acompanhar = false; }
    else if (mover) return res.status(400).json({ ok: false, erro: 'mover inválido' });

    if (typeof prioridade === 'boolean') patch.prioridade = prioridade;

    const { error } = await supabase.from('meluni_conversas').update(patch).eq('id', id);
    if (error) return res.status(500).json({ ok: false, erro: error.message });

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
