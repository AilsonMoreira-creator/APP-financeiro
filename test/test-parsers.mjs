// ═══════════════════════════════════════════════════════════════════════════
// TESTES INTEGRADOS DE PARSERS — usa amostras reais dos CSVs
// ═══════════════════════════════════════════════════════════════════════════
//
// Roda com: node test/test-parsers.mjs
// ═══════════════════════════════════════════════════════════════════════════

import {
  parseCSV, parseNumeroBR, parseDataBR, normalizarDocumento, tipoDocumento,
  detectarTipoArquivo,
} from '../api/_lojas-drive-helpers.js';

let passed = 0, failed = 0;

function test(nome, fn) {
  try { fn(); console.log(`✓ ${nome}`); passed++; }
  catch (e) { console.log(`✗ ${nome}\n   ${e.message}`); failed++; }
}

function eq(a, b, ctx = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${ctx}\n   esperado: ${JSON.stringify(b)}\n   recebido: ${JSON.stringify(a)}`);
  }
}

console.log('\n── parseNumeroBR ──');
test('1.927,00 → 1927', () => eq(parseNumeroBR('1.927,00'), 1927));
test('553,35 → 553.35', () => eq(parseNumeroBR('553,35'), 553.35));
test('27.864,00 → 27864', () => eq(parseNumeroBR('27.864,00'), 27864));
test('"1927" simples → 1927', () => eq(parseNumeroBR('1927'), 1927));
test('"0,5" → 0.5', () => eq(parseNumeroBR('0,5'), 0.5));
test('vazio → null', () => eq(parseNumeroBR(''), null));
test('null → null', () => eq(parseNumeroBR(null), null));

console.log('\n── parseDataBR ──');
test('27/04/2026 → 2026-04-27', () => eq(parseDataBR('27/04/2026'), '2026-04-27'));
test('1/1/2025 → 2025-01-01 (com pad)', () => eq(parseDataBR('1/1/2025'), '2025-01-01'));
test('27/04/26 → 2026-04-27 (assume 20YY)', () => eq(parseDataBR('27/04/26'), '2026-04-27'));
test('ISO já formatado → mantém', () => eq(parseDataBR('2026-04-27'), '2026-04-27'));
test('vazio → null', () => eq(parseDataBR(''), null));

console.log('\n── normalizarDocumento ──');
test('29.941.283/0001-58 → 29941283000158', () => eq(normalizarDocumento('29.941.283/0001-58'), '29941283000158'));
test('007.453.137-95 → 00745313795', () => eq(normalizarDocumento('007.453.137-95'), '00745313795'));
test('só dígitos: 11059323000177 → 11059323000177', () => eq(normalizarDocumento('11059323000177'), '11059323000177'));
test('vazio → null', () => eq(normalizarDocumento(''), null));

console.log('\n── tipoDocumento ──');
test('CNPJ (14 digits)', () => eq(tipoDocumento('29.941.283/0001-58'), 'cnpj'));
test('CPF (11 digits)', () => eq(tipoDocumento('007.453.137-95'), 'cpf'));
test('inválido (5 digits)', () => eq(tipoDocumento('12345'), null));

console.log('\n── detectarTipoArquivo ──');
test('cadastro_clientes_futura.csv', () => {
  const r = detectarTipoArquivo('cadastro_clientes_futura.csv', 'Geral_Inicial');
  eq(r, { tipo: 'cadastro_clientes_futura', loja: null });
});
test('relatorio_vendas_clientes_st.csv → vendas_clientes_st', () => {
  const r = detectarTipoArquivo('relatorio_vendas_clientes_st.csv', 'Silva_Teles_Inicial');
  eq(r, { tipo: 'vendas_clientes_st', loja: 'Silva Teles' });
});
test('relatorio_vendas_st_historico.csv → vendas_historico_st', () => {
  const r = detectarTipoArquivo('relatorio_vendas_st_historico.csv', 'Silva_Teles_Inicial');
  eq(r, { tipo: 'vendas_historico_st', loja: 'Silva Teles' });
});
test('relatorio_vendas_clientes_br.csv → vendas_clientes_br', () => {
  const r = detectarTipoArquivo('relatorio_vendas_clientes_br.csv', 'Bom_Retiro_Inicial');
  eq(r, { tipo: 'vendas_clientes_br', loja: 'Bom Retiro' });
});
test('produtos_27.04.2026.csv', () => {
  const r = detectarTipoArquivo('produtos_27.04.2026.csv', 'Produtos');
  eq(r, { tipo: 'produtos_semanal', loja: null });
});
test('pedidos_espera_st_27.04.2026.pdf → sacola_st', () => {
  const r = detectarTipoArquivo('pedidos_espera_st_27.04.2026.pdf', 'Sacola_Silva_Teles');
  eq(r, { tipo: 'sacola_st', loja: 'Silva Teles' });
});
test('arquivo desconhecido → null', () => {
  eq(detectarTipoArquivo('whatever.txt', 'aleatorio'), null);
});

console.log('\n── parseCSV (TAB-separated) ──');
const csv1 = `CÓDIGO\tDESCRIÇÃO\tPREÇO|MÉDIO
01871\tCALÇA VISCOLINHO\t73,76
02586\tCONJ. LINHO CROPPED\t131,45`;
test('parseCSV básico', () => {
  const r = parseCSV(csv1);
  eq(r.length, 2);
  eq(r[0]['CÓDIGO'], '01871');
  eq(r[0]['PREÇO|MÉDIO'], '73,76');
  eq(r[1]['DESCRIÇÃO'], 'CONJ. LINHO CROPPED');
});

const csv2 = `Código\tRazão Social\tFantasia\tFone\tCelular\tCidade\tCPF/CNPJ\tUF
39201\t3 S ARTIGOS DO VESTUARIO LTDA ME\t3 S ARTIGOS DO VESTUARIO LTDA ME\t\t(65) 9683-2091\tLUCAS DO RIO VERDE\t10.929.621/0001-08\tMT
216201\tADRIANA NEHME GUEDES\tADRIANA NEHME GUEDES\t\t\tITUIUTABA\t62.718.793/0001-36\tMG`;
test('parseCSV cadastro_futura (com campos vazios)', () => {
  const r = parseCSV(csv2);
  eq(r.length, 2);
  eq(r[0]['Fone'], '');
  eq(r[0]['Celular'], '(65) 9683-2091');
  eq(r[1]['Celular'], '');
  eq(r[1]['CPF/CNPJ'], '62.718.793/0001-36');
});

// Detecção automática de separador (bug real encontrado em produção:
// arquivos CSV BR vinham com ';' mas parser assumia '\t')
const csv_bbr = `Código;Razão Social;Fantasia;Fone;Celular;Cidade;CPF/CNPJ;UF\r
39201; 3 S ARTIGOS; 3 S ARTIGOS;;(65) 9683-2091;LUCAS DO RIO VERDE;10.929.621/0001-08;MT\r
216201; ADRIANA NEHME; ADRIANA NEHME;;;ITUIUTABA;62.718.793/0001-36;MG`;
test('parseCSV detecta ; (CSV BR) automaticamente', () => {
  const r = parseCSV(csv_bbr);
  eq(r.length, 2);
  eq(r[0]['Código'], '39201');
  eq(r[0]['Razão Social'], '3 S ARTIGOS');  // trim funciona
  eq(r[0]['CPF/CNPJ'], '10.929.621/0001-08');
  eq(r[1]['UF'], 'MG');
});

const csv_virgula = `code,name,price
A001,Produto X,12.50
A002,Produto Y,30.00`;
test('parseCSV detecta vírgula automaticamente', () => {
  const r = parseCSV(csv_virgula);
  eq(r.length, 2);
  eq(r[0]['code'], 'A001');
  eq(r[1]['price'], '30.00');
});

test('parseCSV separador forçado tem prioridade sobre detecção', () => {
  // Mesmo conteúdo com ';', mas força TAB → vai virar 1 coluna gigante
  const r = parseCSV('a;b;c\n1;2;3', { separador: '\t' });
  eq(r.length, 1);
  eq(Object.keys(r[0]).length, 1);  // só 1 coluna porque forçou TAB
});

console.log(`\n════════════════════════════════════════════════════════════════`);
console.log(`  ✓ ${passed} passaram   |   ✗ ${failed} falharam   |   total: ${passed + failed}`);
console.log(`════════════════════════════════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
