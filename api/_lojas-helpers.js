/**
 * _lojas-helpers.js — Helpers compartilhados dos endpoints do módulo Lojas.
 *
 * Padrão: mesmo template do api/_ia-helpers.js (módulo IA Pergunta) e
 * api/_ml-helpers.js (SAC do ML). Ambos usam SUPABASE_KEY como service role.
 *
 * O que tem aqui:
 *   - cliente Supabase com service role (bypass RLS)
 *   - validação de usuário (admin OU vendedora)
 *   - helpers de config Lojas (lojas_config) e IA global (ia_config)
 *   - chamada Claude com cache + parser JSON tolerante
 *   - cálculo de custo BRL e checagem de orçamento
 *   - log estruturado em lojas_ia_chamadas_log
 *   - rate limit por vendedora
 *   - CORS padrão
 */

import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════════════════════════
// SUPABASE — service role (igual aos outros endpoints do projeto)
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
// Padrão do app: SUPABASE_KEY é a service_role.
// Aceita SUPABASE_SERVICE_ROLE_KEY também por compatibilidade.
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('[lojas-helpers] SUPABASE_URL ou SUPABASE_KEY ausentes nas env vars');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

// ═══════════════════════════════════════════════════════════════════════════
// USUÁRIOS / PERMISSÕES
// ═══════════════════════════════════════════════════════════════════════════

// Admins do módulo Lojas (mesmo array do LojasInstrucoes.jsx, replicado aqui
// pra Edge Function não precisar importar JSX)
const USUARIOS_ACESSO_TOTAL_LOJAS = ['amicia-admin', 'ailson', 'tamara'];

export function ehAdminLojas(userId) {
  if (!userId) return false;
  const norm = String(userId).trim().toLowerCase();
  return USUARIOS_ACESSO_TOTAL_LOJAS.map(u => u.toLowerCase()).includes(norm);
}

/**
 * Valida quem chamou a Edge Function. Aceita admin OU vendedora.
 * Lê de header X-User (mesmo padrão do _ia-helpers.js).
 *
 * Pra ações que só admin pode fazer (gerar sugestões pra OUTRA vendedora),
 * o caller deve checar o resultado.isAdmin separadamente.
 *
 * Retorna { ok, isAdmin, vendedoraId, userId, error?, status? }
 */
export async function validarUsuario(req) {
  const usuario = req.headers['x-user'] || req.body?.usuario;
  if (!usuario) {
    return { ok: false, error: 'Header X-User ausente', status: 401 };
  }

  // Se é admin global do Lojas, libera tudo
  if (ehAdminLojas(usuario)) {
    return { ok: true, isAdmin: true, userId: usuario, vendedoraId: null };
  }

  // Caso contrário, busca vendedora pelo user_id
  try {
    const { data, error } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome, ativa')
      .eq('user_id', usuario)
      .maybeSingle();

    if (error) return { ok: false, error: error.message, status: 500 };
    if (!data) return { ok: false, error: 'Usuário não cadastrado como vendedora ou admin', status: 403 };
    if (!data.ativa) return { ok: false, error: 'Vendedora inativa', status: 403 };

    return { ok: true, isAdmin: false, userId: usuario, vendedoraId: data.id, vendedoraNome: data.nome };
  } catch (e) {
    return { ok: false, error: e.message || 'Erro validação', status: 500 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG (lê tanto lojas_config quanto ia_config — orçamento é compartilhado)
// ═══════════════════════════════════════════════════════════════════════════

export async function getLojasConfig(chave, fallback = null) {
  try {
    const { data } = await supabase
      .from('lojas_config')
      .select('valor')
      .eq('chave', chave)
      .maybeSingle();
    if (data?.valor === undefined || data?.valor === null) return fallback;
    return data.valor;
  } catch {
    return fallback;
  }
}

export async function getIaConfig(chave, fallback = null) {
  try {
    const { data } = await supabase
      .from('ia_config')
      .select('valor')
      .eq('chave', chave)
      .maybeSingle();
    if (data?.valor === undefined || data?.valor === null) return fallback;
    return data.valor;
  } catch {
    return fallback;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRICING ANTHROPIC + CÁLCULO DE CUSTO
// ═══════════════════════════════════════════════════════════════════════════

// Tabela de preços (USD por 1M tokens). Mesma do api/_ia-helpers.js — manter
// em sync se o pricing mudar.
export const ANTHROPIC_PRICING = {
  'claude-sonnet-4-6': {
    input_per_mtok: 3.00,
    output_per_mtok: 15.00,
    cache_read_per_mtok: 0.30,    // 10% do input (cache hit)
    cache_write_per_mtok: 3.75,   // 125% do input (cache write)
  },
  // Compat com possíveis outros modelos (mesmo pricing — opus seria diferente)
  'claude-sonnet-4-7': {
    input_per_mtok: 3.00,
    output_per_mtok: 15.00,
    cache_read_per_mtok: 0.30,
    cache_write_per_mtok: 3.75,
  },
};

export async function calcularCustoBRL({
  modelo, input_tokens = 0, output_tokens = 0,
  cache_read_tokens = 0, cache_write_tokens = 0,
}) {
  const pricing = ANTHROPIC_PRICING[modelo] || ANTHROPIC_PRICING['claude-sonnet-4-6'];
  const taxaUSDBRL = Number(await getIaConfig('taxa_usd_brl', 5.25));

  const custoUSD =
    (input_tokens / 1e6) * pricing.input_per_mtok +
    (output_tokens / 1e6) * pricing.output_per_mtok +
    (cache_read_tokens / 1e6) * pricing.cache_read_per_mtok +
    (cache_write_tokens / 1e6) * pricing.cache_write_per_mtok;

  return {
    custo_usd: Math.round(custoUSD * 1e6) / 1e6,
    custo_brl: Math.round(custoUSD * taxaUSDBRL * 10000) / 10000,
  };
}

/**
 * Soma gasto do mês corrente em BRL — combina lojas_ia_chamadas_log com
 * ia_usage (módulo IA Pergunta). O orçamento é GLOBAL.
 */
export async function gastoMesAtualBRL() {
  const agora = new Date();
  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
  const anoMes = agora.toISOString().slice(0, 7);

  // 1) Gasto do Lojas
  let gastoLojas = 0;
  try {
    const { data: logsLojas } = await supabase
      .from('lojas_ia_chamadas_log')
      .select('custo_estimado_usd')
      .gte('created_at', inicioMes);
    const taxa = Number(await getIaConfig('taxa_usd_brl', 5.25));
    gastoLojas = (logsLojas || []).reduce(
      (s, r) => s + Number(r.custo_estimado_usd || 0) * taxa, 0
    );
  } catch (e) {
    console.warn('[lojas-helpers] erro somar gastoLojas', e.message);
  }

  // 2) Gasto da IA Pergunta (ia_usage)
  let gastoIaPergunta = 0;
  try {
    const { data: logsIa } = await supabase
      .from('ia_usage')
      .select('custo_brl')
      .eq('ano_mes', anoMes);
    gastoIaPergunta = (logsIa || []).reduce((s, r) => s + Number(r.custo_brl || 0), 0);
  } catch (e) {
    console.warn('[lojas-helpers] erro somar gastoIaPergunta', e.message);
  }

  return gastoLojas + gastoIaPergunta;
}

export async function temOrcamento() {
  const gasto = await gastoMesAtualBRL();
  // Lê de ia_config (compartilhado). Default R$ 200 (acordado pelo Ailson).
  const limite = Number(await getIaConfig('orcamento_brl_mensal', 200));
  return { ok: gasto < limite, gasto, limite };
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMIT (por vendedora)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Checa se a vendedora está dentro do rate limit.
 * Default: 3000ms entre chamadas (lê de lojas_config.rate_limit_ms).
 *
 * Retorna { ok, msEspera? }
 */
export async function checarRateLimit(vendedoraId) {
  if (!vendedoraId) return { ok: true };
  const limitMs = Number(await getLojasConfig('rate_limit_ms', 3000));
  const cutoff = new Date(Date.now() - limitMs).toISOString();

  try {
    const { data } = await supabase
      .from('lojas_ia_chamadas_log')
      .select('created_at')
      .eq('vendedora_id', vendedoraId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return { ok: true };
    const msPassados = Date.now() - new Date(data.created_at).getTime();
    const msEspera = limitMs - msPassados;
    return { ok: false, msEspera };
  } catch {
    // Em caso de erro na query, libera (anti-falha em produção)
    return { ok: true };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHAMADA ANTHROPIC
// ═══════════════════════════════════════════════════════════════════════════

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

/**
 * Chama Claude com cache do system prompt + few-shot.
 *
 * IMPORTANTE: Pra usar cache, sytemBlocks deve vir como array de blocos.
 * Cada bloco tem `cache_control: { type: 'ephemeral' }` se quiser cachear.
 *
 * Retorna { ok, texto, usage, modelo, latencia_ms } ou { ok:false, erro }
 */
export async function chamarClaude({
  modelo = 'claude-sonnet-4-6',
  systemBlocks,           // array de blocos com cache_control
  messages,
  max_tokens = 2000,
  temperature = 0.7,
  timeoutMs = 60000,
}) {
  const t0 = Date.now();
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
        system: systemBlocks,
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const latencia_ms = Date.now() - t0;

    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return {
        ok: false,
        erro: `Claude ${r.status}: ${body.slice(0, 300)}`,
        latencia_ms,
      };
    }

    const data = await r.json();
    const texto = data.content?.[0]?.text?.trim() || '';
    const usage = data.usage || {};

    return {
      ok: true,
      texto,
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_input_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
      },
      modelo,
      latencia_ms,
    };
  } catch (e) {
    return {
      ok: false,
      erro: e.name === 'TimeoutError' ? 'Claude timeout' : (e.message || 'Erro Claude'),
      latencia_ms: Date.now() - t0,
    };
  }
}

/**
 * Parser JSON tolerante. Sonnet ocasionalmente devolve JSON com:
 *   - cercas markdown (```json...```)
 *   - smart quotes
 *   - trailing commas
 *   - objetos colados sem vírgula
 *
 * Igual ao do api/ia-cron.js — testado em produção.
 *
 * Retorna { ok, parsed } ou { ok:false, erro, raw }
 */
export function parseJsonTolerante(texto) {
  if (!texto) return { ok: false, erro: 'texto vazio', raw: texto };

  // Remove cercas markdown
  let limpo = texto.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();

  // Tenta direto
  try {
    return { ok: true, parsed: JSON.parse(limpo) };
  } catch (e1) {
    // Tenta com correções
    const tolerante = limpo
      .replace(/[\u201C\u201D]/g, '"')         // smart double quotes
      .replace(/[\u2018\u2019]/g, "'")         // smart single quotes
      .replace(/,(\s*[}\]])/g, '$1')           // trailing commas
      .replace(/}\s*{/g, '},{');               // objetos colados

    try {
      return { ok: true, parsed: JSON.parse(tolerante) };
    } catch (e2) {
      return {
        ok: false,
        erro: `JSON inválido: ${e2.message}`,
        raw: limpo.slice(0, 500),
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LOG ESTRUTURADO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Loga chamada IA em lojas_ia_chamadas_log.
 *
 * Não bloqueia fluxo principal — em caso de erro, só logga no console.
 */
export async function logarChamadaIA({
  vendedoraId,
  userId,
  tipoPrompt,             // 'sugestoes' | 'mensagem'
  modelo,
  usage,                  // { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
  latencia_ms,
  requestSummary,
  responseSummary,
  erro = null,
}) {
  try {
    const { custo_usd } = await calcularCustoBRL({
      modelo,
      input_tokens: usage?.input_tokens || 0,
      output_tokens: usage?.output_tokens || 0,
      cache_read_tokens: usage?.cache_read_input_tokens || 0,
      cache_write_tokens: usage?.cache_creation_input_tokens || 0,
    });

    await supabase.from('lojas_ia_chamadas_log').insert({
      vendedora_id: vendedoraId || null,
      user_id: userId || null,
      tipo_prompt: tipoPrompt,
      modelo,
      tokens_input: usage?.input_tokens || 0,
      tokens_output: usage?.output_tokens || 0,
      tokens_cache_read: usage?.cache_read_input_tokens || 0,
      tokens_cache_write: usage?.cache_creation_input_tokens || 0,
      custo_estimado_usd: custo_usd,
      latencia_ms: latencia_ms || null,
      request_summary: requestSummary ? String(requestSummary).slice(0, 1000) : null,
      response_summary: responseSummary ? String(responseSummary).slice(0, 1000) : null,
      erro: erro ? String(erro).slice(0, 500) : null,
    });
  } catch (e) {
    console.warn('[lojas-helpers] erro ao logar chamada IA:', e.message);
    // não rethrow — log não pode bloquear fluxo
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CORS
// ═══════════════════════════════════════════════════════════════════════════

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS DIVERSOS
// ═══════════════════════════════════════════════════════════════════════════

/** Normaliza REF removendo zeros à esquerda. */
export function refSemZero(ref) {
  if (!ref) return '';
  return String(ref).replace(/^0+/, '') || '0';
}

/** Calcula dias entre uma data ISO e hoje. */
export function diasDesde(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
