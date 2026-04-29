/**
 * lojas-drive-importar.js — Edge Function que orquestra a importação Drive (Parte 5).
 *
 * 2 modos de invocação:
 *
 *   1. Manual (admin): POST /api/lojas-drive-importar
 *      Body: { action: 'carga_inicial' | 'sync_semanal' | 'sync_arquivo',
 *              file_id?: string }
 *      - 'carga_inicial': processa todos os 5 arquivos de _CARGA_INICIAL/
 *      - 'sync_semanal': processa Silva_Teles/, Bom_Retiro/, Sacola_*, Produtos/
 *      - 'sync_arquivo': processa 1 arquivo específico (pra retry)
 *
 *   2. Cron (automático): GET /api/lojas-drive-importar?modo=cron
 *      Roda toda terça 06:00 — chamado por lojas-drive-cron.js
 *
 * Fluxo:
 *   1. Lista arquivos da pasta GOOGLE_DRIVE_FOLDER_ID (e subpastas)
 *   2. Filtra por tipo solicitado (carga_inicial vs sync_semanal)
 *   3. Pra cada arquivo:
 *      a. Cria log em lojas_importacoes (status: iniciada)
 *      b. Baixa conteúdo
 *      c. Chama parser correspondente
 *      d. Faz upsert em lote no Supabase (1000 por vez)
 *      e. Atualiza log (sucesso ou erro com detalhes)
 *   4. Retorna resumo total
 *
 * Padrão técnico:
 *   - SUPABASE_KEY (service role) — bypassa RLS
 *   - Validação X-User no modo manual; cron usa header próprio
 *   - Idempotente: upsert com ON CONFLICT por chaves naturais
 *   - Rate limit: arquivos processados em sequência (1 por vez)
 *     pra não estourar timeout do Vercel (90s)
 */

import {
  supabase,
  setCors,
  validarUsuario,
  ehAdminLojas,
} from './_lojas-helpers.js';

import {
  getGoogleAccessToken,
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

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const TAMANHO_LOTE_UPSERT = 500;
const HISTORICO_DATA_CORTE = '2025-01-01';  // Não importa vendas anteriores

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Modo cron (chamado pelo cron-handler) ou manual?
    const ehCron = req.query?.modo === 'cron' || req.headers['x-vercel-cron'];
    let acao, fileId;

    if (ehCron) {
      acao = 'sync_semanal';
      fileId = null;
    } else {
      // Modo manual: precisa ser admin
      const auth = await validarUsuario(req);
      if (!auth.ok) return res.status(auth.status || 401).json({ error: auth.error });
      if (!auth.isAdmin) {
        return res.status(403).json({ error: 'Apenas admin pode disparar importação Drive' });
      }
      const body = req.body || {};
      acao = body.action;
      fileId = body.file_id;

      if (!['carga_inicial', 'sync_semanal', 'sync_arquivo'].includes(acao)) {
        return res.status(400).json({
          error: 'action inválido. Use: carga_inicial | sync_semanal | sync_arquivo',
        });
      }
      if (acao === 'sync_arquivo' && !fileId) {
        return res.status(400).json({ error: 'sync_arquivo requer file_id' });
      }
    }

    // Carrega vendedoras (uma vez só, usado por todos os parsers)
    const { data: vendedoras, error: errVend } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome, loja, ativa, is_placeholder, is_padrao_loja, aliases');
    if (errVend) {
      return res.status(500).json({ error: `Erro carregando vendedoras: ${errVend.message}` });
    }

    // Lista arquivos do Drive
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      return res.status(500).json({
        error: 'GOOGLE_DRIVE_FOLDER_ID não configurado no Vercel',
      });
    }

    const arquivos = await listarArquivosDrive(folderId);

    // Filtra por ação
    let arquivosParaProcessar;
    if (acao === 'sync_arquivo') {
      arquivosParaProcessar = arquivos.filter(a => a.id === fileId);
      if (!arquivosParaProcessar.length) {
        return res.status(404).json({ error: `Arquivo ${fileId} não encontrado no Drive` });
      }
    } else if (acao === 'carga_inicial') {
      // Pasta _CARGA_INICIAL/* (5 arquivos: cadastro + 2x clientes/historico)
      arquivosParaProcessar = arquivos.filter(a =>
        /carga[-_]?inicial|geral[-_]?inicial|silva[-_]?teles[-_]?inicial|bom[-_]?retiro[-_]?inicial/i
          .test(a.parentName)
      );
    } else {
      // sync_semanal: pega tudo das pastas semanais (Silva_Teles, Bom_Retiro,
      // Sacola_*, Produtos) e descarta as de _CARGA_INICIAL
      arquivosParaProcessar = arquivos.filter(a =>
        !/carga[-_]?inicial|inicial$/i.test(a.parentName)
      );
    }

    // Processa cada arquivo em sequência
    const resultado = {
      acao,
      total_arquivos: arquivosParaProcessar.length,
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

      const r = await processarArquivo(arq, tipoInfo, vendedoras);
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
    console.error('[lojas-drive-importar] erro fatal:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCESSAMENTO DE 1 ARQUIVO
// ═══════════════════════════════════════════════════════════════════════════

async function processarArquivo(arq, tipoInfo, vendedoras) {
  const tInicio = Date.now();

  const importacaoId = await criarLogImportacao(supabase, {
    nome_arquivo: arq.name,
    tipo_arquivo: tipoInfo.tipo,
    loja: tipoInfo.loja,
    drive_file_id: arq.id,
    iniciada_por: 'cron',
  });

  try {
    // Baixa conteúdo (PDF + XLSX são binários, CSV é texto)
    const ehPDF = tipoInfo.tipo.startsWith('sacola');
    const ehXLSX = tipoInfo.tipo.startsWith('relatorio_bi');
    const conteudo = await baixarArquivoDrive(arq.id, {
      encoding: (ehPDF || ehXLSX) ? 'binary' : 'utf-8',
    });

    // Pra PDF, extrai texto antes de chamar o parser
    // Pra XLSX, extrai linhas-objeto via SheetJS
    let textoConteudo = conteudo;
    let linhasComX = null;
    let linhasXLSX = null;
    if (ehPDF) {
      // Sacolas (e outros PDFs tabulares) usam pdfjs-dist com coordenadas X/Y
      // pra preservar separação de colunas. pdf-parse colapsava espaços e
      // colava qtd+devol+total+frete num número só, fazendo valor_total cair
      // pra 0 (bug 28/04/2026 — todas as 11 sacolas no banco estavam com 0).
      linhasComX = await extrairLinhasPDFComX(conteudo);
      // Mantém textoConteudo como fallback caso outro tipo de PDF use texto
      textoConteudo = '';
    } else if (ehXLSX) {
      // Relatório BI Mire (xlsx) — 1 linha por SKU vendido.
      linhasXLSX = await parseXLSX(conteudo);
      textoConteudo = '';
    }

    // Chama parser correspondente
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
      // ⚠️ Sacolas usam linhasComX (estrutura nova com coordenadas)
      parseResult = parsePedidosEspera(linhasComX, tipoInfo.loja, vendedoras);
    } else if (tipoInfo.tipo.startsWith('relatorio_bi')) {
      // ⚠️ Relatório BI usa linhasXLSX (objetos do SheetJS)
      parseResult = parseRelatorioBI(linhasXLSX, tipoInfo.loja, vendedoras);
    } else {
      throw new Error(`Tipo desconhecido: ${tipoInfo.tipo}`);
    }

    // Faz upsert no Supabase
    const upsertStats = await aplicarUpsert(tipoInfo.tipo, parseResult.registros, importacaoId);

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
    console.error(`[lojas-drive-importar] erro processando ${arq.name}:`, err);
    await finalizarLogImportacao(supabase, importacaoId, {
      status: 'erro',
      erro: err.message || String(err),
      iniciada_em: tInicio,
    });
    return { status: 'erro', erro: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRAÇÃO DE PDF
// ═══════════════════════════════════════════════════════════════════════════
//
// Usa pdf-parse (lib npm). Adicionar ao package.json: "pdf-parse": "^1.1.1"
//
// Importante: pdf-parse é CommonJS, então usa import dinâmico.
//
// ⚠️ FIX 28/04/2026: pdf-parse default colapsa TODOS os espaços em branco.
// Pra sacolas (PDFs tabulares), isso colava colunas e quebrava o parser:
//   "18    0          936,00    0,00" virava "180936,000,00".
// Solução: pagerender custom que reinsere espaços baseado em posição X
// dos itens de texto. Total/frete/qtd ficam separáveis pela regex.
// ═══════════════════════════════════════════════════════════════════════════

// Pagerender custom: preserva layout horizontal inserindo espaços
// proporcionais aos gaps de posição X entre itens de texto consecutivos.
function _pagerenderComLayout(pageData) {
  const renderOptions = { normalizeWhitespace: false, disableCombineTextItems: false };
  return pageData.getTextContent(renderOptions).then(textContent => {
    let lastY = -1;
    let lastX = -1;
    let result = '';
    for (const item of textContent.items) {
      const x = item.transform[4];
      const y = item.transform[5];
      // Mudou de linha (Y diferente)
      if (lastY !== -1 && Math.abs(y - lastY) > 2) {
        result += '\n';
        lastX = -1;
      } else if (lastX !== -1) {
        const gap = x - lastX;
        if (gap > 3) {
          // Insere espaços proporcionais ao gap (1 espaço a cada ~3px)
          result += ' '.repeat(Math.max(1, Math.round(gap / 3)));
        }
      }
      result += item.str;
      lastY = y;
      lastX = x + (item.width || 0);
    }
    return result;
  });
}

async function extrairTextoPDF(buffer, opts = {}) {
  const { preservarLayout = false } = opts;
  const pdfParse = (await import('pdf-parse')).default;
  const parseOpts = preservarLayout ? { pagerender: _pagerenderComLayout } : {};
  const data = await pdfParse(Buffer.from(buffer), parseOpts);
  return data.text || '';
}

// ═══════════════════════════════════════════════════════════════════════════
// UPSERT POR TIPO
// ═══════════════════════════════════════════════════════════════════════════

async function aplicarUpsert(tipo, registros, importacaoId) {
  if (!registros?.length) return { inseridos: 0, atualizados: 0 };

  // Adiciona importacao_id em registros que tem essa coluna
  const enriquecidos = registros.map(r => ({ ...r, importacao_id: importacaoId }));

  if (tipo === 'cadastro_clientes_futura') {
    const limpos = enriquecidos.map(r => {
      const { _kpis, _frase_amigavel, importacao_id, ...resto } = r;
      return resto;
    });
    // Dedup por documento (Cadastro Futura tem clientes cadastrados 2x com
    // mesmo CPF/CNPJ; Postgres não permite ON CONFLICT na mesma linha 2x
    // dentro de um upsert). Mantém o último (geralmente cadastro mais novo).
    const dedup = new Map();
    for (const r of limpos) {
      if (r.documento) dedup.set(r.documento, r);
    }
    return upsertEmLotes('lojas_clientes', Array.from(dedup.values()), 'documento');
  }

  if (tipo.startsWith('vendas_clientes')) {
    // Esse parser produz registros pra lojas_clientes COM kpis embutidos.
    // Estratégia:
    //   1. Upsert dos clientes (sem _kpis), dedupados por documento
    //   2. Pra cada cliente, busca o id e upsert em lojas_clientes_kpis
    const clientesRaw = enriquecidos.map(r => {
      const { _kpis, vendedora_nome, importacao_id, ...resto } = r;
      return resto;
    });
    // Dedup por documento (mesmo motivo do cadastro_clientes_futura)
    const dedupClientes = new Map();
    for (const r of clientesRaw) {
      if (r.documento) dedupClientes.set(r.documento, r);
    }
    const clientesDedupados = Array.from(dedupClientes.values());
    const upsertClientes = await upsertEmLotes('lojas_clientes', clientesDedupados, 'documento');

    // Buscar IDs por documento (em lote pra não fazer N queries)
    const documentos = enriquecidos.map(r => r.documento);
    const { data: clientes } = await supabase
      .from('lojas_clientes')
      .select('id, documento')
      .in('documento', documentos);

    const docToId = new Map((clientes || []).map(c => [c.documento, c.id]));

    // KPIs também precisam dedup por documento (mesma razão)
    const dedupKpis = new Map();
    for (const r of enriquecidos) {
      if (r.documento && docToId.has(r.documento)) {
        dedupKpis.set(r.documento, r);
      }
    }

    const kpisRows = Array.from(dedupKpis.values()).map(r => {
      const ticket_medio = r._kpis.qtd_compras > 0
        ? Math.round((r._kpis.lifetime_total / r._kpis.qtd_compras) * 100) / 100
        : 0;
      return {
        cliente_id: docToId.get(r.documento),
        qtd_compras: r._kpis.qtd_compras,
        qtd_pecas: r._kpis.qtd_pecas,
        lifetime_total: r._kpis.lifetime_total,
        ticket_medio,
        primeira_compra: r._kpis.primeira_compra,
        ultima_compra: r._kpis.ultima_compra,
        classificacao_abc: r._kpis.classificacao_abc,
        ultima_atualizacao: new Date().toISOString(),
      };
    });

    if (kpisRows.length) {
      await upsertEmLotes('lojas_clientes_kpis', kpisRows, 'cliente_id');
    }

    return upsertClientes;
  }

  if (tipo.startsWith('vendas_historico') || tipo.startsWith('vendas_semanal')) {
    // Filtra pelo corte de data (01/01/2025+)
    const filtrados = enriquecidos.filter(r =>
      r.data_venda && r.data_venda >= HISTORICO_DATA_CORTE
    );

    // Resolve cliente_id por documento (busca em lote)
    const documentos = [...new Set(filtrados.map(r => r.documento_cliente_raw).filter(Boolean))];
    if (documentos.length) {
      const { data: clientes } = await supabase
        .from('lojas_clientes')
        .select('id, documento')
        .in('documento', documentos);
      const docToId = new Map((clientes || []).map(c => [c.documento, c.id]));

      filtrados.forEach(r => {
        r.cliente_id = docToId.get(r.documento_cliente_raw) || null;
      });
    }

    // Upsert por (numero_pedido, loja)
    return upsertEmLotes('lojas_vendas', filtrados, ['numero_pedido', 'loja']);
  }

  if (tipo === 'produtos_semanal') {
    const limpos = enriquecidos.map(r => {
      const { _frase_amigavel, importacao_id, ...resto } = r;
      // pode_oferecer: estoque > 100 (regra do briefing)
      resto.pode_oferecer = (resto.qtd_estoque || 0) > 100;
      resto.motivo_pode_oferecer = resto.pode_oferecer ? 'estoque' : null;
      resto.ultima_atualizacao = new Date().toISOString();
      return resto;
    });
    return upsertEmLotes('lojas_produtos', limpos, 'ref');
  }

  if (tipo.startsWith('sacola')) {
    // Resolve cliente_id por documento (busca em lote)
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

    // Upsert por (numero_pedido, loja). MAS: pedidos que NÃO estão no PDF
    // atual (foram fechados/cancelados) precisam ser marcados como inativos.
    // Estratégia:
    //   1. Marca todos os pedidos da loja como ativo=false (preliminar)
    //   2. Faz upsert (que vai re-ativar os que estão no PDF)
    //
    // Faz isso ANTES do upsert pra evitar race condition.

    const loja = enriquecidos[0]?.loja;
    if (loja) {
      await supabase
        .from('lojas_pedidos_sacola')
        .update({ ativo: false, fechado_em: new Date().toISOString() })
        .eq('loja', loja)
        .eq('ativo', true);
    }

    // Re-upsert dos que estão no PDF (volta pra ativo)
    enriquecidos.forEach(r => { r.ativo = true; r.fechado_em = null; });
    return upsertEmLotes('lojas_pedidos_sacola', enriquecidos, ['numero_pedido', 'loja']);
  }

  if (tipo.startsWith('relatorio_bi')) {
    // Resolve cliente_id e venda_id por documento + numero_pedido (busca em lote)
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
      // Busca pedidos da MESMA loja pra evitar conflito de numero_pedido
      // (numero_pedido + loja é único)
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

    // Upsert por (numero_pedido, loja, sku). Re-importação substitui.
    return upsertEmLotes('lojas_vendas_itens', enriquecidos, ['numero_pedido', 'loja', 'sku']);
  }

  throw new Error(`Tipo sem rota de upsert: ${tipo}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// UPSERT EM LOTES
// ═══════════════════════════════════════════════════════════════════════════

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

  // Supabase upsert não diferencia inseridos vs atualizados de forma confiável.
  // Reportamos tudo como "inseridos" (na prática é "afetados").
  return { inseridos, atualizados: 0 };
}
