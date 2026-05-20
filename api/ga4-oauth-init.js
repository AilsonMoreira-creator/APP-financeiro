/**
 * ga4-oauth-init.js — Gera a URL de autorização OAuth do Google.
 * Acessa essa URL no navegador uma única vez, autoriza com a conta
 * admin do GA4 (exclusivo@amicialoja.com.br), e o callback armazena
 * o refresh_token no Supabase.
 *
 * Setup: env vars GA4_CLIENT_ID e GA4_CLIENT_SECRET (Vercel).
 * Test user na tela OAuth: exclusivo@amicialoja.com.br.
 */
import { setCors } from './_lojas-helpers.js';

const REDIRECT_URI = 'https://app-financeiro-brown.vercel.app/api/ga4-oauth-callback';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

export default function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clientId = process.env.GA4_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'GA4_CLIENT_ID ausente nas env vars' });
  }

  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const authUrl = new URL(AUTH_ENDPOINT);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent'); // garante refresh_token sempre
  authUrl.searchParams.set('state', state);

  return res.status(200).json({
    ok: true,
    auth_url: authUrl.toString(),
    instructions: 'Abra essa URL no navegador, faça login com exclusivo@amicialoja.com.br e autorize. O callback salva o refresh_token automaticamente.',
  });
}
