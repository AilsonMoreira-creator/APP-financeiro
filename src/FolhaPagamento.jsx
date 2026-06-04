/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FolhaPagamento.jsx — MÓDULO INDEPENDENTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Módulo de comissões/folha mensal pras 11 fichas (5 vendedoras + 6 mktplc).
 * Sessão Ailson 09/05/2026.
 *
 * Persistência:
 *   amicia_data user_id='folha-pagamento' (linha SEPARADA do amica-admin,
 *   não infla o payload financeiro principal). Padrão da Calculadora.
 *
 * Integração:
 *   Botão "Folha do mês" dentro de Lançamentos → Despesas → Funcionários
 *   (só aparece quando auxAberta === "Funcionários" no AuxSimplesPanel).
 *   Ao "Marcar pago", escreve em payload.auxDataPorMes[mes]["Funcionários"]
 *   campos salario/comissao/vale.
 *
 * Split temporal (Ailson):
 *   Salário → planilha do MÊS SEGUINTE (paga no 5º dia útil)
 *   Comissão → planilha do MÊS COMPETÊNCIA
 *   Vale → planilha do MÊS COMPETÊNCIA (lançado pelo cron dia 20)
 *
 * Catálogo de tipos de regra:
 *   - salario_fixo            { valor }
 *   - vale_pago               { valor }                 [não aparece no card]
 *   - comissao_propria        { percentual, base }
 *   - comissao_loja           { loja, percentual }
 *   - bonus_meta_individual   { base, faixas }
 *   - comissao_marketplace    { percentual, fonte }
 *   - valor_fixo              { descricao, valor }      [adhoc no fechamento]
 *   - desconto                { descricao, valor }      [adhoc no fechamento]
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  ArrowLeft, X, Plus, Edit2, Trash2, Check, FileText, Settings,
  AlertCircle, CheckCircle2, Archive, RotateCcw, ChevronDown,
  TrendingUp, Receipt, Wallet, Users, Tag, Minus, Save, Printer, Coffee,
} from 'lucide-react';
import { supabase, palette, FONT } from './Lojas_Shared.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

const NUM = "Calibri, 'Segoe UI', Arial, sans-serif";

const TIPO_INFO = {
  salario_fixo:           { label: 'Salário fixo',           icon: Wallet,    cor: palette.ink },
  vale_pago:              { label: 'Vale (dia 20)',          icon: Receipt,   cor: palette.archive },
  comissao_propria:       { label: 'Comissão própria',       icon: TrendingUp, cor: palette.accent },
  comissao_loja:          { label: 'Comissão sobre loja',    icon: Users,     cor: palette.accent },
  bonus_meta_individual:  { label: 'Bônus por meta',         icon: Tag,       cor: palette.ok },
  comissao_marketplace:   { label: 'Comissão marketplace',   icon: TrendingUp, cor: palette.accent },
  acrescimo:              { label: 'Acréscimo (alimentação, etc)', icon: Coffee, cor: palette.ok },
  valor_fixo:             { label: 'Valor extra',            icon: Plus,      cor: palette.ok },
  desconto:               { label: 'Desconto',               icon: Minus,     cor: palette.alert },
};

// Colunas disponíveis em auxDataPorMes[mes]['Funcionários'][linha] pra Acréscimo
const COLUNAS_PLANILHA_ACRESCIMO = [
  { key: 'alimentacao',     label: 'Alimentação' },
  { key: 'extra',           label: 'Extra' },
  { key: 'ferias',          label: 'Férias' },
  { key: 'decimo_terceiro', label: '13º Salário' },
  { key: 'rescisao',        label: 'Rescisão' },
];

// Funcionários iniciais — pré-cadastrados na primeira carga
const FUNCIONARIOS_INICIAIS = [
  { id: 'cleide',    nome_display: 'Cleide',    nome_planilha: 'CLEIDE',    categoria: 'vendedora_st', vendedora_id: null, ordem: 1, ativo: true },
  { id: 'joelma',    nome_display: 'Joelma',    nome_planilha: 'JOELMA',    categoria: 'vendedora_st', vendedora_id: null, ordem: 2, ativo: true },
  { id: 'celia',     nome_display: 'Célia',     nome_planilha: 'CELIA',     categoria: 'vendedora_br', vendedora_id: null, ordem: 3, ativo: true },
  { id: 'fran',      nome_display: 'Fran',      nome_planilha: 'FRANCISCA', categoria: 'vendedora_br', vendedora_id: null, ordem: 4, ativo: true },
  { id: 'vanessa',   nome_display: 'Vanessa',   nome_planilha: 'VANESSA',   categoria: 'vendedora_br', vendedora_id: null, ordem: 5, ativo: true },
  { id: 'cristiane', nome_display: 'Cristiane', nome_planilha: 'CRISTIANE', categoria: 'mktplc',       vendedora_id: null, ordem: 6, ativo: true },
  { id: 'stefany',   nome_display: 'Stefany',   nome_planilha: 'STEFANY',   categoria: 'mktplc',       vendedora_id: null, ordem: 7, ativo: true },
  { id: 'gabrielly', nome_display: 'Gabrielly', nome_planilha: 'Gabrielly', categoria: 'mktplc',       vendedora_id: null, ordem: 8, ativo: true },
  { id: 'ingrid',    nome_display: 'Ingrid',    nome_planilha: 'INGRID',    categoria: 'mktplc',       vendedora_id: null, ordem: 9, ativo: true },
  { id: 'lucia',     nome_display: 'Lúcia',     nome_planilha: 'LUCIA',     categoria: 'mktplc',       vendedora_id: null, ordem: 10, ativo: true },
  { id: 'igor',      nome_display: 'Igor',      nome_planilha: 'IGOR',      categoria: 'mktplc',       vendedora_id: null, ordem: 11, ativo: true },
];

const FAIXAS_META_PADRAO = [
  { meta: 70000, valor: 200 },
  { meta: 80000, valor: 400 },
  { meta: 90000, valor: 600 },
  { meta: 100000, valor: 800 },
];

// Regras iniciais — pré-cadastradas conforme alinhamento Ailson 09/05/2026
const REGRAS_INICIAIS = {
  cleide: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 2112 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 845 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_propria',      config: { percentual: 1, base: 'total' },                     ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_loja',         config: { loja: 'Silva Teles', percentual: 0.4 },             ordem: 4, ativo: true },
    { id: rid(), tipo: 'bonus_meta_individual', config: { base: 'total', faixas: [...FAIXAS_META_PADRAO] },   ordem: 5, ativo: true },
  ],
  joelma: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 2112 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 845 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_propria',      config: { percentual: 1, base: 'total' },                     ordem: 3, ativo: true },
    { id: rid(), tipo: 'bonus_meta_individual', config: { base: 'total', faixas: [...FAIXAS_META_PADRAO] },   ordem: 4, ativo: true },
  ],
  celia: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 2112 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 845 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_propria',      config: { percentual: 1.5, base: 'total' },                   ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_loja',         config: { loja: 'Bom Retiro', percentual: 0.5 },              ordem: 4, ativo: true },
    { id: rid(), tipo: 'bonus_meta_individual', config: { base: 'total', faixas: [...FAIXAS_META_PADRAO] },   ordem: 5, ativo: true },
  ],
  fran: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 2112 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 845 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_propria',      config: { percentual: 1, base: 'atacado' },                   ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_propria',      config: { percentual: 1.5, base: 'varejo' },                  ordem: 4, ativo: true },
    { id: rid(), tipo: 'bonus_meta_individual', config: { base: 'total', faixas: [...FAIXAS_META_PADRAO] },   ordem: 5, ativo: true },
  ],
  vanessa: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 2112 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 845 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_propria',      config: { percentual: 1, base: 'atacado' },                   ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_propria',      config: { percentual: 1.5, base: 'varejo' },                  ordem: 4, ativo: true },
    { id: rid(), tipo: 'bonus_meta_individual', config: { base: 'total', faixas: [...FAIXAS_META_PADRAO] },   ordem: 5, ativo: true },
  ],
  cristiane: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 2503 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 1002 },                                      ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_loja',         config: { loja: 'Bom Retiro', percentual: 0.3 },              ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.1, fonte: 'mktplc_bruto' },           ordem: 4, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.1, fonte: 'mktplc_liquido' },         ordem: 5, ativo: true },
  ],
  stefany: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 2759 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 1104 },                                      ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.12, fonte: 'mktplc_bruto' },          ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.20, fonte: 'muniam' },                ordem: 4, ativo: true },
  ],
  gabrielly: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 2334.86 },                                   ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 934 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.10, fonte: 'mktplc_bruto' },          ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.20, fonte: 'muniam' },                ordem: 4, ativo: true },
  ],
  ingrid: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 2028 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 892 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.10, fonte: 'mktplc_bruto' },          ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.20, fonte: 'muniam' },                ordem: 4, ativo: true },
  ],
  lucia: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 2112 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 845 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.07, fonte: 'mktplc_bruto' },          ordem: 3, ativo: true },
  ],
  igor: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 1988 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 848 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.10, fonte: 'mktplc_bruto' },          ordem: 3, ativo: true },
    { id: rid(), tipo: 'desconto',              config: { descricao: 'Empréstimo', valor: 0 },                ordem: 4, ativo: true },
  ],
};

function rid() {
  return Math.random().toString(36).slice(2, 11);
}

const CAT_INFO = {
  vendedora_st: { label: 'Vendedora · Silva Teles', cor: '#4a7fa5', bg: '#e8f0f7' },
  vendedora_br: { label: 'Vendedora · Bom Retiro',  cor: '#6b9b75', bg: '#e9f3eb' },
  mktplc:       { label: 'Time marketplace',         cor: '#b88a3d', bg: '#f5ecdc' },
  outro:        { label: 'Outro',                    cor: palette.inkMuted, bg: palette.beige },
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function fmtBRL(n) {
  return 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function competenciaAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function competenciaSeguinte(comp) {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(a, m, 1); // próximo mês
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Mês anterior ao corrente — é o que normalmente se fecha (Ailson 03/06/2026).
function competenciaAnterior() {
  const d = new Date();
  const ano = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const mes = d.getMonth() === 0 ? 12 : d.getMonth();
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

function nomeMes(comp) {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(a, m - 1, 1);
  const s = d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nomeMesCurto(comp) {
  const [, m] = comp.split('-').map(Number);
  return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][m - 1];
}

function iniciais(nome) {
  return (nome || '').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase() || '?';
}

// Normaliza string pra match: trim + lowercase + remove acentos.
// "Célia" / "CÉLIA" / "celia" → "celia". Pra match em planilhas e lojas_vendedoras.
function norm(s) {
  return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// CÁLCULO DAS REGRAS — Fase 2
// ═══════════════════════════════════════════════════════════════════════════
//
// Pra cada regra ativa do funcionário, gera uma linha calculada:
//   { id, tipo, titulo, descricao_calculo, valor, mes_destino }
//
// mes_destino:
//   'competencia'   → escreve no mês fechado (ex: maio)
//   'seguinte'      → escreve no mês de pagamento (ex: junho)
//
// Salário sempre vai pro mês seguinte (regra de costume Ailson).
// Demais vão pra competência.

function calcularRegras(funcionario, regrasFunc, contexto) {
  const linhas = [];
  // Acha vale pra subtrair do salário
  const valeRegra = (regrasFunc || []).find(r => r.tipo === 'vale_pago' && r.ativo);
  const valeValor = Number(valeRegra?.config?.valor || 0);

  for (const r of (regrasFunc || []).filter(x => x.ativo).sort((a, b) => a.ordem - b.ordem)) {
    const linha = calcularUmaRegra(r, funcionario, contexto, valeValor);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

function calcularUmaRegra(regra, funcionario, ctx, valeValor) {
  const cfg = regra.config || {};
  switch (regra.tipo) {
    case 'salario_fixo': {
      const salario = Number(cfg.valor || 0);
      const a_pagar = Math.max(0, salario - valeValor);
      const calc = valeValor > 0
        ? `R$ ${salario.toFixed(2).replace('.',',')} base − R$ ${valeValor.toFixed(2).replace('.',',')} vale (já pago dia 20)`
        : `Salário base R$ ${salario.toFixed(2).replace('.',',')}`;
      return {
        id: regra.id, tipo: regra.tipo, titulo: 'Salário',
        descricao_calculo: calc, valor: a_pagar, mes_destino: 'seguinte',
      };
    }
    case 'vale_pago':
      return null; // não aparece no card; é só pra subtrair do salário e ser usado pelo cron dia 20

    case 'comissao_propria': {
      const base = cfg.base || 'total';
      const v = ctx.vendas_propria?.[base] || 0;
      const valor = v * (Number(cfg.percentual) / 100);
      const baseLabel = base === 'total' ? 'total vendas dela' : `apenas ${base}`;
      return {
        id: regra.id, tipo: regra.tipo,
        titulo: base === 'total' ? 'Comissão sobre vendas' : `Comissão ${base}`,
        descricao_calculo: `${cfg.percentual}% × ${fmtBRL(v)} (${baseLabel} em ${nomeMesCurto(ctx.competencia)}/${ctx.competencia.slice(2,4)})`,
        valor, mes_destino: 'competencia',
      };
    }

    case 'comissao_loja': {
      const v = (cfg.loja === 'Silva Teles' ? ctx.vendas_loja_ST : ctx.vendas_loja_BR) || 0;
      const valor = v * (Number(cfg.percentual) / 100);
      return {
        id: regra.id, tipo: regra.tipo, titulo: 'Comissão sobre loja',
        descricao_calculo: `${cfg.percentual}% × ${fmtBRL(v)} (loja ${cfg.loja} em ${nomeMesCurto(ctx.competencia)}/${ctx.competencia.slice(2,4)})`,
        valor, mes_destino: 'competencia',
      };
    }

    case 'bonus_meta_individual': {
      const base = cfg.base || 'total';
      const v = ctx.vendas_propria?.[base] || 0;
      const faixas = (cfg.faixas || []).slice().sort((a, b) => Number(a.meta) - Number(b.meta));
      let faixaAtingida = null;
      for (const f of faixas) {
        if (v >= Number(f.meta)) faixaAtingida = f;
      }
      if (!faixaAtingida) {
        return {
          id: regra.id, tipo: regra.tipo, titulo: 'Bônus por meta',
          descricao_calculo: `Vendeu ${fmtBRL(v)} — ainda não atingiu nenhuma faixa`,
          valor: 0, mes_destino: 'competencia',
        };
      }
      return {
        id: regra.id, tipo: regra.tipo, titulo: 'Bônus por meta',
        descricao_calculo: `Vendeu ${fmtBRL(v)} (atingiu faixa de ${(Number(faixaAtingida.meta)/1000).toFixed(0)}k)`,
        valor: Number(faixaAtingida.valor), mes_destino: 'competencia',
      };
    }

    case 'comissao_marketplace': {
      let v = 0;
      let label = '';
      if (cfg.fonte === 'mktplc_liquido') { v = ctx.mktplc_liquido || 0; label = 'mktplc líquido'; }
      else if (cfg.fonte === 'mktplc_bruto') { v = ctx.mktplc_bruto || 0; label = 'mktplc bruto'; }
      else if (cfg.fonte === 'muniam') { v = ctx.muniam || 0; label = 'Muniam'; }
      const valor = v * (Number(cfg.percentual) / 100);
      return {
        id: regra.id, tipo: regra.tipo, titulo: `Comissão ${label}`,
        descricao_calculo: `${cfg.percentual}% × ${fmtBRL(v)} (${label})`,
        valor, mes_destino: 'competencia',
      };
    }

    case 'acrescimo': {
      const colInfo = (typeof COLUNAS_PLANILHA_ACRESCIMO !== 'undefined' ? COLUNAS_PLANILHA_ACRESCIMO : [])
        .find(c => c.key === cfg.coluna_planilha);
      const labelCol = colInfo?.label || cfg.descricao || 'Acréscimo';
      return {
        id: regra.id, tipo: regra.tipo,
        titulo: cfg.descricao || labelCol,
        descricao_calculo: `Acréscimo fixo → coluna ${labelCol} da planilha`,
        valor: Number(cfg.valor || 0),
        mes_destino: cfg.mes_destino === 'competencia' ? 'competencia' : 'seguinte',
        coluna_planilha: cfg.coluna_planilha,
      };
    }

    case 'valor_fixo': {
      return {
        id: regra.id, tipo: regra.tipo, titulo: cfg.descricao || 'Valor extra',
        descricao_calculo: 'Adicional fixo',
        valor: Number(cfg.valor || 0), mes_destino: 'competencia',
      };
    }

    case 'desconto': {
      return {
        id: regra.id, tipo: regra.tipo, titulo: cfg.descricao || 'Desconto',
        descricao_calculo: 'Desconto fixo',
        valor: -Math.abs(Number(cfg.valor || 0)), mes_destino: 'competencia',
      };
    }

    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTO — busca bases de cálculo do mês
// ═══════════════════════════════════════════════════════════════════════════

async function carregarContexto(competencia, vendedoras) {
  const [ano, mes] = competencia.split('-').map(Number);
  const inicio = `${competencia}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${competencia}-${String(ultimoDia).padStart(2, '0')}`;

  // 1. Vendas por vendedora_id no período (atacado + varejo via view)
  let vendas = [];
  try {
    const { data, error } = await supabase
      .from('vw_lojas_vendas_completo')
      .select('vendedora_id, categoria, valor_liquido, loja')
      .gte('data_venda', inicio)
      .lte('data_venda', fim);
    if (error) throw error;
    vendas = data || [];
  } catch (e) {
    console.warn('[folha] erro ao buscar vendas', e?.message);
  }

  // Agrega por vendedora_id
  const porVend = new Map();
  for (const v of vendas) {
    if (!v.vendedora_id) continue;
    if (!porVend.has(v.vendedora_id)) porVend.set(v.vendedora_id, { atacado: 0, varejo: 0, total: 0 });
    const acc = porVend.get(v.vendedora_id);
    const val = Number(v.valor_liquido || 0);
    if (v.categoria === 'atacado') acc.atacado += val;
    else if (v.categoria === 'varejo') acc.varejo += val;
    acc.total += val;
  }

  // Total por loja (independente de vendedora)
  let lojaBR = 0, lojaST = 0;
  for (const v of vendas) {
    const val = Number(v.valor_liquido || 0);
    if (v.loja === 'Bom Retiro') lojaBR += val;
    else if (v.loja === 'Silva Teles') lojaST += val;
  }

  // 2. Marketplaces — abordagem híbrida:
  //    - mktplc_liquido: espelha o que aparece em Lançamentos (receitasPorMes
  //      do payload financeiro — populado pelo módulo Bling).
  //    - mktplc_bruto: líquido / 0.9 (regra reversa, -10% devoluções).
  //    - muniam: bling_vendas_detalhe filtrado por conta (única fonte com
  //      isolamento por conta).
  //    Se receitasPorMes vier zerado (Bling ainda não sincronizado no mês),
  //    fallback automático pra bling_vendas_detalhe pra tudo.

  // 2a. Tenta espelhar Lançamentos primeiro
  let mktplcLiquido = 0;
  try {
    const { data } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'amicia-admin')
      .maybeSingle();
    const dias = data?.payload?.receitasPorMes?.[mes] || {};
    for (const dia of Object.values(dias)) {
      mktplcLiquido += Number(dia?.marketplaces || 0);
    }
  } catch (e) {
    console.warn('[folha] erro receitasPorMes:', e?.message);
  }

  // 2b. Sempre busca Muniam isolado em bling_vendas_detalhe (paginado)
  //     E acumula bruto pra fallback caso receitasPorMes esteja vazio
  let blingBruto = 0;
  let muniam = 0;
  try {
    let from = 0; const PAGE = 1000;
    while (true) {
      const { data: pedidos, error } = await supabase
        .from('bling_vendas_detalhe')
        .select('conta, total_produtos')
        .gte('data_pedido', inicio)
        .lte('data_pedido', fim)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!pedidos || pedidos.length === 0) break;
      for (const p of pedidos) {
        const v = Number(p.total_produtos || 0);
        blingBruto += v;
        if (p.conta === 'muniam') muniam += v;
      }
      if (pedidos.length < PAGE) break;
      from += PAGE;
    }
  } catch (e) {
    console.warn('[folha] erro bling_vendas_detalhe:', e?.message);
  }

  // 2c. Decide bruto: se Lançamentos tem líquido, regra reversa; senão fallback
  let mktplcBruto;
  if (mktplcLiquido > 0) {
    mktplcBruto = mktplcLiquido / 0.9;
  } else {
    mktplcBruto = blingBruto;
    mktplcLiquido = blingBruto * 0.9;
  }

  return {
    competencia,
    vendas_por_vendedora: porVend,
    vendas_loja_BR: lojaBR,
    vendas_loja_ST: lojaST,
    mktplc_bruto: mktplcBruto,
    mktplc_liquido: mktplcLiquido,
    muniam,
  };
}

function contextoPorFuncionario(funcionario, ctxGeral, vendedoras) {
  // Mapeia funcionario → vendedora_id pra puxar as vendas dela.
  // Se vendedora_id não está cadastrado no funcionario, tenta resolver
  // pelo nome (case-insensitive em nome_planilha vs lojas_vendedoras.nome).
  let vid = funcionario.vendedora_id;
  if (!vid && funcionario.categoria?.startsWith('vendedora') && vendedoras?.length) {
    const alvo = norm(funcionario.nome_planilha);
    const match = vendedoras.find(v => norm(v.nome) === alvo)
              || vendedoras.find(v => (v.aliases || []).map(norm).includes(alvo));
    if (match) vid = match.id;
  }
  const vendas_propria = (vid && ctxGeral.vendas_por_vendedora.get(vid)) || { atacado: 0, varejo: 0, total: 0 };
  return {
    competencia: ctxGeral.competencia,
    vendas_propria,
    vendas_loja_BR: ctxGeral.vendas_loja_BR,
    vendas_loja_ST: ctxGeral.vendas_loja_ST,
    mktplc_bruto: ctxGeral.mktplc_bruto,
    mktplc_liquido: ctxGeral.mktplc_liquido,
    muniam: ctxGeral.muniam,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export default function FolhaPagamento({ onVoltar, onAuxDataChange }) {
  // Persistência em amicia_data 'folha-pagamento' (linha separada)
  const [funcionarios, setFuncionarios] = useState([]);
  const [regras, setRegras] = useState({});
  const [fechamentos, setFechamentos] = useState({});
  const [valesAplicados, setValesAplicados] = useState({});
  const [carregado, setCarregado] = useState(false);

  // Estado de tela
  const [tela, setTela] = useState('home');                        // 'home' | 'detalhe'
  const [funcSelId, setFuncSelId] = useState(null);
  const [competencia, setCompetencia] = useState(competenciaAnterior());
  const [mostrarArquivados, setMostrarArquivados] = useState(false);

  // Modais
  const [modalCadastro, setModalCadastro] = useState(null);        // null | { isEdit, funcId? }
  const [modalRegras, setModalRegras] = useState(null);            // null | funcId
  const [modalPdf, setModalPdf] = useState(null);                  // null | array de funcId
  const [modalAddLinha, setModalAddLinha] = useState(null);        // null | { tipo: 'valor_fixo'|'desconto' }

  // Seleção em massa (checkbox por card)
  const [selecionados, setSelecionados] = useState({});            // { [funcId]: true }

  // Vendedoras (pra resolver vendedora_id por nome)
  const [vendedoras, setVendedoras] = useState([]);

  // Contexto de cálculo (vendas/loja/mktplc)
  const [ctxGeral, setCtxGeral] = useState(null);
  const [ctxLoading, setCtxLoading] = useState(false);

  const dirtyRef = useRef(false);
  const debounceRef = useRef(null);
  const [syncStatus, setSyncStatus] = useState(null); // 'saving'|'saved'|'error'

  // ───────── Carregar
  useEffect(() => {
    (async () => {
      // 1. Carrega payload da folha
      let payload = null;
      try {
        const { data } = await supabase
          .from('amicia_data')
          .select('payload')
          .eq('user_id', 'folha-pagamento')
          .maybeSingle();
        payload = data?.payload;
      } catch (e) {
        console.warn('[folha] carregar:', e?.message);
      }

      if (payload && Array.isArray(payload.funcionarios) && payload.funcionarios.length > 0) {
        setFuncionarios(payload.funcionarios);
        setRegras(payload.regras || {});
        setFechamentos(payload.fechamentos || {});
        setValesAplicados(payload.vales_aplicados || {});
      } else {
        // Primeira carga: bootstrap com fichas iniciais
        setFuncionarios(FUNCIONARIOS_INICIAIS);
        setRegras(REGRAS_INICIAIS);
        setFechamentos({});
        setValesAplicados({});
        dirtyRef.current = true;
      }
      setCarregado(true);

      // 2. Carrega vendedoras pro link automático
      try {
        const { data } = await supabase
          .from('lojas_vendedoras')
          .select('id, nome, loja, aliases')
          .eq('ativa', true);
        setVendedoras(data || []);
      } catch (e) {
        console.warn('[folha] vendedoras:', e?.message);
      }
    })();
  }, []);

  // ───────── Salvar (debounce 800ms)
  useEffect(() => {
    if (!carregado || !dirtyRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSyncStatus('saving');
      try {
        await supabase
          .from('amicia_data')
          .upsert({
            user_id: 'folha-pagamento',
            payload: { funcionarios, regras, fechamentos, vales_aplicados: valesAplicados },
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });
        setSyncStatus('saved');
        setTimeout(() => setSyncStatus(null), 1500);
      } catch (e) {
        console.error('[folha] salvar:', e?.message);
        setSyncStatus('error');
      }
      dirtyRef.current = false;
    }, 800);
  }, [funcionarios, regras, fechamentos, valesAplicados, carregado]);

  function marcarDirty() { dirtyRef.current = true; }

  // ───────── Carrega contexto quando muda competência
  useEffect(() => {
    if (!carregado) return;
    setCtxLoading(true);
    carregarContexto(competencia, vendedoras).then(c => {
      setCtxGeral(c);
      setCtxLoading(false);
    }).catch(e => {
      console.error('[folha] contexto:', e?.message);
      setCtxLoading(false);
    });
  }, [competencia, vendedoras, carregado]);

  // ───────── Helpers
  function listaFuncs() {
    return [...funcionarios]
      .filter(f => mostrarArquivados ? !f.ativo : f.ativo)
      .sort((a, b) => a.ordem - b.ordem);
  }

  function regrasDoFunc(funcId) {
    return regras[funcId] || [];
  }

  function fechamentoKey(funcId, comp) {
    return `${funcId}|${comp}`;
  }

  function fechamentoDoFunc(funcId, comp) {
    return fechamentos[fechamentoKey(funcId, comp)];
  }

  function ctxParaFunc(funcId) {
    if (!ctxGeral) return null;
    const f = funcionarios.find(x => x.id === funcId);
    if (!f) return null;
    return contextoPorFuncionario(f, ctxGeral, vendedoras);
  }

  function linhasCalculadas(funcId) {
    const f = funcionarios.find(x => x.id === funcId);
    if (!f) return [];
    const ctx = ctxParaFunc(funcId);
    if (!ctx) return [];
    const base = calcularRegras(f, regrasDoFunc(funcId), ctx);
    // Aplica overrides do fechamento se houver
    const fech = fechamentoDoFunc(funcId, competencia);
    const overrides = fech?.overrides || {};
    const ajustes = fech?.ajustes_manuais || [];
    let linhas = base.map(l => overrides[l.id] !== undefined
      ? { ...l, valor: Number(overrides[l.id]), _editado: true }
      : l);
    // Adiciona ajustes manuais (linhas não vinculadas a regras)
    for (const a of ajustes) {
      linhas.push({
        id: a.id, tipo: a.tipo, titulo: a.descricao || (a.tipo === 'desconto' ? 'Desconto' : 'Valor extra'),
        descricao_calculo: a.tipo === 'desconto' ? 'Desconto manual' : 'Valor manual',
        valor: a.tipo === 'desconto' ? -Math.abs(Number(a.valor || 0)) : Number(a.valor || 0),
        mes_destino: 'competencia', _ajuste: true,
      });
    }
    return linhas;
  }

  function totalFunc(funcId) {
    return linhasCalculadas(funcId).reduce((s, l) => s + Number(l.valor || 0), 0);
  }

  // ───────── Mutações
  function addFuncionario(novo) {
    const id = novo.nome_display.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') || 'func_' + rid();
    const f = {
      id, ...novo,
      ordem: (funcionarios.reduce((m, x) => Math.max(m, x.ordem || 0), 0)) + 1,
      ativo: true,
    };
    setFuncionarios(prev => [...prev, f]);
    setRegras(prev => ({ ...prev, [id]: [] }));
    marcarDirty();
    return id;
  }

  function updateFuncionario(funcId, patch) {
    setFuncionarios(prev => prev.map(f => f.id === funcId ? { ...f, ...patch } : f));
    marcarDirty();
  }

  function arquivarFuncionario(funcId) {
    setFuncionarios(prev => prev.map(f => f.id === funcId ? { ...f, ativo: false } : f));
    marcarDirty();
  }

  function reativarFuncionario(funcId) {
    setFuncionarios(prev => prev.map(f => f.id === funcId ? { ...f, ativo: true } : f));
    marcarDirty();
  }

  function setRegrasFunc(funcId, novas) {
    setRegras(prev => ({ ...prev, [funcId]: novas }));
    marcarDirty();
  }

  function setOverrideValor(funcId, regraId, valor) {
    const k = fechamentoKey(funcId, competencia);
    setFechamentos(prev => ({
      ...prev,
      [k]: {
        ...(prev[k] || { ajustes_manuais: [] }),
        overrides: { ...(prev[k]?.overrides || {}), [regraId]: valor },
      },
    }));
    marcarDirty();
  }

  function removerOverride(funcId, regraId) {
    const k = fechamentoKey(funcId, competencia);
    setFechamentos(prev => {
      const f = prev[k];
      if (!f) return prev;
      const ovs = { ...(f.overrides || {}) };
      delete ovs[regraId];
      return { ...prev, [k]: { ...f, overrides: ovs } };
    });
    marcarDirty();
  }

  function removerLinhaDoMes(funcId, regraId) {
    // Marca a linha como "valor zero" pra esse mês via override
    setOverrideValor(funcId, regraId, 0);
  }

  function addAjusteManual(funcId, ajuste) {
    const k = fechamentoKey(funcId, competencia);
    const novo = { id: rid(), ...ajuste };
    setFechamentos(prev => ({
      ...prev,
      [k]: {
        ...(prev[k] || { overrides: {} }),
        ajustes_manuais: [...(prev[k]?.ajustes_manuais || []), novo],
      },
    }));
    marcarDirty();
  }

  function removerAjuste(funcId, ajusteId) {
    const k = fechamentoKey(funcId, competencia);
    setFechamentos(prev => {
      const f = prev[k];
      if (!f) return prev;
      return {
        ...prev,
        [k]: {
          ...f,
          ajustes_manuais: (f.ajustes_manuais || []).filter(a => a.id !== ajusteId),
        },
      };
    });
    marcarDirty();
  }

  // ───────── Computa a folha de UM funcionário (puro, sem IO)
  function montarFolha(funcId) {
    const f = funcionarios.find(x => x.id === funcId);
    if (!f) return null;
    const linhas = linhasCalculadas(funcId);

    // Roteamento de meses (Ailson 03/06/2026 - fecha a folha do mês anterior):
    //   COMISSÃO -> competência (a folha que está fechando). Resto -> mês corrente/seguinte.
    // Coluna do "extra" por palavra-chave: férias/terço -> ferias; 13º/parcela 13 ->
    //   decimo_terceiro; coluna real já definida -> ela; qualquer outro -> extra.
    // Regra do dono: nenhum valor positivo pode ficar sem coluna.
    const COLS_REAIS = ['alimentacao', 'extra', 'ferias', 'decimo_terceiro', 'rescisao'];
    const deburr = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const ehFerias = (t) => /feria|terco/.test(t);
    const eh13 = (t) => /decimo terceiro/.test(t) || /(^|\D)13(\D|$)/.test(t);
    const colunaDoExtra = (l) => {
      const t = deburr(l.titulo);
      if (ehFerias(t) || l.coluna_planilha === 'ferias')      return 'ferias';
      if (eh13(t) || l.coluna_planilha === 'decimo_terceiro') return 'decimo_terceiro';
      if (l.coluna_planilha && COLS_REAIS.includes(l.coluna_planilha)) return l.coluna_planilha;
      return 'extra';
    };

    let salarioTotal = 0, comissaoTotal = 0;
    const acrescimos = [];
    for (const l of linhas) {
      // Empréstimos e descontos: NÃO entram em coluna nenhuma (regra Ailson 15/05/2026).
      if (l.tipo === 'desconto' || l.tipo === 'emprestimo') continue;
      const v = Number(l.valor || 0);
      if (['comissao_propria', 'comissao_loja', 'comissao_marketplace', 'bonus_meta_individual'].includes(l.tipo)) {
        comissaoTotal += v;
      } else if (l.tipo === 'salario_fixo') {
        salarioTotal += v;
      } else {
        acrescimos.push({ mes_destino: 'seguinte', coluna: colunaDoExtra(l), descricao: l.titulo, valor: v });
      }
    }
    const acrescimosAgrupados = {};
    for (const a of acrescimos) {
      const k = `${a.mes_destino}|${a.coluna}`;
      acrescimosAgrupados[k] = (acrescimosAgrupados[k] || 0) + a.valor;
    }

    const valeRegra = (regrasDoFunc(funcId) || []).find(r => r.tipo === 'vale_pago' && r.ativo);
    const valeValor = Number(valeRegra?.config?.valor || 0);

    const compSeguinte = competenciaSeguinte(competencia);
    const [, mesComp] = competencia.split('-').map(Number);
    const [, mesSeg] = compSeguinte.split('-').map(Number);

    return { f, funcId, linhas, salarioTotal, comissaoTotal, acrescimos, acrescimosAgrupados, valeValor, compSeguinte, mesComp, mesSeg };
  }

  // ───────── Escreve a folha de UM funcionário no payload (cria linha se faltar)
  function aplicarFolhaNoPayload(payload, m) {
    payload.auxDataPorMes = payload.auxDataPorMes || {};
    const { f, salarioTotal, comissaoTotal, acrescimosAgrupados, valeValor, mesComp, mesSeg } = m;

    const novaLinhaFunc = (nome) => ({
      nome, salario: '', comissao: '', extra: '', alimentacao: '',
      vale: '', ferias: '', decimo_terceiro: '', rescisao: '',
    });
    const escrever = (mesNum, campos) => {
      if (!payload.auxDataPorMes[mesNum]) payload.auxDataPorMes[mesNum] = {};
      if (!payload.auxDataPorMes[mesNum]['Funcionários']) payload.auxDataPorMes[mesNum]['Funcionários'] = [];
      const arr = payload.auxDataPorMes[mesNum]['Funcionários'];
      const alvo = norm(f.nome_planilha || f.nome_display);
      let idx = arr.findIndex(r => norm(r.nome) === alvo);
      let criou = false;
      if (idx === -1) {
        arr.push(novaLinhaFunc(f.nome_planilha || f.nome_display));
        idx = arr.length - 1;
        criou = true;
      }
      for (const [k, v] of Object.entries(campos)) arr[idx][k] = String(v);
      return { criou };
    };

    const r1 = escrever(mesSeg, { salario: salarioTotal.toFixed(2) });
    const r2 = escrever(mesComp, { comissao: comissaoTotal.toFixed(2) });
    for (const [k, valor] of Object.entries(acrescimosAgrupados)) {
      const [mesDestino, coluna] = k.split('|');
      const mesNum = mesDestino === 'seguinte' ? mesSeg : mesComp;
      escrever(mesNum, { [coluna]: valor.toFixed(2) });
    }
    // Vale -> mês corrente (mesSeg), igual ao cron dia 20. Só se ainda não estiver lá.
    if (valeValor > 0) {
      const arr = payload.auxDataPorMes[mesSeg]?.['Funcionários'] || [];
      const alvo = norm(f.nome_planilha || f.nome_display);
      const linha = arr.find(r => norm(r.nome) === alvo);
      if (linha) {
        const valeAtual = parseFloat(linha.vale || 0);
        if (Math.abs(valeAtual - valeValor) > 0.01) linha.vale = valeValor.toFixed(2);
      }
    }
    return { r1, r2 };
  }

  // ───────── Marcar UM como pago
  async function marcarPago(funcId) {
    const m = montarFolha(funcId);
    if (!m) return;
    const { f, salarioTotal, comissaoTotal, valeValor, acrescimos, compSeguinte } = m;

    const labelColuna = (key) => (COLUNAS_PLANILHA_ACRESCIMO.find(c => c.key === key)?.label) || key;
    const acrescimosResumo = acrescimos
      .map(a => `• ${a.descricao} R$ ${a.valor.toFixed(2).replace('.',',')} → ${nomeMes(compSeguinte)} (coluna ${labelColuna(a.coluna)})`)
      .join('\n');

    if (!confirm(
      `Marcar ${f.nome_display} como pago - ${nomeMes(competencia)}?\n\n` +
      `Vai escrever na planilha:\n` +
      `• Salário R$ ${salarioTotal.toFixed(2).replace('.',',')} → ${nomeMes(compSeguinte)} (mês de pagamento)\n` +
      `• Comissão R$ ${comissaoTotal.toFixed(2).replace('.',',')} → ${nomeMes(competencia)} (competência)\n` +
      (valeValor > 0 ? `• Vale R$ ${valeValor.toFixed(2).replace('.',',')} → ${nomeMes(compSeguinte)} (se ainda não estiver lá)\n` : '') +
      (acrescimosResumo ? acrescimosResumo + '\n' : '') +
      `\nContinuar?`
    )) return;

    try {
      const { data: dado } = await supabase
        .from('amicia_data').select('payload').eq('user_id', 'amicia-admin').maybeSingle();
      if (!dado?.payload) { alert('Payload financeiro não encontrado.'); return; }
      const payload = dado.payload;

      const { r1, r2 } = aplicarFolhaNoPayload(payload, m);

      // FIX RACE CONDITION (Ailson 15/05/2026): avisa o App.tsx ANTES de gravar,
      // pra o autosave do pai não sobrescrever com state stale.
      onAuxDataChange?.(payload.auxDataPorMes);
      await supabase
        .from('amicia_data').update({ payload, updated_at: new Date().toISOString() }).eq('user_id', 'amicia-admin');

      const k = fechamentoKey(funcId, competencia);
      setFechamentos(prev => ({
        ...prev,
        [k]: {
          ...(prev[k] || {}),
          snapshot: {
            linhas: m.linhas, totalSalario: salarioTotal, totalComissao: comissaoTotal,
            totalGeral: salarioTotal + comissaoTotal, vale: valeValor,
          },
          pago_em: new Date().toISOString(),
        },
      }));
      marcarDirty();

      const avisos = [];
      if (r1.criou) avisos.push(`+ Linha de ${f.nome_planilha} criada em ${nomeMes(compSeguinte)}.`);
      if (r2.criou) avisos.push(`+ Linha de ${f.nome_planilha} criada em ${nomeMes(competencia)}.`);
      alert(`✓ ${f.nome_display} marcada como pago.\n\n` +
        `Salário R$ ${salarioTotal.toFixed(2).replace('.',',')} → ${nomeMes(compSeguinte)} ✓\n` +
        `Comissão R$ ${comissaoTotal.toFixed(2).replace('.',',')} → ${nomeMes(competencia)} ✓\n` +
        (avisos.length ? '\n' + avisos.join('\n') : ''));
    } catch (e) {
      console.error('[folha] marcar pago:', e?.message);
      alert('Erro ao marcar pago: ' + e?.message);
    }
  }

  // ───────── Marcar VÁRIOS como pago (um confirm, uma gravação, um resumo)
  async function marcarVariosPago(ids) {
    const montagens = ids.map(montarFolha).filter(Boolean);
    if (!montagens.length) return;
    const compSeguinte = competenciaSeguinte(competencia);
    const totalGeral = montagens.reduce((s, m) => s + m.salarioTotal + m.comissaoTotal, 0);

    if (!confirm(
      `Marcar ${montagens.length} funcionário(s) como pago - ${nomeMes(competencia)}?\n\n` +
      `• Comissão → ${nomeMes(competencia)} (competência)\n` +
      `• Salário e demais → ${nomeMes(compSeguinte)} (mês de pagamento)\n\n` +
      `Total geral: R$ ${totalGeral.toFixed(2).replace('.',',')}\n\nContinuar?`
    )) return;

    try {
      const { data: dado } = await supabase
        .from('amicia_data').select('payload').eq('user_id', 'amicia-admin').maybeSingle();
      if (!dado?.payload) { alert('Payload financeiro não encontrado.'); return; }
      const payload = dado.payload;

      for (const m of montagens) aplicarFolhaNoPayload(payload, m);

      onAuxDataChange?.(payload.auxDataPorMes);
      await supabase
        .from('amicia_data').update({ payload, updated_at: new Date().toISOString() }).eq('user_id', 'amicia-admin');

      const agora = new Date().toISOString();
      setFechamentos(prev => {
        const next = { ...prev };
        for (const m of montagens) {
          const k = fechamentoKey(m.funcId, competencia);
          next[k] = {
            ...(next[k] || {}),
            snapshot: {
              linhas: m.linhas, totalSalario: m.salarioTotal, totalComissao: m.comissaoTotal,
              totalGeral: m.salarioTotal + m.comissaoTotal, vale: m.valeValor,
            },
            pago_em: agora,
          };
        }
        return next;
      });
      marcarDirty();
      setSelecionados({});
      alert(`✓ ${montagens.length} funcionário(s) marcado(s) como pago - ${nomeMes(competencia)}.`);
    } catch (e) {
      console.error('[folha] marcar varios pago:', e?.message);
      alert('Erro ao marcar pago: ' + e?.message);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  if (!carregado) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: palette.inkMuted, fontFamily: FONT, background: palette.bg, minHeight: '100vh' }}>
        Carregando...
      </div>
    );
  }

  const funcSel = funcSelId ? funcionarios.find(f => f.id === funcSelId) : null;

  return (
    <div style={{ background: palette.bg, minHeight: '100vh', fontFamily: FONT, color: palette.ink, colorScheme: 'light' }}>
      {/* Top bar */}
      <div style={{
        background: '#fff', borderBottom: `1px solid ${palette.beige}`,
        padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button onClick={tela === 'home' ? onVoltar : () => setTela('home')}
          onMouseEnter={e=>{ e.currentTarget.style.background = palette.accent; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e=>{ e.currentTarget.style.background = palette.accentSoft; e.currentTarget.style.color = palette.accent; }}
          style={{
            background: palette.accentSoft, color: palette.accent,
            border: `1px solid ${palette.accent}`,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: FONT, fontSize: 14, fontWeight: 600,
            padding: '7px 16px', borderRadius: 20,
            transition: 'all 0.15s',
          }}>
          <ArrowLeft size={17} strokeWidth={2} />
          {tela === 'home' ? 'Voltar' : 'Folha'}
        </button>
        <div style={{ flex: 1 }} />
        {syncStatus && (
          <span style={{ fontSize: 12, color: syncStatus === 'error' ? palette.alert : palette.ok }}>
            {syncStatus === 'saving' ? 'salvando...' : syncStatus === 'saved' ? '✓ salvo' : '✕ erro'}
          </span>
        )}
      </div>

      {tela === 'home' && (
        <HomeFolha
          funcionarios={listaFuncs()}
          allFuncs={funcionarios}
          regras={regras}
          competencia={competencia}
          setCompetencia={setCompetencia}
          fechamentos={fechamentos}
          ctxGeral={ctxGeral}
          ctxLoading={ctxLoading}
          totalFunc={totalFunc}
          onAbrirDetalhe={(id) => { setFuncSelId(id); setTela('detalhe'); }}
          onAbrirCadastro={() => setModalCadastro({ isEdit: false })}
          mostrarArquivados={mostrarArquivados}
          setMostrarArquivados={setMostrarArquivados}
          onReativar={reativarFuncionario}
          selecionados={selecionados}
          onToggleSel={(id) => setSelecionados(prev => { const n = { ...prev }; if (n[id]) delete n[id]; else n[id] = true; return n; })}
          onToggleTodos={(ids) => setSelecionados(prev => {
            const todos = ids.length > 0 && ids.every(id => prev[id]);
            if (todos) return {};
            const n = {}; ids.forEach(id => { n[id] = true; }); return n;
          })}
          onMarcarVarios={(ids) => marcarVariosPago(ids)}
          onGerarPdfVarios={(ids) => setModalPdf(ids)}
        />
      )}

      {tela === 'detalhe' && funcSel && (
        <DetalheFolha
          funcionario={funcSel}
          regras={regrasDoFunc(funcSelId)}
          linhas={linhasCalculadas(funcSelId)}
          fechamento={fechamentoDoFunc(funcSelId, competencia)}
          competencia={competencia}
          ctxLoading={ctxLoading}
          onEditarRegras={() => setModalRegras(funcSelId)}
          onEditarValor={(regraId, valor) => setOverrideValor(funcSelId, regraId, valor)}
          onResetValor={(regraId) => removerOverride(funcSelId, regraId)}
          onRemoverLinha={(regraId) => removerLinhaDoMes(funcSelId, regraId)}
          onAddLinha={(tipo) => setModalAddLinha({ tipo })}
          onRemoverAjuste={(ajusteId) => removerAjuste(funcSelId, ajusteId)}
          onMarcarPago={() => marcarPago(funcSelId)}
          onGerarPdf={() => setModalPdf([funcSelId])}
          onArquivar={() => {
            if (confirm(`Arquivar ${funcSel.nome_display}?\nFunciona como soft-delete: o histórico de fechamentos passados continua, e você pode reativar quando quiser.`)) {
              arquivarFuncionario(funcSelId);
              setTela('home');
            }
          }}
          onEditarFunc={() => setModalCadastro({ isEdit: true, funcId: funcSelId })}
        />
      )}

      {/* Modais */}
      {modalCadastro && (
        <ModalCadastro
          editar={modalCadastro.isEdit ? funcionarios.find(f => f.id === modalCadastro.funcId) : null}
          onClose={() => setModalCadastro(null)}
          onSalvar={(dados) => {
            if (modalCadastro.isEdit) updateFuncionario(modalCadastro.funcId, dados);
            else {
              const novoId = addFuncionario(dados);
              setModalCadastro(null);
              setModalRegras(novoId);  // já abre as regras pra configurar
              return;
            }
            setModalCadastro(null);
          }}
        />
      )}

      {modalRegras && (
        <ModalRegras
          funcionario={funcionarios.find(f => f.id === modalRegras)}
          regras={regrasDoFunc(modalRegras)}
          onClose={() => setModalRegras(null)}
          onSalvar={(novas) => { setRegrasFunc(modalRegras, novas); setModalRegras(null); }}
        />
      )}

      {modalAddLinha && funcSelId && (
        <ModalAddLinha
          tipo={modalAddLinha.tipo}
          onClose={() => setModalAddLinha(null)}
          onSalvar={(ajuste) => { addAjusteManual(funcSelId, ajuste); setModalAddLinha(null); }}
        />
      )}

      {modalPdf && (
        <ModalPdf
          itens={(Array.isArray(modalPdf) ? modalPdf : [modalPdf])
            .map(id => ({
              funcionario: funcionarios.find(f => f.id === id),
              linhas: linhasCalculadas(id),
              fechamento: fechamentoDoFunc(id, competencia),
            }))
            .filter(it => it.funcionario)}
          competencia={competencia}
          onClose={() => setModalPdf(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TELA HOME — Grid de cards
// ═══════════════════════════════════════════════════════════════════════════

function HomeFolha({
  funcionarios, allFuncs, regras, competencia, setCompetencia, fechamentos, ctxGeral, ctxLoading,
  totalFunc, onAbrirDetalhe, onAbrirCadastro, mostrarArquivados, setMostrarArquivados, onReativar,
  selecionados, onToggleSel, onToggleTodos, onMarcarVarios, onGerarPdfVarios,
}) {
  const totalPrevisto = funcionarios.reduce((s, f) => s + totalFunc(f.id), 0);
  const pagos = funcionarios.filter(f => fechamentos[`${f.id}|${competencia}`]?.pago_em).length;
  const totalVales = funcionarios.reduce((s, f) => {
    const v = (regras[f.id] || []).find(r => r.tipo === 'vale_pago' && r.ativo);
    return s + Number(v?.config?.valor || 0);
  }, 0);
  const arquivados = allFuncs.filter(f => !f.ativo).length;

  // Gera opções de competência (12 meses pra trás + atual)
  const opcoes = useMemo(() => {
    const arr = [];
    const d = new Date();
    for (let i = 0; i < 13; i++) {
      const c = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      arr.push(c);
      d.setMonth(d.getMonth() - 1);
    }
    return arr;
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: palette.inkMuted }}>Grupo Amícia</div>
          <div style={{ fontSize: 23, fontWeight: 700, color: palette.ink }}>Folha de Pagamento</div>
        </div>
        <select value={competencia} onChange={e => setCompetencia(e.target.value)}
          style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '8px 14px', fontFamily: FONT, fontSize: 14, color: palette.ink, cursor: 'pointer', colorScheme: 'light' }}>
          {opcoes.map(c => <option key={c} value={c}>{nomeMes(c)}</option>)}
        </select>
      </div>

      {/* Resumo */}
      <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 12, padding: '14px 20px',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 18 }}>
        <ResumoCell label="Funcionários" valor={String(funcionarios.length)} />
        <ResumoCell label="Total previsto" valor={fmtBRL(totalPrevisto)} />
        <ResumoCell label="Já pagos" valor={`${pagos} / ${funcionarios.length}`} />
        <ResumoCell label="Vales (dia 20)" valor={fmtBRL(totalVales)} />
      </div>

      {ctxLoading && (
        <div style={{ background: palette.warnSoft, color: palette.warn, padding: 10, borderRadius: 8, fontSize: 13, marginBottom: 12, textAlign: 'center' }}>
          Carregando vendas do mês...
        </div>
      )}

      {/* Toggle arquivados */}
      {(arquivados > 0 || mostrarArquivados) && (
        <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setMostrarArquivados(!mostrarArquivados)}
            style={{ background: 'none', border: 'none', color: palette.accent, fontFamily: FONT, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {mostrarArquivados ? '↶ Voltar pros ativos' : `Mostrar arquivados (${arquivados})`}
          </button>
        </div>
      )}

      {/* Barra de seleção em massa */}
      {!mostrarArquivados && funcionarios.length > 0 && (() => {
        const idsVisiveis = funcionarios.map(f => f.id);
        const idsSel = idsVisiveis.filter(id => selecionados?.[id]);
        const todosMarcados = idsSel.length === idsVisiveis.length;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14,
            background: idsSel.length ? palette.accentSoft : '#fff',
            border: `1px solid ${idsSel.length ? palette.accent + '55' : palette.beige}`,
            borderRadius: 10, padding: '10px 14px', transition: 'all 0.15s' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: palette.ink, fontWeight: 600 }}>
              <input type="checkbox" checked={todosMarcados}
                onChange={() => onToggleTodos(idsVisiveis)}
                style={{ width: 17, height: 17, accentColor: palette.accent, cursor: 'pointer' }} />
              Selecionar todos
            </label>
            <span style={{ fontSize: 13, color: palette.inkMuted }}>
              {idsSel.length > 0 ? `${idsSel.length} selecionado(s)` : 'Nenhum selecionado'}
            </span>
            {idsSel.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
                <button onClick={() => onMarcarVarios(idsSel)}
                  style={{ background: palette.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px',
                    fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Check size={15} strokeWidth={1.5} /> Marcar {idsSel.length} como pago
                </button>
                <button onClick={() => onGerarPdfVarios(idsSel)}
                  style={{ background: '#fff', color: palette.ink, border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '8px 14px',
                    fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Printer size={15} strokeWidth={1.5} /> Gerar PDF ({idsSel.length})
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Grid de cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {funcionarios.map(f => (
          <CardFunc key={f.id} f={f} total={totalFunc(f.id)}
            pago={!!fechamentos[`${f.id}|${competencia}`]?.pago_em}
            pagoEm={fechamentos[`${f.id}|${competencia}`]?.pago_em}
            arquivado={!f.ativo}
            selecionavel={!mostrarArquivados}
            selecionado={!!selecionados?.[f.id]}
            onToggleSel={() => onToggleSel(f.id)}
            onClick={() => mostrarArquivados ? null : onAbrirDetalhe(f.id)}
            onReativar={() => onReativar(f.id)}
          />
        ))}
        {funcionarios.length === 0 && (
          <div style={{ gridColumn: '1/-1', padding: 40, textAlign: 'center', color: palette.inkMuted, fontSize: 14 }}>
            {mostrarArquivados ? 'Nenhum funcionário arquivado.' : 'Nenhum funcionário cadastrado. Clique em "Novo funcionário".'}
          </div>
        )}
      </div>

      {/* Botão flutuante */}
      <button onClick={onAbrirCadastro}
        style={{ position: 'fixed', bottom: 24, right: 24, background: palette.ink, color: '#fff', border: 'none', borderRadius: 50, padding: '14px 22px',
          fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 4px 12px rgba(44,62,80,0.2)', zIndex: 50 }}>
        <Plus size={17} strokeWidth={1.5} />
        Novo funcionário
      </button>
    </div>
  );
}

function ResumoCell({ label, valor }) {
  return (
    <div>
      <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: palette.inkMuted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: NUM, fontSize: 15, fontWeight: 700, color: palette.ink }}>{valor}</div>
    </div>
  );
}

function CardFunc({ f, total, pago, pagoEm, arquivado, onClick, onReativar, selecionavel, selecionado, onToggleSel }) {
  const cat = CAT_INFO[f.categoria] || CAT_INFO.outro;
  return (
    <div onClick={onClick}
      style={{
        background: arquivado ? palette.beigeSoft : pago ? '#f5f9f3' : '#fff',
        border: `1px solid ${pago ? palette.ok + '40' : palette.beige}`,
        borderRadius: 12, padding: 16, cursor: arquivado ? 'default' : 'pointer',
        transition: 'all 0.15s', position: 'relative', opacity: arquivado ? 0.7 : 1,
        outline: selecionado ? `2px solid ${palette.accent}` : 'none', outlineOffset: -2,
      }}
      onMouseEnter={e => { if (!arquivado) { e.currentTarget.style.borderColor = palette.accent; e.currentTarget.style.transform = 'translateY(-2px)'; } }}
      onMouseLeave={e => { if (!arquivado) { e.currentTarget.style.borderColor = pago ? palette.ok + '40' : palette.beige; e.currentTarget.style.transform = 'translateY(0)'; } }}
    >
      {pago && (
        <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 11, padding: '2px 8px', borderRadius: 10, letterSpacing: 0.5,
          background: palette.okSoft, color: palette.ok }}>
          Pago {pagoEm ? new Date(pagoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}
        </span>
      )}
      {!pago && !arquivado && (
        <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 11, padding: '2px 8px', borderRadius: 10, letterSpacing: 0.5,
          background: palette.warnSoft, color: palette.warn }}>
          Pendente
        </span>
      )}
      {arquivado && (
        <button onClick={(e) => { e.stopPropagation(); onReativar(); }}
          style={{ position: 'absolute', top: 10, right: 10, fontSize: 11, padding: '2px 8px', borderRadius: 10, letterSpacing: 0.5,
            background: palette.beige, color: palette.archive, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <RotateCcw size={11} strokeWidth={1.5} />
          Reativar
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {selecionavel && (
          <input type="checkbox" checked={!!selecionado}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => { e.stopPropagation(); onToggleSel?.(); }}
            style={{ width: 18, height: 18, accentColor: palette.accent, cursor: 'pointer', flexShrink: 0 }} />
        )}
        <div style={{
          width: 38, height: 38, borderRadius: '50%', background: palette.beigeSoft, color: palette.ink,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontFamily: NUM, fontSize: 15, flexShrink: 0,
        }}>{iniciais(f.nome_display)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: palette.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {f.nome_display}
          </div>
          <span style={{ display: 'inline-block', fontSize: 11, letterSpacing: 0.5, color: cat.cor, background: cat.bg,
            padding: '2px 8px', borderRadius: 10, marginTop: 3 }}>{cat.label}</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10, borderTop: `1px dashed ${palette.beige}` }}>
        <span style={{ fontSize: 12, color: palette.inkMuted, letterSpacing: 0.5 }}>Total a pagar</span>
        <span style={{ fontFamily: NUM, fontSize: 15, fontWeight: 700, color: palette.ink }}>{fmtBRL(total)}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TELA DETALHE — Card de fechamento
// ═══════════════════════════════════════════════════════════════════════════

function DetalheFolha({
  funcionario: f, regras, linhas, fechamento, competencia, ctxLoading,
  onEditarRegras, onEditarValor, onResetValor, onRemoverLinha,
  onAddLinha, onRemoverAjuste, onMarcarPago, onGerarPdf, onArquivar, onEditarFunc,
}) {
  const cat = CAT_INFO[f.categoria] || CAT_INFO.outro;
  const total = linhas.reduce((s, l) => s + Number(l.valor || 0), 0);
  const pago = !!fechamento?.pago_em;
  const dataPagamento = new Date(); // 5º dia útil seria o ideal, mas mostra hoje

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px' }}>

      {/* Header funcionário */}
      <div style={{
        background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: '12px 12px 0 0',
        padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', background: palette.beigeSoft, color: palette.ink,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: NUM, fontSize: 23, flexShrink: 0,
        }}>{iniciais(f.nome_display)}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 23, fontWeight: 700, color: palette.ink }}>{f.nome_display}</div>
          <div style={{ fontSize: 13, color: palette.inkMuted, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-block', fontSize: 11, color: cat.cor, background: cat.bg, padding: '2px 8px', borderRadius: 10 }}>
              {cat.label}
            </span>
            <span>Fechamento {nomeMes(competencia)}</span>
            {f.nome_planilha !== f.nome_display && (
              <span style={{ fontSize: 11, fontStyle: 'italic' }}>· planilha: {f.nome_planilha}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onEditarFunc} style={btnSecStyle()}>
            <Edit2 size={15} strokeWidth={1.5} /> Funcionário
          </button>
          <button onClick={onEditarRegras} style={btnSecStyle()}>
            <Settings size={15} strokeWidth={1.5} /> Regras
          </button>
        </div>
      </div>

      {/* Lista de linhas */}
      <div style={{
        background: '#fff', border: `1px solid ${palette.beige}`, borderTop: 'none',
        borderRadius: '0 0 12px 12px', padding: '20px 24px',
      }}>
        {ctxLoading && (
          <div style={{ padding: 14, textAlign: 'center', color: palette.inkMuted, fontSize: 13, fontStyle: 'italic' }}>
            Calculando comissões...
          </div>
        )}

        {linhas.length === 0 && !ctxLoading && (
          <div style={{ padding: 30, textAlign: 'center', color: palette.inkMuted, fontSize: 14 }}>
            Nenhuma regra ativa. Clique em <b>Regras</b> pra configurar.
          </div>
        )}

        {linhas.map(l => (
          <LinhaCalculada key={l.id} l={l}
            onEditar={(v) => onEditarValor(l.id, v)}
            onResetar={() => onResetValor(l.id)}
            onRemover={() => l._ajuste ? onRemoverAjuste(l.id) : onRemoverLinha(l.id)}
          />
        ))}

        {/* Adicionar */}
        {!pago && (
          <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}>
            <button onClick={() => onAddLinha('valor_fixo')} style={btnAddStyle(palette.ok)}>
              <Plus size={15} strokeWidth={1.5} /> Adicionar valor
            </button>
            <button onClick={() => onAddLinha('desconto')} style={btnAddStyle(palette.alert)}>
              <Minus size={15} strokeWidth={1.5} /> Adicionar desconto
            </button>
          </div>
        )}

        {/* Total */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '18px 0 10px', borderTop: `2px solid ${palette.ink}`, marginTop: 10,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: palette.ink, letterSpacing: 0.5, textTransform: 'uppercase' }}>Total a pagar</div>
            <div style={{ fontSize: 12, color: palette.inkMuted, marginTop: 2 }}>
              {pago
                ? `Pago em ${new Date(fechamento.pago_em).toLocaleDateString('pt-BR')}`
                : `Pagamento previsto em ${dataPagamento.toLocaleDateString('pt-BR')}`}
            </div>
          </div>
          <div style={{ fontFamily: NUM, fontSize: 19, fontWeight: 700, color: palette.ink }}>{fmtBRL(total)}</div>
        </div>

        {/* Ações finais */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20, flexWrap: 'wrap' }}>
          <button onClick={onArquivar} style={{ ...btnSecStyle(), color: palette.alert }}>
            <Archive size={15} strokeWidth={1.5} /> Arquivar funcionário
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onGerarPdf} style={btnSecStyle()}>
            <FileText size={15} strokeWidth={1.5} /> Gerar PDF
          </button>
          {!pago && (
            <button onClick={onMarcarPago} style={{
              background: palette.ok, color: '#fff', border: 'none', borderRadius: 8, padding: '11px 22px',
              fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <Check size={15} strokeWidth={1.5} /> Marcar pago
            </button>
          )}
          {pago && (
            <span style={{ fontSize: 13, color: palette.ok, padding: '11px 22px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={15} strokeWidth={1.5} /> Pago
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LinhaCalculada({ l, onEditar, onResetar, onRemover }) {
  const [editando, setEditando] = useState(false);
  const [valorEdit, setValorEdit] = useState(String(l.valor.toFixed(2)));
  const isDesconto = Number(l.valor) < 0;

  function salvar() {
    const v = parseFloat(valorEdit.replace(',', '.')) || 0;
    onEditar(isDesconto ? -Math.abs(v) : Math.abs(v));
    setEditando(false);
  }

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14, alignItems: 'center',
      padding: '14px 0', borderBottom: `1px solid ${palette.beigeSoft}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 15, color: palette.ink, fontWeight: 600 }}>{l.titulo}</div>
        {l.descricao_calculo && (
          <div style={{ fontSize: 12, color: palette.inkMuted, marginTop: 2 }}>{l.descricao_calculo}</div>
        )}
        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {l.mes_destino && (
            <span style={{
              fontSize: 10, textTransform: 'uppercase', letterSpacing: 1,
              color: l.mes_destino === 'seguinte' ? '#b88a3d' : palette.accent,
              background: l.mes_destino === 'seguinte' ? '#f5ecdc' : '#e8f0f7',
              padding: '2px 6px', borderRadius: 4,
            }}>
              → Planilha {l.mes_destino === 'seguinte' ? 'mês seguinte' : 'mês competência'}
            </span>
          )}
          {l._editado && (
            <span style={{ fontSize: 10, color: palette.warn, background: palette.warnSoft, padding: '2px 6px', borderRadius: 4, letterSpacing: 1, textTransform: 'uppercase' }}>
              Editado manual
            </span>
          )}
          {l._ajuste && (
            <span style={{ fontSize: 10, color: palette.ok, background: palette.okSoft, padding: '2px 6px', borderRadius: 4, letterSpacing: 1, textTransform: 'uppercase' }}>
              Manual
            </span>
          )}
        </div>
      </div>
      <div style={{ minWidth: 110, textAlign: 'right' }}>
        {editando ? (
          <input
            type="number" step="0.01" autoFocus
            value={valorEdit} onChange={e => setValorEdit(e.target.value)}
            onBlur={salvar}
            onKeyDown={e => { if (e.key === 'Enter') salvar(); if (e.key === 'Escape') setEditando(false); }}
            style={{
              width: 100, padding: '6px 10px', border: `1px solid ${palette.accent}`, borderRadius: 6,
              fontFamily: NUM, fontSize: 14, fontWeight: 600, textAlign: 'right', color: palette.ink, outline: 'none', colorScheme: 'light', background: '#fff',
            }}
          />
        ) : (
          <span onClick={() => setEditando(true)} style={{
            fontFamily: NUM, fontSize: 14, fontWeight: 600,
            color: isDesconto ? palette.alert : palette.ink, cursor: 'pointer',
          }}>{fmtBRL(Math.abs(l.valor)) + (isDesconto ? '' : '')}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {l._editado && (
          <button onClick={onResetar} title="Voltar ao valor calculado" style={iconBtnStyle()}>
            <RotateCcw size={13} strokeWidth={1.5} />
          </button>
        )}
        <button onClick={() => setEditando(!editando)} title="Editar valor" style={iconBtnStyle()}>
          <Edit2 size={13} strokeWidth={1.5} />
        </button>
        <button onClick={onRemover} title="Remover desse mês" style={iconBtnStyle('danger')}>
          <Trash2 size={13} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL: CADASTRAR / EDITAR FUNCIONÁRIO
// ═══════════════════════════════════════════════════════════════════════════

function ModalCadastro({ editar, onClose, onSalvar }) {
  const [nome, setNome] = useState(editar?.nome_display || '');
  const [nomePlanilha, setNomePlanilha] = useState(editar?.nome_planilha || '');
  const [categoria, setCategoria] = useState(editar?.categoria || 'mktplc');
  const [linhasPlanilha, setLinhasPlanilha] = useState([]);

  // Auto-popula nome_planilha se vazio
  useEffect(() => {
    if (!nomePlanilha && nome) setNomePlanilha(nome.toUpperCase());
  }, [nome]);

  // Carrega nomes da planilha do mês corrente pra validar
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('amicia_data')
          .select('payload')
          .eq('user_id', 'amicia-admin')
          .maybeSingle();
        const mesAtual = new Date().getMonth() + 1;
        const arr = data?.payload?.auxDataPorMes?.[mesAtual]?.['Funcionários'] || [];
        setLinhasPlanilha(arr.map(r => String(r.nome || '').trim()));
      } catch (e) {}
    })();
  }, []);

  const matchPlanilha = useMemo(() => {
    const alvo = norm(nomePlanilha);
    return linhasPlanilha.find(n => norm(n) === alvo);
  }, [nomePlanilha, linhasPlanilha]);

  function salvar() {
    if (!nome.trim()) { alert('Nome obrigatório'); return; }
    onSalvar({
      nome_display: nome.trim(),
      nome_planilha: (nomePlanilha || nome).trim().toUpperCase(),
      categoria,
    });
  }

  return (
    <ModalBox onClose={onClose} titulo={editar ? `Editar ${editar.nome_display}` : 'Novo funcionário'}>
      <div style={{ marginBottom: 14 }}>
        <Label>Nome (aparece no card e PDF)</Label>
        <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex: Fran" />
      </div>

      <div style={{ marginBottom: 14 }}>
        <Label>Nome na planilha (chave pra match na planilha de Funcionários)</Label>
        <Input value={nomePlanilha} onChange={e => setNomePlanilha(e.target.value)} placeholder="Ex: FRANCISCA" />
        {nomePlanilha.trim() && (matchPlanilha
          ? <div style={alertStyle('ok')}><CheckCircle2 size={13} strokeWidth={1.5} /> Encontrado na planilha do mês: <b>{matchPlanilha}</b></div>
          : <div style={alertStyle('warn')}><AlertCircle size={13} strokeWidth={1.5} /> Não encontrado — você vai precisar criar a linha manual</div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <Label>Categoria</Label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {Object.entries(CAT_INFO).map(([k, info]) => (
            <label key={k} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              border: `1px solid ${categoria === k ? palette.accent : palette.beige}`, borderRadius: 6, cursor: 'pointer', fontSize: 13,
              background: categoria === k ? palette.accentSoft : '#fff',
            }}>
              <input type="radio" checked={categoria === k} onChange={() => setCategoria(k)} />
              {info.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: `1px solid ${palette.beige}`, marginTop: 16, paddingTop: 16 }}>
        <button onClick={onClose} style={btnSecStyle()}>Cancelar</button>
        <button onClick={salvar} style={btnPrimaryStyle()}>
          {editar ? 'Salvar' : 'Criar e configurar regras'}
        </button>
      </div>
    </ModalBox>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL: EDITAR REGRAS
// ═══════════════════════════════════════════════════════════════════════════

function ModalRegras({ funcionario: f, regras: regrasIn, onClose, onSalvar }) {
  const [regras, setRegras] = useState(() => regrasIn.map(r => ({ ...r, config: { ...r.config, faixas: r.config?.faixas ? [...r.config.faixas] : undefined } })));
  const [tipoNovo, setTipoNovo] = useState('comissao_propria');

  function addRegra() {
    const cfgPadrao = configPadrao(tipoNovo);
    setRegras(prev => [...prev, { id: rid(), tipo: tipoNovo, config: cfgPadrao, ordem: prev.length + 1, ativo: true }]);
  }
  function removerRegra(id) { setRegras(prev => prev.filter(r => r.id !== id)); }
  function updateRegra(id, patch) {
    setRegras(prev => prev.map(r => r.id === id ? { ...r, ...patch, config: { ...r.config, ...(patch.config || {}) } } : r));
  }

  return (
    <ModalBox onClose={onClose} titulo={`Regras base — ${f.nome_display}`} maxWidth={650}>
      <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 14, fontStyle: 'italic' }}>
        Mudanças aqui valem pra esse mês e os próximos. Pra mudar só nesse mês, edita direto no card.
      </div>

      {regras.sort((a, b) => a.ordem - b.ordem).map(r => (
        <RegraEditor key={r.id} regra={r}
          onChange={(patch) => updateRegra(r.id, patch)}
          onRemover={() => removerRegra(r.id)}
        />
      ))}

      {regras.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', color: palette.inkMuted, fontSize: 13, fontStyle: 'italic' }}>
          Nenhuma regra ainda. Adiciona a primeira embaixo.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'stretch' }}>
        <select value={tipoNovo} onChange={e => setTipoNovo(e.target.value)} style={{
          flex: 1, padding: '9px 12px', border: `1px solid ${palette.beige}`, borderRadius: 6, fontFamily: FONT, fontSize: 13, background: '#fff', colorScheme: 'light',
        }}>
          {Object.entries(TIPO_INFO).filter(([k]) => k !== 'valor_fixo' && k !== 'desconto').map(([k, info]) => (
            <option key={k} value={k}>{info.label}</option>
          ))}
          <option value="desconto">Desconto fixo recorrente</option>
        </select>
        <button onClick={addRegra} style={btnPrimaryStyle()}>
          <Plus size={15} strokeWidth={1.5} /> Adicionar
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 16, borderTop: `1px solid ${palette.beige}`, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecStyle()}>Cancelar</button>
        <button onClick={() => onSalvar(regras)} style={btnPrimaryStyle()}>
          <Save size={15} strokeWidth={1.5} /> Salvar regras
        </button>
      </div>
    </ModalBox>
  );
}

function configPadrao(tipo) {
  switch (tipo) {
    case 'salario_fixo': return { valor: 0 };
    case 'vale_pago': return { valor: 0 };
    case 'comissao_propria': return { percentual: 1, base: 'total' };
    case 'comissao_loja': return { loja: 'Bom Retiro', percentual: 0.5 };
    case 'bonus_meta_individual': return { base: 'total', faixas: [...FAIXAS_META_PADRAO] };
    case 'comissao_marketplace': return { percentual: 0.1, fonte: 'mktplc_liquido' };
    case 'acrescimo': return { descricao: 'Alimentação', valor: 0, coluna_planilha: 'alimentacao', mes_destino: 'seguinte' };
    case 'valor_fixo': return { descricao: '', valor: 0 };
    case 'desconto': return { descricao: '', valor: 0 };
    default: return {};
  }
}

function RegraEditor({ regra, onChange, onRemover }) {
  const info = TIPO_INFO[regra.tipo];
  if (!info) return null;
  const cfg = regra.config || {};

  return (
    <div style={{ background: palette.beigeSoft, border: `1px solid ${palette.beige}`, borderRadius: 8, padding: 14, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: palette.ink, textTransform: 'uppercase', letterSpacing: 0.5 }}>{info.label}</div>
        <button onClick={onRemover} style={iconBtnStyle('danger')}>
          <Trash2 size={13} strokeWidth={1.5} />
        </button>
      </div>

      {(regra.tipo === 'salario_fixo' || regra.tipo === 'vale_pago') && (
        <Field label={regra.tipo === 'salario_fixo' ? 'Base (salário a pagar + vale)' : 'Valor (R$)'}>
          <Input type="number" step="0.01"
            value={cfg.valor === 0 ? '' : cfg.valor}
            onChange={e => onChange({ config: { valor: e.target.value === '' ? 0 : (parseFloat(e.target.value) || 0) } })}
            placeholder="0,00" num />
        </Field>
      )}

      {regra.tipo === 'comissao_propria' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Percentual (%)">
            <Input type="number" step="0.01" value={cfg.percentual} onChange={e => onChange({ config: { percentual: parseFloat(e.target.value) || 0 } })} num />
          </Field>
          <Field label="Base">
            <Select value={cfg.base} onChange={e => onChange({ config: { base: e.target.value } })}>
              <option value="total">Total (atacado + varejo)</option>
              <option value="atacado">Apenas atacado</option>
              <option value="varejo">Apenas varejo</option>
            </Select>
          </Field>
        </div>
      )}

      {regra.tipo === 'comissao_loja' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Loja">
            <Select value={cfg.loja} onChange={e => onChange({ config: { loja: e.target.value } })}>
              <option value="Silva Teles">Silva Teles</option>
              <option value="Bom Retiro">Bom Retiro</option>
            </Select>
          </Field>
          <Field label="Percentual (%)">
            <Input type="number" step="0.01" value={cfg.percentual} onChange={e => onChange({ config: { percentual: parseFloat(e.target.value) || 0 } })} num />
          </Field>
        </div>
      )}

      {regra.tipo === 'bonus_meta_individual' && (
        <>
          <Field label="Base do cálculo">
            <Select value={cfg.base} onChange={e => onChange({ config: { base: e.target.value } })}>
              <option value="total">Total (atacado + varejo)</option>
              <option value="atacado">Apenas atacado</option>
              <option value="varejo">Apenas varejo</option>
            </Select>
          </Field>
          <div style={{ marginTop: 10 }}>
            <Label>Faixas (atingiu R$ X → ganha R$ Y)</Label>
            <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 6, padding: 8 }}>
              {(cfg.faixas || []).map((f, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 24px', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                  <Input type="number" value={f.meta} onChange={e => {
                    const novas = [...cfg.faixas];
                    novas[i] = { ...novas[i], meta: parseFloat(e.target.value) || 0 };
                    onChange({ config: { faixas: novas } });
                  }} num placeholder="Meta R$" />
                  <Input type="number" value={f.valor} onChange={e => {
                    const novas = [...cfg.faixas];
                    novas[i] = { ...novas[i], valor: parseFloat(e.target.value) || 0 };
                    onChange({ config: { faixas: novas } });
                  }} num placeholder="Bônus R$" />
                  <button style={iconBtnStyle('danger')} onClick={() => {
                    onChange({ config: { faixas: cfg.faixas.filter((_, j) => j !== i) } });
                  }}>
                    <X size={11} strokeWidth={2} />
                  </button>
                </div>
              ))}
              <button style={btnAddStyle(palette.accent)} onClick={() => {
                const novas = [...(cfg.faixas || []), { meta: 0, valor: 0 }];
                onChange({ config: { faixas: novas } });
              }}>
                <Plus size={13} strokeWidth={1.5} /> Adicionar faixa
              </button>
            </div>
          </div>
        </>
      )}

      {regra.tipo === 'comissao_marketplace' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Percentual (%)">
            <Input type="number" step="0.01" value={cfg.percentual} onChange={e => onChange({ config: { percentual: parseFloat(e.target.value) || 0 } })} num />
          </Field>
          <Field label="Fonte">
            <Select value={cfg.fonte} onChange={e => onChange({ config: { fonte: e.target.value } })}>
              <option value="mktplc_liquido">Mktplc líquido (-10%)</option>
              <option value="mktplc_bruto">Mktplc bruto</option>
              <option value="muniam">Apenas Muniam</option>
            </Select>
          </Field>
        </div>
      )}

      {regra.tipo === 'acrescimo' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
            <Field label="Descrição (aparece no card)">
              <Input value={cfg.descricao} onChange={e => onChange({ config: { descricao: e.target.value } })} placeholder="Ex: Alimentação" />
            </Field>
            <Field label="Valor (R$)">
              <Input type="number" step="0.01"
                value={cfg.valor === 0 ? '' : cfg.valor}
                onChange={e => onChange({ config: { valor: e.target.value === '' ? 0 : (parseFloat(e.target.value) || 0) } })}
                placeholder="0,00" num />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <Field label="Coluna na planilha">
              <Select value={cfg.coluna_planilha || 'alimentacao'} onChange={e => onChange({ config: { coluna_planilha: e.target.value } })}>
                {COLUNAS_PLANILHA_ACRESCIMO.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Quando paga">
              <Select value={cfg.mes_destino || 'seguinte'} onChange={e => onChange({ config: { mes_destino: e.target.value } })}>
                <option value="seguinte">Mês seguinte (junto com salário)</option>
                <option value="competencia">Mês competência (junto com comissão)</option>
              </Select>
            </Field>
          </div>
        </>
      )}

      {regra.tipo === 'desconto' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <Field label="Descrição">
            <Input value={cfg.descricao} onChange={e => onChange({ config: { descricao: e.target.value } })} placeholder="Ex: Empréstimo" />
          </Field>
          <Field label="Valor (R$)">
            <Input type="number" step="0.01"
              value={cfg.valor === 0 ? '' : cfg.valor}
              onChange={e => onChange({ config: { valor: e.target.value === '' ? 0 : (parseFloat(e.target.value) || 0) } })}
              placeholder="0,00" num />
          </Field>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL: ADICIONAR LINHA (valor extra ou desconto)
// ═══════════════════════════════════════════════════════════════════════════

function ModalAddLinha({ tipo, onClose, onSalvar }) {
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const isDesc = tipo === 'desconto';

  function salvar() {
    const v = parseFloat(String(valor).replace(',', '.')) || 0;
    if (!descricao.trim() || v === 0) { alert('Descrição e valor obrigatórios'); return; }
    onSalvar({ tipo, descricao: descricao.trim(), valor: v });
  }

  return (
    <ModalBox onClose={onClose} titulo={isDesc ? 'Adicionar desconto' : 'Adicionar valor extra'}>
      <Field label="Descrição">
        <Input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder={isDesc ? 'Ex: Falta dia 10' : 'Ex: Bônus pontualidade'} autoFocus />
      </Field>
      <Field label="Valor (R$)">
        <Input type="number" step="0.01" value={valor} onChange={e => setValor(e.target.value)} num placeholder="0,00" />
      </Field>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecStyle()}>Cancelar</button>
        <button onClick={salvar} style={btnPrimaryStyle()}>Adicionar</button>
      </div>
    </ModalBox>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL: PDF (preview imprimível)
// ═══════════════════════════════════════════════════════════════════════════

function Recibo({ funcionario: f, linhas, competencia, fechamento }) {
  const total = linhas.reduce((s, l) => s + Number(l.valor || 0), 0);
  const dataPagamento = fechamento?.pago_em ? new Date(fechamento.pago_em) : new Date();
  return (
    <div className="recibo" style={{
      background: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', margin: '0 auto 24px',
      padding: '50px 60px', maxWidth: 480, color: palette.ink, borderRadius: 4,
    }}>
      <div style={{ fontSize: 12, letterSpacing: 3, textTransform: 'uppercase', color: palette.inkMuted, textAlign: 'center', marginBottom: 4 }}>
        Grupo Amícia
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, textAlign: 'center', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>
        {f.nome_display}
      </div>
      <div style={{ textAlign: 'center', fontSize: 14, color: palette.inkSoft, marginBottom: 30, fontStyle: 'italic' }}>
        {nomeMes(competencia)}
      </div>

      {linhas.map(l => (
        <div key={l.id} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 15, color: palette.ink }}>{l.titulo}</div>
            <div style={{ fontFamily: NUM, fontSize: 15, fontWeight: 600, color: Number(l.valor) < 0 ? palette.alert : palette.ink }}>
              {Number(l.valor) < 0 ? '−' : ''}{fmtBRL(Math.abs(l.valor))}
            </div>
          </div>
          {l.descricao_calculo && (
            <div style={{ fontSize: 12, color: palette.inkMuted, fontStyle: 'italic', marginTop: 2 }}>
              {l.descricao_calculo}
            </div>
          )}
        </div>
      ))}

      <div style={{ borderTop: `1px solid ${palette.ink}`, margin: '24px 0 14px' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Total</div>
        <div style={{ fontFamily: NUM, fontSize: 18, fontWeight: 700 }}>{fmtBRL(total)}</div>
      </div>

      <div style={{ textAlign: 'right', fontSize: 13, color: palette.inkSoft, marginTop: 30 }}>
        Data: {dataPagamento.toLocaleDateString('pt-BR')}
      </div>

      <div style={{ marginTop: 50, borderTop: `1px solid ${palette.beige}`, paddingTop: 12, fontSize: 12, color: palette.inkMuted, textAlign: 'center' }}>
        Recebi o valor acima referente ao mês de {nomeMes(competencia)}
      </div>
      <div style={{ marginTop: 30, display: 'flex', justifyContent: 'space-between', fontSize: 13, color: palette.ink }}>
        <div>_______________________________<br /><span style={{ fontSize: 12 }}>Assinatura</span></div>
        <div>_______________<br /><span style={{ fontSize: 12 }}>Data</span></div>
      </div>
    </div>
  );
}

function ModalPdf({ itens, competencia, onClose }) {
  function imprimir() { window.print(); }
  const lista = itens || [];
  return (
    <div style={modalOverlayStyle()} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #pdf-print, #pdf-print * { visibility: visible; }
          #pdf-print { position: absolute; left: 0; top: 0; width: 100%; }
          #pdf-print .recibo { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; border-radius: 0 !important; padding: 30px 50px !important; }
          #pdf-print .recibo:not(:last-child) { break-after: page; page-break-after: always; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div style={{ maxWidth: 600, width: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'transparent' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>
            {lista.length > 1 ? `${lista.length} recibos` : ''}
          </span>
          <button onClick={onClose} style={{ background: '#fff', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={17} strokeWidth={1.5} />
          </button>
        </div>

        <div id="pdf-print" style={{ fontFamily: FONT }}>
          {lista.map(it => (
            <Recibo key={it.funcionario.id} funcionario={it.funcionario} linhas={it.linhas}
              competencia={competencia} fechamento={it.fechamento} />
          ))}
        </div>

        <div className="no-print" style={{ textAlign: 'center', marginTop: 20 }}>
          <button onClick={imprimir} style={btnPrimaryStyle()}>
            <Printer size={15} strokeWidth={1.5} /> Imprimir {lista.length > 1 ? `(${lista.length})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PRIMITIVAS DE UI
// ═══════════════════════════════════════════════════════════════════════════

function ModalBox({ onClose, titulo, children, maxWidth = 500 }) {
  return (
    <div style={modalOverlayStyle()} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: '#fff', borderRadius: 12, maxWidth, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)', fontFamily: FONT,
      }}>
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${palette.beige}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: palette.ink }}>{titulo}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: palette.inkMuted, padding: 4 }}>
            <X size={19} strokeWidth={1.5} />
          </button>
        </div>
        <div style={{ padding: '18px 22px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: palette.inkMuted, marginBottom: 5 }}>
      {children}
    </div>
  );
}

function Input({ num, ...props }) {
  return (
    <input {...props} style={{
      width: '100%', border: `1px solid ${palette.beige}`, borderRadius: 6, padding: '9px 11px',
      fontFamily: num ? NUM : FONT, fontSize: 14, background: '#fff', color: palette.ink,
      colorScheme: 'light', outline: 'none', boxSizing: 'border-box', fontWeight: num ? 600 : 400,
    }} />
  );
}

function Select({ children, ...props }) {
  return (
    <select {...props} style={{
      width: '100%', border: `1px solid ${palette.beige}`, borderRadius: 6, padding: '9px 11px',
      fontFamily: FONT, fontSize: 14, background: '#fff', color: palette.ink, colorScheme: 'light', outline: 'none', cursor: 'pointer',
    }}>{children}</select>
  );
}

// Style helpers
function modalOverlayStyle() {
  return {
    position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.55)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: FONT,
  };
}
function btnPrimaryStyle() {
  return {
    background: palette.ink, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px',
    fontFamily: FONT, fontSize: 14, fontWeight: 600, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  };
}
function btnSecStyle() {
  return {
    background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '8px 14px',
    fontFamily: FONT, fontSize: 13, color: palette.inkSoft, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  };
}
function btnAddStyle(cor) {
  return {
    flex: 1, background: 'transparent', border: `1px dashed ${palette.beige}`, borderRadius: 8, padding: 10,
    color: cor || palette.inkMuted, fontFamily: FONT, fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  };
}
function iconBtnStyle(variant) {
  const isDanger = variant === 'danger';
  return {
    width: 26, height: 26, background: 'transparent', border: `1px solid ${palette.beige}`, borderRadius: 6,
    cursor: 'pointer', color: isDanger ? palette.alert : palette.inkMuted,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  };
}
function alertStyle(tipo) {
  const cor = tipo === 'ok' ? palette.ok : palette.warn;
  const bg  = tipo === 'ok' ? palette.okSoft : palette.warnSoft;
  return {
    padding: '7px 11px', borderRadius: 5, fontSize: 12, marginTop: 6,
    display: 'flex', alignItems: 'center', gap: 6, color: cor, background: bg, border: `1px solid ${cor}40`,
  };
}
