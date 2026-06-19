// ============================================================================
// Google Service Account -> access token, com Domain-Wide Delegation
// (impersona um usuário do Workspace, ex.: contato@meluniloja.com.br).
// Sem dependência: assina o JWT RS256 com o crypto nativo do Node.
//
// Env:
//   GOOGLE_SA_JSON       -> conteúdo da chave JSON da service account
//                           (aceita o JSON cru OU em base64).
//   GOOGLE_IMPERSONATE   -> e-mail a impersonar (default contato@meluniloja.com.br).
// Ailson 19/06/2026.
// ============================================================================
import crypto from 'crypto';

const _cache = {}; // `${scope}|${sub}` -> { token, exp }

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function lerSA() {
  const raw = process.env.GOOGLE_SA_JSON;
  if (!raw) throw new Error('GOOGLE_SA_JSON ausente');
  let txt = raw.trim();
  if (!txt.startsWith('{')) txt = Buffer.from(txt, 'base64').toString('utf8'); // aceita base64
  const sa = JSON.parse(txt);
  if (!sa.client_email || !sa.private_key) throw new Error('GOOGLE_SA_JSON sem client_email/private_key');
  return sa;
}

// scopes: string ou array. subject: e-mail a impersonar (DWD).
export async function tokenGoogle(scopes, subject) {
  const scope = Array.isArray(scopes) ? scopes.join(' ') : String(scopes);
  const sub = subject || process.env.GOOGLE_IMPERSONATE || 'contato@meluniloja.com.br';
  const ck = `${scope}|${sub}`;
  const now = Math.floor(Date.now() / 1000);

  const hit = _cache[ck];
  if (hit && hit.exp - 60 > now) return hit.token;

  const sa = lerSA();
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, sub, scope, aud, iat: now, exp: now + 3600 };

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  const jwt = `${unsigned}.${b64url(sig)}`;

  const r = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    throw new Error(`token google ${r.status}: ${j?.error_description || j?.error || 'sem access_token'}`);
  }
  _cache[ck] = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return j.access_token;
}
