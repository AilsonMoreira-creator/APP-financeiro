import { supabase, getValidToken, isOutsideBusinessHours, getAbsenceMessage, isInAISchedule, getAILowConfidenceMsg, getStockColors, detectColorsInText, isColorRequest, detectSizeInText, detectConfirmation } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

function greeting() {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours();
  if (h < 12) return 'Olá! Bom dia!';
  if (h < 18) return 'Olá! Boa tarde!';
  return 'Olá! Boa noite!';
}

// ── Stock flow: check pending offers and handle ──
async function handleStockFlow(question, brand, token) {
  const buyerId = String(question.from?.id || '');
  const itemId = question.item_id;
  const text = question.text || '';
  if (!buyerId || !itemId) return null;

  const { data: pending } = await supabase
    .from('ml_stock_offers')
    .select('*')
    .eq('buyer_id', buyerId)
    .eq('item_id', itemId)
    .in('status', ['aguardando_confirmacao', 'aguardando_cor'])
    .gte('created_at', new Date(Date.now() - 48 * 3600000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  const offer = pending?.[0];

  // CASE A: Aguardando cor → check if question specifies color
  if (offer?.status === 'aguardando_cor') {
    const stockColors = await getStockColors();
    const matched = detectColorsInText(text, stockColors);
    if (matched.length > 0) {
      const coresNomes = matched.map(c => c.nome);
      const tam = offer.tamanho || detectSizeInText(text) || '';
      await supabase.from('ml_stock_offers').update({
        cores: coresNomes, status: 'aguardando_confirmacao', tamanho: tam || offer.tamanho,
      }).eq('id', offer.id);
      const corText = coresNomes.join(' e ');
      const tamText = tam ? ` no tamanho ${tam}` : '';
      return {
        text: `${greeting()} Podemos incluir essa peça na cor ${corText}${tamText} pra você! Caso tenha interesse, é só nos confirmar por aqui que vamos providenciar! Agradecemos seu contato!`,
        status: 'auto_stock_offer',
      };
    }
    return null;
  }

  // CASE B: Aguardando confirmação → check confirm/refuse
  if (offer?.status === 'aguardando_confirmacao') {
    const result = detectConfirmation(text);
    if (result === 'confirmacao') {
      await supabase.from('ml_stock_offers').update({
        status: 'confirmado', confirmed_at: new Date().toISOString(),
      }).eq('id', offer.id);
      const corText = (offer.cores || []).join(', ') || '?';
      const tamText = offer.tamanho ? ` · Tam: ${offer.tamanho}` : '';
      let itemTitle = '';
      try {
        const iRes = await fetch(`${ML_API}/items/${itemId}?attributes=title`, { headers: { Authorization: `Bearer ${token}` } });
        if (iRes.ok) itemTitle = (await iRes.json()).title || '';
      } catch {}
      await supabase.from('ml_stock_alerts').insert({
        brand, item_id: itemId, item_title: itemTitle,
        question_text: `Cores: ${corText}${tamText}`,
        answer_text: 'Cliente confirmou interesse',
        detail: `Cliente confirmou inclusão: ${corText}${tamText}`,
        promised_by: '_stock_flow', promised_at: new Date().toISOString(),
        status: 'pendente',
      });
      return {
        text: `${greeting()} Perfeito! Estamos providenciando a inclusão. Fique de olho no anúncio que atualizamos assim que estiver disponível! Agradecemos seu contato! Boas compras!`,
        status: 'auto_stock_confirmed',
      };
    }
    if (result === 'recusa') {
      await supabase.from('ml_stock_offers').update({ status: 'recusado' }).eq('id', offer.id);
      return {
        text: `${greeting()} Sem problemas! Caso mude de ideia, estamos à disposição. Agradecemos seu contato!`,
        status: 'auto_stock_refused',
      };
    }
    return null;
  }

  // CASE C: No pending → check if stock/color request
  if (!isColorRequest(text)) return null;

  const stockColors = await getStockColors();
  const matched = detectColorsInText(text, stockColors);
  const size = detectSizeInText(text);

  if (matched.length > 0) {
    const coresNomes = matched.map(c => c.nome);
    await supabase.from('ml_stock_offers').insert({
      brand, item_id: itemId, question_id: String(question.id),
      buyer_id: buyerId, cores: coresNomes, tamanho: size || '',
      status: 'aguardando_confirmacao',
    });
    const corText = coresNomes.join(' e ');
    const tamText = size ? ` no tamanho ${size}` : '';
    return {
      text: `${greeting()} Podemos incluir essa peça na cor ${corText}${tamText} pra você! Caso tenha interesse, é só nos confirmar por aqui que vamos providenciar! Agradecemos seu contato!`,
      status: 'auto_stock_offer',
    };
  }

  if (size && matched.length === 0) {
    const mentionsAnyColor = /cor\s+\w+|na\s+cor|no\s+\w+\s*(preto|bege|azul|verde|marrom|vinho|figo|rosa|branco|cinza)/i.test(text);
    if (!mentionsAnyColor) {
      await supabase.from('ml_stock_offers').insert({
        brand, item_id: itemId, question_id: String(question.id),
        buyer_id: buyerId, cores: [], tamanho: size,
        status: 'aguardando_cor',
      });
      return {
        text: `${greeting()} Podemos verificar a disponibilidade do tamanho ${size}! Em qual cor você gostaria? Agradecemos seu contato!`,
        status: 'auto_stock_ask_color',
      };
    }
  }

  return null;
}

// ── AI auto-response ──
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
    if (sameItem?.length > 0) qaExamples = sameItem.map((qa, i) => `Ex${i+1}: P: ${qa.question_text}\nR: ${qa.answer_text}`).join('\n');
  } catch {}
  let tone = 'Formal mas amigável. Foco em conversão.';
  try {
    const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'ml-perguntas-config').maybeSingle();
    if (data?.payload?.config?.ai_tone) tone = data.payload.config.ai_tone;
  } catch {}

  const claudeRes = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: `Você é atendente de moda feminina no Mercado Livre.\nTOM: ${tone}\nREGRAS:\n- Resposta COMPLETA: saudação + corpo + despedida (max 500 chars)\n- Saudação conforme horário de Brasília\n- NUNCA "Amícia", "desvestir"\n- NUNCA composição quando perguntam forro (só se tem ou não)\n- NUNCA "ideal dias quentes/frio" — versátil\n- Estoque esgotado: "sempre chega reposição, fique de olho nos anúncios"\n- NUNCA invente informações\n- NUNCA telefone, WhatsApp, fora da plataforma\n- NUNCA sugira enviar fotos\n- NUNCA prometa incluir peças no estoque\n- Se não souber: responda APENAS BAIXA_CONFIANCA`,
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

// ── Main handler ──
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).end();
    const { resource, user_id, topic } = req.body;

    if (topic === 'messages') {
      const { default: messagesHandler } = await import('./ml-messages-webhook.js');
      return messagesHandler(req, res);
    }
    if (topic !== 'questions' || !resource) return res.status(200).json({ ignored: true });

    const { data: tokenRec } = await supabase.from('ml_tokens').select('brand').eq('seller_id', String(user_id)).single();
    if (!tokenRec) return res.status(200).json({ ignored: true, reason: 'unknown_seller' });

    const brand = tokenRec.brand;
    const token = await getValidToken(brand);
    const qRes = await fetch(`${ML_API}${resource}?api_version=4`, { headers: { Authorization: `Bearer ${token}` } });
    if (!qRes.ok) return res.status(200).json({ error: 'fetch_failed' });
    const question = await qRes.json();

    if (question.status === 'UNANSWERED') {
      const outside = await isOutsideBusinessHours();
      const inAISchedule = await isInAISchedule();
      let autoStatus = 'pending';

      // P0: Stock flow
      if (inAISchedule && autoStatus === 'pending') {
        try {
          const stockResult = await handleStockFlow(question, brand, token);
          if (stockResult) {
            const ansRes = await fetch(`${ML_API}/answers`, {
              method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ question_id: question.id, text: stockResult.text }),
            });
            if (ansRes.ok) {
              await supabase.from('ml_qa_history').insert({
                question_id: question.id, brand, item_id: question.item_id,
                question_text: question.text, answer_text: stockResult.text,
                answered_by: '_auto_ia', answered_at: new Date().toISOString(),
              });
              autoStatus = stockResult.status;
            }
          }
        } catch (e) { console.error('[ml-webhook] Stock flow error:', e.message); }
      }

      // P1: AI auto-response
      if (autoStatus === 'pending' && inAISchedule) {
        try {
          const aiResult = await getAIAutoResponse(question.text, question.item_id, brand);
          if (aiResult?.confidence === 'high' && aiResult.text) {
            const ansRes = await fetch(`${ML_API}/answers`, {
              method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
              method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
        } catch (aiErr) { console.error('[ml-webhook] AI error:', aiErr.message); }
      }

      // P2: Absence
      if (outside && autoStatus === 'pending') {
        let absenceEnabled = false;
        try {
          const { data: cfgData } = await supabase.from('amicia_data').select('payload').eq('user_id', 'ml-perguntas-config').single();
          absenceEnabled = cfgData?.payload?.config?.absence_enabled || false;
        } catch {}
        if (absenceEnabled) {
          const msg = await getAbsenceMessage();
          const ansRes = await fetch(`${ML_API}/answers`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
        }
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
