/**
 * ga4-oauth-callback.js — Recebe o code do Google, troca por tokens,
 * salva refresh_token no Supabase em amicia_data com user_id='ga4-oauth-tokens'.
 *
 * Esse endpoint é chamado pelo redirect do Google, não diretamente.
 */
import { setCors, supabase } from './_lojas-helpers.js';

const REDIRECT_URI = 'https://app-financeiro-brown.vercel.app/api/ga4-oauth-callback';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

function htmlPage(titulo, corpo, ok = true) {
  const cor = ok ? '#27ae60' : '#c0392b';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>${titulo}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="font-family:Georgia,serif;background:#f7f4f0;color:#2c3e50;padding:40px 20px;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;">
  <div style="background:#fff;border:1px solid #e8e2da;border-radius:12px;padding:32px;max-width:520px;width:100%;">
    <h1 style="margin:0 0 16px;color:${cor};font-size:22px;">${titulo}</h1>
    ${corpo}
  </div>
</body>
</html>`;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code, error: oauthError, error_description } = req.query;

  if (oauthError) {
    return res
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .status(400)
      .send(htmlPage(
        '❌ Autorização negada',
        `<p>${oauthError}${error_description ? ` — ${error_description}` : ''}</p>
         <p style="color:#8a9aa4;font-size:13px;">Tente acessar /api/ga4-oauth-init novamente.</p>`,
        false,
      ));
  }

  if (!code) {
    return res.status(400).json({ error: 'Code ausente na callback' });
  }

  const clientId = process.env.GA4_CLIENT_ID;
  const clientSecret = process.env.GA4_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'GA4_CLIENT_ID/SECRET ausentes nas env vars' });
  }

  try {
    // 1) Troca o code por tokens
    const tokenResp = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenResp.json();
    if (tokens.error || !tokens.refresh_token) {
      return res
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .status(502)
        .send(htmlPage(
          '⚠️ Erro ao trocar tokens',
          `<p><strong>Resposta Google:</strong></p>
           <pre style="background:#f7f4f0;padding:12px;border-radius:6px;overflow:auto;font-size:12px;">${JSON.stringify(tokens, null, 2)}</pre>
           <p style="font-size:13px;color:#8a9aa4;">Se não tem refresh_token, vá em myaccount.google.com/permissions, remova "Amicia Marketing" e tente novamente.</p>`,
          false,
        ));
    }

    // 2) Salva no Supabase
    const payload = {
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
      scope: tokens.scope,
      token_type: tokens.token_type,
      saved_at: new Date().toISOString(),
    };

    const { error: dbError } = await supabase
      .from('amicia_data')
      .upsert(
        { user_id: 'ga4-oauth-tokens', payload },
        { onConflict: 'user_id' },
      );

    if (dbError) {
      return res
        .setHeader('Content-Type', 'text/html; charset=utf-8')
        .status(500)
        .send(htmlPage(
          '⚠️ Erro ao salvar no Supabase',
          `<pre style="background:#f7f4f0;padding:12px;border-radius:6px;overflow:auto;font-size:12px;">${JSON.stringify(dbError, null, 2)}</pre>`,
          false,
        ));
    }

    return res
      .setHeader('Content-Type', 'text/html; charset=utf-8')
      .status(200)
      .send(htmlPage(
        '✅ GA4 conectado!',
        `<p>O refresh_token foi salvo. Pode fechar essa aba e voltar pro chat com o Claude.</p>
         <p style="color:#8a9aa4;font-size:13px;margin-top:24px;">Token expira em ~1h e renova sozinho. Você só precisa autorizar de novo se revogar o acesso ou trocar o Client Secret.</p>`,
      ));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
