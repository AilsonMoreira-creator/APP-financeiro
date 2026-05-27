// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-conversa-vista — zera unread_count de uma conversa
// ═══════════════════════════════════════════════════════════════════════════
// POST { conversa_id } — chamado pelo frontend qdo vendedora abre a conversa.
// Zera o contador de msgs nao lidas (badge vermelho na UI some).
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from './_lojas-whats-helpers.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { conversa_id } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id_obrigatorio' });

    const { error } = await supabase
      .from('lojas_whats_conversas')
      .update({ unread_count: 0 })
      .eq('id', conversa_id);
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[lojas-whats-conversa-vista]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
