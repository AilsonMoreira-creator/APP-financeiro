/**
 * ia-diag-call.js — Simula o fluxo ia-disparar → ia-cron (Sprint 3 debug).
 *
 * GET /api/ia-diag-call
 *
 * Público (sem auth de admin). Chama o ia-cron internamente igual o
 * ia-disparar faz, e retorna o resultado bruto pra comparar.
 *
 * REMOVER junto com ia-diag-env após smoke test passar.
 */
import { setCors } from './_ia-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET não disponível no runtime do diag-call' });
  }

  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || process.env.VERCEL_URL;
  const url = `${proto}://${host}/api/ia-cron?janela=diag`;

  const fp = (s) => (s && s.length >= 4 ? `${s.slice(0, 2)}...${s.slice(-2)} [${s.length}ch]` : s ? `[${s.length}ch]` : 'null');

  try {
    const t0 = Date.now();
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': cronSecret,
      },
      signal: AbortSignal.timeout(65000),
    });
    const ms = Date.now() - t0;
    const text = await r.text();

    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = null; }

    return res.json({
      diag: 'ia-diag-call',
      url_chamada: url,
      host_usado: host,
      cron_secret_no_diag: fp(cronSecret),
      resposta: {
        status: r.status,
        ok: r.ok,
        duracao_ms: ms,
        body_parsed: parsed,
        body_raw: parsed ? null : text.slice(0, 500),
      },
    });
  } catch (e) {
    return res.status(500).json({
      diag: 'ia-diag-call',
      url_tentada: url,
      host_usado: host,
      cron_secret_no_diag: fp(cronSecret),
      erro: e.message || 'erro interno',
      erro_name: e.name,
    });
  }
}
