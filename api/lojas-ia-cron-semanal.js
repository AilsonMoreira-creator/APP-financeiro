/**
 * lojas-ia-cron-semanal.js — Cron semanal dos resumos da IA Lojas.
 *
 * Schedule: 0 10 * * 2 (07:00 BRT, terça-feira)
 *   - 10:00 UTC = 07:00 BRT (UTC-3)
 *
 * Dispara internamente /api/lojas-ia { action: 'gerar_resumo_semanal' }
 * (modo todas — sem vendedora_id, processa todas ativas).
 *
 * Cada vendedora recebe 1 resumo da semana passada com:
 *  - Métricas (mensagens, sugestões, dispensadas)
 *  - Conversões com sucesso (regra dos 30 dias)
 *  - Top 3 clientes
 *  - Mensagem motivacional gerada por Claude
 */

import { setCors } from './_lojas-helpers.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  setCors(res);

  const ehCron = req.headers['x-vercel-cron'] !== undefined;
  const ehAdmin = req.headers['x-user'] === 'ailson';
  if (!ehCron && !ehAdmin) {
    return res.status(403).json({ error: 'Apenas cron Vercel ou admin' });
  }

  const inicio = Date.now();
  const baseUrl = `https://${req.headers.host}`;

  try {
    const r = await fetch(`${baseUrl}/api/lojas-ia`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User': 'ailson',
        'X-Internal-Cron': '1',
      },
      body: JSON.stringify({ action: 'gerar_resumo_semanal' }),
    });
    const data = await r.json();

    return res.status(r.ok ? 200 : 500).json({
      ok: r.ok,
      duracao_ms: Date.now() - inicio,
      ...data,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
