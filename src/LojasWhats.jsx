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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Bot, RefreshCw, Check, X, Edit3, Send, Filter,
  Users, MessageCircle, Settings, AlertCircle,
  Loader2, ChevronRight, Phone, ShoppingCart, Building2,
  User as UserIcon, Save, Link2, Eye, TrendingUp, Calendar
} from 'lucide-react';
import {
  supabase,
  palette, FONT,
  Header, TabBar, SectionTitle, LoadingScreen,
} from './Lojas_Shared.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES & HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const ASSISTANT_NAME = 'Sofia'; // mude aqui pra trocar nome em toda UI

const ICONS_BASE = '/icons/lojas-whats';

// Ícone de etapa: usa PNG colorido pra cards visuais (funil/cards)
const EtapaIcon = ({ nome, size = 28, style = {} }) => (
  <img
    src={`${ICONS_BASE}/${nome}.png`}
    alt={nome}
    width={size}
    height={size}
    style={{ display: 'block', objectFit: 'contain', flexShrink: 0, ...style }}
  />
);

// ETAPAS do funil (ordem visual + label + cor)
const ETAPAS = [
  { id: 'processando',  label: 'Processando',  cor: palette.inkMuted },
  { id: 'aprovar',      label: 'Aprovar',      cor: palette.warn },
  { id: 'enviada',      label: 'Enviada',      cor: palette.accent },
  { id: 'conversando',  label: 'Conversando',  cor: palette.accent },
  { id: 'quente',       label: 'Quente',       cor: palette.alert },
  { id: 'atendida',     label: 'Atendida',     cor: palette.purple },
  { id: 'vendeu',       label: 'Vendeu',       cor: palette.ok },
  { id: 'perdida',      label: 'Perdida',      cor: palette.inkMuted },
];

const fz = (n) => `${n}px`;
const sz = (n) => n;

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

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export default function LojasWhats({ userId, isAdmin, onBack }) {
  const [activeTab, setActiveTab] = useState('aprovar');
  const [refreshTick, setRefreshTick] = useState(0);

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
    { id: 'aprovar',     label: 'Aprovar',     icon: () => <EtapaIcon nome="aprovar"     size={16} /> },
    { id: 'conversas',   label: 'Conversas',   icon: () => <EtapaIcon nome="conversando" size={16} /> },
    { id: 'vendedoras',  label: 'Vendedoras',  icon: Users },
    { id: 'conversao',   label: 'Conversão',   icon: TrendingUp },
    { id: 'config',      label: 'Config',      icon: Settings },
  ];

  return (
    <div style={{ background: palette.bg, minHeight: '100vh', fontFamily: FONT }}>
      <Header
        title={ASSISTANT_NAME}
        subtitle={`Assistente IA WhatsApp · ${new Date().toLocaleDateString('pt-BR')}`}
        onBack={onBack}
        rightContent={
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
        }
      />
      <TabBar tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'funil' && <FunilTab refreshTick={refreshTick} />}
      {activeTab === 'aprovar' && <AprovarTab userId={userId} refreshTick={refreshTick} onReload={() => setRefreshTick(t => t + 1)} />}
      {activeTab === 'conversas' && <ConversasTab refreshTick={refreshTick} />}
      {activeTab === 'vendedoras' && <VendedorasTab userId={userId} refreshTick={refreshTick} />}
      {activeTab === 'conversao' && <ConversaoTab refreshTick={refreshTick} />}
      {activeTab === 'config' && <ConfigTab userId={userId} refreshTick={refreshTick} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1: FUNIL
// ═══════════════════════════════════════════════════════════════════════════

function FunilTab({ refreshTick }) {
  const [contagens, setContagens] = useState({});
  const [loading, setLoading] = useState(true);
  const [resumo, setResumo] = useState(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Contagens por etapa
      const counts = {};
      for (const etapa of ETAPAS) {
        const { count } = await supabase
          .from('lojas_whats_conversas')
          .select('*', { count: 'exact', head: true })
          .eq('etapa', etapa.id);
        counts[etapa.id] = count || 0;
      }
      setContagens(counts);

      // Resumo da fila (cap, criadas hoje, etc)
      try {
        const r = await fetch('/api/lojas-whats-cron-selecionar');
        if (r.ok) setResumo((await r.json()).data);
      } catch (_) {}
      setLoading(false);
    })();
  }, [refreshTick]);

  if (loading) return <div style={{ padding: 20 }}><Loader2 size={sz(24)} className="spin" /></div>;

  const total = Object.values(contagens).reduce((a, b) => a + b, 0);

  return (
    <div style={{ padding: 14, fontFamily: FONT }}>
      <SectionTitle>Hoje</SectionTitle>
      {resumo && (
        <div style={{
          background: palette.surface, borderRadius: 10, padding: 12,
          marginBottom: 14, display: 'flex', gap: 12, flexWrap: 'wrap',
          fontSize: fz(13),
        }}>
          <StatBox label="Cap diário" valor={resumo.cap_diario} cor={palette.ink} />
          <StatBox label="Criadas hoje" valor={resumo.criadas_hoje} cor={palette.accent} />
          <StatBox label="Restante hoje" valor={resumo.restante_hoje} cor={palette.warn} />
          <StatBox label="Pendentes" valor={resumo.fila_pendentes} cor={palette.warn} />
          <StatBox label="Enviadas hoje" valor={resumo.enviadas_hoje} cor={palette.ok} />
        </div>
      )}

      <SectionTitle>Funil ({total} conversas total)</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
        {ETAPAS.map(et => (
          <div key={et.id} style={{
            background: palette.surface, borderRadius: 10, padding: 12,
            display: 'flex', alignItems: 'center', gap: 10,
            border: `1px solid ${palette.beige}`,
          }}>
            <EtapaIcon nome={et.id} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 2 }}>
                {et.label}
              </div>
              <div style={{ fontSize: fz(22), fontWeight: 700, color: et.cor, lineHeight: 1 }}>
                {contagens[et.id] || 0}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const StatBox = ({ label, valor, cor }) => (
  <div style={{ flex: '1 1 90px', textAlign: 'center', padding: '4px 6px' }}>
    <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: fz(20), fontWeight: 700, color: cor || palette.ink, lineHeight: 1 }}>{valor}</div>
  </div>
);

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
    if (!confirm('Dispensar essa sugestão? A conversa vai pra Perdida.')) return;
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

function ConversasTab({ refreshTick }) {
  const [conversas, setConversas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtroEtapa, setFiltroEtapa] = useState('todas');

  useEffect(() => {
    (async () => {
      setLoading(true);
      let q = supabase
        .from('lojas_whats_conversas')
        .select('id, telefone, nome_cliente, tipo_documento, etapa, valor_carrinho, qtd_pecas, ultima_atividade_em, iniciada_em')
        .order('ultima_atividade_em', { ascending: false })
        .limit(100);
      if (filtroEtapa !== 'todas') q = q.eq('etapa', filtroEtapa);
      const { data } = await q;
      setConversas(data || []);
      setLoading(false);
    })();
  }, [filtroEtapa, refreshTick]);

  if (loading) return <div style={{ padding: 20, textAlign: 'center' }}><Loader2 size={sz(24)} className="spin" /></div>;

  return (
    <div style={{ padding: 14, fontFamily: FONT }}>
      {/* Filtro por etapa */}
      <div style={{
        display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14,
        overflowX: 'auto', paddingBottom: 4,
      }}>
        <FiltroChip
          label="Todas" ativo={filtroEtapa === 'todas'}
          onClick={() => setFiltroEtapa('todas')}
        />
        {ETAPAS.map(et => (
          <FiltroChip
            key={et.id} label={et.label} ativo={filtroEtapa === et.id}
            cor={et.cor} onClick={() => setFiltroEtapa(et.id)}
            iconNome={et.id}
          />
        ))}
      </div>

      {conversas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: palette.inkMuted }}>
          Nenhuma conversa nessa etapa.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {conversas.map(c => <ConversaRow key={c.id} c={c} />)}
        </div>
      )}
    </div>
  );
}

const FiltroChip = ({ label, ativo, cor, onClick, iconNome }) => (
  <button onClick={onClick} style={{
    padding: '6px 10px', borderRadius: 16, cursor: 'pointer',
    border: `1px solid ${ativo ? (cor || palette.ink) : palette.beige}`,
    background: ativo ? (cor || palette.ink) : palette.surface,
    color: ativo ? palette.bg : palette.ink,
    fontSize: fz(12), fontFamily: FONT, fontWeight: 500,
    whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4,
  }}>
    {iconNome && <EtapaIcon nome={iconNome} size={14} />}
    {label}
  </button>
);

const ConversaRow = ({ c }) => {
  const ehPJ = c.tipo_documento === 'CNPJ';
  return (
    <div style={{
      background: palette.surface, padding: 10, borderRadius: 8,
      display: 'flex', alignItems: 'center', gap: 10,
      border: `1px solid ${palette.beige}`,
    }}>
      <EtapaIcon nome={c.etapa} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {ehPJ ? <Building2 size={sz(12)} color={palette.warn} /> : <UserIcon size={sz(12)} color={palette.accent} />}
          <span style={{ fontSize: fz(14), fontWeight: 600, color: palette.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.nome_cliente || '—'}
          </span>
        </div>
        <div style={{ fontSize: fz(11), color: palette.inkMuted, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span>{fmtPhone(c.telefone)}</span>
          {c.qtd_pecas > 0 && <span>· {c.qtd_pecas} peças</span>}
          {Number(c.valor_carrinho) > 0 && <span>· {fmtMoney(c.valor_carrinho)}</span>}
        </div>
      </div>
      <div style={{ fontSize: fz(11), color: palette.inkMuted, textAlign: 'right', flexShrink: 0 }}>
        {fmtRelTime(c.ultima_atividade_em)}
      </div>
    </div>
  );
};

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

          {/* 4 KPI cards: Sofia/Vendedora × Site/Loja */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 10, marginBottom: 18,
          }}>
            <KpiConvCard
              label="🤖 Sofia → Site"
              sub="≤5 dias após msg"
              qtd={dados.kpis.sofia_site.qtd}
              valor={fmtMoney(dados.kpis.sofia_site.valor)}
              corBarra={palette.accent}
            />
            <KpiConvCard
              label="🤖 Sofia → Loja"
              sub="≤15 dias após msg"
              qtd={dados.kpis.sofia_loja.qtd}
              valor={fmtMoney(dados.kpis.sofia_loja.valor)}
              corBarra={palette.purple}
            />
            <KpiConvCard
              label="👩‍💼 Vendedora → Site"
              sub="≤5 dias após msg"
              qtd={dados.kpis.vendedora_site.qtd}
              valor={fmtMoney(dados.kpis.vendedora_site.valor)}
              corBarra={palette.ok}
            />
            <KpiConvCard
              label="👩‍💼 Vendedora → Loja"
              sub="≤15 dias após msg"
              qtd={dados.kpis.vendedora_loja.qtd}
              valor={fmtMoney(dados.kpis.vendedora_loja.valor)}
              corBarra={palette.warn}
            />
          </div>

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
        </>
      )}
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
