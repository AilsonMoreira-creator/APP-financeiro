// ============================================================================
// /api/meluni-whats-registrar — registra o número da Lara no Cloud API (2 etapas).
// GET ?force=1&pin=NNNNNN  -> POST /{phone_id}/register. Ailson 16/06/2026.
// O PIN não é logado na resposta.
// ============================================================================
const GRAPH = 'https://graph.facebook.com/v21.0';

export default async function handler(req, res) {
  if (req.query?.force !== '1') return res.status(403).json({ erro: 'Use ?force=1&pin=NNNNNN' });
  const pin = String(req.query?.pin || '');
  if (!/^\d{6}$/.test(pin)) return res.status(400).json({ erro: 'pin deve ter 6 dígitos' });
  const phoneId = process.env.META_WA_PHONE_ID_LARA;
  if (!phoneId) return res.status(500).json({ erro: 'META_WA_PHONE_ID_LARA ausente' });
  if (!process.env.META_WA_ACCESS_TOKEN) return res.status(500).json({ erro: 'META_WA_ACCESS_TOKEN ausente' });

  const r = await fetch(`${GRAPH}/${phoneId}/register`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* */ }
  if (!r.ok) return res.status(r.status).json({ ok: false, erro: j?.error?.message || txt, code: j?.error?.code || null });
  return res.status(200).json({ ok: true, phone_id: phoneId, resultado: j });
}
