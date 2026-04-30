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

    // Detector de arquivo truncado (decisao Ailson 28/04/2026):
    // Se admin abre CSV no Sheets mobile, ele pode truncar e salvar so as
    // linhas visiveis na tela. Aconteceu com vendas_clientes_br (de 6000+
    // pra 132). Aviso (nao bloqueio) quando arquivo vier suspeitamente
    // pequeno comparado ao ultimo import bem-sucedido do MESMO tipo.
    try {
      const { data: ultimoSucesso } = await supabase
        .from('lojas_importacoes')
        .select('registros_total')
        .eq('tipo', tipoInfo.tipo)
        .eq('status', 'sucesso')
        .gt('registros_total', 0)
        .order('iniciado_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultimoSucesso?.registros_total
          && parseResult.total < ultimoSucesso.registros_total * 0.5) {
        console.warn(
          `⚠️ ${arq.name} veio com ${parseResult.total} linhas — ` +
          `ultimo import tinha ${ultimoSucesso.registros_total}. ` +
          `Possivel truncamento (Sheets mobile?). Verifique antes de confiar nos dados.`
        );
      }
    } catch { /* nao bloqueia se a checagem falhar */ }

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

// ═══════════════════════════════════════════════════════════════════════════
// BACKFILL DE TELEFONE — fallback do WhatsApp do histórico
// ═══════════════════════════════════════════════════════════════════════════
//
// Decisão Ailson 28/04/2026: planilha cadastro_clientes_futura nem sempre tem
// telefone preenchido. Quando vendedora abre o app e clica em "ligar pra X",
// fica sem opção. Solução: aproveitar o campo WHATSAPP da planilha
// relatorio_vendas_historico (ST e BR) — a coluna existe nas vendas e o
// próprio Mire registra esse número.
//
// Como funciona:
//   1. Após upsert de vendas_historico (ST ou BR), pega TODOS os clientes
//      desse lote que tinham WhatsApp preenchido.
//   2. Pra cada cliente, query no Supabase: tem telefone_principal? Não.
//   3. Usa o WhatsApp mais recente (1ª linha do lote tem data desc, normal-
//      mente é a venda mais nova) como telefone_principal, marca origem
//      'historico' pra rastreabilidade.
//   4. Se já tem telefone, NÃO sobrescreve.
//
// Idempotente: toda vez que histórico é importado, o backfill verifica o
// que mudou.
//
// ═══════════════════════════════════════════════════════════════════════════

async function backfillTelefoneClientes(registrosVendas) {
  // Pega o WhatsApp mais recente por cliente_id (registros já vêm ordenados
  // por data desc no CSV do histórico — primeira ocorrência = mais recente)
  const whatsappPorCliente = new Map();
  for (const r of registrosVendas) {
    if (!r.cliente_id || !r.cliente_whatsapp_raw) continue;
    const limpo = String(r.cliente_whatsapp_raw).replace(/\D/g, '');
    // Aceita só telefones válidos: 10 (fixo) ou 11 (celular) dígitos
    if (limpo.length !== 10 && limpo.length !== 11) continue;
    if (!whatsappPorCliente.has(r.cliente_id)) {
      whatsappPorCliente.set(r.cliente_id, limpo);
    }
  }

  if (whatsappPorCliente.size === 0) {
    return { backfill_clientes: 0 };
  }

  // Busca quais desses clientes ainda NÃO têm telefone_principal (particionado)
  const ids = Array.from(whatsappPorCliente.keys());
  const clientesSemTel = await selectInBatches('lojas_clientes', 'id', ids, {
    select: 'id, telefone_principal',
    extraFilters: q => q.or('telefone_principal.is.null,telefone_principal.eq.'),
  });

  const idsParaAtualizar = clientesSemTel.map(c => c.id);
  if (idsParaAtualizar.length === 0) {
    return { backfill_clientes: 0 };
  }

  // Atualiza um por um (Supabase não tem update em batch com valores diferentes
  // sem upsert, e não queremos sobrescrever as outras colunas do cliente).
  // Pra performance: faz Promise.all de até 50 em paralelo.
  let atualizados = 0;
  const lotes = [];
  for (let i = 0; i < idsParaAtualizar.length; i += 50) {
    lotes.push(idsParaAtualizar.slice(i, i + 50));
  }
  for (const lote of lotes) {
    await Promise.all(lote.map(async (clienteId) => {
      const wpp = whatsappPorCliente.get(clienteId);
      if (!wpp) return;
      const { error } = await supabase
        .from('lojas_clientes')
        .update({
          telefone_principal: wpp,
          telefone_principal_origem: 'historico',
          telefone_principal_valido: true,
        })
        .eq('id', clienteId)
        .or('telefone_principal.is.null,telefone_principal.eq.'); // double-check
      if (!error) atualizados++;
    }));
  }

  console.log(`[backfill_telefone] ${atualizados} clientes ganharam telefone do histórico`);
  return { backfill_clientes: atualizados };
}

// ═══════════════════════════════════════════════════════════════════════════
// BACKFILL DE VENDEDORA A PARTIR DO HISTÓRICO DE VENDAS
// ═══════════════════════════════════════════════════════════════════════════
//
// Decisão Ailson 30/04/2026: o agregado relatorio_vendas_clientes_*.csv
// (planilha pequena que ATRIBUI vendedora) está truncado/incompleto. Mas
// o histórico granular (relatorio_vendas_*_historico.csv) tem 15k+ vendas
// COM coluna VENDEDOR preenchida em cada uma. O parser do histórico já
// resolve a vendedora_id por venda — só faltava propagar pra lojas_clientes.
//
// Como funciona:
//   1. Após upsert de vendas_historico, agrega por cliente_id contando
//      ocorrências de cada vendedora_id nas vendas dele
//   2. Pega a VENDEDORA DOMINANTE (mais vendas) de cada cliente
//   3. Pra cada cliente que TEM cliente_id e AINDA NÃO tem vendedora_id
//      em lojas_clientes (vendedor_a_definir=true), atribui a dominante
//   4. Marca fonte_atribuicao='vendedora_dominante_historico' pra rastrear
//
// Idempotente: roda toda vez que histórico é importado.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: SELECT IN(...) PARTICIONADO
// ═══════════════════════════════════════════════════════════════════════════
//
// PostgREST retorna Bad Request quando o IN tem muitos itens (URL > 2KB,
// roughly 500-1000 ids). Erro silencioso quando o caller nao trata error
// corretamente. Este helper particiona em lotes de 200 e agrega resultados.
//
// Uso:
//   const rows = await selectInBatches('lojas_clientes', 'id', ids, { select: 'id, documento' });
//   const rows = await selectInBatches('lojas_clientes', 'documento', docs, {
//     select: 'id, documento, vendedora_id',
//     extraFilters: q => q.is('vendedora_id', null)
//   });

async function selectInBatches(tabela, coluna, valores, opts = {}) {
  const { select = '*', extraFilters = null, tamanhoLote = 200 } = opts;
  if (!valores?.length) return [];
  const todos = [];
  for (let i = 0; i < valores.length; i += tamanhoLote) {
    const lote = valores.slice(i, i + tamanhoLote);
    let q = supabase.from(tabela).select(select).in(coluna, lote);
    if (extraFilters) q = extraFilters(q);
    const { data, error } = await q;
    if (error) {
      console.error(`[selectInBatches] ${tabela}.${coluna} lote ${i}:`, error.message);
      continue;
    }
    todos.push(...(data || []));
  }
  return todos;
}

async function backfillVendedoraClientes(registrosVendas) {
  // Conta vendedora_id por cliente_id (só vendas que tem cliente_id resolvido
  // E vendedora_id resolvida pelo parser)
  // REGRA (decisão Ailson 30/04/2026): vendedora da ÚLTIMA venda (mais recente)
  // vence, NÃO a dominante. Razão: ex-vendedoras (REGILANIA, KELLY) foram
  // absorvidas pela Joelma. Se cliente comprou 5x com REGILANIA e depois 1x
  // com CARINA (Cleide atual), a CARINA herda. Dominante daria pra Joelma
  // por causa do histórico antigo, errado pra atribuição atual.
  //
  // Como pegamos a última: mantemos só a vendedora_id da venda com data_venda
  // MAIS ALTA por cliente. registrosVendas pode chegar em qualquer ordem,
  // então ordenamos.
  const ultimaPorCliente = new Map();  // cliente_id → { vendedora_id, data }
  for (const v of registrosVendas) {
    if (!v.cliente_id || !v.vendedora_id || !v.data_venda) continue;
    const atual = ultimaPorCliente.get(v.cliente_id);
    if (!atual || v.data_venda > atual.data) {
      ultimaPorCliente.set(v.cliente_id, { vendedora_id: v.vendedora_id, data: v.data_venda });
    }
  }

  if (ultimaPorCliente.size === 0) return { backfill_vendedora: 0 };

  // Map cliente_id → vendedora_id da última venda
  const dominantePorCliente = new Map();
  for (const [cid, info] of ultimaPorCliente) {
    dominantePorCliente.set(cid, info.vendedora_id);
  }

  // Busca quais desses clientes AINDA não têm vendedora atribuida (particionado)
  const ids = Array.from(dominantePorCliente.keys());
  const semVendedoraTodos = await selectInBatches('lojas_clientes', 'id', ids, {
    select: 'id, loja_origem',
    extraFilters: q => q.is('vendedora_id', null),
  });
  const idsParaAtualizar = semVendedoraTodos.map(c => c.id);
  if (idsParaAtualizar.length === 0) return { backfill_vendedora: 0 };

  // Busca a loja de cada vendedora (pra setar loja_origem também)
  const vendedoraIds = [...new Set(idsParaAtualizar.map(id => dominantePorCliente.get(id)))];
  const vends = await selectInBatches('lojas_vendedoras', 'id', vendedoraIds, {
    select: 'id, loja',
  });
  const vendIdToLoja = new Map(vends.map(v => [v.id, v.loja]));

  // Atualiza em lote (uma por uma porque cada cliente pode ter vendedora diferente)
  let atualizados = 0;
  await Promise.all(idsParaAtualizar.map(async clienteId => {
    const vid = dominantePorCliente.get(clienteId);
    const loja = vendIdToLoja.get(vid);
    const { error } = await supabase
      .from('lojas_clientes')
      .update({
        vendedora_id: vid,
        loja_origem: loja,
        vendedor_a_definir: false,
        fonte_atribuicao: 'vendedora_dominante_historico',
        data_atribuicao: new Date().toISOString(),
      })
      .eq('id', clienteId)
      .is('vendedora_id', null);  // double-check pra evitar sobrescrita
    if (!error) atualizados++;
  }));

  console.log(`[backfill_vendedora] ${atualizados} clientes ganharam vendedora dominante do histórico`);
  return { backfill_vendedora: atualizados };
}

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
    const dedupados = Array.from(dedup.values());

    // ⚠️ PROTECAO ANTI-SOBRESCRITA (descoberta Ailson 30/04/2026):
    // Trigger Drive importa cadastro_clientes_futura POR ULTIMO. O upsert
    // ON CONFLICT (documento) DO UPDATE estava sobrescrevendo TODOS os campos,
    // incluindo vendedora_id, loja_origem, fonte_atribuicao, canal_cadastro
    // etc — apagando o que vendas_clientes_st/br ja tinha gravado. Resultado:
    // 5503 clientes ficaram com vendedora_id=null mesmo quando o agregado
    // tinha atribuido vendedora.
    //
    // Solucao: pra cada documento, busca o cliente existente. Se ja existe,
    // remove os campos sensiveis (vendedora_id, loja_origem, etc) do payload
    // para nao sobrescrever. Inserts novos vao com tudo.
    const documentos = dedupados.map(r => r.documento);
    const existentes = await selectInBatches('lojas_clientes', 'documento', documentos, {
      select: 'documento, vendedora_id, loja_origem, sistema_origem, fonte_atribuicao, vendedor_a_definir, data_atribuicao, canal_cadastro, telefone_principal, telefone_principal_origem, apelido, comprador_nome',
    });
    const existeMap = new Map(existentes.map(c => [c.documento, c]));

    const protegidos = dedupados.map(r => {
      const ja = existeMap.get(r.documento);
      if (!ja) return r;  // novo cliente, vai com tudo

      // Cliente JA existe: remove campos sensiveis (mantém o que ja tem)
      // e tambem remove campos que cadastro_futura nao tem que preencher
      // se outro parser ja preencheu (telefone, apelido).
      const protegido = { ...r };
      // Vendedora e atribuicao
      delete protegido.vendedora_id;
      delete protegido.loja_origem;
      delete protegido.sistema_origem;
      delete protegido.fonte_atribuicao;
      delete protegido.vendedor_a_definir;
      delete protegido.data_atribuicao;
      // Canal/grupo (preservar marcacao Vesti/Convertr)
      if (ja.canal_cadastro && ja.canal_cadastro !== 'fisico') {
        delete protegido.canal_cadastro;
      }
      // Telefone (so preenche se vazio)
      if (ja.telefone_principal) {
        delete protegido.telefone_principal;
        delete protegido.telefone_principal_origem;
        delete protegido.telefone_principal_valido;
      }
      // Apelido/comprador (só sobrescreve se cadastro tem)
      if (ja.apelido) delete protegido.apelido;
      if (ja.comprador_nome) delete protegido.comprador_nome;
      return protegido;
    });

    return upsertEmLotes('lojas_clientes', protegidos, 'documento');
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

    // Buscar IDs por documento (em lote pra não fazer N queries) — particionado
    const documentos = enriquecidos.map(r => r.documento);
    const clientes = await selectInBatches('lojas_clientes', 'documento', documentos, {
      select: 'id, documento',
    });
    const docToId = new Map(clientes.map(c => [c.documento, c.id]));

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

    // Resolve cliente_id por documento (busca em lote, particionado pra evitar
    // Bad Request do PostgREST com IN > 1000 itens — bug descoberto Ailson
    // 30/04/2026 que silenciosamente quebrava o backfill de vendedora).
    const documentos = [...new Set(filtrados.map(r => r.documento_cliente_raw).filter(Boolean))];
    if (documentos.length) {
      const clientes = await selectInBatches('lojas_clientes', 'documento', documentos, {
        select: 'id, documento',
      });
      const docToId = new Map(clientes.map(c => [c.documento, c.id]));

      filtrados.forEach(r => {
        r.cliente_id = docToId.get(r.documento_cliente_raw) || null;
      });
    }

    // Upsert por (numero_pedido, loja)
    const stats = await upsertEmLotes('lojas_vendas', filtrados, ['numero_pedido', 'loja']);

    // ─── BACKFILL DE TELEFONE A PARTIR DO WHATSAPP DO HISTÓRICO ─────────
    // Decisão Ailson 28/04/2026: quando cliente não tem telefone_principal
    // em lojas_clientes (planilha cadastro_clientes_futura veio sem ele),
    // usa o WHATSAPP da venda mais recente do histórico (ST ou BR) como
    // fallback. Isso roda toda vez que histórico é importado (idempotente).
    await backfillTelefoneClientes(filtrados);

    // ─── BACKFILL DE VENDEDORA A PARTIR DO HISTÓRICO ────────────────────
    // Decisão Ailson 30/04/2026: agregado vendas_clientes está truncado.
    // Pra cada cliente sem vendedora, usa a vendedora dominante do histórico.
    await backfillVendedoraClientes(filtrados);

    return stats;
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
      const clientes = await selectInBatches('lojas_clientes', 'documento', documentos, {
        select: 'id, documento',
      });
      const docToId = new Map(clientes.map(c => [c.documento, c.id]));

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
      const clientes = await selectInBatches('lojas_clientes', 'documento', documentos, {
        select: 'id, documento',
      });
      docToClienteId = new Map(clientes.map(c => [c.documento, c.id]));
    }

    if (pedidos.length) {
      // Busca pedidos da MESMA loja pra evitar conflito de numero_pedido
      const loja = enriquecidos[0]?.loja;
      const vendas = await selectInBatches('lojas_vendas', 'numero_pedido', pedidos, {
        select: 'id, numero_pedido, vendedora_id',
        extraFilters: q => q.eq('loja', loja),
      });
      pedidoToVendaId = new Map(vendas.map(v => [v.numero_pedido, v.id]));
      pedidoToVendedoraId = new Map(vendas.map(v => [v.numero_pedido, v.vendedora_id]));
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
