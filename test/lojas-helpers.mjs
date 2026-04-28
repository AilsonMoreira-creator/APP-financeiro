// ═══════════════════════════════════════════════════════════════════════════
// LOJAS HELPERS — versão standalone .mjs (extraída de src/LojasInstrucoes.jsx)
// ═══════════════════════════════════════════════════════════════════════════
//
// Esse arquivo é uma cópia EXATA das funções helpers do LojasInstrucoes.jsx,
// mas sem JSX/React, pra rodar standalone com Node.js. Use APENAS pra testes.
//
// Em produção, sempre importe de '../src/LojasInstrucoes.jsx'.
//
// ⚠️ Se mudar src/LojasInstrucoes.jsx, lembrar de espelhar aqui pra manter
//    os testes rodando contra a lógica real.
// ═══════════════════════════════════════════════════════════════════════════

// ─── CONSTANTES USADAS PELOS HELPERS ────────────────────────────────────────

export const REGRAS_NOVIDADE = {
  janela_padrao_dias: { inicio: 5, fim: 12 },
  janela_caseado_dias: { inicio: 7, fim: 14 },
  fonte_data: 'modulo_oficinas',
  definicao_novidade: 'ref_nunca_teve_venda',
};

export const CATEGORIAS_PAGAMENTO = {
  vem_na_loja: [
    'DINHEIRO', 'PIX', 'CARTÃO', 'CARTAO',
    'CRÉDITO 1X', 'CREDITO 1X',
    'CRÉDITO 2X', 'CREDITO 2X',
    'CRÉDITO 3X', 'CREDITO 3X',
    'CRÉDITO 4X', 'CREDITO 4X',
    'CRÉDITO 5X', 'CREDITO 5X',
    'CRÉDITO 6X', 'CREDITO 6X',
    'DÉBITO', 'DEBITO',
  ],
  distancia: [
    'LINK 1X', 'LINK 2X', 'LINK 3X', 'LINK 4X',
    'DEPÓSITO', 'DEPOSITO',
    'OUTROS',
  ],
  fiel_confianca: [
    'CHEQUE 1X', 'CHEQUE 2X', 'CHEQUE 3X', 'CHEQUE 4X',
  ],
  multiplo: [
    'MÚLTIPLA FORMA', 'MULTIPLA FORMA',
  ],
};

export const USUARIOS_ACESSO_TOTAL = [
  'amicia-admin', 'admin', 'ailson', 'tamara',
];

export const REGRAS_FILTRO_VAREJO = {
  nomes_ignorar: ['CONSUMIDOR', 'CLIENTE PADRAO', 'CLIENTE PADRÃO', 'VAREJO', ''],
  documentos_ignorar_exatos: ['1', '13', '00000000000', '11111111111'],
  documento_min_chars: 11,
  vendedores_ignorar: ['CONVERTR'],
};

export const VENDEDORAS_INICIAIS = [
  { nome: 'Joelma',      loja: 'Silva Teles', ativa: true, is_placeholder: false, is_padrao_loja: false, aliases: ['JOELMA', 'REGILANIA', 'KELLY'] },
  { nome: 'Cleide',      loja: 'Silva Teles', ativa: true, is_placeholder: false, is_padrao_loja: true,  aliases: ['CLEIDE', 'CARINA', 'KARINA'] },
  { nome: 'Vendedora_3', loja: 'Silva Teles', ativa: true, is_placeholder: true,  is_padrao_loja: false, aliases: ['PERLA', 'GISLENE', 'GI', 'POLYANA', 'POLI', 'POLLY'] },
  { nome: 'Célia',       loja: 'Bom Retiro',  ativa: true, is_placeholder: false, is_padrao_loja: true,  aliases: ['CELIA', 'CÉLIA'] },
  { nome: 'Vanessa',     loja: 'Bom Retiro',  ativa: true, is_placeholder: false, is_padrao_loja: false, aliases: ['VANESSA', 'VANESSA BOM', 'VANESSA BOM RETIRO'] },
  { nome: 'Fran',        loja: 'Bom Retiro',  ativa: true, is_placeholder: false, is_padrao_loja: false, aliases: ['FRAN'] },
  { nome: 'Vendedora_4', loja: 'Bom Retiro',  ativa: true, is_placeholder: true,  is_padrao_loja: false, aliases: ['ROSANGELA', 'ROSÂNGELA', 'MAIRLA', 'MAILA', 'LUCIA'] },
];

// ─── HELPERS ────────────────────────────────────────────────────────────────

export function ehUsuarioAdmin(userId) {
  if (!userId) return false;
  const normalizado = String(userId).trim().toLowerCase();
  return USUARIOS_ACESSO_TOTAL.map(u => u.toLowerCase()).includes(normalizado);
}

export function refSemZero(ref) {
  if (ref === null || ref === undefined) return '';
  return String(ref).trim().replace(/^0+/, '') || '0';
}

export function normalizarTelefone(ddd, telefone) {
  const dddLimpo = String(ddd || '').replace(/\D/g, '');
  let telLimpo = String(telefone || '').replace(/\D/g, '');

  if (!telLimpo) return null;

  telLimpo = telLimpo.replace(/^0+/, '');

  if (dddLimpo && telLimpo.startsWith(dddLimpo) && telLimpo.length > dddLimpo.length + 8) {
    telLimpo = telLimpo.substring(dddLimpo.length);
  }

  let completo = dddLimpo && !telLimpo.startsWith(dddLimpo)
    ? dddLimpo + telLimpo
    : telLimpo;

  if (completo.startsWith('55') && completo.length > 11) {
    completo = completo.substring(2);
  }

  if (completo.length !== 10 && completo.length !== 11) {
    return { numero: completo, valido: false };
  }

  return { numero: completo, valido: true };
}

export function escolherTelefone({ ddd, fone, celular, whatsapp }) {
  const tentativas = [
    { campo: 'whatsapp', valor: whatsapp },
    { campo: 'celular', valor: celular },
    { campo: 'fone', valor: fone },
  ];

  for (const t of tentativas) {
    if (!t.valor) continue;
    const result = normalizarTelefone(ddd, t.valor);
    if (result?.valido) return { ...result, origem: t.campo };
  }

  for (const t of tentativas) {
    if (!t.valor) continue;
    const result = normalizarTelefone(ddd, t.valor);
    if (result) return { ...result, origem: t.campo, observacao: 'numero_revisar' };
  }

  return null;
}

export function detectarLojaPorArquivo(nomeArquivo) {
  if (!nomeArquivo) return null;
  const n = nomeArquivo.toLowerCase();
  if (/_st_|_st\.|silva.?teles/i.test(n)) return 'Silva Teles';
  if (/_br_|_br\.|bom.?retiro/i.test(n)) return 'Bom Retiro';
  return null;
}

export function detectarCanal({ grupo, marketplace }) {
  const g = String(grupo || '').trim().toUpperCase();
  const m = String(marketplace || '').trim().toUpperCase();
  if (g === 'VESTI' || m === 'VESTI') return 'vesti';
  if (g === 'CONVERTR' || m === 'CONVERTR') return 'convertr';
  return 'fisico';
}

export function calcularCanalDominante(vendasCliente) {
  if (!vendasCliente?.length) return null;
  const total = vendasCliente.length;
  const counts = vendasCliente.reduce((acc, v) => {
    const canal = v.canal_origem || 'fisico';
    acc[canal] = (acc[canal] || 0) + 1;
    return acc;
  }, {});
  for (const canal of ['vesti', 'convertr', 'fisico']) {
    if ((counts[canal] || 0) / total >= 0.7) return `${canal}_dominante`;
  }
  return 'misto';
}

export function ehVendaVarejo(cliente, documento, vendedor) {
  const nome = String(cliente || '').trim().toUpperCase();
  const doc = String(documento || '').replace(/\D/g, '');
  const vend = String(vendedor || '').trim().toUpperCase();

  if (REGRAS_FILTRO_VAREJO.vendedores_ignorar.includes(vend)) {
    return { ignorar: true, motivo: 'teste_convertr' };
  }
  if (REGRAS_FILTRO_VAREJO.nomes_ignorar.includes(nome)) {
    return { ignorar: true, motivo: 'varejo_nome' };
  }
  if (REGRAS_FILTRO_VAREJO.documentos_ignorar_exatos.includes(doc)) {
    return { ignorar: true, motivo: 'documento_placeholder' };
  }
  if (!doc || doc.length < REGRAS_FILTRO_VAREJO.documento_min_chars) {
    return { ignorar: true, motivo: 'documento_curto' };
  }
  if (/^0+$/.test(doc) || /^(\d)\1+$/.test(doc)) {
    return { ignorar: true, motivo: 'documento_invalido' };
  }
  return { ignorar: false };
}

export function detectarClienteSinalizado(razao, fantasia) {
  // Cada padrão pode ser string literal OU regex.
  const padroes = [
    { tipo: 'string', valor: 'GOLPE' },
    { tipo: 'regex',  valor: /GO{3,}L/, label: 'GOOOOL' }, // GO + 3+ Os + L
    { tipo: 'string', valor: 'BLOQUEAR' },
    { tipo: 'string', valor: 'NAO VENDER' },
    { tipo: 'string', valor: 'NÃO VENDER' },
    { tipo: 'string', valor: 'CALOTEIRO' },
  ];
  const texto = `${razao || ''} ${fantasia || ''}`.toUpperCase();
  for (const p of padroes) {
    if (p.tipo === 'string' && texto.includes(p.valor)) {
      return { flagado: true, motivo: 'sinalizado_negativamente', palavra: p.valor };
    }
    if (p.tipo === 'regex' && p.valor.test(texto)) {
      return { flagado: true, motivo: 'sinalizado_negativamente', palavra: p.label };
    }
  }
  return { flagado: false };
}

export function resolverVendedora(nomeRaw, lojaArquivo, vendedorasCadastradas) {
  const nome = String(nomeRaw || '').trim().toUpperCase();
  const loja = lojaArquivo;
  const padraoLoja = () => vendedorasCadastradas.find(
    v => v.loja === loja && v.is_padrao_loja
  );
  if (!nome || nome === 'CONVERTR') {
    return padraoLoja();
  }
  const match = vendedorasCadastradas.find(
    v => v.ativa && v.loja === loja && (v.aliases || []).includes(nome)
  );
  if (match) return match;
  return padraoLoja();
}

export function importarApelidoComprador(comprador) {
  if (!comprador) return null;
  const limpo = String(comprador).trim();
  if (!limpo) return null;
  const primeiroNome = limpo.split(/\s*\/\s*|\s+E\s+/i)[0].trim();
  return primeiroNome || null;
}

export function calcularFaseCicloVida(diasDesde1aCompra) {
  if (diasDesde1aCompra === null || diasDesde1aCompra === undefined) return 'normal';
  if (diasDesde1aCompra < 0) return 'sem_compras_ainda';
  if (diasDesde1aCompra <= 14) return 'nova_aguardando';
  if (diasDesde1aCompra === 15) return 'nova_checkin_pronto';
  if (diasDesde1aCompra <= 30) return 'nova_em_analise';
  return 'normal';
}

export function classificarPedidoSacola(diasSeparacao, temNovidadeMatch = false, temPromocaoAtiva = false) {
  if (diasSeparacao < 0) return null;
  if (diasSeparacao <= 7) {
    if (temNovidadeMatch) return 'acrescentar_novidade';
    if (temPromocaoAtiva) return 'acrescentar_promocao';
    return 'lembrete_finalizacao';
  }
  if (diasSeparacao <= 15) {
    if (temPromocaoAtiva) return 'acrescentar_promocao';
    return 'lembrete_finalizacao';
  }
  if (diasSeparacao <= 25) return 'resgate_pedido';
  return 'urgencia_admin';
}

export function categorizarPagamento(formaPagamento) {
  const forma = String(formaPagamento || '').trim().toUpperCase();
  if (!forma) return 'desconhecido';
  for (const [categoria, formas] of Object.entries(CATEGORIAS_PAGAMENTO)) {
    if (formas.includes(forma)) return categoria;
  }
  return 'desconhecido';
}

export function calcularPerfilPresenca(historicoVendas) {
  if (!historicoVendas?.length) {
    return { perfil: 'desconhecido', paga_com_cheque: false, qtd_compras: 0 };
  }
  const total = historicoVendas.length;
  const counts = { vem_na_loja: 0, distancia: 0, fiel_confianca: 0, multiplo: 0, desconhecido: 0 };
  for (const v of historicoVendas) {
    const cat = categorizarPagamento(v.forma_pagamento);
    counts[cat] = (counts[cat] || 0) + 1;
  }
  const paga_com_cheque = counts.fiel_confianca > 0;
  const denominador = counts.vem_na_loja + counts.distancia + counts.fiel_confianca;
  if (denominador === 0) {
    return { perfil: 'desconhecido', paga_com_cheque, qtd_compras: total };
  }
  if ((counts.vem_na_loja / denominador) >= 0.7) {
    return { perfil: 'presencial_dominante', paga_com_cheque, qtd_compras: total };
  }
  if ((counts.distancia / denominador) >= 0.7) {
    return { perfil: 'remota_dominante', paga_com_cheque, qtd_compras: total };
  }
  if ((counts.fiel_confianca / denominador) >= 0.7) {
    return { perfil: 'fiel_cheque', paga_com_cheque: true, qtd_compras: total };
  }
  return { perfil: 'hibrida', paga_com_cheque, qtd_compras: total };
}

export function ehNovidadeReal(ref, vendasHistoricasDaRef) {
  if (!ref) return false;
  if (vendasHistoricasDaRef?.length > 0) return false;
  return true;
}

export function calcularJanelaNovidade(dataEntregaOficina, temCaseado = false, hoje = null) {
  if (!dataEntregaOficina) {
    return { em_janela: false, motivo: 'sem_data_entrega' };
  }
  const dataEntrega = new Date(dataEntregaOficina);
  const dataHoje = hoje ? new Date(hoje) : new Date();
  const ms_por_dia = 1000 * 60 * 60 * 24;
  const diasDesdeEntrega = Math.floor((dataHoje - dataEntrega) / ms_por_dia);

  const janela = temCaseado
    ? REGRAS_NOVIDADE.janela_caseado_dias
    : REGRAS_NOVIDADE.janela_padrao_dias;

  if (diasDesdeEntrega < janela.inicio) {
    return {
      em_janela: false,
      motivo: temCaseado ? 'aguardando_passadoria_e_caseado' : 'aguardando_passadoria',
      dias_desde_entrega: diasDesdeEntrega,
      dias_para_iniciar: janela.inicio - diasDesdeEntrega,
    };
  }
  if (diasDesdeEntrega > janela.fim) {
    return {
      em_janela: false,
      motivo: 'fora_janela_novidade',
      dias_desde_entrega: diasDesdeEntrega,
    };
  }
  return {
    em_janela: true,
    motivo: 'novidade_ativa',
    dias_desde_entrega: diasDesdeEntrega,
    janela_termina_em: janela.fim - diasDesdeEntrega,
  };
}

export function nomeModeloPorRef(ref, fichaTecnica) {
  if (!ref || !fichaTecnica) return null;
  const refNorm = refSemZero(ref);
  const direto = fichaTecnica.find(f => refSemZero(f.ref) === refNorm);
  if (direto?.descricao) return direto.descricao;
  const variantes = [`0${refNorm}`, `00${refNorm}`, `000${refNorm}`];
  for (const v of variantes) {
    const item = fichaTecnica.find(f => f.ref === v);
    if (item?.descricao) return item.descricao;
  }
  return null;
}

export function construirFraseProduto(descricaoOriginal) {
  if (!descricaoOriginal) return null;
  const desc = String(descricaoOriginal).trim().toLowerCase();
  if (!desc) return null;

  const categorias = ['calça', 'calca', 'macacão', 'macacao', 'vestido', 'conjunto',
                      'blusa', 'saia', 'shorts', 'short', 'body', 't-shirt', 'tshirt',
                      'regata', 'pantalona'];
  const tecidos = ['viscolinho', 'viscose', 'algodão', 'algodao',
                   'poliamida', 'crepe', 'malha', 'linho'];

  let categoria = '';
  for (const c of categorias) {
    if (desc.includes(c)) { categoria = c; break; }
  }

  // Acha o tecido com menor indexOf (que aparece primeiro na descrição).
  // Tecidos compostos (viscolinho contém "linho") vencem porque têm offset
  // menor ou igual.
  let tecido = '';
  let menorIdx = Infinity;
  for (const t of tecidos) {
    const idx = desc.indexOf(t);
    if (idx >= 0 && idx < menorIdx) {
      menorIdx = idx;
      tecido = t;
    }
  }

  if (categoria && tecido) return `${categoria} ${tecido}`;
  if (categoria) return categoria;
  if (tecido) return `peça de ${tecido}`;
  return desc.split(/\s+/).slice(0, 3).join(' ');
}

export function calcularDiasSacola(dataCadastroSacola, hoje = null) {
  if (!dataCadastroSacola) return null;
  const cadastro = new Date(dataCadastroSacola);
  const dataHoje = hoje ? new Date(hoje) : new Date();
  const ms_por_dia = 1000 * 60 * 60 * 24;
  return Math.floor((dataHoje - cadastro) / ms_por_dia);
}

export function temMovimentoRecenteSacola(dataAtualizado, hoje = null) {
  if (!dataAtualizado) return false;
  const atualizado = new Date(dataAtualizado);
  const dataHoje = hoje ? new Date(hoje) : new Date();
  const ms_por_dia = 1000 * 60 * 60 * 24;
  const diasDesdeUltimaMex = Math.floor((dataHoje - atualizado) / ms_por_dia);
  return diasDesdeUltimaMex <= 3;
}

export function calcularStatusCliente(diasSemComprar, temPedidoSacolaAtivo = false) {
  if (temPedidoSacolaAtivo) return 'separandoSacola';
  if (diasSemComprar === null || diasSemComprar === undefined) return 'arquivo';
  if (diasSemComprar <= 45) return 'ativo';
  if (diasSemComprar <= 90) return 'atencao';
  if (diasSemComprar <= 180) return 'semAtividade';
  if (diasSemComprar <= 365) return 'inativo';
  return 'arquivo';
}
