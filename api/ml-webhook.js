import { supabase, getValidToken, isOutsideBusinessHours, getAbsenceMessage, isInAISchedule, getAILowConfidenceMsg, getStockColors, detectColorsInText, isColorRequest, detectSizeInText, detectConfirmation } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

function greeting() {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours();
  if (h < 12) return 'Olá! Bom dia!';
  if (h < 18) return 'Olá! Boa tarde!';
  return 'Olá! Boa noite!';
}

// ── Forecast: prevê chegada de cor NÃO cadastrada via módulo Oficinas Cortes ──
// Retorna { text, status } ou null se não houver produção ativa da cor pedida.
const FORECAST_PRAZO_MEDIO = 22;
const FORECAST_JANELA_DIAS = 30;

function _normCor(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}
function _refMatch(a, b) {
  if (!a || !b) return false;
  return String(a).replace(/^0+/, '').trim() === String(b).replace(/^0+/, '').trim();
}
function _corMatch(corCliente, coresArr) {
  const norm = _normCor(corCliente);
  if (!norm) return null;
  for (const c of (coresArr || [])) {
    const nO = _normCor(c.nome);
    if (!nO) continue;
    if (nO === norm || nO.includes(norm) || norm.includes(nO)) return c;
  }
  return null;
}
function _extractRefRegex(scf) {
  if (!scf) return null;
  const t = String(scf).trim();
  const m = t.match(/\(\s*(?:ref\s*)?(\d{3,5})\s*\)/i);
  if (m) return String(parseInt(m[1], 10)).padStart(5, '0');
  const m2 = t.match(/^\s*0*(\d{3,5})\s*$/);
  if (m2) return String(parseInt(m2[1], 10)).padStart(5, '0');
  return null;
}

// Extrai primeira cor mencionada no texto que NÃO está nas 7 carro-chefe
const FORECAST_CORES_AMPLAS = [
  'azul bebe','azul bebê','azul claro','azul royal','azul escuro','azul',
  'verde agua','verde água','verde militar','verde oliva','verde menta','verde',
  'branco','branca','off white','off-white','natural','creme','nude','cru',
  'rosa','rose','rosê','pink','salmao','salmão','coral',
  'amarelo','mostarda','dourado',
  'vermelho','terracota','tijolo',
  'cinza','grafite','prata',
  'caramelo','cappuccino','chocolate','caqui','areia',
  'lilas','lilás','roxo','lavanda',
];
function _extrairCorNaoCadastrada(text, stockColorsNomes) {
  const lower = _normCor(text);
  const stockNorm = stockColorsNomes.map(_normCor);
  // Tenta casar cores mais específicas primeiro (mais longas)
  const ordered = [...FORECAST_CORES_AMPLAS].sort((a, b) => b.length - a.length);
  for (const c of ordered) {
    const cn = _normCor(c);
    if (!lower.includes(cn)) continue;
    // Se essa cor JÁ bate com uma cor cadastrada (ex: "azul" bate com "Azul Marinho"), pula
    const isStockColor = stockNorm.some(s => s.includes(cn) || cn.includes(s));
    if (isStockColor) continue;
    return c;
  }
  return null;
}

async function tryStockForecast(text, itemId, brand, token, questionId) {
  try {
    const stockColors = await getStockColors();
    const stockNomes = stockColors.map(c => c.nome);
    const corPedida = _extrairCorNaoCadastrada(text, stockNomes);
    if (!corPedida) return null;

    // Pega SCF do item
    const itemRes = await fetch(
      `${ML_API}/items/${itemId}?attributes=seller_custom_field`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!itemRes.ok) return null;
    const itemData = await itemRes.json();
    const scfTrim = String(itemData.seller_custom_field || '').trim();

    // Resolve REF: scf_map → regex
    let ref = null;
    if (scfTrim) {
      const { data: scfRow } = await supabase
        .from('ml_scf_ref_map').select('ref').eq('scf', scfTrim).maybeSingle();
      if (scfRow?.ref) ref = String(scfRow.ref).replace(/^0+/, '').padStart(5, '0');
    }
    if (!ref) ref = _extractRefRegex(scfTrim);
    if (!ref) return null;

    // Busca ailson_cortes
    const { data: row } = await supabase.from('amicia_data')
      .select('payload').eq('user_id', 'ailson_cortes').maybeSingle();
    const todosCortes = row?.payload?.cortes || [];

    // Filtra ativos da REF
    const desdeMs = Date.now() - FORECAST_JANELA_DIAS * 86400000;
    const ativos = todosCortes.filter(c => {
      if (!c || c.entregue) return false;
      if (!_refMatch(c.ref, ref)) return false;
      const dt = new Date(c.data).getTime();
      return !isNaN(dt) && dt >= desdeMs;
    }).sort((a, b) => new Date(b.data) - new Date(a.data));

    // Procura corte que tem a cor na matriz
    let escolhido = null;
    for (const c of ativos) {
      const coresM = c.detalhes?.cores;
      if (!Array.isArray(coresM) || coresM.length === 0) continue;
      const matched = _corMatch(corPedida, coresM);
      if (matched) { escolhido = { ...c, _cor: matched }; break; }
    }
    if (!escolhido) return null;

    const dec = Math.floor((Date.now() - new Date(escolhido.data).getTime()) / 86400000);
    const rest = FORECAST_PRAZO_MEDIO - dec;
    const corNome = escolhido._cor?.nome || corPedida;

    // Se atrasado (passou dos 22 dias): não promete, deixa IA responder
    if (rest <= 0) return null;

    // Registra em stock_offers pra rastrear que oferecemos forecast
    await supabase.from('ml_stock_offers').insert({
      brand, item_id: itemId, question_id: String(questionId || ''),
      cores: [corNome], tamanho: '',
      status: 'forecast_informado',
      detalhes: { ref, corte_id: escolhido.id, dias_decorridos: dec, dias_restantes: rest },
    });

    if (rest <= 7) {
      return {
        text: `${greeting()} Boa notícia: este modelo na cor ${corNome} está em fase final de produção e a previsão é chegar nos próximos dias (até 7 dias). Fique de olho no anúncio que atualizamos assim que estiver disponível! Agradecemos seu contato!`,
        status: 'auto_stock_forecast_short',
      };
    }
    return {
      text: `${greeting()} Este modelo na cor ${corNome} está em produção e deve chegar nas próximas semanas. Fique de olho no anúncio que atualizamos assim que estiver disponível! Agradecemos seu contato!`,
      status: 'auto_stock_forecast_long',
    };
  } catch (e) {
    console.error('[forecast] erro:', e.message);
    return null;
  }
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
    // Verifica se o cliente já mencionou QUALQUER cor (mesmo fora das 7 do stock)
    const ALL_COLORS = /\b(preto|preta|bege|azul|verde|marrom|marron|vinho|figo|rosa|branco|branca|cinza|caramelo|cappuccino|off\s*white|natural|nude|terracota|caqui|areia|azul\s*marinho|marrom\s*escuro|verde\s*militar|rose)\b/i;
    const mentionsAnyColor = ALL_COLORS.test(text);
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
    // Cliente disse cor + tamanho mas cor NÃO é do stock → tenta forecast via Oficinas Cortes
    const forecast = await tryStockForecast(text, itemId, brand, token, question.id);
    if (forecast) return forecast;
    // Sem produção ativa dessa cor → deixa IA Claude responder
    return null;
  }
  // Cliente disse cor não-stock SEM tamanho → tenta forecast também
  if (!size && matched.length === 0) {
    const ALL_COLORS = /\b(azul|verde|branco|branca|creme|nude|rosa|amarelo|vermelho|cinza|caramelo|off\s*white|natural|terracota|caqui|areia|mostarda|lilas|lilás|roxo|coral|salmao|salmão)\b/i;
    if (ALL_COLORS.test(text)) {
      const forecast = await tryStockForecast(text, itemId, brand, token, question.id);
      if (forecast) return forecast;
    }
    return null;
  }
}

// ── AI auto-response ──
async function getAIAutoResponse(questionText, itemId, brand) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  
  // ── Buscar contexto completo do anúncio ──
  let title = '', desc = '', itemContext = '';
  try {
    const token = await getValidToken(brand);
    const [itemRes, descRes] = await Promise.all([
      fetch(`${ML_API}/items/${itemId}?attributes=title,attributes,variations,available_quantity,seller_custom_field,price,sale_terms`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${ML_API}/items/${itemId}/description`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    
    if (itemRes.ok) {
      const item = await itemRes.json();
      title = item.title || '';
      
      // Atributos estruturados (composição, marca, gênero, etc)
      const attrs = (item.attributes || [])
        .filter(a => a.value_name && !['Item condition', 'Listing type'].includes(a.name))
        .map(a => `${a.name}: ${a.value_name}`)
        .join('\n');
      
      // Variações (cores e tamanhos disponíveis com estoque)
      const variations = (item.variations || []).map(v => {
        const combos = (v.attribute_combinations || []).map(a => `${a.name}: ${a.value_name}`).join(', ');
        const qty = v.available_quantity || 0;
        return `${combos} → ${qty > 0 ? qty + ' em estoque' : 'ESGOTADO'}`;
      }).join('\n');
      
      // Estoque total
      const totalStock = item.available_quantity || 0;
      
      // Seller custom field (REF do produto)
      const sellerField = item.seller_custom_field || '';
      
      // Montar contexto estruturado
      itemContext = `TÍTULO: ${title}`;
      if (sellerField) itemContext += `\nREF DO VENDEDOR: ${sellerField}`;
      if (item.price) itemContext += `\nPREÇO: R$ ${item.price}`;
      itemContext += `\nESTOQUE TOTAL: ${totalStock}`;
      if (attrs) itemContext += `\n\nATRIBUTOS DO PRODUTO:\n${attrs}`;
      if (variations) itemContext += `\n\nVARIAÇÕES DISPONÍVEIS (cor/tamanho + estoque):\n${variations}`;
    }
    
    if (descRes.ok) desc = ((await descRes.json()).plain_text || '').slice(0, 4000);
  } catch (e) { console.error('[ml-webhook] item fetch error:', e.message); }

  // ── Busca ampla de exemplos Q&A ──
  let qaExamples = '';
  let debugExamples = [];
  let debugKeywords = [];
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

    // 2. Perguntas do mesmo item (SÓ respostas humanas, não auto-IA)
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
    
    // Extrai keywords da pergunta (min 2 chars, sem stopwords)
    const rawWords = questionText.toLowerCase().replace(/[?!.,;:()]/g, '').split(/\s+/);
    const keywords = rawWords.filter(w => w.length >= 2 && !STOPWORDS.has(w));
    
    // Expande keywords com sinônimos/tópicos relacionados
    const expandedKeywords = [...keywords];
    const qLower = questionText.toLowerCase();
    if (qLower.match(/\b(forro|forrado|forrada)\b/)) expandedKeywords.push('forro', 'forrado');
    if (qLower.match(/\b(tamanho|tam|medida|medidas|visto|veste|vestir|cabe)\b/)) expandedKeywords.push('tamanho', 'medida', 'medidas', 'veste', 'cabe');
    if (qLower.match(/\b(cor|cores|preto|bege|figo|marrom|azul|verde|branco|vinho|rosa|nude|caramelo)\b/)) expandedKeywords.push('cor', 'disponível', 'disponivel', 'cores');
    if (qLower.match(/\b(tecido|linho|viscolinho|material|composição|composicao)\b/)) expandedKeywords.push('tecido', 'linho', 'material');
    if (qLower.match(/\b(entrega|entregar|chega|frete|prazo|flex|amanhã|amanha)\b/)) expandedKeywords.push('entrega', 'prazo', 'frete', 'flex');
    if (qLower.match(/\b(lavar|lava|lavagem|passar|ferro|cuidado|encolhe|encolhimento)\b/)) expandedKeywords.push('lavar', 'lavagem', 'cuidado', 'encolhe');
    if (qLower.match(/\b(plus|maior|grande|g1|g2|g3|46|48|50|52)\b/)) expandedKeywords.push('plus', 'tamanho', 'maior');
    if (qLower.match(/\b(estoque|disponível|disponivel|acabou|esgotado|volta)\b/)) expandedKeywords.push('estoque', 'disponível', 'reposição');
    if (qLower.match(/\b(comprimento|compri|midi|longo|curto|mini|joelho)\b/)) expandedKeywords.push('comprimento', 'midi', 'longo');
    if (qLower.match(/\b(transparente|transparência|transparencia|translúcid)\b/)) expandedKeywords.push('transparente', 'forro');
    if (qLower.match(/\b(bojo|sustentação|sustentacao|estrutura.*busto|enchimento)\b/)) expandedKeywords.push('bojo', 'forro', 'dupla');
    if (qLower.match(/\b(desconto|promoção|promocao|cupom|mais barato)\b/)) expandedKeywords.push('preço', 'valor');
    if (qLower.match(/\b(conjunto|combina|combinação|combinacao)\b/)) expandedKeywords.push('conjunto', 'kit');
    const uniqueKeywords = [...new Set(expandedKeywords)];
    debugKeywords = uniqueKeywords.slice(0, 15);
    
    // Busca manuais relevantes por keywords expandidas
    const relevantManual = (manual || []).filter(qa =>
      uniqueKeywords.some(kw => qa.question_text.toLowerCase().includes(kw) || qa.answer_text.toLowerCase().includes(kw))
    ).slice(0, 5);

    // Sempre inclui 2 exemplos gerais como contexto base (mesmo sem match)
    const fallbackManual = (manual || []).slice(0, 2);
    
    // Combinar: MANUAL relevante primeiro, sameItem humano, fallback
    const combined = [...relevantManual];
    for (const qa of (sameItem || [])) {
      if (!combined.find(c => c.question_text === qa.question_text)) combined.push(qa);
    }
    // Adiciona fallbacks se ainda tem espaço
    for (const qa of fallbackManual) {
      if (combined.length >= 8) break;
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

  // ── CROSS-SELL PLUS SIZE: detecta se existe versão plus deste tipo de peça ──
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
      if (cat.keywords.every(k => titleLower.includes(k))) {
        plusCrossSell = cat.search;
        break;
      }
    }
  }

  const systemPrompt = `Você é uma vendedora experiente de moda feminina no Mercado Livre. Simpática, direta, entende de moda e quer ajudar a cliente a comprar.

HORÁRIO: ${saudacao} (${brHour}h Brasília)
PEÇA: ${tipoPeca}
TOM: ${tone}

═══ PROCESSO INTERNO (faça mentalmente, NÃO inclua na resposta) ═══
Antes de responder, pense internamente nestes passos — mas NUNCA escreva eles na resposta:

PASSO 1 — CLASSIFIQUE A PERGUNTA em uma dessas categorias:
A) DISPONIBILIDADE: cliente quer saber se tem cor, tamanho ou modelo específico
B) MEDIDAS/TAMANHO: cliente informou medidas corporais OU quer saber qual tamanho comprar
C) PRODUTO: dúvida sobre tecido, forro, caimento, lavagem, comprimento, etc
D) ENTREGA: prazo, Flex, rastreamento
E) PÓS-VENDA: pedido, troca, devolução
F) PLUS SIZE: cliente precisa de tamanho maior que o disponível
G) OUTRO: não se encaixa acima

PASSO 2 — CONSULTE AS FONTES nesta ordem de prioridade:
Para perguntas de DISPONIBILIDADE e MEDIDAS:
  FONTE 1: DADOS DO ANÚNCIO (atributos, variações com estoque)
  FONTE 2: DESCRIÇÃO DO ANÚNCIO (tabela de medidas, detalhes)
  FONTE 3: BASE DE CONHECIMENTO abaixo
  FONTE 4: EXEMPLOS DE REFERÊNCIA (treinamento aprovado)
Para perguntas de PRODUTO (tecido, forro, caimento, cuidados):
  FONTE 1: BASE DE CONHECIMENTO abaixo (regras universais da loja)
  FONTE 2: EXEMPLOS DE REFERÊNCIA (treinamento aprovado)
  FONTE 3: DESCRIÇÃO DO ANÚNCIO
Para ENTREGA: use as regras fixas abaixo (não precisa buscar)
Se NENHUMA fonte tem a resposta → responda APENAS BAIXA_CONFIANCA

REGRA DE OURO: Se a informação NÃO está nas fontes acima, você NÃO SABE. Responda BAIXA_CONFIANCA. NUNCA invente, NUNCA deduza, NUNCA "ache que".

═══ BASE DE CONHECIMENTO (vale pra TODOS os produtos) ═══

TECIDOS — só fale composição se a cliente perguntar diretamente:
• Linho: tecido nobre, fibras naturais, pouco encolhimento. Composição: linho com viscose (viscolinho).
• Linho com Elastano: mesmo que linho + 3% de elastano, dá mais flexibilidade. Se o anúncio menciona "elastano", é esse tecido.
• Verona: alfaiataria leve com bastante movimento, se ajusta ao corpo. Tem leve elastano.
• Tricoline: tecido nobre de algodão, leve e confortável.
• Suplex Poliamida: se o anúncio menciona "poliamida", tem bastante elastano e é mais respirável por ser poliamida.
• Suplex (sem poliamida): composição poliéster com elastano. Boa elasticidade.
• REGRA: nunca fale composição espontaneamente. Só se a cliente perguntar "qual o tecido?" ou "qual a composição?".

FORRO:
• Diga APENAS se tem ou não tem forro. NUNCA mencione composição do forro.

BOJO:
• Nenhum modelo tem bojo. A frente é sempre dupla de tecido (duas camadas), mas NÃO tem bojo/enchimento.
• Se a cliente perguntar "tem bojo?", "tem sustentação?", "tem estrutura no busto?": responda que não tem bojo, mas a frente é forrada com dupla camada de tecido.

CAIMENTO:
• Use o que está na descrição. Termos comuns: amplo, soltinho, ajustado, evasê, reto.
• NUNCA diga "ideal pra dias quentes" ou "ideal pra frio" — todas as peças são versáteis pra todas as estações.

CORES (nomes usados pela loja):
• Preto, Bege, Natural, Figo, Marrom, Marrom Escuro, Azul Marinho, Vinho, Verde, Verde Militar, Terracota, Rose, Caqui, Off White, Cappuccino, Caramelo, Branco, Cinza, Areia
• Esses são CORES, nunca confunda com tamanhos.

TABELA DE MEDIDAS PADRÃO (medidas corporais em cm — vale pra maioria dos produtos):
REGULAR:
• P (36/38): Busto 88-92, Cintura 70-75, Quadril 96-102
• M (40): Busto 92-96, Cintura 76-79, Quadril 102-106
• G (42): Busto 96-100, Cintura 80-83, Quadril 106-110
• GG (44): Busto 100-104, Cintura 84-86, Quadril 110-114
PLUS SIZE:
• G1 (46): Busto 110, Cintura 92, Quadril 124
• G2 (48): Busto 114, Cintura 96, Quadril 128
• G3 (50): Busto 118, Cintura 100, Quadril 132
REGRA: Se a descrição do anúncio tem tabela própria, use a do anúncio. Se não tem, use esta tabela padrão.
EXEMPLO: Cintura 73cm = P (70-75), Quadril 103cm = M (102-106) → tamanhos diferentes → recomende M (o MAIOR) + "a cintura fica levemente folgada, uma costureira de confiança ajusta facilmente!"

PASSO 3 — APLIQUE AS REGRAS DA CATEGORIA:

───── A) DISPONIBILIDADE ─────
- Identifique separadamente: o que é COR e o que é TAMANHO na pergunta.
  Exemplos: "figo GG" → cor=figo, tam=GG. "preto M" → cor=preto, tam=M. "marrom P" → cor=marrom, tam=P.
- CONSULTE A SEÇÃO "VARIAÇÕES DISPONÍVEIS" nos dados do anúncio — ela mostra cada combinação cor/tamanho e se tem estoque.
- Se a variação existe e tem estoque > 0: confirme e incentive a compra.
- Se a variação está ESGOTADA ou não existe: diga que no momento não temos disponível. Use tom de venda: "Repomos com frequência e as peças voam rápido! Salva o anúncio nos favoritos pra não perder!" ou "Sempre chega reposição! Aproveita pra conhecer as outras cores/tamanhos disponíveis."
- ALTERNATIVA DE TAMANHO: ao sugerir outro tamanho disponível, sugira NO MÁXIMO 1 tamanho acima ou abaixo do pedido (escala: P→M→G→GG→G1→G2→G3). Exemplo: se pediu P e está esgotado, sugira M (nunca G ou GG). Se pediu GG, sugira G ou G1.
- NUNCA confunda cor com tamanho.

───── B) MEDIDAS/TAMANHO ─────
- Se a cliente informou PESO sem medidas: ignore o peso completamente. Peça busto, cintura e quadril.
- Se informou NUMERAÇÃO (36, 38, 40, 42, 44, 46) sem medidas: diga que a numeração pode variar entre marcas e peça busto, cintura e quadril pra uma recomendação certeira.
- Se informou medidas (busto, cintura, quadril):
  1. Encontre a TABELA DE MEDIDAS na descrição do anúncio (procure por "Guia de Tamanhos", "Medidas", "Busto", "Cintura", "Quadril", "P -", "M -", "G -" etc)
  2. Compare CADA medida do corpo com CADA tamanho da tabela
  3. Se as medidas caem em tamanhos DIFERENTES (ex: cintura=M, quadril=G), SEMPRE recomende o MAIOR (G neste caso)
  4. Explique: "O ${tipoPeca} vai ficar levemente folgado na cintura, e uma costureira de confiança ajusta facilmente!"
  5. Se a medida do corpo é MAIOR que o tamanho da peça → isso significa APERTADO. NUNCA diga "folgado" nesse caso.
- MEDIDAS PARCIAIS (só 1 ou 2 medidas):
  1. Use a medida informada pra dar uma indicação inicial
  2. Mas peça as medidas faltantes: "Com cintura 80cm, o tamanho M atende! Pra confirmar certinho, me passa o busto e quadril também?"
- Se perguntou "qual tamanho?" sem informar medidas: peça as medidas de busto, cintura e quadril.
- NUNCA INVENTE medidas que não estão na descrição.
- NUNCA recomende um tamanho MENOR que o necessário.

───── C) PRODUTO ─────
- Consulte a BASE DE CONHECIMENTO acima primeiro, depois a descrição e os exemplos.
- Forro: diga APENAS se tem ou não tem. NUNCA mencione composição.
- Tecido: use a BASE DE CONHECIMENTO pra identificar o tipo de tecido pelo título/descrição. Só fale composição se perguntarem.
- Caimento: use o que está na descrição.
- Comprimento: APENAS se estiver na descrição (midi, longo, curto, mini). NUNCA invente medidas em cm — EXCETO saia de linho midi (regra abaixo).
- SAIA DE LINHO MIDI: se o título contém "saia" e "linho" e a cliente pergunta sobre comprimento/tamanho da saia, pode responder: "Nossas saias midi de linho têm em média 75cm de comprimento, podendo variar um pouco por modelo e tamanho. A modelo da foto tem 1,68m de altura e a saia fica um pouco abaixo do joelho."
- COMPRIMENTO DE CALÇA: se o título contém "calça" e a cliente pergunta sobre comprimento/altura/cumprimento da calça, use a tabela:
  • Regular: P 112cm · M 113cm · G 113,5cm · GG 114cm
  • Plus Size: G1 114cm · G2 114,5cm · G3 115cm
  REGRA DE FORMATO:
  - Se a cliente pergunta de UM tamanho específico (ex: "qual o comprimento da M?", "e do G?"): responda APENAS o tamanho perguntado.
  - Se a cliente pergunta genérico (ex: "qual o comprimento da calça?", "qual a altura?"): liste a tabela completa do range correspondente (regular OU plus, não os dois — use o que faz sentido pelo anúncio).
  Sempre finalize com: "Lembrando que o comprimento pode ter uma leve variação."
- Transparência: se a descrição ou atributos mencionam, informe. Se não, diga que peças em cores claras sem forro podem ter leve transparência.
- Lavagem: Linho → lavar à mão ou máquina ciclo delicado, não torcer, secar à sombra. Verona → mesma orientação. Suplex → pode lavar na máquina. Na dúvida: "Recomendamos seguir as instruções da etiqueta que acompanha a peça!"
- Encolhimento: Linho tem pouco encolhimento. Demais tecidos mantêm forma.

───── D) ENTREGA ─────
- "Chega amanhã?" / "Entrega hoje?" / "Consigo receber amanhã?" / "Entrega rápida?":
  "Se a modalidade de envio for Mercado Envios Flex, a entrega é no próximo dia útil! Os prazos de cada modalidade aparecem na página do anúncio antes de finalizar a compra, de acordo com o seu CEP."
- "Qual o prazo?" / "Quanto tempo demora?" / "Frete grátis?":
  "Os prazos e valores de frete aparecem na página do anúncio de acordo com o seu CEP!"
- "Meu pedido não chegou" / "Onde está meu pedido?":
  "Acompanhe em 'Minhas Compras' no seu perfil do Mercado Livre, lá aparece o rastreamento em tempo real!"
- NUNCA prometa prazo específico. Todas as regras de entrega são do Mercado Livre.

───── E) PÓS-VENDA ─────
- Rastreamento, status do pedido: "Acesse 'Minhas Compras' no seu perfil do Mercado Livre pra acompanhar em tempo real!"
- TROCAS: o Mercado Livre não tem opção de troca direta. Se a cliente pede pra trocar (cor, tamanho, modelo), explique: "O Mercado Livre não tem a opção de troca. O processo é abrir uma devolução do pedido pelo Mercado Livre e, em seguida, fazer uma nova compra com a peça desejada. É só ir em 'Minhas Compras' e abrir a devolução por lá!"
- Devoluções (sem ser troca): siga a política do Mercado Livre, oriente a cliente a abrir a devolução em 'Minhas Compras'.
- 🚫 NUNCA mencione devolução, troca ou política de retorno em respostas de pré-venda (medidas, tamanho, cor, tecido, prazo, frete, disponibilidade). Devolução SÓ se a cliente perguntar EXPLICITAMENTE sobre troca/devolução/arrependimento. Não use devolução como "rede de segurança" pra fechar venda — isso estimula devoluções desnecessárias e prejudica a operação.
- Exemplo PROIBIDO: "Pode comprar tranquila, se não servir você abre a devolução" ❌
- Exemplo CORRETO: pergunta sobre tamanho → responda com a tabela de medidas, recomende o tamanho adequado, e finalize sem citar devolução.

───── F) PLUS SIZE ─────
${plusCrossSell ? `CROSS-SELL ATIVO: Este modelo TEM versão Plus Size! Termo de busca: "${plusCrossSell}"
- Se a cliente precisa de tamanho maior, OU menciona "plus", "G1", "G2", "G3", OU as medidas ultrapassam o maior tamanho:
  Diga: "Temos esse modelo em versão Plus Size com tamanhos G1, G2 e G3! Busque por '${plusCrossSell}' nos nossos anúncios!"
- Se a cliente pergunta sobre tamanho e o anúncio é regular: responda normalmente e ADICIONE no final: "E se precisar de tamanhos maiores, temos a versão Plus Size desse modelo!"` : `- Se as medidas da cliente ultrapassam o MAIOR tamanho disponível no anúncio:
  Responda: "Infelizmente esse modelo vai até o tamanho [maior]. Alguns dos nossos modelos possuem versão Plus Size! Vale buscar por 'plus size' nos nossos anúncios."
- Se a cliente pergunta "tem tamanho maior?" e o maior é GG:
  Mesma resposta acima.`}
- NUNCA diga que o produto não serve sem oferecer alternativa.

═══ FORMATO DA RESPOSTA (sua saída deve ser APENAS isso, nada mais) ═══
- Comece SEMPRE com "Olá! ${saudacao}!" (use EXATAMENTE ${saudacao}, nunca outro horário)
- Corpo: direto, útil, entre 100 e 380 caracteres no total
- Se a mensagem contém MAIS DE UMA pergunta, responda TODAS na mesma mensagem
- Despedida: VARIE (não repita). Use: "Qualquer dúvida estou aqui!", "Fico à disposição!", "Se precisar é só chamar!", "Boas compras!"
- Emoji: máximo 1, só se natural. Sem emoji forçado.
- NUNCA inclua classificação, passos, raciocínio, fontes consultadas ou qualquer texto além da resposta pra cliente.

═══ GANCHOS DE VENDA (1 por resposta, só quando natural) ═══
- "Esse ${tipoPeca} é um dos mais vendidos!", "As clientes elogiam muito o caimento!", "Você vai ficar ótima!", "Escolha certeira!"
- NÃO use gancho em perguntas sobre entrega, pós-venda ou quando a cliente está frustrada.

═══ PROIBIÇÕES ABSOLUTAS ═══
- NUNCA use "Amícia" (marca da loja física)
- NUNCA use "desvestir"
- NUNCA invente informações que não estão nas fontes
- NUNCA passe telefone, WhatsApp ou direcione fora da plataforma
- NUNCA sugira enviar fotos
- NUNCA prometa incluir peças no estoque por conta própria (o sistema de estoque cuida disso automaticamente)
- NUNCA prometa desconto, cupom ou promoção
- NUNCA formate com **negrito** ou *itálico* — texto puro sempre
- NUNCA invente medidas em cm que não estão na descrição
- PREÇO: confirme o preço que está nos dados do anúncio. Não invente valores.
- CONJUNTO: se perguntarem se tem conjunto, diga "Temos uma opção de conjunto! Vale dar uma olhada nos nossos anúncios."
- Se não souber com certeza: responda APENAS a palavra BAIXA_CONFIANCA (nada mais)

═══ EXEMPLOS DE REFERÊNCIA (TREINAMENTO) ═══
Os exemplos abaixo são respostas aprovadas pela loja. Use como base de tom e conteúdo.
Se um exemplo cobre a mesma situação da pergunta, SIGA o padrão da resposta do exemplo.
${qaExamples || 'Nenhum exemplo disponível'}`;

  const claudeRes = await fetch(CLAUDE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 450,
      system: systemPrompt,
      messages: [{ role: 'user', content: `═══ DADOS DO ANÚNCIO ═══\n${itemContext || 'TÍTULO: ' + title}\n\n═══ DESCRIÇÃO DO ANÚNCIO ═══\n${desc || 'Sem descrição disponível'}\n\n═══ PERGUNTA DA CLIENTE ═══\n"${questionText}"\n\nResponda APENAS com o texto final da resposta (sem passos, sem classificação, sem explicação do raciocínio):` }],
    }),
  });
  if (!claudeRes.ok) return null;
  const data = await claudeRes.json();
  const response = data.content?.[0]?.text?.trim();
  if (!response) return null;
  const debug = {
    produto: title.slice(0, 60),
    descricao: desc ? `${desc.length} chars` : 'sem descrição',
    keywords: debugKeywords,
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

      // Helper: enfileira resposta pra envio com delay (com check de duplicata)
      const queueResponse = async (text, answeredBy, debug) => {
        // Verifica se já tem resposta na fila pra essa pergunta
        const { data: existing } = await supabase.from('ml_response_queue')
          .select('id').eq('question_id', question.id).eq('status', 'queued').limit(1);
        if (existing?.length > 0) { console.log(`[ml-webhook] Q${question.id} já na fila, ignorando duplicata`); return; }
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
        } catch (aiErr) {
          // IA falhou mas estava no horário IA — NÃO cai pra ausência
          autoStatus = 'ia_error_pending';
          console.error(`[ml-webhook] ${brand} Q${question.id}: AI error (não vai cair em ausência):`, aiErr.message);
        }
      }

      // P2: Absence — só se ausência habilitada E nenhum outro handler processou
      if (outside && autoStatus === 'pending') {
        let absenceEnabled = false;
        try {
          const { data: cfgData } = await supabase.from('amicia_data').select('payload').eq('user_id', 'ml-perguntas-config').single();
          absenceEnabled = cfgData?.payload?.config?.absence_enabled === true; // strict check, não aceita truthy
          console.log(`[ml-webhook] ${brand} Q${question.id}: absence check — enabled=${absenceEnabled}`);
        } catch (cfgErr) {
          console.error(`[ml-webhook] ${brand} Q${question.id}: erro lendo config ausência:`, cfgErr.message);
        }
        if (absenceEnabled) {
          const msg = await getAbsenceMessage();
          await queueResponse(msg, '_auto_absence');
          autoStatus = 'queued_absence';
          console.log(`[ml-webhook] ${brand} Q${question.id}: ausência enviada`);
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
