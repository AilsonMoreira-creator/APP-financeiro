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
  Instagram, Globe, Lock, Filter, Ban, Bot, User, Phone, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { palette, FONT, Header, TabBar, SectionTitle } from './Lojas_Shared.jsx';
import CalcMetaAdsMeluni from './CalcMetaAdsMeluni.jsx';
import MeluniAnalise from './CalcAnaliseMeluni';

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

function CampoKPI({ Icon, label, valor, destaque, alerta }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {Icon && <Icon size={11} style={{ verticalAlign: 'middle' }} />}
      <span style={{ color: palette.inkMuted }}>{label}:</span>
      <strong style={{ color: alerta ? palette.alert : (destaque ? palette.ok : palette.inkSoft), fontWeight: 600 }}>{valor}</strong>
    </span>
  );
}

// detecta desktop pra decidir layout split (lista + chat lado a lado) vs overlay no mobile
function useIsDesktop(bp = 760) {
  const [d, setD] = useState(typeof window !== 'undefined' ? window.innerWidth >= bp : true);
  useEffect(() => {
    const h = () => setD(window.innerWidth >= bp);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, [bp]);
  return d;
}

// card de cliente — mesmo formato da Sofia (ícone + nome + chips de KPI + bloquear)
// compact: versão reduzida (usada na lista da esquerda quando o chat tá aberto no desktop)
// ativo: card atualmente aberto no chat (fica destacado)
function MeluniClienteCard({ c, sel, onSel, onAbrir, onToggle, compact, ativo }) {
  const tel = c.whatsapp || c.telefone;
  const semCompra = !c.n_compras;

  if (compact) {
    return (
      <div onClick={onAbrir} title="Abrir conversa" style={{
        background: ativo ? MELUNI_SOFT : palette.surface, borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
        border: `1px solid ${ativo ? MELUNI : palette.beige}`, opacity: c.bloqueado ? 0.6 : 1,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <input type="checkbox" checked={sel} onClick={(e) => e.stopPropagation()} onChange={onSel}
          style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }} />
        <User size={13} color={MELUNI} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: ativo ? 700 : 600, color: palette.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nome || '—'}</div>
          <div style={{ fontSize: 11, color: palette.inkMuted }}>{fmtBRL(c.valor_lifetime)} · {c.n_compras || 0} compras</div>
        </div>
        {!tel && <span title="sem número" style={{ fontSize: 12, flexShrink: 0 }}>📵</span>}
      </div>
    );
  }

  return (
    <div style={{
      background: palette.surface, borderRadius: 12, padding: 12,
      border: `1px solid ${c.bloqueado ? palette.alert : palette.beige}`,
      opacity: c.bloqueado ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <input type="checkbox" checked={sel} onClick={(e) => e.stopPropagation()} onChange={onSel}
          style={{ width: 18, height: 18, cursor: 'pointer', marginTop: 2, flexShrink: 0 }} />
        <div onClick={onAbrir} title="Abrir conversa" style={{ flex: 1, minWidth: 0, cursor: 'pointer', display: 'flex', gap: 8 }}>
          <User size={15} color={MELUNI} style={{ marginTop: 3, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: palette.ink }}>{c.nome || '—'}</span>
              {semCompra && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, background: MELUNI_SOFT, color: MELUNI, fontWeight: 700 }}>só cadastro</span>}
            </div>
            <div style={{ fontSize: 12, color: palette.inkMuted, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <span><Phone size={11} style={{ verticalAlign: 'middle' }} /> {fmtTel(tel)}</span>
              {!tel && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: '#fdecea', color: '#b4453a', border: '1px solid #f1c9c4' }}>📵 sem número</span>}
              <CampoKPI Icon={ShoppingCart} label="lifetime" valor={fmtBRL(c.valor_lifetime)} destaque />
              <CampoKPI label="compras" valor={String(c.n_compras || 0)} />
              <CampoKPI label="ticket" valor={fmtBRL(c.ticket_medio)} />
              <CampoKPI label="última" valor={fmtData(c.ultima_compra)} />
            </div>
          </div>
        </div>
        <button onClick={onToggle} title={c.bloqueado ? 'Desbloquear' : 'Bloquear dos disparos'}
          style={{
            flexShrink: 0, padding: '5px 9px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT,
            background: c.bloqueado ? palette.alert : palette.surface, color: c.bloqueado ? '#fff' : palette.alert,
            border: `1px solid ${c.bloqueado ? palette.alert : palette.beige}`,
          }}>
          <Ban size={13} /> {c.bloqueado ? 'Bloqueado' : 'Bloquear'}
        </button>
      </div>
    </div>
  );
}

// ── SHELL genérico do chat (split estilo Sofia) — usado por Clientes/Carrinho/Devolução.
// Cabeçalho roxo: setas ‹ › (passa/volta) + título/subtítulo + fechar. Corpo = children.
// Inline (painel à direita) no desktop; overlay tela cheia no mobile. Setas e título mudam
// por seção; o miolo (children) é o que cada seção renderiza.
function MeluniChatShell({ titulo, subtitulo, overlay, onClose, onPrev, onNext, hasPrev, hasNext, children }) {
  const setaStyle = (on) => ({
    background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff', borderRadius: 7,
    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: on ? 'pointer' : 'default', opacity: on ? 1 : 0.35, padding: 0, flexShrink: 0,
  });
  const corpo = (
    <>
      <div style={{ background: MELUNI, color: '#fff', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button onClick={hasPrev ? onPrev : undefined} disabled={!hasPrev} title="Anterior" style={setaStyle(hasPrev)}><ChevronLeft size={16} /></button>
            <button onClick={hasNext ? onNext : undefined} disabled={!hasNext} title="Próximo" style={setaStyle(hasNext)}><ChevronRight size={16} /></button>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, fontFamily: FONT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo || '—'}</div>
            {subtitulo != null && <div style={{ fontSize: 12, opacity: 0.85, fontFamily: FONT }}>{subtitulo}</div>}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontFamily: FONT, fontSize: 12, flexShrink: 0 }}>fechar</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', fontFamily: FONT }}>{children}</div>
    </>
  );
  if (overlay) {
    return (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
        <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 100%)', height: '100%', background: palette.bg, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 20px rgba(0,0,0,0.15)' }}>
          {corpo}
        </div>
      </div>
    );
  }
  return (
    <div style={{ flex: '0 0 430px', maxWidth: 430, alignSelf: 'flex-start', position: 'sticky', top: 8, maxHeight: 'calc(100vh - 90px)', background: palette.bg, border: `1px solid ${palette.beige}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
      {corpo}
    </div>
  );
}

// ── ORQUESTRADOR do split: lista (compacta quando o chat abre no desktop) + shell do chat.
// Cada seção passa: itens, getId, qual está aberto (abertoId/setAbertoId), título/subtítulo,
// e dois render-props — renderCard(item,{compact,ativo,onAbrir}) e renderChat(item).
function MeluniSplitChat({ itens, getId, abertoId, setAbertoId, isDesktop, tituloDe, subtituloDe, renderCard, renderChat, listaRodape }) {
  const idx = abertoId != null ? itens.findIndex(it => getId(it) === abertoId) : -1;
  const aberto = idx >= 0 ? itens[idx] : null;
  const irPara = (i) => { if (i >= 0 && i < itens.length) setAbertoId(getId(itens[i])); };
  const nav = {
    onClose: () => setAbertoId(null),
    onPrev: () => irPara(idx - 1),
    onNext: () => irPara(idx + 1),
    hasPrev: idx > 0,
    hasNext: idx >= 0 && idx < itens.length - 1,
  };
  const split = !!(aberto && isDesktop);
  const head = aberto ? { titulo: tituloDe(aberto), subtitulo: subtituloDe ? subtituloDe(aberto) : null } : {};
  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: split ? 6 : 8 }}>
          {itens.map(it => (
            <React.Fragment key={getId(it)}>
              {renderCard(it, { compact: split, ativo: aberto && getId(it) === abertoId, onAbrir: () => setAbertoId(getId(it)) })}
            </React.Fragment>
          ))}
          {listaRodape}
        </div>
        {split && <MeluniChatShell {...head} {...nav}>{renderChat(aberto)}</MeluniChatShell>}
      </div>
      {aberto && !isDesktop && <MeluniChatShell overlay {...head} {...nav}>{renderChat(aberto)}</MeluniChatShell>}
    </>
  );
}

// corpo do chat de CLIENTE: faixa de KPIs + histórico de compras (pra Lara personalizar/cross-sell)
function ChatClienteBody({ cliente }) {
  const [hist, setHist] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(`/api/meluni-cliente-historico?cliente_id=${cliente.id}`)
      .then(r => r.json()).then(j => { if (j.ok) setHist(j); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [cliente.id]);
  const pedidos = hist?.pedidos || [];
  return (
    <>
      <div style={{ display: 'flex', gap: 14, padding: '10px 16px', borderBottom: `1px solid ${palette.beige}`, fontSize: 12, color: palette.inkSoft, flexWrap: 'wrap' }}>
        <span>lifetime <b>{fmtBRL(cliente.valor_lifetime)}</b></span>
        <span>compras <b>{cliente.n_compras || 0}</b></span>
        <span>ticket <b>{fmtBRL(cliente.ticket_medio)}</b></span>
        <span>última <b>{fmtData(cliente.ultima_compra)}</b></span>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: palette.inkSoft, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          Histórico de compras {pedidos.length > 0 ? `(${pedidos.length})` : ''}
        </div>
        {loading && <div style={{ fontSize: 13, color: palette.inkMuted }}>carregando…</div>}
        {!loading && pedidos.length === 0 && (
          <div style={{ fontSize: 13, color: palette.inkMuted }}>Ainda sem compras registradas (só cadastro).</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pedidos.map(p => (
            <div key={p.pedido_id} style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 10, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 12, color: palette.inkSoft }}>
                <span>{fmtData(p.data)}</span>
                <strong style={{ color: palette.ink }}>{fmtBRL(p.total)}</strong>
              </div>
              {p.itens.map((i, k) => (
                <div key={k} style={{ fontSize: 12, color: palette.ink, padding: '3px 0', borderTop: k ? `1px solid ${palette.beigeSoft}` : 'none' }}>
                  <span>{i.qtd}x {i.produto}</span>
                  <span style={{ color: palette.inkMuted }}>
                    {i.ref ? ` · ref ${i.ref}` : ''}{i.cor ? ` · ${i.cor}` : ''}{i.tamanho ? ` · ${i.tamanho}` : ''}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, padding: 12, background: MELUNI_SOFT, borderRadius: 10, fontSize: 12, color: palette.inkSoft, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <MessageCircle size={16} color={MELUNI} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>A Lara usa esse histórico pra personalizar e indicar cross-sell. A conversa em si abre aqui quando o número do WhatsApp B2C estiver ligado.</span>
        </div>
      </div>
    </>
  );
}

// nota padrão de rodapé do chat (conversa real só quando a Lara/WhatsApp ligar)
function NotaLara({ children }) {
  return (
    <div style={{ margin: 16, padding: 12, background: MELUNI_SOFT, borderRadius: 10, fontSize: 12, color: palette.inkSoft, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <MessageCircle size={16} color={MELUNI} style={{ marginTop: 1, flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  );
}

function SecaoClientes() {
  const [etapa, setEtapa] = useState('carteira');
  const [ordenar, setOrdenar] = useState('valor');
  const [nome, setNome] = useState('');
  const [periodo, setPeriodo] = useState('');
  const [janela, setJanela] = useState('');
  const [msgDias, setMsgDias] = useState('');
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [sel, setSel] = useState(new Set());
  const [chatId, setChatId] = useState(null);
  const isDesktop = useIsDesktop();

  const carregar = useCallback(async () => {
    setLoading(true); setErro('');
    try {
      const p = new URLSearchParams({ etapa, ordenar });
      if (nome.trim()) p.set('nome', nome.trim());
      if (periodo) p.set('periodo_dias', periodo);
      if (janela) { const [a, b] = janela.split('-'); p.set('janela_min', a); p.set('janela_max', b); }
      if (msgDias) p.set('msg_dias', msgDias);
      const r = await fetch('/api/meluni-clientes-list?' + p.toString());
      const j = await r.json();
      if (j.ok) setClientes(j.clientes || []); else setErro(j.erro || 'erro ao carregar');
    } catch (e) { setErro(String(e?.message || e)); }
    setLoading(false);
  }, [etapa, ordenar, nome, periodo, janela, msgDias]);

  useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t); }, [carregar]);
  useEffect(() => { setSel(new Set()); }, [etapa]);

  const toggleBloqueio = async (c) => {
    const novo = !c.bloqueado;
    if (novo && !window.confirm(`Bloquear ${c.nome || fmtTel(c.whatsapp || c.telefone)} dos disparos?`)) return;
    setClientes(prev => prev.map(x => x.id === c.id ? { ...x, bloqueado: novo } : x));
    try {
      await fetch('/api/meluni-cliente-bloquear', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: c.id, telefone: c.telefone, bloquear: novo }),
      });
    } catch (e) { carregar(); }
  };

  const toggleSel = (id) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const comFone = clientes.filter(c => (c.whatsapp || c.telefone) && !c.bloqueado);
  const selTodos = () => setSel(sel.size === comFone.length && comFone.length ? new Set() : new Set(comFone.map(c => c.id)));

  const tabs = [
    { id: 'carteira', label: 'Carteira' },
    { id: 'enviados', label: 'Enviados' },
    { id: 'conversando', label: 'Conversando' },
    { id: 'follow_up', label: 'Follow up' },
    { id: 'conversao', label: 'Conversão' },
  ];

  return (
    <div>
      <SubTabs tabs={tabs} active={etapa} onChange={setEtapa} />

      {/* barra de filtros */}
      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        marginBottom: 10, padding: 10, background: palette.surface,
        border: `1px solid ${palette.beige}`, borderRadius: 10,
      }}>
        <Filter size={15} color={palette.inkMuted} />
        <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Buscar por nome"
          style={{ ...selStyle, minWidth: 150 }} />
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
      </div>

      {/* barra de seleção em massa */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={selTodos} style={{ ...selStyle, fontWeight: 700 }}>
          {sel.size === comFone.length && comFone.length ? 'Limpar' : 'Selecionar todos'}
        </button>
        <span style={{ fontSize: 12, color: palette.inkMuted, fontFamily: FONT }}>
          {loading ? 'carregando…' : `${clientes.length} clientes`}{sel.size > 0 ? ` · ${sel.size} selecionados` : ''}
        </span>
        {sel.size > 0 && <span style={{ fontSize: 11, color: palette.warn, fontFamily: FONT }}>o disparo em massa liga quando o número da Lara estiver configurado</span>}
      </div>

      {erro && <Placeholder><span style={{ color: palette.alert }}>{erro}</span></Placeholder>}
      {!erro && !loading && clientes.length === 0 && (
        <Placeholder>
          {etapa === 'carteira'
            ? 'Nenhum cliente nesse filtro.'
            : 'Ninguém nessa etapa ainda — enche quando os disparos da Lara começarem.'}
        </Placeholder>
      )}
      {(!erro && clientes.length > 0) && (
        <MeluniSplitChat
          itens={clientes} getId={(c) => c.id}
          abertoId={chatId} setAbertoId={setChatId} isDesktop={isDesktop}
          tituloDe={(c) => c.nome || 'Cliente'}
          subtituloDe={(c) => fmtTel(c.whatsapp || c.telefone) || 'sem número'}
          renderCard={(c, p) => (
            <MeluniClienteCard c={c} sel={sel.has(c.id)}
              onSel={() => toggleSel(c.id)} onToggle={() => toggleBloqueio(c)} {...p} />
          )}
          renderChat={(c) => <ChatClienteBody cliente={c} />}
        />
      )}
    </div>
  );
}

// ─── SEÇÃO: CARRINHO ABANDONADO ─────────────────────────────────────────────
function CarrinhoCard({ c, sel, onSel, compact, ativo, onAbrir }) {
  const tel = c.cliente_whatsapp || c.telefone;
  const nome = c.cliente_nome || c.nome;
  const itens = Array.isArray(c.itens) ? c.itens : [];

  if (compact) {
    return (
      <div onClick={onAbrir} title="Abrir conversa" style={{
        background: ativo ? MELUNI_SOFT : palette.surface, borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
        border: `1px solid ${ativo ? MELUNI : palette.beige}`, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <input type="checkbox" checked={sel} onClick={(e) => e.stopPropagation()} onChange={onSel}
          style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }} />
        <ShoppingCart size={13} color={MELUNI} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: ativo ? 700 : 600, color: palette.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fmtBRL(c.valor)}{nome ? ` · ${nome}` : ''}
          </div>
          <div style={{ fontSize: 11, color: palette.inkMuted }}>{itens.reduce((a, i) => a + (i.qtd || 1), 0)} itens · {fmtData(String(c.data_carrinho || '').slice(0, 10))}</div>
        </div>
        {c.is_cliente && <span title="já é cliente" style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: MELUNI_SOFT, color: MELUNI, fontWeight: 700, flexShrink: 0 }}>cliente</span>}
      </div>
    );
  }

  return (
    <div onClick={onAbrir} title={onAbrir ? 'Abrir conversa' : undefined} style={{ background: palette.surface, borderRadius: 12, padding: 12, border: `1px solid ${palette.beige}`, cursor: onAbrir ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <input type="checkbox" checked={sel} onClick={(e) => e.stopPropagation()} onChange={onSel} style={{ width: 18, height: 18, cursor: 'pointer', marginTop: 2, flexShrink: 0 }} />
        <ShoppingCart size={15} color={MELUNI} style={{ marginTop: 3, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: palette.ink }}>{fmtBRL(c.valor)}</span>
            {nome && <span style={{ fontSize: 13, color: palette.inkSoft }}>{nome}</span>}
            {c.is_cliente && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, background: MELUNI_SOFT, color: MELUNI, fontWeight: 700 }}>já é cliente</span>}
          </div>
          <div style={{ fontSize: 12, color: palette.inkMuted, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span><Phone size={11} style={{ verticalAlign: 'middle' }} /> {fmtTel(tel)}</span>
            {!tel && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: '#fdecea', color: '#b4453a', border: '1px solid #f1c9c4' }}>📵 sem número</span>}
            <CampoKPI label="itens" valor={String(itens.reduce((a, i) => a + (i.qtd || 1), 0))} />
            <span>{fmtData(String(c.data_carrinho || '').slice(0, 10))}</span>
          </div>
          {itens.length > 0 && (
            <div style={{ fontSize: 11, color: palette.inkMuted, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {itens.map(i => `${i.qtd}x ${i.sku}`).join('  ·  ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// corpo do chat de CARRINHO: contato + itens do carrinho + nota da Lara
function ChatCarrinhoBody({ c }) {
  const itens = Array.isArray(c.itens) ? c.itens : [];
  return (
    <>
      <div style={{ display: 'flex', gap: 14, padding: '10px 16px', borderBottom: `1px solid ${palette.beige}`, fontSize: 12, color: palette.inkSoft, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>valor <b>{fmtBRL(c.valor)}</b></span>
        <span>itens <b>{itens.reduce((a, i) => a + (i.qtd || 1), 0)}</b></span>
        <span>data <b>{fmtData(String(c.data_carrinho || '').slice(0, 10))}</b></span>
        {c.is_cliente && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 5, background: MELUNI_SOFT, color: MELUNI, fontWeight: 700 }}>já é cliente</span>}
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: palette.inkSoft, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.3 }}>Carrinho</div>
        {itens.length === 0 && <div style={{ fontSize: 13, color: palette.inkMuted }}>Sem itens detalhados.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {itens.map((i, k) => (
            <div key={k} style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, color: palette.ink }}>
              {i.qtd}x {i.sku}{i.descLimpa ? ` · ${i.descLimpa}` : ''}
            </div>
          ))}
        </div>
      </div>
      <NotaLara>A Lara puxa esse carrinho pra recuperar a venda. A conversa abre aqui quando o número do WhatsApp B2C estiver ligado.</NotaLara>
    </>
  );
}

function SecaoCarrinho() {
  const [aba, setAba] = useState('processando');
  const [carrinhos, setCarrinhos] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(new Set());
  const [chatId, setChatId] = useState(null);
  const isDesktop = useIsDesktop();
  const LIM = 60;
  const tabs = [
    { id: 'processando', label: 'Processando' },
    { id: 'aprovar', label: 'Aprovar / Enviar' },
    { id: 'conversando', label: 'Conversando' },
    { id: 'follow_up', label: 'Follow up' },
  ];
  const carregar = useCallback(async (off = 0) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/meluni-carrinhos-list?status=${aba}&limite=${LIM}&offset=${off}`);
      const j = await r.json();
      if (j.ok) { setTotal(j.total || 0); setCarrinhos(prev => off ? [...prev, ...j.carrinhos] : j.carrinhos); }
    } catch (e) { /* ignora */ }
    setLoading(false);
  }, [aba]);
  useEffect(() => { setSel(new Set()); setChatId(null); carregar(0); }, [carregar]);
  const toggleSel = (id) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selTodos = () => setSel(sel.size === carrinhos.length ? new Set() : new Set(carrinhos.map(c => c.id)));

  const carregarMais = carrinhos.length < total ? (
    <button onClick={() => carregar(carrinhos.length)} disabled={loading}
      style={{ ...selStyle, marginTop: 4, width: '100%', padding: 8, fontWeight: 700 }}>
      {loading ? 'carregando…' : `Carregar mais (${total - carrinhos.length} restantes)`}
    </button>
  ) : null;

  return (
    <div>
      <SubTabs tabs={tabs} active={aba} onChange={setAba} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <button onClick={selTodos} style={{ ...selStyle, fontWeight: 700 }}>
          {sel.size === carrinhos.length && carrinhos.length ? 'Limpar' : 'Selecionar todos'}
        </button>
        <span style={{ fontSize: 12, color: palette.inkMuted, fontFamily: FONT }}>
          {loading ? 'carregando…' : `${total} no funil`}{sel.size > 0 ? ` · ${sel.size} selecionados` : ''}
        </span>
        {sel.size > 0 && <span style={{ fontSize: 11, color: palette.warn, fontFamily: FONT }}>o disparo em massa liga quando o número da Lara estiver configurado</span>}
      </div>
      {!loading && carrinhos.length === 0 && <Placeholder>Nenhum carrinho nesse estágio.</Placeholder>}
      {carrinhos.length > 0 && (
        <MeluniSplitChat
          itens={carrinhos} getId={(c) => c.id}
          abertoId={chatId} setAbertoId={setChatId} isDesktop={isDesktop}
          tituloDe={(c) => c.cliente_nome || c.nome || fmtBRL(c.valor)}
          subtituloDe={(c) => fmtTel(c.cliente_whatsapp || c.telefone) || 'sem número'}
          renderCard={(c, p) => (
            <CarrinhoCard c={c} sel={sel.has(c.id)} onSel={() => toggleSel(c.id)} {...p} />
          )}
          renderChat={(c) => <ChatCarrinhoBody c={c} />}
          listaRodape={carregarMais}
        />
      )}
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
function DevolucaoCard({ d, compact, ativo, onAbrir }) {
  const STA = { Aprovado: palette.ok, Pendente: palette.warn, Recusado: palette.alert, Cancelado: palette.alert };
  const cor = STA[d.status] || palette.inkSoft;

  if (compact) {
    return (
      <div onClick={onAbrir} title="Abrir conversa" style={{
        background: ativo ? MELUNI_SOFT : palette.surface, borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
        border: `1px solid ${ativo ? MELUNI : palette.beige}`, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <RotateCcw size={13} color={MELUNI} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: ativo ? 700 : 600, color: palette.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.nome || '—'}</div>
          <div style={{ fontSize: 11, color: palette.inkMuted }}>{fmtBRL(d.total)} · {d.motivo || 'sem motivo'}</div>
        </div>
        <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, fontWeight: 700, color: cor, border: `1px solid ${cor}`, flexShrink: 0 }}>{d.status || '—'}</span>
      </div>
    );
  }

  return (
    <div onClick={onAbrir} title={onAbrir ? 'Abrir conversa' : undefined} style={{ background: palette.surface, borderRadius: 12, padding: 12, border: `1px solid ${palette.beige}`, cursor: onAbrir ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <RotateCcw size={15} color={MELUNI} style={{ marginTop: 3, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: palette.ink }}>{d.nome || '—'}</span>
            <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: palette.surface, color: cor, border: `1px solid ${cor}` }}>{d.status || '—'}</span>
            {d.pedido_ref && <span style={{ fontSize: 11, color: palette.inkMuted }}>pedido {d.pedido_ref}</span>}
          </div>
          <div style={{ fontSize: 12, color: palette.inkMuted, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 4 }}>
            <span><Phone size={11} style={{ verticalAlign: 'middle' }} /> {fmtTel(d.telefone)}</span>
            <CampoKPI label="motivo" valor={d.motivo || '—'} />
            <CampoKPI label="total" valor={fmtBRL(d.total)} destaque />
            <span>{fmtData(d.data_devolucao)}</span>
          </div>
          <div style={{ fontSize: 11, color: palette.inkSoft }}>
            {d.itens.map((i, k) => (
              <div key={k}>• {i.produto}{i.tamanho ? ` (${String(i.tamanho).replace('Tamanho : ', '')})` : ''} — {fmtBRL(i.valor)}</div>
            ))}
          </div>
          {d.mensagem && <div style={{ fontSize: 11, color: palette.inkMuted, marginTop: 4, fontStyle: 'italic' }}>"{d.mensagem}"</div>}
          <div style={{ marginTop: 8, fontSize: 10.5, color: palette.inkMuted }}>
            {d.rastreio ? `rastreio: ${d.rastreio}` : 'aviso de código de rastreio entra aqui'}
          </div>
        </div>
      </div>
    </div>
  );
}

// corpo do chat de DEVOLUÇÃO: status/motivo/itens + rastreio + nota da Lara
function ChatDevolucaoBody({ d }) {
  const STA = { Aprovado: palette.ok, Pendente: palette.warn, Recusado: palette.alert, Cancelado: palette.alert };
  const cor = STA[d.status] || palette.inkSoft;
  return (
    <>
      <div style={{ display: 'flex', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${palette.beige}`, fontSize: 12, color: palette.inkSoft, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 5, fontWeight: 700, color: cor, border: `1px solid ${cor}` }}>{d.status || '—'}</span>
        <span>total <b>{fmtBRL(d.total)}</b></span>
        {d.pedido_ref && <span>pedido <b>{d.pedido_ref}</b></span>}
        <span>{fmtData(d.data_devolucao)}</span>
      </div>
      <div style={{ padding: 16 }}>
        <div style={{ fontSize: 12, color: palette.inkSoft, marginBottom: 10 }}>motivo: <b>{d.motivo || '—'}</b></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {d.itens.map((i, k) => (
            <div key={k} style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, color: palette.ink }}>
              {i.produto}{i.tamanho ? ` (${String(i.tamanho).replace('Tamanho : ', '')})` : ''} — {fmtBRL(i.valor)}
            </div>
          ))}
        </div>
        {d.mensagem && <div style={{ fontSize: 12, color: palette.inkMuted, marginTop: 10, fontStyle: 'italic' }}>"{d.mensagem}"</div>}
        <div style={{ marginTop: 12, fontSize: 11.5, color: palette.inkMuted }}>
          {d.rastreio ? `rastreio: ${d.rastreio}` : 'o código de rastreio é enviado por aqui quando a devolução for aprovada'}
        </div>
      </div>
      <NotaLara>A Lara conduz a devolução por aqui (status + rastreio). A conversa abre quando o número do WhatsApp B2C estiver ligado.</NotaLara>
    </>
  );
}

function SecaoDevolucao() {
  const [devs, setDevs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chatId, setChatId] = useState(null);
  const isDesktop = useIsDesktop();
  useEffect(() => {
    setLoading(true);
    fetch('/api/meluni-devolucoes-list').then(r => r.json())
      .then(j => { if (j.ok) setDevs(j.devolucoes || []); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);
  return (
    <div>
      <SectionTitle icon={RotateCcw}>{loading ? 'Devoluções…' : `${devs.length} devolução(ões)`}</SectionTitle>
      {!loading && devs.length === 0 && <Placeholder>Nenhuma devolução importada ainda.</Placeholder>}
      {devs.length > 0 && (
        <MeluniSplitChat
          itens={devs} getId={(d) => d.chave}
          abertoId={chatId} setAbertoId={setChatId} isDesktop={isDesktop}
          tituloDe={(d) => d.nome || 'Devolução'}
          subtituloDe={(d) => fmtTel(d.telefone) || 'sem número'}
          renderCard={(d, p) => <DevolucaoCard d={d} {...p} />}
          renderChat={(d) => <ChatDevolucaoBody d={d} />}
        />
      )}
    </div>
  );
}

// ─── SEÇÃO: MARKETPLACES ────────────────────────────────────────────────────
function SecaoMarketing() {
  const [aba, setAba] = useState('meta_ads');
  const tabs = [
    { id: 'meta_ads', label: 'Meta Ads Meluni' },
    { id: 'analise', label: 'Análise' },
  ];
  return (
    <div>
      <SubTabs tabs={tabs} active={aba} onChange={setAba} />
      {aba === 'meta_ads' && (
        <CalcMetaAdsMeluni onVoltar={() => setAba('analise')} mobile={typeof window !== 'undefined' && window.innerWidth < 640} />
      )}
      {aba === 'analise' && (
        <MeluniAnalise onVoltar={() => setAba('meta_ads')} mobile={typeof window !== 'undefined' && window.innerWidth < 640} />
      )}
    </div>
  );
}

// ─── SEÇÃO: DASHBOARD ───────────────────────────────────────────────────────
function KpiTile({ label, valor, sub, destaque }) {
  return (
    <div style={{
      flex: '1 1 150px', minWidth: 140,
      background: destaque ? MELUNI_SOFT : palette.surface,
      border: `1px solid ${destaque ? MELUNI : palette.beige}`, borderRadius: 12, padding: '12px 14px',
    }}>
      <div style={{ fontSize: 11, color: palette.inkMuted, fontFamily: FONT, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: destaque ? MELUNI : palette.ink, fontFamily: FONT }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: palette.inkSoft, fontFamily: FONT, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function MiniBarras({ serie }) {
  if (!serie || !serie.length) return null;
  const max = Math.max(...serie.map(s => s.vendas_valor), 1);
  return (
    <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 14, marginTop: 12 }}>
      <div style={{ fontSize: 12, color: palette.inkSoft, fontFamily: FONT, marginBottom: 10, fontWeight: 600 }}>Vendas por dia (R$)</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
        {serie.map(s => (
          <div key={s.data} title={`${fmtData(s.data)}: ${fmtBRL(s.vendas_valor)} · ${s.vendas_qtd} venda(s)`}
            style={{
              flex: 1, minWidth: 2, background: MELUNI, borderRadius: '3px 3px 0 0',
              height: `${Math.max(2, (s.vendas_valor / max) * 100)}%`, opacity: 0.85,
            }} />
        ))}
      </div>
    </div>
  );
}

function SecaoDashboard() {
  const [periodo, setPeriodo] = useState('30');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    const qs = periodo === 'tudo' ? 'tudo=1' : `dias=${periodo}`;
    fetch(`/api/meluni-dashboard?${qs}`).then(r => r.json())
      .then(j => { if (j.ok) setData(j); }).catch(() => {}).finally(() => setLoading(false));
  }, [periodo]);
  const d = data || {};
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Filter size={15} color={palette.inkMuted} />
        <select style={selStyle} value={periodo} onChange={e => setPeriodo(e.target.value)}>
          <option value="30">Últimos 30 dias</option>
          <option value="60">Últimos 60 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="tudo">Tudo</option>
        </select>
        <span style={{ fontSize: 11, color: palette.inkMuted, fontFamily: FONT, marginLeft: 'auto' }}>
          {loading ? 'carregando…' : (d.periodo ? `${fmtData(d.periodo.de)} a ${fmtData(d.periodo.ate)}` : '')}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <KpiTile label="Vendas" valor={fmtBRL(d.vendas?.soma)} sub={`${d.vendas?.qtd || 0} pedidos`} />
        <KpiTile label="Devoluções" valor={fmtBRL(d.devolucoes?.soma)} sub={`${d.devolucoes?.qtd || 0} devoluções`} />
        <KpiTile label="Valor real (vendas - devolução)" valor={fmtBRL(d.valor_real)} destaque />
        <KpiTile label="Ticket médio" valor={fmtBRL(d.ticket)} />
        <KpiTile label="Carrinhos" valor={String(d.carrinhos?.qtd || 0)} sub="no período" />
      </div>
      <MiniBarras serie={d.serie || []} />
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
    { id: 'marketing', label: 'Marketing', icon: TrendingUp },
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
        {secao === 'marketing' && <SecaoMarketing />}
        {secao === 'dashboard' && <SecaoDashboard />}
      </div>
    </div>
  );
}
