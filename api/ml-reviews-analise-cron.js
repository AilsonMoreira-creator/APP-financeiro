/**
 * ml-reviews-analise-cron.js — Analise quinzenal IA dos reviews ML
 *
 * Sessao Ailson 14/05/2026 — Sprint 2 do projeto Inteligencia Reviews.
 *
 * Schedule: 0 8 1,11,21 * * (05h BRT, dia 1, 11 e 21 do mes — 10 em 10 dias)
 *
 * O QUE FAZ:
 *   Pra cada REF com reviews nos ultimos 6 meses:
 *     1. Carrega reviews (max 200 mais recentes)
 *     2. IA Haiku categoriza em 7 blocos:
 *        - tecido | cor | encolhimento | ziper | tamanho
 *        - pontos positivos | pontos negativos
 *     3. Compara com analise anterior (mesma REF, ultimo registro)
 *     4. Se aparece padrao NOVO recorrente (>=3 mencoes mesma categoria
 *        que nao tinha antes) -> marca mudou_recorrente=true
 *     5. UPSERT em ml_reviews_analise
 *
 * MODO MANUAL:
 *   GET /api/ml-reviews-analise-cron?user=ailson
 *   GET /api/ml-reviews-analise-cron?user=ailson&ref=2304   # so 1 REF
 *
 * Modelo Claude: Haiku 4.5 (R$ 0,02/REF)
 * Custo total estimado: 42 REFs × 2/mes × R$ 0,02 = R$ 1,68/mes
 */
import { supabase, setCors } from './_lojas-helpers.js';
import { calcularCustoBRL, temOrcamento } from './_ia-helpers.js';

export const config = { maxDuration: 600 };

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';  // mesmo modelo dos outros endpoints
const PERIODO_DIAS = 180;          // 6 meses de contexto
const MIN_REVIEWS_ANALISE = 3;     // sem 3+ reviews nao roda analise
const MIN_MENCOES_RECORRENTE = 3;  // alerta amarelo se 3+ mencoes nova categoria

// ═════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT — classifica reviews em 7 blocos estruturados
// ═════════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Voce e um analista de qualidade de produtos da Amicia (confeccao moda feminina). Sua tarefa: analisar reviews do Mercado Livre de UMA referencia (REF) e gerar um resumo estruturado em 7 blocos.

# 7 BLOCOS OBRIGATORIOS

Pra cada bloco, agrupe o que clientes falaram (positivo + negativo). Se nao tiver mencao no bloco, retorne array vazio.

1. **tecido** — qualidade do tecido, textura, peso, transparencia, durabilidade
2. **cor** — cor real vs catalogo, desbotamento, vivacidade
3. **encolhimento** — encolheu apos lavagem ou nao
4. **ziper** — funcionamento, qualidade, quebrou, duro, etc
5. **tamanho** — vestiu certo? veste maior/menor? medidas conferem?
6. **pontos_positivos** — top elogios fora dos 5 blocos acima (caimento, valor, entrega, embalagem, atendimento, etc)
7. **pontos_negativos** — top criticas fora dos 5 blocos acima

# FORMATO DE SAIDA

Retorne UM unico JSON valido (sem markdown, sem texto extra, sem aspas envolvendo, sem prefixos tipo "Aqui esta:"):

\`\`\`json
{
  "tecido": {
    "nota": 4.3,
    "qtd_mencoes": 12,
    "top_positivos": ["leve", "fresco no calor"],
    "top_negativos": ["transparente demais"]
  },
  "cor": {"nota": 4.5, "qtd_mencoes": 8, "top_positivos": ["cor viva"], "top_negativos": []},
  "encolhimento": {"nota": 3.8, "qtd_mencoes": 4, "top_positivos": [], "top_negativos": ["encolheu na primeira lavagem"]},
  "ziper": {"nota": 0, "qtd_mencoes": 0, "top_positivos": [], "top_negativos": []},
  "tamanho": {"nota": 4.0, "qtd_mencoes": 15, "top_positivos": ["medidas conferem"], "top_negativos": ["veste menor"]},
  "pontos_positivos": ["entrega rapida (8 mencoes)", "embalagem caprichada (5 mencoes)"],
  "pontos_negativos": ["foto diferente da peca (3 mencoes)"]
}
\`\`\`

# REGRAS IMPORTANTES

- nota = media de estrelas dos reviews que mencionam esse bloco
- qtd_mencoes = quantos reviews falam desse bloco (positivo OU negativo)
- top_positivos/negativos: ate 3 frases curtas, palavras do cliente, sem inventar
- Se um bloco nao tem NENHUMA mencao: nota=0, qtd_mencoes=0, arrays vazios
- pontos_positivos/negativos: 3-5 strings cada, formato "frase curta (N mencoes)"
- NAO use markdown, retorne SO o JSON valido
- Seja CONSERVADOR: se tem 1 mencao isolada, nao virou tendencia ainda
`;

// ═════════════════════════════════════════════════════════════════════
// Detecta mudancas recorrentes vs analise anterior
// ═════════════════════════════════════════════════════════════════════
function detectarMudancas(novoResumo, antigaAnalise) {
  if (!antigaAnalise || !antigaAnalise.resumo_categorias) {
    // Primeira analise da REF — nao tem como ter "mudanca"
    return { mudou: false, mudancas: [] };
  }
  
  const mudancas = [];
  const antigo = antigaAnalise.resumo_categorias || {};
  const blocos = ['tecido', 'cor', 'encolhimento', 'ziper', 'tamanho'];
  
  for (const bloco of blocos) {
    const a = antigo[bloco] || { qtd_mencoes: 0, nota: 0, top_negativos: [] };
    const n = novoResumo[bloco] || { qtd_mencoes: 0, nota: 0, top_negativos: [] };
    
    // Caso 1: bloco ZERADO antes e agora tem 3+ mencoes negativas
    const negNovas = (n.top_negativos || []).length;
    if (a.qtd_mencoes === 0 && n.qtd_mencoes >= MIN_MENCOES_RECORRENTE && negNovas > 0) {
      mudancas.push({
        categoria: bloco,
        tipo: 'novo_problema',
        descricao: `Agora aparece "${bloco}" com ${n.qtd_mencoes} mencoes (antes 0)`,
        nota_antes: 0,
        nota_agora: n.nota,
      });
    }
    
    // Caso 2: nota caiu mais de 0.5 estrela no bloco
    if (a.qtd_mencoes >= MIN_MENCOES_RECORRENTE && n.qtd_mencoes >= MIN_MENCOES_RECORRENTE) {
      const queda = (a.nota || 0) - (n.nota || 0);
      if (queda >= 0.5) {
        mudancas.push({
          categoria: bloco,
          tipo: 'queda_nota',
          descricao: `Nota de "${bloco}" caiu ${queda.toFixed(1)}★ (de ${a.nota} pra ${n.nota})`,
          nota_antes: a.nota,
          nota_agora: n.nota,
        });
      }
    }
    
    // Caso 3: problema antigo cresceu (mencoes negativas duplicaram)
    const negAntigas = (a.top_negativos || []).length;
    if (negAntigas > 0 && negNovas >= negAntigas + 2) {
      mudancas.push({
        categoria: bloco,
        tipo: 'crescimento_negativo',
        descricao: `Mencoes negativas de "${bloco}" cresceram: ${negAntigas} -> ${negNovas}`,
      });
    }
  }
  
  return { mudou: mudancas.length > 0, mudancas };
}

// ═════════════════════════════════════════════════════════════════════
// Chama Claude pra analisar reviews de UMA REF
// ═════════════════════════════════════════════════════════════════════
async function analisarReviewsClaude(refAmicia, reviews) {
  // Monta payload de reviews resumidos pro prompt
  const reviewsTxt = reviews
    .filter(r => r.content || r.title)
    .slice(0, 200)  // limita pra nao estourar contexto
    .map(r => {
      const dt = r.buying_date ? r.buying_date.slice(0, 10) : '';
      const titulo = (r.title || '').slice(0, 100);
      const conteudo = (r.content || '').slice(0, 500);
      return `[${r.rating}★ ${dt}] ${titulo ? titulo + ' - ' : ''}${conteudo}`;
    })
    .join('\n');
  
  const userMsg = `REF: ${refAmicia}\nTotal reviews ultimos 6 meses: ${reviews.length}\n\n=== REVIEWS ===\n${reviewsTxt}\n\nAnalise e retorne o JSON estruturado.`;
  
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
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });
  
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Claude HTTP ${resp.status}: ${txt}`);
  }
  
  const json = await resp.json();
  const texto = json.content?.[0]?.text || '';
  
  // Parse JSON da resposta (tolerante a markdown wrap)
  let parsed = null;
  try {
    const clean = texto.replace(/```json\s*|\s*```/g, '').trim();
    parsed = JSON.parse(clean);
  } catch (e) {
    console.warn(`[reviews-analise] ${refAmicia} JSON parse falhou:`, e.message);
    return null;
  }
  
  const custo = await calcularCustoBRL({
    modelo: 'claude-sonnet-4-6',  // chave que existe em ANTHROPIC_PRICING (preços iguais 4.5/4.6)
    input_tokens: json.usage?.input_tokens || 0,
    output_tokens: json.usage?.output_tokens || 0,
  });
  
  return {
    resumo: parsed,
    custo_brl: custo.custo_brl,
    duracao_ms: Date.now() - t0,
    tokens_in: json.usage?.input_tokens || 0,
    tokens_out: json.usage?.output_tokens || 0,
  };
}

// ═════════════════════════════════════════════════════════════════════
// Processa UMA REF — analise + sentinel + UPSERT
// ═════════════════════════════════════════════════════════════════════
async function processarRef(refAmicia) {
  const periodoInicio = new Date(Date.now() - PERIODO_DIAS * 86400000);
  const periodoFim = new Date();
  
  // 1. Carrega reviews do periodo
  const { data: reviews, error } = await supabase
    .from('ml_reviews')
    .select('rating, title, content, buying_date, brand')
    .eq('ref_amicia', refAmicia)
    .gte('buying_date', periodoInicio.toISOString())
    .order('buying_date', { ascending: false });
  
  if (error) {
    return { ok: false, ref: refAmicia, erro: error.message };
  }
  if (!reviews || reviews.length < MIN_REVIEWS_ANALISE) {
    return { ok: false, ref: refAmicia, pulado: 'menos_de_3_reviews', qtd: reviews?.length || 0 };
  }
  
  // 2. Notas agregadas (snapshot quantitativo)
  const notaMedia = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
  const reviewsExitus = reviews.filter(r => r.brand === 'Exitus');
  const notaExitus = reviewsExitus.length > 0 
    ? reviewsExitus.reduce((s, r) => s + r.rating, 0) / reviewsExitus.length 
    : null;
  
  // 3. Chama IA pra categorizar
  let analiseIA;
  try {
    analiseIA = await analisarReviewsClaude(refAmicia, reviews);
  } catch (e) {
    return { ok: false, ref: refAmicia, erro: 'claude:' + e.message };
  }
  if (!analiseIA || !analiseIA.resumo) {
    return { ok: false, ref: refAmicia, erro: 'IA retornou vazio' };
  }
  
  // 4. Registra custo no ia_usage
  try {
    await supabase.from('ia_usage').insert({
      data: new Date().toISOString().slice(0, 10),
      ano_mes: new Date().toISOString().slice(0, 7),
      tipo: 'reviews_analise_quinzenal',
      modelo: CLAUDE_MODEL,
      input_tokens: analiseIA.tokens_in,
      output_tokens: analiseIA.tokens_out,
      custo_brl: analiseIA.custo_brl,
      user_id: refAmicia,  // pra rastrear qual REF
    });
  } catch (e) {
    console.warn('[reviews-analise] ia_usage:', e.message);
  }
  
  // 5. Compara com analise anterior (sentinel de mudanca)
  const { data: anterior } = await supabase
    .from('ml_reviews_analise')
    .select('id, resumo_categorias')
    .eq('ref_amicia', refAmicia)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  const { mudou, mudancas } = detectarMudancas(analiseIA.resumo, anterior);
  
  // 6. INSERT nova analise (mantemos historico — nao update)
  const { data: nova, error: errIns } = await supabase
    .from('ml_reviews_analise')
    .insert({
      ref_amicia: refAmicia,
      periodo_inicio: periodoInicio.toISOString().slice(0, 10),
      periodo_fim: periodoFim.toISOString().slice(0, 10),
      qtd_reviews: reviews.length,
      nota_media: Math.round(notaMedia * 100) / 100,
      nota_exitus: notaExitus ? Math.round(notaExitus * 100) / 100 : null,
      resumo_categorias: analiseIA.resumo,
      pontos_positivos: analiseIA.resumo.pontos_positivos || [],
      pontos_negativos: analiseIA.resumo.pontos_negativos || [],
      mudou_recorrente: mudou,
      mudancas_detectadas: mudancas.length > 0 ? mudancas : null,
    })
    .select('id')
    .single();
  
  if (errIns) {
    return { ok: false, ref: refAmicia, erro: 'insert:' + errIns.message };
  }
  
  return {
    ok: true,
    ref: refAmicia,
    qtd_reviews: reviews.length,
    nota_media: notaMedia,
    mudou_recorrente: mudou,
    qtd_mudancas: mudancas.length,
    custo_brl: analiseIA.custo_brl,
    analise_id: nova.id,
  };
}

// ═════════════════════════════════════════════════════════════════════
// HANDLER
// ═════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Auth
  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  const userId = req.query?.user || req.headers['x-user'];
  const ehAdmin = userId === 'ailson' || userId === 'amicia-admin' || userId === 'tamara';
  if (!ehCron && !ehAdmin) {
    return res.status(403).json({ error: 'Apenas cron ou admin' });
  }
  
  // Verifica orcamento Anthropic
  if (!(await temOrcamento())) {
    return res.status(429).json({ error: 'Orcamento mensal Anthropic excedido' });
  }
  
  const tInicio = Date.now();
  const refFiltro = req.query?.ref;  // opcional: testar 1 REF
  
  // Health log
  let healthId = null;
  try {
    const { data: hl } = await supabase
      .from('lojas_cron_health')
      .insert({
        cron_name: 'ml-reviews-analise-cron',
        origem: ehCron ? 'vercel-cron' : 'manual-admin',
        triggered_by: userId || 'vercel',
        status: 'iniciada',
      })
      .select('id').single();
    healthId = hl?.id || null;
  } catch {}
  
  const finalizar = async (status, detalhes = {}) => {
    if (!healthId) return;
    try {
      await supabase.from('lojas_cron_health').update({
        finished_at: new Date().toISOString(),
        duracao_ms: Date.now() - tInicio,
        status,
        ...detalhes,
      }).eq('id', healthId);
    } catch {}
  };
  
  try {
    // Lista REFs com >=3 reviews nos ultimos 6 meses
    let refsParaAnalisar;
    if (refFiltro) {
      refsParaAnalisar = [refFiltro];
    } else {
      const { data: refs } = await supabase
        .from('ml_reviews')
        .select('ref_amicia')
        .gte('buying_date', new Date(Date.now() - PERIODO_DIAS * 86400000).toISOString())
        .not('ref_amicia', 'is', null);
      const setUnico = new Set((refs || []).map(r => r.ref_amicia));
      refsParaAnalisar = Array.from(setUnico);
    }
    
    const resultados = [];
    let custoTotalBrl = 0;
    let analisadas = 0, puladas = 0, erros = 0, alertas = 0;
    
    for (const ref of refsParaAnalisar) {
      const r = await processarRef(ref);
      resultados.push(r);
      if (r.ok) {
        analisadas++;
        custoTotalBrl += r.custo_brl || 0;
        if (r.mudou_recorrente) alertas++;
      } else if (r.pulado) {
        puladas++;
      } else {
        erros++;
      }
      
      // Pequeno delay entre REFs pra nao saturar
      await new Promise(r => setTimeout(r, 200));
    }
    
    await finalizar('sucesso', {
      detalhes: {
        refs_processadas: refsParaAnalisar.length,
        analisadas,
        puladas,
        erros,
        alertas_gerados: alertas,
        custo_total_brl: Math.round(custoTotalBrl * 100) / 100,
      },
    });
    
    return res.json({
      ok: true,
      duracao_ms: Date.now() - tInicio,
      refs_processadas: refsParaAnalisar.length,
      analisadas,
      puladas,
      erros,
      alertas_gerados: alertas,
      custo_total_brl: Math.round(custoTotalBrl * 100) / 100,
      resultados,
    });
  } catch (e) {
    console.error('[reviews-analise]', e);
    await finalizar('erro', { erro_msg: e.message });
    return res.status(500).json({ error: e.message });
  }
}
