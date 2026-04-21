/**
 * ia-cron.js — Motor do OS Amícia (Sprint 3 produção + Sprint 4 marketplaces).
 *
 * Orquestra o fluxo completo de geração de insights via Claude Sonnet 4.6:
 *   1. Valida auth (CRON_SECRET via query ?token= OU header X-Cron-Secret)
 *   2. Lê ?escopo= (default 'producao' pra compatibilidade com Sprint 3)
 *   3. Chama a RPC correspondente no Postgres → recebe JSONB
 *   4. Se payload vazio → grava insight "tudo saudável" e retorna 200
 *   5. Se temOrcamento() == false → pula Claude, fallback determinístico
 *   6. Chama Claude Sonnet 4.6 com prompt de sistema específico do escopo
 *      - Timeout 30s. Se timeout/erro → 1 retry com temperature=0.1
 *      - Se retry também falhar → fallback determinístico
 *   7. Parseia JSON do Claude, valida campos, grava em ia_insights
 *   8. Grava consumo em ia_usage
 *   9. Retorna { ok, total_insights_gerados, custo_brl, modo, escopo }
 *
 * Endpoints:
 *   GET  /api/ia-cron?token=<CRON_SECRET>&janela=manha|tarde&escopo=producao|marketplaces
 *        (usado pelo Vercel Cron)
 *   POST /api/ia-cron
 *        Header: X-Cron-Secret: <CRON_SECRET>
 *        Body:   { escopo?: 'producao'|'marketplaces' }
 *        (usado por /api/ia-disparar)
 *
 * Regras do briefing Sprint 3/4:
 *   - NUNCA citar "Amícia" nos insights (marca interna)
 *   - Fallback sempre confidence='media' no máximo
 *   - Refs vêm SEM zero à esquerda (função SQL já normaliza)
 *   - Origem no ia_insights: 'cron' ou 'fallback_deterministico'
 *     modelo = 'claude-sonnet-4-6' OU 'fallback_deterministico'
 */
import {
  supabase,
  getConfig,
  setCors,
  calcularCustoBRL,
  temOrcamento,
} from './_ia-helpers.js';
import { randomUUID } from 'node:crypto';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

// ═══════════════════════════════════════════════════════════════════════════
// PROMPTS DE SISTEMA (um por escopo)
// ═══════════════════════════════════════════════════════════════════════════

const PROMPT_PRODUCAO = `Você é o cérebro de decisão de produção de uma confecção feminina em São Paulo.
Recebe um JSON consolidado de refs candidatas a corte e devolve insights acionáveis.

8 REGRAS INEGOCIÁVEIS:
1. Toda análise termina em ação concreta. NÃO use "considerar", "avaliar", "monitorar".
   USE: "cortar 6 rolos hoje", "enviar 120 peças pra Dilmo", "priorizar tam M".
2. Estoque zerado nunca é critério sozinho. Cruze SEMPRE com demanda (vendas 30d).
3. Margem é desempate, nunca decisor único.
4. Produção em oficina detalha cor+tam (quando dados permitem).
5. Respeite a "confianca_ref" do input. Se vier "media" ou "baixa", não invente certeza.
6. Linguagem direta, números concretos, sem adjetivos vagos.
7. Brevidade cirúrgica: resumo ≤ 2 frases, acao_sugerida ≤ 1 frase, impacto ≤ 1 frase.
8. Nomes de produtos e refs do input são autoridade: não traduzir, não abreviar.

REGRA BÔNUS: nunca cite a marca "Amícia" no texto (é interna). Use "operação", "produção" etc.

FORMATO DE SAÍDA:
Retorne APENAS um array JSON válido, sem markdown, sem texto antes/depois.
Um objeto por ref do input, com EXATAMENTE estes campos:

[
  {
    "escopo": "producao",
    "categoria": "corte_curva_a" | "corte_curva_b" | "corte_outras" | "investigar_ref",
    "severity": "critico" | "atencao" | "positiva" | "oportunidade" | "info",
    "confidence": "alta" | "media" | "baixa",
    "titulo": "string curta (até ~60 chars)",
    "resumo": "até 2 frases com os números-chave",
    "impacto": "1 frase sobre consequência se não agir",
    "acao_sugerida": "1 frase iniciando com verbo no infinitivo",
    "chaves": { "ref": "...", "sala": "...", "curva": "..." }
  }
]

MAPEAMENTO severity ← severidade do input:
  alta  → critico
  media → atencao
  baixa → info

Se confianca_ref do input for "media" ou "baixa", rebaixe seu confidence na mesma medida.
Se sala_recomendada for null, use categoria="investigar_ref" e severity≥atencao.`;

const PROMPT_MARKETPLACES = `Você é o cérebro de decisão comercial de uma operação de marketplaces de moda feminina em São Paulo.
Recebe um JSON com 10 seções de dados (canais, contas Bling, top movers, margens, oportunidades) e devolve insights acionáveis.

10 REGRAS INEGOCIÁVEIS:
1. Toda análise termina em ação concreta. NÃO use "considerar", "avaliar", "monitorar".
   USE: "subir preço do shein pra R$ 89,90", "pausar ads de ref 2700 no ML", "replicar título da ref 2601 muniam pra exitus".
2. Variação percentual baixa (< 20%) em volume baixo (< 10 un) é ruído. Ignore.
3. Margem crítica (< R$ 8) é prioridade máxima mesmo com pouca venda.
4. Oportunidade de margem alta + venda baixa = ação de tráfego/ads, não de preço.
5. Quando uma ref tem comportamento divergente entre contas Bling (Exitus/Lumia/Muniam), investigue qual conta tem título/foto/ads melhores e sugira replicar.
6. Linguagem direta, números concretos em R$ e %. Zero adjetivos vagos.
7. Brevidade cirúrgica: resumo ≤ 2 frases, acao_sugerida ≤ 1 frase, impacto ≤ 1 frase.
8. Refs do input são autoridade (já normalizadas sem zero à esquerda).
9. Nomes de canais: sempre completos — "Mercado Livre", "Shopee", "Shein", "TikTok Shop", "Meluni".
10. Contas Bling têm nomes próprios: Exitus, Lumia, Muniam (capitalização exata).

REGRA BÔNUS: nunca cite a marca "Amícia" no texto. Use "a operação", "a loja".

PRIORIZAÇÃO DE INSIGHTS (gere EXATAMENTE entre 3 e 5 no total — NUNCA mais que 5):
  - Este é um briefing executivo, não um relatório exaustivo. Cada insight precisa merecer existir.
  - Prioridade máxima (severity=critico): margens_urgencia (lucro < 0 ou < R$ 8) — AGREGUE em 1 insight único ("X produtos com margem crítica"), não 1 por item
  - Alta (severity=atencao): a queda mais acentuada em canal OU conta Bling — 1 insight
  - Média (severity=oportunidade): a melhor oportunidade detectável (cruzamento ou margem alta + venda baixa) — 1 insight
  - Reservar 1-2 slots livres para o que for mais acionável no dia

LIMITE DE TOKENS: resposta total deve caber em ~1000 tokens. Se gerar mais de 5 insights, a resposta será cortada e TODA a análise perderá. Seja CIRÚRGICO — corte o que for ruído e mantenha só o que o Ailson precisa AGIR hoje.

FORMATO DE SAÍDA:
Retorne APENAS um array JSON válido, sem markdown, sem texto antes/depois.

REGRAS DE JSON ESTRITAS (obrigatórias pra evitar erro de parse):
- SEM vírgula depois do último item de arrays ou objetos (trailing comma é erro).
- SEMPRE aspas duplas " (NUNCA aspas inteligentes ou simples).
- Se precisar de aspas dentro de uma string, escape com \\" (ex: "resumo": "Ref 1108 \\"saia linho\\" caindo").
- Não use quebras de linha dentro de strings (substitua por espaço ou ponto).
- Não invente campos além dos listados abaixo.

[
  {
    "escopo": "marketplaces",
    "categoria": "margem_critica" | "margem_atencao" | "canal_queda" | "canal_alta" | "conta_queda" | "mover_subindo" | "mover_caindo" | "cruzamento_contas" | "oportunidade_trafego" | "ajuste_preco",
    "severity": "critico" | "atencao" | "positiva" | "oportunidade" | "info",
    "confidence": "alta" | "media" | "baixa",
    "titulo": "string curta (até ~70 chars)",
    "resumo": "até 2 frases com os números-chave",
    "impacto": "1 frase sobre consequência se não agir",
    "acao_sugerida": "1 frase iniciando com verbo no infinitivo",
    "chaves": { "ref": "...", "canal": "...", "conta": "..." }
  }
]

Preencha apenas as chaves que fazem sentido para o insight em questão. Exemplo: insight de canal não tem "ref".`;

const ESCOPOS = {
  producao: {
    rpc: 'fn_ia_cortes_recomendados',
    prompt: PROMPT_PRODUCAO,
    categoriaTudoSaudavel: 'tudo_saudavel',
    tituloTudoSaudavel: 'Nenhuma ref precisa de corte agora',
  },
  marketplaces: {
    rpc: 'fn_ia_marketplaces_insights',
    prompt: PROMPT_MARKETPLACES,
    categoriaTudoSaudavel: 'marketplaces_saudaveis',
    tituloTudoSaudavel: 'Nenhum alerta de marketplace nesta janela',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function validarAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return { ok: false, erro: 'CRON_SECRET não configurado', status: 500 };

  const tokenQuery = req.query?.token;
  const tokenHeader = req.headers['x-cron-secret'];

  if (tokenQuery === cronSecret) return { ok: true, via: 'query' };
  if (tokenHeader === cronSecret) return { ok: true, via: 'header' };

  return { ok: false, erro: 'Unauthorized', status: 401 };
}

/**
 * Conta elementos totais num payload de marketplaces. Se 0 em todas as
 * seções, sinaliza "tudo saudável".
 */
function payloadVazio(jsonInput, escopo) {
  if (escopo === 'producao') {
    const refs = Array.isArray(jsonInput?.refs) ? jsonInput.refs : [];
    return refs.length === 0;
  }
  if (escopo === 'marketplaces') {
    const secoes = [
      'canais_comparativo', 'contas_bling_7v7', 'concentracao_quedas',
      'top_movers_unificado', 'top_movers_conta', 'top_movers_cruzamento',
      'margens_urgencia', 'margens_atencao', 'plano_ajuste', 'oportunidades',
    ];
    const total = secoes.reduce((s, k) => s + (Array.isArray(jsonInput?.[k]) ? jsonInput[k].length : 0), 0);
    return total === 0;
  }
  return true;
}

/**
 * Fallback determinístico PRODUÇÃO — 1 insight por ref.
 * Trata null gracioso (ref 2851 veio com descricao="", sala=null no smoke).
 */
function gerarFallbackProducao(ref) {
  const descricaoLimpa = (ref.descricao || `REF ${ref.ref}`).trim().slice(0, 50);
  const temSala = !!ref.sala_recomendada;
  const severityMap = { alta: 'critico', media: 'atencao', baixa: 'info' };
  const severity = severityMap[ref.severidade] || 'info';

  const categoria = temSala
    ? (ref.curva === 'A' ? 'corte_curva_a'
       : ref.curva === 'B' ? 'corte_curva_b'
       : 'corte_outras')
    : 'investigar_ref';

  const acao = temSala
    ? `Cortar ${ref.pecas_a_cortar} pç em ${ref.sala_recomendada} (${ref.rendimento_sala} pç/rolo, ${ref.rolos_estimados} rolos).`
    : `Investigar ref sem sala recomendada. ${ref.qtd_variacoes_criticas || 0} variações em estado crítico.`;

  return {
    escopo: 'producao',
    categoria,
    severity,
    confidence: 'media',
    titulo: `REF ${ref.ref} · ${descricaoLimpa}`,
    resumo: `${ref.qtd_variacoes_ativas || 0} variações ativas, ${ref.qtd_variacoes_criticas || 0} críticas. Vendas 30d: ${ref.vendas_30d_total || 0} peças.`,
    impacto: `Curva ${ref.curva || '—'}. Severidade ${ref.severidade || '—'}.`,
    acao_sugerida: acao,
    chaves: {
      ref: ref.ref,
      sala: ref.sala_recomendada || null,
      curva: ref.curva || null,
    },
  };
}

/**
 * Fallback determinístico MARKETPLACES — gera insights high-level
 * cobrindo os sinais mais críticos quando Claude não pode ser usado.
 * Prioriza margens críticas, depois quedas acentuadas em canais.
 */
function gerarFallbackMarketplaces(jsonInput) {
  const insights = [];

  // 1. Margens urgentes (1 insight agregado, não 1 por item)
  const urgencias = jsonInput.margens_urgencia || [];
  if (urgencias.length > 0) {
    const ex = urgencias[0];
    insights.push({
      escopo: 'marketplaces',
      categoria: 'margem_critica',
      severity: 'critico',
      confidence: 'media',
      titulo: `${urgencias.length} produto${urgencias.length === 1 ? '' : 's'} com margem crítica`,
      resumo: `${urgencias.length} pares ref×canal com lucro abaixo de R$ 8. Pior caso: ref ${ex.ref} no ${ex.canal}, lucro R$ ${ex.lucro_peca}.`,
      impacto: 'Cada venda desses itens reduz a lucratividade total da operação.',
      acao_sugerida: `Subir preços seguindo o plano de ajuste gradual pra atingir lucro mínimo R$ 10.`,
      chaves: { ref: ex.ref, canal: ex.canal },
    });
  }

  // 2. Canais em queda acentuada
  const canais = jsonInput.canais_comparativo || [];
  const emQueda = canais.filter(c => c.var_7v7_pct !== null && c.var_7v7_pct < -20);
  if (emQueda.length > 0) {
    const pior = emQueda.sort((a, b) => a.var_7v7_pct - b.var_7v7_pct)[0];
    insights.push({
      escopo: 'marketplaces',
      categoria: 'canal_queda',
      severity: 'atencao',
      confidence: 'media',
      titulo: `Canal ${pior.canal} caindo ${pior.var_7v7_pct}% em 7 dias`,
      resumo: `${pior.canal}: ${pior.u_ult7} unidades nos últimos 7 dias vs ${pior.u_ant7} nos 7 dias anteriores (${pior.var_7v7_pct}%).`,
      impacto: 'Se a tendência persistir, o mês fecha abaixo da meta.',
      acao_sugerida: `Revisar campanhas e estoque dos top produtos no ${pior.canal}.`,
      chaves: { canal: pior.canal },
    });
  }

  // 3. Cruzamento de contas (refs com performance divergente)
  const cruz = jsonInput.top_movers_cruzamento || [];
  if (cruz.length > 0) {
    const ex = cruz[0];
    insights.push({
      escopo: 'marketplaces',
      categoria: 'cruzamento_contas',
      severity: 'oportunidade',
      confidence: 'media',
      titulo: `REF ${ex.ref} com performance divergente entre contas`,
      resumo: `Spread de ${ex.spread_var_pct} pontos percentuais entre contas Bling. Exitus ${ex.var_exitus}%, Lumia ${ex.var_lumia}%, Muniam ${ex.var_muniam}%.`,
      impacto: 'Conta mais fraca pode estar subutilizando a mesma ref.',
      acao_sugerida: 'Comparar títulos, fotos e ads da conta líder e replicar nas outras.',
      chaves: { ref: ex.ref },
    });
  }

  // 4. Oportunidades (margem alta + venda baixa)
  const oports = jsonInput.oportunidades || [];
  if (oports.length > 0) {
    const ex = oports[0];
    insights.push({
      escopo: 'marketplaces',
      categoria: 'oportunidade_trafego',
      severity: 'oportunidade',
      confidence: 'media',
      titulo: `${oports.length} oportunidade${oports.length === 1 ? '' : 's'} de tráfego com margem boa`,
      resumo: `Refs com margem ≥ R$ 10 mas vendendo < 10 un/30d. Ex: ref ${ex.ref} no ${ex.canal}, lucro R$ ${ex.lucro_peca} por peça.`,
      impacto: 'Volume baixo em margem alta significa lucro potencial represado.',
      acao_sugerida: 'Investir em ads ou revisar título/foto dos 3-5 itens de maior margem.',
      chaves: { ref: ex.ref, canal: ex.canal },
    });
  }

  // Se nada disparou alerta, gera 1 insight neutro
  if (insights.length === 0) {
    insights.push({
      escopo: 'marketplaces',
      categoria: 'marketplaces_saudaveis',
      severity: 'info',
      confidence: 'media',
      titulo: 'Marketplaces dentro do esperado (fallback)',
      resumo: 'Nenhum sinal forte de urgência. Fallback determinístico ativo por falta de orçamento ou erro do modelo.',
      impacto: 'Recomendado rodar análise completa na próxima janela.',
      acao_sugerida: 'Revisar no próximo cron.',
      chaves: {},
    });
  }

  return insights;
}

function validarInsight(i, escopoEsperado) {
  if (!i || typeof i !== 'object') return null;
  if (!i.escopo || !i.severity || !i.confidence || !i.titulo) return null;
  const severityValidos = ['critico', 'atencao', 'positiva', 'oportunidade', 'info'];
  const confidenceValidos = ['alta', 'media', 'baixa'];
  if (!severityValidos.includes(i.severity)) return null;
  if (!confidenceValidos.includes(i.confidence)) return null;

  return {
    escopo: escopoEsperado,
    categoria: i.categoria || null,
    severity: i.severity,
    confidence: i.confidence,
    titulo: String(i.titulo).slice(0, 200),
    resumo: i.resumo ? String(i.resumo).slice(0, 500) : null,
    impacto: i.impacto ? String(i.impacto).slice(0, 300) : null,
    acao_sugerida: i.acao_sugerida ? String(i.acao_sugerida).slice(0, 300) : null,
    chaves: i.chaves && typeof i.chaves === 'object' ? i.chaves : null,
  };
}

async function chamarClaude({ jsonInput, modelo, temperature, max_tokens, timeoutMs, systemPrompt }) {
  try {
    const r = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(jsonInput) }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { ok: false, erro: `Claude ${r.status}: ${body.slice(0, 200)}` };
    }

    const data = await r.json();
    const texto = data.content?.[0]?.text?.trim() || '';
    const usage = data.usage || { input_tokens: 0, output_tokens: 0 };

    // Remove cercas de markdown
    let limpo = texto.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

    // Tenta parse direto primeiro (caminho feliz)
    let arr = null;
    try {
      arr = JSON.parse(limpo);
    } catch (e1) {
      // Parser tolerante: corrige problemas comuns do output do Claude.
      // Sonnet ocasionalmente gera:
      //   - virgula extra antes de ] ou }  (trailing comma)
      //   - aspas "inteligentes" em vez de " (smart quotes)
      //   - aspas nao escapadas dentro de strings
      const tolerante = limpo
        .replace(/[\u201C\u201D]/g, '"')           // smart double quotes -> "
        .replace(/[\u2018\u2019]/g, "'")           // smart single quotes -> '
        .replace(/,(\s*[}\]])/g, '$1')              // trailing comma antes de } ou ]
        .replace(/}\s*{/g, '},{')                   // } { -> },{ (objetos colados sem virgula)
        ;

      try {
        arr = JSON.parse(tolerante);
      } catch (e2) {
        // Se ainda falhou, salva fingerprint do erro pra investigacao
        return {
          ok: false,
          erro: `JSON inválido do Claude: ${e1.message}`,
          raw: limpo.slice(0, 500),
          raw_tail: limpo.slice(-300),
          tentou_tolerante: true,
        };
      }
    }

    if (!Array.isArray(arr)) {
      return { ok: false, erro: 'Claude retornou não-array', raw: limpo.slice(0, 300) };
    }

    return { ok: true, insights: arr, usage };
  } catch (e) {
    const isTimeout = e.name === 'TimeoutError' || e.name === 'AbortError';
    return { ok: false, erro: isTimeout ? 'timeout' : (e.message || 'erro desconhecido') };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = validarAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.erro });

  // Escopo vem de query (cron do Vercel) OU body (ia-disparar POST).
  // Default 'producao' preserva compatibilidade Sprint 3.
  const escopo = (req.query?.escopo || req.body?.escopo || 'producao').toLowerCase();
  if (!ESCOPOS[escopo]) {
    return res.status(400).json({ error: `Escopo inválido: ${escopo}. Aceitos: producao, marketplaces.` });
  }
  const cfg = ESCOPOS[escopo];

  const janela = req.query?.janela || 'manual';
  const cronRunId = randomUUID();
  const t0 = Date.now();

  try {
    // 1. Chama a RPC do Postgres correspondente ao escopo
    const { data: jsonInput, error: errFn } = await supabase.rpc(cfg.rpc);
    if (errFn) {
      return res.status(500).json({
        error: `${cfg.rpc} falhou: ${errFn.message}`,
        escopo,
        cron_run_id: cronRunId,
      });
    }

    // 2. Payload vazio → tudo saudável
    if (payloadVazio(jsonInput, escopo)) {
      // Snapshot: apaga insights antigos do escopo antes de inserir o "tudo saudavel"
      await supabase.from('ia_insights').delete().eq('escopo', escopo);

      const insight = {
        escopo,
        categoria: cfg.categoriaTudoSaudavel,
        severity: 'positiva',
        confidence: 'alta',
        titulo: cfg.tituloTudoSaudavel,
        resumo: 'Nenhum item elegível passou pelos gatekeepers desta janela.',
        impacto: 'Operação em estado saudável.',
        acao_sugerida: 'Revisar na próxima janela de cron.',
        chaves: { janela },
        payload: jsonInput,
        origem: 'cron',
        modelo: 'sem_claude',
        cron_run_id: cronRunId,
      };
      await supabase.from('ia_insights').insert(insight);
      return res.json({
        ok: true,
        modo: 'sem_itens',
        escopo,
        total_insights_gerados: 1,
        custo_brl: 0,
        cron_run_id: cronRunId,
        duracao_ms: Date.now() - t0,
      });
    }

    // 3. Configs
    const modelo = (await getConfig('claude_modelo', 'claude-sonnet-4-6')) || 'claude-sonnet-4-6';
    const temperatura = Number(await getConfig('claude_temperatura', 0.3));
    const maxTokens = Number(await getConfig('claude_max_tokens', escopo === 'marketplaces' ? 2500 : 1500));
    const timeoutS = Number(await getConfig('claude_timeout_s', 30));
    const timeoutMs = timeoutS * 1000;

    // 4. Decide: Claude ou fallback direto?
    const orcamentoOk = await temOrcamento();
    let modo = 'claude';
    let insightsBrutos = [];
    let usageClaude = null;
    let erroClaude = null;

    if (!orcamentoOk) {
      modo = 'fallback_orcamento';
      insightsBrutos = escopo === 'marketplaces'
        ? gerarFallbackMarketplaces(jsonInput)
        : (jsonInput.refs || []).map(gerarFallbackProducao);
    } else {
      const tentativa1 = await chamarClaude({
        jsonInput, modelo,
        temperature: temperatura, max_tokens: maxTokens, timeoutMs,
        systemPrompt: cfg.prompt,
      });

      if (tentativa1.ok) {
        insightsBrutos = tentativa1.insights;
        usageClaude = tentativa1.usage;
      } else {
        erroClaude = tentativa1.erro;
        const tentativa2 = await chamarClaude({
          jsonInput, modelo,
          temperature: 0.1, max_tokens: maxTokens, timeoutMs,
          systemPrompt: cfg.prompt,
        });

        if (tentativa2.ok) {
          insightsBrutos = tentativa2.insights;
          usageClaude = tentativa2.usage;
          modo = 'claude_retry';
        } else {
          modo = 'fallback_erro';
          erroClaude = `1ª: ${erroClaude} | 2ª: ${tentativa2.erro}`;
          insightsBrutos = escopo === 'marketplaces'
            ? gerarFallbackMarketplaces(jsonInput)
            : (jsonInput.refs || []).map(gerarFallbackProducao);
        }
      }
    }

    // 5. Valida e prepara
    const usouClaude = modo === 'claude' || modo === 'claude_retry';
    const origemBanco = usouClaude ? 'cron' : 'fallback_deterministico';
    const modeloBanco = usouClaude ? modelo : 'fallback_deterministico';

    const insightsValidos = insightsBrutos
      .map(i => validarInsight(i, escopo))
      .filter(Boolean)
      .map(i => ({
        ...i,
        payload: { janela, cron_run_id: cronRunId, escopo },
        origem: origemBanco,
        modelo: modeloBanco,
        cron_run_id: cronRunId,
      }));

    // Se Claude passou mas validação descartou tudo, cai pro fallback
    if (insightsValidos.length === 0 && usouClaude) {
      modo = 'fallback_validacao';
      const fallback = escopo === 'marketplaces'
        ? gerarFallbackMarketplaces(jsonInput)
        : (jsonInput.refs || []).map(gerarFallbackProducao);
      const doFallback = fallback
        .map(i => validarInsight(i, escopo))
        .filter(Boolean)
        .map(i => ({
          ...i,
          payload: { janela, cron_run_id: cronRunId, escopo, erro_claude: 'validacao_falhou' },
          origem: 'fallback_deterministico',
          modelo: 'fallback_deterministico',
          cron_run_id: cronRunId,
        }));
      insightsValidos.push(...doFallback);
    }

    // 6. SNAPSHOT: apaga insights anteriores DESTE escopo antes de inserir os novos.
    //    Cada disparo substitui o estado atual (insights sao retrato do momento, nao log).
    //    Nao afeta insights de outros escopos (producao e marketplaces sao independentes).
    if (insightsValidos.length > 0) {
      const { error: errDel } = await supabase
        .from('ia_insights')
        .delete()
        .eq('escopo', escopo);

      if (errDel) {
        // Nao fatal: loga mas prossegue. Pior caso: feed fica com duplicatas.
        console.error('[ia-cron] delete snapshot falhou:', errDel.message);
      }

      const { error: errIns } = await supabase.from('ia_insights').insert(insightsValidos);
      if (errIns) {
        return res.status(500).json({
          error: `Insert ia_insights falhou: ${errIns.message}`,
          escopo,
          cron_run_id: cronRunId,
        });
      }
    }

    // 7. ia_usage
    let custoBRL = 0;
    let custoUSD = 0;
    const hoje = new Date().toISOString().slice(0, 10);
    const anoMes = hoje.slice(0, 7);

    if (usageClaude) {
      const custo = await calcularCustoBRL({
        modelo,
        input_tokens: usageClaude.input_tokens || 0,
        output_tokens: usageClaude.output_tokens || 0,
      });
      custoBRL = custo.custo_brl;
      custoUSD = custo.custo_usd;

      await supabase.from('ia_usage').insert({
        data: hoje,
        ano_mes: anoMes,
        tipo: 'cron',
        modelo,
        input_tokens: usageClaude.input_tokens || 0,
        output_tokens: usageClaude.output_tokens || 0,
        custo_usd: custoUSD,
        custo_brl: custoBRL,
        user_id: 'cron',
      });
    } else {
      await supabase.from('ia_usage').insert({
        data: hoje,
        ano_mes: anoMes,
        tipo: 'cron',
        modelo: 'fallback_deterministico',
        input_tokens: 0,
        output_tokens: 0,
        custo_usd: 0,
        custo_brl: 0,
        user_id: 'cron',
      });
    }

    return res.json({
      ok: true,
      modo,
      escopo,
      janela,
      total_insights_gerados: insightsValidos.length,
      custo_usd: custoUSD,
      custo_brl: custoBRL,
      cron_run_id: cronRunId,
      erro_claude: erroClaude,
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message || 'erro interno',
      escopo,
      cron_run_id: cronRunId,
      duracao_ms: Date.now() - t0,
    });
  }
}
