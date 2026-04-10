import { supabase, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

async function getItemContext(itemId, brand) {
  try {
    const token = await getValidToken(brand);
    const [titleRes, descRes] = await Promise.all([
      fetch(`${ML_API}/items/${itemId}?attributes=title`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${ML_API}/items/${itemId}/description`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const title = titleRes.ok ? (await titleRes.json()).title || '' : '';
    const desc = descRes.ok ? ((await descRes.json()).plain_text || '').slice(0, 1500) : '';
    return { title, desc };
  } catch { return { title: '', desc: '' }; }
}

async function getSimilarQA(questionText, itemId) {
  try {
    const { data: sameItem } = await supabase.from('ml_qa_history')
      .select('question_text, answer_text').eq('item_id', itemId)
      .neq('answered_by', '_auto_absence').order('answered_at', { ascending: false }).limit(3);

    const { data: recent } = await supabase.from('ml_qa_history')
      .select('question_text, answer_text').neq('answered_by', '_auto_absence')
      .order('answered_at', { ascending: false }).limit(20);

    const keywords = questionText.toLowerCase().replace(/[?!.,]/g, '').split(/\s+/).filter(w => w.length > 3);
    const relevant = (recent || []).filter(qa =>
      keywords.some(kw => qa.question_text.toLowerCase().includes(kw))
    ).slice(0, 3);

    const combined = [...(sameItem || [])];
    for (const qa of relevant) {
      if (!combined.find(c => c.question_text === qa.question_text)) combined.push(qa);
    }
    return combined.slice(0, 5);
  } catch { return []; }
}

async function getAIConfig() {
  try {
    const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'ml-perguntas-config').single();
    return {
      tone: data?.payload?.config?.ai_tone || 'Formal mas amigável. Foco em conversão.',
      enabled: data?.payload?.config?.ai_enabled !== false,
    };
  } catch { return { tone: 'Formal mas amigável. Foco em conversão.', enabled: true }; }
}

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.json({ suggestion: null, reason: 'ANTHROPIC_API_KEY not configured' });
    }

    const { question_text, item_id, brand } = req.body;
    if (!question_text) return res.status(400).json({ error: 'Missing question_text' });

    // Quiz mode: IA gera pergunta pra admin responder
    if (question_text === '_QUIZ_MODE_') {
      if (!process.env.ANTHROPIC_API_KEY) return res.json({ suggestion: null });
      
      let recentQA = '';
      try {
        const { data: recent } = await supabase.from('ml_qa_history')
          .select('question_text').neq('answered_by', '_auto_absence')
          .order('answered_at', { ascending: false }).limit(20);
        if (recent?.length > 0) {
          recentQA = recent.map(q => q.question_text).join('\n');
        }
      } catch {}

      const quizRes = await fetch(CLAUDE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 200,
          system: `Você é um comprador no Mercado Livre querendo comprar roupas femininas de linho/alfaiataria. Gere UMA pergunta realista que um cliente faria sobre tamanhos, tecido, medidas, cuidados ou disponibilidade. A pergunta deve ser diferente destas já existentes:\n${recentQA}\n\nRetorne APENAS a pergunta, sem aspas.`,
          messages: [{ role: 'user', content: 'Gere uma pergunta de cliente:' }],
        }),
      });
      if (quizRes.ok) {
        const qData = await quizRes.json();
        return res.json({ suggestion: qData.content?.[0]?.text?.trim() || null });
      }
      return res.json({ suggestion: null });
    }

    const aiConfig = await getAIConfig();
    if (!aiConfig.enabled) return res.json({ suggestion: null, reason: 'AI disabled' });

    const [ctx, similarQA] = await Promise.all([
      item_id ? getItemContext(item_id, brand || 'Exitus') : { title: '', desc: '' },
      getSimilarQA(question_text, item_id || ''),
    ]);

    const qaExamples = similarQA.length > 0
      ? similarQA.map((qa, i) => `Ex${i + 1}: P: ${qa.question_text}\nR: ${qa.answer_text}`).join('\n')
      : 'Nenhum exemplo ainda.';

    const claudeRes = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: `Você é atendente de moda feminina no Mercado Livre. TOM: ${aiConfig.tone}. Gere resposta COMPLETA: saudação (Olá! Bom dia/Boa tarde/Boa noite conforme horário) + corpo + despedida (Agradecemos seu contato!). Max 500 chars. NUNCA use a palavra "Amícia" — essa marca é da loja física. NUNCA invente info. NUNCA sugira enviar fotos. NUNCA prometa incluir peças no estoque. NUNCA passe telefone ou direcione fora da plataforma. Fotos são apenas as do anúncio.`,
        messages: [{ role: 'user', content: `PRODUTO: ${ctx.title}\nDESCRIÇÃO: ${ctx.desc || 'N/A'}\n\nEXEMPLOS:\n${qaExamples}\n\nPERGUNTA: "${question_text}"\n\nSugira resposta:` }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json();
      return res.status(500).json({ error: 'AI error', detail: err });
    }

    const data = await claudeRes.json();
    return res.json({
      suggestion: data.content?.[0]?.text?.trim() || null,
      context: { has_description: !!ctx.desc, similar_qa_count: similarQA.length },
    });
  } catch (err) {
    console.error('[ml-ai]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
