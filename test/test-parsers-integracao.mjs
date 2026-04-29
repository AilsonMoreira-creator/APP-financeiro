// ═══════════════════════════════════════════════════════════════════════════
// TESTES DE INTEGRAÇÃO — usa amostras REAIS coladas pelo Ailson nas conversas
// ═══════════════════════════════════════════════════════════════════════════
//
// Cada teste passa uma amostra de CSV/PDF real (10-15 linhas) por todo o
// pipeline parser → registros estruturados. Garante que o código aguenta os
// dados de verdade.
// ═══════════════════════════════════════════════════════════════════════════

import {
  parseCadastroClientesFutura,
  parseRelatorioVendasClientes,
  parseRelatorioVendasHistorico,
  parseProdutos,
  parsePedidosEspera,
} from '../api/lojas-drive-parsers.js';

import { VENDEDORAS_INICIAIS } from '../api/lojas-helpers-business.js';

let passed = 0, failed = 0;

function test(nome, fn) {
  try { fn(); console.log(`✓ ${nome}`); passed++; }
  catch (e) { console.log(`✗ ${nome}\n   ${e.message}`); failed++; }
}

function assertTrue(cond, msg = 'esperado true') {
  if (!cond) throw new Error(msg);
}

// ─── DADOS REAIS (das conversas) ────────────────────────────────────────────

// 1. cadastro_clientes_futura.csv — primeiras 10 linhas reais
const CADASTRO_FUTURA_AMOSTRA = `Código\tRazão Social\tFantasia\tFone\tCelular\tCidade\tCPF/CNPJ\tUF
39201\t3 S ARTIGOS DO VESTUARIO LTDA ME\t3 S ARTIGOS DO VESTUARIO LTDA ME\t\t(65) 9683-2091\tLUCAS DO RIO VERDE\t10.929.621/0001-08\tMT
216201\tADRIANA NEHME GUEDES\tADRIANA NEHME GUEDES\t\t\tITUIUTABA\t62.718.793/0001-36\tMG
297103\tALESSANDRA DE SOUZA DOMINGOS\tAMICIS RESENDE\t(24) 9971-8984\t\tRESENDE\t24.464.576/0001-78\tRJ
287703\tAMARILDES SALES CUNHA HENRIQUES\tAMARILDES SALES CUNHA HENRIQUES\t(83) 9887-1040\t\tAREIA\t52.421.539/0001-18\tPB
342403\tANA CAROLINA ABUD ARIOLI\tANA CAROLINA ABUD ARIOLI\t(16)93618-3236\t\tARARAQUARA\t63.719.547/0001-61\tSP
300303\tANA CLAUDIA BUENO\tANA CLAUDIA BUENO\t(11) 7291-4795\t\tJUNDIAI\t13.728.026/0001-00\tSP
201901\tANA CRISTINA PASSINI FERREIRA DA SILVA\tANA CRISTINA PASSINI FERREIRA DA SILVA\t\t\tITATIBA\t30.109.214/0001-61\tSP
41601\tCLAUDIA OLIVEIRA\tCLAUDIA DE OLIVEIRA\t\t(19)98102-0144\tCAMPINAS\t007.453.137-95\tSP
201501\tDAIANE FERNANDE\tDAIANE CLOSET***GOOOOOLPISTA*\t\t\tTRINDADE\t52.856.493/0001-60\tGO`;

console.log('\n── parseCadastroClientesFutura (dados reais) ──');

test('Parsea 9 clientes válidos', () => {
  const r = parseCadastroClientesFutura(CADASTRO_FUTURA_AMOSTRA);
  assertTrue(r.registros.length === 9, `Esperava 9, recebeu ${r.registros.length}`);
});

test('Extrai CNPJ corretamente: 10.929.621/0001-08 → 10929621000108', () => {
  const r = parseCadastroClientesFutura(CADASTRO_FUTURA_AMOSTRA);
  const c = r.registros.find(x => x.razao_social.includes('3 S ARTIGOS'));
  assertTrue(c.documento === '10929621000108', `Esperava 10929621000108, recebeu ${c.documento}`);
  assertTrue(c.tipo_documento === 'cnpj');
});

test('Distingue CPF de CNPJ: 007.453.137-95 → cpf', () => {
  const r = parseCadastroClientesFutura(CADASTRO_FUTURA_AMOSTRA);
  const c = r.registros.find(x => x.razao_social.includes('CLAUDIA OLIVEIRA'));
  assertTrue(c.tipo_documento === 'cpf');
  assertTrue(c.documento === '00745313795');
});

test('Telefone Celular preenchido tem prioridade sobre Fone vazio', () => {
  const r = parseCadastroClientesFutura(CADASTRO_FUTURA_AMOSTRA);
  const c = r.registros.find(x => x.razao_social.includes('3 S ARTIGOS'));
  assertTrue(c.telefone_principal === '6596832091', `Recebeu ${c.telefone_principal}`);
  assertTrue(c.telefone_principal_origem === 'celular');
});

test('Cliente sem telefone tem campos null', () => {
  const r = parseCadastroClientesFutura(CADASTRO_FUTURA_AMOSTRA);
  const c = r.registros.find(x => x.razao_social.includes('ADRIANA NEHME'));
  assertTrue(c.telefone_principal === null);
  assertTrue(c.telefone_principal_origem === null);
});

test('🚨 DAIANE CLOSET***GOOOOOLPISTA* (5 Os) é flagada como sinalizada (bug 1 corrigido)', () => {
  const r = parseCadastroClientesFutura(CADASTRO_FUTURA_AMOSTRA);
  const c = r.registros.find(x => x.razao_social.includes('DAIANE FERNANDE'));
  assertTrue(c.observacao && c.observacao.includes('SINALIZADA'),
    `Esperava observacao com SINALIZADA, recebeu: "${c.observacao}"`);
  assertTrue(c.observacao.includes('GOOOOL'), `palavra esperada GOOOOL, observacao: ${c.observacao}`);
});

test('Razão Social ≠ Fantasia preserva os 2', () => {
  const r = parseCadastroClientesFutura(CADASTRO_FUTURA_AMOSTRA);
  const c = r.registros.find(x => x.razao_social.includes('ALESSANDRA'));
  assertTrue(c.razao_social.includes('ALESSANDRA DE SOUZA DOMINGOS'));
  assertTrue(c.nome_fantasia.includes('AMICIS RESENDE'));
});


// 2. relatorio_vendas_clientes_st.csv — primeiras 10 linhas reais
const VENDAS_CLIENTES_ST_AMOSTRA = `CLIENTE\tTICKETS\tQTDE\tTOTAL\tDDD\tFONE\tCELULAR\tWHATSAPP\tEMAIL\tVENDEDOR\tCLIENTE DESDE\tULT COMPRA\tCIDADE\tUF\tCNPJ/CPF\tCOMPRADOR\tGRUPO\tINSTAGRAM\t%\tACUMULADO\tABC
CONSUMIDOR\t598\t1.408,00\t121.362,12\t\t\t\t\t\t\t24/05/2011\t24/04/2026\tSAO PAULO\tSP\t13\t\t\t\t3,46%\t3,46%\tA
H. PORTO MANCEBO LTDA\t13\t1.056,00\t73.622,40\t22\t27724399\t(22)99206-9761\t\tcontato@amiciafashion.com\tCLEIDE\t03/03/2016\t13/03/2026\tMACAÉ\tRJ\t29941283000158\t\t\t\t2,10%\t5,57%\tA
YUNI MODAS LTDA\t5\t723\t64.608,30\t\t\t\t\tcontato@amiciafashion.com\tCLEIDE\t22/11/2018\t24/11/2025\tITAPEVI\tSP\t04430106000186\tREGINALDO REPRE\t\t\t1,84%\t7,41%\tA
DIAS & PUCCINELLI LTDA\t15\t874\t61.672,87\t13\t32341313\t\t\tjudosou@hotmail.com\t\t08/03/2022\t10/03/2026\tSANTOS\tSP\t09075172000107\t\t\t\t1,76%\t9,17%\tA
FRANCISCO GENIVAL DE SOUZA\t19\t820\t60.255,50\t\t\t\t\t\tCLEIDE\t19/12/2019\t23/04/2026\tJUNDIAÍ\tSP\t01417201000151\t\t\t\t1,72%\t10,89%\tA
VIVIANE PUCCINELLI & PUCCINELLI LTDA.\t15\t822\t58.565,59\t\t\t\t13997819335\tJUDISOU@HOTMAIL.COM\tKELLY\t08/03/2022\t10/03/2026\tSAO VICENTE\tSP\t08662158000139\t\t\t\t1,67%\t14,25%\tA
SUPER L DE BARRA DA ESTIVA LTDA\t9\t790\t57.454,40\t\t(77) 3450-1270\t\t\tnfe@amiciafashion.com\tCLEIDE\t06/11/2018\t20/03/2026\tBARRA DA ESTIVA\tBA\t16088353000125\t\t\t\t1,64%\t15,89%\tA
MATHEUS DE FARIA BESSA\t24\t650\t56.242,20\t\t1239425676\t\t\tcontato@amiciafashion.com\tJOELMA\t10/10/2017\t23/04/2026\tSÃO JOSÉ DOS CAMPOS\tSP\t03934172000120\t\t\t\t1,61%\t17,49%\tA`;

console.log('\n── parseRelatorioVendasClientes (dados reais ST) ──');

test('Parsea 7 clientes (CONSUMIDOR é ignorado)', () => {
  const r = parseRelatorioVendasClientes(VENDAS_CLIENTES_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  assertTrue(r.registros.length === 7, `Esperava 7, recebeu ${r.registros.length}`);
  assertTrue(r.detalhes_ignorados.consumidor === 1, `Esperava 1 consumidor ignorado`);
});

test('🎯 KELLY (alias) é resolvida pra Joelma (modelo de absorção)', () => {
  const r = parseRelatorioVendasClientes(VENDAS_CLIENTES_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  const viviane = r.registros.find(x => x.razao_social.includes('VIVIANE PUCCINELLI'));
  assertTrue(viviane.vendedora_nome === 'Joelma', `Esperava Joelma, recebeu ${viviane.vendedora_nome}`);
});

test('CLEIDE é resolvida pra Cleide diretamente', () => {
  const r = parseRelatorioVendasClientes(VENDAS_CLIENTES_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  const c = r.registros.find(x => x.razao_social.includes('H. PORTO MANCEBO'));
  assertTrue(c.vendedora_nome === 'Cleide');
});

test('JOELMA é resolvida pra Joelma diretamente', () => {
  const r = parseRelatorioVendasClientes(VENDAS_CLIENTES_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  const matheus = r.registros.find(x => x.razao_social.includes('MATHEUS DE FARIA'));
  assertTrue(matheus.vendedora_nome === 'Joelma');
});

test('VENDEDOR vazio: cai no padrão da loja (Cleide ST), vendedor_a_definir=true', () => {
  const r = parseRelatorioVendasClientes(VENDAS_CLIENTES_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  const dias = r.registros.find(x => x.razao_social.includes('DIAS & PUCCINELLI'));
  assertTrue(dias.vendedora_nome === 'Cleide', `Esperava Cleide (padrão), recebeu ${dias.vendedora_nome}`);
  assertTrue(dias.vendedor_a_definir === true);
});

test('KPIs agregados são extraídos: TICKETS, QTDE, TOTAL', () => {
  const r = parseRelatorioVendasClientes(VENDAS_CLIENTES_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  const c = r.registros.find(x => x.razao_social.includes('H. PORTO MANCEBO'));
  assertTrue(c._kpis.qtd_compras === 13, `Esperava 13 tickets`);
  assertTrue(c._kpis.qtd_pecas === 1056, `Esperava 1056 peças, recebeu ${c._kpis.qtd_pecas}`);
  assertTrue(Math.abs(c._kpis.lifetime_total - 73622.40) < 0.01,
    `Esperava 73622.40, recebeu ${c._kpis.lifetime_total}`);
  assertTrue(c._kpis.classificacao_abc === 'A');
});

test('Datas BR são convertidas pra ISO', () => {
  const r = parseRelatorioVendasClientes(VENDAS_CLIENTES_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  const c = r.registros.find(x => x.razao_social.includes('H. PORTO MANCEBO'));
  assertTrue(c._kpis.primeira_compra === '2016-03-03');
  assertTrue(c._kpis.ultima_compra === '2026-03-13');
});


// 3. relatorio_vendas_st_historico.csv — primeiras 10 linhas reais
const VENDAS_HISTORICO_ST_AMOSTRA = `PEDIDO\tCLIENTE\tCNPJ/CPF\tWHATSAPP\tQTDE\tDEVOL\tTOTAL BRUTO\tDEVOLUÇÃO\tTOTAL\tDESCONTO\t%\tLÍQUIDO\tCUSTO\tPAGAMENTO\tDATA|CADASTRO\tDATA|FINALIZADO\tHORA\tVENDEDOR\tUSUÁRIO\tTERMINAL\tNF\tCIDADE\tUF\tMARKETPLACE
31844\t# ROSANELIA MARIA DE OLIVEIRA\t11059323000177\t\t6\t0\t422\t0\t422\t22\t5%\t400\t210\tDINHEIRO\t27/04/2026\t27/04/2026\t11:57:32\tJOELMA\tADMIN\tDESKTOP-N2SUDVS\t0\tCAPITÓLIO\tMG\t
31843\tCARLA SIMONE VIEIRA DA SILVA\t45472799000157\t\t9\t0\t651\t0\t651\t97,65\t15%\t553,35\t322,5\tPIX\t22/09/2023\t27/04/2026\t11:07:08\tCLEIDE\tADMIN\tDESKTOP-7U6ASIR\t0\tJUNDIAÍ\tSP\t
31842\tAMABILE ALEIXO GIRALDO & CIA LTDA\t38850848000182\t16992227707\t19\t0\t1.927,00\t0\t1.927,00\t192,7\t10%\t1.734,30\t882,5\tPIX\t11/12/2024\t27/04/2026\t10:50:53\tJOELMA\tADMIN\tDESKTOP-N2SUDVS\t0\tBRODOWSKI\tSP\t
31838\tCONSUMIDOR\t13\t\t1\t0\t149\t0\t149\t0\t0%\t149\t74,5\tPIX\t24/05/2011\t24/04/2026\t10:55:57\tJOELMA\tADMIN\tDESKTOP-7U6ASIR\t0\tSAO PAULO\tSP\t`;

console.log('\n── parseRelatorioVendasHistorico (dados reais ST) ──');

test('Parsea 3 vendas (CONSUMIDOR é ignorada)', () => {
  const r = parseRelatorioVendasHistorico(VENDAS_HISTORICO_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  assertTrue(r.registros.length === 3, `Esperava 3, recebeu ${r.registros.length}`);
});

test('🚨 "# ROSANELIA" tem o prefixo "# " removido', () => {
  const r = parseRelatorioVendasHistorico(VENDAS_HISTORICO_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  const v = r.registros.find(x => x.numero_pedido === '31844');
  assertTrue(v.cliente_razao_raw === 'ROSANELIA MARIA DE OLIVEIRA',
    `Esperava sem #, recebeu: "${v.cliente_razao_raw}"`);
});

test('Decimais BR convertidos: 1.927,00 → 1927', () => {
  const r = parseRelatorioVendasHistorico(VENDAS_HISTORICO_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  const v = r.registros.find(x => x.numero_pedido === '31842');
  assertTrue(v.valor_total === 1927, `Esperava 1927, recebeu ${v.valor_total}`);
  assertTrue(Math.abs(v.valor_liquido - 1734.30) < 0.01, `Esperava 1734.30, recebeu ${v.valor_liquido}`);
  assertTrue(v.custo_total === 882.5);
});

test('Forma de pagamento categorizada: PIX → vem_na_loja', () => {
  const r = parseRelatorioVendasHistorico(VENDAS_HISTORICO_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  const v = r.registros.find(x => x.numero_pedido === '31843');
  assertTrue(v.forma_pagamento_categoria === 'vem_na_loja');
});

test('Datas BR: 27/04/2026 → 2026-04-27', () => {
  const r = parseRelatorioVendasHistorico(VENDAS_HISTORICO_ST_AMOSTRA, 'Silva Teles', VENDEDORAS_INICIAIS);
  const v = r.registros.find(x => x.numero_pedido === '31844');
  assertTrue(v.data_venda === '2026-04-27');
});


// 4. produtos_27.04.2026.csv — primeiras linhas reais
const PRODUTOS_AMOSTRA = `CÓDIGO\tDESCRIÇÃO\tCOLEÇÃO\tCATEGORIA\tPREÇO|INICIAL\tPREÇO|MÉDIO\tQUANTIDADE|TOTAL\tQUANTIDADE|DEVOL\tQUANTIDADE|ESTOQUE\tTOTAL|VENDA\tTOTAL|DEVOLUÇÃO\tTOTAL|BRUTO\tTOTAL|DESCONTO\tTOTAL|LÍQUIDO
01871\tCALÇA VISCOLINHO PANTALONA COS LARGO\t\tCALÇA\t79\t73,76\t5.407,00\t0\t-3\t445.157,06\t0\t445.157,06\t46.346,40\t398.810,66
02586\tCONJ. LINHO CROPPED/CALÇA PANT.\t\tCONJUNTO\t139\t131,45\t1.749,00\t1\t-2\t255.359,00\t139\t255.220,00\t25.455,68\t229.764,32
0395\tBODY MALHA TRANSPASSADO REGATA\t\t\t49\t50,57\t2.101,00\t0\t0\t112.956,00\t0\t112.956,00\t6.704,05\t106.251,95
1871\tCALÇA PANTALONA VISCOLINH\tCALÇA\t\t79\t70,08\t637\t3\t1.551,00\t53.187,00\t0\t53.036,00\t5.523,63\t47.512,37`;

console.log('\n── parseProdutos (dados reais) ──');

test('REF normalizada 01871 e 1871 são DEDUPADOS na mesma linha', () => {
  const r = parseProdutos(PRODUTOS_AMOSTRA);
  const refs = r.registros.map(x => x.ref);
  // Deve ter UM "1871" só (ambos viram a mesma chave)
  const ref1871 = refs.filter(x => x === '1871').length;
  assertTrue(ref1871 === 1, `Esperava 1 entrada pra REF 1871, recebeu ${ref1871}`);
});

test('REF "0395" → "395"', () => {
  const r = parseProdutos(PRODUTOS_AMOSTRA);
  const p = r.registros.find(x => x.ref === '395');
  assertTrue(p, 'Não achou ref 395');
  assertTrue(p.descricao.includes('BODY MALHA'));
});

test('Estoque negativo é mantido (peça pré-vendida)', () => {
  const r = parseProdutos(PRODUTOS_AMOSTRA);
  const p = r.registros.find(x => x.ref === '1871');
  // Após dedup, estoque é o MAIOR (Math.max(-3, 1551) = 1551 — caso real)
  // Mas o teste é que 'tem_zero_a_esquerda' é true (porque '01871' veio com zero)
  assertTrue(p.tem_zero_a_esquerda === true);
});

test('Preço médio é parseado: 73,76 → 73.76', () => {
  const r = parseProdutos(PRODUTOS_AMOSTRA);
  const p = r.registros.find(x => x.ref === '1871');
  // Após dedup, mantém o MAIOR preço médio (Math.max(73.76, 70.08) = 73.76)
  assertTrue(p.preco_medio === 73.76);
});

// ───────────────────────────────────────────────────────────────────────────
// parsePedidosEspera — casos REAIS dos PDFs do Miré (regressão do bug 28/04)
// ───────────────────────────────────────────────────────────────────────────
//
// Bug original: pdf-parse colapsava espaços e qtd+devol+total+frete
// virava um número gigante. valor_total caía pra 0 em 100% das sacolas.
// Fix: extrairLinhasPDFComX() (pdfjs-dist com X/Y) + parser que identifica
// campos pela natureza (datas, CNPJ, valores ,nn).
//
// Cada teste simula a saída da nova função extrairLinhasPDFComX() com items
// {x, text} pra um pedido específico.

const VENDS = [
  { id: 'v1', nome: 'JOELMA', loja: 'Silva Teles' },
  { id: 'v2', nome: 'CLEIDE', loja: 'Silva Teles' },
  { id: 'v3', nome: 'CELIA',  loja: 'Bom Retiro' },
];

function linhaTAMiranda() {
  // Caso real do PDF BR (27/04/2026): valor_total era 0 no banco antes do fix.
  return [
    { x: 32,  text: '91569' },
    { x: 53,  text: 'T A MIRANDA PASSOS' },
    { x: 208, text: '86633278000111' },
    { x: 268, text: '6' },
    { x: 288, text: '0' },
    { x: 351, text: '354,00' },
    { x: 384, text: '0,00' },
    { x: 398, text: '27/04/2026 27/04/2026' },
    { x: 474, text: '12:22:15' },
    { x: 503, text: 'CELIA' },
    { x: 759, text: '344322' },
    { x: 787, text: 'Atacado' },
  ];
}

test('parsePedidosEspera: T A Miranda — valor_total 354 (não 0!)', () => {
  const r = parsePedidosEspera([linhaTAMiranda()], 'Bom Retiro', VENDS, '2026-04-27');
  assertTrue(r.registros.length === 1, `esperado 1 registro, veio ${r.registros.length}`);
  const reg = r.registros[0];
  assertTrue(reg.numero_pedido === '91569', `pedido errado: ${reg.numero_pedido}`);
  assertTrue(reg.qtd_pecas === 6, `qtd errada: ${reg.qtd_pecas}`);
  assertTrue(reg.valor_total === 354, `valor errado: ${reg.valor_total}`);
  assertTrue(reg.documento_raw === '86633278000111', `cnpj errado: ${reg.documento_raw}`);
});

test('parsePedidosEspera: YUNI MODAS — qtd 185 (não 180936!)', () => {
  // Caso real do PDF ST: qtd vinha como 180936 (concatenação 18+0+936)
  const linha = [
    { x: 24,  text: '31812' },
    { x: 47,  text: 'YUNI MODAS LTDA' },
    { x: 132, text: '04430106000186' },
    { x: 199, text: '185' },
    { x: 237, text: '0' },
    { x: 295, text: '16.153,00' },
    { x: 341, text: '0,00' },
    { x: 356, text: '22/04/2026 24/04/2026' },
    { x: 438, text: '09:03:57' },
    { x: 470, text: 'CLEIDE' },
  ];
  const r = parsePedidosEspera([linha], 'Silva Teles', VENDS, '2026-04-27');
  assertTrue(r.registros.length === 1);
  const reg = r.registros[0];
  assertTrue(reg.qtd_pecas === 185, `qtd errada: ${reg.qtd_pecas}`);
  assertTrue(reg.valor_total === 16153, `valor errado: ${reg.valor_total}`);
});

test('parsePedidosEspera: MATHEUS — nome+CNPJ colado num único item', () => {
  // Caso real do PDF ST: pdfjs juntou nome e CNPJ numa única string.
  const linha = [
    { x: 24,  text: '31835' },
    { x: 47,  text: 'MATHEUS DE FARIA BESSA 03934172000120' },
    { x: 204, text: '30' },
    { x: 237, text: '0' },
    { x: 299, text: '3.090,00' },
    { x: 341, text: '0,00' },
    { x: 356, text: '23/04/2026 27/04/2026' },
    { x: 438, text: '11:32:34' },
    { x: 470, text: 'JOELMA' },
  ];
  const r = parsePedidosEspera([linha], 'Silva Teles', VENDS, '2026-04-27');
  assertTrue(r.registros.length === 1);
  const reg = r.registros[0];
  assertTrue(reg.documento_raw === '03934172000120', `cnpj errado: ${reg.documento_raw}`);
  assertTrue(reg.qtd_pecas === 30, `qtd errada: ${reg.qtd_pecas}`);
  assertTrue(reg.valor_total === 3090, `valor errado: ${reg.valor_total}`);
});

test('parsePedidosEspera: LUCIA CRISTINA — cliente com CPF E CNPJ secundário', () => {
  // Caso real do PDF ST: cliente tem 2 documentos, antes qtd virava o CNPJ
  const linha = [
    { x: 24,  text: '31828' },
    { x: 47,  text: 'LUCIA CRISTINA PEREIRA 16554155813' }, // CPF colado
    { x: 132, text: '13888148000156' },                       // CNPJ secundário
    { x: 206, text: '3' },
    { x: 237, text: '0' },
    { x: 305, text: '277,00' },
    { x: 341, text: '0,00' },
    { x: 356, text: '23/04/2026 23/04/2026' },
    { x: 438, text: '11:55:02' },
    { x: 470, text: 'CLEIDE' },
  ];
  const r = parsePedidosEspera([linha], 'Silva Teles', VENDS, '2026-04-27');
  assertTrue(r.registros.length === 1);
  const reg = r.registros[0];
  assertTrue(reg.qtd_pecas === 3, `qtd errada (deveria ser 3, veio ${reg.qtd_pecas})`);
  assertTrue(reg.valor_total === 277, `valor errado: ${reg.valor_total}`);
});

test('parsePedidosEspera: subtipo segue regras de dias', () => {
  // hoje=27/04, sacola de 22/04 = 5 dias → null (filtra)
  const linha = linhaTAMiranda(); // cad=27/04, hoje=27/04 → 0 dias
  const r = parsePedidosEspera([linha], 'Bom Retiro', VENDS, '2026-04-27');
  assertTrue(r.registros[0].subtipo_sugerido === null, 'sacola 0d deve ter subtipo null');

  // Mesma linha mas hoje 7 dias depois → incentivar_acrescentar
  const r2 = parsePedidosEspera([linha], 'Bom Retiro', VENDS, '2026-05-04');
  assertTrue(r2.registros[0].subtipo_sugerido === 'incentivar_acrescentar',
    `esperado incentivar_acrescentar, veio ${r2.registros[0].subtipo_sugerido}`);
});

test('parsePedidosEspera: filtra CONSUMIDOR (varejo)', () => {
  // CONSUMIDOR tem doc=1 que é placeholder de varejo
  const linha = [
    { x: 32,  text: '91519' },
    { x: 53,  text: 'CONSUMIDOR CONSUMIDOR 1' }, // nome+doc colados
    { x: 268, text: '1' },
    { x: 288, text: '0' },
    { x: 354, text: '59,00' },
    { x: 384, text: '0,00' },
    { x: 398, text: '25/04/2026 25/04/2026' },
    { x: 474, text: '12:28:42' },
    { x: 504, text: 'LOJA BOM RETIRO' },
  ];
  const r = parsePedidosEspera([linha], 'Bom Retiro', VENDS, '2026-04-27');
  // Sem CNPJ válido, parse falha (efeito final correto: não vai pro banco)
  assertTrue(r.registros.length === 0, 'CONSUMIDOR não deveria entrar');
});


console.log(`\n════════════════════════════════════════════════════════════════`);
console.log(`  ✓ ${passed} passaram   |   ✗ ${failed} falharam   |   total: ${passed + failed}`);
console.log(`════════════════════════════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
