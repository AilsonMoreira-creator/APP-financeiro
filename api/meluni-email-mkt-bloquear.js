// ============================================================================
// /api/meluni-email-mkt-bloquear — marca/desmarca um carrinho pra NÃO receber
// e-mail mkt. POST { carrinho_id, bloquear }. Carimba email_mkt_bloqueado_em.
// Ailson 19/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  const { carrinho_id, bloquear } = req.body || {};
  if (!carrinho_id) return res.status(400).json({ ok: false, erro: 'carrinho_id obrigatorio' });

  try {
    const { error } = await supabase.from('meluni_carrinhos')
      .update({ email_mkt_bloqueado_em: bloquear ? new Date().toISOString() : null })
      .eq('id', carrinho_id);
    if (error) throw error;
    return res.json({ ok: true, carrinho_id, bloqueado: !!bloquear });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
