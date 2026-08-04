// ============================================================================
// /api/meluni-crossell-auto — liga/desliga o AUTO CROSS-SELL da Lara.
//   GET            -> { ok, ativo }
//   POST { ativo } -> grava e devolve { ok, ativo }
// Estado em meluni_config.lara_crossell_auto = { ativo, atualizado_em }.
// Com ativo=false o cron /api/meluni-crossell-cron não envia nada.
// Ailson 03/08/2026 (espelho do meluni-poscompra-auto).
// ============================================================================
import { cfgMeluni, setCfgMeluni } from './_meluni-whats-helpers.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') {
      const cfg = (await cfgMeluni('lara_crossell_auto', { ativo: false })) || {};
      return res.status(200).json({ ok: true, ativo: cfg.ativo === true });
    }
    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const ativo = body?.ativo === true;
      await setCfgMeluni('lara_crossell_auto', { ativo, atualizado_em: new Date().toISOString() });
      return res.status(200).json({ ok: true, ativo });
    }
    return res.status(405).json({ ok: false, erro: 'use GET ou POST' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
