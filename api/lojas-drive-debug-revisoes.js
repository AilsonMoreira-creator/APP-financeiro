/**
 * lojas-drive-debug-revisoes.js
 *
 * GET /api/lojas-drive-debug-revisoes?user=ailson&file_id=...
 *
 * Lista revisoes (versoes anteriores) de 1 arquivo no Drive.
 * Util pra recuperar versao antiga quando arquivo foi sobrescrito.
 */

import { setCors } from './_lojas-helpers.js';
import { getGoogleAccessToken } from './_lojas-drive-helpers.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query.user !== 'ailson') {
    return res.status(403).json({ error: 'Apenas admin (?user=ailson)' });
  }

  const fileId = req.query.file_id || '1BZM-jJdJhusjbBPAh2eOQ8w9YWozNN5b';
  // ↑ default: vendas_clientes_br

  try {
    const token = await getGoogleAccessToken();
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/revisions?fields=revisions(id,modifiedTime,size,lastModifyingUser,originalFilename)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: 'Drive API falhou', detail: err });
    }

    const data = await r.json();
    const revisoes = (data.revisions || []).map(rev => ({
      id: rev.id,
      modifiedTime: rev.modifiedTime,
      size_bytes: parseInt(rev.size || '0'),
      size_kb: Math.round(parseInt(rev.size || '0') / 1024),
      modifiedBy: rev.lastModifyingUser?.displayName || rev.lastModifyingUser?.emailAddress,
      originalFilename: rev.originalFilename,
    }));

    return res.status(200).json({
      file_id: fileId,
      total_revisoes: revisoes.length,
      revisoes,
      hint: 'Procure pela revisao com size_kb maior — eh a versao "completa" antes do truncamento.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
