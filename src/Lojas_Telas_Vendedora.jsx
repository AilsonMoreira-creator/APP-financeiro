/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Lojas_Telas_Vendedora.jsx — PARTE 2A
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Telas que a vendedora vê (e admin também usa quando seleciona uma vendedora):
 *   1. HomeScreen           — entrada com 3 abas (Vendedoras / Dashboard / Config)
 *   2. CardDiaScreen        — 7 sugestões do dia
 *   3. SugestaoScreen       — sugestão expandida + ações
 *   4. MinhaCarteiraScreen  — lista de clientes com filtros + sub-tipos sacola
 *   5. DetalheClienteScreen — dados completos + apelido editável
 *   6. DestaquesScreen      — KPIs da semana da vendedora
 *   7. HistoricoCarteiraScreen — gráfico 12 meses
 *   8. ModalMensagem        — modal de gerar mensagem com IA
 *
 * Importa do Lojas.jsx (Parte 1):
 *   - hook useLojasModule (já vem com state + handlers)
 *   - tokens palette, FONT
 *   - statusMap, subtipoSacolaMap, faseClienteNovaMap
 *   - componentes Header, StatusDot, TabBar, SectionTitle, LampIcon, LojaIcon
 *
 * Adições novas (não tinha no v5):
 *   • Cards de cliente mostram badge SACOLA roxo quando tem pedido em espera
 *   • Sub-tipo da sacola aparece como badge (✨ 🎁 💛 ⏰ 🚨)
 *   • Cliente nova (≤14d) tem badge especial 👋
 *   • Apelido editável que persiste no Supabase
 *   • Botão "Pedir mensagem" chama IA real (com loading state)
 *   • ModalMensagem gerencia loading/erro/retry da API
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ArrowLeft, RefreshCw, ChevronRight, Search, Settings,
  Users, Star, Lightbulb, Check, X, Sparkles, Flame, AlertTriangle,
  MessageCircle, Pencil, Phone, Package, Tag, Copy, Pause, Calendar,
  Archive, Bot, Plus, Store, Gift, FileText, ArrowLeftRight, Download,
  TrendingUp, TrendingDown, BarChart3, UserCog, Maximize2, Filter,
  Save, Trash2, Edit3, MapPin, Clock, CheckCircle2, AlertCircle,
  Upload, FileSpreadsheet, History, Award, Heart, ChevronUp, ChevronDown, Target,
  UsersRound, Link2, Unlink2, Crown, ShoppingBag, ShoppingCart, Loader2, Send, User, Briefcase, UserCheck,
  Bell, Megaphone, BellOff, Trophy, Coins, Eye, EyeOff,
} from 'lucide-react';

// Importa primitives e tokens compartilhados (sem ciclo — Lojas_Shared.jsx
// não importa dos outros arquivos do módulo)
import {
  palette, FONT, statusMap, subtipoSacolaMap, faseClienteNovaMap,
  Header, StatusDot, TabBar, SectionTitle, LampIcon, LojaIcon,
  fz, sz, TelefoneCopiavel, FotoProdutoLojas, saudacaoHora, emojiHora, fraseDoDia,
  adminComSaudacao, supabase, spinKeyframes,
} from './Lojas_Shared.jsx';

// Aba 'Produtos' (admin only) — raio-x de produtos. Isolado em arquivo
// proprio pra nao impactar arquivos de vendedora. Sprint 05/05/2026.
import ProdutosTab from './Lojas_Telas_Produtos.jsx';

// Aba 'Carrinho' (admin + vendedoras) — leads do site Convertr.
// Onda 2 do modulo Leads Carrinho (Ailson 12/05/2026).
import CarrinhoTab, { LeadCard } from './Lojas_Carrinho.jsx';

// Modal de contexto pre-mensagem (Sprint B Trilha Win-back, 13/05/2026).
// Aberto quando IA precisa de info da vendedora antes de gerar mensagem
// (ex: trilha semana 2/3 — vendedora conta o que rolou na semana anterior).
import ContextoMensagemModal from './Lojas_ContextoMensagemModal.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS DE UI ESPECÍFICOS DAS TELAS VENDEDORA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mapa de tipo de sugestão pra ícone + cor.
 * No v5 os mocks tinham 'icone: Flame' (componente), mas como agora vem
 * do Supabase como string 'reativar', preciso resolver dinamicamente.
 */
const TIPO_SUGESTAO_VISUAL = {
  reativar: { icone: Flame, cor: palette.alert, corSoft: palette.alertSoft },
  atencao: { icone: AlertTriangle, cor: palette.warn, corSoft: palette.warnSoft },
  novidade: { icone: Sparkles, cor: palette.accent, corSoft: palette.accentSoft },
  followup: { icone: MessageCircle, cor: palette.ok, corSoft: palette.okSoft },
  // Reposição: REF que cliente compra bem voltou da oficina (28/04/2026)
  // Verde-azul pra diferenciar de novidade pura — sinal de oportunidade conhecida
  reposicao: { icone: TrendingUp, cor: palette.purple, corSoft: palette.purpleSoft },
  // sacola: 4 sub-tipos atualizados (28/04/2026)
  incentivar_acrescentar: { icone: Sparkles, cor: palette.purple, corSoft: palette.purpleSoft },
  fechar_pedido: { icone: Heart, cor: palette.ok, corSoft: palette.okSoft },
  cobranca_incisiva: { icone: Clock, cor: '#e67e22', corSoft: '#fef0e6' },
  desfazer_sacola: { icone: AlertTriangle, cor: palette.alert, corSoft: palette.alertSoft },
  // Trilha Win-back 3 semanas — Ailson 13/05/2026 (Sprint A)
  trilha_winback: { icone: RefreshCw, cor: '#9333ea', corSoft: '#f3e8ff' },
};

function visualSugestao(tipo) {
  return TIPO_SUGESTAO_VISUAL[tipo] || TIPO_SUGESTAO_VISUAL.followup;
}

/** Formata número como dinheiro brasileiro abreviado. 18400 → "R$ 18.400" */
function fmtMoeda(v) {
  if (v == null) return '—';
  return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
}

/** Formata data ISO como "28/01/2026" */
function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

/** Calcula dias entre uma data e hoje (positivo = passou). */
function diasDesde(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const hoje = new Date();
  return Math.floor((hoje - d) / 86400000);
}

/** Pega o nome de display de um cliente. */
function nomeCliente(c) {
  return c.apelido || (c.razao_social || '').split(' ').slice(0, 3).join(' ') || c.nome_fantasia || 'Cliente';
}

/** Detecta fase do ciclo de vida da cliente (≤14d = nova). */
function faseCicloVida(cliente) {
  const primeira = cliente.primeira_compra_data || cliente.kpi?.primeira_compra_data;
  if (!primeira) return 'sem_compras_ainda';
  const dias = diasDesde(primeira);
  if (dias === null) return 'sem_compras_ainda';
  if (dias < 15) return 'nova_aguardando';
  if (dias === 15) return 'nova_checkin_pronto';
  if (dias <= 30) return 'nova_em_analise';
  return 'normal';
}

function capitalizeTipo(tipo) {
  const map = {
    reativar: 'Reativar',
    atencao: 'Atenção:',
    novidade: 'Novidade pra',
    followup: 'Vamos acompanhar',
    reposicao: 'Reposição pra',
    incentivar_acrescentar: 'Sacola:',
    fechar_pedido: 'Sacola:',
    cobranca_incisiva: 'Sacola — cobrar:',
    desfazer_sacola: '🚨 Sacola antiga:',
    trilha_winback: '🔄 Trilha retorno:',
  };
  return map[tipo] || 'Sugestão pra';
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. HomeScreen — entrada do módulo
// ═══════════════════════════════════════════════════════════════════════════

export const HomeScreen = ({
  lojas,
  onSelectVendedora,
  onSelectCliente,
  onTogglePerfil,
  onAbrirHistorico,
  onNavegarConfig,
}) => {
  const { state } = lojas;
  const { isAdmin, vendedoraLogada, vendedoras, clientes } = state;

  const [activeTab, setActiveTab] = useState('vendedoras');

  const tabs = isAdmin
    ? [
        { id: 'vendedoras', label: 'Vendedoras', icon: Users },
        { id: 'carrinho', label: 'Carrinho', icon: ShoppingCart },
        { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
        { id: 'produtos', label: 'Produtos', icon: Package },
        { id: 'carteira_geral', label: 'Carteira geral', icon: Briefcase },
        { id: 'config', label: 'Config', icon: Settings },
      ]
    : [
        { id: 'vendedoras', label: 'Vendedoras', icon: Users },
        { id: 'carrinho', label: 'Carrinho', icon: ShoppingCart },
      ];

  const subtitle = state.ultimaSincronizacao
    ? `Atualizado: ${new Date(state.ultimaSincronizacao).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
    : 'Carregando…';

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title="Lojas"
        subtitle={subtitle}
        rightContent={
          <>
            {!state.online && (
              <span style={{
                fontSize: fz(12), padding: '3px 8px', borderRadius: 6,
                background: palette.warnSoft, color: palette.warn, fontWeight: 600,
              }}>
                Offline
              </span>
            )}
            {onTogglePerfil && (
              <button onClick={onTogglePerfil} style={{
                background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
                color: palette.bg, padding: '6px 10px', borderRadius: 8,
                cursor: 'pointer', fontSize: fz(13), fontFamily: FONT, fontWeight: 600, letterSpacing: 0.3,
              }}>
                {isAdmin ? '👤 Admin' : '👤 Vendedora'}
              </button>
            )}
          </>
        }
      />
      <TabBar tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
      {activeTab === 'vendedoras' && (
        <VendedorasTab
          isAdmin={isAdmin}
          vendedoras={vendedoras}
          clientes={clientes}
          vendedoraLogadaId={vendedoraLogada?.id}
          userId={state?.userId}
          onSelectVendedora={onSelectVendedora}
        />
      )}
      {activeTab === 'carrinho' && (
        <CarrinhoTab
          userId={state?.userId}
          isAdmin={isAdmin}
          vendedoraId={vendedoraLogada?.id}
          vendedoraNome={vendedoraLogada?.nome}
          onAbrirLead={(lead) => {
            // Onda 3: abrir detalhe do lead (em construção)
            console.log('[Lojas] abrir lead:', lead.id);
          }}
        />
      )}
      {activeTab === 'dashboard' && isAdmin && (
        <DashboardTab lojas={lojas} onAbrirHistorico={onAbrirHistorico} />
      )}
      {activeTab === 'produtos' && isAdmin && (
        <ProdutosTab userId={state?.userId} />
      )}
      {activeTab === 'carteira_geral' && isAdmin && (
        <CarteiraGeralTab
          lojas={lojas}
          onSelectCliente={(c) => onSelectCliente && onSelectCliente(c, 'home')}
        />
      )}
      {activeTab === 'config' && isAdmin && (
        <ConfigTab lojas={lojas} onNavegar={onNavegarConfig} />
      )}
    </div>
  );
};

// ─── VendedorasTab ─────────────────────────────────────────────────────────

const VendedorasTab = ({ isAdmin, vendedoras, clientes, vendedoraLogadaId, userId, onSelectVendedora }) => {
  const porLoja = useMemo(() => {
    const grupos = {};
    for (const v of vendedoras) {
      const loja = v.loja || 'Sem loja';
      if (!grupos[loja]) grupos[loja] = [];
      const qtdClientes = clientes.filter(c => c.vendedora_id === v.id).length;
      grupos[loja].push({ ...v, qtdClientes });
    }
    return grupos;
  }, [vendedoras, clientes]);

  const ordemLojas = ['Silva Teles', 'Bom Retiro', ...Object.keys(porLoja).filter(l => l !== 'Bom Retiro' && l !== 'Silva Teles')];

  const VendedoraCard = ({ v }) => {
    const isCurrent = !isAdmin && v.id === vendedoraLogadaId;
    const isClickable = isAdmin || isCurrent;
    const isPlaceholder = (v.nome || '').toLowerCase().startsWith('vendedora_');
    const status = v.ativa ? 'ok' : 'alert';

    if (isPlaceholder) {
      return (
        <button onClick={() => isAdmin && onSelectVendedora && onSelectVendedora(v)} style={{
          background: 'transparent', border: `1.5px dashed ${palette.beige}`,
          borderRadius: 12, padding: 18, width: '100%', textAlign: 'center',
          cursor: isAdmin ? 'pointer' : 'default', fontFamily: FONT, color: palette.inkMuted,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: fz(15),
        }}>
          <Plus size={sz(18)} />
          <span>Slot disponível ({v.loja})</span>
        </button>
      );
    }

    return (
      <button
        onClick={() => isClickable && onSelectVendedora(v)}
        disabled={!isClickable}
        style={{
          background: isCurrent ? palette.beigeSoft : palette.surface,
          border: isCurrent ? `2px solid ${palette.accent}` : `1px solid ${palette.beige}`,
          borderRadius: 12, padding: 14, width: '100%', textAlign: 'left',
          cursor: isClickable ? 'pointer' : 'default', fontFamily: FONT,
          opacity: !isAdmin && !isCurrent ? 0.45 : 1,
          boxShadow: isCurrent ? '0 2px 8px rgba(74,127,165,0.15)' : '0 1px 3px rgba(44,62,80,0.04)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: isCurrent ? palette.accentSoft : palette.beigeSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Users size={sz(25)} color={isCurrent ? palette.accent : palette.inkSoft} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: fz(18), fontWeight: 600, color: palette.ink }}>{v.nome}</span>
            <StatusDot status={status} />
            {v.padrao && <Star size={sz(14)} color={palette.yellow} fill={palette.yellow} />}
            {isCurrent && (
              <span style={{ fontSize: fz(12), color: palette.accent, fontWeight: 600, background: palette.accentSoft, padding: '2px 7px', borderRadius: 4, letterSpacing: 0.3 }}>VOCÊ</span>
            )}
          </div>
          <div style={{ fontSize: fz(14), color: palette.inkMuted, marginBottom: 6 }}>{v.loja}</div>
          <div style={{ fontSize: fz(15), color: palette.inkSoft }}>
            {v.qtdClientes} {v.qtdClientes === 1 ? 'cliente' : 'clientes'}
          </div>
        </div>
        {isClickable && <ChevronRight size={sz(21)} color={palette.inkMuted} />}
      </button>
    );
  };

  const GroupHeader = ({ title, count }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px', marginBottom: 10 }}>
      <LojaIcon size={sz(23)} />
      <span style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink, letterSpacing: 0.5, textTransform: 'uppercase' }}>{title}</span>
      <span style={{ fontSize: fz(13), color: palette.inkMuted, fontWeight: 400 }}>· {count} {count === 1 ? 'vendedora' : 'vendedoras'}</span>
    </div>
  );

  const minhaVendedora = vendedoras.find(v => v.id === vendedoraLogadaId);

  // Tamara é admin mas vê o card de saudação (decisão Ailson 28/04/2026).
  // Lista de admins que também recebem saudação fica em ADMINS_QUE_VEEM_SAUDACAO
  // dentro de Lojas_Shared.jsx (hoje só Tamara).
  const adminEspecial = isAdmin ? adminComSaudacao() : null;
  const nomeExibicao = minhaVendedora?.nome || adminEspecial?.nome || null;
  const seedSaudacao = minhaVendedora?.id || adminEspecial?.seed || null;
  const mostrarSaudacao = (!isAdmin && minhaVendedora) || Boolean(adminEspecial);

  return (
    <div style={{ padding: 16 }}>
      {mostrarSaudacao && nomeExibicao && (
        <div style={{
          background: `linear-gradient(135deg, ${palette.accentSoft} 0%, ${palette.bg} 100%)`,
          borderRadius: 12, padding: 14, marginBottom: 18,
          border: `1px solid ${palette.accent}30`,
          color: palette.ink, lineHeight: 1.5,
        }}>
          <div style={{ fontSize: fz(18), fontWeight: 700, marginBottom: 4 }}>
            {saudacaoHora()}, {nomeExibicao.split(' ')[0]}! {emojiHora()}
          </div>
          <div style={{
            fontSize: fz(15), color: palette.inkSoft, fontStyle: 'italic', marginBottom: 8,
          }}>
            {fraseDoDia(seedSaudacao)}
          </div>
          <div style={{ fontSize: fz(14), color: palette.inkSoft }}>
            Toque no seu card pra ver suas sugestões de hoje.
          </div>
        </div>
      )}

      {/* Card "Minha meta" — só pra vendedora (admin já vê tudo no Dashboard).
          Sprint A 04/05/2026. */}
      {!isAdmin && minhaVendedora && (
        <CardMinhaMetaHome vendedora={minhaVendedora} userId={userId || ''} />
      )}

      {ordemLojas.map(loja => {
        const lista = porLoja[loja];
        if (!lista || lista.length === 0) return null;
        return (
          <div key={loja} style={{ marginBottom: 24 }}>
            <GroupHeader title={loja} count={lista.length} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lista.map(v => <VendedoraCard key={v.id} v={v} />)}
            </div>
          </div>
        );
      })}

      {vendedoras.length === 0 && (
        <div style={{
          padding: 32, textAlign: 'center', color: palette.inkMuted, fontSize: fz(15),
          background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12,
        }}>
          Nenhuma vendedora cadastrada ainda.
        </div>
      )}
    </div>
  );
};

// ─── CardMinhaMetaHome — visível só pra vendedora na HomeScreen ────────────
//
// Sprint A 04/05/2026. Linha clicável abaixo da saudação, com:
//   - Barra de meta com checkpoints (mesmo visual do CardMetas admin)
//   - Botão olho 👁️ pra esconder/mostrar (preferência salva em localStorage)
//   - Click na linha abre ModalMetaIndividual completo
//
// Visível só pra vendedoras (NÃO pra admin — admin já vê tudo no Dashboard).
//
const CardMinhaMetaHome = ({ vendedora, userId }) => {
  // Preferência persistida: ela fechou alguma vez? Se sim, fica fechado.
  const STORAGE_KEY = `lojas_meta_home_visivel_${vendedora?.id || 'x'}`;
  const [visivel, setVisivel] = useState(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === null ? true : v === '1';
    } catch { return true; }
  });
  const [mostrarModal, setMostrarModal] = useState(false);
  const [data, setData] = useState(null);
  const [carregando, setCarregando] = useState(true);

  const BONUS_BR = [70000, 80000, 90000, 100000];
  const BONUS_ST = [70000, 140000];
  const bonus = vendedora?.loja === 'Silva Teles' ? BONUS_ST : BONUS_BR;

  // Toggle visibilidade — salva pra próximas sessões
  const toggleVisivel = (e) => {
    e.stopPropagation();
    const novo = !visivel;
    setVisivel(novo);
    try { localStorage.setItem(STORAGE_KEY, novo ? '1' : '0'); } catch {}
  };

  // Carrega dados quando visivel
  useEffect(() => {
    if (!visivel || !vendedora?.id) return;
    let cancelado = false;
    setCarregando(true);
    fetch('/api/lojas-ia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User': userId || '' },
      body: JSON.stringify({
        action: 'metas_dashboard',
        periodo: 'mes_atual',
        vendedora_id: vendedora.id,
      }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelado) { setData(d); setCarregando(false); } })
      .catch(() => { if (!cancelado) setCarregando(false); });
    return () => { cancelado = true; };
  }, [visivel, vendedora?.id, userId]);

  // Modo escondido: linha super fina só com olho fechado pra reabrir
  if (!visivel) {
    return (
      <div
        onClick={toggleVisivel}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '10px 14px', marginBottom: 14,
          background: palette.surface, border: `1px dashed ${palette.beige}`,
          borderRadius: 10, fontFamily: FONT, cursor: 'pointer',
          color: palette.inkMuted, fontSize: fz(12),
        }}
        title="Mostrar minha meta"
      >
        <EyeOff size={sz(14)} />
        <span>Minha meta (oculta — toque pra mostrar)</span>
      </div>
    );
  }

  const minhaVenda = (data?.vendedoras || []).find(v => v.vendedora_id === vendedora?.id);
  const total = minhaVenda?.total ?? 0;

  return (
    <>
      <div
        onClick={() => setMostrarModal(true)}
        style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderRadius: 12, padding: '12px 16px', marginBottom: 14,
          fontFamily: FONT, cursor: 'pointer',
          transition: 'transform 0.1s',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: carregando || !minhaVenda ? 0 : 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Coins size={sz(16)} color={palette.warn} />
            <span style={{ fontSize: fz(14), fontWeight: 700, color: palette.inkSoft, letterSpacing: 0.3 }}>
              Minha meta
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {!carregando && minhaVenda && (
              <span style={{
                fontSize: fz(15), fontWeight: 700,
                color: total >= (minhaVenda.meta_principal || 0) ? palette.ok : palette.accent,
              }}>
                R$ {Math.round(total).toLocaleString('pt-BR')}
              </span>
            )}
            <button
              onClick={toggleVisivel}
              style={{
                background: 'transparent', border: 'none',
                cursor: 'pointer', padding: 4, marginLeft: 4,
                color: palette.inkMuted, display: 'flex', alignItems: 'center',
              }}
              title="Esconder minha meta"
            >
              <Eye size={sz(15)} />
            </button>
            <ChevronRight size={sz(16)} color={palette.inkMuted} />
          </div>
        </div>
        {/* Barra de meta inline (compacta — mesmo visual do CardMetas) */}
        {carregando ? (
          <div style={{ fontSize: fz(11), color: palette.inkMuted, padding: '4px 0' }}>
            <Loader2 size={sz(12)} style={{ ...spinKeyframes, marginRight: 4, verticalAlign: 'middle' }} />
            Carregando...
          </div>
        ) : minhaVenda && (
          <BarraMetaVendedora v={minhaVenda} metasBonus={bonus} mostrarNome={false} />
        )}
      </div>
      {mostrarModal && (
        <ModalMetaIndividual
          vendedora={vendedora}
          userId={userId}
          onClose={() => setMostrarModal(false)}
        />
      )}
    </>
  );
};

// ─── BarraMetaVendedora — barra com escala fixa em R$ + checkpoints ────────
//
// Sprint A 04/05/2026. Barra horizontal com escala absoluta (não %):
//   - BR: 0 → 100k, marcas em 35/50/60/70/80/90/100k
//   - ST: 0 → 140k, marcas em 60/70/80/90/100/140k
//   - Estrelas ⭐ nos checkpoints com bônus (BR: 70/80/90; ST: 70)
//   - Saco de ouro 💰 na meta máxima (BR 100k, ST 140k)
//   - Quando passa da meta, mostra "+R$ X mil acima da meta 🚀"
//
// Props:
//   - vendedora: { nome, total, meta_principal, checkpoints_loja,
//                  checkpoints_batidos }
//   - METAS_BONUS: array de checkpoints que dão bônus (pra estrela)
//
const BarraMetaVendedora = ({ v, metasBonus, mostrarNome = true }) => {
  // fmtK pra labels dos checkpoints na barra (curto, sem R$, ja contextual).
  // Decisao Ailson 05/05/2026: tirar 'R$' das labels — sobrepunham no celular.
  const fmtK = (n) => Math.round(n / 1000) + 'k';
  const fmtMoney = (n) => 'R$ ' + Math.round(n).toLocaleString('pt-BR');
  const meta = v.meta_principal;
  const total = v.total;
  const pct = Math.min(100, (total / meta) * 100);
  const passouMeta = total > meta;
  const excedente = total - meta;
  // Checkpoints excluindo o final (que vira 💰)
  const intermediarios = (v.checkpoints_loja || []).filter(c => c < meta);
  return (
    <div style={{ marginBottom: 22, paddingLeft: 12, paddingRight: 30, overflow: 'visible' }}>
      {/* Linha do nome + valor atual */}
      {mostrarNome && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: fz(14), fontWeight: 700, color: palette.ink }}>{v.nome}</span>
          <span style={{ fontSize: fz(14), fontWeight: 700, color: passouMeta ? palette.ok : palette.accent }}>
            {fmtMoney(total)}
          </span>
        </div>
      )}
      {/* Barra com escala fixa — altura compacta (14px) */}
      <div style={{ position: 'relative', height: 14, background: palette.beigeSoft,
        borderRadius: 7, border: `1px solid ${palette.beige}` }}>
        {/* Preenchimento */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: passouMeta
            ? `linear-gradient(90deg, ${palette.ok} 0%, #34a96f 100%)`
            : `linear-gradient(90deg, ${palette.accent} 0%, #6a9bc0 100%)`,
          borderRadius: 7, transition: 'width 0.4s ease',
        }} />
        {/* Marcadores intermediários */}
        {intermediarios.map(cp => {
          const x = (cp / meta) * 100;
          const batido = total >= cp;
          const ehBonus = (metasBonus || []).includes(cp);
          return (
            <div key={cp} style={{
              position: 'absolute', left: `${x}%`, top: -2, bottom: -2,
              transform: 'translateX(-50%)',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              pointerEvents: 'none',
            }}>
              <div style={{
                width: 2, height: 18, background: batido ? palette.ok : '#d4cabd',
                opacity: batido ? 0.9 : 0.6,
              }} />
              {ehBonus && (
                <div style={{
                  position: 'absolute', top: -14, fontSize: 11,
                  filter: batido ? 'none' : 'grayscale(60%) opacity(0.45)',
                }}>⭐</div>
              )}
            </div>
          );
        })}
        {/* Marcador da meta máxima (saco de ouro) — apagado se nao bateu */}
        <div style={{
          position: 'absolute', right: 0, top: -2, bottom: -2,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            width: 3, height: 18, background: passouMeta ? palette.ok : '#d4cabd',
            opacity: passouMeta ? 1 : 0.7,
          }} />
          <div style={{
            position: 'absolute', top: -16, right: -4, fontSize: 14,
            filter: passouMeta ? 'none' : 'grayscale(60%) opacity(0.45)',
          }}>💰</div>
        </div>
      </div>
      {/* Labels embaixo dos checkpoints — somente nos checkpoints com BONUS
          (decisao Ailson 05/05/2026: tirar valores sobrepostos no mobile.
          Bom Retiro tem 7 checkpoints num espaco pequeno → labels apertados.
          Solucao: tick na barra pra todos, label so nos com bonus). */}
      <div style={{ position: 'relative', height: 14, marginTop: 4 }}>
        {intermediarios.filter(cp => (metasBonus || []).includes(cp)).map(cp => {
          const x = (cp / meta) * 100;
          const batido = total >= cp;
          return (
            <span key={cp} style={{
              position: 'absolute', left: `${x}%`, transform: 'translateX(-50%)',
              fontSize: fz(9), color: batido ? palette.ok : '#b0a89c',
              fontWeight: batido ? 700 : 500, whiteSpace: 'nowrap',
            }}>{fmtK(cp)}</span>
          );
        })}
        <span style={{
          position: 'absolute', right: 0, transform: 'translateX(50%)',
          fontSize: fz(9),
          color: passouMeta ? palette.ok : '#b0a89c',
          fontWeight: passouMeta ? 700 : 500, whiteSpace: 'nowrap',
        }}>{fmtK(meta)}</span>
      </div>
      {/* Indicador acima da meta */}
      {passouMeta && (
        <div style={{ marginTop: 4, fontSize: fz(11), color: palette.ok, fontWeight: 600 }}>
          +{fmtMoney(excedente)} acima da meta 🚀
        </div>
      )}
    </div>
  );
};

// ─── CardMetas — Dashboard admin (Sprint A 04/05/2026) ─────────────────────
//
// Card admin no Dashboard que mostra progresso de meta de TODAS as
// vendedoras ativas no mês corrente. Le de /api/lojas-ia action='metas_dashboard'.
// Atualiza ao abrir o Dashboard (montagem do componente).
//
const CardMetas = ({ lojas }) => {
  const [periodo, setPeriodo] = useState('mes_atual');
  const [data, setData] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [verHistorico, setVerHistorico] = useState(false);
  const [expandido, setExpandido] = useState(false);  // card comeca FECHADO
  const userId = lojas?.state?.userId || '';
  // Constantes de bonus (espelho do backend api/lojas-ia.js handleMetasDashboard)
  const BONUS_BR = [70000, 80000, 90000, 100000];
  const BONUS_ST = [70000, 140000];

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    fetch('/api/lojas-ia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User': userId },
      body: JSON.stringify({ action: 'metas_dashboard', periodo }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelado) { setData(d); setCarregando(false); } })
      .catch(e => { if (!cancelado) { setErro(e.message || 'Erro'); setCarregando(false); } });
    return () => { cancelado = true; };
  }, [periodo, userId]);

  // Gera lista de meses anteriores (ate 6 meses pra tras a partir de mes corrente)
  const mesesAnteriores = useMemo(() => {
    const lista = [];
    const hoje = new Date();
    for (let i = 1; i <= 6; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      const ano = d.getFullYear();
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const label = d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
        .replace(/^\w/, c => c.toUpperCase());
      lista.push({ id: `${ano}-${mes}`, label });
    }
    return lista;
  }, []);

  const vendedorasBR = (data?.vendedoras || []).filter(v => v.loja === 'Bom Retiro');
  const vendedorasST = (data?.vendedoras || []).filter(v => v.loja === 'Silva Teles');
  const totalGeral = (data?.loja_BR?.total || 0) + (data?.loja_ST?.total || 0);

  return (
    <div style={{
      width: '100%', background: palette.surface, border: `1px solid ${palette.beige}`,
      borderRadius: 12, marginBottom: 12, fontFamily: FONT, overflow: 'hidden',
    }}>
      {/* Cabecalho clicavel (expande/colapsa) */}
      <div
        onClick={() => setExpandido(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          padding: '14px 18px',
          borderBottom: expandido ? `1px solid ${palette.beige}` : 'none',
        }}
      >
        <Trophy size={sz(15)} color={palette.warn} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: fz(13), color: palette.inkSoft, letterSpacing: 0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Metas das vendedoras · {data?.periodo_label || '...'}
          </div>
          {!carregando && !erro && (
            <div style={{ fontSize: fz(15), fontWeight: 700, color: palette.ink, marginTop: 2 }}>
              R$ {Math.round(totalGeral).toLocaleString('pt-BR')}
            </div>
          )}
        </div>
        {expandido ? <ChevronUp size={sz(18)} color={palette.inkMuted} /> : <ChevronDown size={sz(18)} color={palette.inkMuted} />}
      </div>

      {/* Corpo (so quando expandido) */}
      {expandido && (
      <div style={{ padding: '14px 18px' }}>
        {/* Botao Ver meses anteriores */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setVerHistorico(v => !v); }}
            style={{
              background: 'transparent', color: palette.accent,
              border: `1px solid ${palette.beige}`, borderRadius: 6,
              padding: '3px 9px', fontSize: fz(11), fontFamily: FONT,
              fontWeight: 500, cursor: 'pointer',
            }}
          >
            {verHistorico ? '✕ Fechar' : 'Ver meses anteriores'}
          </button>
        </div>

      {/* Seletor de meses anteriores (só quando aberto) */}
      {verHistorico && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
          <button
            onClick={() => setPeriodo('mes_atual')}
            style={{
              background: periodo === 'mes_atual' ? palette.accent : 'transparent',
              color: periodo === 'mes_atual' ? 'white' : palette.inkSoft,
              border: `1px solid ${periodo === 'mes_atual' ? palette.accent : palette.beige}`,
              borderRadius: 6, padding: '3px 9px',
              fontSize: fz(11), fontFamily: FONT, fontWeight: 500, cursor: 'pointer',
            }}
          >Mês atual</button>
          {mesesAnteriores.map(m => (
            <button
              key={m.id}
              onClick={() => setPeriodo(m.id)}
              style={{
                background: periodo === m.id ? palette.accent : 'transparent',
                color: periodo === m.id ? 'white' : palette.inkSoft,
                border: `1px solid ${periodo === m.id ? palette.accent : palette.beige}`,
                borderRadius: 6, padding: '3px 9px',
                fontSize: fz(11), fontFamily: FONT, fontWeight: 500, cursor: 'pointer',
              }}
            >{m.label}</button>
          ))}
        </div>
      )}

      {carregando ? (
        <div style={{ fontSize: fz(13), color: palette.inkMuted, padding: '8px 0' }}>
          <Loader2 size={sz(14)} style={{ ...spinKeyframes, marginRight: 6, verticalAlign: 'middle' }} />
          Carregando...
        </div>
      ) : erro ? (
        <div style={{ fontSize: fz(13), color: palette.alert, padding: '8px 0' }}>
          Erro: {erro}
        </div>
      ) : (
        <div>
          {/* Bom Retiro */}
          {vendedorasBR.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <div style={{
                fontSize: fz(12), fontWeight: 700, color: palette.inkSoft,
                marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase',
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              }}>
                <span>🏪 Bom Retiro</span>
                <span style={{ fontWeight: 600, color: palette.ink, textTransform: 'none', letterSpacing: 0 }}>
                  Total: R$ {Math.round(data.loja_BR?.total || 0).toLocaleString('pt-BR')}
                </span>
              </div>
              {vendedorasBR.map(v => (
                <BarraMetaVendedora key={v.vendedora_id} v={v} metasBonus={BONUS_BR} />
              ))}
            </div>
          )}
          {/* Silva Teles */}
          {vendedorasST.length > 0 && (
            <div>
              <div style={{
                fontSize: fz(12), fontWeight: 700, color: palette.inkSoft,
                marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase',
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              }}>
                <span>🏪 Silva Teles</span>
                <span style={{ fontWeight: 600, color: palette.ink, textTransform: 'none', letterSpacing: 0 }}>
                  Total: R$ {Math.round(data.loja_ST?.total || 0).toLocaleString('pt-BR')}
                </span>
              </div>
              {vendedorasST.map(v => (
                <BarraMetaVendedora key={v.vendedora_id} v={v} metasBonus={BONUS_ST} />
              ))}
            </div>
          )}
          {vendedorasBR.length === 0 && vendedorasST.length === 0 && (
            <div style={{ fontSize: fz(13), color: palette.inkMuted, padding: '8px 0' }}>
              Sem vendas registradas no período.
            </div>
          )}
        </div>
      )}
      </div>
      )}
    </div>
  );
};

// ─── ModalMetaIndividual — botão 💰 na carteira da vendedora ───────────────
//
// Quando vendedora clica 💰 no header da carteira, vê o progresso DELA.
// Sprint A 04/05/2026.
//
const ModalMetaIndividual = ({ vendedora, userId, onClose }) => {
  const [data, setData] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const BONUS_BR = [70000, 80000, 90000, 100000];
  const BONUS_ST = [70000, 140000];
  const bonus = vendedora?.loja === 'Silva Teles' ? BONUS_ST : BONUS_BR;

  useEffect(() => {
    let cancelado = false;
    fetch('/api/lojas-ia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User': userId || '' },
      body: JSON.stringify({
        action: 'metas_dashboard',
        periodo: 'mes_atual',
        vendedora_id: vendedora?.id,
      }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelado) { setData(d); setCarregando(false); } })
      .catch(e => { if (!cancelado) { setErro(e.message || 'Erro'); setCarregando(false); } });
    return () => { cancelado = true; };
  }, [vendedora?.id, userId]);

  // Aqui filtra a vendedora especifica (a API retorna lista mas filtramos local)
  const minhaVenda = (data?.vendedoras || []).find(v => v.vendedora_id === vendedora?.id);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.5)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.surface, borderRadius: '16px 16px 0 0',
        padding: 20, width: '100%', maxWidth: 500, maxHeight: '85vh',
        overflowY: 'auto', fontFamily: FONT,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Coins size={sz(20)} color={palette.warn} />
            <div>
              <div style={{ fontSize: fz(17), fontWeight: 700, color: palette.ink }}>
                Sua meta · {data?.periodo_label || '...'}
              </div>
              <div style={{ fontSize: fz(12), color: palette.inkSoft }}>
                {vendedora?.loja}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: palette.inkSoft, padding: 4,
          }}><X size={sz(20)} /></button>
        </div>

        {carregando ? (
          <div style={{ fontSize: fz(13), color: palette.inkMuted, padding: '8px 0' }}>
            <Loader2 size={sz(14)} style={{ ...spinKeyframes, marginRight: 6, verticalAlign: 'middle' }} />
            Carregando seus dados...
          </div>
        ) : erro ? (
          <div style={{ fontSize: fz(13), color: palette.alert, padding: '8px 0' }}>
            Erro: {erro}
          </div>
        ) : !minhaVenda ? (
          <div style={{ fontSize: fz(13), color: palette.inkMuted, padding: '8px 0' }}>
            Sem vendas registradas neste mês.
          </div>
        ) : (
          <div>
            {/* Resumo numerico */}
            <div style={{
              background: palette.beigeSoft, borderRadius: 10, padding: 12, marginBottom: 16,
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
            }}>
              <div>
                <div style={{ fontSize: fz(10), color: palette.inkSoft, textTransform: 'uppercase' }}>Atacado</div>
                <div style={{ fontSize: fz(14), fontWeight: 700, color: palette.ink }}>
                  R$ {Math.round(minhaVenda.atacado).toLocaleString('pt-BR')}
                </div>
              </div>
              <div>
                <div style={{ fontSize: fz(10), color: palette.inkSoft, textTransform: 'uppercase' }}>Varejo</div>
                <div style={{ fontSize: fz(14), fontWeight: 700, color: palette.ink }}>
                  R$ {Math.round(minhaVenda.varejo).toLocaleString('pt-BR')}
                </div>
              </div>
              <div>
                <div style={{ fontSize: fz(10), color: palette.inkSoft, textTransform: 'uppercase' }}>Total</div>
                <div style={{ fontSize: fz(14), fontWeight: 700, color: palette.accent }}>
                  R$ {Math.round(minhaVenda.total).toLocaleString('pt-BR')}
                </div>
              </div>
            </div>
            <BarraMetaVendedora v={minhaVenda} metasBonus={bonus} mostrarNome={false} />
          </div>
        )}
      </div>
    </div>
  );
};

// ─── CardConversoes — KPI no Dashboard ─────────────────────────────────────
//
// Card mesmo tamanho/layout do "Carteira ativa total". Mostra:
//   - Total de conversões no período (mensagens atencao/semAtividade/inativo
//     que viraram venda em até 15 dias)
//   - Valor total convertido
//   - Breakdown por status (atenção / sem atividade / inativo)
//   - Filtros: mês atual (default) | últimos 7d | mês passado
//
const CardConversoes = ({ lojas }) => {
  const [periodo, setPeriodo] = useState('mes_atual');
  const [data, setData] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    fetch('/api/lojas-ia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'conversoes_dashboard', periodo }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelado) { setData(d); setCarregando(false); } })
      .catch(e => { if (!cancelado) { setErro(e.message || 'Erro'); setCarregando(false); } });
    return () => { cancelado = true; };
  }, [periodo]);

  const PERIODOS = [
    { id: 'mes_atual',   label: 'Mês atual' },
    { id: '7d',          label: 'Últimos 7d' },
    { id: 'mes_passado', label: 'Mês passado' },
  ];

  const total = data?.total ?? 0;
  const valor = data?.valor_total ?? 0;
  const ps = data?.por_status || { atencao: 0, semAtividade: 0, inativo: 0 };
  const po = data?.por_origem || { cliente: { total: 0, valor: 0 }, lead_carrinho: { total: 0, valor: 0, site: 0, manual: 0 } };
  const fmtMoney = (v) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <div style={{
      width: '100%', background: palette.surface, border: `1px solid ${palette.beige}`,
      borderRadius: 12, padding: '14px 16px', marginBottom: 12, fontFamily: FONT,
      boxSizing: 'border-box', overflow: 'hidden', maxWidth: '100%',
    }}>
      {/* Header: titulo + filtros. Em telas estreitas, filtros vao pra
          linha de baixo automaticamente (flexWrap). */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10,
        flexWrap: 'wrap', rowGap: 6,
      }}>
        <TrendingUp size={sz(15)} color={palette.ok} />
        <span style={{ fontSize: fz(13), color: palette.inkSoft, letterSpacing: 0.3, flex: '1 1 auto', minWidth: 100 }}>
          Conversões
        </span>
        {/* Filtros de período */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {PERIODOS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriodo(p.id)}
              style={{
                background: periodo === p.id ? palette.accent : 'transparent',
                color: periodo === p.id ? 'white' : palette.inkSoft,
                border: `1px solid ${periodo === p.id ? palette.accent : palette.beige}`,
                borderRadius: 6, padding: '3px 9px',
                fontSize: fz(11), fontFamily: FONT, fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {carregando ? (
        <div style={{ fontSize: fz(13), color: palette.inkMuted, padding: '8px 0' }}>
          <Loader2 size={sz(14)} style={{ ...spinKeyframes, marginRight: 6, verticalAlign: 'middle' }} />
          Carregando...
        </div>
      ) : erro ? (
        <div style={{ fontSize: fz(12), color: palette.alert, padding: '6px 0' }}>
          {erro}
        </div>
      ) : (
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 14,
          rowGap: 10,
        }}>
          <div>
            <div style={{ fontSize: fz(28), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>
              {total}
            </div>
            <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              total
            </div>
          </div>
          <KpiSlice cor={palette.ok}     valor={fmtMoney(valor)}       label="convertido" />
          <KpiSlice cor={palette.warn}   valor={ps.atencao || 0}       label="atenção" />
          <KpiSlice cor="#d4a017"        valor={ps.semAtividade || 0}  label="+3M" />
          <KpiSlice cor="#e67e22"        valor={ps.inativo || 0}       label="+6M" />
          {/* 🛒 Carrinho — conversões automáticas via cruzamento Miré ↔ leads.
              Mostra qtd + valor + quebra site/manual. Ailson 13/05/2026. */}
          {(po.lead_carrinho?.total || 0) > 0 && (
            <KpiSlice
              cor={palette.accent}
              valor={`${po.lead_carrinho.total} · ${fmtMoney(po.lead_carrinho.valor)}`}
              label={`🛒 carrinho (${po.lead_carrinho.site || 0} site · ${po.lead_carrinho.manual || 0} whats)`}
            />
          )}
        </div>
      )}
    </div>
  );
};

// ─── CardVestiAuditoria — admin Dashboard ──────────────────────────────────
//
// Sprint Ailson 05/05/2026: 'fico no escuro... qtos clientes ela encontrou,
// ta chamando mesmo, o filtro ta certo'.
//
// Mostra:
//   - Total clientes Vesti (canal_dominante='vesti_dominante')
//   - Por loja BR/ST
//   - Por vendedora (com indicador se ela tem link Vesti cadastrado)
//   - Por status (ativo, atencao, semAtividade, inativo)
//   - Sugestoes IA dos ultimos 30d pra clientes Vesti (total + % com link)
//   - Mensagens enviadas dos ultimos 30d
//
// Card eh fechado por default; clica pra expandir.
//
const CardVestiAuditoria = ({ userId }) => {
  const [data, setData] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [expandido, setExpandido] = useState(false);
  const [aba, setAba] = useState('vendedoras'); // 'vendedoras' | 'clientes'

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    fetch('/api/lojas-vesti-auditoria', {
      headers: { 'X-User': userId || 'ailson' },
    })
      .then(r => r.json().then(d => ({ ok: r.ok, status: r.status, data: d })))
      .then(({ ok, status, data: d }) => {
        if (cancelado) return;
        if (!ok) {
          setErro(d?.error || `HTTP ${status}`);
          setCarregando(false);
          return;
        }
        // Garante que estrutura sempre existe (defesa contra resposta parcial)
        setData({
          total_clientes: d?.total_clientes || 0,
          por_loja: d?.por_loja || {},
          por_vendedora: d?.por_vendedora || [],
          por_status: d?.por_status || {},
          clientes: d?.clientes || [],
          sugestoes_30d: d?.sugestoes_30d || { total: 0, com_link_ou_catalogo: 0, executadas: 0, pct_com_link: 0 },
          mensagens_enviadas_30d: d?.mensagens_enviadas_30d || 0,
        });
        setCarregando(false);
      })
      .catch(e => { if (!cancelado) { setErro(e.message || 'Erro'); setCarregando(false); } });
    return () => { cancelado = true; };
  }, []);

  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
  const fz = (n) => mobile ? Math.max(10, n - 1) : n;
  const sz = (n) => mobile ? Math.max(12, n - 2) : n;

  return (
    <div style={{
      background: palette.surface, borderRadius: 12,
      border: `1px solid ${palette.beige}`, padding: '14px 16px',
      marginBottom: 14,
      boxSizing: 'border-box', overflow: 'hidden', maxWidth: '100%',
    }}>
      {/* Header clicavel */}
      <div onClick={() => setExpandido(e => !e)} style={{
        display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
        flexWrap: 'wrap', rowGap: 6,
      }}>
        <Link2 size={sz(15)} color={palette.purple || '#8b5cf6'} />
        <span style={{ fontSize: fz(13), color: palette.inkSoft, letterSpacing: 0.3, flex: '1 1 auto', minWidth: 100 }}>
          Auditoria Vesti
        </span>
        {!carregando && data && (
          <span style={{ fontSize: fz(13), fontWeight: 700, color: palette.ink, fontFamily: FONT }}>
            {data.total_clientes} clientes
          </span>
        )}
        <span style={{ fontSize: fz(11), color: palette.inkMuted }}>
          {expandido ? '▲' : '▼'}
        </span>
      </div>

      {expandido && (
        <div style={{ marginTop: 12 }}>
          {carregando && <div style={{ fontSize: fz(12), color: palette.inkMuted }}>Carregando...</div>}
          {erro && <div style={{ fontSize: fz(12), color: palette.alert }}>Erro: {erro}</div>}
          {data && (
            <>
              {/* Strip de KPIs principais */}
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
                gap: 10, marginBottom: 14,
              }}>
                <div>
                  <div style={{ fontSize: fz(20), fontWeight: 800, fontFamily: FONT, color: palette.ink }}>
                    {data.total_clientes}
                  </div>
                  <div style={{ fontSize: fz(10), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Total Vesti
                  </div>
                </div>
                {Object.entries(data.por_loja).map(([loja, qtd]) => (
                  <div key={loja}>
                    <div style={{ fontSize: fz(20), fontWeight: 800, fontFamily: FONT, color: palette.ink }}>
                      {qtd}
                    </div>
                    <div style={{ fontSize: fz(10), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {loja}
                    </div>
                  </div>
                ))}
              </div>

              {/* Sugestoes IA */}
              <div style={{
                background: palette.beigeSoft, borderRadius: 8, padding: 10, marginBottom: 12,
              }}>
                <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  IA — últimos 30 dias
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: fz(13), color: palette.ink }}>
                  <div>
                    <strong>{data.sugestoes_30d.total}</strong> sugestões pra Vesti
                  </div>
                  <div style={{ color: data.sugestoes_30d.pct_com_link >= 50 ? palette.ok : palette.alert }}>
                    <strong>{data.sugestoes_30d.com_link_ou_catalogo}</strong> ({data.sugestoes_30d.pct_com_link}%) com link/catálogo
                  </div>
                  <div>
                    <strong>{data.sugestoes_30d.executadas}</strong> mensagens enviadas
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <button onClick={() => setAba('vendedoras')} style={{
                  background: aba === 'vendedoras' ? palette.accent : 'transparent',
                  color: aba === 'vendedoras' ? 'white' : palette.inkSoft,
                  border: `1px solid ${aba === 'vendedoras' ? palette.accent : palette.beige}`,
                  borderRadius: 6, padding: '4px 10px', fontSize: fz(11), fontFamily: FONT, cursor: 'pointer',
                }}>Por vendedora</button>
                <button onClick={() => setAba('clientes')} style={{
                  background: aba === 'clientes' ? palette.accent : 'transparent',
                  color: aba === 'clientes' ? 'white' : palette.inkSoft,
                  border: `1px solid ${aba === 'clientes' ? palette.accent : palette.beige}`,
                  borderRadius: 6, padding: '4px 10px', fontSize: fz(11), fontFamily: FONT, cursor: 'pointer',
                }}>Lista clientes</button>
              </div>

              {/* Aba: por vendedora */}
              {aba === 'vendedoras' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {data.por_vendedora.map(v => (
                    <div key={v.vendedora_id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: 8, borderRadius: 6, background: palette.beigeSoft,
                      flexWrap: 'wrap',
                    }}>
                      <span style={{ fontSize: fz(13), fontWeight: 600, color: palette.ink, flex: '1 1 100px' }}>
                        {v.vendedora_nome}
                      </span>
                      <span style={{ fontSize: fz(10), color: palette.inkMuted }}>
                        {v.loja}
                      </span>
                      {v.tem_link
                        ? <span style={{ fontSize: fz(10), color: palette.ok, fontWeight: 600 }} title="Link Vesti cadastrado">🔗 link ✓</span>
                        : <span style={{ fontSize: fz(10), color: palette.alert, fontWeight: 600 }} title="SEM link Vesti cadastrado">🔗 sem link</span>}
                      <span style={{ fontSize: fz(13), fontWeight: 700, color: palette.ink, fontFamily: FONT }}>
                        {v.qtd_clientes}
                      </span>
                      <span style={{ fontSize: fz(10), color: palette.inkMuted }}>
                        {v.ativo > 0 && `${v.ativo} ativos`}
                        {v.atencao > 0 && ` · ${v.atencao} atenção`}
                        {v.semAtividade > 0 && ` · ${v.semAtividade} s/ativ`}
                        {v.inativo > 0 && ` · ${v.inativo} inat`}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Aba: lista clientes */}
              {aba === 'clientes' && (
                <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {data.clientes.map(c => (
                    <div key={c.cliente_id} style={{
                      display: 'flex', gap: 8, padding: '6px 8px', borderRadius: 4,
                      background: palette.surface, border: `1px solid ${palette.beigeSoft}`,
                      fontSize: fz(11), alignItems: 'center', flexWrap: 'wrap',
                    }}>
                      <span style={{ flex: '1 1 150px', fontWeight: 600, color: palette.ink }}>{c.nome}</span>
                      <span style={{ color: palette.inkMuted, fontSize: fz(10) }}>{c.vendedora_nome}</span>
                      <span style={{ color: palette.inkMuted, fontSize: fz(10) }}>{c.status_atual}</span>
                      <span style={{ fontFamily: FONT, color: palette.ink, fontWeight: 600 }}>
                        {c.lifetime_total ? `R$ ${Math.round(c.lifetime_total).toLocaleString('pt-BR')}` : '—'}
                      </span>
                      {c.dias_sem_comprar != null && (
                        <span style={{ color: palette.inkMuted, fontSize: fz(10) }}>
                          {c.dias_sem_comprar}d
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};


// ─── DashboardTab ──────────────────────────────────────────────────────────

// Slice usado no strip horizontal "Carteira ativa total" — número grande
// + cor + label, sem caixa propria (parte de uma linha)
const KpiSlice = ({ cor, valor, label }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
    <span style={{
      width: 8, height: 8, borderRadius: '50%', background: cor,
      display: 'inline-block', alignSelf: 'center',
    }} />
    <div>
      <div style={{ fontSize: fz(20), fontWeight: 600, color: palette.ink, lineHeight: 1 }}>
        {valor}
      </div>
      <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2 }}>
        {label}
      </div>
    </div>
  </div>
);

const DashboardTab = ({ lojas, onAbrirHistorico }) => {
  const { state, clientesEnriquecidos } = lojas;

  const stats = useMemo(() => {
    const ativos = clientesEnriquecidos.filter(c => c.statusAtual === 'ativo').length;
    const atencao = clientesEnriquecidos.filter(c => c.statusAtual === 'atencao').length;
    const semAt = clientesEnriquecidos.filter(c => c.statusAtual === 'semAtividade').length;
    const sacola = clientesEnriquecidos.filter(c => c.statusAtual === 'separandoSacola').length;
    const total = ativos + atencao;

    const sugestoes = state.sugestoesHoje.length;
    const executadas = state.sugestoesHoje.filter(s => s.status === 'executada').length;

    return { ativos, atencao, semAt, sacola, total, sugestoes, executadas };
  }, [clientesEnriquecidos, state.sugestoesHoje]);

  const Indicator = ({ label, value, sub, icon: Icon, cor, expandable, onClick }) => (
    <button
      onClick={expandable ? onClick : undefined}
      disabled={!expandable}
      style={{
        background: palette.surface, border: `1px solid ${palette.beige}`,
        borderRadius: 12, padding: 14, flex: 1, minWidth: 0, textAlign: 'left',
        cursor: expandable ? 'pointer' : 'default', fontFamily: FONT, position: 'relative',
        transition: 'all 0.15s',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Icon size={sz(16)} color={cor} />
        <div style={{ fontSize: fz(13), color: palette.inkSoft, letterSpacing: 0.3, flex: 1 }}>{label}</div>
        {expandable && <Maximize2 size={sz(14)} color={palette.inkMuted} />}
      </div>
      <div style={{ fontSize: fz(25), fontWeight: 700, color: palette.ink, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 4 }}>{sub}</div>}
      {expandable && (
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: `1px solid ${palette.beigeSoft}`,
          fontSize: fz(12), color: palette.accent, fontWeight: 600, letterSpacing: 0.3,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          Ver histórico <ChevronRight size={sz(14)} />
        </div>
      )}
    </button>
  );

  return (
    <div style={{ padding: 16 }}>
      <SectionTitle>Indicadores gerais</SectionTitle>

      {/* Strip horizontal — todos os KPIs juntos */}
      <button onClick={onAbrirHistorico} style={{
        width: '100%', background: palette.surface, border: `1px solid ${palette.beige}`,
        borderRadius: 12, padding: '14px 16px', marginBottom: 12,
        cursor: 'pointer', fontFamily: FONT, textAlign: 'left',
        boxSizing: 'border-box', overflow: 'hidden', maxWidth: '100%',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Users size={sz(15)} color={palette.accent} />
          <span style={{ fontSize: fz(13), color: palette.inkSoft, letterSpacing: 0.3, flex: 1 }}>
            Carteira ativa total
          </span>
          <span style={{ fontSize: fz(11), color: palette.accent, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2 }}>
            histórico <ChevronRight size={sz(13)} />
          </span>
        </div>
        <div style={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 18,
          rowGap: 10,
        }}>
          <div>
            <div style={{ fontSize: fz(28), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>
              {stats.total}
            </div>
            <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              total
            </div>
          </div>
          <KpiSlice cor={palette.ok}     valor={stats.ativos}    label="ativos" />
          <KpiSlice cor={palette.warn}   valor={stats.atencao}   label="atenção" />
          <KpiSlice cor="#d4a017"        valor={stats.semAt}     label="+3M" />
          <KpiSlice cor={palette.purple} valor={stats.sacola}    label="sacolas" />
          <KpiSlice cor={palette.accent} valor={`${stats.executadas}/${stats.sugestoes}`} label="sugestões hoje" />
        </div>
      </button>

      {/* Card de Metas (admin) — mostra progresso das vendedoras */}
      {state.isAdmin && <CardMetas lojas={lojas} />}

      {/* Card Conversões — mesmo tamanho da Carteira ativa */}
      <CardConversoes lojas={lojas} />

      {/* Card Auditoria Vesti (admin) — quantos clientes Vesti tem,
          se IA está usando link/catalogo, mensagens enviadas */}
      {state.isAdmin && <CardVestiAuditoria userId={state.userId} />}

      {/* Card Abertura do app (admin) — quem abriu hoje, quem precisa lembrete */}
      {state.isAdmin && <CardAberturaApp lojas={lojas} />}

      <SectionTitle icon={Star}>Vendedoras ativas</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {state.vendedoras
          .filter(v => v.ativa && !v.nome.toLowerCase().startsWith('vendedora_'))
          .map(v => {
            const carteira = clientesEnriquecidos.filter(c => c.vendedora_id === v.id);
            const qtdAtivos = carteira.filter(c => c.statusAtual === 'ativo').length;
            const qtdAtencao = carteira.filter(c => c.statusAtual === 'atencao').length;
            return (
              <div key={v.id} style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 14 }}>
                <div style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Users size={sz(15)} color={palette.inkSoft} />
                  {v.nome}
                  <span style={{ fontSize: fz(12), color: palette.inkMuted, fontWeight: 400 }}>· {v.loja}</span>
                </div>
                <div style={{ fontSize: fz(14), color: palette.inkSoft }}>
                  {carteira.length} clientes · {qtdAtivos} ativos · {qtdAtencao} em atenção
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// CarteiraGeralTab — Ailson 13/05/2026
// 
// Tab admin-only que mostra TODOS os clientes de TODAS as vendedoras.
// Filtros: busca (nome/cnpj/cpf), vendedora, status, ordenação.
// Click no card → DetalheClienteScreen (mesma da carteira individual).
// ═══════════════════════════════════════════════════════════════════════════

const CarteiraGeralTab = ({ lojas, onSelectCliente }) => {
  const { state, clientesEnriquecidos } = lojas;
  const { vendedoras } = state;
  // FIX Ailson 13/05/2026: usa clientesEnriquecidos (que tem statusAtual
  // calculado) em vez de state.clientes (raw, sem statusAtual). Sem isso
  // os chips de status mostravam 0 em tudo.
  const clientes = clientesEnriquecidos || [];

  // Filtros — persistem em localStorage como os outros do app
  const [busca, setBusca] = useState('');
  const [filtroVendedoraId, setFiltroVendedoraId] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lojas_carteira_geral_filtros') || '{}').vendedoraId || 'todas'; }
    catch { return 'todas'; }
  });
  const [filtroStatus, setFiltroStatus] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lojas_carteira_geral_filtros') || '{}').status || 'todos'; }
    catch { return 'todos'; }
  });
  const [ordenacao, setOrdenacao] = useState(() => {
    try { return JSON.parse(localStorage.getItem('lojas_carteira_geral_filtros') || '{}').ordenacao || 'maior_compra'; }
    catch { return 'maior_compra'; }
  });

  // Persiste filtros
  useEffect(() => {
    try {
      localStorage.setItem('lojas_carteira_geral_filtros', JSON.stringify({
        vendedoraId: filtroVendedoraId, status: filtroStatus, ordenacao,
      }));
    } catch {}
  }, [filtroVendedoraId, filtroStatus, ordenacao]);

  // Mapa vendedora_id -> nome (pra mostrar no card)
  const vendedoraMap = useMemo(() => {
    const m = new Map();
    (vendedoras || []).forEach(v => m.set(v.id, v));
    return m;
  }, [vendedoras]);

  // Filtra + ordena
  const clientesFiltrados = useMemo(() => {
    const buscaNorm = busca.trim().toLowerCase();
    let arr = (clientes || []).filter(c => {
      // Filtro vendedora
      if (filtroVendedoraId !== 'todas' && c.vendedora_id !== filtroVendedoraId) return false;
      // Filtro status
      if (filtroStatus !== 'todos' && c.statusAtual !== filtroStatus) return false;
      // Busca por nome, apelido, cnpj/cpf
      if (buscaNorm) {
        const campos = [
          c.nome, c.apelido, c.razao_social,
          (c.documento || '').replace(/\D/g, ''),
        ].map(s => (s || '').toLowerCase());
        const buscaSemMascara = buscaNorm.replace(/\D/g, '');
        const bate = campos.some(s => s.includes(buscaNorm))
          || (buscaSemMascara && campos.some(s => s.includes(buscaSemMascara)));
        if (!bate) return false;
      }
      return true;
    });

    // Ordenação
    if (ordenacao === 'az') {
      arr.sort((a, b) => (a.nome || a.apelido || '').localeCompare(b.nome || b.apelido || ''));
    } else if (ordenacao === 'maior_compra') {
      arr.sort((a, b) => (b.kpi?.lifetime_total || 0) - (a.kpi?.lifetime_total || 0));
    } else if (ordenacao === 'mais_recente') {
      arr.sort((a, b) => {
        // dias_sem_comprar menor = mais recente
        const da = a.kpi?.dias_sem_comprar ?? 99999;
        const db = b.kpi?.dias_sem_comprar ?? 99999;
        return da - db;
      });
    }

    return arr;
  }, [clientes, busca, filtroVendedoraId, filtroStatus, ordenacao]);

  // Contadores por status (sempre com filtros de vendedora + busca aplicados,
  // mas SEM o filtro de status, pra mostrar quantos tem em cada categoria)
  const contadores = useMemo(() => {
    const buscaNorm = busca.trim().toLowerCase();
    const buscaSemMascara = buscaNorm.replace(/\D/g, '');
    const aplicavel = (clientes || []).filter(c => {
      if (filtroVendedoraId !== 'todas' && c.vendedora_id !== filtroVendedoraId) return false;
      if (buscaNorm) {
        const campos = [c.nome, c.apelido, c.razao_social, (c.documento || '').replace(/\D/g, '')]
          .map(s => (s || '').toLowerCase());
        const bate = campos.some(s => s.includes(buscaNorm))
          || (buscaSemMascara && campos.some(s => s.includes(buscaSemMascara)));
        if (!bate) return false;
      }
      return true;
    });
    return {
      todos: aplicavel.length,
      ativo: aplicavel.filter(c => c.statusAtual === 'ativo').length,
      separandoSacola: aplicavel.filter(c => c.statusAtual === 'separandoSacola').length,
      atencao: aplicavel.filter(c => c.statusAtual === 'atencao').length,
      semAtividade: aplicavel.filter(c => c.statusAtual === 'semAtividade').length,
      inativo: aplicavel.filter(c => c.statusAtual === 'inativo').length,
      arquivo: aplicavel.filter(c => c.statusAtual === 'arquivo').length,
    };
  }, [clientes, busca, filtroVendedoraId]);

  // Vendedoras ativas pra o select
  const vendedorasOrdenadas = useMemo(() => {
    return [...(vendedoras || [])].sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  }, [vendedoras]);

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div style={{ background: palette.bg, minHeight: '100vh', padding: 14, fontFamily: FONT }}>
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: fz(11), fontWeight: 600, letterSpacing: 1, color: palette.inkMuted, textTransform: 'uppercase' }}>
          Admin · Visão geral
        </div>
        <div style={{ fontSize: fz(20), fontWeight: 600, color: palette.ink, marginTop: 2 }}>
          Carteira geral
        </div>
        <div style={{ fontSize: fz(12), color: palette.inkSoft, marginTop: 2 }}>
          {clientes?.length || 0} clientes no total · {vendedorasOrdenadas.length} vendedoras
        </div>
      </div>

      {/* Busca */}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search size={sz(16)} style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
          color: palette.inkMuted, pointerEvents: 'none',
        }} />
        <input
          type="text"
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome, apelido, CNPJ ou CPF…"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 12px 10px 36px', fontFamily: FONT, fontSize: fz(14),
            border: `1px solid ${palette.beige}`, borderRadius: 10,
            background: palette.surface, color: palette.ink,
          }}
        />
      </div>

      {/* Filtros: vendedora + ordenação (lado a lado) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <select
          value={filtroVendedoraId}
          onChange={e => setFiltroVendedoraId(e.target.value)}
          style={{
            flex: 1, padding: '8px 10px', fontFamily: FONT, fontSize: fz(13),
            border: `1px solid ${palette.beige}`, borderRadius: 8,
            background: palette.surface, color: palette.ink,
          }}
        >
          <option value="todas">Todas vendedoras</option>
          {vendedorasOrdenadas.map(v => (
            <option key={v.id} value={v.id}>{v.nome}{v.loja ? ` · ${v.loja}` : ''}</option>
          ))}
        </select>
        <select
          value={ordenacao}
          onChange={e => setOrdenacao(e.target.value)}
          style={{
            flex: 1, padding: '8px 10px', fontFamily: FONT, fontSize: fz(13),
            border: `1px solid ${palette.beige}`, borderRadius: 8,
            background: palette.surface, color: palette.ink,
          }}
        >
          <option value="maior_compra">Maiores compras</option>
          <option value="mais_recente">Mais recentes</option>
          <option value="az">A → Z</option>
        </select>
      </div>

      {/* Chips status — scroll horizontal */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
        {[
          { id: 'todos', label: 'Todos', cor: palette.ink },
          { id: 'ativo', label: 'Ativos', cor: statusMap.ativo.cor },
          { id: 'separandoSacola', label: 'Sacola', cor: statusMap.separandoSacola.cor },
          { id: 'atencao', label: 'Atenção', cor: statusMap.atencao.cor },
          { id: 'semAtividade', label: '+3M', cor: statusMap.semAtividade.cor },
          { id: 'inativo', label: '+6M', cor: statusMap.inativo.cor },
          { id: 'arquivo', label: 'Arquivo', cor: statusMap.arquivo.cor },
        ].map(c => {
          const ativo = filtroStatus === c.id;
          const count = contadores[c.id] ?? 0;
          return (
            <button
              key={c.id}
              onClick={() => setFiltroStatus(c.id)}
              style={{
                flexShrink: 0, padding: '6px 12px',
                background: ativo ? c.cor : palette.surface,
                color: ativo ? '#fff' : palette.ink,
                border: `1px solid ${ativo ? c.cor : palette.beige}`,
                borderRadius: 8, cursor: 'pointer', fontFamily: FONT,
                fontSize: fz(13), fontWeight: ativo ? 600 : 500,
                whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              {c.label}
              <span style={{
                fontSize: fz(11), fontWeight: 700,
                background: ativo ? 'rgba(255,255,255,0.2)' : palette.beigeSoft,
                color: ativo ? '#fff' : palette.inkSoft,
                padding: '1px 6px', borderRadius: 4,
              }}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Resultado info */}
      <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 10 }}>
        {clientesFiltrados.length} {clientesFiltrados.length === 1 ? 'cliente' : 'clientes'}
        {filtroVendedoraId !== 'todas' && vendedoraMap.has(filtroVendedoraId) && (
          <span> · {vendedoraMap.get(filtroVendedoraId).nome}</span>
        )}
      </div>

      {/* Lista de cards */}
      {clientesFiltrados.length === 0 && (
        <div style={{
          padding: 30, textAlign: 'center', color: palette.inkMuted,
          background: palette.surface, borderRadius: 12, border: `1px dashed ${palette.beige}`,
        }}>
          <div style={{ fontSize: fz(14), marginBottom: 4 }}>Nenhum cliente nesses filtros</div>
          <div style={{ fontSize: fz(12), color: palette.inkMuted }}>
            Tenta ajustar busca, vendedora ou status
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 80 }}>
        {clientesFiltrados.map(c => {
          const meta = statusMap[c.statusAtual] || statusMap.ativo;
          const vendedora = vendedoraMap.get(c.vendedora_id);
          const nome = c.apelido || c.nome || c.razao_social || 'Sem nome';
          return (
            <button
              key={c.id}
              onClick={() => onSelectCliente && onSelectCliente(c)}
              style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 12, padding: 12, cursor: 'pointer', textAlign: 'left',
                fontFamily: FONT, display: 'block',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: fz(15), fontWeight: 600, color: palette.ink,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {nome}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{
                      fontSize: fz(11), fontWeight: 600,
                      color: meta.cor, background: meta.soft,
                      padding: '2px 7px', borderRadius: 4,
                    }}>
                      {meta.emoji} {meta.label}
                    </span>
                    {vendedora && (
                      <span style={{ fontSize: fz(12), color: palette.inkMuted, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <UserCheck size={sz(12)} /> {vendedora.nome}
                        {vendedora.loja && <span style={{ color: palette.inkMuted }}> · {vendedora.loja}</span>}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: fz(14), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>
                    {c.kpi?.lifetime_total ? 'R$ ' + Number(c.kpi.lifetime_total).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—'}
                  </div>
                  <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 3 }}>
                    {c.kpi?.qtd_compras ? `${c.kpi.qtd_compras} ${c.kpi.qtd_compras === 1 ? 'compra' : 'compras'}` : 'sem compras'}
                  </div>
                  {c.kpi?.dias_sem_comprar != null && (
                    <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2 }}>
                      {c.kpi.dias_sem_comprar}d sem comprar
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};


// ─── ConfigTab ─────────────────────────────────────────────────────────────

const ConfigTab = ({ lojas, onNavegar }) => {
  const { state } = lojas;

  const items = [
    { id: 'cadastrarComprador', icon: User, cor: palette.accent, corSoft: palette.accentSoft,
      title: 'Cadastrar comprador', sub: 'Vincular nome do comprador a um CNPJ/CPF' },
    { id: 'promocoes', icon: Gift, cor: palette.warn, corSoft: palette.warnSoft,
      title: 'Promoções', sub: `${state.promocoes.length} ${state.promocoes.length === 1 ? 'ativa' : 'ativas'}` },
    { id: 'acoes', icon: Megaphone, cor: palette.purple, corSoft: palette.purpleSoft,
      title: 'Ações', sub: `${(state.acoes || []).filter(a => a.ativa).length} vigentes — IA incorpora nas mensagens` },
    { id: 'avisos', icon: Bell, cor: palette.warn, corSoft: palette.warnSoft,
      title: 'Avisos', sub: `${(state.avisos || []).filter(a => a.status === 'pendente').length} pendentes — vira 1ª sugestão da vendedora` },
    { id: 'curadoria', icon: Star, cor: palette.warn, corSoft: palette.warnSoft,
      title: 'Curadoria de produtos', sub: `Best-sellers · em alta · novidades manuais (${(state.curadoria || []).filter(c => c.ativo).length})` },
    { id: 'regras', icon: FileText, cor: palette.accent, corSoft: palette.accentSoft,
      title: 'Regras gerais', sub: 'Tom, parâmetros, sempre/nunca' },
    { id: 'vendedoras', icon: UserCog, cor: palette.ok, corSoft: palette.okSoft,
      title: 'Vendedoras', sub: `${state.vendedoras.filter(v => v.ativa).length} ativas` },
    { id: 'transferir', icon: ArrowLeftRight, cor: palette.archive, corSoft: palette.archiveSoft,
      title: 'Transferir carteira', sub: 'Avulsa ou em massa' },
    { id: 'importacoes', icon: Download, cor: palette.inkSoft, corSoft: palette.beigeSoft,
      title: 'Importações',
      sub: state.importacoes[0] ? `Última: ${fmtData(state.importacoes[0].finalizada_em || state.importacoes[0].iniciada_em)}` : 'Nenhuma ainda' },
    { id: 'grupos', icon: UsersRound, cor: palette.purple, corSoft: palette.purpleSoft,
      title: 'Grupos', sub: `${state.grupos.length} ${state.grupos.length === 1 ? 'grupo' : 'grupos'}` },
  ];

  return (
    <div style={{ padding: 16 }}>
      <SectionTitle>Controles administrativos</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it, i) => {
          const Icon = it.icon;
          return (
            <button key={i} onClick={() => onNavegar && onNavegar(it.id)} style={{
              background: palette.surface, border: `1px solid ${palette.beige}`,
              borderRadius: 12, padding: 14, width: '100%', textAlign: 'left',
              cursor: 'pointer', fontFamily: FONT,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 10, background: it.corSoft,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon size={sz(25)} color={it.cor} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink, marginBottom: 2 }}>{it.title}</div>
                <div style={{ fontSize: fz(14), color: palette.inkMuted }}>{it.sub}</div>
              </div>
              <ChevronRight size={sz(21)} color={palette.inkMuted} />
            </button>
          );
        })}
      </div>
      <div style={{
        marginTop: 24, padding: 14, background: palette.beigeSoft, borderRadius: 10,
        fontSize: fz(14), color: palette.inkSoft, lineHeight: 1.5,
      }}>
        ℹ️ <strong>Promoções e Regras</strong> alimentam diretamente as sugestões da IA.
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. CardDiaScreen — 7 sugestões do dia da vendedora
// ═══════════════════════════════════════════════════════════════════════════

export const CardDiaScreen = ({
  lojas, vendedora, onBack, onSelectSugestao, onAbrirCarteira, onAbrirDestaques,
}) => {
  const { state, handleRegerarSugestoes } = lojas;
  const [regenerando, setRegenerando] = useState(false);

  const sugestoes = state.sugestoesHoje;

  // Separa avulsas (prioridade 99, geradas via "Pedir mensagem" da carteira)
  // das 7 oficiais do dia. Avulsas vao em secao propria abaixo.
  // Detector defensivo: cobre sugestoes antigas sem metadados_ia preenchido.
  // Ailson 08/05/2026.
  const ehAvulsa = (s) =>
    s.prioridade === 99 ||
    s.metadados_ia?.origem === 'avulsa' ||
    s.fatos?.origem === 'avulsa';

  const oficiais = sugestoes.filter(s => !ehAvulsa(s));
  const avulsas = sugestoes.filter(ehAvulsa);

  const ativas = oficiais.filter(s => s.status === 'pendente' || !s.status);
  const enviadas = oficiais.filter(s => s.status === 'executada');
  const dispensadas = oficiais.filter(s => s.status === 'dispensada');

  const ativasAvulsas = avulsas.filter(s => s.status === 'pendente' || !s.status);
  const enviadasAvulsas = avulsas.filter(s => s.status === 'executada');

  // Contador conta SO oficiais (X de 7). Avulsas tem contador proprio.
  const total = oficiais.length;
  const executadas = enviadas.length;
  const pct = total ? Math.round((executadas / total) * 100) : 0;

  const handleRegerar = async () => {
    // FIX 07/05/2026 (Ailson): confirmacao obrigatoria antes de regerar.
    // Caso real Celia 06/05: clicava 'Atualizar' achando que era refresh
    // da pagina e perdia (aparentemente) o trabalho do dia. Agora explica
    // o que vai acontecer + confirma.
    // Aproveita pra mostrar quantas ja foram enviadas (que ficam preservadas).
    const msgConfirma = executadas > 0
      ? `Você já enviou ${executadas} mensagem${executadas > 1 ? 's' : ''} hoje. Atualizar vai gerar NOVAS sugestões pendentes (as enviadas ficam guardadas). Continuar?`
      : `Atualizar vai gerar novas sugestões pra você. Isso usa IA e demora ~30 segundos. Continuar?`;
    if (!confirm(msgConfirma)) return;

    setRegenerando(true);
    try {
      await handleRegerarSugestoes();
    } catch (e) {
      alert('Erro ao gerar sugestões: ' + e.message);
    } finally {
      setRegenerando(false);
    }
  };

  const SugestaoCard = ({ s, riscada = false }) => {
    const visual = visualSugestao(s.tipo);
    const Icone = visual.icone;
    const cliente = state.clientes.find(c => c.id === s.cliente_id);
    const titulo = s.titulo || (cliente ? `${capitalizeTipo(s.tipo)} ${nomeCliente(cliente)}` : 'Sugestão');

    return (
      <button onClick={() => !riscada && onSelectSugestao(s)} disabled={riscada} style={{
        background: riscada ? palette.beigeSoft : palette.surface,
        border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 14,
        width: '100%', textAlign: 'left',
        cursor: riscada ? 'default' : 'pointer', fontFamily: FONT,
        opacity: riscada ? 0.55 : 1,
        boxShadow: riscada ? 'none' : '0 1px 3px rgba(44,62,80,0.04)',
        display: 'flex', alignItems: 'flex-start', gap: 12,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9, background: visual.corSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icone size={sz(21)} color={visual.cor} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: fz(17), fontWeight: 600, color: palette.ink, marginBottom: 3,
            textDecoration: riscada ? 'line-through' : 'none',
          }}>{titulo}</div>
          <div style={{ fontSize: fz(14), color: palette.inkSoft }}>{s.contexto || ''}</div>
          {riscada && (
            <div style={{ marginTop: 6, fontSize: fz(13), color: palette.ok, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
              <Check size={sz(14)} /> Enviada
            </div>
          )}
        </div>
        {!riscada && <ChevronRight size={sz(21)} color={palette.inkMuted} />}
      </button>
    );
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title={vendedora?.nome || 'Sugestões'}
        subtitle={`${vendedora?.loja || ''} · ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}`}
        onBack={onBack}
        rightContent={
          <button onClick={handleRegerar} disabled={regenerando} style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
            color: palette.bg, padding: '6px 10px', borderRadius: 8,
            cursor: regenerando ? 'wait' : 'pointer', fontSize: fz(13), fontFamily: FONT, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 4, opacity: regenerando ? 0.6 : 1,
          }}>
            <RefreshCw size={sz(14)} style={regenerando ? { animation: 'spin 1s linear infinite' } : undefined} />
            {regenerando ? 'Gerando…' : 'Atualizar'}
          </button>
        }
      />
      <div style={{ padding: 16 }}>
        {/* Card especial de TERCA-FEIRA (Ailson 06/05/2026):
            Resumo motivacional da semana anterior + CTA pra abrir Destaques.
            Aparece SO no dia 2 (terca) e SO se a vendedora tem sugestoes hoje
            (evita aparecer em fins-de-semana ou dia sem cron rodado). */}
        {new Date().getDay() === 2 && total > 0 && (
          <button
            onClick={onAbrirDestaques}
            style={{
              width: '100%',
              background: `linear-gradient(135deg, ${palette.purpleSoft} 0%, ${palette.bg} 100%)`,
              border: `1px solid ${palette.purple}40`,
              borderRadius: 14, padding: 14, marginBottom: 12,
              cursor: 'pointer', fontFamily: FONT, textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 12,
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: '50%', background: palette.surface,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `2px solid ${palette.purple}`, flexShrink: 0,
            }}>
              <Award size={sz(24)} color={palette.purple} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: fz(15), fontWeight: 700, color: palette.ink, marginBottom: 2 }}>
                Resumo da sua semana 🚀
              </div>
              <div style={{ fontSize: fz(13), color: palette.inkSoft }}>
                Toque pra ver suas conversões e destaques
              </div>
            </div>
            <ChevronRight size={sz(20)} color={palette.purple} />
          </button>
        )}

        <div style={{
          background: palette.surface, borderRadius: 14, padding: 16, marginBottom: 18,
          border: `1px solid ${palette.beige}`,
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <div style={{
            width: 50, height: 50, borderRadius: 12, background: palette.accentSoft,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Bot size={sz(30)} color={palette.accent} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: fz(17), color: palette.ink, fontWeight: 600 }}>
              {total > 0 ? 'Sugestões de hoje' : 'Nenhuma sugestão ainda'}
            </div>
            <div style={{ fontSize: fz(15), color: palette.inkSoft, marginTop: 3 }}>
              {total > 0 ? `${executadas} de ${total} executadas` : 'Toque em "Atualizar" pra gerar'}
            </div>
            {total > 0 && (
              <div style={{ marginTop: 8, height: 6, background: palette.beige, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: palette.accent, borderRadius: 4 }} />
              </div>
            )}
          </div>
        </div>

        {ativas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {ativas.map(s => <SugestaoCard key={s.id} s={s} />)}
          </div>
        )}

        {enviadas.length > 0 && (
          <>
            <SectionTitle>Já executadas hoje</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {enviadas.map(s => <SugestaoCard key={s.id} s={s} riscada />)}
            </div>
          </>
        )}

        {dispensadas.length > 0 && (
          <details style={{ marginBottom: 16 }}>
            <summary style={{
              cursor: 'pointer', fontSize: fz(14), color: palette.inkMuted, padding: 8,
              background: palette.beigeSoft, borderRadius: 8,
            }}>
              {dispensadas.length} dispensada{dispensadas.length > 1 ? 's' : ''} hoje
            </summary>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dispensadas.map(s => <SugestaoCard key={s.id} s={s} riscada />)}
            </div>
          </details>
        )}

        {/* Mensagens avulsas (Ailson 08/05/2026): geradas via "Pedir mensagem"
            no card da carteira ou no detalhe do cliente. Ficam separadas
            das 7 oficiais do dia pra nao poluir o contador. */}
        {(ativasAvulsas.length > 0 || enviadasAvulsas.length > 0) && (
          <>
            <div style={{
              marginTop: 24, marginBottom: 10,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Send size={sz(16)} color={palette.inkMuted} />
              <div style={{ fontSize: fz(14), color: palette.inkMuted, fontWeight: 600, letterSpacing: 0.3 }}>
                MENSAGENS AVULSAS
                {ativasAvulsas.length + enviadasAvulsas.length > 0 && (
                  <span style={{ marginLeft: 6, fontWeight: 400 }}>
                    · {enviadasAvulsas.length} de {ativasAvulsas.length + enviadasAvulsas.length}
                  </span>
                )}
              </div>
            </div>
            {ativasAvulsas.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                {ativasAvulsas.map(s => <SugestaoCard key={s.id} s={s} />)}
              </div>
            )}
            {enviadasAvulsas.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {enviadasAvulsas.map(s => <SugestaoCard key={s.id} s={s} riscada />)}
              </div>
            )}
          </>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 24 }}>
          <button onClick={onAbrirCarteira} style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 12, padding: 14, cursor: 'pointer', fontFamily: FONT,
            fontSize: fz(16), color: palette.ink,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 600,
          }}>
            <Users size={sz(20)} color={palette.accent} /> Minha carteira
          </button>
          <button onClick={onAbrirDestaques} style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 12, padding: 14, cursor: 'pointer', fontFamily: FONT,
            fontSize: fz(16), color: palette.ink,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 600,
          }}>
            <Star size={sz(20)} color={palette.warn} /> Destaques da semana
          </button>
        </div>

        {/* Footer versao + hard-reload — Ailson 08/05/2026
            Mostra build pra diagnostico (vendedoras pdem mandar print).
            Tap 5x ativa hard reload (limpa SW + caches + reload). */}
        <FooterVersao />
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// Footer com versao + hard-reload escondido (5 taps no 'v')
// Permite vendedora forcar atualizacao quando cache do iOS prende
const FooterVersao = () => {
  const [taps, setTaps] = useState(0);
  const [hardReloading, setHardReloading] = useState(false);

  const versao = (typeof __APP_BUILD__ !== 'undefined') ? __APP_BUILD__ : 'dev';
  const versaoCurta = versao.replace(/[-:]/g, '').slice(0, 13);

  const onTap = () => {
    const novo = taps + 1;
    setTaps(novo);
    if (novo >= 5) {
      hardReload();
    } else {
      setTimeout(() => setTaps(0), 1500);
    }
  };

  const hardReload = async () => {
    setHardReloading(true);
    try {
      // 1. Unregister todos os service workers
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      // 2. Limpa todos os caches
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      // 3. Reload com bypass de cache
      window.location.href = window.location.href.split('?')[0] + '?v=' + Date.now();
    } catch (e) {
      alert('Erro ao recarregar: ' + (e?.message || e));
      setHardReloading(false);
    }
  };

  return (
    <div
      onClick={onTap}
      style={{
        marginTop: 32, marginBottom: 8, padding: 8,
        textAlign: 'center', fontSize: fz(11), color: palette.inkMuted,
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {hardReloading ? (
        <span>🔄 Atualizando…</span>
      ) : taps >= 3 ? (
        <span style={{ color: palette.accent }}>
          {5 - taps} toque{5 - taps !== 1 ? 's' : ''} pra atualizar app
        </span>
      ) : (
        <span>v {versaoCurta}</span>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. SugestaoScreen — sugestão expandida com ações
// ═══════════════════════════════════════════════════════════════════════════

export const SugestaoScreen = ({
  lojas, sugestao, vendedora, onBack, onPedirMensagem, onMarcarEnviada,
}) => {
  const { state, handleEditarApelido, handleMarcarSugestaoExecutada, handleDispensarSugestao, handleEditarTelefone } = lojas;
  const [showRecusa, setShowRecusa] = useState(false);
  const [apelidoEdit, setApelidoEdit] = useState(false);
  const [salvandoApelido, setSalvandoApelido] = useState(false);
  const [enviandoWhats, setEnviandoWhats] = useState(false);
  const [showCadTelefone, setShowCadTelefone] = useState(false);  // modal cadastrar tel
  const [telefoneInput, setTelefoneInput] = useState('');
  const [salvandoTelefone, setSalvandoTelefone] = useState(false);
  // Origem do modal: 'whats' = abre WhatsApp depois de salvar (fluxo do botao
  // WhatsApp). 'edicao' = so salva e fecha (fluxo do lapis/Adicionar no card)
  const [origemModalTel, setOrigemModalTel] = useState('whats');

  // Cliente da sugestão
  const cliente = state.clientes.find(c => c.id === sugestao.cliente_id);
  const [apelido, setApelido] = useState(cliente?.apelido || '');

  // Sincroniza local quando cliente mudar (realtime)
  useEffect(() => {
    setApelido(cliente?.apelido || '');
  }, [cliente?.apelido]);

  const visual = visualSugestao(sugestao.tipo);
  const Icone = visual.icone;
  const titulo = sugestao.titulo || (cliente ? `${capitalizeTipo(sugestao.tipo)} ${nomeCliente(cliente)}` : 'Sugestão');

  // Produto referenciado pela sugestão (se houver)
  const produtoRef = sugestao.produto_ref;
  const produto = produtoRef ? state.produtos.find(p => p.ref === produtoRef) : null;

  // Promoção referenciada (se houver)
  const promocao = sugestao.promocao_id
    ? state.promocoes.find(p => p.id === sugestao.promocao_id)
    : null;

  // Sub-tipo de sacola (se for sugestão tipo sacola)
  const subtipoMeta = subtipoSacolaMap[sugestao.tipo];

  // Salvar apelido editado
  const salvarApelido = async () => {
    if (!cliente || apelido === (cliente.apelido || '')) {
      setApelidoEdit(false);
      return;
    }
    setSalvandoApelido(true);
    try {
      await handleEditarApelido(cliente.id, apelido.trim() || null);
      setApelidoEdit(false);
    } catch (e) {
      alert('Erro ao salvar apelido: ' + e.message);
    } finally {
      setSalvandoApelido(false);
    }
  };

  const marcarEnviada = async () => {
    try {
      await handleMarcarSugestaoExecutada(sugestao.id, null);
      onMarcarEnviada && onMarcarEnviada();
    } catch (e) {
      alert('Erro ao marcar como enviada: ' + e.message);
    }
  };

  // Abre WhatsApp Business com a conversa do cliente. Marca como enviada
  // automaticamente (Ailson 04/05/2026: clicar WhatsApp = enviou).
  // Se cliente nao tem telefone, abre modal pra cadastrar antes.
  const abrirWhatsApp = async () => {
    if (!cliente) return;
    const tel = (cliente.telefone_principal || '').trim();
    if (!tel) {
      setTelefoneInput('');
      setOrigemModalTel('whats');
      setShowCadTelefone(true);
      return;
    }
    setEnviandoWhats(true);
    try {
      // Marca como enviada antes de redirecionar (idempotente)
      await handleMarcarSugestaoExecutada(sugestao.id, null);
      // Abre WhatsApp sem mensagem pre-definida (so atalho pra conversa)
      const numeroLimpo = tel.replace(/\D/g, '');
      const numero = numeroLimpo.length === 11 || numeroLimpo.length === 10
        ? '55' + numeroLimpo  // celular brasileiro sem 55
        : numeroLimpo;
      window.location.href = `https://wa.me/${numero}`;
      onMarcarEnviada && onMarcarEnviada();
    } catch (e) {
      alert('Erro ao abrir WhatsApp: ' + e.message);
    } finally {
      setEnviandoWhats(false);
    }
  };

  // Salva telefone do cliente. Comportamento depende da origem:
  //   'whats'  → veio do botao WhatsApp (cliente sem tel) → marca sugestao
  //              enviada e abre wa.me
  //   'edicao' → veio do lapis ou 'Adicionar WhatsApp' no card → so salva e
  //              fecha (vendedora pode clicar WhatsApp depois se quiser)
  const salvarTelefoneCliente = async () => {
    const tel = telefoneInput.replace(/\D/g, '');
    // Permite vazio so se origem='edicao' (vendedora pode estar limpando)
    if (tel && (tel.length < 10 || tel.length > 11)) {
      alert('Digite um número válido (10 ou 11 dígitos)');
      return;
    }
    if (!tel && origemModalTel === 'whats') {
      alert('Digite o WhatsApp pra abrir a conversa');
      return;
    }
    setSalvandoTelefone(true);
    try {
      if (handleEditarTelefone) {
        await handleEditarTelefone(cliente.id, tel);
      }
      setShowCadTelefone(false);
      // So abre WhatsApp se a origem foi o botao WhatsApp
      if (origemModalTel === 'whats') {
        await handleMarcarSugestaoExecutada(sugestao.id, null);
        const numero = tel.length === 11 || tel.length === 10 ? '55' + tel : tel;
        window.location.href = `https://wa.me/${numero}`;
        onMarcarEnviada && onMarcarEnviada();
      }
    } catch (e) {
      alert('Erro ao salvar telefone: ' + e.message);
    } finally {
      setSalvandoTelefone(false);
    }
  };

  const dispensar = async (motivo) => {
    try {
      await handleDispensarSugestao(sugestao.id, motivo);
      setShowRecusa(false);
      onBack && onBack();
    } catch (e) {
      alert('Erro ao dispensar: ' + e.message);
    }
  };

  // Lista de fatos pode vir como array ou string
  const fatos = Array.isArray(sugestao.fatos)
    ? sugestao.fatos
    : (typeof sugestao.fatos === 'string' ? sugestao.fatos.split('\n').filter(Boolean) : []);

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title={`${vendedora?.nome || ''} · Sugestão`}
        subtitle={`#${(sugestao.id || '').toString().slice(0, 8)} · ${sugestao.tipo}`}
        onBack={onBack}
      />
      <div style={{ padding: 16, paddingBottom: 100 }}>
        {/* Card principal */}
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderLeft: `4px solid ${visual.cor}`, borderRadius: 12, padding: 16, marginBottom: 18,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, background: visual.corSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icone size={sz(23)} color={visual.cor} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: fz(20), fontWeight: 600, color: palette.ink }}>{titulo}</div>
              <div style={{ fontSize: fz(14), color: palette.inkSoft, marginTop: 2 }}>{sugestao.contexto}</div>
            </div>
          </div>

          {/* Badge de sub-tipo de sacola, se for o caso */}
          {subtipoMeta && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px',
              background: subtipoMeta.cor + '15', color: subtipoMeta.cor,
              borderRadius: 6, fontSize: fz(13), fontWeight: 600, marginBottom: 12,
            }}>
              <span>{subtipoMeta.emoji}</span>
              <span>{subtipoMeta.label}</span>
            </div>
          )}

          {/* Dados do cliente */}
          {cliente && (
            <div style={{ background: palette.beigeSoft, borderRadius: 8, padding: 12, fontSize: fz(15) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: palette.inkSoft, marginBottom: 4 }}>
                <Store size={sz(15)} />
                <span style={{ fontSize: fz(13) }}>RAZÃO SOCIAL</span>
              </div>
              <div style={{ color: palette.ink, fontWeight: 600, fontSize: fz(15) }}>{cliente.razao_social}</div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${palette.beige}` }}>
                <Pencil size={sz(15)} color={palette.inkSoft} />
                {apelidoEdit ? (
                  <>
                    <input
                      autoFocus value={apelido}
                      onChange={e => setApelido(e.target.value)}
                      onBlur={salvarApelido}
                      onKeyDown={e => {
                        if (e.key === 'Enter') salvarApelido();
                        if (e.key === 'Escape') { setApelido(cliente.apelido || ''); setApelidoEdit(false); }
                      }}
                      placeholder="Nome de quem atende"
                      disabled={salvandoApelido}
                      style={{
                        flex: 1, border: `1px solid ${palette.accent}`, background: palette.surface,
                        padding: '4px 8px', borderRadius: 6, fontSize: fz(15), fontFamily: FONT, outline: 'none',
                      }} />
                    {salvandoApelido && <Loader2 size={sz(16)} style={{ animation: 'spin 1s linear infinite', color: palette.accent }} />}
                  </>
                ) : (
                  <button onClick={() => setApelidoEdit(true)} style={{
                    flex: 1, background: 'transparent', border: 'none', textAlign: 'left',
                    cursor: 'pointer', fontFamily: FONT, fontSize: fz(15),
                    color: apelido ? palette.ink : palette.inkMuted,
                    fontStyle: apelido ? 'normal' : 'italic',
                  }}>
                    {apelido ? `Comprador: ${apelido}` : 'Adicionar nome do comprador'}
                  </button>
                )}
              </div>

              {/* WhatsApp — sempre visivel, mesma logica da carteira do cliente */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                marginTop: 8, paddingTop: 8, borderTop: `1px solid ${palette.beige}` }}>
                <Phone size={sz(15)} color={palette.inkSoft} />
                {cliente.telefone_principal ? (
                  <>
                    <div style={{ flex: 1 }}>
                      <TelefoneCopiavel telefone={cliente.telefone_principal} />
                    </div>
                    <button onClick={() => {
                      setTelefoneInput(String(cliente.telefone_principal || '').replace(/\D/g, ''));
                      setOrigemModalTel('edicao');
                      setShowCadTelefone(true);
                    }} style={{
                      background: 'transparent', border: 'none',
                      cursor: 'pointer', padding: 4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }} title="Editar WhatsApp">
                      <Pencil size={sz(15)} color={palette.inkSoft} />
                    </button>
                  </>
                ) : (
                  <button onClick={() => {
                    setTelefoneInput('');
                    setOrigemModalTel('edicao');
                    setShowCadTelefone(true);
                  }} style={{
                    flex: 1, background: 'transparent', border: 'none',
                    cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                    fontSize: fz(14), color: palette.accent, padding: 0,
                    display: 'flex', alignItems: 'center', gap: 6,
                    fontStyle: 'italic',
                  }}>
                    <Plus size={sz(14)} /> Adicionar WhatsApp
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Por que essa sugestão? */}
        {fatos.length > 0 && (
          <>
            <SectionTitle icon={Lightbulb}>Por que essa sugestão?</SectionTitle>
            <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 10, padding: 12, marginBottom: 18 }}>
              {fatos.map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: fz(15), color: palette.ink,
                  padding: '5px 0',
                  borderBottom: i < fatos.length - 1 ? `1px solid ${palette.beigeSoft}` : 'none',
                }}>
                  <span style={{ color: palette.accent, marginTop: 1 }}>•</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Ação sugerida */}
        {sugestao.acao_sugerida && (
          <>
            <SectionTitle icon={Sparkles}>Ação sugerida</SectionTitle>
            <div style={{
              background: palette.accentSoft, border: `1px solid ${palette.accent}30`,
              borderRadius: 10, padding: 14, fontSize: fz(15), color: palette.ink, lineHeight: 1.55,
              marginBottom: 18, whiteSpace: 'pre-wrap', textAlign: 'left',
              overflowWrap: 'anywhere', // Ailson 08/05/2026
            }}>{renderMensagemComLinks(sugestao.acao_sugerida)}</div>
          </>
        )}

        {/* Produto sugerido */}
        {produto && (
          <>
            <SectionTitle icon={Package}>Produto sugerido</SectionTitle>
            <div style={{
              background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 10,
              padding: 12, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18,
            }}>
              <FotoProdutoLojas refProd={produto.ref} size={sz(56)} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: fz(13), color: palette.inkMuted, letterSpacing: 0.5 }}>REF {produto.ref}</div>
                <div style={{ fontSize: fz(16), color: palette.ink, fontWeight: 600, marginTop: 2 }}>
                  {produto.descricao || produto.modelo || `Produto ${produto.ref}`}
                </div>
                {produto.estoque_total != null && (
                  <div style={{ fontSize: fz(14), color: produto.estoque_total > 10 ? palette.ok : palette.warn, marginTop: 4 }}>
                    {produto.estoque_total} peças disponíveis
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Promoção ativa */}
        {promocao && (
          <>
            <SectionTitle icon={Tag}>Promoção ativa</SectionTitle>
            <div style={{
              background: palette.warnSoft, border: `1px solid ${palette.warn}40`, borderRadius: 10,
              padding: 12, fontSize: fz(15), color: palette.ink,
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18,
            }}>
              <Tag size={sz(17)} color={palette.warn} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{promocao.nome}</div>
                {promocao.descricao && (
                  <div style={{ fontSize: fz(13), color: palette.inkSoft, marginTop: 2 }}>{promocao.descricao}</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer fixo */}
      <div style={{
        position: 'sticky', bottom: 0, background: palette.surface,
        borderTop: `1px solid ${palette.beige}`, padding: 12,
        display: 'flex', flexDirection: 'column', gap: 8,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
      }}>
        <button onClick={onPedirMensagem} style={{
          background: `linear-gradient(135deg, ${palette.accent} 0%, #3d6b8c 100%)`,
          color: palette.bg, border: 'none', borderRadius: 10,
          padding: '13px 16px', fontSize: fz(16), fontWeight: 600,
          cursor: 'pointer', fontFamily: FONT,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: '0 2px 6px rgba(74,127,165,0.25)',
        }}>
          <LampIcon size={sz(21)} />
          Pedir sugestão de mensagem
        </button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={abrirWhatsApp} disabled={enviandoWhats} style={{
            flex: '1 1 100%',
            background: '#25D366',  // verde WhatsApp oficial
            color: 'white',
            border: 'none', borderRadius: 10, padding: '13px',
            fontSize: fz(16), fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 2px 6px rgba(37,211,102,0.35)',
            opacity: enviandoWhats ? 0.6 : 1,
          }}>
            <MessageCircle size={sz(20)} /> {enviandoWhats ? 'Abrindo…' : 'WhatsApp'}
          </button>
          <button onClick={marcarEnviada} style={{
            flex: 1, background: palette.surface, color: palette.accent,
            border: `1.5px solid ${palette.accent}`, borderRadius: 10, padding: '11px',
            fontSize: fz(15), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}><Check size={sz(17)} /> Já enviei</button>
          <button onClick={() => setShowRecusa(true)} style={{
            flex: 1, background: palette.surface, color: palette.inkSoft,
            border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '11px',
            fontSize: fz(15), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}><X size={sz(17)} /> Não faz sentido</button>
        </div>
      </div>

      {/* Modal editar/cadastrar WhatsApp.
          origem='whats': salva e abre WhatsApp na sequencia (botao verde)
          origem='edicao': so salva e fecha (botao azul) */}
      {showCadTelefone && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.5)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100,
        }} onClick={() => setShowCadTelefone(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: palette.surface, borderRadius: '16px 16px 0 0',
            padding: 20, width: '100%', maxWidth: 500, fontFamily: FONT,
          }}>
            <div style={{ fontSize: fz(18), fontWeight: 600, color: palette.ink, marginBottom: 4 }}>
              📱 {cliente?.telefone_principal && origemModalTel === 'edicao' ? 'Editar' : 'Cadastrar'} WhatsApp
            </div>
            <div style={{ fontSize: fz(14), color: palette.inkSoft, marginBottom: 16 }}>
              {cliente?.razao_social || cliente?.nome_fantasia || 'Cliente'}
            </div>
            <input
              type="tel"
              inputMode="numeric"
              autoFocus
              value={telefoneInput}
              onChange={(e) => setTelefoneInput(e.target.value)}
              placeholder="DDD + número (ex: 11987654321)"
              style={{
                width: '100%', padding: 12, fontSize: fz(16), fontFamily: FONT,
                border: `1.5px solid ${palette.beige}`, borderRadius: 8,
                marginBottom: 14, boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowCadTelefone(false)} style={{
                flex: 1, background: palette.surface, color: palette.inkSoft,
                border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '12px',
                fontSize: fz(15), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
              }}>Cancelar</button>
              <button onClick={salvarTelefoneCliente} disabled={salvandoTelefone} style={{
                flex: 2,
                background: origemModalTel === 'whats' ? '#25D366' : palette.accent,
                color: 'white',
                border: 'none', borderRadius: 10, padding: '12px',
                fontSize: fz(15), fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: salvandoTelefone ? 0.6 : 1,
              }}>
                {origemModalTel === 'whats' && <MessageCircle size={sz(18)} />}
                {salvandoTelefone
                  ? 'Salvando…'
                  : (origemModalTel === 'whats' ? 'Salvar e abrir' : 'Salvar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de recusa */}
      {showRecusa && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.5)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100,
        }} onClick={() => setShowRecusa(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: palette.surface, borderRadius: '16px 16px 0 0',
            padding: 20, width: '100%', maxWidth: 500, fontFamily: FONT,
          }}>
            <div style={{ fontSize: fz(18), fontWeight: 600, color: palette.ink, marginBottom: 4 }}>Por que não faz sentido?</div>
            <div style={{ fontSize: fz(14), color: palette.inkSoft, marginBottom: 16 }}>Escolha pra IA aprender o que melhor se encaixa</div>
            {[
              { motivo: 'pular_hoje', icon: Pause, color: palette.inkSoft, label: 'Pular hoje', sub: 'Volta em 7 dias' },
              { motivo: 'pular_30d', icon: Calendar, color: palette.warn, label: 'Pular 30 dias', sub: 'Cliente sazonal' },
              { motivo: 'arquivar', icon: Archive, color: palette.archive, label: 'Arquivar cliente', sub: 'Não sugerir mais' },
            ].map((op, i) => {
              const OpIcon = op.icon;
              return (
                <button key={i} onClick={() => dispensar(op.motivo)} style={{
                  width: '100%', background: palette.surface, border: `1px solid ${palette.beige}`,
                  borderRadius: 10, padding: 14, marginBottom: 8, cursor: 'pointer', fontFamily: FONT,
                  display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                }}>
                  <OpIcon size={sz(23)} color={op.color} />
                  <div>
                    <div style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink }}>{op.label}</div>
                    <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 2 }}>{op.sub}</div>
                  </div>
                </button>
              );
            })}
            <button onClick={() => setShowRecusa(false)} style={{
              width: '100%', background: 'transparent', color: palette.inkMuted,
              border: 'none', padding: 12, fontSize: fz(15), cursor: 'pointer', fontFamily: FONT, marginTop: 4,
            }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 4. MinhaCarteiraScreen — lista de clientes com filtros + sub-tipos sacola
// ═══════════════════════════════════════════════════════════════════════════

export const MinhaCarteiraScreen = ({
  lojas, vendedora, onBack, onSelectCliente, onAbrirGrupos, onSelectGrupo, onPedirMensagemRapida,
  onAbrirCadastrarComprador,
}) => {
  const { state, carteiraAtual, handleTransferirCliente } = lojas;
  // Persistir filtroStatus + ordenacao em localStorage — Ailson 11/05/2026.
  // Sem isso, ao navegar pra detalhe e voltar, componente desmonta e o filtro
  // volta pro default (todos/lifetime), forcando a vendedora a refiltrar.
  const [filtroStatus, setFiltroStatus] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('lojas_carteira_filtros') || '{}');
      return saved.filtroStatus || 'todos';
    } catch { return 'todos'; }
  });

  // ─── Transferir cliente (Ailson 11/05/2026) ────────────────────────────────
  // Atalho pra admin (Ailson + Tamara) transferir cliente direto do card,
  // sem precisar ir pra tela Admin > Transferir Carteira. Backend ja existe
  // via handleTransferirCliente do hook.
  const [clienteTransferir, setClienteTransferir] = useState(null);
  const [destinoTransferir, setDestinoTransferir] = useState('');
  const [motivoTransferir, setMotivoTransferir] = useState('');
  const [salvandoTransferencia, setSalvandoTransferencia] = useState(false);

  // Filtro "na janela de compra" — Ailson 06/05/2026.
  // Lê IDs de clientes dentro da janela via endpoint (calc em tempo real
  // da view vw_lojas_clientes_janela). Quando ativo, filtra a lista.
  const [idsNaJanela, setIdsNaJanela] = useState(null); // null = nao carregado
  const [filtroJanela, setFiltroJanela] = useState(false);
  // Contadores compactos — Ailson 07/05/2026: so Ativos+Atencao+Janela
  // visiveis sempre. Resto via "+" expand.
  // Ailson 11/05/2026: se o filtro persistido eh de linha expandida
  // (Sacola/S-Ativ/Inativ/Arquivo), inicia ja expandido pra ela ver
  // o chip ativo destacado.
  const [contadoresExpandidos, setContadoresExpandidos] = useState(() => {
    const STATUS_EXPANDIDOS = ['separandoSacola', 'semAtividade', 'inativo', 'arquivo', 'carrinhos'];
    try {
      const saved = JSON.parse(localStorage.getItem('lojas_carteira_filtros') || '{}');
      return STATUS_EXPANDIDOS.includes(saved.filtroStatus);
    } catch { return false; }
  });
  const [showInfoJanela, setShowInfoJanela] = useState(false);
  // Modal observações cliente — Ailson 07/05/2026 (etapa B)
  const [obsModalCliente, setObsModalCliente] = useState(null);
  const [obsCliente, setObsCliente] = useState({}); // cache local: {cliente_id: {observacoes ou null}}

  // Carrega observação ao abrir modal — Ailson 07/05/2026
  useEffect(() => {
    if (!obsModalCliente?.id) return;
    if (obsCliente[obsModalCliente.id] !== undefined) return; // ja tem em cache
    (async () => {
      try {
        const r = await fetch(`/api/lojas-cliente-observacoes?cliente_id=${obsModalCliente.id}`, {
          headers: { 'X-User': state.userId || '' },
        });
        if (r.ok) {
          const d = await r.json();
          setObsCliente(prev => ({ ...prev, [obsModalCliente.id]: d.observacoes || null }));
        }
      } catch (e) {
        console.warn('[obs] erro carregar:', e?.message);
      }
    })();
  }, [obsModalCliente?.id, state.userId, obsCliente]);

  useEffect(() => {
    if (!vendedora?.id) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(`/api/lojas-janela-cliente?vendedora_id=${vendedora.id}&filtro=na_janela`, {
          headers: { 'X-User': state.userId || '' },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelado) setIdsNaJanela(new Set((d.itens || []).map(i => i.cliente_id)));
      } catch {}
    })();
    return () => { cancelado = true; };
  }, [vendedora?.id, state.userId]);

  // ─── Carrega leads de carrinho dela (Ailson 12/05/2026) ────────────
  // Ailson decisão: depois q a vendedora envia mensagem WhatsApp, o lead
  // some da tab Carrinho geral e aparece AQUI na carteira dela quando o
  // filtro "🛒 Carrinhos" estiver ativo. Permite continuar fazendo follow-up.
  const [meusCarrinhos, setMeusCarrinhos] = useState([]);
  const [reloadCarrinhosKey, setReloadCarrinhosKey] = useState(0);
  useEffect(() => {
    if (!state.userId) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch('/api/lojas-leads-listar?escopo=meus_carrinhos', {
          headers: { 'X-User': state.userId },
        });
        const d = await r.json();
        if (!cancelado && r.ok && d.ok) {
          setMeusCarrinhos(d.leads || []);
        }
      } catch {}
    })();
    return () => { cancelado = true; };
  }, [state.userId, reloadCarrinhosKey]);

  // Realtime: a carteira "🛒 Carrinhos" atualiza quando a vendedora
  // pegar lock OU enviar msg. Ailson 14/05/2026.
  useEffect(() => {
    let timer = null;
    const ch = supabase
      .channel('minha-carteira-carrinhos')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'lojas_leads_carrinho' },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => setReloadCarrinhosKey(k => k + 1), 800);
        }
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(ch);
    };
  }, []);
  const [busca, setBusca] = useState('');
  const [ordenacao, setOrdenacao] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('lojas_carteira_filtros') || '{}');
      return saved.ordenacao || 'lifetime';
    } catch { return 'lifetime'; }
  });

  // Sincroniza filtroStatus + ordenacao no localStorage sempre que mudam.
  useEffect(() => {
    try {
      localStorage.setItem('lojas_carteira_filtros', JSON.stringify({
        filtroStatus,
        ordenacao,
      }));
    } catch { /* localStorage indisponivel — ignora silenciosamente */ }
  }, [filtroStatus, ordenacao]);
  const [mostrarVesti, setMostrarVesti] = useState(false);
  const [mostrarMeta, setMostrarMeta] = useState(false);

  // Itens da carteira: clientes soltos + grupos agregados
  const itensCarteira = useMemo(() => {
    // Clientes filtrados pela vendedora ativa (carteiraAtual já vem filtrado)
    const carteiraVendedora = vendedora
      ? carteiraAtual.filter(c => c.vendedora_id === vendedora.id)
      : carteiraAtual;

    // Clientes individuais (sem grupo)
    const clientesSoltos = carteiraVendedora
      .filter(c => !c.grupo_id)
      .map(c => ({
        tipo: 'cliente',
        id: 'c' + c.id,
        cliente: c,
        statusAtual: c.statusAtual,
        diasUltima: c.kpi?.dias_sem_comprar ?? 999,
        lifetime: c.kpi?.lifetime_total ?? 0,
        nome: nomeCliente(c),
      }));

    // Grupos com agregação dos seus CNPJs
    const gruposComAgregacao = state.grupos
      .filter(g => !vendedora || g.vendedora_id === vendedora.id)
      .map(g => {
        const docsDoGrupo = carteiraVendedora.filter(c => c.grupo_id === g.id);
        if (docsDoGrupo.length === 0) return null;

        const lifetime = docsDoGrupo.reduce((s, c) => s + (c.kpi?.lifetime_total || 0), 0);
        const compras = docsDoGrupo.reduce((s, c) => s + (c.kpi?.qtd_compras || 0), 0);
        const diasUltima = Math.min(...docsDoGrupo.map(c => c.kpi?.dias_sem_comprar ?? 999));

        // Status agregado: pega o MELHOR (mais ativo). Se um único doc do
        // grupo tá ativo, o grupo todo é ativo — porque grupo é "mesmo dono"
        // e ele já comprou recente por algum CNPJ.
        // Decisão Ailson 28/04/2026: era o contrario (pegava o pior status),
        // resultando em grupo INATIVO mesmo com doc principal comprando 5d
        // atras, so porque um CNPJ secundário tinha 0 compras.
        // Ordem do MELHOR pro PIOR — find() pega o 1o que algum doc tem.
        // 'arquivo' fica no fim porque so vale se TODOS estao arquivados.
        const ordemStatus = ['ativo', 'separandoSacola', 'atencao', 'semAtividade', 'inativo', 'arquivo'];
        const statusGrupo = ordemStatus.find(s => docsDoGrupo.some(c => c.statusAtual === s)) || 'ativo';

        return {
          tipo: 'grupo',
          id: 'g' + g.id,
          grupo: g,
          docsDoGrupo,
          statusAtual: statusGrupo,
          diasUltima, lifetime, compras,
          nome: g.nome_grupo,
          qtdDocs: docsDoGrupo.length,
        };
      })
      .filter(Boolean);

    return [...clientesSoltos, ...gruposComAgregacao];
  }, [carteiraAtual, state.grupos, vendedora]);

  const contadores = {
    ativo: itensCarteira.filter(i => i.statusAtual === 'ativo').length,
    atencao: itensCarteira.filter(i => i.statusAtual === 'atencao').length,
    semAtividade: itensCarteira.filter(i => i.statusAtual === 'semAtividade').length,
    separandoSacola: itensCarteira.filter(i => i.statusAtual === 'separandoSacola').length,
    inativo: itensCarteira.filter(i => i.statusAtual === 'inativo').length,
    arquivo: itensCarteira.filter(i => i.statusAtual === 'arquivo').length,
  };

  const itensFiltrados = itensCarteira
    .filter(i => filtroStatus === 'todos' || i.statusAtual === filtroStatus)
    .filter(i => {
      // Filtro "Na janela" — quando ativo, mostra so cliente cujo id esta no Set
      // Pra grupo, mostra se algum doc do grupo esta na janela
      if (!filtroJanela || !idsNaJanela) return true;
      if (i.tipo === 'cliente') return idsNaJanela.has(i.cliente.id);
      // grupo: algum cliente do grupo na janela
      return (i.docsDoGrupo || []).some(c => idsNaJanela.has(c.id));
    })
    .filter(i => {
      if (!busca) return true;
      const termo = busca.toLowerCase();
      if (i.tipo === 'cliente') {
        return (i.cliente.razao_social || '').toLowerCase().includes(termo)
          || (i.cliente.apelido || '').toLowerCase().includes(termo)
          || (i.cliente.nome_fantasia || '').toLowerCase().includes(termo);
      }
      return i.nome.toLowerCase().includes(termo)
        || i.docsDoGrupo.some(c => (c.razao_social || '').toLowerCase().includes(termo));
    })
    .sort((a, b) => {
      if (ordenacao === 'recentes') return a.diasUltima - b.diasUltima;
      if (ordenacao === 'lifetime') return b.lifetime - a.lifetime;
      if (ordenacao === 'antigos') return b.diasUltima - a.diasUltima;
      return a.nome.localeCompare(b.nome);
    });

  // Confirma transferência (chamada pelo modal admin)
  const confirmarTransferencia = async () => {
    if (!clienteTransferir) return;
    if (!destinoTransferir) {
      alert('Selecione uma vendedora destino');
      return;
    }
    setSalvandoTransferencia(true);
    try {
      await handleTransferirCliente(
        clienteTransferir.id,
        destinoTransferir,
        motivoTransferir || 'transferencia_admin_carteira',
      );
      const destino = (state.vendedoras || []).find(v => v.id === destinoTransferir);
      alert(`${nomeCliente(clienteTransferir)} transferido(a) pra ${destino?.nome || 'vendedora destino'}!`);
      setClienteTransferir(null);
      setDestinoTransferir('');
      setMotivoTransferir('');
    } catch (e) {
      alert('Erro ao transferir: ' + (e?.message || e));
    } finally {
      setSalvandoTransferencia(false);
    }
  };

  const Contador = ({ statusKey, label, count, corOverride, corSoftOverride }) => {
    const meta = statusMap[statusKey] || { cor: corOverride || palette.accent, soft: corSoftOverride || palette.accentSoft };
    const cor = corOverride || meta.cor;
    const soft = corSoftOverride || meta.soft;
    const ativo = filtroStatus === statusKey;
    return (
      <button onClick={() => setFiltroStatus(ativo ? 'todos' : statusKey)} style={{
        background: ativo ? soft : palette.surface,
        border: `1.5px solid ${ativo ? cor : palette.beige}`,
        borderRadius: 10, padding: '10px 6px', flex: 1, minWidth: 0, cursor: 'pointer',
        fontFamily: FONT, textAlign: 'center', transition: 'all 0.15s',
      }}>
        <div style={{ fontSize: fz(21), fontWeight: 700, color: ativo ? cor : palette.ink, lineHeight: 1 }}>{count}</div>
        <div style={{ fontSize: fz(10), color: ativo ? cor : palette.inkMuted, marginTop: 4, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>{label}</div>
      </button>
    );
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title={`Carteira de ${vendedora?.nome || ''}`}
        subtitle={`${vendedora?.loja || ''} · ${itensCarteira.length} ${itensCarteira.length === 1 ? 'item' : 'itens'} (${state.grupos.length} grupos)`}
        onBack={onBack}
        rightContent={(() => {
          const mobile = typeof window !== 'undefined' && window.innerWidth < 640;
          // Em mobile, botoes ficam so com icone (texto oculto) pra caber 4
          // botoes em telas estreitas. Em telas medias+ mostra texto.
          const btnStyle = {
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.15)',
            color: palette.bg,
            padding: mobile ? '8px 8px' : '6px 10px',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: fz(13), fontFamily: FONT, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: mobile ? 0 : 4,
            flexShrink: 0,
          };
          return (
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              {onAbrirCadastrarComprador && (
                <button onClick={onAbrirCadastrarComprador} style={btnStyle} title="Cadastrar nome do comprador">
                  <User size={sz(15)} /> {!mobile && 'Comprador'}
                </button>
              )}
              {/* Botão sininho push — discreto, mostra status */}
              {vendedora && (
                <BotaoSinoPush vendedora={vendedora} />
              )}
              {/* Botão 💰 Meta — vendedora ve seu progresso individual (Sprint A) */}
              {vendedora && (
                <button onClick={() => setMostrarMeta(true)} style={{
                  ...btnStyle,
                  background: 'rgba(212,160,23,0.25)',  // dourado suave
                  color: 'white',
                }} title="Minha meta">
                  <Coins size={sz(15)} /> {!mobile && 'Meta'}
                </button>
              )}
              {/* Botão Meus links Vesti — abre modal pra vendedora editar */}
              {vendedora && (
                <button onClick={() => setMostrarVesti(true)} style={{
                  ...btnStyle,
                  background: vendedora.vesti_link_ativo ? palette.purple : 'rgba(255,255,255,0.1)',
                  color: 'white',
                }} title="Meus links Vesti">
                  <Link2 size={sz(15)} /> {!mobile && `Vesti${vendedora.vesti_link_ativo ? ' ✓' : ''}`}
                </button>
              )}
              {onAbrirGrupos && (
                <button onClick={onAbrirGrupos} style={btnStyle} title="Grupos">
                  <UsersRound size={sz(15)} /> {!mobile && 'Grupos'}
                </button>
              )}
            </div>
          );
        })()}
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>
        {/* Contadores — Ailson 07/05/2026: compactos, mostra so essenciais
            + Janela em destaque com tooltip explicativo. Click "+" expande
            o resto (Sacola, S/Ativ, Inativ, Arq).
            Decisao: ATIVOS, ATENÇÃO e JANELA visiveis sempre. Resto via expand. */}
        <>
          {/* Linha 1: Janela em destaque (se carregou) */}
          {idsNaJanela && idsNaJanela.size > 0 && (
            <div style={{ marginBottom: 8 }}>
              <button
                onClick={() => setFiltroJanela(v => !v)}
                style={{
                  width: '100%',
                  background: filtroJanela ? '#eafbf0' : 'linear-gradient(90deg, #f0fdf4, #ecfdf5)',
                  border: `2px solid ${filtroJanela ? '#27ae60' : '#a7f3d0'}`,
                  borderRadius: 12, padding: '12px 14px',
                  cursor: 'pointer', fontFamily: FONT,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: fz(22) }}>🎯</span>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: fz(13), fontWeight: 700, color: '#15803d', letterSpacing: 0.3, textTransform: 'uppercase' }}>
                      Janela ideal de compra
                    </div>
                    <div style={{ fontSize: fz(12), color: '#166534', marginTop: 2 }}>
                      {idsNaJanela.size} cliente{idsNaJanela.size !== 1 ? 's' : ''} pront{idsNaJanela.size !== 1 ? 'os' : 'o'} pra contato
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowInfoJanela(true);
                    }}
                    style={{
                      width: 24, height: 24, borderRadius: 12,
                      background: '#27ae60', color: 'white',
                      fontSize: fz(13), fontWeight: 700,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer',
                    }}
                    title="Como funciona"
                  >?</span>
                  <span style={{
                    fontSize: fz(11), padding: '4px 10px', borderRadius: 8,
                    background: filtroJanela ? '#27ae60' : 'rgba(39, 174, 96, 0.15)',
                    color: filtroJanela ? 'white' : '#15803d',
                    fontWeight: 700,
                  }}>
                    {filtroJanela ? '✓ Filtrado' : 'Ver lista'}
                  </span>
                </div>
              </button>
            </div>
          )}

          {/* Linha 2: Contadores principais (Ativos + Atencao) + botao + */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {/* Botão "✕ Todos" — Ailson 11/05/2026
                Aparece SO quando ha filtro de status ativo, pra resetar
                sem precisar sair da tela. */}
            {filtroStatus !== 'todos' && (
              <button onClick={() => setFiltroStatus('todos')} style={{
                background: palette.accent, color: 'white',
                border: `1.5px solid ${palette.accent}`,
                borderRadius: 10, padding: '10px 12px',
                cursor: 'pointer', fontFamily: FONT,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 5, flexShrink: 0,
              }}
                title="Mostrar todos os clientes (limpar filtro)"
              >
                <X size={sz(14)} />
                <span style={{ fontSize: fz(12), fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Todos</span>
              </button>
            )}
            <Contador statusKey="ativo" label="Ativos" count={contadores.ativo} />
            <Contador statusKey="atencao" label="Atenção" count={contadores.atencao} />
            <button
              onClick={() => setContadoresExpandidos(!contadoresExpandidos)}
              style={{
                background: contadoresExpandidos ? palette.beigeSoft : palette.surface,
                border: `1px solid ${palette.beige}`,
                borderRadius: 10, padding: '10px 6px',
                minWidth: 60, cursor: 'pointer', fontFamily: FONT,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 4,
              }}
              title={contadoresExpandidos ? 'Recolher' : 'Ver mais filtros'}
            >
              <span style={{ fontSize: fz(20), fontWeight: 700, color: palette.inkSoft }}>
                {contadoresExpandidos ? '−' : '+'}
              </span>
              <span style={{ fontSize: fz(10), color: palette.inkMuted, fontWeight: 600 }}>
                {contadoresExpandidos ? 'menos' : 'mais'}
              </span>
            </button>
          </div>

          {/* Linha 3 (expandida): Sacola, S/Ativ, Inativ, Arquivo, 🛒 Carrinhos */}
          {contadoresExpandidos && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: 'auto' }}>
              <Contador statusKey="separandoSacola" label="Sacola" count={contadores.separandoSacola} />
              <Contador statusKey="semAtividade" label="S/Ativ" count={contadores.semAtividade} />
              <Contador statusKey="inativo" label="Inativ" count={contadores.inativo} />
              <Contador statusKey="arquivo" label="Arq" count={contadores.arquivo} />
              {/* 🛒 Carrinhos — Ailson 12/05/2026 (Onda 3)
                  Leads que ELA mandou mensagem WhatsApp ficam aqui pra
                  follow-up: pode pedir nova mensagem, salvar observações. */}
              <Contador
                statusKey="carrinhos"
                label="Carrinhos"
                count={meusCarrinhos.length}
                corOverride={palette.accent}
                corSoftOverride={palette.accentSoft}
              />
            </div>
          )}

          {/* Modal info Janela */}
          {showInfoJanela && (
            <div
              onClick={() => setShowInfoJanela(false)}
              style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 9999, padding: 20,
              }}
            >
              <div
                onClick={e => e.stopPropagation()}
                style={{
                  background: palette.surface, borderRadius: 14,
                  padding: 20, maxWidth: 420, width: '100%',
                  maxHeight: '80vh', overflowY: 'auto',
                  fontFamily: FONT,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: fz(28) }}>🎯</span>
                  <div style={{ fontSize: fz(18), fontWeight: 700, color: palette.ink }}>
                    Janela ideal de compra
                  </div>
                </div>

                <div style={{ fontSize: fz(14), color: palette.inkSoft, lineHeight: 1.6, marginBottom: 14 }}>
                  A IA calcula a <strong>média de dias</strong> que cada cliente costuma levar entre uma compra e outra.
                  Quando ela está perto desse intervalo natural, é o <strong>melhor momento</strong> pra você dar um alô.
                </div>

                <div style={{
                  background: '#eafbf0', border: '1px solid #a7f3d0',
                  borderRadius: 8, padding: 12, marginBottom: 14,
                  fontSize: fz(13), color: '#166534',
                }}>
                  <strong>Por que vale priorizar quem está na janela?</strong><br/>
                  <span style={{ color: '#1e7e34' }}>
                    Cliente fora da janela ainda está no ciclo natural — ela vai comprar sozinha em alguns dias. Mensagem agora pode soar invasiva.
                  </span><br/>
                  <span style={{ color: '#1e7e34' }}>
                    Cliente <strong>NA janela</strong> está no momento ideal — uma novidade, foto, ou simples lembrete pode acelerar a compra.
                  </span>
                </div>

                <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 14, lineHeight: 1.5 }}>
                  <strong>Detalhes técnicos:</strong><br/>
                  • Calculado com base nas últimas 10 compras da cliente<br/>
                  • Só aparece pra clientes com <strong>5+ compras</strong> distintas (média confiável)<br/>
                  • Janela = entre 70% e 100% do ciclo médio dela
                </div>

                <button
                  onClick={() => setShowInfoJanela(false)}
                  style={{
                    width: '100%',
                    background: '#27ae60', color: 'white',
                    border: 'none', borderRadius: 8, padding: '12px',
                    fontSize: fz(15), fontWeight: 600, cursor: 'pointer',
                    fontFamily: FONT,
                  }}
                >
                  Entendi
                </button>
              </div>
            </div>
          )}
        </>

        {/* Busca */}
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderRadius: 10, padding: '8px 12px', marginBottom: 10,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Search size={sz(18)} color={palette.inkMuted} />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, apelido ou razão social"
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontFamily: FONT, fontSize: fz(15), color: palette.ink,
            }} />
          {busca && (
            <button onClick={() => setBusca('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <X size={sz(16)} color={palette.inkMuted} />
            </button>
          )}
        </div>

        {/* Ordenação */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: fz(14), color: palette.inkSoft }}>
          <Filter size={sz(15)} />
          <span>Ordenar:</span>
          <select value={ordenacao} onChange={e => setOrdenacao(e.target.value)} style={{
            flex: 1, padding: '6px 8px', borderRadius: 6, border: `1px solid ${palette.beige}`,
            fontFamily: FONT, fontSize: fz(14), color: palette.ink, background: palette.surface,
          }}>
            <option value="lifetime">Quem já comprou mais</option>
            <option value="recentes">Compras recentes</option>
            <option value="antigos">Mais antigos</option>
            <option value="nome">Nome A-Z</option>
          </select>
        </div>

        <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 8 }}>
          {filtroStatus === 'carrinhos'
            ? `${meusCarrinhos.length} ${meusCarrinhos.length === 1 ? 'lead' : 'leads'} com mensagem enviada`
            : `${itensFiltrados.length} ${itensFiltrados.length === 1 ? 'item' : 'itens'}`
          }
        </div>

        {/* ━━━ Lista CARRINHOS — Ailson 12/05/2026 ━━━━━━━━━━━━━━━━━━━━━━ */}
        {/* Quando filtro Carrinhos ativo, mostra leads que ela mandou
            mensagem (em vez da lista de clientes normal). Permite follow-up. */}
        {filtroStatus === 'carrinhos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {meusCarrinhos.length === 0 && (
              <div style={{
                textAlign: 'center', padding: 30, color: palette.inkMuted,
                background: palette.surface, borderRadius: 12, border: `1px dashed ${palette.beige}`,
              }}>
                <div style={{ fontSize: fz(14), marginBottom: 4 }}>Nenhum carrinho aqui ainda</div>
                <div style={{ fontSize: fz(12), color: palette.inkMuted }}>
                  Quando vc enviar mensagem pra um lead na tab "🛒 Carrinho", ele vai aparecer aqui
                </div>
              </div>
            )}
            {meusCarrinhos.map(lead => (
              <LeadCard
                key={lead.id}
                lead={lead}
                userId={state.userId}
                isAdmin={state.isAdmin}
                vendedoraId={vendedora?.id}
                vendedoraNome={vendedora?.nome}
                limitesDiarios={{ pj: 1, pf: 1, pj_restante: 99, pf_restante: 99 }}
                onAcaoConcluida={() => setReloadCarrinhosKey(k => k + 1)}
              />
            ))}
          </div>
        )}

        {/* Lista normal de clientes (oculta quando filtro=carrinhos) */}
        {filtroStatus !== 'carrinhos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {itensFiltrados.map(item => {
            const meta = statusMap[item.statusAtual] || statusMap.ativo;

            // ━━━ Card de GRUPO ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            if (item.tipo === 'grupo') {
              const g = item.grupo;
              return (
                <div key={item.id} style={{
                  background: palette.surface, border: `1px solid ${palette.beige}`,
                  borderLeft: `3px solid ${meta.cor}`,
                  borderRadius: 10, padding: 12, position: 'relative',
                }}>
                  <div onClick={() => onSelectGrupo && onSelectGrupo(g)} style={{ cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                      <UsersRound size={sz(16)} color={palette.accent} />
                      <span style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink }}>{g.nome_grupo}</span>
                      <span style={{
                        fontSize: fz(10), fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                        background: palette.accentSoft, color: palette.accent,
                        letterSpacing: 0.3, textTransform: 'uppercase',
                      }}>GRUPO</span>
                      <span style={{
                        fontSize: fz(10), fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                        background: meta.soft, color: meta.cor, letterSpacing: 0.3, textTransform: 'uppercase',
                      }}>{meta.label}</span>
                    </div>
                    <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 4 }}>
                      {item.qtdDocs} {item.qtdDocs === 1 ? 'documento' : 'documentos'}
                    </div>
                    <div style={{ fontSize: fz(14), color: palette.inkSoft, marginBottom: 4 }}>
                      Última: {item.diasUltima} dias · {fmtMoeda(item.lifetime)} · {item.compras} compras
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${palette.beigeSoft}` }}>
                    <button onClick={() => onSelectGrupo && onSelectGrupo(g)} style={{
                      flex: 1, background: palette.surface, color: palette.accent,
                      border: `1px solid ${palette.accent}40`, borderRadius: 6, padding: '8px',
                      fontSize: fz(13), cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                    }}>
                      <UsersRound size={sz(14)} /> Ver grupo
                    </button>
                  </div>
                </div>
              );
            }

            // ━━━ Card de CLIENTE individual ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            const c = item.cliente;
            const fase = faseCicloVida(c);
            const faseMeta = faseClienteNovaMap[fase];
            const eNovaCheckin = fase === 'nova_checkin_pronto';
            const eNova = fase.startsWith('nova_');

            // Sub-tipo da sacola (se houver)
            const subtipoMeta = c.subtipoSacola ? subtipoSacolaMap[c.subtipoSacola] : null;

            return (
              <div key={item.id} style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderLeft: `3px solid ${meta.cor}`,
                borderRadius: 10, padding: 12,
              }}>
                <div onClick={() => onSelectCliente(c)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink }}>
                      {nomeCliente(c)}
                    </span>
                    <span style={{
                      fontSize: fz(10), fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                      background: meta.soft, color: meta.cor, letterSpacing: 0.3, textTransform: 'uppercase',
                    }}>{meta.label}</span>
                    {/* Badge cliente nova */}
                    {eNovaCheckin && (
                      <span style={{
                        fontSize: fz(10), fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                        background: palette.purpleSoft, color: palette.purple, letterSpacing: 0.3,
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}>
                        👋 Check-in dia 15
                      </span>
                    )}
                    {eNova && !eNovaCheckin && (
                      <span style={{
                        fontSize: fz(10), fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                        background: palette.beigeSoft, color: palette.inkSoft, letterSpacing: 0.3,
                      }}>
                        {faseMeta?.emoji} Cliente nova
                      </span>
                    )}
                  </div>
                  {c.apelido && (
                    <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 4 }}>{c.razao_social}</div>
                  )}
                  <div style={{ fontSize: fz(14), color: palette.inkSoft, marginBottom: 4 }}>
                    Última: {c.kpi?.dias_sem_comprar ?? '?'} dias · {fmtMoeda(c.kpi?.lifetime_total)} · {c.kpi?.qtd_compras ?? 0} compras
                  </div>

                  {/* Badge especial sub-tipo SACOLA */}
                  {subtipoMeta && (
                    <div style={{
                      marginTop: 8, padding: '6px 10px',
                      background: subtipoMeta.cor + '15',
                      border: `1px solid ${subtipoMeta.cor}40`,
                      borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: fz(13), fontWeight: 600, color: subtipoMeta.cor,
                    }}>
                      <span>{subtipoMeta.emoji}</span>
                      <span>{subtipoMeta.label}</span>
                      {c.diasSacola != null && (
                        <span style={{ marginLeft: 'auto', fontSize: fz(12), color: palette.inkMuted, fontWeight: 400 }}>
                          {c.diasSacola}d
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 6, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${palette.beigeSoft}` }}>
                  <button onClick={() => onSelectCliente(c)} style={{
                    flex: 1, background: palette.surface, color: palette.accent,
                    border: `1px solid ${palette.accent}40`, borderRadius: 6, padding: '8px',
                    fontSize: fz(13), cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}>
                    <History size={sz(14)} /> Histórico
                  </button>
                  <button onClick={() => onPedirMensagemRapida && onPedirMensagemRapida(c)} style={{
                    flex: 1, background: `${palette.yellow}15`, color: palette.ink,
                    border: `1px solid ${palette.yellow}50`, borderRadius: 6, padding: '8px',
                    fontSize: fz(13), cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}>
                    <LampIcon size={sz(14)} /> Pedir mensagem
                  </button>
                  {/* Botao observacoes IA — Ailson 07/05/2026 etapa B
                      Vendedora abre modal pra anotar contexto sobre cliente
                      (personalidade, evento recente, preferencias). Notas
                      ficam salvas e influenciam IA na proxima geracao. */}
                  {(() => {
                    // Detecta se cliente eh do tipo cliente (pra grupos nao mostra)
                    if (c.tipo !== 'cliente') return null;
                    const obs = obsCliente[c.cliente.id];
                    const temObs = obs && (obs.personalidade || obs.evento_recente
                      || obs.preferencias || obs.observacao_livre);
                    return (
                      <button
                        onClick={() => setObsModalCliente(c.cliente)}
                        title={temObs ? 'Editar observações sobre essa cliente' : 'Adicionar observações sobre essa cliente'}
                        style={{
                          background: temObs ? '#7c4dff15' : palette.surface,
                          color: temObs ? '#7c4dff' : palette.inkMuted,
                          border: `1px solid ${temObs ? '#7c4dff60' : palette.beige}`,
                          borderRadius: 6, padding: '8px 10px',
                          fontSize: fz(14), cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                          minWidth: 38,
                        }}
                      >
                        {temObs ? '📝' : '💡'}
                      </button>
                    );
                  })()}
                  {/* Botão Transferir cliente — Ailson 11/05/2026
                      Atalho admin-only (ele + Tamara). Abre modal sem sair da carteira. */}
                  {state.isAdmin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setClienteTransferir(c);
                        setDestinoTransferir('');
                        setMotivoTransferir('');
                      }}
                      title="Transferir cliente pra outra vendedora (admin)"
                      style={{
                        background: `${palette.accent}15`,
                        color: palette.accent,
                        border: `1px solid ${palette.accent}40`,
                        borderRadius: 6, padding: '8px 10px',
                        fontSize: fz(13), cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                        minWidth: 38,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <ArrowLeftRight size={sz(15)} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        )}

        {itensFiltrados.length === 0 && filtroStatus !== 'carrinhos' && (
          <div style={{
            padding: 32, textAlign: 'center', color: palette.inkMuted, fontSize: fz(15),
            background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12,
          }}>
            {busca ? 'Nenhum cliente encontrado pra essa busca.' : 'Nenhum cliente nessa categoria.'}
          </div>
        )}
      </div>

      {/* Modal Meus links Vesti */}
      {mostrarVesti && vendedora && (
        <ModalVestiLinks
          lojas={lojas}
          vendedora={vendedora}
          onClose={() => setMostrarVesti(false)}
        />
      )}

      {/* Modal Meta individual (Sprint A 04/05/2026) */}
      {mostrarMeta && vendedora && (
        <ModalMetaIndividual
          vendedora={vendedora}
          userId={state?.userId || ''}
          onClose={() => setMostrarMeta(false)}
        />
      )}

      {/* Modal Observações IA sobre cliente — Ailson 07/05/2026 (etapa B)
          Vendedora preenche perguntas guiadas + texto livre. Persiste em
          lojas_clientes.observacoes_ia. IA usa pra calibrar mensagens. */}
      {obsModalCliente && (
        <ModalObservacoesCliente
          cliente={obsModalCliente}
          userId={state?.userId || ''}
          observacoesAtuais={obsCliente[obsModalCliente.id] || null}
          onSalvar={(novaObs) => {
            // Atualiza cache local pra UI refletir imediato
            setObsCliente(prev => ({ ...prev, [obsModalCliente.id]: novaObs }));
            setObsModalCliente(null);
          }}
          onClose={() => setObsModalCliente(null)}
        />
      )}

      {/* Modal Transferir cliente (admin) — Ailson 11/05/2026 */}
      {clienteTransferir && (
        <div
          onClick={() => !salvandoTransferencia && setClienteTransferir(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, zIndex: 9999,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: palette.surface, borderRadius: 14,
              padding: 22, maxWidth: 440, width: '100%',
              maxHeight: '85vh', overflowY: 'auto',
              fontFamily: FONT,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <ArrowLeftRight size={sz(22)} color={palette.accent} />
              <div style={{ fontSize: fz(18), fontWeight: 700, color: palette.ink }}>
                Transferir cliente
              </div>
            </div>
            <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 16 }}>
              Função admin · sai da carteira de {vendedora?.nome || '?'}
            </div>

            <div style={{
              background: palette.beigeSoft || '#fafaf7',
              border: `1px solid ${palette.beige}`,
              borderRadius: 8, padding: '10px 12px', marginBottom: 16,
            }}>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>
                Cliente
              </div>
              <div style={{ fontSize: fz(15), fontWeight: 700, color: palette.ink }}>
                {nomeCliente(clienteTransferir)}
              </div>
              {clienteTransferir.razao_social && clienteTransferir.apelido && (
                <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 2 }}>
                  {clienteTransferir.razao_social}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>
                Vendedora destino
              </div>
              <select
                value={destinoTransferir}
                onChange={e => setDestinoTransferir(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${palette.beige}`, fontFamily: FONT,
                  fontSize: fz(14), color: palette.ink, background: palette.surface,
                  boxSizing: 'border-box',
                }}
              >
                <option value="">— Escolha uma vendedora —</option>
                {(state.vendedoras || [])
                  .filter(v => v.ativa && v.id !== vendedora?.id)
                  .sort((a, b) => (a.loja || '').localeCompare(b.loja || '') || (a.nome || '').localeCompare(b.nome || ''))
                  .map(v => (
                    <option key={v.id} value={v.id}>
                      {v.nome} · {v.loja}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>
                Motivo (opcional)
              </div>
              <input
                type="text"
                value={motivoTransferir}
                onChange={e => setMotivoTransferir(e.target.value)}
                placeholder="Ex: cliente foi pra outra loja"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${palette.beige}`, fontFamily: FONT,
                  fontSize: fz(14), color: palette.ink, background: palette.surface,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setClienteTransferir(null)}
                disabled={salvandoTransferencia}
                style={{
                  flex: 1, background: palette.surface, color: palette.inkMuted,
                  border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '12px',
                  fontSize: fz(14), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmarTransferencia}
                disabled={salvandoTransferencia || !destinoTransferir}
                style={{
                  flex: 2,
                  background: destinoTransferir ? palette.accent : palette.beige,
                  color: destinoTransferir ? 'white' : palette.inkMuted,
                  border: 'none', borderRadius: 8, padding: '12px',
                  fontSize: fz(14), fontWeight: 700, cursor: destinoTransferir && !salvandoTransferencia ? 'pointer' : 'not-allowed',
                  fontFamily: FONT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {salvandoTransferencia ? <><Loader2 size={sz(15)} className="spin"/> Transferindo...</> : <><ArrowLeftRight size={sz(15)}/> Transferir</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. DetalheClienteScreen — dados completos + apelido editável
// ═══════════════════════════════════════════════════════════════════════════

export const DetalheClienteScreen = ({
  lojas, cliente, onBack, onAbrirGrupo, onCriarGrupo, onPedirMensagem,
}) => {
  const { state, handleEditarApelido, handleEditarTelefone, handleArquivarCliente, handlePularCliente, handleTransferirCliente } = lojas;
  const [apelidoEdit, setApelidoEdit] = useState(false);
  const [apelido, setApelido] = useState(cliente.apelido || '');
  const [salvando, setSalvando] = useState(false);
  const [showAcoes, setShowAcoes] = useState(false);

  // Transferir cliente (admin-only) — Ailson 11/05/2026
  const [transferirAberto, setTransferirAberto] = useState(false);
  const [destinoTransferir, setDestinoTransferir] = useState('');
  const [motivoTransferir, setMotivoTransferir] = useState('');
  const [salvandoTransferencia, setSalvandoTransferencia] = useState(false);

  // Modal editar/cadastrar WhatsApp (telefone_principal)
  const [showEditTel, setShowEditTel] = useState(false);
  const [telInput, setTelInput] = useState('');
  const [salvandoTel, setSalvandoTel] = useState(false);

  // Observações da cliente — Ailson 10/05/2026
  // Vendedora abre modal pra anotar personalidade, evento, perfil de
  // compra, etc. IA usa pra calibrar mensagens. Carrega 1 vez ao montar.
  const [obsModalAberto, setObsModalAberto] = useState(false);
  const [obsAtuais, setObsAtuais] = useState(null);
  const [obsLoading, setObsLoading] = useState(true);
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(`/api/lojas-cliente-observacoes?cliente_id=${cliente.id}`, {
          headers: { 'X-User': state?.userId || '' },
        });
        const d = await r.json();
        if (!cancelado && r.ok) setObsAtuais(d.observacoes || null);
      } catch (e) {
        console.warn('Erro carregando observacoes:', e?.message);
      } finally {
        if (!cancelado) setObsLoading(false);
      }
    })();
    return () => { cancelado = true; };
  }, [cliente.id, state?.userId]);

  const temObs = obsAtuais && (
    obsAtuais.personalidade || obsAtuais.evento_recente ||
    (obsAtuais.perfil_compra?.length > 0) ||
    obsAtuais.preferencias ||
    (obsAtuais.reclamacoes?.length > 0) ||
    (obsAtuais.elogios?.length > 0)
    // obsLivre e eventos_timeline removidos da UI — nao contam pra "tem obs"
  );

  const abrirEditTelefone = () => {
    // Pre-preenche com o telefone atual (so digitos)
    const atual = String(cliente.telefone_principal || '').replace(/\D/g, '');
    setTelInput(atual);
    setShowEditTel(true);
  };

  const salvarTelefone = async () => {
    const limpo = telInput.replace(/\D/g, '');
    if (limpo && (limpo.length < 10 || limpo.length > 11)) {
      alert('Telefone deve ter 10 ou 11 dígitos (com DDD)');
      return;
    }
    setSalvandoTel(true);
    try {
      await handleEditarTelefone(cliente.id, limpo);
      setShowEditTel(false);
    } catch (e) {
      alert('Erro: ' + e.message);
    } finally {
      setSalvandoTel(false);
    }
  };

  // Atualiza local quando cliente muda
  useEffect(() => {
    setApelido(cliente.apelido || '');
  }, [cliente.apelido]);

  // Fetch dados da janela de compra (view vw_lojas_clientes_janela)
  // Ailson 06/05/2026 noite. Mostra media de dias + dias ate janela
  // SO se cliente tem >=5 visitas (media_confiavel=true). Caso contrario
  // omite (decisao Ailson 3a).
  const [janela, setJanela] = useState(null);
  useEffect(() => {
    if (!cliente?.id) return;
    let cancelado = false;
    (async () => {
      try {
        const r = await fetch(`/api/lojas-janela-cliente?cliente_id=${cliente.id}`, {
          headers: { 'X-User': state.userId || '' },
        });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelado) setJanela(d);
      } catch {}
    })();
    return () => { cancelado = true; };
  }, [cliente?.id, state.userId]);

  const kpi = cliente.kpi || state.clientesKpis[cliente.id] || {};
  const meta = statusMap[cliente.statusAtual] || statusMap.ativo;
  const ticketMedio = kpi.ticket_medio_total || (kpi.lifetime_total && kpi.qtd_compras ? Math.round(kpi.lifetime_total / kpi.qtd_compras) : null);
  const fase = faseCicloVida(cliente);
  const faseMeta = faseClienteNovaMap[fase];

  // Vendedora atual
  const vendedoraAtual = state.vendedoras.find(v => v.id === cliente.vendedora_id);

  // Grupo do cliente (se tiver)
  const grupoDoCliente = cliente.grupo_id ? state.grupos.find(g => g.id === cliente.grupo_id) : null;

  // Sacola ativa
  const sacolaAtiva = cliente.sacolaAtiva;
  const subtipoMeta = cliente.subtipoSacola ? subtipoSacolaMap[cliente.subtipoSacola] : null;

  // Salvar apelido
  const salvarApelido = async () => {
    if (apelido === (cliente.apelido || '')) {
      setApelidoEdit(false);
      return;
    }
    setSalvando(true);
    try {
      await handleEditarApelido(cliente.id, apelido.trim() || null);
      setApelidoEdit(false);
    } catch (e) {
      alert('Erro ao salvar apelido: ' + e.message);
    } finally {
      setSalvando(false);
    }
  };

  // Transferir cliente (admin) — Ailson 11/05/2026
  const confirmarTransferencia = async () => {
    if (!destinoTransferir) {
      alert('Selecione uma vendedora destino');
      return;
    }
    setSalvandoTransferencia(true);
    try {
      await handleTransferirCliente(
        cliente.id,
        destinoTransferir,
        motivoTransferir || 'transferencia_admin_detalhe',
      );
      const destino = (state.vendedoras || []).find(v => v.id === destinoTransferir);
      alert(`${nomeCliente(cliente)} transferido(a) pra ${destino?.nome || 'vendedora destino'}!`);
      setTransferirAberto(false);
      setDestinoTransferir('');
      setMotivoTransferir('');
      // Volta pra carteira (cliente nao esta mais aqui)
      if (onBack) onBack();
    } catch (e) {
      alert('Erro ao transferir: ' + (e?.message || e));
    } finally {
      setSalvandoTransferencia(false);
    }
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title={nomeCliente(cliente)}
        subtitle={meta.label}
        onBack={onBack}
        rightContent={
          <button onClick={() => setShowAcoes(true)} style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
            color: palette.bg, padding: '6px 10px', borderRadius: 8,
            cursor: 'pointer', fontSize: fz(13), fontFamily: FONT, fontWeight: 600,
          }}>
            ⋯
          </button>
        }
      />
      <div style={{ padding: 16, paddingBottom: 100 }}>

        {/* Header card do cliente */}
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderLeft: `4px solid ${meta.cor}`, borderRadius: 12, padding: 14, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: palette.inkSoft, marginBottom: 4 }}>
            <Store size={sz(15)} />
            <span style={{ fontSize: fz(12), letterSpacing: 0.5, textTransform: 'uppercase' }}>
              {cliente.cnpj ? 'CNPJ' : 'CPF'}
            </span>
          </div>
          <div style={{ fontSize: fz(16), color: palette.ink, fontWeight: 600, marginBottom: 4 }}>{cliente.razao_social}</div>
          {cliente.cnpj && (
            <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 12, fontFamily: 'monospace' }}>
              {cliente.cnpj}
            </div>
          )}

          {/* Apelido editável */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${palette.beigeSoft}` }}>
            <Pencil size={sz(15)} color={palette.inkSoft} />
            {apelidoEdit ? (
              <>
                <input autoFocus value={apelido} onChange={e => setApelido(e.target.value)}
                  onBlur={salvarApelido}
                  onKeyDown={e => {
                    if (e.key === 'Enter') salvarApelido();
                    if (e.key === 'Escape') { setApelido(cliente.apelido || ''); setApelidoEdit(false); }
                  }}
                  placeholder="Apelido"
                  disabled={salvando}
                  style={{
                    flex: 1, border: `1px solid ${palette.accent}`, background: palette.surface,
                    padding: '4px 8px', borderRadius: 6, fontSize: fz(15), fontFamily: FONT, outline: 'none',
                  }} />
                {salvando && <Loader2 size={sz(16)} style={{ animation: 'spin 1s linear infinite', color: palette.accent }} />}
              </>
            ) : (
              <button onClick={() => setApelidoEdit(true)} style={{
                flex: 1, background: 'transparent', border: 'none', textAlign: 'left',
                cursor: 'pointer', fontFamily: FONT, fontSize: fz(15), color: palette.ink,
              }}>
                Comprador: <strong>{apelido || 'sem nome'}</strong>
              </button>
            )}
          </div>

          {/* Telefone (WhatsApp) — sempre visivel pra editar / cadastrar */}
          <div style={{ padding: '8px 0', borderTop: `1px solid ${palette.beigeSoft}`,
            display: 'flex', alignItems: 'center', gap: 8 }}>
            <Phone size={sz(15)} color={palette.inkSoft} />
            {cliente.telefone_principal ? (
              <>
                <div style={{ flex: 1 }}>
                  <TelefoneCopiavel telefone={cliente.telefone_principal} />
                </div>
                <button onClick={() => abrirEditTelefone()} style={{
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', padding: 4,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }} title="Editar WhatsApp">
                  <Pencil size={sz(15)} color={palette.inkSoft} />
                </button>
              </>
            ) : (
              <button onClick={() => abrirEditTelefone()} style={{
                flex: 1, background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left', fontFamily: FONT,
                fontSize: fz(14), color: palette.accent, padding: 0,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <Plus size={sz(14)} /> Adicionar WhatsApp
              </button>
            )}
          </div>

          {/* Vendedora atual */}
          {vendedoraAtual && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${palette.beigeSoft}`, fontSize: fz(15), color: palette.inkSoft }}>
              <Users size={sz(15)} />
              <span>Carteira de <strong style={{ color: palette.ink }}>{vendedoraAtual.nome}</strong> · {vendedoraAtual.loja}</span>
            </div>
          )}

          {/* Grupo (se tiver) */}
          {grupoDoCliente && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: `1px solid ${palette.beigeSoft}` }}>
              <UsersRound size={sz(15)} color={palette.accent} />
              <button onClick={() => onAbrirGrupo && onAbrirGrupo(grupoDoCliente)} style={{
                flex: 1, background: 'transparent', border: 'none', textAlign: 'left',
                cursor: 'pointer', fontFamily: FONT, fontSize: fz(15), color: palette.accent, fontWeight: 600,
              }}>
                Pertence ao grupo "{grupoDoCliente.nome_grupo}" →
              </button>
            </div>
          )}
        </div>

        {/* Sacola ativa em destaque */}
        {sacolaAtiva && subtipoMeta && (
          <div style={{
            background: subtipoMeta.cor + '15',
            border: `1.5px solid ${subtipoMeta.cor}`,
            borderRadius: 12, padding: 14, marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <ShoppingBag size={sz(18)} color={subtipoMeta.cor} />
              <span style={{ fontSize: fz(15), fontWeight: 600, color: subtipoMeta.cor }}>
                {subtipoMeta.emoji} {subtipoMeta.label}
              </span>
              {cliente.diasSacola != null && (
                <span style={{ marginLeft: 'auto', fontSize: fz(13), color: palette.inkMuted }}>
                  {cliente.diasSacola}d em espera
                </span>
              )}
            </div>
            {sacolaAtiva.valor_total != null && (
              <div style={{ fontSize: fz(14), color: palette.inkSoft }}>
                Valor da sacola: <strong>{fmtMoeda(sacolaAtiva.valor_total)}</strong>
                {sacolaAtiva.qtd_pecas && ` · ${sacolaAtiva.qtd_pecas} peças`}
              </div>
            )}
          </div>
        )}

        {/* Cliente nova destaque */}
        {fase.startsWith('nova_') && faseMeta && (
          <div style={{
            background: fase === 'nova_checkin_pronto' ? palette.purpleSoft : palette.beigeSoft,
            border: `1px solid ${fase === 'nova_checkin_pronto' ? palette.purple : palette.beige}`,
            borderRadius: 10, padding: 12, marginBottom: 16,
            fontSize: fz(14), color: palette.ink, lineHeight: 1.5,
          }}>
            {faseMeta.emoji} <strong>{faseMeta.label}</strong>
            {fase === 'nova_aguardando' && ' · não enviar mensagem ainda, deixar a cliente experimentar.'}
            {fase === 'nova_checkin_pronto' && ' · momento certo de fazer um check-in!'}
            {fase === 'nova_em_analise' && ' · cliente em fase de avaliação, evitar pressão.'}
          </div>
        )}

        {/* Resumo financeiro */}
        <SectionTitle icon={BarChart3}>Histórico de compras</SectionTitle>
        <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
          <div style={{ fontSize: fz(16), color: palette.ink, lineHeight: 1.7 }}>
            <strong>{kpi.qtd_compras || 0} {kpi.qtd_compras === 1 ? 'compra' : 'compras'}</strong> · <strong>{fmtMoeda(kpi.lifetime_total)}</strong> já comprou
          </div>
          {ticketMedio && (
            <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.7, marginTop: 2 }}>
              Ticket médio {fmtMoeda(ticketMedio)}
            </div>
          )}
          {kpi.dias_sem_comprar != null && (
            <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.7 }}>
              Última compra há <strong>{kpi.dias_sem_comprar} dias</strong>
            </div>
          )}
          {/* Media de dias entre compras + dias ate janela
              Mostrado SO se cliente tem >=5 visitas distintas (media_confiavel).
              Decisao Ailson 06/05/2026 (3a): omitir quando nao confiavel. */}
          {janela?.media_confiavel && janela?.media_dias_compras && (
            <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.7 }}>
              Compra a cada <strong>{Math.round(janela.media_dias_compras)} dias</strong>
              {' '}<span style={{ fontSize: fz(13), color: palette.inkSoft }}>(média de {janela.qtd_datas_unicas} compras)</span>
            </div>
          )}
          {janela?.media_confiavel && janela?.dias_ate_janela_atencao != null && (() => {
            const d = janela.dias_ate_janela_atencao;
            const dentro = janela.dentro_janela_compra;
            // 3 estados visuais:
            //   d > 0  → "Faltam X dias pra entrar na janela" (cinza)
            //   dentro=true → "Está na janela agora!" (verde)
            //   d < 0 sem dentro → "Passou da janela há X dias" (vermelho leve)
            if (dentro) {
              return (
                <div style={{ fontSize: fz(15), fontWeight: 600, color: '#27ae60', lineHeight: 1.7, marginTop: 4, padding: '4px 10px', background: '#eafbf0', borderRadius: 6, display: 'inline-block' }}>
                  🎯 Está na janela de compra agora
                </div>
              );
            }
            if (d > 0) {
              return (
                <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.7 }}>
                  Faltam <strong>{d} dias</strong> pra entrar na janela
                </div>
              );
            }
            // d <= 0 e nao dentro = passou
            return (
              <div style={{ fontSize: fz(15), fontWeight: 600, color: '#c0392b', lineHeight: 1.7, marginTop: 4, padding: '4px 10px', background: '#fdeaea', borderRadius: 6, display: 'inline-block' }}>
                ⚠ Passou da janela há {Math.abs(d)} dias
              </div>
            );
          })()}
        </div>

        {/* Estilo dominante */}
        {kpi.estilo_dominante && (
          <>
            <SectionTitle icon={Heart}>Estilo dominante</SectionTitle>
            <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: fz(16), color: palette.ink, fontWeight: 600 }}>{kpi.estilo_dominante}</div>
              <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 4 }}>Calculado a partir das peças que mais comprou</div>
            </div>
          </>
        )}

        {/* Tamanhos */}
        {kpi.tamanhos_frequentes && Array.isArray(kpi.tamanhos_frequentes) && kpi.tamanhos_frequentes.length > 0 && (
          <>
            <SectionTitle icon={Tag}>Tamanhos que costuma pedir</SectionTitle>
            <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 10, padding: 12, marginBottom: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {kpi.tamanhos_frequentes.map(t => (
                <span key={t} style={{
                  padding: '6px 14px', background: palette.beigeSoft, borderRadius: 6,
                  fontSize: fz(15), fontWeight: 600, color: palette.ink,
                }}>{t}</span>
              ))}
            </div>
          </>
        )}

        {/* Histórico de vendedoras */}
        {vendedoraAtual && (
          <>
            <SectionTitle icon={Users}>Vendedora atual</SectionTitle>
            <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: fz(15), color: palette.ink, padding: '4px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  padding: '2px 8px', background: palette.accentSoft, color: palette.accent,
                  borderRadius: 4, fontSize: fz(12), fontWeight: 600, letterSpacing: 0.3,
                }}>ATUAL</span>
                {vendedoraAtual.nome} · desde {fmtData(cliente.data_atribuicao)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer fixo */}
      <div style={{
        position: 'sticky', bottom: 0, background: palette.surface,
        borderTop: `1px solid ${palette.beige}`, padding: 12,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {/* Transferir cliente — botão admin-only (Ailson 11/05/2026) */}
        {state.isAdmin && (
          <button
            onClick={() => {
              setTransferirAberto(true);
              setDestinoTransferir('');
              setMotivoTransferir('');
            }}
            style={{
              background: `${palette.accent}10`,
              color: palette.accent,
              border: `1px dashed ${palette.accent}60`,
              borderRadius: 10,
              padding: '9px 16px', fontSize: fz(13), fontWeight: 600,
              cursor: 'pointer', fontFamily: FONT, width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            <ArrowLeftRight size={sz(15)} />
            Transferir cliente (admin)
          </button>
        )}
        {/* Observações da cliente — Ailson 10/05/2026 */}
        <button onClick={() => setObsModalAberto(true)} style={{
          background: temObs ? '#eff5fa' : palette.surface,
          color: palette.ink,
          border: `1.5px solid ${temObs ? palette.accent : palette.beige}`,
          borderRadius: 10,
          padding: '11px 16px', fontSize: fz(14), fontWeight: 600,
          cursor: 'pointer', fontFamily: FONT, width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <span style={{ fontSize: fz(17) }}>📝</span>
          {obsLoading ? 'Observações da cliente' : (temObs ? 'Observações da cliente ✓' : 'Adicionar observações da cliente')}
        </button>
        <button onClick={() => onPedirMensagem && onPedirMensagem(cliente)} style={{
          background: `linear-gradient(135deg, ${palette.accent} 0%, #3d6b8c 100%)`,
          color: palette.bg, border: 'none', borderRadius: 10,
          padding: '13px 16px', fontSize: fz(16), fontWeight: 600,
          cursor: 'pointer', fontFamily: FONT, width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: '0 2px 6px rgba(74,127,165,0.25)',
        }}>
          <LampIcon size={sz(21)} />
          Pedir sugestão de mensagem
        </button>
      </div>

      {/* Modal Transferir cliente (admin) — Ailson 11/05/2026 */}
      {transferirAberto && (
        <div
          onClick={() => !salvandoTransferencia && setTransferirAberto(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, zIndex: 9999,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: palette.surface, borderRadius: 14,
              padding: 22, maxWidth: 440, width: '100%',
              maxHeight: '85vh', overflowY: 'auto',
              fontFamily: FONT,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <ArrowLeftRight size={sz(22)} color={palette.accent} />
              <div style={{ fontSize: fz(18), fontWeight: 700, color: palette.ink }}>
                Transferir cliente
              </div>
            </div>
            <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 16 }}>
              Função admin · sai da carteira de {vendedoraAtual?.nome || '?'}
            </div>

            <div style={{
              background: palette.beigeSoft || '#fafaf7',
              border: `1px solid ${palette.beige}`,
              borderRadius: 8, padding: '10px 12px', marginBottom: 16,
            }}>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 4 }}>
                Cliente
              </div>
              <div style={{ fontSize: fz(15), fontWeight: 700, color: palette.ink }}>
                {nomeCliente(cliente)}
              </div>
              {cliente.razao_social && cliente.apelido && (
                <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 2 }}>
                  {cliente.razao_social}
                </div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>
                Vendedora destino
              </div>
              <select
                value={destinoTransferir}
                onChange={e => setDestinoTransferir(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${palette.beige}`, fontFamily: FONT,
                  fontSize: fz(14), color: palette.ink, background: palette.surface,
                  boxSizing: 'border-box',
                }}
              >
                <option value="">— Escolha uma vendedora —</option>
                {(state.vendedoras || [])
                  .filter(v => v.ativa && v.id !== cliente.vendedora_id)
                  .sort((a, b) => (a.loja || '').localeCompare(b.loja || '') || (a.nome || '').localeCompare(b.nome || ''))
                  .map(v => (
                    <option key={v.id} value={v.id}>
                      {v.nome} · {v.loja}
                    </option>
                  ))}
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>
                Motivo (opcional)
              </div>
              <input
                type="text"
                value={motivoTransferir}
                onChange={e => setMotivoTransferir(e.target.value)}
                placeholder="Ex: cliente foi pra outra loja"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${palette.beige}`, fontFamily: FONT,
                  fontSize: fz(14), color: palette.ink, background: palette.surface,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setTransferirAberto(false)}
                disabled={salvandoTransferencia}
                style={{
                  flex: 1, background: palette.surface, color: palette.inkMuted,
                  border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '12px',
                  fontSize: fz(14), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmarTransferencia}
                disabled={salvandoTransferencia || !destinoTransferir}
                style={{
                  flex: 2,
                  background: destinoTransferir ? palette.accent : palette.beige,
                  color: destinoTransferir ? 'white' : palette.inkMuted,
                  border: 'none', borderRadius: 8, padding: '12px',
                  fontSize: fz(14), fontWeight: 700,
                  cursor: destinoTransferir && !salvandoTransferencia ? 'pointer' : 'not-allowed',
                  fontFamily: FONT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {salvandoTransferencia ? <><Loader2 size={sz(15)} className="spin"/> Transferindo...</> : <><ArrowLeftRight size={sz(15)}/> Transferir</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Observações da cliente — Ailson 10/05/2026 */}
      {obsModalAberto && (
        <ModalObservacoesCliente
          cliente={cliente}
          userId={state?.userId || ''}
          observacoesAtuais={obsAtuais}
          onSalvar={(novaObs) => {
            setObsAtuais(novaObs);
            setObsModalAberto(false);
          }}
          onClose={() => setObsModalAberto(false)}
        />
      )}

      {/* Modal editar/cadastrar WhatsApp */}
      {showEditTel && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.5)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100,
        }} onClick={() => setShowEditTel(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: palette.surface, borderRadius: '16px 16px 0 0',
            padding: 20, width: '100%', maxWidth: 500, fontFamily: FONT,
          }}>
            <div style={{ fontSize: fz(18), fontWeight: 600, color: palette.ink, marginBottom: 4 }}>
              📱 {cliente.telefone_principal ? 'Editar' : 'Cadastrar'} WhatsApp
            </div>
            <div style={{ fontSize: fz(13), color: palette.inkSoft, marginBottom: 14 }}>
              {nomeCliente(cliente)}
            </div>
            <input
              type="tel"
              inputMode="numeric"
              autoFocus
              value={telInput}
              onChange={(e) => setTelInput(e.target.value)}
              placeholder="DDD + número (ex: 11987654321)"
              style={{
                width: '100%', padding: 12, fontSize: fz(16), fontFamily: FONT,
                border: `1.5px solid ${palette.beige}`, borderRadius: 8,
                marginBottom: 14, boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowEditTel(false)} style={{
                flex: 1, background: palette.surface, color: palette.inkSoft,
                border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '12px',
                fontSize: fz(15), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
              }}>Cancelar</button>
              <button onClick={salvarTelefone} disabled={salvandoTel} style={{
                flex: 2, background: palette.accent, color: 'white',
                border: 'none', borderRadius: 10, padding: '12px',
                fontSize: fz(15), fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
                opacity: salvandoTel ? 0.6 : 1,
              }}>
                {salvandoTel ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de ações secundárias */}
      {showAcoes && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.5)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 100,
        }} onClick={() => setShowAcoes(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: palette.surface, borderRadius: '16px 16px 0 0',
            padding: 20, width: '100%', maxWidth: 500, fontFamily: FONT,
          }}>
            <div style={{ fontSize: fz(18), fontWeight: 600, color: palette.ink, marginBottom: 14 }}>Ações</div>

            {!grupoDoCliente && onCriarGrupo && (
              <button onClick={() => { onCriarGrupo(cliente); setShowAcoes(false); }} style={{
                width: '100%', background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 10, padding: 14, marginBottom: 8, cursor: 'pointer', fontFamily: FONT,
                display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
              }}>
                <UsersRound size={sz(23)} color={palette.accent} />
                <div>
                  <div style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink }}>Criar/adicionar a grupo</div>
                  <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 2 }}>Agrupar com outros CNPJs do mesmo dono</div>
                </div>
              </button>
            )}

            <button onClick={async () => {
              if (confirm('Pular sugestões dessa cliente por 7 dias?')) {
                try {
                  await handlePularCliente(cliente.id, 7);
                  setShowAcoes(false);
                  onBack && onBack();
                } catch (e) { alert('Erro: ' + e.message); }
              }
            }} style={{
              width: '100%', background: palette.surface, border: `1px solid ${palette.beige}`,
              borderRadius: 10, padding: 14, marginBottom: 8, cursor: 'pointer', fontFamily: FONT,
              display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
            }}>
              <Pause size={sz(23)} color={palette.warn} />
              <div>
                <div style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink }}>Pular 7 dias</div>
                <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 2 }}>Não sugerir essa cliente por uma semana</div>
              </div>
            </button>

            <button onClick={async () => {
              const motivo = prompt('Motivo do arquivamento (opcional):');
              if (motivo !== null) {
                try {
                  await handleArquivarCliente(cliente.id, motivo || 'arquivado pela vendedora');
                  setShowAcoes(false);
                  onBack && onBack();
                } catch (e) { alert('Erro: ' + e.message); }
              }
            }} style={{
              width: '100%', background: palette.surface, border: `1px solid ${palette.alert}40`,
              borderRadius: 10, padding: 14, marginBottom: 8, cursor: 'pointer', fontFamily: FONT,
              display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
            }}>
              <Archive size={sz(23)} color={palette.alert} />
              <div>
                <div style={{ fontSize: fz(16), fontWeight: 600, color: palette.alert }}>Arquivar cliente</div>
                <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 2 }}>Não sugerir mais (pode reverter no admin)</div>
              </div>
            </button>

            <button onClick={() => setShowAcoes(false)} style={{
              width: '100%', background: 'transparent', color: palette.inkMuted,
              border: 'none', padding: 12, fontSize: fz(15), cursor: 'pointer', fontFamily: FONT, marginTop: 4,
            }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── ConversoesVendedora — feedback motivacional (Ailson 06/05/2026) ──────
// Card que mostra clientes resgatados (atencao/semAtividade/inativo que
// viraram venda em ate 15d apos receber mensagem). Quando tem >0,
// parabeniza e detalha. Quando 0, encoraja sem desmotivar.
const ConversoesVendedora = ({ conversoes, fz, sz }) => {
  const total = conversoes?.total || 0;
  const valor = conversoes?.valor_total || 0;
  const porStatus = conversoes?.por_status || { atencao: 0, semAtividade: 0, inativo: 0 };

  // Sem conversões ainda — encorajamento
  if (total === 0) {
    return (
      <div style={{
        background: palette.beigeSoft, border: `1px solid ${palette.beige}`,
        borderRadius: 14, padding: 16, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Target size={sz(20)} color={palette.inkSoft} />
          <span style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink }}>
            Nenhuma conversão ainda este mês
          </span>
        </div>
        <div style={{ fontSize: fz(13), color: palette.inkSoft, lineHeight: 1.5 }}>
          Toda venda de cliente em atenção, +3M ou +6M após enviar mensagem
          conta como conversão. Continue mandando! Cada mensagem aumenta sua chance. 💪
        </div>
      </div>
    );
  }

  const fmtR = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  // Frase motivacional baseada no volume
  let parabens = '👏 Mandou bem!';
  if (total >= 10) parabens = '🔥 Você está em chamas!';
  else if (total >= 5) parabens = '🌟 Excelente trabalho!';
  else if (total >= 3) parabens = '💪 Continua assim!';

  return (
    <div style={{
      background: `linear-gradient(135deg, ${palette.purpleSoft} 0%, ${palette.bg} 100%)`,
      border: `1px solid ${palette.purple}40`,
      borderRadius: 14, padding: 16, marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%', background: palette.surface,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: `2px solid ${palette.purple}`,
        }}>
          <Award size={sz(24)} color={palette.purple} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: fz(20), fontWeight: 700, color: palette.ink }}>
            {total} {total === 1 ? 'cliente resgatada' : 'clientes resgatadas'}
          </div>
          <div style={{ fontSize: fz(12), color: palette.inkMuted }}>
            {fmtR(valor)} em vendas · {parabens}
          </div>
        </div>
      </div>

      <div style={{
        background: palette.surface, borderRadius: 8, padding: 10,
        fontSize: fz(13), color: palette.inkSoft,
      }}>
        Resgatadas por status crítico:
        <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap', fontFamily: FONT }}>
          {porStatus.atencao > 0 && (
            <span><strong style={{ color: palette.warn, fontSize: fz(15) }}>{porStatus.atencao}</strong>
              <span style={{ fontSize: fz(11), marginLeft: 4, color: palette.inkMuted }}>em atenção</span></span>
          )}
          {porStatus.semAtividade > 0 && (
            <span><strong style={{ color: '#d4a017', fontSize: fz(15) }}>{porStatus.semAtividade}</strong>
              <span style={{ fontSize: fz(11), marginLeft: 4, color: palette.inkMuted }}>+3M</span></span>
          )}
          {porStatus.inativo > 0 && (
            <span><strong style={{ color: '#e67e22', fontSize: fz(15) }}>{porStatus.inativo}</strong>
              <span style={{ fontSize: fz(11), marginLeft: 4, color: palette.inkMuted }}>+6M</span></span>
          )}
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 6. DestaquesScreen — KPIs da semana da vendedora
// ═══════════════════════════════════════════════════════════════════════════

export const DestaquesScreen = ({ lojas, vendedora, onBack }) => {
  const { state, clientesEnriquecidos } = lojas;
  const [composicaoExpandida, setComposicaoExpandida] = useState(false);
  const [conversoes, setConversoes] = useState(null);
  const [carregandoConv, setCarregandoConv] = useState(true);

  // KPIs da semana
  const stats = useMemo(() => {
    const carteira = clientesEnriquecidos.filter(c => c.vendedora_id === vendedora?.id);
    const ativos = carteira.filter(c => c.statusAtual === 'ativo').length;
    const atencao = carteira.filter(c => c.statusAtual === 'atencao').length;
    const semAt = carteira.filter(c => c.statusAtual === 'semAtividade').length;
    const inativo = carteira.filter(c => c.statusAtual === 'inativo').length;
    const sacola = carteira.filter(c => c.statusAtual === 'separandoSacola').length;

    // Sugestões da semana (filtra por data, mas como o reducer só carrega "hoje", uso isso por agora)
    const sugestoesSemana = state.sugestoesHoje;
    const enviadas = sugestoesSemana.filter(s => s.status === 'executada').length;
    const totalSugestoes = sugestoesSemana.length;
    const dispensadas = sugestoesSemana.filter(s => s.status === 'dispensada').length;
    const taxaExecucao = totalSugestoes ? Math.round((enviadas / totalSugestoes) * 100) : 0;

    return { ativos, atencao, semAt, inativo, sacola, enviadas, totalSugestoes, dispensadas, taxaExecucao, carteiraTotal: carteira.length };
  }, [clientesEnriquecidos, vendedora, state.sugestoesHoje]);

  // Conversões da vendedora (mês atual) — Ailson 06/05/2026
  // Mostra clientes em status critico (atencao/semAtividade/inativo) que
  // viraram venda apos receber mensagem da vendedora. Janela 15d apos envio.
  useEffect(() => {
    if (!vendedora?.id) return;
    let cancelado = false;
    setCarregandoConv(true);
    fetch('/api/lojas-ia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User': state.userId || 'ailson' },
      body: JSON.stringify({
        action: 'conversoes_dashboard',
        periodo: 'mes_atual',
        vendedora_id: vendedora.id,
      }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelado) { setConversoes(d); setCarregandoConv(false); } })
      .catch(() => { if (!cancelado) setCarregandoConv(false); });
    return () => { cancelado = true; };
  }, [vendedora?.id, state.userId]);

  // Hoje
  const hoje = new Date();
  const inicioSemana = new Date(hoje);
  inicioSemana.setDate(hoje.getDate() - hoje.getDay());
  const fimSemana = new Date(inicioSemana);
  fimSemana.setDate(inicioSemana.getDate() + 6);

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title={`Destaques de ${vendedora?.nome || ''}`}
        subtitle={`Semana de ${inicioSemana.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a ${fimSemana.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`}
        onBack={onBack}
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>
        <div style={{
          fontSize: fz(13), color: palette.inkMuted, marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Clock size={sz(13)} />
          Atualizado em tempo real
        </div>

        {/* KPI principal */}
        {stats.enviadas > 0 ? (
          <div style={{
            background: `linear-gradient(135deg, ${palette.okSoft} 0%, ${palette.bg} 100%)`,
            border: `1px solid ${palette.ok}30`, borderRadius: 14, padding: 16, marginBottom: 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Sparkles size={sz(21)} color={palette.ok} />
              <span style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink }}>
                {stats.enviadas} {stats.enviadas === 1 ? 'mensagem enviada' : 'mensagens enviadas'} hoje!
              </span>
            </div>
            <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.5 }}>
              Você executou <strong>{stats.taxaExecucao}%</strong> das sugestões.
              {stats.taxaExecucao >= 80 && ' Mandou bem! 👏'}
              {stats.taxaExecucao >= 50 && stats.taxaExecucao < 80 && ' Continue assim!'}
            </div>
          </div>
        ) : (
          <div style={{
            background: palette.beigeSoft, borderRadius: 14, padding: 16, marginBottom: 14,
            fontSize: fz(15), color: palette.inkSoft, textAlign: 'center',
          }}>
            Sem mensagens enviadas ainda esta semana. Comece pelas sugestões do dia! 💪
          </div>
        )}

        {/* CONVERSÕES — clientes resgatados (Ailson 06/05/2026) */}
        {/* Mostra primeiro porque eh o feedback motivacional principal pra
            vendedora ver que o trabalho de reativacao deu resultado. */}
        <SectionTitle icon={Award}>Suas conversões do mês</SectionTitle>
        {carregandoConv ? (
          <div style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 12, padding: 14, marginBottom: 14,
            fontSize: fz(13), color: palette.inkMuted, textAlign: 'center',
          }}>Carregando…</div>
        ) : (
          <ConversoesVendedora conversoes={conversoes} fz={fz} sz={sz} />
        )}

        {/* Composição da carteira — RETRAIDA (Ailson 06/05/2026) */}
        {/* Vendedora ja sabe carteira dela, prioridade eh ver conversao.
            Mantemos so a primeira linha (Ativos) visivel + botao expandir. */}
        <SectionTitle icon={TrendingUp}>Composição da carteira</SectionTitle>
        <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          {(() => {
            const linhas = [
              { status: 'ativo', label: 'Ativos', count: stats.ativos },
              { status: 'separandoSacola', label: 'Sacola em espera', count: stats.sacola },
              { status: 'atencao', label: 'Em atenção', count: stats.atencao },
              { status: 'semAtividade', label: '+3M', count: stats.semAt },
              { status: 'inativo', label: '+6M', count: stats.inativo },
            ];
            // Quando retraido, mostra so a primeira linha (Ativos)
            const visiveis = composicaoExpandida ? linhas : linhas.slice(0, 1);
            return (
              <>
                {visiveis.map((e, i) => {
                  const meta = statusMap[e.status];
                  return (
                    <div key={e.status} style={{
                      display: 'flex', alignItems: 'center', padding: '10px 0',
                      borderTop: i > 0 ? `1px solid ${palette.beigeSoft}` : 'none',
                    }}>
                      <span style={{ marginRight: 10 }}>{meta.emoji}</span>
                      <span style={{ flex: 1, fontSize: fz(15), color: palette.ink }}>{e.label}</span>
                      <span style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink }}>{e.count}</span>
                    </div>
                  );
                })}
                <button
                  onClick={() => setComposicaoExpandida(v => !v)}
                  style={{
                    width: '100%', marginTop: 8, padding: '8px 0',
                    background: 'transparent', border: 'none',
                    fontSize: fz(12), color: palette.accent, fontFamily: FONT,
                    fontWeight: 600, cursor: 'pointer',
                    borderTop: `1px solid ${palette.beigeSoft}`,
                  }}
                >
                  {composicaoExpandida ? '▲ Ver menos' : '▼ Ver detalhes da carteira'}
                </button>
                <div style={{
                  marginTop: 4, paddingTop: 6, borderTop: `1px solid ${palette.beige}`,
                  fontSize: fz(13), fontWeight: 600, color: palette.accent, textAlign: 'right',
                }}>
                  Total: {stats.carteiraTotal} clientes
                </div>
              </>
            );
          })()}
        </div>

        {/* Engajamento com IA */}
        <SectionTitle icon={Bot}>Engajamento com a IA</SectionTitle>
        <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          {[
            { label: 'Sugestões hoje', value: stats.totalSugestoes },
            { label: 'Executadas', value: stats.enviadas },
            { label: 'Dispensadas', value: stats.dispensadas },
            { label: 'Taxa de execução', value: `${stats.taxaExecucao}%` },
          ].map((m, i) => (
            <div key={m.label} style={{
              display: 'flex', alignItems: 'center', padding: '10px 0',
              borderTop: i > 0 ? `1px solid ${palette.beigeSoft}` : 'none',
            }}>
              <span style={{ flex: 1, fontSize: fz(15), color: palette.inkSoft }}>{m.label}</span>
              <span style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink }}>{m.value}</span>
            </div>
          ))}
        </div>

        {/* Card motivacional */}
        <div style={{
          background: `linear-gradient(135deg, ${palette.warnSoft} 0%, ${palette.bg} 100%)`,
          border: `1px solid ${palette.warn}40`, borderRadius: 14, padding: 16, marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 50, height: 50, borderRadius: 25, background: palette.surface,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `2px solid ${palette.warn}`,
            }}>
              <Award size={sz(28)} color={palette.warn} />
            </div>
            <div>
              <div style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink }}>Continue firme!</div>
              <div style={{ fontSize: fz(13), color: palette.inkMuted }}>Cada mensagem conta</div>
            </div>
          </div>
          <div style={{
            background: palette.surface, borderRadius: 8, padding: 10,
            fontSize: fz(14), color: palette.inkSoft, fontStyle: 'italic',
            border: `1px solid ${palette.warn}30`,
          }}>
            💛 "A relação com cliente se constrói no tempo, uma mensagem por vez."
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 7. HistoricoCarteiraScreen — gráfico 12 meses
// ═══════════════════════════════════════════════════════════════════════════

export const HistoricoCarteiraScreen = ({ lojas, onBack }) => {
  const { state, clientesEnriquecidos } = lojas;
  const [filtroLoja, setFiltroLoja] = useState('todas');

  // Dados reais por mês: por enquanto, só temos snapshot atual.
  // Mostramos os últimos 12 meses com base no que tiver na tabela lojas_clientes_kpis
  // (essa tela vai ficar mais rica quando rodar o snapshot mensal).
  // Por agora, calcula só o estado atual da carteira por loja.
  const stats = useMemo(() => {
    const todos = clientesEnriquecidos.filter(c => c.statusAtual === 'ativo' || c.statusAtual === 'atencao');
    const br = todos.filter(c => {
      const v = state.vendedoras.find(vv => vv.id === c.vendedora_id);
      return v?.loja === 'Bom Retiro';
    });
    const st = todos.filter(c => {
      const v = state.vendedoras.find(vv => vv.id === c.vendedora_id);
      return v?.loja === 'Silva Teles';
    });
    return { todas: todos.length, br: br.length, st: st.length };
  }, [clientesEnriquecidos, state.vendedoras]);

  const valor = filtroLoja === 'todas' ? stats.todas : (filtroLoja === 'br' ? stats.br : stats.st);

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title="Carteira ativa"
        subtitle="Snapshot atual"
        onBack={onBack}
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>
        <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: fz(13), color: palette.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>Atual</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: fz(41), fontWeight: 700, color: palette.ink, lineHeight: 1 }}>{valor}</div>
            <div style={{ fontSize: fz(15), color: palette.inkSoft }}>clientes ativos</div>
          </div>
        </div>

        {/* Filtros loja */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, background: palette.beigeSoft, padding: 4, borderRadius: 10 }}>
          {[
            { id: 'todas', label: 'Todas' },
            { id: 'br', label: 'Bom Retiro' },
            { id: 'st', label: 'Silva Teles' },
          ].map(f => (
            <button key={f.id} onClick={() => setFiltroLoja(f.id)} style={{
              flex: 1, background: filtroLoja === f.id ? palette.surface : 'transparent',
              color: filtroLoja === f.id ? palette.ink : palette.inkSoft,
              border: 'none', borderRadius: 8, padding: '8px 4px', fontSize: fz(14),
              fontWeight: filtroLoja === f.id ? 600 : 400, cursor: 'pointer', fontFamily: FONT,
              boxShadow: filtroLoja === f.id ? '0 1px 3px rgba(0,0,0,0.06)' : 'none', transition: 'all 0.15s',
            }}>{f.label}</button>
          ))}
        </div>

        {/* Stats rápidas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: fz(12), color: palette.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>Bom Retiro</div>
            <div style={{ fontSize: fz(25), fontWeight: 700, color: palette.ink }}>{stats.br}</div>
            <div style={{ fontSize: fz(13), color: palette.inkSoft, marginTop: 2 }}>clientes ativos</div>
          </div>
          <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: fz(12), color: palette.inkMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 }}>Silva Teles</div>
            <div style={{ fontSize: fz(25), fontWeight: 700, color: palette.ink }}>{stats.st}</div>
            <div style={{ fontSize: fz(13), color: palette.inkSoft, marginTop: 2 }}>clientes ativos</div>
          </div>
        </div>

        <div style={{
          marginTop: 16, padding: 12, background: palette.beigeSoft,
          borderRadius: 10, fontSize: fz(13), color: palette.inkSoft, lineHeight: 1.5,
        }}>
          ℹ️ Cliente ativo = comprou nos últimos 45 dias. Histórico mensal será populado conforme as importações forem rodando.
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// ModalObservacoesCliente — vendedora anota contexto sobre cliente (etapa B)
// ═══════════════════════════════════════════════════════════════════════════
// Sessao Ailson 07/05/2026.
//
// Vendedora preenche perguntas guiadas + texto livre. Persiste em
// lojas_clientes.observacoes_ia. IA usa pra calibrar mensagens (sem citar
// na mensagem em si). Notas continuam valendo pra proximas sugestoes.

const PERSONALIDADES = [
  { v: '', label: '— não definir —' },
  { v: 'doce', label: '🌸 Doce / acolhedora' },
  { v: 'direta', label: '🎯 Direta' },
  { v: 'indecisa', label: '🤔 Indecisa' },
  { v: 'divertida', label: '😄 Divertida' },
  { v: 'discreta', label: '🤫 Discreta / reservada' },
  { v: 'apressada', label: '⏱️ Apressada' },
  { v: 'detalhista', label: '🔍 Detalhista' },
];
const EVENTOS = [
  { v: '', label: '— sem evento específico —' },
  { v: 'gravidez', label: '🤰 Gravidez' },
  { v: 'viagem', label: '✈️ Viajando' },
  { v: 'festa', label: '🎉 Tem festa/evento próximo' },
  { v: 'mudanca_loja', label: '🏪 Loja nova / mudança' },
  { v: 'dificuldade_financeira', label: '💸 Dificuldade financeira' },
  { v: 'momento_bom', label: '📈 Em fase positiva' },
];
// Perfil de compra — multi-select (cliente pode marcar varias) — Ailson 10/05/2026
// IA usa como GATILHO: gosta_promocao -> priorizar mensagens com promo;
// gosta_novidades -> priorizar novidade_oficina sobre reposicao.
const PERFIL_COMPRA = [
  { v: 'gosta_promocao', label: '🏷️ Gosta muito de promoção' },
  { v: 'gosta_novidades', label: '✨ Gosta muito de novidades' },
];

// ─── EMOJI PICKER (Ailson 11/05/2026, expandido 13/05/2026) ────────────────
// Lista padrao curada pra contexto comercial moda atacado: tons calorosos
// sem exagero, sem emojis "fora do contexto". Conforme a vendedora usa
// emojis nas edicoes, a lista personaliza (top dela vem primeiro).
//
// Ailson 13/05/2026: acrescentou 🤎 🍁 🍂 🚀 🙏 da paleta dele.
const EMOJIS_PADRAO_VENDEDORA = [
  '😊', '😍', '🥰', '😘', '🔥', '💕',
  '🤎', '💛', '💖', '🌸', '🙏', '👏',
  '✨', '🌟', '🎉', '🚀', '🍁', '🍂',
  '☕',
];

// ─── ONDA 3 (Ailson 10/05/2026): Reclamacoes, Elogios, Eventos Timeline ──
// Tags estruturadas em listas — vendedora marca quando essas coisas
// acontecem. IA usa como gatilho pra personalizar mensagens (ex:
// reclamou linho_encolheu + cliente_silencioso_demais -> pergunta direta;
// elogiou modelagem -> usa modelagem como gancho).

const RECLAMACOES_TIPOS = [
  { v: 'defeito_costura', label: '🪡 Defeito de costura' },
  { v: 'linho_encolheu', label: '👕 Linho encolheu na lavagem' },
  { v: 'viscolinho_encolheu', label: '👚 Viscolinho encolheu na lavagem' },
  { v: 'tecido_qualidade', label: '🧵 Tecido de baixa qualidade' },
  { v: 'concorrente_cidade', label: '🏬 Concorrente na cidade c/ mesmo modelo' },
  { v: 'preco_alto', label: '💰 Achou preço alto' },
  { v: 'atendimento_ruim', label: '😕 Atendimento deixou a desejar' },
  { v: 'modelagem_ruim', label: '📏 Modelagem não agradou' },
  { v: 'outros', label: '📝 Outros' },
];

const ELOGIOS_TIPOS = [
  { v: 'atendimento', label: '👏 Atendimento' },
  { v: 'colecao', label: '✨ Coleção' },
  { v: 'modelagem', label: '📐 Modelagem' },
  { v: 'qualidade_tecido', label: '🧶 Qualidade do tecido' },
  { v: 'precos', label: '💵 Preços' },
  { v: 'variedade', label: '🌈 Variedade de modelos' },
  { v: 'outros', label: '📝 Outros' },
];

const EVENTOS_TIMELINE_TIPOS = [
  { v: 'gravidez', label: '🤰 Gravidez' },
  { v: 'mudanca_loja', label: '🏪 Mudança / loja nova' },
  { v: 'viagem_longa', label: '✈️ Viagem longa' },
  { v: 'casamento', label: '💍 Casamento próprio/família' },
  { v: 'reforma_loja', label: '🔨 Reforma da loja' },
  { v: 'parceria_nova', label: '🤝 Parceria nova com marca/marketplace' },
  { v: 'outros', label: '📅 Outros' },
];

// Gerador de ID curto pra itens (tipo_timestamp_random)
const gerarIdItem = (prefix) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// ─── COMPONENTE HELPER: SecaoListaItens ──────────────────────────────────
// Renderiza titulo + lista de itens + form inline pra adicionar.
// Usado pra Reclamacoes, Elogios e EventosTimeline. Diferenca eh so:
// - reclamacoes tem toggle "resolvido"
// - cor de destaque por categoria
//
// FLUXO ENRIQUECEDOR IA — Onda 2 (Ailson 10/05/2026):
// Depois que vendedora escolhe tipo + detalhe, em vez de salvar direto ela
// pode clicar "🤖 Enriquecer com IA" — chama /api/lojas-ia action
// enriquecer_observacao que retorna 3 perguntas com alternativas. Vendedora
// responde clicando, e as respostas vao pro contexto do item.
const SecaoListaItens = ({
  titulo, subtitulo, tipos, itens, categoria, cliente, userId,
  onAdd, onRemove, onToggleResolvido,
  temToggleResolvido = false,
  corAcento = palette.accent,
}) => {
  const [aberto, setAberto] = useState(false);
  const [tipoSel, setTipoSel] = useState('');
  const [detalhe, setDetalhe] = useState('');
  // Fluxo enriquecedor IA
  const [enriquecendo, setEnriquecendo] = useState(false);
  const [perguntas, setPerguntas] = useState(null); // null | [{id, texto, alternativas}]
  const [respostas, setRespostas] = useState({}); // { p1: 'a1', p2: 'a3', ... }
  const [erroEnriquecer, setErroEnriquecer] = useState(null);

  const labelTipo = (v) => tipos.find(t => t.v === v)?.label || v;

  const categoriaApiMap = {
    reclamacoes: 'reclamacao',
    elogios: 'elogio',
    eventos_timeline: 'evento_timeline',
  };

  const enriquecerComIA = async () => {
    if (!tipoSel) return;
    setEnriquecendo(true);
    setErroEnriquecer(null);
    try {
      const r = await fetch('/api/lojas-ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId || '' },
        body: JSON.stringify({
          action: 'enriquecer_observacao',
          cliente_id: cliente?.id,
          categoria: categoriaApiMap[categoria],
          tipo: tipoSel,
          detalhe,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErroEnriquecer(d.error || `HTTP ${r.status}`);
        return;
      }
      setPerguntas(d.perguntas || []);
      setRespostas({});
    } catch (e) {
      setErroEnriquecer(e.message || String(e));
    } finally {
      setEnriquecendo(false);
    }
  };

  const responder = (pid, aid) => setRespostas(prev => ({ ...prev, [pid]: aid }));

  const salvarItem = (incluirRespostasIA = false) => {
    if (!tipoSel) return;
    // Se enriqueceu, monta contexto.respostas_ia: [{pergunta_id, pergunta_texto, resposta_id, resposta_label}]
    let contexto = {};
    if (incluirRespostasIA && perguntas?.length) {
      const respostasArr = perguntas.map(p => {
        const respId = respostas[p.id];
        const alt = p.alternativas.find(a => a.id === respId);
        return {
          pergunta_id: p.id,
          pergunta_texto: p.texto,
          resposta_id: respId || null,
          resposta_label: alt?.label || null,
          respondida: !!respId,
        };
      });
      contexto = { respostas_ia: respostasArr, enriquecida_em: new Date().toISOString() };
    }
    onAdd(categoria, tipoSel, detalhe, contexto);
    // Reset
    setTipoSel('');
    setDetalhe('');
    setPerguntas(null);
    setRespostas({});
    setErroEnriquecer(null);
    setAberto(false);
  };

  const cancelarForm = () => {
    setAberto(false); setTipoSel(''); setDetalhe('');
    setPerguntas(null); setRespostas({}); setErroEnriquecer(null);
  };

  const inputStyleLocal = {
    width: '100%', padding: '10px 12px',
    borderRadius: 8, border: `1.5px solid ${palette.beige}`,
    fontFamily: FONT, fontSize: fz(14), background: palette.surface,
    color: palette.ink,
  };

  const todasRespondidas = perguntas?.length > 0
    && perguntas.every(p => respostas[p.id]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.inkSoft, marginBottom: 4 }}>
        {titulo} {itens.length > 0 && <span style={{ color: corAcento }}>({itens.length})</span>}
      </div>
      <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 8 }}>
        {subtitulo}
      </div>

      {/* Lista de itens já registrados */}
      {itens.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {itens.map(it => (
            <div key={it.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '8px 10px',
              background: it.resolvido ? '#f0f4f0' : palette.surface,
              border: `1.5px solid ${it.resolvido ? '#c9d8c5' : palette.beige}`,
              borderRadius: 8,
              opacity: it.resolvido ? 0.7 : 1,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: fz(13), fontWeight: 600, color: corAcento,
                  textDecoration: it.resolvido ? 'line-through' : 'none',
                }}>
                  {labelTipo(it.tipo)}
                  {it.contexto?.respostas_ia?.length > 0 && (
                    <span style={{
                      fontSize: fz(10), color: '#7c4dff', marginLeft: 6,
                      background: '#f3edff', padding: '1px 6px', borderRadius: 4,
                      fontWeight: 500,
                    }}>
                      🤖 enriquecida
                    </span>
                  )}
                </div>
                {it.detalhe && (
                  <div style={{ fontSize: fz(12), color: palette.inkSoft, marginTop: 2, lineHeight: 1.4 }}>
                    {it.detalhe}
                  </div>
                )}
                {/* Mostrar respostas IA (resumido) */}
                {it.contexto?.respostas_ia?.length > 0 && (
                  <div style={{ marginTop: 4, fontSize: fz(11), color: palette.inkMuted, lineHeight: 1.4 }}>
                    {it.contexto.respostas_ia
                      .filter(r => r.respondida)
                      .map(r => `• ${r.resposta_label}`)
                      .join(' · ')}
                  </div>
                )}
                {it.data_registro && (
                  <div style={{ fontSize: fz(10), color: palette.inkMuted, marginTop: 3 }}>
                    {new Date(it.data_registro).toLocaleDateString('pt-BR')}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                {temToggleResolvido && (
                  <button
                    type="button"
                    onClick={() => onToggleResolvido(it.id)}
                    title={it.resolvido ? 'Marcar como nao resolvido' : 'Marcar como resolvido'}
                    style={{
                      background: it.resolvido ? '#c9d8c5' : palette.surface,
                      border: `1.5px solid ${it.resolvido ? '#5b9555' : palette.beige}`,
                      borderRadius: 6, padding: '4px 6px',
                      fontSize: fz(11), cursor: 'pointer',
                      color: it.resolvido ? '#3d6e3a' : palette.inkSoft,
                    }}
                  >
                    {it.resolvido ? '✓ ok' : '○'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(categoria, it.id)}
                  title="Remover"
                  style={{
                    background: 'transparent', border: 'none',
                    color: palette.inkMuted, fontSize: fz(15), cursor: 'pointer',
                    padding: '2px 6px',
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form inline de adicionar */}
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          style={{
            background: palette.surface,
            border: `1.5px dashed ${corAcento}`,
            color: corAcento,
            borderRadius: 8, padding: '8px 12px',
            fontSize: fz(13), fontWeight: 600,
            cursor: 'pointer', fontFamily: FONT,
            width: '100%',
          }}
        >
          + Adicionar
        </button>
      )}
      {aberto && (
        <div style={{
          padding: 10,
          background: '#fafaf7',
          border: `1.5px solid ${corAcento}40`,
          borderRadius: 8,
        }}>
          {/* ETAPA 1: tipo + detalhe (sempre visivel) */}
          <select
            value={tipoSel}
            onChange={e => { setTipoSel(e.target.value); setPerguntas(null); setRespostas({}); }}
            disabled={perguntas !== null}
            style={{ ...inputStyleLocal, marginBottom: 8 }}
          >
            <option value="">— Selecionar tipo —</option>
            {tipos.map(t => (
              <option key={t.v} value={t.v}>{t.label}</option>
            ))}
          </select>
          <textarea
            value={detalhe}
            onChange={e => setDetalhe(e.target.value.slice(0, 300))}
            rows={2}
            disabled={perguntas !== null}
            placeholder="Detalhes (opcional, max 300 caract)"
            style={{ ...inputStyleLocal, resize: 'vertical', fontFamily: FONT, marginBottom: 8 }}
          />

          {/* ETAPA 2: perguntas IA (so quando enriquecido) */}
          {perguntas && perguntas.length > 0 && (
            <div style={{
              marginBottom: 10, padding: 10,
              background: '#f3edff',
              border: '1.5px solid #d4c5f9',
              borderRadius: 8,
            }}>
              <div style={{
                fontSize: fz(12), fontWeight: 700, color: '#5d3fc7',
                marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
              }}>
                🤖 Pra eu te ajudar a personalizar as mensagens depois, me responde:
              </div>
              {perguntas.map((p, pidx) => (
                <div key={p.id} style={{ marginBottom: pidx === perguntas.length - 1 ? 0 : 12 }}>
                  <div style={{ fontSize: fz(12), color: palette.ink, marginBottom: 6, fontWeight: 600 }}>
                    {pidx + 1}) {p.texto}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {p.alternativas.map(a => {
                      const ativo = respostas[p.id] === a.id;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => responder(p.id, a.id)}
                          style={{
                            padding: '7px 10px',
                            borderRadius: 6,
                            border: `1.5px solid ${ativo ? '#7c4dff' : palette.beige}`,
                            background: ativo ? '#7c4dff' : palette.surface,
                            color: ativo ? '#fff' : palette.ink,
                            fontFamily: FONT, fontSize: fz(12), fontWeight: ativo ? 600 : 400,
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          {ativo ? '✓ ' : ''}{a.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {erroEnriquecer && (
            <div style={{
              padding: 8, background: '#fee', borderRadius: 6, marginBottom: 8,
              fontSize: fz(12), color: palette.alert,
            }}>
              {erroEnriquecer}
            </div>
          )}

          {/* Botoes de acao — variam conforme etapa */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={cancelarForm}
              style={{
                flex: '1 1 80px', background: palette.surface, color: palette.inkSoft,
                border: `1px solid ${palette.beige}`, borderRadius: 6,
                padding: '8px', fontSize: fz(13), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
              }}
            >
              Cancelar
            </button>

            {/* Sem perguntas ainda: oferece enriquecer ou salvar simples */}
            {!perguntas && (
              <>
                <button
                  type="button"
                  onClick={enriquecerComIA}
                  disabled={!tipoSel || enriquecendo}
                  style={{
                    flex: '1 1 130px',
                    background: !tipoSel || enriquecendo ? '#ccc' : '#f3edff',
                    color: !tipoSel || enriquecendo ? '#fff' : '#5d3fc7',
                    border: `1.5px solid ${!tipoSel || enriquecendo ? '#ccc' : '#7c4dff'}`,
                    borderRadius: 6,
                    padding: '8px', fontSize: fz(12), fontWeight: 600,
                    cursor: !tipoSel || enriquecendo ? 'not-allowed' : 'pointer', fontFamily: FONT,
                  }}
                >
                  {enriquecendo ? '🤖 carregando...' : '🤖 Enriquecer c/ IA'}
                </button>
                <button
                  type="button"
                  onClick={() => salvarItem(false)}
                  disabled={!tipoSel}
                  style={{
                    flex: '1 1 90px',
                    background: tipoSel ? corAcento : '#ccc',
                    color: '#fff',
                    border: 'none', borderRadius: 6,
                    padding: '8px', fontSize: fz(13), fontWeight: 600,
                    cursor: tipoSel ? 'pointer' : 'not-allowed', fontFamily: FONT,
                  }}
                >
                  Salvar
                </button>
              </>
            )}

            {/* Com perguntas: salvar com respostas */}
            {perguntas && (
              <button
                type="button"
                onClick={() => salvarItem(true)}
                style={{
                  flex: '1 1 160px',
                  background: corAcento,
                  color: '#fff',
                  border: 'none', borderRadius: 6,
                  padding: '8px', fontSize: fz(13), fontWeight: 600,
                  cursor: 'pointer', fontFamily: FONT,
                }}
              >
                {todasRespondidas ? '✓ Salvar c/ respostas' : 'Salvar (com o que respondi)'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const ModalObservacoesCliente = ({ cliente, userId, observacoesAtuais, onSalvar, onClose }) => {
  const [personalidade, setPersonalidade] = useState(observacoesAtuais?.personalidade || '');
  const [eventoRecente, setEventoRecente] = useState(observacoesAtuais?.evento_recente || '');
  const [perfilCompra, setPerfilCompra] = useState(observacoesAtuais?.perfil_compra || []);
  const [preferencias, setPreferencias] = useState(observacoesAtuais?.preferencias || '');
  const [obsLivre, setObsLivre] = useState(observacoesAtuais?.observacao_livre || '');
  // ─── ONDA 3 (Ailson 10/05/2026): listas estruturadas ───
  const [reclamacoes, setReclamacoes] = useState(observacoesAtuais?.reclamacoes || []);
  const [elogios, setElogios] = useState(observacoesAtuais?.elogios || []);
  const [eventosTimeline, setEventosTimeline] = useState(observacoesAtuais?.eventos_timeline || []);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  // Sincroniza quando observacoesAtuais carrega async
  useEffect(() => {
    if (observacoesAtuais) {
      setPersonalidade(observacoesAtuais.personalidade || '');
      setEventoRecente(observacoesAtuais.evento_recente || '');
      setPerfilCompra(observacoesAtuais.perfil_compra || []);
      setPreferencias(observacoesAtuais.preferencias || '');
      setObsLivre(observacoesAtuais.observacao_livre || '');
      setReclamacoes(observacoesAtuais.reclamacoes || []);
      setElogios(observacoesAtuais.elogios || []);
      setEventosTimeline(observacoesAtuais.eventos_timeline || []);
    }
  }, [observacoesAtuais]);

  const togglePerfil = (v) => setPerfilCompra(prev =>
    prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
  );

  // ─── Handlers Onda 3 ───────────────────────────────────────────────────
  const adicionarItem = (categoria, tipo, detalhe, contexto = {}) => {
    const novo = {
      id: gerarIdItem(categoria === 'reclamacoes' ? 'rec' : categoria === 'elogios' ? 'elo' : 'evt'),
      tipo,
      detalhe: (detalhe || '').trim(),
      data_registro: new Date().toISOString(),
      contexto: contexto && typeof contexto === 'object' ? contexto : {},
      ...(categoria === 'reclamacoes' ? { resolvido: false } : {}),
    };
    if (categoria === 'reclamacoes') setReclamacoes(prev => [...prev, novo]);
    else if (categoria === 'elogios') setElogios(prev => [...prev, novo]);
    else if (categoria === 'eventos_timeline') setEventosTimeline(prev => [...prev, novo]);
  };
  const removerItem = (categoria, id) => {
    if (categoria === 'reclamacoes') setReclamacoes(prev => prev.filter(x => x.id !== id));
    else if (categoria === 'elogios') setElogios(prev => prev.filter(x => x.id !== id));
    else if (categoria === 'eventos_timeline') setEventosTimeline(prev => prev.filter(x => x.id !== id));
  };
  const toggleResolvido = (id) => setReclamacoes(prev =>
    prev.map(r => r.id === id ? { ...r, resolvido: !r.resolvido } : r)
  );

  const nome = (cliente?.apelido || cliente?.comprador_nome || '').split(/\s+/)[0] || 'Cliente';

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const payload = {
        personalidade: personalidade || null,
        evento_recente: eventoRecente || null,
        perfil_compra: perfilCompra,
        preferencias: preferencias.trim(),
        observacao_livre: obsLivre.trim(),
        // Onda 3 — Ailson 10/05/2026
        reclamacoes,
        elogios,
        eventos_timeline: eventosTimeline,
      };
      const r = await fetch('/api/lojas-cliente-observacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId || '' },
        body: JSON.stringify({ cliente_id: cliente.id, payload }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErro(d.error || `HTTP ${r.status}`);
        return;
      }
      onSalvar(d.observacoes);
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setSalvando(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px',
    borderRadius: 8, border: `1.5px solid ${palette.beige}`,
    fontFamily: FONT, fontSize: fz(14), background: palette.surface,
    color: palette.ink,
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: palette.surface, borderRadius: '14px 14px 0 0',
          padding: 18, width: '100%', maxWidth: 540,
          maxHeight: '92vh', overflowY: 'auto', fontFamily: FONT,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: fz(24) }}>💡</span>
          <div style={{ fontSize: fz(17), fontWeight: 700, color: palette.ink }}>
            Observações sobre {nome}
          </div>
        </div>
        <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 14, lineHeight: 1.4 }}>
          Quanto mais detalhes sobre essa cliente, mais personalizada fica a mensagem da IA.
          Essas notas <strong>NÃO aparecem</strong> no que vc envia — só ajustam o tom e o conteúdo.
        </div>

        {/* Personalidade */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Como ela é? (personalidade)
          </div>
          <select value={personalidade} onChange={e => setPersonalidade(e.target.value)} style={inputStyle}>
            {PERSONALIDADES.map(p => (
              <option key={p.v} value={p.v}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Evento recente */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Tem algum evento ou momento recente?
          </div>
          <select value={eventoRecente} onChange={e => setEventoRecente(e.target.value)} style={inputStyle}>
            {EVENTOS.map(p => (
              <option key={p.v} value={p.v}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Perfil de compra — multi-select (Ailson 10/05/2026) */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.inkSoft, marginBottom: 8 }}>
            Perfil de compra (marca o q se aplica)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PERFIL_COMPRA.map(p => {
              const ativo = perfilCompra.includes(p.v);
              return (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => togglePerfil(p.v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `1.5px solid ${ativo ? palette.accent : palette.beige}`,
                    background: ativo ? '#eff5fa' : palette.surface,
                    color: palette.ink,
                    fontFamily: FONT, fontSize: fz(14), fontWeight: ativo ? 600 : 400,
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 18, height: 18, borderRadius: 4,
                    border: `1.5px solid ${ativo ? palette.accent : palette.inkMuted}`,
                    background: ativo ? palette.accent : 'transparent',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, flexShrink: 0,
                  }}>
                    {ativo ? '✓' : ''}
                  </span>
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Preferências */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Preferências fortes (livre, max 500 caract)
          </div>
          <input
            value={preferencias}
            onChange={e => setPreferencias(e.target.value.slice(0, 500))}
            placeholder='ex: "só linho, odeia preto", "fã de plus size"'
            style={inputStyle}
          />
          <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 4 }}>
            {preferencias.length}/500
          </div>
        </div>

        {/* Observação livre — REMOVIDA da UI (Ailson 10/05/2026)
            Dado existente no banco eh preservado via state obsLivre que
            continua sendo enviado no payload. Mas vendedora nao pode
            mais editar — campo simplificado pq nao era usado. */}

        {/* ─── ONDA 3 (Ailson 10/05/2026): 2 listas estruturadas ─── */}
        {/* Eventos importantes REMOVIDO da UI: era duplicacao de
            'Tem algum evento ou momento recente?' (dropdown evento_recente).
            State eventosTimeline mantido pra preservar dados antigos. */}
        <SecaoListaItens
          titulo="🛑 Reclamações"
          subtitulo="Coisas que ela reclamou (defeito, encolheu, preço, etc)"
          tipos={RECLAMACOES_TIPOS}
          itens={reclamacoes}
          categoria="reclamacoes"
          cliente={cliente}
          userId={userId}
          onAdd={adicionarItem}
          onRemove={removerItem}
          onToggleResolvido={toggleResolvido}
          temToggleResolvido
          corAcento="#c66160"
        />

        <SecaoListaItens
          titulo="🌟 Elogios"
          subtitulo="Coisas que ela elogiou (atendimento, modelagem, coleção, etc)"
          tipos={ELOGIOS_TIPOS}
          itens={elogios}
          categoria="elogios"
          cliente={cliente}
          userId={userId}
          onAdd={adicionarItem}
          onRemove={removerItem}
          corAcento="#5b9555"
        />
        {/* ─── Fim Onda 3 ─── */}

        {erro && (
          <div style={{
            padding: 10, background: '#fee', borderRadius: 6, marginBottom: 12,
            fontSize: fz(13), color: palette.alert,
          }}>
            {erro}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={onClose}
            disabled={salvando}
            style={{
              flex: 1, background: palette.surface, color: palette.inkSoft,
              border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '12px',
              fontSize: fz(15), fontWeight: 600, cursor: salvando ? 'wait' : 'pointer',
              fontFamily: FONT,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            style={{
              flex: 2, background: '#7c4dff', color: 'white',
              border: 'none', borderRadius: 8, padding: '12px',
              fontSize: fz(15), fontWeight: 600, cursor: salvando ? 'wait' : 'pointer',
              fontFamily: FONT,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {salvando
              ? <><Loader2 size={sz(15)} style={spinKeyframes} /> Salvando…</>
              : <>💾 Salvar observações</>}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 8. ModalMensagem — gera mensagem com IA real
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// renderMensagemComLinks — Ailson 08/05/2026
// ═══════════════════════════════════════════════════════════════════════════
// Renderiza texto da mensagem detectando URLs e formatando-as:
//   • URLs em azul (palette.accent)
//   • word-break: anywhere (link grande nao vaza do container)
//   • Decoration underline so na URL pra destacar como link
//
// Uso: <div>{renderMensagemComLinks(texto)}</div>

function renderMensagemComLinks(texto) {
  if (!texto) return null;
  // Sem flag /g pra evitar problema de lastIndex.
  // Cria nova regex em cada chamada de teste pra ser seguro.
  const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
  const partes = String(texto).split(URL_PATTERN);
  return partes.map((parte, i) => {
    // Detecta URL via fresh regex (sem flag /g pra .test estavel)
    const ehUrl = /^https?:\/\//.test(parte);
    if (ehUrl) {
      return (
        <span
          key={i}
          style={{
            color: palette.accent,
            wordBreak: 'break-all',
            overflowWrap: 'anywhere',
            textDecoration: 'underline',
          }}
        >
          {parte}
        </span>
      );
    }
    return <span key={i}>{parte}</span>;
  });
}


export const ModalMensagem = ({ lojas, sugestao, cliente, onClose, onEnviada }) => {
  const { state, handleGerarMensagem, handleEditarApelido, handleEditarTelefone, handleMarcarSugestaoExecutada, handleDispensarSugestao, handleSalvarEdicaoMensagem } = lojas;

  // Cliente vem direto OU buscado pela sugestão.
  // FIX 08/05/2026 (Ailson): memoiza pra nao rodar state.clientes.find()
  // a cada keystroke do input apelido (causava lentidao perceptivel em
  // carteiras grandes — search linear em ~6k clientes a cada render).
  const clienteEfetivo = useMemo(
    () => cliente || (sugestao ? state.clientes.find(c => c.id === sugestao.cliente_id) : null),
    [cliente, sugestao, state.clientes]
  );
  const apelidoInicial = clienteEfetivo?.apelido || '';

  const [step, setStep] = useState(apelidoInicial ? 'gerando' : 'apelido');
  const [apelido, setApelido] = useState(apelidoInicial);
  const [mensagem, setMensagem] = useState('');
  const [mensagemOriginal, setMensagemOriginal] = useState('');  // pra comparar e salvar edicao
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState(null);
  const [marcandoEnviada, setMarcandoEnviada] = useState(false);
  // Rate limit (429): mostra countdown amigavel + auto-retry
  const [esperaSeg, setEsperaSeg] = useState(0);

  // Edicao da mensagem com lapis (Ailson 04/05): vendedora ajusta pra IA aprender
  const [editandoMsg, setEditandoMsg] = useState(false);
  const [msgRascunho, setMsgRascunho] = useState('');

  // ─── EMOJI PICKER (Ailson 11/05/2026) ──────────────────────────────────────
  // Vendedoras cujo teclado nao mostra emoji (ex: Celia) usam o picker do
  // app pra inserir. Lista personaliza pelo uso: top emojis dela vem primeiro
  // (lojas_estilo_vendedora.emojis), completa com padrao curado.
  const textareaEditRef = useRef(null);
  const [emojisVendedora, setEmojisVendedora] = useState({});
  useEffect(() => {
    if (!sugestao?.vendedora_id) return;
    let cancelado = false;
    fetch(`/api/lojas-estilo-vendedora?vendedora_id=${sugestao.vendedora_id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelado && d) setEmojisVendedora(d.emojis || {}); })
      .catch(() => { /* fallback usa só padrao, sem alerta */ });
    return () => { cancelado = true; };
  }, [sugestao?.vendedora_id]);

  const emojisExibir = useMemo(() => {
    const counter = Object.entries(emojisVendedora || {});
    counter.sort((a, b) => b[1] - a[1]); // mais usados primeiro
    const topVendedora = counter.slice(0, 18).map(([e]) => e);
    // Completa com padrao SEM repetir
    const completar = EMOJIS_PADRAO_VENDEDORA.filter(e => !topVendedora.includes(e));
    return [...topVendedora, ...completar].slice(0, 18);
  }, [emojisVendedora]);

  const inserirEmoji = (emoji) => {
    const ta = textareaEditRef.current;
    if (!ta) {
      // Fallback: adiciona no fim se ref nao disponivel
      setMsgRascunho(prev => prev + emoji);
      return;
    }
    const start = ta.selectionStart ?? msgRascunho.length;
    const end = ta.selectionEnd ?? msgRascunho.length;
    const novo = msgRascunho.slice(0, start) + emoji + msgRascunho.slice(end);
    setMsgRascunho(novo);
    // Reposiciona cursor logo apos o emoji inserido
    setTimeout(() => {
      if (textareaEditRef.current) {
        textareaEditRef.current.focus();
        const pos = start + emoji.length;
        textareaEditRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  // Botao WhatsApp (envia COM mensagem) + modal cadastrar tel se vazio
  const [enviandoWhats, setEnviandoWhats] = useState(false);
  const [showCadTel, setShowCadTel] = useState(false);
  const [telInput, setTelInput] = useState('');
  const [salvandoTel, setSalvandoTel] = useState(false);

  // Modal de recusa "Nao faz sentido"
  const [showRecusa, setShowRecusa] = useState(false);

  // Modal de Contexto pré-mensagem — Sprint B (Ailson 13/05/2026)
  // Backend dispara quando precisa de info extra (ex: trilha winback S2/S3).
  // Front recebe { requires_context, questions, titulo_modal }, abre modal,
  // coleta respostas, chama de novo com respostas_contexto.
  const [modalCtx, setModalCtx] = useState(null); // { questions, titulo, ... }

  // Wrapper que faz a chamada efetiva e trata requires_context
  const chamarGerar = useCallback(async (ctxExtra) => {
    const sugestaoId = sugestao?.id;
    if (sugestaoId) {
      const r = await handleGerarMensagem(sugestaoId, ctxExtra);
      // Backend pediu contexto? Não é mensagem, é instrução pra abrir modal
      if (r?.requires_context) {
        return { _abrirModal: true, ...r };
      }
      return r?.mensagem || r; // compatibilidade — antes retornava string
    } else if (clienteEfetivo && lojas.handleGerarMensagemAvulsa) {
      const r = await lojas.handleGerarMensagemAvulsa(clienteEfetivo.id, ctxExtra);
      return r.mensagem;
    }
    return '(não foi possível gerar mensagem — cliente não identificado)';
  }, [sugestao, clienteEfetivo, handleGerarMensagem, lojas]);

  const gerar = useCallback(async () => {
    if (!sugestao && !clienteEfetivo) return;
    setErro(null);
    setStep('gerando');
    try {
      // Salva apelido se preenchido e diferente
      if (apelido && apelido !== apelidoInicial && clienteEfetivo) {
        try { await handleEditarApelido(clienteEfetivo.id, apelido.trim()); } catch (e) { /* não bloqueia */ }
      }

      // Chama IA via wrapper que detecta requires_context
      const ctx = { apelido_atual: apelido || null };
      const r = await chamarGerar(ctx);

      // Backend disse "preciso de contexto"? Abre modal
      if (r?._abrirModal) {
        setModalCtx({
          titulo: r.titulo_modal,
          questions: r.questions,
          etapa: r.etapa,
          trilha_id: r.trilha_id,
          // Quando modal envia, reabre o gerar com respostas
          onSubmit: async (respostas) => {
            setModalCtx(null);
            setStep('gerando');
            try {
              const r2 = await chamarGerar({
                ...ctx,
                respostas_contexto: respostas,
              });
              const msg = typeof r2 === 'string' ? r2 : r2?.mensagem;
              if (!msg) {
                setErro('IA retornou vazio. Tenta de novo.');
                setStep('erro');
                return;
              }
              setMensagem(msg);
              setMensagemOriginal(msg);
              setStep('pronta');
            } catch (e2) {
              setErro(e2.message || 'Erro ao gerar mensagem');
              setStep('erro');
            }
          },
        });
        setStep('apelido'); // volta pro inicial enquanto modal aberto
        return;
      }

      const msg = typeof r === 'string' ? r : r?.mensagem;
      setMensagem(msg);
      setMensagemOriginal(msg);
      setStep('pronta');
    } catch (e) {
      // Rate limit (429): UI amigavel com countdown + auto-retry
      if (e?.code === 'RATE_LIMIT') {
        const seg = Math.max(1, Math.ceil((e.msEspera || 3000) / 1000));
        setEsperaSeg(seg);
        setStep('aguardando');
        // Countdown decremental + auto-retry no fim
        const intv = setInterval(() => {
          setEsperaSeg(prev => {
            if (prev <= 1) {
              clearInterval(intv);
              gerar();
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
        return;
      }
      setErro(e.message || 'Erro ao gerar mensagem');
      setStep('erro');
    }
  }, [sugestao, clienteEfetivo, apelido, apelidoInicial, handleGerarMensagem, handleEditarApelido, lojas, chamarGerar]);

  // Auto-gera quando entra direto em 'gerando'
  useEffect(() => {
    if (step === 'gerando' && !mensagem) gerar();
  }, [step]);

  const copiar = () => {
    navigator.clipboard?.writeText(mensagem);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  const marcarEnviada = async () => {
    if (!sugestao) {
      onClose && onClose();
      return;
    }
    setMarcandoEnviada(true);
    try {
      await handleMarcarSugestaoExecutada(sugestao.id, mensagem);
      onEnviada && onEnviada();
    } catch (e) {
      alert('Erro ao marcar como enviada: ' + e.message);
    } finally {
      setMarcandoEnviada(false);
    }
  };

  // Inicia edicao da mensagem com lapis. Pre-popula com a versao atual.
  const iniciarEdicao = () => {
    setMsgRascunho(mensagem);
    setEditandoMsg(true);
  };

  // Salva edicao: substitui mensagem visivel + manda backend pra IA aprender
  const salvarEdicao = async () => {
    const novaMsg = msgRascunho.trim();
    if (!novaMsg) {
      alert('Mensagem nao pode ficar vazia');
      return;
    }
    if (novaMsg === mensagem) {
      setEditandoMsg(false);
      return;
    }
    setMensagem(novaMsg);
    setEditandoMsg(false);
    // Salva edicao em background pra IA aprender o estilo da vendedora.
    // Nao bloqueia a UI — vendedora pode mandar WhatsApp imediatamente.
    if (sugestao && handleSalvarEdicaoMensagem) {
      try {
        await handleSalvarEdicaoMensagem({
          sugestao_id: sugestao.id,
          vendedora_id: sugestao.vendedora_id,
          original: mensagemOriginal,
          editada: novaMsg,
        });
      } catch (e) {
        console.warn('[edicao] erro salvar (nao bloqueia):', e?.message);
      }
    }
  };

  // Abre WhatsApp Business COM mensagem pre-preenchida + marca enviada.
  // Se cliente nao tem telefone, abre modal pra cadastrar primeiro.
  const abrirWhatsAppComMsg = async () => {
    if (!clienteEfetivo) return;
    const tel = (clienteEfetivo.telefone_principal || '').trim();
    if (!tel) {
      setTelInput('');
      setShowCadTel(true);
      return;
    }
    setEnviandoWhats(true);
    try {
      // Marca enviada (idempotente) com a mensagem que vai ser enviada
      if (sugestao) {
        await handleMarcarSugestaoExecutada(sugestao.id, mensagem);
      }
      const numeroLimpo = tel.replace(/\D/g, '');
      const numero = numeroLimpo.length === 11 || numeroLimpo.length === 10
        ? '55' + numeroLimpo
        : numeroLimpo;
      // Mensagem pre-preenchida, encoded
      const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
      window.location.href = url;
      onEnviada && onEnviada();
    } catch (e) {
      alert('Erro ao abrir WhatsApp: ' + e.message);
    } finally {
      setEnviandoWhats(false);
    }
  };

  // Salva telefone novo + abre WhatsApp na sequencia
  const salvarTelEAbrirWhats = async () => {
    const tel = telInput.replace(/\D/g, '');
    if (tel.length < 10 || tel.length > 11) {
      alert('Digite um número válido (10 ou 11 dígitos)');
      return;
    }
    setSalvandoTel(true);
    try {
      if (handleEditarTelefone) {
        await handleEditarTelefone(clienteEfetivo.id, tel);
      }
      setShowCadTel(false);
      if (sugestao) {
        await handleMarcarSugestaoExecutada(sugestao.id, mensagem);
      }
      const numero = tel.length === 11 || tel.length === 10 ? '55' + tel : tel;
      const url = `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
      window.location.href = url;
      onEnviada && onEnviada();
    } catch (e) {
      alert('Erro ao salvar telefone: ' + e.message);
    } finally {
      setSalvandoTel(false);
    }
  };

  // Recusa sugestao via "Nao faz sentido"
  const dispensar = async (motivo) => {
    if (!sugestao) {
      setShowRecusa(false);
      onClose && onClose();
      return;
    }
    try {
      if (handleDispensarSugestao) {
        await handleDispensarSugestao(sugestao.id, motivo);
      }
      setShowRecusa(false);
      onClose && onClose();
    } catch (e) {
      alert('Erro ao dispensar: ' + e.message);
    }
  };

  const tituloModal = clienteEfetivo
    ? `Para ${clienteEfetivo.razao_social}`
    : 'Sugestão de mensagem';

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      padding: 16, fontFamily: FONT,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.surface, borderRadius: 16, padding: 20,
        width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 9,
              background: `${palette.yellow}25`, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <LampIcon size={sz(23)} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink }}>Sugestão de mensagem</div>
              <div style={{
                fontSize: fz(13), color: palette.inkMuted,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{tituloModal}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: palette.inkMuted, padding: 4 }}>
            <X size={sz(23)} />
          </button>
        </div>

        {/* Step: pedir apelido */}
        {step === 'apelido' && (
          <div>
            <div style={{ background: palette.beigeSoft, borderRadius: 10, padding: 14, marginBottom: 14, fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.5 }}>
              Antes de gerar a mensagem, você sabe o nome de quem atende?
              <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 6 }}>
                A IA já lembra na próxima vez.
              </div>
            </div>
            <input autoFocus value={apelido} onChange={e => setApelido(e.target.value)}
              placeholder="Ex: Iara"
              onKeyDown={e => { if (e.key === 'Enter') setStep('gerando'); }}
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${palette.beige}`,
                fontSize: fz(17), fontFamily: FONT, color: palette.ink,
                background: palette.bg, colorScheme: 'light',
                outline: 'none', boxSizing: 'border-box', marginBottom: 14,
              }} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setApelido(''); setStep('gerando'); }} style={{
                flex: 1, background: palette.surface, color: palette.inkSoft,
                border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '12px',
                fontSize: fz(15), cursor: 'pointer', fontFamily: FONT,
              }}>Pular</button>
              <button onClick={() => setStep('gerando')} style={{
                flex: 2, background: palette.accent, color: palette.bg, border: 'none',
                borderRadius: 10, padding: '12px', fontSize: fz(15), fontWeight: 600,
                cursor: 'pointer', fontFamily: FONT,
              }}>Salvar e continuar</button>
            </div>
          </div>
        )}

        {/* Step: gerando */}
        {step === 'gerando' && (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16, background: palette.accentSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px', animation: 'pulse 1.5s ease-in-out infinite',
            }}>
              <Bot size={sz(37)} color={palette.accent} />
            </div>
            <div style={{ fontSize: fz(16), color: palette.ink, fontWeight: 600 }}>
              Gerando mensagem{apelido ? ` para ${apelido}` : ''}…
            </div>
            <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 8 }}>
              A IA tá lendo o histórico da cliente
            </div>
            <style>{`@keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.08); opacity: 0.85; } }`}</style>
          </div>
        )}

        {/* Step: aguardando (rate limit 429 — UI amigavel com countdown) */}
        {step === 'aguardando' && (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <div style={{
              width: 60, height: 60, borderRadius: '50%', background: '#fef3c7',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
              fontSize: sz(28),
            }}>
              ⏳
            </div>
            <div style={{ fontSize: fz(16), color: palette.ink, fontWeight: 600, marginBottom: 6 }}>
              Só um instante
            </div>
            <div style={{ fontSize: fz(14), color: palette.inkSoft, marginBottom: 16, lineHeight: 1.5 }}>
              Tô gerando outra mensagem ainda.<br/>
              Tento de novo em <strong style={{ color: palette.accent, fontSize: fz(18) }}>{esperaSeg}s</strong>…
            </div>
            <button onClick={onClose} style={{
              width: '100%', background: palette.surface, color: palette.inkSoft,
              border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '12px',
              fontSize: fz(15), cursor: 'pointer', fontFamily: FONT,
            }}>Fechar</button>
          </div>
        )}

        {/* Step: erro */}
        {step === 'erro' && (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <div style={{
              width: 60, height: 60, borderRadius: '50%', background: palette.alertSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px',
            }}>
              <AlertCircle size={sz(32)} color={palette.alert} />
            </div>
            <div style={{ fontSize: fz(16), color: palette.ink, fontWeight: 600, marginBottom: 6 }}>
              Não consegui gerar a mensagem
            </div>
            <div style={{ fontSize: fz(14), color: palette.inkSoft, marginBottom: 16, lineHeight: 1.5 }}>
              {erro}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} style={{
                flex: 1, background: palette.surface, color: palette.inkSoft,
                border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '12px',
                fontSize: fz(15), cursor: 'pointer', fontFamily: FONT,
              }}>Fechar</button>
              <button onClick={gerar} style={{
                flex: 2, background: palette.accent, color: palette.bg, border: 'none',
                borderRadius: 10, padding: '12px', fontSize: fz(15), fontWeight: 600,
                cursor: 'pointer', fontFamily: FONT,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <RefreshCw size={sz(16)} /> Tentar de novo
              </button>
            </div>
          </div>
        )}

        {/* Step: pronta */}
        {step === 'pronta' && (
          <div>
            <div style={{
              fontSize: fz(13), color: palette.inkSoft, letterSpacing: 0.5, textTransform: 'uppercase',
              marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={sz(14)} /> Mensagem sugerida
              </span>
              {!editandoMsg && (
                <button onClick={iniciarEdicao} title="Editar mensagem (a IA aprende com seu estilo)" style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: palette.inkSoft, padding: 4, display: 'flex', alignItems: 'center', gap: 4,
                  fontSize: fz(12), fontFamily: FONT,
                }}>
                  <Pencil size={sz(13)} /> Editar
                </button>
              )}
            </div>

            {/* Modo visualizacao OU edicao */}
            {editandoMsg ? (
              <>
                <textarea
                  ref={textareaEditRef}
                  value={msgRascunho}
                  onChange={(e) => setMsgRascunho(e.target.value)}
                  autoFocus
                  rows={6}
                  style={{
                    width: '100%', padding: 12, fontSize: fz(15), fontFamily: FONT,
                    border: `1.5px solid ${palette.accent}`, borderRadius: 10,
                    color: palette.ink, lineHeight: 1.6, resize: 'vertical',
                    boxSizing: 'border-box', marginBottom: 8,
                  }}
                />
                {/* Picker de emojis — Ailson 11/05/2026
                    Pra celulares cujo teclado nao mostra emoji.
                    Lista dinamica: top dela primeiro + padrao. */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 6,
                  padding: '8px 10px', marginBottom: 8,
                  background: palette.beigeSoft || '#fafaf7',
                  border: `1px solid ${palette.beige}`,
                  borderRadius: 8,
                  alignItems: 'center',
                }}>
                  <span style={{
                    fontSize: fz(10), color: palette.inkMuted,
                    marginRight: 4,
                    textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
                  }}>Emojis</span>
                  {emojisExibir.map((emoji, idx) => (
                    <button
                      key={`${emoji}-${idx}`}
                      type="button"
                      onClick={() => inserirEmoji(emoji)}
                      title={`Inserir ${emoji}`}
                      style={{
                        background: 'transparent', border: 'none',
                        fontSize: fz(22), cursor: 'pointer',
                        padding: '2px 6px', borderRadius: 6,
                        lineHeight: 1,
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 10, fontStyle: 'italic' }}>
                  💡 Suas edições ajudam a IA a aprender seu jeito de escrever
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => setEditandoMsg(false)} style={{
                    flex: 1, background: palette.surface, color: palette.inkSoft,
                    border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '11px',
                    fontSize: fz(15), cursor: 'pointer', fontFamily: FONT,
                  }}>Cancelar</button>
                  <button onClick={salvarEdicao} style={{
                    flex: 2, background: palette.accent, color: 'white',
                    border: 'none', borderRadius: 10, padding: '11px',
                    fontSize: fz(15), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                    <Save size={sz(15)} /> Salvar edição
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{
                  background: palette.beigeSoft, borderRadius: 12, padding: 14, fontSize: fz(16),
                  color: palette.ink, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  border: `1px solid ${palette.beige}`, marginBottom: 14, fontFamily: FONT,
                  overflowWrap: 'anywhere', // Ailson 08/05/2026: links grandes nao vazam
                }}>{renderMensagemComLinks(mensagem)}</div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button onClick={() => { setMensagem(''); setMensagemOriginal(''); gerar(); }} style={{
                    flex: 1, background: palette.surface, color: palette.inkSoft,
                    border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '11px',
                    fontSize: fz(15), cursor: 'pointer', fontFamily: FONT,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}><RefreshCw size={sz(16)} /> Gerar outra</button>
                  <button onClick={copiar} style={{
                    flex: 1, background: copiado ? palette.ok : palette.surface,
                    color: copiado ? palette.bg : palette.accent,
                    border: `1.5px solid ${copiado ? palette.ok : palette.accent}`,
                    borderRadius: 10, padding: '11px', fontSize: fz(15), fontWeight: 600,
                    cursor: 'pointer', fontFamily: FONT,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 6, transition: 'all 0.2s',
                  }}>{copiado ? <><Check size={sz(16)} /> Copiado!</> : <><Copy size={sz(16)} /> Copiar</>}</button>
                </div>
              </>
            )}

            {/* 3 botoes de acao — so aparecem fora do modo edicao */}
            {!editandoMsg && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={abrirWhatsAppComMsg} disabled={enviandoWhats} style={{
                  flex: '1 1 100%',
                  background: '#25D366', color: 'white',
                  border: 'none', borderRadius: 10, padding: '13px',
                  fontSize: fz(16), fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  boxShadow: '0 2px 6px rgba(37,211,102,0.35)',
                  opacity: enviandoWhats ? 0.6 : 1,
                }}>
                  <MessageCircle size={sz(20)} /> {enviandoWhats ? 'Abrindo…' : 'WhatsApp'}
                </button>
                <button onClick={marcarEnviada} disabled={marcandoEnviada} style={{
                  flex: 1, background: palette.surface, color: palette.accent,
                  border: `1.5px solid ${palette.accent}`, borderRadius: 10, padding: '11px',
                  fontSize: fz(15), fontWeight: 600,
                  cursor: marcandoEnviada ? 'wait' : 'pointer', fontFamily: FONT,
                  opacity: marcandoEnviada ? 0.6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  {marcandoEnviada
                    ? <><Loader2 size={sz(15)} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</>
                    : <><Check size={sz(17)} /> Já enviei</>}
                </button>
                <button onClick={() => setShowRecusa(true)} style={{
                  flex: 1, background: palette.surface, color: palette.inkSoft,
                  border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '11px',
                  fontSize: fz(15), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}><X size={sz(17)} /> Não faz sentido</button>
              </div>
            )}
          </div>
        )}

        {/* Modal cadastrar telefone (cliente sem WhatsApp) */}
        {showCadTel && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.6)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 300,
          }} onClick={() => setShowCadTel(false)}>
            <div onClick={e => e.stopPropagation()} style={{
              background: palette.surface, borderRadius: '16px 16px 0 0',
              padding: 20, width: '100%', maxWidth: 500, fontFamily: FONT,
            }}>
              <div style={{ fontSize: fz(18), fontWeight: 600, color: palette.ink, marginBottom: 4 }}>
                📱 Cadastrar WhatsApp
              </div>
              <div style={{ fontSize: fz(13), color: palette.inkSoft, marginBottom: 14 }}>
                {clienteEfetivo?.razao_social || clienteEfetivo?.nome_fantasia || 'Cliente'} ainda não tem telefone.
              </div>
              <input
                type="tel"
                inputMode="numeric"
                autoFocus
                value={telInput}
                onChange={(e) => setTelInput(e.target.value)}
                placeholder="DDD + número (ex: 11987654321)"
                style={{
                  width: '100%', padding: 12, fontSize: fz(16), fontFamily: FONT,
                  border: `1.5px solid ${palette.beige}`, borderRadius: 8,
                  marginBottom: 14, boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setShowCadTel(false)} style={{
                  flex: 1, background: palette.surface, color: palette.inkSoft,
                  border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '12px',
                  fontSize: fz(15), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                }}>Cancelar</button>
                <button onClick={salvarTelEAbrirWhats} disabled={salvandoTel} style={{
                  flex: 2, background: '#25D366', color: 'white',
                  border: 'none', borderRadius: 10, padding: '12px',
                  fontSize: fz(15), fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: salvandoTel ? 0.6 : 1,
                }}>
                  <MessageCircle size={sz(18)} />
                  {salvandoTel ? 'Salvando…' : 'Salvar e abrir'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal de recusa "Nao faz sentido" */}
        {showRecusa && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.6)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 300,
          }} onClick={() => setShowRecusa(false)}>
            <div onClick={e => e.stopPropagation()} style={{
              background: palette.surface, borderRadius: '16px 16px 0 0',
              padding: 20, width: '100%', maxWidth: 500, fontFamily: FONT,
            }}>
              <div style={{ fontSize: fz(18), fontWeight: 600, color: palette.ink, marginBottom: 4 }}>Por que não faz sentido?</div>
              <div style={{ fontSize: fz(14), color: palette.inkSoft, marginBottom: 16 }}>Escolha pra IA aprender o que melhor se encaixa</div>
              {[
                { motivo: 'pular_hoje', icon: Pause, color: palette.inkSoft, label: 'Pular hoje', sub: 'Volta em 7 dias' },
                { motivo: 'pular_30d', icon: Calendar, color: palette.warn, label: 'Pular 30 dias', sub: 'Cliente sazonal' },
                { motivo: 'arquivar', icon: Archive, color: palette.archive, label: 'Arquivar cliente', sub: 'Não sugerir mais' },
              ].map((op, i) => {
                const OpIcon = op.icon;
                return (
                  <button key={i} onClick={() => dispensar(op.motivo)} style={{
                    width: '100%', background: palette.surface, border: `1px solid ${palette.beige}`,
                    borderRadius: 10, padding: 14, marginBottom: 8, cursor: 'pointer', fontFamily: FONT,
                    display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                  }}>
                    <OpIcon size={sz(23)} color={op.color} />
                    <div>
                      <div style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink }}>{op.label}</div>
                      <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 2 }}>{op.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal de Contexto pré-mensagem (Sprint B — Ailson 13/05/2026) */}
      {/* Aberto quando backend retorna requires_context (trilha winback S2/S3). */}
      <ContextoMensagemModal
        open={!!modalCtx}
        titulo={modalCtx?.titulo}
        questions={modalCtx?.questions || []}
        onClose={() => {
          setModalCtx(null);
          // Volta pro step inicial pra vendedora poder tentar de novo se quiser
          setStep('apelido');
        }}
        onSubmit={modalCtx?.onSubmit || (() => {})}
      />
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// ModalVestiLinks — vendedora cadastra ate 3 links Vesti dela
// ═══════════════════════════════════════════════════════════════════════════
//
// Acesso: botao "🔗 Vesti" no header da MinhaCarteiraScreen.
// Funcionamento: 3 inputs URL + radio pra marcar 1 ativo (ou nenhum).
// IA usa o link ativo nas mensagens pra clientes Vesti.
//
const ModalVestiLinks = ({ lojas, vendedora, onClose }) => {
  const { handleSalvarLinksVesti } = lojas;
  const [link1, setLink1] = useState(vendedora.vesti_link_1 || '');
  const [link2, setLink2] = useState(vendedora.vesti_link_2 || '');
  const [link3, setLink3] = useState(vendedora.vesti_link_3 || '');
  const [ativo, setAtivo] = useState(vendedora.vesti_link_ativo || null);
  const [salvando, setSalvando] = useState(false);

  const validarUrl = (s) => {
    if (!s || !s.trim()) return true;
    try {
      const u = new URL(s.trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const podeAtivar = (n) => {
    if (n === 1) return link1.trim().length > 0;
    if (n === 2) return link2.trim().length > 0;
    if (n === 3) return link3.trim().length > 0;
    return false;
  };

  const salvar = async () => {
    if (!validarUrl(link1) || !validarUrl(link2) || !validarUrl(link3)) {
      alert('Algum link parece inválido (precisa começar com http:// ou https://)');
      return;
    }
    let ativoFinal = ativo;
    if (ativoFinal && !podeAtivar(ativoFinal)) ativoFinal = null;

    setSalvando(true);
    try {
      await handleSalvarLinksVesti(vendedora.id, {
        link_1: link1.trim() || null,
        link_2: link2.trim() || null,
        link_3: link3.trim() || null,
        link_ativo: ativoFinal,
      });
      onClose();
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: 10, border: `1px solid ${palette.beige}`,
    borderRadius: 6, fontFamily: FONT, fontSize: fz(14),
    background: palette.surface, color: palette.ink,
  };

  const renderCampo = (n, valor, setValor) => {
    const ehAtivo = ativo === n;
    const temConteudo = valor.trim().length > 0;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
      }}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 5,
          cursor: temConteudo ? 'pointer' : 'not-allowed',
          opacity: temConteudo ? 1 : 0.4, flexShrink: 0, minWidth: 36,
        }}>
          <input
            type="radio"
            name="vesti-ativo-modal"
            checked={ehAtivo}
            disabled={!temConteudo}
            onChange={() => setAtivo(ehAtivo ? null : n)}
          />
          <span style={{
            fontSize: fz(13),
            color: ehAtivo ? palette.purple : palette.inkMuted,
            fontWeight: ehAtivo ? 600 : 400,
          }}>{n}</span>
        </label>
        <input
          type="url"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={`Link Vesti ${n} (cole aqui)`}
          style={{
            ...inputStyle,
            borderColor: ehAtivo ? palette.purple : palette.beige,
            borderWidth: ehAtivo ? 2 : 1,
          }}
        />
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200, padding: 16, fontFamily: FONT,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.surface, borderRadius: 16,
        width: '100%', maxWidth: 500, maxHeight: '85vh', overflow: 'auto',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${palette.beige}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Link2 size={sz(18)} color={palette.purple} /> Meus links Vesti
            </div>
            <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 2 }}>
              {vendedora.nome} — links que você gerou na app Vesti
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: palette.inkMuted, padding: 4,
          }}>
            <X size={sz(22)} />
          </button>
        </div>

        <div style={{ padding: 18 }}>
          <div style={{
            padding: 10, background: palette.purpleSoft, borderRadius: 6,
            borderLeft: `3px solid ${palette.purple}`, marginBottom: 14,
            fontSize: fz(12), color: palette.inkSoft, lineHeight: 1.5,
          }}>
            Cole até 3 links. Marque o radio do link que a IA deve usar nas mensagens pras suas clientes Vesti. Se nenhum marcado, IA fica livre.
          </div>

          {renderCampo(1, link1, setLink1)}
          {renderCampo(2, link2, setLink2)}
          {renderCampo(3, link3, setLink3)}

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={() => setAtivo(null)} disabled={!ativo} style={{
              background: palette.surface, color: palette.inkSoft,
              border: `1px solid ${palette.beige}`, borderRadius: 6,
              padding: '9px 14px', fontFamily: FONT, fontSize: fz(13),
              cursor: ativo ? 'pointer' : 'not-allowed',
              opacity: ativo ? 1 : 0.4,
            }}>
              Nenhum ativo
            </button>
            <button onClick={salvar} disabled={salvando} style={{
              flex: 1, background: salvando ? palette.beige : palette.purple,
              color: 'white', border: 'none', borderRadius: 6,
              padding: '9px 14px', fontFamily: FONT, fontSize: fz(13), fontWeight: 600,
              cursor: salvando ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              {salvando
                ? <><Loader2 size={sz(15)} style={spinKeyframes} /> Salvando…</>
                : <><Save size={sz(15)} /> Salvar links</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// BotaoSinoPush — icone discreto pro vendedor ativar/desativar push
// ═══════════════════════════════════════════════════════════════════════════
//
// Estados visuais:
//   🔔 (cor solid) = ativo neste navegador, registrado pra ESTA vendedora
//   🔕 (sem cor)   = nao ativo OU registrado pra outra vendedora
//
// Ao clicar:
//   - Se nao ativo → ativa (pede permissao + registra)
//   - Se ativo → desativa (confirma + limpa)
//
import {
  pushSuportado, statusPush, ativarPush, desativarPush,
} from './lojas-push-client.js';

const BotaoSinoPush = ({ vendedora }) => {
  const [status, setStatus] = useState('verificando');  // verificando | ativo | inativo | nao_suportado
  const [ocupado, setOcupado] = useState(false);

  // Le userId do localStorage. Se for 'tamara' (admin), backend redireciona
  // o push pra placeholder Tamara_admin em vez de salvar pra vendedora atual.
  const userId = (typeof localStorage !== 'undefined'
    ? (localStorage.getItem('user_id') || localStorage.getItem('userId'))
    : null) || null;
  const ehTamara = String(userId || '').toLowerCase().trim() === 'tamara';

  // Verifica status do push neste navegador.
  // OBS: status 'inscrito' do navegador NAO garante que esta inscrito pra
  // ESTA vendedora — pode ser que login mudou e a inscricao ficou pra
  // outra. Comparamos com vendedora.push_subscription do banco.
  useEffect(() => {
    let cancelado = false;
    async function checar() {
      if (!pushSuportado()) {
        if (!cancelado) setStatus('nao_suportado');
        return;
      }
      const s = await statusPush();
      if (cancelado) return;
      if (s !== 'inscrito') {
        setStatus('inativo');
        return;
      }
      // Confere se a subscription do navegador bate com a do banco
      // ATENCAO: pra Tamara (admin), comparar com Tamara_admin nao com a
      // vendedora atual da carteira aberta. Como nao temos a row da
      // Tamara_admin facilmente aqui, simplificamos: se navegador inscrito,
      // mostra 🔔. Se ela trocar de celular, vai aparecer 🔔 mas o banco
      // estara com subscription antiga — clicar 🔔 (desativar) e 🔕 (ativar)
      // resolve.
      if (ehTamara) {
        setStatus('ativo');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        const enpNav = sub?.endpoint;
        const enpBanco = vendedora?.push_subscription?.endpoint;
        if (enpNav && enpBanco && enpNav === enpBanco) {
          setStatus('ativo');
        } else {
          setStatus('inativo');  // mesmo navegador, registrado pra outra vendedora
        }
      } catch {
        setStatus('inativo');
      }
    }
    checar();
    return () => { cancelado = true; };
  }, [vendedora?.id, vendedora?.push_subscription?.endpoint, ehTamara]);

  const ativar = async () => {
    setOcupado(true);
    const r = await ativarPush(vendedora.id, userId);
    setOcupado(false);
    if (r.ok) {
      setStatus('ativo');
      const msg = r.redirecionado_admin
        ? 'Notificações ativadas pra você (Tamara)! 🔔\n\nVai receber lembrete de manhã pra revisar o app.'
        : 'Notificações ativadas! 🔔\n\nVocê vai receber um lembrete de manhã se ainda não tiver aberto o app.';
      alert(msg);
    } else {
      alert('Não consegui ativar: ' + r.motivo);
    }
  };

  const desativar = async () => {
    if (!confirm('Desativar notificações neste celular?')) return;
    setOcupado(true);
    const r = await desativarPush(vendedora.id, userId);
    setOcupado(false);
    if (r.ok) setStatus('inativo');
    else alert('Erro: ' + r.motivo);
  };

  if (status === 'nao_suportado') return null;
  if (status === 'verificando') return null;

  const ativo = status === 'ativo';
  const Icone = ativo ? Bell : BellOff;

  return (
    <button
      onClick={ativo ? desativar : ativar}
      disabled={ocupado}
      title={ativo ? 'Notificações ativadas — toque pra desativar' : 'Toque pra ativar notificações'}
      style={{
        background: ativo ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.15)',
        color: 'white',
        padding: 7, borderRadius: 8,
        cursor: ocupado ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: ocupado ? 0.5 : 1,
      }}
    >
      <Icone size={sz(15)} />
    </button>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// CardAberturaApp — admin ve quem abriu o app hoje
// ═══════════════════════════════════════════════════════════════════════════
//
// Le da view vw_lojas_acesso_hoje (criada no SQL push). Mostra status:
//   ✅ abriu hoje
//   ⏳ ainda nao abriu
//   🔕 push nao ativado no celular
//
const CardAberturaApp = ({ lojas }) => {
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      try {
        const { data, error } = await supabase
          .from('vw_lojas_acesso_hoje')
          .select('vendedora_id, vendedora_nome, loja, push_ativo, abriu_hoje, ultimo_acesso_em, status_acesso');
        if (cancelado) return;
        if (error) {
          console.warn('[abertura-app] view indisponivel:', error.message);
          setLinhas([]);
        } else {
          setLinhas(data || []);
        }
      } catch (e) {
        if (!cancelado) setLinhas([]);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => { cancelado = true; };
  }, []);

  if (carregando) {
    return (
      <div style={{
        background: palette.surface, border: `1px solid ${palette.beige}`,
        borderRadius: 12, padding: 14, marginBottom: 16,
      }}>
        <div style={{ fontSize: fz(13), color: palette.inkMuted }}>Carregando abertura do app…</div>
      </div>
    );
  }

  if (!linhas.length) return null;

  const horaUltimo = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  };

  const visualPorStatus = {
    abriu_hoje:      { icone: '✅', cor: palette.ok,        label: 'abriu' },
    sem_acesso_hoje: { icone: '⏳', cor: palette.warn,      label: 'sem acesso' },
    nunca_abriu:     { icone: '⏳', cor: palette.warn,      label: 'sem acesso' },
    sem_push:        { icone: '🔕', cor: palette.inkMuted,  label: 'push off' },
  };

  return (
    <div style={{
      background: palette.surface, border: `1px solid ${palette.beige}`,
      borderRadius: 12, padding: 14, marginBottom: 16,
    }}>
      <div style={{
        fontSize: fz(13), color: palette.inkSoft, fontWeight: 600,
        marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        📲 Abertura do app — hoje
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {linhas.map(l => {
          const v = visualPorStatus[l.status_acesso] || visualPorStatus.sem_acesso_hoje;
          return (
            <div key={l.vendedora_id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: fz(13), color: palette.ink,
              padding: '4px 0',
            }}>
              <span style={{ fontSize: fz(15) }}>{v.icone}</span>
              <span style={{ flex: 1, fontWeight: 500 }}>
                {l.vendedora_nome}
                <span style={{ fontSize: fz(11), color: palette.inkMuted, fontWeight: 400, marginLeft: 6 }}>
                  · {l.loja === 'Bom Retiro' ? 'BR' : 'ST'}
                </span>
              </span>
              <span style={{ fontSize: fz(12), color: v.cor, fontWeight: 600 }}>
                {l.status_acesso === 'abriu_hoje' && l.ultimo_acesso_em
                  ? horaUltimo(l.ultimo_acesso_em)
                  : v.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
