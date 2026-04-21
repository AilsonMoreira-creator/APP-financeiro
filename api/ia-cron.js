/**
 * ia-cron.js — Motor do OS Amícia (Sprint 3).
 *
 * Orquestra o fluxo completo de geração de insights de produção:
 *   1. Valida auth (CRON_SECRET via query ?token= OU header X-Cron-Secret)
 *   2. Chama fn_ia_cortes_recomendados() no Postgres → recebe JSONB
 *   3. Se refs == 0 → grava insight "tudo saudável" e retorna 200
 *   4. Se temOrcamento() == false → pula Claude, fallback determinístico
 *   5. Chama Claude Sonnet 4.6 com as 8 regras do prompt de sistema
 *      - Timeout 30s. Se timeout/erro → 1 retry com temperature=0.1
 *      - Se retry também falhar → fallback determinístico
 *   6. Parseia JSON do Claude, valida campos, grava em ia_insights
 *   7. Grava consumo em ia_usage
 *   8. Retorna { ok, total_insights_gerados, custo_brl, modo }
 *
 * Endpoints:
 *   GET  /api/ia-cron?token=<CRON_SECRET>&janela=manha|tarde
 *        (usado pelo Vercel Cron na query)
 *   POST /api/ia-cron
 *        Header: X-Cron-Secret: <CRON_SECRET>
 *        (usado por /api/ia-disparar quando admin clica "Disparar agora")
 *
 * Regras do briefing Sprint 3:
 *   - NUNCA citar "Amícia" nos insights (marca interna)
 *   - Fallback sempre confidence='media' no máximo
 *   - Refs vêm SEM zero à esquerda (função já normaliza)
 *   - Tratar null em sala_recomendada, descricao vazia, etc.
 *   - Origem no ia_insights: 'cron' ou 'fallback_deterministico' (CHECK constraint)
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

// ─── Prompt de sistema · 8 regras do briefing seção 7 ───────────────────────
const PROMPT_SISTEMA = `Você é o cérebro de decisão de produção de uma confecção feminina em São Paulo.
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

// ─── Helpers internos ───────────────────────────────────────────────────────

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
 * Fallback determinístico — gera 1 insight por ref a partir do JSONB puro
 * da função. Nunca explode; trata null gracioso (ref 2851 no teste real de
 * 21/04 veio com descricao="", sala_recomendada=null).
 */
function gerarFallback(ref) {
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
    confidence: 'media',  // fallback nunca passa de media (regra do briefing)
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
 * Valida um insight parseado do Claude. Retorna null se inválido.
 * Campos mínimos obrigatórios: escopo, severity, confidence, titulo.
 */
function validarInsight(i) {
  if (!i || typeof i !== 'object') return null;
  if (!i.escopo || !i.severity || !i.confidence || !i.titulo) return null;
  const severityValidos = ['critico', 'atencao', 'positiva', 'oportunidade', 'info'];
  const confidenceValidos = ['alta', 'media', 'baixa'];
  if (!severityValidos.includes(i.severity)) return null;
  if (!confidenceValidos.includes(i.confidence)) return null;
  return {
    escopo: 'producao',  // sprint 3 só gera producao
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

/**
 * Chama Claude Sonnet 4.6 com timeout. Retorna { ok, insights?, usage?, erro? }.
 * Tenta 1x. Quem orquestra retry é o handler principal.
 */
async function chamarClaude({ jsonInput, modelo, temperature, max_tokens, timeoutMs }) {
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
        system: PROMPT_SISTEMA,
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

    // Remove cercas de markdown se o modelo teimou em colocar
    const limpo = texto.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

    let arr;
    try {
      arr = JSON.parse(limpo);
    } catch (e) {
      return { ok: false, erro: `JSON inválido do Claude: ${e.message}`, raw: limpo.slice(0, 300) };
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

// ─── Handler principal ──────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth
  const auth = validarAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.erro });

  const janela = req.query?.janela || 'manual';
  const cronRunId = randomUUID();
  const t0 = Date.now();

  try {
    // 1. Chama a função do Postgres
    const { data: jsonInput, error: errFn } = await supabase.rpc('fn_ia_cortes_recomendados');
    if (errFn) {
      return res.status(500).json({
        error: `fn_ia_cortes_recomendados falhou: ${errFn.message}`,
        cron_run_id: cronRunId,
      });
    }

    const refs = Array.isArray(jsonInput?.refs) ? jsonInput.refs : [];

    // 2. Zero refs → tudo saudável
    if (refs.length === 0) {
      const insight = {
        escopo: 'producao',
        categoria: 'tudo_saudavel',
        severity: 'positiva',
        confidence: 'alta',
        titulo: 'Nenhuma ref precisa de corte agora',
        resumo: `Capacidade semanal: ${jsonInput?.capacidade_semanal?.status || 'normal'}. Nenhuma ref elegível passou pelo gatekeeper de demanda.`,
        impacto: 'Operação em cobertura saudável nesta janela.',
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
        modo: 'sem_refs',
        total_insights_gerados: 1,
        custo_brl: 0,
        cron_run_id: cronRunId,
        duracao_ms: Date.now() - t0,
      });
    }

    // 3. Config da chamada
    const modelo = (await getConfig('claude_modelo', 'claude-sonnet-4-6')) || 'claude-sonnet-4-6';
    const temperatura = Number(await getConfig('claude_temperatura', 0.3));
    const maxTokens = Number(await getConfig('claude_max_tokens', 1500));
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
      insightsBrutos = refs.map(gerarFallback);
    } else {
      // Tenta Claude com temperatura padrão
      const tentativa1 = await chamarClaude({
        jsonInput, modelo, temperature: temperatura, max_tokens: maxTokens, timeoutMs,
      });

      if (tentativa1.ok) {
        insightsBrutos = tentativa1.insights;
        usageClaude = tentativa1.usage;
      } else {
        erroClaude = tentativa1.erro;
        // Retry 1× com temperatura mais determinística (0.1)
        const tentativa2 = await chamarClaude({
          jsonInput, modelo, temperature: 0.1, max_tokens: maxTokens, timeoutMs,
        });

        if (tentativa2.ok) {
          insightsBrutos = tentativa2.insights;
          usageClaude = tentativa2.usage;
          modo = 'claude_retry';
        } else {
          // Fallback determinístico
          modo = 'fallback_erro';
          erroClaude = `1ª: ${erroClaude} | 2ª: ${tentativa2.erro}`;
          insightsBrutos = refs.map(gerarFallback);
        }
      }
    }

    // 5. Valida e prepara pra insert
    const usouClaude = modo === 'claude' || modo === 'claude_retry';
    const origemBanco = usouClaude ? 'cron' : 'fallback_deterministico';
    const modeloBanco = usouClaude ? modelo : 'fallback_deterministico';

    const insightsValidos = insightsBrutos
      .map(validarInsight)
      .filter(Boolean)
      .map(i => ({
        ...i,
        payload: { janela, cron_run_id: cronRunId },
        origem: origemBanco,
        modelo: modeloBanco,
        cron_run_id: cronRunId,
      }));

    // Se Claude passou mas validação descartou tudo, cai pro fallback
    if (insightsValidos.length === 0 && usouClaude) {
      modo = 'fallback_validacao';
      const doFallback = refs.map(gerarFallback).map(validarInsight).filter(Boolean).map(i => ({
        ...i,
        payload: { janela, cron_run_id: cronRunId, erro_claude: 'validacao_falhou' },
        origem: 'fallback_deterministico',
        modelo: 'fallback_deterministico',
        cron_run_id: cronRunId,
      }));
      insightsValidos.push(...doFallback);
    }

    // 6. Insert
    if (insightsValidos.length > 0) {
      const { error: errIns } = await supabase.from('ia_insights').insert(insightsValidos);
      if (errIns) {
        return res.status(500).json({
          error: `Insert ia_insights falhou: ${errIns.message}`,
          cron_run_id: cronRunId,
        });
      }
    }

    // 7. Grava ia_usage
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
      // Fallback: grava auditoria com custo 0.
      // ⚠️ ia_usage.tipo tem CHECK IN ('cron','pergunta_livre','retry') — não aceita 'fallback'.
      //    Marcamos como 'cron' e identificamos via modelo='fallback_deterministico'.
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
      janela,
      total_refs_entrada: refs.length,
      total_insights_gerados: insightsValidos.length,
      custo_usd: custoUSD,
      custo_brl: custoBRL,
      cron_run_id: cronRunId,
      erro_claude: erroClaude,  // null se tudo OK
      duracao_ms: Date.now() - t0,
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message || 'erro interno',
      cron_run_id: cronRunId,
      duracao_ms: Date.now() - t0,
    });
  }
}
