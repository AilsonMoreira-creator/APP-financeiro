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
// PDF que o Miré gera. Texto é extraível (não é imagem). Este parser recebe
// o TEXTO já extraído (orquestrador usa pdf-parse antes).
//
// Estrutura: 1 linha de header + N linhas de dados + linha de totais.
// Snapshot atual: cada linha = 1 cliente atualmente em status SEPARANDO_SACOLA.
//
// Regras:
//   - Agrupa por cliente (mesmo CNPJ): pega pedido mais antigo pra dias-em-sacola
//   - Sub-tipo via classificarPedidoSacola(dias)
//
// ═══════════════════════════════════════════════════════════════════════════

export function parsePedidosEspera(textoPDF, loja, vendedorasCadastradas, hoje = null) {
  if (!textoPDF) return { registros: [], total: 0, ignorados: 0, detalhes_ignorados: {} };

  // O texto extraído de PDF tabular vem com colunas separadas por múltiplos
  // espaços ou \t, mas o pdf-parse pode bagunçar. Estratégia: parsear por
  // padrão de número de pedido (primeiro número da linha) seguido de campos.
  //
  // Ordem das colunas (do PDF visto): Pedido, Cliente, CNPJ/CPF, Qtde, Devol,
  // Total, Frete, Cadastro, Atualizado, Hora, Vendedor, Representante,
  // Migrado, Observação, Plataforma, Nº Pedido, ID Cliente, Tipo

  const linhas = textoPDF.split('\n').map(l => l.trim()).filter(Boolean);

  const registros = [];
  const detalhes_ignorados = {
    sem_loja: 0,
    consumidor: 0,
    documento_invalido: 0,
    parse_falhou: 0,
  };

  if (!loja) {
    return { registros: [], total: linhas.length, ignorados: linhas.length,
      detalhes_ignorados: { ...detalhes_ignorados, sem_loja: linhas.length } };
  }

  for (const linha of linhas) {
    // Linha tem que começar com número de pedido (5 dígitos típico do Miré)
    const m = linha.match(/^(\d{4,7})\s+(.+)$/);
    if (!m) continue;

    const numero_pedido = m[1];
    const resto = m[2];

    // Tenta extrair: nome do cliente (até CNPJ), CNPJ (14 ou 11 dígitos),
    // qtde, devol, total, frete, cadastro (dd/mm/aaaa), atualizado, hora,
    // vendedor, ...
    //
    // Padrão: nome_cliente CNPJ\s+qtde\s+devol\s+total\s+frete\s+dd/mm/aaaa\s+dd/mm/aaaa\s+hh:mm:ss\s+vendedor\s+...
    //
    // Esse parser é heurístico — o PDF é tabular mas o pdf-parse colapsa
    // espaços às vezes. Usa regex pra capturar os pivôs (CNPJ + datas).

    const cnpjMatch = resto.match(/(\d{11,14})/);
    if (!cnpjMatch) {
      detalhes_ignorados.parse_falhou++;
      continue;
    }
    const documento = cnpjMatch[1];
    const cnpjIdx = cnpjMatch.index;
    const clienteRaw = resto.substring(0, cnpjIdx).trim();

    // Filtro varejo
    const filtro = ehVendaVarejo(clienteRaw, documento, '');
    if (filtro.ignorar) {
      if (filtro.motivo === 'varejo_nome' || filtro.motivo === 'documento_placeholder') {
        detalhes_ignorados.consumidor++;
      } else {
        detalhes_ignorados.documento_invalido++;
      }
      continue;
    }

    // Parte depois do CNPJ: pega valores numéricos e datas
    const aposCnpj = resto.substring(cnpjIdx + documento.length);

    // Datas dd/mm/aaaa (são pelo menos 2 — Cadastro e Atualizado)
    const datas = [...aposCnpj.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
    if (datas.length < 1) {
      detalhes_ignorados.parse_falhou++;
      continue;
    }
    const data_cadastro_sacola = parseDataBR(`${datas[0][1]}/${datas[0][2]}/${datas[0][3]}`);
    const data_ultima_atualizacao = datas[1]
      ? parseDataBR(`${datas[1][1]}/${datas[1][2]}/${datas[1][3]}`)
      : data_cadastro_sacola;

    // Hora hh:mm:ss
    const horaMatch = aposCnpj.match(/(\d{2}:\d{2}:\d{2})/);
    const hora = horaMatch ? horaMatch[1] : null;

    // Vendedor: maiúsculas após a hora, antes de "Atacado"
    const trecho = horaMatch ? aposCnpj.substring(horaMatch.index + 8) : aposCnpj;
    // Pega palavra(s) maiúsculas como vendedor (até próxima quebra ou número)
    const vendMatch = trecho.match(/^\s*([A-ZÁÃÀÉÊÍÓÔÕÚÇ ]{3,30})/);
    const vendedoraNome = vendMatch ? vendMatch[1].trim() : '';
    const vendedora = resolverVendedora(vendedoraNome, loja, vendedorasCadastradas);

    // Valores numéricos: pega os primeiros 4 do trecho ANTES da primeira data
    // (qtde, devol, total, frete)
    const trechoAntesData = aposCnpj.substring(0, datas[0].index);
    const numeros = [...trechoAntesData.matchAll(/[\d.]+,\d{2}|\d+/g)].map(x => x[0]);
    // numeros[0]=qtde, [1]=devol, [2]=total, [3]=frete (ordem do PDF)

    const qtd_pecas = parseInt(numeros[0]) || 0;
    const valor_total = parseNumeroBR(numeros[2]) || 0;

    // Calcula dias em sacola
    const dias = calcularDiasSacola(data_cadastro_sacola, hoje);
    const subtipo_sugerido = dias != null ? classificarPedidoSacola(dias) : null;

    registros.push({
      numero_pedido,
      loja,
      documento_raw: documento,
      vendedor_nome_raw: vendedoraNome,
      vendedora_id: vendedora?.id || null,

      data_cadastro_sacola,
      data_ultima_atualizacao,
      hora,

      qtd_pecas,
      valor_total,

      status: 'aberto',
      ativo: true,
      subtipo_sugerido,
    });
  }

  // Dedup por cliente: se mesmo CNPJ tem múltiplos pedidos abertos,
  // mantém todos (não agrupa) — orquestrador pode optar por mostrar 1 por
  // cliente na UI usando o pedido mais antigo, mas a tabela armazena tudo.
  //
  // (Decidido com o Ailson: "agrupar por cliente, usar pedido mais antigo"
  // é uma view/lógica de leitura, não de gravação. Tabela tem tudo.)

  return {
    registros,
    total: linhas.filter(l => /^\d{4,7}\s/.test(l)).length,
    ignorados: linhas.filter(l => /^\d{4,7}\s/.test(l)).length - registros.length,
    detalhes_ignorados,
  };
}
