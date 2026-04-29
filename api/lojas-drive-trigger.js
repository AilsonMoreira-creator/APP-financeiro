/**
 * lojas-drive-trigger.js — Trigger manual de importação do Drive (versão proxy).
 *
 * Endpoint GET (URL clicável no navegador) que chama o handler OFICIAL
 * `lojas-drive-importar.js` internamente, passando os headers que ele exige.
 *
 * Vantagem dessa versão: usa a lógica REAL de upsert (que sabe gravar em
 * lojas_clientes + lojas_clientes_kpis pra parser vendas_clientes,
 * em lojas_vendas pra parser vendas_historico, etc).
 *
 * A primeira versão (commit 99cbe3c) replicava a lógica inline e tinha bugs:
 *   - mandava registros pra tabela inexistente `lojas_vendas_clientes`
 *   - mandava `importacao_id` pra `lojas_clientes` (coluna não existe)
 *
 * Uso: GET /api/lojas-drive-trigger?user=ailson
 *      GET /api/lojas-drive-trigger?user=ailson&action=carga_inicial
 *      GET /api/lojas-drive-trigger?user=ailson&action=sync_semanal (default)
 */

import { setCors } from './_lojas-helpers.js';
import importadorHandler from './lojas-drive-importar.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query.user || req.headers['x-user'];
  if (userId !== 'ailson') {
    return res.status(403).json({
      error: 'Apenas admin (?user=ailson)',
      exemplo: '/api/lojas-drive-trigger?user=ailson',
    });
  }

  const action = req.query.action || 'sync_semanal';
  if (!['carga_inicial', 'sync_semanal', 'sync_arquivo'].includes(action)) {
    return res.status(400).json({
      error: 'action inválido. Use: carga_inicial | sync_semanal | sync_arquivo',
      recebido: action,
    });
  }

  // Mock req/res pra reutilizar o handler oficial:
  //   - method POST (handler oficial diferencia POST/cron)
  //   - header x-user com 'ailson' (passa pelo validarUsuario)
  //   - body { action } (handler espera no body em modo manual)
  const fakeReq = {
    method: 'POST',
    headers: {
      'x-user': 'ailson',
      'content-type': 'application/json',
    },
    body: { action },
    query: {},
  };

  // Captura a resposta do handler interno
  let statusCode = 200;
  let payload = null;
  const fakeRes = {
    setHeader: () => {},
    status(code) { statusCode = code; return this; },
    json(obj) { payload = obj; return this; },
    end() { return this; },
  };

  try {
    await importadorHandler(fakeReq, fakeRes);
    return res.status(statusCode).json(payload || { error: 'sem resposta do importador' });
  } catch (err) {
    console.error('[lojas-drive-trigger] erro fatal:', err);
    return res.status(500).json({
      error: err.message || String(err),
      stack: err.stack?.split('\n').slice(0, 6),
    });
  }
}
