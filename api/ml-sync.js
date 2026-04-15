import { supabase, getValidToken, BRANDS, isOutsideBusinessHours, getAbsenceMessage } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

async function syncBrand(brand, outside, absMsg, absenceEnabled) {
  const token = await getValidToken(brand);
  const { data: rec } = await supabase.from('ml_tokens').select('seller_id').eq('brand', brand).single();
  if (!rec) return { brand, synced: 0, autoReplied: 0 };

  const res = await fetch(
    `${ML_API}/questions/search?seller_id=${rec.seller_id}&status=UNANSWERED&api_version=4&limit=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return { brand, synced: 0, error: res.status };

  const data = await res.json();
  const questions = data.questions || [];
  let autoReplied = 0;

  for (const q of questions) {
    // Ausência: SÓ se está fora do horário E absence_enabled === true
    if (outside && absenceEnabled && absMsg) {
      try {
        const aRes = await fetch(`${ML_API}/answers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ question_id: q.id, text: absMsg }),
        });
        if (aRes.ok) {
          await supabase.from('ml_qa_history').insert({
            question_id: q.id, brand, item_id: q.item_id,
            question_text: q.text, answer_text: absMsg,
            answered_by: '_auto_absence', answered_at: new Date().toISOString(),
          });
          autoReplied++;
        }
      } catch (e) { console.error(`[ml-sync] Auto-reply Q${q.id}:`, e.message); }
    }

    await supabase.from('ml_pending_questions').upsert({
      question_id: String(q.id), brand, item_id: q.item_id,
      question_text: q.text, buyer_id: String(q.from?.id || ''),
      date_created: q.date_created,
      status: (outside && absenceEnabled) ? 'auto_answered' : 'pending',
      received_at: new Date().toISOString(),
    }, { onConflict: 'question_id' });
  }

  return { brand, synced: questions.length, autoReplied };
}

export default async function handler(req, res) {
  try {
    const outside = await isOutsideBusinessHours();
    const absMsg = outside ? await getAbsenceMessage() : '';
    
    // Checa absence_enabled no config (strict check)
    let absenceEnabled = false;
    try {
      const { data: cfgData } = await supabase.from('amicia_data').select('payload').eq('user_id', 'ml-perguntas-config').single();
      absenceEnabled = cfgData?.payload?.config?.absence_enabled === true;
      console.log('[ml-sync] absence_enabled:', absenceEnabled, '| outside:', outside);
    } catch (e) { console.error('[ml-sync] config read error:', e.message); }

    const results = await Promise.all(
      BRANDS.map(b => syncBrand(b, outside, absMsg, absenceEnabled).catch(e => ({ brand: b, error: e.message })))
    );

    // Limpar locks expirados (>5 min)
    const expiry = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await supabase.from('ml_question_locks').delete().lt('locked_at', expiry);

    await supabase.from('amicia_data').upsert({
      user_id: 'ml-last-sync',
      payload: { synced_at: new Date().toISOString(), results, outside },
    }, { onConflict: 'user_id' });

    return res.json({ success: true, outside, absenceEnabled, results });
  } catch (err) {
    console.error('[ml-sync]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
