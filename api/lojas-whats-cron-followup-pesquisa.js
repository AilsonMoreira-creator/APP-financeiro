// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-followup-pesquisa.js — Cron 10h BRT (13:00 UTC), seg a sab.
//   1) Dispara a pesquisa de motivo pros leads travados em follow-up elegiveis
//      (etapa='follow_up' 7+ dias + print + 3 msgs).
//   2) Promove a 'perdida' quem esta 7+ dias em follow-up sem print/poucas msgs.
// So roda a pesquisa se o template estiver aprovado (a propria funcao checa).
// Ailson 28/06/2026.
// ═══════════════════════════════════════════════════════════════════════════

import { setCors, log, logErro } from './_lojas-whats-helpers.js';
import { dispararFollowupPesquisa, promoverFollowupPerdidas } from './lojas-whats-followup-pesquisa-enviar.js';

export default async function handler(req, res) {
  setCors(res);
  try {
    const envio = await dispararFollowupPesquisa({ limite: 30 });
    const perdidas = await promoverFollowupPerdidas();
    log('cron-followup-pesquisa', JSON.stringify({ envio, perdidas }));
    return res.status(200).json({ ok: true, envio, perdidas });
  } catch (e) {
    logErro('cron-followup-pesquisa', e);
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
