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

  // ── Busca ampla de exemplos Q&A ──
  let qaExamples = '';
  let debugExamples = [];
  try {
    // 1. Perguntas treinadas manualmente (MANUAL) — prioridade máxima
    // Cada pergunta foi salva 3x (Exitus/Lumia/Muniam), então puxamos mais e deduplicamos
    const { data: manualRaw } = await supabase.from('ml_qa_history')
      .select('question_text, answer_text').eq('item_id', 'MANUAL')
      .neq('answered_by', '_auto_absence').neq('answered_by', '_auto_ia_low')
      .order('answered_at', { ascending: false }).limit(300);

    // Deduplica (mesma pergunta salva em 3 marcas)
    const seen = new Set();
    const manual = (manualRaw || []).filter(qa => {
      const key = qa.question_text.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 2. Perguntas do mesmo item
    const { data: sameItem } = await supabase.from('ml_qa_history')
      .select('question_text, answer_text').eq('item_id', itemId)
      .neq('answered_by', '_auto_absence').neq('answered_by', '_auto_ia_low')
      .order('answered_at', { ascending: false }).limit(5);

    // Filtrar exemplos relevantes por keywords da pergunta
    const keywords = questionText.toLowerCase().replace(/[?!.,;]/g, '').split(/\s+/)
      .filter(w => w.length > 3 && !['para','como','esse','essa','este','esta','qual','quero','voces','vocês','tenho','pode','posso','seria','seria','tambem','também'].includes(w));
    
    const relevantManual = (manual || []).filter(qa =>
      keywords.some(kw => qa.question_text.toLowerCase().includes(kw) || qa.answer_text.toLowerCase().includes(kw))
    ).slice(0, 5);

    // Combinar: mesmo item + manuais relevantes (sem duplicar)
    const combined = [...(sameItem || [])];
    for (const qa of relevantManual) {
      if (!combined.find(c => c.question_text === qa.question_text)) combined.push(qa);
    }
    const final = combined.slice(0, 8);
    debugExamples = final.map(qa => ({ p: qa.question_text.slice(0, 80), r: qa.answer_text.slice(0, 80) }));
    if (final.length > 0) qaExamples = final.map((qa, i) => `Ex${i+1}: P: ${qa.question_text}\nR: ${qa.answer_text}`).join('\n');
  } catch (e) { console.error('[ml-webhook] QA search error:', e.message); }

  let tone = 'Amigável, próxima, vendedora. Foco em conversão.';
  try {
    const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'ml-perguntas-config').maybeSingle();
    if (data?.payload?.config?.ai_tone) tone = data.payload.config.ai_tone;
  } catch {}

  // Horário real de Brasília pra saudação correta
  const brHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours();
  const saudacao = brHour < 12 ? 'Bom dia' : brHour < 18 ? 'Boa tarde' : 'Boa noite';

  // Extrair tipo da peça do título pra linguagem contextual
  const titleLower = title.toLowerCase();
  let tipoPeca = 'peça';
  if (titleLower.includes('vestido')) tipoPeca = 'vestido';
  else if (titleLower.includes('saia')) tipoPeca = 'saia';
  else if (titleLower.includes('calça') || titleLower.includes('calca')) tipoPeca = 'calça';
  else if (titleLower.includes('macacão') || titleLower.includes('macacao')) tipoPeca = 'macacão';
  else if (titleLower.includes('blusa') || titleLower.includes('camisa')) tipoPeca = 'blusa';
  else if (titleLower.includes('bermuda') || titleLower.includes('short')) tipoPeca = 'bermuda';
  else if (titleLower.includes('conjunto')) tipoPeca = 'conjunto';

  const systemPrompt = `Você é uma vendedora experiente de moda feminina no Mercado Livre. Você é simpática, direta e entende de moda.

HORÁRIO ATUAL: ${saudacao} (${brHour}h Brasília)
TIPO DA PEÇA: ${tipoPeca}
TOM: ${tone}

═══ FORMATO DA RESPOSTA ═══
- Comece com "Olá! ${saudacao}!" (EXATAMENTE esse horário, nunca outro)
- Corpo direto e útil (max 380 caracteres no total)
- Despedida VARIADA (não repita "Agradecemos seu contato"). Use: "Qualquer dúvida estou aqui!", "Fico à disposição!", "Se precisar de algo mais é só chamar!", "Estamos aqui pra te ajudar!", "Boas compras!" — varie a cada resposta
- Emoji: no máximo 1 emoji no final, e só quando for natural. Sem emoji forçado. Sem 😊💕 em toda resposta.

═══ GANCHOS DE VENDA (use 1 por resposta, de forma natural) ═══
- Prova social: "Esse ${tipoPeca} é um dos nossos mais vendidos!", "As clientes elogiam muito o caimento!"
- Projeção: "Você vai ficar ótima!", "O caimento desse ${tipoPeca} valoriza muito o corpo!"
- Confiança: "É uma escolha certeira!", "Não vai se arrepender!"
- Use o gancho que fizer sentido com a pergunta. Não force. Se a pergunta é só sobre frete, não precisa de gancho.

═══ REGRAS DE MEDIDAS E TAMANHOS (CRÍTICO) ═══
- PESO sem medidas: ignore o peso, peça busto, cintura e quadril educadamente.
- Se informar medidas: compare CADA medida com a tabela na descrição.
- Medidas caem em tamanhos diferentes: recomende o MAIOR. Diga que as partes menores ficam levemente folgadas e "uma costureira de confiança ajusta facilmente".
- Medida do corpo MAIOR que da peça = APERTADO. NUNCA diga "folgado" nesse caso.
- Ultrapassa o maior tamanho: diga honestamente que não atende.
- NUNCA invente medidas.
- PLUS SIZE: refs 02277, 02601, 02600, 02700, 01628, 02798 têm versão Plus Size (G1/G2/G3). Se medidas > GG e é uma dessas refs, sugira buscar o anúncio Plus Size.

═══ PROIBIÇÕES ═══
- NUNCA "Amícia" (marca da loja física)
- NUNCA "desvestir"
- NUNCA composição do tecido quando perguntam sobre forro (só se tem ou não)
- NUNCA "ideal para dias quentes/frio" — versátil pra todas as estações
- NUNCA invente informações
- NUNCA telefone, WhatsApp, fora da plataforma
- NUNCA sugira enviar fotos
- NUNCA prometa incluir peças no estoque
- Estoque esgotado: "sempre chega reposição, fica de olho no anúncio!"
- Se não souber com certeza: responda APENAS BAIXA_CONFIANCA

═══ EXEMPLOS DE REFERÊNCIA ═══
${qaExamples || 'Nenhum exemplo disponível'}`;

  const claudeRes = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 450,
      system: systemPrompt,
      messages: [{ role: 'user', content: `PRODUTO: ${title}\nDESCRIÇÃO DO ANÚNCIO: ${desc || 'N/A'}\n\nPERGUNTA DA CLIENTE: "${questionText}"\n\nResponda como vendedora:` }],
    }),
  });
  if (!claudeRes.ok) return null;
  const data = await claudeRes.json();
  const response = data.content?.[0]?.text?.trim();
  if (!response) return null;
  const debug = {
    produto: title.slice(0, 60),
    descricao: desc ? `${desc.length} chars` : 'sem descrição',
    exemplos_encontrados: debugExamples.length,
    exemplos: debugExamples,
    modelo: 'claude-sonnet-4-6',
  };
  if (response.includes('BAIXA_CONFIANCA')) return { text: null, confidence: 'low', debug };
  return { text: response, confidence: 'high', debug };
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

      const DELAY_MS = 2 * 60 * 1000; // 2 minutos
      const buyerId = String(question.from?.id || '');
      const respondAfter = new Date(Date.now() + DELAY_MS).toISOString();

      // Helper: enfileira resposta pra envio com delay
      const queueResponse = async (text, answeredBy, debug) => {
        await supabase.from('ml_response_queue').insert({
          question_id: question.id, brand, item_id: question.item_id,
          question_text: question.text, response_text: text,
          answered_by: answeredBy, buyer_id: buyerId,
          respond_after: respondAfter, status: 'queued',
          debug: debug || null,
        });
      };

      // P0: Stock flow — roda SEMPRE (independente do horário)
      if (autoStatus === 'pending') {
        try {
          const stockResult = await handleStockFlow(question, brand, token);
          if (stockResult) {
            await queueResponse(stockResult.text, '_auto_ia', { fonte: 'stock_flow' });
            autoStatus = 'queued_' + stockResult.status;
          }
        } catch (e) { console.error('[ml-webhook] Stock flow error:', e.message); }
      }

      // P1: AI auto-response
      if (autoStatus === 'pending' && inAISchedule) {
        try {
          const aiResult = await getAIAutoResponse(question.text, question.item_id, brand);
          if (aiResult?.confidence === 'high' && aiResult.text) {
            await queueResponse(aiResult.text, '_auto_ia', aiResult.debug);
            autoStatus = 'queued_ia';
          } else {
            // Baixa confiança: NÃO responde, fica como pendente pra humano
            autoStatus = 'ia_low_pending';
            console.log(`[ml-webhook] ${brand} Q${question.id}: IA baixa confiança, deixando pendente`);
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
          await queueResponse(msg, '_auto_absence');
          autoStatus = 'queued_absence';
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
