/**
 * lojas-drive-debug-ignorados.js — Mostra amostra das linhas que foram
 * IGNORADAS na importação de um arquivo CSV de vendas.
 *
 * Uso (admin):
 *   POST /api/lojas-drive-debug-ignorados
 *   Body: { file_id: "...", loja: "Silva Teles" | "Bom Retiro" }
 *
 * Retorna até 50 linhas que foram filtradas, agrupadas por motivo
 * (varejo_nome, documento_placeholder, documento_curto, etc).
 *
 * Útil pra entender se o filtro está pegando atacadistas reais por
 * engano (false positive) ou se realmente são consumidores.
 */

import { setCors, validarUsuario } from './_lojas-helpers.js';
import { baixarArquivoDrive, parseCSV } from './_lojas-drive-helpers.js';
import { ehVendaVarejo } from './lojas-helpers-business.js';

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
    const linhas = parseCSV(conteudo);

    // Detecta colunas (alguns arquivos são "vendas_clientes" agregados,
    // outros são "vendas_historico")
    const ehHistorico = linhas[0] && 'PEDIDO' in linhas[0];

    const ignorados = {
      varejo_nome: [],          // nome era CONSUMIDOR/CLIENTE PADRAO/etc
      documento_placeholder: [], // doc era 1, 13, 0, etc
      documento_curto: [],       // doc < 11 chars
      documento_invalido: [],    // doc 000... ou 111...
      teste_convertr: [],        // vendedor = CONVERTR
      sem_documento: [],         // sem documento mesmo
    };

    const total_por_motivo = {
      varejo_nome: 0,
      documento_placeholder: 0,
      documento_curto: 0,
      documento_invalido: 0,
      teste_convertr: 0,
      sem_documento: 0,
    };

    for (const l of linhas) {
      const cliente = l['CLIENTE'];
      const docRaw = l['CNPJ/CPF'];
      const vendedor = l['VENDEDOR'];

      const filtro = ehVendaVarejo(cliente, docRaw, vendedor);
      if (!filtro.ignorar) continue;

      const motivo = filtro.motivo;
      total_por_motivo[motivo] = (total_por_motivo[motivo] || 0) + 1;

      // Coleta amostra (até 15 por motivo) com dados úteis pra debug
      if (ignorados[motivo] && ignorados[motivo].length < 15) {
        ignorados[motivo].push({
          pedido: l['PEDIDO'] || null,
          cliente: cliente || '(vazio)',
          documento: docRaw || '(vazio)',
          vendedor: vendedor || '(vazio)',
          total: l['TOTAL'] || l['LÍQUIDO'] || null,
          data: l['DATA|FINALIZADO'] || l['ULT COMPRA'] || null,
        });
      }
    }

    return res.status(200).json({
      arquivo_tipo_detectado: ehHistorico ? 'vendas_historico' : 'vendas_clientes',
      total_linhas: linhas.length,
      total_ignoradas: Object.values(total_por_motivo).reduce((a, b) => a + b, 0),
      total_por_motivo,
      amostra_ignorados: ignorados,
    });

  } catch (err) {
    console.error('[lojas-drive-debug-ignorados] erro:', err);
    return res.status(500).json({ error: err.message || String(err), stack: err.stack });
  }
}
