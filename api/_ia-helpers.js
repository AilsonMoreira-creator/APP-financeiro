/**
 * _ia-helpers.js — Helpers compartilhados dos endpoints do OS Amícia.
 *
 * - cliente Supabase com service role (bypass RLS)
 * - validação admin-only via header X-User
 * - helpers de config/sazonalidade
 * - helpers de custo Anthropic
 *
 * Padrão seguido: igual ao _bling-helpers.js e _ordens-corte-helpers.js
 * que já existem no projeto.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
// Padrão do app: SUPABASE_KEY é a service_role (ver api/_ml-helpers.js e api/ml-skumap-*.js)
// Aceitamos também SUPABASE_SERVICE_ROLE_KEY por compatibilidade.
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('[ia-helpers] SUPABASE_URL ou SUPABASE_KEY ausentes nas env vars');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { persistSession: false },
});

/**
 * Valida se o request vem de um admin. Padrão do app: admin é
 * identificado pelo header X-User (preenchido pelo frontend com
 * usuarioLogado.usuario quando admin===true).
 *
 * Como o app atual não tem auth formal do Supabase, checamos contra
 * a tabela `amicia_data` user_id='usuarios' pra confirmar que o
 * usuário declarado é de fato admin.
 *
 * Retorna { ok: true, user } ou { ok: false, error, status }.
 */
export async function validarAdmin(req) {
  const usuario = req.headers['x-user'] || req.body?.usuario;
  if (!usuario) {
    return { ok: false, error: 'Header X-User ausente', status: 401 };
  }

  try {
    const { data, error } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'usuarios')
      .maybeSingle();

    if (error) return { ok: false, error: error.message, status: 500 };

    const lista = data?.payload?.usuarios || [];
    const encontrado = lista.find(u => u.usuario === usuario);

    if (!encontrado) {
      return { ok: false, error: 'Usuário não encontrado', status: 403 };
    }
    if (encontrado.admin !== true) {
      return { ok: false, error: 'Apenas admin', status: 403 };
    }

    return { ok: true, user: encontrado };
  } catch (e) {
    return { ok: false, error: e.message || 'Erro validação admin', status: 500 };
  }
}

/**
 * Lê um valor de ia_config. Retorna `fallback` se a chave não existir
 * ou se houver erro (nunca explode).
 */
export async function getConfig(chave, fallback = null) {
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

/**
 * Helper de CORS padrão dos endpoints do app.
 */
export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
}

/**
 * Custo Anthropic por token (USD). Preços Sonnet 4.6 no momento
 * (21/04/2026). Se Anthropic mudar, ajustar aqui ou mover pra ia_config.
 */
export const ANTHROPIC_PRICING = {
  'claude-sonnet-4-6': {
    input_per_mtok: 3.00,       // $3 / 1M input tokens
    output_per_mtok: 15.00,     // $15 / 1M output tokens
    cache_read_per_mtok: 0.30,  // 10% do input
    cache_write_per_mtok: 3.75, // 125% do input
  },
};

/**
 * Converte consumo em BRL usando taxa de ia_config.
 */
export async function calcularCustoBRL({ modelo, input_tokens, output_tokens, cache_read_tokens = 0, cache_write_tokens = 0 }) {
  const pricing = ANTHROPIC_PRICING[modelo];
  if (!pricing) return { custo_usd: 0, custo_brl: 0 };

  const taxaUSDBRL = Number(await getConfig('taxa_usd_brl', 5.25));

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
 * Soma gasto do mês corrente em ia_usage (BRL).
 */
export async function gastoMesAtual() {
  const agora = new Date();
  const anoMes = agora.toISOString().slice(0, 7);
  const { data } = await supabase
    .from('ia_usage')
    .select('custo_brl')
    .eq('ano_mes', anoMes);
  if (!data) return 0;
  return data.reduce((s, r) => s + Number(r.custo_brl || 0), 0);
}

/**
 * Retorna true se ainda há orçamento pra gastar.
 */
export async function temOrcamento() {
  const gasto = await gastoMesAtual();
  const limite = Number(await getConfig('orcamento_brl_mensal', 80));
  return gasto < limite;
}
