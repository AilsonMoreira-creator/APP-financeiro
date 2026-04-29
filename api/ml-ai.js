import { supabase, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

async function getItemContext(itemId, brand) {
  try {
    const token = await getValidToken(brand);
    const [itemRes, descRes] = await Promise.all([
      fetch(`${ML_API}/items/${itemId}?attributes=title,attributes,variations,available_quantity,seller_custom_field,price`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${ML_API}/items/${itemId}/description`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    let title = '', itemContext = '';
    if (itemRes.ok) {
      const item = await itemRes.json();
      title = item.title || '';
      const attrs = (item.attributes || [])
        .filter(a => a.value_name && !['Item condition', 'Listing type'].includes(a.name))
        .map(a => `${a.name}: ${a.value_name}`).join('\n');
      const variations = (item.variations || []).map(v => {
        const combos = (v.attribute_combinations || []).map(a => `${a.name}: ${a.value_name}`).join(', ');
        return `${combos} → ${v.available_quantity > 0 ? v.available_quantity + ' estoque' : 'ESGOTADO'}`;
      }).join('\n');
      itemContext = `TÍTULO: ${title}`;
      if (item.seller_custom_field) itemContext += `\nREF: ${item.seller_custom_field}`;
      if (item.price) itemContext += `\nPREÇO: R$ ${item.price}`;
      itemContext += `\nESTOQUE: ${item.available_quantity || 0}`;
      if (attrs) itemContext += `\n\nATRIBUTOS:\n${attrs}`;
      if (variations) itemContext += `\n\nVARIAÇÕES:\n${variations}`;
    }
    const desc = descRes.ok ? ((await descRes.json()).plain_text || '').slice(0, 4000) : '';
    return { title, desc, itemContext };
  } catch { return { title: '', desc: '', itemContext: '' }; }
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

    // ── Extração inteligente de keywords ──
    const STOPWORDS = new Set([
      'para','como','esse','essa','este','esta','qual','quero','voces','vocês',
      'tenho','pode','posso','seria','tambem','também','gostaria','modelo',
      'teria','desse','deste','dessa','desta','muito','mais','ainda','aqui',
      'favor','obrigada','obrigado','comprar','comprei','anuncio','anúncio',
      'pergunta','ola','olá','bom','boa','dia','tarde','noite','por','com',
      'uma','uns','umas','que','não','nao','sim','está','esta','tem','ter',
    ]);
    const rawWords = questionText.toLowerCase().replace(/[?!.,;:()]/g, '').split(/\s+/);
    const keywords = rawWords.filter(w => w.length >= 2 && !STOPWORDS.has(w));
    const qLower = questionText.toLowerCase();
    const expandedKeywords = [...keywords];
    if (qLower.match(/\b(forro|forrado|forrada)\b/)) expandedKeywords.push('forro', 'forrado');
    if (qLower.match(/\b(tamanho|tam|medida|medidas|visto|veste|vestir|cabe)\b/)) expandedKeywords.push('tamanho', 'medida', 'medidas', 'veste');
    if (qLower.match(/\b(cor|cores|preto|bege|figo|marrom|azul|verde|branco|vinho|rosa|nude|caramelo)\b/)) expandedKeywords.push('cor', 'disponível', 'cores');
    if (qLower.match(/\b(tecido|linho|viscolinho|material)\b/)) expandedKeywords.push('tecido', 'linho', 'material');
    if (qLower.match(/\b(entrega|entregar|chega|frete|prazo|flex)\b/)) expandedKeywords.push('entrega', 'prazo', 'frete');
    if (qLower.match(/\b(lavar|lavagem|passar|ferro|cuidado)\b/)) expandedKeywords.push('lavar', 'lavagem', 'cuidado');
    if (qLower.match(/\b(plus|maior|grande|g1|g2|g3)\b/)) expandedKeywords.push('plus', 'tamanho', 'maior');
    if (qLower.match(/\b(estoque|disponível|disponivel|acabou|esgotado|volta)\b/)) expandedKeywords.push('estoque', 'disponível', 'reposição');
    const uniqueKeywords = [...new Set(expandedKeywords)];
    
    const relevantManual = (manual || []).filter(qa =>
      uniqueKeywords.some(kw => qa.question_text.toLowerCase().includes(kw) || qa.answer_text.toLowerCase().includes(kw))
    ).slice(0, 5);

    const fallbackManual = (manual || []).slice(0, 2);

    // Combinar: MANUAL primeiro, depois sameItem humano, fallback
    const combined = [...relevantManual];
    for (const qa of (sameItem || [])) {
      if (!combined.find(c => c.question_text === qa.question_text)) combined.push(qa);
    }
    for (const qa of fallbackManual) {
      if (combined.length >= 8) break;
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

    // ── CROSS-SELL PLUS SIZE ──
    const PLUS_CATEGORIAS = [
      { keywords: ['vestido', 'linho', 'midi'], search: 'vestido linho midi plus size' },
      { keywords: ['macacão', 'linho'], search: 'macacão linho plus size' },
      { keywords: ['macacao', 'linho'], search: 'macacão linho plus size' },
      { keywords: ['saia', 'linho'], search: 'saia midi linho plus size' },
      { keywords: ['saia', 'midi'], search: 'saia midi linho plus size' },
      { keywords: ['calça', 'linho'], search: 'calça pantalona linho plus size' },
      { keywords: ['calca', 'linho'], search: 'calça pantalona linho plus size' },
      { keywords: ['pantalona'], search: 'calça pantalona linho plus size' },
      { keywords: ['vestido', 'verona'], search: 'vestido verona plus size' },
      { keywords: ['cropped', 'viscolinho'], search: 'cropped viscolinho plus size' },
    ];
    const isPlus = titleLower.includes('plus size') || titleLower.includes('plussize');
    let plusCrossSell = '';
    if (!isPlus) {
      for (const cat of PLUS_CATEGORIAS) {
        if (cat.keywords.every(k => titleLower.includes(k))) { plusCrossSell = cat.search; break; }
      }
    }

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
HORÁRIO: ${saudacao} (${brHour}h) | PEÇA: ${tipoPeca} | TOM: ${aiConfig.tone}

PROCESSO INTERNO (pense, mas NÃO escreva na resposta): 1) Classifique. 2) Consulte fontes. 3) Se não encontrou: BAIXA_CONFIANCA.
SUA SAÍDA deve ser APENAS o texto da resposta pra cliente. Sem passos, sem classificação, sem raciocínio.
FONTES pra disponibilidade/medidas: dados anúncio → descrição → exemplos.
FONTES pra produto/tecido: BASE DE CONHECIMENTO → exemplos → descrição.
REGRA DE OURO: Não está nas fontes = BAIXA_CONFIANCA. NUNCA invente.

BASE DE CONHECIMENTO (universal):
TECIDOS (só fale composição se perguntarem):
• Linho/Viscolinho: tecido nobre, fibras naturais, pouco encolhimento. Composição: linho com viscose.
• Linho com Elastano: linho + 3% elastano, mais flexibilidade. Anúncio menciona "elastano".
• Verona: alfaiataria leve, bastante movimento, se ajusta ao corpo, leve elastano.
• Tricoline: tecido nobre de algodão.
• Suplex Poliamida: bastante elastano, mais respirável. Anúncio menciona "poliamida".
• Suplex (sem poliamida): poliéster com elastano.
FORRO: só diga se tem ou não. NUNCA composição.
CORES da loja: Preto, Bege, Natural, Figo, Marrom, Marrom Escuro, Azul Marinho, Vinho, Verde, Terracota, Rose, Off White, Cappuccino, Areia — são CORES, não tamanhos.
TABELA PADRÃO (medidas corporais cm): P(36/38) B88-92 C70-75 Q96-102 | M(40) B92-96 C76-79 Q102-106 | G(42) B96-100 C80-83 Q106-110 | GG(44) B100-104 C84-86 Q110-114 | Plus: G1(46) B110 C92 Q124 | G2(48) B114 C96 Q128 | G3(50) B118 C100 Q132. Se anúncio tem tabela própria, use a do anúncio. Medidas em tamanhos diferentes → MAIOR + "costureira ajusta".

DISPONIBILIDADE: Separe COR de TAMANHO (figo GG = cor figo, tam GG). Consulte VARIAÇÕES nos dados do anúncio. NUNCA confunda cor com tamanho.
MEDIDAS: Peso → peça busto/cintura/quadril. Numeração (38,40,42) → peça medidas (varia entre marcas). Com medidas → tabela na descrição → MAIOR tamanho → "costureira ajusta". Medidas parciais → usa a informada + pede o resto. Corpo > peça = APERTADO. NUNCA invente. NUNCA recomende menor.
TAMANHO ESPECÍFICO: Se cliente perguntou diretamente sobre 1 tamanho ("o GG serve?", "M dá em mim?") COM medidas/peso/altura, NÃO peça mais dados — RESPONDA usando a tabela: "GG (44): busto 100-104, cintura 84-86, quadril 110-114cm". Se ela passou só peso/altura SEM medidas: "Esse tamanho costuma servir de B até C de busto, é comum quem tem [peso/altura] caber, mas o que conta é a medida do busto/cintura/quadril — consegue medir?". NÃO mude o assunto pra cor/disponibilidade se ela só perguntou tamanho.
CONTEXTO DA CONVERSA: Releia as mensagens recentes. Se a cliente está respondendo a uma pergunta SUA anterior (ex: você perguntou cor, ela respondeu "verde e preto"), apenas CONFIRME a info — NÃO volte ao zero perguntando tamanho/disponibilidade. Continue a conversa de onde parou.
COR DE PEÇA NO VÍDEO/FOTO: Se cliente pergunta "qual a cor da peça do vídeo?" ou "que cor é essa que aparece na foto?" → BAIXA_CONFIANCA. IA não consegue ver vídeo nem foto, deixa pro humano responder.
PLUS SIZE: ${plusCrossSell ? `Este modelo TEM versão Plus Size (G1/G2/G3)! Se a cliente precisa de tamanho maior, diga: "Temos esse modelo em Plus Size! Busque por '${plusCrossSell}' nos nossos anúncios!"` : `Medidas > maior tamanho → "Alguns dos nossos modelos possuem versão Plus Size! Vale buscar por 'plus size' nos nossos anúncios." NUNCA afirme que aquele modelo específico tem Plus Size.`}
PEÇA SEM A CARACTERÍSTICA PEDIDA: Se cliente pergunta variação que NÃO temos (ex: "tem vestido linho com manga?", "tem essa saia em outro tom?"), responda DIRETO que não temos com essa característica MAS indique nossos modelos similares deixando CLARO o que muda. Ex: "Esse vestido de linho é sem manga, não temos com manga. Mas temos outros modelos de linho lindos (todos sem manga) — vale dar uma olhada nos nossos anúncios!". Sempre explicita a diferença pra cliente saber o que vai ver.
ENTREGA: "Chega amanhã?" → "Se for Flex, próximo dia útil! Prazos no anúncio conforme CEP." Prazo/frete → "Aparece no anúncio conforme CEP!" Rastreamento → "Acompanhe em Minhas Compras." NUNCA prometa prazo.
ESGOTADO: Tom de venda! "Repomos com frequência e as peças voam rápido! Salva nos favoritos pra não perder!"
PRODUTO: Comprimento → só se na descrição (midi, longo, curto, mini). NUNCA invente cm — EXCETO saia de linho midi (regra abaixo). Transparência → se não mencionada, cores claras sem forro podem ter leve transparência. Lavagem → Linho: ciclo delicado, não torcer. Suplex: pode lavar máquina. Na dúvida: "siga a etiqueta".
SAIA LINHO MIDI: título com "saia"+"linho" e cliente pergunta comprimento → "Nossas saias midi de linho têm em média 75cm de comprimento, podendo variar um pouco por modelo e tamanho. A modelo da foto tem 1,68m de altura e a saia fica um pouco abaixo do joelho."
TROCAS: ML não tem opção de troca. Cliente pede troca → explicar: "O Mercado Livre não tem a opção de troca. O processo é abrir uma devolução pelo Mercado Livre e, em seguida, fazer uma nova compra com a peça desejada. É só ir em 'Minhas Compras' e abrir a devolução por lá!"
NUNCA "ideal dias quentes/frio" — versátil pra todas as estações.
FORMATO: "Olá! ${saudacao}!" + 100-380 chars + despedida variada. Se múltiplas perguntas, responda TODAS. Emoji max 1. NUNCA **negrito**.
GANCHOS (1, natural): "dos mais vendidos!", "clientes elogiam!", "vai ficar ótima!". Não em entrega/pós-venda.
PROIBIÇÕES: "Amícia", "desvestir", inventar, telefone/WhatsApp, enviar fotos, prometer desconto/cupom, inventar medidas em cm. Conjunto → "Temos uma opção de conjunto nos nossos anúncios!" Se não souber: BAIXA_CONFIANCA.
EXEMPLOS: ${qaExamples}`,
        messages: [{ role: 'user', content: `═══ DADOS DO ANÚNCIO ═══\n${ctx.itemContext || 'TÍTULO: ' + ctx.title}\n\n═══ DESCRIÇÃO ═══\n${ctx.desc || 'Sem descrição'}\n\n═══ PERGUNTA ═══\n"${question_text}"\n\nResponda APENAS com o texto final (sem passos nem classificação):` }],
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
