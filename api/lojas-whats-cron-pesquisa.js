// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-pesquisa.js — Cron diario 14h BRT (17:00 UTC).
// Dispara a pesquisa de motivo pra ate 30 leads perdidos elegiveis.
// Se houver menos que 30, manda pra quantos tiver. So roda se o template
// estiver aprovado (a propria dispararPesquisa checa). Ailson 21/06/2026.
// ═══════════════════════════════════════════════════════════════════════════

import { setCors, log, logErro } from './_lojas-whats-helpers.js';
import { dispararPesquisa } from './lojas-whats-pesquisa-enviar.js';

export default async function handler(req, res) {
  setCors(res);
  try {
    const r = await dispararPesquisa({ limite: 30 });
    log('cron-pesquisa', JSON.stringify(r));
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    logErro('cron-pesquisa', e);
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
