/**
 * site-amicia-drive-cron.js — Cron handler que dispara o import do Drive.
 *
 * Schedule em vercel.json: diário 08:00 BRT (= 11:00 UTC).
 *
 * Padrão mesma estrutura de lojas-drive-cron.js: separa cron handler do
 * importador real pra ter logs claros e permitir teste manual via ?force=1.
 *
 * Sessão Ailson 12/05/2026 — Onda 5 (Cron Drive Site Amicia).
 */
import { setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({
      error: 'Endpoint só é chamado pelo cron Vercel. Use ?force=1 pra teste manual.',
    });
  }

  const tInicio = Date.now();
  const baseUrl = `https://${req.headers.host}`;

  try {
    // 1) Import dos CSVs do Drive → popula lojas_leads_carrinho
    const r = await fetch(`${baseUrl}/api/site-amicia-drive-importar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-vercel-cron': '1',
      },
      body: JSON.stringify({}),
    });

    const data = await r.json().catch(() => ({}));

    // 2) ENCADEAMENTO (Ailson 27/05/2026): dispara cron-selecionar Sofia
    //    LOGO APÓS o import terminar, garantindo que leads novos sejam
    //    pegos no mesmo ciclo, independente de schedule. Robustez extra
    //    além do cron agendado às 09h BRT.
    //    Idempotente: cron-selecionar filtra duplicatas (não cria conversa
    //    pra telefone que já tem conversa ativa).
    let selecionarOk = false;
    let selecionarResultado = null;
    try {
      const rSel = await fetch(`${baseUrl}/api/lojas-whats-cron-selecionar?executar=1`, {
        method: 'GET',
        headers: { 'x-vercel-cron': '1' },
      });
      selecionarResultado = await rSel.json().catch(() => ({}));
      selecionarOk = rSel.ok;
    } catch (eSel) {
      console.error('[site-amicia-drive-cron] erro chain selecionar:', eSel);
      selecionarResultado = { erro: eSel.message };
    }

    return res.status(200).json({
      ok: r.ok,
      status: r.status,
      duracao_ms: Date.now() - tInicio,
      resultado: data,
      chain_selecionar: { ok: selecionarOk, resultado: selecionarResultado },
    });
  } catch (err) {
    console.error('[site-amicia-drive-cron] erro:', err);
    return res.status(500).json({
      error: err.message || String(err),
      duracao_ms: Date.now() - tInicio,
    });
  }
}
