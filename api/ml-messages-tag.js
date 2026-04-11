/**
 * ml-messages-tag.js — Atualiza tag, observação, status de conversa pós-venda
 */
import { supabase, setCors } from './_ml-helpers.js';

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const { conversation_id, tag, notes, status, resolved_by } = req.body;
    if (!conversation_id) return res.status(400).json({ error: 'Falta conversation_id' });

    const update = { updated_at: new Date().toISOString() };
    if (tag !== undefined) update.tag = tag;
    if (notes !== undefined) update.notes = notes;
    if (status !== undefined) {
      update.status = status;
      if (status === 'resolvido') {
        update.resolved_by = resolved_by || 'unknown';
        update.resolved_at = new Date().toISOString();
        update.tag = 'resolvido';
      }
    }

    const { error } = await supabase
      .from('ml_conversations')
      .update(update)
      .eq('id', conversation_id);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ success: true });
  } catch (err) {
    console.error('[ml-messages-tag]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
