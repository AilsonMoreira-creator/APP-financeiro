// ═══════════════════════════════════════════════════════════════════════════
// /api/sac-push-test — envia um push de teste pras inscrições do usuário
// ═══════════════════════════════════════════════════════════════════════════
// POST { user_id } → dispara uma notificação de teste só pros devices daquele
// usuário (não pra todos). Serve pra validar a entrega na hora, sem depender
// de chegar mensagem real de comprador. Ailson 02/06/2026.
// ═══════════════════════════════════════════════════════════════════════════

import { enviarPushSAC } from './_push-helpers.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id_obrigatorio' });

    const r = await enviarPushSAC({
      titulo: '🔔 Teste de notificação',
      mensagem: 'Se vc está vendo isso, o push do SAC tá funcionando.',
      url: '/?sac=1',
      tag: 'sac-teste',
      userId: user_id,
    });

    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    console.error('[sac-push-test]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
