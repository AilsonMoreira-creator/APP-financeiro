/**
 * _ml-helpers.js — Funções compartilhadas entre os serverless do ML
 * Prefixo _ = Vercel não expõe como endpoint
 */

import { createClient } from '@supabase/supabase-js';

const ML_API = 'https://api.mercadolibre.com';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const BRANDS = ['Exitus', 'Lumia', 'Muniam'];

// ── Stock Color Detection ──

const DEFAULT_STOCK_COLORS = [
  { nome: 'Preto', aliases: ['preto', 'black'] },
  { nome: 'Bege', aliases: ['bege', 'creme'] },
  { nome: 'Figo', aliases: ['figo'] },
  { nome: 'Marrom', aliases: ['marrom', 'marron', 'brown'] },
  { nome: 'Marrom Escuro', aliases: ['marrom escuro', 'marron escuro'] },
  { nome: 'Azul Marinho', aliases: ['azul marinho', 'azul escuro', 'marinho', 'navy'] },
  { nome: 'Vinho', aliases: ['vinho', 'bordô', 'bordo', 'marsala', 'bordó'] },
];

export async function getStockColors() {
  try {
    const { data } = await supabase
      .from('amicia_data').select('payload')
      .eq('user_id', 'ml-perguntas-config').maybeSingle();
    return data?.payload?.config?.stock_colors || DEFAULT_STOCK_COLORS;
  } catch { return DEFAULT_STOCK_COLORS; }
}

export function detectColorsInText(text, stockColors) {
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const matched = [];
  for (const cor of stockColors) {
    for (const alias of cor.aliases) {
      const aliasNorm = alias.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (lower.includes(aliasNorm)) {
        if (!matched.find(m => m.nome === cor.nome)) matched.push(cor);
        break;
      }
    }
  }
  return matched;
}

const COLOR_REQUEST_PATTERNS = [
  'tem em ', 'tem na cor', 'tem no ', 'tem na ', 'tem o ', 'tem a ',
  'disponível em', 'disponivel em', 'disponível na', 'disponivel na',
  'vem em ', 'vem na cor', 'vem no ', 'vem na ',
  'queria na cor', 'quero na cor', 'quero o ', 'quero a ', 'quero em ', 'queria em ', 'queria o ', 'queria a ',
  'não tem na cor', 'nao tem na cor', 'não tem em ', 'nao tem em ',
  'essa peça tem na cor', 'pode colocar na cor', 'tem essa cor', 'essa cor',
  'tem nessa cor', 'gostaria na cor', 'gostaria em ', 'gostaria no ',
  'volta o ', 'volta na cor', 'volta em ', 'volta a ',
  'tem o tamanho', 'tem no tamanho', 'volta o tamanho', 'tem tamanho',
  'quando volta', 'quando chega', 'vai ter', 'vai voltar',
  'preciso do ', 'preciso da ', 'preciso em ', 'preciso na ',
  'quero esse', 'quero essa', 'quero um ', 'quero uma ',
  'no bege', 'no preto', 'no marrom', 'no azul', 'no verde', 'no figo', 'no vinho',
  'na cor ', 'tem cor ',
];

export function isColorRequest(text) {
  const lower = text.toLowerCase();
  return COLOR_REQUEST_PATTERNS.some(p => lower.includes(p));
}

export function detectSizeInText(text) {
  const m = text.match(/\b(PP|P|M|G|GG|G1|G2|G3|XG|XXG|EG|EGG)\b/i);
  return m ? m[1].toUpperCase() : null;
}

const CONFIRM_PATTERNS = [
  'sim', 'quero', 'pode', 'coloca', 'acrescenta', 'por favor', 'gostaria',
  'pode colocar', 'pode sim', 'quero sim', 'pode incluir', 'isso mesmo',
  'perfeito', 'fechado', 'bora', 'manda ver', 'pode ser', 'quero esse',
  'quero essa', 'isso', 'com certeza', 'claro', 'manda', 'faz isso',
  'aguardo', 'vou querer', 'tenho interesse',
];

const REFUSAL_PATTERNS = [
  'não', 'nao', 'não precisa', 'nao precisa', 'deixa', 'não quero',
  'nao quero', 'esquece', 'deixa pra lá', 'vou pensar', 'agora não',
  'não obrigad', 'nao obrigad', 'valeu mas', 'obrigado mas não',
];

export function detectConfirmation(text) {
  const lower = text.toLowerCase().trim();
  // Recusa tem prioridade (ex: "não, obrigado" não é confirmação)
  if (REFUSAL_PATTERNS.some(p => lower.includes(p))) return 'recusa';
  if (CONFIRM_PATTERNS.some(p => lower.includes(p))) return 'confirmacao';
  return null;
}

// ── Token Management ──

async function getTokenRecord(brand) {
  const { data } = await supabase
    .from('ml_tokens')
    .select('*')
    .eq('brand', brand)
    .single();
  return data;
}

export async function saveToken(brand, tokenData) {
  const record = {
    brand,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    seller_id: String(tokenData.user_id),
    expires_at: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await supabase.from('ml_tokens').upsert(record, { onConflict: 'brand' });
  return record;
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`ML refresh error: ${res.status}`);
  return res.json();
}

export async function getValidToken(brand) {
  const record = await getTokenRecord(brand);
  if (!record) throw new Error(`No token for brand: ${brand}`);

  const expiresAt = new Date(record.expires_at);
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt.getTime() - Date.now() > bufferMs) {
    return record.access_token;
  }

  console.log(`[ml] Refreshing token for ${brand}...`);
  const tokenData = await refreshAccessToken(record.refresh_token);
  const saved = await saveToken(brand, tokenData);
  return saved.access_token;
}

// ── Schedule / Absence helpers ──

export async function isOutsideBusinessHours() {
  try {
    const { data } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'ml-perguntas-config')
      .single();

    if (!data?.payload?.config?.schedule) return false;
    const config = data.payload.config;

    const now = new Date();
    const spTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const dayIndex = spTime.getDay();
    const scheduleIndex = dayIndex === 0 ? 6 : dayIndex - 1;
    const daySchedule = config.schedule[scheduleIndex];

    if (!daySchedule || !daySchedule.active) return true;

    const currentTime = spTime.getHours() * 60 + spTime.getMinutes();
    const [sH, sM] = daySchedule.start.split(':').map(Number);
    const [eH, eM] = daySchedule.end.split(':').map(Number);

    return currentTime < (sH * 60 + sM) || currentTime > (eH * 60 + eM);
  } catch { return false; }
}

export async function getAbsenceMessage() {
  try {
    const { data } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'ml-perguntas-config')
      .single();
    return data?.payload?.config?.absence_message ||
      'Olá! Agradecemos seu contato. No momento estamos fora do horário de atendimento. Retornaremos assim que possível.';
  } catch {
    return 'Olá! Agradecemos seu contato. No momento estamos fora do horário de atendimento. Retornaremos assim que possível.';
  }
}

// ── AI Auto-response schedule check ──

export async function isInAISchedule() {
  try {
    const { data } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'ml-perguntas-config')
      .single();

    if (!data?.payload?.config?.ai_auto_enabled) return false;

    // IA responde fora do horário de atendimento
    const outside = await isOutsideBusinessHours();
    return outside;
  } catch { return false; }
}

export async function getAILowConfidenceMsg() {
  try {
    const { data } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'ml-perguntas-config')
      .single();
    return data?.payload?.config?.ai_low_confidence_msg ||
      'Olá! Agradecemos sua pergunta. Alguém do nosso time vai responder em breve. Obrigado!';
  } catch {
    return 'Olá! Agradecemos sua pergunta. Alguém do nosso time vai responder em breve. Obrigado!';
  }
}

// ── CORS headers ──

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
