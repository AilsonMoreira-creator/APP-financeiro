/**
 * lojas-drive-parsers.js — Parsers especializados por tipo de arquivo do Drive.
 *
 * Cada parser:
 *   1. Recebe o conteúdo bruto + metadata
 *   2. Aplica regras de negócio (filtro varejo, normalização, alias de vendedora)
 *   3. Retorna { registros, ignorados, detalhes_ignorados } pronto pra upsert
 *
 * Não chama Supabase diretamente — só transforma dados. O orquestrador
 * (lojas-drive-importar.js) que faz o upsert.
 *
 * Helpers usados:
 *   - parseCSV, parseNumeroBR, parseDataBR, normalizarDocumento, tipoDocumento, limparTexto
 *   - refSemZero, normalizarTelefone, escolherTelefone, ehVendaVarejo,
 *     resolverVendedora, detectarClienteSinalizado, importarApelidoComprador,
 *     classificarPedidoSacola, calcularDiasSacola, categorizarPagamento,
 *     calcularJanelaNovidade, construirFraseProduto
 */

import {
  parseCSV, parseNumeroBR, parseDataBR, limparTexto,
  normalizarDocumento, tipoDocumento,
} from './_lojas-drive-helpers.js';

import {
  refSemZero,
  refFromSku,
  normalizarTelefone,
  escolherTelefone,
  ehVendaVarejo,
  resolverVendedora,
  detectarClienteSinalizado,
  importarApelidoComprador,
  classificarPedidoSacola,
  calcularDiasSacola,
  categorizarPagamento,
  calcularJanelaNovidade,
  construirFraseProduto,
} from './lojas-helpers-business.js';

// ═══════════════════════════════════════════════════════════════════════════
// PARSER 1: cadastro_clientes_futura.csv
// ═══════════════════════════════════════════════════════════════════════════
//
// Colunas: Código, Razão Social, Fantasia, Fone, Celular, Cidade, CPF/CNPJ, UF
// Esse arquivo é GLOBAL (toda história das 2 lojas, sem distinção).
// Sem coluna de vendedora — fica null aqui (vendedora vem do relatorio_clientes).
//
// Regras:
//   - Fantasia preenchido → razao_social do cadastro = Fantasia
//   - Razão Social = nome_fantasia secundário (pra documentos fiscais)
//   - Fone tem celulares de 11 dígitos modernos → usar como telefone principal
//   - Detecta sinalização ("***GOOOOL***") via detectarClienteSinalizado
//
// ═══════════════════════════════════════════════════════════════════════════

export function parseCadastroClientesFutura(conteudo) {
  const linhas = parseCSV(conteudo);
  const registros = [];
  const detalhes_ignorados = { documento_invalido: 0, sinalizado: 0 };

  for (const l of linhas) {
    const docRaw = l['CPF/CNPJ'];
    const documento = normalizarDocumento(docRaw);
    const tipo_doc = tipoDocumento(docRaw);

    // Sem documento válido → ignora
    if (!documento || !tipo_doc) {
      detalhes_ignorados.documento_invalido++;
      continue;
    }

    const razao = limparTexto(l['Razão Social']) || limparTexto(l['Fantasia']) || '(sem nome)';
    const fantasia = limparTexto(l['Fantasia']);
    const fone = limparTexto(l['Fone']);
    const celular = limparTexto(l['Celular']);
    const cidade = limparTexto(l['Cidade']);
    const uf = limparTexto(l['UF']);
    const codigo_futura = limparTexto(l['Código']);

    // Telefone principal (cascata Celular > Fone — coluna "Celular" é mais recente)
    const tel = escolherTelefone({ celular, fone });

    // Detecta cliente sinalizada
    const sinal = detectarClienteSinalizado(razao, fantasia);

    registros.push({
      documento,
      tipo_documento: tipo_doc,
      razao_social: razao,
      nome_fantasia: fantasia,
      apelido: null,
      comprador_nome: null,
      telefone_principal: tel?.numero || null,
      telefone_principal_origem: tel?.origem || null,
      telefone_principal_valido: tel?.valido || false,
      telefone_brutos: { fone, celular },
      endereco_cidade: cidade,
      endereco_uf: uf,
      sistema_origem: 'futura',
      id_cliente_mire: codigo_futura,
      canal_cadastro: 'fisico',
      // vendedora_id e loja_origem ficam null aqui — são preenchidos pelo
      // parser de vendas_clientes (que tem essa info)
      vendedora_id: null,
      loja_origem: null,
      vendedor_a_definir: true,
      observacao: sinal.flagado ? `⚠️ SINALIZADA: ${sinal.palavra}` : null,
    });

    if (sinal.flagado) detalhes_ignorados.sinalizado++;
  }

  return {
    registros,
    total: linhas.length,
    ignorados: linhas.length - registros.length,
    detalhes_ignorados,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER 2: relatorio_vendas_clientes_st.csv / _br.csv
// ═══════════════════════════════════════════════════════════════════════════
//
// 21 colunas. É a FONTE DE VERDADE pra:
//   - vendedora responsável (coluna VENDEDOR)
//   - tickets, total acumulado, ult_compra
//   - WhatsApp normalizado (já vem só dígitos)
//   - classificação ABC
//
// Regras:
//   - CONSUMIDOR (CNPJ=13/1) → ignora
//   - VENDEDOR vazio → vendedora_id = null (carteira aberta, vendedor_a_definir=true)
//   - VENDEDOR preenchido → resolverVendedora pelos aliases (já trata absorções)
//
// ═══════════════════════════════════════════════════════════════════════════

export function parseRelatorioVendasClientes(conteudo, loja, vendedorasCadastradas) {
  const linhas = parseCSV(conteudo);
  const registros = [];
  const detalhes_ignorados = {
    consumidor: 0,
    documento_invalido: 0,
    sinalizado: 0,
    sem_loja: 0,
  };

  if (!loja) {
    return { registros: [], total: linhas.length, ignorados: linhas.length,
      detalhes_ignorados: { ...detalhes_ignorados, sem_loja: linhas.length } };
  }

  for (const l of linhas) {
    const cliente = limparTexto(l['CLIENTE']);
    const docRaw = l['CNPJ/CPF'];

    // Filtro de varejo (CONSUMIDOR, doc 13/1, etc)
    const filtro = ehVendaVarejo(cliente, docRaw, l['VENDEDOR']);
    if (filtro.ignorar) {
      if (filtro.motivo === 'varejo_nome' || filtro.motivo === 'documento_placeholder') {
        detalhes_ignorados.consumidor++;
      } else {
        detalhes_ignorados.documento_invalido++;
      }
      continue;
    }

    const documento = normalizarDocumento(docRaw);
    const tipo_doc = tipoDocumento(docRaw);
    if (!documento || !tipo_doc) {
      detalhes_ignorados.documento_invalido++;
      continue;
    }

    // Resolve vendedora (já cuida de aliases, absorção, padrão por loja)
    const vendedoraNome = limparTexto(l['VENDEDOR']);
    const vendedora = resolverVendedora(vendedoraNome, loja, vendedorasCadastradas);

    // Telefones (ddd + fone/celular/whatsapp)
    const ddd = limparTexto(l['DDD']);
    const fone = limparTexto(l['FONE']);
    const celular = limparTexto(l['CELULAR']);
    const whatsapp = limparTexto(l['WHATSAPP']);
    const tel = escolherTelefone({ ddd, fone, celular, whatsapp });

    const sinal = detectarClienteSinalizado(cliente, null);

    registros.push({
      // identificação
      documento,
      tipo_documento: tipo_doc,
      razao_social: cliente,
      nome_fantasia: null,
      apelido: limparTexto(l['COMPRADOR']),
      comprador_nome: importarApelidoComprador(l['COMPRADOR']),

      // contato
      telefone_principal: tel?.numero || null,
      telefone_principal_origem: tel?.origem || null,
      telefone_principal_valido: tel?.valido || false,
      telefone_brutos: { ddd, fone, celular, whatsapp },
      email: limparTexto(l['EMAIL']),
      instagram: limparTexto(l['INSTAGRAM']),

      // localização
      endereco_cidade: limparTexto(l['CIDADE']),
      endereco_uf: limparTexto(l['UF']),

      // origem e atribuição
      loja_origem: loja,
      sistema_origem: 'mire',
      vendedora_id: vendedora?.id || null,
      vendedora_nome: vendedora?.nome || null,           // pra log
      vendedor_a_definir: !vendedoraNome || !vendedora,  // sinalize aberto se sem nome
      fonte_atribuicao: 'relatorio_vendas_clientes',
      data_atribuicao: new Date().toISOString(),

      // dados agregados (vão pra lojas_clientes_kpis)
      _kpis: {
        qtd_compras: parseInt(l['TICKETS']) || 0,
        qtd_pecas: Math.round(parseNumeroBR(l['QTDE']) || 0),
        lifetime_total: parseNumeroBR(l['TOTAL']) || 0,
        primeira_compra: parseDataBR(l['CLIENTE DESDE']),
        ultima_compra: parseDataBR(l['ULT COMPRA']),
        classificacao_abc: limparTexto(l['ABC']),  // coluna nova adicionada via migration
      },

      observacao: sinal.flagado ? `⚠️ SINALIZADA: ${sinal.palavra}` : null,
    });

    if (sinal.flagado) detalhes_ignorados.sinalizado++;
  }

  return {
    registros,
    total: linhas.length,
    ignorados: linhas.length - registros.length,
    detalhes_ignorados,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER 3: relatorio_vendas_st_historico.csv / _br.csv
// ═══════════════════════════════════════════════════════════════════════════
//
// 24 colunas. 1 linha = 1 pedido. Esse é o histórico cru, vai pra lojas_vendas.
//
// Regras:
//   - CONSUMIDOR (CNPJ=13/1) → ignora (não tem cliente real pra rastrear)
//   - "#" no início do nome → remove (sem significado)
//   - CUSTO é confiável (Miré calcula automaticamente)
//   - Data corte: 01/01/2025+ (16 meses) — mas o filtro de data é feito pelo
//     orquestrador, parser não filtra
//
// ═══════════════════════════════════════════════════════════════════════════

export function parseRelatorioVendasHistorico(conteudo, loja, vendedorasCadastradas) {
  const linhas = parseCSV(conteudo);
  const registros = [];
  const detalhes_ignorados = {
    consumidor: 0,
    documento_invalido: 0,
    sem_loja: 0,
  };

  if (!loja) {
    return { registros: [], total: linhas.length, ignorados: linhas.length,
      detalhes_ignorados: { ...detalhes_ignorados, sem_loja: linhas.length } };
  }

  for (const l of linhas) {
    let cliente = limparTexto(l['CLIENTE']);
    if (cliente && cliente.startsWith('# ')) cliente = cliente.substring(2).trim();

    const docRaw = l['CNPJ/CPF'];
    const filtro = ehVendaVarejo(cliente, docRaw, l['VENDEDOR']);
    if (filtro.ignorar) {
      if (filtro.motivo === 'varejo_nome' || filtro.motivo === 'documento_placeholder') {
        detalhes_ignorados.consumidor++;
      } else {
        detalhes_ignorados.documento_invalido++;
      }
      continue;
    }

    const documento = normalizarDocumento(docRaw);
    if (!documento) {
      detalhes_ignorados.documento_invalido++;
      continue;
    }

    const numero_pedido = limparTexto(l['PEDIDO']);
    if (!numero_pedido) continue;  // pedido sem número, dado corrompido

    const vendedoraNome = limparTexto(l['VENDEDOR']);
    const vendedora = resolverVendedora(vendedoraNome, loja, vendedorasCadastradas);

    const formaPagamento = limparTexto(l['PAGAMENTO']);
    const categoria_pag = categorizarPagamento(formaPagamento);

    // % desconto: vem como "5%", "15%", "0%"
    let pct_desconto = 0;
    const pctRaw = String(l['%'] || '').replace('%', '').trim();
    pct_desconto = parseNumeroBR(pctRaw) || 0;

    registros.push({
      numero_pedido,
      loja,

      // dados do cliente (raw — orquestrador resolve cliente_id depois)
      documento_cliente_raw: documento,
      cliente_razao_raw: cliente,
      cliente_whatsapp_raw: limparTexto(l['WHATSAPP']),
      cliente_cidade: limparTexto(l['CIDADE']),
      cliente_uf: limparTexto(l['UF']),

      // vendedora
      vendedora_nome_raw: vendedoraNome,
      vendedora_id: vendedora?.id || null,

      // datas
      data_cadastro_cliente: parseDataBR(l['DATA|CADASTRO']),
      data_venda: parseDataBR(l['DATA|FINALIZADO']),
      hora_venda: limparTexto(l['HORA']),

      // valores
      qtd_pecas: Math.round(parseNumeroBR(l['QTDE']) || 0),
      qtd_devolvida: Math.round(parseNumeroBR(l['DEVOL']) || 0),
      valor_bruto: parseNumeroBR(l['TOTAL BRUTO']) || 0,
      valor_devolucao: parseNumeroBR(l['DEVOLUÇÃO']) || 0,
      valor_total: parseNumeroBR(l['TOTAL']) || 0,
      valor_desconto: parseNumeroBR(l['DESCONTO']) || 0,
      pct_desconto,
      valor_liquido: parseNumeroBR(l['LÍQUIDO']) || 0,
      custo_total: parseNumeroBR(l['CUSTO']) || 0,

      // pagamento
      forma_pagamento: formaPagamento,
      forma_pagamento_categoria: categoria_pag,

      // canal e NF
      canal_origem: 'fisico',
      numero_nf: limparTexto(l['NF']),
      marketplace_raw: limparTexto(l['MARKETPLACE']),

      // origem
      loja_origem_raw: limparTexto(l['TERMINAL']),
    });
  }

  return {
    registros,
    total: linhas.length,
    ignorados: linhas.length - registros.length,
    detalhes_ignorados,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER 4: produtos_27.04.2026.csv (semanal)
// ═══════════════════════════════════════════════════════════════════════════
//
// 14 colunas. Catálogo de produtos com vendas acumuladas e estoque atual.
//
// Regras:
//   - REF normalizada (sem zero à esquerda) é a chave
//   - Estoque pode ser negativo (pedidos pré-aprovados) — mantém como vem
//   - Códigos duplicados (01871 vs 1871) viram a mesma linha após normalização
//     → orquestrador faz dedup somando estoques + max preço
//   - DESCRIÇÃO vazia: importa mesmo, com descricao=null
//
// ═══════════════════════════════════════════════════════════════════════════

export function parseProdutos(conteudo) {
  const linhas = parseCSV(conteudo);
  const mapa = new Map();  // refNormalizada → produto agregado

  for (const l of linhas) {
    const codigoRaw = limparTexto(l['CÓDIGO']);
    if (!codigoRaw) continue;

    const ref = refSemZero(codigoRaw);
    if (!ref) continue;

    const descricao = limparTexto(l['DESCRIÇÃO']);
    const categoria = limparTexto(l['CATEGORIA']);
    const preco_inicial = parseNumeroBR(l['PREÇO|INICIAL']);
    const preco_medio = parseNumeroBR(l['PREÇO|MÉDIO']);
    const qtd_total = Math.round(parseNumeroBR(l['QUANTIDADE|TOTAL']) || 0);
    const qtd_devol = Math.round(parseNumeroBR(l['QUANTIDADE|DEVOL']) || 0);
    const qtd_estoque = Math.round(parseNumeroBR(l['QUANTIDADE|ESTOQUE']) || 0);

    // Frase amigável pra IA usar
    const fraseProduto = descricao ? construirFraseProduto(descricao) : null;

    if (mapa.has(ref)) {
      // Dedup: já existe, soma quantidades, mantém maior preço, completa descrição se vazia
      const existente = mapa.get(ref);
      existente.qtd_total_vendida += qtd_total;
      existente.qtd_devolvida += qtd_devol;
      existente.qtd_estoque = Math.max(existente.qtd_estoque, qtd_estoque);
      if (!existente.descricao && descricao) existente.descricao = descricao;
      if (!existente.categoria && categoria) existente.categoria = categoria;
      if (preco_inicial !== null && (!existente.preco_inicial || preco_inicial > existente.preco_inicial)) {
        existente.preco_inicial = preco_inicial;
      }
      if (preco_medio !== null) {
        // Média ponderada simples (não é perfeita mas evita inflar): mantém a maior
        existente.preco_medio = Math.max(existente.preco_medio || 0, preco_medio);
      }
    } else {
      mapa.set(ref, {
        ref,
        ref_original: codigoRaw,
        descricao,
        categoria,
        preco_inicial,
        preco_medio,
        qtd_total_vendida: qtd_total,
        qtd_devolvida: qtd_devol,
        qtd_estoque,
        tem_zero_a_esquerda: codigoRaw !== ref,
        origem_dado: 'mire_relatorio',
        // pode_oferecer: calculado pelo orquestrador (estoque > 100 + outras flags)
        // novidade_*: vem do módulo Oficinas (não é desse arquivo)
        _frase_amigavel: fraseProduto,  // só pra log/debug
      });
    }
  }

  const registros = Array.from(mapa.values());

  return {
    registros,
    total: linhas.length,
    deduped: linhas.length - registros.length,
    ignorados: 0,
    detalhes_ignorados: { codigo_vazio: linhas.length - registros.length - (linhas.length - registros.length) },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PARSER 5: pedidos_espera_st_*.pdf / _br_*.pdf  (PDF tabular)
// ═══════════════════════════════════════════════════════════════════════════
//
// PDF que o Miré gera. Texto é extraível (não é imagem).
//
// VERSÃO 2.0 (28/04/2026): Recebe ESTRUTURA POSICIONADA em vez de texto.
//   Antes: pdf-parse colapsava espaços e quebrava colunas (qtd+devol+total+
//          frete viravam um número gigante e valor_total caía pra 0).
//   Agora: orquestrador chama extrairLinhasPDFComX() (pdfjs-dist com X/Y)
//          e passa Array<Array<{x, text}>>. Parser identifica campos pela
//          NATUREZA (datas dd/mm/aaaa, CNPJ 11-14 dígitos, valores ,nn).
//
// Estrutura: 1 linha de header + N linhas de dados + linha de totais.
// Snapshot atual: cada linha = 1 cliente atualmente em status SEPARANDO_SACOLA.
//
// Regras:
//   - Filtro varejo via ehVendaVarejo (CONSUMIDOR, doc=13, etc)
//   - Sub-tipo via classificarPedidoSacola(dias)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parseia uma única linha (array de items {x, text}) e retorna campos
 * estruturados, ou null se não for linha de pedido válida.
 */
function _parseLinhaPedidoEspera(itens) {
  // Items vêm ordenados por x mas garantimos
  const its = itens
    .slice()
    .sort((a, b) => a.x - b.x)
    .map(i => i.text.trim())
    .filter(Boolean);
  if (its.length < 5) return null;

  const f = {};
  let i = 0;

  // 1. Pedido = primeiro item, deve ser numérico 4-7 dígitos
  if (!/^\d{4,7}$/.test(its[i])) return null;
  f.pedido = its[i++];

  // 2. Cliente (+ fantasia opcional) até CNPJ.
  //    CNPJ pode estar puro OU colado no fim do nome (PDFs do Miré fazem isso).
  const partesNome = [];
  let cnpjEncontrado = false;
  while (i < its.length) {
    const t = its[i];
    if (/^\d{11,14}$/.test(t)) {
      f.cnpj = t;
      i++;
      cnpjEncontrado = true;
      break;
    }
    const colado = t.match(/^(.+?)\s+(\d{11,14})$/);
    if (colado) {
      partesNome.push(colado[1]);
      f.cnpj = colado[2];
      i++;
      cnpjEncontrado = true;
      break;
    }
    partesNome.push(t);
    i++;
  }
  if (!cnpjEncontrado) return null;
  f.cliente_raw = partesNome.join(' ').trim();

  // 3. Valores até primeira data (qtde, devol, total, frete em ordem)
  const valoresPreData = [];
  while (i < its.length && !/^\d{2}\/\d{2}\/\d{4}/.test(its[i])) {
    valoresPreData.push(its[i++]);
  }

  // Atribuição por TIPO (mais robusto que ordem posicional):
  //   - monetários têm formato ",dd" no fim: total e frete
  //   - inteiros até 5 dígitos: qtde e devol
  //     (limite 5 dígitos descarta CPF/CNPJ secundário que cliente possa ter)
  const monetarios = valoresPreData.filter(v => /,\d{2}$/.test(v));
  const inteiros = valoresPreData.filter(v => /^\d{1,5}$/.test(v));

  f.qtd_pecas = parseInt(inteiros[0], 10) || 0;
  // devol = inteiros[1] — não usamos hoje
  f.valor_total = parseNumeroBR(monetarios[0]) || 0;
  // frete = monetarios[1] — não armazenado hoje

  // 4. Datas (cadastro pode vir colado com atualizado)
  if (i < its.length && /^\d{2}\/\d{2}\/\d{4}/.test(its[i])) {
    const m = its[i].match(/(\d{2}\/\d{2}\/\d{4})\s*(\d{2}\/\d{2}\/\d{4})?/);
    if (m) {
      const [d, mes, ano] = m[1].split('/');
      f.data_cadastro_sacola = parseDataBR(`${d}/${mes}/${ano}`);
      if (m[2]) {
        const [d2, mes2, ano2] = m[2].split('/');
        f.data_ultima_atualizacao = parseDataBR(`${d2}/${mes2}/${ano2}`);
      }
    }
    i++;
  }
  if (i < its.length && /^\d{2}\/\d{2}\/\d{4}$/.test(its[i])) {
    if (!f.data_ultima_atualizacao) {
      const [d, mes, ano] = its[i].split('/');
      f.data_ultima_atualizacao = parseDataBR(`${d}/${mes}/${ano}`);
    }
    i++;
  }
  if (!f.data_ultima_atualizacao) f.data_ultima_atualizacao = f.data_cadastro_sacola;

  // 5. Hora hh:mm:ss
  if (i < its.length && /^\d{2}:\d{2}:\d{2}$/.test(its[i])) {
    f.hora = its[i++];
  }

  // 6. Vendedor: blocos de texto ALL-CAPS consecutivos
  const partesVendedor = [];
  while (i < its.length && /^[A-ZÁÃÀÉÊÍÓÔÕÚÇ ]{3,}$/.test(its[i])) {
    partesVendedor.push(its[i++]);
  }
  f.vendedor_nome_raw = partesVendedor.join(' ').trim();

  return f;
}

/**
 * @param {Array<Array<{x:number, text:string}>>} linhasComX  Saída de extrairLinhasPDFComX()
 * @param {string} loja                                       'Bom Retiro' | 'Silva Teles'
 * @param {Array} vendedorasCadastradas                       lista pra resolver vendedora_id
 * @param {string|null} hoje                                  override pra testes (ISO date)
 */
export function parsePedidosEspera(linhasComX, loja, vendedorasCadastradas, hoje = null) {
  const detalhes_ignorados = {
    sem_loja: 0,
    consumidor: 0,
    documento_invalido: 0,
    parse_falhou: 0,
    sem_valor: 0,
  };

  if (!Array.isArray(linhasComX) || linhasComX.length === 0) {
    return { registros: [], total: 0, ignorados: 0, detalhes_ignorados };
  }

  if (!loja) {
    return {
      registros: [],
      total: linhasComX.length,
      ignorados: linhasComX.length,
      detalhes_ignorados: { ...detalhes_ignorados, sem_loja: linhasComX.length },
    };
  }

  const registros = [];
  let totalLinhasPedido = 0;

  for (const itens of linhasComX) {
    // Só linhas que começam com pedido (número 4-7 dígitos numa posição inicial)
    const primeiroItem = itens.slice().sort((a, b) => a.x - b.x)[0];
    if (!primeiroItem || !/^\d{4,7}$/.test(primeiroItem.text.trim())) continue;
    totalLinhasPedido++;

    const parsed = _parseLinhaPedidoEspera(itens);
    if (!parsed) {
      detalhes_ignorados.parse_falhou++;
      continue;
    }

    // Filtro varejo (CONSUMIDOR, doc=13, etc)
    const filtro = ehVendaVarejo(parsed.cliente_raw, parsed.cnpj, '');
    if (filtro.ignorar) {
      if (filtro.motivo === 'varejo_nome' || filtro.motivo === 'documento_placeholder') {
        detalhes_ignorados.consumidor++;
      } else {
        detalhes_ignorados.documento_invalido++;
      }
      continue;
    }

    // Resolve vendedora pelo nome
    const vendedora = resolverVendedora(parsed.vendedor_nome_raw, loja, vendedorasCadastradas);

    // Calcula dias em sacola + sub-tipo
    const dias = calcularDiasSacola(parsed.data_cadastro_sacola, hoje);
    const subtipo_sugerido = dias != null ? classificarPedidoSacola(dias) : null;

    // ALARME: valor 0 é bug do parser, NÃO acontece na realidade
    // (toda sacola tem peças com preço cadastrado no Miré)
    if (parsed.valor_total <= 0) {
      detalhes_ignorados.sem_valor++;
      console.warn(
        `[parsePedidosEspera] SACOLA SEM VALOR (bug parser?): pedido=${parsed.pedido} ` +
        `qtd=${parsed.qtd_pecas} cliente="${parsed.cliente_raw}" doc=${parsed.cnpj}`
      );
      // Continua e salva mesmo assim — orçamento conhecer o problema
    }

    registros.push({
      numero_pedido: parsed.pedido,
      loja,
      documento_raw: parsed.cnpj,
      vendedor_nome_raw: parsed.vendedor_nome_raw,
      vendedora_id: vendedora?.id || null,

      data_cadastro_sacola: parsed.data_cadastro_sacola,
      data_ultima_atualizacao: parsed.data_ultima_atualizacao,
      hora: parsed.hora || null,

      qtd_pecas: parsed.qtd_pecas,
      valor_total: parsed.valor_total,

      status: 'aberto',
      ativo: true,
      subtipo_sugerido,
    });
  }

  return {
    registros,
    total: totalLinhasPedido,
    ignorados: totalLinhasPedido - registros.length,
    detalhes_ignorados,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// PARSER 6: relatorio_bi_st_*.xlsx / _br_*.xlsx (semanal a partir de 03/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// Origem: planilha "RELATÓRIO PARA BI" do Mire — 1 linha = 1 SKU vendido.
// Decisão Ailson 28/04/2026: alimentar 1x/semana, mesma cadência das outras.
// Dados disponíveis desde 01/03/2026.
//
// Colunas relevantes (Mire pode variar nomes — usamos fallbacks):
//   Pedido, Data Cadastro, Status, Data Pago, Nº NF, CNPJ/CPF, Nome,
//   Desconto, Frete, Líquido,
//   ID Produto, SKU, Descrição, Qtde, Frete Item, Custo, Preço,
//   Desconto (item), Líquido (item),
//   # Pedido Site, Rastreamento, UF, Forma de Pagamento, Prazo, Parcela
//
// REGRAS:
//   - Status diferente de FATURADO → ignora (rascunho, cancelado etc)
//   - CONSUMIDOR / CNPJ '13' → ignora (varejo balcão)
//   - SKU vazio ou < 4 dígitos → ignora (item sem cadastro)
//   - REF extraída via refFromSku() (regra 4 dígitos com 4 exceções)
//   - Dedup natural por (numero_pedido + loja + sku) na DB
//
// Diferente de outros parsers, esse RECEBE LINHAS já parseadas (do parseXLSX),
// não precisa decodificar CSV. Recebe um array de objetos.
//
// ═══════════════════════════════════════════════════════════════════════════

// Lê valor de coluna tentando vários nomes alternativos (Mire varia capitalização).
function _col(linha, ...nomes) {
  for (const n of nomes) {
    if (linha[n] !== undefined && linha[n] !== '') return linha[n];
  }
  return null;
}

export function parseRelatorioBI(linhasObj, loja, vendedorasCadastradas) {
  const registros = [];
  const detalhes_ignorados = {
    nao_faturado: 0,
    consumidor: 0,
    documento_invalido: 0,
    sku_invalido: 0,
    ref_invalida: 0,
    sem_loja: 0,
    sem_data: 0,
  };

  if (!loja) {
    return {
      registros: [],
      total: linhasObj.length,
      ignorados: linhasObj.length,
      detalhes_ignorados: { ...detalhes_ignorados, sem_loja: linhasObj.length },
    };
  }

  if (!Array.isArray(linhasObj)) {
    return {
      registros: [],
      total: 0,
      ignorados: 0,
      detalhes_ignorados,
    };
  }

  for (const l of linhasObj) {
    // 1) Filtro por Status: só FATURADO entra
    const status = String(_col(l, 'Status', 'STATUS', 'status') || '').trim().toUpperCase();
    if (status && status !== 'FATURADO') {
      detalhes_ignorados.nao_faturado++;
      continue;
    }

    // 2) Filtro varejo (consumidor / cnpj placeholder)
    const cliente = limparTexto(_col(l, 'Nome', 'NOME', 'CLIENTE'));
    const docRaw = _col(l, 'CNPJ/CPF', 'CNPJ', 'CPF');
    const filtro = ehVendaVarejo(cliente, docRaw, '');  // sem vendedor nessa planilha
    if (filtro.ignorar) {
      if (filtro.motivo === 'varejo_nome' || filtro.motivo === 'documento_placeholder') {
        detalhes_ignorados.consumidor++;
      } else {
        detalhes_ignorados.documento_invalido++;
      }
      continue;
    }

    const documento = normalizarDocumento(docRaw);
    if (!documento) {
      detalhes_ignorados.documento_invalido++;
      continue;
    }

    // 3) Pedido obrigatório
    const numero_pedido = limparTexto(_col(l, 'Pedido', 'PEDIDO', '# Pedido'));
    if (!numero_pedido) continue;

    // 4) SKU + REF obrigatórios
    const sku = String(_col(l, 'SKU', 'sku') || '').replace(/\D/g, '');
    if (!sku || sku.length < 4) {
      detalhes_ignorados.sku_invalido++;
      continue;
    }
    const ref = refFromSku(sku);
    if (!ref) {
      detalhes_ignorados.ref_invalida++;
      continue;
    }

    // 5) Data da venda (preferência: Data Pago > Data Cadastro)
    const dataVenda = parseDataBR(
      _col(l, 'Data Pago', 'DATA PAGO', 'Data Pago ', 'Data Cadasrto', 'Data Cadastro', 'DATA CADASTRO')
    );
    if (!dataVenda) {
      detalhes_ignorados.sem_data++;
      continue;
    }

    // 6) Vendedora (Mire BI nem sempre traz — fica null se ausente)
    // OBS: planilha BI não tem coluna de vendedora explicitamente — vendedora_id
    // será resolvida depois (cruzando numero_pedido com lojas_vendas existente).
    // Aqui deixamos só o campo pra desnormalização.

    registros.push({
      numero_pedido,
      loja,
      sku,
      ref,

      documento_cliente_raw: documento,
      cliente_razao_raw: cliente,

      data_venda: dataVenda,

      descricao: limparTexto(_col(l, 'Descrição', 'DESCRICAO', 'Descricao')),
      qtd: Math.round(parseNumeroBR(_col(l, 'Qtde', 'QTDE', 'Qtd', 'QTD')) || 1),
      custo_unit: parseNumeroBR(_col(l, 'Custo', 'CUSTO')) || 0,
      preco_unit: parseNumeroBR(_col(l, 'Preço', 'PRECO', 'Preco')) || 0,
      desconto_unit: parseNumeroBR(_col(l, 'Desconto', 'DESCONTO')) || 0,
      // "Líquido" aparece 2 vezes na planilha (do pedido e do item).
      // SheetJS serializa o segundo como "Líquido_1" — tentamos esse primeiro,
      // depois fallback pra "Líquido" (item) ou nome alternativo.
      liquido_unit: parseNumeroBR(
        _col(l, 'Líquido_1', 'Liquido_1', 'LIQUIDO_1', 'Líquido item', 'Líquido')
      ) || 0,
      frete_unit: parseNumeroBR(_col(l, 'Frete Item', 'FRETE ITEM', 'Frete')) || 0,
    });
  }

  return {
    registros,
    total: linhasObj.length,
    ignorados: linhasObj.length - registros.length,
    detalhes_ignorados,
  };
}
