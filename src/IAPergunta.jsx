/**
 * IAPergunta.jsx — Módulo "Perguntar à IA" (Sprint 8)
 * ══════════════════════════════════════════════════════════════════════
 *
 * Componente standalone. Igual padrão MLPerguntas.jsx:
 *   - NÃO importa de App.tsx
 *   - localStorage + Supabase pra persistência
 *   - Paleta/tipografia do app (Georgia serif + Calibri sans)
 *
 * Exports:
 *   default IAPergunta  — modal principal (todos os users)
 *   IAPerguntaAdminPanel — painel admin (só admin acessa)
 *
 * Integração no App.tsx:
 *   import IAPergunta from './IAPergunta';
 *   // No cabeçalho, última posição à direita:
 *   <button onClick={() => setIaOpen(true)}>🤖</button>
 *   {iaOpen && <IAPergunta supabase={supabase} usuarioLogado={usuarioLogado}
 *                          onClose={() => setIaOpen(false)} />}
 *
 * Props do IAPergunta:
 *   - supabase: cliente Supabase compartilhado
 *   - usuarioLogado: { id, usuario, admin, ... }
 *   - onClose: callback quando user fecha o modal
 * ══════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ══════════════════════════════════════════════════════════
// CONSTANTS & PALETTE
// ══════════════════════════════════════════════════════════

const LS_KEY = 'amica_ia_pergunta';
const CONFIG_KEY = 'ia-pergunta-config';

const C = {
  appBg: '#f7f4f0',
  cream: '#e8e2da',
  border: '#d5cec6',
  blueDark: '#2c3e50',
  blue: '#4a7fa5',
  text: '#2c3e50',
  textSoft: '#4a4a4a',
  muted: '#7a7a7a',
  iaBg: '#EAE0D5',
  iaDark: '#373F51',
  iaDarker: '#1C2533',
  critical: '#c0392b',
  criticalBg: '#fdeaea',
  warning: '#c8a040',
  warningBg: '#faf6ec',
  success: '#27ae60',
  successBg: '#eafbf0',
};

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'Calibri, "Segoe UI", Arial, sans-serif';

// Cores p/ chips e dots da matriz (mesmo mapeamento do módulo Oficina)
const COR_DOTS = {
  'bege':          '#c9b89e',
  'preto':         '#1a1a1a',
  'marrom':        '#5c3a1e',
  'marrom escuro': '#3a2412',
  'figo':          '#5a2d3a',
  'azul marinho':  '#1f2b4a',
  'caramelo':      '#a0632c',
  'nude':          '#d8b89c',
  'vinho':         '#5c1a2e',
  'verde militar': '#4a5240',
  'verde sálvia':  '#8ea892',
  'azul serenity': '#7fa0c8',
  'azul claro':    '#a8c4dc',
  'branco':        '#f5f5f5',
  'off-white':     '#ebe5d6',
  'offwhite':      '#ebe5d6',
};

function dotColor(nome) {
  const k = String(nome || '').toLowerCase().trim();
  return COR_DOTS[k] || '#a0a0a0';
}


// ══════════════════════════════════════════════════════════
// DATA LAYER (localStorage + Supabase)
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
  } catch (e) { console.error('[IAPergunta] ls save:', e); }
}


// ══════════════════════════════════════════════════════════
// API CALLS
// ══════════════════════════════════════════════════════════

async function apiPerguntar({ pergunta, user_id }) {
  const r = await fetch('/api/ia-pergunta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pergunta, user_id }),
  });
  return r.json();
}

async function apiHistorico({ requester_id, user_id, periodo = 'hoje' }) {
  const params = new URLSearchParams({ acao: 'historico', periodo });
  if (user_id) params.set('user_id', user_id);
  const r = await fetch(`/api/ia-pergunta-admin?${params}`, {
    headers: { 'X-User-Id': String(requester_id) },
  });
  return r.json();
}

async function apiStats({ requester_id }) {
  const r = await fetch('/api/ia-pergunta-admin?acao=stats', {
    headers: { 'X-User-Id': String(requester_id) },
  });
  return r.json();
}


// ══════════════════════════════════════════════════════════
// UI: BOTÃO DO CABEÇALHO (exportado pra App.tsx usar)
// ══════════════════════════════════════════════════════════

export const IABotaoCabecalho = ({ onClick }) => (
  <button
    onClick={onClick}
    title="Perguntar à IA"
    style={{
      background: C.iaDarker, color: C.iaBg,
      border: 'none', borderRadius: 8,
      padding: '7px 12px', cursor: 'pointer',
      fontSize: 14, fontFamily: SERIF, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}
  >🤖 <span style={{ fontSize: 11, fontFamily: SANS }}>Perguntar à IA</span></button>
);


// ══════════════════════════════════════════════════════════
// UI: MATRIZ DE CORES (igual módulo Oficina)
// ══════════════════════════════════════════════════════════

const MatrizRender = ({ matriz }) => {
  if (!matriz) return null;
  const { cores = [], tamanhos = [], total_folhas, total_pecas, qtd_manual, qtd_calculada } = matriz;
  const tams = Array.isArray(tamanhos) && tamanhos.length ? tamanhos : ['P','M','G','GG'];
  const qtdOk = qtd_manual != null && qtd_calculada != null && qtd_manual === qtd_calculada;

  return (
    <div style={{
      background: C.appBg, border: `1px solid ${C.cream}`, borderRadius: 8,
      padding: 10, margin: '8px 0', fontFamily: SANS,
    }}>
      {/* Folhas por cor */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8,
        paddingBottom: 8, marginBottom: 8,
        borderBottom: `1px solid ${C.cream}`, alignItems: 'center',
      }}>
        <span style={{
          fontSize: 9.5, color: C.muted, letterSpacing: 0.3,
          textTransform: 'uppercase', width: '100%', marginBottom: 2,
        }}>Folhas por cor</span>
        {cores.map((c, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            fontSize: 11, color: C.text,
          }}>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: dotColor(c.nome),
              border: '1px solid rgba(0,0,0,0.1)',
            }} />
            {c.nome} <strong style={{ color: C.blueDark }}>{c.folhas}</strong>
          </div>
        ))}
        {total_folhas != null && (
          <div style={{
            marginLeft: 'auto', fontSize: 10, fontWeight: 600, color: C.text,
          }}>Total: <strong>{total_folhas}</strong></div>
        )}
      </div>

      <div style={{
        textAlign: 'center', fontFamily: SERIF, fontSize: 10,
        color: C.blueDark, letterSpacing: 0.5, textTransform: 'uppercase',
        marginBottom: 6, fontWeight: 600,
      }}>Matriz · Peças por tamanho × cor</div>

      {/* Tabela */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{
              fontSize: 9.5, color: C.muted, letterSpacing: 0.3,
              textTransform: 'uppercase', padding: '4px 6px',
              textAlign: 'left', fontWeight: 600,
              borderBottom: `1px solid ${C.cream}`,
            }}>Cor</th>
            {tams.map(t => (
              <th key={t} style={{
                fontSize: 9.5, color: C.muted, letterSpacing: 0.3,
                textTransform: 'uppercase', padding: '4px 6px',
                textAlign: 'center', fontWeight: 600,
                borderBottom: `1px solid ${C.cream}`,
              }}>{t}</th>
            ))}
            <th style={{
              fontSize: 9.5, color: C.blueDark, letterSpacing: 0.3,
              textTransform: 'uppercase', padding: '4px 6px',
              textAlign: 'center', fontWeight: 600,
              borderBottom: `1px solid ${C.cream}`,
            }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {cores.map((c, i) => (
            <tr key={i}>
              <td style={{
                padding: '5px 6px',
                display: 'flex', alignItems: 'center', gap: 6,
                fontWeight: 500,
                borderBottom: `1px dashed ${C.cream}`,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: dotColor(c.nome),
                  border: '1px solid rgba(0,0,0,0.12)',
                }} />
                {c.nome}
              </td>
              {tams.map(t => (
                <td key={t} style={{
                  padding: '5px 6px', textAlign: 'center', color: C.text,
                  borderBottom: `1px dashed ${C.cream}`,
                }}>{c[t] ?? c.grade?.[t] ?? 0}</td>
              ))}
              <td style={{
                padding: '5px 6px', textAlign: 'center',
                fontWeight: 700, color: C.blueDark,
                borderBottom: `1px dashed ${C.cream}`,
              }}>{c.total ?? c.total_pecas ?? 0}</td>
            </tr>
          ))}
          <tr>
            <td style={{
              borderTop: `1.5px solid ${C.blueDark}`, paddingTop: 6,
              fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase',
              fontWeight: 700, color: C.blueDark,
            }}>Total</td>
            {tams.map(t => {
              const soma = cores.reduce((s, c) => s + (c[t] ?? c.grade?.[t] ?? 0), 0);
              return (
                <td key={t} style={{
                  borderTop: `1.5px solid ${C.blueDark}`, paddingTop: 6,
                  textAlign: 'center', fontWeight: 700, color: C.blueDark,
                }}>{soma}</td>
              );
            })}
            <td style={{
              borderTop: `1.5px solid ${C.blueDark}`, paddingTop: 6,
              textAlign: 'center', fontWeight: 700, color: C.blueDark,
            }}>{total_pecas || cores.reduce((s, c) => s + (c.total ?? 0), 0)}</td>
          </tr>
        </tbody>
      </table>

      {/* Validador */}
      {(qtd_manual != null || qtd_calculada != null) && (
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.cream}`,
          display: 'flex', alignItems: 'center', gap: 14, fontSize: 10,
        }}>
          <div>
            <span style={{
              color: C.muted, fontSize: 8.5, letterSpacing: 0.4,
              textTransform: 'uppercase', display: 'block',
            }}>Qtd manual</span>
            <span style={{ color: C.blueDark, fontWeight: 700, fontSize: 13 }}>{qtd_manual}</span>
          </div>
          <div>
            <span style={{
              color: C.muted, fontSize: 8.5, letterSpacing: 0.4,
              textTransform: 'uppercase', display: 'block',
            }}>Qtd calculada</span>
            <span style={{ color: C.blueDark, fontWeight: 700, fontSize: 13 }}>{qtd_calculada}</span>
          </div>
          <div style={{
            marginLeft: 'auto', color: qtdOk ? C.success : C.warning,
            fontWeight: 700, fontSize: 10, letterSpacing: 0.3,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>{qtdOk ? '✓ Quantidade OK' : '⚠ Divergência'}</div>
        </div>
      )}
    </div>
  );
};


// ══════════════════════════════════════════════════════════
// UI: ÍCONES DE CATEGORIA
// ══════════════════════════════════════════════════════════

const CAT_META = {
  estoque:  { label: 'Estoque',  icon: '📦', bg: '#e8ddd3', fg: '#8a6500' },
  producao: { label: 'Produção', icon: '✂️', bg: '#d8e3d9', fg: '#1a5d2e' },
  produto:  { label: 'Produto',  icon: '🛒', bg: '#dde6f0', fg: '#2a4d6e' },
  ficha:    { label: 'Ficha',    icon: '💎', bg: '#f0ddcf', fg: '#7a4a1f' },
  outros:   { label: 'Geral',    icon: '💬', bg: C.cream,   fg: C.muted },
};

const CategoriaChip = ({ categoria }) => {
  const meta = CAT_META[categoria] || CAT_META.outros;
  return (
    <span style={{
      fontSize: 10, padding: '2px 8px', borderRadius: 10,
      background: meta.bg, color: meta.fg, fontFamily: SANS,
      textTransform: 'uppercase', letterSpacing: 0.2, fontWeight: 600,
    }}>{meta.icon} {meta.label}</span>
  );
};


// ══════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL: IAPergunta
// ══════════════════════════════════════════════════════════

export default function IAPergunta({ supabase, usuarioLogado, onClose }) {
  const [tab, setTab] = useState('perguntar'); // 'perguntar' | 'historico'
  const [mensagens, setMensagens] = useState([]); // [{role:'user'|'ia', text, matriz, categoria, time}]
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [adminOpen, setAdminOpen] = useState(false);

  const chatRef = useRef(null);

  const isAdmin = usuarioLogado?.admin === true;
  const userId = usuarioLogado?.id;
  const userName = usuarioLogado?.usuario || 'usuário';

  // Load mensagens locais da sessão atual (user só vê as dele)
  useEffect(() => {
    const local = loadLocal();
    if (local?.mensagens?.[userId]) {
      setMensagens(local.mensagens[userId]);
    }
  }, [userId]);

  // Autoscroll no chat
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [mensagens, loading]);

  // Busca histórico quando aba histórico é aberta
  useEffect(() => {
    if (tab === 'historico' && userId) {
      apiHistorico({ requester_id: userId, user_id: isAdmin ? null : userId, periodo: 'hoje' })
        .then(r => setHistorico(r.historico || []))
        .catch(e => console.error('[IAPergunta] historico:', e));
    }
  }, [tab, userId, isAdmin]);

  const enviarPergunta = async () => {
    const q = input.trim();
    if (!q || loading) return;

    setErro(null);
    setInput('');

    const novaMsgUser = { role: 'user', text: q, time: new Date().toISOString() };
    const novas = [...mensagens, novaMsgUser];
    setMensagens(novas);
    persistirMensagens(novas);
    setLoading(true);

    try {
      const r = await apiPerguntar({ pergunta: q, user_id: userId });

      if (r.limite_estourado) {
        const msg = {
          role: 'blocked',
          text: `🛑 Limite diário estourado. O time já usou ${r.usado} de ${r.limite} perguntas hoje. Volta amanhã às 00:00 ou peça pro admin liberar mais.`,
          time: new Date().toISOString(),
        };
        const atuais = [...novas, msg];
        setMensagens(atuais);
        persistirMensagens(atuais);
        return;
      }
      if (r.orcamento_esgotado) {
        const msg = {
          role: 'blocked',
          text: `🛑 Orçamento do mês atingiu ${r.hard_stop_pct}% do teto (R$ ${r.gasto_brl} de R$ ${r.limite_brl}). Fala com o Ailson.`,
          time: new Date().toISOString(),
        };
        const atuais = [...novas, msg];
        setMensagens(atuais);
        persistirMensagens(atuais);
        return;
      }
      if (!r.ok) {
        throw new Error(r.error || 'Erro desconhecido');
      }

      const msgIA = {
        role: 'ia',
        text: r.resposta_texto,
        matriz: r.matriz_render,
        categoria: r.categoria,
        time: new Date().toISOString(),
      };
      const atuais = [...novas, msgIA];
      setMensagens(atuais);
      persistirMensagens(atuais);
    } catch (e) {
      setErro(e.message || 'Erro ao perguntar à IA');
    } finally {
      setLoading(false);
    }
  };

  const persistirMensagens = (msgs) => {
    const local = loadLocal() || { mensagens: {} };
    if (!local.mensagens) local.mensagens = {};
    // Guarda últimas 30 mensagens por user (evita stuffar localStorage)
    local.mensagens[userId] = msgs.slice(-30);
    saveLocal(local);
  };

  // Detecta mobile pelo viewport (pra ajustar layout do modal)
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 720;

  // Se admin abriu o painel, renderiza ele em vez do modal de chat
  if (adminOpen) {
    return (
      <IAPerguntaAdminPanel
        supabase={supabase}
        usuarioLogado={usuarioLogado}
        onClose={() => setAdminOpen(false)}
        onBackToChat={() => setAdminOpen(false)}
      />
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: isMobile ? 'flex-end' : 'center',
      justifyContent: 'center',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.appBg,
        borderRadius: isMobile ? '16px 16px 0 0' : 12,
        width: isMobile ? '100%' : 600,
        height: isMobile ? '92%' : 640,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 -10px 40px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{
          background: C.iaDarker, color: '#fff',
          padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, background: C.iaBg, color: C.iaDarker,
            borderRadius: '50%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 17,
          }}>🤖</div>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 15, fontWeight: 700 }}>Perguntar à IA</div>
            <div style={{ fontFamily: SANS, fontSize: 10, color: '#b0b8c8', marginTop: 1 }}>
              {isAdmin ? 'Admin · sem limite · acesso a valores em R$' : 'Estoque · Produção · Produtos · Ficha técnica'}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {isAdmin && (
              <button onClick={() => setAdminOpen(true)} style={{
                background: C.iaBg, color: C.iaDarker, border: 'none',
                fontFamily: SANS, fontSize: 11, padding: '6px 10px',
                borderRadius: 6, cursor: 'pointer', fontWeight: 600,
              }}>👥 Admin</button>
            )}
            <button onClick={onClose} style={{
              background: 'transparent', border: 'none', color: '#fff',
              cursor: 'pointer', fontSize: 20, padding: '4px 8px',
            }}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ background: '#fff', borderBottom: `1px solid ${C.cream}`, display: 'flex' }}>
          {[
            { id: 'perguntar', label: '💬 Perguntar' },
            { id: 'historico', label: '🕐 Histórico' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, background: 'transparent', border: 'none',
              padding: 10, cursor: 'pointer', fontFamily: SANS,
              fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
              color: tab === t.id ? C.iaDarker : C.muted,
              borderBottom: `2px solid ${tab === t.id ? C.iaDarker : 'transparent'}`,
              textTransform: 'uppercase',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Corpo */}
        {tab === 'perguntar' ? (
          <>
            <div ref={chatRef} style={{
              flex: 1, overflowY: 'auto', padding: 16,
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {mensagens.length === 0 && !loading && (
                <EmptyState />
              )}
              {mensagens.map((m, i) => (
                <MensagemRender key={i} msg={m} />
              ))}
              {loading && (
                <div style={{
                  alignSelf: 'flex-start', padding: '10px 14px',
                  background: '#fff', borderRadius: 14,
                  border: `1px solid ${C.cream}`,
                  borderBottomLeftRadius: 4,
                  color: C.muted, fontStyle: 'italic',
                  fontFamily: SANS, fontSize: 13.5,
                }}>
                  IA pensando
                  <span style={{ display: 'inline-flex', gap: 3, marginLeft: 4, verticalAlign: 'middle' }}>
                    {[0, 200, 400].map((d, i) => (
                      <span key={i} style={{
                        width: 5, height: 5, background: C.muted, borderRadius: '50%',
                        animation: `iapergunta_typing 1.2s infinite ${d}ms`,
                      }} />
                    ))}
                  </span>
                </div>
              )}
              {erro && (
                <div style={{
                  alignSelf: 'center', background: C.criticalBg,
                  color: C.critical, border: `1px solid ${C.critical}`,
                  borderRadius: 10, padding: 10, fontSize: 12, fontFamily: SANS,
                  maxWidth: '90%',
                }}>⚠ {erro}</div>
              )}
            </div>

            {/* Input area */}
            <div style={{
              background: '#fff', padding: '10px 12px',
              borderTop: `1px solid ${C.cream}`,
            }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      enviarPergunta();
                    }
                  }}
                  placeholder={loading ? 'Aguarde...' : 'Pergunta o que quiser sobre estoque, produção, produtos...'}
                  disabled={loading}
                  rows={1}
                  style={{
                    flex: 1, border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '9px 12px', fontFamily: SANS, fontSize: 14,
                    outline: 'none', resize: 'none',
                    background: loading ? '#eee' : C.appBg, color: C.text,
                    minHeight: 38, maxHeight: 90,
                  }}
                />
                <button
                  onClick={enviarPergunta}
                  disabled={loading || !input.trim()}
                  style={{
                    background: loading || !input.trim() ? C.cream : C.iaDarker,
                    color: loading || !input.trim() ? C.muted : C.iaBg,
                    border: 'none', borderRadius: 10, padding: '10px 14px',
                    cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                    fontSize: 16, minWidth: 42,
                  }}
                >➤</button>
              </div>
            </div>
          </>
        ) : (
          <HistoricoTab historico={historico} isAdmin={isAdmin} />
        )}
      </div>
      <style>{`
        @keyframes iapergunta_typing {
          0%, 60%, 100% { opacity: 0.3; }
          30% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}


// ══════════════════════════════════════════════════════════
// SUB: Empty state
// ══════════════════════════════════════════════════════════

const EmptyState = () => (
  <div style={{
    textAlign: 'center', padding: '40px 20px',
    color: C.muted, fontFamily: SANS, fontSize: 13, lineHeight: 1.6,
  }}>
    <div style={{ fontSize: 42, marginBottom: 12, opacity: 0.5 }}>💬</div>
    <div>Me pergunta qualquer coisa sobre<br/>estoque, produção ou produtos.</div>
    <div style={{ fontStyle: 'italic', fontSize: 11, color: C.muted, marginTop: 14 }}>
      Ex: "Quantas peças da 2277 tão em produção?"<br/>
      ou "Qual cor mais vende esse mês?"
    </div>
  </div>
);


// ══════════════════════════════════════════════════════════
// SUB: Mensagem (user, ia, blocked)
// ══════════════════════════════════════════════════════════

const MensagemRender = ({ msg }) => {
  if (msg.role === 'user') {
    return (
      <div style={{ alignSelf: 'flex-end', maxWidth: '85%' }}>
        <div style={{
          padding: '10px 14px', background: C.blue, color: '#fff',
          borderRadius: 14, borderBottomRightRadius: 4,
          fontFamily: SANS, fontSize: 13.5, lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
        }}>{msg.text}</div>
        <div style={{
          fontFamily: SANS, fontSize: 9.5, color: C.muted,
          marginTop: 2, textAlign: 'right', padding: '0 6px',
        }}>{formatTime(msg.time)}</div>
      </div>
    );
  }

  if (msg.role === 'blocked') {
    return (
      <div style={{
        alignSelf: 'center', background: C.warningBg, color: '#8a6500',
        border: `1px solid ${C.warning}`, borderRadius: 10,
        padding: '12px 16px', fontSize: 12, fontFamily: SANS,
        textAlign: 'center', maxWidth: '92%', lineHeight: 1.5,
      }}>{msg.text}</div>
    );
  }

  // msg.role === 'ia'
  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '90%' }}>
      <div style={{
        padding: '10px 14px', background: '#fff', color: C.text,
        border: `1px solid ${C.cream}`, borderRadius: 14,
        borderBottomLeftRadius: 4,
        fontFamily: SANS, fontSize: 13.5, lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
      }}>
        {msg.text}
        {msg.matriz && <MatrizRender matriz={msg.matriz} />}
      </div>
      <div style={{
        fontFamily: SANS, fontSize: 9.5, color: C.muted,
        marginTop: 2, padding: '0 6px',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {formatTime(msg.time)}
        {msg.categoria && <CategoriaChip categoria={msg.categoria} />}
      </div>
    </div>
  );
};


// ══════════════════════════════════════════════════════════
// SUB: Tab Histórico
// ══════════════════════════════════════════════════════════

const HistoricoTab = ({ historico, isAdmin }) => (
  <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
    {historico.length === 0 && (
      <div style={{ textAlign: 'center', padding: 30, color: C.muted, fontFamily: SANS, fontSize: 12 }}>
        Nenhuma pergunta hoje ainda.
      </div>
    )}
    {historico.map(h => (
      <div key={h.id} style={{
        background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 10,
        padding: '11px 13px', marginBottom: 8, fontFamily: SANS,
      }}>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 600, marginBottom: 5 }}>{h.pergunta}</div>
        {h.resposta && (
          <div style={{
            fontSize: 12, color: C.textSoft, lineHeight: 1.5,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>{h.resposta}</div>
        )}
        {h.erro && (
          <div style={{ fontSize: 11, color: C.critical, fontStyle: 'italic' }}>⚠ {h.erro}</div>
        )}
        <div style={{
          fontSize: 9.5, color: C.muted, marginTop: 6,
          display: 'flex', gap: 10, alignItems: 'center',
        }}>
          <span>{formatTime(h.created_at)}</span>
          {h.categoria && <CategoriaChip categoria={h.categoria} />}
          {h.r_bloqueado && <span style={{ color: C.warning }}>🔒 R$ filtrado</span>}
          {isAdmin && <span style={{ marginLeft: 'auto' }}>{h.user_name}</span>}
        </div>
      </div>
    ))}
  </div>
);


function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const hoje = new Date();
    const mesmoSeDia = d.toDateString() === hoje.toDateString();
    if (mesmoSeDia) return `${hh}:${mm}`;
    return `${d.getDate()}/${d.getMonth() + 1} ${hh}:${mm}`;
  } catch { return ''; }
}


// ══════════════════════════════════════════════════════════
// ADMIN PANEL (shell — detalhamento no próximo commit)
// ══════════════════════════════════════════════════════════

export function IAPerguntaAdminPanel({ supabase, usuarioLogado, onClose, onBackToChat }) {
  const [secao, setSecao] = useState('visao');
  const [stats, setStats] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const userId = usuarioLogado?.id;

  useEffect(() => {
    if (secao === 'visao') {
      setCarregando(true);
      apiStats({ requester_id: userId })
        .then(r => { if (r.ok) setStats(r.stats); })
        .finally(() => setCarregando(false));
    }
    if (secao === 'historico') {
      setCarregando(true);
      apiHistorico({ requester_id: userId, user_id: null, periodo: 'hoje' })
        .then(r => { if (r.ok) setHistorico(r.agrupado || []); })
        .finally(() => setCarregando(false));
    }
  }, [secao, userId]);

  const isMobile = typeof window !== 'undefined' && window.innerWidth < 720;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: '#fff', display: 'flex', flexDirection: 'column',
      fontFamily: SERIF,
    }}>
      {/* Topbar */}
      <div style={{
        background: C.iaDarker, color: '#fff',
        padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button onClick={onBackToChat} style={{
          background: 'rgba(255,255,255,0.1)', color: '#fff', border: 'none',
          padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
          fontFamily: SANS, fontSize: 11,
        }}>‹ Voltar ao chat</button>
        <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 700 }}>🤖 Perguntar à IA · Painel admin</div>
        <button onClick={onClose} style={{
          marginLeft: 'auto', background: 'transparent', border: 'none',
          color: '#fff', cursor: 'pointer', fontSize: 22, padding: '2px 8px',
        }}>×</button>
      </div>

      {/* Shell: sidebar + main */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {!isMobile && (
          <div style={{
            width: 220, background: C.iaDarker, color: '#fff',
            padding: '16px 0', display: 'flex', flexDirection: 'column',
            flexShrink: 0, overflowY: 'auto',
          }}>
            {[
              { id: 'visao', label: '📊 Visão geral' },
              { id: 'historico', label: '👥 Histórico por user' },
              { id: 'limites', label: '⚙️ Limites & orçamento' },
              { id: 'treinamento', label: '📚 Treinamento (Q&A)' },
              { id: 'glossario', label: '🗂️ Glossário' },
              { id: 'alertas', label: '🚨 Bugs & alertas' },
            ].map(s => (
              <div key={s.id} onClick={() => setSecao(s.id)} style={{
                padding: '10px 20px', fontFamily: SANS, fontSize: 12.5,
                cursor: 'pointer',
                background: secao === s.id ? 'rgba(234,224,213,0.08)' : 'transparent',
                color: secao === s.id ? C.iaBg : '#cbd4de',
                borderLeft: `3px solid ${secao === s.id ? C.iaBg : 'transparent'}`,
                fontWeight: secao === s.id ? 600 : 400,
              }}>{s.label}</div>
            ))}
          </div>
        )}

        {isMobile && (
          <div style={{
            background: C.iaDarker, padding: 8, overflowX: 'auto',
            display: 'flex', gap: 6, flexShrink: 0,
          }}>
            {[
              { id: 'visao', label: '📊' },
              { id: 'historico', label: '👥' },
              { id: 'limites', label: '⚙️' },
              { id: 'treinamento', label: '📚' },
              { id: 'glossario', label: '🗂️' },
              { id: 'alertas', label: '🚨' },
            ].map(s => (
              <button key={s.id} onClick={() => setSecao(s.id)} style={{
                padding: '6px 12px', fontFamily: SANS, fontSize: 14,
                border: 'none', borderRadius: 6, cursor: 'pointer',
                background: secao === s.id ? C.iaBg : 'rgba(255,255,255,0.1)',
                color: secao === s.id ? C.iaDarker : '#fff',
              }}>{s.label}</button>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', background: C.appBg }}>
          {carregando && (
            <div style={{ color: C.muted, fontFamily: SANS, fontSize: 12 }}>Carregando...</div>
          )}

          {secao === 'visao' && <SecaoVisao stats={stats} />}
          {secao === 'historico' && <SecaoHistorico agrupado={historico} />}
          {secao === 'limites' && <SecaoEmConstrucao titulo="Limites & orçamento" proximoCommit="Próximo commit: formulário de rate limit, orçamento mensal, hard-stop." />}
          {secao === 'treinamento' && <SecaoEmConstrucao titulo="Treinamento (Q&A)" proximoCommit="Próximo commit: textarea pergunta + resposta + botão salvar. 25 Q&A seed." />}
          {secao === 'glossario' && <SecaoEmConstrucao titulo="Glossário" proximoCommit="Próximo commit: editor do glossário (termos internos + sinônimos)." />}
          {secao === 'alertas' && <SecaoEmConstrucao titulo="Bugs & alertas" proximoCommit="Próximo commit: alerta de nomes duplicados + sugestões de fix." />}
        </div>
      </div>
    </div>
  );
}

// ── Seções internas do admin (versão inicial) ──

const SecaoVisao = ({ stats }) => {
  if (!stats) return <div style={{ color: C.muted, fontFamily: SANS }}>Sem dados ainda.</div>;
  return (
    <div>
      <h2 style={{ fontFamily: SERIF, color: C.blueDark, fontSize: 20, marginBottom: 4 }}>Visão geral</h2>
      <div style={{ fontFamily: SANS, fontSize: 12, color: C.muted, marginBottom: 20 }}>
        Estado atual · atualizado em {stats.atualizado_em}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 12, marginBottom: 16,
      }}>
        <StatCard label="Perguntas hoje" value={stats.hoje?.total || 0}
          sub={`${stats.hoje?.funcionarios || 0} func · ${stats.hoje?.admin || 0} admin`} />
        <StatCard label="Pool funcionários" value={`${stats.hoje?.pool_usado || 0}`}
          sub="hoje · pool compartilhado" />
        <StatCard label="Custo do mês" value={`R$ ${(stats.mes?.custo_brl || 0).toFixed(2)}`}
          sub={`${stats.mes?.total || 0} perguntas no mês`} />
        <StatCard label="Tempo médio" value={`${((stats.hoje?.tempo_medio_ms || 0) / 1000).toFixed(1)}s`}
          sub="resposta da IA" color={C.success} />
        <StatCard label="R$ bloqueadas" value={stats.hoje?.bloqueadas_r$ || 0}
          sub="perguntas de func defletidas" color={C.warning} />
      </div>
      {stats.hoje?.por_categoria && (
        <div style={{
          background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 10,
          padding: 16,
        }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 14, color: C.blueDark, marginBottom: 10 }}>
            📈 Distribuição por categoria (hoje)
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontFamily: SANS, fontSize: 12 }}>
            {Object.entries(stats.hoje.por_categoria).map(([cat, qtd]) => (
              <div key={cat} style={{ display: 'flex', gap: 10 }}>
                <CategoriaChip categoria={cat} />
                <span>{qtd} pergunta{qtd === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, sub, color }) => (
  <div style={{
    background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 10,
    padding: '14px 16px',
  }}>
    <div style={{
      fontFamily: SANS, fontSize: 10.5, color: C.muted, letterSpacing: 0.3,
      textTransform: 'uppercase', marginBottom: 6,
    }}>{label}</div>
    <div style={{
      fontFamily: SERIF, fontSize: 22, fontWeight: 700,
      color: color || C.blueDark,
    }}>{value}</div>
    {sub && <div style={{ fontFamily: SANS, fontSize: 10.5, color: C.muted, marginTop: 3 }}>{sub}</div>}
  </div>
);

const SecaoHistorico = ({ agrupado }) => (
  <div>
    <h2 style={{ fontFamily: SERIF, color: C.blueDark, fontSize: 20, marginBottom: 4 }}>
      Histórico por usuário
    </h2>
    <div style={{ fontFamily: SANS, fontSize: 12, color: C.muted, marginBottom: 20 }}>
      Perguntas feitas hoje · isolado por user_id numérico
    </div>
    {agrupado.length === 0 && (
      <div style={{ color: C.muted, fontFamily: SANS, fontSize: 12 }}>Nenhuma pergunta hoje.</div>
    )}
    {agrupado.map(grupo => (
      <div key={grupo.user_id} style={{
        background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 10,
        marginBottom: 12, overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: C.appBg,
          borderBottom: `1px solid ${C.cream}`,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: grupo.is_admin ? C.iaDarker : C.blue,
            color: '#fff', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 11, fontWeight: 700,
            fontFamily: SANS,
          }}>{(grupo.user_name || '?')[0].toUpperCase()}</div>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 14, fontWeight: 700, color: C.blueDark }}>
              {grupo.user_name}
            </div>
            <div style={{ fontFamily: 'Courier New, monospace', fontSize: 10, color: C.muted }}>
              id: {grupo.user_id}
            </div>
          </div>
          <span style={{
            fontFamily: SANS, fontSize: 10, padding: '2px 8px', borderRadius: 10,
            background: grupo.is_admin ? C.iaDarker : C.cream,
            color: grupo.is_admin ? C.iaBg : C.text,
            textTransform: 'uppercase', letterSpacing: 0.3,
          }}>{grupo.is_admin ? 'admin' : 'func'}</span>
          <span style={{
            marginLeft: 'auto', fontFamily: SANS, fontSize: 11, color: C.text,
          }}><strong>{grupo.total}</strong> perguntas</span>
        </div>
        {grupo.perguntas.slice(0, 5).map(p => (
          <div key={p.id} style={{
            padding: '10px 14px', borderBottom: `1px solid ${C.appBg}`,
            display: 'grid', gridTemplateColumns: '60px 1fr 80px 70px',
            gap: 10, alignItems: 'center', fontFamily: SANS, fontSize: 12,
          }}>
            <span style={{ color: C.muted, fontFamily: 'Courier New, monospace', fontSize: 11 }}>
              {formatTime(p.created_at)}
            </span>
            <span style={{
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{p.pergunta}</span>
            {p.categoria ? <CategoriaChip categoria={p.categoria} /> : <span />}
            <span style={{
              fontSize: 10, padding: '2px 7px', borderRadius: 9, textAlign: 'center',
              background: p.erro ? C.criticalBg : p.r_bloqueado ? C.warningBg : C.successBg,
              color: p.erro ? C.critical : p.r_bloqueado ? C.warning : C.success,
              fontWeight: 600,
            }}>
              {p.erro ? '⚠ erro' : p.r_bloqueado ? '🔒 R$' : '✓ ok'}
            </span>
          </div>
        ))}
        {grupo.perguntas.length > 5 && (
          <div style={{
            padding: '10px 14px', textAlign: 'center',
            fontFamily: SANS, fontSize: 11, color: C.blue, cursor: 'pointer',
          }}>Ver todas as {grupo.perguntas.length} perguntas ›</div>
        )}
      </div>
    ))}
  </div>
);

const SecaoEmConstrucao = ({ titulo, proximoCommit }) => (
  <div>
    <h2 style={{ fontFamily: SERIF, color: C.blueDark, fontSize: 20, marginBottom: 4 }}>{titulo}</h2>
    <div style={{
      marginTop: 24, padding: '24px 20px', textAlign: 'center',
      background: C.warningBg, border: `1px solid ${C.warning}`,
      borderRadius: 10, color: '#8a6500', fontFamily: SANS,
    }}>
      <div style={{ fontSize: 24, marginBottom: 8 }}>🛠️</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Em construção</div>
      <div style={{ fontSize: 11, lineHeight: 1.5 }}>{proximoCommit}</div>
    </div>
  </div>
);
