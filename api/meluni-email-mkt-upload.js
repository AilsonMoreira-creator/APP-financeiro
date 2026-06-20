// ============================================================================
// /api/meluni-email-mkt-upload — sobe o criativo do e-mail.
// POST { base64, mime } -> { ok, url }  (bucket sofia-midias, prefixo email-mkt/)
// Front manda base64 via fileToBase64Scaled. Ailson 20/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  let { base64, mime } = req.body || {};
  if (!base64) return res.status(400).json({ ok: false, erro: 'base64 obrigatório' });
  base64 = String(base64).includes(',') ? String(base64).split(',').pop() : base64;
  mime = (mime || 'image/jpeg').toLowerCase();
  const ext = EXT[mime] || 'jpg';

  try {
    const buf = Buffer.from(base64, 'base64');
    if (!buf.length) return res.status(400).json({ ok: false, erro: 'imagem vazia' });
    const path = `email-mkt/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('sofia-midias')
      .upload(path, buf, { contentType: mime, upsert: false });
    if (error) throw error;
    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(path);
    return res.json({ ok: true, url: pub?.publicUrl || '', path });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
