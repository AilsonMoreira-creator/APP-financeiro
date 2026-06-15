/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Meluni.jsx — MÓDULO MELUNI (assistente IA WhatsApp B2C, "Lara")
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ISOLADO da Sofia. Só reaproveita os primitivos VISUAIS de Lojas_Shared
 * (palette, FONT, Header, TabBar, SectionTitle) — nada de lógica da Sofia.
 * Backend próprio: api/meluni-* + tabelas meluni_*.
 *
 * Seções (botões do topo):
 *   👥 Clientes      — carteira do Bling (lumia/Outros) + cadastro Convertr, KPIs, filtros, bloquear
 *   🛒 Carrinho      — resgate de carrinho abandonado (funil igual Sofia)
 *   💬 SAC           — dúvidas do site + Direct do Insta (abas conversando/follow up/arquivo)
 *   ↩  Devolução     — planilha diária do Drive
 *   📈 Marketplaces  — calculadora + Análise Meluni + Meta Ads Meluni
 *   📊 Dashboard     — vendas, devoluções, conversão de carrinho
 *
 * ESQUELETO: estrutura navegável pronta; cada seção é populada nos próximos
 * sprints (endpoints de leitura + planilhas). Ailson 13/06/2026.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, ShoppingCart, MessageCircle, RotateCcw, TrendingUp, BarChart3,
  Instagram, Globe, Lock, Filter, Ban, Bot, Calculator, Megaphone,
} from 'lucide-react';
import { palette, FONT, Header, TabBar, SectionTitle } from './Lojas_Shared.jsx';

const ASSISTANT_NAME = 'Lara';
const MELUNI = '#9b59b6';      // roxo da marca Meluni (consistente com o resto do app)
const MELUNI_SOFT = '#f6f0f9';

// ─── sub-abas leves (dentro de cada seção) ──────────────────────────────────
function SubTabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
      {tabs.map(t => {
        const on = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            border: `1px solid ${on ? MELUNI : palette.beige}`,
            background: on ? MELUNI : palette.surface,
            color: on ? '#fff' : palette.inkSoft,
            borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
            fontFamily: FONT, fontSize: 13, fontWeight: on ? 700 : 500,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {t.label}
            {t.badge > 0 && (
              <span style={{
                background: on ? '#fff' : MELUNI, color: on ? MELUNI : '#fff',
                borderRadius: 999, minWidth: 16, height: 16, padding: '0 4px',
                fontSize: 10, fontWeight: 700, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
              }}>{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// placeholder padrão enquanto a seção não tem dado ligado
function Placeholder({ children }) {
  return (
    <div style={{
      border: `1px dashed ${palette.beige}`, borderRadius: 12, padding: '40px 20px',
      textAlign: 'center', color: palette.inkMuted, fontFamily: FONT, fontSize: 13,
      background: palette.surface,
    }}>
      {children}
    </div>
  );
}

function Tag({ cor, bg, children }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color: cor, background: bg,
      borderRadius: 4, padding: '2px 7px', display: 'inline-flex',
      alignItems: 'center', gap: 3, fontFamily: FONT,
    }}>{children}</span>
  );
}

// ─── SEÇÃO: CLIENTES ────────────────────────────────────────────────────────
const fmtBRL = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTel = (t) => {
  const d = String(t || '').replace(/\D/g, '');
  if (!d) return '—';
  const n = d.length > 11 ? d.slice(-11) : d;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return t;
};
const fmtData = (d) => d ? String(d).split('-').reverse().join('/') : '—';

function SecaoClientes() {
  const [aba, setAba] = useState('carteira');
  const [ordenar, setOrdenar] = useState('valor');
  const [periodo, setPeriodo] = useState('');
  const [janela, setJanela] = useState('');
  const [msgDias, setMsgDias] = useState('');
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true); setErro('');
    try {
      const p = new URLSearchParams({ aba, ordenar });
      if (periodo) p.set('periodo_dias', periodo);
      if (janela) { const [a, b] = janela.split('-'); p.set('janela_min', a); p.set('janela_max', b); }
      if (msgDias) p.set('msg_dias', msgDias);
      const r = await fetch('/api/meluni-clientes-list?' + p.toString());
      const j = await r.json();
      if (j.ok) setClientes(j.clientes || []); else setErro(j.erro || 'erro ao carregar');
    } catch (e) { setErro(String(e?.message || e)); }
    setLoading(false);
  }, [aba, ordenar, periodo, janela, msgDias]);

  useEffect(() => { carregar(); }, [carregar]);

  const toggleBloqueio = async (c) => {
    const novo = !c.bloqueado;
    if (novo && !window.confirm(`Bloquear ${c.nome || fmtTel(c.telefone)} dos disparos?`)) return;
    setClientes(prev => prev.map(x => x.id === c.id ? { ...x, bloqueado: novo } : x));
    try {
      await fetch('/api/meluni-cliente-bloquear', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: c.id, telefone: c.telefone, bloquear: novo }),
      });
    } catch (e) { carregar(); }
  };

  const COLS = ['Cliente', 'WhatsApp', 'Nº compras', 'Lifetime', 'Ticket', 'Última compra', ''];
  return (
    <div>
      <SubTabs tabs={[{ id: 'carteira', label: 'Carteira' }, { id: 'clientes', label: 'Clientes' }]}
        active={aba} onChange={setAba} />

      {/* barra de filtros */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        marginBottom: 12, padding: 10, background: palette.surface,
        border: `1px solid ${palette.beige}`, borderRadius: 10,
      }}>
        <Filter size={15} color={palette.inkMuted} />
        <select style={selStyle} value={periodo} onChange={e => setPeriodo(e.target.value)}>
          <option value="">Período: todos</option><option value="30">Últimos 30 dias</option>
          <option value="60">Últimos 60 dias</option><option value="90">Últimos 90 dias</option>
        </select>
        <select style={selStyle} value={janela} onChange={e => setJanela(e.target.value)}>
          <option value="">Janela última compra</option><option value="10-15">10 a 15 dias</option><option value="15-30">15 a 30 dias</option>
        </select>
        <select style={selStyle} value={ordenar} onChange={e => setOrdenar(e.target.value)}>
          <option value="valor">Ordenar: maior valor</option><option value="compras">Nº de compras</option><option value="recente">Mais recente</option>
        </select>
        <select style={selStyle} value={msgDias} onChange={e => setMsgDias(e.target.value)}>
          <option value="">Recebeu msg: ignorar</option><option value="30">Últimos 30 dias</option><option value="90">Até 90 dias</option>
        </select>
        <span style={{ fontSize: 11, color: palette.inkMuted, marginLeft: 'auto', fontFamily: FONT }}>
          {loading ? 'carregando…' : `${clientes.length} clientes`}
        </span>
      </div>

      <SectionTitle icon={Users}>{aba === 'carteira' ? 'Carteira de clientes' : 'Todos os clientes'}</SectionTitle>
      <div style={{ overflowX: 'auto', border: `1px solid ${palette.beige}`, borderRadius: 10, background: palette.surface }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 13 }}>
          <thead>
            <tr style={{ background: MELUNI_SOFT }}>
              {COLS.map((c, i) => (
                <th key={i} style={{ textAlign: i >= 2 && i <= 4 ? 'right' : 'left', padding: '9px 12px', color: palette.inkSoft, fontWeight: 700, whiteSpace: 'nowrap' }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {erro && <tr><td colSpan={COLS.length} style={{ padding: 24, textAlign: 'center', color: palette.alert }}>{erro}</td></tr>}
            {!erro && !loading && clientes.length === 0 && (
              <tr><td colSpan={COLS.length} style={{ padding: 30, textAlign: 'center', color: palette.inkMuted }}>
                Sem clientes ainda. Quando o sync do Bling (lumia/Outros) rodar, eles aparecem aqui.
              </td></tr>
            )}
            {clientes.map(c => (
              <tr key={c.id} style={{ borderTop: `1px solid ${palette.beigeSoft}`, opacity: c.bloqueado ? 0.5 : 1 }}>
                <td style={{ padding: '8px 12px', color: palette.ink, fontWeight: 600 }}>{c.nome || '—'}</td>
                <td style={{ padding: '8px 12px', color: palette.inkSoft }}>{fmtTel(c.whatsapp || c.telefone)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: palette.ink }}>{c.n_compras || 0}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: palette.ink, fontWeight: 700 }}>{fmtBRL(c.valor_lifetime)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'right', color: palette.inkSoft }}>{fmtBRL(c.ticket_medio)}</td>
                <td style={{ padding: '8px 12px', color: palette.inkSoft }}>{fmtData(c.ultima_compra)}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  <button onClick={() => toggleBloqueio(c)} title={c.bloqueado ? 'Desbloquear' : 'Bloquear dos disparos'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.bloqueado ? palette.alert : palette.inkMuted }}>
                    <Ban size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── SEÇÃO: CARRINHO ABANDONADO ─────────────────────────────────────────────
function SecaoCarrinho() {
  const [aba, setAba] = useState('processando');
  const tabs = [
    { id: 'processando', label: 'Processando' },
    { id: 'aprovar', label: 'Aprovar / Enviar' },
    { id: 'conversando', label: 'Conversando' },
    { id: 'follow_up', label: 'Follow up' },
  ];
  return (
    <div>
      <SubTabs tabs={tabs} active={aba} onChange={setAba} />
      <Placeholder>
        Funil de carrinho abandonado (igual à Sofia): chega na planilha do Drive → <b>Processando</b> (selecionar todos) →
        <b> Aprovar/Enviar</b> (disparo em massa via template) → <b>Conversando</b> → <b>Follow up</b>.
      </Placeholder>
    </div>
  );
}

// ─── SEÇÃO: SAC ─────────────────────────────────────────────────────────────
function SecaoSac() {
  const [aba, setAba] = useState('conversando');
  const tabs = [
    { id: 'conversando', label: 'Conversando' },
    { id: 'follow_up', label: 'Follow up' },
    { id: 'arquivo', label: 'Arquivo' },
  ];
  return (
    <div>
      <SubTabs tabs={tabs} active={aba} onChange={setAba} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: palette.inkMuted, fontFamily: FONT }}>Canais:</span>
        <Tag cor={palette.accent} bg={palette.accentSoft}><Globe size={11} /> site</Tag>
        <Tag cor={MELUNI} bg={MELUNI_SOFT}><Instagram size={11} /> direct insta</Tag>
      </div>
      <Placeholder>
        {aba === 'conversando' && <>Chat espelhado da Sofia. Card com campo de <b>anotações</b> + tag de quem está atendendo. Conversa fria há 3 dias vai pro <b>Arquivo</b>.</>}
        {aba === 'follow_up' && <>Cards que precisam de atenção futura. Botão amarelo <b>acompanhar</b> (fixo no topo) e verde <b>resolvido</b> (após 24h vai pro Arquivo).</>}
        {aba === 'arquivo' && <>Conversas encerradas ou frias.</>}
      </Placeholder>
      <div style={{ marginTop: 8, fontSize: 11, color: palette.inkMuted, fontFamily: FONT }}>
        O Direct do Insta entra aqui com a tag <b>direct insta</b> quando a Instagram Messaging API estiver ligada (token/permissão à parte do token de Ads).
      </div>
    </div>
  );
}

// ─── SEÇÃO: DEVOLUÇÃO ───────────────────────────────────────────────────────
function SecaoDevolucao() {
  return (
    <div>
      <SectionTitle icon={RotateCcw}>Devoluções</SectionTitle>
      <Placeholder>
        Planilha diária do Drive com as devoluções. Card com dados do cliente + dados da devolução.
        Estrutura pronta (<code>meluni_devolucoes</code> com <code>dados_extra</code>); encaixo as colunas quando vc mandar a planilha.
      </Placeholder>
    </div>
  );
}

// ─── SEÇÃO: MARKETPLACES ────────────────────────────────────────────────────
function SecaoMarketplaces() {
  const btn = {
    border: `1px solid ${palette.beige}`, background: palette.surface, color: palette.ink,
    borderRadius: 10, padding: '12px 16px', cursor: 'pointer', fontFamily: FONT,
    fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
  };
  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button style={btn}><Calculator size={16} color={MELUNI} /> Calculadora</button>
        <button style={btn}><BarChart3 size={16} color={MELUNI} /> Análise Meluni</button>
        <button style={btn}><Megaphone size={16} color={MELUNI} /> Meta Ads Meluni</button>
      </div>
      <Placeholder>Os botões da calculadora + análise de campanhas (Meta Ads / GA4) entram aqui, com as campanhas mais completas. Reaproveita <code>meluni_meta_ads_historico</code>.</Placeholder>
    </div>
  );
}

// ─── SEÇÃO: DASHBOARD ───────────────────────────────────────────────────────
function SecaoDashboard() {
  const [aba, setAba] = useState('vendas');
  const tabs = [
    { id: 'vendas', label: 'Vendas' },
    { id: 'devolucao', label: 'Devolução' },
    { id: 'carrinho', label: 'Conversão de carrinho' },
  ];
  return (
    <div>
      <SubTabs tabs={tabs} active={aba} onChange={setAba} />
      <Placeholder>
        {aba === 'vendas' && <>Vendas Meluni (com filtros). Venda conta até 7 dias depois da mensagem, cruzando com o Bling.</>}
        {aba === 'devolucao' && <>Devoluções (com filtros).</>}
        {aba === 'carrinho' && <>Nº de carrinhos por dia, taxa de resposta e taxa de conversão.</>}
      </Placeholder>
    </div>
  );
}

const selStyle = {
  border: `1px solid ${palette.beige}`, borderRadius: 7, padding: '5px 8px',
  fontFamily: FONT, fontSize: 12, color: palette.inkSoft, background: palette.surface, cursor: 'pointer',
};

// ─── ROOT ───────────────────────────────────────────────────────────────────
export default function Meluni({ userId = '', isAdmin = false, onBack }) {
  const [secao, setSecao] = useState('clientes');
  const tabs = [
    { id: 'clientes', label: 'Clientes', icon: Users },
    { id: 'carrinho', label: 'Carrinho', icon: ShoppingCart },
    { id: 'sac', label: 'SAC', icon: MessageCircle },
    { id: 'devolucao', label: 'Devolução', icon: RotateCcw },
    { id: 'marketplaces', label: 'Marketplaces', icon: TrendingUp },
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  ];
  return (
    <div style={{ minHeight: '100vh', background: palette.bg, fontFamily: FONT }}>
      <Header
        title={`Meluni · ${ASSISTANT_NAME}`}
        subtitle="WhatsApp B2C · IA atendente"
        onBack={onBack}
        rightContent={<span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: MELUNI, borderRadius: 6, padding: '3px 9px' }}>B2C</span>}
      />
      <TabBar tabs={tabs} activeTab={secao} onChange={setSecao} />
      <div style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
        {/* presence lock: card aberto fica read-only pros outros — ligado quando os cards forem montados */}
        {secao === 'clientes' && <SecaoClientes />}
        {secao === 'carrinho' && <SecaoCarrinho />}
        {secao === 'sac' && <SecaoSac />}
        {secao === 'devolucao' && <SecaoDevolucao />}
        {secao === 'marketplaces' && <SecaoMarketplaces />}
        {secao === 'dashboard' && <SecaoDashboard />}
      </div>
    </div>
  );
}
