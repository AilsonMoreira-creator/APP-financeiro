// ═══════════════════════════════════════════════════════════════════════════
// _lojas-whats-helpers.js — Funções compartilhadas do módulo Sofia (lojas-whats)
// ═══════════════════════════════════════════════════════════════════════════
// Sofia é a assistente IA que atende carrinhos abandonados via WhatsApp.
// Tamara revisa cada mensagem (100% aprovação humana no MVP).
//
// Prefixo _ = Vercel não expõe como endpoint público.
// Padrão de arquitetura segue _ml-helpers.js / _push-helpers.js.
//
// IMPORTANTE: nome 'Sofia' fica APENAS no frontend (via constante).
// Backend é 100% genérico (lojas-whats-*).
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─── CONFIG (lê/escreve lojas_whats_config) ────────────────────────────────

/**
 * Le um valor de config. Cache em memoria 1min pra evitar hit no banco.
 * @param {string} chave - nome da config
 * @param {any} fallback - valor default se nao encontrar
 */
const _configCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

export async function getConfig(chave, fallback = null) {
  const cached = _configCache.get(chave);
  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) {
    return cached.valor;
  }
  try {
    const { data, error } = await supabase
      .from('lojas_whats_config')
      .select('valor')
      .eq('chave', chave)
      .maybeSingle();
    if (error) throw error;
    const valor = data?.valor ?? fallback;
    _configCache.set(chave, { valor, at: Date.now() });
    return valor;
  } catch (e) {
    console.warn(`[lojas-whats] getConfig(${chave}) falhou:`, e?.message);
    return fallback;
  }
}

export async function saveConfig(chave, valor, descricao = null) {
  _configCache.delete(chave); // invalida cache
  const payload = { chave, valor, updated_at: new Date().toISOString() };
  if (descricao) payload.descricao = descricao;
  const { error } = await supabase
    .from('lojas_whats_config')
    .upsert(payload, { onConflict: 'chave' });
  if (error) throw error;
}

// ─── TELEFONE ──────────────────────────────────────────────────────────────

/**
 * Normaliza telefone pra formato E.164 (sem o '+', so digitos).
 * Meta WhatsApp Cloud API aceita o numero sem '+', so digitos.
 *
 * Exemplos:
 *   "(11) 99999-9999"  -> "5511999999999"
 *   "11999999999"      -> "5511999999999"
 *   "5511999999999"    -> "5511999999999"
 *   "+5511999999999"   -> "5511999999999"
 *   "21999999999"      -> "5521999999999"
 */
export function normalizarTelefone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\D/g, ''); // so digitos
  if (!s) return null;
  // Se ja vem com 55 na frente (codigo Brasil), deixa
  if (s.startsWith('55') && s.length >= 12 && s.length <= 13) return s;
  // Se vem como DDD+numero (10 ou 11 digitos), adiciona 55
  if (s.length === 10 || s.length === 11) return '55' + s;
  // Se vem com 0 na frente do DDD (formato antigo), remove o 0 e adiciona 55
  if (s.startsWith('0') && (s.length === 11 || s.length === 12)) return '55' + s.slice(1);
  return null; // formato invalido
}

/**
 * Valida se um numero esta em formato E.164 brasileiro plausivel.
 * Aceita 12 ou 13 digitos comecando com 55.
 */
export function telefoneValido(num) {
  if (!num) return false;
  const s = String(num).replace(/\D/g, '');
  return /^55\d{10,11}$/.test(s);
}

/**
 * Extrai primeiro nome de uma string completa.
 *   "Maria das Graças Silva" -> "Maria"
 *   "joao.silva@email.com"   -> "Joao"
 *   "JOÃO"                   -> "João"
 */
export function primeiroNome(nomeCompleto) {
  if (!nomeCompleto) return 'oi';
  const limpo = String(nomeCompleto).trim().split(/[\s@.]+/)[0];
  if (!limpo) return 'oi';
  return limpo.charAt(0).toUpperCase() + limpo.slice(1).toLowerCase();
}

// ─── JANELA HORARIA (decide se pode enviar agora) ──────────────────────────

/**
 * Verifica se o horario atual esta dentro da janela permitida pra envio.
 * Considera fuso de Sao Paulo (BRT/BRST).
 * MVP: seg-sex 9-21. Sab/dom desligado.
 */
export async function dentroDaJanela(dataRef = new Date()) {
  const janela = await getConfig('janela_horario', {
    seg_sex: { inicio: '09:00', fim: '21:00' },
    sab: null,
    dom: null
  });

  // Converte pra horario de SP
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(dataRef);
  // fmt vem tipo "sex., 12:34"
  const [diaAbrev, hhmm] = fmt.split(', ');

  let regra = null;
  if (/^(seg|ter|qua|qui|sex)/.test(diaAbrev)) regra = janela.seg_sex;
  else if (diaAbrev.startsWith('sáb') || diaAbrev.startsWith('sab')) regra = janela.sab;
  else if (diaAbrev.startsWith('dom')) regra = janela.dom;

  if (!regra) return false;
  return hhmm >= regra.inicio && hhmm < regra.fim;
}

// ─── LOG (debug + auditoria) ───────────────────────────────────────────────

export function log(prefixo, ...args) {
  console.log(`[lojas-whats/${prefixo}]`, ...args);
}

export function logErro(prefixo, erro) {
  console.error(`[lojas-whats/${prefixo}] ERRO:`, erro?.message || erro);
  if (erro?.stack) console.error(erro.stack);
}

// ─── CORS (mesmo padrao dos outros endpoints lojas-*) ──────────────────────

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}
