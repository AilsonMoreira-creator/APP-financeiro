/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LojasWhats.jsx — MÓDULO SOFIA (assistente IA WhatsApp)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * UI exibe como "Sofia" mas backend é genérico (lojas-whats-*).
 * Trocar nome = mudar apenas ASSISTANT_NAME abaixo.
 *
 * Acesso: amicia-admin, ailson, tamara (admin only — checado pelo Lojas pai)
 *
 * 5 sub-abas:
 *   🏠 Funil       — visão geral por etapa + contadores
 *   ✋ Aprovar      — fila de sugestões pendentes (core do MVP)
 *   💬 Conversas   — histórico WhatsApp Web style
 *   👩‍💼 Vendedoras — config rodízio + link Vesti
 *   ⚙️  Config      — editar configs (cap, janela, etc)
 *
 * Backend:
 *   GET  /api/lojas-whats-cron-selecionar  → resumo
 *   POST /api/lojas-whats-cron-selecionar  → seleciona
 *   GET  /api/lojas-whats-aprovar          → lista pendentes
 *   POST /api/lojas-whats-aprovar          → aprovar/dispensar
 *
 * Ícones PNG em public/icons/lojas-whats/:
 *   processando, aprovar, enviada, conversando, quente,
 *   esfriando, atendida, vendeu, perdida, whatsapp, carrinho
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ativarPushSofia, desativarPushSofia, statusSubscriptionSofia } from './sofia-push-client.js';
import {
  Bot, RefreshCw, Check, X, Edit3, Send, Filter,
  Users, MessageCircle, Settings, AlertCircle,
  Loader2, ChevronRight, Phone, ShoppingCart, Building2,
  User as UserIcon, Save, Link2, Eye, TrendingUp, Calendar,
  Brain, Paperclip, Trash2, Upload, Star, FileText, Image, Video, Hash,
  Instagram, Facebook, Copy, Circle, Search
} from 'lucide-react';
import {
  supabase,
  palette, FONT,
  Header, TabBar, SectionTitle, LoadingScreen,
} from './Lojas_Shared.jsx';
import ClientesTab from './ClientesSofia.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES & HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const ASSISTANT_NAME = 'Sofia'; // mude aqui pra trocar nome em toda UI

const ICONS_BASE = '/icons/lojas-whats';

// Ícone de etapa: usa PNG colorido pra cards visuais (funil/cards)
const EtapaIcon = ({ nome, size = 28, style = {} }) => {
  // Fallback: se PNG da etapa nao existir (ex: follow_up.png nao subido ainda),
  // troca pelo de conversando.png como placeholder visual.
  // Ailson 27/05/2026
  const handleError = (e) => {
    if (!e.currentTarget.dataset.fallback) {
      e.currentTarget.dataset.fallback = '1';
      e.currentTarget.src = `${ICONS_BASE}/conversando.png`;
    }
  };
  return (
    <img
      src={`${ICONS_BASE}/${nome}.png`}
      alt={nome}
      width={size}
      height={size}
      onError={handleError}
      style={{ display: 'block', objectFit: 'contain', flexShrink: 0, ...style }}
    />
  );
};

// ETAPAS do funil (ordem visual + label + cor)
const ETAPAS = [
  { id: 'processando',  label: 'Processando',  cor: palette.inkMuted },
  { id: 'aprovar',      label: 'Aprovar',      cor: palette.warn },
  { id: 'enviada',      label: 'Enviada',      cor: palette.accent },
  { id: 'conversando',  label: 'Conversando',  cor: palette.accent },
  { id: 'quente',       label: 'Quente',       cor: palette.alert },
  { id: 'atendida',     label: 'Atendida',     cor: palette.purple },
  { id: 'vendeu',       label: 'Vendeu',       cor: palette.ok },
  { id: 'follow_up',    label: 'Follow up',    cor: '#f59e0b' },
  { id: 'perdida',      label: 'Perdida',      cor: palette.inkMuted },
  { id: 'varejo',       label: 'Varejo',       cor: palette.inkMuted },
];

const fz = (n) => `${n}px`;
const sz = (n) => n;

// Hook: detecta se viewport é "desktop" (split view). Mobile mantém fullscreen.
// Ailson 28/05/2026 — split view do chat.
const SPLIT_BREAKPOINT = 768;
export function useIsDesktop(breakpoint = SPLIT_BREAKPOINT) {
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= breakpoint : false
  );
  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= breakpoint);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [breakpoint]);
  return isDesktop;
}

// Card compacto da coluna esquerda no split view. Mostra só o essencial:
// ícone de etapa + nome + unread + origem + badge "Sofia" (sugestão pendente).
// NÃO altera ConversaRow (card expandido) — é um componente paralelo.
// Ailson 28/05/2026.
export const LARGURA_LISTA_SPLIT = 320;
const CardCompacto = ({ c, ativo, onClick, vendedoraNome }) => {
  const ehPJ = c.tipo_documento === 'CNPJ';
  const temSugestaoSofia = !!c.sugestao_quente_pendente_em;
  // Carrinho: detecta por carrinho_id (presente em TODOS leads carrinho, mesmo
  // os legados sem origem_lead corretamente setada). Ailson 28/05/2026.
  // Stories/Linktree adicionados no mesmo dia — vinham faltando aqui (no
  // CardCompacto da split view), apesar de estarem corretos no ConversaRow.
  const origem = (c.carrinho_id || c.origem_lead === 'carrinho_site_amicialoja') ? 'carrinho'
    : c.origem_lead === 'anuncio_facebook' ? 'fb'
    : c.origem_lead === 'anuncio_instagram' ? 'ads'
    : c.origem_lead === 'instagram_stories' ? 'stories'
    : c.origem_lead === 'instagram_linktree' ? 'linktree'
    : c.origem_lead === 'sac' ? 'sac'
    : null;
  // Carrinho "fechado por fora": veio do carrinho mas a vendedora puxou/fechou
  // sem a Sofia ter conduzido (atendido_por != 'sofia' — ex: venda_loja).
  // Pinta o badge carrinho em cor diferente na aba Vendeu. Ailson 30/06/2026.
  const carrinhoForaSofia = origem === 'carrinho' && c.etapa === 'vendeu'
    && c._atendido_por && c._atendido_por !== 'sofia';
  return (
    <div
      onClick={onClick}
      style={{
        margin: '6px 8px', padding: '10px 11px', borderRadius: 10,
        cursor: 'pointer',
        background: ativo ? '#eef4f9' : palette.surface,
        border: `1px solid ${ativo ? palette.accent : palette.beige}`,
        boxShadow: ativo ? '0 1px 5px rgba(74,127,165,0.20)' : '0 1px 2px rgba(0,0,0,0.04)',
        display: 'flex', alignItems: 'center', gap: 10,
        fontFamily: FONT,
        transition: 'background 0.12s, border-color 0.12s, box-shadow 0.12s',
      }}
    >
      {/* Avatar fixo — garante que o nome sempre começa na mesma posição (uniforme) */}
      <div style={{
        width: 38, height: 38, borderRadius: 9, flexShrink: 0,
        background: ativo ? '#dceaf5' : palette.bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <EtapaIcon nome={c.etapa} size={26} />
      </div>
      {/* Bloco de texto */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Linha 1: nome + badges à direita */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: fz(13.5), fontWeight: 700, color: palette.ink,
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{c.nome_cliente || fmtPhone(c.telefone) || '—'}</span>
          {temSugestaoSofia && (
            <span title="Sugestão Sofia pendente" style={{
              background: '#fff8e7', color: '#8a5500', border: '1px solid #f5c84e',
              fontSize: fz(9), fontWeight: 700, padding: '1px 5px', borderRadius: 4, flexShrink: 0,
            }}>Sofia</span>
          )}
          {c.fup_relogio_em && (
            <span title="Follow-up automático em andamento (cliente sem responder)" style={{
              fontSize: fz(13), flexShrink: 0, lineHeight: 1,
            }}>⏰</span>
          )}
          {c.unread_count > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
              fontSize: fz(10), fontWeight: 700, background: '#dc2626', color: '#fff',
              lineHeight: 1, flexShrink: 0,
            }}>{c.unread_count}</span>
          )}
        </div>
        {/* Linha 2: origem destacada + PJ + peças */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
          {origem === 'fb' && (
            <span title="Lead veio de anúncio do Facebook (campanha atacado)" style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              background: '#e7f1fc', color: '#1877f2',
              fontSize: fz(9.5), fontWeight: 800, padding: '2px 7px', borderRadius: 6,
            }}><Facebook size={fz(11)} fill="#1877f2" color="#1877f2" strokeWidth={0} /> Facebook</span>
          )}
          {origem === 'ads' && (
            <span style={{
              background: '#e7f1fc', color: '#1877f2',
              fontSize: fz(9.5), fontWeight: 800, padding: '2px 7px', borderRadius: 6,
              fontFamily: 'Arial, sans-serif',
            }}>f Ads</span>
          )}
          {origem === 'carrinho' && (
            <span title={carrinhoForaSofia
              ? 'Carrinho do site — a vendedora fechou por fora (Sofia não conduziu a venda)'
              : 'Lead veio do carrinho do site'} style={{
              background: carrinhoForaSofia ? '#f3e8ff' : '#fff0e0',
              color: carrinhoForaSofia ? '#7c3aed' : '#a55a00',
              fontSize: fz(9.5), fontWeight: 800, padding: '2px 7px', borderRadius: 6,
            }}>🛒 carrinho</span>
          )}
          {origem === 'stories' && (
            <span title="Lead via link no Stories do Instagram (Amicia)" style={{
              background: 'linear-gradient(45deg, #fbe5d2, #f4d6e5)', color: '#a8388d',
              fontSize: fz(9.5), fontWeight: 800, padding: '2px 7px', borderRadius: 6,
            }}>📸 stories</span>
          )}
          {origem === 'linktree' && (
            <span title="Lead via Linktree do Instagram (Amicia)" style={{
              background: '#e6f7ee', color: '#1f7a48',
              fontSize: fz(9.5), fontWeight: 800, padding: '2px 7px', borderRadius: 6,
            }}>🔗 linktree</span>
          )}
          {origem === 'sac' && (
            <span title="Atendimento iniciado pelo botão do site Amícia (SAC)" style={{
              background: '#eaf1f7', color: '#2c5d86',
              fontSize: fz(9.5), fontWeight: 800, padding: '2px 7px', borderRadius: 6,
            }}>🎧 SAC</span>
          )}
          {ehPJ && (
            <span style={{
              background: '#fff4e0', color: '#8a5500',
              fontSize: fz(9), fontWeight: 700, padding: '2px 6px', borderRadius: 6,
            }}>PJ</span>
          )}
          {c.pesquisa_respondida_em ? (
            <span title={`Respondeu a pesquisa${c.pesquisa_motivo ? ' (' + c.pesquisa_motivo + ')' : ''}`} style={{
              background: '#e6f7ee', color: '#1f7a48',
              fontSize: fz(9), fontWeight: 700, padding: '2px 6px', borderRadius: 6,
            }}>📋 {({ minimo_pecas: 'mín. peças', preco: 'preço', variedade: 'variedade', outros: 'outros' }[c.pesquisa_motivo]) || 'respondeu'}</span>
          ) : c.pesquisa_enviada_em ? (
            <span title="Pesquisa de motivo enviada, aguardando resposta" style={{
              background: '#fff4e5', color: '#9c5b00',
              fontSize: fz(9), fontWeight: 700, padding: '2px 6px', borderRadius: 6,
            }}>📋 pesquisa</span>
          ) : null}
          {c.etapa === 'atendida' && vendedoraNome && (
            <span title={`Atendida por ${vendedoraNome}`} style={{
              background: '#f3eafc', color: '#6b3aa0',
              fontSize: fz(9.5), fontWeight: 700, padding: '2px 7px', borderRadius: 6,
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>👤 {vendedoraNome}</span>
          )}
          {c.etapa === 'follow_up' && vendedoraNome && (
            <span title={`Estava em atendimento com ${vendedoraNome}`} style={{
              background: '#f3eafc', color: '#6b3aa0',
              fontSize: fz(9.5), fontWeight: 700, padding: '2px 7px', borderRadius: 6,
              display: 'inline-flex', alignItems: 'center', gap: 3,
            }}>👤 estava com {vendedoraNome}</span>
          )}
          {c.etapa === 'vendeu' && Number(c.vendeu_valor) > 0 && (
            <span title="Valor da venda fechada" style={{
              background: '#e6f7ee', color: '#1f7a48',
              fontSize: fz(9.5), fontWeight: 800, padding: '2px 7px', borderRadius: 6,
            }}>{fmtMoney(c.vendeu_valor)}</span>
          )}
          {origem === 'carrinho' ? (
            <span style={{ fontSize: fz(10), color: palette.inkMuted, fontWeight: 600 }}>{c.qtd_pecas || 0} pç</span>
          ) : c.qtd_pecas > 0 && (
            <span style={{ fontSize: fz(10), color: palette.inkMuted, fontWeight: 600 }}>{c.qtd_pecas} pç</span>
          )}
        </div>
      </div>
    </div>
  );
};

// Chip compacto pra barra de filtros da coluna esquerda (split view).
// Troca o filtroEtapa sem fechar o chat aberto. Ailson 28/05/2026.
const ChipMini = ({ label, ativo, onClick, badge, unread, cor }) => (
  <button onClick={onClick} style={{
    padding: '3px 8px', borderRadius: 12,
    border: ativo ? `1px solid ${palette.accent}` : `1px solid ${palette.beige}`,
    background: ativo ? palette.accent : palette.surface,
    color: ativo ? '#fff' : palette.inkSoft,
    fontFamily: FONT, fontSize: fz(10), fontWeight: 700,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
    whiteSpace: 'nowrap',
  }}>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: ativo ? '#fff' : (cor || palette.inkMuted), flexShrink: 0 }} />
    {label}
    {badge > 0 && (
      <span style={{
        background: ativo ? 'rgba(255,255,255,0.25)' : palette.bg,
        padding: '0 4px', borderRadius: 8, fontSize: fz(9), fontWeight: 700,
      }}>{badge}</span>
    )}
    {unread > 0 && (
      <span style={{
        background: '#dc2626', color: '#fff', minWidth: 14, height: 14,
        padding: '0 3px', borderRadius: 7, fontSize: fz(9), fontWeight: 700,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>{unread}</span>
    )}
  </button>
);

// Emojis curados pro picker da assistente (Ailson 27/05/2026) — mesmo
// conjunto usado no modulo Lojas pelas vendedoras.
const EMOJIS_PICKER = [
  '😊', '😍', '🥰', '😘', '🔥', '💕',
  '🤎', '💛', '💖', '🌸', '🙏', '👏',
  '✨', '🌟', '🎉', '🚀', '🍁', '🍂',
  '☕', '😉', '😂', '❤️', '👍', '🙌',
];

const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2
});

const fmtPhone = (tel) => {
  if (!tel) return '';
  const s = String(tel).replace(/\D/g, '');
  // 5511999998888 → +55 11 99999-8888
  if (s.length === 13 && s.startsWith('55')) {
    return `+55 (${s.slice(2,4)}) ${s.slice(4,9)}-${s.slice(9)}`;
  }
  if (s.length === 12 && s.startsWith('55')) {
    return `+55 (${s.slice(2,4)}) ${s.slice(4,8)}-${s.slice(8)}`;
  }
  return tel;
};

// Formata CPF (11) ou CNPJ (14). Se ja tiver formato, devolve como esta.
const fmtDocumento = (doc) => {
  if (!doc) return '';
  const s = String(doc).replace(/\D/g, '');
  if (s.length === 11) {
    return `${s.slice(0,3)}.${s.slice(3,6)}.${s.slice(6,9)}-${s.slice(9)}`;
  }
  if (s.length === 14) {
    return `${s.slice(0,2)}.${s.slice(2,5)}.${s.slice(5,8)}/${s.slice(8,12)}-${s.slice(12)}`;
  }
  return doc;
};

// Fonte do chat — Helvetica pra ficar mais proximo do WhatsApp.
// Outras telas do Sofia continuam com FONT (Georgia do app financeiro).
const FONT_CHAT = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';

const fmtRelTime = (iso) => {
  if (!iso) return '';
  const dt = new Date(iso);
  const diffMs = Date.now() - dt.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
};

// ── Relógio do ciclo 24h (Ailson 02/07/2026) ──
// Janela de resposta do WhatsApp fechando: relógio vermelho acende (1x por
// conversa, via cron) faltando 4h pro fim. Ativo = vence no futuro E nenhuma
// atividade depois que acendeu (cliente respondeu ou mandamos algo → some).
const relogioCiclo24Ms = (c, agora = Date.now()) => {
  if (!c?.ciclo24_vence_em || c.etapa !== 'conversando') return null;
  const v = new Date(c.ciclo24_vence_em).getTime();
  if (v <= agora) return null;
  if (new Date(c.ultima_atividade_em).getTime() > v - 4 * 3600 * 1000) return null;
  return v;
};

const RelogioCiclo24 = ({ c }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30000);
    return () => clearInterval(t);
  }, []);
  const v = relogioCiclo24Ms(c);
  if (!v) return null;
  const rest = v - Date.now();
  const h = Math.floor(rest / 3600000);
  const m = Math.floor((rest % 3600000) / 60000);
  return (
    <span title="Janela de 24h do WhatsApp fechando — Sofia gera um gancho leve pra manter o contato antes de vencer"
      style={{
        fontSize: fz(10), padding: '1px 6px', borderRadius: 8, flexShrink: 0,
        background: '#fdecea', color: '#c0392b', fontWeight: 700,
        border: '1px solid #f5b7b1',
      }}>🕐 {h}:{String(m).padStart(2, '0')}</span>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export default function LojasWhats({ userId, isAdmin, onBack }) {
  const [activeTab, setActiveTab] = useState('aprovar');
  // Conversa que a aba Pesquisa pediu pra abrir no chat (Ailson 22/06/2026)
  const [conversaParaAbrir, setConversaParaAbrir] = useState(null);
  const [tabAnterior, setTabAnterior] = useState('aprovar');
  const handleTabChange = (t) => { if (t === 'clientes') setTabAnterior(activeTab); setActiveTab(t); };
  const [refreshTick, setRefreshTick] = useState(0);
  // Push notif desktop: 'desabilitado' (no SW/permission), 'inscrito', 'naoinscrito', null=loading
  const [pushStatus, setPushStatus] = useState(null);
  // Badge "clientes em aberto": conversas do módulo Clientes (feedback/inativo) com msg do cliente ainda não vista.
  const [clientesAbertos, setClientesAbertos] = useState(0);

  useEffect(() => {
    statusSubscriptionSofia().then(setPushStatus).catch(() => setPushStatus('desabilitado'));
  }, []);

  useEffect(() => {
    let vivo = true;
    const contar = async () => {
      const { count } = await supabase
        .from('lojas_whats_conversas')
        .select('id', { count: 'exact', head: true })
        .in('etapa', ['feedback', 'inativo'])
        .gt('unread_count', 0);
      if (vivo) setClientesAbertos(count || 0);
    };
    contar();
    const t = setInterval(contar, 30000);
    return () => { vivo = false; clearInterval(t); };
  }, [refreshTick]);

  const togglePush = async () => {
    if (pushStatus === 'inscrito') {
      const r = await desativarPushSofia();
      if (r.ok) setPushStatus('naoinscrito');
      else alert('Erro: ' + r.motivo);
    } else if (pushStatus === 'naoinscrito') {
      const r = await ativarPushSofia(userId);
      if (r.ok) { setPushStatus('inscrito'); alert('✓ Notificações Sofia ativadas. Só toca quando o app estiver totalmente fechado.'); }
      else alert('Erro: ' + r.motivo);
    }
  };

  // Permissao Sofia (Ailson 25/05/2026): isAdmin OU usuario tem 'sofia' em modulos[].
  // Usuario com modulo sofia tem MESMO acesso de admin dentro do modulo:
  // pode aprovar, editar, dispensar, alterar config, atender clientes.
  const temAcessoSofia = (() => {
    if (isAdmin) return true;
    try {
      const s = JSON.parse(localStorage.getItem('amica_session') || '{}');
      return Array.isArray(s?.modulos) && s.modulos.includes('sofia');
    } catch {
      return false;
    }
  })();

  if (!temAcessoSofia) {
    return (
      <div style={{ padding: 20, fontFamily: FONT, textAlign: 'center' }}>
        <AlertCircle size={48} color={palette.alert} style={{ margin: '20px auto' }} />
        <p>{ASSISTANT_NAME} precisa de permissao especifica. Fala com o admin pra ele liberar.</p>
        <button onClick={onBack} style={btnSecundario}>Voltar</button>
      </div>
    );
  }

  const tabs = [
    { id: 'funil',       label: 'Funil',       icon: () => <EtapaIcon nome="processando" size={16} /> },
    { id: 'conversas',   label: 'Conversas',   icon: () => <EtapaIcon nome="conversando" size={16} /> },
    { id: 'vendedoras',  label: 'Vendedoras',  icon: Users },
    { id: 'conversao',   label: 'Conversão',   icon: TrendingUp },
    { id: 'aprendizado', label: 'Aprendizado', icon: Brain },
    { id: 'midias',      label: 'Mídias',      icon: Paperclip },
    { id: 'pesquisa',    label: 'Pesquisa',    icon: FileText },
    { id: 'config',      label: 'Config',      icon: Settings },
    { id: 'clientes',    label: 'Clientes',    icon: Users, badge: clientesAbertos },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100vh', fontFamily: FONT }}>
      <Header
        title={ASSISTANT_NAME}
        subtitle={`Assistente IA WhatsApp · ${new Date().toLocaleDateString('pt-BR')}`}
        onBack={activeTab === 'clientes' ? () => setActiveTab(tabAnterior || 'aprovar') : onBack}
        rightContent={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {pushStatus && pushStatus !== 'desabilitado' && (
              <button
                onClick={togglePush}
                title={pushStatus === 'inscrito'
                  ? 'Notificações ativas (toca só quando app totalmente fechado) — clique pra desativar'
                  : 'Ativar notificações desktop pra novas msgs Sofia'}
                style={{
                  background: pushStatus === 'inscrito' ? 'rgba(39,174,96,0.85)' : 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff', padding: '6px 10px', borderRadius: 8,
                  cursor: 'pointer', fontSize: fz(14), fontFamily: FONT,
                }}
              >
                {pushStatus === 'inscrito' ? '🔔' : '🔕'}
              </button>
            )}
            <button
              onClick={() => setRefreshTick(t => t + 1)}
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: palette.bg, padding: '6px 10px', borderRadius: 8,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                fontSize: fz(13), fontFamily: FONT,
              }}
            >
              <RefreshCw size={sz(14)} />
            </button>
          </div>
        }
      />
      {activeTab !== 'clientes' && <TabBar tabs={tabs} activeTab={activeTab} onChange={handleTabChange} />}

      {activeTab === 'funil' && <FunilTab refreshTick={refreshTick} />}
      {activeTab === 'conversas' && <ConversasTab refreshTick={refreshTick} userId={userId} conversaInicial={conversaParaAbrir} onAberturaConsumida={() => setConversaParaAbrir(null)} />}
      {activeTab === 'aprovar' && <ConversasTab refreshTick={refreshTick} userId={userId} filtroInicial="aprovar" />}
      {activeTab === 'vendedoras' && <VendedorasTab userId={userId} refreshTick={refreshTick} />}
      {activeTab === 'conversao' && <ConversaoTab refreshTick={refreshTick} />}
      {activeTab === 'aprendizado' && <AprendizadoTab refreshTick={refreshTick} />}
      {activeTab === 'midias' && <MidiasTab refreshTick={refreshTick} />}
      {activeTab === 'pesquisa' && <PesquisaTab refreshTick={refreshTick} onAbrirChat={(id) => { setConversaParaAbrir(id); setActiveTab('conversas'); }} />}
      {activeTab === 'config' && <ConfigTab userId={userId} refreshTick={refreshTick} />}
      {activeTab === 'clientes' && <ClientesTab userId={userId} refreshTick={refreshTick} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1: FUNIL
// ═══════════════════════════════════════════════════════════════════════════

// ─── Realtime resiliente (Ailson 31/05/2026) ──────────────────────────────
// No celular o WebSocket do Supabase cai quando o app vai pra segundo plano e
// nao reconecta sozinho ao voltar — a tela so atualizava em acao manual.
// Este hook:
//   (a) reassina o canal no visibilitychange/focus (removeChannel + subscribe + refetch)
//   (b) trata status do .subscribe (reassina em CHANNEL_ERROR/TIMED_OUT/CLOSED)
//   (c) fallback de polling (~18s) SO com a aba visivel
// montarListeners(c, aoMudar) recebe o canal e o callback, encadeia os .on() e
// devolve o canal. aoMudar normalmente faz setReloadTick(t => t + 1).
function useRealtimeSofia(channelName, montarListeners, aoMudar, { ativo = true, pollMs = 18000 } = {}) {
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;
  const montarRef = useRef(montarListeners);
  montarRef.current = montarListeners;

  useEffect(() => {
    if (!ativo || !channelName) return;
    let canal = null;
    let cancelado = false;
    let epoca = 0; // ignora callbacks de canais antigos (evita loop de re-subscribe)

    const assinar = () => {
      if (cancelado) return;
      const minhaEpoca = ++epoca;
      if (canal) { try { supabase.removeChannel(canal); } catch {} canal = null; }
      let c = supabase.channel(channelName);
      c = montarRef.current(c, () => { aoMudarRef.current && aoMudarRef.current(); });
      c.subscribe((status) => {
        if (cancelado || minhaEpoca !== epoca) return; // canal obsoleto
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (document.visibilityState === 'visible') {
            setTimeout(() => {
              if (!cancelado && minhaEpoca === epoca && document.visibilityState === 'visible') assinar();
            }, 3000);
          }
        }
      });
      canal = c;
    };

    assinar();

    // Voltou pro foco/visibilidade: reassina o canal e refetch imediato.
    const aoVoltar = () => {
      if (document.visibilityState !== 'visible') return;
      assinar();
      aoMudarRef.current && aoMudarRef.current();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);

    // Fallback: polling leve so com aba visivel (rede de seguranca).
    const iv = setInterval(() => {
      if (document.visibilityState === 'visible') aoMudarRef.current && aoMudarRef.current();
    }, pollMs);

    return () => {
      cancelado = true;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
      if (canal) { try { supabase.removeChannel(canal); } catch {} }
    };
  }, [channelName, ativo, pollMs]);
}

function FunilTab({ refreshTick }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [importando, setImportando] = useState(false);
  const [toast, setToast] = useState(null); // { tipo: 'ok'|'erro'|'info', texto }
  const [ajustandoEstoque, setAjustandoEstoque] = useState(false);
  const [matchandoVendas, setMatchandoVendas] = useState(false);

  const carregar = useCallback(async () => {
      setLoading(true);
      try {
        // Calcula datas: hoje, ontem, 7d
        const hoje = new Date();
        const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
        const inicioOntem = new Date(inicioHoje); inicioOntem.setDate(inicioOntem.getDate() - 1);
        const inicioSemana = new Date(inicioHoje); inicioSemana.setDate(inicioSemana.getDate() - 7);

        const fmtUtc = (d) => d.toISOString();

        // KPIs hoje
        const [
          carrinhosHoje, carrinhosOntem,
          enviadasHoje, enviadasOntem,
          recebidasHoje, recebidasOntem,
          quentesHoje, quentesOntem,
          vendeuHoje, vendeuOntem,
          totalRespostas7d, totalEnviadas7d,
          totalConversas, totalAtivasAgora,
        ] = await Promise.all([
          // Novos carrinhos = leads de carrinho CRIADOS no dia (lojas_leads_carrinho).
          // Antes contava conversas iniciadas (errado) — Ailson 31/05/2026.
          supabase.from('lojas_leads_carrinho').select('*', { count: 'exact', head: true }).gte('criado_em', fmtUtc(inicioHoje)),
          supabase.from('lojas_leads_carrinho').select('*', { count: 'exact', head: true }).gte('criado_em', fmtUtc(inicioOntem)).lt('criado_em', fmtUtc(inicioHoje)),
          supabase.from('lojas_whats_mensagens').select('*', { count: 'exact', head: true }).eq('direcao', 'saida').gte('enviada_em', fmtUtc(inicioHoje)),
          supabase.from('lojas_whats_mensagens').select('*', { count: 'exact', head: true }).eq('direcao', 'saida').gte('enviada_em', fmtUtc(inicioOntem)).lt('enviada_em', fmtUtc(inicioHoje)),
          // Mensagens recebidas no dia (direcao=entrada) — Ailson 31/05/2026.
          supabase.from('lojas_whats_mensagens').select('*', { count: 'exact', head: true }).eq('direcao', 'entrada').gte('enviada_em', fmtUtc(inicioHoje)),
          supabase.from('lojas_whats_mensagens').select('*', { count: 'exact', head: true }).eq('direcao', 'entrada').gte('enviada_em', fmtUtc(inicioOntem)).lt('enviada_em', fmtUtc(inicioHoje)),
          supabase.from('lojas_whats_conversas').select('*', { count: 'exact', head: true }).eq('etapa', 'quente').gte('atualizado_em', fmtUtc(inicioHoje)),
          supabase.from('lojas_whats_conversas').select('*', { count: 'exact', head: true }).eq('etapa', 'quente').gte('atualizado_em', fmtUtc(inicioOntem)).lt('atualizado_em', fmtUtc(inicioHoje)),
          supabase.from('lojas_whats_conversas').select('*', { count: 'exact', head: true }).eq('etapa', 'vendeu').gte('vendeu_em', fmtUtc(inicioHoje)),
          supabase.from('lojas_whats_conversas').select('*', { count: 'exact', head: true }).eq('etapa', 'vendeu').gte('vendeu_em', fmtUtc(inicioOntem)).lt('vendeu_em', fmtUtc(inicioHoje)),
          supabase.from('lojas_whats_mensagens').select('*', { count: 'exact', head: true }).eq('direcao', 'entrada').gte('enviada_em', fmtUtc(inicioSemana)),
          supabase.from('lojas_whats_mensagens').select('*', { count: 'exact', head: true }).eq('direcao', 'saida').gte('enviada_em', fmtUtc(inicioSemana)),
          supabase.from('lojas_whats_conversas').select('*', { count: 'exact', head: true }),
          supabase.from('lojas_whats_conversas').select('*', { count: 'exact', head: true }).not('etapa', 'in', '(perdida,vendeu)'),
        ]);

        // Contagem por etapa (pra funil visual)
        const contagensEtapas = {};
        for (const et of ETAPAS) {
          const { count } = await supabase
            .from('lojas_whats_conversas')
            .select('*', { count: 'exact', head: true })
            .eq('etapa', et.id);
          contagensEtapas[et.id] = count || 0;
        }

        // Resumo cron (cap+pendentes)
        let resumoCron = null;
        try {
          const r = await fetch('/api/lojas-whats-cron-selecionar');
          if (r.ok) resumoCron = (await r.json()).data;
        } catch (_) {}

        // Taxa resposta = entradas / saidas nos ultimos 7d
        const totRespostas = totalRespostas7d.count || 0;
        const totEnviadas = totalEnviadas7d.count || 0;
        const taxaResposta = totEnviadas > 0 ? (totRespostas / totEnviadas) : 0;

        setData({
          hoje: {
            carrinhos: carrinhosHoje.count || 0,
            enviadas: enviadasHoje.count || 0,
            recebidas: recebidasHoje.count || 0,
            quentes: quentesHoje.count || 0,
            vendeu: vendeuHoje.count || 0,
          },
          ontem: {
            carrinhos: carrinhosOntem.count || 0,
            enviadas: enviadasOntem.count || 0,
            recebidas: recebidasOntem.count || 0,
            quentes: quentesOntem.count || 0,
            vendeu: vendeuOntem.count || 0,
          },
          taxa_resposta_7d: taxaResposta,
          total_conversas: totalConversas.count || 0,
          total_ativas: totalAtivasAgora.count || 0,
          contagens_etapas: contagensEtapas,
          resumo_cron: resumoCron,
        });
      } catch (e) {
        console.error('[funil] erro:', e);
      }
      setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [refreshTick, reloadKey, carregar]);

  // Auto-dismiss do toast apos alguns segundos
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Importacao manual dos carrinhos do Drive (sem esperar cron das 08:00 BRT).
  // Chama o mesmo cron (site-amicia-drive-cron) com ?force=1: importa os CSVs
  // pra lojas_leads_carrinho E encadeia o selecionar da Sofia, igual ao diario.
  const importarCarrinhos = useCallback(async () => {
    setImportando(true);
    setToast(null);
    try {
      const r = await fetch('/api/site-amicia-drive-cron?force=1');
      const j = await r.json().catch(() => ({}));
      const res = j?.resultado || {};
      const detalhes = Array.isArray(res.detalhes) ? res.detalhes : [];
      const totalCarrinhos = detalhes
        .filter(d => d && d.ok)
        .reduce((s, d) => s + (d.carrinhos_inseridos || 0), 0);
      const processados = res.pares_processados || 0;

      if (!r.ok || j?.ok === false || res.ok === false) {
        setToast({ tipo: 'erro', texto: 'Falha na importação. Tenta de novo em instantes.' });
      } else if (processados > 0) {
        const arq = processados === 1 ? '1 arquivo' : `${processados} arquivos`;
        setToast({ tipo: 'ok', texto: `${totalCarrinhos} carrinhos importados (${arq})` });
        setReloadKey(k => k + 1); // refresh do painel
      } else {
        setToast({ tipo: 'info', texto: 'Nenhum arquivo novo no Drive' });
      }
    } catch (e) {
      setToast({ tipo: 'erro', texto: 'Erro de rede ao importar. Tenta de novo.' });
    }
    setImportando(false);
  }, []);

  // Ajusta estoque: importa a planilha estoque_*.csv do Drive na hora (mesmo
  // cron do 07:00 BRT). Ailson 03/07/2026.
  const ajustarEstoque = useCallback(async () => {
    setAjustandoEstoque(true);
    setToast(null);
    try {
      const r = await fetch('/api/lojas-estoque-grade-cron');
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        setToast({ tipo: 'erro', texto: 'Falha ao ajustar estoque. Tenta de novo.' });
      } else {
        const arq = j.arquivo ? ` (${j.arquivo})` : '';
        setToast({ tipo: 'ok', texto: `Estoque ajustado: ${j.importadas || 0} linhas, ${j.refs_distintas || 0} refs${arq}` });
        setReloadKey(k => k + 1);
      }
    } catch (e) {
      setToast({ tipo: 'erro', texto: 'Erro de rede ao ajustar estoque.' });
    }
    setAjustandoEstoque(false);
  }, []);

  // Match de vendas: cruza Mire x Sofia e dispara CAPI Purchase. Pode demorar,
  // por isso o confirm. Ailson 03/07/2026.
  const matchVendas = useCallback(async () => {
    if (!window.confirm('Rodar o match de vendas agora? Ele cruza as vendas com as conversas e dispara os eventos de compra (CAPI).')) return;
    setMatchandoVendas(true);
    setToast(null);
    try {
      const r = await fetch('/api/lojas-whats-cron-capi-match?executar=1');
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        setToast({ tipo: 'erro', texto: 'Falha no match de vendas. Tenta de novo.' });
      } else {
        const casadas = j.com_match || 0;
        const capi = j.capi_enviado_ok || 0;
        setToast({ tipo: casadas > 0 ? 'ok' : 'info', texto: `Match: ${casadas} venda(s) casada(s), ${capi} CAPI enviado(s)` });
        setReloadKey(k => k + 1);
      }
    } catch (e) {
      setToast({ tipo: 'info', texto: 'O match está demorando e segue rodando em segundo plano. Confere o funil em instantes.' });
    }
    setMatchandoVendas(false);
  }, []);

  if (loading) return <div style={{ padding: 20 }}><Loader2 size={sz(24)} className="spin" /></div>;
  if (!data) return <div style={{ padding: 20, color: palette.alert }}>Erro carregando funil</div>;

  return (
    <div style={{ padding: 14, fontFamily: FONT }}>
      {/* TITULO E DATA + BOTAO IMPORTAR CARRINHOS (Ailson 31/05/2026) */}
      <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <SectionTitle>📊 Resumo do dia</SectionTitle>
        <span style={{ fontSize: fz(11), color: palette.inkMuted }}>
          {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
        </span>
        <button
          onClick={importarCarrinhos}
          disabled={importando}
          title="Importa os CSVs de carrinho do Drive na hora (sem esperar o cron das 08:00)"
          style={{
            marginLeft: 'auto',
            background: importando ? palette.beige : palette.accent,
            color: importando ? palette.inkMuted : '#fff',
            border: 'none', borderRadius: 8, padding: '7px 12px',
            cursor: importando ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: fz(12), fontWeight: 600, fontFamily: FONT,
          }}
        >
          {importando
            ? <><Loader2 size={sz(14)} className="spin" /> Importando…</>
            : <><ShoppingCart size={sz(14)} /> Importar carrinhos agora</>}
        </button>
        <button
          onClick={ajustarEstoque}
          disabled={ajustandoEstoque}
          title="Importa a planilha de estoque do Drive na hora (mesmo cron do 07:00)"
          style={{
            background: ajustandoEstoque ? palette.beige : palette.accent,
            color: ajustandoEstoque ? palette.inkMuted : '#fff',
            border: 'none', borderRadius: 8, padding: '7px 12px',
            cursor: ajustandoEstoque ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: fz(12), fontWeight: 600, fontFamily: FONT,
          }}
        >
          {ajustandoEstoque
            ? <><Loader2 size={sz(14)} className="spin" /> Ajustando…</>
            : <><RefreshCw size={sz(14)} /> Ajustar estoque</>}
        </button>
        <button
          onClick={matchVendas}
          disabled={matchandoVendas}
          title="Cruza as vendas com as conversas da Sofia e dispara CAPI"
          style={{
            background: matchandoVendas ? palette.beige : palette.accent,
            color: matchandoVendas ? palette.inkMuted : '#fff',
            border: 'none', borderRadius: 8, padding: '7px 12px',
            cursor: matchandoVendas ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: fz(12), fontWeight: 600, fontFamily: FONT,
          }}
        >
          {matchandoVendas
            ? <><Loader2 size={sz(14)} className="spin" /> Casando…</>
            : <><Link2 size={sz(14)} /> Match vendas</>}
        </button>
      </div>

      {/* TOAST do resultado da importacao */}
      {toast && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 8,
          fontSize: fz(12), fontWeight: 500, fontFamily: FONT,
          background: toast.tipo === 'ok' ? palette.okSoft : toast.tipo === 'erro' ? palette.alertSoft : palette.accentSoft,
          color: toast.tipo === 'ok' ? palette.ok : toast.tipo === 'erro' ? palette.alert : palette.accent,
          border: `1px solid ${toast.tipo === 'ok' ? palette.ok : toast.tipo === 'erro' ? palette.alert : palette.accent}`,
        }}>
          {toast.tipo === 'ok' ? '✅ ' : toast.tipo === 'erro' ? '⚠️ ' : 'ℹ️ '}{toast.texto}
        </div>
      )}

      {/* KPIs PRINCIPAIS (4 cards com comparativo dia anterior) */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 10, marginBottom: 18,
      }}>
        <FunilKpiCard label="Novos carrinhos"
          hoje={data.hoje.carrinhos} ontem={data.ontem.carrinhos}
          icon="🛒" cor={palette.accent} />
        <FunilKpiCard label="Mensagens enviadas"
          hoje={data.hoje.enviadas} ontem={data.ontem.enviadas}
          icon="📨" cor={palette.ink} />
        <FunilKpiCard label="Mensagens recebidas"
          hoje={data.hoje.recebidas} ontem={data.ontem.recebidas}
          icon="📥" cor={palette.inkSoft} />
        <FunilKpiCard label="Viraram quente"
          hoje={data.hoje.quentes} ontem={data.ontem.quentes}
          icon="🔥" cor="#f5a623" />
        <FunilKpiCard label="Vendeu"
          hoje={data.hoje.vendeu} ontem={data.ontem.vendeu}
          icon="💰" cor={palette.ok} />
      </div>

      {/* FUNIL VISUAL: barras horizontais decrescentes */}
      <SectionTitle>🪜 Funil agora</SectionTitle>
      <FunilVisual contagens={data.contagens_etapas} />

      {/* INDICADORES SECUNDARIOS */}
      <div style={{
        marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10,
      }}>
        <IndicadorCard
          titulo="Taxa de resposta cliente"
          valor={`${Math.round(data.taxa_resposta_7d * 100)}%`}
          sub="últimos 7 dias"
          cor={data.taxa_resposta_7d > 0.4 ? palette.ok : data.taxa_resposta_7d > 0.2 ? '#d4a017' : palette.alert}
        />
        <IndicadorCard
          titulo="Conversas ativas"
          valor={data.total_ativas}
          sub={`de ${data.total_conversas} total`}
          cor={palette.accent}
        />
        {data.resumo_cron && (
          <>
            <IndicadorCard
              titulo="Cap diário"
              valor={`${data.resumo_cron.criadas_hoje || 0} / ${data.resumo_cron.cap_diario || 0}`}
              sub={`${data.resumo_cron.restante_hoje || 0} restante`}
              cor={palette.ink}
            />
            <IndicadorCard
              titulo="Fila aprovar"
              valor={data.resumo_cron.fila_pendentes || 0}
              sub="aguardando assistente"
              cor={(data.resumo_cron.fila_pendentes || 0) > 0 ? '#d4a017' : palette.inkMuted}
            />
          </>
        )}
      </div>

      {/* INFO BOX */}
      <div style={{
        marginTop: 18, padding: 10, borderRadius: 8,
        background: '#f0f6fb', border: '1px solid #c8dae8',
        fontSize: fz(11), color: palette.inkSoft, lineHeight: 1.5,
      }}>
        <strong>Como ler:</strong> KPIs comparam hoje com ontem (↑ verde = melhor, ↓ vermelho = pior).
        Funil mostra distribuição AGORA por etapa (não acumulado).
        Taxa de resposta = mensagens recebidas / enviadas em 7 dias.
      </div>
    </div>
  );
}

// Card KPI com comparativo dia anterior
function FunilKpiCard({ label, hoje, ontem, icon, cor }) {
  const diff = hoje - ontem;
  const pct = ontem > 0 ? Math.round((diff / ontem) * 100) : (hoje > 0 ? 100 : 0);
  const positivo = diff >= 0;
  return (
    <div style={{
      background: palette.surface, borderRadius: 10,
      border: `1px solid ${palette.beige}`, padding: '10px 12px',
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: cor,
      }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: fz(15) }}>{icon}</span>
        <span style={{ fontSize: fz(10), color: palette.inkMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: fz(24), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>
          {hoje}
        </span>
        {ontem > 0 && (
          <span style={{
            fontSize: fz(11), fontWeight: 600,
            color: positivo ? palette.ok : palette.alert,
          }}>
            {positivo ? '↑' : '↓'} {Math.abs(pct)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 1 }}>
        ontem: {ontem}
      </div>
    </div>
  );
}

// Funil visual em barras horizontais (drop-off por etapa)
function FunilVisual({ contagens }) {
  // Pega o maior valor pra normalizar barras
  const max = Math.max(1, ...Object.values(contagens));
  const totalEntrada = (contagens.processando || 0)
    + (contagens.aprovar || 0)
    + (contagens.enviada || 0)
    + (contagens.conversando || 0)
    + (contagens.quente || 0)
    + (contagens.atendida || 0)
    + (contagens.vendeu || 0)
    + (contagens.perdida || 0);

  return (
    <div style={{
      background: palette.surface, borderRadius: 10,
      border: `1px solid ${palette.beige}`, padding: '12px',
      display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      {ETAPAS.map(et => {
        const valor = contagens[et.id] || 0;
        const pctMax = (valor / max) * 100;
        const pctTotal = totalEntrada > 0 ? ((valor / totalEntrada) * 100).toFixed(1) : '0.0';
        return (
          <div key={et.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 100, display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <EtapaIcon nome={et.id} size={18} />
              <span style={{ fontSize: fz(11), fontWeight: 600, color: palette.ink, whiteSpace: 'nowrap' }}>
                {et.label}
              </span>
            </div>
            <div style={{
              flex: 1, height: 22, background: palette.beige,
              borderRadius: 4, overflow: 'hidden', position: 'relative',
            }}>
              <div style={{
                width: `${pctMax}%`, height: '100%',
                background: et.cor || palette.ink,
                transition: 'width 0.4s ease',
              }} />
              <div style={{
                position: 'absolute', inset: 0, display: 'flex',
                alignItems: 'center', justifyContent: 'flex-end',
                paddingRight: 8,
                fontSize: fz(11), fontWeight: 700, color: palette.ink,
              }}>
                {valor} <span style={{ opacity: 0.6, fontWeight: 400, marginLeft: 4 }}>({pctTotal}%)</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IndicadorCard({ titulo, valor, sub, cor }) {
  return (
    <div style={{
      background: palette.surface, borderRadius: 10,
      border: `1px solid ${palette.beige}`, padding: '10px 12px',
    }}>
      <div style={{ fontSize: fz(10), color: palette.inkMuted, fontWeight: 600, marginBottom: 2 }}>
        {titulo}
      </div>
      <div style={{ fontSize: fz(18), fontWeight: 700, color: cor || palette.ink, lineHeight: 1.1 }}>
        {valor}
      </div>
      <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2: APROVAR (core MVP) — fila pendentes + ações
// ═══════════════════════════════════════════════════════════════════════════

function AprovarTab({ userId, refreshTick, onReload }) {
  const [pendentes, setPendentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selecionados, setSelecionados] = useState(new Set());
  const [editandoId, setEditandoId] = useState(null);
  const [editText, setEditText] = useState('');
  const [acaoEmAndamento, setAcaoEmAndamento] = useState(false);
  const [erroGlobal, setErroGlobal] = useState(null);
  // Cap diário (configurável aqui mesmo — vale pro próximo cron 8h)
  const [capDiario, setCapDiario] = useState(null);
  const [capInput, setCapInput] = useState('');
  const [salvandoCap, setSalvandoCap] = useState(false);
  const [feedbackAuto, setFeedbackAuto] = useState('manual');
  const [salvandoFb, setSalvandoFb] = useState(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErroGlobal(null);
    try {
      const [rPend, rResumo] = await Promise.all([
        fetch('/api/lojas-whats-aprovar'),
        fetch('/api/lojas-whats-cron-selecionar')
      ]);
      if (!rPend.ok) throw new Error(`HTTP ${rPend.status}`);
      const j = await rPend.json();
      setPendentes(j.sugestoes || []);
      if (rResumo.ok) {
        const jResumo = await rResumo.json();
        setCapDiario(jResumo.data?.cap_diario);
        setCapInput(String(jResumo.data?.cap_diario || ''));
      }
      const { data: cfgFb } = await supabase
        .from('lojas_whats_config').select('valor').eq('chave', 'feedback_auto').maybeSingle();
      setFeedbackAuto(cfgFb?.valor === 'auto' ? 'auto' : 'manual');
    } catch (e) {
      setErroGlobal(`Erro: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const salvarCap = async () => {
    const novoCap = parseInt(capInput, 10);
    if (isNaN(novoCap) || novoCap < 0 || novoCap > 200) {
      alert('Valor inválido. Digite entre 0 e 200.');
      return;
    }
    setSalvandoCap(true);
    try {
      const { error } = await supabase
        .from('lojas_whats_config')
        .update({ valor: novoCap, updated_at: new Date().toISOString() })
        .eq('chave', 'cap_diario');
      if (error) throw error;
      setCapDiario(novoCap);
    } catch (e) {
      alert(`Erro salvar cap: ${e.message}`);
    } finally {
      setSalvandoCap(false);
    }
  };

  const salvarFeedbackAuto = async (modo) => {
    if (modo === feedbackAuto) return;
    setSalvandoFb(true);
    try {
      const { error } = await supabase
        .from('lojas_whats_config')
        .update({ valor: modo, updated_at: new Date().toISOString() })
        .eq('chave', 'feedback_auto');
      if (error) throw error;
      setFeedbackAuto(modo);
    } catch (e) {
      alert(`Erro salvar modo feedback: ${e.message}`);
    } finally {
      setSalvandoFb(false);
    }
  };

  useEffect(() => { carregar(); }, [carregar, refreshTick]);

  const dispararSelecao = async () => {
    setAcaoEmAndamento(true);
    setErroGlobal(null);
    try {
      const r = await fetch('/api/lojas-whats-cron-selecionar', { method: 'POST' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'falhou');
      alert(`Selecionados: ${j.selecionados || 0} novos\nCriados: ${j.criadas || 0}\nFalhas: ${j.falhas?.length || 0}`);
      await carregar();
    } catch (e) {
      setErroGlobal(`Erro selecionar: ${e.message}`);
    } finally {
      setAcaoEmAndamento(false);
    }
  };

  const previewSelecao = async () => {
    setAcaoEmAndamento(true);
    setErroGlobal(null);
    try {
      const r = await fetch('/api/lojas-whats-cron-selecionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: true })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'falhou');
      alert(
        `PREVIEW (não persistiu nada):\n\n` +
        `Cap diário: ${j.cap_diario}\n` +
        `Criadas hoje: ${j.criadas_hoje}\n` +
        `Restante: ${j.restante_hoje}\n` +
        `Leads brutos: ${j.leads_brutos}\n` +
        `Candidatos válidos: ${j.candidatos_validos}\n` +
        `Seriam selecionados: ${j.seriam_selecionados}\n\n` +
        `Top 5:\n${(j.preview || []).slice(0, 5).map(p =>
          `  ${p.tipo} ${p.nome} · ${p.pecas}p · ${fmtMoney(p.valor)}`).join('\n')}`
      );
    } catch (e) {
      setErroGlobal(`Erro preview: ${e.message}`);
    } finally {
      setAcaoEmAndamento(false);
    }
  };

  const acionar = async (sugestaoIds, acao, textoEditado = null) => {
    setAcaoEmAndamento(true);
    setErroGlobal(null);
    try {
      const r = await fetch('/api/lojas-whats-aprovar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sugestao_ids: sugestaoIds,
          acao,
          texto_editado: textoEditado,
          aprovada_por: userId || 'tamara'
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'falhou');
      if (j.falhas > 0) {
        const erros = j.resultados?.erro?.map(e => `${e.id.slice(0,8)}: ${e.erro}`).join('\n') || '';
        alert(`Processadas: ${j.processadas}\nFalhas: ${j.falhas}\n\n${erros}`);
      } else {
        // sucesso silencioso
      }
      setSelecionados(new Set());
      setEditandoId(null);
      await carregar();
    } catch (e) {
      setErroGlobal(`Erro: ${e.message}`);
    } finally {
      setAcaoEmAndamento(false);
    }
  };

  const aprovar = (id) => acionar([id], 'aprovar');
  const dispensar = (id) => {
    acionar([id], 'dispensar');
  };
  const salvarEdicaoEEnviar = () => {
    if (!editandoId || !editText.trim()) return;
    acionar([editandoId], 'editar_aprovar', editText);
  };
  const aprovarLote = () => {
    if (selecionados.size === 0) return;
    if (!confirm(`Aprovar ${selecionados.size} sugestões em lote?`)) return;
    acionar(Array.from(selecionados), 'aprovar');
  };
  const dispensarLote = () => {
    if (selecionados.size === 0) return;
    if (!confirm(`Dispensar ${selecionados.size} sugestões?`)) return;
    acionar(Array.from(selecionados), 'dispensar');
  };

  const toggleSel = (id) => {
    const nova = new Set(selecionados);
    if (nova.has(id)) nova.delete(id);
    else nova.add(id);
    setSelecionados(nova);
  };
  const selecionarTodos = () => {
    if (selecionados.size === pendentes.length) setSelecionados(new Set());
    else setSelecionados(new Set(pendentes.map(p => p.id)));
  };

  if (loading) return <div style={{ padding: 20, textAlign: 'center' }}><Loader2 size={sz(24)} className="spin" /></div>;

  return (
    <div style={{ padding: 14, fontFamily: FONT, paddingBottom: 80 }}>
      {/* Banner do Cap diário */}
      <div style={{
        background: palette.accentSoft, padding: 10, borderRadius: 10,
        marginBottom: 10, display: 'flex', alignItems: 'center',
        gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: fz(13), color: palette.ink }}>
          <strong>Cap diário:</strong> Sofia gera até{' '}
          <strong style={{ color: palette.accent }}>{capDiario ?? '?'}</strong> sugestões/dia (cron 8h BRT seg-sex).
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="number" min="0" max="200" value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            style={{
              width: 60, padding: '4px 6px', borderRadius: 6,
              border: `1px solid ${palette.beige}`, fontFamily: FONT,
              fontSize: fz(13), textAlign: 'center',
            }}
          />
          <button
            onClick={salvarCap}
            disabled={salvandoCap || parseInt(capInput, 10) === capDiario}
            style={{
              ...btnPrimario, padding: '4px 10px', fontSize: fz(12),
              opacity: (salvandoCap || parseInt(capInput, 10) === capDiario) ? 0.5 : 1
            }}
          >
            {salvandoCap ? '...' : 'Salvar'}
          </button>
        </div>
      </div>

      {/* Disparo de feedback pós-1ª-compra: manual (aprovo) × automático */}
      <div style={{
        background: palette.surface, padding: 10, borderRadius: 10,
        marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        border: `1px solid ${palette.beige}`,
      }}>
        <div style={{ fontSize: fz(13), color: palette.ink }}>
          <strong>Feedback pós-compra:</strong> dispara no 15º dia da 1ª compra (domingo cai pra segunda).{' '}
          {feedbackAuto === 'auto'
            ? 'Hoje envia sozinho.'
            : 'Hoje monta o lote e espera vc aprovar em 1 toque na aba Clientes.'}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['manual', 'auto'].map(m => (
            <button key={m} onClick={() => salvarFeedbackAuto(m)} disabled={salvandoFb}
              style={{
                padding: '4px 12px', fontSize: fz(12), borderRadius: 6, cursor: 'pointer', fontFamily: FONT,
                border: `1px solid ${palette.beige}`,
                background: feedbackAuto === m ? palette.accent : palette.surface,
                color: feedbackAuto === m ? '#fff' : palette.ink,
                opacity: salvandoFb ? 0.6 : 1,
              }}>
              {m === 'manual' ? 'Manual (aprovo)' : 'Automático'}
            </button>
          ))}
        </div>
      </div>

      {/* Barra de ação topo */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12,
        background: palette.surface, padding: 10, borderRadius: 10,
        border: `1px solid ${palette.beige}`,
      }}>
        <button onClick={previewSelecao} disabled={acaoEmAndamento} style={btnSecundario}>
          <Eye size={sz(14)} style={{ marginRight: 4 }} /> Preview
        </button>
        <button onClick={dispararSelecao} disabled={acaoEmAndamento} style={btnPrimario}>
          <RefreshCw size={sz(14)} style={{ marginRight: 4 }} /> Selecionar agora
        </button>
        <div style={{ flex: 1 }} />
        {pendentes.length > 0 && (
          <>
            <button onClick={selecionarTodos} style={btnSecundario}>
              {selecionados.size === pendentes.length ? 'Limpar' : 'Selecionar todos'}
            </button>
            {selecionados.size > 0 && (
              <>
                <button onClick={aprovarLote} disabled={acaoEmAndamento} style={btnSucesso}>
                  ✓ Aprovar {selecionados.size}
                </button>
                <button onClick={dispensarLote} disabled={acaoEmAndamento} style={btnAlerta}>
                  ✗ Dispensar {selecionados.size}
                </button>
              </>
            )}
          </>
        )}
      </div>

      {erroGlobal && (
        <div style={{
          background: palette.alertSoft, color: palette.alert, padding: 10,
          borderRadius: 8, marginBottom: 12, fontSize: fz(13),
        }}>
          {erroGlobal}
        </div>
      )}

      {pendentes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: palette.inkMuted }}>
          <EtapaIcon nome="aprovar" size={48} style={{ opacity: 0.3, margin: '0 auto 12px' }} />
          <p>Nenhuma sugestão pendente.</p>
          <p style={{ fontSize: fz(13), marginTop: 4 }}>Clica em "Selecionar agora" pra buscar carrinhos.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pendentes.map(sug => (
            <SugestaoCard
              key={sug.id}
              sug={sug}
              selecionado={selecionados.has(sug.id)}
              editando={editandoId === sug.id}
              editText={editText}
              onToggleSel={() => toggleSel(sug.id)}
              onAprovar={() => aprovar(sug.id)}
              onDispensar={() => dispensar(sug.id)}
              onIniciarEdit={() => {
                setEditandoId(sug.id);
                setEditText(sug.texto_proposto);
              }}
              onChangeEdit={setEditText}
              onSalvarEdit={salvarEdicaoEEnviar}
              onCancelarEdit={() => { setEditandoId(null); setEditText(''); }}
              disabled={acaoEmAndamento}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SugestaoCard({
  sug, selecionado, editando, editText,
  onToggleSel, onAprovar, onDispensar, onIniciarEdit,
  onChangeEdit, onSalvarEdit, onCancelarEdit, disabled
}) {
  const conv = sug.conversa || {};
  const ehPJ = conv.tipo_documento === 'CNPJ';

  return (
    <div style={{
      background: palette.surface, borderRadius: 12, padding: 12,
      border: `2px solid ${selecionado ? palette.accent : palette.beige}`,
      transition: 'border-color 0.15s',
    }}>
      {/* Header card: checkbox + nome + valor */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <input
          type="checkbox" checked={selecionado} onChange={onToggleSel}
          style={{ width: 18, height: 18, cursor: 'pointer', marginTop: 2 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            {ehPJ ? <Building2 size={sz(14)} color={palette.warn} /> : <UserIcon size={sz(14)} color={palette.accent} />}
            <span style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink }}>
              {conv.nome_cliente || '—'}
            </span>
            <span style={{
              fontSize: fz(10), padding: '1px 6px', borderRadius: 4,
              background: ehPJ ? palette.warnSoft : palette.accentSoft,
              color: ehPJ ? palette.warn : palette.accent, fontWeight: 600,
            }}>
              {conv.tipo_documento || '—'}
            </span>
          </div>
          <div style={{ fontSize: fz(12), color: palette.inkMuted, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <span><Phone size={sz(11)} style={{ verticalAlign: 'middle' }} /> {fmtPhone(conv.telefone)}</span>
            <span><ShoppingCart size={sz(11)} style={{ verticalAlign: 'middle' }} /> {conv.qtd_pecas || 0} peças</span>
            {Number(conv.valor_carrinho) > 0 && (
              <span style={{ fontWeight: 600, color: palette.ok }}>{fmtMoney(conv.valor_carrinho)}</span>
            )}
            <span style={{ marginLeft: 'auto' }}>há {fmtRelTime(sug.criada_em)}</span>
          </div>
        </div>
      </div>

      {/* Texto proposto / edição */}
      {editando ? (
        <div>
          <textarea
            value={editText} onChange={(e) => onChangeEdit(e.target.value)}
            rows={6}
            style={{
              width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8,
              border: `1px solid ${palette.accent}`, fontFamily: FONT, fontSize: fz(13),
              resize: 'vertical', lineHeight: 1.45,
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={onSalvarEdit} disabled={disabled || !editText.trim()} style={btnSucesso}>
              <Send size={sz(14)} style={{ marginRight: 4 }} /> Enviar editada
            </button>
            <button onClick={onCancelarEdit} style={btnSecundario}>Cancelar</button>
          </div>
        </div>
      ) : (
        <>
          <div style={{
            background: palette.beigeSoft, padding: 10, borderRadius: 8,
            fontSize: fz(13), lineHeight: 1.5, whiteSpace: 'pre-wrap',
            color: palette.ink, marginBottom: 10,
          }}>
            {sug.texto_proposto}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={onAprovar} disabled={disabled} style={btnSucesso}>
              <Check size={sz(14)} style={{ marginRight: 4 }} /> Aprovar e enviar
            </button>
            <button onClick={onIniciarEdit} disabled={disabled} style={btnSecundario}>
              <Edit3 size={sz(14)} style={{ marginRight: 4 }} /> Editar
            </button>
            <button onClick={onDispensar} disabled={disabled} style={btnAlerta}>
              <X size={sz(14)} style={{ marginRight: 4 }} /> Dispensar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3: CONVERSAS
// ═══════════════════════════════════════════════════════════════════════════

function ConversasTab({ refreshTick, userId, filtroInicial = 'todas', conversaInicial = null, onAberturaConsumida }) {
  const [conversas, setConversas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroEtapa, setFiltroEtapa] = useState(filtroInicial);
  const [modalEnviar, setModalEnviar] = useState(null);
  const [modalEditarLead, setModalEditarLead] = useState(null);
  const [modalPago, setModalPago] = useState(null);
  const [conversaDetalhe, setConversaDetalhe] = useState(null);  // tela cheia chat
  // Mapa id->nome de vendedoras pra mostrar quem atendeu (aba Atendida e demais).
  // Ailson 28/05/2026.
  const [vendedorasMap, setVendedorasMap] = useState(new Map());
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('lojas_vendedoras')
        .select('id, nome');
      if (data) setVendedorasMap(new Map(data.map(v => [v.id, v.nome])));
    })();
  }, []);
  const isDesktop = useIsDesktop();  // split view só em desktop; mobile = fullscreen
  const [feedback, setFeedback] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [expandido, setExpandido] = useState(false);
  // Realtime atualiza a lista em background — spinner so na 1a carga (nao
  // pisca a tela a cada msg nova). Ailson 30/05/2026.
  const jaCarregouListaRef = useRef(false);
  // Contadores por etapa (badge no chip) + selecao multipla (so na aba processando)
  // Ailson 26/05/2026 sessao tarde
  const [contadores, setContadores] = useState({});
  const [selecionados, setSelecionados] = useState(new Set());
  const [processandoFila, setProcessandoFila] = useState(false);
  // Modal de explicacao "?" dos chips de filtro (Ailson 27/05/2026)
  const [ajudaEtapa, setAjudaEtapa] = useState(null);
  // Sub-filtro da aba Perdida: ver quem recebeu / nao recebeu a pesquisa de
  // motivo. 'todos' | 'com' | 'sem'. Ailson 22/06/2026.
  const [filtroPesquisaPerdida, setFiltroPesquisaPerdida] = useState('todos');
  // Filtros da reativação em massa na aba Perdida (Ailson 04/07/2026): origem
  // do lead, data em que virou perdida e template do disparo (hoje só a
  // pesquisa funciona; curadoria/novidades/dicas entram quando aprovar na Meta).
  const [filtroOrigemPerdida, setFiltroOrigemPerdida] = useState('todas');
  const [perdidaDe, setPerdidaDe] = useState('');
  const [perdidaAte, setPerdidaAte] = useState('');
  const [templateMassa, setTemplateMassa] = useState('pesquisa');
  const [tplsReativacao, setTplsReativacao] = useState([]);
  // Contador de pesquisas enviadas HOJE (BRT) na etapa ativa (follow_up / perdida).
  const [enviadosHoje, setEnviadosHoje] = useState(0);

  // Sincroniza se filtroInicial mudar (ex: navegacao entre tabs Aprovar/Conversas)
  useEffect(() => { setFiltroEtapa(filtroInicial); }, [filtroInicial]);
  // Abertura externa: clique num card da aba Pesquisa manda abrir o chat dessa
  // conversa aqui na aba Conversas. Avisa o pai pra limpar (re-clique funciona).
  // Ailson 22/06/2026.
  useEffect(() => {
    if (conversaInicial) {
      setConversaDetalhe(conversaInicial);
      onAberturaConsumida?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversaInicial]);
  useEffect(() => { setSelecionados(new Set()); }, [filtroEtapa]);
  // Sai da Perdida -> zera o sub-filtro de pesquisa (Ailson 22/06/2026)
  useEffect(() => { if (filtroEtapa !== 'perdida') setFiltroPesquisaPerdida('todos'); }, [filtroEtapa]);

  // Carrega contadores por etapa pros badges nos chips
  // Ailson 25/05/2026: pra etapas 'conversando' e 'quente', badge eh
  // numero de conversas que PRECISAM DE ACAO — ou seja, cliente foi
  // o ultimo a enviar mensagem (ultima_msg_direcao='entrada').
  // Pra 'follow_up' (Sprint B): badge conta conversas com tag VENCIDA
  // (follow_up_vence_em <= NOW) — Sofia ja gerou sugestao pra revisar
  // (ou ja deveria). Demais etapas mantem contagem total.
  const ETAPAS_PRECISA_ACAO = ['conversando', 'quente'];
  const [unreadPorEtapa, setUnreadPorEtapa] = useState({});
  useEffect(() => {
    (async () => {
      const etapasIds = ETAPAS.map(e => e.id);
      const agora = new Date().toISOString();
      const counts = {};
      const queries = await Promise.all(
        etapasIds.map(et => {
          let q = supabase.from('lojas_whats_conversas')
            .select('*', { count: 'exact', head: true })
            .eq('etapa', et);
          if (ETAPAS_PRECISA_ACAO.includes(et)) {
            q = q.eq('ultima_msg_direcao', 'entrada');
          }
          // follow_up: badge = TOTAL de cards na aba (Ailson 01/06/2026 —
          // antes contava so os vencidos, confundia). Cor discreta no chip.
          return q;
        })
      );
      etapasIds.forEach((id, i) => { counts[id] = queries[i].count || 0; });
      const { count: total } = await supabase.from('lojas_whats_conversas')
        .select('*', { count: 'exact', head: true });
      counts.todas = total || 0;
      setContadores(counts);

      // Conversas com mensagens nao vistas por etapa (badge vermelho)
      // Ailson 27/05/2026: badge VERMELHO em cima/lado do chip qdo houver
      // qualquer msg nova nao vista do cliente em qq aba.
      const unreadQueries = await Promise.all(
        etapasIds.map(et =>
          supabase.from('lojas_whats_conversas')
            .select('*', { count: 'exact', head: true })
            .eq('etapa', et).gt('unread_count', 0)
        )
      );
      const unread = {};
      etapasIds.forEach((id, i) => { unread[id] = unreadQueries[i].count || 0; });
      const { count: totalUnread } = await supabase.from('lojas_whats_conversas')
        .select('*', { count: 'exact', head: true }).gt('unread_count', 0);
      unread.todas = totalUnread || 0;
      setUnreadPorEtapa(unread);
    })();
  }, [refreshTick, reloadTick]);

  // Realtime: refresh automatico quando entra mensagem nova OU conversa
  // muda de etapa. Reconecta no foco/visibilidade + fallback polling (Ailson
  // 31/05/2026) — no celular o socket caia em background e nao voltava sozinho.
  useRealtimeSofia(
    'sofia-conversas-mensagens',
    (c, aoMudar) => c
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lojas_whats_mensagens' }, aoMudar)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lojas_whats_conversas' }, aoMudar)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'lojas_whats_conversas' }, aoMudar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lojas_whats_sugestoes' }, aoMudar),
    () => setReloadTick(t => t + 1),
    { pollMs: 12000 },
  );

  useEffect(() => {
    (async () => {
      if (!jaCarregouListaRef.current) setLoading(true);  // spinner so na 1a carga
      const limite = expandido ? 500 : 50;
      let q = supabase
        .from('lojas_whats_conversas')
        .select(`
          id, telefone, nome_cliente, tipo_documento, documento, carrinho_id, etapa, valor_carrinho, qtd_pecas, ultima_atividade_em, iniciada_em, score_quente, lead_prioritario, observacao_para_sofia, observacao_assistente, cliente_indicou_site, origem_lead, unread_count, sugestao_quente_pendente_em, sugestao_quente_motivo, sugestao_quente_gatilhos, vendedora_atribuida_id, catalogo_enviado_em, catalogo_followup_6h_em, catalogo_followup_pausado, follow_up_vence_em, editando_por, editando_em, fup_relogio_em, pesquisa_enviada_em, pesquisa_respondida_em, pesquisa_motivo, vendeu_venda_id, vendeu_valor, ciclo24_vence_em, perdida_em,
          handoffs:lojas_whats_handoffs(status, vendedora_id),
          sugestoes:lojas_whats_sugestoes(id, status)
        `)
        // Prioritarios primeiro
        .order('lead_prioritario', { ascending: false });
      // Aba 'processando' (fila visivel pra assistente): CNPJ primeiro, data desc
      if (filtroEtapa === 'processando') {
        q = q.order('tipo_documento', { ascending: false })  // CNPJ antes de CPF
              .order('iniciada_em', { ascending: false });
      } else {
        q = q.order('ultima_atividade_em', { ascending: false });
      }
      q = q.limit(limite);
      if (filtroEtapa !== 'todas') q = q.eq('etapa', filtroEtapa);
      // Sub-filtro da Perdida: recebeu / nao recebeu a pesquisa. Ailson 22/06/2026.
      if (filtroEtapa === 'perdida' && filtroPesquisaPerdida === 'com') q = q.not('pesquisa_enviada_em', 'is', null);
      else if (filtroEtapa === 'perdida' && filtroPesquisaPerdida === 'sem') q = q.is('pesquisa_enviada_em', null);
      // Filtros de reativação da Perdida: origem do lead e data de chegada na
      // aba (perdida_em). Ailson 04/07/2026.
      if (filtroEtapa === 'perdida') {
        if (filtroOrigemPerdida === 'desconhecida') q = q.or('origem_lead.eq.desconhecida,origem_lead.is.null');
        else if (filtroOrigemPerdida !== 'todas') q = q.eq('origem_lead', filtroOrigemPerdida);
        if (perdidaDe) q = q.gte('perdida_em', `${perdidaDe}T00:00:00-03:00`);
        if (perdidaAte) q = q.lte('perdida_em', `${perdidaAte}T23:59:59-03:00`);
      }
      const { data } = await q;
      let lista = data || [];
      // Enriquece conversas VENDIDAS com atendido_por da conversao (lojas_conversoes),
      // pra distinguir no card "carrinho fechado por fora" (venda_loja/vendedora) de
      // "Sofia conduziu" (sofia). Lookup leve por vendeu_venda_id. Ailson 30/06/2026.
      const vendaIds = lista
        .filter(c => c.etapa === 'vendeu' && c.vendeu_venda_id)
        .map(c => c.vendeu_venda_id);
      if (vendaIds.length) {
        const { data: convs } = await supabase
          .from('lojas_conversoes')
          .select('venda_id, atendido_por')
          .in('venda_id', vendaIds);
        const mapaAtend = Object.fromEntries((convs || []).map(c => [c.venda_id, c.atendido_por]));
        lista = lista.map(c => ({ ...c, _atendido_por: mapaAtend[c.vendeu_venda_id] || null }));
      }
      // Aba Conversando (Ailson 02/07/2026): relógios do ciclo 24h ativos sobem,
      // ficando abaixo SÓ das prioridades ⭐. Entre relógios, o mais urgente
      // (menos tempo restante) primeiro. Resto mantém ordem por atividade.
      if (filtroEtapa === 'conversando') {
        const agora = Date.now();
        lista = [...lista].sort((a, b) => {
          const pa = a.lead_prioritario ? 1 : 0, pb = b.lead_prioritario ? 1 : 0;
          if (pa !== pb) return pb - pa;
          const ra = relogioCiclo24Ms(a, agora), rb = relogioCiclo24Ms(b, agora);
          if ((ra !== null) !== (rb !== null)) return ra !== null ? -1 : 1;
          if (ra !== null && rb !== null) return ra - rb;
          return new Date(b.ultima_atividade_em) - new Date(a.ultima_atividade_em);
        });
      }
      setConversas(lista);
      jaCarregouListaRef.current = true;
      setLoading(false);
    })();
  }, [filtroEtapa, refreshTick, reloadTick, expandido, filtroPesquisaPerdida, filtroOrigemPerdida, perdidaDe, perdidaAte]);

  // Catálogo dos templates de reativação (curadoria/novidades/dicas) pro
  // seletor do disparo em massa. Carrega 1x quando abre a aba Perdida.
  useEffect(() => {
    if (filtroEtapa !== 'perdida' || tplsReativacao.length) return;
    fetch('/api/lojas-whats-templates-catalogo')
      .then(r => r.json())
      .then(j => {
        if (j.ok) setTplsReativacao([
          ...(j.pastas?.curadoria || []),
          ...(j.pastas?.novidades || []),
          ...(j.pastas?.dicas_rapidas || []),
        ]);
      })
      .catch(() => {});
  }, [filtroEtapa]);

  // Conta quantas pesquisas saíram HOJE (BRT) na etapa ativa: follow_up usa
  // followup_pesq_enviada_em, perdida usa pesquisa_enviada_em. Recarrega junto
  // com a lista (reloadTick) pra refletir envios recém-feitos.
  useEffect(() => {
    if (filtroEtapa !== 'follow_up' && filtroEtapa !== 'perdida') { setEnviadosHoje(0); return; }
    let vivo = true;
    (async () => {
      const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
      const desde = `${ymd}T03:00:00.000Z`; // 00:00 BRT = 03:00 UTC
      const col = filtroEtapa === 'follow_up' ? 'followup_pesq_enviada_em' : 'pesquisa_enviada_em';
      const { count } = await supabase.from('lojas_whats_conversas')
        .select('id', { count: 'exact', head: true }).gte(col, desde);
      if (vivo) setEnviadosHoje(count || 0);
    })();
    return () => { vivo = false; };
  }, [filtroEtapa, reloadTick, refreshTick]);

  // Resolve o valor da venda dos cards em 'vendeu' que estao sem vendeu_valor,
  // buscando no Mire (documento -> telefone -> nome). Roda 1x ao abrir a aba;
  // se gravou algum, recarrega a lista pro card mostrar. Ailson 01/07/2026.
  const resolveuValoresRef = useRef(false);
  useEffect(() => {
    if (filtroEtapa !== 'vendeu') { resolveuValoresRef.current = false; return; }
    if (resolveuValoresRef.current) return;
    resolveuValoresRef.current = true;
    (async () => {
      try {
        const r = await fetch('/api/lojas-whats-vendeu-valores');
        const j = await r.json();
        if (j?.resolvidos?.length) setReloadTick(x => x + 1);
      } catch { /* silencioso */ }
    })();
  }, [filtroEtapa]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  if (loading) return <div style={{ padding: 20, textAlign: 'center' }}><Loader2 size={sz(24)} className="spin" /></div>;

  const onContinuarSofia = (conversa) => {
    setFeedback({ tipo: 'ok', msg: `Sofia continua atendimento de ${conversa.nome_cliente || conversa.telefone}` });
  };

  const onTogglePrioridade = async (c) => {
    const novo = !c.lead_prioritario;
    try {
      const r = await fetch('/api/lojas-whats-conversa-editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversa_id: c.id,
          campos: { prioridade: novo ? 1 : 0 },
        }),
      });
      const j = await r.json();
      if (j.error) setFeedback({ tipo: 'erro', msg: j.error });
      else {
        setFeedback({ tipo: 'ok', msg: novo ? '★ Lead marcado como prioridade' : 'Prioridade removida' });
        setReloadTick(t => t + 1);
      }
    } catch (e) { setFeedback({ tipo: 'erro', msg: e.message }); }
  };

  // Desmarcar/reativar o relogio de follow-up do catalogo direto no card. Ailson 29/05/2026.
  const onToggleCatalogoFollowup = async (c) => {
    const novo = !c.catalogo_followup_pausado;  // novo=true => pausado
    try {
      const r = await fetch('/api/lojas-whats-conversa-editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversa_id: c.id,
          campos: { catalogo_followup_pausado: novo },
        }),
      });
      const j = await r.json();
      if (j.error) setFeedback({ tipo: 'erro', msg: j.error });
      else {
        setFeedback({ tipo: 'ok', msg: novo ? '🔕 Follow-up do catálogo desmarcado' : '🔔 Follow-up do catálogo reativado' });
        setReloadTick(t => t + 1);
      }
    } catch (e) { setFeedback({ tipo: 'erro', msg: e.message }); }
  };

  // Define (ou nao) o agendamento de follow-up direto no card. Ailson 01/06/2026.
  //   dias > 0 -> retomada agendada pra now+dias | null -> nao envia (fica parado)
  const onDefinirFollowUp = async (c, dias) => {
    try {
      const r = await fetch('/api/lojas-whats-conversa-editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversa_id: c.id,
          campos: { etapa: 'follow_up', follow_up_dias: dias },
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { setFeedback({ tipo: 'erro', msg: j.error || 'Erro ao agendar follow-up' }); return; }
      setFeedback({
        tipo: 'ok',
        msg: dias ? `Follow-up agendado pra ${dias} dia${dias > 1 ? 's' : ''}` : 'Follow-up parado (não envia por enquanto)',
      });
      setReloadTick(t => t + 1);
    } catch (e) { setFeedback({ tipo: 'erro', msg: e.message }); }
  };

  //  - DESKTOP (>=768px): split view — lista compacta à esquerda + chat à direita
  // Modais renderizados em ambos (senão ficam fora do DOM). Ailson 28/05/2026
  if (conversaDetalhe) {
    const abrirConversa = (id, unread) => {
      setConversaDetalhe(id);
      if (unread > 0) {
        setConversas(prev => prev.map(x => x.id === id ? { ...x, unread_count: 0 } : x));
        fetch('/api/lojas-whats-conversa-vista', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversa_id: id }),
        }).catch(() => {});
      }
    };

    const modais = (
      <>
        {modalEditarLead && (
          <EditarLeadModal
            conversa={modalEditarLead.conversa}
            onClose={() => setModalEditarLead(null)}
            onSucesso={(msg) => { setFeedback({ tipo: 'ok', msg }); setModalEditarLead(null); setReloadTick(t => t + 1); }}
            onErro={(msg) => setFeedback({ tipo: 'erro', msg })}
            onEnviarVendedora={(conv) => setModalEnviar({ conversa: conv })}
          />
        )}
        {modalEnviar && (
          <EnviarVendedoraModal
            conversa={modalEnviar.conversa}
            onClose={() => setModalEnviar(null)}
            onSucesso={(msg) => {
              setFeedback({ tipo: 'ok', msg });
              setModalEnviar(null);
              setConversaDetalhe(null);
              setReloadTick(t => t + 1);
            }}
            onErro={(msg) => setFeedback({ tipo: 'erro', msg })}
          />
        )}
      </>
    );

    const chatDetalhe = (
      <ConversaDetail
        conversaId={conversaDetalhe}
        userId={userId}
        idsNaAba={(conversas || []).map(c => c.id)}
        onNavegar={(id) => setConversaDetalhe(id)}
        onBack={() => { setConversaDetalhe(null); setReloadTick(t => t + 1); }}
        onEditarLead={(conv) => setModalEditarLead({ conversa: conv })}
        onEnviarVendedora={(conv) => setModalEnviar({ conversa: conv })}
        splitLeft={isDesktop ? LARGURA_LISTA_SPLIT : 0}
      />
    );

    // MOBILE — fullscreen (comportamento original intacto)
    if (!isDesktop) {
      return <>{chatDetalhe}{modais}</>;
    }

    // DESKTOP — split view
    const etapaLabelAtual = filtroEtapa === 'todas'
      ? 'no total'
      : `em ${(ETAPAS.find(e => e.id === filtroEtapa)?.label) || filtroEtapa}`;
    const etapasNaBarra = ETAPAS.filter(et =>
      ['aprovar', 'quente', 'conversando', 'follow_up', 'processando'].includes(et.id)
      || et.id === filtroEtapa
    );
    return (
      <>
        {/* COLUNA ESQUERDA — lista compacta + filtros cross-tab */}
        <div style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: LARGURA_LISTA_SPLIT, zIndex: 101,
          background: palette.bg, borderRight: `1px solid ${palette.beige}`,
          display: 'flex', flexDirection: 'column', fontFamily: FONT,
        }}>
          {/* Barra de filtros (troca a aba SEM fechar o chat aberto) */}
          <div style={{
            display: 'flex', gap: 4, flexWrap: 'wrap', padding: 8,
            borderBottom: `1px solid ${palette.beige}`, background: palette.surface,
          }}>
            <ChipMini label="Todas" cor={palette.inkMuted}
              ativo={filtroEtapa === 'todas'} onClick={() => setFiltroEtapa('todas')}
              badge={contadores.todas} />
            {etapasNaBarra.map(et => (
              <ChipMini key={et.id} label={et.label} cor={et.cor}
                ativo={filtroEtapa === et.id} onClick={() => setFiltroEtapa(et.id)}
                badge={contadores[et.id]} unread={unreadPorEtapa[et.id]} />
            ))}
          </div>
          {/* Contagem da aba atual */}
          <div style={{
            padding: '7px 12px', fontSize: fz(10), fontWeight: 700,
            color: palette.inkSoft, textTransform: 'uppercase', letterSpacing: 0.5,
            borderBottom: `1px solid ${palette.beige}`, background: 'transparent',
          }}>
            {conversas.length} {etapaLabelAtual}
          </div>
          {/* Lista scrollable */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {conversas.length === 0 ? (
              <div style={{
                padding: 20, fontSize: fz(12), color: palette.inkMuted,
                textAlign: 'center', fontStyle: 'italic',
              }}>
                Nenhuma conversa nessa etapa
              </div>
            ) : conversas.map(c => (
              <CardCompacto key={c.id} c={c}
                ativo={c.id === conversaDetalhe}
                onClick={() => abrirConversa(c.id, c.unread_count)}
                vendedoraNome={c.vendedora_atribuida_id ? vendedorasMap.get(c.vendedora_atribuida_id) : null}
              />
            ))}
          </div>
        </div>
        {chatDetalhe}
        {modais}
      </>
    );
  }

  // Handlers selecao multipla (aba processando)
  const toggleSelecao = (id) => {
    setSelecionados(prev => {
      const ns = new Set(prev);
      if (ns.has(id)) ns.delete(id); else ns.add(id);
      return ns;
    });
  };
  const processarSelecionados = async () => {
    if (selecionados.size === 0) return;
    setProcessandoFila(true);
    try {
      const r = await fetch('/api/lojas-whats-processar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversa_ids: Array.from(selecionados) }),
      });
      const j = await r.json();
      if (j.error) setFeedback({ tipo: 'erro', msg: j.error });
      else {
        setFeedback({ tipo: 'ok', msg: `${j.processadas} processadas → Aprovar` });
        setSelecionados(new Set());
        setReloadTick(t => t + 1);
      }
    } catch (e) { setFeedback({ tipo: 'erro', msg: e.message }); }
    setProcessandoFila(false);
  };

  const ehAbaProcessando = filtroEtapa === 'processando';
  const ehAbaAprovar = filtroEtapa === 'aprovar';
  const ehAbaPerdida = filtroEtapa === 'perdida';

  // Envia a pesquisa de motivo pros leads selecionados (so os elegiveis recebem,
  // o endpoint filtra pela view). Ailson 21/06/2026.
  const enviarPesquisaSelecionados = async () => {
    if (selecionados.size === 0) return;
    if (!confirm(`Enviar pesquisa pra ${selecionados.size} lead(s)? (só os elegíveis recebem)`)) return;
    setProcessandoFila(true);
    try {
      const r = await fetch('/api/lojas-whats-pesquisa-enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selecionados) }),
      });
      const j = await r.json();
      if (!r.ok || j.error || j.ok === false) {
        setFeedback({ tipo: 'erro', msg: j.error || (j.motivo === 'template_nao_aprovado' ? 'Template ainda não aprovado pela Meta' : j.motivo) || 'Falha ao enviar' });
      } else {
        setFeedback({ tipo: 'ok', msg: `Pesquisa: ${j.enviadas || 0} enviada(s), ${j.falhas || 0} falha(s)` });
        setSelecionados(new Set());
        setReloadTick(t => t + 1);
      }
    } catch (e) { setFeedback({ tipo: 'erro', msg: e.message }); }
    setProcessandoFila(false);
  };

  // Seleciona ate 30 leads ELEGIVEIS que estejam visiveis nesta lista.
  const selecionar30Pesquisa = async () => {
    try {
      const r = await fetch('/api/lojas-whats-pesquisa-enviar');
      const j = await r.json();
      if (j.error) { setFeedback({ tipo: 'erro', msg: j.error }); return; }
      const elegiveis = new Set((j.elegiveis || []).map(e => e.id));
      const naAba = (conversas || []).map(c => c.id).filter(id => elegiveis.has(id)).slice(0, 30);
      setSelecionados(new Set(naAba));
      if (naAba.length === 0) setFeedback({ tipo: 'erro', msg: 'Nenhum elegível visível nesta lista (role/expanda pra carregar mais)' });
    } catch (e) { setFeedback({ tipo: 'erro', msg: e.message }); }
  };

  // Aprovar em lote (aba Aprovar): mapeia as conversas selecionadas pras suas
  // sugestoes pendentes e aprova/envia todas de uma vez. Ailson 01/06/2026.
  const aprovarSelecionados = async () => {
    const sugIds = [];
    for (const c of conversas) {
      if (!selecionados.has(c.id)) continue;
      const sug = (c.sugestoes || []).find(s => s.status === 'pendente');
      if (sug) sugIds.push(sug.id);
    }
    if (sugIds.length === 0) return;
    if (!confirm(`Aprovar e enviar ${sugIds.length} mensagens de uma vez?`)) return;
    setProcessandoFila(true);
    try {
      const r = await fetch('/api/lojas-whats-aprovar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sugestao_ids: sugIds, acao: 'aprovar', aprovada_por: userId || 'tamara' }),
      });
      const j = await r.json();
      if (!r.ok || j.error) setFeedback({ tipo: 'erro', msg: j.error || 'Erro ao aprovar.' });
      else {
        const msg = j.falhas > 0
          ? `${j.processadas} aprovadas, ${j.falhas} falharam`
          : `${j.processadas} aprovadas e enviadas`;
        setFeedback({ tipo: j.falhas > 0 ? 'erro' : 'ok', msg });
        setSelecionados(new Set());
        setReloadTick(t => t + 1);
      }
    } catch (e) { setFeedback({ tipo: 'erro', msg: e.message }); }
    setProcessandoFila(false);
  };

  return (
    <div style={{ padding: 14, fontFamily: FONT }}>
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14,
        overflowX: 'auto', paddingBottom: 4,
      }}>
        <FiltroChip label="Todas" etapaId="todas" onAjuda={setAjudaEtapa}
          ativo={filtroEtapa === 'todas'} onClick={() => setFiltroEtapa('todas')}
          badge={contadores.todas} />
        {ETAPAS.map(et => (
          <FiltroChip key={et.id} label={et.label} ativo={filtroEtapa === et.id}
            cor={et.cor} onClick={() => setFiltroEtapa(et.id)} iconNome={et.id}
            etapaId={et.id} onAjuda={setAjudaEtapa}
            badgeCor={et.id === 'follow_up' ? palette.inkMuted : undefined}
            badge={contadores[et.id]} unread={unreadPorEtapa[et.id]} />
        ))}
      </div>

      {/* Barra de selecao multipla — abas processando e aprovar */}
      {(ehAbaProcessando || ehAbaAprovar || ehAbaPerdida) && conversas.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
          padding: '8px 12px', borderRadius: 8,
          background: selecionados.size > 0 ? '#fff8e1' : palette.surface,
          border: `1px solid ${selecionados.size > 0 ? '#ffd54f' : palette.beige}`,
          flexWrap: 'wrap',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: fz(12) }}>
            <input type="checkbox"
              checked={selecionados.size === conversas.length && conversas.length > 0}
              onChange={(e) => {
                setSelecionados(e.target.checked
                  ? new Set(conversas.map(c => c.id)) : new Set());
              }}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ color: palette.inkSoft }}>
              {selecionados.size === 0
                ? (ehAbaAprovar ? 'Selecionar todos' : ehAbaPerdida ? 'Selecionar leads' : `${conversas.length} na fila`)
                : `${selecionados.size} de ${conversas.length} selecionados`}
            </span>
          </label>
          {ehAbaPerdida && (
            <button onClick={selecionar30Pesquisa} disabled={processandoFila}
              style={{
                marginLeft: 'auto', padding: '6px 12px', borderRadius: 6,
                background: palette.surface, color: palette.ink,
                border: `1px solid ${palette.beige}`, fontFamily: FONT,
                fontSize: fz(12), fontWeight: 600, cursor: 'pointer',
              }}>
              Selecionar 30
            </button>
          )}
          {selecionados.size > 0 && (
            ehAbaAprovar ? (
              <button onClick={aprovarSelecionados} disabled={processandoFila}
                style={{
                  marginLeft: 'auto', padding: '6px 14px', borderRadius: 6,
                  background: processandoFila ? '#bdc3c7' : palette.ok,
                  color: '#fff', border: 'none', fontFamily: FONT,
                  fontSize: fz(13), fontWeight: 700,
                  cursor: processandoFila ? 'wait' : 'pointer',
                }}>
                {processandoFila ? 'Aprovando…' : `✓ Aprovar ${selecionados.size}`}
              </button>
            ) : ehAbaPerdida ? (
              <>
                {/* Seletor do template do disparo (Ailson 04/07/2026): hoje só a
                    pesquisa funciona; curadoria/novidades/dicas habilitam quando
                    o template for aprovado na Meta. */}
                <select value={templateMassa} onChange={e => setTemplateMassa(e.target.value)}
                  style={{
                    fontSize: fz(12), padding: '6px 8px', borderRadius: 6,
                    border: `1px solid ${palette.beige}`, fontFamily: FONT,
                    background: palette.surface, color: palette.ink, maxWidth: 190,
                  }}>
                  <option value="pesquisa">Pesquisa de motivo</option>
                  {tplsReativacao.map(t => {
                    const rotulo = { curadoria: 'Curadoria', novidades: 'Novidades', dicas_rapidas: 'Dica lojista' }[t.pasta] || t.name;
                    const pronto = t.status === 'aprovado';
                    return (
                      <option key={t.name} value={t.name} disabled={!pronto}>
                        {rotulo}{pronto ? '' : ' (aguardando Meta)'}
                      </option>
                    );
                  })}
                </select>
                <button onClick={enviarPesquisaSelecionados}
                  disabled={processandoFila || templateMassa !== 'pesquisa'}
                  title={templateMassa !== 'pesquisa' ? 'Disparo desse template entra quando ele for aprovado na Meta' : undefined}
                  style={{
                    padding: '6px 14px', borderRadius: 6,
                    background: (processandoFila || templateMassa !== 'pesquisa') ? '#bdc3c7' : palette.accent,
                  color: '#fff', border: 'none', fontFamily: FONT,
                  fontSize: fz(13), fontWeight: 700,
                  cursor: processandoFila ? 'wait' : 'pointer',
                }}>
                {processandoFila ? 'Enviando…' : `Enviar pesquisa (${selecionados.size})`}
              </button>
              </>
            ) : (
              <button onClick={processarSelecionados} disabled={processandoFila}
                style={{
                  marginLeft: 'auto', padding: '6px 14px', borderRadius: 6,
                  background: processandoFila ? '#bdc3c7' : '#2c3e50',
                  color: '#fff', border: 'none', fontFamily: FONT,
                  fontSize: fz(13), fontWeight: 700,
                  cursor: processandoFila ? 'wait' : 'pointer',
                }}>
                {processandoFila ? 'Processando…' : `Processar ${selecionados.size}`}
              </button>
            )
          )}
        </div>
      )}

      {/* Sub-filtro Perdida: quem recebeu / nao recebeu a pesquisa. Ailson 22/06/2026 */}
      {ehAbaPerdida && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: fz(11), color: palette.inkMuted, fontWeight: 600 }}>📋 Pesquisa:</span>
          {[['todos', 'Todos'], ['com', 'Recebeu'], ['sem', 'Não recebeu']].map(([id, label]) => {
            const ativo = filtroPesquisaPerdida === id;
            return (
              <button key={id} onClick={() => setFiltroPesquisaPerdida(id)}
                style={{
                  fontSize: fz(11), padding: '4px 11px', borderRadius: 14,
                  border: `1px solid ${ativo ? palette.accent : palette.beige}`,
                  background: ativo ? palette.accent : palette.surface,
                  color: ativo ? '#fff' : palette.ink,
                  cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                }}>{label}</button>
            );
          })}
        </div>
      )}

      {/* Filtros de reativação: origem do lead + data que virou perdida. Ailson 04/07/2026 */}
      {ehAbaPerdida && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: fz(11), color: palette.inkMuted, fontWeight: 600 }}>🎯 Origem:</span>
            {[
              ['todas', 'Todas'],
              ['carrinho_site_amicialoja', 'Carrinho'],
              ['instagram_stories', 'Stories'],
              ['anuncio_facebook', 'Anúncio FB'],
              ['anuncio_instagram', 'Anúncio IG'],
              ['instagram_linktree', 'Linktree'],
              ['desconhecida', 'Desconhecida'],
            ].map(([id, label]) => {
              const ativo = filtroOrigemPerdida === id;
              return (
                <button key={id} onClick={() => setFiltroOrigemPerdida(id)}
                  style={{
                    fontSize: fz(11), padding: '4px 11px', borderRadius: 14,
                    border: `1px solid ${ativo ? palette.accent : palette.beige}`,
                    background: ativo ? palette.accent : palette.surface,
                    color: ativo ? '#fff' : palette.ink,
                    cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                  }}>{label}</button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: fz(11), color: palette.inkMuted, fontWeight: 600 }}>📅 Perdida entre:</span>
            <input type="date" value={perdidaDe} onChange={e => setPerdidaDe(e.target.value)}
              style={{ fontSize: fz(11), padding: '4px 8px', borderRadius: 6, border: `1px solid ${palette.beige}`, fontFamily: FONT, background: palette.surface, color: palette.ink }} />
            <span style={{ fontSize: fz(11), color: palette.inkMuted }}>e</span>
            <input type="date" value={perdidaAte} onChange={e => setPerdidaAte(e.target.value)}
              style={{ fontSize: fz(11), padding: '4px 8px', borderRadius: 6, border: `1px solid ${palette.beige}`, fontFamily: FONT, background: palette.surface, color: palette.ink }} />
            {(perdidaDe || perdidaAte || filtroOrigemPerdida !== 'todas') && (
              <button onClick={() => { setPerdidaDe(''); setPerdidaAte(''); setFiltroOrigemPerdida('todas'); }}
                style={{ fontSize: fz(11), padding: '4px 10px', borderRadius: 14, border: `1px solid ${palette.beige}`, background: palette.surface, color: palette.inkMuted, cursor: 'pointer', fontFamily: FONT, fontWeight: 600 }}>
                limpar
              </button>
            )}
          </div>
        </>
      )}

      {(filtroEtapa === 'follow_up' || filtroEtapa === 'perdida') && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, marginBottom: 10,
          padding: '6px 12px', borderRadius: 999,
          background: palette.surface, border: `1px solid ${palette.beige}`,
          fontFamily: FONT, fontSize: fz(12), fontWeight: 700, color: palette.inkSoft,
        }}>
          <Send size={13} color={palette.accent} />
          {enviadosHoje} {enviadosHoje === 1 ? 'pesquisa enviada' : 'pesquisas enviadas'} hoje
        </div>
      )}

      {feedback && (
        <div style={{
          padding: '8px 12px', marginBottom: 10, borderRadius: 6,
          background: feedback.tipo === 'erro' ? palette.alertSoft : '#e7f5ec',
          color: feedback.tipo === 'erro' ? palette.alert : '#2e7d32',
          fontSize: fz(13), fontWeight: 500,
        }}>{feedback.msg}</div>
      )}

      {conversas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: palette.inkMuted }}>
          Nenhuma conversa nessa etapa.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {conversas.map(c => (
              <ConversaRow key={c.id} c={c}
                vendedoraNome={c.vendedora_atribuida_id ? vendedorasMap.get(c.vendedora_atribuida_id) : null}
                vendedorasMap={vendedorasMap}
                selecionavel={ehAbaProcessando || ehAbaAprovar || ehAbaPerdida}
                selecionado={selecionados.has(c.id)}
                onToggleSelecao={() => toggleSelecao(c.id)}
                onContinuarSofia={() => onContinuarSofia(c)}
                onEnviarVendedora={() => setModalEnviar({ conversa: c })}
                onTogglePrioridade={() => onTogglePrioridade(c)}
                onToggleCatalogoFollowup={() => onToggleCatalogoFollowup(c)}
                onDefinirFollowUp={(dias) => onDefinirFollowUp(c, dias)}
                onEditar={() => setModalEditarLead({ conversa: c })}
                onConfirmarPago={() => setModalPago({ conversa: c })}
                onDecidiuQuente={(id, decisao) => {
                  // Update otimista: zera sugestao quente do card (some na hora)
                  // e se aceitou tambem ja marca etapa='quente' localmente.
                  // Reload tick depois pega handoffs novos e estado real.
                  setConversas(prev => prev.map(x => x.id === id ? {
                    ...x,
                    sugestao_quente_pendente_em: null,
                    sugestao_quente_motivo: null,
                    sugestao_quente_gatilhos: null,
                    ...(decisao === 'aceitar' ? { etapa: 'quente' } : {}),
                  } : x));
                  setReloadTick(t => t + 1);
                }}
                onAbrirChat={() => {
                  setConversaDetalhe(c.id);
                  // Zera unread localmente (UI instantanea) + no banco (fire-and-forget)
                  if (c.unread_count > 0) {
                    setConversas(prev => prev.map(x => x.id === c.id ? { ...x, unread_count: 0 } : x));
                    fetch('/api/lojas-whats-conversa-vista', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ conversa_id: c.id }),
                    }).catch(() => {});
                  }
                }}
              />
            ))}
          </div>
          {!expandido && conversas.length >= 50 && (
            <button onClick={() => setExpandido(true)} style={{
              width: '100%', marginTop: 12, padding: '10px',
              background: palette.surface, border: `1px dashed ${palette.beige}`,
              borderRadius: 8, cursor: 'pointer', fontFamily: FONT,
              fontSize: fz(13), fontWeight: 600, color: palette.ink,
            }}>
              Ver mais conversas (até 500)
            </button>
          )}
          {expandido && (
            <div style={{ textAlign: 'center', marginTop: 12, fontSize: fz(11), color: palette.inkMuted }}>
              {conversas.length} conversas exibidas
            </div>
          )}
        </>
      )}

      {modalEnviar && (
        <EnviarVendedoraModal
          conversa={modalEnviar.conversa}
          onClose={() => setModalEnviar(null)}
          onSucesso={(msg) => { setFeedback({ tipo: 'ok', msg }); setModalEnviar(null); setReloadTick(t => t + 1); }}
          onErro={(msg) => setFeedback({ tipo: 'erro', msg })}
        />
      )}

      {modalEditarLead && (
        <EditarLeadModal
          conversa={modalEditarLead.conversa}
          onClose={() => setModalEditarLead(null)}
          onSucesso={(msg) => { setFeedback({ tipo: 'ok', msg }); setModalEditarLead(null); setReloadTick(t => t + 1); }}
          onErro={(msg) => setFeedback({ tipo: 'erro', msg })}
          onEnviarVendedora={(conv) => setModalEnviar({ conversa: conv })}
        />
      )}

      {modalPago && (
        <ModalConfirmarPago
          conversa={modalPago.conversa}
          onClose={() => setModalPago(null)}
          onSucesso={(msg) => { setFeedback({ tipo: 'ok', msg }); setModalPago(null); setReloadTick(t => t + 1); }}
          onErro={(msg) => setFeedback({ tipo: 'erro', msg })}
        />
      )}

      {ajudaEtapa && (
        <ModalEtapa etapaId={ajudaEtapa} onClose={() => setAjudaEtapa(null)} />
      )}
    </div>
  );
}

// Tooltips de cada etapa (Ailson 26/05/2026 — Q sobre regras)
// ─── INFO DETALHADA POR ETAPA (modal grande no ?) ─────────────────────────
// Cada chave eh uma etapa do funil. Renderizada no ModalEtapa.
// Mantem aspecto educativo — assistente precisa entender pra operar bem.

const INFO_ETAPA = {
  todas: {
    titulo: 'Todas as conversas',
    cor: palette.ink,
    definicao: 'Filtro neutro. Mostra todas as conversas, em qualquer etapa do funil.',
    quando_entra: ['Sempre — esse filtro nao remove nada.'],
    quando_sai: ['Nunca — eh uma visao agregada.'],
    regras: ['Util pra busca geral ou auditoria.'],
    acoes: ['Tudo que estiver disponivel na conversa especifica.'],
  },
  processando: {
    titulo: 'Processando (Fila)',
    cor: '#6b7280',
    definicao: 'Fila de leads elegiveis aguardando Sofia gerar a primeira mensagem (HSM).',
    quando_entra: [
      'Carrinho abandonado no site (lojas_leads_carrinho) entra automaticamente.',
      'Filtros aplicados: PF 1-6 pecas, PJ 0 pecas (carrinho vazio), maximo 15 dias.',
      'Cron-selecionar (07h BRT, seg-sex) popula a fila sem cap.',
    ],
    quando_sai: [
      'Cron-processar (07h45 BRT) pega cap_diario, gera HSM via IA, move pra "Aprovar".',
      'Assistente pode marcar checkbox e processar manualmente leads extras a qualquer momento.',
    ],
    regras: [
      'Sem IA aqui — apenas selecao por regras.',
      'Cap diario configuravel em lojas_whats_config (cap_diario).',
      'Ordenacao: PJ por valor desc, PF por data desc.',
    ],
    acoes: ['Selecionar via checkbox + botao "Processar selecionados".'],
  },
  aprovar: {
    titulo: 'Aprovar',
    cor: '#d97706',
    definicao: 'Sugestao de mensagem (HSM) pronta, esperando a assistente revisar e decidir.',
    quando_entra: [
      'Cron-processar gerou a sugestao automaticamente (rotina das 07h45 BRT).',
      'OU assistente processou manualmente um lead da fila.',
    ],
    quando_sai: [
      'Assistente aprova → mensagem enviada → etapa "Enviada".',
      'Assistente dispensa → vai pra "Perdida" (motivo: dispensada).',
      'Sem acao em 3 dias → vira "Perdida" automaticamente.',
    ],
    regras: [
      'Janela de envio: seg-sex 09h-21h (configuravel).',
      'Texto pode ser editado antes de aprovar.',
      'Cada envio consome 1 conversa HSM da WABA.',
    ],
    acoes: ['Aprovar (envia HSM)', 'Editar texto', 'Dispensar sugestão', 'Anexar midia'],
  },
  enviada: {
    titulo: 'Enviada',
    cor: '#3b82f6',
    definicao: 'HSM enviada via Cloud API. Aguardando o cliente responder pra abrir janela de 24h.',
    quando_entra: ['Assistente aprovou na etapa anterior.'],
    quando_sai: [
      'Cliente responde → etapa "Conversando".',
      '3 dias sem resposta → etapa "Perdida".',
    ],
    regras: [
      'Status WhatsApp atualizado em tempo real pelo webhook (sent → delivered → read → failed).',
      'Antes do cliente responder, NAO da pra mandar texto livre — so HSM aprovada.',
      'Webhook valida HMAC-SHA256 pra garantir que veio da Meta.',
    ],
    acoes: ['So aguardar. Visualizar status de entrega.'],
  },
  conversando: {
    titulo: 'Conversando',
    cor: '#10b981',
    definicao: 'Cliente respondeu! Janela de 24h aberta. Sofia conduz a conversa de forma autonoma.',
    quando_entra: ['Primeira mensagem do cliente apos HSM enviada.'],
    quando_sai: [
      'IA detecta gatilho de venda → etapa "Quente".',
      'Cliente fechou venda (cruzamento de pedidos) → "Vendeu".',
      'Conversa esfria sem evolucao → "Perdida".',
    ],
    regras: [
      'Sofia gera respostas via Claude Sonnet 4.6.',
      'Aprende padroes da vendedora correspondente (lojas_whats_aprendizado_padroes).',
      'Tons banidos: incrivel, imperdivel, sensacional, travessao. Sempre "vc".',
      'Sacola: nao usa R$. Marca "Amicia" nunca no texto da resposta.',
    ],
    acoes: ['Acompanhar', 'Intervir manualmente', 'Editar lead', 'Forcar handoff'],
  },
  quente: {
    titulo: 'Quente',
    cor: '#ef4444',
    definicao: 'IA detectou que o cliente esta proximo de fechar. Momento de decisao.',
    quando_entra: [
      'Mencao a: pix, frete, parcelamento, "separar peca", "vou pagar", "amanha levo".',
      'Pergunta direta sobre forma de pagamento ou retirada.',
    ],
    quando_sai: [
      'Assistente clica "Continuar Sofia" → volta pra "Conversando".',
      'Assistente clica "Enviar vendedora" → handoff → "Atendida" quando vendedora aceitar.',
      '2 dias sem decisao (esfriando) → "Perdida".',
    ],
    regras: [
      'Sofia PAUSA respostas automaticas — espera decisao humana.',
      'Vendedora rodiziada por loja (Silva Teles ou Bom Retiro) conforme link Vesti.',
      'Vendedora tem 30 min pra aceitar o handoff.',
    ],
    acoes: ['Continuar Sofia', 'Enviar vendedora (handoff)'],
  },
  atendida: {
    titulo: 'Atendida',
    cor: '#8b5cf6',
    definicao: 'Vendedora aceitou o handoff e esta conduzindo o atendimento humano.',
    quando_entra: ['Vendedora aceitou em ate 30min na fila dela.'],
    quando_sai: [
      'Cliente fecha venda → "Vendeu".',
      'Conversa fica parada sem venda → "Perdida".',
    ],
    regras: [
      'Sofia para de gerar mensagens nesta conversa.',
      'Vendedora continua via WhatsApp pessoal dela.',
      'App registra que essa vendedora pegou — conta pra conversao depois.',
    ],
    acoes: ['Visualizar historico. Aguardar fechamento.'],
  },
  vendeu: {
    titulo: 'Vendeu',
    cor: '#059669',
    definicao: 'Conversao confirmada — cliente fechou venda atribuida a essa conversa.',
    quando_entra: [
      'Cruzamento automatico de pedidos:',
      '  • Site: venda em ate 5 dias apos a conversa.',
      '  • Loja fisica: venda em ate 15 dias apos a conversa.',
    ],
    quando_sai: ['Estado terminal — nao sai mais.'],
    regras: [
      'Atribuicao usa documento (CPF/CNPJ) + telefone normalizado.',
      'Vendedora que pegou handoff leva o credito.',
      'Se Sofia conduziu ate o fim sem handoff: credito vai pra Sofia.',
    ],
    acoes: ['Visualizar pedido relacionado. Auditoria.'],
  },
  follow_up: {
    titulo: 'Follow up',
    cor: '#f59e0b',
    definicao: 'Lead com potencial mas que nao virou venda no primeiro contato. Sofia tenta de novo depois de um tempo com outro angulo.',
    quando_entra: [
      'Cliente estava em "Conversando" mas IA NAO conseguiu levar pra "Quente".',
      'Sinais detectados pela IA:',
      '  • "vou pensar", "depois decido", "indeciso"',
      '  • "vou voltar no site pra comprar" mas passaram 3 dias sem venda no sistema',
      '  • Pediu catalogo e nao respondeu mais',
      '  • Conversa esfriou mas demonstrou interesse real',
    ],
    quando_sai: [
      'Cliente responde o follow-up → volta pra "Conversando".',
      'Detecta gatilho quente no follow-up → "Quente".',
      'Sem resposta apos 2 tentativas de follow-up → "Perdida".',
      'Cruzamento de venda detecta compra → "Vendeu".',
    ],
    regras: [
      'Sofia escolhe template baseado no contexto da conversa anterior:',
      '  • Mencionou site → "Conseguiu fazer o pedido no site?"',
      '  • Pediu catalogo → "Conseguiu analisar o catalogo? Ficou alguma duvida?"',
      '  • Generico → "Ainda quer fechar? Posso ajudar?"',
      'Envio: texto livre se janela 24h aberta, HSM se fora.',
      'Intervalo: 3-5 dias apos ultima interacao (configuravel).',
      'Limite: 2 follow-ups por conversa, depois vira Perdida.',
    ],
    acoes: ['Enviar follow-up agora', 'Editar mensagem antes de enviar', 'Pular follow-up', 'Enviar vendedora'],
  },
  perdida: {
    titulo: 'Perdida',
    cor: '#9ca3af',
    definicao: 'Conversa nao evoluiu. Estado terminal sem conversao.',
    quando_entra: [
      'Aprovar: 3 dias sem acao da assistente.',
      'Enviada: 3 dias sem resposta do cliente.',
      'Quente: 2 dias sem decisao.',
      'Follow up: 2 tentativas sem resposta.',
      'Manual: assistente dispensou (registra motivo).',
    ],
    quando_sai: ['Estado terminal — nao sai mais.'],
    regras: [
      'Cron-promover roda a cada 4h reavaliando prazos.',
      'Nao volta automaticamente — se quiser reativar, e novo lead.',
    ],
    acoes: ['So consulta. Util pra entender por que conversoes nao acontecem.'],
  },
};

// ─── MODAL DE EXPLICACAO DA ETAPA ─────────────────────────────────────────
// Aberto ao clicar no ? do FiltroChip. Renderiza INFO_ETAPA[id] formatado.

function ModalEtapa({ etapaId, onClose }) {
  const info = INFO_ETAPA[etapaId];
  if (!info) return null;

  // Trava scroll do body enquanto aberto
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, []);

  const Section = ({ titulo, items, icon }) => {
    if (!items || items.length === 0) return null;
    return (
      <div style={{ marginTop: 18 }}>
        <div style={{
          fontSize: fz(12), fontWeight: 700, color: palette.inkMuted,
          textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>{icon}</span> {titulo}
        </div>
        <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55, fontSize: fz(14), color: palette.ink }}>
          {items.map((it, i) => <li key={i} style={{ marginBottom: 4 }}>{it}</li>)}
        </ul>
      </div>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 16, fontFamily: FONT,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: palette.bg, borderRadius: 14,
          maxWidth: 600, width: '100%', maxHeight: '88vh', overflowY: 'auto',
          boxShadow: '0 18px 50px rgba(0,0,0,0.28)',
        }}
      >
        {/* Header colorido com a cor da etapa */}
        <div style={{
          background: info.cor, color: '#fff',
          padding: '18px 22px', borderRadius: '14px 14px 0 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <EtapaIcon nome={etapaId} size={26} />
            <div style={{ fontSize: fz(20), fontWeight: 700 }}>{info.titulo}</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            style={{
              background: 'rgba(255,255,255,0.2)', border: 'none',
              color: '#fff', width: 32, height: 32, borderRadius: '50%',
              fontSize: 18, cursor: 'pointer', fontWeight: 700, lineHeight: 1,
            }}
          >×</button>
        </div>

        {/* Corpo */}
        <div style={{ padding: '20px 22px 24px' }}>
          <div style={{
            fontSize: fz(15), color: palette.ink, lineHeight: 1.55,
            padding: '12px 14px', background: palette.surface,
            borderLeft: `3px solid ${info.cor}`, borderRadius: 6,
          }}>
            {info.definicao}
          </div>

          <Section titulo="Quando o lead entra aqui" items={info.quando_entra} icon="→" />
          <Section titulo="Quando o lead sai daqui" items={info.quando_sai} icon="↳" />
          <Section titulo="Regras de negocio" items={info.regras} icon="⚙" />
          <Section titulo="Acoes disponiveis" items={info.acoes} icon="✦" />
        </div>
      </div>
    </div>
  );
}

const FiltroChip = ({ label, ativo, cor, onClick, iconNome, etapaId, badge, unread, onAjuda, badgeCor }) => {
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={onClick} style={{
        padding: '6px 10px', borderRadius: 16, cursor: 'pointer',
        border: `1px solid ${ativo ? (cor || palette.ink) : palette.beige}`,
        background: ativo ? (cor || palette.ink) : palette.surface,
        color: ativo ? palette.bg : palette.ink,
        fontSize: fz(13), fontFamily: FONT, fontWeight: 500,
        whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
      }}>
        {iconNome && <EtapaIcon nome={iconNome} size={14} />}
        {label}
        {typeof badge === 'number' && badge > 0 && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: 18, height: 18, padding: '0 5px',
            borderRadius: 10, fontSize: fz(10), fontWeight: 700,
            background: ativo ? 'rgba(255,255,255,0.25)' : (badgeCor || cor || palette.ink),
            color: ativo ? palette.bg : palette.bg,
            lineHeight: 1,
          }}>{badge}</span>
        )}
      </button>
      {/* Badge VERMELHO de mensagens nao vistas — flutua no canto superior direito */}
      {typeof unread === 'number' && unread > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: 14, zIndex: 1,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 16, height: 16, padding: '0 4px',
          borderRadius: 8, fontSize: fz(9), fontWeight: 700,
          background: '#dc2626', color: '#fff', lineHeight: 1,
          border: '2px solid #fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
        }}>{unread}</span>
      )}
      {etapaId && onAjuda && (
        <button
          onClick={(e) => { e.stopPropagation(); onAjuda(etapaId); }}
          aria-label={`Como funciona ${label}`}
          title={`Como funciona ${label}`}
          style={{
            marginLeft: 3, width: 18, height: 18, padding: 0,
            borderRadius: '50%', border: `1px solid ${palette.beige}`,
            background: palette.surface, color: palette.inkMuted,
            cursor: 'pointer', fontSize: 11, fontWeight: 700,
            fontFamily: FONT, lineHeight: 1, alignSelf: 'center',
          }}
        >?</button>
      )}
    </div>
  );
};

// Botao "confirmar pago" do card (etapa atendida). Neutro/transparente por
// padrao pra NAO passar impressao de "ja pago"; fica verde so no hover/toque.
// Ailson 26/06/2026.
const BotaoConfirmarPago = ({ onClick }) => {
  const [hover, setHover] = useState(false);
  return (
    <span
      onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Confirmar pagamento — registra o valor e move pra Vendeu"
      style={{
        fontSize: fz(10), padding: '1px 7px', borderRadius: 8, cursor: 'pointer',
        fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3,
        background: hover ? '#1f7a48' : 'transparent',
        color: hover ? '#fff' : palette.inkMuted,
        border: `1px solid ${hover ? '#1f7a48' : palette.beige}`,
        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
      }}
    >✓ confirmar pago</span>
  );
};

const ConversaRow = ({ c, vendedoraNome, vendedorasMap, onContinuarSofia, onEnviarVendedora, onTogglePrioridade, onToggleCatalogoFollowup, onDefinirFollowUp, onEditar, onConfirmarPago, onAbrirChat, onDecidiuQuente, selecionavel, selecionado, onToggleSelecao }) => {
  const ehPJ = c.tipo_documento === 'CNPJ';
  const ehQuente = c.etapa === 'quente';
  const prioritario = !!c.lead_prioritario;
  const [definirAberto, setDefinirAberto] = useState(false);
  const [definirN, setDefinirN] = useState('');
  const [fupBusy, setFupBusy] = useState(false);
  return (
    <div style={{
      background: prioritario ? '#fffbf0' : (selecionado ? '#fff8e1' : palette.surface),
      padding: 10, borderRadius: 8,
      border: `1px solid ${selecionado ? '#ffd54f' : (prioritario ? '#f5c84e' : (ehQuente ? '#f5a623' : palette.beige))}`,
      borderLeftWidth: (prioritario || ehQuente || selecionado) ? 3 : 1,
      borderLeftColor: selecionado ? '#ffd54f' : (prioritario ? '#f5c84e' : (ehQuente ? '#f5a623' : palette.beige)),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Checkbox de selecao multipla (so na aba processando) */}
        {selecionavel && (
          <input type="checkbox" checked={selecionado} onChange={onToggleSelecao}
            style={{ cursor: 'pointer', flexShrink: 0 }} />
        )}
        {/* Estrela prioridade */}
        <button onClick={onTogglePrioridade} title={prioritario ? 'Remover prioridade' : 'Marcar como prioridade'}
          style={{
            background: 'transparent', border: 'none', padding: 0,
            cursor: 'pointer', flexShrink: 0,
          }}>
          <Star size={sz(18)} fill={prioritario ? '#f5c84e' : 'none'}
            color={prioritario ? '#d4a017' : palette.inkMuted} />
        </button>

        <EtapaIcon nome={c.etapa} size={28} />
        {/* Area clicavel: abre chat */}
        <div onClick={onAbrirChat} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Icone origem: carrinho abandonado (Ailson 27/05/2026).
                Hoje todos leads vem dai. No futuro: outras origens viram outros icones. */}
            {c.carrinho_id && (
              <ShoppingCart size={sz(12)} color={palette.inkMuted}
                style={{ flexShrink: 0 }} />
            )}
            {ehPJ ? <Building2 size={sz(12)} color={palette.warn} /> : <UserIcon size={sz(12)} color={palette.accent} />}
            <span style={{ fontSize: fz(14), fontWeight: 600, color: palette.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.nome_cliente || '—'}
            </span>
            {/* Trava de presença: alguém com o chat aberto (Ailson 30/05/2026) */}
            {c.editando_por && c.editando_em && (Date.now() - new Date(c.editando_em).getTime() < 45000) && (
              <span title={`Sendo respondido por ${c.editando_por}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                fontSize: fz(10), padding: '1px 6px', borderRadius: 8,
                background: '#fff4e5', color: '#9c5b00', fontWeight: 700,
              }}>✏️ {c.editando_por}</span>
            )}
            {/* Badge VERMELHO: mensagens novas nao vistas (Ailson 27/05/2026) */}
            {c.unread_count > 0 && (
              <span title={`${c.unread_count} mensagem(ns) nova(s) do cliente`} style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 18, height: 18, padding: '0 5px',
                borderRadius: 9, fontSize: fz(10), fontWeight: 700,
                background: '#dc2626', color: '#fff', lineHeight: 1,
                flexShrink: 0,
              }}>{c.unread_count}</span>
            )}
            {ehQuente && c.score_quente && (
              <span style={{
                fontSize: fz(10), padding: '1px 6px', borderRadius: 8,
                background: '#fff4e0', color: '#8a5500', fontWeight: 700,
              }}>{c.score_quente}</span>
            )}
            {c.cliente_indicou_site && (
              <span title="Cliente disse que vai voltar pro site" style={{
                fontSize: fz(10), padding: '1px 5px', borderRadius: 8,
                background: '#e8f4ff', color: '#2c5d8a', fontWeight: 600,
              }}>🌐 site</span>
            )}
            {/* Relógio do ciclo 24h (Ailson 02/07/2026): janela WhatsApp fechando */}
            {c.etapa === 'conversando' && c.ciclo24_vence_em && <RelogioCiclo24 c={c} />}
            {/* Origem do lead — flag visual (Ailson 25/05/2026) */}
            {c.origem_lead === 'anuncio_facebook' && (
              <span title="Lead veio de anúncio do Facebook (campanha atacado)" style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: fz(10), padding: '1px 5px', borderRadius: 8,
                background: '#e7f1fc', color: '#1877f2', fontWeight: 700,
              }}><Facebook size={fz(11)} fill="#1877f2" color="#1877f2" strokeWidth={0} /> Facebook</span>
            )}
            {c.origem_lead === 'anuncio_instagram' && (
              <span title="Lead veio de anúncio Meta Ads (Instagram/Facebook)" style={{
                fontSize: fz(10), padding: '1px 5px', borderRadius: 8,
                background: '#e7f1fc', color: '#1877f2', fontWeight: 700,
                fontFamily: 'Arial Black, sans-serif',
              }}>f Ads</span>
            )}
            {c.origem_lead === 'carrinho_site_amicialoja' && (
              <span title="Lead de carrinho abandonado no site amicialoja.com.br" style={{
                fontSize: fz(10), padding: '1px 5px', borderRadius: 8,
                background: '#fff0e0', color: '#a55a00', fontWeight: 600,
              }}>🛒 carrinho</span>
            )}
            {c.origem_lead === 'instagram_stories' && (
              <span title="Lead via link no Stories do Instagram (Amicia)" style={{
                fontSize: fz(10), padding: '1px 5px', borderRadius: 8,
                background: 'linear-gradient(45deg, #fbe5d2, #f4d6e5)', color: '#a8388d', fontWeight: 700,
              }}>📸 stories</span>
            )}
            {c.origem_lead === 'instagram_linktree' && (
              <span title="Lead via Linktree do Instagram (Amicia)" style={{
                fontSize: fz(10), padding: '1px 5px', borderRadius: 8,
                background: '#e6f7ee', color: '#1f7a48', fontWeight: 700,
              }}>🔗 linktree</span>
            )}
            {c.origem_lead === 'sac' && (
              <span title="Atendimento iniciado pelo botão do site Amícia (SAC)" style={{
                fontSize: fz(10), padding: '1px 5px', borderRadius: 8,
                background: '#eaf1f7', color: '#2c5d86', fontWeight: 700,
              }}>🎧 SAC</span>
            )}
            {/* Pesquisa de motivo (Ailson 22/06/2026): selo pra ver quem recebeu /
                quem respondeu, principalmente na aba Perdida. */}
            {c.pesquisa_respondida_em ? (
              <span title={`Respondeu a pesquisa de motivo${c.pesquisa_motivo ? ' (' + c.pesquisa_motivo + ')' : ''}`} style={{
                fontSize: fz(10), padding: '1px 5px', borderRadius: 8,
                background: '#e6f7ee', color: '#1f7a48', fontWeight: 700,
              }}>📋 {({ minimo_pecas: 'mín. peças', preco: 'preço', variedade: 'variedade', outros: 'outros' }[c.pesquisa_motivo]) || 'respondeu'}</span>
            ) : c.pesquisa_enviada_em ? (
              <span title="Pesquisa de motivo enviada, aguardando resposta" style={{
                fontSize: fz(10), padding: '1px 5px', borderRadius: 8,
                background: '#fff4e5', color: '#9c5b00', fontWeight: 700,
              }}>📋 pesquisa</span>
            ) : null}
            {/* Relógio de follow-up do catálogo — clicável: desmarca/reativa o
                envio automático 6h/24h sem abrir o chat. Ailson 29/05/2026. */}
            {c.catalogo_enviado_em && !['vendeu', 'perdida'].includes(c.etapa) && (() => {
              const fase24 = !!c.catalogo_followup_6h_em;
              const baseMs = fase24
                ? new Date(c.catalogo_followup_6h_em).getTime() + 24 * 3600 * 1000
                : new Date(c.catalogo_enviado_em).getTime() + 6 * 3600 * 1000;
              const base = new Date(baseMs);
              const hBRT = parseInt(base.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }), 10);
              let alvo = base;
              if (hBRT < 9 || hBRT >= 20) {
                const d = new Date(base);
                if (hBRT >= 20) d.setUTCDate(d.getUTCDate() + 1);
                const dataBRT = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
                alvo = new Date(`${dataBRT}T09:00:00-03:00`);
              }
              const quando = alvo.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit' });
              const pausado = c.catalogo_followup_pausado;
              return (
                <span
                  onClick={(e) => { e.stopPropagation(); onToggleCatalogoFollowup && onToggleCatalogoFollowup(); }}
                  title={pausado
                    ? 'Follow-up do catálogo DESMARCADO — não sai automático. Clique pra reativar.'
                    : `Follow-up ${fase24 ? '24h' : '6h'} automático ~ ${quando}. Clique pra desmarcar.`}
                  style={{
                    fontSize: fz(10), padding: '1px 5px', borderRadius: 8, cursor: 'pointer',
                    background: pausado ? '#f3f4f6' : '#eef6ff',
                    color: pausado ? '#9ca3af' : '#1e40af', fontWeight: 700, flexShrink: 0,
                    textDecoration: pausado ? 'line-through' : 'none',
                  }}
                >{pausado ? '🔕' : '⏰'}</span>
              );
            })()}
            {c.etapa === 'atendida' && vendedoraNome && (
              <span title={`Atendida por ${vendedoraNome}`} style={{
                fontSize: fz(10), padding: '1px 6px', borderRadius: 8,
                background: '#f3eafc', color: '#6b3aa0', fontWeight: 700,
              }}>👤 {vendedoraNome}</span>
            )}
            {c.etapa === 'atendida' && (
              <BotaoConfirmarPago onClick={onConfirmarPago} />
            )}
            {c.etapa === 'follow_up' && vendedoraNome && (
              <span title={`Estava em atendimento com ${vendedoraNome}`} style={{
                fontSize: fz(10), padding: '1px 6px', borderRadius: 8,
                background: '#f3eafc', color: '#6b3aa0', fontWeight: 700,
              }}>👤 estava com {vendedoraNome}</span>
            )}
          </div>
          <div style={{ fontSize: fz(11), color: palette.inkMuted, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span>{fmtPhone(c.telefone)}</span>
            {c.documento && (
              <span>· {c.tipo_documento}: {fmtDocumento(c.documento)}</span>
            )}
            {c.qtd_pecas > 0 && <span>· {c.qtd_pecas} peças</span>}
            {Number(c.valor_carrinho) > 0 && <span>· {fmtMoney(c.valor_carrinho)}</span>}
            {c.etapa === 'vendeu' && Number(c.vendeu_valor) > 0 && (
              <span style={{ fontWeight: 700, color: palette.ok }}>· venda {fmtMoney(c.vendeu_valor)}</span>
            )}
          </div>
        </div>

        {/* Botao editar (abre modal completo) */}
        <button onClick={onEditar} title="Editar lead (observações, etapa, anexos)"
          style={{
            background: 'transparent', border: `1px solid ${palette.beige}`,
            borderRadius: 4, padding: 4, cursor: 'pointer', flexShrink: 0,
          }}>
          <Edit3 size={sz(12)} color={palette.inkMuted} />
        </button>

        <div style={{ fontSize: fz(11), color: palette.inkMuted, textAlign: 'right', flexShrink: 0, marginLeft: 4 }}>
          {fmtRelTime(c.ultima_atividade_em)}
        </div>
      </div>

      {/* Observação pra Sofia (preview se existe) */}
      {c.observacao_para_sofia && (
        <div style={{
          marginTop: 8, padding: '6px 8px', borderRadius: 4,
          background: '#fff8e0', borderLeft: `2px solid #d4a017`,
          fontSize: fz(11), color: '#5a4500',
        }}>
          <strong>📝 pra Sofia:</strong> {c.observacao_para_sofia.slice(0, 100)}
          {c.observacao_para_sofia.length > 100 && '...'}
        </div>
      )}

      {/* Sugestao Sofia pendente: Tamara decide promover pra quente ou nao
          (Ailson 27/05/2026). Aparece antes do bloco quente porque essa
          decisao precede a transicao pra quente. */}
      {c.sugestao_quente_pendente_em && (
        <div style={{
          marginTop: 8, padding: 8, borderRadius: 6,
          background: '#fff8e7', border: '1px solid #f5c84e',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: fz(11), color: '#8a5500', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <img src="/robo-ia.png" alt="Sofia" style={{ width: 18, height: 18, flexShrink: 0, verticalAlign: 'middle' }} />
            <strong>Sofia sugere promover pra quente</strong>
            {c.sugestao_quente_motivo && (
              <span style={{ display: 'block', color: '#6a4500', marginTop: 2, width: '100%' }}>
                {c.sugestao_quente_motivo}
              </span>
            )}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (!confirm('Promover esta conversa pra quente e disparar handoff pra vendedora?')) return;
                const r = await fetch('/api/lojas-whats-sugestao-quente-decidir', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    conversa_id: c.id, decisao: 'aceitar',
                    decidida_por: 'tamara',
                  }),
                });
                const d = await r.json();
                if (!r.ok) { alert('Erro: ' + (d.error || r.status)); return; }
                onDecidiuQuente?.(c.id, 'aceitar');
              }}
              style={{
                padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
                background: '#d97706', color: '#fff', border: 'none',
                fontSize: fz(11), fontFamily: FONT, fontWeight: 700,
              }}>
              🔥 Promover
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                const r = await fetch('/api/lojas-whats-sugestao-quente-decidir', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    conversa_id: c.id, decisao: 'recusar',
                    decidida_por: 'tamara',
                  }),
                });
                const d = await r.json();
                if (!r.ok) { alert('Erro: ' + (d.error || r.status)); return; }
                onDecidiuQuente?.(c.id, 'recusar');
              }}
              style={{
                padding: '5px 10px', borderRadius: 5, cursor: 'pointer',
                background: palette.surface, color: palette.inkSoft,
                border: `1px solid ${palette.beige}`,
                fontSize: fz(11), fontFamily: FONT, fontWeight: 600,
              }}>
              ❌ Manter
            </button>
          </div>
        </div>
      )}

      {/* Botões só pra etapa quente — esconde se ja tem handoff pendente */}
      {ehQuente && (() => {
        const handoffPend = (c.handoffs || []).some(h => ['aguardando','fila_fora_janela'].includes(h.status));
        if (handoffPend) {
          // Ja foi enviada pra vendedora — mostra QUEM estamos esperando + permite
          // cancelar e reenviar manual (escolher outra vendedora). Ailson 01/06/2026.
          const hPend = (c.handoffs || []).find(h => ['aguardando', 'fila_fora_janela'].includes(h.status));
          const vNome = hPend && vendedorasMap ? vendedorasMap.get(hPend.vendedora_id) : null;
          return (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${palette.beige}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{
                padding: '8px 10px', background: '#ecfdf5', border: '1px solid #86efac',
                borderRadius: 6, color: '#166534',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                fontSize: fz(12), fontFamily: FONT, fontWeight: 600,
              }}>
                <Users size={sz(14)} /> Aguardando {vNome || 'vendedora'} aceitar
              </div>
              <button onClick={onEnviarVendedora} style={{
                padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
                background: palette.surface, color: palette.alert,
                border: `1px solid ${palette.beige}`,
                fontSize: fz(12), fontFamily: FONT, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
                <Users size={sz(14)} /> Cancelar e enviar manual
              </button>
            </div>
          );
        }
        return (
          <div style={{ display: 'flex', gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${palette.beige}` }}>
            <button onClick={onContinuarSofia} style={{
              flex: 1, padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
              background: palette.surface, color: palette.ink,
              border: `1px solid ${palette.beige}`,
              fontSize: fz(12), fontFamily: FONT, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
              <Bot size={sz(14)} /> Continuar Sofia
            </button>
            <button onClick={onEnviarVendedora} style={{
              flex: 1, padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
              background: '#f5a623', color: '#fff',
              border: '1px solid #f5a623',
              fontSize: fz(12), fontFamily: FONT, fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
              <Users size={sz(14)} /> Enviar vendedora
            </button>
          </div>
        );
      })()}

      {/* Mini-controle de follow-up: agenda (1d/3d/Nd) ou deixa parado
          ("nao enviar"). NULL = nada dispara sozinho. Ailson 01/06/2026. */}
      {c.etapa === 'follow_up' && onDefinirFollowUp && (() => {
        const venceEm = c.follow_up_vence_em ? new Date(c.follow_up_vence_em) : null;
        const venceLabel = venceEm
          ? venceEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
          : null;
        const aplicar = async (dias) => {
          if (fupBusy) return;
          setFupBusy(true);
          try { await onDefinirFollowUp(dias); }
          finally { setFupBusy(false); setDefinirAberto(false); setDefinirN(''); }
        };
        const btnBase = {
          padding: '5px 9px', borderRadius: 5, cursor: fupBusy ? 'default' : 'pointer',
          border: `1px solid ${palette.beige}`, background: palette.surface,
          color: palette.ink, fontSize: fz(11), fontFamily: FONT, fontWeight: 600,
          opacity: fupBusy ? 0.6 : 1,
        };
        return (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px dashed ${palette.beige}` }}>
            <div style={{ fontSize: fz(11), color: venceLabel ? '#92580a' : palette.inkMuted, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              {venceLabel ? `⏰ retomada agendada ~ ${venceLabel}` : '⏸️ parado — não envia por enquanto'}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <button disabled={fupBusy} onClick={(e) => { e.stopPropagation(); aplicar(1); }} style={btnBase}>1 dia</button>
              <button disabled={fupBusy} onClick={(e) => { e.stopPropagation(); aplicar(3); }} style={btnBase}>3 dias</button>
              {!definirAberto ? (
                <button disabled={fupBusy} onClick={(e) => { e.stopPropagation(); setDefinirAberto(true); }} style={btnBase}>Definir dias</button>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <input type="number" min="1" max="365" value={definirN}
                    autoFocus
                    onChange={(e) => setDefinirN(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { const n = parseInt(definirN, 10); if (n > 0) aplicar(n); } }}
                    placeholder="N"
                    style={{
                      width: 52, padding: '4px 6px', borderRadius: 5,
                      border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: fz(11),
                      color: palette.ink, background: palette.surface, boxSizing: 'border-box',
                    }} />
                  <button disabled={fupBusy} onClick={() => { const n = parseInt(definirN, 10); if (n > 0) aplicar(n); }}
                    style={{ ...btnBase, background: '#f5a623', color: '#fff', border: '1px solid #f5a623' }}>OK</button>
                  <button disabled={fupBusy} onClick={() => { setDefinirAberto(false); setDefinirN(''); }}
                    style={{ ...btnBase, padding: '5px 7px' }}>×</button>
                </span>
              )}
              <button disabled={fupBusy} onClick={(e) => { e.stopPropagation(); aplicar(null); }}
                style={{ ...btnBase, color: venceLabel ? palette.inkSoft : '#1f7a48', borderColor: venceLabel ? palette.beige : '#9bd3b0', background: venceLabel ? palette.surface : '#eefaf2' }}>
                Não enviar
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// MODAL "Enviar vendedora" (Etapa 5 quente → encaminha pra rodízio ou manual)
// ═══════════════════════════════════════════════════════════════════════════

export function EnviarVendedoraModal({ conversa, onClose, onSucesso, onErro }) {
  // Se a conversa ja tem handoff pendente, abrimos direto no modo "Definir"
  // (manual) — o backend cancela o pendente e reenvia pra escolhida. Ailson 01/06.
  const temHandoffPendente = (conversa.handoffs || []).some(h => ['aguardando', 'fila_fora_janela'].includes(h.status));
  const [modo, setModo] = useState(temHandoffPendente ? 'manual' : 'rodizio'); // 'rodizio' | 'manual'
  const [vendedoraId, setVendedoraId] = useState('');
  const [vendedoras, setVendedoras] = useState([]);
  const [enviando, setEnviando] = useState(false);

  // Carrega TODAS vendedoras quando abre o modo manual
  useEffect(() => {
    if (modo !== 'manual') return;
    (async () => {
      const { data } = await supabase
        .from('lojas_vendedoras')
        .select('id, nome, loja, ativa')
        .order('loja')
        .order('nome');
      setVendedoras(data || []);
    })();
  }, [modo]);

  const enviar = async () => {
    if (modo === 'manual' && !vendedoraId) {
      onErro('Selecione uma vendedora.');
      return;
    }
    setEnviando(true);
    try {
      const r = await fetch('/api/lojas-whats-encaminhar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversa_id: conversa.id,
          modo,
          vendedora_id: modo === 'manual' ? vendedoraId : undefined,
        }),
      });
      const r2 = await r.json();
      if (!r.ok || r2.error) {
        onErro(r2.error || 'Erro encaminhando.');
      } else {
        const v = vendedoras.find(v => v.id === r2.vendedora_id);
        const nome = v?.nome || 'vendedora';
        onSucesso(r2.mensagem || `Lead enviado pra ${nome}.`);
      }
    } catch (e) {
      onErro(e.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.bg, borderRadius: 12, padding: 20,
        maxWidth: 420, width: '100%', fontFamily: FONT,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: fz(16), color: palette.ink, fontFamily: FONT, fontWeight: 700 }}>
            Enviar pra vendedora
          </h3>
          <button onClick={onClose} style={{
            border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
          }}>
            <X size={sz(22)} color={palette.inkMuted} />
          </button>
        </div>
        <div style={{ fontSize: fz(13), color: palette.inkSoft, marginBottom: 14 }}>
          Cliente: <strong>{conversa.nome_cliente || conversa.telefone}</strong>
        </div>

        {/* Toggle modo */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <button onClick={() => setModo('rodizio')} style={{
            flex: 1, padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${modo === 'rodizio' ? palette.accent : palette.beige}`,
            background: modo === 'rodizio' ? palette.accent : palette.surface,
            color: modo === 'rodizio' ? palette.bg : palette.ink,
            fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
          }}>
            🎲 Rodízio
          </button>
          <button onClick={() => setModo('manual')} style={{
            flex: 1, padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${modo === 'manual' ? palette.accent : palette.beige}`,
            background: modo === 'manual' ? palette.accent : palette.surface,
            color: modo === 'manual' ? palette.bg : palette.ink,
            fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <img src="/sac-icons/usuario_falando.png" alt="Definir" style={{ width: 18, height: 18 }} />
            Definir
          </button>
        </div>

        {/* Descrição modo / select */}
        {modo === 'rodizio' ? (
          <div style={{
            padding: 10, borderRadius: 6, background: palette.surface,
            border: `1px solid ${palette.beige}`, fontSize: fz(12), color: palette.inkSoft,
            marginBottom: 14,
          }}>
            Sistema escolhe a próxima vendedora elegível (rodízio round-robin).
            Janela 9h-13h BRT. Sábado só Bom Retiro.
          </div>
        ) : (
          <select value={vendedoraId} onChange={e => setVendedoraId(e.target.value)} style={{
            width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${palette.beige}`,
            fontFamily: FONT, fontSize: fz(13), color: palette.ink, marginBottom: 14,
            background: palette.surface,
          }}>
            <option value="">Selecione vendedora...</option>
            {vendedoras.map(v => (
              <option key={v.id} value={v.id}>{v.nome} ({v.loja})</option>
            ))}
          </select>
        )}

        {/* Botoes */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onClose} disabled={enviando} style={{
            flex: 1, padding: '9px 14px', borderRadius: 6, cursor: enviando ? 'wait' : 'pointer',
            background: palette.surface, color: palette.ink,
            border: `1px solid ${palette.beige}`, fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
          }}>
            Cancelar
          </button>
          <button onClick={enviar} disabled={enviando} style={{
            flex: 1, padding: '9px 14px', borderRadius: 6, cursor: enviando ? 'wait' : 'pointer',
            background: '#f5a623', color: '#fff',
            border: '1px solid #f5a623', fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
          }}>
            {enviando ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 4: VENDEDORAS — config rodízio + link Vesti
// ═══════════════════════════════════════════════════════════════════════════

function VendedorasTab({ userId, refreshTick }) {
  const [vendedoras, setVendedoras] = useState([]);
  const [configs, setConfigs] = useState({});
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    // Lista todas vendedoras ativas
    const { data: vends } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome, loja, ativa')
      .eq('ativa', true)
      .order('loja')
      .order('nome');
    // Configs Sofia por vendedora
    const { data: configsRows } = await supabase
      .from('lojas_whats_vendedoras')
      .select('*');
    const map = {};
    for (const c of configsRows || []) map[c.vendedora_id] = c;
    setVendedoras(vends || []);
    setConfigs(map);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar, refreshTick]);

  const salvar = async (vendedoraId, patch) => {
    setSalvando(vendedoraId);
    try {
      const existente = configs[vendedoraId];
      const payload = { vendedora_id: vendedoraId, ...patch, atualizado_em: new Date().toISOString() };
      if (existente) {
        const { error } = await supabase
          .from('lojas_whats_vendedoras')
          .update(payload)
          .eq('vendedora_id', vendedoraId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('lojas_whats_vendedoras')
          .insert(payload);
        if (error) throw error;
      }
      // Atualiza local
      setConfigs(prev => ({ ...prev, [vendedoraId]: { ...prev[vendedoraId], ...payload } }));
    } catch (e) {
      alert(`Erro: ${e.message}`);
    } finally {
      setSalvando(null);
    }
  };

  if (loading) return <div style={{ padding: 20, textAlign: 'center' }}><Loader2 size={sz(24)} className="spin" /></div>;

  const noRodizio = vendedoras.filter(v => configs[v.id]?.participa_rodizio).length;

  return (
    <div style={{ padding: 14, fontFamily: FONT }}>
      <div style={{
        background: palette.accentSoft, padding: 10, borderRadius: 8, marginBottom: 14,
        fontSize: fz(13), color: palette.ink,
      }}>
        <strong>{noRodizio} de {vendedoras.length}</strong> vendedoras no rodízio.
        Quando uma conversa atinge 🔥 Quente, o handoff é distribuído entre quem está participando.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {vendedoras.map(v => {
          const cfg = configs[v.id] || {};
          return (
            <div key={v.id} style={{
              background: palette.surface, padding: 12, borderRadius: 10,
              border: `1px solid ${palette.beige}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 18,
                  background: palette.beigeSoft, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: fz(14), fontWeight: 700, color: palette.ink,
                }}>
                  {(v.nome || '?').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink }}>
                    {v.nome}
                  </div>
                  <div style={{ fontSize: fz(11), color: palette.inkMuted }}>{v.loja}</div>
                </div>
                {/* Toggle rodízio */}
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  cursor: 'pointer', userSelect: 'none',
                }}>
                  <input
                    type="checkbox"
                    checked={!!cfg.participa_rodizio}
                    onChange={(e) => salvar(v.id, { participa_rodizio: e.target.checked })}
                    disabled={salvando === v.id}
                    style={{ width: 20, height: 20, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: fz(12), color: palette.ink, fontWeight: 500 }}>Rodízio</span>
                </label>
              </div>

              {/* Link Vesti */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Link2 size={sz(14)} color={palette.inkMuted} />
                <input
                  type="text"
                  placeholder="Link Vesti (opcional)"
                  defaultValue={cfg.link_vesti || ''}
                  onBlur={(e) => {
                    const val = e.target.value.trim() || null;
                    if (val !== (cfg.link_vesti || null)) {
                      salvar(v.id, { link_vesti: val });
                    }
                  }}
                  disabled={salvando === v.id}
                  style={{
                    flex: 1, padding: '6px 8px', borderRadius: 6,
                    border: `1px solid ${palette.beige}`, fontFamily: FONT,
                    fontSize: fz(12), background: palette.bg,
                  }}
                />
                {salvando === v.id && <Loader2 size={sz(14)} className="spin" color={palette.accent} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 5: CONFIG
// ═══════════════════════════════════════════════════════════════════════════

function ConfigTab({ userId, refreshTick }) {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState({}); // { chave: valorString }
  const [salvando, setSalvando] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('lojas_whats_config')
      .select('*')
      .order('chave');
    setConfigs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar, refreshTick]);

  const salvar = async (chave) => {
    if (!(chave in editando)) return;
    setSalvando(chave);
    try {
      let valor;
      try { valor = JSON.parse(editando[chave]); }
      catch { valor = editando[chave]; }
      const { error } = await supabase
        .from('lojas_whats_config')
        .update({ valor, updated_at: new Date().toISOString() })
        .eq('chave', chave);
      if (error) throw error;
      // Atualiza local
      setConfigs(prev => prev.map(c => c.chave === chave ? { ...c, valor } : c));
      setEditando(prev => { const n = { ...prev }; delete n[chave]; return n; });
    } catch (e) {
      alert(`Erro: ${e.message}`);
    } finally {
      setSalvando(null);
    }
  };

  if (loading) return <div style={{ padding: 20, textAlign: 'center' }}><Loader2 size={sz(24)} className="spin" /></div>;

  return (
    <div style={{ padding: 14, fontFamily: FONT }}>
      <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 12 }}>
        Edite com cuidado. Cache é invalidado em ~1min.
      </div>
      {configs.map(c => {
        const valStr = typeof c.valor === 'string' ? c.valor : JSON.stringify(c.valor, null, 2);
        const editado = c.chave in editando;
        const valorAtual = editado ? editando[c.chave] : valStr;
        return (
          <div key={c.chave} style={{
            background: palette.surface, padding: 10, borderRadius: 8,
            marginBottom: 8, border: `1px solid ${palette.beige}`,
          }}>
            <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.ink, marginBottom: 4 }}>
              {c.chave}
            </div>
            {c.descricao && (
              <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 6 }}>
                {c.descricao}
              </div>
            )}
            <textarea
              value={valorAtual}
              onChange={(e) => setEditando(prev => ({ ...prev, [c.chave]: e.target.value }))}
              rows={Math.min(Math.max(valStr.split('\n').length, 1), 8)}
              style={{
                width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 6,
                border: `1px solid ${editado ? palette.warn : palette.beige}`,
                fontFamily: 'monospace', fontSize: fz(12), background: palette.bg,
              }}
            />
            {editado && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button onClick={() => salvar(c.chave)} disabled={salvando === c.chave} style={btnSucesso}>
                  <Save size={sz(12)} style={{ marginRight: 4 }} /> Salvar
                </button>
                <button onClick={() => setEditando(prev => { const n = { ...prev }; delete n[c.chave]; return n; })} style={btnSecundario}>
                  Cancelar
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 6: CONVERSÃO (Ailson 25/05/2026)
// ═══════════════════════════════════════════════════════════════════════════
//
// KPIs de conversao dos leads atendidos por Sofia ou Vendedora, com janela
// diferenciada por canal: site=5d / loja=15d. Filtra origem_tipo=lead_carrinho
// (Sofia so atende carrinho abandonado do site Amicia). NAO interfere com
// CardConversoes do Dashboard Lojas (que tem regra propria de exibir so
// status atencao/+3M/+6M).
//
// Endpoint: /api/lojas-whats-conversoes
// ═══════════════════════════════════════════════════════════════════════════

// ─── Origens Instagram (Ailson 28/05/2026)
// Cards com os 2 links wa.me prontos pra colar no Instagram (Stories + Linktree).
// Mensagens pre-preenchidas batem com a deteccao em api/lojas-whats-webhook.js
// (REGEX_INSTA_STORIES / REGEX_INSTA_LINKTREE) → marcam origem_lead +
// disparam rotina C da Sofia.
const WA_NUMERO_CENTRAL = '5511945017349';  // (11) 94501-7349 — Sofia Amicia
const TEXTO_INSTA_STORIES  = 'Olá!! Vi vcs no insta e preciso de informação para comprar no atacado!!';
const TEXTO_INSTA_LINKTREE = 'Olá!! Gostaria de informações pra comprar no atacado!!';
const URL_INSTA_STORIES  = `https://wa.me/${WA_NUMERO_CENTRAL}?text=${encodeURIComponent(TEXTO_INSTA_STORIES)}`;
const URL_INSTA_LINKTREE = `https://wa.me/${WA_NUMERO_CENTRAL}?text=${encodeURIComponent(TEXTO_INSTA_LINKTREE)}`;

function OrigensInstagramCards({ origens, loading, kpis, fmtMoney }) {
  const [copiado, setCopiado] = useState(null);
  const [ajuda, setAjuda] = useState(null);        // qual card tem o "?" aberto
  const [expandido, setExpandido] = useState(false); // detalhe do card Carrinho
  const fMoney = fmtMoney || ((v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }));
  const copiar = (url, qual) => {
    try {
      navigator.clipboard.writeText(url);
      setCopiado(qual);
      setTimeout(() => setCopiado(c => c === qual ? null : c), 1800);
    } catch {}
  };
  const cardBase = {
    flex: '1 1 240px', minWidth: 0, padding: 12, borderRadius: 10,
    border: `1.5px solid ${palette.beige}`, background: palette.surface,
    display: 'flex', flexDirection: 'column', gap: 8,
  };
  // Funil da origem no periodo do filtro: recebidas · vendas · % (Ailson 30/05/2026)
  const Metricas = ({ o, cor }) => (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap',
      padding: '6px 8px', borderRadius: 6, background: palette.bg,
    }}>
      <span style={{ fontSize: fz(15), fontWeight: 700, color: palette.ink }}>
        {loading && !o ? '…' : (o?.recebidas ?? 0)}
      </span>
      <span style={{ fontSize: fz(9.5), color: palette.inkMuted }}>recebidas</span>
      <span style={{ color: palette.beige, fontSize: fz(11) }}>·</span>
      <span style={{ fontSize: fz(15), fontWeight: 700, color: cor }}>
        {loading && !o ? '…' : (o?.convertidos ?? 0)}
      </span>
      <span style={{ fontSize: fz(9.5), color: palette.inkMuted }}>vendas</span>
      <span style={{ color: palette.beige, fontSize: fz(11) }}>·</span>
      <span style={{ fontSize: fz(13), fontWeight: 700, color: cor }}>
        {o && o.recebidas > 0 ? `${o.pct}%` : '—'}
      </span>
      <span style={{ fontSize: fz(9.5), color: palette.inkMuted }}>conv.</span>
    </div>
  );
  // Cabecalho com botao "?" (Ailson 30/05/2026)
  const Header = ({ icone, titulo, sub, id }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      {icone}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: fz(12.5), fontWeight: 700, color: palette.ink }}>{titulo}</div>
        <div style={{ fontSize: fz(10), color: palette.inkMuted }}>{sub}</div>
      </div>
      <button
        onClick={() => setAjuda(a => a === id ? null : id)}
        title="O que é este card?"
        style={{
          width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
          border: `1px solid ${palette.beige}`, cursor: 'pointer', lineHeight: 1,
          background: ajuda === id ? palette.ink : 'transparent',
          color: ajuda === id ? '#fff' : palette.inkMuted,
          fontSize: fz(10), fontWeight: 700, fontFamily: FONT,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >?</button>
    </div>
  );
  const Ajuda = ({ id, children }) => ajuda === id ? (
    <div style={{
      fontSize: fz(9.5), color: palette.inkSoft, lineHeight: 1.4,
      padding: '6px 8px', borderRadius: 6, background: palette.bg,
      border: `1px dashed ${palette.beige}`,
    }}>{children}</div>
  ) : null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
      {/* STORIES */}
      <div style={{ ...cardBase, borderColor: '#f4d6e5' }}>
        <Header id="stories" titulo="📸 Stories" sub="Link pro Stories do Instagram"
          icone={
            <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
              <Instagram size={sz(22)} color="#a8388d" strokeWidth={1.6} style={{ position: 'absolute', top: 3, left: 3 }} />
              <Circle size={sz(10)} color="#a8388d" fill="#a8388d" style={{ position: 'absolute', top: 0, right: 0 }} />
            </div>
          } />
        <Ajuda id="stories">Leads que chegam pelo link no Stories do Instagram. <b>Recebidas</b> = conversas iniciadas no período. <b>Vendas</b> = lead que comprou (casado por telefone) em até 15 dias. <b>conv.</b> = vendas ÷ recebidas.</Ajuda>
        <Metricas o={origens?.stories} cor="#a8388d" />
        <div style={{
          fontSize: fz(10), color: palette.inkSoft, padding: 6, borderRadius: 4,
          background: palette.bg, fontFamily: 'monospace', wordBreak: 'break-all',
        }}>{URL_INSTA_STORIES}</div>
        <button onClick={() => copiar(URL_INSTA_STORIES, 'stories')} style={{
          padding: '6px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: copiado === 'stories' ? palette.ok : '#a8388d', color: '#fff',
          fontSize: fz(11), fontWeight: 700, fontFamily: FONT,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        }}>
          {copiado === 'stories' ? <><Check size={sz(12)} /> Copiado!</> : <><Copy size={sz(12)} /> Copiar link</>}
        </button>
      </div>
      {/* LINKTREE */}
      <div style={{ ...cardBase, borderColor: '#cde9d8' }}>
        <Header id="linktree" titulo="🔗 Linktree" sub="Link pro Linktree da bio"
          icone={
            <div style={{ position: 'relative', width: 28, height: 28, flexShrink: 0 }}>
              <Instagram size={sz(22)} color="#1f7a48" strokeWidth={1.6} style={{ position: 'absolute', top: 3, left: 3 }} />
              <Link2 size={sz(11)} color="#1f7a48" style={{ position: 'absolute', top: 0, right: 0, background: palette.surface, borderRadius: 2 }} />
            </div>
          } />
        <Ajuda id="linktree">Leads que chegam pelo link do Linktree na bio do Instagram. <b>Recebidas</b> = conversas iniciadas no período. <b>Vendas</b> = lead que comprou (casado por telefone) em até 15 dias. <b>conv.</b> = vendas ÷ recebidas.</Ajuda>
        <Metricas o={origens?.linktree} cor="#1f7a48" />
        <div style={{
          fontSize: fz(10), color: palette.inkSoft, padding: 6, borderRadius: 4,
          background: palette.bg, fontFamily: 'monospace', wordBreak: 'break-all',
        }}>{URL_INSTA_LINKTREE}</div>
        <button onClick={() => copiar(URL_INSTA_LINKTREE, 'linktree')} style={{
          padding: '6px 10px', borderRadius: 6, border: 'none', cursor: 'pointer',
          background: copiado === 'linktree' ? palette.ok : '#1f7a48', color: '#fff',
          fontSize: fz(11), fontWeight: 700, fontFamily: FONT,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
        }}>
          {copiado === 'linktree' ? <><Check size={sz(12)} /> Copiado!</> : <><Copy size={sz(12)} /> Copiar link</>}
        </button>
      </div>
      {/* META ADS */}
      <div style={{ ...cardBase, borderColor: '#cfe0ee' }}>
        <Header id="meta_ads" titulo="📣 Meta Ads" sub="Anúncios Facebook/Instagram"
          icone={
            <div style={{ width: 28, height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Facebook size={sz(22)} color="#2c5fa8" strokeWidth={1.6} />
            </div>
          } />
        <Ajuda id="meta_ads">Leads que chegam pelos anúncios (clique-pra-WhatsApp). A origem vem do próprio anúncio — não tem link pra copiar. <b>Vendas</b> = lead que comprou (casado por telefone/documento) em até 15 dias.</Ajuda>
        <Metricas o={origens?.meta_ads} cor="#2c5fa8" />
      </div>
      {/* CARRINHO DO SITE — consolida os 4 modos (Sofia/Vendedora × Site/Loja).
          Ailson 30/05/2026: virou card igual os outros, com detalhe expansível. */}
      <div style={{ ...cardBase, borderColor: '#e3d9c8' }}>
        <Header id="carrinho" titulo="Carrinho do Site" sub="Carrinho abandonado no site"
          icone={
            <div style={{ width: 28, height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fz(18) }}>🛒</div>
          } />
        <Ajuda id="carrinho">Leads de carrinho abandonado no site Amícia. <b>Conversão</b> = venda atribuída ao lead: <b>site</b> em ≤5 dias, <b>loja</b> em ≤15 dias após a mensagem (Sofia ou vendedora). Abra "ver detalhe" pra separar por quem atendeu × canal.</Ajuda>
        <Metricas o={origens?.carrinho} cor="#9c7b3f" />
        <button onClick={() => setExpandido(e => !e)} style={{
          padding: '4px 6px', borderRadius: 6, border: `1px solid ${palette.beige}`,
          background: 'transparent', cursor: 'pointer', color: palette.inkSoft,
          fontSize: fz(10), fontWeight: 600, fontFamily: FONT,
        }}>
          {expandido ? '▴ ocultar detalhe' : '▾ ver detalhe (Sofia/Vendedora × Site/Loja)'}
        </button>
        {expandido && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[
              { l: '✨ Sofia → Site',      s: '≤5d',  k: kpis?.sofia_site,     c: palette.accent },
              { l: '✨ Sofia → Loja',      s: '≤15d', k: kpis?.sofia_loja,     c: palette.purple },
              { l: '👩‍💼 Vendedora → Site', s: '≤5d',  k: kpis?.vendedora_site, c: palette.ok },
              { l: '👩‍💼 Vendedora → Loja', s: '≤15d', k: kpis?.vendedora_loja, c: palette.warn },
            ].map((m, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                padding: '4px 6px', borderRadius: 4, background: palette.bg,
                borderLeft: `3px solid ${m.c}`,
              }}>
                <span style={{ fontSize: fz(10), color: palette.ink }}>
                  {m.l} <span style={{ color: palette.inkMuted }}>{m.s}</span>
                </span>
                <span style={{ fontSize: fz(10), whiteSpace: 'nowrap' }}>
                  <b style={{ color: palette.ink }}>{m.k?.qtd ?? 0}</b>
                  <span style={{ color: palette.ok, marginLeft: 6 }}>{fMoney(m.k?.valor)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConversaoTab({ refreshTick }) {
  // Period: default = últimos 30 dias
  const hoje = new Date();
  const hojeStr = hoje.toISOString().slice(0, 10);
  const default30dAtras = new Date(hoje.getTime() - 30 * 86400000)
    .toISOString().slice(0, 10);

  const [dataInicio, setDataInicio] = useState(default30dAtras);
  const [dataFim, setDataFim] = useState(hojeStr);
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  // Quick-select periods
  const setPeriodo = (dias) => {
    const fim = new Date();
    const ini = new Date(fim.getTime() - dias * 86400000);
    setDataInicio(ini.toISOString().slice(0, 10));
    setDataFim(fim.toISOString().slice(0, 10));
  };

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setErro(null);
    const params = new URLSearchParams({ data_inicio: dataInicio, data_fim: dataFim });
    fetch(`/api/lojas-whats-conversoes?${params.toString()}`)
      .then(r => r.json())
      .then(d => {
        if (cancelado) return;
        if (d.error) setErro(d.error);
        else setDados(d);
        setLoading(false);
      })
      .catch(e => {
        if (cancelado) return;
        setErro(e.message || 'Erro carregando');
        setLoading(false);
      });
    return () => { cancelado = true; };
  }, [dataInicio, dataFim, refreshTick]);

  const fmtMoney = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });

  return (
    <div style={{ padding: '12px 16px', fontFamily: FONT }}>
      {/* Filtros de período */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
        flexWrap: 'wrap', rowGap: 6,
      }}>
        <Calendar size={sz(14)} color={palette.inkSoft} />
        <input
          type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
          style={{
            border: `1px solid ${palette.beige}`, borderRadius: 6, padding: '4px 8px',
            fontSize: fz(12), fontFamily: FONT, color: palette.ink,
          }}
        />
        <span style={{ fontSize: fz(12), color: palette.inkMuted }}>até</span>
        <input
          type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
          style={{
            border: `1px solid ${palette.beige}`, borderRadius: 6, padding: '4px 8px',
            fontSize: fz(12), fontFamily: FONT, color: palette.ink,
          }}
        />
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {[
            { dias: 7,  label: '7d'  },
            { dias: 30, label: '30d' },
            { dias: 90, label: '90d' },
          ].map(p => (
            <button
              key={p.dias}
              onClick={() => setPeriodo(p.dias)}
              style={{
                background: 'transparent', border: `1px solid ${palette.beige}`,
                borderRadius: 6, padding: '3px 9px',
                fontSize: fz(11), fontFamily: FONT, fontWeight: 500,
                cursor: 'pointer', color: palette.inkSoft,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Origens Instagram — 2 cards com os links wa.me prontos pra colar.
          Ailson 28/05/2026: stories + linktree, rotina C da Sofia. */}
      <OrigensInstagramCards origens={dados?.origens} loading={loading} kpis={dados?.kpis} fmtMoney={fmtMoney} />

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: palette.inkMuted }}>
          <Loader2 size={sz(20)} style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ marginTop: 8, fontSize: fz(12) }}>Carregando...</div>
        </div>
      ) : erro ? (
        <div style={{
          padding: 16, background: palette.alertSoft, color: palette.alert,
          borderRadius: 8, fontSize: fz(13),
        }}>
          {erro}
        </div>
      ) : !dados ? null : (
        <>
          {/* Header com total */}
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 14,
            flexWrap: 'wrap', rowGap: 6,
          }}>
            <div>
              <div style={{ fontSize: fz(28), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>
                {dados.total}
              </div>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                conversões no período ({dados.periodo.dias}d)
              </div>
            </div>
            <div>
              <div style={{ fontSize: fz(20), fontWeight: 600, color: palette.ok, lineHeight: 1 }}>
                {fmtMoney(dados.valor_total)}
              </div>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2 }}>
                valor total
              </div>
            </div>
          </div>

          {/* Os 4 modos (Sofia/Vendedora × Site/Loja) agora vivem dentro do
              card "Carrinho do Site" (expansível). Ailson 30/05/2026. */}

          {/* Ranking por vendedora */}
          {dados.por_vendedora.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <SectionTitle>Por vendedora</SectionTitle>
              <div style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 8, overflow: 'hidden',
              }}>
                {dados.por_vendedora.map((v, i) => (
                  <div key={v.vendedora_id || i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderTop: i > 0 ? `1px solid ${palette.beige}` : 'none',
                  }}>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: fz(13), fontWeight: 600, color: palette.ink }}>
                        {v.vendedora_nome}
                      </span>
                      <span style={{ fontSize: fz(11), color: palette.inkMuted }}>
                        {v.site} site · {v.loja} loja
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ fontSize: fz(16), fontWeight: 700, color: palette.ink }}>
                        {v.qtd}
                      </span>
                      <span style={{ fontSize: fz(12), color: palette.ok, fontWeight: 600 }}>
                        {fmtMoney(v.valor)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Detalhe (top 50) */}
          {dados.detalhe.length > 0 && (
            <div>
              <SectionTitle>Últimas conversões</SectionTitle>
              <div style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 8, overflow: 'hidden',
              }}>
                {dados.detalhe.map((d, i) => (
                  <div key={d.id || i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', gap: 8,
                    borderTop: i > 0 ? `1px solid ${palette.beige}` : 'none',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: fz(12), color: palette.ink, fontWeight: 600,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {d.cliente_nome || '—'}
                      </div>
                      <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 1 }}>
                        {d.atendido_por === 'sofia' ? '🤖 Sofia' : `👩‍💼 ${d.vendedora_nome || '?'}`}
                        {' · '}
                        {d.canal_pedido === 'site' ? 'site' : 'loja'}
                        {' · '}
                        {d.dias_ate_compra}d
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: fz(12), fontWeight: 700, color: palette.ok }}>
                        {fmtMoney(d.valor_venda)}
                      </div>
                      <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 1 }}>
                        {d.data_venda}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dados.total === 0 && (
            <div style={{
              padding: 24, textAlign: 'center', color: palette.inkMuted,
              background: palette.surface, border: `1px dashed ${palette.beige}`,
              borderRadius: 8,
            }}>
              <TrendingUp size={sz(32)} style={{ opacity: 0.3 }} />
              <div style={{ marginTop: 8, fontSize: fz(13) }}>
                Sem conversões registradas no período
              </div>
              <div style={{ marginTop: 4, fontSize: fz(11) }}>
                Lead vira conversão quando recebe msg E compra dentro da janela
                (5d site / 15d loja). Vendas orgânicas não contam.
              </div>
            </div>
          )}

          {/* Bloco CAPI Meta Ads (Ailson 25/05/2026 - Sprint Attribution) */}
          <CapiMetaAdsBloco dataInicio={dataInicio} dataFim={dataFim} refreshTick={refreshTick} />
        </>
      )}
    </div>
  );
}

// ─── Bloco CAPI Meta Ads (Conversoes enviadas pra Meta) ────────────────────
function CapiMetaAdsBloco({ dataInicio, dataFim, refreshTick }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modalManualAberto, setModalManualAberto] = useState(false);
  const [tickLocal, setTickLocal] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    const params = new URLSearchParams({ data_inicio: dataInicio, data_fim: dataFim });
    fetch(`/api/lojas-whats-capi-stats?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (!cancelado) { setDados(d); setLoading(false); } })
      .catch(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [dataInicio, dataFim, refreshTick, tickLocal]);

  if (loading || !dados || dados.error) return null;
  const k = dados.kpis || {};
  const semConversoes = (k.total_eventos || 0) === 0;
  const qtdManual = k.manual_vendedora_externa?.qtd || 0;

  return (
    <div style={{ marginTop: 22, paddingTop: 16, borderTop: `2px solid ${palette.beige}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          fontFamily: 'Arial Black, sans-serif', fontWeight: 900,
          background: '#1877f2', color: '#fff',
          padding: '3px 8px', borderRadius: 6, fontSize: fz(11),
        }}>f Ads</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: fz(14), fontWeight: 700, color: palette.ink }}>
            Conversões enviadas pra Meta (CAPI)
          </div>
          <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 1 }}>
            Cada evento Purchase reportado fecha o loop de attribution Click-to-WhatsApp
          </div>
        </div>
        <button onClick={() => setModalManualAberto(true)} style={{
          padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
          background: '#1877f2', color: '#fff', border: '1px solid #1877f2',
          fontSize: fz(12), fontWeight: 600, fontFamily: FONT,
          whiteSpace: 'nowrap',
        }}>
          + Informar venda manual
        </button>
      </div>

      {semConversoes ? (
        <div style={{
          padding: 16, textAlign: 'center', color: palette.inkMuted,
          background: palette.surface, border: `1px dashed ${palette.beige}`,
          borderRadius: 8, fontSize: fz(12),
        }}>
          Nenhuma conversão CAPI enviada no período.<br/>
          Eventos disparam quando venda Miré cruza com conversa Sofia origem Anúncio/Carrinho<br/>
          <span style={{ fontSize: fz(11) }}>ou quando vendedora informa venda manualmente acima.</span>
        </div>
      ) : (
        <>
          {/* Linha de KPIs */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <KpiCapi label="Eventos enviados" valor={k.total_eventos} cor="#1877f2" />
            <KpiCapi label="Valor total" valor={`R$ ${Number(k.valor_total||0).toLocaleString('pt-BR', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`} cor={palette.ok} />
            <KpiCapi label="Com CTWA ID" valor={`${k.com_ctwa_clid}/${k.total_eventos}`}
              cor={k.com_ctwa_clid === k.total_eventos ? palette.ok : palette.warn}
              hint="ctwa_clid garante attribution exata na Meta" />
            <KpiCapi label="Match telefone" valor={k.match_telefone} cor={palette.inkSoft} />
            <KpiCapi label="Match CPF/CNPJ" valor={k.match_documento} cor={palette.inkSoft} />
            {qtdManual > 0 && (
              <KpiCapi label="Manual vendedora" valor={`${qtdManual} · R$ ${Number(k.manual_vendedora_externa?.valor||0).toLocaleString('pt-BR', {maximumFractionDigits:0})}`}
                cor="#8b5cf6"
                hint="Vendas informadas manualmente pelas vendedoras (sem conversa Sofia)" />
            )}
            {k.falhados > 0 && <KpiCapi label="Falhados" valor={k.falhados} cor={palette.alert} />}
          </div>

          {/* Atacado vs Varejo */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, fontSize: fz(12) }}>
            <div style={{ padding: '6px 12px', background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 6 }}>
              <strong>Atacado:</strong> {k.atacado?.qtd || 0} · R$ {Number(k.atacado?.valor||0).toLocaleString('pt-BR', {minimumFractionDigits:0, maximumFractionDigits:0})}
            </div>
            <div style={{ padding: '6px 12px', background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 6 }}>
              <strong>Varejo:</strong> {k.varejo?.qtd || 0} · R$ {Number(k.varejo?.valor||0).toLocaleString('pt-BR', {minimumFractionDigits:0, maximumFractionDigits:0})}
            </div>
            {dados.manual_por_vendedora?.length > 0 && dados.manual_por_vendedora.map(mv => (
              <div key={mv.vendedora_nome} style={{ padding: '6px 12px', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6 }}>
                <strong>✋ {mv.vendedora_nome}:</strong> {mv.qtd} · R$ {Number(mv.valor||0).toLocaleString('pt-BR', {maximumFractionDigits:0})}
              </div>
            ))}
          </div>

          {/* Lista últimas conversões */}
          {dados.ultimos?.length > 0 && (
            <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ padding: '6px 10px', borderBottom: `1px solid ${palette.beige}`, fontSize: fz(11), fontWeight: 700, color: palette.inkSoft, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Últimas conversões reportadas
              </div>
              {dados.ultimos.map((e, i) => {
                const isManual = e.origem_capi === 'manual_vendedora_externa';
                return (
                  <div key={i} style={{
                    padding: '6px 10px', display: 'flex', gap: 8, alignItems: 'center',
                    borderBottom: i < dados.ultimos.length - 1 ? `1px solid ${palette.beige}` : 'none',
                    fontSize: fz(11),
                    background: isManual ? '#faf5ff' : 'transparent',
                  }}>
                    <div style={{ flex: '1 1 0', minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: palette.ink }}>
                        {e.cliente_nome || 'Sem nome'}{' '}
                        <span style={{ fontWeight: 400, color: palette.inkMuted, fontSize: fz(10) }}>
                          · #{e.numero_pedido || '?'} · {e.venda_categoria}
                          {isManual && e.vendedora_nome && (
                            <span style={{ color: '#8b5cf6', fontWeight: 600 }}>
                              {' '}· [manual · {e.vendedora_nome}]
                            </span>
                          )}
                        </span>
                      </div>
                      <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 1 }}>
                        {new Date(e.enviado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        {!isManual && ` · match: ${e.tipo_match}`}
                        {e.ctwa_clid && ' · ctwa ✓'}
                        {e.origem_lead === 'anuncio_facebook' && ' · 📘 facebook ads'}
                        {e.origem_lead === 'anuncio_instagram' && ' · 📱 anúncio'}
                        {e.origem_lead === 'carrinho_site_amicialoja' && ' · 🛒 carrinho'}
                        {e.origem_lead === 'instagram_stories' && ' · 📸 stories'}
                        {e.origem_lead === 'instagram_linktree' && ' · 🔗 linktree'}
                        {e.origem_lead === 'sac' && ' · 🎧 SAC'}
                      </div>
                    </div>
                    <div style={{ fontSize: fz(12), fontWeight: 700, color: palette.ok, flexShrink: 0 }}>
                      R$ {Number(e.valor).toLocaleString('pt-BR', {minimumFractionDigits:0, maximumFractionDigits:0})}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {modalManualAberto && (
        <ModalVendaManualMeta
          onClose={() => setModalManualAberto(false)}
          onSucesso={() => {
            setModalManualAberto(false);
            setTickLocal(t => t + 1);
          }}
        />
      )}
    </div>
  );
}

// ─── Modal: vendedora informa venda manualmente pra disparar Purchase Meta ──
// Caso de uso: cliente comprou na loja vindo de anuncio Meta mas (a) nao passou
// por Sofia OU (b) o cron de match Mire x Sofia nao pegou. Vendedora preenche
// telefone + nome (opt) + CPF (opt) + valor + Nº pedido + categoria.
// Sem ctwa_clid (vendedora nao tem) — attribution depende do advanced matching
// (telefone hash) da Meta. Default vendedora_nome=Vanessa.
function ModalVendaManualMeta({ onClose, onSucesso }) {
  const [vendedoras, setVendedoras] = useState([]);
  const [vendedoraNome, setVendedoraNome] = useState('Vanessa');
  const [telefone, setTelefone] = useState('');
  const [nomeCliente, setNomeCliente] = useState('');
  const [documento, setDocumento] = useState('');
  const [valor, setValor] = useState('');
  const [numeroPedido, setNumeroPedido] = useState('');
  const [categoria, setCategoria] = useState('varejo');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('lojas_vendedoras')
        .select('nome, loja, ativa')
        .eq('ativa', true)
        .order('loja')
        .order('nome');
      setVendedoras(data || []);
    })();
  }, []);

  const valorNum = parseFloat(String(valor).replace(',', '.')) || 0;
  const telDigits = telefone.replace(/\D/g, '');
  const valido = vendedoraNome
    && telDigits.length >= 10
    && valorNum > 0
    && numeroPedido.trim().length > 0;

  const enviar = async () => {
    if (!valido) return;
    setEnviando(true);
    setErro(null);
    setOkMsg(null);
    try {
      const r = await fetch('/api/lojas-whats-meta-capi-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          manual: true,
          vendedora_nome: vendedoraNome,
          dados_manual: {
            telefone: telDigits,
            nome_cliente: nomeCliente.trim() || null,
            documento: documento.replace(/\D/g, '') || null,
            valor: valorNum,
            numero_pedido: numeroPedido.trim(),
            categoria,
          },
        }),
      });
      const r2 = await r.json();
      if (!r.ok || r2.error) {
        setErro(r2.error || 'Erro ao enviar.');
      } else if (r2.status === 'duplicado') {
        setOkMsg(`Já enviado anteriormente (event_id ${r2.event_id?.slice(0,8)}...).`);
        setTimeout(onSucesso, 1500);
      } else {
        setOkMsg(`✓ Purchase enviado pra Meta (R$ ${valorNum.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}).`);
        setTimeout(onSucesso, 1500);
      }
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: 8, borderRadius: 6, border: `1px solid ${palette.beige}`,
    fontFamily: FONT, fontSize: fz(13), color: palette.ink,
    background: palette.surface, boxSizing: 'border-box',
  };
  const labelStyle = { fontSize: fz(11), color: palette.inkSoft, fontWeight: 600, marginBottom: 3, display: 'block' };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.bg, borderRadius: 12, padding: 16,
        maxWidth: 460, width: '100%', fontFamily: FONT,
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        {/* Header compacto */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: fz(15), color: palette.ink, fontFamily: FONT, fontWeight: 700 }}>
            <span style={{
              fontFamily: 'Arial Black, sans-serif', fontWeight: 900,
              background: '#1877f2', color: '#fff',
              padding: '2px 6px', borderRadius: 4, fontSize: fz(10), marginRight: 6,
            }}>f Ads</span>
            Informar venda manual
          </h3>
          <button onClick={onClose} style={{
            border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
          }}>
            <X size={sz(20)} color={palette.inkMuted} />
          </button>
        </div>
        <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 12 }}>
          Reporta venda pro Meta CAPI quando cliente veio de anúncio mas o match automático não pegou.
        </div>

        {/* Vendedora (full width) */}
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Vendedora *</label>
          <select value={vendedoraNome} onChange={e => setVendedoraNome(e.target.value)} style={inputStyle}>
            {vendedoras.length === 0 && <option value="Vanessa">Vanessa</option>}
            {vendedoras.map(v => (
              <option key={`${v.loja}-${v.nome}`} value={v.nome}>{v.nome} ({v.loja})</option>
            ))}
          </select>
        </div>

        {/* Telefone + Valor side-by-side */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1.4 }}>
            <label style={labelStyle}>Telefone cliente *</label>
            <input
              value={telefone}
              onChange={e => setTelefone(e.target.value)}
              placeholder="11 99999-9999"
              inputMode="tel"
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Valor R$ *</label>
            <input
              value={valor}
              onChange={e => setValor(e.target.value)}
              placeholder="0,00"
              inputMode="decimal"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Nome + CPF side-by-side */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1.4 }}>
            <label style={labelStyle}>Nome cliente</label>
            <input
              value={nomeCliente}
              onChange={e => setNomeCliente(e.target.value)}
              placeholder="opcional"
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>CPF/CNPJ</label>
            <input
              value={documento}
              onChange={e => setDocumento(e.target.value)}
              placeholder="opcional"
              inputMode="numeric"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Pedido + Categoria side-by-side */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1.4 }}>
            <label style={labelStyle}>Nº pedido Miré *</label>
            <input
              value={numeroPedido}
              onChange={e => setNumeroPedido(e.target.value)}
              placeholder="ex: 12345"
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Categoria *</label>
            <select value={categoria} onChange={e => setCategoria(e.target.value)} style={inputStyle}>
              <option value="varejo">Varejo</option>
              <option value="atacado">Atacado</option>
            </select>
          </div>
        </div>

        {/* Aviso obrigatorios */}
        <div style={{
          fontSize: fz(10), color: palette.inkMuted, marginBottom: 10,
          padding: '6px 8px', background: palette.surface, borderRadius: 4,
          border: `1px dashed ${palette.beige}`,
        }}>
          Telefone + Nº pedido + Valor são obrigatórios. Nome e CPF ajudam o
          advanced matching da Meta — preencha se tiver.
        </div>

        {/* Mensagens */}
        {erro && (
          <div style={{
            fontSize: fz(12), color: '#fff', background: palette.alert,
            padding: '6px 10px', borderRadius: 6, marginBottom: 10,
          }}>
            {erro}
          </div>
        )}
        {okMsg && (
          <div style={{
            fontSize: fz(12), color: '#fff', background: palette.ok,
            padding: '6px 10px', borderRadius: 6, marginBottom: 10,
          }}>
            {okMsg}
          </div>
        )}

        {/* Botoes */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onClose} disabled={enviando} style={{
            flex: 1, padding: '9px 14px', borderRadius: 6, cursor: enviando ? 'wait' : 'pointer',
            background: palette.surface, color: palette.ink,
            border: `1px solid ${palette.beige}`, fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
          }}>
            Cancelar
          </button>
          <button onClick={enviar} disabled={!valido || enviando} style={{
            flex: 1.5, padding: '9px 14px', borderRadius: 6,
            cursor: (!valido || enviando) ? 'not-allowed' : 'pointer',
            background: (!valido || enviando) ? palette.inkMuted : '#1877f2',
            color: '#fff', border: 'none',
            fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
            opacity: (!valido || enviando) ? 0.6 : 1,
          }}>
            {enviando ? 'Enviando...' : 'Enviar pra Meta'}
          </button>
        </div>
      </div>
    </div>
  );
}

function KpiCapi({ label, valor, cor, hint }) {
  return (
    <div title={hint} style={{
      background: palette.surface, border: `1px solid ${palette.beige}`,
      borderLeft: `3px solid ${cor}`, borderRadius: 6, padding: '6px 10px',
      minWidth: 90,
    }}>
      <div style={{ fontSize: fz(15), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>{valor}</div>
      <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// Card KPI compacto pra aba Conversao
function KpiConvCard({ label, sub, qtd, valor, corBarra }) {
  return (
    <div style={{
      background: palette.surface, border: `1px solid ${palette.beige}`,
      borderRadius: 8, padding: '10px 12px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: corBarra,
      }} />
      <div style={{ fontSize: fz(11), color: palette.inkSoft, fontWeight: 600, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: fz(10), color: palette.inkMuted, marginBottom: 6 }}>
        {sub}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: fz(22), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>
          {qtd}
        </span>
        <span style={{ fontSize: fz(12), color: palette.ok, fontWeight: 600 }}>
          {valor}
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 7: APRENDIZADO IA (Ailson 26/05/2026 — coração da Sofia)
// ═══════════════════════════════════════════════════════════════════════════
//
// UI pra Ailson auditar o aprendizado da Sofia. Mostra:
//   - KPIs: eventos / padroes ativos / usar / evitar / resumos
//   - Último resumo (texto em prosa gerado pelo Claude)
//   - Top padrões (palavra/emoji/horario com sucessos × amostras)
//   - Botão "Gerar resumo agora" (manual trigger cron-resumir)
//
// Endpoints:
//   GET  /api/lojas-whats-aprendizado-listar?action=overview
//   GET  /api/lojas-whats-aprendizado-listar?action=resumos
//   POST /api/lojas-whats-aprendizado-listar action=resumir_agora
// ═══════════════════════════════════════════════════════════════════════════

function AprendizadoTab({ refreshTick }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [gerando, setGerando] = useState(false);
  const [filtroRecomendacao, setFiltroRecomendacao] = useState('todos');

  const carregar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch('/api/lojas-whats-aprendizado-listar?action=overview');
      const d = await r.json();
      if (d.error) setErro(d.error); else setOverview(d);
    } catch (e) {
      setErro(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, [refreshTick]);

  const gerarResumoAgora = async () => {
    setGerando(true);
    try {
      const r = await fetch('/api/lojas-whats-aprendizado-listar?action=resumir_agora');
      const d = await r.json();
      if (d.error) setErro(d.error);
      else if (d.skipped) setErro(d.razao || 'Sem dados novos suficientes ainda');
      else await carregar();
    } catch (e) { setErro(e.message); }
    setGerando(false);
  };

  if (loading) return <div style={{ padding: 20, textAlign: 'center' }}><Loader2 size={sz(24)} className="spin" /></div>;
  if (erro && !overview) return <div style={{ padding: 16, color: palette.alert }}>{erro}</div>;

  const k = overview?.kpis || {};
  const padroesFiltrados = (overview?.top_padroes || []).filter(p =>
    filtroRecomendacao === 'todos' || p.recomendacao === filtroRecomendacao
  );

  return (
    <div style={{ padding: '12px 14px', fontFamily: FONT }}>
      {/* KPIs */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 8, marginBottom: 14,
      }}>
        <KpiCard label="Eventos" valor={k.eventos_total} cor={palette.accent} />
        <KpiCard label="Padrões ativos" valor={k.padroes_ativos} cor={palette.ink} />
        <KpiCard label="✓ Usar" valor={k.padroes_usar} cor={palette.ok} />
        <KpiCard label="✗ Evitar" valor={k.padroes_evitar} cor={palette.alert} />
        <KpiCard label="Resumos" valor={k.resumos_total} cor={palette.purple || '#7b6fc6'} />
      </div>

      {/* Erro flutuante */}
      {erro && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 6,
          background: palette.alertSoft, color: palette.alert,
          fontSize: fz(12),
        }}>
          {erro}
        </div>
      )}

      {/* Último resumo */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <SectionTitle>📖 Resumo da Sofia</SectionTitle>
          <button onClick={gerarResumoAgora} disabled={gerando} style={{
            background: gerando ? palette.beige : palette.ink, color: palette.bg,
            border: 'none', borderRadius: 6, padding: '5px 11px',
            fontSize: fz(11), fontFamily: FONT, fontWeight: 600,
            cursor: gerando ? 'wait' : 'pointer',
          }}>
            {gerando ? 'Gerando...' : '🔄 Gerar agora'}
          </button>
        </div>
        {overview?.ultimo_resumo ? (
          <div style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 10, padding: 14,
          }}>
            <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 8 }}>
              Até {overview.ultimo_resumo.ate_data} ·
              {' '}{overview.ultimo_resumo.atendimentos_analisados} atendimentos ·
              {' '}{overview.ultimo_resumo.vendas_neste_periodo} vendas ·
              {' '}{Math.round((overview.ultimo_resumo.taxa_conversao_geral || 0) * 100)}% conversão
            </div>
            <div style={{
              fontSize: fz(13), color: palette.ink, lineHeight: 1.55,
              whiteSpace: 'pre-wrap', fontFamily: FONT,
            }}>
              {overview.ultimo_resumo.resumo_ia || '(vazio)'}
            </div>
          </div>
        ) : (
          <div style={{
            padding: 16, textAlign: 'center', color: palette.inkMuted,
            background: palette.surface, border: `1px dashed ${palette.beige}`,
            borderRadius: 10, fontSize: fz(12),
          }}>
            <Brain size={sz(28)} style={{ opacity: 0.3 }} />
            <div style={{ marginTop: 8 }}>
              Nenhum resumo gerado ainda. Sofia precisa de pelo menos 30 atendimentos
              em estado final pra gerar.
            </div>
          </div>
        )}
      </div>

      {/* Top padrões */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <SectionTitle>🎯 Padrões aprendidos</SectionTitle>
          <select
            value={filtroRecomendacao}
            onChange={e => setFiltroRecomendacao(e.target.value)}
            style={{
              border: `1px solid ${palette.beige}`, borderRadius: 6, padding: '3px 8px',
              fontSize: fz(11), fontFamily: FONT, color: palette.ink,
              background: palette.surface,
            }}
          >
            <option value="todos">Todos</option>
            <option value="usar">✓ Usar</option>
            <option value="evitar">✗ Evitar</option>
            <option value="experimentar">⚪ Experimentar</option>
            <option value="inconclusivo">? Inconclusivo</option>
          </select>
        </div>

        {padroesFiltrados.length === 0 ? (
          <div style={{
            padding: 16, textAlign: 'center', color: palette.inkMuted,
            background: palette.surface, border: `1px dashed ${palette.beige}`,
            borderRadius: 8, fontSize: fz(12),
          }}>
            Sem padrões pra mostrar (cron-aprender roda 02h BRT diário).
          </div>
        ) : (
          <div style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 8, overflow: 'hidden',
          }}>
            {padroesFiltrados.map((p, i) => (
              <PadraoRow key={i} p={p} primeira={i === 0} />
            ))}
          </div>
        )}
      </div>

      {/* Info do sistema */}
      <div style={{
        marginTop: 18, padding: 10, borderRadius: 8,
        background: '#f0f6fb', border: '1px solid #c8dae8',
        fontSize: fz(11), color: palette.inkSoft, lineHeight: 1.5,
      }}>
        <strong>Como Sofia aprende:</strong> Cron diário (02h BRT) extrai
        features das mensagens com Claude Haiku, atribui contribuição via decay
        (última msg pesa mais). Re-agrega padrões. Sofia consulta TOP padrões
        antes de gerar resposta (70% replica / 30% explora variações).
        Resumo semanal toda segunda 06h BRT se ≥30 atendimentos novos.
      </div>
    </div>
  );
}

function KpiCard({ label, valor, cor }) {
  return (
    <div style={{
      background: palette.surface, border: `1px solid ${palette.beige}`,
      borderRadius: 8, padding: '8px 10px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: cor,
      }} />
      <div style={{ fontSize: fz(10), color: palette.inkMuted, fontWeight: 600, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: fz(20), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>
        {valor != null ? valor : '—'}
      </div>
    </div>
  );
}

function PadraoRow({ p, primeira }) {
  const pct = Math.round((p.taxa_sucesso || 0) * 100);
  const recCor = {
    usar:          palette.ok,
    evitar:        palette.alert,
    experimentar: '#d4a017',
    inconclusivo:  palette.inkMuted,
  }[p.recomendacao] || palette.inkMuted;

  const recIcon = {
    usar:         '✓',
    evitar:       '✗',
    experimentar: '⚪',
    inconclusivo: '?',
  }[p.recomendacao] || '·';

  const tipoEmoji = {
    palavra:    '💬',
    emoji:      '😀',
    horario:    '🕒',
    tipo_msg:   '📋',
    combinacao: '🔗',
  }[p.tipo] || '·';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px',
      borderTop: primeira ? 'none' : `1px solid ${palette.beige}`,
    }}>
      <span style={{ fontSize: fz(14), opacity: 0.7 }}>{tipoEmoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: fz(13), fontWeight: 600, color: palette.ink,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          "{p.chave}"
          {p.contexto?.etapa && (
            <span style={{ fontSize: fz(10), color: palette.inkMuted, marginLeft: 6, fontWeight: 400 }}>
              em {p.contexto.etapa}
            </span>
          )}
        </div>
        <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 1 }}>
          {p.sucessos}/{p.amostras} amostras
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 60 }}>
        <div style={{ fontSize: fz(14), fontWeight: 700, color: recCor, lineHeight: 1 }}>
          {pct}%
        </div>
        <div style={{ fontSize: fz(10), color: recCor, fontWeight: 600, marginTop: 2 }}>
          {recIcon} {p.recomendacao}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL EDITAR LEAD (Ailson 26/05/2026)
// Mover etapa · Observações (Sofia + privada) · Anexar mídia · Prioridade
// ═══════════════════════════════════════════════════════════════════════════

// Modal "Confirmar pago" — aparece ao clicar na caixinha verde do card (etapa
// atendida). Coloca o valor, grava a venda, move pra Vendeu e (se for venda de
// anuncio Meta) dispara o Purchase pra Meta via CAPI. Ailson 26/06/2026.
function ModalConfirmarPago({ conversa, onClose, onSucesso, onErro }) {
  const [valor, setValor] = useState('');
  const [enviando, setEnviando] = useState(false);

  const ehMeta = ['anuncio_facebook', 'anuncio_instagram'].includes(conversa.origem_lead) || !!conversa.ctwa_clid;

  // Parse BR: "1.234,56"->1234.56 | "799,90"->799.9 | "1234"->1234
  const parseBR = (s) => {
    if (!s) return NaN;
    let t = String(s).replace(/[^\d.,]/g, '').trim();
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
    return Number(t);
  };

  const confirmar = async () => {
    const v = parseBR(valor);
    if (!Number.isFinite(v) || v <= 0) { onErro('Coloca o valor da venda (maior que zero).'); return; }
    setEnviando(true);
    try {
      const r = await fetch('/api/lojas-whats-confirmar-pago', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversa_id: conversa.id, valor: v }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { onErro(j.error || 'Erro ao confirmar.'); return; }
      let msg = `Venda de ${fmtMoney(v)} confirmada. Card movido pra Vendeu.`;
      const cs = j.capi?.status;
      if (cs === 'enviado') msg += ' Evento enviado pra Meta (CAPI).';
      else if (cs === 'duplicado') msg += ' (CAPI já tinha sido enviado.)';
      else if (cs === 'falhou') msg += ' ⚠️ CAPI não enviou (confere o log).';
      onSucesso(msg);
    } catch (e) {
      onErro(e.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.bg, borderRadius: 12, padding: 20,
        maxWidth: 380, width: '100%', fontFamily: FONT,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: fz(16), color: palette.ink, fontFamily: FONT, fontWeight: 700 }}>
            Confirmar pago
          </h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
            <X size={sz(22)} color={palette.inkMuted} />
          </button>
        </div>
        <div style={{ fontSize: fz(13), color: palette.inkSoft, marginBottom: 14 }}>
          Cliente: <strong>{conversa.nome_cliente || conversa.telefone}</strong>
        </div>
        <label style={{ fontSize: fz(12), color: palette.inkSoft, fontWeight: 600, display: 'block', marginBottom: 6 }}>
          Valor da venda
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: ehMeta ? 10 : 16 }}>
          <span style={{ fontSize: fz(15), color: palette.inkMuted, fontWeight: 700 }}>R$</span>
          <input
            autoFocus inputMode="decimal" value={valor}
            onChange={e => setValor(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !enviando) confirmar(); }}
            placeholder="0,00"
            style={{
              flex: 1, padding: '9px 10px', borderRadius: 6, border: `1px solid ${palette.beige}`,
              fontFamily: FONT, fontSize: fz(15), color: palette.ink, background: palette.surface,
            }}
          />
        </div>
        {ehMeta && (
          <div style={{
            fontSize: fz(11.5), color: '#1f7a48', background: '#e6f7ee',
            border: '1px solid #b7e4c7', borderRadius: 6, padding: '7px 9px',
            marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Facebook size={fz(13)} fill="#1f7a48" color="#1f7a48" strokeWidth={0} />
            Venda de anúncio — vai enviar o evento pra Meta (CAPI) pra campanha aprender.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} disabled={enviando} style={{
            flex: 1, padding: '10px', borderRadius: 6, cursor: 'pointer',
            border: `1px solid ${palette.beige}`, background: palette.surface,
            color: palette.ink, fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
          }}>Cancelar</button>
          <button onClick={confirmar} disabled={enviando} style={{
            flex: 2, padding: '10px', borderRadius: 6, cursor: enviando ? 'default' : 'pointer',
            border: 'none', background: enviando ? '#9cc1ab' : '#1f7a48',
            color: '#fff', fontSize: fz(13), fontWeight: 700, fontFamily: FONT,
          }}>{enviando ? 'Confirmando...' : '✓ Confirmar pago → Vendeu'}</button>
        </div>
      </div>
    </div>
  );
}

export function EditarLeadModal({ conversa, onClose, onSucesso, onErro, onEnviarVendedora }) {
  const [etapa, setEtapa] = useState(conversa.etapa);
  const [obsSofia, setObsSofia] = useState(conversa.observacao_para_sofia || '');
  const [obsPrivada, setObsPrivada] = useState(conversa.observacao_assistente || '');
  const [prioritario, setPrioritario] = useState(
    !!conversa.lead_prioritario || (Number(conversa.prioridade) > 0)
  );
  const [salvando, setSalvando] = useState(false);
  const [anexarAberto, setAnexarAberto] = useState(false);

  const salvar = async () => {
    setSalvando(true);
    try {
      // So envia 'etapa' se ela REALMENTE mudou. Importante pra follow_up:
      // se a conversa ja esta em follow_up (com agendamento), reenviar
      // etapa='follow_up' sem follow_up_dias faria o backend zerar o
      // follow_up_vence_em. Mandar etapa so na transicao evita isso. O
      // ajuste de dias do follow-up e feito no card. Ailson 01/06/2026.
      const campos = {
        observacao_para_sofia: obsSofia.trim() || null,
        observacao_assistente: obsPrivada.trim() || null,
        prioridade: prioritario ? 1 : 0,
      };
      if (etapa !== conversa.etapa) campos.etapa = etapa;
      const r = await fetch('/api/lojas-whats-conversa-editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversa_id: conversa.id,
          campos,
          usuario: (() => {
            try { return JSON.parse(localStorage.getItem('amica_session') || '{}')?.usuario || null; }
            catch { return null; }
          })(),
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { onErro(j.error || 'Erro ao salvar'); return; }
      onSucesso('Lead atualizado');
    } catch (e) { onErro(e.message); }
    setSalvando(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20, overflow: 'auto',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.bg, borderRadius: 12, padding: 18,
        maxWidth: 480, width: '100%', fontFamily: FONT, maxHeight: '90vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: fz(16), color: palette.ink, fontWeight: 700 }}>
              Editar lead
            </h3>
            <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 2 }}>
              {conversa.nome_cliente || fmtPhone(conversa.telefone)}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
            <X size={sz(22)} color={palette.inkMuted} />
          </button>
        </div>

        {/* Prioridade */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 10px', borderRadius: 6, marginBottom: 10,
          background: prioritario ? '#fffbf0' : palette.surface,
          border: `1px solid ${prioritario ? '#f5c84e' : palette.beige}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Star size={sz(18)} fill={prioritario ? '#f5c84e' : 'none'}
              color={prioritario ? '#d4a017' : palette.inkMuted} />
            <span style={{ fontSize: fz(13), color: palette.ink }}>
              Lead prioritário (sobe pro topo)
            </span>
          </div>
          <button onClick={() => setPrioritario(p => !p)} style={{
            background: prioritario ? '#d4a017' : palette.beige,
            color: prioritario ? '#fff' : palette.ink,
            border: 'none', borderRadius: 4, padding: '4px 10px',
            fontSize: fz(11), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
          }}>
            {prioritario ? 'Remover' : 'Marcar'}
          </button>
        </div>

        {/* Mover etapa */}
        <label style={{ fontSize: fz(11), color: palette.inkSoft, fontWeight: 600 }}>
          Etapa do funil
        </label>
        <select value={etapa} onChange={e => setEtapa(e.target.value)} style={{
          width: '100%', padding: '7px 10px', borderRadius: 6,
          border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: fz(13),
          marginBottom: 12, marginTop: 4, color: palette.ink, background: palette.surface,
          boxSizing: 'border-box',
        }}>
          {ETAPAS.map(et => (
            <option key={et.id} value={et.id}>{et.label}</option>
          ))}
        </select>

        {/* Enviar pra vendedora — atalho aqui pra etapas em aberto (Ailson 28/05/2026).
            Fecha o modal de editar e abre o de escolher vendedora. Some quando
            a conversa ja terminou (atendida/vendeu/perdida) ou ja foi quente
            (banner do quente cobre esse caso na lista). */}
        {onEnviarVendedora && !['quente', 'atendida', 'vendeu', 'perdida'].includes(conversa.etapa) && (
          <button onClick={() => { onClose(); onEnviarVendedora(conversa); }} style={{
            width: '100%', padding: '9px 12px', borderRadius: 6,
            background: '#f5a623', color: '#fff', border: 'none',
            fontSize: fz(13), fontFamily: FONT, fontWeight: 700, cursor: 'pointer',
            marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Users size={sz(15)} /> Enviar pra vendedora
          </button>
        )}

        {/* Anexar mídia */}
        <div style={{
          marginBottom: 12, padding: 10, background: palette.surface,
          border: `1px dashed ${palette.beige}`, borderRadius: 6,
        }}>
          <button onClick={() => setAnexarAberto(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: palette.accent, fontSize: fz(12), fontWeight: 600, fontFamily: FONT,
          }}>
            <Paperclip size={sz(14)} /> Anexar mídia à próxima mensagem
          </button>
          <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 4 }}>
            Escolha foto/vídeo/catálogo que já está em "Mídias Sofia"
          </div>
        </div>

        {/* Observação pra Sofia */}
        <label style={{ fontSize: fz(11), color: palette.inkSoft, fontWeight: 600 }}>
          📝 Observação pra Sofia <span style={{ fontWeight: 400, color: palette.inkMuted }}>(entra no prompt — persistente até limpar)</span>
        </label>
        <textarea value={obsSofia} onChange={e => setObsSofia(e.target.value)}
          placeholder="Ex: Cliente PJ atacado, prefere PAC, já mencionou que quer macacão floral"
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6,
            border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: fz(12),
            marginBottom: 12, marginTop: 4, color: palette.ink, background: palette.surface,
            boxSizing: 'border-box', resize: 'vertical', minHeight: 60,
          }}
        />

        {/* Observação privada */}
        <label style={{ fontSize: fz(11), color: palette.inkSoft, fontWeight: 600 }}>
          🔒 Anotação privada <span style={{ fontWeight: 400, color: palette.inkMuted }}>(só pra assistente — NÃO entra no prompt)</span>
        </label>
        <textarea value={obsPrivada} onChange={e => setObsPrivada(e.target.value)}
          placeholder="Ex: Cliente da Tamara, não atender entre 12-13h"
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6,
            border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: fz(12),
            marginBottom: 14, marginTop: 4, color: palette.ink, background: palette.surface,
            boxSizing: 'border-box', resize: 'vertical', minHeight: 50,
          }}
        />

        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onClose} disabled={salvando} style={{
            flex: 1, padding: '9px', borderRadius: 6,
            background: palette.surface, color: palette.ink,
            border: `1px solid ${palette.beige}`, fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
            cursor: salvando ? 'wait' : 'pointer',
          }}>Cancelar</button>
          <button onClick={salvar} disabled={salvando} style={{
            flex: 1, padding: '9px', borderRadius: 6,
            background: palette.ink, color: palette.bg, border: 'none',
            fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
            cursor: salvando ? 'wait' : 'pointer',
          }}>{salvando ? 'Salvando...' : 'Salvar'}</button>
        </div>

        {/* Modal anexar mídia */}
        {anexarAberto && (
          <AnexarMidiaModal
            conversa={conversa}
            onClose={() => setAnexarAberto(false)}
            onSucesso={(msg) => { setAnexarAberto(false); onSucesso(msg); }}
            onErro={onErro}
          />
        )}
      </div>
    </div>
  );
}

function AnexarMidiaModal({ conversa, onClose, onSucesso, onErro }) {
  const [midias, setMidias] = useState([]);
  const [filtro, setFiltro] = useState('todos');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const url = filtro !== 'todos' ? `/api/lojas-whats-midia?tipo=${filtro}` : '/api/lojas-whats-midia';
      try {
        const r = await fetch(url);
        const j = await r.json();
        setMidias(j.midias || []);
      } catch (e) { onErro(e.message); }
      setLoading(false);
    })();
  }, [filtro]);

  const anexar = async (m) => {
    // Anota na obs_para_sofia que essa midia deve ir na proxima msg.
    // Marcador interpretado pelo backend depois.
    const marcador = `[ANEXAR_${m.tipo.toUpperCase()}:${m.id}]`;
    const obsAtual = conversa.observacao_para_sofia || '';
    const novaObs = obsAtual.includes(marcador)
      ? obsAtual
      : (obsAtual ? `${obsAtual}\n${marcador}` : marcador);
    const { error } = await supabase.from('lojas_whats_conversas')
      .update({ observacao_para_sofia: novaObs, atualizado_em: new Date().toISOString() })
      .eq('id', conversa.id);
    if (error) onErro(error.message);
    else onSucesso(`Mídia anexada: ${m.nome_arquivo}`);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1100, padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.bg, borderRadius: 12, padding: 16,
        maxWidth: 500, width: '100%', fontFamily: FONT, maxHeight: '85vh', overflow: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: fz(15), color: palette.ink, fontWeight: 700 }}>
            Anexar mídia
          </h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={sz(20)} color={palette.inkMuted} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
          {['todos', 'foto', 'video', 'catalogo'].map(t => (
            <button key={t} onClick={() => setFiltro(t)} style={{
              padding: '4px 8px', borderRadius: 12, cursor: 'pointer',
              border: `1px solid ${filtro === t ? palette.ink : palette.beige}`,
              background: filtro === t ? palette.ink : palette.surface,
              color: filtro === t ? palette.bg : palette.ink,
              fontSize: fz(11), fontWeight: 500, fontFamily: FONT, textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 20 }}><Loader2 size={20} className="spin" /></div>
        ) : midias.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: palette.inkMuted, fontSize: fz(12) }}>
            Nenhuma mídia disponível. Suba via aba Mídias Sofia.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(110px,1fr))' }}>
            {midias.map(m => (
              <button key={m.id} onClick={() => anexar(m)} style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 6, padding: 0, cursor: 'pointer', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', textAlign: 'left',
              }}>
                <div style={{
                  height: 70, background: '#f0f0f0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {m.tipo === 'foto' && m.url_publica ? (
                    <img src={m.url_publica} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ color: palette.inkMuted, textAlign: 'center' }}>
                      {m.tipo === 'video' && <Video size={24} />}
                      {m.tipo === 'catalogo' && <FileText size={24} />}
                      <div style={{ fontSize: 9, textTransform: 'uppercase' }}>{m.tipo}</div>
                    </div>
                  )}
                </div>
                <div style={{ padding: 4 }}>
                  <div style={{
                    fontSize: 10, color: palette.ink, fontWeight: 600,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {m.ref ? `REF ${m.ref}` : m.nome_arquivo.slice(0, 16)}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 8: MÍDIAS SOFIA (Ailson 26/05/2026)
// ═══════════════════════════════════════════════════════════════════════════
// Gerenciamento de fotos/videos/catalogos que a Sofia usa nas conversas.
// Storage: bucket 'sofia-midias' (separado do bucket 'produtos' da Ficha Tecnica).
// ESCOPO: SOMENTE modulo Sofia/Lojas — NUNCA confundir os 2 buckets.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSA DETAIL — tela cheia tipo WhatsApp (Ailson 26/05/2026)
// ═══════════════════════════════════════════════════════════════════════════

export function ConversaDetail({ conversaId, onBack, onEditarLead, onEnviarVendedora, idsNaAba, onNavegar, userId, splitLeft = 0 }) {
  const [conversa, setConversa] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  // Ailson 29/05/2026: mapa nome_template -> botao URL, pra renderizar no app
  // o mesmo botao que o WhatsApp mostra pra cliente (so visual, nao afeta envio).
  const [tplBotoes, setTplBotoes] = useState({});
  const [sugestoesPendentes, setSugestoesPendentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [novoTexto, setNovoTexto] = useState('');
  const [midiasAnexadas, setMidiasAnexadas] = useState([]);  // [{id,tipo,nome_arquivo,url_publica} (biblioteca) | {_local:true,file,previewUrl,nome_arquivo} (dispositivo)]
  const fileLocalRef = useRef(null);
  const [seletorMidiaAberto, setSeletorMidiaAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);
  // Modal de indicação manual de refs (quando a Sofia erra/nao acha o modelo).
  // Ailson 28/06/2026.
  const [indicarAberto, setIndicarAberto] = useState(false);
  const [indicarLinhas, setIndicarLinhas] = useState([]); // [{ url, ref }]
  const [indicarFila, setIndicarFila] = useState([]);     // fotos além das 5 na tela (Ailson 04/07/2026)
  const [indicarAviso, setIndicarAviso] = useState(null); // "enviadas, vindo as próximas"
  const [indicarEnviando, setIndicarEnviando] = useState(false);
  // Realtime atualiza a thread em background — spinner so quando troca de
  // conversa, nao a cada msg/sugestao nova. Ailson 30/05/2026.
  const convCarregadaRef = useRef(null);
  const [editandoMsgId, setEditandoMsgId] = useState(null);  // edit msg ja enviada (anota erro)
  // Botao "robô vazado": dispara IA na hora (Ailson 27/05/2026)
  const [iaDisparando, setIaDisparando] = useState(false);
  const [emojiPickerAberto, setEmojiPickerAberto] = useState(false);
  // Mobile (Ailson 06/06): ao focar, o textarea expande e os icones de suporte
  // descem pra linha de baixo; ao enviar/desfocar volta ao normal. Desktop intacto.
  const isDesktop = useIsDesktop();
  const textareaRef = useRef(null);
  const inputBarRef = useRef(null);
  // Mobile: campo de mensagem cresce conforme o texto e volta sozinho ao limpar,
  // SEM depender de foco/blur (no iOS o blur nao dispara ao tocar numa area vazia,
  // por isso o campo ficava grande e nao recolhia). Ailson 07/06/2026.
  const ajustarAlturaMsg = () => {
    const el = textareaRef.current;
    if (!el || isDesktop) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };
  // Mobile/iOS: quando o teclado fecha por QUALQUER caminho (botao do
  // teclado, swipe, blur), o visualViewport volta ao tamanho cheio mas a
  // janela fica deslocada (header fora da tela). Reancora no topo.
  // Ailson 11/06/2026.
  useEffect(() => {
    if (isDesktop) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onVvResize = () => {
      // teclado fechou: viewport visivel ~= altura total da janela
      if (vv.height >= window.innerHeight - 60) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    };
    vv.addEventListener('resize', onVvResize);
    return () => vv.removeEventListener('resize', onVvResize);
  }, [isDesktop]);
  const fimChatRef = useRef(null);

  // ─── Trava de presença (Ailson 30/05/2026) ──────────────────────────────
  // So 1 pessoa edita/responde a mesma conversa por vez. Quem abre "segura"
  // (editando_por + heartbeat editando_em). Os demais veem "sendo respondido
  // por X" e ficam so-leitura. Lock obsoleto (>45s sem heartbeat) eh tomado.
  const [lockPor, setLockPor] = useState(null);  // userId de quem segura, ou null
  const [souDono, setSouDono] = useState(false);
  const bloqueado = !!lockPor && lockPor !== userId;

  // Carrega conversa + mensagens
  useEffect(() => {
    if (!conversaId) return;
    (async () => {
      if (convCarregadaRef.current !== conversaId) setLoading(true);  // spinner so ao trocar de conversa
      const [{ data: conv }, { data: msgs }, { data: sugs }] = await Promise.all([
        supabase.from('lojas_whats_conversas')
          .select('id, telefone, nome_cliente, tipo_documento, documento, carrinho_id, etapa, valor_carrinho, qtd_pecas, score_quente, observacao_para_sofia, observacao_assistente, lead_prioritario, cliente_indicou_site, gatilhos_detectados, ultima_atividade_em, iniciada_em, sugestao_quente_pendente_em, sugestao_quente_motivo, sugestao_quente_gatilhos')
          .eq('id', conversaId).maybeSingle(),
        supabase.from('lojas_whats_mensagens')
          .select('id, direcao, autor, tipo_midia, texto, audio_transcricao, midia_url, meta_message_id, status, enviada_em, template_name')
          .eq('conversa_id', conversaId)
          .order('enviada_em', { ascending: true })
          .limit(200),
        // Sugestoes pendentes da Sofia (Ailson 25/05/2026 fix bug)
        // Antes: tela de conversa so mostrava mensagens. Sugestoes pendentes
        // ficavam invisiveis aqui (so apareciam na aba Aprovar do funil).
        // Caso real: Amanda Goncalves + Gleide Maria em etapa='aprovar' com
        // sugestao pendente -> tela mostrava "Sem mensagens ainda".
        supabase.from('lojas_whats_sugestoes')
          .select('id, tipo, texto_proposto, motivo_proposta, criada_em, status, contexto_ia')
          .eq('conversa_id', conversaId)
          .eq('status', 'pendente')
          .order('criada_em', { ascending: true }),
      ]);
      setConversa(conv);
      // Atualiza SO quando a thread realmente mudou — assim o polling rapido
      // (3s, chat ao vivo) nao re-renderiza nem joga o scroll pro fim a cada
      // ciclo. Retornar prev (mesma referencia) faz o React nao re-renderizar.
      // Ailson 31/05/2026.
      const novasMsgs = msgs || [];
      setMensagens(prev => {
        const ult = prev[prev.length - 1], novoUlt = novasMsgs[novasMsgs.length - 1];
        if (prev.length === novasMsgs.length && ult?.id === novoUlt?.id && ult?.status === novoUlt?.status) {
          return prev;
        }
        return novasMsgs;
      });
      const novasSugs = sugs || [];
      setSugestoesPendentes(prev => {
        if (prev.length === novasSugs.length
            && prev[0]?.id === novasSugs[0]?.id
            && prev[prev.length - 1]?.id === novasSugs[novasSugs.length - 1]?.id) {
          return prev;
        }
        return novasSugs;
      });
      // Mapa de botoes dos templates (so visual). Pega o 1o botao URL de cada.
      if (Object.keys(tplBotoes).length === 0) {
        const { data: tpls } = await supabase.from('lojas_whats_templates').select('name, botoes');
        if (tpls) {
          const mapa = {};
          for (const t of tpls) {
            const btn = Array.isArray(t.botoes) ? t.botoes.find(b => b?.type === 'URL' && b?.url) : null;
            if (btn) mapa[t.name] = { text: btn.text || 'VER NO SITE', url: btn.url };
          }
          setTplBotoes(mapa);
        }
      }
      setLoading(false);
      convCarregadaRef.current = conversaId;
    })();
  }, [conversaId, reloadTick]);

  // Realtime da conversa aberta: msg nova ou sugestao nova/alterada aparece na
  // hora. Reconecta no foco/visibilidade + fallback polling (Ailson 31/05/2026).
  useRealtimeSofia(
    `sofia-conversa-${conversaId}`,
    (c, aoMudar) => c
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lojas_whats_mensagens', filter: `conversa_id=eq.${conversaId}` }, aoMudar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lojas_whats_sugestoes', filter: `conversa_id=eq.${conversaId}` }, aoMudar),
    () => setReloadTick(t => t + 1),
    { ativo: !!conversaId, pollMs: 3000 },
  );

  // ─── Lock: claim atomico + heartbeat + release ──────────────────────────
  const tentarLock = useCallback(async () => {
    if (!conversaId || !userId) return;
    const agoraIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - 45000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    try {
      // Claim: pega o lock se estiver livre, ja for meu, ou estiver obsoleto.
      const { data: claimed } = await supabase
        .from('lojas_whats_conversas')
        .update({ editando_por: userId, editando_em: agoraIso })
        .eq('id', conversaId)
        .or(`editando_por.is.null,editando_por.eq."${userId}",editando_em.lt.${staleIso}`)
        .select('editando_por');
      if (claimed && claimed.length) {
        setLockPor(userId); setSouDono(true);
      } else {
        const { data: atual } = await supabase
          .from('lojas_whats_conversas')
          .select('editando_por').eq('id', conversaId).maybeSingle();
        setLockPor(atual?.editando_por || null); setSouDono(false);
      }
    } catch {}
  }, [conversaId, userId]);

  const liberarLock = useCallback(() => {
    if (!conversaId || !userId) return;
    try {
      supabase.from('lojas_whats_conversas')
        .update({ editando_por: null, editando_em: null })
        .eq('id', conversaId).eq('editando_por', userId)
        .then(() => {}, () => {});
    } catch {}
  }, [conversaId, userId]);

  useEffect(() => {
    if (!conversaId) return;
    tentarLock();
    const hb = setInterval(tentarLock, 20000);
    const onHide = () => liberarLock();
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(hb);
      window.removeEventListener('pagehide', onHide);
      liberarLock();
    };
  }, [conversaId, userId, tentarLock, liberarLock]);

  // Auto-scroll pra ultima msg
  useEffect(() => {
    if (fimChatRef.current) {
      fimChatRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [mensagens]);

  const enviar = async () => {
    if (bloqueado) return;
    const textoMsg = novoTexto.trim();
    const itens = midiasAnexadas;
    if (!textoMsg && itens.length === 0) return;
    setEnviando(true);
    setErro(null);
    const usuario = (() => {
      try { return JSON.parse(localStorage.getItem('amica_session') || '{}')?.usuario || null; }
      catch { return null; }
    })();
    try {
      if (itens.length === 0) {
        const r = await fetch('/api/lojas-whats-mensagem-enviar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversa_id: conversaId, texto: textoMsg || null, midia_id: null, autor: 'assistente', usuario }),
        });
        const j = await r.json();
        if (!r.ok || j.error) { setErro(j.error || 'Erro ao enviar'); setEnviando(false); return; }
      } else {
        // 1+ midias: a 1a leva o texto digitado, as demais so a midia (1 por msg)
        for (let i = 0; i < itens.length; i++) {
          const it = itens[i];
          const txt = i === 0 ? (textoMsg || null) : null;
          if (it._local) {
            const ok = await enviarFotoLocal(it.file, txt, usuario);
            if (!ok) { setEnviando(false); return; }
          } else {
            const r = await fetch('/api/lojas-whats-mensagem-enviar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ conversa_id: conversaId, texto: txt, midia_id: it.id, autor: 'assistente', usuario }),
            });
            const j = await r.json();
            if (!r.ok || j.error) { setErro(j.error || 'Erro ao enviar mídia'); setEnviando(false); return; }
          }
        }
      }
      setNovoTexto('');
      setMidiasAnexadas([]);
      setReloadTick(t => t + 1);
      // Mobile: ao enviar, recolhe o campo e fecha o teclado pra voltar ao normal
      // (Ailson 06/06 — evita a tela ficar "expandida" depois do envio).
      if (!isDesktop && textareaRef.current) { textareaRef.current.style.height = ''; }
    } catch (e) { setErro(e.message); }
    setEnviando(false);
  };

  // Upload local "so enviar" (NAO guarda na biblioteca). Ailson 04/06/2026:
  // presign -> PUT direto no storage -> endpoint sobe pra Meta e registra a msg,
  // sem criar item reutilizavel em lojas_whats_midias.
  const enviarFotoLocal = async (file, texto, usuario) => {
    try {
      const presignRes = await fetch('/api/lojas-whats-midia-presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'foto', nome_arquivo: file.name, size_bytes: file.size, mime_type: file.type }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok || presign.error) { setErro(presign.error || 'Falha no upload'); return false; }
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type, 'Authorization': `Bearer ${presign.token}`, 'x-upsert': 'false' },
        body: file,
      });
      if (!putRes.ok) { setErro('Upload falhou: ' + putRes.status); return false; }
      const r = await fetch('/api/lojas-whats-midia-enviar-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversa_id: conversaId, storage_path: presign.storage_path,
          mime_type: file.type, nome_arquivo: file.name, texto: texto || null,
          autor: 'assistente', usuario,
        }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { setErro(j.error || 'Erro ao enviar foto'); return false; }
      return true;
    } catch (e) { setErro(e.message); return false; }
  };

  // Desmarcar/reativar o relogio de follow-up do catalogo (6h/24h). Ailson 29/05/2026.
  const toggleCatalogoFollowup = async () => {
    if (!conversa) return;
    try {
      await fetch('/api/lojas-whats-conversa-editar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversa_id: conversaId,
          campos: { catalogo_followup_pausado: !conversa.catalogo_followup_pausado },
        }),
      });
      setReloadTick(t => t + 1);
    } catch (e) { /* silencioso — proxima carga reflete */ }
  };

  // Abre o modal pré-carregando as fotos que a CLIENTE mandou, em ordem
  // cronológica: as 5 primeiras na tela, o resto numa FILA. Ao enviar as 5,
  // o modal traz as próximas até acabar (Ailson 04/07/2026: tem cliente que
  // manda 10+ fotos e antes o modal só via as últimas 5).
  const abrirIndicar = () => {
    // Leituras de print das sugestoes pendentes (vision+match do backend):
    // candidata FORTE ja preenche a ref da linha (Tamara so confere pela
    // miniatura); candidatas fracas viram chips clicaveis. Assim quando a
    // Sofia acerta 3 de 5, corrige-se SO as 2 erradas em vez de redigitar
    // tudo. Ailson 04/07/2026.
    const porUrl = new Map();
    for (const s of sugestoesPendentes || []) {
      for (const le of s.contexto_ia?.print_leituras || []) {
        if (le?.url) porUrl.set(le.url, le);
      }
    }
    const todas = (mensagens || [])
      .filter(m => m.direcao === 'entrada' && m.tipo_midia === 'image' && m.midia_url)
      .map(m => {
        const le = porUrl.get(m.midia_url);
        const cands = (le?.candidatas || []).map(c => c.ref);
        return {
          url: m.midia_url,
          ref: (le?.forte && cands[0]) ? cands[0] : '',
          candidatas: cands.slice(0, 3),
          sugerida: !!(le?.forte && cands[0]),
        };
      });
    const naTela = todas.slice(0, 5);
    setIndicarLinhas(naTela.length ? naTela : [{ url: null, ref: '' }]);
    setIndicarFila(todas.slice(5));
    setIndicarAviso(null);
    setPickerIdx(null); setPickerQ(''); setPickerRes([]);
    setIndicarAberto(true);
  };

  // Picker visual: busca por nome/categoria/ref/preco com miniaturas, inline
  // no modal — sem sair da tela nem decorar ref. Ailson 04/07/2026.
  const [pickerIdx, setPickerIdx] = useState(null);
  const [pickerQ, setPickerQ] = useState('');
  const [pickerRes, setPickerRes] = useState([]);
  const [pickerBuscando, setPickerBuscando] = useState(false);
  useEffect(() => {
    if (pickerIdx === null) return;
    const q = pickerQ.trim();
    if (q.length < 2) { setPickerRes([]); return; }
    let vivo = true;
    setPickerBuscando(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/lojas-whats-refs-buscar?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        if (vivo) setPickerRes(j.itens || []);
      } catch { if (vivo) setPickerRes([]); }
      if (vivo) setPickerBuscando(false);
    }, 400);
    return () => { vivo = false; clearTimeout(t); };
  }, [pickerQ, pickerIdx]);

  const enviarIndicacao = async () => {
    const refs = indicarLinhas.map(l => (l.ref || '').trim()).filter(Boolean);
    if (!refs.length) { setErro('Digite ao menos uma referência'); return; }
    setIndicarEnviando(true);
    try {
      const r = await fetch('/api/lojas-whats-refs-indicar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversa_id: conversaId, refs }),
      });
      const j = await r.json();
      if (!r.ok || j.error) { setErro(j.error || 'Erro ao indicar refs'); setIndicarEnviando(false); return; }
      setIndicarEnviando(false);
      setReloadTick(t => t + 1);
      // Ainda tem foto na fila? Traz as próximas 5 e mantém o modal aberto.
      if (indicarFila.length) {
        const proximas = indicarFila.slice(0, 5);
        setIndicarLinhas(proximas);
        setIndicarFila(indicarFila.slice(5));
        setIndicarAviso(`✓ ${refs.length} enviada(s)! Agora as próximas ${proximas.length} fotos.`);
      } else {
        setIndicarAberto(false);
      }
    } catch (e) { setErro(e.message); setIndicarEnviando(false); }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Loader2 size={sz(24)} className="spin" />
      </div>
    );
  }
  if (!conversa) {
    return <div style={{ padding: 20, color: palette.alert }}>Conversa não encontrada</div>;
  }

  const etapaInfo = ETAPAS.find(e => e.id === conversa.etapa);

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, left: splitLeft,
      background: palette.beige, zIndex: 100,
      display: 'flex', flexDirection: 'column', fontFamily: FONT_CHAT,
    }}>
      {indicarAberto && (
        <div onClick={() => !indicarEnviando && setIndicarAberto(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: palette.surface, borderRadius: 12, maxWidth: 440, width: '100%',
              maxHeight: '85vh', overflowY: 'auto', padding: 18, fontFamily: FONT_CHAT,
              boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: fz(15), fontWeight: 700, color: palette.ink, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Hash size={sz(16)} /> Indicar referências
              </div>
              <button onClick={() => !indicarEnviando && setIndicarAberto(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: palette.inkMuted, display: 'flex' }}>
                <X size={sz(18)} />
              </button>
            </div>
            <div style={{ fontSize: fz(12), color: palette.inkMuted, marginBottom: 14, lineHeight: 1.4 }}>
              Digite a ref de cada foto que a cliente mandou. A Sofia manda uma mensagem por ref com a foto de cores e os tamanhos disponíveis. Sem foto de cores, manda só o texto.
              {indicarFila.length > 0 && (
                <div style={{ marginTop: 6, fontWeight: 700, color: palette.accent }}>
                  +{indicarFila.length} foto(s) na fila: ao enviar essas, as próximas aparecem aqui.
                </div>
              )}
            </div>
            {indicarAviso && (
              <div style={{ padding: '7px 10px', marginBottom: 10, borderRadius: 6, background: '#e7f5ec', color: '#2e7d32', fontSize: fz(12), fontWeight: 600 }}>
                {indicarAviso}
              </div>
            )}
            {indicarLinhas.map((l, i) => (
              <div key={i} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: i < indicarLinhas.length - 1 ? '1px dashed #efe9e0' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  {l.url
                    ? <img src={l.url} alt="" style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 8, flexShrink: 0, border: '1px solid #e8e2da' }} />
                    : <div style={{ width: 54, height: 54, borderRadius: 8, background: palette.beige, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Image size={sz(18)} color={palette.inkMuted} /></div>}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input value={l.ref}
                        onChange={e => setIndicarLinhas(prev => prev.map((x, j) => j === i ? { ...x, ref: e.target.value, sugerida: false } : x))}
                        placeholder="Ref (ex: 3213)" inputMode="numeric"
                        style={{ flex: 1, minWidth: 0, padding: '9px 11px', borderRadius: 8, border: l.sugerida ? '1.5px solid #4caf7d' : '1px solid #e8e2da', fontSize: fz(14), fontFamily: FONT_CHAT, color: palette.ink, background: palette.bg }} />
                      <button title="Buscar por nome, categoria ou preço"
                        onClick={() => { setPickerIdx(pickerIdx === i ? null : i); setPickerQ(''); setPickerRes([]); }}
                        style={{ background: pickerIdx === i ? palette.accent : '#f0ece5', border: 'none', borderRadius: 8, padding: 9, cursor: 'pointer', display: 'flex', flexShrink: 0 }}>
                        <Search size={sz(15)} color={pickerIdx === i ? '#fff' : palette.inkMuted} />
                      </button>
                      {indicarLinhas.length > 1 && (
                        <button onClick={() => {
                          // Repõe da fila pra manter 5 na tela (foto pulada sai de vez)
                          setPickerIdx(null);
                          setIndicarLinhas(prev => {
                            const nova = prev.filter((_, j) => j !== i);
                            if (indicarFila.length) {
                              nova.push(indicarFila[0]);
                              setIndicarFila(f => f.slice(1));
                            }
                            return nova;
                          });
                        }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: palette.alert, display: 'flex', flexShrink: 0, padding: 4 }}>
                          <Trash2 size={sz(16)} />
                        </button>
                      )}
                    </div>
                    {l.sugerida && l.ref && (
                      <div style={{ fontSize: fz(10), color: '#2e7d32', fontWeight: 600, marginTop: 3 }}>
                        ✦ sugerida pela Sofia (leitura do print) — confira pela miniatura
                      </div>
                    )}
                    <RefThumbAoVivo refDigitada={l.ref} palette={palette} fz={fz} sz={sz} />
                    {!l.ref && (l.candidatas || []).length > 0 && (
                      <RefsChips refs={l.candidatas} palette={palette} fz={fz} sz={sz}
                        titulo="Pode ser uma dessas (toca pra escolher):"
                        onPick={(ref) => setIndicarLinhas(prev => prev.map((x, j) => j === i ? { ...x, ref } : x))} />
                    )}
                  </div>
                </div>
                {pickerIdx === i && (
                  <div style={{ marginTop: 8, marginLeft: 64, background: '#faf7f2', border: '1px solid #e8e2da', borderRadius: 10, padding: 10 }}>
                    <input autoFocus value={pickerQ} onChange={e => setPickerQ(e.target.value)}
                      placeholder="Nome, categoria ou preço (ex: conjunto, 169)"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #e8e2da', fontSize: fz(13), fontFamily: FONT_CHAT, color: palette.ink, background: '#fff' }} />
                    <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto' }}>
                      {pickerBuscando && <div style={{ fontSize: fz(11), color: palette.inkMuted, padding: 6 }}>buscando…</div>}
                      {!pickerBuscando && pickerQ.trim().length >= 2 && !pickerRes.length && (
                        <div style={{ fontSize: fz(11), color: palette.inkMuted, padding: 6 }}>nada encontrado — tenta outro nome ou o preço da etiqueta</div>
                      )}
                      {pickerRes.map(it => (
                        <div key={it.ref}
                          onClick={() => {
                            setIndicarLinhas(prev => prev.map((x, j) => j === i ? { ...x, ref: it.ref, sugerida: false } : x));
                            setPickerIdx(null); setPickerQ(''); setPickerRes([]);
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 4px', borderRadius: 8, cursor: 'pointer' }}
                          onMouseEnter={e => { e.currentTarget.style.background = '#f0ece5'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
                          {it.foto_url
                            ? <img src={it.foto_url} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />
                            : <div style={{ width: 46, height: 46, borderRadius: 8, background: '#f0ece5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Image size={sz(16)} color="#a89f92" /></div>}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: fz(12), fontWeight: 700, color: palette.ink }}>REF {it.ref}{(it.preco_tabela || it.preco_medio) ? <span style={{ fontWeight: 500, color: palette.inkMuted }}> · R${Math.round(it.preco_tabela || it.preco_medio)}</span> : null}</div>
                            <div style={{ fontSize: fz(10.5), color: palette.inkMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.nome || it.categoria || '—'}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {indicarLinhas.length < 5 && (
              <button onClick={() => setIndicarLinhas(prev => [...prev, { url: null, ref: '' }])}
                style={{ background: 'none', border: '1px dashed #cfc6ba', color: palette.inkMuted, borderRadius: 8,
                  padding: '7px 10px', cursor: 'pointer', fontSize: fz(12), fontFamily: FONT_CHAT, marginBottom: 12 }}>
                + adicionar ref
              </button>
            )}
            <button onClick={enviarIndicacao} disabled={indicarEnviando}
              style={{ width: '100%', marginTop: 6, background: palette.accent, color: '#fff', border: 'none',
                borderRadius: 8, padding: 11, cursor: indicarEnviando ? 'default' : 'pointer', fontSize: fz(14),
                fontWeight: 600, fontFamily: FONT_CHAT, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 8, opacity: indicarEnviando ? 0.7 : 1 }}>
              {indicarEnviando ? <Loader2 size={sz(16)} className="spin" /> : <Send size={sz(15)} />}
              {indicarEnviando ? 'Enviando...' : 'Enviar pra cliente'}
            </button>
          </div>
        </div>
      )}
      {/* Wrapper centralizado: chat com max-width pra nao ficar com balöes
          nos extremos em telas largas. Fundo bege da tela cheia fica visivel
          nas laterais. Ailson 27/05/2026 */}
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        maxWidth: 960, width: '100%', margin: '0 auto',
        background: palette.bg, minHeight: 0,
        boxShadow: '0 0 24px rgba(0,0,0,0.06)',
      }}>
      {/* HEADER */}
      <div style={{
        background: palette.ink, color: palette.bg, padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
          color: palette.bg, padding: '6px 9px', borderRadius: 6, cursor: 'pointer',
          display: 'flex', alignItems: 'center',
        }}>
          <ChevronRight size={sz(16)} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: fz(15), fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 6 }}>
            {conversa.carrinho_id && (
              <ShoppingCart size={sz(14)} style={{ opacity: 0.8, flexShrink: 0 }}
                titleAccess="Origem: carrinho abandonado" />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {conversa.nome_cliente || fmtPhone(conversa.telefone)}
            </span>
          </div>
          <div style={{ fontSize: fz(11), opacity: 0.8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span>{fmtPhone(conversa.telefone)}</span>
            {conversa.documento && (
              <span>· {conversa.tipo_documento}: {fmtDocumento(conversa.documento)}</span>
            )}
            {conversa.qtd_pecas > 0 && <span>· {conversa.qtd_pecas} pç</span>}
            {Number(conversa.valor_carrinho) > 0 && <span>· {fmtMoney(conversa.valor_carrinho)}</span>}
            <span>·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <EtapaIcon nome={conversa.etapa} size={11} /> {etapaInfo?.label || conversa.etapa}
            </span>
          </div>
        </div>
        {/* Estrela de prioridade direto no chat — sem precisar voltar pra lista.
            Escondida na etapa perdida (perdida nunca prioriza). Ailson 25/06/2026. */}
        {conversa.etapa !== 'perdida' && (
          <button
            onClick={async () => {
              const novo = !conversa.lead_prioritario;
              setConversa(prev => prev ? { ...prev, lead_prioritario: novo } : prev);
              try {
                await fetch('/api/lojas-whats-conversa-editar', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ conversa_id: conversa.id, campos: { prioridade: novo ? 1 : 0 } }),
                });
              } catch {
                setConversa(prev => prev ? { ...prev, lead_prioritario: !novo } : prev);
              }
            }}
            title={conversa.lead_prioritario ? 'Remover prioridade' : 'Marcar como prioridade'}
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
              color: palette.bg, padding: '6px 9px', borderRadius: 6, cursor: 'pointer',
              display: 'flex', alignItems: 'center',
            }}>
            <Star size={sz(15)} fill={conversa.lead_prioritario ? '#f5c84e' : 'none'}
              color={conversa.lead_prioritario ? '#f5c84e' : palette.bg} />
          </button>
        )}
        <button onClick={abrirIndicar} title="Indicar referências (até 5)"
          style={{
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
            color: palette.bg, padding: '6px 9px', borderRadius: 6, cursor: 'pointer',
            display: 'flex', alignItems: 'center',
          }}>
          <Hash size={sz(14)} />
        </button>
        <button onClick={() => onEditarLead && onEditarLead(conversa)} title="Editar lead"
          style={{
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
            color: palette.bg, padding: '6px 9px', borderRadius: 6, cursor: 'pointer',
          }}>
          <Edit3 size={sz(14)} />
        </button>
        {/* Enviar pra vendedora direto do chat — assistente nao precisa
            voltar pra lista. Ailson 27/05/2026.
            Esconde se ja foi enviada (quente/atendida) — evita reenvio. */}
        {onEnviarVendedora && !['quente', 'atendida', 'vendeu', 'perdida'].includes(conversa.etapa) && (
          <button onClick={() => onEnviarVendedora(conversa)} title="Enviar pra vendedora"
            style={{
              background: '#f59e0b', border: '1px solid #d97706',
              color: '#fff', padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: FONT_CHAT, fontSize: fz(12), fontWeight: 600, whiteSpace: 'nowrap',
            }}>
            <Users size={sz(14)} />
            Vendedora
          </button>
        )}
        {/* Quando ja foi enviada, mostra status passivo (sem clique) */}
        {['quente', 'atendida'].includes(conversa.etapa) && (
          <div style={{
            background: '#ecfdf5', border: '1px solid #86efac',
            color: '#166534', padding: '6px 12px', borderRadius: 6,
            display: 'flex', alignItems: 'center', gap: 6,
            fontFamily: FONT_CHAT, fontSize: fz(11), fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            <Users size={sz(13)} />
            {conversa.etapa === 'atendida' ? 'Vendedora atendendo' : 'Enviado pra vendedora'}
          </div>
        )}
      </div>

      {/* Relógio de follow-up do catálogo (6h/24h). Aparece quando o catálogo
          foi enviado e o cliente não respondeu. Vendedora pode desmarcar
          (não envia auto) ou manter. Espelha a janela 9-20h → senão 9h do dia
          seguinte. Ailson 29/05/2026. */}
      {conversa.catalogo_enviado_em && !['vendeu', 'perdida'].includes(conversa.etapa) && (() => {
        const fase24 = !!conversa.catalogo_followup_6h_em;
        // FASE 1 pendente: 19:30 do mesmo dia (catálogo < 18h BRT) ou 9h do dia
        // seguinte (>= 18h). FASE 2: HSM 24h após o catálogo. Ailson 08/06/2026.
        let alvo; let adiado = false;
        if (fase24) {
          alvo = new Date(new Date(conversa.catalogo_enviado_em).getTime() + 24 * 3600 * 1000);
        } else {
          const recvBRT = new Date(new Date(conversa.catalogo_enviado_em).getTime() - 3 * 3600 * 1000);
          const y = recvBRT.getUTCFullYear(), m = recvBRT.getUTCMonth(), d = recvBRT.getUTCDate(), h = recvBRT.getUTCHours();
          if (h < 18) {
            alvo = new Date(Date.UTC(y, m, d, 22, 30, 0));      // 19:30 BRT
          } else {
            alvo = new Date(Date.UTC(y, m, d + 1, 12, 0, 0));    // 9h BRT dia seguinte
            adiado = true;
          }
        }
        const quando = alvo.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const pausado = conversa.catalogo_followup_pausado;
        return (
          <div style={{
            padding: '7px 12px',
            background: pausado ? '#f3f4f6' : '#eef6ff',
            borderBottom: `1px solid ${pausado ? '#d1d5db' : '#bfdbfe'}`,
            fontSize: fz(11), color: pausado ? '#6b7280' : '#1e40af',
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: fz(13) }}>{pausado ? '🔕' : '⏰'}</span>
              {pausado
                ? <span>Follow-up do catálogo <b>desmarcado</b> — não vai sair automático</span>
                : <span>Follow-up {fase24 ? <b>final 24h</b> : 'do catálogo'} automático ~ <b>{quando}</b>{adiado && !fase24 ? ' (recebido após 18h → vai às 9h)' : ''}</span>}
            </span>
            <button onClick={toggleCatalogoFollowup} style={{
              marginLeft: 'auto',
              background: pausado ? '#2c7a4f' : 'transparent',
              color: pausado ? '#fff' : '#1e40af',
              border: `1px solid ${pausado ? '#2c7a4f' : '#bfdbfe'}`,
              padding: '3px 10px', borderRadius: 6, cursor: 'pointer',
              fontSize: fz(11), fontWeight: 600, whiteSpace: 'nowrap',
            }}>
              {pausado ? '🔔 Reativar' : '🔕 Desmarcar'}
            </button>
          </div>
        );
      })()}

      {/* Observação pra Sofia banner */}
      {conversa.observacao_para_sofia && (
        <div style={{
          padding: '8px 12px', background: '#fff8e0', borderBottom: '1px solid #f0d97a',
          fontSize: fz(11), color: '#5a4500',
        }}>
          <strong>📝 Dica pra Sofia:</strong> {conversa.observacao_para_sofia}
        </div>
      )}
      {conversa.observacao_assistente && (
        <div style={{
          padding: '8px 12px', background: '#f0f0f0', borderBottom: '1px solid #d0d0d0',
          fontSize: fz(11), color: '#444',
        }}>
          <strong>🔒 privado:</strong> {conversa.observacao_assistente}
        </div>
      )}

      {/* Sugestao Sofia pendente — banner com Promover/Manter NO CHAT (Ailson
          28/05/2026). Antes esses botoes so existiam no ConversaRow (lista
          mobile). No split view desktop a sugestao era invisivel aqui: nao
          tinha como decidir sem voltar pra lista. */}
      {conversa.sugestao_quente_pendente_em && (
        <div style={{
          padding: 10, borderBottom: `1px solid #f5c84e`,
          background: '#fff8e7',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: fz(12), color: '#8a5500', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <img src="/robo-ia.png" alt="Sofia" style={{ width: 20, height: 20, flexShrink: 0 }} />
            <span><strong>Sofia sugere promover pra quente.</strong>{conversa.sugestao_quente_motivo && <span style={{ color: '#6a4500' }}> {conversa.sugestao_quente_motivo}</span>}</span>
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={async () => {
                if (!confirm('Promover esta conversa pra quente e disparar handoff pra vendedora?')) return;
                const r = await fetch('/api/lojas-whats-sugestao-quente-decidir', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ conversa_id: conversa.id, decisao: 'aceitar', decidida_por: 'tamara' }),
                });
                const d = await r.json();
                if (!r.ok) { alert('Erro: ' + (d.error || r.status)); return; }
                setConversa(prev => prev ? {
                  ...prev,
                  sugestao_quente_pendente_em: null,
                  sugestao_quente_motivo: null,
                  sugestao_quente_gatilhos: null,
                  etapa: 'quente',
                } : prev);
              }}
              style={{
                padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                background: '#d97706', color: '#fff', border: 'none',
                fontSize: fz(12), fontFamily: FONT, fontWeight: 700,
              }}>🔥 Promover</button>
            <button
              onClick={async () => {
                const r = await fetch('/api/lojas-whats-sugestao-quente-decidir', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ conversa_id: conversa.id, decisao: 'recusar', decidida_por: 'tamara' }),
                });
                const d = await r.json();
                if (!r.ok) { alert('Erro: ' + (d.error || r.status)); return; }
                setConversa(prev => prev ? {
                  ...prev,
                  sugestao_quente_pendente_em: null,
                  sugestao_quente_motivo: null,
                  sugestao_quente_gatilhos: null,
                } : prev);
              }}
              style={{
                padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                background: palette.surface, color: palette.inkSoft,
                border: `1px solid ${palette.beige}`,
                fontSize: fz(12), fontFamily: FONT, fontWeight: 600,
              }}>❌ Manter</button>
          </div>
        </div>
      )}

      {/* CHAT BUBBLES */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: 12,
        // Fundo bege com padrao de icones (Ailson 27/05/2026)
        backgroundColor: '#f3ead5',
        backgroundImage: `url('${ICONS_BASE}/chat-bg.png')`,
        backgroundRepeat: 'repeat',
        backgroundSize: '500px auto',
      }}>
        {mensagens.length === 0 && sugestoesPendentes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: palette.inkMuted, fontSize: fz(12) }}>
            Sem mensagens ainda. Envie a primeira abaixo.
          </div>
        ) : (
          <>
            {mensagens.map(m => <Bubble key={m.id} m={m} botao={m.tipo_midia === 'template' ? tplBotoes[m.template_name] : null} />)}
            {/* Sugestoes pendentes da Sofia (Ailson 25/05/2026 fix) */}
            {sugestoesPendentes.map(sug => (
              <SugestaoPendenteBubble
                key={sug.id}
                sug={sug}
                onAprovou={() => setReloadTick(t => t + 1)}
                userId={userId}
                bloqueado={bloqueado}
                palette={palette}
                fz={fz}
                sz={sz}
                FONT={FONT}
              />
            ))}
          </>
        )}
        <div ref={fimChatRef} />
      </div>

      {/* Mídias anexadas preview (1 ou várias) */}
      {midiasAnexadas.length > 0 && (
        <div style={{
          padding: '8px 12px', background: '#e8f0ff',
          borderTop: '1px solid #c8dae8',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          {midiasAnexadas.map((m, i) => (
            <div key={m._local ? `loc${i}` : m.id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: palette.bg, border: '1px solid #c8dae8',
              borderRadius: 14, padding: '3px 8px', maxWidth: 200,
            }}>
              {m._local
                ? <Image size={sz(13)} color={palette.accent} />
                : <Paperclip size={sz(13)} color={palette.accent} />}
              <span style={{ fontSize: fz(11), color: palette.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m._local ? `foto: ${m.nome_arquivo}` : `${m.tipo}: ${m.nome_arquivo}`}
              </span>
              <button onClick={() => setMidiasAnexadas(prev => prev.filter((_, j) => j !== i))} style={{
                background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex',
              }}>
                <X size={sz(13)} color={palette.inkMuted} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div style={{
          padding: '6px 12px', background: palette.alertSoft,
          color: palette.alert, fontSize: fz(11),
          borderTop: `1px solid ${palette.alert}`,
        }}>
          {erro}
        </div>
      )}

      {/* Trava de presença — outro usuário está respondendo (Ailson 30/05/2026) */}
      {bloqueado && (
        <div style={{
          padding: '8px 12px', background: '#fff4e5', color: '#9c5b00',
          fontSize: fz(11.5), fontWeight: 600, borderTop: '1px solid #f0c98a',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          🔒 Sendo respondido por <b>{lockPor}</b> — somente leitura até essa pessoa sair do chat
        </div>
      )}

      {/* INPUT BAR */}
      <div ref={inputBarRef} style={{
        padding: 10, background: palette.surface,
        borderTop: `1px solid ${palette.beige}`,
        display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0,
        // Layout estável: a caixa cresce pelo conteúdo (auto-grow), sem
        // reorganizar a barra ao focar (o reflow no foco abortava o toque no
        // iOS e fazia a caixa encolher ao digitar). Ailson 15/06/2026.
        flexWrap: 'nowrap',
        opacity: bloqueado ? 0.55 : 1, pointerEvents: bloqueado ? 'none' : 'auto',
      }}>
        {/* Botao emoji picker — à esquerda junto dos demais (Ailson 28/05/2026) */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setEmojiPickerAberto(v => !v)}
            title="Inserir emoji"
            style={{
              background: palette.bg, border: `1px solid ${palette.beige}`,
              borderRadius: '50%', width: 36, height: 36, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}>😊</button>
          {emojiPickerAberto && (
            <div onClick={() => setEmojiPickerAberto(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
          )}
          {emojiPickerAberto && (
            <div style={{
              position: 'absolute', bottom: 44, left: 0, zIndex: 50,
              background: '#fff', border: `1px solid ${palette.beige}`,
              borderRadius: 8, padding: 8, boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
              display: 'grid', gridTemplateColumns: 'repeat(6, 32px)', gap: 4,
              width: 220,
            }}>
              {EMOJIS_PICKER.map(e => (
                <button key={e} onClick={() => {
                  const ta = textareaRef.current;
                  if (!ta) { setNovoTexto(p => p + e); return; }
                  const s = ta.selectionStart ?? novoTexto.length;
                  const en = ta.selectionEnd ?? novoTexto.length;
                  const novo = novoTexto.slice(0, s) + e + novoTexto.slice(en);
                  setNovoTexto(novo);
                  setTimeout(() => {
                    if (textareaRef.current) {
                      textareaRef.current.focus();
                      const pos = s + e.length;
                      textareaRef.current.setSelectionRange(pos, pos);
                    }
                  }, 0);
                }}
                  style={{
                    width: 32, height: 32, border: 'none', background: 'transparent',
                    cursor: 'pointer', fontSize: 18, borderRadius: 4,
                  }}
                  onMouseEnter={(ev) => ev.target.style.background = palette.beige}
                  onMouseLeave={(ev) => ev.target.style.background = 'transparent'}
                >{e}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setSeletorMidiaAberto(true)} title="Anexar da biblioteca"
          style={{
            background: palette.bg, border: `1px solid ${palette.beige}`,
            borderRadius: '50%', width: 36, height: 36, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
          <Paperclip size={sz(16)} color={palette.inkMuted} />
        </button>
        {/* Foto do dispositivo (celular/desktop) — Ailson 04/06/2026.
            So envia, nao guarda na biblioteca. Aceita varias de uma vez. */}
        <input
          ref={fileLocalRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length === 0) return;
            setMidiasAnexadas(prev => {
              const espaco = Math.max(0, 10 - prev.length);
              const novos = files.slice(0, espaco).map(f => ({ _local: true, file: f, nome_arquivo: f.name }));
              return [...prev, ...novos];
            });
            e.target.value = '';
          }}
        />
        <button onClick={() => fileLocalRef.current?.click()} title="Enviar foto do dispositivo"
          style={{
            background: palette.bg, border: `1px solid ${palette.beige}`,
            borderRadius: '50%', width: 36, height: 36, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
          <Image size={sz(16)} color={palette.inkMuted} />
        </button>
        {/* Vesti: insere o link do catalogo virtual no campo (vc revisa e envia).
            Ailson 04/06/2026. */}
        <button onClick={() => {
          const link = 'https://v.vesti.mobi/amicia';
          const ta = textareaRef.current;
          if (!ta) { setNovoTexto(p => (p ? p + ' ' : '') + link); return; }
          const s = ta.selectionStart ?? novoTexto.length;
          const en = ta.selectionEnd ?? novoTexto.length;
          const novo = novoTexto.slice(0, s) + link + novoTexto.slice(en);
          setNovoTexto(novo);
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus();
              const pos = s + link.length;
              textareaRef.current.setSelectionRange(pos, pos);
            }
          }, 0);
        }} title="Inserir link do catálogo Vesti"
          style={{
            background: palette.bg, border: `1px solid ${palette.beige}`,
            borderRadius: '50%', width: 36, height: 36, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
          <Link2 size={sz(16)} color={palette.accent} />
        </button>
        {/* Robô vazado: pede pra Sofia gerar sugestao AGORA sem esperar
            o ritmo automatico. Dentro janela 24h → msg livre. Fora →
            Sofia escolhe template e cria sugestao pendente (Tamara aprova
            no fluxo normal). Ailson 27/05/2026 */}
        <button
          onClick={async () => {
            if (iaDisparando) return;
            setIaDisparando(true);
            try {
              const r = await fetch('/api/lojas-whats-ia-disparar-manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversa_id: conversaId }),
              });
              const d = await r.json();
              if (!r.ok) { alert('Erro: ' + (d.error || r.status)); return; }
              if (d.modo === 'livre') {
                if (d.gerou === false) {
                  const motivos = {
                    sem_mensagem_cliente_pra_responder: 'a última mensagem não é do cliente — não há o que responder ainda.',
                    conversa_ja_fechada: 'essa conversa já está fechada.',
                  };
                  alert('Sofia não gerou: ' + (motivos[d.motivo] || d.motivo || 'motivo desconhecido'));
                }
                setReloadTick(t => t + 1);  // recarrega sugestoes pendentes
              } else if (d.modo === 'sugestao_criada') {
                alert(`Sofia gerou sugestão (${d.template}) — abra a aba Aprovar`);
                setReloadTick(t => t + 1);
              }
            } catch (e) {
              alert('Erro: ' + e.message);
            } finally {
              setIaDisparando(false);
            }
          }}
          disabled={iaDisparando}
          title="Pedir pra Sofia gerar mensagem agora"
          style={{
            background: palette.bg, border: `1px solid ${palette.beige}`,
            borderRadius: '50%', width: 36, height: 36,
            cursor: iaDisparando ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, opacity: iaDisparando ? 0.5 : 1,
          }}>
          <Bot size={sz(16)} strokeWidth={1.4} color={palette.accent} />
        </button>
        <textarea
          ref={textareaRef}
          value={novoTexto}
          onChange={e => { setNovoTexto(e.target.value); ajustarAlturaMsg(); }}
          onBlur={() => {
            if (isDesktop) return;
            // iOS: ao fechar o teclado a janela fica deslocada (header sai da
            // tela). Reancora no topo. Ailson 11/06/2026.
            setTimeout(() => {
              window.scrollTo(0, 0);
              document.documentElement.scrollTop = 0;
              document.body.scrollTop = 0;
            }, 80);
          }}
          placeholder="Mensagem (Enter quebra linha · clica no botao verde pra enviar)"
          rows={1}
          style={{
            flex: 1,
            padding: '8px 12px', borderRadius: 18,
            border: `1px solid ${palette.beige}`, fontFamily: FONT_CHAT,
            // iOS faz zoom automatico em input com fonte <16px e o zoom NAO
            // desfaz no blur (header sumia, tinha que pincar pra voltar).
            // Mobile = 16px sempre. Ailson 11/06/2026.
            fontSize: isDesktop ? fz(13) : fz(16),
            color: palette.ink, background: palette.bg,
            resize: 'none', minHeight: isDesktop ? 36 : 42,
            maxHeight: isDesktop ? 120 : 140, lineHeight: 1.4,
            boxSizing: 'border-box', overflowY: 'auto',
          }}
        />
        <button onClick={enviar} disabled={enviando || (!novoTexto.trim() && midiasAnexadas.length === 0)}
          style={{
            background: '#25d366', color: '#fff',
            border: 'none', borderRadius: '50%',
            width: 38, height: 38, cursor: enviando ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, opacity: (!novoTexto.trim() && midiasAnexadas.length === 0) ? 0.5 : 1,
          }}>
          <Send size={sz(16)} />
        </button>
      </div>

      {/* Seletor de mídia da biblioteca (seleção múltipla) */}
      {seletorMidiaAberto && (
        <SeletorMidiaModal
          onClose={() => setSeletorMidiaAberto(false)}
          onSelect={(arr) => {
            setMidiasAnexadas(prev => {
              const idsExistentes = new Set(prev.filter(m => !m._local).map(m => m.id));
              const novos = (arr || []).filter(m => !idsExistentes.has(m.id));
              return [...prev, ...novos].slice(0, 10);
            });
            setSeletorMidiaAberto(false);
          }}
        />
      )}

      {/* ─── Setas de navegacao entre conversas da MESMA aba (Ailson 25/05/2026) ──
          Comportamento: percorre a lista de conversas filtradas pelo
          filtroEtapa atual (passada como idsNaAba pelo pai). Se estiver
          na aba 'aprovar', anda entre conversas em 'aprovar'. Idem pra
          outras abas. Setas viram cinza nos limites. */}
      {idsNaAba && idsNaAba.length > 1 && (() => {
        const idx = idsNaAba.indexOf(conversaId);
        const anteriorId = idx > 0 ? idsNaAba[idx - 1] : null;
        const proximoId  = idx >= 0 && idx < idsNaAba.length - 1 ? idsNaAba[idx + 1] : null;
        // No split view o chat começa em splitLeft, então o centro útil
        // desloca splitLeft/2. Em fullscreen (splitLeft=0) cai no cálculo
        // original. Ailson 28/05/2026.
        const meioOff = splitLeft / 2;
        const seta = (lado, id) => (
          <button
            onClick={() => id && onNavegar?.(id)}
            disabled={!id}
            title={id ? `Ir pra ${lado === 'esq' ? 'anterior' : 'próxima'}` : 'Fim da lista'}
            style={{
              position: 'fixed',
              // Aproxima do card do chat (wrapper 960px centralizado na área útil).
              // esq: piso = borda da lista (splitLeft) + 8px pra não invadi-la.
              // Conta: metade wrapper (480) + gap (12) + largura seta (44) = 536.
              [lado === 'esq' ? 'left' : 'right']: lado === 'esq'
                ? `max(${splitLeft + 8}px, calc(50% + ${meioOff}px - 536px))`
                : `max(8px, calc(50% - ${meioOff}px - 536px))`,
              top: '50%', transform: 'translateY(-50%)',
              width: 44, height: 44, borderRadius: '50%',
              background: id ? 'rgba(255,255,255,0.95)' : 'rgba(200,200,200,0.5)',
              color: id ? palette.ink : '#999',
              border: '1px solid ' + (id ? '#d0d0d0' : '#e5e5e5'),
              cursor: id ? 'pointer' : 'not-allowed',
              fontSize: 22, fontWeight: 700, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              zIndex: 50,
              fontFamily: FONT,
            }}
          >
            {lado === 'esq' ? '‹' : '›'}
          </button>
        );
        return (
          <>
            {seta('esq', anteriorId)}
            {seta('dir', proximoId)}
            <div style={{
              position: 'fixed', bottom: 80, left: `calc(50% + ${meioOff}px)`,
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.55)', color: '#fff',
              padding: '3px 10px', borderRadius: 12,
              fontSize: fz(10), fontFamily: FONT,
              zIndex: 50, pointerEvents: 'none',
            }}>
              {idx + 1} / {idsNaAba.length}
            </div>
          </>
        );
      })()}
      </div>{/* /wrapper centralizado */}
    </div>
  );
}

// Bubble individual no chat
// ─── Bubble pra sugestao da Sofia pendente de aprovacao (Ailson 25/05/2026) ──
// Antes esse bubble nao existia: a tela de conversa so renderizava mensagens
// ja enviadas (lojas_whats_mensagens). Sugestoes pendentes (lojas_whats_sugestoes
// status='pendente') ficavam invisiveis aqui — so na aba Aprovar do funil.
// Resultado: leads recem-processados pela Sofia (Amanda, Gleide 25/05) apareciam
// como "Sem mensagens ainda" mesmo com sugestao pronta no banco.
//
// Agora: cada sugestao pendente vira um bubble especial (fundo diferente,
// borda amarela) com 3 botoes: Aprovar / Editar / Dispensar. Usa o mesmo
// endpoint /api/lojas-whats-aprovar usado na aba Aprovar.
// ─── REFS COM MINIATURA (Ailson 04/07/2026) ─────────────────────────────────
// Ninguem decora ref de cabeca: toda ref citada (na sugestao da Sofia ou no
// modal Indicar refs) ganha a MINIATURA da foto do catalogo + nome + preco,
// via /api/lojas-whats-refs-buscar. Cache de modulo evita re-buscar.
const _refsInfoCache = new Map(); // refNorm -> {ref, nome, foto_url, preco_tabela, preco_medio, ...}
const _normRefFront = (r) => String(r ?? '').trim().replace(/^0+/, '') || '';

async function hidratarRefsInfo(refs) {
  const pedidas = [...new Set(refs.map(_normRefFront).filter(Boolean))];
  const faltam = pedidas.filter(r => !_refsInfoCache.has(r));
  if (faltam.length) {
    try {
      const r = await fetch(`/api/lojas-whats-refs-buscar?refs=${faltam.join(',')}`);
      const j = await r.json();
      for (const it of j.itens || []) _refsInfoCache.set(it.ref, it);
    } catch { /* silencioso — chips ficam sem thumb */ }
  }
  return pedidas.map(r => _refsInfoCache.get(r)).filter(Boolean);
}

// Chips "REF + foto" — usados embaixo da sugestao da Sofia. onPick opcional
// (no modal, tocar num chip preenche a linha).
function RefsChips({ refs, palette, fz, sz, titulo, onPick }) {
  const [itens, setItens] = useState([]);
  const chave = (refs || []).join(',');
  useEffect(() => {
    let vivo = true;
    if (!chave) { setItens([]); return; }
    hidratarRefsInfo(chave.split(',')).then(x => { if (vivo) setItens(x); });
    return () => { vivo = false; };
  }, [chave]);
  if (!itens.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {titulo && <div style={{ fontSize: fz(10), color: '#7a5a00', fontWeight: 600, marginBottom: 4 }}>{titulo}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {itens.map(it => (
          <div key={it.ref}
            onClick={onPick ? () => onPick(it.ref) : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, background: '#fff',
              border: '1px solid #e8e2da', borderRadius: 8, padding: '3px 8px 3px 3px',
              cursor: onPick ? 'pointer' : 'default',
            }}>
            {it.foto_url
              ? <img src={it.foto_url} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 6 }} />
              : <div style={{ width: 34, height: 34, borderRadius: 6, background: '#f0ece5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Image size={sz(14)} color="#a89f92" /></div>}
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontSize: fz(11), fontWeight: 700, color: palette.ink }}>REF {it.ref}</div>
              <div style={{ fontSize: fz(9.5), color: palette.inkMuted, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[it.nome, (it.preco_tabela || it.preco_medio) ? `R$${Math.round(it.preco_tabela || it.preco_medio)}` : null].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Thumb ao vivo ao lado do input de ref no modal: digitou -> ve a foto e o
// nome, confirma visualmente que e a peca certa (debounce 450ms).
function RefThumbAoVivo({ refDigitada, palette, fz, sz }) {
  const [info, setInfo] = useState(null);
  const rn = _normRefFront(refDigitada);
  useEffect(() => {
    let vivo = true;
    if (!rn || rn.length < 3) { setInfo(null); return; }
    if (_refsInfoCache.has(rn)) { setInfo(_refsInfoCache.get(rn)); return; }
    const t = setTimeout(() => {
      hidratarRefsInfo([rn]).then(x => { if (vivo) setInfo(x[0] || null); });
    }, 450);
    return () => { vivo = false; clearTimeout(t); };
  }, [rn]);
  if (!rn || rn.length < 3) return null;
  if (!info || info.desconhecida) {
    return (
      <div style={{ fontSize: fz(10), color: '#b45309', marginTop: 3 }}>
        ref não encontrada na base (confere o número)
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      {info.foto_url
        ? <img src={info.foto_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, border: '2px solid #4caf7d' }} />
        : <div style={{ width: 40, height: 40, borderRadius: 6, background: '#f0ece5', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e8e2da' }}><Image size={sz(15)} color="#a89f92" /></div>}
      <div style={{ fontSize: fz(10.5), color: palette.ink, lineHeight: 1.25 }}>
        <span style={{ fontWeight: 700 }}>✓ {info.nome || `REF ${info.ref}`}</span>
        {(info.preco_tabela || info.preco_medio) && <span style={{ color: palette.inkMuted }}> · R${Math.round(info.preco_tabela || info.preco_medio)}</span>}
        {!info.foto_url && <div style={{ color: palette.inkMuted }}>sem foto no catálogo, mas a ref existe</div>}
      </div>
    </div>
  );
}

function SugestaoPendenteBubble({ sug, onAprovou, userId, bloqueado, palette, fz, sz, FONT }) {
  const [editando, setEditando] = useState(false);
  const [editText, setEditText] = useState(sug.texto_proposto || '');
  const [acaoEm, setAcaoEm] = useState(false);

  // Edicao da sugestao agora abre num OVERLAY FIXO (dialog ancorado no topo),
  // fora do chat rolavel. Antes era inline na thread e o teclado do iOS
  // reancorava a tela: scroll pulava ao digitar, a caixa abria cortada e ao
  // fechar nao voltava pra posicao. Com overlay fixo o chat nao se mexe.
  // Ailson 14/06/2026.
  const editTaRef = useRef(null);
  const isDesktop = useIsDesktop();
  useEffect(() => {
    if (!editando) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';   // trava scroll de fundo enquanto edita
    return () => { document.body.style.overflow = prev; };
  }, [editando]);

  const horario = sug.criada_em ? new Date(sug.criada_em).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '';

  const acionar = async (acao, texto = null) => {
    if (bloqueado) return;
    setAcaoEm(true);
    try {
      const r = await fetch('/api/lojas-whats-aprovar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sugestao_ids: [sug.id], acao,
          texto_editado: texto,
          aprovada_por: userId || 'tamara',
        }),
      });
      const j = await r.json();
      if (!r.ok || j.falhas > 0) {
        alert(j.error || 'Erro ao processar');
      } else {
        onAprovou?.();
      }
    } catch (e) {
      alert('Erro: ' + e.message);
    } finally {
      setAcaoEm(false);
      setEditando(false);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10, fontFamily: FONT }}>
      <div style={{
        maxWidth: '85%', background: '#fff8e0',
        border: '2px solid #f0c050', borderRadius: 10, padding: 10,
      }}>
        <div style={{ fontSize: fz(10), color: '#7a5a00', marginBottom: 6, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
          <Bot size={12} strokeWidth={2} /> Sofia sugeriu — aguardando sua aprovação
        </div>

        <>
          <>
            <div style={{
              fontSize: fz(13), lineHeight: 1.5, whiteSpace: 'pre-wrap',
              color: palette.ink, marginBottom: 8,
            }}>
              {(() => {
                // Marcadores no texto da sugestao:
                //  - [ASSISTENTE_ANEXAR:x] = VERMELHO, Tamara precisa anexar manual.
                //  - [ENVIAR_CATALOGO/FOTO/VIDEO:x] = VERDE, vai junto AUTOMATICO
                //    quando aprovar (backend anexa). Tamara nao faz nada. Ailson 29/05/2026.
                const txt = sug.texto_proposto || '';
                const re = /\[(ASSISTENTE_ANEXAR|ENVIAR_CATALOGO|ENVIAR_FOTO|ENVIAR_VIDEO):([^\]]+)\]/gi;
                const parts = [];
                let last = 0; let m; let i = 0;
                while ((m = re.exec(txt)) !== null) {
                  if (m.index > last) parts.push(<span key={`t${i++}`}>{txt.slice(last, m.index)}</span>);
                  const tipo = m[1].toUpperCase();
                  const val = m[2].trim();
                  if (tipo === 'ASSISTENTE_ANEXAR') {
                    parts.push(
                      <span key={`m${i++}`} title="Apague esse marcador e anexe a mídia manualmente antes de enviar" style={{
                        display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                        background: '#fee2e2', color: '#b91c1c', fontWeight: 700,
                        fontSize: fz(11), border: '1px dashed #b91c1c', margin: '0 2px',
                      }}>📎 ANEXAR: {val}</span>
                    );
                  } else {
                    const rotulo = tipo === 'ENVIAR_CATALOGO' ? '📎 Catálogo'
                      : tipo === 'ENVIAR_FOTO' ? `🖼️ Foto REF ${val}`
                      : `🎬 Vídeo REF ${val}`;
                    parts.push(
                      <span key={`m${i++}`} title="Vai junto automaticamente quando você aprovar — não precisa anexar nada" style={{
                        display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                        background: '#dcfce7', color: '#15803d', fontWeight: 700,
                        fontSize: fz(11), border: '1px solid #86efac', margin: '0 2px',
                      }}>{rotulo} · anexado automático</span>
                    );
                  }
                  last = re.lastIndex;
                }
                if (last < txt.length) parts.push(<span key={`t${i++}`}>{txt.slice(last)}</span>);
                return parts.length ? parts : txt;
              })()}
            </div>
            {/\[ASSISTENTE_ANEXAR/i.test(sug.texto_proposto || '') && (
              <div style={{
                fontSize: fz(10), color: '#b91c1c', background: '#fef2f2',
                border: '1px solid #fecaca', borderRadius: 4, padding: '4px 6px',
                marginBottom: 8,
              }}>
                ⚠️ Sofia pediu pra vc anexar mídia manualmente. Edite a msg pra apagar o marcador, anexe a foto/vídeo, depois envie.
              </div>
            )}
            {(() => {
              // Miniaturas das refs que a Sofia esta tratando: citadas no texto
              // ([ENVIAR_FOTO:x]) + top candidata de cada print lido (vision).
              // A Tamara valida de olho, sem decorar ref. Ailson 04/07/2026.
              const txt = sug.texto_proposto || '';
              const setRefs = new Set();
              const reTag = /\[ENVIAR_(?:FOTO|VIDEO):([^\]]+)\]/gi;
              let mm; while ((mm = reTag.exec(txt)) !== null) setRefs.add(mm[1].trim());
              const reTxt = /\bref\.?\s*(\d{3,4})\b/gi;
              while ((mm = reTxt.exec(txt)) !== null) setRefs.add(mm[1]);
              for (const le of sug.contexto_ia?.print_leituras || []) {
                if (le?.candidatas?.[0]?.ref) setRefs.add(le.candidatas[0].ref);
              }
              const refs = [...setRefs].slice(0, 6);
              return refs.length
                ? <div style={{ marginBottom: 8 }}>
                    <RefsChips refs={refs} palette={palette} fz={fz} sz={sz}
                      titulo="Peças identificadas (confira pela foto):" />
                  </div>
                : null;
            })()}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', opacity: bloqueado ? 0.5 : 1, pointerEvents: bloqueado ? 'none' : 'auto' }}>
              <button
                onClick={() => acionar('aprovar')}
                disabled={acaoEm || bloqueado}
                style={{
                  padding: '6px 10px', background: '#2c7a4f', color: '#fff',
                  border: 'none', borderRadius: 6, fontSize: fz(12), cursor: 'pointer',
                }}
              >✓ Aprovar e enviar</button>
              <button
                onClick={() => setEditando(true)}
                disabled={acaoEm}
                style={{
                  padding: '6px 10px', background: '#f0f0f0', color: '#333',
                  border: 'none', borderRadius: 6, fontSize: fz(12), cursor: 'pointer',
                }}
              >✏️ Editar</button>
              <button
                onClick={() => acionar('dispensar')}
                disabled={acaoEm}
                style={{
                  padding: '6px 10px', background: '#fff', color: '#a23',
                  border: '1px solid #d99', borderRadius: 6, fontSize: fz(12), cursor: 'pointer',
                }}
              >✕ Dispensar</button>
            </div>
          </>
        </>
        {horario && (
          <div style={{ fontSize: fz(9), color: '#888', marginTop: 6, textAlign: 'right' }}>
            {horario}
          </div>
        )}
      </div>
      {editando && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(20,16,8,0.45)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: isDesktop ? '8vh 16px 16px' : '40px 10px 10px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 560, background: '#fff8e0',
              border: '2px solid #f0c050', borderRadius: 12, padding: 14,
              boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
              display: 'flex', flexDirection: 'column', fontFamily: FONT,
            }}
          >
            <div style={{ fontSize: fz(11), color: '#7a5a00', fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
              <Bot size={13} strokeWidth={2} /> Editar mensagem da Sofia
            </div>
            <textarea
              ref={editTaRef}
              autoFocus
              value={editText}
              onChange={e => setEditText(e.target.value)}
              style={{
                width: '100%', minHeight: isDesktop ? 200 : 150, maxHeight: isDesktop ? '60vh' : '46vh', padding: 10,
                borderRadius: 8, border: '1px solid #d0c080',
                fontSize: isDesktop ? '14px' : '16px', fontFamily: FONT, lineHeight: 1.5,
                resize: 'vertical', overflowY: 'auto', whiteSpace: 'pre-wrap', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={() => acionar('editar_aprovar', editText)}
                disabled={acaoEm}
                style={{
                  flex: 1, padding: '12px', background: '#2c7a4f', color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: fz(14), fontWeight: 600,
                  cursor: 'pointer', opacity: acaoEm ? 0.6 : 1,
                }}
              >{acaoEm ? 'Enviando...' : 'Salvar e enviar'}</button>
              <button
                onClick={() => { setEditando(false); setEditText(sug.texto_proposto); }}
                disabled={acaoEm}
                style={{
                  padding: '12px 16px', background: '#e8e2da', color: '#333',
                  border: 'none', borderRadius: 8, fontSize: fz(14), cursor: 'pointer',
                }}
              >Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Bubble({ m, botao }) {
  const [capaIdx, setCapaIdx] = useState(0);  // 0=objeto direto, 1=render/image, 2=fallback
  const ehSaida = m.direcao === 'saida';
  const ehAssistente = m.autor === 'assistente';
  // Ailson 25/05/2026: padroniza verde WhatsApp pra TODA msg de saida
  // (Sofia/assistente/vendedora) e branco pra cliente. Antes Sofia ficava
  // azul, ficava destoante do padrao WhatsApp.
  const corBg = ehSaida ? '#dcf8c6' : '#fff';
  const align = ehSaida ? 'flex-end' : 'flex-start';

  const horario = m.enviada_em ? new Date(m.enviada_em).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '';

  // Label do autor — usa o icone de pessoa (mesmo dos cards) ao inves do
  // emoji robo, pra Sofia parecer vendedora ate visualmente. Ailson 25/05/2026
  const labelSofia = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <UserIcon size={9} color={palette.accent} /> Sofia
    </span>
  );
  const labelAutor = ehSaida
    ? (m.autor === 'sistema' ? <span>sistema</span> : labelSofia)
    : null;

  // URL da midia: pra image renderiza thumb clicavel; pra document/video
  // mostra ícone+link clicavel. Outbound nosso e inbound do cliente ja vem
  // com URL publica do Supabase Storage (webhook baixou e salvou).
  // Ailson 03/07/2026: 'template' com midia_url = HSM com header IMAGE (foto da
  // peça no carrinho abandonado) — renderiza a foto igual mensagem de imagem.
  const ehImagem = (m.tipo_midia === 'image' || m.tipo_midia === 'template') && m.midia_url && m.midia_url.startsWith('http');
  const ehVideo = m.tipo_midia === 'video' && m.midia_url && m.midia_url.startsWith('http');
  const ehDocumento = m.tipo_midia === 'document' && m.midia_url && m.midia_url.startsWith('http');
  const ehAudio = m.tipo_midia === 'audio' && m.midia_url && m.midia_url.startsWith('http');

  // Ailson 27/05/2026: pra catalogos (path inclui /catalogos/), tentar
  // mostrar capa.{ext} do mesmo folder como miniatura clicavel em vez de
  // ícone genérico de documento. Cascata: jpg → png → webp → fallback.
  // Ailson 28/05/2026: cache-busting com versao manual. Browsers podem
  // cachear 404 da capa de antes dela ter sido uploadada — bumpar a
  // versao forca refresh em todos os clientes.
  // Ailson 29/05/2026: a capa nao aparecia mesmo com o arquivo existindo e o
  // bucket publico. Causa: 404 cacheado no caminho /object/public/ — e o
  // Supabase IGNORA query string (?v=) pra cache de objeto, entao bumpar versao
  // nao furava. Solucao: usar o endpoint /render/image/ (caminho de URL
  // diferente => chave de cache nova, sem herdar o 404). Bonus: redimensiona.
  const ehCatalogo = ehDocumento && m.midia_url.includes('/catalogos/');
  // Ailson 30/05/2026: a capa.jpg antiga ficou com 404 preso no cache do
  // /object/ e o /render/image/ depende de Image Transformations (off). Solucao
  // definitiva: NOME NOVO (capa2.*) servido pelo /object/ direto — caminho/nome
  // inedito = sem 404 cacheado, e sem depender de transform. Cascata so de
  // objeto direto (png primeiro, que e o formato da arte enviada). Sobe a capa
  // como sofia-midias/catalogos/capa2.png (ou .jpg) que ja aparece.
  const dirCatalogos = ehCatalogo
    ? m.midia_url.replace(/\/catalogos\/[^/]+$/, '/catalogos/')
    : null;
  const CAPA_CANDIDATOS = dirCatalogos ? [
    `${dirCatalogos}capa2.png?v=1`,
    `${dirCatalogos}capa2.jpg?v=1`,
    `${dirCatalogos}capa.jpg?v=4`,
  ] : [];
  const capaErr = capaIdx >= CAPA_CANDIDATOS.length;
  const capaUrl = !capaErr ? CAPA_CANDIDATOS[capaIdx] : null;

  return (
    <div style={{ display: 'flex', justifyContent: align, marginBottom: 8 }}>
      <div style={{
        maxWidth: '78%', background: corBg,
        padding: '7px 10px', borderRadius: 8,
        boxShadow: '0 1px 1px rgba(0,0,0,0.08)',
        position: 'relative',
      }}>
        {labelAutor && (
          <div style={{ fontSize: 9, color: '#5a6470', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {labelAutor}
          </div>
        )}
        {/* Miniatura de IMAGEM clicavel pra abrir em tamanho real */}
        {ehImagem && (
          <a href={m.midia_url} target="_blank" rel="noopener noreferrer" style={{ display: 'block' }}>
            <img
              src={m.midia_url}
              alt="foto"
              style={{
                maxWidth: 260, maxHeight: 300,
                borderRadius: 6, display: 'block',
                marginBottom: m.texto ? 6 : 0,
                cursor: 'pointer',
              }}
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
          </a>
        )}
        {/* VIDEO com controle nativo */}
        {ehVideo && (
          <video
            src={m.midia_url}
            controls
            style={{
              maxWidth: 260, maxHeight: 300,
              borderRadius: 6, display: 'block',
              marginBottom: m.texto ? 6 : 0,
              background: '#000',
            }}
          />
        )}
        {/* AUDIO */}
        {ehAudio && (
          <>
            <audio src={m.midia_url} controls style={{ display: 'block', marginBottom: m.audio_transcricao ? 4 : (m.texto ? 6 : 0), maxWidth: 260 }} />
            {/* Transcricao Whisper (auto): pra Tamara ler sem precisar dar play */}
            {m.audio_transcricao && (
              <div style={{
                fontSize: fz(11), fontStyle: 'italic', color: palette.inkSoft,
                padding: '4px 8px', background: 'rgba(0,0,0,0.04)',
                borderLeft: `2px solid ${palette.inkMuted}`, borderRadius: 4,
                marginBottom: m.texto ? 6 : 0, maxWidth: 260,
              }}>
                <span style={{ fontSize: fz(9), color: palette.inkMuted, fontWeight: 600, marginRight: 4 }}>📝 transcrição:</span>
                {m.audio_transcricao}
              </div>
            )}
          </>
        )}
        {/* DOCUMENTO: link clicavel */}
        {ehDocumento && ehCatalogo && !capaErr && (
          <a
            href={m.midia_url} target="_blank" rel="noopener noreferrer"
            style={{
              display: 'block', textDecoration: 'none', cursor: 'pointer',
              marginBottom: m.texto ? 6 : 0,
            }}
            title="Abrir catálogo (PDF)"
          >
            <img
              src={capaUrl}
              alt="Catálogo Amícia"
              onError={() => {
                console.warn('[capa] falhou:', capaUrl, '→ proxima extensao');
                setCapaIdx(i => i + 1);
              }}
              style={{
                maxWidth: 220, width: '100%', borderRadius: 8,
                display: 'block', boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              }}
            />
            <div style={{
              fontSize: 10, color: palette.inkMuted, marginTop: 3,
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <FileText size={11} /> Catálogo · clique pra abrir
            </div>
          </a>
        )}
        {ehDocumento && (!ehCatalogo || capaErr) && (
          <a
            href={m.midia_url} target="_blank" rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 10px', background: 'rgba(0,0,0,0.05)',
              borderRadius: 6, marginBottom: m.texto ? 6 : 0,
              textDecoration: 'none', color: '#1a4a8a',
              fontSize: 12, fontWeight: 600,
            }}
          >
            <FileText size={16} />
            <span>📎 Abrir {ehCatalogo ? 'catálogo' : 'documento'}</span>
          </a>
        )}
        {/* Tipo 'unsupported' = WhatsApp Business API nao consegue processar
            esse formato (ex: vCard, certos stickers animados, formatos exoticos).
            Limitacao da Meta — nao tem como recuperar o arquivo via API. */}
        {m.tipo_midia === 'unsupported' && (
          <div style={{
            padding: '8px 10px', background: '#fef3c7',
            border: '1px solid #fcd34d', borderRadius: 6, marginBottom: 6,
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#92400e',
          }}>
            <span>⚠️</span>
            <span>Cliente enviou um arquivo em formato que o WhatsApp Business API não consegue baixar (vCard, sticker animado, etc). Peça pra reenviar como foto, vídeo ou PDF.</span>
          </div>
        )}
        {/* Fallback: tem tipo de midia mas URL nao chegou (ainda baixando ou erro) */}
        {!ehImagem && !ehVideo && !ehAudio && !ehDocumento &&
         (m.tipo_midia === 'image' || m.tipo_midia === 'video' || m.tipo_midia === 'document' || m.tipo_midia === 'audio') && (
          <div style={{
            padding: '6px 8px', background: 'rgba(0,0,0,0.04)',
            borderRadius: 6, marginBottom: 6, display: 'flex',
            alignItems: 'center', gap: 6, fontSize: 11, color: '#888',
            fontStyle: 'italic',
          }}>
            {m.tipo_midia === 'image' && <Image size={14} />}
            {m.tipo_midia === 'video' && <Video size={14} />}
            {m.tipo_midia === 'document' && <FileText size={14} />}
            <span>
              {m.midia_url
                ? `❌ Mídia indisponível (falha no download — link Meta expira em ~5min, peça pra reenviar)`
                : 'Mídia (carregando...)'}
            </span>
          </div>
        )}
        {m.texto && (
          <div style={{ fontSize: 13, color: '#1a1a1a', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
            {m.texto}
          </div>
        )}
        {botao && (
          <a href={botao.url} target="_blank" rel="noopener noreferrer" style={{
            display: 'block', marginTop: 8, paddingTop: 8,
            borderTop: '1px solid rgba(0,0,0,0.1)',
            textAlign: 'center', fontSize: 13, fontWeight: 600,
            color: '#1c7ed6', textDecoration: 'none',
          }}>
            🔗 {botao.text}
          </a>
        )}
        <div style={{
          fontSize: 9, color: '#7c8a99', marginTop: 4,
          textAlign: 'right',
        }}>
          {horario} {ehSaida && m.status === 'entregue' && '✓✓'}
        </div>
      </div>
    </div>
  );
}

// Modal selector de mídia da biblioteca
function SeletorMidiaModal({ onClose, onSelect }) {
  const [midias, setMidias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState({});  // id -> midia (selecao multipla)
  const toggleSel = (m) => setSel(prev => {
    const novo = { ...prev };
    if (novo[m.id]) delete novo[m.id]; else novo[m.id] = m;
    return novo;
  });
  const qtdSel = Object.keys(sel).length;

  useEffect(() => {
    (async () => {
      setLoading(true);
      const url = filtroTipo !== 'todos'
        ? `/api/lojas-whats-midia?tipo=${filtroTipo}`
        : '/api/lojas-whats-midia';
      const r = await fetch(url);
      const j = await r.json();
      setMidias(j.midias || []);
      setLoading(false);
    })();
  }, [filtroTipo]);

  const filtradas = busca
    ? midias.filter(m =>
        (m.nome_arquivo || '').toLowerCase().includes(busca.toLowerCase()) ||
        (m.ref || '').includes(busca))
    : midias;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1100, padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.bg, borderRadius: 12, padding: 16,
        maxWidth: 500, width: '100%', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', fontFamily: FONT,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: fz(15), fontWeight: 700, color: palette.ink }}>
            Anexar mídia da biblioteca
          </h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}>
            <X size={sz(20)} color={palette.inkMuted} />
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {[
            { id: 'todos', label: 'Todas' },
            { id: 'foto', label: '📷 Fotos' },
            { id: 'cores', label: '🎨 Cores' },
            { id: 'video', label: '🎬 Vídeos' },
            { id: 'catalogo', label: '📄 Catálogos' },
          ].map(f => (
            <button key={f.id} onClick={() => setFiltroTipo(f.id)} style={{
              padding: '4px 9px', borderRadius: 14, cursor: 'pointer',
              border: `1px solid ${filtroTipo === f.id ? palette.ink : palette.beige}`,
              background: filtroTipo === f.id ? palette.ink : palette.surface,
              color: filtroTipo === f.id ? palette.bg : palette.ink,
              fontSize: fz(11), fontFamily: FONT, fontWeight: 500,
            }}>{f.label}</button>
          ))}
        </div>
        <input type="text" value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome/REF..."
          style={{
            padding: '6px 10px', borderRadius: 6, border: `1px solid ${palette.beige}`,
            fontFamily: FONT, fontSize: fz(12), marginBottom: 10,
          }} />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Loader2 size={20} className="spin" /></div>
          ) : filtradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: palette.inkMuted, fontSize: fz(12) }}>
              Nenhuma mídia. Vá em "Mídias" pra subir.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
              {filtradas.map(m => (
                <button key={m.id} onClick={() => toggleSel(m)} style={{
                  background: sel[m.id] ? '#e8f0ff' : palette.surface,
                  border: `2px solid ${sel[m.id] ? palette.accent : palette.beige}`,
                  borderRadius: 6, padding: 8, cursor: 'pointer', textAlign: 'left',
                  fontFamily: FONT, position: 'relative',
                }}>
                  {sel[m.id] && (
                    <span style={{
                      position: 'absolute', top: 4, right: 4, zIndex: 1,
                      background: palette.accent, color: '#fff', borderRadius: '50%',
                      width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}><Check size={12} /></span>
                  )}
                  {(m.tipo === 'foto' || m.tipo === 'cores') && m.url_publica ? (
                    <img src={m.url_publica} alt="" style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 4, marginBottom: 4 }} />
                  ) : (
                    <div style={{
                      width: '100%', height: 70, background: palette.beige, borderRadius: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4,
                      fontSize: 28,
                    }}>
                      {m.tipo === 'video' ? '🎬' : '📄'}
                    </div>
                  )}
                  <div style={{ fontSize: 10, fontWeight: 600, color: palette.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.ref ? `REF ${m.ref}` : m.nome_arquivo}
                  </div>
                  <div style={{ fontSize: 9, color: palette.inkMuted }}>
                    {m.tipo} · {(m.size_bytes / 1024).toFixed(0)}kb
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Rodapé: anexar as selecionadas de uma vez */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button onClick={onClose} style={{
            padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
            border: `1px solid ${palette.beige}`, background: palette.surface,
            color: palette.ink, fontSize: fz(12), fontFamily: FONT, fontWeight: 500,
          }}>Cancelar</button>
          <button
            disabled={qtdSel === 0}
            onClick={() => onSelect(Object.values(sel))}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              cursor: qtdSel === 0 ? 'not-allowed' : 'pointer',
              background: qtdSel === 0 ? palette.beige : palette.accent,
              color: qtdSel === 0 ? palette.inkMuted : '#fff',
              fontSize: fz(12), fontFamily: FONT, fontWeight: 700,
            }}>
            Anexar{qtdSel > 0 ? ` (${qtdSel})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 8: MIDIAS SOFIA
// ═══════════════════════════════════════════════════════════════════════════

// Chip da origem do lead (carrinho / Facebook / stories / linktree / SAC), mesmo
// visual dos cards do funil. Retorna null (sem espaço) quando não há origem.
// Ailson 26/06/2026.
function ChipOrigemLead({ origem_lead, carrinho_id }) {
  const o = (carrinho_id || origem_lead === 'carrinho_site_amicialoja') ? 'carrinho'
    : origem_lead === 'anuncio_facebook' ? 'fb'
    : origem_lead === 'anuncio_instagram' ? 'ads'
    : origem_lead === 'instagram_stories' ? 'stories'
    : origem_lead === 'instagram_linktree' ? 'linktree'
    : origem_lead === 'sac' ? 'sac'
    : null;
  if (!o) return null;
  const base = { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: fz(9.5), fontWeight: 800, padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap' };
  const span =
    o === 'fb' ? <span title="Lead de anúncio do Facebook" style={{ ...base, background: '#e7f1fc', color: '#1877f2' }}><Facebook size={fz(11)} fill="#1877f2" color="#1877f2" strokeWidth={0} /> Facebook</span>
    : o === 'ads' ? <span style={{ ...base, background: '#e7f1fc', color: '#1877f2', fontFamily: 'Arial, sans-serif' }}>f Ads</span>
    : o === 'carrinho' ? <span title="Lead de carrinho abandonado" style={{ ...base, background: '#fff0e0', color: '#a55a00' }}>🛒 carrinho</span>
    : o === 'stories' ? <span title="Lead via Stories do Instagram" style={{ ...base, background: 'linear-gradient(45deg, #fbe5d2, #f4d6e5)', color: '#a8388d' }}>📸 stories</span>
    : o === 'linktree' ? <span title="Lead via Linktree do Instagram" style={{ ...base, background: '#e6f7ee', color: '#1f7a48' }}>🔗 linktree</span>
    : <span title="Atendimento via SAC do site" style={{ ...base, background: '#eaf1f7', color: '#2c5d86' }}>🎧 SAC</span>;
  return <div style={{ marginTop: sz(4) }}>{span}</div>;
}

function PesquisaTab({ refreshTick, onAbrirChat }) {
  const [respostas, setRespostas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  const carregar = async () => {
    setLoading(true); setErro(null);
    try {
      const { data: resp, error } = await supabase
        .from('lojas_whats_pesquisa_respostas')
        .select('id, conversa_id, telefone, nome, motivo, variante, botao_texto, respondido_em')
        .order('respondido_em', { ascending: false })
        .limit(500);
      if (error) throw error;
      const ids = [...new Set((resp || []).map(r => r.conversa_id).filter(Boolean))];
      const convPorId = {};
      if (ids.length) {
        const { data: convs } = await supabase
          .from('lojas_whats_conversas')
          .select('id, etapa, origem_lead, carrinho_id')
          .in('id', ids);
        (convs || []).forEach(c => { convPorId[c.id] = c; });
      }
      setRespostas((resp || []).map(r => {
        const cv = convPorId[r.conversa_id] || null;
        return { ...r, etapaAtual: cv?.etapa || null, origem_lead: cv?.origem_lead || null, carrinho_id: cv?.carrinho_id || null };
      }));
    } catch (e) { setErro(e.message); }
    setLoading(false);
  };
  useEffect(() => { carregar(); }, [refreshTick, reloadTick]);

  const moverPara = async (conversaId, etapa) => {
    try {
      const r = await fetch('/api/lojas-whats-conversa-editar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversa_id: conversaId, campos: { etapa } }),
      });
      const j = await r.json();
      if (!r.ok || j.error) setFeedback({ tipo: 'erro', msg: j.error || 'Erro ao mover' });
      else { setFeedback({ tipo: 'ok', msg: `Movido para ${etapa}` }); setReloadTick(t => t + 1); }
    } catch (e) { setFeedback({ tipo: 'erro', msg: e.message }); }
  };

  if (loading) return <div style={{ padding: sz(20), textAlign: 'center' }}><Loader2 size={sz(24)} className="spin" /></div>;
  if (erro) return <div style={{ padding: sz(16), color: palette.alert }}>{erro}</div>;

  const LABELS = { minimo_pecas: 'Mínimo de peças', preco: 'Preço', variedade: 'Variedade', outros: 'Outros motivos' };
  const ORDEM = ['minimo_pecas', 'preco', 'variedade', 'outros'];
  const grupos = {}; ORDEM.forEach(m => { grupos[m] = []; });
  (respostas || []).forEach(r => { (grupos[r.motivo] || (grupos[r.motivo] = [])).push(r); });

  const btnMover = (conversaId, et) => (
    <button key={et} onClick={() => moverPara(conversaId, et)}
      style={{ fontSize: sz(11), padding: `${sz(4)}px ${sz(8)}px`, borderRadius: sz(6),
        border: `1px solid ${palette.beige}`, background: palette.bg, color: palette.ink,
        cursor: 'pointer', fontFamily: FONT }}>
      → {et}
    </button>
  );

  return (
    <div style={{ padding: sz(12), fontFamily: FONT }}>
      {feedback && (
        <div style={{ marginBottom: sz(8), fontSize: sz(12), color: feedback.tipo === 'erro' ? palette.alert : palette.ok }}>
          {feedback.msg}
        </div>
      )}
      <div style={{ fontSize: sz(12), color: palette.inkMuted, marginBottom: sz(12) }}>
        Leads que responderam a pesquisa (já receberam a resposta automática da Sofia). Aqui vc dá sequência e decide pra qual aba mandar.
      </div>
      {ORDEM.map(m => {
        const lista = grupos[m] || [];
        return (
          <div key={m} style={{ marginBottom: sz(18) }}>
            <div style={{ fontWeight: 700, fontSize: sz(14), marginBottom: sz(6), color: palette.ink }}>
              {LABELS[m]} <span style={{ color: palette.inkMuted, fontWeight: 400 }}>({lista.length})</span>
            </div>
            {lista.length === 0 && <div style={{ fontSize: sz(12), color: palette.inkMuted }}>Nenhum ainda.</div>}
            {lista.map(r => {
              const tel = (r.telefone || '').replace(/\D/g, '');
              return (
                <div key={r.id} style={{ border: `1px solid ${palette.beige}`, borderRadius: sz(10), padding: sz(10), marginBottom: sz(8), background: palette.surface }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: sz(8) }}>
                    <div onClick={() => r.conversa_id && onAbrirChat?.(r.conversa_id)}
                      title={r.conversa_id ? 'Abrir conversa no chat' : undefined}
                      style={{ cursor: r.conversa_id ? 'pointer' : 'default', flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: sz(13), color: palette.ink }}>{r.nome || r.telefone || 'Lead'}</div>
                      <ChipOrigemLead origem_lead={r.origem_lead} carrinho_id={r.carrinho_id} />
                      <div style={{ fontSize: sz(11), color: palette.inkMuted, marginTop: sz(2) }}>
                        {r.telefone || '—'} · variante {r.variante || '-'}{r.etapaAtual ? ` · agora: ${r.etapaAtual}` : ''}
                      </div>
                    </div>
                    {tel && (
                      <a href={`https://wa.me/${tel}`} target="_blank" rel="noreferrer"
                        style={{ fontSize: sz(12), color: palette.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        WhatsApp
                      </a>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: sz(6), marginTop: sz(8), flexWrap: 'wrap' }}>
                    {r.conversa_id && (
                      <button onClick={() => onAbrirChat?.(r.conversa_id)}
                        style={{ fontSize: sz(11), padding: `${sz(4)}px ${sz(8)}px`, borderRadius: sz(6),
                          border: `1px solid ${palette.accent}`, background: palette.accent, color: '#fff',
                          cursor: 'pointer', fontFamily: FONT, fontWeight: 600 }}>
                        💬 Abrir chat
                      </button>
                    )}
                    {['conversando', 'quente', 'atendida', 'perdida'].map(et => btnMover(r.conversa_id, et))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Pasta "Templates" da aba Mídias (Ailson 04/07/2026) ────────────────────
// Catálogo dos templates HSM da Sofia organizado em subpastas: Curadoria,
// Novidades, Dicas rápidas (reativação, criativo trocável) e Ativos hoje.
// Cada card mostra DE FORMA REAL como o cliente recebe (criativo + corpo +
// botões), em que fluxo é usado e por que existe — controle pra não se perder
// com vários templates. Nos 3 de conteúdo dá pra subir/trocar o criativo sem
// mexer no corpo aprovado.
function TemplatesCatalogo() {
  const [aberto, setAberto] = useState(false);
  const [pastas, setPastas] = useState(null);
  const [subAberta, setSubAberta] = useState(null);
  const [salvando, setSalvando] = useState(null);   // name em edicao/upload
  const [msg, setMsg] = useState(null);

  const carregar = async () => {
    try {
      const r = await fetch('/api/lojas-whats-templates-catalogo');
      const j = await r.json();
      if (j.ok) setPastas(j.pastas);
      else setMsg({ tipo: 'erro', txt: j.erro || 'falha ao carregar' });
    } catch (e) { setMsg({ tipo: 'erro', txt: e.message }); }
  };
  useEffect(() => { if (aberto && !pastas) carregar(); }, [aberto]);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  const salvarDoc = async (name, campo, valor) => {
    setSalvando(name);
    try {
      const r = await fetch('/api/lojas-whats-templates-catalogo', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, [campo]: valor }),
      });
      const j = await r.json();
      if (j.ok) { setMsg({ tipo: 'ok', txt: 'Salvo' }); await carregar(); }
      else setMsg({ tipo: 'erro', txt: j.erro || 'falha' });
    } catch (e) { setMsg({ tipo: 'erro', txt: e.message }); }
    setSalvando(null);
  };

  const subirCriativo = async (name, file) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setMsg({ tipo: 'erro', txt: 'Criativo acima de 2MB' }); return; }
    setSalvando(name);
    try {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('arquivo', file);
      const r = await fetch('/api/lojas-whats-templates-catalogo', { method: 'POST', body: fd });
      const j = await r.json();
      if (j.ok) { setMsg({ tipo: 'ok', txt: 'Criativo atualizado' }); await carregar(); }
      else setMsg({ tipo: 'erro', txt: j.erro || 'falha no upload' });
    } catch (e) { setMsg({ tipo: 'erro', txt: e.message }); }
    setSalvando(null);
  };

  const SUBS = [
    ['curadoria', '🎨 Curadoria', 'Cores e modelos que são tendência'],
    ['novidades', '✨ Novidades', 'Novidades da Amícia'],
    ['dicas_rapidas', '💡 Dicas rápidas', 'Conteúdos rápidos pro lojista'],
    ['ativos', '📤 Ativos hoje', 'Como o cliente recebe e em que fluxo'],
  ];

  const CardTpl = ({ t, comCriativo }) => {
    const [porqueEdit, setPorqueEdit] = useState(null);   // null = fechado
    const [fluxoEdit, setFluxoEdit] = useState(null);
    const ocupado = salvando === t.name;
    return (
      <div style={{ border: `1px solid ${palette.beige}`, borderRadius: 10, padding: 12, background: palette.surface, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: fz(13), color: palette.ink }}>{t.name}</strong>
          <span style={{
            fontSize: fz(10), fontWeight: 700, padding: '2px 8px', borderRadius: 10,
            background: t.status === 'aprovado' ? '#e7f5ec' : '#f0ede8',
            color: t.status === 'aprovado' ? '#2e7d32' : palette.inkMuted,
          }}>{t.status === 'aprovado' ? 'aprovado na Meta' : t.status}</span>
          {t.criativo_atualizado_em && (
            <span style={{ fontSize: fz(10), color: palette.inkMuted }}>
              criativo de {new Date(t.criativo_atualizado_em).toLocaleDateString('pt-BR')}
            </span>
          )}
        </div>

        {/* Preview real (como o cliente recebe) */}
        <div style={{ maxWidth: 340, background: '#e7f8d4', borderRadius: 10, padding: 10, marginBottom: 10 }}>
          {t.criativo_url && (
            <img src={t.criativo_url} alt="criativo" style={{ width: '100%', borderRadius: 8, marginBottom: 8, display: 'block' }} />
          )}
          <div style={{ fontSize: fz(12), color: '#2c3e50', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
            {t.body_text}
          </div>
          {Array.isArray(t.botoes) && t.botoes.length > 0 && (
            <div style={{ marginTop: 8, borderTop: '1px solid #cfe3b8', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {t.botoes.map((b, i) => (
                <div key={i} style={{ textAlign: 'center', fontSize: fz(12), fontWeight: 700, color: '#1a73a8' }}>
                  {typeof b === 'string' ? b : (b.text || b.url || '')}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Por que existe */}
        <div style={{ fontSize: fz(11), marginBottom: 6 }}>
          <strong style={{ color: palette.inkSoft }}>Por quê:</strong>{' '}
          {porqueEdit === null ? (
            <>
              <span style={{ color: palette.ink }}>{t.porque || '(sem explicação)'}</span>
              <button onClick={() => setPorqueEdit(t.porque || '')} style={{ marginLeft: 6, fontSize: fz(10), border: 'none', background: 'none', color: palette.accent, cursor: 'pointer', fontWeight: 700 }}>editar</button>
            </>
          ) : (
            <div style={{ marginTop: 4 }}>
              <textarea value={porqueEdit} onChange={e => setPorqueEdit(e.target.value)} rows={2}
                style={{ width: '100%', fontSize: fz(11), fontFamily: FONT, borderRadius: 6, border: `1px solid ${palette.beige}`, padding: 6, boxSizing: 'border-box' }} />
              <button disabled={ocupado} onClick={async () => { await salvarDoc(t.name, 'porque', porqueEdit); setPorqueEdit(null); }}
                style={{ fontSize: fz(11), padding: '3px 10px', borderRadius: 6, border: 'none', background: palette.accent, color: '#fff', cursor: 'pointer', fontWeight: 700, marginRight: 6 }}>salvar</button>
              <button onClick={() => setPorqueEdit(null)} style={{ fontSize: fz(11), padding: '3px 10px', borderRadius: 6, border: `1px solid ${palette.beige}`, background: palette.surface, color: palette.inkMuted, cursor: 'pointer' }}>cancelar</button>
            </div>
          )}
        </div>

        {/* Fluxo de uso */}
        <div style={{ fontSize: fz(11), marginBottom: comCriativo ? 8 : 0 }}>
          <strong style={{ color: palette.inkSoft }}>Fluxo:</strong>{' '}
          {fluxoEdit === null ? (
            <>
              <span style={{ color: palette.ink }}>{t.fluxo || '(sem fluxo definido)'}</span>
              <button onClick={() => setFluxoEdit(t.fluxo || '')} style={{ marginLeft: 6, fontSize: fz(10), border: 'none', background: 'none', color: palette.accent, cursor: 'pointer', fontWeight: 700 }}>editar</button>
            </>
          ) : (
            <div style={{ marginTop: 4 }}>
              <textarea value={fluxoEdit} onChange={e => setFluxoEdit(e.target.value)} rows={2}
                style={{ width: '100%', fontSize: fz(11), fontFamily: FONT, borderRadius: 6, border: `1px solid ${palette.beige}`, padding: 6, boxSizing: 'border-box' }} />
              <button disabled={ocupado} onClick={async () => { await salvarDoc(t.name, 'fluxo', fluxoEdit); setFluxoEdit(null); }}
                style={{ fontSize: fz(11), padding: '3px 10px', borderRadius: 6, border: 'none', background: palette.accent, color: '#fff', cursor: 'pointer', fontWeight: 700, marginRight: 6 }}>salvar</button>
              <button onClick={() => setFluxoEdit(null)} style={{ fontSize: fz(11), padding: '3px 10px', borderRadius: 6, border: `1px solid ${palette.beige}`, background: palette.surface, color: palette.inkMuted, cursor: 'pointer' }}>cancelar</button>
            </div>
          )}
        </div>

        {/* Upload/troca de criativo (só nas subpastas de conteúdo) */}
        {comCriativo && (
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: fz(11),
            fontWeight: 700, color: ocupado ? palette.inkMuted : palette.accent,
            cursor: ocupado ? 'wait' : 'pointer',
          }}>
            <Upload size={sz(13)} />
            {ocupado ? 'Enviando…' : (t.criativo_url ? 'Trocar criativo' : 'Subir criativo')}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={ocupado}
              onChange={e => { subirCriativo(t.name, e.target.files?.[0]); e.target.value = ''; }}
              style={{ display: 'none' }} />
          </label>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 14, border: `1px solid ${palette.beige}`, borderRadius: 10, background: palette.bg }}>
      <button onClick={() => setAberto(a => !a)} style={{
        width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none',
        background: 'none', fontFamily: FONT, fontSize: fz(13), fontWeight: 700,
        color: palette.ink, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
      }}>
        📁 Templates {aberto ? '▾' : '▸'}
        <span style={{ fontSize: fz(10), fontWeight: 600, color: palette.inkMuted }}>
          curadoria · novidades · dicas · ativos
        </span>
      </button>
      {aberto && (
        <div style={{ padding: '0 14px 12px' }}>
          {msg && (
            <div style={{ padding: '6px 10px', marginBottom: 8, borderRadius: 6, fontSize: fz(12), background: msg.tipo === 'erro' ? palette.alertSoft : '#e7f5ec', color: msg.tipo === 'erro' ? palette.alert : '#2e7d32' }}>{msg.txt}</div>
          )}
          {!pastas ? (
            <div style={{ padding: 12, color: palette.inkMuted, fontSize: fz(12) }}>Carregando…</div>
          ) : SUBS.map(([id, titulo, sub]) => {
            const lista = pastas[id] || [];
            const abertaSub = subAberta === id;
            return (
              <div key={id} style={{ marginBottom: 6 }}>
                <button onClick={() => setSubAberta(abertaSub ? null : id)} style={{
                  width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8,
                  border: `1px solid ${palette.beige}`, background: palette.surface,
                  fontFamily: FONT, fontSize: fz(12), fontWeight: 700, color: palette.ink,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  {titulo} {abertaSub ? '▾' : '▸'}
                  <span style={{ fontSize: fz(10), fontWeight: 500, color: palette.inkMuted }}>{sub} · {lista.length}</span>
                </button>
                {abertaSub && (
                  <div style={{ padding: '8px 4px 0' }}>
                    {lista.length === 0
                      ? <div style={{ fontSize: fz(11), color: palette.inkMuted, padding: '4px 8px' }}>Nenhum template aqui ainda.</div>
                      : lista.map(t => <CardTpl key={t.name} t={t} comCriativo={id !== 'ativos'} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MidiasTab({ refreshTick }) {
  const [midias, setMidias] = useState([]);
  const [stats, setStats] = useState({ total: 0, total_bytes: 0, por_tipo: {} });
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [uploadAberto, setUploadAberto] = useState(false);
  const [loteAberto, setLoteAberto] = useState(false);
  const [editando, setEditando] = useState(null);  // midia em edicao

  const carregar = async () => {
    setLoading(true);
    setErro(null);
    try {
      const url = filtroTipo !== 'todos'
        ? `/api/lojas-whats-midia?tipo=${filtroTipo}`
        : '/api/lojas-whats-midia';
      const r = await fetch(url);
      const j = await r.json();
      if (j.error) setErro(j.error);
      else {
        setMidias(j.midias || []);
        setStats(j.stats || { total: 0, total_bytes: 0, por_tipo: {} });
      }
    } catch (e) { setErro(e.message); }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, [filtroTipo, refreshTick]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [feedback]);

  const onExcluir = async (m) => {
    if (!confirm(`Excluir ${m.nome_arquivo}? Vai liberar ${(m.size_bytes / 1024 / 1024).toFixed(1)}MB.`)) return;
    try {
      const r = await fetch(`/api/lojas-whats-midia?id=${m.id}`, { method: 'DELETE' });
      const j = await r.json();
      if (j.error) setErro(j.error);
      else {
        setFeedback({ tipo: 'ok', msg: `${m.nome_arquivo} excluida` });
        await carregar();
      }
    } catch (e) { setErro(e.message); }
  };

  const midiasFiltradas = busca
    ? midias.filter(m =>
        (m.nome_arquivo || '').toLowerCase().includes(busca.toLowerCase()) ||
        (m.ref || '').includes(busca) ||
        (m.descricao || '').toLowerCase().includes(busca.toLowerCase()))
    : midias;

  if (loading) return <div style={{ padding: 20, textAlign: 'center' }}><Loader2 size={sz(24)} className="spin" /></div>;

  const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + 'MB';

  return (
    <div style={{ padding: '12px 14px', fontFamily: FONT }}>
      {/* Pasta Templates (catálogo dos HSM: curadoria/novidades/dicas/ativos) */}
      <TemplatesCatalogo />

      {/* Header stats + botao upload */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12, gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: fz(12), color: palette.inkMuted }}>
          📦 <strong>{stats.total}</strong> mídias · {fmtMB(stats.total_bytes)} total
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setLoteAberto(true)} style={{
            background: palette.surface, color: palette.ink,
            border: `1px solid ${palette.ink}`, borderRadius: 6, padding: '6px 12px',
            fontSize: fz(12), fontWeight: 600, cursor: 'pointer',
            fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Upload size={sz(14)} /> Subir em lote
          </button>
          <button onClick={() => setUploadAberto(true)} style={{
            background: palette.ink, color: palette.bg,
            border: 'none', borderRadius: 6, padding: '6px 12px',
            fontSize: fz(12), fontWeight: 600, cursor: 'pointer',
            fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <Upload size={sz(14)} /> Subir mídia
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {[
          { id: 'todos',    label: `Todas (${stats.total})`, icon: null },
          { id: 'foto',     label: `Fotos (${stats.por_tipo?.foto || 0})`, icon: Image },
          { id: 'cores',    label: `Cores (${stats.por_tipo?.cores || 0})`, icon: Image },
          { id: 'video',    label: `Vídeos (${stats.por_tipo?.video || 0})`, icon: Video },
          { id: 'catalogo', label: `Catálogos (${stats.por_tipo?.catalogo || 0})`, icon: FileText },
        ].map(f => (
          <button key={f.id} onClick={() => setFiltroTipo(f.id)} style={{
            padding: '5px 10px', borderRadius: 14, cursor: 'pointer',
            border: `1px solid ${filtroTipo === f.id ? palette.ink : palette.beige}`,
            background: filtroTipo === f.id ? palette.ink : palette.surface,
            color: filtroTipo === f.id ? palette.bg : palette.ink,
            fontSize: fz(11), fontFamily: FONT, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            {f.icon && <f.icon size={sz(11)} />} {f.label}
          </button>
        ))}
      </div>

      {/* Busca */}
      <input type="text" placeholder="🔍 Buscar por nome, REF ou descrição..." value={busca}
        onChange={e => setBusca(e.target.value)}
        style={{
          width: '100%', padding: '7px 10px', borderRadius: 6,
          border: `1px solid ${palette.beige}`, fontSize: fz(12), fontFamily: FONT,
          marginBottom: 10, color: palette.ink, background: palette.surface,
          boxSizing: 'border-box',
        }}
      />

      {/* Feedback */}
      {(feedback || erro) && (
        <div style={{
          padding: '8px 12px', marginBottom: 10, borderRadius: 6,
          background: erro ? palette.alertSoft : '#e7f5ec',
          color: erro ? palette.alert : '#2e7d32',
          fontSize: fz(12),
        }}>
          {erro || feedback?.msg}
        </div>
      )}

      {/* Grid de midias */}
      {midiasFiltradas.length === 0 ? (
        <div style={{
          padding: 24, textAlign: 'center', color: palette.inkMuted,
          background: palette.surface, border: `1px dashed ${palette.beige}`,
          borderRadius: 8, fontSize: fz(12),
        }}>
          <Paperclip size={sz(28)} style={{ opacity: 0.3, marginBottom: 6 }} />
          <div>Nenhuma mídia cadastrada{busca ? ' pra essa busca' : ''}.</div>
          <div style={{ marginTop: 4, fontSize: fz(11), opacity: 0.7 }}>
            Clique "Subir mídia" pra adicionar.
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid', gap: 8,
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
        }}>
          {midiasFiltradas.map(m => (
            <MidiaCard key={m.id} m={m}
              onEditar={() => setEditando(m)}
              onExcluir={() => onExcluir(m)} />
          ))}
        </div>
      )}

      {/* Info regras */}
      <div style={{
        marginTop: 16, padding: 10, borderRadius: 8,
        background: '#f0f6fb', border: '1px solid #c8dae8',
        fontSize: fz(11), color: palette.inkSoft, lineHeight: 1.5,
      }}>
        <strong>📌 Como Sofia usa:</strong> auto-detecta REF do nome do arquivo
        (ex: 2655.jpg → ref 2655). Catálogos PDF são gerais. Sofia decide quando 
        enviar baseado nas regras + aprendizado (catálogo só após cliente engajar, 
        foto se cliente mencionou produto/categoria, vídeo só em fechamento).
        Excluir mídia libera espaço no Storage.
      </div>

      {/* Modal upload */}
      {uploadAberto && (
        <UploadMidiaModal
          onClose={() => setUploadAberto(false)}
          onSucesso={() => { setUploadAberto(false); carregar(); setFeedback({ tipo: 'ok', msg: 'Mídia subida com sucesso' }); }}
          onErro={(msg) => setErro(msg)}
        />
      )}

      {loteAberto && (
        <UploadLoteModal
          onClose={() => setLoteAberto(false)}
          onSucesso={(n) => { setLoteAberto(false); carregar(); setFeedback({ tipo: 'ok', msg: `${n} mídia(s) subida(s)` }); }}
          onErro={(msg) => setErro(msg)}
        />
      )}

      {/* Modal editar */}
      {editando && (
        <EditarMidiaModal
          midia={editando}
          onClose={() => setEditando(null)}
          onSucesso={() => { setEditando(null); carregar(); setFeedback({ tipo: 'ok', msg: 'Mídia atualizada' }); }}
          onErro={(msg) => setErro(msg)}
        />
      )}
    </div>
  );
}

function MidiaCard({ m, onEditar, onExcluir }) {
  const fmtMB = (b) => (b / 1024 / 1024).toFixed(1) + 'MB';
  const ehFoto = m.tipo === 'foto';
  const ehCores = m.tipo === 'cores';
  const ehVideo = m.tipo === 'video';
  const ehCatalogo = m.tipo === 'catalogo';
  return (
    <div style={{
      background: palette.surface, border: `1px solid ${palette.beige}`,
      borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        height: 100, background: '#f0f0f0', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {(ehFoto || ehCores) && m.url_publica ? (
          <img src={m.url_publica} alt={m.nome_arquivo} style={{
            width: '100%', height: '100%', objectFit: 'cover',
          }} />
        ) : (
          <div style={{ textAlign: 'center', color: palette.inkMuted }}>
            {ehVideo && <Video size={32} />}
            {ehCatalogo && <FileText size={32} />}
            {!ehFoto && !ehCores && !ehVideo && !ehCatalogo && <Paperclip size={32} />}
            <div style={{ fontSize: 10, marginTop: 4, textTransform: 'uppercase', fontWeight: 600 }}>
              {m.tipo}
            </div>
          </div>
        )}
        {m.ref && (
          <div style={{
            position: 'absolute', top: 4, left: 4,
            background: palette.ink, color: palette.bg,
            padding: '1px 6px', borderRadius: 4,
            fontSize: 10, fontWeight: 700,
          }}>
            REF {m.ref}
          </div>
        )}
      </div>
      <div style={{ padding: 6, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: palette.ink, lineHeight: 1.2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {m.nome_arquivo}
        </div>
        <div style={{ fontSize: 10, color: palette.inkMuted, marginTop: 2 }}>
          {fmtMB(m.size_bytes)}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <button onClick={onEditar} style={{
            flex: 1, background: palette.surface, color: palette.ink,
            border: `1px solid ${palette.beige}`, borderRadius: 4,
            padding: '4px 6px', fontSize: 10, cursor: 'pointer', fontFamily: FONT,
          }}>
            <Edit3 size={11} />
          </button>
          <button onClick={onExcluir} style={{
            flex: 1, background: palette.alertSoft, color: palette.alert,
            border: '1px solid ' + palette.alert, borderRadius: 4,
            padding: '4px 6px', fontSize: 10, cursor: 'pointer', fontFamily: FONT,
          }}>
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

function UploadLoteModal({ onClose, onSucesso, onErro }) {
  const [tipo, setTipo] = useState('cores');
  const [itens, setItens] = useState([]); // [{ file, previewUrl, ref, status, erro }]
  const [enviando, setEnviando] = useState(false);
  const fileRef = useRef(null);

  const LIMITES_MB = { foto: 2, cores: 4, video: 16, catalogo: 20 };
  const ACEITOS = { foto: 'image/*', cores: 'image/*', video: 'video/*', catalogo: '.pdf,image/*' };

  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const limiteMB = LIMITES_MB[tipo];
    const novos = files.map(f => {
      const m = (f.name || '').match(/(\d{3,6})/);
      const grande = f.size > limiteMB * 1024 * 1024;
      return {
        file: f,
        previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
        ref: m ? m[1] : '',
        status: grande ? 'grande' : 'pendente',
        erro: grande ? `acima de ${limiteMB}MB` : null,
      };
    });
    setItens(prev => [...prev, ...novos]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const setRefItem = (i, val) => setItens(prev => prev.map((x, j) => j === i ? { ...x, ref: val } : x));
  const remover = (i) => setItens(prev => prev.filter((_, j) => j !== i));

  const uploadUm = async (it) => {
    const USAR_DIRETO = it.file.size > 4 * 1024 * 1024;
    if (USAR_DIRETO) {
      const presignRes = await fetch('/api/lojas-whats-midia-presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, nome_arquivo: it.file.name, size_bytes: it.file.size, mime_type: it.file.type }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok || presign.error) return { ok: false, erro: presign.error || 'presign' };
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT', headers: { 'Content-Type': it.file.type, 'Authorization': `Bearer ${presign.token}`, 'x-upsert': 'false' },
        body: it.file,
      });
      if (!putRes.ok) return { ok: false, erro: 'upload ' + putRes.status };
      const regRes = await fetch('/api/lojas-whats-midia-upload?modo=register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storage_path: presign.storage_path, tipo, ref: it.ref || null, nome_arquivo: it.file.name, size_bytes: it.file.size, mime_type: it.file.type }),
      });
      const reg = await regRes.json();
      if (!regRes.ok || reg.error) return { ok: false, erro: reg.error || 'registro' };
      return { ok: true };
    }
    const fd = new FormData();
    fd.append('arquivo', it.file);
    fd.append('tipo', tipo);
    if (it.ref) fd.append('ref', it.ref);
    const r = await fetch('/api/lojas-whats-midia-upload', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok || j.error) return { ok: false, erro: j.error || 'upload' };
    return { ok: true };
  };

  const enviarTodas = async () => {
    const fila = itens.map((it, i) => ({ it, i })).filter(({ it }) => it.status === 'pendente' || it.status === 'erro');
    if (!fila.length) { onErro('Escolha as fotos primeiro'); return; }
    if (tipo === 'cores' && fila.some(({ it }) => !(it.ref || '').trim())) {
      onErro('Cada foto de cores precisa de uma ref'); return;
    }
    setEnviando(true);
    let ok = 0;
    for (const { it, i } of fila) {
      setItens(prev => prev.map((x, j) => j === i ? { ...x, status: 'enviando' } : x));
      try {
        const r = await uploadUm(it);
        setItens(prev => prev.map((x, j) => j === i ? { ...x, status: r.ok ? 'ok' : 'erro', erro: r.ok ? null : r.erro } : x));
        if (r.ok) ok++;
      } catch (e) {
        setItens(prev => prev.map((x, j) => j === i ? { ...x, status: 'erro', erro: e.message } : x));
      }
    }
    setEnviando(false);
    if (ok > 0) onSucesso(ok);
  };

  const pendentes = itens.filter(x => x.status === 'pendente' || x.status === 'erro').length;
  const faltaRef = tipo === 'cores' && itens.some(x => (x.status === 'pendente' || x.status === 'erro') && !(x.ref || '').trim());

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }} onClick={() => !enviando && onClose()}>
      <div onClick={e => e.stopPropagation()} style={{ background: palette.bg, borderRadius: 12, padding: 20,
        maxWidth: 520, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', fontFamily: FONT }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: fz(16), color: palette.ink, fontWeight: 700 }}>Subir em lote</h3>
          <button onClick={() => !enviando && onClose()} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={sz(22)} color={palette.inkMuted} />
          </button>
        </div>

        {/* Toggle tipo */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['cores', 'foto', 'video', 'catalogo'].map(t => (
            <button key={t} onClick={() => setTipo(t)} disabled={enviando} style={{
              flex: 1, padding: '7px 6px', borderRadius: 6, cursor: enviando ? 'default' : 'pointer',
              border: `1px solid ${tipo === t ? palette.accent : palette.beige}`,
              background: tipo === t ? palette.accent : palette.surface,
              color: tipo === t ? palette.bg : palette.ink,
              fontSize: fz(12), fontWeight: 600, fontFamily: FONT, textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>

        <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 10, lineHeight: 1.4 }}>
          {tipo === 'cores'
            ? 'Foto de cores = a arara com todas as cores do modelo. Escolha várias e digite a ref de cada uma (a ref é obrigatória). Se o nome do arquivo tiver número, ele já preenche sozinho.'
            : `Escolha vários arquivos de uma vez. Limite ${LIMITES_MB[tipo]}MB cada.`}
        </div>

        <input ref={fileRef} type="file" multiple accept={ACEITOS[tipo]} onChange={onPick} disabled={enviando}
          style={{ width: '100%', padding: 6, marginBottom: 12, fontFamily: FONT, fontSize: fz(12), boxSizing: 'border-box' }} />

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, marginBottom: 12 }}>
          {itens.length === 0 && (
            <div style={{ textAlign: 'center', color: palette.inkMuted, fontSize: fz(12), padding: '20px 0' }}>
              Nenhuma foto escolhida ainda
            </div>
          )}
          {itens.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
              padding: 8, background: palette.surface, borderRadius: 8, border: '1px solid #e8e2da' }}>
              {it.previewUrl
                ? <img src={it.previewUrl} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                : <div style={{ width: 46, height: 46, borderRadius: 6, background: palette.beige, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><FileText size={sz(16)} color={palette.inkMuted} /></div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <input value={it.ref} onChange={e => setRefItem(i, e.target.value)} disabled={enviando}
                  placeholder={tipo === 'catalogo' ? 'REF (opcional)' : 'Ref (ex: 3213)'} inputMode="numeric"
                  style={{ width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid #e8e2da',
                    fontFamily: FONT, fontSize: fz(13), color: palette.ink, background: palette.bg, boxSizing: 'border-box' }} />
                <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {it.file.name} · {(it.file.size / 1024 / 1024).toFixed(2)}MB
                </div>
              </div>
              <div style={{ width: 24, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                {it.status === 'ok' && <Check size={sz(16)} color={palette.ok} />}
                {it.status === 'enviando' && <Loader2 size={sz(15)} className="spin" color={palette.accent} />}
                {(it.status === 'erro' || it.status === 'grande') && <span title={it.erro} style={{ color: palette.alert, fontSize: fz(10), fontWeight: 700 }}>!</span>}
                {(it.status === 'pendente') && !enviando && (
                  <button onClick={() => remover(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: palette.alert, display: 'flex' }}>
                    <Trash2 size={sz(14)} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {faltaRef && (
          <div style={{ fontSize: fz(11), color: palette.alert, marginBottom: 8 }}>
            Falta a ref em alguma foto — preencha todas pra subir.
          </div>
        )}

        <button onClick={enviarTodas} disabled={enviando || pendentes === 0 || faltaRef}
          style={{ width: '100%', background: palette.accent, color: '#fff', border: 'none', borderRadius: 8,
            padding: 12, cursor: (enviando || pendentes === 0 || faltaRef) ? 'default' : 'pointer', fontSize: fz(14),
            fontWeight: 700, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            opacity: (enviando || pendentes === 0 || faltaRef) ? 0.6 : 1 }}>
          {enviando ? <Loader2 size={sz(16)} className="spin" /> : <Upload size={sz(15)} />}
          {enviando ? 'Subindo...' : `Subir ${pendentes || ''} foto(s)`}
        </button>
      </div>
    </div>
  );
}

function UploadMidiaModal({ onClose, onSucesso, onErro }) {
  const [tipo, setTipo] = useState('foto');
  const [arquivo, setArquivo] = useState(null);
  const [ref, setRef] = useState('');
  const [descricao, setDescricao] = useState('');
  const [enviando, setEnviando] = useState(false);

  const LIMITES_MB = { foto: 2, cores: 4, video: 16, catalogo: 20 };
  const ACEITOS = {
    foto: '.jpg,.jpeg,.png,.webp',
    // Foto de cores (arara): ref no nome do arquivo (ex: 3213.jpg). Ailson 28/06/2026.
    cores: '.jpg,.jpeg,.png,.webp',
    video: '.mp4,.mov',
    // Catalogo aceita PDF (catalogo em si) OU imagem (capa do catalogo).
    // Imagem cai em fluxo separado no backend: salva como catalogos/capa.{ext}
    // e sobrescreve a anterior. Ailson 27/05/2026.
    catalogo: '.pdf,.jpg,.jpeg,.png,.webp',
  };

  const onFileChange = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const limiteMB = LIMITES_MB[tipo];
    if (f.size > limiteMB * 1024 * 1024) {
      onErro(`Arquivo ${(f.size / 1024 / 1024).toFixed(1)}MB excede limite ${tipo} (${limiteMB}MB)`);
      return;
    }
    setArquivo(f);
    // Auto-detecta REF do nome (3C)
    const m = f.name.match(/^(\d{3,6})/);
    if (m && !ref) setRef(m[1]);
  };

  const enviar = async () => {
    if (!arquivo) { onErro('Selecione um arquivo'); return; }
    setEnviando(true);
    try {
      // Ailson 25/05/2026: catalogos PDF estouram limite 4.5MB do Vercel.
      // Pra arquivos > 4MB: fluxo 2-passos (presign + PUT direto Supabase + register).
      // Pra arquivos pequenos: fluxo classico (multipart via Vercel) — mais simples.
      const USAR_FLUXO_DIRETO = arquivo.size > 4 * 1024 * 1024;

      if (USAR_FLUXO_DIRETO) {
        // ── PASSO 1: pedir signed upload URL ──────────────────────────────
        const presignRes = await fetch('/api/lojas-whats-midia-presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipo,
            nome_arquivo: arquivo.name,
            size_bytes: arquivo.size,
            mime_type: arquivo.type,
          }),
        });
        const presign = await presignRes.json();
        if (!presignRes.ok || presign.error) {
          onErro(presign.error || 'Falha na presign'); setEnviando(false); return;
        }

        // ── PASSO 2: PUT direto no Supabase Storage (sem passar pelo Vercel) ──
        const putRes = await fetch(presign.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': arquivo.type,
            'Authorization': `Bearer ${presign.token}`,
            'x-upsert': 'false',
          },
          body: arquivo,
        });
        if (!putRes.ok) {
          const txt = await putRes.text();
          onErro('Upload direto falhou: ' + (txt || putRes.status)); setEnviando(false); return;
        }

        // ── PASSO 3: registrar metadados no banco ─────────────────────────
        const regRes = await fetch('/api/lojas-whats-midia-upload?modo=register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storage_path: presign.storage_path,
            tipo,
            ref: ref || null,
            descricao: descricao || null,
            nome_arquivo: arquivo.name,
            size_bytes: arquivo.size,
            mime_type: arquivo.type,
          }),
        });
        const reg = await regRes.json();
        if (!regRes.ok || reg.error) { onErro(reg.error || 'Erro ao registrar'); setEnviando(false); return; }
        onSucesso();
      } else {
        // ── FLUXO CLASSICO (arquivos pequenos) ─────────────────────────────
        const fd = new FormData();
        fd.append('arquivo', arquivo);
        fd.append('tipo', tipo);
        if (ref) fd.append('ref', ref);
        if (descricao) fd.append('descricao', descricao);

        const r = await fetch('/api/lojas-whats-midia-upload', { method: 'POST', body: fd });
        const j = await r.json();
        if (!r.ok || j.error) { onErro(j.error || 'Erro no upload'); return; }
        onSucesso();
      }
    } catch (e) { onErro(e.message); }
    setEnviando(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.bg, borderRadius: 12, padding: 20,
        maxWidth: 460, width: '100%', fontFamily: FONT,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: fz(16), color: palette.ink, fontWeight: 700 }}>
            Subir mídia
          </h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>
            <X size={sz(22)} color={palette.inkMuted} />
          </button>
        </div>

        {/* Toggle tipo */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {['foto', 'cores', 'video', 'catalogo'].map(t => (
            <button key={t} onClick={() => { setTipo(t); setArquivo(null); }} style={{
              flex: 1, padding: '8px 6px', borderRadius: 6, cursor: 'pointer',
              border: `1px solid ${tipo === t ? palette.accent : palette.beige}`,
              background: tipo === t ? palette.accent : palette.surface,
              color: tipo === t ? palette.bg : palette.ink,
              fontSize: fz(12), fontWeight: 600, fontFamily: FONT, textTransform: 'capitalize',
            }}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 8 }}>
          Limite: <strong>{LIMITES_MB[tipo]}MB</strong> · Formatos: {ACEITOS[tipo]}
        </div>

        <input type="file" accept={ACEITOS[tipo]} onChange={onFileChange} style={{
          width: '100%', padding: 6, marginBottom: 10,
          fontFamily: FONT, fontSize: fz(12), boxSizing: 'border-box',
        }} />

        {arquivo && (
          <div style={{
            padding: 8, background: palette.surface, borderRadius: 6,
            border: `1px solid ${palette.beige}`, marginBottom: 10,
            fontSize: fz(12),
          }}>
            <div style={{ fontWeight: 600, color: palette.ink }}>{arquivo.name}</div>
            <div style={{ color: palette.inkMuted, fontSize: fz(11), marginTop: 2 }}>
              {(arquivo.size / 1024 / 1024).toFixed(2)}MB
            </div>
          </div>
        )}

        {/* REF (opcional pra catalogo, recomendado pra foto/video) */}
        <input type="text" placeholder={tipo === 'catalogo' ? 'REF (opcional)' : 'REF do produto (ex: 2655)'}
          value={ref} onChange={e => setRef(e.target.value)}
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6,
            border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: fz(12),
            color: palette.ink, background: palette.surface, marginBottom: 8,
            boxSizing: 'border-box',
          }}
        />

        <textarea placeholder="Descrição (opcional) — ex: 'Vestido floral coleção primavera'"
          value={descricao} onChange={e => setDescricao(e.target.value)}
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6,
            border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: fz(12),
            color: palette.ink, background: palette.surface, marginBottom: 14,
            boxSizing: 'border-box', resize: 'vertical', minHeight: 60,
          }}
        />

        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onClose} disabled={enviando} style={{
            flex: 1, padding: '9px 14px', borderRadius: 6,
            background: palette.surface, color: palette.ink,
            border: `1px solid ${palette.beige}`, fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
            cursor: enviando ? 'wait' : 'pointer',
          }}>
            Cancelar
          </button>
          <button onClick={enviar} disabled={enviando || !arquivo} style={{
            flex: 1, padding: '9px 14px', borderRadius: 6,
            background: palette.ink, color: palette.bg,
            border: 'none', fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
            cursor: (enviando || !arquivo) ? 'wait' : 'pointer',
            opacity: (!arquivo) ? 0.5 : 1,
          }}>
            {enviando ? 'Subindo...' : 'Subir'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditarMidiaModal({ midia, onClose, onSucesso, onErro }) {
  const [ref, setRef] = useState(midia.ref || '');
  const [descricao, setDescricao] = useState(midia.descricao || '');
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await fetch('/api/lojas-whats-midia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: midia.id, ref, descricao }),
      });
      const j = await r.json();
      if (j.error) onErro(j.error); else onSucesso();
    } catch (e) { onErro(e.message); }
    setSalvando(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.bg, borderRadius: 12, padding: 20,
        maxWidth: 420, width: '100%', fontFamily: FONT,
      }}>
        <h3 style={{ margin: '0 0 12px', fontSize: fz(16), color: palette.ink, fontWeight: 700 }}>
          Editar mídia
        </h3>
        <div style={{ fontSize: fz(12), color: palette.inkMuted, marginBottom: 10 }}>
          {midia.nome_arquivo} · {midia.tipo}
        </div>
        <label style={{ fontSize: fz(11), color: palette.inkSoft, fontWeight: 600 }}>REF</label>
        <input type="text" value={ref} onChange={e => setRef(e.target.value)}
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6,
            border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: fz(12),
            marginBottom: 10, marginTop: 4, color: palette.ink, background: palette.surface,
            boxSizing: 'border-box',
          }}
        />
        <label style={{ fontSize: fz(11), color: palette.inkSoft, fontWeight: 600 }}>Descrição</label>
        <textarea value={descricao} onChange={e => setDescricao(e.target.value)}
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 6,
            border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: fz(12),
            marginBottom: 14, marginTop: 4, color: palette.ink, background: palette.surface,
            boxSizing: 'border-box', resize: 'vertical', minHeight: 70,
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onClose} disabled={salvando} style={{
            flex: 1, padding: '9px', borderRadius: 6,
            background: palette.surface, color: palette.ink,
            border: `1px solid ${palette.beige}`, fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
            cursor: salvando ? 'wait' : 'pointer',
          }}>
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando} style={{
            flex: 1, padding: '9px', borderRadius: 6,
            background: palette.ink, color: palette.bg, border: 'none',
            fontSize: fz(13), fontWeight: 600, fontFamily: FONT,
            cursor: salvando ? 'wait' : 'pointer',
          }}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BOTÕES (estilo compartilhado)
// ═══════════════════════════════════════════════════════════════════════════

const btnBase = {
  padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
  fontFamily: FONT, fontSize: fz(13), fontWeight: 600,
  border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const btnPrimario  = { ...btnBase, background: palette.accent, color: palette.bg };
const btnSucesso   = { ...btnBase, background: palette.ok,     color: palette.bg };
const btnAlerta    = { ...btnBase, background: palette.alert,  color: palette.bg };
const btnSecundario = { ...btnBase, background: palette.surface, color: palette.ink, border: `1px solid ${palette.beige}` };
