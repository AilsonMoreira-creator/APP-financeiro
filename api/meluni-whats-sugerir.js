// ============================================================================
// /api/meluni-whats-sugerir — pede pra Lara gerar uma sugestão AGORA pra uma
// conversa (sem esperar o cron). POST { conversa_id }. A sugestão entra como
// pendente em meluni_sugestoes e aparece no card do chat. Ailson 17/06/2026.
// ============================================================================
import { processarConversaMeluni } from './meluni-whats-ia.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const conversaId = body?.conversa_id;
  if (!conversaId) return res.status(400).json({ ok: false, erro: 'conversa_id obrigatorio' });

  try {
    const r = await processarConversaMeluni(conversaId, { forcar: true });
    return res.json({ ok: true, ...r });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
