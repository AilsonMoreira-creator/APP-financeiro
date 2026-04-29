// ═══════════════════════════════════════════════════════════════════════════
// TESTES — Helpers de Documento e Comprador (Lojas)
// ═══════════════════════════════════════════════════════════════════════════
//
// Os helpers ficam em src/Lojas_Shared.jsx (JSX, não importável em node sem
// build). Aqui replicamos a lógica e testamos. Se mudar lá, atualizar aqui.
//
// Roda com: node test/test-comprador.mjs
// ═══════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'node:assert';

// ─── Cópias dos helpers (sincronizar com src/Lojas_Shared.jsx) ─────────────

function limparDocumento(doc) {
  return String(doc || '').replace(/\D/g, '');
}

function detectarTipoDocumento(doc) {
  const limpo = limparDocumento(doc);
  if (limpo.length === 11) return 'cpf';
  if (limpo.length === 14) return 'cnpj';
  return null;
}

function formatarDocumento(doc, tipo = null) {
  const d = limparDocumento(doc);
  const t = tipo || detectarTipoDocumento(d);
  if (t === 'cnpj' && d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (t === 'cpf' && d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return d;
}

function formatarDocumentoLive(input) {
  const d = limparDocumento(input).slice(0, 14);
  if (d.length <= 11) {
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function primeiroNome(nome) {
  const s = String(nome || '').trim();
  if (!s) return '';
  const palavras = s.split(/\s+/).filter(p => p.length >= 2);
  return palavras[0] || s;
}

// ─── Runner ─────────────────────────────────────────────────────────────────

let passou = 0, falhou = 0;
function teste(nome, fn) {
  try { fn(); console.log('✓', nome); passou++; }
  catch (e) { console.log('✗', nome); console.log('   ', e.message); falhou++; }
}

// ─── Testes ─────────────────────────────────────────────────────────────────

teste('limparDocumento tira tudo que não é dígito', () => {
  assert.equal(limparDocumento('12.345.678/0001-99'), '12345678000199');
  assert.equal(limparDocumento('123.456.789-09'), '12345678909');
  assert.equal(limparDocumento('  12345  '), '12345');
  assert.equal(limparDocumento(null), '');
  assert.equal(limparDocumento(undefined), '');
});

teste('detectarTipoDocumento: CPF 11 dígitos', () => {
  assert.equal(detectarTipoDocumento('12345678909'), 'cpf');
  assert.equal(detectarTipoDocumento('123.456.789-09'), 'cpf');
});

teste('detectarTipoDocumento: CNPJ 14 dígitos', () => {
  assert.equal(detectarTipoDocumento('12345678000199'), 'cnpj');
  assert.equal(detectarTipoDocumento('12.345.678/0001-99'), 'cnpj');
});

teste('detectarTipoDocumento: inválido retorna null', () => {
  assert.equal(detectarTipoDocumento(''), null);
  assert.equal(detectarTipoDocumento('123'), null);
  assert.equal(detectarTipoDocumento('123456789012345'), null); // 15
});

teste('formatarDocumento CPF', () => {
  assert.equal(formatarDocumento('12345678909'), '123.456.789-09');
});

teste('formatarDocumento CNPJ', () => {
  assert.equal(formatarDocumento('12345678000199'), '12.345.678/0001-99');
});

teste('formatarDocumento aceita já formatado', () => {
  assert.equal(formatarDocumento('12.345.678/0001-99'), '12.345.678/0001-99');
});

teste('formatarDocumentoLive vai formatando como CPF até 11', () => {
  assert.equal(formatarDocumentoLive('1'), '1');
  assert.equal(formatarDocumentoLive('123'), '123');
  assert.equal(formatarDocumentoLive('1234'), '123.4');
  assert.equal(formatarDocumentoLive('1234567'), '123.456.7');
  assert.equal(formatarDocumentoLive('12345678909'), '123.456.789-09');
});

teste('formatarDocumentoLive transiciona pra CNPJ depois do 12º dígito', () => {
  assert.equal(formatarDocumentoLive('123456789012'), '12.345.678/9012');
  assert.equal(formatarDocumentoLive('12345678000199'), '12.345.678/0001-99');
});

teste('formatarDocumentoLive ignora caracteres não numéricos', () => {
  assert.equal(formatarDocumentoLive('abc123def456'), '123.456');
  assert.equal(formatarDocumentoLive('12.345.678/0001-99XYZ'), '12.345.678/0001-99');
});

teste('formatarDocumentoLive limita em 14 dígitos', () => {
  assert.equal(formatarDocumentoLive('123456789012345678'), '12.345.678/9012-34');
});

teste('primeiroNome corta primeiro nome', () => {
  assert.equal(primeiroNome('Rosana Ruiva'), 'Rosana');
  assert.equal(primeiroNome('Reginaldo Yuni'), 'Reginaldo');
  assert.equal(primeiroNome('Maria de Souza'), 'Maria');
});

teste('primeiroNome com 1 palavra retorna ela mesma', () => {
  assert.equal(primeiroNome('Camila'), 'Camila');
});

teste('primeiroNome com vazio retorna vazio', () => {
  assert.equal(primeiroNome(''), '');
  assert.equal(primeiroNome(null), '');
  assert.equal(primeiroNome(undefined), '');
});

teste('primeiroNome trima espaços', () => {
  assert.equal(primeiroNome('  Rosana Ruiva  '), 'Rosana');
});

teste('primeiroNome ignora palavras de 1 caractere (iniciais)', () => {
  // "M Costa" → pula M, pega Costa
  assert.equal(primeiroNome('M Costa'), 'Costa');
  // mas "Mo Costa" pega Mo (>=2 chars)
  assert.equal(primeiroNome('Mo Costa'), 'Mo');
});

// ─── Resultado ──────────────────────────────────────────────────────────────

console.log(`\n════════════════════════════════════════════════════════════════`);
console.log(`  ✓ ${passou} passaram   |   ✗ ${falhou} falharam   |   total: ${passou + falhou}`);
console.log(`════════════════════════════════════════════════════════════════\n`);
process.exit(falhou > 0 ? 1 : 0);
