/**
 * lojas-drive-debug.js — Endpoint de diagnóstico da integração Drive.
 *
 * Use só pra investigar problemas. Retorna:
 *   - ID da pasta configurada
 *   - Conteúdo da raiz (arquivos + subpastas)
 *   - Conteúdo de cada subpasta de 1º nível
 *   - Email da conta OAuth (pra confirmar qual conta tem acesso)
 *
 * Uso (admin):
 *   POST /api/lojas-drive-debug
 *   Header: X-User: ailson
 *
 * Sem body. Retorna JSON com tudo.
 */

import { setCors, validarUsuario } from './_lojas-helpers.js';
import { getGoogleAccessToken } from './_lojas-drive-helpers.js';

const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Validação admin
    const auth = await validarUsuario(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error });
    if (!auth.isAdmin) {
      return res.status(403).json({ error: 'Apenas admin pode rodar debug' });
    }

    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      return res.status(500).json({
        error: 'GOOGLE_DRIVE_FOLDER_ID não configurado no Vercel',
      });
    }

    const token = await getGoogleAccessToken();

    // 1) Quem é a conta OAuth?
    let userInfo = null;
    try {
      const ur = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (ur.ok) {
        const data = await ur.json();
        userInfo = { email: data.email, name: data.name };
      }
    } catch (e) {
      userInfo = { erro: e.message };
    }

    // 2) Metadados da pasta raiz (existe? que nome tem?)
    let pastaRaizMeta = null;
    try {
      const r = await fetch(
        `${GOOGLE_DRIVE_API}/files/${folderId}?fields=id,name,mimeType,owners,parents`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (r.ok) {
        pastaRaizMeta = await r.json();
      } else {
        pastaRaizMeta = { erro: `${r.status}: ${await r.text()}` };
      }
    } catch (e) {
      pastaRaizMeta = { erro: e.message };
    }

    // 3) Conteúdo da raiz
    const conteudoRaiz = await listarConteudo(folderId, token);

    // 4) Conteúdo de cada subpasta
    const conteudoSubpastas = {};
    const subpastas = conteudoRaiz.itens.filter(i => i.isFolder);
    for (const sp of subpastas) {
      conteudoSubpastas[sp.name] = await listarConteudo(sp.id, token);
    }

    // 5) Tentativa adicional: buscar com query global (caso ID tenha permissão
    // mas estrutura seja diferente)
    let buscaArquivosCsv = null;
    try {
      const q = "mimeType = 'text/csv' or name contains '.csv' or name contains '.pdf'";
      const url = `${GOOGLE_DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,parents)&pageSize=20`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) {
        const data = await r.json();
        buscaArquivosCsv = {
          total: data.files?.length || 0,
          primeiros_20: (data.files || []).map(f => ({
            id: f.id, name: f.name, parents: f.parents,
          })),
        };
      } else {
        buscaArquivosCsv = { erro: await r.text() };
      }
    } catch (e) {
      buscaArquivosCsv = { erro: e.message };
    }

    return res.status(200).json({
      folder_id_configurado: folderId,
      conta_oauth: userInfo,
      pasta_raiz: pastaRaizMeta,
      conteudo_raiz: conteudoRaiz,
      conteudo_subpastas: conteudoSubpastas,
      busca_global_csv_pdf: buscaArquivosCsv,
    });

  } catch (err) {
    console.error('[lojas-drive-debug] erro:', err);
    return res.status(500).json({ error: err.message || String(err), stack: err.stack });
  }
}

async function listarConteudo(folderId, token) {
  const fields = 'files(id,name,mimeType,parents,modifiedTime)';
  const q = `'${folderId}' in parents and trashed = false`;
  const url = `${GOOGLE_DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=1000`;

  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      return { erro: `${r.status}: ${await r.text()}`, itens: [] };
    }
    const data = await r.json();
    const itens = (data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      isFolder: f.mimeType === 'application/vnd.google-apps.folder',
    }));
    return {
      total: itens.length,
      arquivos: itens.filter(i => !i.isFolder).length,
      pastas: itens.filter(i => i.isFolder).length,
      itens,
    };
  } catch (e) {
    return { erro: e.message, itens: [] };
  }
}
