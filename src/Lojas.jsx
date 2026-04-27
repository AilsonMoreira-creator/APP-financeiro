/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Lojas.jsx — MÓDULO INDEPENDENTE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Co-piloto de vendas com IA pra lojas físicas (Bom Retiro + Silva Teles).
 *
 * Arquitetura:
 *   • Independente (igual MLPerguntas, Bling, SAC) — próprio Supabase client
 *   • Carrega user_id de localStorage (setado no login do app)
 *   • Realtime via 4 channels: sugestões, sacola, importações, KPIs
 *   • IA via Edge Function /api/lojas-ia (chama Anthropic com cache)
 *   • Permissões: 3 admins veem tudo, vendedoras só própria carteira
 *
 * Tabelas Supabase (todas no schema public):
 *   • lojas_admins, lojas_vendedoras, lojas_grupos
 *   • lojas_clientes, lojas_clientes_kpis
 *   • lojas_vendas, lojas_pedidos_sacola
 *   • lojas_produtos, lojas_produtos_curadoria, lojas_promocoes
 *   • lojas_sugestoes_diarias, lojas_ia_chamadas_log, lojas_importacoes
 *   • lojas_carteira_historico, lojas_acoes, lojas_agenda, lojas_config
 *
 * Estrutura deste arquivo:
 *   PARTE 1 (este arquivo):
 *     - Setup Supabase
 *     - Constants e palette
 *     - Estado e reducer
 *     - Load/save por entidade (não JSON gigante)
 *     - Realtime channels
 *     - Chamadas IA
 *     - Helpers de UI
 *   PARTE 2 (próximo arquivo, mesclar depois):
 *     - JSX das 17 telas + 3 modais
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useReducer, useRef, useCallback, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  ArrowLeft, RefreshCw, ChevronRight, Search, Settings,
  Users, Star, Lightbulb, Check, X, Sparkles, Flame, AlertTriangle,
  MessageCircle, Pencil, Phone, Package, Tag, Copy, Pause, Calendar,
  Archive, Bot, Plus, Store, Gift, FileText, ArrowLeftRight, Download,
  TrendingUp, TrendingDown, BarChart3, UserCog, Maximize2, Filter,
  Save, Trash2, Edit3, MapPin, Clock, CheckCircle2, AlertCircle,
  Upload, FileSpreadsheet, History, Award, Heart, ChevronUp, ChevronDown,
  UsersRound, Link2, Unlink2, Crown, ShoppingBag, Loader2, WifiOff
} from 'lucide-react';

// Importa cérebro da IA + helpers puros
import {
  // prompts e exemplos
  SYSTEM_PROMPT_SUGESTOES, SYSTEM_PROMPT_MENSAGENS, EXEMPLOS_FEW_SHOT, META,
  // constantes
  STATUS_CLIENTE, SUBTIPOS_SACOLA, CATEGORIAS_PAGAMENTO, FASES_CICLO_VIDA,
  REGRAS_NOVIDADE, USUARIOS_ACESSO_TOTAL,
  // helpers
  ehUsuarioAdmin,
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
} from './LojasInstrucoes.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// SUPABASE CLIENT (independente — igual MLPerguntas)
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 10 } },
});

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS (do v5, com adições)
// ═══════════════════════════════════════════════════════════════════════════

const palette = {
  bg: '#f7f4f0', surface: '#ffffff',
  beige: '#e8e2da', beigeSoft: '#f0ebe3',
  ink: '#2c3e50', inkSoft: '#5a6b7d', inkMuted: '#8a99a8',
  accent: '#4a7fa5', accentSoft: '#e5eef5',
  alert: '#c0392b', alertSoft: '#fde8e6',
  warn: '#d4a017', warnSoft: '#fdf6e3',
  ok: '#2d8659', okSoft: '#e0f0e8',
  archive: '#7a6e5d', archiveSoft: '#ede7dd',
  yellow: '#f5b800',
  // ⭐ NOVO: roxo pra status SEPARANDO_SACOLA
  purple: '#a855f7', purpleSoft: '#f3e8ff',
};
const FONT = "Georgia, 'Times New Roman', serif";

// Mapa de status visual (com SACOLA roxo adicionado)
const statusMap = {
  ativo: { cor: palette.ok, soft: palette.okSoft, label: 'Ativo', emoji: '🟢' },
  atencao: { cor: palette.warn, soft: palette.warnSoft, label: 'Atenção', emoji: '🟡' },
  semAtividade: { cor: '#e67e22', soft: '#fef0e6', label: 'S/Atividade', emoji: '🟠' },
  inativo: { cor: palette.alert, soft: palette.alertSoft, label: 'Inativo', emoji: '🔴' },
  arquivo: { cor: palette.archive, soft: palette.archiveSoft, label: 'Arquivo', emoji: '📁' },
  // ⭐ NOVO
  separandoSacola: { cor: palette.purple, soft: palette.purpleSoft, label: 'Sacola', emoji: '🟣' },
};

// Mapa de sub-tipos da sacola (cores + labels pra UI)
const subtipoSacolaMap = {
  acrescentar_novidade: { cor: palette.accent, label: 'Tem novidade que combina', emoji: '✨' },
  acrescentar_promocao: { cor: palette.warn, label: 'Tem promo ativa', emoji: '🎁' },
  lembrete_finalizacao: { cor: palette.ok, label: 'Lembrar de finalizar', emoji: '💛' },
  resgate_pedido: { cor: '#e67e22', label: 'Resgatar gentilmente', emoji: '⏰' },
  urgencia_admin: { cor: palette.alert, label: 'Urgente — alinhar', emoji: '🚨' },
};

// Mapa de fases do ciclo de vida da cliente nova
const faseClienteNovaMap = {
  nova_aguardando: { cor: palette.inkMuted, label: 'Aguardando (0-14d)', emoji: '⏳' },
  nova_checkin_pronto: { cor: palette.purple, label: 'Check-in dia 15!', emoji: '👋' },
  nova_em_analise: { cor: palette.inkMuted, label: 'Em análise (16-30d)', emoji: '🤔' },
  normal: { cor: palette.inkSoft, label: 'Cliente regular', emoji: '✓' },
  sem_compras_ainda: { cor: palette.archive, label: 'Sem compras', emoji: '—' },
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES DO MÓDULO
// ═══════════════════════════════════════════════════════════════════════════

const REALTIME_CHANNELS = {
  SUGESTOES: 'lojas-sugestoes',
  SACOLA: 'lojas-sacola',
  IMPORTACOES: 'lojas-importacoes',
  KPIS: 'lojas-kpis',
};

const LOAD_PHASES = {
  IDLE: 'idle',
  LOADING_USER: 'loading_user',
  LOADING_VENDEDORAS: 'loading_vendedoras',
  LOADING_CARTEIRA: 'loading_carteira',
  LOADING_PRODUTOS: 'loading_produtos',
  LOADING_SUGESTOES: 'loading_sugestoes',
  READY: 'ready',
  ERROR: 'error',
};

// ═══════════════════════════════════════════════════════════════════════════
// REDUCER (estado global do módulo)
// ═══════════════════════════════════════════════════════════════════════════

const initialState = {
  // identidade
  userId: null,
  isAdmin: false,
  vendedoraLogada: null,        // se vendedora, qual é
  
  // carteira
  vendedoras: [],
  vendedoraAtiva: null,         // vendedora selecionada (admin pode trocar)
  
  // dados principais
  clientes: [],
  clientesKpis: {},             // {cliente_id: kpis}
  grupos: [],
  produtos: [],
  curadoria: [],                // best_sellers, em_alta, novidades manuais
  promocoes: [],
  
  // operacional
  sugestoesHoje: [],            // sugestões geradas hoje pra vendedora ativa
  pedidosSacola: [],            // pedidos em espera ativos
  importacoes: [],
  
  // UI state
  phase: LOAD_PHASES.IDLE,
  errorMsg: null,
  online: true,
  ultimaSincronizacao: null,
  
  // realtime status
  realtimeStatus: { sugestoes: 'idle', sacola: 'idle', importacoes: 'idle', kpis: 'idle' },
};

function lojasReducer(state, action) {
  switch (action.type) {
    case 'SET_PHASE':
      return { ...state, phase: action.phase, errorMsg: action.error || null };
    
    case 'SET_USER':
      return {
        ...state,
        userId: action.userId,
        isAdmin: ehUsuarioAdmin(action.userId),
      };
    
    case 'SET_VENDEDORA_LOGADA':
      return { ...state, vendedoraLogada: action.vendedora };
    
    case 'SET_VENDEDORAS':
      return { ...state, vendedoras: action.vendedoras };
    
    case 'SET_VENDEDORA_ATIVA':
      return { ...state, vendedoraAtiva: action.vendedora };
    
    case 'SET_CLIENTES':
      return { ...state, clientes: action.clientes };
    
    case 'UPDATE_CLIENTE': {
      const idx = state.clientes.findIndex(c => c.id === action.cliente.id);
      if (idx === -1) return { ...state, clientes: [...state.clientes, action.cliente] };
      const novos = [...state.clientes];
      novos[idx] = { ...novos[idx], ...action.cliente };
      return { ...state, clientes: novos };
    }
    
    case 'SET_KPIS':
      return { ...state, clientesKpis: action.kpis };
    
    case 'UPDATE_KPI': {
      const novos = { ...state.clientesKpis, [action.cliente_id]: action.kpi };
      return { ...state, clientesKpis: novos };
    }
    
    case 'SET_GRUPOS':
      return { ...state, grupos: action.grupos };
    
    case 'UPDATE_GRUPO': {
      const idx = state.grupos.findIndex(g => g.id === action.grupo.id);
      if (idx === -1) return { ...state, grupos: [...state.grupos, action.grupo] };
      const novos = [...state.grupos];
      novos[idx] = { ...novos[idx], ...action.grupo };
      return { ...state, grupos: novos };
    }
    
    case 'SET_PRODUTOS':
      return { ...state, produtos: action.produtos };
    
    case 'SET_CURADORIA':
      return { ...state, curadoria: action.curadoria };
    
    case 'SET_PROMOCOES':
      return { ...state, promocoes: action.promocoes };
    
    case 'SET_SUGESTOES':
      return { ...state, sugestoesHoje: action.sugestoes };
    
    case 'UPDATE_SUGESTAO': {
      const idx = state.sugestoesHoje.findIndex(s => s.id === action.sugestao.id);
      if (idx === -1) return { ...state, sugestoesHoje: [...state.sugestoesHoje, action.sugestao] };
      const novos = [...state.sugestoesHoje];
      novos[idx] = { ...novos[idx], ...action.sugestao };
      return { ...state, sugestoesHoje: novos };
    }
    
    case 'SET_SACOLA':
      return { ...state, pedidosSacola: action.sacola };
    
    case 'UPDATE_SACOLA': {
      const idx = state.pedidosSacola.findIndex(p => p.id === action.pedido.id);
      if (idx === -1) return { ...state, pedidosSacola: [...state.pedidosSacola, action.pedido] };
      const novos = [...state.pedidosSacola];
      novos[idx] = { ...novos[idx], ...action.pedido };
      return { ...state, pedidosSacola: novos };
    }
    
    case 'SET_IMPORTACOES':
      return { ...state, importacoes: action.importacoes };
    
    case 'UPDATE_IMPORTACAO': {
      const idx = state.importacoes.findIndex(i => i.id === action.importacao.id);
      if (idx === -1) return { ...state, importacoes: [action.importacao, ...state.importacoes] };
      const novos = [...state.importacoes];
      novos[idx] = action.importacao;
      return { ...state, importacoes: novos };
    }
    
    case 'SET_ONLINE':
      return { ...state, online: action.online };
    
    case 'SET_ULTIMA_SINC':
      return { ...state, ultimaSincronizacao: action.timestamp };
    
    case 'SET_REALTIME_STATUS':
      return {
        ...state,
        realtimeStatus: { ...state.realtimeStatus, [action.canal]: action.status },
      };
    
    default:
      return state;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: pega user_id do localStorage (mesmo padrão do app principal)
// ═══════════════════════════════════════════════════════════════════════════

function getUserIdFromStorage() {
  // O app principal salva em 'amicia_user' como JSON {id: 'celia', ...}
  // ou direto em 'user_id' string.
  try {
    const json = localStorage.getItem('amicia_user');
    if (json) {
      const parsed = JSON.parse(json);
      return parsed?.id || parsed?.user_id || null;
    }
  } catch {}
  return localStorage.getItem('user_id') || localStorage.getItem('userId') || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOAD: funções de carregamento por entidade
// ═══════════════════════════════════════════════════════════════════════════
// Cada função carrega UMA tabela. Não há JSON gigante — leitura direta.

async function loadVendedoras() {
  const { data, error } = await supabase
    .from('lojas_vendedoras')
    .select('*')
    .eq('ativa', true)
    .order('loja')
    .order('ordem_display');
  if (error) throw error;
  return data || [];
}

async function loadVendedoraByUserId(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('lojas_vendedoras')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

async function loadClientes(filtroVendedoraId = null) {
  let query = supabase
    .from('lojas_clientes')
    .select('*')
    .is('arquivado_em', null);
  
  if (filtroVendedoraId) {
    query = query.eq('vendedora_id', filtroVendedoraId);
  }
  
  const { data, error } = await query.order('razao_social');
  if (error) throw error;
  return data || [];
}

async function loadKpis(clienteIds) {
  if (!clienteIds?.length) return {};
  // Lê em chunks de 200 pra não estourar limit do Supabase
  const chunks = [];
  for (let i = 0; i < clienteIds.length; i += 200) {
    chunks.push(clienteIds.slice(i, i + 200));
  }
  
  const todos = [];
  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from('lojas_clientes_kpis')
      .select('*')
      .in('cliente_id', chunk);
    if (error) throw error;
    todos.push(...(data || []));
  }
  
  // Vira dict {cliente_id: kpi}
  return todos.reduce((acc, k) => {
    acc[k.cliente_id] = k;
    return acc;
  }, {});
}

async function loadGrupos(filtroVendedoraId = null) {
  let query = supabase
    .from('lojas_grupos')
    .select('*')
    .is('arquivado_em', null);
  
  if (filtroVendedoraId) {
    query = query.eq('vendedora_id', filtroVendedoraId);
  }
  
  const { data, error } = await query.order('nome_grupo');
  if (error) throw error;
  return data || [];
}

async function loadProdutos() {
  // Só os ofereciveis (do view vw_lojas_produtos_oferecveis)
  const { data, error } = await supabase
    .from('vw_lojas_produtos_oferecveis')
    .select('*')
    .order('score_relevancia', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data || [];
}

async function loadCuradoria() {
  const { data, error } = await supabase
    .from('lojas_produtos_curadoria')
    .select('*')
    .eq('ativo', true)
    .or('data_fim.is.null,data_fim.gte.' + new Date().toISOString().slice(0, 10));
  if (error) throw error;
  return data || [];
}

async function loadPromocoes() {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('lojas_promocoes')
    .select('*')
    .eq('ativo', true)
    .gte('data_fim', hoje)
    .order('data_fim');
  if (error) throw error;
  return data || [];
}

async function loadSugestoesHoje(vendedoraId) {
  if (!vendedoraId) return [];
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('lojas_sugestoes_diarias')
    .select('*')
    .eq('vendedora_id', vendedoraId)
    .eq('data_geracao', hoje)
    .order('prioridade');
  if (error) throw error;
  return data || [];
}

async function loadPedidosSacola(filtroVendedoraId = null) {
  let query = supabase
    .from('lojas_pedidos_sacola')
    .select('*')
    .eq('ativo', true);
  
  if (filtroVendedoraId) {
    query = query.eq('vendedora_id', filtroVendedoraId);
  }
  
  const { data, error } = await query.order('data_cadastro_sacola', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function loadImportacoes(limit = 50) {
  const { data, error } = await supabase
    .from('lojas_importacoes')
    .select('*')
    .order('iniciada_em', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ═══════════════════════════════════════════════════════════════════════════
// SAVE: funções de gravação por entidade
// ═══════════════════════════════════════════════════════════════════════════

async function saveCliente(cliente, userId) {
  const payload = {
    ...cliente,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  const { data, error } = await supabase
    .from('lojas_clientes')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function saveApelidoCliente(clienteId, apelido, userId) {
  const { data, error } = await supabase
    .from('lojas_clientes')
    .update({ apelido, updated_at: new Date().toISOString(), updated_by: userId })
    .eq('id', clienteId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function arquivarCliente(clienteId, motivo, userId) {
  const { data, error } = await supabase
    .from('lojas_clientes')
    .update({
      arquivado_em: new Date().toISOString(),
      arquivado_por: userId,
      arquivado_motivo: motivo,
    })
    .eq('id', clienteId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function pularCliente(clienteId, dias, userId) {
  const ate = new Date();
  ate.setDate(ate.getDate() + dias);
  const { error } = await supabase
    .from('lojas_clientes')
    .update({
      pular_ate: ate.toISOString().slice(0, 10),
      updated_by: userId,
    })
    .eq('id', clienteId);
  if (error) throw error;
}

async function transferirCliente(clienteId, vendedoraDestinoId, motivo, userId) {
  // 1. Pega vendedora atual pra registrar histórico
  const { data: clienteAtual } = await supabase
    .from('lojas_clientes')
    .select('vendedora_id')
    .eq('id', clienteId)
    .single();
  
  // 2. Atualiza cliente
  const { error: e1 } = await supabase
    .from('lojas_clientes')
    .update({
      vendedora_id: vendedoraDestinoId,
      data_atribuicao: new Date().toISOString(),
      fonte_atribuicao: 'transferencia_manual',
      updated_by: userId,
    })
    .eq('id', clienteId);
  if (e1) throw e1;
  
  // 3. Registra no histórico
  const { error: e2 } = await supabase
    .from('lojas_carteira_historico')
    .insert({
      cliente_id: clienteId,
      vendedora_anterior: clienteAtual?.vendedora_id || null,
      vendedora_nova: vendedoraDestinoId,
      motivo: motivo || 'transferencia',
      acao_por: userId,
    });
  if (e2) throw e2;
}

async function transferirCarteiraEmMassa(vendedoraOrigemId, vendedoraDestinoId, motivo, userId) {
  // Busca todos os clientes da origem
  const { data: clientes, error: e1 } = await supabase
    .from('lojas_clientes')
    .select('id')
    .eq('vendedora_id', vendedoraOrigemId)
    .is('arquivado_em', null);
  if (e1) throw e1;
  
  if (!clientes?.length) return { transferidos: 0 };
  
  // Atualiza todos em batch
  const ids = clientes.map(c => c.id);
  const { error: e2 } = await supabase
    .from('lojas_clientes')
    .update({
      vendedora_id: vendedoraDestinoId,
      data_atribuicao: new Date().toISOString(),
      fonte_atribuicao: 'transferencia_massa',
      updated_by: userId,
    })
    .in('id', ids);
  if (e2) throw e2;
  
  // Registra histórico em batch
  const historicos = ids.map(cid => ({
    cliente_id: cid,
    vendedora_anterior: vendedoraOrigemId,
    vendedora_nova: vendedoraDestinoId,
    motivo: motivo || 'transferencia_massa',
    acao_por: userId,
  }));
  const { error: e3 } = await supabase
    .from('lojas_carteira_historico')
    .insert(historicos);
  if (e3) throw e3;
  
  return { transferidos: ids.length };
}

async function saveVendedora(vendedora, userId) {
  const payload = {
    ...vendedora,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  const { data, error } = await supabase
    .from('lojas_vendedoras')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function inativarVendedora(vendedoraId, userId) {
  const { error } = await supabase
    .from('lojas_vendedoras')
    .update({ ativa: false, updated_by: userId })
    .eq('id', vendedoraId);
  if (error) throw error;
}

async function savePromocao(promocao, userId) {
  const payload = {
    ...promocao,
    updated_at: new Date().toISOString(),
    criado_por: promocao.criado_por || userId,
  };
  const { data, error } = await supabase
    .from('lojas_promocoes')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function pausarPromocao(promocaoId) {
  const { error } = await supabase
    .from('lojas_promocoes')
    .update({ ativo: false })
    .eq('id', promocaoId);
  if (error) throw error;
}

async function saveGrupo(grupo, userId) {
  const payload = {
    ...grupo,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  const { data, error } = await supabase
    .from('lojas_grupos')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function adicionarClienteAoGrupo(clienteId, grupoId, userId) {
  const { error } = await supabase
    .from('lojas_clientes')
    .update({ grupo_id: grupoId, updated_by: userId })
    .eq('id', clienteId);
  if (error) throw error;
}

async function removerClienteDoGrupo(clienteId, userId) {
  const { error } = await supabase
    .from('lojas_clientes')
    .update({ grupo_id: null, updated_by: userId })
    .eq('id', clienteId);
  if (error) throw error;
}

async function adicionarCuradoria(ref, tipo, motivo, userId) {
  const refNorm = refSemZero(ref);
  const payload = {
    ref: refNorm,
    tipo,
    motivo,
    ativo: true,
    adicionado_por: userId,
    data_inicio: new Date().toISOString().slice(0, 10),
  };
  // Novidade manual = janela de 15 dias
  if (tipo === 'novidade_manual') {
    const fim = new Date();
    fim.setDate(fim.getDate() + 15);
    payload.data_fim = fim.toISOString().slice(0, 10);
  }
  const { data, error } = await supabase
    .from('lojas_produtos_curadoria')
    .upsert(payload, { onConflict: 'ref,tipo' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function removerCuradoria(curadoriaId) {
  const { error } = await supabase
    .from('lojas_produtos_curadoria')
    .update({ ativo: false })
    .eq('id', curadoriaId);
  if (error) throw error;
}

async function marcarSugestaoExecutada(sugestaoId, mensagem) {
  const updates = {
    status: 'executada',
    executada_em: new Date().toISOString(),
  };
  if (mensagem) updates.mensagem_gerada = mensagem;
  const { data, error } = await supabase
    .from('lojas_sugestoes_diarias')
    .update(updates)
    .eq('id', sugestaoId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function dispensarSugestao(sugestaoId, motivo) {
  const { data, error } = await supabase
    .from('lojas_sugestoes_diarias')
    .update({
      status: 'dispensada',
      dispensada_em: new Date().toISOString(),
      motivo_dispensa: motivo,
    })
    .eq('id', sugestaoId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function registrarAcao(acao, userId, vendedoraId) {
  const { error } = await supabase
    .from('lojas_acoes')
    .insert({
      ...acao,
      vendedora_id: vendedoraId || acao.vendedora_id,
    });
  if (error) console.warn('[Lojas] erro ao registrar ação', error);
  // não bloqueia fluxo principal
}

// ═══════════════════════════════════════════════════════════════════════════
// IA: chamadas para Edge Function /api/lojas-ia
// ═══════════════════════════════════════════════════════════════════════════

async function gerarSugestoesIA(vendedoraId) {
  // Roda na Edge Function pra não expor API key.
  // A function recebe vendedora_id, monta payload com carteira/produtos/promoções,
  // chama Anthropic com SYSTEM_PROMPT_SUGESTOES, e grava em lojas_sugestoes_diarias.
  const res = await fetch('/api/lojas-ia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'gerar_sugestoes',
      vendedora_id: vendedoraId,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`IA erro ${res.status}: ${txt}`);
  }
  return res.json();
}

async function gerarMensagemIA(sugestaoId, contextoExtra = {}) {
  const res = await fetch('/api/lojas-ia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'gerar_mensagem',
      sugestao_id: sugestaoId,
      contexto: contextoExtra,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`IA erro ${res.status}: ${txt}`);
  }
  const json = await res.json();
  return json.mensagem;
}

// ═══════════════════════════════════════════════════════════════════════════
// REALTIME: subscrições
// ═══════════════════════════════════════════════════════════════════════════

function subscribeRealtime({ vendedoraId, isAdmin, dispatch }) {
  const channels = [];
  
  // ─── 1. Sugestões diárias ───────────────────────────────────────────────
  const chSugestoes = supabase
    .channel(REALTIME_CHANNELS.SUGESTOES)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'lojas_sugestoes_diarias',
      filter: isAdmin ? undefined : `vendedora_id=eq.${vendedoraId}`,
    }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        dispatch({ type: 'UPDATE_SUGESTAO', sugestao: payload.new });
      }
    })
    .subscribe((status) => {
      dispatch({ type: 'SET_REALTIME_STATUS', canal: 'sugestoes', status });
    });
  channels.push(chSugestoes);
  
  // ─── 2. Pedidos sacola ──────────────────────────────────────────────────
  const chSacola = supabase
    .channel(REALTIME_CHANNELS.SACOLA)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'lojas_pedidos_sacola',
      filter: isAdmin ? undefined : `vendedora_id=eq.${vendedoraId}`,
    }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
        dispatch({ type: 'UPDATE_SACOLA', pedido: payload.new });
      }
    })
    .subscribe((status) => {
      dispatch({ type: 'SET_REALTIME_STATUS', canal: 'sacola', status });
    });
  channels.push(chSacola);
  
  // ─── 3. Importações (só admin) ──────────────────────────────────────────
  if (isAdmin) {
    const chImports = supabase
      .channel(REALTIME_CHANNELS.IMPORTACOES)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'lojas_importacoes',
      }, (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          dispatch({ type: 'UPDATE_IMPORTACAO', importacao: payload.new });
        }
      })
      .subscribe((status) => {
        dispatch({ type: 'SET_REALTIME_STATUS', canal: 'importacoes', status });
      });
    channels.push(chImports);
  }
  
  // ─── 4. KPIs (atualização de status quando importação roda) ─────────────
  const chKpis = supabase
    .channel(REALTIME_CHANNELS.KPIS)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'lojas_clientes_kpis',
    }, (payload) => {
      dispatch({ type: 'UPDATE_KPI', cliente_id: payload.new.cliente_id, kpi: payload.new });
    })
    .subscribe((status) => {
      dispatch({ type: 'SET_REALTIME_STATUS', canal: 'kpis', status });
    });
  channels.push(chKpis);
  
  return () => {
    channels.forEach(ch => supabase.removeChannel(ch));
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK: useLojasModule (lógica principal)
// ═══════════════════════════════════════════════════════════════════════════

function useLojasModule() {
  const [state, dispatch] = useReducer(lojasReducer, initialState);
  const initialized = useRef(false);
  
  // ─── Inicialização ──────────────────────────────────────────────────────
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    
    (async () => {
      try {
        dispatch({ type: 'SET_PHASE', phase: LOAD_PHASES.LOADING_USER });
        
        // 1. Pega userId
        const userId = getUserIdFromStorage();
        if (!userId) {
          dispatch({ type: 'SET_PHASE', phase: LOAD_PHASES.ERROR, error: 'Usuário não autenticado' });
          return;
        }
        dispatch({ type: 'SET_USER', userId });
        const isAdmin = ehUsuarioAdmin(userId);
        
        // 2. Carrega vendedoras (todas)
        dispatch({ type: 'SET_PHASE', phase: LOAD_PHASES.LOADING_VENDEDORAS });
        const vendedoras = await loadVendedoras();
        dispatch({ type: 'SET_VENDEDORAS', vendedoras });
        
        // 3. Se não é admin, busca a vendedora correspondente
        let vendedoraLogada = null;
        if (!isAdmin) {
          vendedoraLogada = await loadVendedoraByUserId(userId);
          if (!vendedoraLogada) {
            dispatch({
              type: 'SET_PHASE',
              phase: LOAD_PHASES.ERROR,
              error: 'Usuário não está cadastrado como vendedora',
            });
            return;
          }
          dispatch({ type: 'SET_VENDEDORA_LOGADA', vendedora: vendedoraLogada });
          dispatch({ type: 'SET_VENDEDORA_ATIVA', vendedora: vendedoraLogada });
        }
        
        // 4. Carrega carteira
        dispatch({ type: 'SET_PHASE', phase: LOAD_PHASES.LOADING_CARTEIRA });
        const filtroVendedoraCarteira = isAdmin ? null : vendedoraLogada.id;
        const [clientes, grupos, sacola] = await Promise.all([
          loadClientes(filtroVendedoraCarteira),
          loadGrupos(filtroVendedoraCarteira),
          loadPedidosSacola(filtroVendedoraCarteira),
        ]);
        dispatch({ type: 'SET_CLIENTES', clientes });
        dispatch({ type: 'SET_GRUPOS', grupos });
        dispatch({ type: 'SET_SACOLA', sacola });
        
        // 5. Carrega KPIs em paralelo
        const kpis = await loadKpis(clientes.map(c => c.id));
        dispatch({ type: 'SET_KPIS', kpis });
        
        // 6. Carrega produtos + curadoria + promoções
        dispatch({ type: 'SET_PHASE', phase: LOAD_PHASES.LOADING_PRODUTOS });
        const [produtos, curadoria, promocoes] = await Promise.all([
          loadProdutos(),
          loadCuradoria(),
          loadPromocoes(),
        ]);
        dispatch({ type: 'SET_PRODUTOS', produtos });
        dispatch({ type: 'SET_CURADORIA', curadoria });
        dispatch({ type: 'SET_PROMOCOES', promocoes });
        
        // 7. Carrega sugestões de hoje (só pra vendedora ativa)
        dispatch({ type: 'SET_PHASE', phase: LOAD_PHASES.LOADING_SUGESTOES });
        const vendedoraAtivaId = (vendedoraLogada || vendedoras[0])?.id;
        if (vendedoraAtivaId) {
          const sugestoes = await loadSugestoesHoje(vendedoraAtivaId);
          dispatch({ type: 'SET_SUGESTOES', sugestoes });
        }
        
        // 8. Importações (só admin)
        if (isAdmin) {
          const importacoes = await loadImportacoes();
          dispatch({ type: 'SET_IMPORTACOES', importacoes });
        }
        
        // ✅ Pronto
        dispatch({ type: 'SET_PHASE', phase: LOAD_PHASES.READY });
        dispatch({ type: 'SET_ULTIMA_SINC', timestamp: new Date().toISOString() });
      } catch (e) {
        console.error('[Lojas] erro init', e);
        dispatch({
          type: 'SET_PHASE',
          phase: LOAD_PHASES.ERROR,
          error: e.message || 'Erro desconhecido',
        });
      }
    })();
  }, []);
  
  // ─── Realtime subscription ──────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== LOAD_PHASES.READY) return;
    if (!state.vendedoraAtiva && !state.isAdmin) return;
    
    const unsubscribe = subscribeRealtime({
      vendedoraId: state.vendedoraAtiva?.id,
      isAdmin: state.isAdmin,
      dispatch,
    });
    return unsubscribe;
  }, [state.phase, state.vendedoraAtiva?.id, state.isAdmin]);
  
  // ─── Online/offline detection ──────────────────────────────────────────
  useEffect(() => {
    const onOnline = () => dispatch({ type: 'SET_ONLINE', online: true });
    const onOffline = () => dispatch({ type: 'SET_ONLINE', online: false });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    dispatch({ type: 'SET_ONLINE', online: navigator.onLine });
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
  
  // ─── Trocar vendedora ativa (só admin) ──────────────────────────────────
  const trocarVendedoraAtiva = useCallback(async (vendedora) => {
    if (!state.isAdmin) return;
    dispatch({ type: 'SET_VENDEDORA_ATIVA', vendedora });
    if (vendedora) {
      const sugestoes = await loadSugestoesHoje(vendedora.id);
      dispatch({ type: 'SET_SUGESTOES', sugestoes });
    }
  }, [state.isAdmin]);
  
  // ─── Recarregar tudo (refresh manual) ──────────────────────────────────
  const refresh = useCallback(async () => {
    initialized.current = false;
    // Re-trigga useEffect de init
    setTimeout(() => { initialized.current = true; }, 0);
  }, []);
  
  // ─── Wrappers que disparam ações + atualizam estado ────────────────────
  
  const handleEditarApelido = useCallback(async (clienteId, apelido) => {
    const cliente = await saveApelidoCliente(clienteId, apelido, state.userId);
    dispatch({ type: 'UPDATE_CLIENTE', cliente });
    return cliente;
  }, [state.userId]);
  
  const handleArquivarCliente = useCallback(async (clienteId, motivo) => {
    await arquivarCliente(clienteId, motivo, state.userId);
    // Remove da lista local
    dispatch({
      type: 'SET_CLIENTES',
      clientes: state.clientes.filter(c => c.id !== clienteId),
    });
  }, [state.userId, state.clientes]);
  
  const handlePularCliente = useCallback(async (clienteId, dias) => {
    await pularCliente(clienteId, dias, state.userId);
  }, [state.userId]);
  
  const handleTransferirCliente = useCallback(async (clienteId, vendedoraDestinoId, motivo) => {
    await transferirCliente(clienteId, vendedoraDestinoId, motivo, state.userId);
    // Atualiza local
    const cliente = state.clientes.find(c => c.id === clienteId);
    if (cliente) {
      dispatch({
        type: 'UPDATE_CLIENTE',
        cliente: { ...cliente, vendedora_id: vendedoraDestinoId },
      });
    }
  }, [state.userId, state.clientes]);
  
  const handleTransferirEmMassa = useCallback(async (origemId, destinoId, motivo) => {
    const result = await transferirCarteiraEmMassa(origemId, destinoId, motivo, state.userId);
    // Recarrega clientes
    const filtroVendedoraCarteira = state.isAdmin ? null : state.vendedoraLogada?.id;
    const clientes = await loadClientes(filtroVendedoraCarteira);
    dispatch({ type: 'SET_CLIENTES', clientes });
    return result;
  }, [state.userId, state.isAdmin, state.vendedoraLogada]);
  
  const handleSaveVendedora = useCallback(async (vendedora) => {
    const saved = await saveVendedora(vendedora, state.userId);
    const vendedoras = await loadVendedoras();
    dispatch({ type: 'SET_VENDEDORAS', vendedoras });
    return saved;
  }, [state.userId]);
  
  const handleInativarVendedora = useCallback(async (vendedoraId) => {
    await inativarVendedora(vendedoraId, state.userId);
    const vendedoras = await loadVendedoras();
    dispatch({ type: 'SET_VENDEDORAS', vendedoras });
  }, [state.userId]);
  
  const handleSavePromocao = useCallback(async (promocao) => {
    const saved = await savePromocao(promocao, state.userId);
    const promocoes = await loadPromocoes();
    dispatch({ type: 'SET_PROMOCOES', promocoes });
    return saved;
  }, [state.userId]);
  
  const handlePausarPromocao = useCallback(async (promocaoId) => {
    await pausarPromocao(promocaoId);
    const promocoes = await loadPromocoes();
    dispatch({ type: 'SET_PROMOCOES', promocoes });
  }, []);
  
  const handleSaveGrupo = useCallback(async (grupo) => {
    const saved = await saveGrupo(grupo, state.userId);
    const grupos = await loadGrupos(state.isAdmin ? null : state.vendedoraLogada?.id);
    dispatch({ type: 'SET_GRUPOS', grupos });
    return saved;
  }, [state.userId, state.isAdmin, state.vendedoraLogada]);
  
  const handleAdicionarAoGrupo = useCallback(async (clienteId, grupoId) => {
    await adicionarClienteAoGrupo(clienteId, grupoId, state.userId);
    const cliente = state.clientes.find(c => c.id === clienteId);
    if (cliente) {
      dispatch({ type: 'UPDATE_CLIENTE', cliente: { ...cliente, grupo_id: grupoId } });
    }
  }, [state.userId, state.clientes]);
  
  const handleRemoverDoGrupo = useCallback(async (clienteId) => {
    await removerClienteDoGrupo(clienteId, state.userId);
    const cliente = state.clientes.find(c => c.id === clienteId);
    if (cliente) {
      dispatch({ type: 'UPDATE_CLIENTE', cliente: { ...cliente, grupo_id: null } });
    }
  }, [state.userId, state.clientes]);
  
  const handleAdicionarCuradoria = useCallback(async (ref, tipo, motivo) => {
    await adicionarCuradoria(ref, tipo, motivo, state.userId);
    const curadoria = await loadCuradoria();
    dispatch({ type: 'SET_CURADORIA', curadoria });
  }, [state.userId]);
  
  const handleRemoverCuradoria = useCallback(async (curadoriaId) => {
    await removerCuradoria(curadoriaId);
    const curadoria = await loadCuradoria();
    dispatch({ type: 'SET_CURADORIA', curadoria });
  }, []);
  
  const handleMarcarSugestaoExecutada = useCallback(async (sugestaoId, mensagem) => {
    const sugestao = await marcarSugestaoExecutada(sugestaoId, mensagem);
    dispatch({ type: 'UPDATE_SUGESTAO', sugestao });
    if (state.vendedoraAtiva) {
      registrarAcao(
        { sugestao_id: sugestaoId, tipo_acao: 'mensagem_enviada', resultado: 'sucesso' },
        state.userId,
        state.vendedoraAtiva.id,
      );
    }
  }, [state.userId, state.vendedoraAtiva]);
  
  const handleDispensarSugestao = useCallback(async (sugestaoId, motivo) => {
    const sugestao = await dispensarSugestao(sugestaoId, motivo);
    dispatch({ type: 'UPDATE_SUGESTAO', sugestao });
  }, []);
  
  const handleGerarMensagem = useCallback(async (sugestaoId, contextoExtra) => {
    return await gerarMensagemIA(sugestaoId, contextoExtra);
  }, []);
  
  const handleRegerarSugestoes = useCallback(async () => {
    if (!state.vendedoraAtiva) return;
    await gerarSugestoesIA(state.vendedoraAtiva.id);
    // Realtime vai entregar as novas sugestões automaticamente
  }, [state.vendedoraAtiva]);
  
  // ─── Computed: clientes enriquecidos com KPIs + sub-tipo de sacola ─────
  const clientesEnriquecidos = useMemo(() => {
    return state.clientes.map(c => {
      const kpi = state.clientesKpis[c.id] || {};
      const sacolaAtiva = state.pedidosSacola.find(p => p.cliente_id === c.id);
      
      // Status calculado (sacola sobrescreve)
      let statusAtual = kpi.status_atual;
      if (sacolaAtiva) statusAtual = 'separandoSacola';
      else if (!statusAtual) statusAtual = calcularStatusCliente(kpi.dias_sem_comprar, !!sacolaAtiva);
      
      // Sub-tipo da sacola (se ativa)
      let subtipoSacola = null;
      let diasSacola = null;
      if (sacolaAtiva) {
        diasSacola = calcularDiasSacola(sacolaAtiva.data_cadastro_sacola);
        subtipoSacola = sacolaAtiva.subtipo_sugerido || classificarPedidoSacola(diasSacola, false, false);
      }
      
      return {
        ...c,
        kpi,
        statusAtual,
        sacolaAtiva,
        diasSacola,
        subtipoSacola,
      };
    });
  }, [state.clientes, state.clientesKpis, state.pedidosSacola]);
  
  // ─── Computed: filtro pra vendedora atual ──────────────────────────────
  const carteiraAtual = useMemo(() => {
    if (!state.vendedoraAtiva) return clientesEnriquecidos;
    return clientesEnriquecidos.filter(c => c.vendedora_id === state.vendedoraAtiva.id);
  }, [clientesEnriquecidos, state.vendedoraAtiva]);
  
  // ─── Retorna API pública ───────────────────────────────────────────────
  return {
    state,
    dispatch,
    
    // computed
    clientesEnriquecidos,
    carteiraAtual,
    
    // actions
    trocarVendedoraAtiva,
    refresh,
    
    // edição cliente
    handleEditarApelido,
    handleArquivarCliente,
    handlePularCliente,
    handleTransferirCliente,
    handleTransferirEmMassa,
    handleAdicionarAoGrupo,
    handleRemoverDoGrupo,
    
    // vendedoras
    handleSaveVendedora,
    handleInativarVendedora,
    
    // promoções
    handleSavePromocao,
    handlePausarPromocao,
    
    // grupos
    handleSaveGrupo,
    
    // curadoria
    handleAdicionarCuradoria,
    handleRemoverCuradoria,
    
    // sugestões e IA
    handleMarcarSugestaoExecutada,
    handleDispensarSugestao,
    handleGerarMensagem,
    handleRegerarSugestoes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE: Loading screen
// ═══════════════════════════════════════════════════════════════════════════

function LoadingScreen({ phase, error, online }) {
  const messages = {
    [LOAD_PHASES.LOADING_USER]: 'Verificando autenticação…',
    [LOAD_PHASES.LOADING_VENDEDORAS]: 'Carregando vendedoras…',
    [LOAD_PHASES.LOADING_CARTEIRA]: 'Carregando carteira…',
    [LOAD_PHASES.LOADING_PRODUTOS]: 'Carregando produtos e promoções…',
    [LOAD_PHASES.LOADING_SUGESTOES]: 'Buscando sugestões do dia…',
  };
  
  if (phase === LOAD_PHASES.ERROR) {
    return (
      <div style={{
        background: palette.bg, minHeight: '100vh', fontFamily: FONT,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24, textAlign: 'center',
      }}>
        <div style={{
          width: 60, height: 60, borderRadius: '50%', background: palette.alertSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}>
          <AlertCircle size={30} color={palette.alert} />
        </div>
        <div style={{ fontSize: 17, fontWeight: 600, color: palette.ink, marginBottom: 8 }}>
          Não foi possível carregar
        </div>
        <div style={{ fontSize: 13, color: palette.inkSoft, lineHeight: 1.5, maxWidth: 320 }}>
          {error || 'Erro desconhecido'}
        </div>
        <button onClick={() => window.location.reload()} style={{
          marginTop: 20, background: palette.accent, color: palette.bg, border: 'none',
          borderRadius: 10, padding: '12px 24px', fontSize: 14, fontWeight: 600,
          cursor: 'pointer', fontFamily: FONT,
        }}>
          Tentar novamente
        </button>
      </div>
    );
  }
  
  return (
    <div style={{
      background: palette.bg, minHeight: '100vh', fontFamily: FONT,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 24, textAlign: 'center',
    }}>
      <div style={{ marginBottom: 16, animation: 'spin 1s linear infinite' }}>
        <Loader2 size={40} color={palette.accent} />
      </div>
      <div style={{ fontSize: 14, color: palette.inkSoft }}>
        {messages[phase] || 'Carregando…'}
      </div>
      {!online && (
        <div style={{
          marginTop: 16, padding: '8px 14px', background: palette.warnSoft,
          color: palette.warn, borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <WifiOff size={14} /> Sem conexão
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTES UTILITÁRIOS DE UI (reaproveitados do v5 + adições)
// ═══════════════════════════════════════════════════════════════════════════

const LampIcon = ({ size = 16 }) => (
  <Lightbulb size={size} fill={palette.yellow} color={palette.yellow} strokeWidth={1.8}
    style={{ filter: 'drop-shadow(0 0 2px rgba(245,184,0,0.4))' }} />
);

const LojaIcon = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 64 56" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
    <rect x="4" y="4" width="56" height="4" fill="#9ca3af" rx="1" />
    <rect x="6" y="6" width="52" height="14" fill={palette.beigeSoft} stroke={palette.ink} strokeWidth="0.8" />
    <text x="32" y="17" textAnchor="middle" fontFamily="Georgia" fontStyle="italic" fontWeight="bold" fontSize="11" fill={palette.ink}>A</text>
    <rect x="6" y="20" width="52" height="2" fill="#9ca3af" />
    <rect x="6" y="22" width="52" height="32" fill={palette.bg} stroke={palette.ink} strokeWidth="0.8" />
    <rect x="9" y="25" width="20" height="26" fill="#fff" stroke={palette.ink} strokeWidth="0.6" />
    <rect x="35" y="25" width="20" height="26" fill="#fff" stroke={palette.ink} strokeWidth="0.6" />
    <line x1="29" y1="25" x2="29" y2="51" stroke={palette.ink} strokeWidth="0.6" />
    <line x1="35" y1="25" x2="35" y2="51" stroke={palette.ink} strokeWidth="0.6" />
    <rect x="4" y="52" width="56" height="2" fill={palette.ink} rx="0.5" />
  </svg>
);

const Header = ({ title, subtitle, onBack, rightContent }) => (
  <div style={{
    background: palette.ink, color: palette.bg, padding: '14px 16px',
    fontFamily: FONT, position: 'sticky', top: 0, zIndex: 10,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        {onBack && (
          <button onClick={onBack} style={{
            background: 'transparent', border: 'none', color: palette.bg,
            cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
          }}>
            <ArrowLeft size={22} />
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          {!onBack && <LojaIcon size={28} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 17, fontWeight: 600, letterSpacing: 0.3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{title}</div>
            {subtitle && (<div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{subtitle}</div>)}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {rightContent}
      </div>
    </div>
  </div>
);

const StatusDot = ({ status }) => {
  const cores = { ok: palette.ok, warn: palette.warn, alert: palette.alert };
  return <span style={{
    display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
    background: cores[status] || palette.ok, flexShrink: 0,
  }} />;
};

const TabBar = ({ tabs, activeTab, onChange }) => (
  <div style={{
    background: palette.surface, borderBottom: `1px solid ${palette.beige}`,
    padding: '0 4px', position: 'sticky', top: 60, zIndex: 9,
    fontFamily: FONT, display: 'flex', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
  }}>
    {tabs.map(tab => {
      const active = activeTab === tab.id;
      const Icon = tab.icon;
      return (
        <button key={tab.id} onClick={() => onChange(tab.id)} style={{
          background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT,
          padding: '14px 16px', fontSize: 14,
          color: active ? palette.ink : palette.inkMuted,
          fontWeight: active ? 600 : 400,
          borderBottom: active ? `2.5px solid ${palette.accent}` : '2.5px solid transparent',
          display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'all 0.15s',
        }}>
          <Icon size={16} />
          {tab.label}
        </button>
      );
    })}
  </div>
);

const SectionTitle = ({ icon: Icon, children }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 11, fontWeight: 600, color: palette.inkSoft,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10,
  }}>
    {Icon && <Icon size={13} />}
    {children}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL (provisório — Parte 2 vai trazer telas reais)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS DE TELAS (Parte 2a - vendedora; Parte 2b - admin)
// ═══════════════════════════════════════════════════════════════════════════

import {
  HomeScreen,
  CardDiaScreen,
  SugestaoScreen,
  MinhaCarteiraScreen,
  DetalheClienteScreen,
  DestaquesScreen,
  HistoricoCarteiraScreen,
  ModalMensagem,
} from './Lojas_Telas_Vendedora.jsx';

// Parte 2b — admin (será criada em chat separado, importações ficam comentadas até lá)
// import {
//   PromocoesScreen, NovaPromocaoScreen,
//   RegrasScreen,
//   VendedorasAdminScreen, NovaVendedoraScreen,
//   TransferirCarteiraScreen,
//   CuradoriaScreen,
//   GruposListScreen, DetalheGrupoScreen,
//   ImportacoesScreen,
//   CriarGrupoModal, AdicionarCnpjModal,
// } from './Lojas_Telas_Admin.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — Router de telas
// ═══════════════════════════════════════════════════════════════════════════

export default function LojasModule() {
  const lojas = useLojasModule();
  const { state, trocarVendedoraAtiva } = lojas;
  
  // Estado de navegação
  const [screen, setScreen] = useState('home');
  const [sugestaoAtiva, setSugestaoAtiva] = useState(null);
  const [clienteAtivo, setClienteAtivo] = useState(null);
  const [grupoAtivo, setGrupoAtivo] = useState(null);
  const [grupoOrigem, setGrupoOrigem] = useState('grupos');
  const [showModal, setShowModal] = useState(false);
  const [showCriarGrupo, setShowCriarGrupo] = useState(false);
  const [showAdicionarCnpj, setShowAdicionarCnpj] = useState(false);
  const [clienteParaGrupo, setClienteParaGrupo] = useState(null);
  
  // Loading inicial / erro
  if (state.phase !== LOAD_PHASES.READY) {
    return <LoadingScreen phase={state.phase} error={state.errorMsg} online={state.online} />;
  }
  
  // ─── Handlers de navegação ─────────────────────────────────────────────
  
  const handleSelectVendedora = async (v) => {
    await trocarVendedoraAtiva(v);
    setScreen('cardDia');
  };
  
  const handleSelectSugestao = (s) => {
    setSugestaoAtiva(s);
    setScreen('sugestao');
  };
  
  const handleSelectCliente = (c) => {
    setClienteAtivo(c);
    setScreen('cliente');
  };
  
  const handleSelectGrupo = (g) => {
    setGrupoOrigem(screen);
    setGrupoAtivo(g);
    setScreen('grupo');
  };
  
  const handleAbrirAdmin = (id) => {
    if (id === 'promocoes') setScreen('promocoes');
    else if (id === 'regras') setScreen('regras');
    else if (id === 'vendedoras') setScreen('vendedorasAdmin');
    else if (id === 'transferir') setScreen('transferir');
    else if (id === 'curadoria') setScreen('curadoria');
    else if (id === 'grupos') setScreen('gruposAdmin');
    else if (id === 'importacoes') setScreen('importacoes');
  };
  
  const vendedoraAtiva = state.vendedoraAtiva;
  
  return (
    <div style={{
      maxWidth: 460, margin: '0 auto', minHeight: '100vh',
      background: palette.bg, boxShadow: '0 0 40px rgba(0,0,0,0.06)', position: 'relative',
    }}>
      {/* ─── Telas vendedora (Parte 2a) ──────────────────────────────────── */}
      
      {screen === 'home' && (
        <HomeScreen
          lojas={lojas}
          onSelectVendedora={handleSelectVendedora}
          onAbrirHistorico={() => setScreen('historico')}
          onNavegarConfig={handleAbrirAdmin}
        />
      )}
      
      {screen === 'historico' && (
        <HistoricoCarteiraScreen lojas={lojas} onBack={() => setScreen('home')} />
      )}
      
      {screen === 'cardDia' && vendedoraAtiva && (
        <CardDiaScreen
          lojas={lojas}
          vendedora={vendedoraAtiva}
          onBack={() => setScreen('home')}
          onSelectSugestao={handleSelectSugestao}
          onAbrirCarteira={() => setScreen('carteira')}
          onAbrirDestaques={() => setScreen('destaques')}
        />
      )}
      
      {screen === 'carteira' && vendedoraAtiva && (
        <MinhaCarteiraScreen
          lojas={lojas}
          vendedora={vendedoraAtiva}
          onBack={() => setScreen('cardDia')}
          onSelectCliente={handleSelectCliente}
          onSelectGrupo={handleSelectGrupo}
          onAbrirGrupos={() => setScreen('grupos')}
        />
      )}
      
      {screen === 'cliente' && clienteAtivo && (
        <DetalheClienteScreen
          lojas={lojas}
          cliente={clienteAtivo}
          onBack={() => setScreen('carteira')}
          onAbrirGrupo={handleSelectGrupo}
          onCriarGrupo={(c) => { setClienteParaGrupo(c); setShowCriarGrupo(true); }}
        />
      )}
      
      {screen === 'destaques' && vendedoraAtiva && (
        <DestaquesScreen
          lojas={lojas}
          vendedora={vendedoraAtiva}
          onBack={() => setScreen('cardDia')}
        />
      )}
      
      {screen === 'sugestao' && sugestaoAtiva && vendedoraAtiva && (
        <SugestaoScreen
          lojas={lojas}
          sugestao={sugestaoAtiva}
          vendedora={vendedoraAtiva}
          onBack={() => setScreen('cardDia')}
          onPedirMensagem={() => setShowModal(true)}
          onMarcarEnviada={async () => {
            try {
              await lojas.handleMarcarSugestaoExecutada(sugestaoAtiva.id);
              setScreen('cardDia');
            } catch (e) {
              alert('Erro: ' + e.message);
            }
          }}
        />
      )}
      
      {/* ─── Telas admin (Parte 2b - placeholder até implementação) ──────── */}
      
      {['promocoes', 'novaPromocao', 'regras', 'vendedorasAdmin', 'novaVendedora',
        'transferir', 'curadoria', 'grupos', 'gruposAdmin', 'grupo', 'importacoes'].includes(screen) && (
        <div style={{ background: palette.bg, minHeight: '100vh', fontFamily: FONT }}>
          <Header
            title={`${screen.charAt(0).toUpperCase()}${screen.slice(1)}`}
            subtitle="Tela admin — Parte 2b"
            onBack={() => setScreen('home')}
          />
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{
              width: 60, height: 60, borderRadius: '50%', background: palette.warnSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '24px auto 16px',
            }}>
              <Settings size={30} color={palette.warn} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: palette.ink, marginBottom: 6 }}>
              Tela admin em desenvolvimento
            </div>
            <div style={{ fontSize: 12, color: palette.inkSoft, lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
              Esta tela faz parte da <strong>Parte 2b</strong> (telas administrativas).
              Será implementada em chat separado pra preservar contexto.
            </div>
          </div>
        </div>
      )}
      
      {/* ─── Modais ──────────────────────────────────────────────────────── */}
      
      {showModal && sugestaoAtiva && (
        <ModalMensagem
          lojas={lojas}
          sugestao={sugestaoAtiva}
          cliente={state.clientes.find(c => c.id === sugestaoAtiva.cliente_id)}
          onClose={() => setShowModal(false)}
          onEnviada={() => {
            setShowModal(false);
            setScreen('cardDia');
          }}
        />
      )}
      
      {showCriarGrupo && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          padding: 16, fontFamily: FONT,
        }} onClick={() => setShowCriarGrupo(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: palette.surface, borderRadius: 16, padding: 20,
            width: '100%', maxWidth: 460,
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: palette.ink, marginBottom: 8 }}>
              Criar grupo
            </div>
            <div style={{ fontSize: 12, color: palette.inkSoft, marginBottom: 16, lineHeight: 1.5 }}>
              Funcionalidade da Parte 2b — em desenvolvimento.
            </div>
            <button onClick={() => setShowCriarGrupo(false)} style={{
              width: '100%', background: palette.accent, color: palette.bg, border: 'none',
              borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', fontFamily: FONT,
            }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS AUXILIARES (pra Parte 2 reaproveitar)
// ═══════════════════════════════════════════════════════════════════════════

export {
  // hook
  useLojasModule,
  
  // tokens
  palette, FONT, statusMap, subtipoSacolaMap, faseClienteNovaMap,
  
  // componentes
  Header, StatusDot, TabBar, SectionTitle, LampIcon, LojaIcon, LoadingScreen,
  
  // estado
  LOAD_PHASES,
  
  // operações pra UI chamar diretamente
  saveCliente, saveApelidoCliente, arquivarCliente, pularCliente,
  transferirCliente, transferirCarteiraEmMassa,
  saveVendedora, inativarVendedora,
  savePromocao, pausarPromocao,
  saveGrupo, adicionarClienteAoGrupo, removerClienteDoGrupo,
  adicionarCuradoria, removerCuradoria,
  marcarSugestaoExecutada, dispensarSugestao,
  gerarSugestoesIA, gerarMensagemIA,
  
  // supabase client (caso Parte 2 precise queries específicas)
  supabase,
};
