/**
 * ml-reviews-analise-live.js — Analise on-demand IA dos reviews ML (Sprint 4)
 *
 * Sessao Ailson 14-15/05/2026 — Sprint 4 do projeto Inteligencia Reviews.
 *
 * Endpoint POST chamado pelo frontend src/Reviews_meli.jsx quando o admin
 * clica em uma REF pra abrir o modal de analise rica e contextual.
 *
 * DIFERENCAS em relacao ao cron quinzenal:
 *   - On-demand (nao cron)
 *   - Body: { ref }
 *   - Modelo Sonnet 4.5 (analise mais profunda)
 *   - Contexto rico: 90d reviews + analise quinzenal vigente + vendas 30d + card
 *   - Busca insights NAO OBVIOS (a IA recebe a quinzenal pronta e nao repete)
 *   - Foco em recorrencia ultimos 30d
 *   - Cache 60min por REF (custo R$ 0 em hit)
 *   - Rate limit 10 analises/admin/dia
 *
 * Custo esperado: ~R$ 0,30/analise (~3k tokens out)
 */
import { supabase, setCors } from './_lojas-helpers.js';
import { calcularCustoBRL, temOrcamento } from './_ia-helpers.js';

export const config = { maxDuration: 120 };

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const CONTEXTO_DIAS = 90;
const RECORRENCIA_DIAS = 30;
const CACHE_MINUTOS = 60;
const LIMITE_POR_ADMIN_DIA = 10;
const MAX_REVIEWS_CONTEXTO = 250;
const ADMINS = ['ailson', 'amicia-admin', 'tamara'];

// ═════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — busca insights NAO OBVIOS, complementares a quinzenal
// ═════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Voce e analista senior de qualidade e marketing da Amicia (confeccao moda feminina, SP). Sua tarefa: gerar insights ACIONAVEIS e NAO OBVIOS sobre UMA REF a partir de reviews do Mercado Livre dos ultimos 90 dias.

# REGRA DE OURO

Voce VAI receber a "Analise Quinzenal Vigente" no contexto. Ela ja resume tecido, cor, encolhimento, ziper, tamanho, pontos positivos e negativos. NAO REPITA isso. Sua mision e ir ALEM dela.

Procure padroes que a quinzenal nao captura, com foco nos ULTIMOS 30 DIAS (recorrencia recente).

# 6 CATEGORIAS DE INSIGHTS

Procure ativamente sinais nessas 6 lentes (use as que tiverem evidencia, ignore as que nao):

1. **padrao_fraco** — sinal em 1-2 reviews bem fundamentados que pode virar problema (ex: 2 clientes mencionam costura na manga abrindo apos 3 lavagens). Cite trechos do review.

2. **cruzamento** — descompasso entre vendas e feedback. Ex: vendas alta nos ultimos 30d MAS aparecem queixas crescentes -> alerta. Ou: vendas caindo MAS reviews elogiosos -> problema de anuncio, nao de produto.

3. **comunicacao** — elogios marcantes do cliente que podem virar copy de anuncio em OUTRAS pecas similares. Cite a frase original.

4. **catalogo** — queixas "diferente da foto", "cor outra", "tecido diferente" indicam erro NO ANUNCIO (foto/descricao), nao no produto.

5. **sizing** — sinais fortes de tamanho: clientes que RECLAMARAM de tamanho mas voltaram a comprar (super forte!), ou pedem "puxar de tamanho". Note caimento.

6. **transferencia** — o aprendizado dessa REF se aplica a qual outra REF/colecao similar? Sugira generalizacao.

# FORMATO DE SAIDA

Retorne UM unico JSON valido (sem markdown, sem texto extra):

\`\`\`json
{
  "resumo_texto": "Texto amigavel em PT-BR, 5-8 paragrafos curtos, fluindo natural. Comeca contextualizando a REF (ex: 'REF 2304 acumulou 47 reviews nos ultimos 90 dias, com nota 4.3 e vendas firmes - 124 pecas em 30 dias'). Depois mergulha nos insights mais relevantes, citando trechos reais de reviews quando relevante. Termina com 2-3 acoes praticas que voce recomendaria pro Ailson fazer essa semana. Tom: como se voce fosse um socio analista falando direto, sem floreio.",
  "insights_estruturados": [
    {
      "tipo": "padrao_fraco",
      "titulo": "Frase curta de no maximo 80 chars",
      "descricao": "1-3 frases explicando o sinal, citando evidencia",
      "acao_sugerida": "1 acao concreta e curta",
      "severidade": "alta"
    }
  ]
}
\`\`\`

# REGRAS

- max 5 insights_estruturados (qualidade > quantidade)
- tipo: SEMPRE uma das 6 categorias acima
- severidade: "alta" | "media" | "baixa"
- Se nao houver insights novos (a quinzenal ja cobre tudo), retorne insights_estruturados=[] e fala isso no resumo_texto
- Cite trechos reais de reviews entre aspas quando ajudar
- NAO use markdown na saida (so JSON)
- NAO invente dados, so use o que esta no contexto
`;

// ═════════════════════════════════════════════════════════════════════
// Busca contexto completo da REF: card + analise quinzenal + vendas + reviews
// ═════════════════════════════════════════════════════════════════════
async function buscarContextoRef(refAmicia) {
  const periodoInicio = new Date(Date.now() - CONTEXTO_DIAS * 86400000);
  const recorrenciaInicio = new Date(Date.now() - RECORRENCIA_DIAS * 86400000);

  // Card geral
  const { data: card } = await supabase
    .from('vw_ml_reviews_cards')
    .select('ref_amicia, descricao, reviews_30d, nota_exitus, total_reviews, vendas_30d_qtd, vendas_30d_valor, mudou_recorrente')
    .eq('ref_amicia', refAmicia)
    .maybeSingle();

  // Analise quinzenal vigente (mais recente)
  const { data: quinzenal } = await supabase
    .from('ml_reviews_analise')
    .select('id, periodo_inicio, periodo_fim, qtd_reviews, nota_media, resumo_categorias, pontos_positivos, pontos_negativos, mudou_recorrente, mudancas_detectadas, criado_em')
    .eq('ref_amicia', refAmicia)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Vendas 30d via RPC (mesma fonte usada pelo card, mas pego fresh)
  let vendas30d = { qtd_vendas: 0, valor_total: 0 };
  try {
    const { data: vendasRows } = await supabase.rpc('ml_reviews_vendas_30d', { p_ref: refAmicia });
    if (Array.isArray(vendasRows) && vendasRows.length > 0) {
      vendas30d = vendasRows[0];
    } else if (vendasRows && typeof vendasRows === 'object') {
      vendas30d = vendasRows;
    }
  } catch (e) {
    console.warn('[reviews-live] rpc vendas_30d:', e.message);
  }

  // Reviews dos ultimos 90 dias
  const { data: reviews, error } = await supabase
    .from('ml_reviews')
    .select('rating, title, content, buying_date, brand, mlb_id')
    .eq('ref_amicia', refAmicia)
    .gte('buying_date', periodoInicio.toISOString())
    .order('buying_date', { ascending: false })
    .limit(MAX_REVIEWS_CONTEXTO);

  if (error) throw new Error('reviews:' + error.message);

  const reviewsRecentes = (reviews || []).filter(r => r.buying_date && new Date(r.buying_date) >= recorrenciaInicio);

  return {
    card,
    quinzenal,
    vendas30d,
    reviews: reviews || [],
    reviewsRecentes,
  };
}

// ═════════════════════════════════════════════════════════════════════
// Monta texto do contexto pro Claude
// ═════════════════════════════════════════════════════════════════════
function montarUserMessage(refAmicia, ctx) {
  const { card, quinzenal, vendas30d, reviews, reviewsRecentes } = ctx;

  const cardTxt = card
    ? `- Descricao: ${card.descricao || '-'}
- Total reviews (todo historico): ${card.total_reviews || 0}
- Reviews ultimos 30d: ${card.reviews_30d || 0}
- Nota Exitus: ${card.nota_exitus ?? '-'}
- Vendas 30d: ${vendas30d.qtd_vendas || 0} pecas / R$ ${Number(vendas30d.valor_total || 0).toFixed(2)}
- Mudou recorrente na ultima quinzenal: ${card.mudou_recorrente ? 'SIM' : 'nao'}`
    : '- Card nao disponivel pra essa REF';

  let quinzenalTxt = '(nenhuma analise quinzenal anterior — primeira analise dessa REF)';
  if (quinzenal) {
    const blocos = quinzenal.resumo_categorias || {};
    const linhas = ['tecido', 'cor', 'encolhimento', 'ziper', 'tamanho'].map(b => {
      const v = blocos[b] || {};
      const pos = (v.top_positivos || []).join('; ') || '-';
      const neg = (v.top_negativos || []).join('; ') || '-';
      return `  - ${b}: nota ${v.nota || 0} | ${v.qtd_mencoes || 0} mencoes | +[${pos}] -[${neg}]`;
    }).join('\n');
    quinzenalTxt = `Periodo analisado: ${quinzenal.periodo_inicio} a ${quinzenal.periodo_fim}
Qtd reviews na quinzenal: ${quinzenal.qtd_reviews} | Nota media: ${quinzenal.nota_media}
Mudou recorrente: ${quinzenal.mudou_recorrente ? 'SIM' : 'nao'}
Blocos:
${linhas}
Pontos positivos gerais: ${(quinzenal.pontos_positivos || []).join(' | ') || '-'}
Pontos negativos gerais: ${(quinzenal.pontos_negativos || []).join(' | ') || '-'}`;
    if (quinzenal.mudancas_detectadas) {
      quinzenalTxt += `\nMudancas detectadas pela quinzenal: ${JSON.stringify(quinzenal.mudancas_detectadas).slice(0, 400)}`;
    }
  }

  const formatReview = r => {
    const dt = r.buying_date ? r.buying_date.slice(0, 10) : '';
    const titulo = (r.title || '').slice(0, 100);
    const conteudo = (r.content || '').slice(0, 400);
    return `[${r.rating}★ ${dt} ${r.brand || '?'}] ${titulo ? titulo + ' - ' : ''}${conteudo}`;
  };

  const reviews90dTxt = reviews
    .filter(r => r.content || r.title)
    .map(formatReview)
    .join('\n') || '(sem reviews com conteudo)';

  const reviews30dTxt = reviewsRecentes
    .filter(r => r.content || r.title)
    .map(formatReview)
    .join('\n') || '(sem reviews com conteudo nos ultimos 30 dias)';

  return `REF: ${refAmicia}

# CARD GERAL
${cardTxt}

# ANALISE QUINZENAL VIGENTE (nao repetir!)
${quinzenalTxt}

# REVIEWS — ULTIMOS 90 DIAS (${reviews.length} reviews, ordem cronologica reversa)
${reviews90dTxt}

# FOCO RECORRENCIA — ULTIMOS 30 DIAS (${reviewsRecentes.length} reviews)
${reviews30dTxt}

Gere insights nao obvios e o resumo_texto conforme instruido.`;
}

// ═════════════════════════════════════════════════════════════════════
// Chama Claude
// ═════════════════════════════════════════════════════════════════════
async function analisarLiveClaude(refAmicia, ctx) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY ausente no env');
  }

  const userMsg = montarUserMessage(refAmicia, ctx);

  const t0 = Date.now();
  const resp = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 3500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Claude HTTP ${resp.status}: ${txt.slice(0, 500)}`);
  }

  const json = await resp.json();
  const texto = json.content?.[0]?.text || '';

  let parsed = null;
  try {
    const clean = texto.replace(/```json\s*|\s*```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch (e) {
    console.warn(`[reviews-live] ${refAmicia} JSON parse falhou:`, e.message, 'raw:', texto.slice(0, 300));
    // Fallback: usa o texto bruto como resumo, sem estruturados
    parsed = { resumo_texto: texto || 'IA nao retornou conteudo parseavel.', insights_estruturados: [] };
  }

  // Sanitiza insights_estruturados
  const estruturados = Array.isArray(parsed.insights_estruturados)
    ? parsed.insights_estruturados.slice(0, 5).filter(i => i && typeof i === 'object')
    : [];

  const custo = await calcularCustoBRL({
    modelo: 'claude-sonnet-4-6',  // chave que existe em ANTHROPIC_PRICING
    input_tokens: json.usage?.input_tokens || 0,
    output_tokens: json.usage?.output_tokens || 0,
  });

  return {
    resumo_texto: parsed.resumo_texto || '',
    insights_estruturados: estruturados,
    custo_brl: custo.custo_brl,
    duracao_ms: Date.now() - t0,
    tokens_in: json.usage?.input_tokens || 0,
    tokens_out: json.usage?.output_tokens || 0,
  };
}

// ═════════════════════════════════════════════════════════════════════
// CACHE: retorna analise mais recente se < CACHE_MINUTOS
// ═════════════════════════════════════════════════════════════════════
async function buscarCache(refAmicia) {
  const limite = new Date(Date.now() - CACHE_MINUTOS * 60000).toISOString();
  const { data } = await supabase
    .from('ml_reviews_analise_live')
    .select('id, insights, insights_texto, solicitado_em')
    .eq('ref_amicia', refAmicia)
    .gte('solicitado_em', limite)
    .order('solicitado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

// ═════════════════════════════════════════════════════════════════════
// Conta analises do admin no dia corrente (timezone BRT aproximado: usa data BR)
// ═════════════════════════════════════════════════════════════════════
async function contarUsoDoDia(userId) {
  // Dia atual em BRT (America/Sao_Paulo = UTC-3)
  const agoraBrt = new Date(Date.now() - 3 * 3600 * 1000);
  const inicioDiaBrt = new Date(Date.UTC(
    agoraBrt.getUTCFullYear(), agoraBrt.getUTCMonth(), agoraBrt.getUTCDate(), 3, 0, 0
  ));  // 00:00 BRT = 03:00 UTC
  const { count } = await supabase
    .from('ml_reviews_analise_live')
    .select('id', { count: 'exact', head: true })
    .eq('solicitado_por', userId)
    .gte('solicitado_em', inicioDiaBrt.toISOString());
  return count || 0;
}

// ═════════════════════════════════════════════════════════════════════
// HANDLER
// ═════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST com body { ref }' });
  }

  // Auth admin
  const userId = req.headers['x-user'] || req.body?.usuario || req.query?.user;
  if (!userId || !ADMINS.includes(userId)) {
    return res.status(403).json({ error: 'Apenas admin (ailson | amicia-admin | tamara)' });
  }

  // REF do body
  const ref = String(req.body?.ref || '').trim();
  if (!ref) {
    return res.status(400).json({ error: 'Campo "ref" obrigatorio no body' });
  }

  try {
    // 1) Cache hit: retorna sem chamar Claude, custo R$ 0
    const cache = await buscarCache(ref);
    if (cache) {
      return res.json({
        ok: true,
        cached: true,
        insights_texto: cache.insights_texto || '',
        insights_estruturados: Array.isArray(cache.insights) ? cache.insights : [],
        custo_brl: 0,
        analisado_em: cache.solicitado_em,
      });
    }

    // 2) Limite diario
    const usoHoje = await contarUsoDoDia(userId);
    if (usoHoje >= LIMITE_POR_ADMIN_DIA) {
      return res.status(429).json({
        error: `Limite diario atingido: ${LIMITE_POR_ADMIN_DIA} analises por admin. Tente amanha.`,
      });
    }

    // 3) Orcamento mensal Anthropic
    if (!(await temOrcamento())) {
      return res.status(429).json({ error: 'Orcamento mensal Anthropic excedido' });
    }

    // 4) Busca contexto
    const ctx = await buscarContextoRef(ref);
    if (!ctx.reviews || ctx.reviews.length === 0) {
      return res.status(404).json({ error: `Nenhum review nos ultimos ${CONTEXTO_DIAS} dias pra REF ${ref}` });
    }

    // 5) Chama Claude
    const analise = await analisarLiveClaude(ref, ctx);

    // 6) Persiste em ml_reviews_analise_live
    const { error: errLive } = await supabase
      .from('ml_reviews_analise_live')
      .insert({
        ref_amicia: ref,
        solicitado_por: userId,
        contexto_dias: CONTEXTO_DIAS,
        recorrencia_dias: RECORRENCIA_DIAS,
        insights: analise.insights_estruturados,
        insights_texto: analise.resumo_texto,
        custo_brl: analise.custo_brl,
      });
    if (errLive) console.warn('[reviews-live] insert live:', errLive.message);

    // 7) Registra custo em ia_usage
    try {
      await supabase.from('ia_usage').insert({
        data: new Date().toISOString().slice(0, 10),
        ano_mes: new Date().toISOString().slice(0, 7),
        tipo: 'reviews_analise_live',
        modelo: CLAUDE_MODEL,
        input_tokens: analise.tokens_in,
        output_tokens: analise.tokens_out,
        custo_brl: analise.custo_brl,
        user_id: userId,
      });
    } catch (e) {
      console.warn('[reviews-live] ia_usage:', e.message);
    }

    return res.json({
      ok: true,
      cached: false,
      insights_texto: analise.resumo_texto,
      insights_estruturados: analise.insights_estruturados,
      custo_brl: analise.custo_brl,
      duracao_ms: analise.duracao_ms,
      tokens_in: analise.tokens_in,
      tokens_out: analise.tokens_out,
      qtd_reviews_contexto: ctx.reviews.length,
      qtd_reviews_30d: ctx.reviewsRecentes.length,
    });
  } catch (e) {
    console.error('[reviews-live] erro:', e);
    return res.status(500).json({ error: e.message || 'erro interno' });
  }
}
