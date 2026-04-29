/**
 * lojas-drive-trigger.js — Trigger manual de importação do Drive.
 *
 * Endpoint GET (pra colar URL no navegador) que dispara o lojas-drive-importar
 * com auth via query string. Usar quando precisar importar manualmente sem
 * esperar o cron de terça 6h (ex: 1ª carga, teste, ajuste).
 *
 * Uso: GET /api/lojas-drive-trigger?user=ailson
 *
 * Por que GET: facilita teste manual abrindo URL no celular/desktop sem
 * precisar de Postman/curl. Em produção o cron continua chamando o endpoint
 * principal direto.
 */

import { supabase, setCors } from './_lojas-helpers.js';
import {
  listarArquivosDrive,
  baixarArquivoDrive,
  detectarTipoArquivo,
  criarLogImportacao,
  finalizarLogImportacao,
  extrairLinhasPDFComX,
  parseXLSX,
} from './_lojas-drive-helpers.js';
import {
  parseCadastroClientesFutura,
  parseRelatorioVendasClientes,
  parseRelatorioVendasHistorico,
  parseProdutos,
  parsePedidosEspera,
  parseRelatorioBI,
} from './lojas-drive-parsers.js';

export const config = { maxDuration: 300 }; // até 5min (importação retroativa pode demorar)

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth via query param (só pra teste manual via URL no navegador)
  const userId = req.query.user || req.headers['x-user'];
  if (userId !== 'ailson') {
    return res.status(403).json({
      error: 'Apenas admin (?user=ailson)',
      exemplo: '/api/lojas-drive-trigger?user=ailson',
    });
  }

  // Forwarda pra própria handler do importador. Como esse roda em runtime
  // serverless, replicamos o setup mínimo aqui pra evitar header missing.
  // (mais simples que importar o handler interno)

  try {
    // 1. Lista arquivos do Drive (a função busca o token internamente)
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      return res.status(500).json({
        error: 'GOOGLE_DRIVE_FOLDER_ID não configurado no Vercel',
      });
    }
    const arquivos = await listarArquivosDrive(folderId);

    // 2. Carrega vendedoras (necessário pros parsers)
    const { data: vendedoras } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome, loja, ativa')
      .eq('ativa', true);

    // 3. Filtra arquivos cuja modificação é mais recente que a última importação
    //    OU é arquivo novo. (Pra trigger manual, não filtramos — re-processa
    //    tudo. Idempotente via upsert.)
    const arquivosParaProcessar = arquivos;

    const resultado = {
      iniciado_via: 'trigger_manual',
      timestamp: new Date().toISOString(),
      total_arquivos_drive: arquivos.length,
      processados: 0,
      sucessos: 0,
      erros: 0,
      ignorados_tipo_nao_reconhecido: 0,
      por_arquivo: [],
    };

    for (const arq of arquivosParaProcessar) {
      const tipoInfo = detectarTipoArquivo(arq.name, arq.parentName);
      if (!tipoInfo) {
        resultado.ignorados_tipo_nao_reconhecido++;
        resultado.por_arquivo.push({
          nome: arq.name,
          parent: arq.parentName,
          status: 'ignorado',
          motivo: 'tipo_nao_reconhecido',
        });
        continue;
      }

      const r = await processarArquivo(arq, tipoInfo, vendedoras || []);
      resultado.processados++;
      if (r.status === 'sucesso') resultado.sucessos++;
      else resultado.erros++;
      resultado.por_arquivo.push({
        nome: arq.name,
        tipo: tipoInfo.tipo,
        loja: tipoInfo.loja,
        ...r,
      });
    }

    return res.status(200).json(resultado);
  } catch (err) {
    console.error('[lojas-drive-trigger] erro fatal:', err);
    return res.status(500).json({
      error: err.message || String(err),
      stack: err.stack?.split('\n').slice(0, 5),
    });
  }
}

// ─── Processamento de 1 arquivo (cópia exata do lojas-drive-importar) ──────

async function processarArquivo(arq, tipoInfo, vendedoras) {
  const tInicio = Date.now();

  const importacaoId = await criarLogImportacao(supabase, {
    nome_arquivo: arq.name,
    tipo_arquivo: tipoInfo.tipo,
    loja: tipoInfo.loja,
    drive_file_id: arq.id,
    iniciada_por: 'trigger_manual',
  });

  try {
    const ehPDF = tipoInfo.tipo.startsWith('sacola');
    const ehXLSX = tipoInfo.tipo.startsWith('relatorio_bi');
    const conteudo = await baixarArquivoDrive(arq.id, {
      encoding: (ehPDF || ehXLSX) ? 'binary' : 'utf-8',
    });

    let textoConteudo = conteudo;
    let linhasComX = null;
    let linhasXLSX = null;
    if (ehPDF) {
      linhasComX = await extrairLinhasPDFComX(conteudo);
      textoConteudo = '';
    } else if (ehXLSX) {
      linhasXLSX = await parseXLSX(conteudo);
      textoConteudo = '';
    }

    let parseResult;
    if (tipoInfo.tipo === 'cadastro_clientes_futura') {
      parseResult = parseCadastroClientesFutura(textoConteudo);
    } else if (tipoInfo.tipo.startsWith('vendas_clientes')) {
      parseResult = parseRelatorioVendasClientes(textoConteudo, tipoInfo.loja, vendedoras);
    } else if (tipoInfo.tipo.startsWith('vendas_historico') || tipoInfo.tipo.startsWith('vendas_semanal')) {
      parseResult = parseRelatorioVendasHistorico(textoConteudo, tipoInfo.loja, vendedoras);
    } else if (tipoInfo.tipo === 'produtos_semanal') {
      parseResult = parseProdutos(textoConteudo);
    } else if (tipoInfo.tipo.startsWith('sacola')) {
      parseResult = parsePedidosEspera(linhasComX, tipoInfo.loja, vendedoras);
    } else if (tipoInfo.tipo.startsWith('relatorio_bi')) {
      parseResult = parseRelatorioBI(linhasXLSX, tipoInfo.loja, vendedoras);
    } else {
      throw new Error(`Tipo desconhecido: ${tipoInfo.tipo}`);
    }

    // Reusa o aplicarUpsert do importador via dynamic import
    const { aplicarUpsert } = await import('./lojas-drive-importar.js')
      .then(m => ({ aplicarUpsert: m.aplicarUpsert || m.default?.aplicarUpsert }))
      .catch(() => ({ aplicarUpsert: null }));

    // Se o aplicarUpsert não está exportado, replicamos inline o essencial.
    // Pra simplificar: usamos uma cópia mínima do upsert por tipo.
    const upsertStats = await aplicarUpsertInline(tipoInfo.tipo, parseResult.registros, importacaoId);

    await finalizarLogImportacao(supabase, importacaoId, {
      status: 'sucesso',
      registros_total: parseResult.total,
      registros_inseridos: upsertStats.inseridos,
      registros_atualizados: upsertStats.atualizados,
      registros_ignorados: parseResult.ignorados,
      detalhes_ignorados: parseResult.detalhes_ignorados,
      iniciada_em: tInicio,
    });

    return {
      status: 'sucesso',
      registros: parseResult.total,
      inseridos: upsertStats.inseridos,
      atualizados: upsertStats.atualizados,
      ignorados: parseResult.ignorados,
      detalhes_ignorados: parseResult.detalhes_ignorados,
      duracao_ms: Date.now() - tInicio,
    };
  } catch (err) {
    console.error(`[lojas-drive-trigger] erro processando ${arq.name}:`, err);
    await finalizarLogImportacao(supabase, importacaoId, {
      status: 'erro',
      erro: err.message || String(err),
      iniciada_em: tInicio,
    });
    return { status: 'erro', erro: err.message };
  }
}

// ─── Upsert inline (cópia simplificada do importador principal) ───────────

const TAMANHO_LOTE_UPSERT = 500;

async function upsertEmLotes(tabela, registros, conflictCol) {
  if (!registros?.length) return { inseridos: 0, atualizados: 0 };
  const onConflict = Array.isArray(conflictCol) ? conflictCol.join(',') : conflictCol;
  let inseridos = 0;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE_UPSERT) {
    const lote = registros.slice(i, i + TAMANHO_LOTE_UPSERT);
    const { error, count } = await supabase
      .from(tabela)
      .upsert(lote, { onConflict, count: 'exact' });
    if (error) {
      throw new Error(`Upsert em ${tabela} falhou (lote ${i}): ${error.message}`);
    }
    inseridos += count || lote.length;
  }
  return { inseridos, atualizados: 0 };
}

async function aplicarUpsertInline(tipo, registros, importacaoId) {
  if (!registros?.length) return { inseridos: 0, atualizados: 0 };

  const enriquecidos = registros.map(r => ({ ...r, importacao_id: importacaoId }));

  if (tipo === 'cadastro_clientes_futura') {
    const docMap = new Map();
    for (const r of enriquecidos) {
      const k = r.documento;
      if (!k) continue;
      if (!docMap.has(k)) docMap.set(k, r);
    }
    return upsertEmLotes('lojas_clientes', [...docMap.values()], 'documento');
  }

  if (tipo.startsWith('vendas_clientes')) {
    const docs = [...new Set(enriquecidos.map(r => r.documento).filter(Boolean))];
    if (docs.length) {
      const { data: clientes } = await supabase
        .from('lojas_clientes')
        .select('id, documento')
        .in('documento', docs);
      const map = new Map((clientes || []).map(c => [c.documento, c.id]));
      enriquecidos.forEach(r => {
        if (!r.cliente_id && r.documento) r.cliente_id = map.get(r.documento) || null;
      });
    }
    const filtrados = enriquecidos.filter(r => r.cliente_id);
    if (filtrados.length === 0) return { inseridos: 0, atualizados: 0 };
    return upsertEmLotes('lojas_vendas_clientes', filtrados, ['cliente_id', 'mes_ano']);
  }

  if (tipo.startsWith('vendas_historico') || tipo.startsWith('vendas_semanal')) {
    const docs = [...new Set(enriquecidos.map(r => r.documento).filter(Boolean))];
    if (docs.length) {
      const { data: clientes } = await supabase
        .from('lojas_clientes')
        .select('id, documento')
        .in('documento', docs);
      const map = new Map((clientes || []).map(c => [c.documento, c.id]));
      enriquecidos.forEach(r => {
        if (!r.cliente_id && r.documento) r.cliente_id = map.get(r.documento) || null;
      });
    }
    const filtrados = enriquecidos.filter(r => r.cliente_id);
    if (filtrados.length === 0) return { inseridos: 0, atualizados: 0 };
    return upsertEmLotes('lojas_vendas', filtrados, ['numero_pedido', 'loja']);
  }

  if (tipo === 'produtos_semanal') {
    const limpos = enriquecidos.map(r => {
      const { _frase_amigavel, importacao_id, ...resto } = r;
      resto.pode_oferecer = (resto.qtd_estoque || 0) > 100;
      resto.motivo_pode_oferecer = resto.pode_oferecer ? 'estoque' : null;
      resto.ultima_atualizacao = new Date().toISOString();
      return resto;
    });
    return upsertEmLotes('lojas_produtos', limpos, 'ref');
  }

  if (tipo.startsWith('sacola')) {
    const documentos = [...new Set(enriquecidos.map(r => r.documento_raw).filter(Boolean))];
    if (documentos.length) {
      const { data: clientes } = await supabase
        .from('lojas_clientes')
        .select('id, documento')
        .in('documento', documentos);
      const docToId = new Map((clientes || []).map(c => [c.documento, c.id]));
      enriquecidos.forEach(r => {
        r.cliente_id = docToId.get(r.documento_raw) || null;
      });
    }
    const loja = enriquecidos[0]?.loja;
    if (loja) {
      await supabase
        .from('lojas_pedidos_sacola')
        .update({ ativo: false, fechado_em: new Date().toISOString() })
        .eq('loja', loja)
        .eq('ativo', true);
    }
    enriquecidos.forEach(r => { r.ativo = true; r.fechado_em = null; });
    return upsertEmLotes('lojas_pedidos_sacola', enriquecidos, ['numero_pedido', 'loja']);
  }

  if (tipo.startsWith('relatorio_bi')) {
    const documentos = [...new Set(enriquecidos.map(r => r.documento_cliente_raw).filter(Boolean))];
    const pedidos = [...new Set(enriquecidos.map(r => r.numero_pedido).filter(Boolean))];

    let docToClienteId = new Map();
    let pedidoToVendaId = new Map();
    let pedidoToVendedoraId = new Map();

    if (documentos.length) {
      const { data: clientes } = await supabase
        .from('lojas_clientes')
        .select('id, documento')
        .in('documento', documentos);
      docToClienteId = new Map((clientes || []).map(c => [c.documento, c.id]));
    }

    if (pedidos.length) {
      const loja = enriquecidos[0]?.loja;
      const { data: vendas } = await supabase
        .from('lojas_vendas')
        .select('id, numero_pedido, vendedora_id')
        .eq('loja', loja)
        .in('numero_pedido', pedidos);
      pedidoToVendaId = new Map((vendas || []).map(v => [v.numero_pedido, v.id]));
      pedidoToVendedoraId = new Map((vendas || []).map(v => [v.numero_pedido, v.vendedora_id]));
    }

    enriquecidos.forEach(r => {
      r.cliente_id = docToClienteId.get(r.documento_cliente_raw) || null;
      r.venda_id = pedidoToVendaId.get(r.numero_pedido) || null;
      r.vendedora_id = pedidoToVendedoraId.get(r.numero_pedido) || null;
    });

    return upsertEmLotes('lojas_vendas_itens', enriquecidos, ['numero_pedido', 'loja', 'sku']);
  }

  throw new Error(`Tipo sem rota de upsert: ${tipo}`);
}
