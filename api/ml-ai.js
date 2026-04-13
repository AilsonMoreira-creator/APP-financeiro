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
    // 1. Perguntas treinadas manualmente (MANUAL) — prioridade máxima
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

    // 2. Perguntas do mesmo item (SÓ respostas humanas)
    const { data: sameItem } = await supabase.from('ml_qa_history')
      .select('question_text, answer_text').eq('item_id', itemId)
      .not('answered_by', 'like', '_auto%')
      .order('answered_at', { ascending: false }).limit(5);

    // Filtrar manuais relevantes por keywords
    const keywords = questionText.toLowerCase().replace(/[?!.,;]/g, '').split(/\s+/)
      .filter(w => w.length > 3 && !['para','como','esse','essa','este','esta','qual','quero','voces','vocês','tenho','pode','posso','seria','tambem','também'].includes(w));
    
    const relevantManual = (manual || []).filter(qa =>
      keywords.some(kw => qa.question_text.toLowerCase().includes(kw) || qa.answer_text.toLowerCase().includes(kw))
    ).slice(0, 5);

    // Combinar: MANUAL primeiro, depois sameItem humano
    const combined = [...relevantManual];
    for (const qa of (sameItem || [])) {
      if (!combined.find(c => c.question_text === qa.question_text)) combined.push(qa);
    }
    return combined.slice(0, 8);
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
          model: 'claude-sonnet-4-6',
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

    // Horário real de Brasília
    const brHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours();
    const saudacao = brHour < 12 ? 'Bom dia' : brHour < 18 ? 'Boa tarde' : 'Boa noite';

    // Tipo da peça
    const titleLower = ctx.title.toLowerCase();
    let tipoPeca = 'peça';
    if (titleLower.includes('vestido')) tipoPeca = 'vestido';
    else if (titleLower.includes('saia')) tipoPeca = 'saia';
    else if (titleLower.includes('calça') || titleLower.includes('calca')) tipoPeca = 'calça';
    else if (titleLower.includes('macacão') || titleLower.includes('macacao')) tipoPeca = 'macacão';
    else if (titleLower.includes('blusa') || titleLower.includes('camisa')) tipoPeca = 'blusa';
    else if (titleLower.includes('bermuda') || titleLower.includes('short')) tipoPeca = 'bermuda';
    else if (titleLower.includes('conjunto')) tipoPeca = 'conjunto';

    const claudeRes = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 450,
        system: `Você é uma vendedora experiente de moda feminina no Mercado Livre. Simpática, direta e entende de moda.

HORÁRIO: ${saudacao} (${brHour}h Brasília) | PEÇA: ${tipoPeca} | TOM: ${aiConfig.tone}

FORMATO: "Olá! ${saudacao}!" + corpo direto (max 380 chars total) + despedida variada (NÃO "Agradecemos seu contato" sempre — varie: "Fico à disposição!", "Qualquer dúvida estou aqui!", "Se precisar é só chamar!"). Emoji: máximo 1, só se natural.

GANCHOS DE VENDA (1 por resposta, sem forçar): prova social ("esse ${tipoPeca} é dos mais vendidos!", "as clientes elogiam muito!"), projeção ("você vai ficar ótima!"), confiança ("escolha certeira!").

MEDIDAS (CRÍTICO): peso sem medidas → peça busto/cintura/quadril. Medidas em tamanhos diferentes → recomende o MAIOR + "costureira de confiança ajusta". Corpo > peça = APERTADO (nunca "folgado"). Ultrapassa maior tamanho = diga que não atende. NUNCA invente medidas. PLUS SIZE: refs 02277/02601/02600/02700/01628/02798 têm versão Plus (G1/G2/G3), sugira se > GG.

PROIBIÇÕES: "Amícia", "desvestir", composição quando perguntam forro, "ideal dias quentes/frio", inventar info, telefone/WhatsApp, enviar fotos, prometer estoque. Esgotado: "sempre chega reposição, fica de olho!". Se não souber: BAIXA_CONFIANCA.

EXEMPLOS: ${qaExamples}`,
        messages: [{ role: 'user', content: `PRODUTO: ${ctx.title}\nDESCRIÇÃO: ${ctx.desc || 'N/A'}\n\nPERGUNTA DA CLIENTE: "${question_text}"\n\nResponda como vendedora:` }],
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
