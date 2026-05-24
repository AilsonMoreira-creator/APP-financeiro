// ═══════════════════════════════════════════════════════════════════════════
// _lojas-whats-padroes.js — Consulta padroes aprendidos pra injetar no prompt
// ═══════════════════════════════════════════════════════════════════════════
//
// Sofia consulta este helper antes de gerar cada msg na etapa 'conversando'.
//
// SUGGEST (3B Ailson): padroes aparecem no prompt como DICA, nao force.
// Sofia decide se segue ou nao.
//
// EXPLORATION (4A=30%, escolha do Ailson):
//   30% das vezes -> modo 'explorar': prompt NAO injeta padroes "usar"
//                                       (mantem "evitar" pra seguranca).
//                                       Sofia gera mais livremente — coleta dados.
//   70% das vezes -> modo 'replicar':   injeta TOP padroes "usar" pra Sofia
//                                       replicar o que funciona.
//
// Cache 5min pra reduzir hits no banco.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from './_lojas-whats-helpers.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const EXPLORATION_RATE = 0.30;
let _cache = null;
let _cacheExp = 0;

async function carregarPadroes() {
  if (_cache && Date.now() < _cacheExp) return _cache;
  const { data, error } = await supabase
    .from('lojas_whats_aprendizado_padroes')
    .select('tipo, chave, contexto, amostras, taxa_sucesso, recomendacao')
    .eq('ativo', true)
    .in('recomendacao', ['usar', 'evitar'])
    .order('amostras', { ascending: false })
    .limit(50);
  if (error) {
    console.warn('[padroes] erro:', error.message);
    return [];
  }
  _cache = data || [];
  _cacheExp = Date.now() + CACHE_TTL_MS;
  return _cache;
}

/**
 * Decide se este request usa modo 'explorar' ou 'replicar'.
 * 30% chance explorar.
 */
export function decidirModo() {
  return Math.random() < EXPLORATION_RATE ? 'explorar' : 'replicar';
}

/**
 * Monta bloco de texto com padroes aprendidos pra injetar no system prompt.
 *
 * - modo='replicar': inclui top 5 'usar' + top 5 'evitar' (n>=5 amostras)
 * - modo='explorar': SO inclui 'evitar' (mantém seguranca, mas Sofia varia)
 *
 * Retorna string vazia se nao tem padroes suficientes.
 */
export async function montarBlocoPadroes(modo, contexto = {}) {
  const padroes = await carregarPadroes();
  if (padroes.length === 0) return '';

  // Filtra por contexto (matching da etapa, se especificado no padrao)
  const matchContexto = (p) => {
    if (!p.contexto || Object.keys(p.contexto).length === 0) return true;
    if (p.contexto.etapa && contexto.etapa && p.contexto.etapa !== contexto.etapa) return false;
    return true;
  };

  const usaveis = padroes
    .filter(p => p.recomendacao === 'usar' && p.amostras >= 5)
    .filter(matchContexto)
    .slice(0, 5);
  const evitar = padroes
    .filter(p => p.recomendacao === 'evitar' && p.amostras >= 5)
    .filter(matchContexto)
    .slice(0, 5);

  const linhas = [];

  if (modo === 'replicar' && usaveis.length > 0) {
    linhas.push('PADROES APRENDIDOS QUE FUNCIONARAM (use como dica, nao obrigacao):');
    for (const p of usaveis) {
      const pct = Math.round((p.taxa_sucesso || 0) * 100);
      linhas.push(`  + ${p.tipo}: "${p.chave}" → ${pct}% sucesso (n=${p.amostras})`);
    }
    linhas.push('');
  }

  if (evitar.length > 0) {
    linhas.push('PADROES PRA EVITAR (taxas baixas — NAO use):');
    for (const p of evitar) {
      const pct = Math.round((p.taxa_sucesso || 0) * 100);
      linhas.push(`  - ${p.tipo}: "${p.chave}" → so ${pct}% sucesso (n=${p.amostras})`);
    }
    linhas.push('');
  }

  if (modo === 'explorar') {
    linhas.push('MODO EXPERIMENTACAO: tenta variar abordagem (palavras, emojis, horarios) pra coletar mais dados de aprendizado. Mantenha tom Sofia + regras da loja.');
  }

  return linhas.length > 0 ? linhas.join('\n') : '';
}

/**
 * Limpa cache (chamar apos atualizar padroes manualmente, se aplicavel)
 */
export function invalidarCache() {
  _cache = null;
  _cacheExp = 0;
}
