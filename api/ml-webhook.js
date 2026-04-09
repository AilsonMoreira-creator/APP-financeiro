import { supabase, getValidToken, isOutsideBusinessHours, getAbsenceMessage } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).end();

    const { resource, user_id, topic } = req.body;
    if (topic !== 'questions' || !resource) return res.status(200).json({ ignored: true });

    // Identificar marca pelo seller_id
    const { data: tokenRec } = await supabase
      .from('ml_tokens').select('brand').eq('seller_id', String(user_id)).single();
    if (!tokenRec) return res.status(200).json({ ignored: true, reason: 'unknown_seller' });

    const brand = tokenRec.brand;
    const token = await getValidToken(brand);

    const qRes = await fetch(`${ML_API}${resource}?api_version=4`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!qRes.ok) return res.status(200).json({ error: 'fetch_failed' });

    const question = await qRes.json();

    if (question.status === 'UNANSWERED') {
      const outside = await isOutsideBusinessHours();

      if (outside) {
        const msg = await getAbsenceMessage();
        const ansRes = await fetch(`${ML_API}/answers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ question_id: question.id, text: msg }),
        });
        if (ansRes.ok) {
          await supabase.from('ml_qa_history').insert({
            question_id: question.id, brand, item_id: question.item_id,
            question_text: question.text, answer_text: msg,
            answered_by: '_auto_absence', answered_at: new Date().toISOString(),
          });
        }
      }

      await supabase.from('ml_pending_questions').upsert({
        question_id: String(question.id), brand, item_id: question.item_id,
        question_text: question.text, buyer_id: String(question.from?.id || ''),
        date_created: question.date_created,
        status: outside ? 'auto_answered' : 'pending',
        received_at: new Date().toISOString(),
      }, { onConflict: 'question_id' });
    }

    return res.status(200).json({ processed: true, question_id: question.id });
  } catch (err) {
    console.error('[ml-webhook]', err.message);
    return res.status(200).json({ error: err.message });
  }
}
