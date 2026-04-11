import { supabase, getValidToken, isOutsideBusinessHours, getAbsenceMessage, isInAISchedule, getAILowConfidenceMsg } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

async function getAIAutoResponse(questionText, itemId, brand) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  let title = '', desc = '';
  try {
    const token = await getValidToken(brand);
    const [tRes, dRes] = await Promise.all([
      fetch(`${ML_API}/items/${itemId}?attributes=title`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${ML_API}/items/${itemId}/description`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (tRes.ok) title = (await tRes.json()).title || '';
    if (dRes.ok) desc = ((await dRes.json()).plain_text || '').slice(0, 1500);
  } catch {}

  let qaExamples = '';
  try {
    const { data: sameItem } = await supabase.from('ml_qa_history')
      .select('question_text, answer_text').eq('item_id', itemId)
      .neq('answered_by', '_auto_absence').neq('answered_by', '_auto_ia_low')
      .order('answered_at', { ascending: false }).limit(5);
    if (sameItem?.length > 0) {
      qaExamples = sameItem.map((qa, i) => `Ex${i+1}: P: ${qa.question_text}\nR: ${qa.answer_text}`).join('\n');
    }
  } catch {}

  let tone = 'Formal mas amigável. Foco em conversão.';
  try {
    const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'ml-perguntas-config').maybeSingle();
    if (data?.payload?.config?.ai_tone) tone = data.payload.config.ai_tone;
  } catch {}

  const claudeRes = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: `Você é atendente de moda feminina no Mercado Livre.
TOM: ${tone}
REGRAS:
- Gere a resposta COMPLETA com saudação + corpo + despedida
- Saudação: use "Olá! Bom dia!", "Olá! Boa tarde!" ou "Olá! Boa noite!" conforme horário de Brasília
- Despedida: "Agradecemos seu contato! Boas compras!" ou "Qualquer dúvida, estamos à disposição!"
- Max 500 caracteres total
- NUNCA use a palavra "Amícia" — essa marca é da loja física e não deve aparecer nos marketplaces
- NUNCA use a palavra "desvestir"
- NUNCA fale em composição do tecido quando perguntarem sobre forro — responda apenas se tem ou não forro
- NUNCA diga que a peça é "ideal para dias quentes" ou "ideal para o frio" — as peças são versáteis para qualquer clima
- Quando perguntarem sobre estoque esgotado, diga que sempre chega reposição e para ficarem de olho nos anúncios
- NUNCA invente informações que não estejam na descrição ou nos exemplos
- NUNCA passe telefone, WhatsApp ou direcione fora da plataforma
- NUNCA sugira enviar fotos adicionais — as fotos são apenas as do anúncio
- NUNCA prometa incluir peças no estoque ou disponibilizar tamanhos/cores esgotadas
- Se não souber responder com certeza baseado na descrição e exemplos, responda APENAS: BAIXA_CONFIANCA
- Responda APENAS o texto da resposta ou BAIXA_CONFIANCA`,
      messages: [{ role: 'user', content: `PRODUTO: ${title}\nDESCRIÇÃO: ${desc || 'N/A'}\n\nEXEMPLOS:\n${qaExamples || 'Nenhum'}\n\nPERGUNTA: "${questionText}"\n\nResponda:` }],
    }),
  });

  if (!claudeRes.ok) return null;
  const data = await claudeRes.json();
  const response = data.content?.[0]?.text?.trim();
  if (!response) return null;
  if (response.includes('BAIXA_CONFIANCA')) return { text: null, confidence: 'low' };
  return { text: response, confidence: 'high' };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).end();

    const { resource, user_id, topic } = req.body;

    // Mensagens pós-venda → redireciona pro handler de mensagens
    if (topic === 'messages') {
      const { default: messagesHandler } = await import('./ml-messages-webhook.js');
      return messagesHandler(req, res);
    }

    if (topic !== 'questions' || !resource) return res.status(200).json({ ignored: true });

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
      const inAISchedule = await isInAISchedule();
      let autoStatus = 'pending';

      // Prioridade 1: Dentro do horário da IA → resposta automática
      if (inAISchedule) {
        try {
          const aiResult = await getAIAutoResponse(question.text, question.item_id, brand);
          if (aiResult?.confidence === 'high' && aiResult.text) {
            const ansRes = await fetch(`${ML_API}/answers`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ question_id: question.id, text: aiResult.text }),
            });
            if (ansRes.ok) {
              await supabase.from('ml_qa_history').insert({
                question_id: question.id, brand, item_id: question.item_id,
                question_text: question.text, answer_text: aiResult.text,
                answered_by: '_auto_ia', answered_at: new Date().toISOString(),
              });
              autoStatus = 'auto_ia';
            }
          } else {
            const lowMsg = await getAILowConfidenceMsg();
            const ansRes = await fetch(`${ML_API}/answers`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ question_id: question.id, text: lowMsg }),
            });
            if (ansRes.ok) {
              await supabase.from('ml_qa_history').insert({
                question_id: question.id, brand, item_id: question.item_id,
                question_text: question.text, answer_text: lowMsg,
                answered_by: '_auto_ia_low', answered_at: new Date().toISOString(),
              });
              autoStatus = 'auto_ia_low';
            }
          }
        } catch (aiErr) {
          console.error('[ml-webhook] AI error:', aiErr.message);
        }
      }

      // Prioridade 2: Fora do horário → ausência (só se IA não respondeu e ausência ativa)
      if (outside && autoStatus === 'pending') {
        // Checar se ausência está ativada
        let absenceEnabled = false;
        try {
          const { data: cfgData } = await supabase.from('amicia_data').select('payload').eq('user_id', 'ml-perguntas-config').single();
          absenceEnabled = cfgData?.payload?.config?.absence_enabled || false;
        } catch {}

        if (absenceEnabled) {
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
          autoStatus = 'auto_absence';
        }
        } // end absenceEnabled
      }

      await supabase.from('ml_pending_questions').upsert({
        question_id: String(question.id), brand, item_id: question.item_id,
        question_text: question.text, buyer_id: String(question.from?.id || ''),
        date_created: question.date_created, status: autoStatus,
        received_at: new Date().toISOString(),
      }, { onConflict: 'question_id' });
    }

    return res.status(200).json({ processed: true, question_id: question.id });
  } catch (err) {
    console.error('[ml-webhook]', err.message);
    return res.status(200).json({ error: err.message });
  }
}
