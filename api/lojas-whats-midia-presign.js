// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-midia-presign.js — Gera URL assinada pra upload direto Supabase
// ═══════════════════════════════════════════════════════════════════════════
//
// PROBLEMA: Vercel Serverless body limit = 4.5MB. Catalogos PDF chegam a 20MB.
// SOLUCAO: browser faz upload direto pro Supabase Storage com signed URL,
// bypass do Vercel. Sem limite alem dos 20MB do nosso codigo.
//
// FLUXO:
//   1. Browser: POST /api/lojas-whats-midia-presign { tipo, nome_arquivo, size_bytes, mime_type }
//      → recebe { uploadUrl, token, storage_path }
//   2. Browser: PUT {uploadUrl} (body = arquivo binario, header Authorization: Bearer {token})
//   3. Browser: POST /api/lojas-whats-midia-upload?modo=register
//      { storage_path, tipo, ref, descricao, nome_arquivo, size_bytes, mime_type }
//      → registra no banco + retorna { ok: true, midia: {...} }
//
// Ailson 25/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

const LIMITES = {
  foto:      { bytes: 2  * 1024 * 1024, mimes: ['image/jpeg','image/jpg','image/png','image/webp'], pasta: 'fotos' },
  video:     { bytes: 16 * 1024 * 1024, mimes: ['video/mp4','video/quicktime'],                     pasta: 'videos' },
  catalogo:  { bytes: 20 * 1024 * 1024, mimes: ['application/pdf'],                                  pasta: 'catalogos' },
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST apenas' });

  try {
    const { tipo, nome_arquivo, size_bytes, mime_type } = req.body || {};

    if (!tipo || !LIMITES[tipo]) {
      return res.status(400).json({ error: `tipo invalido: ${tipo}` });
    }
    if (!nome_arquivo) return res.status(400).json({ error: 'nome_arquivo obrigatorio' });
    if (!size_bytes || size_bytes <= 0) return res.status(400).json({ error: 'size_bytes obrigatorio' });
    if (!mime_type) return res.status(400).json({ error: 'mime_type obrigatorio' });

    const limite = LIMITES[tipo];

    if (size_bytes > limite.bytes) {
      const limMB = (limite.bytes / 1024 / 1024).toFixed(0);
      const atualMB = (size_bytes / 1024 / 1024).toFixed(1);
      return res.status(413).json({ error: `Arquivo ${atualMB}MB excede limite ${tipo} (${limMB}MB)` });
    }

    if (!limite.mimes.includes(mime_type)) {
      return res.status(400).json({ error: `mime ${mime_type} nao permitido pra ${tipo}. Use: ${limite.mimes.join(', ')}` });
    }

    // Sanitiza nome + gera path unico
    const nomeSanitizado = nome_arquivo.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${limite.pasta}/${Date.now()}_${nomeSanitizado}`;

    // Gera signed upload URL (TTL padrao Supabase: 2h, suficiente)
    const { data, error } = await supabase.storage
      .from('sofia-midias')
      .createSignedUploadUrl(storagePath);

    if (error) {
      console.error('[midia-presign] erro signed url:', error);
      return res.status(500).json({ error: 'Falha ao gerar URL assinada: ' + error.message });
    }

    return res.json({
      ok: true,
      uploadUrl: data.signedUrl,
      token: data.token,
      storage_path: storagePath,
    });
  } catch (e) {
    console.error('[midia-presign] excecao:', e);
    return res.status(500).json({ error: e.message });
  }
}
