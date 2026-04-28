/**
 * lojas-drive-debug-conteudo.js — Inspeciona o conteúdo de 1 arquivo do Drive.
 *
 * Uso (admin):
 *   POST /api/lojas-drive-debug-conteudo
 *   Body: { file_id: "..." }  (pega da listagem do /api/lojas-drive-debug)
 *
 * Retorna:
 *   - primeiros 1500 chars do arquivo (cru)
 *   - cabeçalho parseado de várias formas (TAB, vírgula, ponto-e-vírgula)
 *   - tamanho total
 */

import { setCors, validarUsuario } from './_lojas-helpers.js';
import { baixarArquivoDrive } from './_lojas-drive-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const auth = await validarUsuario(req);
    if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error });
    if (!auth.isAdmin) {
      return res.status(403).json({ error: 'Apenas admin' });
    }

    const fileId = req.body?.file_id;
    if (!fileId) {
      return res.status(400).json({ error: 'file_id obrigatório' });
    }

    const conteudo = await baixarArquivoDrive(fileId, { encoding: 'utf-8' });
    const tamanho_total = conteudo.length;
    const preview_1500_chars = conteudo.substring(0, 1500);
    const primeiras_3_linhas = conteudo.split('\n').slice(0, 3);

    // Testa parsing com 3 separadores diferentes
    const linha_header = primeiras_3_linhas[0] || '';
    const tentativas = {
      tab: {
        separador: '\\t (TAB)',
        n_colunas: linha_header.split('\t').length,
        primeiras_5_colunas: linha_header.split('\t').slice(0, 5),
      },
      virgula: {
        separador: ', (vírgula)',
        n_colunas: linha_header.split(',').length,
        primeiras_5_colunas: linha_header.split(',').slice(0, 5),
      },
      ponto_virgula: {
        separador: '; (ponto-vírgula)',
        n_colunas: linha_header.split(';').length,
        primeiras_5_colunas: linha_header.split(';').slice(0, 5),
      },
    };

    // Conta caracteres especiais pra confirmar separador
    const conta_chars = {
      tabs: (conteudo.match(/\t/g) || []).length,
      virgulas: (conteudo.match(/,/g) || []).length,
      ponto_virgulas: (conteudo.match(/;/g) || []).length,
      quebras_linha: (conteudo.match(/\n/g) || []).length,
    };

    return res.status(200).json({
      tamanho_total_bytes: tamanho_total,
      total_linhas_aprox: conta_chars.quebras_linha + 1,
      conta_chars,
      primeiras_3_linhas,
      tentativas_separador: tentativas,
      preview_1500_chars,
    });

  } catch (err) {
    console.error('[lojas-drive-debug-conteudo] erro:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
