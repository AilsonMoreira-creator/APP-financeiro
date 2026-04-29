// ═══════════════════════════════════════════════════════════════════════════
// TESTES — Lojas Helpers
// ═══════════════════════════════════════════════════════════════════════════
//
// Roda com Node 18+:
//   node test/test-lojas.mjs
//
// Não tem dependência externa (só node:assert). Saída: lista de ✓ e ✗ + total.
// ═══════════════════════════════════════════════════════════════════════════

import {
  refSemZero,
  normalizarTelefone,
  escolherTelefone,
  detectarLojaPorArquivo,
  detectarCanal,
  calcularCanalDominante,
  ehVendaVarejo,
  detectarClienteSinalizado,
  resolverVendedora,
  importarApelidoComprador,
  calcularFaseCicloVida,
  classificarPedidoSacola,
  categorizarPagamento,
  calcularPerfilPresenca,
  ehNovidadeReal,
  calcularJanelaNovidade,
  nomeModeloPorRef,
  construirFraseProduto,
  calcularDiasSacola,
  temMovimentoRecenteSacola,
  calcularStatusCliente,
  ehUsuarioAdmin,
  VENDEDORAS_INICIAIS,
} from './lojas-helpers.mjs';

// ─── MINI TEST RUNNER ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failedDetails = [];
let currentSuite = '';

function suite(nome) {
  currentSuite = nome;
  console.log(`\n── ${nome} ──`);
}

function test(descricao, fn) {
  try {
    fn();
    console.log(`  ✓ ${descricao}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${descricao}`);
    console.log(`     ${err.message}`);
    failed++;
    failedDetails.push({ suite: currentSuite, descricao, mensagem: err.message });
  }
}

function assertEqual(real, esperado, contexto = '') {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) {
    throw new Error(`${contexto ? contexto + ': ' : ''}esperado ${b}, recebido ${a}`);
  }
}

function assertTruthy(valor, contexto = '') {
  if (!valor) throw new Error(`${contexto ? contexto + ': ' : ''}esperado truthy, recebido ${JSON.stringify(valor)}`);
}

function assertFalsy(valor, contexto = '') {
  if (valor) throw new Error(`${contexto ? contexto + ': ' : ''}esperado falsy, recebido ${JSON.stringify(valor)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTES
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n╔═══════════════════════════════════════════════════════════════╗');
console.log('║          TESTES — Lojas Helpers (importação Drive)            ║');
console.log('╚═══════════════════════════════════════════════════════════════╝');

// ───────────────────────────────────────────────────────────────────────────
suite('refSemZero');
// ───────────────────────────────────────────────────────────────────────────
test('REF com zero à esquerda: 01871 → 1871', () => {
  assertEqual(refSemZero('01871'), '1871');
});
test('REF sem zero: 1871 → 1871', () => {
  assertEqual(refSemZero('1871'), '1871');
});
test('REF múltiplos zeros: 002 → 2', () => {
  assertEqual(refSemZero('002'), '2');
});
test('REF "0" sozinho não vira string vazia', () => {
  assertEqual(refSemZero('0'), '0');
});
test('REF null retorna string vazia', () => {
  assertEqual(refSemZero(null), '');
});
test('REF número (não string) é convertida', () => {
  assertEqual(refSemZero(1871), '1871');
});

// ───────────────────────────────────────────────────────────────────────────
suite('normalizarTelefone');
// ───────────────────────────────────────────────────────────────────────────
test('Formato (XX) X-XXXX-XXXX: (22) 9683-2091 → 10 dígitos é válido (telefone fixo)', () => {
  const r = normalizarTelefone('', '(22) 9683-2091');
  assertEqual(r, { numero: '2296832091', valido: true });
});
test('Celular completo 11 dígitos: (22)98189-1180 → 22981891180', () => {
  const r = normalizarTelefone('', '(22)98189-1180');
  assertEqual(r, { numero: '22981891180', valido: true });
});
test('DDD separado em coluna: 22 + 981891180 → 22981891180', () => {
  const r = normalizarTelefone('22', '981891180');
  assertEqual(r, { numero: '22981891180', valido: true });
});
test('DDD duplicado (DDD + telefone com DDD): 22 + 22981891180 → 22981891180', () => {
  const r = normalizarTelefone('22', '22981891180');
  assertEqual(r, { numero: '22981891180', valido: true });
});
test('Código país 55 + 11 dígitos: 5522981891180 → 22981891180', () => {
  const r = normalizarTelefone('', '5522981891180');
  assertEqual(r, { numero: '22981891180', valido: true });
});
test('Telefone vazio retorna null', () => {
  assertEqual(normalizarTelefone('22', ''), null);
});
test('Telefone com letras é limpo: ABC123 → 123 (inválido por tamanho)', () => {
  const r = normalizarTelefone('', 'ABC123');
  assertEqual(r, { numero: '123', valido: false });
});

// ───────────────────────────────────────────────────────────────────────────
suite('escolherTelefone (cascata WhatsApp > Celular > Fone)');
// ───────────────────────────────────────────────────────────────────────────
test('Tem WhatsApp válido: usa WhatsApp', () => {
  const r = escolherTelefone({ ddd: '22', whatsapp: '22981891180', celular: '22999999999', fone: '2233331111' });
  assertEqual(r.origem, 'whatsapp');
  assertEqual(r.valido, true);
});
test('Sem WhatsApp, tem celular: usa Celular', () => {
  const r = escolherTelefone({ ddd: '22', whatsapp: '', celular: '22999999999', fone: '2233331111' });
  assertEqual(r.origem, 'celular');
});
test('Só Fone disponível: usa Fone', () => {
  const r = escolherTelefone({ ddd: '11', whatsapp: '', celular: '', fone: '32341313' });
  assertEqual(r.origem, 'fone');
});
test('Tudo vazio retorna null', () => {
  assertEqual(escolherTelefone({ ddd: '', whatsapp: '', celular: '', fone: '' }), null);
});

// ───────────────────────────────────────────────────────────────────────────
suite('detectarLojaPorArquivo');
// ───────────────────────────────────────────────────────────────────────────
test('relatorio_vendas_st_historico.csv → Silva Teles', () => {
  assertEqual(detectarLojaPorArquivo('relatorio_vendas_st_historico.csv'), 'Silva Teles');
});
test('pedidos_espera_br_27.04.2026.pdf → Bom Retiro', () => {
  assertEqual(detectarLojaPorArquivo('pedidos_espera_br_27.04.2026.pdf'), 'Bom Retiro');
});
test('relatorio_vendas_clientes_st.csv → Silva Teles', () => {
  assertEqual(detectarLojaPorArquivo('relatorio_vendas_clientes_st.csv'), 'Silva Teles');
});
test('cadastro_clientes_futura.csv → null (não tem loja)', () => {
  assertEqual(detectarLojaPorArquivo('cadastro_clientes_futura.csv'), null);
});
test('Variante "silva teles" no nome funciona', () => {
  assertEqual(detectarLojaPorArquivo('export_silva_teles_2026.csv'), 'Silva Teles');
});

// ───────────────────────────────────────────────────────────────────────────
suite('detectarCanal');
// ───────────────────────────────────────────────────────────────────────────
test('Grupo VESTI → vesti', () => {
  assertEqual(detectarCanal({ grupo: 'VESTI' }), 'vesti');
});
test('Marketplace VESTI → vesti', () => {
  assertEqual(detectarCanal({ marketplace: 'VESTI' }), 'vesti');
});
test('Grupo CONVERTR → convertr', () => {
  assertEqual(detectarCanal({ grupo: 'CONVERTR' }), 'convertr');
});
test('Sem grupo nem marketplace → fisico (default)', () => {
  assertEqual(detectarCanal({}), 'fisico');
});

// ───────────────────────────────────────────────────────────────────────────
suite('ehVendaVarejo');
// ───────────────────────────────────────────────────────────────────────────
test('CONSUMIDOR + doc 13: ignora (documento_placeholder, doc tem prioridade)', () => {
  const r = ehVendaVarejo('CONSUMIDOR', '13', 'JOELMA');
  assertEqual(r.ignorar, true);
  assertEqual(r.motivo, 'documento_placeholder');
});
test('Cliente real + doc 13: ignora (documento_placeholder)', () => {
  const r = ehVendaVarejo('LOJA REAL', '13', 'JOELMA');
  assertEqual(r.ignorar, true);
  assertEqual(r.motivo, 'documento_placeholder');
});
test('Cliente real + doc 1: ignora (documento_placeholder)', () => {
  const r = ehVendaVarejo('LOJA REAL', '1', 'JOELMA');
  assertEqual(r.ignorar, true);
  assertEqual(r.motivo, 'documento_placeholder');
});
test('Vendedor CONVERTR: ignora (teste_convertr)', () => {
  const r = ehVendaVarejo('LOJA REAL', '12345678901234', 'CONVERTR');
  assertEqual(r.ignorar, true);
  assertEqual(r.motivo, 'teste_convertr');
});
test('Cliente real + CNPJ válido + JOELMA: NÃO ignora', () => {
  const r = ehVendaVarejo('H. PORTO MANCEBO LTDA', '29941283000158', 'JOELMA');
  assertEqual(r.ignorar, false);
});
test('Doc com pontuação é normalizado: 29.941.283/0001-58 → válido', () => {
  const r = ehVendaVarejo('H. PORTO MANCEBO LTDA', '29.941.283/0001-58', 'JOELMA');
  assertEqual(r.ignorar, false);
});
test('Doc curto (< 11 dígitos): ignora', () => {
  const r = ehVendaVarejo('LOJA', '123456', 'JOELMA');
  assertEqual(r.ignorar, true);
  assertEqual(r.motivo, 'documento_curto');
});
test('Doc todo zerado: ignora', () => {
  const r = ehVendaVarejo('LOJA', '00000000000', 'JOELMA');
  assertEqual(r.ignorar, true);
  // 00000000000 está em documentos_ignorar_exatos, então motivo é placeholder
  assertEqual(r.motivo, 'documento_placeholder');
});
// CASO REAL DESCOBERTO PELO USUÁRIO (28/abr/2026): bug do Miré que deixa
// nome em branco quando atacadista vem com CNPJ válido. Antes ignorava
// como varejo_nome, agora importa porque doc é prioridade.
test('Nome VAZIO + CNPJ válido (bug Miré atacadista): NÃO ignora', () => {
  const r = ehVendaVarejo('', '10466630000100', 'CLEIDE');
  assertEqual(r.ignorar, false);
});
test('Nome CONSUMIDOR + CNPJ válido (caso edge): NÃO ignora', () => {
  // Vendedora pode ter passado CONSUMIDOR mas digitou CNPJ certo. Doc vence.
  const r = ehVendaVarejo('CONSUMIDOR', '10466630000100', 'CLEIDE');
  assertEqual(r.ignorar, false);
});

// ───────────────────────────────────────────────────────────────────────────
suite('detectarClienteSinalizado');
// ───────────────────────────────────────────────────────────────────────────
test('Nome com GOLPE: flagado', () => {
  const r = detectarClienteSinalizado('FULANA SILVA ***GOLPE***', null);
  assertEqual(r.flagado, true);
  assertEqual(r.palavra, 'GOLPE');
});
test('Fantasia com GOOOOL (4 Os): flagado', () => {
  const r = detectarClienteSinalizado('FULANA', 'NOME ***GOOOOL***');
  assertEqual(r.flagado, true);
  assertEqual(r.palavra, 'GOOOOL');
});
test('CASO REAL: Fantasia "DAIANE CLOSET***GOOOOOLPISTA*" (5 Os): FLAGADO ✅ (bug corrigido)', () => {
  // ✅ Bug corrigido: regex /GO{3,}L/ pega qualquer número de Os ≥ 3
  const r = detectarClienteSinalizado('DAIANE FERNANDE', 'DAIANE CLOSET***GOOOOOLPISTA*');
  assertEqual(r.flagado, true);
  assertEqual(r.palavra, 'GOOOOL');
});
test('GOOOOOOOL (10 Os): também detectado', () => {
  const r = detectarClienteSinalizado('FULANA', 'NOME GOOOOOOOOOOOOL');
  assertEqual(r.flagado, true);
});
test('GOL puro (sem Os extras): NÃO flagado (não é o termo jocoso)', () => {
  // Importante: "JOGADOR DE FUTEBOL FAZ GOL" não pode ser flagado.
  // Termo jocoso de golpista exige 3+ Os ("GOOOL" mínimo).
  const r = detectarClienteSinalizado('TIME', 'TIME DE FUTEBOL FEZ GOL');
  assertEqual(r.flagado, false);
});
test('NÃO VENDER (com til): flagado', () => {
  const r = detectarClienteSinalizado('CLIENTE - NÃO VENDER', null);
  assertEqual(r.flagado, true);
});
test('NAO VENDER (sem til): flagado', () => {
  const r = detectarClienteSinalizado('CLIENTE - NAO VENDER', null);
  assertEqual(r.flagado, true);
});
test('Cliente normal: não flagado', () => {
  const r = detectarClienteSinalizado('CARLA SIMONE', 'CARLA SIMONE VIEIRA');
  assertEqual(r.flagado, false);
});
test('Caso lowercase ainda detecta (case-insensitive)', () => {
  const r = detectarClienteSinalizado('fulana golpe', null);
  assertEqual(r.flagado, true);
});

// ───────────────────────────────────────────────────────────────────────────
suite('resolverVendedora (modelo de absorção)');
// ───────────────────────────────────────────────────────────────────────────
test('JOELMA na ST → Joelma', () => {
  const v = resolverVendedora('JOELMA', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Joelma');
});
test('CLEIDE na ST → Cleide', () => {
  const v = resolverVendedora('CLEIDE', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Cleide');
});
test('KELLY (alias da Joelma) na ST → Joelma (absorvida)', () => {
  const v = resolverVendedora('KELLY', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Joelma');
});
test('REGILANIA (alias da Joelma) na ST → Joelma', () => {
  const v = resolverVendedora('REGILANIA', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Joelma');
});
test('CARINA (alias da Cleide) na ST → Cleide', () => {
  const v = resolverVendedora('CARINA', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Cleide');
});
test('PERLA (alias placeholder ST) na ST → Vendedora_3', () => {
  const v = resolverVendedora('PERLA', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Vendedora_3');
});
test('GISLENE (alias placeholder ST) na ST → Vendedora_3', () => {
  const v = resolverVendedora('GISLENE', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Vendedora_3');
});
test('ROSANGELA (alias placeholder BR) na BR → Vendedora_4', () => {
  const v = resolverVendedora('ROSANGELA', 'Bom Retiro', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Vendedora_4');
});
test('MAIRLA (alias placeholder BR) na BR → Vendedora_4', () => {
  const v = resolverVendedora('MAIRLA', 'Bom Retiro', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Vendedora_4');
});
test('CELIA na BR → Célia', () => {
  const v = resolverVendedora('CELIA', 'Bom Retiro', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Célia');
});
test('Nome desconhecido na ST → padrão da loja (Cleide)', () => {
  const v = resolverVendedora('XPTO', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Cleide');
});
test('Nome vazio na ST → padrão da loja (Cleide)', () => {
  const v = resolverVendedora('', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Cleide');
});
test('CONVERTR na ST → padrão da loja (Cleide)', () => {
  const v = resolverVendedora('CONVERTR', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Cleide');
});
test('JOELMA na BR (loja errada): NÃO acha JOELMA, cai no padrão Célia', () => {
  const v = resolverVendedora('JOELMA', 'Bom Retiro', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Célia');
});
test('CELIA na ST (loja errada): cai no padrão Cleide', () => {
  const v = resolverVendedora('CELIA', 'Silva Teles', VENDEDORAS_INICIAIS);
  assertEqual(v.nome, 'Cleide');
});

// ───────────────────────────────────────────────────────────────────────────
suite('importarApelidoComprador');
// ───────────────────────────────────────────────────────────────────────────
test('Nome simples: REGINALDO REPRE → REGINALDO REPRE', () => {
  assertEqual(importarApelidoComprador('REGINALDO REPRE'), 'REGINALDO REPRE');
});
test('Múltiplo com /: ZENAIDE/JESSICA → ZENAIDE', () => {
  assertEqual(importarApelidoComprador('ZENAIDE/JESSICA'), 'ZENAIDE');
});
test('Múltiplo com E: ESTHER E IVONETE → ESTHER', () => {
  assertEqual(importarApelidoComprador('ESTHER E IVONETE'), 'ESTHER');
});
test('Múltiplo com / e espaços: ANA / MARIA → ANA', () => {
  assertEqual(importarApelidoComprador('ANA / MARIA'), 'ANA');
});
test('Vazio retorna null', () => {
  assertEqual(importarApelidoComprador(''), null);
});
test('Null retorna null', () => {
  assertEqual(importarApelidoComprador(null), null);
});

// ───────────────────────────────────────────────────────────────────────────
suite('calcularFaseCicloVida');
// ───────────────────────────────────────────────────────────────────────────
test('Cliente com 0 dias (acabou de comprar): nova_aguardando', () => {
  assertEqual(calcularFaseCicloVida(0), 'nova_aguardando');
});
test('Cliente dia 14: ainda nova_aguardando', () => {
  assertEqual(calcularFaseCicloVida(14), 'nova_aguardando');
});
test('Cliente dia 15: nova_checkin_pronto (gerar follow-up)', () => {
  assertEqual(calcularFaseCicloVida(15), 'nova_checkin_pronto');
});
test('Cliente dia 16-30: nova_em_analise', () => {
  assertEqual(calcularFaseCicloVida(20), 'nova_em_analise');
});
test('Cliente dia 31+: normal', () => {
  assertEqual(calcularFaseCicloVida(31), 'normal');
});
test('Sem data (null): normal', () => {
  assertEqual(calcularFaseCicloVida(null), 'normal');
});

// ───────────────────────────────────────────────────────────────────────────
suite('classificarPedidoSacola');
// ───────────────────────────────────────────────────────────────────────────
// Atualizado 28/04/2026 (Ailson): novas regras
//   0-5d  → null (filtro: muito recente, vendedora ainda monta)
//   6-10d → incentivar_acrescentar
//   11-15d→ fechar_pedido
//   16-23d→ cobranca_incisiva
//   24+d  → desfazer_sacola

test('0 dias: null (muito recente)', () => {
  assertEqual(classificarPedidoSacola(0), null);
});
test('5 dias: null (limite de muito recente)', () => {
  assertEqual(classificarPedidoSacola(5), null);
});
test('6 dias: incentivar_acrescentar', () => {
  assertEqual(classificarPedidoSacola(6), 'incentivar_acrescentar');
});
test('10 dias: incentivar_acrescentar', () => {
  assertEqual(classificarPedidoSacola(10), 'incentivar_acrescentar');
});
test('11 dias: fechar_pedido', () => {
  assertEqual(classificarPedidoSacola(11), 'fechar_pedido');
});
test('15 dias: fechar_pedido', () => {
  assertEqual(classificarPedidoSacola(15), 'fechar_pedido');
});
test('16 dias: cobranca_incisiva', () => {
  assertEqual(classificarPedidoSacola(16), 'cobranca_incisiva');
});
test('23 dias: cobranca_incisiva', () => {
  assertEqual(classificarPedidoSacola(23), 'cobranca_incisiva');
});
test('24 dias: desfazer_sacola', () => {
  assertEqual(classificarPedidoSacola(24), 'desfazer_sacola');
});
test('30 dias: desfazer_sacola', () => {
  assertEqual(classificarPedidoSacola(30), 'desfazer_sacola');
});
test('Dia negativo retorna null', () => {
  assertEqual(classificarPedidoSacola(-1), null);
});
test('null retorna null', () => {
  assertEqual(classificarPedidoSacola(null), null);
});

// ───────────────────────────────────────────────────────────────────────────
suite('categorizarPagamento');
// ───────────────────────────────────────────────────────────────────────────
test('PIX → vem_na_loja', () => {
  assertEqual(categorizarPagamento('PIX'), 'vem_na_loja');
});
test('CRÉDITO 1X → vem_na_loja', () => {
  assertEqual(categorizarPagamento('CRÉDITO 1X'), 'vem_na_loja');
});
test('DINHEIRO → vem_na_loja', () => {
  assertEqual(categorizarPagamento('DINHEIRO'), 'vem_na_loja');
});
test('LINK 1X → distancia', () => {
  assertEqual(categorizarPagamento('LINK 1X'), 'distancia');
});
test('OUTROS → distancia', () => {
  assertEqual(categorizarPagamento('OUTROS'), 'distancia');
});
test('CHEQUE 1X → fiel_confianca', () => {
  assertEqual(categorizarPagamento('CHEQUE 1X'), 'fiel_confianca');
});
test('CHEQUE 3X → fiel_confianca', () => {
  assertEqual(categorizarPagamento('CHEQUE 3X'), 'fiel_confianca');
});
test('Vazio → desconhecido', () => {
  assertEqual(categorizarPagamento(''), 'desconhecido');
});
test('Forma desconhecida → desconhecido', () => {
  assertEqual(categorizarPagamento('BOLETO 1X'), 'desconhecido'); // BOLETO não está cadastrado!
});

// ───────────────────────────────────────────────────────────────────────────
suite('calcularPerfilPresenca');
// ───────────────────────────────────────────────────────────────────────────
test('100% PIX (3 vendas): presencial_dominante', () => {
  const r = calcularPerfilPresenca([
    { forma_pagamento: 'PIX' },
    { forma_pagamento: 'PIX' },
    { forma_pagamento: 'PIX' },
  ]);
  assertEqual(r.perfil, 'presencial_dominante');
  assertEqual(r.paga_com_cheque, false);
});
test('100% LINK (3 vendas): remota_dominante', () => {
  const r = calcularPerfilPresenca([
    { forma_pagamento: 'LINK 1X' },
    { forma_pagamento: 'LINK 1X' },
    { forma_pagamento: 'LINK 1X' },
  ]);
  assertEqual(r.perfil, 'remota_dominante');
});
test('100% CHEQUE: fiel_cheque', () => {
  const r = calcularPerfilPresenca([
    { forma_pagamento: 'CHEQUE 1X' },
    { forma_pagamento: 'CHEQUE 3X' },
  ]);
  assertEqual(r.perfil, 'fiel_cheque');
  assertEqual(r.paga_com_cheque, true);
});
test('Mix 50/50 PIX e LINK: hibrida', () => {
  const r = calcularPerfilPresenca([
    { forma_pagamento: 'PIX' },
    { forma_pagamento: 'PIX' },
    { forma_pagamento: 'LINK 1X' },
    { forma_pagamento: 'LINK 1X' },
  ]);
  assertEqual(r.perfil, 'hibrida');
});
test('Histórico vazio: desconhecido', () => {
  const r = calcularPerfilPresenca([]);
  assertEqual(r.perfil, 'desconhecido');
  assertEqual(r.qtd_compras, 0);
});
test('PIX dominante mas tem 1 cheque: paga_com_cheque=true', () => {
  const r = calcularPerfilPresenca([
    { forma_pagamento: 'PIX' },
    { forma_pagamento: 'PIX' },
    { forma_pagamento: 'PIX' },
    { forma_pagamento: 'PIX' },
    { forma_pagamento: 'CHEQUE 1X' },
  ]);
  // 4 PIX + 1 CHEQUE = 4/5 = 80% PIX → presencial dominante
  assertEqual(r.perfil, 'presencial_dominante');
  assertEqual(r.paga_com_cheque, true); // mas tem 1 cheque, flag continua
});

// ───────────────────────────────────────────────────────────────────────────
suite('calcularJanelaNovidade');
// ───────────────────────────────────────────────────────────────────────────
test('Sem data de entrega: false (sem_data_entrega)', () => {
  const r = calcularJanelaNovidade(null);
  assertEqual(r.em_janela, false);
  assertEqual(r.motivo, 'sem_data_entrega');
});
test('Entregue há 3 dias (sem caseado): aguardando_passadoria', () => {
  const hoje = '2026-04-28';
  const entrega = '2026-04-25'; // 3 dias atrás
  const r = calcularJanelaNovidade(entrega, false, hoje);
  assertEqual(r.em_janela, false);
  assertEqual(r.motivo, 'aguardando_passadoria');
});
test('Entregue há 7 dias (sem caseado): em_janela (5-12d)', () => {
  const hoje = '2026-04-28';
  const entrega = '2026-04-21'; // 7 dias atrás
  const r = calcularJanelaNovidade(entrega, false, hoje);
  assertEqual(r.em_janela, true);
  assertEqual(r.motivo, 'novidade_ativa');
});
test('Entregue há 5 dias (com caseado): aguardando (precisa 7+ se tem caseado)', () => {
  const hoje = '2026-04-28';
  const entrega = '2026-04-23'; // 5 dias atrás
  const r = calcularJanelaNovidade(entrega, true, hoje);
  assertEqual(r.em_janela, false);
  assertEqual(r.motivo, 'aguardando_passadoria_e_caseado');
});
test('Entregue há 8 dias (com caseado): em_janela (7-14d)', () => {
  const hoje = '2026-04-28';
  const entrega = '2026-04-20'; // 8 dias atrás
  const r = calcularJanelaNovidade(entrega, true, hoje);
  assertEqual(r.em_janela, true);
});
test('Entregue há 20 dias: fora_janela_novidade', () => {
  const hoje = '2026-04-28';
  const entrega = '2026-04-08'; // 20 dias atrás
  const r = calcularJanelaNovidade(entrega, false, hoje);
  assertEqual(r.em_janela, false);
  assertEqual(r.motivo, 'fora_janela_novidade');
});

// ───────────────────────────────────────────────────────────────────────────
suite('construirFraseProduto');
// ───────────────────────────────────────────────────────────────────────────
test('CALÇA VISCOLINHO PANTALONA → "calça viscolinho" (viscolinho > linho)', () => {
  // ⚠️ Crítico: "viscolinho" contém "linho", mas viscolinho deve ganhar
  assertEqual(construirFraseProduto('CALÇA VISCOLINHO PANTALONA COS LARGO'), 'calça viscolinho');
});
test('CALÇA PANTALONA LINHO/ALGODÃO/ELASTANO → "calça linho" ✅ (bug corrigido)', () => {
  // ✅ Bug corrigido: agora pega o tecido que aparece PRIMEIRO na descrição
  // (linho aparece antes de algodão).
  assertEqual(construirFraseProduto('CALÇA PANTALONA LINHO/ALGODÃO/ELASTANO'), 'calça linho');
});
test('VESTIDO LINHO MIDI → "vestido linho"', () => {
  assertEqual(construirFraseProduto('VESTIDO LINHO MIDI COM FENDA DECOTE REDONDO'), 'vestido linho');
});
test('CONJUNTO sem tecido reconhecido → "conjunto"', () => {
  assertEqual(construirFraseProduto('CONJUNTO CROPPED SAIA MIDI AMARRAÇÃO'), 'conjunto');
});
test('BLUSA MALHA POLIAMIDA → "blusa malha" ✅ (bug corrigido)', () => {
  // ✅ Bug corrigido: malha aparece antes de poliamida na descrição
  assertEqual(construirFraseProduto('BLUSA MALHA POLIAMIDA M. LONGA'), 'blusa malha');
});
test('CALÇA POLIAMIDA MALHA (ordem inversa): "calça poliamida"', () => {
  // Confirma que a regra é "primeiro na descrição", não "ordem fixa"
  assertEqual(construirFraseProduto('CALÇA POLIAMIDA MALHA LONGA'), 'calça poliamida');
});
test('CALÇA ALGODÃO LINHO (ordem inversa): "calça algodão"', () => {
  // Idem
  assertEqual(construirFraseProduto('CALÇA ALGODÃO LINHO ELASTANO'), 'calça algodão');
});
test('VISCOLINHO continua tendo prioridade sobre LINHO', () => {
  // Caso especial: "viscolinho" CONTÉM "linho", mas ambos têm o mesmo offset
  // (viscolinho começa em X, linho começa em X+3). indexOf de viscolinho é
  // menor, então ganha. ✓
  assertEqual(construirFraseProduto('CALÇA VISCOLINHO PANTALONA COS LARGO'), 'calça viscolinho');
});
test('Vazio retorna null', () => {
  assertEqual(construirFraseProduto(''), null);
});
test('Descrição sem categoria/tecido → primeiras 3 palavras', () => {
  assertEqual(construirFraseProduto('PEÇA NOVA EXCLUSIVA EDIÇÃO'), 'peça nova exclusiva');
});

// ───────────────────────────────────────────────────────────────────────────
suite('calcularDiasSacola');
// ───────────────────────────────────────────────────────────────────────────
test('Pedido cadastrado hoje: 0 dias', () => {
  assertEqual(calcularDiasSacola('2026-04-28', '2026-04-28'), 0);
});
test('Pedido cadastrado 5 dias atrás: 5 dias', () => {
  assertEqual(calcularDiasSacola('2026-04-23', '2026-04-28'), 5);
});
test('Sem data retorna null', () => {
  assertEqual(calcularDiasSacola(null), null);
});
test('Pedido cadastrado em 24/03 → 35 dias até 28/04', () => {
  assertEqual(calcularDiasSacola('2026-03-24', '2026-04-28'), 35);
});

// ───────────────────────────────────────────────────────────────────────────
suite('calcularStatusCliente');
// ───────────────────────────────────────────────────────────────────────────
test('Tem pedido sacola ativo: separandoSacola (overrides)', () => {
  assertEqual(calcularStatusCliente(200, true), 'separandoSacola');
});
test('Comprou há 10 dias: ativo (0-45d)', () => {
  assertEqual(calcularStatusCliente(10), 'ativo');
});
test('Comprou há 60 dias: atencao (45-90d)', () => {
  assertEqual(calcularStatusCliente(60), 'atencao');
});
test('Comprou há 120 dias: semAtividade (90-180d)', () => {
  assertEqual(calcularStatusCliente(120), 'semAtividade');
});
test('Comprou há 250 dias: inativo (180-365d)', () => {
  assertEqual(calcularStatusCliente(250), 'inativo');
});
test('Comprou há 500 dias: arquivo (365+)', () => {
  assertEqual(calcularStatusCliente(500), 'arquivo');
});
test('Sem data (null): arquivo', () => {
  assertEqual(calcularStatusCliente(null), 'arquivo');
});

// ───────────────────────────────────────────────────────────────────────────
suite('temMovimentoRecenteSacola');
// ───────────────────────────────────────────────────────────────────────────
test('Atualizado hoje: true', () => {
  assertEqual(temMovimentoRecenteSacola('2026-04-28', '2026-04-28'), true);
});
test('Atualizado 2 dias atrás: true', () => {
  assertEqual(temMovimentoRecenteSacola('2026-04-26', '2026-04-28'), true);
});
test('Atualizado 5 dias atrás: false', () => {
  assertEqual(temMovimentoRecenteSacola('2026-04-23', '2026-04-28'), false);
});
test('Sem data: false', () => {
  assertEqual(temMovimentoRecenteSacola(null), false);
});

// ───────────────────────────────────────────────────────────────────────────
suite('ehNovidadeReal');
// ───────────────────────────────────────────────────────────────────────────
test('REF sem vendas históricas: true (é novidade)', () => {
  assertEqual(ehNovidadeReal('1871', []), true);
});
test('REF com vendas: false', () => {
  assertEqual(ehNovidadeReal('1871', [{ ref: '1871' }]), false);
});
test('REF null: false', () => {
  assertEqual(ehNovidadeReal(null, []), false);
});

// ───────────────────────────────────────────────────────────────────────────
suite('nomeModeloPorRef');
// ───────────────────────────────────────────────────────────────────────────
const ficha = [
  { ref: '1871', descricao: 'CALÇA VISCOLINHO' },
  { ref: '02586', descricao: 'CONJUNTO LINHO' },
  { ref: '02716', descricao: '' }, // sem descrição
];
test('REF normalizada bate direto', () => {
  assertEqual(nomeModeloPorRef('1871', ficha), 'CALÇA VISCOLINHO');
});
test('REF com zero à esquerda bate igual: 01871 → CALÇA VISCOLINHO', () => {
  assertEqual(nomeModeloPorRef('01871', ficha), 'CALÇA VISCOLINHO');
});
test('REF 02586 (com zero) → CONJUNTO LINHO', () => {
  assertEqual(nomeModeloPorRef('02586', ficha), 'CONJUNTO LINHO');
});
test('REF não encontrada: null', () => {
  assertEqual(nomeModeloPorRef('9999', ficha), null);
});
test('REF sem descrição na ficha: null', () => {
  assertEqual(nomeModeloPorRef('02716', ficha), null);
});

// ───────────────────────────────────────────────────────────────────────────
suite('calcularCanalDominante');
// ───────────────────────────────────────────────────────────────────────────
test('100% físico (3 vendas): fisico_dominante', () => {
  const vendas = [
    { canal_origem: 'fisico' }, { canal_origem: 'fisico' }, { canal_origem: 'fisico' },
  ];
  assertEqual(calcularCanalDominante(vendas), 'fisico_dominante');
});
test('100% Vesti: vesti_dominante', () => {
  const vendas = [
    { canal_origem: 'vesti' }, { canal_origem: 'vesti' },
  ];
  assertEqual(calcularCanalDominante(vendas), 'vesti_dominante');
});
test('Mix 50/50 físico/vesti: misto', () => {
  const vendas = [
    { canal_origem: 'fisico' }, { canal_origem: 'fisico' },
    { canal_origem: 'vesti' }, { canal_origem: 'vesti' },
  ];
  assertEqual(calcularCanalDominante(vendas), 'misto');
});
test('Vazio: null', () => {
  assertEqual(calcularCanalDominante([]), null);
});

// ───────────────────────────────────────────────────────────────────────────
suite('ehUsuarioAdmin');
// ───────────────────────────────────────────────────────────────────────────
test('admin: true', () => {
  assertEqual(ehUsuarioAdmin('admin'), true);
});
test('AILSON (uppercase): true (case-insensitive)', () => {
  assertEqual(ehUsuarioAdmin('AILSON'), true);
});
test('amicia-admin: true', () => {
  assertEqual(ehUsuarioAdmin('amicia-admin'), true);
});
test('joelma: false', () => {
  assertEqual(ehUsuarioAdmin('joelma'), false);
});
test('vazio: false', () => {
  assertEqual(ehUsuarioAdmin(''), false);
});
test('null: false', () => {
  assertEqual(ehUsuarioAdmin(null), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// RELATÓRIO FINAL
// ═══════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════════');
console.log(`  ✓ ${passed} passaram   |   ✗ ${failed} falharam   |   total: ${passed + failed}`);
console.log('════════════════════════════════════════════════════════════════');

if (failed > 0) {
  console.log('\n❌ FALHAS:');
  failedDetails.forEach((f, i) => {
    console.log(`  ${i + 1}. [${f.suite}] ${f.descricao}`);
    console.log(`     ${f.mensagem}`);
  });
  process.exit(1);
} else {
  console.log('\n🎉 Todos os testes passaram!\n');
  process.exit(0);
}
