// ============================================================================
// Google OAuth (refresh token) -> access token. Substitui o Service Account/DWD
// (que exigia criar chave JSON, bloqueada pela política da org).
// ----------------------------------------------------------------------------
// O refresh token é capturado uma vez via /api/meluni-email-oauth e guardado em
// meluni_config (chave 'google_oauth_refresh'). Aqui a gente só troca refresh
// token por access token (cacheado ~55min).
//
// Env:
//   GOOGLE_OAUTH_CLIENT_ID      -> client id do OAuth (console.cloud)
//   GOOGLE_OAUTH_CLIENT_SECRET  -> client secret
//   GOOGLE_OAUTH_REFRESH_TOKEN  -> opcional; fallback se não estiver no meluni_config
// Ailson 19/06/2026.
// ============================================================================
import { cfgMeluni } from './_meluni-whats-helpers.js';

const TOKEN_URI = 'https://oauth2.googleapis.com/token';
let _cache = { token: null, exp: 0 };

export async function refreshTokenGoogle() {
  const cfg = await cfgMeluni('google_oauth_refresh', null);
  return (cfg && (cfg.refresh_token || cfg)) || process.env.GOOGLE_OAUTH_REFRESH_TOKEN || null;
}

export async function googleOAuthOk() {
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) return false;
  return !!(await refreshTokenGoogle());
}

// Assinatura compatível com o uso antigo: aceita (scopes, subject) mas ignora —
// o escopo é definido no consentimento e o subject é o próprio dono do token.
export async function tokenGoogle() {
  const now = Math.floor(Date.now() / 1000);
  if (_cache.token && _cache.exp - 60 > now) return _cache.token;

  const refresh = await refreshTokenGoogle();
  if (!refresh) throw new Error('refresh token do Google ausente (rode /api/meluni-email-oauth)');
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID/SECRET ausentes');
  }

  const r = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    throw new Error(`token google ${r.status}: ${j?.error_description || j?.error || 'sem access_token'}`);
  }
  _cache = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return j.access_token;
}
