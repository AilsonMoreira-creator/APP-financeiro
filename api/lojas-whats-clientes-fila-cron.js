// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-clientes-fila-cron — drena a fila de envio em massa
// ═══════════════════════════════════════════════════════════════════════════
// Roda a cada minuto (vercel.json). Processa um lote de itens 'pendente'.
// Chamável manualmente com ?executar=1.
// ═══════════════════════════════════════════════════════════════════════════

import { processarFila } from './_lojas-whats-clientes-fila.js';

const LOTE_CRON = 50;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const ehCron = req.headers['user-agent']?.includes('vercel-cron') || req.query?.executar === '1';
  if (!ehCron) return res.status(200).json({ ok: true, msg: 'use ?executar=1 ou aguarde o cron' });

  try {
    const r = await processarFila(LOTE_CRON);
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('[lojas-whats-clientes-fila-cron]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
