/**
 * lojas-drive-debug-vendas-clientes-br.js
 *
 * GET /api/lojas-drive-debug-vendas-clientes-br?user=ailson
 *
 * Diagnostico do CSV vendas_clientes_br.csv que ta vindo so com 132 linhas.
 * Mostra:
 *   - Tamanho real do arquivo no Drive
 *   - Quantas linhas o arquivo tem (split simples)
 *   - Quantas linhas o parseCSV retorna
 *   - Primeira e ultima linha
 *   - Linhas em torno da #132 (onde corta)
 */

import { setCors } from './_lojas-helpers.js';
import {
  listarArquivosDrive, baixarArquivoDrive, detectarTipoArquivo, parseCSV,
} from './_lojas-drive-helpers.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query.user !== 'ailson') {
    return res.status(403).json({ error: 'Apenas admin (?user=ailson)' });
  }

  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      return res.status(500).json({ error: 'GOOGLE_DRIVE_FOLDER_ID não configurado' });
    }
    const arquivos = await listarArquivosDrive(folderId);
    const candidatos = arquivos.filter(a => {
      const tipo = detectarTipoArquivo(a.name, a.parentName);
      return tipo?.tipo === 'vendas_clientes_br';
    });

    if (candidatos.length === 0) {
      return res.status(404).json({
        error: 'Nenhum arquivo vendas_clientes_br encontrado no Drive',
        total_arquivos_drive: arquivos.length,
      });
    }

    // 2. Pra CADA arquivo encontrado (pode ter duplicado), baixar e analisar
    const resultados = [];
    for (const arq of candidatos) {
      const conteudo = await baixarArquivoDrive(arq.id, { encoding: 'utf-8' });
      const tamanho_bytes = conteudo.length;
      const linhas_split_simples = conteudo.split('\n').length;
      const parsed = parseCSV(conteudo);

      resultados.push({
        nome: arq.name,
        id: arq.id,
        parent: arq.parentName,
        modifiedTime: arq.modifiedTime,
        tamanho_bytes,
        tamanho_kb: Math.round(tamanho_bytes / 1024),
        linhas_no_arquivo_cru: linhas_split_simples,
        registros_parseados: parsed.length,
        primeira_linha: conteudo.split('\n')[0]?.substring(0, 200),
        linha_2: conteudo.split('\n')[1]?.substring(0, 200),
        ultima_linha: conteudo.split('\n').filter(l => l.trim()).slice(-1)[0]?.substring(0, 200),
        // Onde "corta" — se o parser para na linha 132, mostra contexto
        linha_130_a_135: conteudo.split('\n').slice(130, 136).map(l => l.substring(0, 100)),
      });
    }

    return res.status(200).json({
      total_candidatos: candidatos.length,
      arquivos: resultados,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack?.split('\n').slice(0, 5) });
  }
}
