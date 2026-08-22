// /api/amicia-data-tamanho-diag — one-off: tamanho de cada payload do
// amicia_data. Cada UPDATE numa linha dessas é transmitido INTEIRO pelo
// Realtime pra toda sessão aberta que assina aquele user_id.
import { supabase } from './_ml-helpers.js';

export default async function handler(req, res) {
  try {
    const { data } = await supabase.from('amicia_data').select('user_id, payload');
    const linhas = (data || []).map(r => ({
      user_id: r.user_id,
      kb: Math.round(JSON.stringify(r.payload || {}).length / 1024),
    })).sort((a, b) => b.kb - a.kb);
    const total = linhas.reduce((s, l) => s + l.kb, 0);
    return res.status(200).json({ total_kb: total, linhas });
  } catch (e) {
    return res.status(500).json({ erro: String(e?.message || e) });
  }
}
