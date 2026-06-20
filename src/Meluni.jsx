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
import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import {
  Users, ShoppingCart, MessageCircle, RotateCcw, TrendingUp, BarChart3,
  Instagram, Mail, Globe, Lock, Filter, Ban, Bot, User, Phone, ChevronLeft, ChevronRight,
  CheckCircle, X, ThumbsUp, Tag as IconTag, PackageCheck, Clock, DollarSign, Send, Paperclip, Smile,
} from 'lucide-react';
import { palette, FONT, Header, TabBar, SectionTitle } from './Lojas_Shared.jsx';
import CalcMetaAdsMeluni from './CalcMetaAdsMeluni.jsx';
import MeluniAnalise from './CalcAnaliseMeluni';

const ASSISTANT_NAME = 'Lara';
const MELUNI = '#9b59b6';      // roxo da marca Meluni (consistente com o resto do app)
const MELUNI_SOFT = '#f6f0f9';
const VERDE_ENVIAR = '#25d366'; // verde WhatsApp (igual Sofia) pros botões de enviar mensagem

// ─── trava de presença (Ailson 16/06/2026) ─────────────────────────────────
// userId via Context (o front da Meluni é por API; o claim/release vai em
// /api/meluni-lock). 1 atendente por chat/devolução; os demais ficam só-leitura
// e veem quem está atendendo. Lock obsoleto (>45s sem heartbeat 20s) é tomado.
const MeluniUserCtx = React.createContext('');

function useMeluniLock(tipo, id) {
  const userId = useContext(MeluniUserCtx);
  const [lockPor, setLockPor] = useState(null);
  useEffect(() => {
    if (!id || !userId) { setLockPor(null); return; }
    let vivo = true;
    const body = (acao) => JSON.stringify({ tipo, id, acao, userId });
    const claim = async () => {
      try {
        const r = await fetch('/api/meluni-lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body('claim') });
        const j = await r.json();
        if (vivo && j.ok) setLockPor(j.lockPor || null);
      } catch { /* ignora */ }
    };
    const release = () => {
      try { fetch('/api/meluni-lock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body('release'), keepalive: true }); } catch { /* */ }
    };
    claim();
    const hb = setInterval(claim, 20000);
    window.addEventListener('pagehide', release);
    return () => { vivo = false; clearInterval(hb); window.removeEventListener('pagehide', release); release(); };
  }, [tipo, id, userId]);
  const bloqueado = !!lockPor && lockPor !== userId;
  return { lockPor, bloqueado };
}

// ─── sub-abas leves (dentro de cada seção) ──────────────────────────────────
function SubTabs({ tabs, active, onChange }) {
  const [helpOpen, setHelpOpen] = useState(null);
  const aberto = tabs.find(t => t.id === helpOpen && t.help);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {tabs.map(t => {
          const on = active === t.id;
          return (
            <div key={t.id} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <button onClick={() => onChange(t.id)} style={{
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
              {t.help && (
                <button onClick={(e) => { e.stopPropagation(); setHelpOpen(helpOpen === t.id ? null : t.id); }}
                  title="como funciona esta etapa" style={{
                    marginLeft: 3, width: 17, height: 17, flexShrink: 0, borderRadius: 999, cursor: 'pointer',
                    border: `1px solid ${helpOpen === t.id ? MELUNI : palette.beige}`,
                    background: helpOpen === t.id ? MELUNI : palette.surface,
                    color: helpOpen === t.id ? '#fff' : palette.inkMuted,
                    fontSize: 11, fontWeight: 700, fontFamily: FONT, lineHeight: 1, padding: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>?</button>
              )}
              {t.unread > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4, zIndex: 1,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
                  fontSize: 9, fontWeight: 700, background: '#dc2626', color: '#fff',
                  lineHeight: 1, border: '2px solid #fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                }}>{t.unread}</span>
              )}
            </div>
          );
        })}
      </div>
      {aberto && (
        <div style={{
          marginTop: 8, background: MELUNI_SOFT, border: `1px solid ${MELUNI}`, borderRadius: 10,
          padding: '10px 30px 10px 12px', fontFamily: FONT, fontSize: 12.5, color: palette.ink,
          lineHeight: 1.5, whiteSpace: 'pre-line', position: 'relative',
        }}>
          <button onClick={() => setHelpOpen(null)} title="fechar" style={{
            position: 'absolute', top: 6, right: 8, border: 'none', background: 'none',
            cursor: 'pointer', fontSize: 16, color: palette.inkMuted, lineHeight: 1, padding: 0,
          }}>×</button>
          <div style={{ fontWeight: 700, color: MELUNI, marginBottom: 4 }}>{aberto.label}</div>
          {aberto.help}
        </div>
      )}
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
// data + hora a partir de timestamptz (pra linha do tempo da devolução)
const fmtDH = (ts) => {
  if (!ts) return '';
  const dt = new Date(ts);
  if (isNaN(dt)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
};
// dias inteiros desde um timestamp (base do SLA)
const diasDesde = (ts) => {
  if (!ts) return 0;
  const dt = new Date(ts);
  if (isNaN(dt)) return 0;
  return Math.floor((Date.now() - dt.getTime()) / 86400000);
};

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

// marcação de conversa sem resposta — vermelho idêntico Sofia (#dc2626)
const DotConversa = () => <span title="conversa sem resposta" style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', flexShrink: 0 }} />;
const PillConversa = () => <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: '#fdecea', color: '#dc2626', border: '1px solid #f4c7c7' }}>💬 sem resposta</span>;

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
        {c.conversa_pendente && <DotConversa />}
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
              {c.conversa_pendente && <PillConversa />}
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

// reduz a imagem (foto de celular costuma ser grande) e devolve base64 jpeg
function fileToBase64Scaled(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (Math.max(width, height) > maxDim) {
        const r = maxDim / Math.max(width, height);
        width = Math.round(width * r); height = Math.round(height * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      try { resolve({ base64: canvas.toDataURL('image/jpeg', quality).split(',')[1], mime: 'image/jpeg' }); }
      catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('falha ao ler imagem')); };
    img.src = url;
  });
}
const EMOJIS_CHAT = ['😊', '😍', '🥰', '😉', '😅', '🙏', '👏', '✨', '💕', '💜', '🤍', '🔥', '🎉', '👗', '👜', '🛍️', '✅', '👇', '💬', '😂'];

// ── THREAD da Lara: mensagens reais + sugestão pendente (aprovar/editar/enviar/
// descartar) + envio manual. Reutilizável: passa telefone OU conversaId.
// Polla a cada 5s (estilo live chat da Sofia). Ailson 16/06/2026.
function LaraThread({ telefone, conversaId, nome }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rascunho, setRascunho] = useState('');
  const [editando, setEditando] = useState(false);
  const [sugTexto, setSugTexto] = useState('');
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState('');
  const [gerando, setGerando] = useState(false);
  const [anexando, setAnexando] = useState(false);
  const [emojiAberto, setEmojiAberto] = useState(false);
  const fileRef = useRef(null);
  const fimRef = useRef(null);

  const qs = conversaId ? `conversa_id=${conversaId}` : `telefone=${encodeURIComponent(telefone || '')}`;
  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/meluni-whats-conversa?${qs}`);
      const j = await r.json();
      if (j.ok) setData(j);
    } catch { /* ignora */ } finally { setLoading(false); }
  }, [qs]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 5000);
    return () => clearInterval(t);
  }, [carregar]);
  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [data?.mensagens?.length, data?.sugestao?.id]);

  const conv = data?.conversa;
  const msgs = data?.mensagens || [];
  const sug = data?.sugestao;
  const ultEntradaMs = msgs.filter(m => m.direcao === 'entrada').reduce((a, m) => Math.max(a, +new Date(m.enviada_em) || 0), 0);
  const ehEmail = conv?.canal === 'email';
  // e-mail não tem janela de 24h (isso é regra do WhatsApp): está sempre aberto.
  const janelaAberta = ehEmail || (ultEntradaMs > 0 && (Date.now() - ultEntradaMs) < 24 * 3600e3);
  const { lockPor, bloqueado } = useMeluniLock('conversa', conv?.id);

  async function post(url, body) {
    setBusy(true); setAviso('');
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (j && j.ok === false) {
        const e = String(j.erro || '');
        if (/24|janela|reengag|re-engage|131047|outside|escrito antes|nao encontrada/i.test(e)) {
          setAviso('Fora da janela de 24h. O WhatsApp só deixa enviar texto livre depois que a cliente responder. Até lá, só dá pra usar template (1º/2º envio).');
        } else {
          setAviso(e || 'Não consegui enviar.');
        }
      }
      await carregar();
    } catch { setAviso('Falha de conexão ao enviar.'); } finally { setBusy(false); }
  }
  const aprovar = (txt) => { if (bloqueado) return; setEditando(false); return post('/api/meluni-whats-aprovar', { id: sug.id, acao: 'aprovar', texto: txt || null, operador: 'atendente' }); };
  const descartar = () => { if (bloqueado) return; return post('/api/meluni-whats-aprovar', { id: sug.id, acao: 'descartar', operador: 'atendente' }); };
  const enviarManual = () => {
    if (bloqueado) return;
    const t = rascunho.trim(); if (!t) return;
    const body = conv?.id ? { conversa_id: conv.id, texto: t } : { telefone, texto: t };
    setRascunho('');
    return post('/api/meluni-whats-enviar', { ...body, operador: 'atendente' });
  };
  const gerarSugestao = async () => {
    if (!conv?.id || gerando || bloqueado) return;
    setGerando(true); setAviso('');
    try {
      const r = await fetch('/api/meluni-whats-sugerir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversa_id: conv.id }) });
      const j = await r.json().catch(() => ({}));
      if (!j.ok || (j.motivo && j.motivo !== 'sugestao_criada')) {
        setAviso(j.motivo === 'sem_mensagens' ? 'Ainda não há histórico pra Lara escrever.' : j.motivo === 'claude_falhou' ? 'A IA não respondeu agora, tenta de novo.' : (j.erro || 'Não consegui gerar a mensagem agora.'));
      }
      await carregar();
    } catch { setAviso('Falha ao gerar a mensagem.'); } finally { setGerando(false); }
  };
  const enviarImagem = async (file) => {
    if (!file || !conv?.id || anexando || bloqueado) return;
    setAnexando(true); setAviso('');
    try {
      let payload;
      try { payload = await fileToBase64Scaled(file); }
      catch {
        const raw = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',').pop()); fr.onerror = rej; fr.readAsDataURL(file); });
        payload = { base64: raw, mime: file.type || 'image/jpeg' };
      }
      const r = await fetch('/api/meluni-whats-midia-enviar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversa_id: conv.id, caption: rascunho.trim(), operador: 'atendente', ...payload }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) { setRascunho(''); }
      else {
        const e = String(j.erro || '');
        setAviso(/24|janela|reengag|131047|outside|escrito antes|nao encontrada/i.test(e)
          ? 'Fora da janela de 24h. Só dá pra anexar depois que a cliente responder.'
          : (e || 'Não consegui enviar a imagem.'));
      }
      await carregar();
    } catch { setAviso('Falha ao enviar a imagem.'); } finally { setAnexando(false); }
  };

  return (
    <div style={{ borderTop: `1px solid ${palette.beige}`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 700, color: palette.inkSoft, textTransform: 'uppercase', letterSpacing: 0.3, display: 'flex', alignItems: 'center', gap: 6 }}>
        <MessageCircle size={13} color={MELUNI} /> Conversa (Lara · WhatsApp)
        {bloqueado && (
          <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, fontSize: 11, fontWeight: 700, color: '#8a5a00', background: '#fff4dd', border: '1px solid #f0d8a0', borderRadius: 6, padding: '2px 8px' }}>
            🔒 {lockPor} está respondendo
          </span>
        )}
      </div>

      {/* histórico */}
      <div style={{ padding: '4px 14px 10px', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 430, overflowY: 'auto' }}>
        {loading && <div style={{ fontSize: 12, color: palette.inkMuted }}>carregando…</div>}
        {!loading && msgs.length === 0 && (
          <div style={{ fontSize: 12, color: palette.inkMuted, padding: '6px 0' }}>
            Ainda sem conversa. Quando {nome ? nome.split(' ')[0] : 'a cliente'} escrever pro WhatsApp da Lara, as mensagens aparecem aqui.
          </div>
        )}
        {msgs.map(m => {
          const entrada = m.direcao === 'entrada';
          return (
            <div key={m.id} style={{ alignSelf: entrada ? 'flex-start' : 'flex-end', maxWidth: '80%' }}>
              <div style={{ background: entrada ? palette.surface : MELUNI_SOFT, border: `1px solid ${entrada ? palette.beige : 'transparent'}`, color: palette.ink, borderRadius: 10, padding: '6px 10px', fontSize: 12.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {m.tipo_midia === 'image' && m.midia_url && m.midia_url.startsWith('http') ? (
                  <>
                    <a href={m.midia_url} target="_blank" rel="noopener noreferrer" title="abrir imagem em tamanho original">
                      <img src={m.midia_url} alt="foto" style={{ maxWidth: 200, maxHeight: 240, borderRadius: 8, display: 'block', objectFit: 'contain', cursor: 'zoom-in', background: '#fff' }} />
                    </a>
                    {m.texto && m.texto !== '[image]' ? <div style={{ marginTop: 4 }}>{m.texto}</div> : null}
                  </>
                ) : m.tipo_midia === 'audio' && m.midia_url && m.midia_url.startsWith('http') ? (
                  <>
                    <audio controls src={m.midia_url} style={{ maxWidth: 210, display: 'block' }} />
                    {m.texto && m.texto !== '[áudio]' ? <div style={{ marginTop: 4, fontStyle: 'italic', color: palette.inkSoft }}>{m.texto}</div> : null}
                  </>
                ) : (
                  m.texto || (m.tipo_midia && m.tipo_midia !== 'text' ? `[${m.tipo_midia}]` : '')
                )}
              </div>
              <div style={{ fontSize: 9.5, color: palette.inkMuted, textAlign: entrada ? 'left' : 'right', marginTop: 1 }}>{fmtDH(m.enviada_em)}{!entrada && m.autor && m.autor !== 'lara_auto' ? ` · ${m.autor}` : ''}</div>
            </div>
          );
        })}
        <div ref={fimRef} />
      </div>

      {/* sugestão pendente da Lara */}
      {sug && (
        <div style={{ margin: '0 14px 10px', border: `1px solid ${MELUNI}`, borderRadius: 10, padding: 10, background: MELUNI_SOFT, opacity: bloqueado ? 0.55 : 1, pointerEvents: bloqueado ? 'none' : 'auto' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: MELUNI, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>sugestão da Lara</div>
          {editando ? (
            <textarea value={sugTexto} onChange={e => setSugTexto(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13, lineHeight: 1.45, minHeight: 120, maxHeight: '42vh', overflowY: 'auto', resize: 'vertical' }} />
          ) : (
            <div style={{ fontSize: 12.5, color: palette.ink, whiteSpace: 'pre-wrap', marginBottom: 8 }}>{sug.texto}</div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {editando ? (
              <>
                <button disabled={busy} onClick={() => aprovar(sugTexto)} style={fbtn(VERDE_ENVIAR, '#fff')}>enviar editado</button>
                <button disabled={busy} onClick={() => setEditando(false)} style={fbtn(palette.surface, palette.inkSoft, palette.beige)}>cancelar</button>
              </>
            ) : (
              <>
                <button disabled={busy} onClick={() => aprovar()} style={fbtn(VERDE_ENVIAR, '#fff')}>aprovar e enviar</button>
                <button disabled={busy} onClick={() => { setSugTexto(sug.texto); setEditando(true); }} style={fbtn(palette.surface, MELUNI, palette.beige)}>editar</button>
                <button disabled={busy} onClick={descartar} style={fbtn(palette.surface, palette.alert, '#f4c7c7')}>descartar</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* envio manual */}
      {aviso && (
        <div style={{ margin: '0 14px 8px', fontSize: 11.5, fontWeight: 600, color: '#b4453a', background: '#fdecea', border: '1px solid #f1c9c4', borderRadius: 8, padding: '6px 10px' }}>{aviso}</div>
      )}
      {conv && !janelaAberta && !bloqueado && (
        <div style={{ margin: '0 14px 6px', fontSize: 11, color: palette.inkMuted, fontStyle: 'italic' }}>
          Janela de 24h fechada — só dá pra enviar texto livre depois que {nome ? nome.split(' ')[0] : 'a cliente'} responder. Antes disso, use template.
        </div>
      )}
      {emojiAberto && (
        <div style={{ margin: '0 14px 6px', padding: '8px 10px', background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {EMOJIS_CHAT.map(e => (
            <button key={e} onClick={() => { setRascunho(r => r + e); if (aviso) setAviso(''); }}
              style={{ fontSize: 20, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 6 }}>{e}</button>
          ))}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) enviarImagem(f); }} />
      <div style={{ display: 'flex', gap: 6, padding: '0 14px 12px', alignItems: 'flex-end' }}>
        <button onClick={gerarSugestao} disabled={!conv || gerando || bloqueado}
          title="pedir pra Lara gerar uma mensagem"
          style={{ ...fbtn(palette.surface, MELUNI, palette.beige), padding: '8px 10px', opacity: (conv && !gerando && !bloqueado) ? 1 : 0.5 }}>
          <Bot size={16} />
        </button>
        <button onClick={() => fileRef.current?.click()} disabled={!conv || busy || bloqueado || !janelaAberta || anexando || ehEmail}
          title={ehEmail ? 'anexo de saída no e-mail em breve' : 'anexar foto da fototeca/arquivos'}
          style={{ ...fbtn(palette.surface, MELUNI, palette.beige), padding: '8px 10px', opacity: (conv && janelaAberta && !bloqueado && !anexando && !ehEmail) ? 1 : 0.5 }}>
          <Paperclip size={16} />
        </button>
        <button onClick={() => setEmojiAberto(v => !v)} disabled={bloqueado}
          title="emojis"
          style={{ ...fbtn(emojiAberto ? MELUNI_SOFT : palette.surface, MELUNI, palette.beige), padding: '8px 10px' }}>
          <Smile size={16} />
        </button>
        <textarea value={rascunho} onChange={e => { setRascunho(e.target.value); if (aviso) setAviso(''); }} rows={1}
          placeholder={bloqueado ? `${lockPor} está respondendo…` : !conv ? 'cliente precisa escrever primeiro' : !janelaAberta ? 'fora da janela de 24h — só template' : anexando ? 'enviando imagem…' : 'escrever pra cliente…'}
          disabled={!conv || busy || bloqueado || !janelaAberta || anexando}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarManual(); } }}
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 12.5, resize: 'none', opacity: (conv && janelaAberta && !bloqueado) ? 1 : 0.6 }} />
        <button disabled={!conv || busy || bloqueado || !janelaAberta || !rascunho.trim()} onClick={enviarManual} style={fbtn(VERDE_ENVIAR, '#fff')}>enviar</button>
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
    <div style={{ flex: '0 0 560px', maxWidth: 560, alignSelf: 'flex-start', position: 'sticky', top: 8, maxHeight: 'calc(100vh - 70px)', background: palette.bg, border: `1px solid ${palette.beige}`, borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
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
  const [histAberto, setHistAberto] = useState(false);
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
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${palette.beige}` }}>
        <button onClick={() => setHistAberto(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontFamily: FONT }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: palette.inkSoft, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {histAberto ? '▾' : '▸'} Histórico de compras {pedidos.length > 0 ? `(${pedidos.length})` : ''}
          </span>
        </button>
        {histAberto && (
          <div style={{ marginTop: 10 }}>
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
          </div>
        )}
      </div>
      <LaraThread telefone={cliente.whatsapp || cliente.telefone} nome={cliente.nome} />
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
  const [unread, setUnread] = useState({});
  const [disparando, setDisparando] = useState(false);
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
      if (j.ok) { setClientes(j.clientes || []); setUnread(j.unread || {}); } else setErro(j.erro || 'erro ao carregar');
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

  const dispararSel = async () => {
    const ids = Array.from(sel);
    if (!ids.length || disparando) return;
    const aviso = ids.length > 30
      ? `Você selecionou ${ids.length}. Vão sair os primeiros 30 agora (repita pra continuar). Disparar a mensagem pós-compra da Lara?`
      : `Disparar a mensagem pós-compra da Lara pra ${ids.length} cliente(s)? Envia agora no WhatsApp.`;
    if (!window.confirm(aviso)) return;
    setDisparando(true);
    try {
      const r = await fetch('/api/meluni-clientes-disparo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const j = await r.json();
      if (j.ok) {
        alert(`Enviados: ${j.enviados} · Pulados: ${j.pulados}${j.erros ? ` · Erros: ${j.erros}` : ''}`);
        setSel(new Set());
        carregar();
      } else { alert('Falhou: ' + (j.erro || 'erro')); }
    } catch (e) { alert('Erro: ' + (e?.message || e)); }
    setDisparando(false);
  };

  const tabs = [
    { id: 'carteira', label: 'Carteira', unread: unread.carteira },
    { id: 'enviados', label: 'Enviados', unread: unread.enviados },
    { id: 'conversando', label: 'Conversando', unread: unread.conversando },
    { id: 'follow_up', label: 'Follow up', unread: unread.follow_up },
    { id: 'conversao', label: 'Conversão', unread: unread.conversao },
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
        {sel.size > 0 && (
          <button onClick={dispararSel} disabled={disparando}
            style={{ ...selStyle, fontWeight: 700, background: MELUNI, color: '#fff', border: 'none', cursor: disparando ? 'default' : 'pointer', opacity: disparando ? 0.6 : 1 }}>
            {disparando ? 'enviando…' : `Gerar e disparar (${sel.size})`}
          </button>
        )}
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
// relógio do funil: tempo restante até a próxima transição automática (Sprint 2).
function relogioCarrinho(c) {
  const map = { enviada: ['enviado_em', 24, '2º envio'], segundo_envio: ['segundo_envio_em', 48, 'perdidos'], conversando: ['ultima_interacao_em', 72, 'perdidos'] };
  const cfg = map[c?.status]; if (!cfg) return null;
  // o cronômetro que aponta pra "perdidos" é controle interno — não mostra na UI.
  if (cfg[2] === 'perdidos') return null;
  const base = c[cfg[0]] || c.enviado_em; if (!base) return null;
  const rest = new Date(base).getTime() + cfg[1] * 3600e3 - Date.now();
  if (rest <= 0) return { texto: `vencido → ${cfg[2]}`, urgente: true };
  const h = Math.floor(rest / 3600e3);
  const txt = h >= 24 ? `${Math.floor(h / 24)}d${h % 24 ? ' ' + (h % 24) + 'h' : ''}` : `${h}h`;
  return { texto: `${txt} → ${cfg[2]}`, urgente: h < 6 };
}
function RelogioBadge({ c }) {
  const r = relogioCarrinho(c); if (!r) return null;
  return (
    <span style={{ fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 5, whiteSpace: 'nowrap',
      background: r.urgente ? '#fdecea' : '#fff4dd', color: r.urgente ? '#b4453a' : '#8a5a00', border: `1px solid ${r.urgente ? '#f1c9c4' : '#f0d8a0'}` }}>
      🕒 {r.texto}
    </span>
  );
}

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
          <div style={{ fontSize: 11, color: palette.inkMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{itens.reduce((a, i) => a + (i.qtd || 1), 0)} itens · {fmtData(String(c.data_carrinho || '').slice(0, 10))}</span>
            <RelogioBadge c={c} />
          </div>
        </div>
        {c.conversa_pendente && <DotConversa />}
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
            {c.conversa_pendente && <PillConversa />}
            {c.is_cliente && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, background: MELUNI_SOFT, color: MELUNI, fontWeight: 700 }}>já é cliente</span>}
          </div>
          <div style={{ fontSize: 12, color: palette.inkMuted, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span><Phone size={11} style={{ verticalAlign: 'middle' }} /> {fmtTel(tel)}</span>
            {!tel && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: '#fdecea', color: '#b4453a', border: '1px solid #f1c9c4' }}>📵 sem número</span>}
            <CampoKPI label="itens" valor={String(itens.reduce((a, i) => a + (i.qtd || 1), 0))} />
            <span>{fmtData(String(c.data_carrinho || '').slice(0, 10))}</span>
            <RelogioBadge c={c} />
          </div>
          {itens.length > 0 && (
            <div style={{ fontSize: 11, color: palette.inkMuted, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {itens.map(i => `${i.qtd}x ${i.ref ? 'ref ' + i.ref : (i.sku || '')}`).join('  ·  ')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// corpo do chat de CARRINHO: contato + itens do carrinho + nota da Lara
function ChatCarrinhoBody({ c, onMoved }) {
  const itens = Array.isArray(c.itens) ? c.itens : [];
  const [movendo, setMovendo] = useState(false);
  const [carAberto, setCarAberto] = useState(false);
  const DESTINOS = [
    { v: 'follow_up', l: 'Follow up' }, { v: 'conversando', l: 'Conversando' },
    { v: 'conversao', l: 'Conversão' }, { v: 'perdida', l: 'Perdidos' },
    { v: 'enviada', l: 'Enviadas' }, { v: 'processando', l: 'Processando' },
  ].filter(d => d.v !== c.status);
  const mover = async (status) => {
    if (!status || movendo) return;
    setMovendo(true);
    try {
      await fetch('/api/meluni-carrinho-mover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, status }) });
      onMoved?.();
    } catch { /* */ }
    setMovendo(false);
  };
  return (
    <>
      <div style={{ display: 'flex', gap: 14, padding: '10px 16px', borderBottom: `1px solid ${palette.beige}`, fontSize: 12, color: palette.inkSoft, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>valor <b>{fmtBRL(c.valor)}</b></span>
        <span>itens <b>{itens.reduce((a, i) => a + (i.qtd || 1), 0)}</b></span>
        <span>data <b>{fmtData(String(c.data_carrinho || '').slice(0, 10))}</b></span>
        {c.is_cliente && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 5, background: MELUNI_SOFT, color: MELUNI, fontWeight: 700 }}>já é cliente</span>}
        <RelogioBadge c={c} />
        <select value="" disabled={movendo} onChange={(e) => mover(e.target.value)}
          title="mover este carrinho de etapa"
          style={{ marginLeft: 'auto', fontFamily: FONT, fontSize: 12, fontWeight: 700, color: MELUNI, background: '#fff', border: `1px solid ${MELUNI}`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>
          <option value="" disabled>{movendo ? 'movendo…' : 'mover pra ▾'}</option>
          {DESTINOS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
        </select>
      </div>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${palette.beige}` }}>
        <button onClick={() => setCarAberto(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'none', border: 'none', padding: 0, fontFamily: FONT }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: palette.inkSoft, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {carAberto ? '▾' : '▸'} Carrinho · {itens.length} {itens.length === 1 ? 'item' : 'itens'}
          </span>
        </button>
        {carAberto && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {itens.length === 0 && <div style={{ fontSize: 13, color: palette.inkMuted }}>Sem itens detalhados.</div>}
            {itens.map((i, k) => (
              <div key={k} style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '6px 10px', fontSize: 12, color: palette.ink }}>
                {i.qtd}x {i.ref ? <b>ref {i.ref}</b> : (i.sku || '')}{i.descricao ? ` · ${i.descricao}` : (i.descLimpa ? ` · ${i.descLimpa}` : '')}
              </div>
            ))}
          </div>
        )}
      </div>
      <LaraThread telefone={c.telefone || c.whatsapp} nome={c.nome} />
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
  const [unread, setUnread] = useState({});
  const [dias, setDias] = useState(30); // só últimos 30 dias por padrão (0 = todos)
  const [disparando, setDisparando] = useState(false);
  const [dispMsg, setDispMsg] = useState('');
  const isDesktop = useIsDesktop();
  const LIM = 60;
  const tabs = [
    { id: 'processando', label: 'Processando', unread: unread.processando,
      help: 'Aqui ficam os carrinhos que a cliente montou no site mas não finalizou, e que ainda não receberam nenhuma mensagem nossa.\n\nPra agir: selecione os que quiser e clique em "Gerar mensagem e disparar". A Lara monta o texto e envia pra cliente na hora, e o carrinho passa pra Enviadas.\n\nDica: comece com poucos por vez, porque o número da Lara ainda está ganhando confiança no WhatsApp.' },
    { id: 'enviada', label: 'Enviadas', unread: unread.enviada,
      help: 'São as clientes que já receberam a primeira mensagem da Lara sobre o carrinho. Agora a gente dá 24 horas pra ela reagir (é o relógio no card).\n\nSe ela responder, vai sozinha pra Conversando. Se comprar, vai pra Conversão. Se passar as 24 horas sem responder e sem comprar, a Lara manda sozinha uma segunda mensagem com desconto e o carrinho vai pra 2º envio.\n\nAqui vocês não precisam fazer nada, é só acompanhar.' },
    { id: 'segundo_envio', label: '2º envio', unread: unread.segundo_envio,
      help: 'Aqui estão as clientes que não responderam à primeira mensagem e receberam um segundo empurrãozinho: uma oferta de até 20% (o cupom de primeira compra somado ao desconto que o próprio carrinho libera pelo valor).\n\nAgora o relógio é de 48 horas. Se responder, vai pra Conversando. Se comprar, pra Conversão. Se passar as 48 horas sem nada, vai pra Perdidos. Tudo automático.' },
    { id: 'conversando', label: 'Conversando', unread: unread.conversando,
      help: 'São as clientes que responderam a Lara. Aqui é a hora do atendimento de verdade: tirar dúvida, ajudar a escolher, fechar a venda, tudo pela própria conversa.\n\nSe a cliente comprar, o carrinho vai pra Conversão. Se ela ficar 3 dias sem dar nenhum retorno, vai pra Perdidos. Então vale dar atenção pra não esfriar.' },
    { id: 'conversao', label: 'Conversão', unread: unread.conversao,
      help: 'Essas são as vitórias: clientes que compraram depois do nosso contato.\n\nO sistema reconhece a compra sozinho, cruzando o telefone, o e-mail, o nome ou o cadastro da cliente com as vendas feitas a partir do dia do envio.\n\nÉ a etapa final boa. Não precisa fazer nada, é só comemorar.' },
    { id: 'follow_up', label: 'Follow up', unread: unread.follow_up,
      help: 'Esta aba é manual: o carrinho só chega aqui quando vocês movem ele de propósito (pelo botão "mover pra" dentro do carrinho).\n\nServe pra separar as clientes que vocês querem acompanhar com calma, do jeito de vocês. Eles ficam parados aqui até vocês decidirem o que fazer, não saem sozinhos.' },
    { id: 'perdida', label: 'Perdidos', unread: unread.perdida,
      help: 'São os carrinhos que passaram do prazo sem a cliente responder nem comprar.\n\nMas não é o fim: se a cliente voltar a mandar mensagem, o carrinho reabre sozinho e volta pra Conversando. E vocês também podem reabrir na mão, movendo ele de volta, se quiserem retomar.' },
  ];
  const carregar = useCallback(async (off = 0) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/meluni-carrinhos-list?status=${aba}&limite=${LIM}&offset=${off}&dias=${dias}`);
      const j = await r.json();
      if (j.ok) { setTotal(j.total || 0); setUnread(j.unread || {}); setCarrinhos(prev => off ? [...prev, ...j.carrinhos] : j.carrinhos); }
    } catch (e) { /* ignora */ }
    setLoading(false);
  }, [aba, dias]);
  useEffect(() => { setSel(new Set()); setChatId(null); carregar(0); }, [carregar]);
  const toggleSel = (id) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selTodos = () => setSel(sel.size === carrinhos.length ? new Set() : new Set(carrinhos.map(c => c.id)));

  const dispararSel = async () => {
    if (disparando || !sel.size) return;
    setDisparando(true); setDispMsg('');
    try {
      const r = await fetch('/api/meluni-whats-carrinho-disparo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...sel] }),
      });
      const j = await r.json();
      if (j.ok) {
        setDispMsg(`✓ ${j.enviados} enviado(s)${j.pulados ? ` · ${j.pulados} pulado(s)` : ''}${j.erros ? ` · ${j.erros} erro(s)` : ''}`);
        setSel(new Set()); carregar(0);
      } else { setDispMsg(j.erro || 'falhou'); }
    } catch { setDispMsg('falhou'); }
    setDisparando(false);
    setTimeout(() => setDispMsg(''), 8000);
  };

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
        <button onClick={() => setDias(d => d > 0 ? 0 : 30)} title="alterna entre últimos 30 dias e todos os períodos"
          style={{ ...selStyle, fontWeight: 700, color: dias > 0 ? MELUNI : palette.inkMuted, borderColor: dias > 0 ? MELUNI : palette.beige }}>
          {dias > 0 ? '🕒 últimos 30 dias' : 'todos os períodos'}
        </button>
        <span style={{ fontSize: 12, color: palette.inkMuted, fontFamily: FONT }}>
          {loading ? 'carregando…' : `${total} no funil`}{sel.size > 0 ? ` · ${sel.size} selecionados` : ''}
        </span>
        {aba === 'processando' && sel.size > 0 && (
          <button onClick={dispararSel} disabled={disparando}
            style={{ ...fbtn(VERDE_ENVIAR, '#fff'), opacity: disparando ? 0.7 : 1 }}>
            {disparando ? 'disparando…' : `Gerar mensagem e disparar (${sel.size})`}
          </button>
        )}
        {dispMsg && <span style={{ fontSize: 11.5, fontWeight: 600, color: palette.inkSoft, fontFamily: FONT }}>{dispMsg}</span>}
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
          renderChat={(c) => <ChatCarrinhoBody c={c} onMoved={() => { setChatId(null); carregar(0); }} />}
          listaRodape={carregarMais}
        />
      )}
    </div>
  );
}

// ─── SEÇÃO: SAC ─────────────────────────────────────────────────────────────
function SecaoSac() {
  const [aba, setAba] = useState('conversando');
  const [conversas, setConversas] = useState([]);
  const [cont, setCont] = useState({});
  const [loading, setLoading] = useState(true);
  const [chatId, setChatId] = useState(null);
  const isDesktop = useIsDesktop();

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/meluni-whats-sac-list?aba=${aba}`);
      const j = await r.json();
      if (j.ok) { setConversas(j.conversas || []); setCont(j.contadores || {}); }
    } catch { /* ignora */ } finally { setLoading(false); }
  }, [aba]);
  useEffect(() => { setChatId(null); carregar(); const t = setInterval(carregar, 15000); return () => clearInterval(t); }, [carregar]);

  const tabs = [
    { id: 'conversando', label: 'Conversando', unread: cont.conversando },
    { id: 'follow_up', label: 'Follow up', unread: cont.follow_up },
    { id: 'arquivo', label: 'Arquivo', unread: cont.arquivo },
  ];
  return (
    <div>
      <SubTabs tabs={tabs} active={aba} onChange={setAba} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: palette.inkMuted, fontFamily: FONT }}>Canais:</span>
        <Tag cor={MELUNI} bg={MELUNI_SOFT}><Phone size={11} /> whatsapp</Tag>
        <Tag cor={MELUNI} bg={MELUNI_SOFT}><Instagram size={11} /> direct insta</Tag>
        <Tag cor={MELUNI} bg={MELUNI_SOFT}><Mail size={11} /> e-mail</Tag>
      </div>
      {loading && conversas.length === 0 && <Placeholder>carregando…</Placeholder>}
      {!loading && conversas.length === 0 && <Placeholder>Nenhuma conversa nessa aba ainda. Entra aqui quando a cliente escrever pro WhatsApp da Lara (ou pelo Direct).</Placeholder>}
      {conversas.length > 0 && (
        <MeluniSplitChat
          itens={conversas} getId={(c) => c.id}
          abertoId={chatId} setAbertoId={setChatId} isDesktop={isDesktop}
          tituloDe={(c) => c.nome_cliente || fmtTel(c.telefone) || (c.canal === 'email' ? c.externo_id : '') || (c.canal === 'direct_insta' ? 'Cliente do Direct' : 'Cliente')}
          subtituloDe={(c) => (c.canal === 'email' ? (c.externo_id || 'e-mail') : c.canal === 'direct_insta' ? 'Direct Insta' : (fmtTel(c.telefone) || 'whatsapp'))}
          renderCard={(c, p) => <SacConversaCard c={c} onChanged={carregar} aba={aba} {...p} />}
          renderChat={(c) => <LaraThread conversaId={c.id} nome={c.nome_cliente} />}
        />
      )}
    </div>
  );
}

// card de conversa no inbox SAC (lista)
function SacConversaCard({ c, compact, ativo, onAbrir, onChanged, aba }) {
  const Icone = c.canal === 'email' ? Mail : c.canal === 'direct_insta' ? Instagram : Phone;
  const [busy, setBusy] = useState(false);
  const acao = async (body) => {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/meluni-conversa-acao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, ...body }),
      });
      onChanged?.();
    } catch { /* */ }
    setBusy(false);
  };
  const DESTINOS = [
    { v: 'conversando', l: 'Conversando' }, { v: 'follow_up', l: 'Follow up' }, { v: 'arquivo', l: 'Arquivo' },
  ].filter(d => d.v !== aba);
  const nome = c.nome_cliente || fmtTel(c.telefone) || (c.canal === 'email' ? c.externo_id : '') || (c.canal === 'direct_insta' ? 'Cliente do Direct' : 'Cliente');
  return (
    <div onClick={onAbrir} title="Abrir conversa" style={{
      background: ativo ? MELUNI_SOFT : palette.surface, borderRadius: compact ? 10 : 12,
      padding: compact ? '8px 10px' : 12, cursor: 'pointer',
      border: `1px solid ${ativo ? MELUNI : palette.beige}`, display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <button onClick={(e) => { e.stopPropagation(); acao({ prioridade: !c.prioridade }); }}
        disabled={busy} title={c.prioridade ? 'tirar prioridade' : 'marcar como prioridade'}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, lineHeight: 1, fontSize: compact ? 15 : 17, color: c.prioridade ? '#e6b800' : palette.beige }}>
        {c.prioridade ? '★' : '☆'}
      </button>
      <Icone size={compact ? 13 : 15} color={MELUNI} style={{ flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: compact ? 13 : 14, fontWeight: ativo ? 700 : 600, color: palette.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {nome}
        </div>
        <div style={{ fontSize: 11, color: palette.inkMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.preview || '—'}</div>
      </div>
      {c.unread && <DotConversa />}
      <select value="" disabled={busy} onClick={(e) => e.stopPropagation()}
        onChange={(e) => { const v = e.target.value; e.target.value = ''; if (v) acao({ mover: v }); }}
        title="mover de etapa"
        style={{ flexShrink: 0, fontFamily: FONT, fontSize: 11, fontWeight: 700, color: MELUNI, background: '#fff', border: `1px solid ${MELUNI}`, borderRadius: 6, padding: '2px 4px', cursor: 'pointer' }}>
        <option value="">⋯</option>
        {DESTINOS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
      </select>
    </div>
  );
}

// ─── SEÇÃO: DEVOLUÇÃO (por peça, fluxo completo) ────────────────────────────

// rótulo + cor de cada estado do fluxo (aprovada fica discreta)
const DEVOL_FLUXO = {
  em_analise:          { label: 'em análise',          cor: palette.inkSoft },
  aprovada:            { label: 'aprovada',            cor: palette.inkSoft },
  aguardando_postagem: { label: 'aguardando postagem', cor: palette.inkSoft },
  aguardando_conferir: { label: 'conferir',            cor: palette.warn },
  aguardando_estorno:  { label: 'estornar',            cor: palette.warn },
  completa:            { label: 'completa',            cor: palette.ok },
  cancelada:           { label: 'cancelada',           cor: palette.alert },
};

// SLA por etapa ATIVA. Regra geral: amarelo a partir de 1d de atraso, vermelho com mais de 1d.
// Exceção etiqueta enviada -> devolução chegar: 7d normal, 7–10 amarelo, acima de 10 vermelho.
const AMBAR = '#e6a23c';

function slaDevol(d) {
  let base, alerta, critico, rotulo;
  switch (d.fluxo_status) {
    case 'aprovada':            base = d.fluxo_desde;                          alerta = 1;  critico = 2;  rotulo = 'etiqueta';  break;
    case 'aguardando_postagem': base = d.etiqueta_avisado_em || d.fluxo_desde; alerta = 7;  critico = 11; rotulo = 'a chegar'; break;
    case 'aguardando_conferir': base = d.recebido_efetivo || d.fluxo_desde;    alerta = 1;  critico = 2;  rotulo = 'conferir';  break;
    case 'aguardando_estorno':  base = d.conferido_em || d.fluxo_desde;        alerta = 1;  critico = 2;  rotulo = 'pagamento'; break;
    case 'completa':
      if (d.estornado_em && !d.cliente_avisado_em) { base = d.estornado_em; alerta = 1; critico = 2; rotulo = 'avisar'; break; }
      return null;
    default: return null;
  }
  const dias = diasDesde(base);
  let cor = palette.ok, nivel = 'ok';
  if (dias >= critico)     { cor = palette.alert; nivel = 'critico'; }
  else if (dias >= alerta) { cor = AMBAR;         nivel = 'alerta'; }
  return { dias, cor, nivel, txt: `${rotulo} · ${dias <= 0 ? 'hoje' : dias + 'd'}` };
}

const fmtTam = (t) => t ? String(t).replace(/tamanho\s*:?\s*/i, '') : '';

// ─── LINHA DO TEMPO — fluxo real da devolução Meluni (6 etapas) ──────────────
// Aprovada (o import só traz aprovadas) → Etiqueta enviada → Recebida e conferida
// (as duas contam como uma) → Aguardando pagamento → Estorno pago → Mensagem
// enviada (confirma o estorno).
const DEVOL_STEPS = [
  { id: 'aprovada',  label: 'Aprovada',              curto: 'aprovada',  Icon: ThumbsUp },
  { id: 'etiqueta',  label: 'Etiqueta\nenviada',     curto: 'etiqueta',  Icon: IconTag },
  { id: 'recebida',  label: 'Recebida e\nconferida', curto: 'conferir',  Icon: PackageCheck },
  { id: 'pagamento', label: 'Aguardando\npagamento', curto: 'pagamento', Icon: Clock },
  { id: 'estorno',   label: 'Estorno\npago',         curto: 'estorno',   Icon: DollarSign },
  { id: 'avisada',   label: 'Mensagem\nenviada',     curto: 'avisar',    Icon: Send },
];
// índice da etapa ATIVA (as anteriores ficam concluídas). >=6 = tudo concluído. -2 = cancelada.
function stepDevol(d) {
  switch (d?.fluxo_status) {
    case 'cancelada':           return -2;
    case 'em_analise':          return 0;  // ainda não aprovada (raro; import já traz aprovada)
    case 'aprovada':            return 1;  // aprovada ok, falta avisar a etiqueta
    case 'aguardando_postagem': return 2;  // etiqueta enviada, aguardando chegar/conferir
    case 'aguardando_conferir': return 2;  // chegou, falta conferir (mesma etapa)
    case 'aguardando_estorno':  return 3;  // conferida, aguardando pagamento
    case 'completa':            return (d.estornado_em && !d.cliente_avisado_em) ? 5 : 6;
    default:                    return 1;
  }
}
// rótulo curto da etapa ativa (pills dos cards)
function devolStepInfo(d) {
  const i = stepDevol(d);
  if (i === -2) return { i, curto: 'cancelada', label: 'cancelada' };
  if (i >= DEVOL_STEPS.length) return { i, curto: 'concluída', label: 'Concluída' };
  return { i, curto: DEVOL_STEPS[i].curto, label: DEVOL_STEPS[i].label };
}

// "Cor : MARROM ESCURO;\r\nTamanho : G" -> { cor:'Marrom escuro', tam:'G' }
function parseCorTam(s) {
  if (!s) return { cor: '', tam: '' };
  const str = String(s);
  const pega = (re) => { const r = str.match(re); return r ? r[1].replace(/[;\r\n]+/g, ' ').trim() : ''; };
  let cor = pega(/cor\s*:?\s*([^;\r\n]+)/i);
  let tam = pega(/tamanho\s*:?\s*([^;\r\n]+)/i);
  if (cor) cor = cor.charAt(0).toUpperCase() + cor.slice(1).toLowerCase();
  if (!cor && !tam) tam = str.replace(/[;\r\n]+/g, ' ').trim();
  return { cor, tam };
}

// timeline horizontal conectada. size: 'mini' (card, compacta) | 'full' (chat)
function TimelineDevol({ d, size = 'full' }) {
  const full = size === 'full';
  const atual = stepDevol(d);
  const sla = slaDevol(d);
  // etapa ativa acende vermelho/âmbar no atraso; senão é o preto de "em andamento"
  const corAtiva = sla && sla.nivel === 'critico' ? palette.alert
                 : sla && sla.nivel === 'alerta'  ? AMBAR
                 : '#1a1a1a';

  if (d?.fluxo_status === 'cancelada') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 28, height: 28, borderRadius: '50%', background: palette.alert, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <X size={15} color="#fff" />
        </span>
        <span style={{ fontSize: full ? 13 : 12, fontWeight: 700, color: palette.alert }}>Devolução cancelada</span>
      </div>
    );
  }

  const concluida = atual >= DEVOL_STEPS.length;

  // 6 nós conectados com rótulo; etapa ativa acende no atraso.
  // mini (card da lista) = mesma linha, só um pouco menor que o full (chat).
  const D = full ? 36 : 30, IS = full ? 18 : 15, FS = full ? 10.5 : 9.5;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', maxWidth: full ? '100%' : '70%' }}>
      {DEVOL_STEPS.map((s, i) => {
        const feito = concluida || i < atual;
        const ehAtual = !concluida && i === atual;
        const bg = feito ? MELUNI : ehAtual ? corAtiva : palette.surface;
        const bd = feito ? MELUNI : ehAtual ? corAtiva : palette.beige;
        const ic = (feito || ehAtual) ? '#fff' : palette.inkMuted;
        const corLinha = (concluida || i < atual) ? MELUNI : palette.beige;
        return (
          <React.Fragment key={s.id}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: D }}>
              <span style={{ width: D, height: D, borderRadius: '50%', background: bg, border: `1.5px solid ${bd}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <s.Icon size={IS} color={ic} strokeWidth={1.8} />
              </span>
              <span style={{ fontSize: FS, color: (feito || ehAtual) ? palette.ink : palette.inkMuted, textAlign: 'center', marginTop: full ? 6 : 5, lineHeight: 1.15, whiteSpace: 'pre-line', fontWeight: ehAtual ? 700 : 400 }}>{s.label}</span>
              {ehAtual && sla && sla.nivel !== 'ok' && (
                <span style={{ fontSize: full ? 9.5 : 9, fontWeight: 700, color: sla.cor, marginTop: 2 }}>{sla.dias}d atraso</span>
              )}
            </div>
            {i < DEVOL_STEPS.length - 1 && (
              <div style={{ flex: 1, height: 1.5, background: corLinha, marginTop: D / 2 - 0.75, minWidth: full ? 8 : 6 }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function DevolucaoCard({ d, compact, ativo, onAbrir }) {
  const [maisAberto, setMaisAberto] = useState(false);
  const sla = slaDevol(d);
  const apagada = d.fluxo_status === 'completa' || d.fluxo_status === 'cancelada';
  const itens = Array.isArray(d.itens) ? d.itens : [];
  const n = d.n_pecas || itens.length || 1;
  const stepLabel = devolStepInfo(d).curto;
  const it0 = itens[0];
  const resumoItens = n > 1
    ? `${n} peças: ${itens.map(i => String(i?.descricao || i?.produto || '').trim()).filter(Boolean).join(', ')}`
    : [it0?.ref || it0?.sku, String(it0?.descricao || it0?.produto || d.produto || '—').trim()].filter(Boolean).join(' · ');

  if (compact) {
    return (
      <div onClick={onAbrir} title="Abrir" style={{
        background: ativo ? MELUNI_SOFT : palette.surface, borderRadius: 10, padding: '8px 10px', cursor: 'pointer',
        border: `1px solid ${ativo ? MELUNI : palette.beige}`, display: 'flex', alignItems: 'center', gap: 8,
        opacity: apagada && !ativo ? 0.5 : 1,
      }}>
        <RotateCcw size={13} color={MELUNI} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: ativo ? 700 : 600, color: palette.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.nome || '—'}</div>
          <div style={{ fontSize: 11, color: palette.inkMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmtBRL(d.valor)} · {n > 1 ? `${n} peças` : resumoItens}</div>
        </div>
        {d.conversa_pendente && <DotConversa />}
        <span style={{ fontSize: 9.5, padding: '1px 6px', borderRadius: 4, fontWeight: 700, color: d.fluxo_status === 'cancelada' ? palette.alert : (sla && sla.nivel !== 'ok' ? sla.cor : MELUNI), border: `1px solid ${d.fluxo_status === 'cancelada' ? palette.alert : (sla && sla.nivel !== 'ok' ? sla.cor : palette.beige)}`, flexShrink: 0, whiteSpace: 'nowrap' }}>{stepLabel}</span>
      </div>
    );
  }

  return (
    <div onClick={onAbrir} title={onAbrir ? 'Abrir' : undefined} style={{
      background: palette.surface, borderRadius: 12, padding: 12, border: `1px solid ${ativo ? MELUNI : palette.beige}`,
      cursor: onAbrir ? 'pointer' : 'default', opacity: apagada ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <RotateCcw size={15} color={MELUNI} style={{ marginTop: 3, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: palette.ink }}>{d.nome || '—'}</span>
            {n > 1 && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, background: MELUNI_SOFT, color: MELUNI, fontWeight: 700 }}>{n} peças</span>}
            {d.conversa_pendente && <PillConversa />}
            {sla && sla.nivel !== 'ok' && <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 5, fontWeight: 700, color: '#fff', background: sla.cor }}>{sla.txt}</span>}
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 8 }}>
            {/* esquerda: contato + pedido */}
            <div style={{ flex: '1 1 230px', minWidth: 0, fontSize: 12, color: palette.inkMuted, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', alignContent: 'flex-start' }}>
              <span><Phone size={11} style={{ verticalAlign: 'middle' }} /> {fmtTel(d.telefone)}</span>
              <CampoKPI label="valor" valor={fmtBRL(d.valor)} destaque />
              {d.pedido_ref && <span>pedido {d.pedido_ref}</span>}
            </div>
            {/* direita: 1ª peça sempre; demais recolhidas (clica pra expandir no card) */}
            <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {(maisAberto ? itens : itens.slice(0, 1)).map((it, k) => {
                const r = it?.ref || it?.sku;
                const t = String(it?.descricao || it?.produto || '—').trim();
                return (
                  <div key={k} style={{ fontSize: 12, color: palette.inkSoft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r && <span style={{ color: palette.inkMuted, fontWeight: 700 }}>{r}</span>}{r ? ' · ' : ''}{t}
                  </div>
                );
              })}
              {itens.length > 1 && (
                <button onClick={(e) => { e.stopPropagation(); setMaisAberto(v => !v); }}
                  style={{ alignSelf: 'flex-start', fontSize: 11, color: MELUNI, fontWeight: 700, background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: FONT }}>
                  {maisAberto ? '▾ recolher' : `▸ +${itens.length - 1} peça(s)`}
                </button>
              )}
            </div>
          </div>
          {/* linha do tempo (reduzida pra não pegar o card todo) */}
          <TimelineDevol d={d} size="mini" />
        </div>
      </div>
    </div>
  );
}

const fbtn = (bg, fg, bd) => ({
  padding: '8px 12px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
  background: bg, color: fg, border: `1px solid ${bd || bg}`, display: 'inline-flex', alignItems: 'center', gap: 6,
});

// corpo do chat de DEVOLUÇÃO: linha do tempo + ação do passo atual + cancelar/arquivar
function ChatDevolucaoBody({ d, isAdmin, onAcao }) {
  const [valor, setValor] = useState(d.estorno_valor != null ? String(d.estorno_valor) : (d.valor != null ? String(d.valor) : ''));
  const [forma, setForma] = useState(d.estorno_forma || (String(d.tipo || '').toLowerCase().includes('cr') && String(d.tipo || '').toLowerCase().includes('dito') ? 'credito' : 'pix'));
  const [chave, setChave] = useState(d.estorno_pix_chave || '');
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [devAberto, setDevAberto] = useState(false);
  const { lockPor, bloqueado } = useMeluniLock('devolucao', d.id);

  const st = d.fluxo_status;
  const mensagem = d.dados_extra?.mensagem;
  const itens = Array.isArray(d.itens) ? d.itens : [];
  const n = d.n_pecas || itens.length || 1;

  const run = async (acao, payload) => {
    if (bloqueado) return;
    setBusy(true);
    await onAcao(acao, payload);
    setBusy(false);
  };

  return (
    <>
      <div style={{ display: 'flex', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${palette.beige}`, fontSize: 12, color: palette.inkSoft, flexWrap: 'wrap', alignItems: 'center' }}>
        <span>valor total <b>{fmtBRL(d.valor)}</b></span>
        <span>{n > 1 ? <b>{n} peças</b> : '1 peça'}</span>
        {d.pedido_ref && <span>pedido <b>{d.pedido_ref}</b></span>}
      </div>

      {bloqueado && (
        <div style={{ margin: '10px 16px 0', padding: '8px 10px', borderRadius: 8, background: '#fff4dd', border: '1px solid #f0d8a0', color: '#8a5a00', fontSize: 12.5, fontWeight: 700 }}>
          🔒 {lockPor} está atendendo esta devolução — somente leitura até essa pessoa sair.
        </div>
      )}
      <div style={{ padding: 16, opacity: bloqueado ? 0.55 : 1, pointerEvents: bloqueado ? 'none' : 'auto' }}>
        {d.conversa_pendente && (
          <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: '#fdecea', color: palette.alert, fontSize: 12, fontWeight: 600 }}>💬 conversa sem resposta</div>
        )}

        {/* PEÇAS DA DEVOLUÇÃO + motivo (recolhido por padrão) */}
        <button onClick={() => setDevAberto(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'none', border: 'none', padding: 0, marginBottom: devAberto ? 8 : 12, fontFamily: FONT }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: palette.inkSoft, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {devAberto ? '▾' : '▸'} {n > 1 ? `Peças devolvidas (${n})` : 'Peça devolvida'} · motivo
          </span>
        </button>
        {devAberto && (<>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {itens.map((it, k) => {
            const { cor, tam } = parseCorTam(it.tamanho);
            const ref = it.ref || it.sku || '';
            const desc = String(it.descricao || it.produto || '—').replace(/\s{2,}/g, ' ').trim();
            return (
              <div key={k} style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: palette.ink, fontWeight: 600, lineHeight: 1.25 }}>{desc}</div>
                  {(ref || cor || tam) && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      {ref && <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 4, background: palette.bg, color: palette.inkMuted, fontWeight: 700, border: `1px solid ${palette.beige}`, letterSpacing: 0.2 }}>REF {ref}</span>}
                      {cor && <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 4, background: MELUNI_SOFT, color: MELUNI, fontWeight: 600 }}>{cor}</span>}
                      {tam && <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 4, background: palette.bg, color: palette.inkSoft, fontWeight: 700, border: `1px solid ${palette.beige}` }}>{tam}</span>}
                    </div>
                  )}
                </div>
                {it.valor != null && <span style={{ fontSize: 12.5, color: palette.inkSoft, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}>{fmtBRL(it.valor)}</span>}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 12 }}>motivo: {d.motivo || '—'}</div>
        {mensagem && <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 12, fontStyle: 'italic' }}>"{mensagem}"</div>}
        </>)}

        {/* LINHA DO TEMPO (horizontal, conectada) */}
        <div style={{ fontSize: 11, fontWeight: 700, color: palette.inkSoft, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.3 }}>Linha do tempo</div>
        <div style={{ marginBottom: 18, padding: '0 4px' }}>
          <TimelineDevol d={d} size="full" />
        </div>
        {/* detalhes dos carimbos (quem/quando) */}
        {(d.etiqueta_avisado_em || d.recebido_efetivo || d.conferido_em || d.estornado_em || d.cliente_avisado_em) && (
          <div style={{ fontSize: 11, color: palette.inkMuted, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {d.etiqueta_avisado_em && <span>Etiqueta avisada: {fmtDH(d.etiqueta_avisado_em)}{d.etiqueta_avisado_por ? ` · ${d.etiqueta_avisado_por}` : ''}</span>}
            {d.recebido_efetivo && <span>Produto recebido: {fmtDH(d.recebido_efetivo)}</span>}
            {d.conferido_em && <span>Conferida: {fmtDH(d.conferido_em)}{d.conferido_por ? ` · ${d.conferido_por}` : ''}</span>}
            {d.estornado_em && <span>Estorno: {fmtDH(d.estornado_em)} · {fmtBRL(d.estorno_valor)} {d.estorno_forma || ''}{d.estornado_por ? ` · ${d.estornado_por}` : ''}</span>}
            {d.cliente_avisado_em && <span>Cliente avisada: {fmtDH(d.cliente_avisado_em)}{d.cliente_avisado_por ? ` · ${d.cliente_avisado_por}` : ''}</span>}
          </div>
        )}

        {/* AÇÃO DO PASSO ATUAL */}
        {st === 'em_analise' ? (
          <div style={{ padding: '10px 12px', borderRadius: 9, background: palette.surface, border: `1px solid ${palette.beige}`, color: palette.inkSoft, fontSize: 12.5 }}>Em análise no Convertr. A etiqueta é avisada ao cliente quando a devolução for aprovada.</div>
        ) : st === 'cancelada' ? (
          <div style={{ padding: '10px 12px', borderRadius: 9, background: '#fdecea', color: palette.alert, fontSize: 12.5 }}>
            {d.cancelada_em || d.cancelada_por ? (
              <>Cancelada {d.cancelada_por ? `por ${d.cancelada_por}` : ''}{d.cancelada_em ? ` em ${fmtDH(d.cancelada_em)}` : ''}.<br /><b>Motivo:</b> {d.cancelada_motivo || '—'}</>
            ) : 'Cancelada (importada do Convertr).'}
          </div>
        ) : st === 'aprovada' ? (
          <button disabled={busy} onClick={() => run('avisar_etiqueta')} style={fbtn(MELUNI, '#fff')}>
            <MessageCircle size={14} /> avisar cliente da etiqueta
          </button>
        ) : st === 'aguardando_postagem' ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: palette.inkSoft }}>aguardando o cliente postar.</span>
            <button disabled={busy} onClick={() => run('marcar_recebido')} style={fbtn(palette.surface, MELUNI, palette.beige)}>marcar recebido</button>
          </div>
        ) : st === 'aguardando_conferir' ? (
          <button disabled={busy} onClick={() => run('conferir')} style={fbtn(MELUNI, '#fff')}>conferir devolução</button>
        ) : st === 'aguardando_estorno' ? (
          <div style={{ border: `1px solid ${palette.beige}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: palette.inkSoft, marginBottom: 8 }}>Estorno</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: palette.inkMuted }}>valor
                <input value={valor} onChange={e => setValor(e.target.value)} inputMode="decimal"
                  style={{ display: 'block', width: 100, padding: '6px 8px', borderRadius: 7, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13 }} />
              </label>
              <label style={{ fontSize: 11, color: palette.inkMuted }}>forma
                <select value={forma} onChange={e => setForma(e.target.value)}
                  style={{ display: 'block', padding: '6px 8px', borderRadius: 7, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13 }}>
                  <option value="pix">Pix</option>
                  <option value="cartao">Cartão</option>
                  <option value="credito">Crédito</option>
                </select>
              </label>
            </div>
            {forma === 'pix' && (
              <input value={chave} onChange={e => setChave(e.target.value)} placeholder="chave pix"
                style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 7, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13, marginBottom: 8 }} />
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button disabled={busy} onClick={() => run('salvar_estorno', { estorno_valor: valor, estorno_forma: forma, estorno_pix_chave: chave })} style={fbtn(palette.surface, MELUNI, palette.beige)}>salvar</button>
              <button disabled={busy} onClick={() => run('estornar', { estorno_valor: valor, estorno_forma: forma, estorno_pix_chave: chave })} style={fbtn(MELUNI, '#fff')}>
                <DollarSign size={14} /> confirmar estorno (pago)
              </button>
            </div>
            <div style={{ fontSize: 10.5, color: palette.inkMuted, marginTop: 8 }}>a Lara salva o valor e a forma; confirme o estorno depois que o pagamento sair.</div>
          </div>
        ) : st === 'completa' && d.estornado_em && !d.cliente_avisado_em ? (
          <button disabled={busy} onClick={() => run('avisar_estorno')} style={fbtn(palette.ok, '#fff')}>
            <MessageCircle size={14} /> avisar cliente do estorno
          </button>
        ) : st === 'completa' ? (
          <div style={{ padding: '10px 12px', borderRadius: 9, background: '#eafbf0', color: palette.ok, fontSize: 12.5, fontWeight: 600 }}>
            {d.estornado_em ? 'Concluída. Cliente avisada do estorno.' : 'Concluída (importada como Completo do Convertr).'}
          </div>
        ) : null}

        {/* CANCELAR / ARQUIVAR */}
        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {st !== 'cancelada' && st !== 'completa' && (
            <button disabled={busy} onClick={() => setCancelOpen(true)} style={fbtn(palette.surface, palette.alert, palette.beige)}>cancelar devolução</button>
          )}
          {isAdmin && (
            <button disabled={busy} onClick={() => { if (window.confirm('Arquivar? Some de todas as contagens.')) run('arquivar'); }} style={fbtn(palette.surface, palette.inkMuted, palette.beige)}>arquivar</button>
          )}
        </div>
      </div>

      <LaraThread telefone={d.telefone} nome={d.nome} />

      {/* MODAL CANCELAR */}
      {cancelOpen && (
        <div onClick={() => setCancelOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: palette.bg, borderRadius: 12, padding: 16, width: 'min(380px, 100%)', fontFamily: FONT }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: palette.ink, marginBottom: 8 }}>Cancelar devolução</div>
            <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 8 }}>Trava todo o fluxo. Fica registrado.</div>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="motivo do cancelamento" rows={3}
              style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13, marginBottom: 10 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setCancelOpen(false)} style={fbtn(palette.surface, palette.inkSoft, palette.beige)}>voltar</button>
              <button disabled={busy || !motivo.trim()} onClick={async () => { await run('cancelar', { motivo }); setCancelOpen(false); }} style={fbtn(palette.alert, '#fff')}>confirmar cancelamento</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SecaoDevolucao({ userId, isAdmin }) {
  const [etapa, setEtapa] = useState('todas');
  const [devs, setDevs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chatId, setChatId] = useState(null);
  const isDesktop = useIsDesktop();
  const [unread, setUnread] = useState({});
  const tabs = [
    { id: 'todas', label: 'Todas', unread: unread.todas },
    { id: 'aguardando_conferir', label: 'Aguardando conferir', unread: unread.aguardando_conferir },
    { id: 'aguardando_estorno', label: 'Aguardando estorno', unread: unread.aguardando_estorno },
    { id: 'canceladas', label: 'Canceladas', unread: unread.canceladas },
  ];
  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/meluni-devolucoes-list?etapa=${etapa}`);
      const j = await r.json();
      if (j.ok) { setDevs(j.devolucoes || []); setUnread(j.unread || {}); }
    } catch (e) { /* ignora */ }
    setLoading(false);
  }, [etapa]);
  useEffect(() => { carregar(); }, [carregar]);

  const onAcao = useCallback(async (id, acao, payload = {}) => {
    try {
      const r = await fetch('/api/meluni-devolucao-acao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, acao, operador: userId, isAdmin, ...payload }),
      });
      const j = await r.json();
      if (!j.ok) { window.alert(j.erro || 'falhou'); return false; }
      await carregar();
      return true;
    } catch (e) { window.alert(String(e)); return false; }
  }, [userId, isAdmin, carregar]);

  return (
    <div>
      <SubTabs tabs={tabs} active={etapa} onChange={setEtapa} />
      <SectionTitle icon={RotateCcw}>{loading ? 'Devoluções…' : `${devs.length} devolução(ões)`}</SectionTitle>
      {!loading && devs.length === 0 && <Placeholder>Nenhuma devolução nessa aba.</Placeholder>}
      {devs.length > 0 && (
        <MeluniSplitChat
          itens={devs} getId={(d) => d.id}
          abertoId={chatId} setAbertoId={setChatId} isDesktop={isDesktop}
          tituloDe={(d) => d.nome || 'Devolução'}
          subtituloDe={(d) => fmtTel(d.telefone) || 'sem número'}
          renderCard={(d, p) => <DevolucaoCard d={d} {...p} />}
          renderChat={(d) => <ChatDevolucaoBody d={d} isAdmin={isAdmin} onAcao={(acao, payload) => onAcao(d.id, acao, payload)} />}
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

function DashCarrinhoRow({ c }) {
  const itens = Array.isArray(c.itens) ? c.itens : [];
  return (
    <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, color: palette.ink, fontSize: 13 }}>
          <ShoppingCart size={13} color={MELUNI} style={{ verticalAlign: 'middle', marginRight: 5 }} />
          {fmtBRL(c.valor)}{c.nome ? ` · ${c.nome}` : ''}
        </span>
        <span style={{ fontSize: 12, color: palette.inkMuted }}>
          <Phone size={11} style={{ verticalAlign: 'middle' }} /> {fmtTel(c.telefone)} · {fmtData(String(c.data_carrinho || '').slice(0, 10))}
        </span>
      </div>
      {itens.length > 0 && (
        <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 3 }}>
          {itens.map(i => `${i.qtd}x ${i.ref ? 'ref ' + i.ref : (i.sku || '')}`).join('  ·  ')}
        </div>
      )}
    </div>
  );
}

function SecaoDashboard() {
  const [periodo, setPeriodo] = useState('30');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [gasto, setGasto] = useState(null);
  const [loadingGasto, setLoadingGasto] = useState(false);

  useEffect(() => {
    setLoading(true);
    let qs;
    if (periodo === 'mes') {
      const n = new Date();
      qs = `de=${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
    } else {
      qs = `dias=${periodo}`;
    }
    fetch(`/api/meluni-dashboard?${qs}`).then(r => r.json())
      .then(j => { if (j.ok) setData(j); }).catch(() => {}).finally(() => setLoading(false));
  }, [periodo]);

  const d = data || {};

  // Gasto Meta Ads (conta Meluni) ao vivo, na MESMA janela que o dashboard devolveu.
  useEffect(() => {
    const de = data?.periodo?.de, ate = data?.periodo?.ate;
    if (!de || !ate) return;
    setLoadingGasto(true); setGasto(null);
    fetch(`/api/meta-ads-analise?account=943539471358534&since=${de}&until=${ate}`)
      .then(r => r.json())
      .then(j => {
        if (!Array.isArray(j?.data)) { setGasto(null); return; }
        setGasto(j.data.reduce((a, r) => a + (Number(r.spend) || 0), 0));
      })
      .catch(() => setGasto(null))
      .finally(() => setLoadingGasto(false));
  }, [data?.periodo?.de, data?.periodo?.ate]);

  const roas = (gasto && gasto > 0) ? (Number(d.vendas?.soma) || 0) / gasto : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <Filter size={15} color={palette.inkMuted} />
        <select style={selStyle} value={periodo} onChange={e => setPeriodo(e.target.value)}>
          <option value="mes">Esse mês</option>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
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
        <KpiTile label="Gasto Meta Ads" valor={loadingGasto ? '…' : (gasto == null ? '—' : fmtBRL(gasto))} sub="conta Meluni" />
        <KpiTile label="ROAS (venda ÷ gasto)" valor={loadingGasto ? '…' : (roas == null ? '—' : roas.toFixed(2) + 'x')} destaque />
      </div>
      <MiniBarras serie={d.serie || []} />
    </div>
  );
}

// ─── SEÇÃO: E-MAIL MKT (carrinho abandonado por e-mail, mesmo padrão do Carrinho, SEM chat) ──
const EMAIL_PERIODOS = [
  { v: 'mes_atual', l: 'Mês atual' },
  { v: '15d', l: 'Últimos 15 dias' },
  { v: '7d', l: 'Últimos 7 dias' },
  { v: 'mes_passado', l: 'Último mês' },
];

function EmailMktCard({ c, etapa, sel, onSel, onBloquear }) {
  const [bloq, setBloq] = useState(false);
  const dataFmt = fmtData(String(c.data || '').slice(0, 10));
  const rotuloData = etapa === 'processando' ? 'carrinho' : (etapa === 'abertura' ? 'aberto' : 'enviado');
  const abriu = etapa === 'abertura' || (etapa === 'enviados' && c.aberto_em);
  return (
    <div style={{
      background: palette.surface, borderRadius: 12, padding: 12,
      border: `1px solid ${palette.beige}`, display: 'flex', alignItems: 'flex-start', gap: 10,
    }}>
      {etapa === 'processando' && (
        <input type="checkbox" checked={sel} onChange={onSel}
          style={{ width: 18, height: 18, cursor: 'pointer', marginTop: 2, flexShrink: 0 }} />
      )}
      <Mail size={15} color={MELUNI} style={{ marginTop: 3, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: palette.ink }}>{c.nome || 'Cliente'}</span>
          {abriu && <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, background: '#e9f7ef', color: '#1e8449', fontWeight: 700 }}>abriu</span>}
        </div>
        <div style={{ fontSize: 12, color: palette.inkMuted, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>📧 {c.email || '—'}</span>
          <span>valor <b style={{ color: palette.ink }}>{fmtBRL(c.valor)}</b></span>
          <span>{rotuloData} <b>{dataFmt}</b></span>
        </div>
      </div>
      {etapa === 'processando' && (
        <button onClick={async () => { setBloq(true); await onBloquear(); }} disabled={bloq}
          title="Não enviar e-mail pra esse carrinho"
          style={{
            flexShrink: 0, padding: '5px 9px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: FONT,
            background: palette.surface, color: palette.alert, border: `1px solid ${palette.beige}`,
            opacity: bloq ? 0.6 : 1,
          }}>
          <Ban size={13} /> Bloquear
        </button>
      )}
    </div>
  );
}

// ── Composer "Criar e-mail" ────────────────────────────────────────────────
const inEmail = {
  width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 9,
  border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 14, color: palette.ink,
  background: '#fff', outline: 'none',
};
function CampoEmail({ label, dica, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: palette.inkSoft, fontFamily: FONT, marginBottom: 4 }}>
        {label}{dica && <span style={{ fontWeight: 400, color: palette.inkMuted }}> · {dica}</span>}
      </div>
      {children}
    </div>
  );
}

function ComposerEmail({ selCount = 0, onClose }) {
  const [brief, setBrief] = useState('');
  const [gerando, setGerando] = useState(false);
  const [assunto, setAssunto] = useState('');
  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [criativoUrl, setCriativoUrl] = useState('');
  const [criativoPath, setCriativoPath] = useState('');
  const [subindo, setSubindo] = useState(false);
  const [galeria, setGaleria] = useState(false);
  const [criativos, setCriativos] = useState([]);
  const [loadGal, setLoadGal] = useState(false);
  const [cupom, setCupom] = useState('VOLTE10');
  const [cupomValidade, setCupomValidade] = useState('24 horas');
  const [ctaLabel, setCtaLabel] = useState('Voltar pro meu carrinho');
  const [ctaUrl, setCtaUrl] = useState('https://meluniloja.com.br');
  const [utm, setUtm] = useState('utm_source=email&utm_medium=carrinho&utm_campaign=recuperacao');
  const [assinatura, setAssinatura] = useState('Equipe Meluni');
  const [avancado, setAvancado] = useState(false);
  const [ajuda, setAjuda] = useState(false);
  const [comNome, setComNome] = useState(true);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoad, setPreviewLoad] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [campanhaId, setCampanhaId] = useState(null);
  const [vista, setVista] = useState('editor');
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  const fileRef = useRef(null);

  useEffect(() => {
    const onR = () => setW(window.innerWidth);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  const wide = w >= 900;

  const campanha = {
    assunto, titulo, corpo, criativo_url: criativoUrl,
    cta_label: ctaLabel, cta_url: ctaUrl, cupom, cupom_validade: cupomValidade, utm, assinatura,
  };
  const campKey = JSON.stringify(campanha);

  useEffect(() => {
    let vivo = true;
    setPreviewLoad(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/meluni-email-mkt-preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campanha, carrinho: { nome: comNome ? 'Maria' : null, valor: 289.9, resumo: 'Vestido de Linho e mais 1 peça' } }),
        });
        const j = await r.json();
        if (vivo && j.ok) setPreviewHtml(j.html || '');
      } catch { /* */ }
      if (vivo) setPreviewLoad(false);
    }, 450);
    return () => { vivo = false; clearTimeout(t); };
  }, [campKey, comNome]); // eslint-disable-line

  const gerar = async () => {
    if (!brief.trim()) return;
    setGerando(true);
    try {
      const r = await fetch('/api/meluni-email-mkt-lara', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, cupom, cupom_validade: cupomValidade }),
      });
      const j = await r.json();
      if (j.ok) {
        if (j.assunto) setAssunto(j.assunto);
        if (j.titulo) setTitulo(j.titulo);
        if (j.corpo) setCorpo(j.corpo);
        if (!wide) setVista('preview');
      } else alert(j.erro || 'A Lara não conseguiu agora.');
    } catch { alert('Falha ao falar com a Lara.'); }
    setGerando(false);
  };

  const subirCriativo = async (file) => {
    if (!file) return;
    setSubindo(true);
    try {
      const { base64, mime } = await fileToBase64Scaled(file);
      const r = await fetch('/api/meluni-email-mkt-upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mime }),
      });
      const j = await r.json();
      if (j.ok && j.url) { setCriativoUrl(j.url); setCriativoPath(j.path || ''); }
      else alert(j.erro || 'Falha no upload.');
    } catch { alert('Falha ao subir o criativo.'); }
    setSubindo(false);
  };

  const abrirGaleria = async () => {
    setGaleria(true); setLoadGal(true);
    try {
      const r = await fetch('/api/meluni-email-mkt-criativos');
      const j = await r.json();
      if (j.ok) setCriativos(j.criativos || []);
    } catch { /* */ }
    setLoadGal(false);
  };
  const salvarCriativo = async () => {
    if (!criativoUrl) return;
    const nome = prompt('Nome do criativo (pra achar depois):', '');
    if (nome === null) return;
    try {
      const r = await fetch('/api/meluni-email-mkt-criativos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'salvar', nome: nome || 'Criativo', url: criativoUrl, path: criativoPath }),
      });
      const j = await r.json();
      if (j.ok) alert('Criativo salvo na pasta ✓'); else alert(j.erro || 'Falha ao salvar.');
    } catch { alert('Falha ao salvar.'); }
  };
  const usarCriativo = (c) => { setCriativoUrl(c.url); setCriativoPath(c.path || ''); setGaleria(false); };
  const renomearCriativo = async (c) => {
    const nome = prompt('Novo nome:', c.nome || '');
    if (nome === null) return;
    try {
      await fetch('/api/meluni-email-mkt-criativos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'renomear', id: c.id, nome }),
      });
      setCriativos(prev => prev.map(x => x.id === c.id ? { ...x, nome } : x));
    } catch { /* */ }
  };
  const excluirCriativo = async (c) => {
    if (!confirm(`Excluir "${c.nome || 'criativo'}" da pasta?`)) return;
    try {
      await fetch('/api/meluni-email-mkt-criativos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'excluir', id: c.id }),
      });
      setCriativos(prev => prev.filter(x => x.id !== c.id));
    } catch { /* */ }
  };

  const salvar = async () => {
    if (!assunto.trim() || !corpo.trim()) { alert('Preencha pelo menos assunto e corpo.'); return; }
    setSalvando(true);
    try {
      const r = await fetch('/api/meluni-email-mkt-campanha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: campanhaId, ...campanha, status: 'rascunho' }),
      });
      const j = await r.json();
      if (j.ok) { setCampanhaId(j.id); alert('Campanha salva ✓'); } else alert(j.erro || 'Falha ao salvar.');
    } catch { alert('Falha ao salvar.'); }
    setSalvando(false);
  };

  const enviarManual = async () => {
    if (!assunto.trim() || !corpo.trim()) { alert('Preencha pelo menos assunto e corpo antes de enviar.'); return; }
    const email = (window.prompt('Enviar este e-mail (teste/manual) para qual endereço?', '') || '').trim();
    if (!email) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { alert('E-mail inválido.'); return; }
    setEnviando(true);
    try {
      const r = await fetch('/api/meluni-email-mkt-enviar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, campanha,
          carrinho: { nome: comNome ? 'Maria' : null, valor: 289.9, resumo: 'Vestido de Linho e mais 1 peça' },
        }),
      });
      const j = await r.json();
      if (j.ok) alert('E-mail enviado ✓  Confere a caixa de entrada (e o spam).');
      else alert(j.erro || 'Falha ao enviar.');
    } catch { alert('Falha ao enviar.'); }
    setEnviando(false);
  };
  const btnVista = (id, txt) => (
    <button onClick={() => setVista(id)} style={{
      ...selStyle, fontWeight: 700, background: vista === id ? MELUNI : '#fff',
      color: vista === id ? '#fff' : palette.inkSoft, borderColor: vista === id ? MELUNI : palette.beige,
    }}>{txt}</button>
  );
  const segBtn = (on) => ({
    ...selStyle, padding: '3px 9px', fontSize: 11, fontWeight: 700,
    background: on ? MELUNI : '#fff', color: on ? '#fff' : palette.inkSoft, borderColor: on ? MELUNI : palette.beige,
  });

  const editor = (
    <div style={{ flex: wide ? '0 0 50%' : '1 1 auto', maxWidth: wide ? 560 : '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box' }}>
      {/* Brief / Lara */}
      <div style={{ background: MELUNI_SOFT, border: `1px solid ${MELUNI}`, borderRadius: 12, padding: 12, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: palette.ink, fontFamily: FONT, marginBottom: 6 }}>
          ✦ Diga o que vc quer e a Lara escreve
        </div>
        <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={3}
          placeholder="Ex: faz um copy de carrinho abandonado e fala do cupom VOLTE10 que dá 10%, com um tom elegante e atemporal."
          style={{ ...inEmail, resize: 'vertical' }} />
        <button onClick={gerar} disabled={gerando || !brief.trim()}
          style={{ ...fbtn(MELUNI, '#fff'), marginTop: 8, opacity: (gerando || !brief.trim()) ? 0.5 : 1, cursor: (gerando || !brief.trim()) ? 'default' : 'pointer' }}>
          {gerando ? 'a Lara está escrevendo…' : '✨ Gerar com a Lara'}
        </button>
        <div style={{ fontSize: 11, color: palette.inkMuted, fontFamily: FONT, marginTop: 6 }}>
          Tudo o que ela gerar fica editável abaixo. O nome da cliente entra sozinho via {'{{nome}}'}.
        </div>
      </div>

      <CampoEmail label="Assunto" dica={`${assLen}/40 ${assLen > 40 ? '· longo p/ mobile' : ''}`}>
        <input value={assunto} onChange={e => setAssunto(e.target.value)}
          placeholder="Suas peças continuam aqui, {{nome}}" style={inEmail} />
      </CampoEmail>

      <CampoEmail label="Título (abertura dentro do e-mail)">
        <input value={titulo} onChange={e => setTitulo(e.target.value)} style={inEmail} />
      </CampoEmail>

      <CampoEmail label="Corpo">
        <textarea value={corpo} onChange={e => setCorpo(e.target.value)} rows={6}
          style={{ ...inEmail, resize: 'vertical', lineHeight: 1.5 }} />
      </CampoEmail>

      <CampoEmail label="Criativo (imagem do topo)">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) subirCriativo(f); e.target.value = ''; }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {criativoUrl && <img src={criativoUrl} alt="" style={{ width: 90, height: 60, objectFit: 'cover', borderRadius: 8, border: `1px solid ${palette.beige}` }} />}
          <button onClick={() => fileRef.current?.click()} disabled={subindo}
            style={{ ...fbtn('#fff', palette.inkSoft, palette.beige), opacity: subindo ? 0.6 : 1 }}>
            {subindo ? 'subindo…' : (criativoUrl ? 'Trocar' : '⬆ Subir criativo')}
          </button>
          <button onClick={abrirGaleria} style={{ ...fbtn('#fff', palette.inkSoft, palette.beige) }}>📁 Criativos salvos</button>
          {criativoUrl && <button onClick={salvarCriativo} style={{ ...fbtn('#fff', MELUNI, MELUNI) }}>💾 Salvar na pasta</button>}
          {criativoUrl && <button onClick={() => { setCriativoUrl(''); setCriativoPath(''); }} style={{ ...selStyle, color: palette.alert, borderColor: palette.alert }}>Remover</button>}
        </div>
        <div style={{ fontSize: 11, color: palette.inkMuted, fontFamily: FONT, marginTop: 6, lineHeight: 1.5 }}>
          <strong>1200px largura x 1500px altura</strong> (4:5) · máximo 5 MB · JPG, PNG ou WebP.
          <br />A imagem é otimizada automaticamente. Toque no “?” lá em cima pra ver como fazer.
        </div>
      </CampoEmail>

      <div style={{ display: 'flex', gap: 10 }}>
        <CampoEmail label="Cupom"><input value={cupom} onChange={e => setCupom(e.target.value)} style={inEmail} /></CampoEmail>
        <CampoEmail label="Validade do cupom"><input value={cupomValidade} onChange={e => setCupomValidade(e.target.value)} placeholder="24 horas" style={inEmail} /></CampoEmail>
      </div>

      {/* Avançado: botão / UTM / assinatura */}
      <button onClick={() => setAvancado(v => !v)}
        style={{ ...selStyle, width: '100%', textAlign: 'left', fontWeight: 700, marginBottom: avancado ? 12 : 0 }}>
        {avancado ? '▾' : '▸'} Botão, UTM e assinatura (padrão pronto, edite se quiser)
      </button>
      {avancado && (
        <div style={{ borderLeft: `2px solid ${palette.beige}`, paddingLeft: 12 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <CampoEmail label="Texto do botão"><input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} style={inEmail} /></CampoEmail>
            <CampoEmail label="Link do botão"><input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} style={inEmail} /></CampoEmail>
          </div>
          <CampoEmail label="UTM (rastreio)"><input value={utm} onChange={e => setUtm(e.target.value)} style={{ ...inEmail, fontSize: 12 }} /></CampoEmail>
          <CampoEmail label="Assinatura"><textarea value={assinatura} onChange={e => setAssinatura(e.target.value)} rows={2} style={{ ...inEmail, resize: 'vertical' }} /></CampoEmail>
        </div>
      )}
    </div>
  );

  const preview = (
    <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', background: palette.beigeSoft, borderLeft: wide ? `1px solid ${palette.beige}` : 'none' }}>
      <div style={{ padding: '8px 14px', borderBottom: `1px solid ${palette.beige}`, fontSize: 12, fontFamily: FONT, color: palette.inkSoft, display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ color: palette.inkMuted, fontWeight: 700 }}>Assunto:</strong>
        <span style={{ color: palette.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '0 1 auto' }}>{assunto || '—'}</span>
        {previewLoad && <span style={{ fontSize: 11, color: palette.inkMuted }}>•••</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, flexShrink: 0 }}>
          <button onClick={() => setComNome(true)} style={segBtn(comNome)}>Com nome</button>
          <button onClick={() => setComNome(false)} style={segBtn(!comNome)}>Sem nome</button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <iframe title="preview" srcDoc={previewHtml} style={{ width: '100%', height: '100%', border: 0, background: '#fff' }} />
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: palette.bg, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${palette.beige}`, background: '#fff', flexWrap: 'wrap' }}>
        <strong style={{ fontFamily: FONT, fontSize: 16, color: palette.ink }}>✉️ Criar template</strong>
        <button onClick={() => setAjuda(true)} title="Como fazer o criativo"
          style={{ width: 24, height: 24, borderRadius: 999, border: `1px solid ${MELUNI}`, background: MELUNI_SOFT, color: MELUNI, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0 }}>?</button>
        {!wide && <div style={{ display: 'flex', gap: 6 }}>{btnVista('editor', 'Editar')}{btnVista('preview', 'Preview')}</div>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={salvar} disabled={salvando} style={{ ...fbtn('#fff', palette.ink, palette.beige), opacity: salvando ? 0.6 : 1 }}>
            {salvando ? 'salvando…' : (campanhaId ? 'Salvar ✓' : 'Salvar')}
          </button>
          <button onClick={enviarManual} disabled={enviando} title="Enviar este e-mail pra um endereço (teste ou manual)"
            style={{ ...fbtn('#fff', MELUNI, MELUNI), opacity: enviando ? 0.6 : 1 }}>
            {enviando ? 'enviando…' : '✉️ Enviar'}
          </button>
          <button disabled title="Disparo em massa: disponível quando o Resend (chave + domínio) estiver configurado"
            style={{ ...fbtn(MELUNI, '#fff'), opacity: 0.45, cursor: 'not-allowed' }}>
            Disparar{selCount ? ` · ${selCount}` : ''}
          </button>
          <button onClick={onClose} style={{ ...fbtn('#fff', palette.inkSoft, palette.beige) }}>✕</button>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {(wide || vista === 'editor') && editor}
        {(wide || vista === 'preview') && preview}
      </div>
      {ajuda && (
        <div onClick={() => setAjuda(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(44,62,80,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, maxWidth: 460, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 20, fontFamily: FONT, boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 17, color: palette.ink }}>Como fazer o criativo</strong>
              <button onClick={() => setAjuda(false)} style={{ ...fbtn('#fff', palette.inkSoft, palette.beige), marginLeft: 'auto' }}>✕</button>
            </div>
            {[
              ['📐 Tamanho', '1200px de largura x 1500px de altura (proporção 4:5, retrato). É o que fica mais bonito em moda. Se quiser o título e o botão aparecendo mais cedo, 1200x1200 (quadrado) também funciona.'],
              ['💾 Peso', 'Máximo 5 MB. Pode subir maior que o app reduz e otimiza sozinho.'],
              ['🖼️ Formatos', 'JPG, PNG ou WebP. Foto do iPhone funciona normal.'],
              ['👗 O que mostrar', 'A peça em destaque, de preferência a modelo vestindo. Peça grande e centralizada.'],
              ['💡 Fundo e luz', 'Fundo limpo e claro, boa iluminação. Evite imagem escura ou poluída.'],
              ['🚫 Sem texto na imagem', 'O texto vai no corpo do e-mail. A imagem é só o visual da peça.'],
              ['↕️ Lembre', 'Ela aparece no topo, ocupando a largura toda. Algo vertical e nítido fica melhor.'],
            ].map(([t, d]) => (
              <div key={t} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: palette.ink, marginBottom: 2 }}>{t}</div>
                <div style={{ fontSize: 13.5, color: palette.inkSoft, lineHeight: 1.5 }}>{d}</div>
              </div>
            ))}
            <button onClick={() => setAjuda(false)} style={{ ...fbtn(MELUNI, '#fff'), width: '100%', justifyContent: 'center', marginTop: 4 }}>Entendi</button>
          </div>
        </div>
      )}
      {galeria && (
        <div onClick={() => setGaleria(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(44,62,80,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%', maxHeight: '85vh', overflowY: 'auto', padding: 20, fontFamily: FONT, boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <strong style={{ fontSize: 17, color: palette.ink }}>📁 Criativos salvos</strong>
              <button onClick={() => setGaleria(false)} style={{ ...fbtn('#fff', palette.inkSoft, palette.beige), marginLeft: 'auto' }}>✕</button>
            </div>
            {loadGal ? (
              <div style={{ color: palette.inkMuted, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>carregando…</div>
            ) : criativos.length === 0 ? (
              <div style={{ color: palette.inkMuted, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Nenhum criativo salvo ainda. Suba um e clique em “Salvar na pasta”.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12 }}>
                {criativos.map(c => (
                  <div key={c.id} style={{ border: `1px solid ${palette.beige}`, borderRadius: 10, overflow: 'hidden', background: palette.beigeSoft }}>
                    <img src={c.url} alt="" onClick={() => usarCriativo(c)}
                      style={{ width: '100%', height: 120, objectFit: 'cover', cursor: 'pointer', display: 'block' }} />
                    <div style={{ padding: '6px 8px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: palette.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.nome || 'Sem nome'}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                        <button onClick={() => usarCriativo(c)} style={{ ...selStyle, flex: 1, padding: '4px 6px', fontSize: 11, fontWeight: 700, background: MELUNI, color: '#fff', borderColor: MELUNI }}>Usar</button>
                        <button onClick={() => renomearCriativo(c)} title="Renomear" style={{ ...selStyle, padding: '4px 7px', fontSize: 11 }}>✏️</button>
                        <button onClick={() => excluirCriativo(c)} title="Excluir" style={{ ...selStyle, padding: '4px 7px', fontSize: 11, color: palette.alert, borderColor: palette.alert }}>🗑️</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SecaoEmailMkt() {
  const [aba, setAba] = useState('processando');
  const [periodo, setPeriodo] = useState('mes_atual');
  const [cards, setCards] = useState([]);
  const [counts, setCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(new Set());
  const [criar, setCriar] = useState(false);
  const LIM = 80;

  const carregar = useCallback(async (off = 0) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/meluni-email-mkt-list?etapa=${aba}&periodo=${periodo}&limite=${LIM}&offset=${off}`);
      const j = await r.json();
      if (j.ok) {
        setCounts(j.counts || {});
        setTotal(j.total || 0);
        setCards(prev => off ? [...prev, ...j.cards] : j.cards);
      }
    } catch { /* */ }
    setLoading(false);
  }, [aba, periodo]);

  useEffect(() => { setSel(new Set()); carregar(0); }, [carregar]);

  const tabs = [
    { id: 'processando', label: 'Processando', unread: counts.processando,
      help: 'Carrinhos abandonados que têm e-mail e peças e ainda não receberam e-mail mkt.\n\nSelecione os que quiser, clique em "Criar template", monte a mensagem (a Lara ajuda) e dispare. Quem recebe passa pra Enviados.' },
    { id: 'enviados', label: 'Enviados', unread: counts.enviados,
      help: 'Leads que já receberam o e-mail mkt no período escolhido.' },
    { id: 'abertura', label: 'Abertura', unread: counts.abertura,
      help: 'Leads que abriram o e-mail (medido pelo Resend).\n\nA abertura é aproximada: alguns apps de e-mail inflam (Apple Mail) e outros bloqueiam o pixel de leitura.' },
  ];

  const toggleSel = (id) => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selTodos = () => setSel(sel.size === cards.length ? new Set() : new Set(cards.map(c => c.id)));

  const bloquear = async (carrinho_id) => {
    try {
      await fetch('/api/meluni-email-mkt-bloquear', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ carrinho_id, bloquear: true }) });
      setCards(prev => prev.filter(c => c.carrinho_id !== carrinho_id));
      setSel(p => { const n = new Set(p); n.delete(carrinho_id); return n; });
      setCounts(c => ({ ...c, processando: Math.max(0, (c.processando || 1) - 1) }));
      setTotal(t => Math.max(0, t - 1));
    } catch { /* */ }
  };

  const carregarMais = cards.length < total ? (
    <button onClick={() => carregar(cards.length)} disabled={loading}
      style={{ ...selStyle, marginTop: 4, width: '100%', padding: 8, fontWeight: 700 }}>
      {loading ? 'carregando…' : `Carregar mais (${total - cards.length} restantes)`}
    </button>
  ) : null;

  const rotuloTotal = aba === 'processando' ? 'elegíveis' : (aba === 'abertura' ? 'aberturas' : 'enviados');

  return (
    <div>
      <SubTabs tabs={tabs} active={aba} onChange={setAba} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <select style={selStyle} value={periodo} onChange={e => setPeriodo(e.target.value)}>
          {EMAIL_PERIODOS.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
        </select>
        {aba === 'processando' && (
          <button onClick={selTodos} style={{ ...selStyle, fontWeight: 700 }}>
            {sel.size === cards.length && cards.length ? 'Limpar' : 'Selecionar todos'}
          </button>
        )}
        <span style={{ fontSize: 12, color: palette.inkMuted, fontFamily: FONT }}>
          {loading ? 'carregando…' : `${total} ${rotuloTotal}`}{sel.size > 0 ? ` · ${sel.size} selecionados` : ''}
        </span>
        {aba === 'processando' && (
          <button onClick={() => setCriar(true)}
            style={{ ...fbtn(MELUNI, '#fff'), marginLeft: 'auto' }}>
            ✉️ Criar template
          </button>
        )}
      </div>
      {!loading && cards.length === 0 && <Placeholder>Nada nessa etapa no período.</Placeholder>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {cards.map(c => (
          <EmailMktCard key={c.id} c={c} etapa={aba}
            sel={sel.has(c.id)} onSel={() => toggleSel(c.id)}
            onBloquear={() => bloquear(c.carrinho_id)} />
        ))}
      </div>
      {carregarMais}
      {criar && <ComposerEmail selCount={sel.size} onClose={() => setCriar(false)} />}
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
  const [syncTick, setSyncTick] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [pend, setPend] = useState({ clientes: 0, carrinho: 0, sac: 0 });

  // contagem de pendências (badge vermelho das abas) — recarrega ao trocar de aba e a cada 20s
  useEffect(() => {
    let parar = false;
    const carregar = async () => {
      try {
        const r = await fetch('/api/meluni-pendencias');
        const j = await r.json();
        if (!parar && j?.ok) setPend({ clientes: j.clientes || 0, carrinho: j.carrinho || 0, sac: j.sac || 0 });
      } catch { /* silencioso */ }
    };
    carregar();
    const t = setInterval(carregar, 20000);
    return () => { parar = true; clearInterval(t); };
  }, [secao, syncTick]);

  const tabs = [
    { id: 'clientes', label: 'Clientes', icon: Users, badge: pend.clientes },
    { id: 'carrinho', label: 'Carrinho', icon: ShoppingCart, badge: pend.carrinho },
    { id: 'sac', label: 'SAC', icon: MessageCircle, badge: pend.sac },
    { id: 'devolucao', label: 'Devolução', icon: RotateCcw },
    { id: 'marketing', label: 'Marketing', icon: TrendingUp },
    { id: 'emailmkt', label: 'E-mail Mkt', icon: Mail },
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  ];

  const sincronizar = useCallback(async () => {
    if (syncing) return;
    setSyncing(true); setSyncMsg('');
    try {
      const r = await fetch('/api/meluni-drive-cron?dias=7', { method: 'POST' });
      const j = await r.json();
      if (j.processados) {
        const tot = { carrinhos: 0, devolucoes: 0, clientes: 0 };
        for (const v of Object.values(j.resumo || {})) {
          if (v?.tipo && tot[v.tipo] != null) tot[v.tipo] += Number(v.linhas) || 0;
        }
        const partes = [];
        if (tot.carrinhos) partes.push(`${tot.carrinhos} carrinho${tot.carrinhos > 1 ? 's' : ''}`);
        if (tot.devolucoes) partes.push(`${tot.devolucoes} ${tot.devolucoes > 1 ? 'devoluções' : 'devolução'}`);
        if (tot.clientes) partes.push(`${tot.clientes} cliente${tot.clientes > 1 ? 's' : ''}`);
        setSyncMsg(partes.length ? `✓ ${partes.join(' · ')}` : '✓ nada novo');
        setSyncTick(t => t + 1); // remonta as seções pra puxar os dados novos
      } else {
        setSyncMsg(j.msg || 'nada novo');
      }
    } catch {
      setSyncMsg('falhou');
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(''), 6000);
    }
  }, [syncing]);

  return (
    <MeluniUserCtx.Provider value={userId}>
    <div style={{ minHeight: '100vh', background: palette.bg, fontFamily: FONT }}>
      <style>{`@keyframes meluniSpin{to{transform:rotate(360deg)}}`}</style>
      <Header
        title={`Meluni · ${ASSISTANT_NAME}`}
        subtitle="WhatsApp B2C · IA atendente"
        onBack={onBack}
        rightContent={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {syncMsg && <span style={{ fontSize: 11, fontWeight: 600, color: palette.inkSoft }}>{syncMsg}</span>}
            <button onClick={sincronizar} disabled={syncing}
              title="Importa as planilhas do Drive (carrinhos, devoluções, clientes)"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: MELUNI, color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, fontFamily: FONT, cursor: syncing ? 'default' : 'pointer', opacity: syncing ? 0.7 : 1 }}>
              <RotateCcw size={13} style={{ animation: syncing ? 'meluniSpin 0.8s linear infinite' : 'none' }} />
              {syncing ? 'sincronizando…' : 'Sync'}
            </button>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: MELUNI, borderRadius: 6, padding: '3px 9px' }}>B2C</span>
          </div>
        }
      />
      <TabBar tabs={tabs} activeTab={secao} onChange={setSecao} />
      <div style={{ maxWidth: 960, margin: '0 auto', padding: 16 }}>
        {secao === 'clientes' && <SecaoClientes key={syncTick} />}
        {secao === 'carrinho' && <SecaoCarrinho key={syncTick} />}
        {secao === 'sac' && <SecaoSac />}
        {secao === 'devolucao' && <SecaoDevolucao key={syncTick} userId={userId} isAdmin={isAdmin} />}
        {secao === 'marketing' && <SecaoMarketing />}
        {secao === 'emailmkt' && <SecaoEmailMkt />}
        {secao === 'dashboard' && <SecaoDashboard />}
      </div>
    </div>
    </MeluniUserCtx.Provider>
  );
}
