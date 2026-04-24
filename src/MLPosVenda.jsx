/**
 * MLPosVenda.jsx — Módulo Pós-Venda (mensagens ML)
 * Props: supabase, currentUser
 */
import { useState, useEffect, useRef, useCallback } from 'react';

const PALETTE = {
  dark: '#2c3e50', blue: '#4a7fa5', cream: '#f7f4f0', sand: '#e8e2da', white: '#fff',
  red: '#c0392b', redLight: '#e74c3c22', green: '#27ae60', greenLight: '#27ae6022',
  orange: '#e67e22', orangeLight: '#e67e2222', text: '#2c3e50', textLight: '#7f8c8d', border: '#d5cec6',
};
const BRANDS = {
  Exitus: { color: '#4a3a2a', bg: '#d4c8a8' },
  Lumia: { color: '#4a3a2a', bg: '#b8a88a' },
  Muniam: { color: '#fff', bg: '#8a7560' },
};
const TAGS = {
  urgente: { emoji: '🔴', label: 'Urgente', color: '#c0392b', bg: '#c0392b15' },
  atencao: { emoji: '🟡', label: 'Atenção', color: '#e67e22', bg: '#e67e2215' },
  normal: { emoji: '⚪', label: 'Normal', color: '#7f8c8d', bg: '#7f8c8d10' },
  resolvido: { emoji: '✅', label: 'Resolvido', color: '#27ae60', bg: '#27ae6015' },
};
const S = { fontFamily: "Georgia,'Times New Roman',serif" };
const timeAgo = (d) => { if (!d) return ''; const diff = Date.now() - new Date(d).getTime(); const m = Math.floor(diff / 60000); if (m < 60) return `${m}min`; const h = Math.floor(m / 60); if (h < 24) return `${h}h`; return `${Math.floor(h / 24)}d`; };

const BrandTag = ({ brand }) => {
  const b = BRANDS[brand] || { color: '#888', bg: '#88815' };
  return <span style={{ ...S, fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, color: b.color, background: b.bg }}>{brand}</span>;
};

export default function MLPosVenda({ supabase, currentUser }) {
  const [convs, setConvs] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('todos'); // default: mostra todas (antes era 'pendentes' — sumia conv não-aberta)
  const [brandFilter, setBrandFilter] = useState('Todas');
  const [loading, setLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [aiSuggest, setAiSuggest] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [notesEdit, setNotesEdit] = useState('');
  const [showTraining, setShowTraining] = useState(false);
  const [training, setTraining] = useState([]);
  const [trainQ, setTrainQ] = useState('');
  const [trainA, setTrainA] = useState('');
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState(null); // { done, total }
  const chatEndRef = useRef(null);

  // ── Fetch conversas ──
  const fetchConvs = useCallback(async () => {
    try {
      const r = await fetch('/api/ml-messages?limit=100');
      if (r.ok) { const d = await r.json(); setConvs(d.conversations || []); }
    } catch (e) { console.error('PV fetch:', e); }
  }, []);

  // ── Fetch mensagens de uma conversa ──
  const fetchMsgs = useCallback(async (conv) => {
    try {
      const r = await fetch('/api/ml-messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'messages', conversation_id: conv.id }),
      });
      if (r.ok) { const d = await r.json(); setMsgs(d.messages || []); }
    } catch (e) { console.error('PV msgs:', e); }
  }, []);

  // ── Fetch training data ──
  const fetchTraining = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('ml_qa_history_posvenda').select('*').order('answered_at', { ascending: false }).limit(50);
    if (data) setTraining(data);
  }, [supabase]);

  // ── Init + Realtime ──
  useEffect(() => {
    fetchConvs();
    fetchTraining();
    const interval = setInterval(fetchConvs, 60000); // Refresh cada 60s
    // Realtime
    let channel;
    if (supabase) {
      channel = supabase.channel('pv-convs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ml_conversations' }, () => fetchConvs())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ml_messages' }, (payload) => {
          if (selected && payload.new?.conversation_id === selected.id) fetchMsgs(selected);
          fetchConvs();
        })
        .subscribe();
    }
    return () => { clearInterval(interval); if (channel) supabase.removeChannel(channel); };
  }, []);

  // Scroll to bottom when msgs change
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  // ── Open conversation ──
  const openConv = async (conv) => {
    setSelected(conv); setReplyText(''); setAiSuggest(null);
    setNotesEdit(conv.notes || '');
    fetchMsgs(conv);

    // Se falta item_title ou thumbnail, tenta enriquecer no ML on-demand
    // (caso o webhook original tenha vindo incompleto)
    if (!conv.item_title || !conv.item_thumbnail) {
      try {
        const r = await fetch('/api/ml-conv-enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversation_id: conv.id }),
        });
        if (r.ok) {
          const data = await r.json();
          if (data.enriched && data.conv) {
            setSelected(data.conv);
            fetchConvs(); // atualiza a lista também pra ver a thumb/title novos
          }
        }
      } catch (e) { console.error('[SAC] enrich:', e.message); }
    }
  };

  // ── Send reply ──
  const sendReply = async () => {
    if (!replyText.trim() || !selected || sending) return;
    setSending(true);
    try {
      const r = await fetch('/api/ml-messages-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: selected.id, text: replyText.trim(), sent_via: 'manual' }),
      });
      if (r.ok) { setReplyText(''); fetchMsgs(selected); fetchConvs(); }
      else {
        const e = await r.json().catch(() => ({}));
        // Mostra detalhes completos do erro ML pra facilitar diagnóstico
        const detalhe = e.detail?.message
          || e.detail?.error
          || (typeof e.detail === 'string' ? e.detail : null)
          || (e.detail ? JSON.stringify(e.detail).slice(0, 200) : null)
          || e.error
          || `HTTP ${r.status}`;
        alert(`Erro ao enviar pro ML:\n\n${detalhe}\n\nSe o erro persistir, fala com o Ailson.`);
      }
    } catch (e) { alert('Erro de rede: ' + e.message); }
    setSending(false);
  };

  // ── Batch enrich: busca fotos/títulos faltantes no ML pra conversas
  //    antigas que vieram incompletas. Roda em paralelo com limit=3 pra
  //    não estressar a API ML.
  const enrichFaltantes = async () => {
    if (enrichLoading) return;
    const pendentes = convs.filter(c => !c.item_title || !c.item_thumbnail);
    if (pendentes.length === 0) {
      alert('Todas as conversas já têm foto e título 👌');
      return;
    }
    if (!confirm(`Buscar foto/título no ML pra ${pendentes.length} conversa${pendentes.length > 1 ? 's' : ''}?\n\nPode demorar uns segundos.`)) return;

    setEnrichLoading(true);
    setEnrichProgress({ done: 0, total: pendentes.length });

    const LIMIT = 3; // concorrência máxima
    let done = 0;
    for (let i = 0; i < pendentes.length; i += LIMIT) {
      const batch = pendentes.slice(i, i + LIMIT);
      await Promise.all(batch.map(async (conv) => {
        try {
          await fetch('/api/ml-conv-enrich', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ conversation_id: conv.id }),
          });
        } catch (e) {
          console.error('[enrich batch]', conv.id, e.message);
        }
        done++;
        setEnrichProgress({ done, total: pendentes.length });
      }));
    }

    setEnrichLoading(false);
    setEnrichProgress(null);
    fetchConvs(); // recarrega a lista com as fotos/títulos novos
  };

  // ── Update tag/notes/status ──
  const updateConv = async (field, value) => {
    if (!selected) return;
    const body = { conversation_id: selected.id, [field]: value };
    if (field === 'status' && value === 'resolvido') body.resolved_by = currentUser;
    await fetch('/api/ml-messages-tag', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSelected(prev => ({ ...prev, [field]: value, ...(field === 'status' && value === 'resolvido' ? { tag: 'resolvido' } : {}) }));
    fetchConvs();
  };

  // ── AI Suggestion ──
  const getAiSuggestion = async () => {
    if (!selected || aiLoading) return;
    setAiLoading(true);
    try {
      // Build context from conversation
      const context = msgs.map(m => `${m.from_type === 'buyer' ? 'COMPRADOR' : 'VENDEDOR'}: ${m.text}`).join('\n');
      const r = await fetch('/api/ml-ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand: selected.brand,
          item_id: selected.item_id,
          question_text: `[PÓS-VENDA] Contexto da conversa:\n${context}\n\nÚltima mensagem do comprador: "${msgs.filter(m => m.from_type === 'buyer').pop()?.text || ''}"`,
          mode: 'posvenda',
        }),
      });
      if (r.ok) { const d = await r.json(); setAiSuggest(d.suggestion || 'Sem sugestão'); }
    } catch (e) { console.error('AI:', e); }
    setAiLoading(false);
  };

  // ── Save training ──
  const saveTraining = async () => {
    if (!trainQ.trim() || !trainA.trim() || !supabase) return;
    await supabase.from('ml_qa_history_posvenda').insert({
      brand: selected?.brand || 'Todas',
      situation_text: trainQ.trim(),
      answer_text: trainA.trim(),
      answered_by: currentUser || 'admin',
    });
    setTrainQ(''); setTrainA('');
    fetchTraining();
  };

  // ── Filtered list ──
  const filtered = convs.filter(c => {
    // Pendentes: aberto OU tem mensagem nao lida (mesmo se status mudou por engano)
    if (filter === 'pendentes' && c.status !== 'aberto' && !(c.unread_count > 0)) return false;
    if (filter === 'resolvidas' && c.status !== 'resolvido') return false;
    if (filter === 'urgente' && c.tag !== 'urgente') return false;
    if (filter === 'atencao' && c.tag !== 'atencao') return false;
    if (brandFilter !== 'Todas' && c.brand !== brandFilter) return false;
    return true;
  });

  const openCount = convs.filter(c => c.status === 'aberto').length;
  const unreadTotal = convs.reduce((s, c) => s + (c.unread_count || 0), 0);

  // ═══════════════ CHAT VIEW ═══════════════
  if (selected) {
    const conv = selected;
    const tag = TAGS[conv.tag] || TAGS.normal;

    return (
      <div>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button onClick={() => { setSelected(null); fetchConvs(); }} style={{ ...S, background: 'none', border: `1px solid ${PALETTE.border}`, borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer', color: PALETTE.blue }}>← Voltar</button>
          {conv.item_thumbnail ? (
            <img src={conv.item_thumbnail} alt="" style={{ width: 42, height: 42, borderRadius: 6, objectFit: 'cover', border: `1px solid ${PALETTE.sand}` }} onError={e => { e.target.style.display = 'none'; }} />
          ) : (
            <div style={{ width: 42, height: 42, borderRadius: 6, background: PALETTE.cream, border: `1px solid ${PALETTE.sand}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, color: PALETTE.textLight }}>📦</div>
          )}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BrandTag brand={conv.brand} />
              <span style={{ ...S, fontSize: 15, fontWeight: 700, color: PALETTE.dark }}>{conv.item_title ? (conv.item_title.length > 50 ? conv.item_title.slice(0, 50) + '...' : conv.item_title) : `Pedido #${conv.order_id || conv.pack_id}`}</span>
            </div>
            <div style={{ ...S, fontSize: 12, color: PALETTE.textLight, marginTop: 2 }}>📦 #{conv.order_id || conv.pack_id} · 👤 {conv.buyer_nickname || conv.buyer_id || '—'}</div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ background: PALETTE.white, borderRadius: 12, border: `1px solid ${PALETTE.sand}`, padding: 16, marginBottom: 10, maxHeight: 420, overflowY: 'auto' }}>
          {msgs.length === 0 ? (
            <div style={{ ...S, textAlign: 'center', color: PALETTE.textLight, padding: 20, fontSize: 14 }}>Nenhuma mensagem carregada</div>
          ) : (
            // Garantia de ordem cronológica crescente (buyer fala primeiro, seller responde depois)
            [...msgs]
              .sort((a, b) => new Date(a.date_created || 0) - new Date(b.date_created || 0))
              .map((m, i) => (
            <div key={m.id || i} style={{ marginBottom: 14, display: 'flex', flexDirection: m.from_type === 'seller' ? 'row-reverse' : 'row', gap: 8 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: m.from_type === 'buyer' ? '#e3edf5' : '#e3f5ea', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                {m.from_type === 'buyer' ? '👤' : '🏪'}
              </div>
              <div style={{ maxWidth: '78%' }}>
                <div style={{ ...S, fontSize: 15, lineHeight: 1.5, color: PALETTE.dark, padding: '10px 14px', borderRadius: 10, background: m.from_type === 'buyer' ? '#f0f4f8' : '#e8f5e9', borderBottomLeftRadius: m.from_type === 'buyer' ? 3 : 10, borderBottomRightRadius: m.from_type === 'seller' ? 3 : 10 }}>
                  {m.text}
                </div>
                {m.attachments?.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {m.attachments.map((a, j) => (
                      <span key={j} style={{ ...S, fontSize: 11, padding: '3px 8px', background: PALETTE.cream, border: `1px solid ${PALETTE.border}`, borderRadius: 4, color: PALETTE.blue, cursor: 'pointer' }}>
                        {a.type === 'image' ? '🖼️' : '📄'} {a.filename || 'anexo'}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ ...S, fontSize: 10, color: PALETTE.textLight, marginTop: 3, textAlign: m.from_type === 'seller' ? 'right' : 'left' }}>
                  {m.date_created ? new Date(m.date_created).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
            </div>
          )))}
          <div ref={chatEndRef} />
        </div>

        {/* Notes + Tags */}
        <div style={{ background: PALETTE.white, borderRadius: 10, border: `1px solid ${PALETTE.sand}`, padding: '10px 14px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ ...S, fontSize: 11, fontWeight: 700, color: PALETTE.dark }}>📝 Observação</span>
            <div style={{ display: 'flex', gap: 3 }}>
              {Object.entries(TAGS).map(([k, t]) => (
                <button key={k} onClick={() => updateConv('tag', k)} style={{ ...S, border: conv.tag === k ? `2px solid ${t.color}` : `1px solid ${PALETTE.border}`, borderRadius: 5, padding: '2px 7px', fontSize: 9, cursor: 'pointer', background: conv.tag === k ? t.bg : 'transparent', color: t.color, fontWeight: conv.tag === k ? 700 : 400 }}>
                  {t.emoji}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={notesEdit} onChange={e => setNotesEdit(e.target.value)} onBlur={() => updateConv('notes', notesEdit)} placeholder="Observação pra equipe..." style={{ ...S, flex: 1, border: `1px solid ${PALETTE.border}`, borderRadius: 6, padding: '6px 8px', fontSize: 11, outline: 'none', background: '#fafaf8' }} />
          </div>
        </div>

        {/* AI Suggestion */}
        {aiSuggest && (
          <div style={{ background: '#f0f6fb', border: `1px solid ${PALETTE.blue}40`, borderRadius: 10, padding: '12px 16px', marginBottom: 10 }}>
            <div style={{ ...S, fontSize: 13, fontWeight: 700, color: PALETTE.blue, marginBottom: 6 }}>✨ Sugestão IA (pós-venda)</div>
            <div style={{ ...S, fontSize: 14, lineHeight: 1.5, color: PALETTE.dark, padding: 10, background: PALETTE.white, borderRadius: 6, border: `1px solid ${PALETTE.border}` }}>{aiSuggest}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={() => { setReplyText(aiSuggest); setAiSuggest(null); }} style={{ ...S, background: PALETTE.blue, color: '#fff', border: 'none', borderRadius: 5, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>Usar como base</button>
              <button onClick={() => setAiSuggest(null)} style={{ ...S, background: 'transparent', color: PALETTE.textLight, border: `1px solid ${PALETTE.border}`, borderRadius: 5, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>Descartar</button>
            </div>
          </div>
        )}

        {/* Reply */}
        {conv.status === 'aberto' && (
          <div style={{ background: PALETTE.white, borderRadius: 10, border: `1px solid ${PALETTE.sand}`, padding: '12px 16px' }}>
            <div style={{ display: 'flex', gap: 5, marginBottom: 8 }}>
              <button onClick={getAiSuggestion} disabled={aiLoading} style={{ ...S, background: '#f0f6fb', color: PALETTE.blue, border: `1px solid ${PALETTE.blue}40`, borderRadius: 5, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600, opacity: aiLoading ? 0.6 : 1 }}>{aiLoading ? '⏳ gerando…' : '✨ Sugestão IA'}</button>
              <div style={{ flex: 1 }} />
              <button onClick={() => updateConv('status', 'resolvido')} style={{ ...S, background: PALETTE.green, color: '#fff', border: 'none', borderRadius: 5, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>✅ Resolvido</button>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <textarea value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Digite sua resposta..." rows={4} style={{ ...S, flex: 1, border: `1px solid ${PALETTE.border}`, borderRadius: 6, padding: '8px 10px', fontSize: 14, lineHeight: 1.4, outline: 'none', resize: 'vertical' }} />
              <button onClick={sendReply} disabled={sending || !replyText.trim()} style={{ ...S, background: PALETTE.dark, color: '#fff', border: 'none', borderRadius: 6, padding: '10px 18px', fontSize: 13, cursor: sending ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: sending ? 0.6 : 1, alignSelf: 'flex-end' }}>
                {sending ? '⏳' : 'Enviar'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════ LIST VIEW ═══════════════
  return (
    <div>
      {/* Filters — uma linha só */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        {[
          { id: 'todos', label: 'Todas' },
          { id: 'pendentes', label: '⏳ Pendentes', badge: openCount },
          { id: 'urgente', label: '🔴 Urgente' },
          { id: 'atencao', label: '🟡 Atenção' },
          { id: 'resolvidas', label: '✅ Resolvidas' },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            ...S, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none', borderRadius: 5,
            background: filter === f.id ? PALETTE.dark : PALETTE.sand, color: filter === f.id ? '#fff' : PALETTE.text,
          }}>
            {f.label} {f.badge > 0 && <span style={{ background: PALETTE.red, color: '#fff', borderRadius: 8, padding: '1px 6px', fontSize: 10, marginLeft: 3 }}>{f.badge}</span>}
          </button>
        ))}
        <span style={{ ...S, fontSize: 12, color: PALETTE.textLight, padding: '4px 2px' }}>│</span>
        {['Todas', 'Exitus', 'Lumia', 'Muniam'].map(b => (
          <button key={b} onClick={() => setBrandFilter(b)} style={{
            ...S, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: brandFilter === b ? 'none' : `1px solid ${PALETTE.border}`,
            borderRadius: 4, background: brandFilter === b ? (b === 'Todas' ? PALETTE.dark : BRANDS[b]?.bg) : 'transparent',
            color: brandFilter === b ? (b === 'Muniam' || b === 'Todas' ? '#fff' : BRANDS[b]?.color) : PALETTE.text,
          }}>{b}</button>
        ))}
        <button onClick={fetchConvs} style={{ ...S, background: PALETTE.dark, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, marginLeft: 'auto' }}>🔄</button>
        {(() => {
          const faltando = convs.filter(c => !c.item_title || !c.item_thumbnail).length;
          if (faltando === 0 && !enrichLoading) return null;
          return (
            <button onClick={enrichFaltantes} disabled={enrichLoading} style={{
              ...S, background: enrichLoading ? PALETTE.sand : PALETTE.blue, color: '#fff',
              border: 'none', borderRadius: 5, padding: '5px 10px', fontSize: 12,
              cursor: enrichLoading ? 'wait' : 'pointer', fontWeight: 600,
            }}>
              {enrichLoading
                ? `⏳ ${enrichProgress?.done || 0}/${enrichProgress?.total || 0}`
                : `🖼️ Buscar fotos (${faltando})`}
            </button>
          );
        })()}
      </div>

      {/* Conversation cards */}
      {loading ? (
        <div style={{ ...S, textAlign: 'center', padding: 30, color: PALETTE.textLight, fontSize: 12 }}>⏳ Carregando...</div>
      ) : filtered.length === 0 ? (
        <div style={{ ...S, textAlign: 'center', padding: 30, color: PALETTE.textLight, fontSize: 12, background: PALETTE.white, borderRadius: 10, border: `1px dashed ${PALETTE.border}` }}>
          📦 Nenhuma conversa {filter === 'pendentes' ? 'pendente' : filter === 'resolvidas' ? 'resolvida' : ''}
        </div>
      ) : filtered.map(conv => {
        const tag = TAGS[conv.tag] || TAGS.normal;
        const isUnread = (conv.unread_count || 0) > 0;
        return (
          <div key={conv.id} onClick={() => openConv(conv)} style={{
            background: PALETTE.white, borderRadius: 10, border: `1px solid ${isUnread ? PALETTE.blue + '60' : PALETTE.sand}`,
            borderLeft: `4px solid ${tag.color}`, padding: '12px 16px', cursor: 'pointer', marginBottom: 8,
            boxShadow: isUnread ? `0 1px 6px ${PALETTE.blue}12` : 'none',
          }}>
            <div style={{ display: 'flex', gap: 12 }}>
              {/* Thumbnail ou placeholder (sempre aparece) */}
              {conv.item_thumbnail ? (
                <div style={{ width: 52, height: 52, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: PALETTE.cream, border: `1px solid ${PALETTE.sand}` }}>
                  <img src={conv.item_thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; e.target.parentElement.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:22px;color:#a89f94">📦</div>'; }} />
                </div>
              ) : (
                <div style={{ width: 52, height: 52, borderRadius: 6, flexShrink: 0, background: PALETTE.cream, border: `1px solid ${PALETTE.sand}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: PALETTE.textLight }}>
                  📦
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                  <BrandTag brand={conv.brand} />
                  <span style={{ ...S, fontSize: 14, fontWeight: 700, color: PALETTE.dark, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(conv.item_title || 'Pedido #' + (conv.order_id || conv.pack_id)).slice(0, 40)}</span>
                  <span style={{ ...S, fontSize: 10, color: tag.color, fontWeight: 700, background: tag.bg, padding: '2px 6px', borderRadius: 3, flexShrink: 0, marginLeft: 'auto' }}>{tag.emoji}</span>
                </div>
                <div style={{ ...S, fontSize: 12, color: PALETTE.textLight, marginBottom: 4 }}>
                  👤 {conv.buyer_nickname || conv.buyer_id || '—'} · 📦 #{conv.order_id || conv.pack_id}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ ...S, fontSize: 13, color: isUnread ? PALETTE.dark : PALETTE.textLight, fontWeight: isUnread ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {conv.last_message_from === 'buyer' ? '💬' : '↩️'} {(conv.last_message_text || '').slice(0, 60)}{(conv.last_message_text || '').length > 60 ? '...' : ''}
                  </span>
                  <span style={{ ...S, fontSize: 11, color: PALETTE.textLight, flexShrink: 0 }}>🕐 {timeAgo(conv.last_message_at)}</span>
                  {conv.unread_count > 0 && <span style={{ background: PALETTE.blue, color: '#fff', borderRadius: 8, padding: '2px 7px', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{conv.unread_count}</span>}
                </div>
                {conv.notes && (
                  <div style={{ ...S, fontSize: 11, color: PALETTE.orange, marginTop: 4, padding: '3px 8px', background: PALETTE.orangeLight, borderRadius: 3 }}>📝 {conv.notes}</div>
                )}
              </div>
            </div>
          </div>
        );
      })}

    </div>
  );
}
