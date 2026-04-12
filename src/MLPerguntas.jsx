/**
 * MLPerguntas.jsx — Módulo ML Perguntas
 * 
 * Componente standalone pra integrar no App.jsx
 * Segue mesmo padrão: localStorage + Supabase, palette, Georgia serif
 * 
 * Props esperadas do App.jsx:
 *   - supabase: instância do supabase client
 *   - currentUser: string com nome do usuário logado (ex: "Ailson", "Loja")
 * 
 * Integração no App.jsx:
 *   import MLPerguntas from './MLPerguntas';
 *   // No JSX, dentro do switch de módulos:
 *   {modulo === 'mlPerguntas' && <MLPerguntas supabase={supabase} currentUser={currentUser} />}
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import MLPosVenda from './MLPosVenda';

// ══════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════

const API_BASE = ''; // Mesmo domínio (Vercel)
const LS_KEY = 'amica_ml_perguntas';
const SUPABASE_KEY = 'ml-perguntas';
const CONFIG_KEY = 'ml-perguntas-config';
const SYNC_INTERVAL = 30000; // 30s pra checar Supabase
const LOCK_HEARTBEAT = 60000; // 1 min heartbeat
const LOCK_EXPIRY = 5 * 60 * 1000; // 5 min

const PALETTE = {
  dark: '#2c3e50', blue: '#4a7fa5', blueLight: '#5a8fb5',
  cream: '#f7f4f0', sand: '#e8e2da', white: '#ffffff',
  red: '#c0392b', redLight: '#e74c3c22', green: '#27ae60',
  greenLight: '#27ae6022', orange: '#e67e22', orangeLight: '#e67e2222',
  text: '#2c3e50', textLight: '#7f8c8d', border: '#d5cec6',
};

const BRANDS = {
  Exitus: { color: '#4a3a2a', bg: '#d4c8a8' },
  Lumia: { color: '#4a3a2a', bg: '#b8a88a' },
  Muniam: { color: '#4a3a2a', bg: '#8a7560' },
};

const DAYS_OF_WEEK = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

const CONFIG_VERSION = 3; // Incrementar pra forçar reset de config

const DEFAULT_CONFIG = {
  _version: CONFIG_VERSION,
  schedule: DAYS_OF_WEEK.map((d, i) => ({
    day: d, active: i < 6, start: '08:00', end: i === 5 ? '14:00' : '18:00',
  })),
  absence_message: 'Olá! Agradecemos seu contato. No momento estamos fora do horário de atendimento. Retornaremos assim que possível. Obrigado!',
  absence_enabled: true,
  ai_enabled: true,
  ai_tone: 'Formal mas amigável. Sempre educado, nunca robótico. Foco em conversão. Usar "você" e não "senhor/senhora".',
  ai_read_description: true,
  ai_auto_enabled: true,
  ai_low_confidence_msg: 'Olá! Agradecemos sua pergunta. Alguém do nosso time vai responder em breve. Obrigado!',
  alert_warning: 15,
  alert_urgent: 30,
  alert_critical: 60,
  templates: {
    saudacao: [
      { id: 's1', text: 'Olá! Bom dia!', shortcut: '/sd', ctrlKey: '1' },
      { id: 's2', text: 'Olá! Boa tarde!', shortcut: '/st', ctrlKey: '2' },
      { id: 's3', text: 'Olá! Boa noite!', shortcut: '/sn', ctrlKey: '3' },
    ],
    mensagem: [
      { id: 'm1', text: 'Sim, temos disponível em todos os tamanhos.', shortcut: '/disp', ctrlKey: '' },
      { id: 'm2', text: 'O prazo de envio é de 1 a 3 dias úteis após a aprovação do pagamento.', shortcut: '/prazo', ctrlKey: '' },
      { id: 'm3', text: 'Recomendamos seguir a tabela de medidas disponível no anúncio.', shortcut: '/tam', ctrlKey: '' },
    ],
    despedida: [
      { id: 'd1', text: 'Agradecemos seu contato! Boas compras!', shortcut: '/dp', ctrlKey: '8' },
      { id: 'd2', text: 'Qualquer outra dúvida, estamos à disposição!', shortcut: '/dd', ctrlKey: '9' },
    ],
  },
};

// ══════════════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ══════════════════════════════════════════════════════════

const S = { fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif", fontSize: 14 };

const Badge = ({ count, color = PALETTE.red }) => count > 0 ? (
  <span style={{
    ...S, background: color, color: '#fff', borderRadius: 10, padding: '1px 7px',
    fontSize: 11, fontWeight: 700, marginLeft: 6, minWidth: 18,
    display: 'inline-block', textAlign: 'center',
  }}>{count}</span>
) : null;

const formatTime = (min) => {
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${min % 60}min`;
  const days = Math.floor(min / 1440);
  return `${days}d ${Math.floor((min % 1440) / 60)}h`;
};

const TimeTag = ({ minutes, config }) => {
  const w = config?.alert_warning || 15;
  const u = config?.alert_urgent || 30;
  const urgent = minutes > w;
  const critical = minutes > u;
  return (
    <span style={{
      ...S, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
      background: critical ? PALETTE.redLight : urgent ? PALETTE.orangeLight : PALETTE.greenLight,
      color: critical ? PALETTE.red : urgent ? PALETTE.orange : PALETTE.green,
    }}>
      ⏱ {formatTime(minutes)}
    </span>
  );
};

const RobotIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ verticalAlign: 'middle', marginRight: 2 }}>
    <rect x="5" y="9" width="14" height="10" rx="2" fill="currentColor" opacity="0.8"/>
    <rect x="9" y="4" width="6" height="6" rx="3" fill="currentColor" opacity="0.6"/>
    <circle cx="10" cy="13" r="1.5" fill="#fff"/>
    <circle cx="14" cy="13" r="1.5" fill="#fff"/>
    <line x1="12" y1="2" x2="12" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <circle cx="12" cy="1.5" r="1" fill="currentColor"/>
    <rect x="8" y="16" width="8" height="1.5" rx="0.75" fill="#fff" opacity="0.7"/>
    <line x1="2" y1="13" x2="5" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    <line x1="19" y1="13" x2="22" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const BrandTag = ({ brand }) => (
  <span style={{
    ...S, fontSize: 10, padding: '2px 8px', borderRadius: 3, fontWeight: 700,
    letterSpacing: 0.5, textTransform: 'uppercase',
    background: BRANDS[brand]?.bg || '#ccc', color: brand === 'Muniam' ? '#fff' : BRANDS[brand]?.color || '#333',
  }}>{brand}</span>
);

const Btn = ({ children, onClick, primary, small, danger, disabled, style: sx = {} }) => (
  <button onClick={onClick} disabled={disabled} style={{
    ...S, padding: small ? '4px 10px' : '7px 16px',
    fontSize: small ? 11 : 12, fontWeight: 600,
    border: primary || danger ? 'none' : `1px solid ${PALETTE.border}`,
    borderRadius: 5, cursor: disabled ? 'not-allowed' : 'pointer',
    background: danger ? PALETTE.red : primary ? PALETTE.blue : PALETTE.white,
    color: primary || danger ? '#fff' : PALETTE.text,
    opacity: disabled ? 0.5 : 1, transition: 'all 0.15s', ...sx,
  }}>{children}</button>
);

// ══════════════════════════════════════════════════════════
// DATA LAYER — localStorage + Supabase (mesmo padrão App.jsx)
// ══════════════════════════════════════════════════════════

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveLocal(data) {
  try {
    data._updated = new Date().toISOString();
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (err) { console.error('[MLPerguntas] localStorage save error:', err); }
}

// ══════════════════════════════════════════════════════════
// API HELPERS
// ══════════════════════════════════════════════════════════

async function apiCall(path, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    console.error(`[MLPerguntas] API error ${path}:`, err.message);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════
// MAIN MODULE COMPONENT
// ══════════════════════════════════════════════════════════

export default function MLPerguntas({ supabase, currentUser = 'Admin' }) {
  const [page, setPage] = useState('respostas');
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [locks, setLocks] = useState({}); // { question_id: { user, locked_at } }
  const [expandedId, setExpandedId] = useState(null);
  const [fields, setFields] = useState({ saudacao: '', mensagem: '', despedida: '' });
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState('pendentes');
  const [brandFilter, setBrandFilter] = useState('Todas');
  const [showTemplates, setShowTemplates] = useState(false);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [configSection, setConfigSection] = useState('saude');
  const [tokenStatus, setTokenStatus] = useState([]);
  const [answeredToday, setAnsweredToday] = useState([]);
  const [qaHistory, setQaHistory] = useState([]);
  const [error, setError] = useState(null);
  const [stockAlerts, setStockAlerts] = useState([]);
  const [aiResponses, setAiResponses] = useState([]);
  const [absenceResponses, setAbsenceResponses] = useState([]);
  const [pvUnread, setPvUnread] = useState(0);
  const [conversions, setConversions] = useState([]);
  const [stockColorInput, setStockColorInput] = useState('');
  const [stockAliasInput, setStockAliasInput] = useState('');
  const [sacHealth, setSacHealth] = useState(null);
  const [sacHealthLoading, setSacHealthLoading] = useState(false);
  const fetchSacHealth = async () => {
    try {
      setSacHealthLoading(true);
      const r = await fetch('/api/ml-health');
      if (r.ok) { const d = await r.json(); setSacHealth(d); }
    } catch (e) { console.error('sac health:', e); }
    finally { setSacHealthLoading(false); }
  };

  const heartbeatRef = useRef(null);
  const syncRef = useRef(null);

  // ── Load config from localStorage / Supabase ──
  useEffect(() => {
    const local = loadLocal();
    if (local?.config) {
      // Se versão antiga, forçar defaults novos (schedule, etc)
      if ((local.config._version || 0) < CONFIG_VERSION) {
        const updated = { ...DEFAULT_CONFIG, ...local.config, _version: CONFIG_VERSION,
          schedule: DEFAULT_CONFIG.schedule,
        };
        setConfig(updated);
        saveLocal({ config: updated });
      } else {
        setConfig({ ...DEFAULT_CONFIG, ...local.config });
      }
    }
    if (local?.answeredToday) setAnsweredToday(local.answeredToday);

    // Load from Supabase
    loadFromSupabase();
    // Initial fetch
    fetchQuestions();
    fetchLocks();
    fetchStockAlerts();
    fetchAnswered();
    fetchAutoResponses();
    fetchConversions();
    // Post-sale unread count
    const fetchPvUnread = async () => {
      try {
        const r = await fetch('/api/ml-messages?limit=200');
        if (r.ok) { const d = await r.json(); setPvUnread((d.conversations || []).filter(c => c.status === 'aberto' && c.unread_count > 0).length); }
      } catch {}
    };
    fetchPvUnread();

    // Sync interval
    syncRef.current = setInterval(() => {
      fetchQuestions();
      fetchLocks();
      fetchPvUnread();
    }, SYNC_INTERVAL);

    return () => {
      clearInterval(syncRef.current);
      clearInterval(heartbeatRef.current);
    };
  }, []);

  // ── Supabase load ──
  async function loadFromSupabase() {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from('amicia_data')
        .select('payload')
        .eq('user_id', CONFIG_KEY)
        .single();
      if (data?.payload?.config) {
        setConfig(prev => ({ ...prev, ...data.payload.config }));
      }
    } catch (err) { console.error('[MLPerguntas] Supabase load error:', err); }
  }

  // ── Supabase save config ──
  async function saveConfig(newConfig) {
    setConfig(newConfig);
    const toSave = { config: newConfig, _updated: new Date().toISOString() };
    saveLocal(toSave);

    if (supabase) {
      try {
        await supabase.from('amicia_data').upsert({
          user_id: CONFIG_KEY,
          payload: toSave,
        }, { onConflict: 'user_id' });
      } catch (err) { console.error('[MLPerguntas] Config save error:', err); }
    }
  }

  // ── Fetch questions from API ──
  async function fetchQuestions() {
    try {
      const data = await apiCall('/api/ml-questions');
      setQuestions(data.questions || []);
      setLastSync(data.fetched_at);
      setError(null);
    } catch (err) {
      setError(`Erro no sync: ${err.message}`);
    }
  }

  // ── Fetch answered (last 24h) from Supabase ──
  async function fetchAnswered() {
    if (!supabase) return;
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase.from('ml_qa_history')
        .select('*')
        .gte('answered_at', cutoff)
        .order('answered_at', { ascending: false })
        .limit(50);
      setAnsweredToday((data || []).map(q => ({
        id: q.question_id, brand: q.brand, item_id: q.item_id,
        question_text: q.question_text, question_status: 'ANSWERED',
        date_created: q.answered_at,
        answer: { text: q.answer_text, date_created: q.answered_at, answered_by: q.answered_by },
        answered_by: q.answered_by,
      })));
    } catch (err) {
      console.error('[MLPerguntas] Fetch answered error:', err);
    }
  }

  // ── Stock alerts ──
  async function fetchStockAlerts() {
    if (!supabase) return;
    try {
      const { data } = await supabase.from('ml_stock_alerts')
        .select('*').order('promised_at', { ascending: false }).limit(50);
      setStockAlerts(data || []);
    } catch (err) { console.error('[MLPerguntas] Stock alerts error:', err); }
  }

  async function resolveStockAlert(alertId, resolved) {
    if (!supabase) return;
    try {
      await supabase.from('ml_stock_alerts').update({
        status: resolved ? 'resolvido' : 'cancelado',
        resolved_by: currentUser, resolved_at: new Date().toISOString(),
      }).eq('id', alertId);
      fetchStockAlerts();
    } catch (err) { console.error('[MLPerguntas] Resolve alert error:', err); }
  }

  async function fetchConversions() {
    if (!supabase) return;
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data } = await supabase.from('ml_conversions')
        .select('*').gte('order_at', sevenDaysAgo)
        .order('order_at', { ascending: false }).limit(50);
      setConversions(data || []);
    } catch (err) { console.error('[MLPerguntas] Conversions error:', err); }
  }

  // ── Fetch AI and absence responses from Supabase ──
  async function fetchAutoResponses() {
    if (!supabase) return;
    try {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const { data: ai } = await supabase.from('ml_qa_history')
        .select('*').eq('answered_by', '_auto_ia')
        .gte('answered_at', cutoff).order('answered_at', { ascending: false }).limit(20);
      setAiResponses(ai || []);

      const { data: aiLow } = await supabase.from('ml_qa_history')
        .select('*').eq('answered_by', '_auto_ia_low')
        .gte('answered_at', cutoff).order('answered_at', { ascending: false }).limit(20);

      const { data: absence } = await supabase.from('ml_qa_history')
        .select('*').eq('answered_by', '_auto_absence')
        .gte('answered_at', cutoff).order('answered_at', { ascending: false }).limit(20);
      setAbsenceResponses([...(absence || []), ...(aiLow || [])]);
    } catch (err) { console.error('[MLPerguntas] Auto responses error:', err); }
  }

  // ── Fetch locks ──
  async function fetchLocks() {
    try {
      const data = await apiCall('/api/ml-lock');
      setLocks(data.locks || {});
    } catch (err) {
      console.error('[MLPerguntas] Fetch locks error:', err);
    }
  }

  // ── Lock a question ──
  async function lockQuestion(questionId) {
    try {
      await apiCall('/api/ml-lock', {
        method: 'POST',
        body: JSON.stringify({ action: 'lock', question_id: questionId, user: currentUser }),
      });
      setLocks(prev => ({
        ...prev,
        [questionId]: { user: currentUser, locked_at: new Date().toISOString() },
      }));

      // Start heartbeat
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        apiCall('/api/ml-lock', {
          method: 'POST',
          body: JSON.stringify({ action: 'heartbeat', question_id: questionId, user: currentUser }),
        }).catch(() => {});
      }, LOCK_HEARTBEAT);

      return true;
    } catch (err) {
      if (err.message?.includes('locked')) {
        alert(err.message);
        return false;
      }
      return true; // Se erro de rede, deixa abrir mesmo assim
    }
  }

  // ── Unlock a question ──
  async function unlockQuestion(questionId) {
    clearInterval(heartbeatRef.current);
    try {
      await apiCall('/api/ml-lock', {
        method: 'POST',
        body: JSON.stringify({ action: 'unlock', question_id: questionId }),
      });
    } catch {}
    setLocks(prev => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  }

  // ── Expand question (with lock) ──
  async function handleExpand(questionId) {
    // Fechar atual
    if (expandedId) {
      await unlockQuestion(expandedId);
    }

    if (expandedId === questionId) {
      setExpandedId(null);
      setFields({ saudacao: '', mensagem: '', despedida: '' });
      setAiSuggestion(null);
      return;
    }

    // Tentar lock
    const locked = await lockQuestion(questionId);
    if (!locked) return;

    setExpandedId(questionId);
    setFields({ saudacao: '', mensagem: '', despedida: '' });
    setAiSuggestion(null);
  }

  // ── Send answer ──
  async function handleSendAnswer(question) {
    const fullText = [fields.saudacao, fields.mensagem, fields.despedida]
      .filter(Boolean).join(' ');

    if (!fullText.trim()) return;
    if (fullText.length > 2000) {
      alert(`Resposta excede o limite de 2000 caracteres (${fullText.length})`);
      return;
    }

    setSending(true);
    try {
      await apiCall('/api/ml-answer', {
        method: 'POST',
        body: JSON.stringify({
          question_id: question.id,
          brand: question.brand,
          text: fullText,
          item_id: question.item_id,
          question_text: question.question_text,
          answered_by: currentUser,
        }),
      });

      // Unlock e limpar
      await unlockQuestion(question.id);
      setExpandedId(null);
      setFields({ saudacao: '', mensagem: '', despedida: '' });
      setAiSuggestion(null);

      // Refresh
      await fetchQuestions();
      setError(null);
    } catch (err) {
      setError(`Erro ao enviar: ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  // ── AI Suggestion ──
  async function requestAISuggestion(question) {
    setAiLoading(true);
    setAiSuggestion(null);
    try {
      const data = await apiCall('/api/ml-ai', {
        method: 'POST',
        body: JSON.stringify({
          question_text: question.question_text,
          item_id: question.item_id,
          brand: question.brand,
        }),
      });
      setAiSuggestion(data.suggestion);
    } catch (err) {
      setAiSuggestion(`Erro: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  }

  // ── Shortcut handler (/ commands and Ctrl+number) ──
  function handleFieldKeyDown(e, fieldKey) {
    // Ctrl + number shortcuts
    if (e.ctrlKey && e.key >= '0' && e.key <= '9') {
      e.preventDefault();
      const allTemplates = [
        ...config.templates.saudacao,
        ...config.templates.mensagem,
        ...config.templates.despedida,
      ];
      const match = allTemplates.find(t => t.ctrlKey === e.key);
      if (match) {
        // Determine which field this template belongs to
        const tField = config.templates.saudacao.includes(match) ? 'saudacao'
          : config.templates.mensagem.includes(match) ? 'mensagem' : 'despedida';
        setFields(prev => ({ ...prev, [tField]: match.text }));
      }
      return;
    }

    // / command shortcuts (check on Enter or Space after /)
    if (e.key === ' ' || e.key === 'Enter') {
      const value = fields[fieldKey];
      const allTemplates = [
        ...config.templates.saudacao.map(t => ({ ...t, _field: 'saudacao' })),
        ...config.templates.mensagem.map(t => ({ ...t, _field: 'mensagem' })),
        ...config.templates.despedida.map(t => ({ ...t, _field: 'despedida' })),
      ];

      for (const t of allTemplates) {
        if (value.trim() === t.shortcut) {
          e.preventDefault();
          setFields(prev => ({ ...prev, [fieldKey]: t.text }));
          return;
        }
      }
    }
  }

  // ── Filter questions ──
  const pending = questions.filter(q => q.question_status === 'UNANSWERED');
  const answered24h = answeredToday;
  const displayQuestions = tab === 'pendentes' ? pending : answered24h;
  const filtered = displayQuestions.filter(
    q => brandFilter === 'Todas' || q.brand === brandFilter
  );
  const brandCounts = { Todas: pending.length, Exitus: 0, Lumia: 0, Muniam: 0 };
  pending.forEach(q => { if (brandCounts[q.brand] !== undefined) brandCounts[q.brand]++; });

  // ══════════════════════════════════════════════════════════
  // PAGE: RESPOSTAS
  // ══════════════════════════════════════════════════════════
  function renderRespostas() {
    return (
      <div>
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {[
              { id: 'pendentes', label: 'Pendentes', badge: pending.length, badgeColor: PALETTE.red },
              { id: 'posvenda', label: '📦 Pós-Venda', badge: pvUnread, badgeColor: PALETTE.blue },
              { id: 'respondidas', label: 'Respondidas (24h)', badge: answeredToday.length, badgeColor: PALETTE.textLight },
              ...(absenceResponses.length > 0 ? [{ id: 'ausencia', label: 'Ausência', badge: absenceResponses.length, badgeColor: PALETTE.textLight }] : []),
              { id: 'ia_resp', label: '✨ IA', badge: aiResponses.length, badgeColor: PALETTE.textLight },
              { id: 'estoque', label: '📦 Estoque', badge: stockAlerts.filter(a => a.status === 'pendente').length, badgeColor: PALETTE.red },
              { id: 'arquivo', label: 'Arquivo', badge: 0 },
            ].map(t => (
              <button key={t.id} onClick={() => {
                setTab(t.id);
                if (t.id === 'respondidas' || t.id === 'ausencia' || t.id === 'ia_resp') { fetchAnswered(); fetchAutoResponses(); }
                if (t.id === 'estoque') fetchStockAlerts();
              }} style={{
                ...S, padding: '5px 12px', fontSize: 11, fontWeight: 600,
                border: 'none', borderRadius: 5, cursor: 'pointer',
                background: tab === t.id ? PALETTE.dark : PALETTE.sand,
                color: tab === t.id ? '#fff' : PALETTE.text,
              }}>
                {t.id === 'ia_resp' ? <><RobotIcon size={13} /> IA</> : t.label}
                {t.badge > 0 && <Badge count={t.badge} color={t.badgeColor} />}
              </button>
            ))}
          </div>
        </div>

        {/* Brand filter — não mostra no pós-venda (tem filtro próprio) */}
        {tab !== 'posvenda' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
          {['Todas', 'Exitus', 'Lumia', 'Muniam'].map(b => (
            <button key={b} onClick={() => setBrandFilter(b)} style={{
              ...S, padding: '3px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: brandFilter === b ? `2px solid ${b === 'Todas' ? PALETTE.dark : BRANDS[b]?.color}` : `1px solid ${PALETTE.border}`,
              borderRadius: 4,
              background: brandFilter === b ? (b === 'Todas' ? PALETTE.dark + '12' : BRANDS[b]?.bg) : 'transparent',
              color: b === 'Todas' ? PALETTE.dark : BRANDS[b]?.color,
            }}>
              {b} {brandCounts[b] > 0 && tab === 'pendentes' ? `(${brandCounts[b]})` : ''}
            </button>
          ))}
        </div>
        )}

        {/* Templates panel */}
        {showTemplates && renderTemplatesPanel()}

        {/* Error banner */}
        {error && (
          <div style={{
            ...S, padding: '8px 12px', marginBottom: 10, borderRadius: 6,
            background: PALETTE.redLight, color: PALETTE.red, fontSize: 12,
          }}>⚠️ {error}</div>
        )}

        {/* Questions list */}
        {tab === 'posvenda' ? (
          <MLPosVenda supabase={supabase} currentUser={currentUser} />
        ) : tab === 'arquivo' ? (
          <div style={{ ...S, padding: 30, textAlign: 'center', color: PALETTE.textLight, fontSize: 13 }}>
            📁 Arquivo — busca por período em desenvolvimento
          </div>
        ) : tab === 'ausencia' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {absenceResponses.length === 0 ? (
              <div style={{ ...S, padding: 30, textAlign: 'center', color: PALETTE.textLight, fontSize: 13 }}>
                🌙 Nenhuma resposta de ausência nas últimas 48h
              </div>
            ) : absenceResponses.map((r, i) => (
              <div key={i} style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px', borderLeft: `4px solid ${PALETTE.orange}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <BrandTag brand={r.brand} />
                  <span style={{ ...S, fontSize: 11, color: PALETTE.textLight }}>
                    {new Date(r.answered_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ ...S, fontSize: 11, color: PALETTE.orange, fontWeight: 600 }}>
                    {r.answered_by === '_auto_ia_low' ? '✨ IA (baixa confiança)' : '🌙 Ausência'}
                  </span>
                </div>
                <div style={{ ...S, fontSize: 13, color: PALETTE.text, marginBottom: 4 }}>💬 "{r.question_text}"</div>
                <div style={{ ...S, fontSize: 12, color: PALETTE.green, padding: '4px 8px', background: PALETTE.greenLight, borderRadius: 4 }}>✓ {r.answer_text}</div>
              </div>
            ))}
          </div>
        ) : tab === 'ia_resp' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {aiResponses.length === 0 ? (
              <div style={{ ...S, padding: 30, textAlign: 'center', color: PALETTE.textLight, fontSize: 13 }}>
                ✨ Nenhuma resposta da IA nas últimas 48h
              </div>
            ) : aiResponses.map((r, i) => (
              <div key={i} style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: '10px 12px', borderLeft: `4px solid ${PALETTE.blue}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <BrandTag brand={r.brand} />
                  <span style={{ ...S, fontSize: 11, color: PALETTE.textLight }}>
                    {new Date(r.answered_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ ...S, fontSize: 11, color: PALETTE.blue, fontWeight: 600 }}>✨ IA (alta confiança)</span>
                </div>
                <div style={{ ...S, fontSize: 13, color: PALETTE.text, marginBottom: 4 }}>💬 "{r.question_text}"</div>
                <div style={{ ...S, fontSize: 12, color: PALETTE.green, padding: '4px 8px', background: PALETTE.greenLight, borderRadius: 4 }}>✓ {r.answer_text}</div>
              </div>
            ))}
          </div>
        ) : tab === 'estoque' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {stockAlerts.length === 0 ? (
              <div style={{ ...S, padding: 30, textAlign: 'center', color: PALETTE.green, fontSize: 14, fontWeight: 600 }}>
                ✅ Nenhum alerta de estoque!
              </div>
            ) : stockAlerts.map(alert => (
              <div key={alert.id} style={{
                background: PALETTE.white,
                border: `1px solid ${alert.status === 'pendente' ? PALETTE.orange : PALETTE.border}`,
                borderRadius: 8, overflow: 'hidden',
                borderLeft: `4px solid ${alert.status === 'pendente' ? PALETTE.orange : PALETTE.green}`,
              }}>
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <BrandTag brand={alert.brand} />
                    <span style={{
                      ...S, fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                      background: alert.status === 'pendente' ? PALETTE.orangeLight : PALETTE.greenLight,
                      color: alert.status === 'pendente' ? PALETTE.orange : PALETTE.green,
                    }}>
                      {alert.status === 'pendente' ? '⚠️ Pendente' : '✅ Resolvido'}
                    </span>
                    <span style={{ ...S, fontSize: 11, color: PALETTE.textLight }}>
                      {new Date(alert.promised_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span style={{ ...S, fontSize: 11, color: PALETTE.textLight }}>
                      por {alert.promised_by === '_auto_ia' ? '✨ IA' : alert.promised_by}
                    </span>
                  </div>
                  <div style={{ ...S, fontSize: 14, fontWeight: 700, color: PALETTE.dark, marginBottom: 2 }}>
                    {alert.item_title || alert.item_id}
                  </div>
                  <div style={{ ...S, fontSize: 11, color: PALETTE.textLight, marginBottom: 8 }}>{alert.item_id}</div>
                  <div style={{
                    ...S, fontSize: 13, padding: '8px 10px', borderRadius: 6,
                    background: alert.status === 'pendente' ? '#fff8f0' : '#f0fff4',
                    border: `1px solid ${alert.status === 'pendente' ? '#ffe0b2' : '#c8e6c9'}`,
                    color: PALETTE.dark, lineHeight: 1.4,
                  }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, color: alert.status === 'pendente' ? PALETTE.orange : PALETTE.green }}>
                      📦 {alert.detail}
                    </div>
                    <div style={{ fontSize: 12, color: PALETTE.textLight }}>
                      <b>Pergunta:</b> "{alert.question_text}"
                    </div>
                    <div style={{ fontSize: 12, color: PALETTE.textLight, marginTop: 2 }}>
                      <b>Resposta:</b> "{(alert.answer_text || '').slice(0, 120)}..."
                    </div>
                  </div>
                  {alert.status === 'pendente' && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      <Btn primary small onClick={() => resolveStockAlert(alert.id, true)}>✅ Peça incluída</Btn>
                      <Btn small onClick={() => resolveStockAlert(alert.id, false)}>❌ Não foi possível</Btn>
                    </div>
                  )}
                  {alert.status !== 'pendente' && alert.resolved_by && (
                    <div style={{ ...S, fontSize: 11, color: PALETTE.green, marginTop: 6 }}>
                      ✅ {alert.status === 'resolvido' ? 'Resolvido' : 'Cancelado'} por {alert.resolved_by} em {new Date(alert.resolved_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ ...S, padding: 30, textAlign: 'center', color: PALETTE.green, fontSize: 14, fontWeight: 600 }}>
            ✓ {tab === 'respondidas' ? 'Nenhuma resposta nas últimas 24h' : `Nenhuma pergunta pendente${brandFilter !== 'Todas' ? ` para ${brandFilter}` : ''}`}!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(q => renderQuestionCard(q))}
          </div>
        )}
      </div>
    );
  }

  function renderTemplatesPanel() {
    return (
      <div style={{
        background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8,
        padding: 12, marginBottom: 10, maxHeight: 260, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ ...S, fontWeight: 700, fontSize: 12, color: PALETTE.dark }}>⚡ Templates</span>
          <Btn small onClick={() => setShowTemplates(false)}>✕</Btn>
        </div>
        {['saudacao', 'mensagem', 'despedida'].map(field => (
          <div key={field} style={{ marginBottom: 8 }}>
            <div style={{ ...S, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: PALETTE.textLight, marginBottom: 3 }}>
              {field === 'saudacao' ? '🌅 Saudação' : field === 'mensagem' ? '💬 Mensagem' : '👋 Despedida'}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(config.templates?.[field] || []).map(t => (
                <button key={t.id} onClick={() => setFields(prev => ({ ...prev, [field]: t.text }))}
                  style={{
                    ...S, padding: '3px 8px', fontSize: 11, border: `1px solid ${PALETTE.border}`,
                    borderRadius: 4, cursor: 'pointer', background: PALETTE.cream,
                    color: PALETTE.text, textAlign: 'left', maxWidth: 280,
                  }}>
                  <span style={{ color: PALETTE.blue, fontWeight: 700, marginRight: 4 }}>{t.shortcut}</span>
                  {t.text.length > 30 ? t.text.slice(0, 30) + '…' : t.text}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderQuestionCard(q) {
    const isExpanded = expandedId === q.id;
    const lock = locks[String(q.id)];
    const lockedByOther = lock && lock.user !== currentUser;
    const isAnswered = q.question_status === 'ANSWERED';

    return (
      <div key={q.id} style={{
        background: PALETTE.white,
        border: `1px solid ${isExpanded ? PALETTE.blue : PALETTE.border}`,
        borderRadius: 8, overflow: 'hidden',
        borderLeft: `4px solid ${BRANDS[q.brand]?.bg || PALETTE.dark}`,
        opacity: lockedByOther ? 0.7 : 1,
        position: 'relative',
      }}>
        {/* Botão X para arquivar */}
        {!isAnswered && (
          <button onClick={async (e) => {
            e.stopPropagation();
            if (!confirm('Arquivar essa pergunta?')) return;
            try {
              await supabase.from('ml_pending_questions').update({ status: 'archived' }).eq('question_id', String(q.id));
              fetchQuestions();
            } catch {}
          }} style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', color: PALETTE.textLight, cursor: 'pointer', fontSize: 14, padding: '2px 4px', zIndex: 2 }}>✕</button>
        )}
        {/* Card header */}
        <div
          onClick={() => !isAnswered && !lockedByOther && handleExpand(q.id)}
          style={{ padding: '10px 12px', cursor: isAnswered || lockedByOther ? 'default' : 'pointer' }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
            {/* Thumbnail */}
            {q.item_thumbnail && (
              <div style={{
                width: 52, height: 52, borderRadius: 6, overflow: 'hidden',
                background: PALETTE.sand, flexShrink: 0,
              }}>
                <img src={q.item_thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={e => { e.target.parentElement.style.display = 'none'; }} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Row 1: Brand + Time */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                <BrandTag brand={q.brand} />
                {!isAnswered && <TimeTag minutes={q.minutes_elapsed} config={config} />}
                {lockedByOther && (
                  <span style={{ ...S, fontSize: 10, color: PALETTE.orange, fontWeight: 600 }}>
                    🔒 {lock.user} respondendo...
                  </span>
                )}
              </div>
              {/* Row 2: Product Title bold */}
              <div style={{ ...S, fontSize: 14, fontWeight: 700, color: PALETTE.dark, lineHeight: 1.3, marginBottom: 2 }}>
                {q.item_title && q.item_title !== q.item_id ? q.item_title : 'Carregando título...'}
              </div>
              {/* Row 3: MLB ID small gray */}
              <div style={{ ...S, fontSize: 11, color: PALETTE.textLight }}>
                {q.item_id}
              </div>
            </div>
          </div>

          <div style={{
            ...S, fontSize: 13, color: PALETTE.text, lineHeight: 1.4,
            padding: '6px 8px', background: '#fafaf8', borderRadius: 4,
          }}>
            💬 "{q.question_text}"
          </div>

          {/* Answered info */}
          {isAnswered && q.answer && (
            <div style={{
              ...S, marginTop: 6, padding: '6px 8px', background: PALETTE.greenLight,
              borderRadius: 4, fontSize: 12, color: PALETTE.green,
            }}>
              ✓ Respondida
              <div style={{ marginTop: 3, color: PALETTE.text, fontSize: 12 }}>{q.answer.text}</div>
            </div>
          )}
        </div>

        {/* Expanded response area */}
        {isExpanded && !isAnswered && (
          <div style={{ padding: '0 12px 12px', borderTop: `1px solid ${PALETTE.sand}` }}>
            {/* AI suggestion */}
            <div style={{ margin: '8px 0 6px' }}>
              <button onClick={() => requestAISuggestion(q)} disabled={aiLoading}
                style={{ ...S, fontSize: 11, color: PALETTE.blue, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}>
                {aiLoading ? '⏳ Pensando...' : '✨ Pedir sugestão da IA'}
              </button>
              {aiSuggestion && (
                <div style={{
                  marginTop: 6, padding: 8, background: '#e8f4fd', borderRadius: 6,
                  ...S, fontSize: 12, color: PALETTE.dark, borderLeft: `3px solid ${PALETTE.blue}`, lineHeight: 1.4,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: PALETTE.blue, marginBottom: 3 }}>💡 Sugestão IA</div>
                  <span style={{ cursor: 'pointer' }}
                    onClick={() => setFields(f => ({ ...f, mensagem: aiSuggestion }))}>
                    {aiSuggestion}
                  </span>
                  <div style={{ fontSize: 10, color: PALETTE.textLight, marginTop: 4 }}>
                    Clique pra usar no campo Mensagem
                  </div>
                </div>
              )}
            </div>

            {/* 3 response fields */}
            {[
              { key: 'saudacao', label: '🌅 Saudação', ph: '/sd /st /sn', rows: 1 },
              { key: 'mensagem', label: '💬 Mensagem', ph: '/disp /prazo /tam ou digite', rows: 3 },
              { key: 'despedida', label: '👋 Despedida', ph: '/dp /dd', rows: 1 },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 4 }}>
                <div style={{ ...S, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: PALETTE.textLight, marginBottom: 2 }}>
                  {f.label}
                </div>
                {f.rows > 1 ? (
                  <textarea
                    value={fields[f.key]}
                    onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                    onKeyDown={e => handleFieldKeyDown(e, f.key)}
                    placeholder={f.ph}
                    rows={f.rows}
                    style={{
                      ...S, width: '100%', padding: 7, fontSize: 12,
                      border: `1px solid ${PALETTE.border}`, borderRadius: 5,
                      resize: 'vertical', outline: 'none', boxSizing: 'border-box', lineHeight: 1.4,
                    }}
                  />
                ) : (
                  <input
                    value={fields[f.key]}
                    onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                    onKeyDown={e => handleFieldKeyDown(e, f.key)}
                    placeholder={f.ph}
                    style={{
                      ...S, width: '100%', padding: 6, fontSize: 12,
                      border: `1px solid ${PALETTE.border}`, borderRadius: 5,
                      outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>
            ))}

            {/* Preview */}
            {(fields.saudacao || fields.mensagem || fields.despedida) && (() => {
              const full = [fields.saudacao, fields.mensagem, fields.despedida].filter(Boolean).join(' ');
              const over = full.length > 2000;
              return (
                <div style={{
                  marginTop: 6, padding: 8, background: over ? PALETTE.redLight : PALETTE.cream,
                  borderRadius: 6, ...S, fontSize: 12, color: PALETTE.dark,
                  lineHeight: 1.4, borderLeft: `3px solid ${over ? PALETTE.red : PALETTE.green}`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: over ? PALETTE.red : PALETTE.textLight, marginBottom: 3 }}>
                    PREVIEW ({full.length}/2000)
                  </div>
                  {full}
                </div>
              );
            })()}

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
              <Btn small onClick={() => handleExpand(null)}>Cancelar</Btn>
              <Btn primary small disabled={sending || !fields.mensagem.trim()}
                onClick={() => handleSendAnswer(q)}>
                {sending ? '⏳ Enviando...' : '✓ Enviar Resposta'}
              </Btn>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // PAGE: DASHBOARD
  // ══════════════════════════════════════════════════════════
  function renderDashboard() {
    const todayPending = pending.length;
    const todayAnswered = answeredToday.length;
    const total = todayPending + todayAnswered;
    const rate = total > 0 ? Math.round((todayAnswered / total) * 100) : 0;

    // Avg response time from answered
    const avgTime = answeredToday.length > 0
      ? Math.round(answeredToday.reduce((sum, q) => {
          const created = new Date(q.date_created).getTime();
          const answered = new Date(q.answer?.date_created || created).getTime();
          return sum + (answered - created) / 60000;
        }, 0) / answeredToday.length)
      : 0;

    const byBrand = { Exitus: 0, Lumia: 0, Muniam: 0 };
    [...pending, ...answeredToday].forEach(q => { if (byBrand[q.brand] !== undefined) byBrand[q.brand]++; });

    return (
      <div>
        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
          {[
            { label: 'Recebidas', value: total, icon: '📩', color: PALETTE.blue },
            { label: 'Respondidas', value: todayAnswered, icon: '✅', color: PALETTE.green },
            { label: 'Pendentes', value: todayPending, icon: '⏳', color: todayPending > 5 ? PALETTE.red : PALETTE.orange },
            { label: 'Tempo Médio', value: formatTime(avgTime), icon: '⚡', color: PALETTE.dark },
          ].map((k, i) => (
            <div key={i} style={{
              background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8,
              padding: '10px 8px', textAlign: 'center',
            }}>
              <div style={{ fontSize: 18 }}>{k.icon}</div>
              <div style={{ ...S, fontSize: 20, fontWeight: 700, color: k.color }}>{k.value}</div>
              <div style={{ ...S, fontSize: 10, color: PALETTE.textLight, fontWeight: 600 }}>{k.label}</div>
            </div>
          ))}
        </div>

        {/* Response rate */}
        <div style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ ...S, fontSize: 12, fontWeight: 700, color: PALETTE.dark }}>Taxa de Resposta</span>
            <span style={{ ...S, fontSize: 14, fontWeight: 700, color: rate > 80 ? PALETTE.green : rate > 50 ? PALETTE.orange : PALETTE.red }}>{rate}%</span>
          </div>
          <div style={{ height: 8, background: PALETTE.sand, borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: `${rate}%`, height: '100%', borderRadius: 4, transition: 'width 0.5s',
              background: rate > 80 ? PALETTE.green : rate > 50 ? PALETTE.orange : PALETTE.red,
            }} />
          </div>
        </div>

        {/* Volume by brand */}
        <div style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 12, marginBottom: 10 }}>
          <div style={{ ...S, fontSize: 12, fontWeight: 700, color: PALETTE.dark, marginBottom: 8 }}>📊 Volume por Marca</div>
          {Object.entries(byBrand).map(([brand, count]) => (
            <div key={brand} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <BrandTag brand={brand} />
              <div style={{ flex: 1, height: 6, background: PALETTE.sand, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: total > 0 ? `${(count / total) * 100}%` : '0%', height: '100%',
                  background: BRANDS[brand]?.color, borderRadius: 3,
                }} />
              </div>
              <span style={{ ...S, fontSize: 12, fontWeight: 700, color: PALETTE.dark, minWidth: 20 }}>{count}</span>
            </div>
          ))}
        </div>

        {/* Load dashboard data */}
        <Btn small onClick={() => { fetchAnswered(); fetchConversions(); }} style={{ marginTop: 4 }}>📊 Atualizar Dashboard</Btn>

        {/* Conversions: perguntas que geraram vendas */}
        <div style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 12, marginTop: 14 }}>
          <div style={{ ...S, fontSize: 13, fontWeight: 700, color: PALETTE.dark, marginBottom: 8 }}>🛒 Conversão de Perguntas (7 dias)</div>
          {conversions.length === 0 ? (
            <div style={{ ...S, fontSize: 12, color: PALETTE.textLight, textAlign: 'center', padding: 16 }}>
              Nenhuma conversão detectada nos últimos 7 dias.
              <div style={{ fontSize: 10, marginTop: 4 }}>O cron roda a cada 30min cruzando perguntas × pedidos.</div>
            </div>
          ) : (() => {
            const totalConv = conversions.length;
            const totalValor = conversions.reduce((s, c) => s + parseFloat(c.order_value || 0), 0);
            const diretas = conversions.filter(c => c.conversion_type === 'direta').length;
            const porIA = conversions.filter(c => c.answered_by?.startsWith('_auto_ia')).length;
            const byBrandConv = {};
            conversions.forEach(c => { byBrandConv[c.brand] = (byBrandConv[c.brand] || 0) + 1; });
            const avgTime = totalConv > 0 ? Math.round(conversions.reduce((s, c) => s + (c.time_to_buy_minutes || 0), 0) / totalConv) : 0;
            const fmtR = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            const fmtT = m => m < 60 ? `${m}min` : `${Math.floor(m/60)}h${m%60>0?` ${m%60}min`:''}`;
            return (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 10 }}>
                  {[
                    { icon: '🛒', value: totalConv, label: 'Vendas' },
                    { icon: '💰', value: fmtR(totalValor), label: 'Faturado' },
                    { icon: '✨', value: porIA, label: 'Via IA' },
                    { icon: '⚡', value: fmtT(avgTime), label: 'Tempo médio' },
                  ].map((k, i) => (
                    <div key={i} style={{ background: PALETTE.cream, borderRadius: 6, padding: '8px 4px', textAlign: 'center' }}>
                      <div style={{ fontSize: 14 }}>{k.icon}</div>
                      <div style={{ ...S, fontSize: 14, fontWeight: 700, color: PALETTE.dark }}>{k.value}</div>
                      <div style={{ ...S, fontSize: 9, color: PALETTE.textLight }}>{k.label}</div>
                    </div>
                  ))}
                </div>
                {Object.entries(byBrandConv).map(([brand, count]) => (
                  <div key={brand} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <BrandTag brand={brand} />
                    <span style={{ ...S, fontSize: 11, color: PALETTE.dark }}>{count} vendas</span>
                    <span style={{ ...S, fontSize: 11, color: PALETTE.textLight }}>({fmtR(conversions.filter(c => c.brand === brand).reduce((s, c) => s + parseFloat(c.order_value || 0), 0))})</span>
                  </div>
                ))}
                <div style={{ marginTop: 8, borderTop: `1px solid ${PALETTE.sand}`, paddingTop: 8 }}>
                  <div style={{ ...S, fontSize: 11, fontWeight: 600, color: PALETTE.dark, marginBottom: 4 }}>Últimas conversões</div>
                  {conversions.slice(0, 5).map((c, i) => (
                    <div key={i} style={{ ...S, fontSize: 11, color: PALETTE.text, marginBottom: 3, padding: '3px 0', borderBottom: `1px solid ${PALETTE.sand}` }}>
                      <span style={{ color: PALETTE.green }}>✅</span> {c.item_title?.slice(0, 35) || c.item_id} — {fmtR(c.order_value)} <span style={{ color: PALETTE.textLight }}>({fmtT(c.time_to_buy_minutes)} depois · {c.answered_by?.startsWith('_auto_ia') ? '✨ IA' : c.answered_by || '?'})</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // PAGE: CONFIGURAÇÕES
  // ══════════════════════════════════════════════════════════
  function renderConfig() {
    const sections = [
      { id: 'saude', label: '🩺 Saúde' },
      { id: 'contas', label: '🔗 Contas' },
      { id: 'templates', label: '⚡ Templates' },
      { id: 'horario', label: '🕐 Horários' },
      { id: 'ausencia', label: '🌙 Ausência' },
      { id: 'ia', label: '✨ IA' },
      { id: 'alertas', label: '🔔 Alertas' },
      { id: 'treinamento', label: '📚 Treinar IA' },
      { id: 'treinamento_pv', label: '📚 Pós-Venda' },
    ];

    return (
      <div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
          {sections.map(s => (
            <button key={s.id} onClick={() => { setConfigSection(s.id); if (s.id === 'saude') fetchSacHealth(); }} style={{
              ...S, padding: '5px 10px', fontSize: 11, fontWeight: 600,
              border: 'none', borderRadius: 5, cursor: 'pointer',
              background: configSection === s.id ? PALETTE.dark : PALETTE.sand,
              color: configSection === s.id ? '#fff' : PALETTE.text,
            }}>{s.label}</button>
          ))}
        </div>

        {/* SAÚDE */}
        {configSection === 'saude' && (
          <div style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ ...S, fontSize: 13, fontWeight: 700, color: PALETTE.dark }}>🩺 Saúde do SAC</div>
              <button onClick={fetchSacHealth} disabled={sacHealthLoading} style={{ ...S, background: PALETTE.blue, color: '#fff', border: 'none', borderRadius: 5, padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontWeight: 600, opacity: sacHealthLoading ? 0.6 : 1 }}>
                {sacHealthLoading ? 'Carregando...' : '🔄 Atualizar'}
              </button>
            </div>

            {!sacHealth ? (
              <div style={{ ...S, fontSize: 11, color: PALETTE.textLight, textAlign: 'center', padding: 16 }}>Clique em Atualizar pra ver o status</div>
            ) : (
              <div>
                {/* Config status */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  {[
                    { label: 'IA Sugestão', ok: sacHealth.config?.ia_enabled, icon: '✨' },
                    { label: 'IA Auto', ok: sacHealth.config?.ia_auto_enabled, icon: '🤖' },
                    { label: 'Ausência', ok: sacHealth.config?.absence_enabled, icon: '🌙' },
                  ].map((c, i) => (
                    <div key={i} style={{ ...S, fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 600, background: c.ok ? '#eafbf0' : '#fdeaea', color: c.ok ? '#27ae60' : '#c0392b' }}>
                      {c.icon} {c.label}: {c.ok ? 'ON' : 'OFF'}
                    </div>
                  ))}
                  <div style={{ ...S, fontSize: 10, padding: '3px 8px', borderRadius: 5, fontWeight: 600, background: '#f0f4ff', color: PALETTE.blue }}>
                    🎨 {sacHealth.config?.stock_colors_count || 0} cores estoque
                  </div>
                </div>

                {/* KPIs gerais */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Conversões 7d', value: sacHealth.conversoes_7d || 0, icon: '🛒' },
                    { label: 'Faturado', value: 'R$ ' + Number(sacHealth.conversoes_valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0 }), icon: '💰' },
                    { label: 'Alertas estoque', value: sacHealth.alertas_pendentes || 0, icon: '📦' },
                    { label: 'Pós-venda abertas', value: sacHealth.posvenda_abertas || 0, icon: '💬' },
                  ].map((k, i) => (
                    <div key={i} style={{ flex: 1, minWidth: 80, background: PALETTE.cream, borderRadius: 6, padding: '6px 4px', textAlign: 'center' }}>
                      <div style={{ fontSize: 12 }}>{k.icon}</div>
                      <div style={{ ...S, fontSize: 13, fontWeight: 700, color: PALETTE.dark }}>{k.value}</div>
                      <div style={{ ...S, fontSize: 8, color: PALETTE.textLight }}>{k.label}</div>
                    </div>
                  ))}
                </div>

                {/* Por conta */}
                {['Exitus', 'Lumia', 'Muniam'].map(brand => {
                  const c = sacHealth.contas?.[brand];
                  if (!c) return null;
                  const tkColor = c.token_status === 'valido' ? '#27ae60' : c.token_status === 'expira_breve' ? '#e67e22' : '#c0392b';
                  const tkLabel = c.token_status === 'valido' ? '✅ Token OK' : c.token_status === 'expira_breve' ? '⚠️ Expira em breve' : c.token_status === 'expirado' ? '❌ Expirado' : '❓ Sem token';
                  const totalResp = c.ia_auto_24h + c.ia_low_24h + c.ausencia_24h;
                  const iaPct = c.perguntas_24h > 0 ? Math.round((c.ia_auto_24h / c.perguntas_24h) * 100) : 0;
                  const temProblema = c.token_status !== 'valido';
                  const webhookOk = c.ultimo_webhook && (new Date() - new Date(c.ultimo_webhook)) < 24 * 3600000;
                  return (
                    <div key={brand} style={{ background: temProblema ? '#fef5f5' : '#fafff5', border: `1px solid ${temProblema ? '#f4b8b8' : '#d4edc4'}`, borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <BrandTag brand={brand} />
                        <span style={{ ...S, fontSize: 9, fontWeight: 700, color: tkColor, padding: '2px 8px', borderRadius: 8, background: tkColor + '18' }}>{tkLabel}</span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 4, marginBottom: 6 }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ ...S, fontSize: 8, color: PALETTE.textLight }}>Perguntas 24h</div>
                          <div style={{ ...S, fontSize: 13, fontWeight: 700, color: PALETTE.dark }}>{c.perguntas_24h}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ ...S, fontSize: 8, color: PALETTE.textLight }}>✨ IA auto</div>
                          <div style={{ ...S, fontSize: 13, fontWeight: 700, color: '#27ae60' }}>{c.ia_auto_24h}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ ...S, fontSize: 8, color: PALETTE.textLight }}>🌙 Ausência</div>
                          <div style={{ ...S, fontSize: 13, fontWeight: 700, color: PALETTE.blue }}>{c.ausencia_24h}</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ ...S, fontSize: 8, color: PALETTE.textLight }}>📦 Estoque</div>
                          <div style={{ ...S, fontSize: 13, fontWeight: 700, color: c.estoque_pendentes > 0 ? '#e67e22' : PALETTE.dark }}>{c.estoque_pendentes}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ ...S, fontSize: 9, color: PALETTE.textLight }}>
                          Webhook: <span style={{ fontWeight: 700, color: webhookOk ? '#27ae60' : '#c0392b' }}>{webhookOk ? '✅ ativo' : '⚠️ sem atividade'}</span>
                        </div>
                        {c.perguntas_24h > 0 && (
                          <div style={{ ...S, fontSize: 9, color: PALETTE.textLight }}>
                            IA taxa: <span style={{ fontWeight: 700, color: iaPct > 40 ? '#27ae60' : '#e67e22' }}>{iaPct}%</span>
                          </div>
                        )}
                        {c.token_expires && (
                          <div style={{ ...S, fontSize: 9, color: PALETTE.textLight }}>
                            Token expira: {new Date(c.token_expires).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* CONTAS */}
        {configSection === 'contas' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {['Exitus', 'Lumia', 'Muniam'].map(brand => (
              <div key={brand} style={{
                background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8,
                padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <BrandTag brand={brand} />
                  <span style={{ ...S, fontSize: 12, color: PALETTE.dark }}>Conta {brand}</span>
                </div>
                <Btn small onClick={async () => {
                  try {
                    const data = await apiCall('/api/ml-auth?action=url');
                    window.open(data.url, '_blank');
                  } catch {}
                }}>Conectar</Btn>
              </div>
            ))}
            <Btn small onClick={async () => {
              try {
                const data = await apiCall('/api/ml-auth?action=status');
                setTokenStatus(data.tokens || []);
              } catch {}
            }}>🔄 Verificar Status</Btn>
            {tokenStatus.length > 0 && tokenStatus.map(t => (
              <div key={t.brand} style={{ ...S, fontSize: 11, color: t.active ? PALETTE.green : PALETTE.red }}>
                {t.brand}: {t.active ? '✓ Ativo' : '✕ Expirado'} — Seller: {t.seller_id}
              </div>
            ))}
          </div>
        )}

        {/* TEMPLATES */}
        {configSection === 'templates' && (
          <div>
            {['saudacao', 'mensagem', 'despedida'].map(field => (
              <div key={field} style={{ marginBottom: 12 }}>
                <div style={{ ...S, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: PALETTE.dark, marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{field === 'saudacao' ? '🌅 Saudação' : field === 'mensagem' ? '💬 Mensagem' : '👋 Despedida'}</span>
                  <Btn small onClick={() => {
                    const text = prompt('Texto do template:');
                    const shortcut = prompt('Atalho (ex: /novo):');
                    if (text && shortcut) {
                      const newTemplate = { id: `${field}_${Date.now()}`, text, shortcut, ctrlKey: '' };
                      const newConfig = { ...config };
                      newConfig.templates = { ...newConfig.templates };
                      newConfig.templates[field] = [...(newConfig.templates[field] || []), newTemplate];
                      saveConfig(newConfig);
                    }
                  }}>+ Novo</Btn>
                </div>
                {(config.templates?.[field] || []).map((t, i) => (
                  <div key={t.id} style={{
                    background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 6,
                    padding: '6px 10px', marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                  }}>
                    <span style={{ ...S, fontSize: 12, flex: 1 }}>{t.text}</span>
                    <code style={{ ...S, fontSize: 10, padding: '2px 6px', background: PALETTE.cream, borderRadius: 3, color: PALETTE.blue, fontWeight: 700 }}>{t.shortcut}</code>
                    {t.ctrlKey && <code style={{ ...S, fontSize: 10, padding: '2px 6px', background: PALETTE.cream, borderRadius: 3 }}>Ctrl+{t.ctrlKey}</code>}
                    <Btn small danger onClick={() => {
                      const newConfig = { ...config };
                      newConfig.templates = { ...newConfig.templates };
                      newConfig.templates[field] = newConfig.templates[field].filter(x => x.id !== t.id);
                      saveConfig(newConfig);
                    }}>✕</Btn>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* HORÁRIO */}
        {configSection === 'horario' && (
          <div style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ ...S, fontSize: 12, fontWeight: 700, marginBottom: 8, color: PALETTE.dark }}>Horário de Atendimento por Dia</div>
            {(config.schedule || []).map((day, i) => (
              <div key={day.day} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, opacity: day.active ? 1 : 0.4 }}>
                <label style={{ ...S, display: 'flex', alignItems: 'center', gap: 4, width: 85, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={day.active} onChange={() => {
                    const s = [...config.schedule];
                    s[i] = { ...s[i], active: !s[i].active };
                    saveConfig({ ...config, schedule: s });
                  }} />
                  {day.day}
                </label>
                {day.active && <>
                  <input type="time" value={day.start} onChange={e => {
                    const s = [...config.schedule];
                    s[i] = { ...s[i], start: e.target.value };
                    saveConfig({ ...config, schedule: s });
                  }} style={{ ...S, fontSize: 12, padding: '3px 4px', border: `1px solid ${PALETTE.border}`, borderRadius: 4 }} />
                  <span style={{ ...S, fontSize: 11, color: PALETTE.textLight }}>às</span>
                  <input type="time" value={day.end} onChange={e => {
                    const s = [...config.schedule];
                    s[i] = { ...s[i], end: e.target.value };
                    saveConfig({ ...config, schedule: s });
                  }} style={{ ...S, fontSize: 12, padding: '3px 4px', border: `1px solid ${PALETTE.border}`, borderRadius: 4 }} />
                </>}
              </div>
            ))}
          </div>
        )}

        {/* AUSÊNCIA */}
        {configSection === 'ausencia' && (
          <div style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ ...S, fontSize: 12, fontWeight: 700, marginBottom: 4, color: PALETTE.dark }}>🌙 Resposta Automática de Ausência</div>
            <div style={{ ...S, fontSize: 11, color: PALETTE.textLight, marginBottom: 8 }}>
              Disparada automaticamente fora do horário configurado
            </div>
            <textarea
              value={config.absence_message}
              onChange={e => saveConfig({ ...config, absence_message: e.target.value })}
              rows={3}
              style={{ ...S, width: '100%', padding: 8, fontSize: 12, border: `1px solid ${PALETTE.border}`, borderRadius: 5, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.4 }}
            />
            <label style={{ ...S, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={config.absence_enabled}
                onChange={() => saveConfig({ ...config, absence_enabled: !config.absence_enabled })} />
              Ativar resposta automática
            </label>
          </div>
        )}

        {/* IA */}
        {configSection === 'ia' && (
          <div style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ ...S, fontSize: 13, fontWeight: 700, marginBottom: 4, color: PALETTE.dark }}>✨ Configuração da IA</div>
            <div style={{ ...S, fontSize: 12, color: PALETTE.textLight, marginBottom: 8, lineHeight: 1.4 }}>
              A IA aprende com cada resposta enviada. Lê a descrição do anúncio + histórico de Q&A.
            </div>
            <div style={{ ...S, fontSize: 12, fontWeight: 700, color: PALETTE.dark, marginBottom: 3 }}>Tom de voz</div>
            <textarea
              value={config.ai_tone}
              onChange={e => saveConfig({ ...config, ai_tone: e.target.value })}
              rows={3}
              style={{ ...S, width: '100%', padding: 8, fontSize: 13, border: `1px solid ${PALETTE.border}`, borderRadius: 5, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.4 }}
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              <label style={{ ...S, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.ai_enabled}
                  onChange={() => saveConfig({ ...config, ai_enabled: !config.ai_enabled })} />
                Sugestões ativas
              </label>
              <label style={{ ...S, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.ai_read_description}
                  onChange={() => saveConfig({ ...config, ai_read_description: !config.ai_read_description })} />
                Ler descrição
              </label>
            </div>

            {/* Auto-resposta IA */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${PALETTE.sand}` }}>
              <div style={{ ...S, fontSize: 13, fontWeight: 700, color: PALETTE.dark, marginBottom: 4 }}>✨ Resposta Automática da IA</div>
              <div style={{ ...S, fontSize: 12, color: PALETTE.textLight, marginBottom: 8, lineHeight: 1.4 }}>
                A IA responde automaticamente <b>fora do horário de atendimento</b> (configurado na aba Horários). Quando tem alta confiança, envia a resposta. Se não tiver confiança, envia a mensagem padrão abaixo.
              </div>
              <label style={{ ...S, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginBottom: 10, padding: '8px 12px', background: config.ai_auto_enabled ? PALETTE.greenLight : PALETTE.sand, borderRadius: 6 }}>
                <input type="checkbox" checked={config.ai_auto_enabled || false}
                  onChange={() => saveConfig({ ...config, ai_auto_enabled: !config.ai_auto_enabled })} />
                <b>IA responde fora do horário de atendimento</b>
              </label>

              {config.ai_auto_enabled && (
                <div>
                  <div style={{ ...S, fontSize: 12, fontWeight: 700, color: PALETTE.dark, marginBottom: 3 }}>Mensagem quando sem confiança</div>
                  <textarea
                    value={config.ai_low_confidence_msg || ''}
                    onChange={e => saveConfig({ ...config, ai_low_confidence_msg: e.target.value })}
                    rows={2}
                    style={{ ...S, width: '100%', padding: 8, fontSize: 13, border: `1px solid ${PALETTE.border}`, borderRadius: 5, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.4 }}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ALERTAS */}
        {configSection === 'alertas' && (
          <div style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ ...S, fontSize: 12, fontWeight: 700, marginBottom: 8, color: PALETTE.dark }}>🔔 Thresholds de Alerta (minutos)</div>
            {[
              { key: 'alert_warning', label: '⚠️ Atenção (amarelo)', def: 15 },
              { key: 'alert_urgent', label: '🔴 Urgente (vermelho)', def: 30 },
              { key: 'alert_critical', label: '🚨 Crítico (notificação)', def: 60 },
            ].map(a => (
              <div key={a.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ ...S, fontSize: 12, color: PALETTE.dark, width: 180 }}>{a.label}</span>
                <input type="number" value={config[a.key] || a.def}
                  onChange={e => saveConfig({ ...config, [a.key]: Number(e.target.value) })}
                  style={{ ...S, width: 55, padding: '3px 6px', fontSize: 12, border: `1px solid ${PALETTE.border}`, borderRadius: 4, textAlign: 'center' }} />
                <span style={{ ...S, fontSize: 11, color: PALETTE.textLight }}>min</span>
              </div>
            ))}
          </div>
        )}

        {/* TREINAMENTO IA */}
        {configSection === 'treinamento' && (
          <div style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ ...S, fontSize: 13, fontWeight: 700, marginBottom: 4, color: PALETTE.dark }}>📚 Treinar IA — Adicionar Perguntas e Respostas</div>
            <div style={{ ...S, fontSize: 12, color: PALETTE.textLight, marginBottom: 10, lineHeight: 1.4 }}>
              Adicione perguntas e respostas reais pra IA aprender. Vale pra todas as lojas (Exitus, Lumia, Muniam).
            </div>
            <div style={{ marginBottom: 6 }}>
              <div style={{ ...S, fontSize: 12, fontWeight: 700, color: PALETTE.dark, marginBottom: 2 }}>Pergunta do cliente</div>
              <textarea id="qa-pergunta" rows={2} placeholder="Ex: Esse vestido veste bem quem usa 42?"
                style={{ ...S, width: '100%', padding: 8, fontSize: 13, border: `1px solid ${PALETTE.border}`, borderRadius: 5, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.4 }} />
            </div>
            <div style={{ marginBottom: 6 }}>
              <div style={{ ...S, fontSize: 12, fontWeight: 700, color: PALETTE.dark, marginBottom: 2 }}>Resposta ideal</div>
              <textarea id="qa-resposta" rows={3} placeholder="Ex: Olá! Sim, o tamanho G corresponde ao 42..."
                style={{ ...S, width: '100%', padding: 8, fontSize: 13, border: `1px solid ${PALETTE.border}`, borderRadius: 5, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.4 }} />
            </div>
            <Btn primary small onClick={async () => {
              const pergunta = document.getElementById('qa-pergunta')?.value?.trim();
              const resposta = document.getElementById('qa-resposta')?.value?.trim();
              if (!pergunta || !resposta) { alert('Preencha pergunta e resposta'); return; }
              try {
                if (supabase) {
                  const brands = ['Exitus', 'Lumia', 'Muniam'];
                  await Promise.all(brands.map(brand =>
                    supabase.from('ml_qa_history').insert({
                      brand, item_id: 'MANUAL', question_text: pergunta, answer_text: resposta,
                      answered_by: currentUser || 'admin', answered_at: new Date().toISOString(),
                    })
                  ));
                  document.getElementById('qa-pergunta').value = '';
                  document.getElementById('qa-resposta').value = '';
                  alert('✅ Salvo pra Exitus, Lumia e Muniam! A IA vai usar como referência.');
                }
              } catch (err) { alert('Erro: ' + err.message); }
            }}>💾 Salvar pra todas as lojas</Btn>

            {/* Quiz: IA quer aprender */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${PALETTE.sand}` }}>
              <div style={{ ...S, fontSize: 13, fontWeight: 700, color: PALETTE.dark, marginBottom: 4 }}>🧠 IA quer aprender</div>
              <div style={{ ...S, fontSize: 12, color: PALETTE.textLight, marginBottom: 8, lineHeight: 1.4 }}>
                A IA gera perguntas que não sabe responder bem. Você confirma ou corrige — e ela aprende.
              </div>
              <Btn small onClick={async () => {
                try {
                  const data = await apiCall('/api/ml-ai', {
                    method: 'POST',
                    body: JSON.stringify({
                      question_text: '_QUIZ_MODE_',
                      item_id: '',
                      brand: 'Exitus',
                    }),
                  });
                  if (data.suggestion) {
                    document.getElementById('qa-pergunta').value = data.suggestion;
                    document.getElementById('qa-resposta').value = '';
                    document.getElementById('qa-resposta').focus();
                    alert('A IA gerou uma pergunta acima. Escreva a resposta correta e salve!');
                  } else {
                    alert('A IA não tem dúvidas no momento. Continue respondendo perguntas normalmente.');
                  }
                } catch (err) { alert('Erro: ' + err.message); }
              }}>🧠 Gerar pergunta pra eu responder</Btn>
            </div>

            {/* Stock Colors: cores disponíveis pra oferta de estoque */}
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${PALETTE.sand}` }}>
              <div style={{ ...S, fontSize: 13, fontWeight: 700, color: PALETTE.dark, marginBottom: 4 }}>🎨 Cores Disponíveis pra Estoque</div>
              <div style={{ ...S, fontSize: 12, color: PALETTE.textLight, marginBottom: 8, lineHeight: 1.4 }}>
                Quando um cliente perguntar sobre essas cores, a IA oferece incluir no estoque. Cores fora da lista recebem resposta genérica de reposição.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {(config.stock_colors || []).map((cor, i) => (
                  <div key={i} style={{ ...S, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: PALETTE.cream, border: `1px solid ${PALETTE.border}`, borderRadius: 6, fontSize: 11 }}>
                    <span style={{ fontWeight: 700, color: PALETTE.dark }}>{cor.nome}</span>
                    <span style={{ fontSize: 9, color: PALETTE.textLight }}>({cor.aliases.join(', ')})</span>
                    <button onClick={() => {
                      const updated = (config.stock_colors || []).filter((_, j) => j !== i);
                      saveConfig({ ...config, stock_colors: updated });
                    }} style={{ background: 'none', border: 'none', color: PALETTE.red, cursor: 'pointer', fontSize: 12, padding: 0, marginLeft: 2 }}>×</button>
                  </div>
                ))}
                {(!config.stock_colors || config.stock_colors.length === 0) && (
                  <div style={{ ...S, fontSize: 11, color: PALETTE.orange }}>⚠ Nenhuma cor cadastrada. Usando padrão: Preto, Bege, Figo, Marrom, Marrom Escuro, Azul Marinho, Vinho</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ ...S, fontSize: 10, color: PALETTE.textLight, marginBottom: 2 }}>Nome da cor</div>
                  <input value={stockColorInput} onChange={e => setStockColorInput(e.target.value)} placeholder="Ex: Verde Sálvia" style={{ ...S, width: '100%', border: `1px solid ${PALETTE.border}`, borderRadius: 5, padding: '5px 8px', fontSize: 11, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ ...S, fontSize: 10, color: PALETTE.textLight, marginBottom: 2 }}>Variações (vírgula)</div>
                  <input value={stockAliasInput} onChange={e => setStockAliasInput(e.target.value)} placeholder="Ex: verde salvia, pistache" style={{ ...S, width: '100%', border: `1px solid ${PALETTE.border}`, borderRadius: 5, padding: '5px 8px', fontSize: 11, boxSizing: 'border-box' }} />
                </div>
                <Btn primary small onClick={() => {
                  if (!stockColorInput.trim()) return;
                  const aliases = stockAliasInput ? stockAliasInput.split(',').map(a => a.trim().toLowerCase()).filter(Boolean) : [stockColorInput.trim().toLowerCase()];
                  const updated = [...(config.stock_colors || []), { nome: stockColorInput.trim(), aliases }];
                  saveConfig({ ...config, stock_colors: updated });
                  setStockColorInput(''); setStockAliasInput('');
                }}>+ Adicionar</Btn>
              </div>
            </div>
          </div>
        )}

        {/* TREINAMENTO PÓS-VENDA */}
        {configSection === 'treinamento_pv' && (
          <div style={{ background: PALETTE.white, border: `1px solid ${PALETTE.border}`, borderRadius: 8, padding: 12 }}>
            <div style={{ ...S, fontSize: 13, fontWeight: 700, marginBottom: 4, color: PALETTE.dark }}>📚 Treinar IA — Pós-Venda</div>
            <div style={{ ...S, fontSize: 12, color: PALETTE.textLight, marginBottom: 10, lineHeight: 1.4 }}>
              Adicione situações reais de pós-venda e respostas ideais. A IA usa como referência nas sugestões.
            </div>
            <div style={{ marginBottom: 6 }}>
              <div style={{ ...S, fontSize: 12, fontWeight: 700, color: PALETTE.dark, marginBottom: 2 }}>Situação do cliente</div>
              <textarea id="qa-pv-situacao" rows={2} placeholder='Ex: "Recebi o produto com defeito"'
                style={{ ...S, width: '100%', padding: 8, fontSize: 13, border: `1px solid ${PALETTE.border}`, borderRadius: 5, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.4 }} />
            </div>
            <div style={{ marginBottom: 6 }}>
              <div style={{ ...S, fontSize: 12, fontWeight: 700, color: PALETTE.dark, marginBottom: 2 }}>Resposta ideal</div>
              <textarea id="qa-pv-resposta" rows={3} placeholder='Ex: "Lamentamos o ocorrido! Vamos resolver..."'
                style={{ ...S, width: '100%', padding: 8, fontSize: 13, border: `1px solid ${PALETTE.border}`, borderRadius: 5, resize: 'vertical', boxSizing: 'border-box', lineHeight: 1.4 }} />
            </div>
            <Btn primary small onClick={async () => {
              const situacao = document.getElementById('qa-pv-situacao')?.value?.trim();
              const resposta = document.getElementById('qa-pv-resposta')?.value?.trim();
              if (!situacao || !resposta) { alert('Preencha situação e resposta'); return; }
              try {
                const brands = ['Exitus', 'Lumia', 'Muniam'];
                await Promise.all(brands.map(brand =>
                  supabase.from('ml_qa_history_posvenda').insert({
                    brand, situation_text: situacao, answer_text: resposta,
                    answered_by: currentUser || 'admin', answered_at: new Date().toISOString(),
                  })
                ));
                document.getElementById('qa-pv-situacao').value = '';
                document.getElementById('qa-pv-resposta').value = '';
                alert('✅ Salvo pra Exitus, Lumia e Muniam!');
              } catch (err) { alert('Erro: ' + err.message); }
            }}>💾 Salvar pra todas as lojas</Btn>
          </div>
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  // MAIN RENDER
  // ══════════════════════════════════════════════════════════

  const pages = [
    { id: 'respostas', label: '💬 Perguntas', badge: 0 },
    { id: 'dashboard', label: '📊 Dashboard', badge: 0 },
    { id: 'config', label: '⚙️ Config', badge: 0 },
  ];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: PALETTE.dark, padding: '12px 14px', borderRadius: '8px 8px 0 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🎧</span>
          <div>
            <div style={{ ...S, color: '#fff', fontWeight: 700, fontSize: 15 }}>SAC</div>
            <div style={{ ...S, color: '#ffffff77', fontSize: 10 }}>
              Sync: {lastSync ? new Date(lastSync).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
              {' · '}{currentUser}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setShowTemplates(!showTemplates)} style={{ ...S, background: '#ffffff22', color: '#fff', border: '1px solid #ffffff33', borderRadius: 6, padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>⚡ Rápidas</button>
          <button onClick={() => { fetchQuestions(); fetchLocks(); }} style={{ ...S, background: '#ffffff22', color: '#fff', border: '1px solid #ffffff33', borderRadius: 6, padding: '4px 8px', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}>🔄</button>
          <span style={{ ...S, background: '#ffffff18', padding: '3px 8px', borderRadius: 10, fontSize: 10, color: '#fff' }}>
          {Object.keys(locks).length > 0 ? `🔒 ${Object.keys(locks).length} em atendimento` : '🟢 Online'}
          </span>
        </div>
      </div>

      {/* Page tabs */}
      <div style={{ display: 'flex', background: PALETTE.white, borderBottom: `1px solid ${PALETTE.border}` }}>
        {pages.map(p => (
          <button key={p.id} onClick={() => {
            setPage(p.id);
            if (p.id === 'dashboard') { fetchAnswered(); fetchConversions(); }
          }} style={{
            ...S, flex: 1, padding: '9px 0', fontSize: 12, fontWeight: 600,
            border: 'none', cursor: 'pointer',
            background: page === p.id ? PALETTE.cream : PALETTE.white,
            color: page === p.id ? PALETTE.dark : PALETTE.textLight,
            borderBottom: page === p.id ? `3px solid ${PALETTE.blue}` : '3px solid transparent',
          }}>
            {p.label}
            {p.badge > 0 && <Badge count={p.badge} />}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: 12, background: PALETTE.cream, borderRadius: '0 0 8px 8px', minHeight: 300 }}>
        {page === 'respostas' && renderRespostas()}
        {page === 'dashboard' && renderDashboard()}
        {page === 'config' && renderConfig()}
      </div>
    </div>
  );
}
