/**
 * ia-diag-env.js — Probe TEMPORÁRIO de diagnóstico (Sprint 3).
 *
 * GET /api/ia-diag-env
 *
 * Público (sem auth) mas retorna APENAS booleans — não vaza nenhum valor.
 * Usado só pra confirmar se env vars foram injetadas no runtime.
 *
 * REMOVER assim que smoke test do Sprint 3 passar.
 */
import { setCors } from './_ia-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const cs = process.env.CRON_SECRET || '';
  return res.json({
    ok: true,
    deploy_sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || null,
    env_check: {
      supabase_url: !!process.env.SUPABASE_URL,
      supabase_key: !!process.env.SUPABASE_KEY,
      anthropic_api_key: !!process.env.ANTHROPIC_API_KEY,
      cron_secret: !!cs,
      cron_secret_len: cs.length,  // só o tamanho, não o valor
    },
  });
}
