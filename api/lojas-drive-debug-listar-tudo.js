/**
 * lojas-drive-debug-listar-tudo.js
 *
 * GET /api/lojas-drive-debug-listar-tudo?user=ailson
 *
 * Lista TODOS os arquivos que o app ve no Drive, com nome, pasta, tamanho,
 * mimeType e qual tipo o detectarTipoArquivo identifica (ou null).
 */

import { setCors } from './_lojas-helpers.js';
import { listarArquivosDrive, detectarTipoArquivo } from './_lojas-drive-helpers.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query.user !== 'ailson') {
    return res.status(403).json({ error: 'Apenas admin (?user=ailson)' });
  }

  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID não configurado' });

    const arquivos = await listarArquivosDrive(folderId);

    const resultado = arquivos.map(a => {
      const tipo = detectarTipoArquivo(a.name, a.parentName);
      return {
        nome: a.name,
        pasta: a.parentName,
        tamanho_kb: Math.round((parseInt(a.size || '0')) / 1024),
        modifiedTime: a.modifiedTime,
        tipo_detectado: tipo?.tipo || '⚠️ NAO RECONHECIDO',
        loja: tipo?.loja || null,
        mime: a.mimeType,
      };
    });

    // Agrupa por pasta pra ficar legivel
    const porPasta = {};
    for (const r of resultado) {
      const p = r.pasta || '(raiz)';
      if (!porPasta[p]) porPasta[p] = [];
      porPasta[p].push(r);
    }

    return res.status(200).json({
      total_arquivos: arquivos.length,
      por_pasta: porPasta,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack?.split('\n').slice(0, 5) });
  }
}
