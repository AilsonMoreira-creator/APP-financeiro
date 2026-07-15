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
  // tipo='cores' = foto da arara com todas as cores do modelo (cor real). Ref no
  // nome do arquivo (ex: 3213.jpg). Pasta dedicada separa da foto de modelo
  // (tipo='foto'), que alimenta o reconhecimento. Ailson 28/06/2026.
  cores:     { bytes: 4  * 1024 * 1024, mimes: ['image/jpeg','image/jpg','image/png','image/webp'], pasta: 'cores' },
  video:     { bytes: 16 * 1024 * 1024, mimes: ['video/mp4','video/quicktime'],                     pasta: 'videos' },
  // tipo='catalogo' aceita PDF (catalogo em si) OU imagem (capa do catalogo).
  // Imagens caem no fluxo de capa: salvas como catalogos/capa.{ext}, upsert,
  // sem registrar em lojas_whats_midias. Ailson 27/05/2026.
  catalogo:  { bytes: 20 * 1024 * 1024, mimes: ['application/pdf','image/jpeg','image/jpg','image/png','image/webp'], pasta: 'catalogos' },
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
          // O buffer inteiro é lido como 'binary' (latin1) pra preservar os bytes
          // do arquivo. Mas o filename dos headers vem em UTF-8, então acento
          // (ex: "Amícia", "verão") sai corrompido ("AmÃ­cia"). Reinterpreta os
          // bytes latin1 como UTF-8 pra recuperar o acento. Ailson 15/07/2026.
          const filenameRaw = dispMatch[2];
          const filename = filenameRaw
            ? Buffer.from(filenameRaw, 'binary').toString('utf8')
            : filenameRaw;

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

  // ─── MODO "REGISTER" (Ailson 25/05/2026) ────────────────────────────────
  // Pra arquivos grandes (>4MB), browser sobe DIRETO pro Supabase Storage
  // via signed URL (endpoint /api/lojas-whats-midia-presign), bypass do
  // Vercel body limit de 4.5MB. Depois chama AQUI com modo=register e
  // o storage_path do arquivo ja subido pra registrar metadados.
  // Fluxo full: presign -> PUT direto Supabase -> register (esse modo).
  if (req.query?.modo === 'register' || req.headers['content-type']?.includes('application/json')) {
    return handleRegister(req, res);
  }

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

    // ─── CAPA DO CATALOGO (Ailson 27/05/2026) ────────────────────────────
    // Quando tipo=catalogo + mime=image/*, eh upload da capa (miniatura
    // mostrada na UI do chat no lugar do icone generico de documento).
    // Salva como catalogos/capa.{ext} com upsert e deleta as outras 2
    // extensoes pra garantir sempre 1 capa ativa. NAO registra em
    // lojas_whats_midias (capa nao deve aparecer no seletor de mídias).
    if (tipo === 'catalogo' && file.mime.startsWith('image/')) {
      const ext = (file.mime === 'image/png') ? 'png'
                : (file.mime === 'image/webp') ? 'webp'
                : 'jpg';
      const capaPath = `catalogos/capa.${ext}`;
      // Deleta as 3 versoes possiveis pra evitar 2 capas ativas
      await supabase.storage.from('sofia-midias').remove([
        'catalogos/capa.jpg', 'catalogos/capa.png', 'catalogos/capa.webp',
      ]);
      const { error: errUp } = await supabase.storage
        .from('sofia-midias')
        .upload(capaPath, file.buffer, { contentType: file.mime, upsert: true });
      if (errUp) {
        return res.status(500).json({ error: 'Storage upload capa: ' + errUp.message });
      }
      const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(capaPath);
      return res.json({
        ok: true,
        eh_capa_catalogo: true,
        storage_path: capaPath,
        url_publica: pub?.publicUrl,
      });
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

    // A nova midia vira a principal: arquiva a(s) anterior(es) de mesma REF+tipo.
    // Ailson 08/07/2026 (foto/cores/video). Depois do insert, pra so arquivar se deu certo.
    if (ref && (tipo === 'foto' || tipo === 'cores' || tipo === 'video')) {
      try {
        await supabase.from('lojas_whats_midias')
          .update({ ativa: false, atualizada_em: new Date().toISOString() })
          .eq('tipo', tipo).eq('ref', ref).eq('ativa', true).neq('id', row.id);
      } catch (e) { console.error('[midia-upload] arquivar anterior:', e?.message); }
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

// ═══════════════════════════════════════════════════════════════════════════
// MODO REGISTER — chamado APOS upload direto pra Supabase via signed URL
// ═══════════════════════════════════════════════════════════════════════════
async function handleRegister(req, res) {
  try {
    // Le body JSON
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: 'Body deve ser JSON valido' });
    }

    const { storage_path, tipo, ref: refRaw, descricao, nome_arquivo, size_bytes, mime_type, criada_por } = body;

    if (!storage_path) return res.status(400).json({ error: 'storage_path obrigatorio' });
    if (!tipo || !LIMITES[tipo]) return res.status(400).json({ error: `tipo invalido: ${tipo}` });
    if (!nome_arquivo) return res.status(400).json({ error: 'nome_arquivo obrigatorio' });

    // Valida que o arquivo realmente existe no storage (anti-fabricacao)
    // Lista o path e ve se aparece
    const pasta = storage_path.split('/')[0];
    const fileName = storage_path.split('/').slice(1).join('/');
    const { data: lista, error: errList } = await supabase.storage
      .from('sofia-midias')
      .list(pasta, { search: fileName, limit: 1 });

    if (errList) {
      return res.status(500).json({ error: 'Falha ao verificar storage: ' + errList.message });
    }
    if (!lista || lista.length === 0) {
      return res.status(404).json({ error: 'Arquivo nao encontrado em storage. Faca o upload primeiro.' });
    }

    // REF: igual ao fluxo normal
    const refManual = (refRaw || '').trim();
    const refDetectada = detectarRefDoNome(nome_arquivo);
    const refFinal = refManual || refDetectada || null;
    const ref = tipo === 'catalogo' ? (refManual || null) : refFinal;

    // Infere categoria
    let categoriaInferida = null;
    if (ref) {
      try {
        const { data: catData } = await supabase.rpc('lojas_whats_inferir_categoria', { p_ref: ref });
        categoriaInferida = catData || null;
      } catch {}
    }

    const { data: row, error: errIns } = await supabase
      .from('lojas_whats_midias')
      .insert({
        tipo,
        ref,
        nome_arquivo,
        storage_path,
        size_bytes: size_bytes || lista[0]?.metadata?.size || null,
        mime_type: mime_type || lista[0]?.metadata?.mimetype || null,
        descricao: descricao || null,
        categoria_inferida: categoriaInferida,
        criada_por: criada_por || 'assistente',
        ativa: true,
      })
      .select().single();

    if (errIns) {
      // Rollback storage
      await supabase.storage.from('sofia-midias').remove([storage_path]);
      return res.status(500).json({ error: 'DB insert: ' + errIns.message });
    }

    // A nova midia vira a principal: arquiva a(s) anterior(es) de mesma REF+tipo.
    if (ref && (tipo === 'foto' || tipo === 'cores' || tipo === 'video')) {
      try {
        await supabase.from('lojas_whats_midias')
          .update({ ativa: false, atualizada_em: new Date().toISOString() })
          .eq('tipo', tipo).eq('ref', ref).eq('ativa', true).neq('id', row.id);
      } catch (e) { console.error('[midia-upload/register] arquivar anterior:', e?.message); }
    }

    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(storage_path);

    return res.json({
      ok: true,
      midia: row,
      url_publica: pub?.publicUrl,
    });
  } catch (e) {
    console.error('[midia-upload/register] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
