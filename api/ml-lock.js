import { supabase, setCors } from './_ml-helpers.js';

const LOCK_EXPIRY_MS = 5 * 60 * 1000;

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
      const expiry = new Date(Date.now() - LOCK_EXPIRY_MS).toISOString();
      await supabase.from('ml_question_locks').delete().lt('locked_at', expiry);
      const { data } = await supabase.from('ml_question_locks').select('*');
      const locks = {};
      (data || []).forEach(l => { locks[l.question_id] = { user: l.locked_by, locked_at: l.locked_at }; });
      return res.json({ locks });
    }

    if (req.method === 'POST') {
      const { action, question_id, user } = req.body;

      if (action === 'lock' && question_id && user) {
        const { data: existing } = await supabase
          .from('ml_question_locks').select('*').eq('question_id', String(question_id)).single();

        if (existing && existing.locked_by !== user) {
          if (Date.now() - new Date(existing.locked_at).getTime() < LOCK_EXPIRY_MS) {
            return res.status(409).json({
              error: 'locked', locked_by: existing.locked_by,
              message: `${existing.locked_by} já está respondendo esta pergunta`,
            });
          }
        }

        await supabase.from('ml_question_locks').upsert({
          question_id: String(question_id), locked_by: user, locked_at: new Date().toISOString(),
        }, { onConflict: 'question_id' });
        return res.json({ success: true, locked: true });
      }

      if (action === 'unlock' && question_id) {
        await supabase.from('ml_question_locks').delete().eq('question_id', String(question_id));
        return res.json({ success: true, unlocked: true });
      }

      if (action === 'heartbeat' && question_id && user) {
        await supabase.from('ml_question_locks').upsert({
          question_id: String(question_id), locked_by: user, locked_at: new Date().toISOString(),
        }, { onConflict: 'question_id' });
        return res.json({ success: true, heartbeat: true });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('[ml-lock]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
