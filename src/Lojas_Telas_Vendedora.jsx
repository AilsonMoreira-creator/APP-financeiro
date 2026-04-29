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

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft, RefreshCw, ChevronRight, Search, Settings,
  Users, Star, Lightbulb, Check, X, Sparkles, Flame, AlertTriangle,
  MessageCircle, Pencil, Phone, Package, Tag, Copy, Pause, Calendar,
  Archive, Bot, Plus, Store, Gift, FileText, ArrowLeftRight, Download,
  TrendingUp, TrendingDown, BarChart3, UserCog, Maximize2, Filter,
  Save, Trash2, Edit3, MapPin, Clock, CheckCircle2, AlertCircle,
  Upload, FileSpreadsheet, History, Award, Heart, ChevronUp, ChevronDown,
  UsersRound, Link2, Unlink2, Crown, ShoppingBag, Loader2, Send, User,
} from 'lucide-react';

// Importa primitives e tokens compartilhados (sem ciclo — Lojas_Shared.jsx
// não importa dos outros arquivos do módulo)
import {
  palette, FONT, statusMap, subtipoSacolaMap, faseClienteNovaMap,
  Header, StatusDot, TabBar, SectionTitle, LampIcon, LojaIcon,
  fz, sz, TelefoneCopiavel, FotoProdutoLojas, saudacaoHora, emojiHora, fraseDoDia,
  adminComSaudacao,
} from './Lojas_Shared.jsx';

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
  };
  return map[tipo] || 'Sugestão pra';
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. HomeScreen — entrada do módulo
// ═══════════════════════════════════════════════════════════════════════════

export const HomeScreen = ({
  lojas,
  onSelectVendedora,
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
        { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
        { id: 'config', label: 'Config', icon: Settings },
      ]
    : [{ id: 'vendedoras', label: 'Vendedoras', icon: Users }];

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
          onSelectVendedora={onSelectVendedora}
        />
      )}
      {activeTab === 'dashboard' && isAdmin && (
        <DashboardTab lojas={lojas} onAbrirHistorico={onAbrirHistorico} />
      )}
      {activeTab === 'config' && isAdmin && (
        <ConfigTab lojas={lojas} onNavegar={onNavegarConfig} />
      )}
    </div>
  );
};

// ─── VendedorasTab ─────────────────────────────────────────────────────────

const VendedorasTab = ({ isAdmin, vendedoras, clientes, vendedoraLogadaId, onSelectVendedora }) => {
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

// ─── DashboardTab ──────────────────────────────────────────────────────────

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
      <div style={{ marginBottom: 10 }}>
        <Indicator
          label="Carteira ativa total" value={stats.total}
          sub={`🟢 ${stats.ativos} ativos · 🟡 ${stats.atencao} atenção`}
          icon={Users} cor={palette.accent} expandable onClick={onAbrirHistorico}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <Indicator label="Sugestões hoje" value={`${stats.executadas} / ${stats.sugestoes}`}
          sub={stats.sugestoes ? `${Math.round((stats.executadas / stats.sugestoes) * 100)}% executadas` : 'sem sugestões'}
          icon={Bot} cor={palette.accent} />
        <Indicator label="Sacolas em espera" value={stats.sacola} sub="aguardando finalização"
          icon={ShoppingBag} cor={palette.purple} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
        <Indicator label="Em atenção" value={stats.atencao} sub="🟡 45-90 dias"
          icon={AlertTriangle} cor={palette.warn} />
        <Indicator label="Sem atividade" value={stats.semAt} sub="🟠 90+ dias"
          icon={Clock} cor="#e67e22" />
      </div>

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

// ─── ConfigTab ─────────────────────────────────────────────────────────────

const ConfigTab = ({ lojas, onNavegar }) => {
  const { state } = lojas;

  const items = [
    { id: 'cadastrarComprador', icon: User, cor: palette.accent, corSoft: palette.accentSoft,
      title: 'Cadastrar comprador', sub: 'Vincular nome do comprador a um CNPJ/CPF' },
    { id: 'promocoes', icon: Gift, cor: palette.warn, corSoft: palette.warnSoft,
      title: 'Promoções', sub: `${state.promocoes.length} ${state.promocoes.length === 1 ? 'ativa' : 'ativas'}` },
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
  const ativas = sugestoes.filter(s => s.status === 'pendente' || !s.status);
  const enviadas = sugestoes.filter(s => s.status === 'executada');
  const dispensadas = sugestoes.filter(s => s.status === 'dispensada');

  const total = sugestoes.length;
  const executadas = enviadas.length;
  const pct = total ? Math.round((executadas / total) * 100) : 0;

  const handleRegerar = async () => {
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
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. SugestaoScreen — sugestão expandida com ações
// ═══════════════════════════════════════════════════════════════════════════

export const SugestaoScreen = ({
  lojas, sugestao, vendedora, onBack, onPedirMensagem, onMarcarEnviada,
}) => {
  const { state, handleEditarApelido, handleMarcarSugestaoExecutada, handleDispensarSugestao } = lojas;
  const [showRecusa, setShowRecusa] = useState(false);
  const [apelidoEdit, setApelidoEdit] = useState(false);
  const [salvandoApelido, setSalvandoApelido] = useState(false);

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

              {cliente.telefone_principal && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${palette.beige}` }}>
                  <TelefoneCopiavel telefone={cliente.telefone_principal} />
                </div>
              )}
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
            }}>{sugestao.acao_sugerida}</div>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={marcarEnviada} style={{
            flex: 1, background: palette.surface, color: palette.ok,
            border: `1.5px solid ${palette.ok}`, borderRadius: 10, padding: '11px',
            fontSize: fz(15), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}><Check size={sz(17)} /> Enviada</button>
          <button onClick={() => setShowRecusa(true)} style={{
            flex: 1, background: palette.surface, color: palette.inkSoft,
            border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '11px',
            fontSize: fz(15), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}><X size={sz(17)} /> Não faz sentido</button>
        </div>
      </div>

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
  const { state, carteiraAtual } = lojas;
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [ordenacao, setOrdenacao] = useState('recentes');

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

        // Status agregado: pega o pior (mais "alarmante")
        const ordemStatus = ['inativo', 'semAtividade', 'separandoSacola', 'atencao', 'ativo', 'arquivo'];
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

  const Contador = ({ statusKey, label, count }) => {
    const meta = statusMap[statusKey];
    const ativo = filtroStatus === statusKey;
    return (
      <button onClick={() => setFiltroStatus(ativo ? 'todos' : statusKey)} style={{
        background: ativo ? meta.soft : palette.surface,
        border: `1.5px solid ${ativo ? meta.cor : palette.beige}`,
        borderRadius: 10, padding: '10px 6px', flex: 1, minWidth: 0, cursor: 'pointer',
        fontFamily: FONT, textAlign: 'center', transition: 'all 0.15s',
      }}>
        <div style={{ fontSize: fz(21), fontWeight: 700, color: ativo ? meta.cor : palette.ink, lineHeight: 1 }}>{count}</div>
        <div style={{ fontSize: fz(10), color: ativo ? meta.cor : palette.inkMuted, marginTop: 4, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>{label}</div>
      </button>
    );
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title={`Carteira de ${vendedora?.nome || ''}`}
        subtitle={`${vendedora?.loja || ''} · ${itensCarteira.length} ${itensCarteira.length === 1 ? 'item' : 'itens'} (${state.grupos.length} grupos)`}
        onBack={onBack}
        rightContent={
          <div style={{ display: 'flex', gap: 6 }}>
            {onAbrirCadastrarComprador && (
              <button onClick={onAbrirCadastrarComprador} style={{
                background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
                color: palette.bg, padding: '6px 10px', borderRadius: 8,
                cursor: 'pointer', fontSize: fz(13), fontFamily: FONT, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 4,
              }} title="Cadastrar nome do comprador">
                <User size={sz(15)} /> Comprador
              </button>
            )}
            {onAbrirGrupos && (
              <button onClick={onAbrirGrupos} style={{
                background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
                color: palette.bg, padding: '6px 10px', borderRadius: 8,
                cursor: 'pointer', fontSize: fz(13), fontFamily: FONT, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <UsersRound size={sz(15)} /> Grupos
              </button>
            )}
          </div>
        }
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>
        {/* Contadores - inclui SACOLA novo */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 14, overflowX: 'auto' }}>
          <Contador statusKey="ativo" label="Ativos" count={contadores.ativo} />
          <Contador statusKey="separandoSacola" label="Sacola" count={contadores.separandoSacola} />
          <Contador statusKey="atencao" label="Atenção" count={contadores.atencao} />
          <Contador statusKey="semAtividade" label="S/Ativ" count={contadores.semAtividade} />
          <Contador statusKey="inativo" label="Inativ" count={contadores.inativo} />
          <Contador statusKey="arquivo" label="Arq" count={contadores.arquivo} />
        </div>

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
            <option value="recentes">Compras recentes</option>
            <option value="antigos">Mais antigos</option>
            <option value="lifetime">Quem já comprou mais</option>
            <option value="nome">Nome A-Z</option>
          </select>
        </div>

        <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 8 }}>
          {itensFiltrados.length} {itensFiltrados.length === 1 ? 'item' : 'itens'}
        </div>

        {/* Lista */}
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
                </div>
              </div>
            );
          })}
        </div>

        {itensFiltrados.length === 0 && (
          <div style={{
            padding: 32, textAlign: 'center', color: palette.inkMuted, fontSize: fz(15),
            background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12,
          }}>
            {busca ? 'Nenhum cliente encontrado pra essa busca.' : 'Nenhum cliente nessa categoria.'}
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. DetalheClienteScreen — dados completos + apelido editável
// ═══════════════════════════════════════════════════════════════════════════

export const DetalheClienteScreen = ({
  lojas, cliente, onBack, onAbrirGrupo, onCriarGrupo, onPedirMensagem,
}) => {
  const { state, handleEditarApelido, handleArquivarCliente, handlePularCliente } = lojas;
  const [apelidoEdit, setApelidoEdit] = useState(false);
  const [apelido, setApelido] = useState(cliente.apelido || '');
  const [salvando, setSalvando] = useState(false);
  const [showAcoes, setShowAcoes] = useState(false);

  // Atualiza local quando cliente muda
  useEffect(() => {
    setApelido(cliente.apelido || '');
  }, [cliente.apelido]);

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

          {/* Telefone */}
          {cliente.telefone_principal && (
            <div style={{ padding: '8px 0', borderTop: `1px solid ${palette.beigeSoft}` }}>
              <TelefoneCopiavel telefone={cliente.telefone_principal} />
            </div>
          )}

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
          {kpi.frequencia_media_dias && (
            <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.7 }}>
              Compra a cada ~<strong>{Math.round(kpi.frequencia_media_dias)} dias</strong>
            </div>
          )}
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
      }}>
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

// ═══════════════════════════════════════════════════════════════════════════
// 6. DestaquesScreen — KPIs da semana da vendedora
// ═══════════════════════════════════════════════════════════════════════════

export const DestaquesScreen = ({ lojas, vendedora, onBack }) => {
  const { state, clientesEnriquecidos } = lojas;

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

        {/* Composição da carteira */}
        <SectionTitle icon={TrendingUp}>Composição da carteira</SectionTitle>
        <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 14, marginBottom: 14 }}>
          {[
            { status: 'ativo', label: 'Ativos', count: stats.ativos },
            { status: 'separandoSacola', label: 'Sacola em espera', count: stats.sacola },
            { status: 'atencao', label: 'Em atenção', count: stats.atencao },
            { status: 'semAtividade', label: 'Sem atividade', count: stats.semAt },
            { status: 'inativo', label: 'Inativos', count: stats.inativo },
          ].map((e, i) => {
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
          <div style={{
            marginTop: 8, paddingTop: 10, borderTop: `2px solid ${palette.beige}`,
            fontSize: fz(14), fontWeight: 600, color: palette.accent, textAlign: 'right',
          }}>
            Total: {stats.carteiraTotal} clientes
          </div>
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
// 8. ModalMensagem — gera mensagem com IA real
// ═══════════════════════════════════════════════════════════════════════════

export const ModalMensagem = ({ lojas, sugestao, cliente, onClose, onEnviada }) => {
  const { state, handleGerarMensagem, handleEditarApelido, handleMarcarSugestaoExecutada } = lojas;

  // Cliente vem direto OU buscado pela sugestão
  const clienteEfetivo = cliente || (sugestao ? state.clientes.find(c => c.id === sugestao.cliente_id) : null);
  const apelidoInicial = clienteEfetivo?.apelido || '';

  const [step, setStep] = useState(apelidoInicial ? 'gerando' : 'apelido');
  const [apelido, setApelido] = useState(apelidoInicial);
  const [mensagem, setMensagem] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState(null);
  const [marcandoEnviada, setMarcandoEnviada] = useState(false);

  const gerar = useCallback(async () => {
    if (!sugestao && !clienteEfetivo) return;
    setErro(null);
    setStep('gerando');
    try {
      // Salva apelido se preenchido e diferente
      if (apelido && apelido !== apelidoInicial && clienteEfetivo) {
        try { await handleEditarApelido(clienteEfetivo.id, apelido.trim()); } catch (e) { /* não bloqueia */ }
      }

      // Chama IA
      const sugestaoId = sugestao?.id;
      const ctx = { apelido_atual: apelido || null };
      const msg = sugestaoId
        ? await handleGerarMensagem(sugestaoId, ctx)
        : '(geração avulsa ainda não disponível — gere a partir de uma sugestão)';

      setMensagem(msg);
      setStep('pronta');
    } catch (e) {
      setErro(e.message || 'Erro ao gerar mensagem');
      setStep('erro');
    }
  }, [sugestao, clienteEfetivo, apelido, apelidoInicial, handleGerarMensagem, handleEditarApelido]);

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
                fontSize: fz(17), fontFamily: FONT, color: palette.ink, outline: 'none', boxSizing: 'border-box', marginBottom: 14,
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
              marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Sparkles size={sz(14)} /> Mensagem sugerida
            </div>
            <div style={{
              background: palette.beigeSoft, borderRadius: 12, padding: 14, fontSize: fz(16),
              color: palette.ink, lineHeight: 1.6, whiteSpace: 'pre-wrap',
              border: `1px solid ${palette.beige}`, marginBottom: 14, fontFamily: FONT,
            }}>{mensagem}</div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={() => { setMensagem(''); gerar(); }} style={{
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

            <button onClick={marcarEnviada} disabled={marcandoEnviada} style={{
              width: '100%', background: palette.ok, color: palette.bg, border: 'none',
              borderRadius: 10, padding: '13px', fontSize: fz(16), fontWeight: 600,
              cursor: marcandoEnviada ? 'wait' : 'pointer', fontFamily: FONT,
              opacity: marcandoEnviada ? 0.7 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {marcandoEnviada
                ? <><Loader2 size={sz(20)} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</>
                : <><Send size={sz(20)} /> Enviei!</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
