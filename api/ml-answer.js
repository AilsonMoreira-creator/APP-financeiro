import { supabase, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    const { question_id, brand, text, item_id, question_text, answered_by } = req.body;
    if (!question_id || !brand || !text) return res.status(400).json({ error: 'Missing fields' });
    if (text.length > 2000) return res.status(400).json({ error: `Excede 2000 chars (${text.length})` });

    const token = await getValidToken(brand);

    const mlRes = await fetch(`${ML_API}/answers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: Number(question_id), text }),
    });

    if (!mlRes.ok) {
      const err = await mlRes.json();
      return res.status(mlRes.status).json({ error: 'ML API error', detail: err });
    }

    const mlData = await mlRes.json();

    // Salvar no histórico pra IA
    try {
      await supabase.from('ml_qa_history').insert({
        question_id, brand, item_id: item_id || null,
        question_text: question_text || '', answer_text: text,
        answered_by: answered_by || 'unknown', answered_at: new Date().toISOString(),
      });
    } catch (e) { console.error('[ml-answer] History error:', e.message); }

    // Remover lock
    try {
      await supabase.from('ml_question_locks').delete().eq('question_id', String(question_id));
    } catch (e) { console.error('[ml-answer] Lock cleanup error:', e.message); }

    // Cancelar resposta da fila se existir (operador respondeu antes dos 2min)
    try {
      await supabase.from('ml_response_queue')
        .update({ status: 'cancelled', error: 'manual_answer' })
        .eq('question_id', Number(question_id))
        .eq('status', 'queued');
    } catch (e) { console.error('[ml-answer] Queue cancel error:', e.message); }

    return res.json({ success: true, question_id, brand, ml_response: mlData });
  } catch (err) {
    console.error('[ml-answer]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
