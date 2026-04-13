/**
 * ml-ai-respond.js — Cron: envia respostas da fila após delay de 2min
 * Roda a cada 1 min via Vercel Cron
 * Busca respostas em ml_response_queue com status=queued e respond_after <= now
 * Envia pra ML API e salva no histórico
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const inicio = Date.now();
  let enviados = 0, erros = 0;

  try {
    // Busca respostas prontas pra enviar (delay já passou)
    const { data: queue, error: qErr } = await supabase
      .from('ml_response_queue')
      .select('*')
      .eq('status', 'queued')
      .lte('respond_after', new Date().toISOString())
      .order('respond_after', { ascending: true })
      .limit(20);

    if (qErr) {
      console.error('[ml-respond] query error:', qErr.message);
      return res.status(500).json({ error: qErr.message });
    }

    if (!queue || queue.length === 0) {
      return res.json({ ok: true, enviados: 0, msg: 'nada na fila' });
    }

    console.log(`[ml-respond] ${queue.length} respostas na fila`);

    for (const item of queue) {
      try {
        const token = await getValidToken(item.brand);

        // Verifica se a pergunta ainda está sem resposta (evita duplicata se operador respondeu)
        try {
          const qCheck = await fetch(`${ML_API}/questions/${item.question_id}?api_version=4`, { headers: { Authorization: `Bearer ${token}` } });
          if (qCheck.ok) {
            const qData = await qCheck.json();
            if (qData.status !== 'UNANSWERED') {
              console.log(`[ml-respond] Q${item.question_id} já respondida, cancelando`);
              await supabase.from('ml_response_queue').update({ status: 'cancelled', error: 'já respondida' }).eq('id', item.id);
              continue;
            }
          }
        } catch {}

        // Envia resposta pra ML API
        const ansRes = await fetch(`${ML_API}/answers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ question_id: item.question_id, text: item.response_text }),
        });

        if (ansRes.ok) {
          // Salva no histórico
          await supabase.from('ml_qa_history').insert({
            question_id: item.question_id,
            brand: item.brand,
            item_id: item.item_id,
            question_text: item.question_text,
            answer_text: item.response_text,
            answered_by: item.answered_by,
            answered_at: new Date().toISOString(),
            buyer_id: item.buyer_id || '',
          });

          // Marca como enviado
          await supabase.from('ml_response_queue')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', item.id);

          enviados++;
          console.log(`[ml-respond] ✓ ${item.brand} Q${item.question_id} enviado`);
        } else {
          const errBody = await ansRes.text().catch(() => '');
          const errMsg = `HTTP ${ansRes.status}: ${errBody.slice(0, 200)}`;
          console.error(`[ml-respond] ✗ ${item.brand} Q${item.question_id}:`, errMsg);

          // Se a pergunta já foi respondida (409/400), marca como enviado pra não ficar em loop
          if (ansRes.status === 400 || ansRes.status === 409) {
            await supabase.from('ml_response_queue')
              .update({ status: 'failed', error: errMsg, sent_at: new Date().toISOString() })
              .eq('id', item.id);
          }
          erros++;
        }
      } catch (e) {
        console.error(`[ml-respond] erro Q${item.question_id}:`, e.message);
        await supabase.from('ml_response_queue')
          .update({ status: 'failed', error: e.message })
          .eq('id', item.id);
        erros++;
      }

      // Delay entre envios (evita rate limit ML)
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (e) {
    console.error('[ml-respond] erro fatal:', e.message);
    return res.status(500).json({ error: e.message });
  }

  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`[ml-respond] ✓ ${duracao}s — ${enviados} enviados, ${erros} erros`);
  return res.json({ ok: true, duracao: duracao + 's', enviados, erros });
}
