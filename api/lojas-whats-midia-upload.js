// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-midia-upload.js — Upload de midia Sofia (foto/video/catalogo)
// ═══════════════════════════════════════════════════════════════════════════
//
// POST com Content-Type: multipart/form-data
//   campo 'arquivo' (binary)
//   campo 'tipo'    (foto | video | catalogo)
//   campo 'ref'     (opcional, ou auto-detecta do nome)
//   campo 'descricao' (opcional)
//
// Limites:
//   foto:      2MB  (image/jpeg, image/png, image/webp)
//   video:    16MB  (video/mp4 — limite WhatsApp)
//   catalogo: 20MB  (application/pdf)
//
// Auto-detecta REF do nome se nao foi informado:
//   "2655.jpg" -> ref='2655'
//   "outono_2026.pdf" -> ref=null (catalogo geral)
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';
import { Buffer } from 'node:buffer';

export const config = {
  api: {
    bodyParser: false,  // multipart manual
  },
};

const LIMITES = {
  foto:      { bytes: 2  * 1024 * 1024, mimes: ['image/jpeg','image/jpg','image/png','image/webp'], pasta: 'fotos' },
  video:     { bytes: 16 * 1024 * 1024, mimes: ['video/mp4','video/quicktime'],                     pasta: 'videos' },
  catalogo:  { bytes: 20 * 1024 * 1024, mimes: ['application/pdf'],                                  pasta: 'catalogos' },
};

// Le multipart manualmente (sem dependencia)
async function readMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        const m = contentType.match(/boundary=(.+)$/);
        if (!m) return reject(new Error('boundary nao encontrado no content-type'));
        const boundary = '--' + m[1];

        const text = buffer.toString('binary');
        const parts = text.split(boundary).slice(1, -1);  // remove primeiro vazio + final --
        const fields = {};
        let file = null;

        for (const p of parts) {
          // Cada parte tem headers separados do body por \r\n\r\n
          const headerEnd = p.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const headers = p.slice(0, headerEnd);
          let body = p.slice(headerEnd + 4);
          // Remove \r\n final
          if (body.endsWith('\r\n')) body = body.slice(0, -2);

          const dispMatch = headers.match(/name="([^"]+)"(?:;\s*filename="([^"]+)")?/);
          if (!dispMatch) continue;
          const name = dispMatch[1];
          const filename = dispMatch[2];

          if (filename) {
            // Arquivo binario
            const ctMatch = headers.match(/Content-Type:\s*(.+)/i);
            file = {
              field: name,
              filename,
              mime: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
              buffer: Buffer.from(body, 'binary'),
            };
          } else {
            fields[name] = body;
          }
        }
        resolve({ fields, file });
      } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function detectarRefDoNome(filename) {
  // 2655.jpg / 2655-azul.jpg / ref_2655.jpg
  const m = filename.match(/^(\d{3,6})(?:[-_.]|\b)/);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST esperado' });

  try {
    const { fields, file } = await readMultipart(req);
    if (!file) return res.status(400).json({ error: 'Arquivo nao enviado (campo "arquivo")' });

    const tipo = fields.tipo;
    if (!LIMITES[tipo]) {
      return res.status(400).json({ error: `tipo invalido: ${tipo}. Use foto/video/catalogo.` });
    }

    const limite = LIMITES[tipo];
    if (file.buffer.length > limite.bytes) {
      return res.status(413).json({
        error: `Arquivo ${(file.buffer.length / 1024 / 1024).toFixed(1)}MB excede limite ${tipo} (${limite.bytes / 1024 / 1024}MB)`,
      });
    }
    if (!limite.mimes.includes(file.mime)) {
      return res.status(415).json({ error: `Mime invalido pra ${tipo}: ${file.mime}. Aceitos: ${limite.mimes.join(', ')}` });
    }

    // REF: prioridade campo manual > auto-detect (3C escolha Ailson)
    const refManual = (fields.ref || '').trim();
    const refDetectada = detectarRefDoNome(file.filename);
    const refFinal = refManual || refDetectada || null;

    // Catalogo sempre nullable
    const ref = tipo === 'catalogo' ? (refManual || null) : refFinal;

    // Path no storage: pasta/nome
    const nomeSanitizado = file.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${limite.pasta}/${Date.now()}_${nomeSanitizado}`;

    // Upload pro Supabase Storage
    const { error: errUp } = await supabase.storage
      .from('sofia-midias')
      .upload(storagePath, file.buffer, {
        contentType: file.mime,
        upsert: false,
      });
    if (errUp) {
      return res.status(500).json({ error: 'Storage upload: ' + errUp.message });
    }

    // Infere categoria via funcao SQL (se ref existir)
    let categoriaInferida = null;
    if (ref) {
      try {
        const { data: catData } = await supabase.rpc('lojas_whats_inferir_categoria', { p_ref: ref });
        categoriaInferida = catData || null;
      } catch {}
    }

    // Insere registro
    const { data: row, error: errIns } = await supabase
      .from('lojas_whats_midias')
      .insert({
        tipo,
        ref,
        nome_arquivo: file.filename,
        storage_path: storagePath,
        size_bytes: file.buffer.length,
        mime_type: file.mime,
        descricao: fields.descricao || null,
        categoria_inferida: categoriaInferida,
        criada_por: fields.criada_por || 'assistente',
        ativa: true,
      })
      .select().single();

    if (errIns) {
      // Rollback storage
      await supabase.storage.from('sofia-midias').remove([storagePath]);
      return res.status(500).json({ error: 'DB insert: ' + errIns.message });
    }

    // URL publica
    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(storagePath);

    return res.json({
      ok: true,
      midia: row,
      url_publica: pub?.publicUrl,
    });
  } catch (e) {
    console.error('[midia-upload] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
