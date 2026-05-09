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
  TrendingUp, Receipt, Wallet, Users, Tag, Minus, Save, Printer,
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
  valor_fixo:             { label: 'Valor extra',            icon: Plus,      cor: palette.ok },
  desconto:               { label: 'Desconto',               icon: Minus,     cor: palette.alert },
};

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
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 1501 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 1002 },                                      ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_loja',         config: { loja: 'Bom Retiro', percentual: 0.3 },              ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.1, fonte: 'mktplc_bruto' },           ordem: 4, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.1, fonte: 'mktplc_liquido' },         ordem: 5, ativo: true },
  ],
  stefany: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 1655 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 1104 },                                      ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.12, fonte: 'mktplc_liquido' },        ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.20, fonte: 'muniam' },                ordem: 4, ativo: true },
  ],
  gabrielly: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 1400.86 },                                   ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 934 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.12, fonte: 'mktplc_liquido' },        ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.20, fonte: 'muniam' },                ordem: 4, ativo: true },
  ],
  ingrid: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 1136 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 892 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.12, fonte: 'mktplc_liquido' },        ordem: 3, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.20, fonte: 'muniam' },                ordem: 4, ativo: true },
  ],
  lucia: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 1380 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 920 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.07, fonte: 'mktplc_liquido' },        ordem: 3, ativo: true },
  ],
  igor: [
    { id: rid(), tipo: 'salario_fixo',          config: { valor: 1140 },                                      ordem: 1, ativo: true },
    { id: rid(), tipo: 'vale_pago',             config: { valor: 848 },                                       ordem: 2, ativo: true },
    { id: rid(), tipo: 'comissao_marketplace',  config: { percentual: 0.1, fonte: 'mktplc_liquido' },         ordem: 3, ativo: true },
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

  // 2. Marketplaces — lê do payload financeiro (amica-admin)
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
    console.warn('[folha] erro ao buscar mktplc', e?.message);
  }
  const mktplcBruto = mktplcLiquido / 0.9;

  // 3. Muniam — TODO: integrar com Bling pra pegar só Muniam
  // Por enquanto: zero (admin edita manualmente no card)
  const muniam = 0;

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
    const alvo = funcionario.nome_planilha?.trim().toUpperCase();
    const match = vendedoras.find(v => v.nome?.trim().toUpperCase() === alvo)
              || vendedoras.find(v => (v.aliases || []).map(a => a.toUpperCase()).includes(alvo));
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

export default function FolhaPagamento({ onVoltar }) {
  // Persistência em amicia_data 'folha-pagamento' (linha separada)
  const [funcionarios, setFuncionarios] = useState([]);
  const [regras, setRegras] = useState({});
  const [fechamentos, setFechamentos] = useState({});
  const [valesAplicados, setValesAplicados] = useState({});
  const [carregado, setCarregado] = useState(false);

  // Estado de tela
  const [tela, setTela] = useState('home');                        // 'home' | 'detalhe'
  const [funcSelId, setFuncSelId] = useState(null);
  const [competencia, setCompetencia] = useState(competenciaAtual());
  const [mostrarArquivados, setMostrarArquivados] = useState(false);

  // Modais
  const [modalCadastro, setModalCadastro] = useState(null);        // null | { isEdit, funcId? }
  const [modalRegras, setModalRegras] = useState(null);            // null | funcId
  const [modalPdf, setModalPdf] = useState(null);                  // null | funcId
  const [modalAddLinha, setModalAddLinha] = useState(null);        // null | { tipo: 'valor_fixo'|'desconto' }

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

  // ───────── Marcar pago — escreve na planilha auxDataPorMes
  async function marcarPago(funcId) {
    const f = funcionarios.find(x => x.id === funcId);
    if (!f) return;
    const linhas = linhasCalculadas(funcId);

    // Soma por mes_destino
    let salarioTotal = 0;
    let comissaoTotal = 0;
    for (const l of linhas) {
      if (l.mes_destino === 'seguinte') salarioTotal += Number(l.valor);
      else comissaoTotal += Number(l.valor);
    }

    // Vale (do regras base)
    const valeRegra = (regrasDoFunc(funcId) || []).find(r => r.tipo === 'vale_pago' && r.ativo);
    const valeValor = Number(valeRegra?.config?.valor || 0);

    const compSeguinte = competenciaSeguinte(competencia);
    const [, mesComp] = competencia.split('-').map(Number);
    const [, mesSeg] = compSeguinte.split('-').map(Number);

    if (!confirm(
      `Marcar ${f.nome_display} como pago — ${nomeMes(competencia)}?\n\n` +
      `Vai escrever na planilha:\n` +
      `• Salário R$ ${salarioTotal.toFixed(2).replace('.',',')} → ${nomeMes(compSeguinte)} (mês de pagamento)\n` +
      `• Comissão R$ ${comissaoTotal.toFixed(2).replace('.',',')} → ${nomeMes(competencia)} (competência)\n` +
      (valeValor > 0 ? `• Vale R$ ${valeValor.toFixed(2).replace('.',',')} → ${nomeMes(competencia)} (se ainda não estiver lá)\n` : '') +
      `\nContinuar?`
    )) return;

    try {
      // Lê payload financeiro atual
      const { data: dado } = await supabase
        .from('amicia_data')
        .select('payload')
        .eq('user_id', 'amicia-admin')
        .maybeSingle();
      if (!dado?.payload) {
        alert('Payload financeiro não encontrado.');
        return;
      }
      const payload = dado.payload;
      payload.auxDataPorMes = payload.auxDataPorMes || {};

      const escrever = (mesNum, campos) => {
        if (!payload.auxDataPorMes[mesNum]) payload.auxDataPorMes[mesNum] = {};
        if (!payload.auxDataPorMes[mesNum]['Funcionários']) payload.auxDataPorMes[mesNum]['Funcionários'] = [];
        const arr = payload.auxDataPorMes[mesNum]['Funcionários'];
        const alvo = (f.nome_planilha || f.nome_display).trim().toLowerCase();
        const idx = arr.findIndex(r => String(r.nome || '').trim().toLowerCase() === alvo);
        if (idx === -1) {
          return { achou: false, mes: mesNum };
        }
        for (const [k, v] of Object.entries(campos)) {
          arr[idx][k] = String(v);
        }
        return { achou: true, mes: mesNum };
      };

      const r1 = escrever(mesSeg, { salario: salarioTotal.toFixed(2) });
      const r2 = escrever(mesComp, { comissao: comissaoTotal.toFixed(2) });

      // Vale: só preenche se não estiver lá ainda (cron dia 20 normalmente põe)
      if (valeValor > 0) {
        const arr = payload.auxDataPorMes[mesComp]?.['Funcionários'] || [];
        const alvo = (f.nome_planilha || f.nome_display).trim().toLowerCase();
        const linha = arr.find(r => String(r.nome || '').trim().toLowerCase() === alvo);
        if (linha) {
          const valeAtual = parseFloat(linha.vale || 0);
          if (Math.abs(valeAtual - valeValor) > 0.01) {
            linha.vale = valeValor.toFixed(2);
          }
        }
      }

      await supabase
        .from('amicia_data')
        .update({ payload, updated_at: new Date().toISOString() })
        .eq('user_id', 'amicia-admin');

      // Snapshot do fechamento
      const k = fechamentoKey(funcId, competencia);
      setFechamentos(prev => ({
        ...prev,
        [k]: {
          ...(prev[k] || {}),
          snapshot: {
            linhas, totalSalario: salarioTotal, totalComissao: comissaoTotal,
            totalGeral: salarioTotal + comissaoTotal, vale: valeValor,
          },
          pago_em: new Date().toISOString(),
        },
      }));
      marcarDirty();

      const avisos = [];
      if (!r1.achou) avisos.push(`⚠ Linha "${f.nome_planilha}" não existe na planilha de ${nomeMes(compSeguinte)} (salário). Crie manual.`);
      if (!r2.achou) avisos.push(`⚠ Linha "${f.nome_planilha}" não existe na planilha de ${nomeMes(competencia)} (comissão). Crie manual.`);
      alert(`✓ ${f.nome_display} marcada como pago.\n\n` +
        (r1.achou ? `Salário R$ ${salarioTotal.toFixed(2).replace('.',',')} → ${nomeMes(compSeguinte)} ✓\n` : '') +
        (r2.achou ? `Comissão R$ ${comissaoTotal.toFixed(2).replace('.',',')} → ${nomeMes(competencia)} ✓\n` : '') +
        (avisos.length ? '\n' + avisos.join('\n') : ''));
    } catch (e) {
      console.error('[folha] marcar pago:', e?.message);
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
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, color: palette.accent, fontFamily: FONT, fontSize: 13 }}>
          <ArrowLeft size={16} strokeWidth={1.5} />
          {tela === 'home' ? 'Voltar' : 'Folha'}
        </button>
        <div style={{ flex: 1 }} />
        {syncStatus && (
          <span style={{ fontSize: 11, color: syncStatus === 'error' ? palette.alert : palette.ok }}>
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
          onGerarPdf={() => setModalPdf(funcSelId)}
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
          funcionario={funcionarios.find(f => f.id === modalPdf)}
          linhas={linhasCalculadas(modalPdf)}
          competencia={competencia}
          fechamento={fechamentoDoFunc(modalPdf, competencia)}
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
          <div style={{ fontSize: 10, letterSpacing: 2, textTransform: 'uppercase', color: palette.inkMuted }}>Grupo Amícia</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: palette.ink }}>Folha de Pagamento</div>
        </div>
        <select value={competencia} onChange={e => setCompetencia(e.target.value)}
          style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '8px 14px', fontFamily: FONT, fontSize: 13, color: palette.ink, cursor: 'pointer', colorScheme: 'light' }}>
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
        <div style={{ background: palette.warnSoft, color: palette.warn, padding: 10, borderRadius: 8, fontSize: 12, marginBottom: 12, textAlign: 'center' }}>
          Carregando vendas do mês...
        </div>
      )}

      {/* Toggle arquivados */}
      {(arquivados > 0 || mostrarArquivados) && (
        <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setMostrarArquivados(!mostrarArquivados)}
            style={{ background: 'none', border: 'none', color: palette.accent, fontFamily: FONT, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            {mostrarArquivados ? '↶ Voltar pros ativos' : `Mostrar arquivados (${arquivados})`}
          </button>
        </div>
      )}

      {/* Grid de cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {funcionarios.map(f => (
          <CardFunc key={f.id} f={f} total={totalFunc(f.id)}
            pago={!!fechamentos[`${f.id}|${competencia}`]?.pago_em}
            pagoEm={fechamentos[`${f.id}|${competencia}`]?.pago_em}
            arquivado={!f.ativo}
            onClick={() => mostrarArquivados ? null : onAbrirDetalhe(f.id)}
            onReativar={() => onReativar(f.id)}
          />
        ))}
        {funcionarios.length === 0 && (
          <div style={{ gridColumn: '1/-1', padding: 40, textAlign: 'center', color: palette.inkMuted, fontSize: 13 }}>
            {mostrarArquivados ? 'Nenhum funcionário arquivado.' : 'Nenhum funcionário cadastrado. Clique em "Novo funcionário".'}
          </div>
        )}
      </div>

      {/* Botão flutuante */}
      <button onClick={onAbrirCadastro}
        style={{ position: 'fixed', bottom: 24, right: 24, background: palette.ink, color: '#fff', border: 'none', borderRadius: 50, padding: '14px 22px',
          fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 4px 12px rgba(44,62,80,0.2)', zIndex: 50 }}>
        <Plus size={16} strokeWidth={1.5} />
        Novo funcionário
      </button>
    </div>
  );
}

function ResumoCell({ label, valor }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: palette.inkMuted, marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: NUM, fontSize: 14, fontWeight: 700, color: palette.ink }}>{valor}</div>
    </div>
  );
}

function CardFunc({ f, total, pago, pagoEm, arquivado, onClick, onReativar }) {
  const cat = CAT_INFO[f.categoria] || CAT_INFO.outro;
  return (
    <div onClick={onClick}
      style={{
        background: arquivado ? palette.beigeSoft : pago ? '#f5f9f3' : '#fff',
        border: `1px solid ${pago ? palette.ok + '40' : palette.beige}`,
        borderRadius: 12, padding: 16, cursor: arquivado ? 'default' : 'pointer',
        transition: 'all 0.15s', position: 'relative', opacity: arquivado ? 0.7 : 1,
      }}
      onMouseEnter={e => { if (!arquivado) { e.currentTarget.style.borderColor = palette.accent; e.currentTarget.style.transform = 'translateY(-2px)'; } }}
      onMouseLeave={e => { if (!arquivado) { e.currentTarget.style.borderColor = pago ? palette.ok + '40' : palette.beige; e.currentTarget.style.transform = 'translateY(0)'; } }}
    >
      {pago && (
        <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, padding: '2px 8px', borderRadius: 10, letterSpacing: 0.5,
          background: palette.okSoft, color: palette.ok }}>
          Pago {pagoEm ? new Date(pagoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''}
        </span>
      )}
      {!pago && !arquivado && (
        <span style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, padding: '2px 8px', borderRadius: 10, letterSpacing: 0.5,
          background: palette.warnSoft, color: palette.warn }}>
          Pendente
        </span>
      )}
      {arquivado && (
        <button onClick={(e) => { e.stopPropagation(); onReativar(); }}
          style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, padding: '2px 8px', borderRadius: 10, letterSpacing: 0.5,
            background: palette.beige, color: palette.archive, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <RotateCcw size={10} strokeWidth={1.5} />
          Reativar
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%', background: palette.beigeSoft, color: palette.ink,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontFamily: NUM, fontSize: 14, flexShrink: 0,
        }}>{iniciais(f.nome_display)}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: palette.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {f.nome_display}
          </div>
          <span style={{ display: 'inline-block', fontSize: 10, letterSpacing: 0.5, color: cat.cor, background: cat.bg,
            padding: '2px 8px', borderRadius: 10, marginTop: 3 }}>{cat.label}</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10, borderTop: `1px dashed ${palette.beige}` }}>
        <span style={{ fontSize: 11, color: palette.inkMuted, letterSpacing: 0.5 }}>Total a pagar</span>
        <span style={{ fontFamily: NUM, fontSize: 14, fontWeight: 700, color: palette.ink }}>{fmtBRL(total)}</span>
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
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontFamily: NUM, fontSize: 22, flexShrink: 0,
        }}>{iniciais(f.nome_display)}</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: palette.ink }}>{f.nome_display}</div>
          <div style={{ fontSize: 12, color: palette.inkMuted, marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-block', fontSize: 10, color: cat.cor, background: cat.bg, padding: '2px 8px', borderRadius: 10 }}>
              {cat.label}
            </span>
            <span>Fechamento {nomeMes(competencia)}</span>
            {f.nome_planilha !== f.nome_display && (
              <span style={{ fontSize: 10, fontStyle: 'italic' }}>· planilha: {f.nome_planilha}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onEditarFunc} style={btnSecStyle()}>
            <Edit2 size={14} strokeWidth={1.5} /> Funcionário
          </button>
          <button onClick={onEditarRegras} style={btnSecStyle()}>
            <Settings size={14} strokeWidth={1.5} /> Regras
          </button>
        </div>
      </div>

      {/* Lista de linhas */}
      <div style={{
        background: '#fff', border: `1px solid ${palette.beige}`, borderTop: 'none',
        borderRadius: '0 0 12px 12px', padding: '20px 24px',
      }}>
        {ctxLoading && (
          <div style={{ padding: 14, textAlign: 'center', color: palette.inkMuted, fontSize: 12, fontStyle: 'italic' }}>
            Calculando comissões...
          </div>
        )}

        {linhas.length === 0 && !ctxLoading && (
          <div style={{ padding: 30, textAlign: 'center', color: palette.inkMuted, fontSize: 13 }}>
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
              <Plus size={14} strokeWidth={1.5} /> Adicionar valor
            </button>
            <button onClick={() => onAddLinha('desconto')} style={btnAddStyle(palette.alert)}>
              <Minus size={14} strokeWidth={1.5} /> Adicionar desconto
            </button>
          </div>
        )}

        {/* Total */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '18px 0 10px', borderTop: `2px solid ${palette.ink}`, marginTop: 10,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: palette.ink, letterSpacing: 0.5, textTransform: 'uppercase' }}>Total a pagar</div>
            <div style={{ fontSize: 11, color: palette.inkMuted, marginTop: 2 }}>
              {pago
                ? `Pago em ${new Date(fechamento.pago_em).toLocaleDateString('pt-BR')}`
                : `Pagamento previsto em ${dataPagamento.toLocaleDateString('pt-BR')}`}
            </div>
          </div>
          <div style={{ fontFamily: NUM, fontSize: 18, fontWeight: 700, color: palette.ink }}>{fmtBRL(total)}</div>
        </div>

        {/* Ações finais */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20, flexWrap: 'wrap' }}>
          <button onClick={onArquivar} style={{ ...btnSecStyle(), color: palette.alert }}>
            <Archive size={14} strokeWidth={1.5} /> Arquivar funcionário
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onGerarPdf} style={btnSecStyle()}>
            <FileText size={14} strokeWidth={1.5} /> Gerar PDF
          </button>
          {!pago && (
            <button onClick={onMarcarPago} style={{
              background: palette.ok, color: '#fff', border: 'none', borderRadius: 8, padding: '11px 22px',
              fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <Check size={14} strokeWidth={1.5} /> Marcar pago
            </button>
          )}
          {pago && (
            <span style={{ fontSize: 12, color: palette.ok, padding: '11px 22px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={14} strokeWidth={1.5} /> Pago
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
        <div style={{ fontSize: 14, color: palette.ink, fontWeight: 600 }}>{l.titulo}</div>
        {l.descricao_calculo && (
          <div style={{ fontSize: 11, color: palette.inkMuted, marginTop: 2 }}>{l.descricao_calculo}</div>
        )}
        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {l.mes_destino && (
            <span style={{
              fontSize: 9, textTransform: 'uppercase', letterSpacing: 1,
              color: l.mes_destino === 'seguinte' ? '#b88a3d' : palette.accent,
              background: l.mes_destino === 'seguinte' ? '#f5ecdc' : '#e8f0f7',
              padding: '2px 6px', borderRadius: 4,
            }}>
              → Planilha {l.mes_destino === 'seguinte' ? 'mês seguinte' : 'mês competência'}
            </span>
          )}
          {l._editado && (
            <span style={{ fontSize: 9, color: palette.warn, background: palette.warnSoft, padding: '2px 6px', borderRadius: 4, letterSpacing: 1, textTransform: 'uppercase' }}>
              Editado manual
            </span>
          )}
          {l._ajuste && (
            <span style={{ fontSize: 9, color: palette.ok, background: palette.okSoft, padding: '2px 6px', borderRadius: 4, letterSpacing: 1, textTransform: 'uppercase' }}>
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
              fontFamily: NUM, fontSize: 13, fontWeight: 600, textAlign: 'right', color: palette.ink, outline: 'none', colorScheme: 'light', background: '#fff',
            }}
          />
        ) : (
          <span onClick={() => setEditando(true)} style={{
            fontFamily: NUM, fontSize: 13, fontWeight: 600,
            color: isDesconto ? palette.alert : palette.ink, cursor: 'pointer',
          }}>{fmtBRL(Math.abs(l.valor)) + (isDesconto ? '' : '')}</span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {l._editado && (
          <button onClick={onResetar} title="Voltar ao valor calculado" style={iconBtnStyle()}>
            <RotateCcw size={12} strokeWidth={1.5} />
          </button>
        )}
        <button onClick={() => setEditando(!editando)} title="Editar valor" style={iconBtnStyle()}>
          <Edit2 size={12} strokeWidth={1.5} />
        </button>
        <button onClick={onRemover} title="Remover desse mês" style={iconBtnStyle('danger')}>
          <Trash2 size={12} strokeWidth={1.5} />
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
    const alvo = nomePlanilha.trim().toLowerCase();
    return linhasPlanilha.find(n => n.toLowerCase() === alvo);
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
          ? <div style={alertStyle('ok')}><CheckCircle2 size={12} strokeWidth={1.5} /> Encontrado na planilha do mês: <b>{matchPlanilha}</b></div>
          : <div style={alertStyle('warn')}><AlertCircle size={12} strokeWidth={1.5} /> Não encontrado — você vai precisar criar a linha manual</div>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <Label>Categoria</Label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {Object.entries(CAT_INFO).map(([k, info]) => (
            <label key={k} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
              border: `1px solid ${categoria === k ? palette.accent : palette.beige}`, borderRadius: 6, cursor: 'pointer', fontSize: 12,
              background: categoria === k ? palette.accentSoft : '#fff',
            }}>
              <input type="radio" checked={categoria === k} onChange={() => setCategoria(k)} />
              {info.label}
            </label>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 8, borderTop: `1px solid ${palette.beige}`, marginTop: 16, paddingTop: 16 }}>
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
      <div style={{ fontSize: 11, color: palette.inkMuted, marginBottom: 14, fontStyle: 'italic' }}>
        Mudanças aqui valem pra esse mês e os próximos. Pra mudar só nesse mês, edita direto no card.
      </div>

      {regras.sort((a, b) => a.ordem - b.ordem).map(r => (
        <RegraEditor key={r.id} regra={r}
          onChange={(patch) => updateRegra(r.id, patch)}
          onRemover={() => removerRegra(r.id)}
        />
      ))}

      {regras.length === 0 && (
        <div style={{ padding: 20, textAlign: 'center', color: palette.inkMuted, fontSize: 12, fontStyle: 'italic' }}>
          Nenhuma regra ainda. Adiciona a primeira embaixo.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'stretch' }}>
        <select value={tipoNovo} onChange={e => setTipoNovo(e.target.value)} style={{
          flex: 1, padding: '9px 12px', border: `1px solid ${palette.beige}`, borderRadius: 6, fontFamily: FONT, fontSize: 12, background: '#fff', colorScheme: 'light',
        }}>
          {Object.entries(TIPO_INFO).filter(([k]) => k !== 'valor_fixo' && k !== 'desconto').map(([k, info]) => (
            <option key={k} value={k}>{info.label}</option>
          ))}
          <option value="desconto">Desconto fixo recorrente</option>
        </select>
        <button onClick={addRegra} style={btnPrimaryStyle()}>
          <Plus size={14} strokeWidth={1.5} /> Adicionar
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 16, borderTop: `1px solid ${palette.beige}`, marginTop: 16 }}>
        <button onClick={onClose} style={btnSecStyle()}>Cancelar</button>
        <button onClick={() => onSalvar(regras)} style={btnPrimaryStyle()}>
          <Save size={14} strokeWidth={1.5} /> Salvar regras
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
        <div style={{ fontSize: 12, fontWeight: 600, color: palette.ink, textTransform: 'uppercase', letterSpacing: 0.5 }}>{info.label}</div>
        <button onClick={onRemover} style={iconBtnStyle('danger')}>
          <Trash2 size={12} strokeWidth={1.5} />
        </button>
      </div>

      {(regra.tipo === 'salario_fixo' || regra.tipo === 'vale_pago') && (
        <Field label="Valor (R$)">
          <Input type="number" step="0.01" value={cfg.valor} onChange={e => onChange({ config: { valor: parseFloat(e.target.value) || 0 } })} num />
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
                    <X size={10} strokeWidth={2} />
                  </button>
                </div>
              ))}
              <button style={btnAddStyle(palette.accent)} onClick={() => {
                const novas = [...(cfg.faixas || []), { meta: 0, valor: 0 }];
                onChange({ config: { faixas: novas } });
              }}>
                <Plus size={12} strokeWidth={1.5} /> Adicionar faixa
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

      {regra.tipo === 'desconto' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <Field label="Descrição">
            <Input value={cfg.descricao} onChange={e => onChange({ config: { descricao: e.target.value } })} placeholder="Ex: Empréstimo" />
          </Field>
          <Field label="Valor (R$)">
            <Input type="number" step="0.01" value={cfg.valor} onChange={e => onChange({ config: { valor: parseFloat(e.target.value) || 0 } })} num />
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

function ModalPdf({ funcionario: f, linhas, competencia, fechamento, onClose }) {
  const total = linhas.reduce((s, l) => s + Number(l.valor || 0), 0);
  const dataPagamento = fechamento?.pago_em ? new Date(fechamento.pago_em) : new Date();

  function imprimir() {
    window.print();
  }

  return (
    <div style={modalOverlayStyle()} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #pdf-print, #pdf-print * { visibility: visible; }
          #pdf-print { position: absolute; left: 0; top: 0; width: 100%; padding: 30px 50px; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div style={{ maxWidth: 600, width: '100%', background: 'transparent' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button onClick={onClose} style={{ background: '#fff', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div id="pdf-print" style={{
          background: '#fff', boxShadow: '0 4px 20px rgba(0,0,0,0.15)', margin: '0 auto',
          padding: '50px 60px', maxWidth: 480, fontFamily: FONT, color: palette.ink, borderRadius: 4,
        }}>
          <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: palette.inkMuted, textAlign: 'center', marginBottom: 4 }}>
            Grupo Amícia
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, textAlign: 'center', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>
            {f.nome_display}
          </div>
          <div style={{ textAlign: 'center', fontSize: 12, color: palette.inkSoft, marginBottom: 30, fontStyle: 'italic' }}>
            {nomeMes(competencia)}
          </div>

          {linhas.map(l => (
            <div key={l.id} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 13, color: palette.ink }}>{l.titulo}</div>
                <div style={{ fontFamily: NUM, fontSize: 13, fontWeight: 600, color: Number(l.valor) < 0 ? palette.alert : palette.ink }}>
                  {Number(l.valor) < 0 ? '−' : ''}{fmtBRL(Math.abs(l.valor))}
                </div>
              </div>
              {l.descricao_calculo && (
                <div style={{ fontSize: 10, color: palette.inkMuted, fontStyle: 'italic', marginTop: 2 }}>
                  {l.descricao_calculo}
                </div>
              )}
            </div>
          ))}

          <div style={{ borderTop: `1px solid ${palette.ink}`, margin: '24px 0 14px' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Total</div>
            <div style={{ fontFamily: NUM, fontSize: 16, fontWeight: 700 }}>{fmtBRL(total)}</div>
          </div>

          <div style={{ textAlign: 'right', fontSize: 11, color: palette.inkSoft, marginTop: 30 }}>
            Data: {dataPagamento.toLocaleDateString('pt-BR')}
          </div>

          <div style={{ marginTop: 50, borderTop: `1px solid ${palette.beige}`, paddingTop: 12, fontSize: 10, color: palette.inkMuted, textAlign: 'center' }}>
            Recebi o valor acima referente ao mês de {nomeMes(competencia)}
          </div>
          <div style={{ marginTop: 30, display: 'flex', justifyContent: 'space-between', fontSize: 11, color: palette.ink }}>
            <div>_______________________________<br /><span style={{ fontSize: 10 }}>Assinatura</span></div>
            <div>_______________<br /><span style={{ fontSize: 10 }}>Data</span></div>
          </div>
        </div>

        <div className="no-print" style={{ textAlign: 'center', marginTop: 20 }}>
          <button onClick={imprimir} style={btnPrimaryStyle()}>
            <Printer size={14} strokeWidth={1.5} /> Imprimir
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
          <div style={{ fontSize: 16, fontWeight: 700, color: palette.ink }}>{titulo}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: palette.inkMuted, padding: 4 }}>
            <X size={18} strokeWidth={1.5} />
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
    <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: palette.inkMuted, marginBottom: 5 }}>
      {children}
    </div>
  );
}

function Input({ num, ...props }) {
  return (
    <input {...props} style={{
      width: '100%', border: `1px solid ${palette.beige}`, borderRadius: 6, padding: '9px 11px',
      fontFamily: num ? NUM : FONT, fontSize: 13, background: '#fff', color: palette.ink,
      colorScheme: 'light', outline: 'none', boxSizing: 'border-box', fontWeight: num ? 600 : 400,
    }} />
  );
}

function Select({ children, ...props }) {
  return (
    <select {...props} style={{
      width: '100%', border: `1px solid ${palette.beige}`, borderRadius: 6, padding: '9px 11px',
      fontFamily: FONT, fontSize: 13, background: '#fff', color: palette.ink, colorScheme: 'light', outline: 'none', cursor: 'pointer',
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
    fontFamily: FONT, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  };
}
function btnSecStyle() {
  return {
    background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '8px 14px',
    fontFamily: FONT, fontSize: 12, color: palette.inkSoft, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
  };
}
function btnAddStyle(cor) {
  return {
    flex: 1, background: 'transparent', border: `1px dashed ${palette.beige}`, borderRadius: 8, padding: 10,
    color: cor || palette.inkMuted, fontFamily: FONT, fontSize: 12, cursor: 'pointer',
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
    padding: '7px 11px', borderRadius: 5, fontSize: 11, marginTop: 6,
    display: 'flex', alignItems: 'center', gap: 6, color: cor, background: bg, border: `1px solid ${cor}40`,
  };
}
