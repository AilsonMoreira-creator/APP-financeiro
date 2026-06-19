// ============================================================================
// /api/meluni-email-oauth — captura (uma vez) o refresh token do Google pro
// canal de e-mail da Lara, via OAuth. Substitui a chave JSON de Service Account.
// ----------------------------------------------------------------------------
// Uso:
//   1) No console.cloud: crie um OAuth Client (tipo "Aplicativo da Web") e
//      registre o redirect URI = https://<dominio>/api/meluni-email-oauth
//   2) Vercel env: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
//      GOOGLE_OAUTH_SETUP_KEY (qualquer segredo seu).
//   3) Abra no navegador: /api/meluni-email-oauth?k=<GOOGLE_OAUTH_SETUP_KEY>
//      e autorize com a caixa primária (exclusivo@meluniloja.com.br).
//   4) O refresh token é salvo em meluni_config (chave 'google_oauth_refresh').
// Ailson 19/06/2026.
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';

const AUTH_URI = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
].join(' ');

function html(res, status, corpo) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;max-width:640px;margin:40px auto;line-height:1.5;color:#2c3e50">${corpo}</body>`);
}

export default async function handler(req, res) {
  const CLIENT_ID = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const CLIENT_SECRET = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
  const SETUP_KEY = (process.env.GOOGLE_OAUTH_SETUP_KEY || '').trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = (process.env.GOOGLE_OAUTH_REDIRECT || `https://${host}/api/meluni-email-oauth`).trim();

  // diagnóstico (sem segredo: client_id e redirect_uri são públicos; só booleans pro resto)
  if (req.query?.debug === '1') {
    return res.status(200).json({
      client_id: CLIENT_ID || null,
      client_id_len: CLIENT_ID ? CLIENT_ID.length : 0,
      client_id_termina_ok: CLIENT_ID ? CLIENT_ID.endsWith('.apps.googleusercontent.com') : false,
      redirect_uri: redirectUri,
      redirect_env_set: !!process.env.GOOGLE_OAUTH_REDIRECT,
      tem_secret: !!CLIENT_SECRET,
      tem_setup_key: !!SETUP_KEY,
    });
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return html(res, 500, '<h3>Falta configurar</h3><p>Defina <code>GOOGLE_OAUTH_CLIENT_ID</code> e <code>GOOGLE_OAUTH_CLIENT_SECRET</code> no Vercel.</p>');
  }
  if (!SETUP_KEY) {
    return html(res, 500, '<h3>Falta configurar</h3><p>Defina <code>GOOGLE_OAUTH_SETUP_KEY</code> (um segredo seu) no Vercel.</p>');
  }

  const { code, state, error } = req.query || {};

  // callback do Google
  if (code) {
    if (state !== SETUP_KEY) return html(res, 403, '<h3>State inválido</h3><p>Recomece pelo link com <code>?k=</code>.</p>');
    try {
      const r = await fetch(TOKEN_URI, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: String(code),
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri: redirectUri,
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.access_token) {
        return html(res, 400, `<h3>Erro ao trocar o code</h3><pre>${j?.error_description || j?.error || r.status}</pre>`);
      }
      if (!j.refresh_token) {
        return html(res, 400, '<h3>Sem refresh token</h3><p>O Google não devolveu refresh token. Revogue o acesso do app na conta e tente de novo (o link já força <code>prompt=consent</code>).</p>');
      }
      // descobre qual conta autorizou (só pra confirmar na tela)
      let conta = '';
      try {
        const pr = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
          headers: { Authorization: `Bearer ${j.access_token}` },
        });
        const pj = await pr.json().catch(() => null);
        conta = pj?.emailAddress || '';
      } catch { /* não bloqueia */ }

      const { error: upErr } = await supabase.from('meluni_config').upsert(
        { chave: 'google_oauth_refresh', valor: { refresh_token: j.refresh_token, conta, criado_em: new Date().toISOString() } },
        { onConflict: 'chave' },
      );
      if (upErr) return html(res, 500, `<h3>Salvou token mas falhou gravar</h3><pre>${upErr.message}</pre>`);

      return html(res, 200, `<h3>Conectado ✅</h3><p>Conta: <b>${conta || '(desconhecida)'}</b></p><p>Refresh token salvo. O cron de e-mail vai começar a rodar em até 2 min. Pode fechar esta aba.</p>`);
    } catch (e) {
      return html(res, 500, `<h3>Erro</h3><pre>${String(e?.message || e)}</pre>`);
    }
  }

  if (error) return html(res, 400, `<h3>Autorização cancelada</h3><pre>${error}</pre>`);

  // início do fluxo
  if ((req.query?.k || '') !== SETUP_KEY) {
    return html(res, 403, '<h3>Acesso negado</h3><p>Abra com <code>?k=SEU_GOOGLE_OAUTH_SETUP_KEY</code>.</p>');
  }
  const url = `${AUTH_URI}?${new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: SETUP_KEY,
  })}`;
  res.status(302).setHeader('Location', url);
  return res.end();
}
