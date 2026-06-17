// ============================================================================
// /api/meluni-whats-template-status — lê o status dos templates da WABA da Lara.
// GET ?force=1 (opcional ?nomes=a,b). Usa META_WA_ACCESS_TOKEN. Ailson 16/06/2026.
// ============================================================================
const GRAPH = 'https://graph.facebook.com/v21.0';
const WABA = process.env.META_WA_WABA_ID_LARA || '912339361863904';

export default async function handler(req, res) {
  if (req.query?.force !== '1') return res.status(403).json({ erro: 'Use ?force=1' });
  if (!process.env.META_WA_ACCESS_TOKEN) return res.status(500).json({ erro: 'META_WA_ACCESS_TOKEN ausente' });

  const filtro = (req.query?.nomes || 'meluni_carrinho_leve,meluni_carrinho_elegante,meluni_carrinho_sem_nome')
    .split(',').map(s => s.trim()).filter(Boolean);

  const url = `${GRAPH}/${WABA}/message_templates?fields=name,status,category,language,rejected_reason,quality_score&limit=100`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}` } });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* */ }
  if (!r.ok) return res.status(r.status).json({ ok: false, erro: j?.error?.message || txt });

  const todos = j?.data || [];
  const alvo = todos.filter(t => filtro.includes(t.name));
  return res.status(200).json({
    ok: true, waba: WABA,
    templates: alvo.map(t => ({
      name: t.name, status: t.status, category: t.category, language: t.language,
      rejected_reason: t.rejected_reason || null, quality: t.quality_score?.score || null,
    })),
  });
}
