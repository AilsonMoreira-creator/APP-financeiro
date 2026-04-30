/**
 * lojas-drive-cron.js — Cron handler que dispara a importação semanal Drive.
 *
 * Schedule definido em vercel.json: terça 06:00 (BRT = sábado UTC 09:00).
 * Configuração: "0 9 * * 2" (UTC) → terça 06:00 (BRT, UTC-3).
 *
 * O que faz:
 *   1. Verifica se é o dia certo (defesa contra disparos manuais)
 *   2. Faz request interno pra /api/lojas-drive-importar?modo=cron
 *   3. Loga resultado em lojas_importacoes (já feito pelo importar.js)
 *   4. Retorna resumo agregado
 *
 * Por que separado do importar.js:
 *   - Limite de timeout do Vercel: 10s pra crons sem config, 90s com maxDuration
 *   - Permite no futuro disparar múltiplos jobs (ex: importar.js + recalcula KPIs)
 *   - Padrão consistente com bling-cron.js, ml-sync, ia-cron.js
 */

import { setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Cron do Vercel envia user-agent 'vercel-cron/1.0' (forma oficial atual).
  // Header 'x-vercel-cron' foi descontinuado. Mantemos por compatibilidade.
  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({
      error: 'Endpoint só é chamado pelo cron Vercel. Use ?force=1 pra teste manual (admin).',
    });
  }

  const tInicio = Date.now();
  const baseUrl = `https://${req.headers.host}`;

  try {
    // Dispara importar com modo=cron (sem precisar de auth, só passa header)
    const r = await fetch(`${baseUrl}/api/lojas-drive-importar?modo=cron`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-vercel-cron': '1',
      },
      body: JSON.stringify({}),
    });

    const data = await r.json().catch(() => ({}));

    return res.status(200).json({
      ok: r.ok,
      status: r.status,
      duracao_ms: Date.now() - tInicio,
      resultado: data,
    });

  } catch (err) {
    console.error('[lojas-drive-cron] erro:', err);
    return res.status(500).json({
      error: err.message || String(err),
      duracao_ms: Date.now() - tInicio,
    });
  }
}
