// ============================================================================
// MELUNI — bloquear/desbloquear cliente dos disparos em massa.
// POST { cliente_id?, telefone?, bloquear (bool, default true), motivo?, por? }
// Marca meluni_clientes.bloqueado e registra/remove em meluni_bloqueios.
// Ailson 13/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  const { cliente_id, telefone, bloquear = true, motivo = '', por = '' } = req.body || {};
  if (!cliente_id && !telefone) return res.status(400).json({ ok: false, erro: 'informe cliente_id ou telefone' });

  try {
    if (cliente_id) {
      await supabase.from('meluni_clientes')
        .update({ bloqueado: !!bloquear, bloqueado_em: bloquear ? new Date().toISOString() : null })
        .eq('id', cliente_id);
    }
    if (bloquear) {
      await supabase.from('meluni_bloqueios').insert({
        cliente_id: cliente_id || null, telefone: telefone || null, motivo, criado_por: por,
      });
    } else {
      let del = supabase.from('meluni_bloqueios').delete();
      del = cliente_id ? del.eq('cliente_id', cliente_id) : del.eq('telefone', telefone);
      await del;
    }
    return res.json({ ok: true, bloqueado: !!bloquear });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
