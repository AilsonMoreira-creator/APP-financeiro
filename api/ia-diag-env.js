/**
 * ia-diag-env.js — Probe TEMPORÁRIO de diagnóstico (Sprint 3).
 *
 * GET /api/ia-diag-env
 *
 * Público (sem auth) mas nunca vaza o valor completo do segredo.
 * Mostra só tamanho + primeiros/últimos 2 chars pra comparar entre endpoints.
 *
 * REMOVER assim que smoke test do Sprint 3 passar.
 */
import { setCors } from './_ia-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const cs = process.env.CRON_SECRET || '';
  const fingerprint = cs.length >= 4
    ? `${cs.slice(0, 2)}...${cs.slice(-2)}`
    : null;

  return res.json({
    ok: true,
    deploy_sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
    vercel_env: process.env.VERCEL_ENV || null,
    vercel_url: process.env.VERCEL_URL || null,
    env_check: {
      supabase_url: !!process.env.SUPABASE_URL,
      supabase_key: !!process.env.SUPABASE_KEY,
      anthropic_api_key: !!process.env.ANTHROPIC_API_KEY,
      cron_secret: !!cs,
      cron_secret_len: cs.length,
      cron_secret_fingerprint: fingerprint,
      cron_secret_has_whitespace: cs !== cs.trim(),
    },
  });
}
