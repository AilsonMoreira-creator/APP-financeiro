/**
 * ml-upload-attachment.js — Upload de anexo pra mensagem pos-venda ML
 *
 * Sessao Ailson 04/05/2026.
 *
 * Fluxo:
 *  1. Cliente envia multipart com 'file' + 'conversation_id'
 *  2. Validamos tipo/tamanho
 *  3. Upload pro endpoint /messages/attachments do ML
 *  4. Retornamos o ID gerado pelo ML
 *
 * IMPORTANTE: Vercel exige bodyParser:false + maxDuration aumentado pra
 * aceitar arquivos grandes (limite default eh 4.5MB no body).
 */
import { supabase, getValidToken, setCors } from './_ml-helpers.js';
import formidable from 'formidable';
import fs from 'fs/promises';

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

const ML_API = 'https://api.mercadolibre.com';

// MIME types aceitos pelo ML (lista oficial doc)
const ACCEPTED_MIMES = [
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/heif',
  'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'text/xml',
  'application/xml',
  'application/octet-stream',
];
const MAX_SIZE = 25 * 1024 * 1024; // 25MB

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  let tmpPath = null;
  try {
    // Parse multipart
    const form = formidable({ maxFileSize: MAX_SIZE });
    const [fields, files] = await form.parse(req);

    const conversationId = fields.conversation_id?.[0];
    const file = files.file?.[0];

    if (!conversationId || !file) {
      return res.status(400).json({ error: 'Falta conversation_id ou file' });
    }
    tmpPath = file.filepath;

    const mime = file.mimetype || 'application/octet-stream';
    if (!ACCEPTED_MIMES.includes(mime)) {
      return res.status(400).json({
        error: `Formato ${mime} nao aceito pelo ML. Aceitos: imagens (JPG/PNG/HEIC), documentos (PDF/DOC/XLS), texto (TXT) e XML.`,
      });
    }

    // Busca conversa pra pegar brand → token
    const { data: conv, error: convErr } = await supabase
      .from('ml_conversations')
      .select('brand')
      .eq('id', conversationId)
      .single();
    if (convErr || !conv) {
      return res.status(404).json({ error: 'Conversa nao encontrada' });
    }

    const token = await getValidToken(conv.brand);

    // Upload pro ML usando FormData nativo
    const fileBuffer = await fs.readFile(file.filepath);
    const blob = new Blob([fileBuffer], { type: mime });
    const formData = new FormData();
    formData.append('file', blob, file.originalFilename || 'anexo');

    const url = `${ML_API}/messages/attachments?tag=post_sale&site_id=MLB`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });

    if (!r.ok) {
      const text = await r.text();
      let detail;
      try { detail = JSON.parse(text); } catch { detail = text.slice(0, 300); }
      console.error('[ml-upload-attachment] ML respondeu', r.status, detail);
      return res.status(r.status).json({
        error: 'Falha upload pro ML',
        detail,
      });
    }

    const result = await r.json();
    // ML retorna { id: "415460047_..." } ou diretamente a string
    const attachmentId = typeof result === 'string'
      ? result
      : (result.id || JSON.stringify(result));

    return res.json({
      attachment_id: attachmentId,
      filename: file.originalFilename,
      size: file.size,
      mime,
    });
  } catch (e) {
    console.error('[ml-upload-attachment] erro:', e?.message);
    if (e?.code === 'LIMIT_FILE_SIZE' || /maxFileSize/i.test(e?.message || '')) {
      return res.status(413).json({ error: 'Arquivo maior que 25MB' });
    }
    return res.status(500).json({ error: e?.message || 'Erro upload' });
  } finally {
    if (tmpPath) {
      try { await fs.unlink(tmpPath); } catch {}
    }
  }
}
