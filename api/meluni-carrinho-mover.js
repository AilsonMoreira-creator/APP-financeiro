// ============================================================================
// /api/meluni-carrinho-mover — move manualmente o carrinho de etapa no funil.
// POST { id, status }. status ∈ funil. Carimba movido_manual_em e, conforme o
// destino, perdido_em / convertido_em. Ailson 17/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

const VALIDOS = new Set(['processando', 'enviada', 'segundo_envio', 'conversando', 'conversao', 'follow_up', 'perdida']);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  const { id, status } = req.body || {};
  if (!id || !status) return res.status(400).json({ ok: false, erro: 'id e status obrigatorios' });
  if (!VALIDOS.has(status)) return res.status(400).json({ ok: false, erro: `status invalido: ${status}` });

  const nowIso = new Date().toISOString();
  const upd = { status, movido_manual_em: nowIso };
  if (status === 'perdida') upd.perdido_em = nowIso;
  if (status === 'conversao') upd.convertido_em = upd.convertido_em || nowIso;

  try {
    const { error } = await supabase.from('meluni_carrinhos').update(upd).eq('id', id);
    if (error) throw error;
    return res.json({ ok: true, id, status });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
