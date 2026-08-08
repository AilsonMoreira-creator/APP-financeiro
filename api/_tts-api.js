/**
 * _tts-api.js — cliente da API do TikTok Shop (Ailson 08/08/2026).
 *
 * Variáveis de ambiente esperadas na Vercel:
 *   TIKTOK_APP_KEY     = 6kr44ku62od2j   (é público, aparece no Partner Center)
 *   TIKTOK_APP_SECRET  = o segredo do app (só na Vercel, nunca no repo)
 *
 * Assinatura (documentação v2): concatena app_secret + path + os parâmetros de
 * query ORDENADOS por nome (sem sign nem access_token, coladas chave+valor) +
 * o corpo quando houver + app_secret; disso sai um HMAC-SHA256 com o secret.
 */
import crypto from 'crypto';
import { supabase } from './_bling-helpers.js';

export const AUTH_HOST = 'https://auth.tiktok-shops.com';
export const API_HOST = 'https://open-api.tiktokglobalshop.com';

export function ctxTts() {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;
  if (!appKey || !appSecret) return null;
  return { appKey, appSecret };
}

export function assinar(path, params, appSecret, body = '') {
  const chaves = Object.keys(params)
    .filter(k => k !== 'sign' && k !== 'access_token')
    .sort();
  let base = appSecret + path;
  for (const k of chaves) base += k + params[k];
  base += body;
  base += appSecret;
  return crypto.createHmac('sha256', appSecret).update(base).digest('hex');
}

/** Chamada autenticada na API do TikTok Shop. */
export async function chamarTts(path, params, auth, ctx, { method = 'GET', body = null } = {}) {
  const p = {
    app_key: ctx.appKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(auth?.shop_cipher ? { shop_cipher: auth.shop_cipher } : {}),
    ...params,
  };
  const corpo = body ? JSON.stringify(body) : '';
  p.sign = assinar(path, p, ctx.appSecret, corpo);
  const qs = new URLSearchParams(p).toString();
  const r = await fetch(`${API_HOST}${path}?${qs}`, {
    method,
    headers: {
      'x-tts-access-token': auth.access_token,
      'Content-Type': 'application/json',
    },
    ...(corpo ? { body: corpo } : {}),
  });
  return r.json();
}

/** Busca a loja autorizada e renova o token quando estiver perto de vencer. */
export async function authTts(conta = 'exitus') {
  const ctx = ctxTts();
  if (!ctx) return { erro: 'faltam TIKTOK_APP_KEY / TIKTOK_APP_SECRET na Vercel' };

  const { data: auth } = await supabase.from('tts_auth')
    .select('*').eq('conta', conta).order('atualizado_em', { ascending: false })
    .limit(1).maybeSingle();
  if (!auth) return { erro: `loja ${conta} ainda não autorizada` };

  if (auth.expira_em && new Date(auth.expira_em).getTime() < Date.now() + 300000) {
    const url = `${AUTH_HOST}/api/v2/token/refresh?app_key=${ctx.appKey}&app_secret=${ctx.appSecret}`
      + `&refresh_token=${auth.refresh_token}&grant_type=refresh_token`;
    const d = await (await fetch(url)).json();
    const t = d?.data;
    if (!t?.access_token) return { erro: 'falha ao renovar token', detalhe: d };
    auth.access_token = t.access_token;
    await supabase.from('tts_auth').update({
      access_token: t.access_token,
      refresh_token: t.refresh_token || auth.refresh_token,
      expira_em: new Date((t.access_token_expire_in || 0) * 1000).toISOString(),
      refresh_expira_em: t.refresh_token_expire_in ? new Date(t.refresh_token_expire_in * 1000).toISOString() : auth.refresh_expira_em,
      atualizado_em: new Date().toISOString(),
    }).eq('id', auth.id);
  }
  return { auth, ctx };
}
