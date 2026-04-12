/**
 * produto-foto.js — Upload de foto de produto pro Supabase Storage
 * POST: recebe imagem base64, redimensiona pra 600x800, salva no bucket "produtos"
 * DELETE: remove foto do bucket
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // DELETE: remove foto
  if (req.method === 'DELETE') {
    const { ref } = req.body || {};
    if (!ref) return res.status(400).json({ error: 'ref obrigatório' });
    try {
      // List and remove all files for this ref
      const { data: files } = await supabase.storage.from('produtos').list('', {
        search: ref,
      });
      if (files?.length > 0) {
        await supabase.storage.from('produtos').remove(files.map(f => f.name));
      }
      return res.json({ ok: true, msg: `Foto ${ref} removida` });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST ou DELETE' });

  try {
    const { ref, image_base64, content_type } = req.body;
    if (!ref || !image_base64) return res.status(400).json({ error: 'ref e image_base64 obrigatórios' });

    // Validate content type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const type = content_type || 'image/jpeg';
    if (!validTypes.includes(type)) return res.status(400).json({ error: 'Formato inválido. Use JPEG, PNG ou WebP.' });

    // Decode base64
    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Check size (max 2MB raw)
    if (buffer.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'Imagem muito grande. Máximo 2MB.' });
    }

    // File name: ref.jpg (always jpg for consistency)
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const fileName = `${ref.trim().toUpperCase()}.${ext}`;

    // Remove old file if exists (any extension)
    try {
      const { data: existing } = await supabase.storage.from('produtos').list('', { search: ref.trim().toUpperCase() });
      if (existing?.length > 0) {
        await supabase.storage.from('produtos').remove(existing.map(f => f.name));
      }
    } catch {}

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('produtos')
      .upload(fileName, buffer, {
        contentType: type,
        upsert: true,
      });

    if (error) {
      console.error('[produto-foto] upload error:', error);
      return res.status(500).json({ error: error.message });
    }

    // Get public URL
    const { data: urlData } = supabase.storage.from('produtos').getPublicUrl(fileName);
    const publicUrl = urlData?.publicUrl;

    console.log(`[produto-foto] ✓ ${fileName} uploaded (${(buffer.length / 1024).toFixed(0)}KB)`);

    return res.json({
      ok: true,
      url: publicUrl,
      fileName,
      sizeKB: Math.round(buffer.length / 1024),
    });

  } catch (e) {
    console.error('[produto-foto] erro:', e);
    return res.status(500).json({ error: e.message });
  }
}
