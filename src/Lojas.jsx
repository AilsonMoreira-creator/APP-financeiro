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

// Tokens visuais, supabase client e primitives UI ficam num arquivo separado
// (Lojas_Shared.jsx) pra evitar import circular entre Lojas.jsx ↔ telas.
// Em produção minificada, ciclos de import causam ReferenceError
// "Cannot access X before initialization" no carregamento inicial.
import {
  supabase,
  palette, FONT,
  statusMap, subtipoSacolaMap, faseClienteNovaMap,
  LOAD_PHASES,
  LampIcon, LojaIcon,
  Header, StatusDot, TabBar, SectionTitle, LoadingScreen,
  useLojasW,
} from './Lojas_Shared.jsx';

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
// CONSTANTES DO MÓDULO
// ═══════════════════════════════════════════════════════════════════════════
//
// NOTA: supabase, palette, FONT, statusMap, subtipoSacolaMap, faseClienteNovaMap
// e LOAD_PHASES vêm de Lojas_Shared.jsx (importados no topo deste arquivo).
// Aqui ficam apenas constantes específicas internas.

const REALTIME_CHANNELS = {
  SUGESTOES: 'lojas-sugestoes',
  SACOLA: 'lojas-sacola',
  IMPORTACOES: 'lojas-importacoes',
  KPIS: 'lojas-kpis',
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
  coresAuto: [],                // top cores Bling (vw_ranking_cores_catalogo)
  coresManuais: [],             // cores adicionadas manualmente
  promocoes: [],
  acoes: [],                    // mensagens contextuais por periodo (IA incorpora)
  avisos: [],                   // disparos unicos pra vendedora (vira sugestao 1)
  
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

    case 'SET_ACOES':
      return { ...state, acoes: action.acoes };

    case 'SET_AVISOS':
      return { ...state, avisos: action.avisos };

    case 'SET_CORES_AUTO':
      return { ...state, coresAuto: action.coresAuto };

    case 'SET_CORES_MANUAIS':
      return { ...state, coresManuais: action.coresManuais };

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
  // Padrão real do app principal: 'amica_session' (sem o "i" depois do "m") com {usuario, admin, ...}
  // Fallbacks: 'amicia_user', 'user_id', 'userId'
  try {
    const sess = localStorage.getItem('amica_session');
    if (sess) {
      const p = JSON.parse(sess);
      if (p?.usuario) return p.usuario;
      if (p?.id) return p.id;
    }
  } catch {}
  try {
    const json = localStorage.getItem('amicia_user');
    if (json) {
      const parsed = JSON.parse(json);
      return parsed?.id || parsed?.user_id || parsed?.usuario || null;
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

  // 1) Tenta match exato pelo user_id (case-insensitive)
  // ilike com escape de % e _ pra evitar wildcards acidentais (improvável em
  // userIds simples como "celia", mas seguro)
  const userIdEscaped = String(userId).replace(/[%_]/g, '\\$&');
  let { data, error } = await supabase
    .from('lojas_vendedoras')
    .select('*')
    .ilike('user_id', userIdEscaped)
    .limit(1)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  if (data) return data;

  // 2) Fallback: tenta match pelo NOME (admin pode ter criado vendedora sem
  // setar user_id explicitamente; usa o nome como referência).
  // Normaliza removendo acento e fazendo lowercase pros 2 lados.
  const norm = s => String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  const userIdNorm = norm(userId);

  const { data: todasVendedoras } = await supabase
    .from('lojas_vendedoras')
    .select('*')
    .eq('ativa', true);

  const match = (todasVendedoras || []).find(v => norm(v.nome) === userIdNorm);
  return match || null;
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

// ─── AÇÕES (mensagens contextuais por período) ─────────────────────────
async function loadAcoes() {
  const { data, error } = await supabase
    .from('lojas_acoes')
    .select('*')
    .order('data_inicio', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function salvarAcao(acao) {
  if (acao.id) {
    const { error } = await supabase
      .from('lojas_acoes')
      .update({
        texto: acao.texto,
        data_inicio: acao.data_inicio,
        data_fim: acao.data_fim,
        ativa: acao.ativa,
      })
      .eq('id', acao.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('lojas_acoes')
      .insert({
        texto: acao.texto,
        data_inicio: acao.data_inicio,
        data_fim: acao.data_fim,
        ativa: acao.ativa ?? true,
        criado_por: acao.criado_por || null,
      });
    if (error) throw error;
  }
}

async function removerAcao(acaoId) {
  const { error } = await supabase
    .from('lojas_acoes')
    .delete()
    .eq('id', acaoId);
  if (error) throw error;
}

// ─── AVISOS (disparo único pra vendedora) ──────────────────────────────
async function loadAvisos() {
  const { data, error } = await supabase
    .from('lojas_avisos')
    .select('*')
    .order('data_disparo', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

async function salvarAviso(aviso) {
  if (aviso.id) {
    const { error } = await supabase
      .from('lojas_avisos')
      .update({
        texto: aviso.texto,
        data_disparo: aviso.data_disparo,
        vendedoras_ids: aviso.vendedoras_ids,
        cliente_id: aviso.cliente_id || null,
        status: aviso.status,
      })
      .eq('id', aviso.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('lojas_avisos')
      .insert({
        texto: aviso.texto,
        data_disparo: aviso.data_disparo,
        vendedoras_ids: aviso.vendedoras_ids,
        cliente_id: aviso.cliente_id || null,
        status: 'pendente',
        criado_por: aviso.criado_por || null,
      });
    if (error) throw error;
  }
}

async function removerAviso(avisoId) {
  const { error } = await supabase
    .from('lojas_avisos')
    .delete()
    .eq('id', avisoId);
  if (error) throw error;
}

// ─── CORES (auto Bling + manual) ───────────────────────────────────────
async function loadCoresAuto() {
  const { data, error } = await supabase
    .from('vw_ranking_cores_catalogo')
    .select('cor, cor_key, vendas_30d, rank_global, elegivel_gate1')
    .eq('elegivel_gate1', true)
    .order('rank_global', { ascending: true })
    .limit(20);
  if (error) {
    console.warn('vw_ranking_cores_catalogo indisponivel:', error.message);
    return [];
  }
  return data || [];
}

async function loadCoresManuais() {
  const { data, error } = await supabase
    .from('lojas_cores_curadoria_manual')
    .select('*')
    .eq('ativa', true)
    .order('cor');
  if (error) {
    console.warn('lojas_cores_curadoria_manual indisponivel:', error.message);
    return [];
  }
  return data || [];
}

async function adicionarCorManual({ cor, motivo, criado_por }) {
  const cor_key = cor.toLowerCase().trim().replace(/\s+/g, ' ');
  const cor_bonita = cor.trim();
  const { error } = await supabase
    .from('lojas_cores_curadoria_manual')
    .insert({ cor_key, cor: cor_bonita, motivo: motivo || null, criado_por: criado_por || null });
  if (error) throw error;
}

async function removerCorManual(corId) {
  const { error } = await supabase
    .from('lojas_cores_curadoria_manual')
    .delete()
    .eq('id', corId);
  if (error) throw error;
}

// ─── LINKS VESTI da vendedora ──────────────────────────────────────────
async function salvarLinksVesti(vendedoraId, { link_1, link_2, link_3, link_ativo }) {
  const { error } = await supabase
    .from('lojas_vendedoras')
    .update({
      vesti_link_1: link_1 || null,
      vesti_link_2: link_2 || null,
      vesti_link_3: link_3 || null,
      vesti_link_ativo: link_ativo || null,
    })
    .eq('id', vendedoraId);
  if (error) throw error;
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
  // Decisão Ailson 28/04/2026: schema mantém apelido + comprador_nome separados,
  // mas a UI escreve nas DUAS colunas com o mesmo valor. Compatibilidade total
  // com importações antigas + novo fluxo unificado de "nome do comprador".
  const { data, error } = await supabase
    .from('lojas_clientes')
    .update({
      apelido,
      comprador_nome: apelido,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
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
// CONFIG E HISTÓRICO (helpers usados pelas telas admin — Parte 2b)
// ═══════════════════════════════════════════════════════════════════════════

// ─── lojas_config (key-value) ──────────────────────────────────────────────
async function saveConfig(chave, valor, userId) {
  const payload = {
    chave,
    valor,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  const { error } = await supabase
    .from('lojas_config')
    .upsert(payload, { onConflict: 'chave' });
  if (error) throw error;
}

async function loadConfig() {
  const { data, error } = await supabase
    .from('lojas_config')
    .select('chave, valor');
  if (error) throw error;
  return Object.fromEntries((data || []).map(r => [r.chave, r.valor]));
}

// ─── Histórico de promoções (expiradas/pausadas) ───────────────────────────
async function loadPromocoesHistorico(limit = 20) {
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('lojas_promocoes')
    .select('*')
    .or(`ativo.eq.false,data_fim.lt.${hoje}`)
    .order('data_fim', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ─── Upload manual de importação (Drive — UI only por enquanto) ────────────
// MVP: apenas insere registro com status='iniciada'. Edge Function da Parte 5
// vai puxar os arquivos das pastas Mire_Bom_Retiro / Mire_Silva_Teles do Drive.
async function registrarImportacaoManual(tipoArquivo, loja, userId) {
  const payload = {
    tipo_arquivo: tipoArquivo,
    loja: loja || null,
    nome_arquivo: 'manual-' + Date.now(),
    iniciada_em: new Date().toISOString(),
    status: 'iniciada',
    iniciada_por: userId,
  };
  const { data, error } = await supabase
    .from('lojas_importacoes')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ═══════════════════════════════════════════════════════════════════════════
// IA: chamadas para Edge Function /api/lojas-ia
// ═══════════════════════════════════════════════════════════════════════════

async function gerarSugestoesIA(vendedoraId) {
  // Roda na Edge Function pra não expor API key.
  // A function recebe vendedora_id, monta payload com carteira/produtos/promoções,
  // chama Anthropic com SYSTEM_PROMPT_SUGESTOES, e grava em lojas_sugestoes_diarias.
  const userId = getUserIdFromStorage();
  const res = await fetch('/api/lojas-ia', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User': userId || '',
    },
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
  const userId = getUserIdFromStorage();
  const res = await fetch('/api/lojas-ia', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User': userId || '',
    },
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

        // CACHE OPTIMÍSTICO (decisão Ailson 28/04/2026): mostra carteira do
        // localStorage IMEDIATAMENTE, depois recarrega do Supabase em
        // background. Vendedora não fica olhando "Carregando..." 3 segundos.
        // Cache vale 24h (é refrescado sempre no Realtime e nessa carga).
        const cacheKey = `lojas_cache_v1_${filtroVendedoraCarteira || 'admin'}`;
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const { ts, clientes: cClis, grupos: cGrp, sacola: cSac, kpis: cKpis } = JSON.parse(cached);
            const idadeMin = (Date.now() - ts) / 60000;
            if (idadeMin < 1440 && Array.isArray(cClis)) { // 24h
              dispatch({ type: 'SET_CLIENTES', clientes: cClis });
              dispatch({ type: 'SET_GRUPOS', grupos: cGrp || [] });
              dispatch({ type: 'SET_SACOLA', sacola: cSac || [] });
              if (cKpis) dispatch({ type: 'SET_KPIS', kpis: cKpis });
              dispatch({ type: 'SET_PHASE', phase: LOAD_PHASES.READY });
            }
          }
        } catch (e) {
          // Cache corrompido — ignora e segue load normal
          console.warn('[lojas-cache] cache invalido:', e.message);
        }

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

        // Atualiza cache pra próxima carga
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            ts: Date.now(),
            clientes, grupos, sacola, kpis,
          }));
        } catch (e) {
          // localStorage cheio? só ignora
          console.warn('[lojas-cache] save falhou:', e.message);
        }
        
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

        // 6b. Ações + Avisos + Cores (só admin precisa, mas carrega pra todos
        // pra que avisos do dia possam ser exibidos no card)
        try {
          const [acoes, avisos, coresAuto, coresManuais] = await Promise.all([
            loadAcoes(),
            loadAvisos(),
            loadCoresAuto(),
            loadCoresManuais(),
          ]);
          dispatch({ type: 'SET_ACOES', acoes });
          dispatch({ type: 'SET_AVISOS', avisos });
          dispatch({ type: 'SET_CORES_AUTO', coresAuto });
          dispatch({ type: 'SET_CORES_MANUAIS', coresManuais });
        } catch (e) {
          console.warn('[lojas] acoes/avisos/cores nao carregadas:', e?.message);
        }
        
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

  // ─── Ações ────────────────────────────────────────────────────────
  const handleSalvarAcao = useCallback(async (acao) => {
    await salvarAcao({ ...acao, criado_por: state.userId });
    const acoes = await loadAcoes();
    dispatch({ type: 'SET_ACOES', acoes });
  }, [state.userId]);

  const handleRemoverAcao = useCallback(async (acaoId) => {
    await removerAcao(acaoId);
    const acoes = await loadAcoes();
    dispatch({ type: 'SET_ACOES', acoes });
  }, []);

  // ─── Avisos ───────────────────────────────────────────────────────
  const handleSalvarAviso = useCallback(async (aviso) => {
    await salvarAviso({ ...aviso, criado_por: state.userId });
    const avisos = await loadAvisos();
    dispatch({ type: 'SET_AVISOS', avisos });
  }, [state.userId]);

  const handleRemoverAviso = useCallback(async (avisoId) => {
    await removerAviso(avisoId);
    const avisos = await loadAvisos();
    dispatch({ type: 'SET_AVISOS', avisos });
  }, []);

  // ─── Cores ────────────────────────────────────────────────────────
  const handleAdicionarCorManual = useCallback(async ({ cor, motivo }) => {
    await adicionarCorManual({ cor, motivo, criado_por: state.userId });
    const coresManuais = await loadCoresManuais();
    dispatch({ type: 'SET_CORES_MANUAIS', coresManuais });
  }, [state.userId]);

  const handleRemoverCorManual = useCallback(async (corId) => {
    await removerCorManual(corId);
    const coresManuais = await loadCoresManuais();
    dispatch({ type: 'SET_CORES_MANUAIS', coresManuais });
  }, []);

  // ─── Vesti links ──────────────────────────────────────────────────
  const handleSalvarLinksVesti = useCallback(async (vendedoraId, links) => {
    await salvarLinksVesti(vendedoraId, links);
    // Recarrega vendedoras pra refletir mudança no state
    const vendedoras = await loadVendedoras();
    dispatch({ type: 'SET_VENDEDORAS', vendedoras });
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
  
  // ─── Handlers de Config / Histórico / Importação (Parte 2b) ────────────
  
  const handleSaveConfig = useCallback(async (chave, valor) => {
    await saveConfig(chave, valor, state.userId);
  }, [state.userId]);
  
  const handleLoadConfig = useCallback(async () => {
    return await loadConfig();
  }, []);
  
  const handleLoadPromocoesHistorico = useCallback(async (limit = 20) => {
    return await loadPromocoesHistorico(limit);
  }, []);
  
  const handleRegistrarImportacaoManual = useCallback(async (tipoArquivo, loja) => {
    return await registrarImportacaoManual(tipoArquivo, loja, state.userId);
  }, [state.userId]);
  
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
        subtipoSacola = sacolaAtiva.subtipo_sugerido || classificarPedidoSacola(diasSacola);
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
    handleSalvarAcao,
    handleRemoverAcao,
    handleSalvarAviso,
    handleRemoverAviso,
    handleAdicionarCorManual,
    handleRemoverCorManual,
    handleSalvarLinksVesti,
    
    // sugestões e IA
    handleMarcarSugestaoExecutada,
    handleDispensarSugestao,
    handleGerarMensagem,
    handleRegerarSugestoes,
    
    // config / histórico / importação (Parte 2b)
    handleSaveConfig,
    handleLoadConfig,
    handleLoadPromocoesHistorico,
    handleRegistrarImportacaoManual,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// NOTA: LoadingScreen, LampIcon, LojaIcon, Header, StatusDot, TabBar, SectionTitle
// vêm de Lojas_Shared.jsx (importados no topo do arquivo).
// ═══════════════════════════════════════════════════════════════════════════

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

// Parte 2b — telas admin
import {
  PromocoesScreen, NovaPromocaoScreen,
  RegrasScreen,
  VendedorasAdminScreen, NovaVendedoraScreen,
  TransferirCarteiraScreen,
  CuradoriaScreen,
  AcoesScreen,
  AvisosScreen,
  GruposListScreen, DetalheGrupoScreen,
  ImportacoesScreen,
  CriarGrupoModal, AdicionarCnpjModal,
} from './Lojas_Telas_Admin.jsx';

// Tela compartilhada (vendedora E admin) pra cadastrar nome do comprador
import { CadastrarCompradorScreen } from './Lojas_CadastrarComprador.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL — Router de telas
// ═══════════════════════════════════════════════════════════════════════════

export default function LojasModule({ userId: userIdProp = null, isAdmin: isAdminProp = false, supabase: supabaseProp = null } = {}) {
  // Se app principal passou userId via prop, registra em sessão temporária pra que
  // o hook useLojasModule e os fetch /api/lojas-ia consigam pegar via getUserIdFromStorage()
  if (userIdProp && typeof window !== 'undefined') {
    try {
      // Só sobreescreve se não houver amica_session ativa OU se for diferente
      const cur = localStorage.getItem('amica_session');
      const parsed = cur ? JSON.parse(cur) : null;
      if (!parsed || parsed.usuario !== userIdProp) {
        // Não cria sessão fake — só registra fallback
        if (!localStorage.getItem('user_id')) localStorage.setItem('user_id', userIdProp);
      }
    } catch {}
  }
  const lojas = useLojasModule();
  const { state, trocarVendedoraAtiva } = lojas;

  // Detector mobile (mesmo padrão SalasCorteContent no App.tsx).
  // Mobile (<640px): maxWidth 460. Desktop (≥640px): maxWidth 900 + fz/sz add 1px.
  const w = useLojasW();
  const mobile = w < 640;
  
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
  // Parte 2b — estados pra edição
  const [promocaoEdit, setPromocaoEdit] = useState(null);
  const [vendedoraEdit, setVendedoraEdit] = useState(null);
  
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
    else if (id === 'acoes') setScreen('acoes');
    else if (id === 'avisos') setScreen('avisos');
    else if (id === 'grupos') setScreen('gruposAdmin');
    else if (id === 'importacoes') setScreen('importacoes');
    else if (id === 'cadastrarComprador') setScreen('cadastrarComprador');
  };
  
  const vendedoraAtiva = state.vendedoraAtiva;
  
  return (
    <div style={{
      maxWidth: mobile ? 460 : 900, margin: '0 auto', minHeight: '100vh',
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
          onAbrirCadastrarComprador={() => setScreen('cadastrarComprador')}
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
      
      {/* ─── Telas admin (Parte 2b) ──────────────────────────────────────── */}

      {screen === 'promocoes' && (
        <PromocoesScreen
          lojas={lojas}
          onBack={() => setScreen('home')}
          onNovaPromocao={() => { setPromocaoEdit(null); setScreen('novaPromocao'); }}
          onEditarPromocao={(p) => { setPromocaoEdit(p); setScreen('novaPromocao'); }}
        />
      )}

      {screen === 'novaPromocao' && (
        <NovaPromocaoScreen
          lojas={lojas}
          promocaoExistente={promocaoEdit}
          onBack={() => { setPromocaoEdit(null); setScreen('promocoes'); }}
          onSaved={() => { setPromocaoEdit(null); setScreen('promocoes'); }}
        />
      )}

      {screen === 'regras' && (
        <RegrasScreen lojas={lojas} onBack={() => setScreen('home')} />
      )}

      {screen === 'vendedorasAdmin' && (
        <VendedorasAdminScreen
          lojas={lojas}
          onBack={() => setScreen('home')}
          onNovaVendedora={() => { setVendedoraEdit(null); setScreen('novaVendedora'); }}
          onEditarVendedora={(v) => { setVendedoraEdit(v); setScreen('novaVendedora'); }}
        />
      )}

      {screen === 'novaVendedora' && (
        <NovaVendedoraScreen
          lojas={lojas}
          vendedoraExistente={vendedoraEdit}
          onBack={() => { setVendedoraEdit(null); setScreen('vendedorasAdmin'); }}
          onSaved={() => { setVendedoraEdit(null); setScreen('vendedorasAdmin'); }}
        />
      )}

      {screen === 'transferir' && (
        <TransferirCarteiraScreen lojas={lojas} onBack={() => setScreen('home')} />
      )}

      {screen === 'curadoria' && (
        <CuradoriaScreen lojas={lojas} onBack={() => setScreen('home')} />
      )}

      {screen === 'acoes' && (
        <AcoesScreen lojas={lojas} onBack={() => setScreen('home')} />
      )}

      {screen === 'avisos' && (
        <AvisosScreen lojas={lojas} onBack={() => setScreen('home')} />
      )}

      {(screen === 'grupos' || screen === 'gruposAdmin') && (
        <GruposListScreen
          lojas={lojas}
          isAdmin={state.isAdmin}
          onBack={() => setScreen(screen === 'gruposAdmin' ? 'home' : 'cardDia')}
          onSelectGrupo={(g) => { setGrupoOrigem(screen); setGrupoAtivo(g); setScreen('grupo'); }}
          onCriarGrupo={() => { setClienteParaGrupo(null); setShowCriarGrupo(true); }}
        />
      )}

      {screen === 'grupo' && grupoAtivo && (
        <DetalheGrupoScreen
          lojas={lojas}
          grupo={grupoAtivo}
          onBack={() => setScreen(grupoOrigem || 'gruposAdmin')}
          onAdicionarCnpj={() => setShowAdicionarCnpj(true)}
        />
      )}

      {screen === 'importacoes' && (
        <ImportacoesScreen lojas={lojas} onBack={() => setScreen('home')} />
      )}

      {screen === 'cadastrarComprador' && (
        <CadastrarCompradorScreen
          lojas={lojas}
          onBack={() => setScreen(state.isAdmin ? 'home' : 'carteira')}
        />
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
        <CriarGrupoModal
          lojas={lojas}
          clienteInicial={clienteParaGrupo}
          onClose={() => { setShowCriarGrupo(false); setClienteParaGrupo(null); }}
          onCriado={(grupo) => {
            setShowCriarGrupo(false);
            setClienteParaGrupo(null);
            setGrupoOrigem(screen === 'gruposAdmin' || screen === 'grupos' ? screen : 'gruposAdmin');
            setGrupoAtivo(grupo);
            setScreen('grupo');
          }}
        />
      )}

      {showAdicionarCnpj && grupoAtivo && (
        <AdicionarCnpjModal
          lojas={lojas}
          grupo={grupoAtivo}
          onClose={() => setShowAdicionarCnpj(false)}
          onAdicionado={() => setShowAdicionarCnpj(false)}
        />
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
  
  // Parte 2b
  saveConfig, loadConfig, loadPromocoesHistorico, registrarImportacaoManual,
  
  // supabase client (caso Parte 2 precise queries específicas)
  supabase,
};
