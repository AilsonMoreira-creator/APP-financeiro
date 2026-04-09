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
      .select('data')
      .eq('user_id', 'ml-perguntas-config')
      .single();

    if (!data?.data?.config?.schedule) return false;
    const config = data.data.config;
    if (!config.absence_enabled) return false;

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
      .select('data')
      .eq('user_id', 'ml-perguntas-config')
      .single();
    return data?.data?.config?.absence_message ||
      'Olá! Agradecemos seu contato. No momento estamos fora do horário de atendimento. Retornaremos assim que possível.';
  } catch {
    return 'Olá! Agradecemos seu contato. No momento estamos fora do horário de atendimento. Retornaremos assim que possível.';
  }
}

// ── CORS headers ──

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
