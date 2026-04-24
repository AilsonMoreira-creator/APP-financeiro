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

async function apiTopSemana({ requester_id, limite = 10 }) {
  const r = await fetch(`/api/ia-pergunta-admin?acao=top_semana&limite=${limite}`, {
    headers: { 'X-User-Id': String(requester_id) },
  });
  return r.json();
}

async function apiUsersDuplicados({ requester_id }) {
  const r = await fetch('/api/ia-pergunta-admin?acao=users_duplicados', {
    headers: { 'X-User-Id': String(requester_id) },
  });
  return r.json();
}

async function apiBuscarConfig(supabase) {
  const { data } = await supabase
    .from('amicia_data')
    .select('payload')
    .eq('user_id', CONFIG_KEY)
    .maybeSingle();
  return data?.payload?.config || null;
}

async function apiSalvarConfig(supabase, config) {
  const { error } = await supabase
    .from('amicia_data')
    .upsert({ user_id: CONFIG_KEY, payload: { config, updated_at: new Date().toISOString() } }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  return true;
}


// ══════════════════════════════════════════════════════════
// DEFAULT_CONFIG (com seed das 25 Q&A aprovadas)
// ══════════════════════════════════════════════════════════

const GLOSSARIO_DEFAULT = `- "ref" = "referência" = "modelo" = "peça" (tudo vira código de 5 dígitos com zero à esquerda: 2277 == 02277)
- "Silva Teles" = "Brás" = "ST" (loja atacado Brás, Rua Silva Teles)
- "José Paulino" = "Bom Retiro" = "JP" (loja atacado Bom Retiro)
- "Varejo" = loja física direto pro consumidor final (preço Bom Retiro + R$40)
- "Curva A" = bestseller (≥300 peças/ciclo), "Curva B" = ≥200, "Curva C" = resto
- "Matriz" = estrutura cor × tamanho × folhas do corte
- "Carro-chefe" = top 10 cores mais vendidas no Bling
- "Produção" = "produzindo" = "no costureiro" = "na costura" = "na oficina"
- Oficinas externas: Dona Maria, Seu Zé, etc (costureiros que recebem peças cortadas)
- Salas de corte internas: Antonio, Adalecio, Chico (cortam tecido)
- Tamanhos: P, M, G, GG (regular) + G1, G2, G3 (plus size)
- 3 marcas ML: Exitus, Lumia, Muniam (mesmo produto, contas diferentes — sempre somar)
- NUNCA usar a palavra "lote" — usar "corte", "modelo", "ref"`;

const QA_SEED = [
  // ─── ESTOQUE (7) ───────────────────────────────────────────
  { categoria: 'estoque', pergunta: 'Quais refs estão em ruptura?', resposta_esperada: 'Lista refs com qtd_total < 30 peças (cobertura crítica). Mostrar até top 10.' },
  { categoria: 'estoque', pergunta: 'Quais variações da REF X tão zeradas?', resposta_esperada: 'Listar SKUs (cor × tam) com qtd = 0. Agrupar por cor.' },
  { categoria: 'estoque', pergunta: 'Cobertura em dias da REF X?', resposta_esperada: 'Estoque atual / vendas média 30d. Resposta: "X dias de cobertura".' },
  { categoria: 'estoque', pergunta: 'Quais refs vão zerar nos próximos 7 dias?', resposta_esperada: 'Cruzar cobertura < 7 com vendas atuais. Listar até 15 refs.' },
  { categoria: 'estoque', pergunta: 'Cores zeradas da REF X?', resposta_esperada: 'Listar cores onde TODAS as variações estão zeradas. Não confundir com cor parcial.' },
  { categoria: 'estoque', pergunta: 'Curva A com cores carro-chefe zeradas?', resposta_esperada: 'ADMIN ONLY. Cruzar refs curva A × top 10 cores Bling × variações zeradas.' },
  { categoria: 'estoque', pergunta: 'Tem REF X cor Y tam Z em estoque?', resposta_esperada: 'Resposta direta com qtd. Se não acha, dizer "Sem dados ML pra essa variação".' },

  // ─── PRODUÇÃO (7) ──────────────────────────────────────────
  { categoria: 'producao', pergunta: 'Quanto tem em produção total?', resposta_esperada: 'Soma todos cortes ativos (entregue=false). Quebrar por oficina.' },
  { categoria: 'producao', pergunta: 'Status da REF X em produção?', resposta_esperada: 'Data prevista (corte + 22d) + matriz visual completa. Se múltiplos cortes, listar todos.' },
  { categoria: 'producao', pergunta: 'Qual oficina tá com a REF X?', resposta_esperada: 'Nome da oficina + nCorte + qtd. Se ainda não cortou, dizer "Programado na sala — estimativa".' },
  { categoria: 'producao', pergunta: 'Prazo da REF X?', resposta_esperada: 'Dias restantes (22 - dias_decorridos). Se atrasado, sinalizar com ⚠.' },
  { categoria: 'producao', pergunta: 'Matriz de cores da REF X?', resposta_esperada: 'SEMPRE responder com matriz_render no JSON, não em texto.' },
  { categoria: 'producao', pergunta: 'Variação X (cor + tam) da REF Y em produção?', resposta_esperada: 'Qtd da combinação específica olhando matriz do corte ativo.' },
  { categoria: 'producao', pergunta: 'Cortes atrasados?', resposta_esperada: 'Lista cortes com dias_restantes < 0. Mostrar oficina + REF + dias de atraso.' },

  // ─── PRODUTO/VENDAS (7) ────────────────────────────────────
  { categoria: 'produto', pergunta: 'Mais vendido do mês?', resposta_esperada: 'Top 1 por volume. Sem R$ pra func, com R$ pra admin.' },
  { categoria: 'produto', pergunta: 'Top 10 mais vendidos?', resposta_esperada: 'Lista top 10 por qtd. Filtra R$ pra func.' },
  { categoria: 'produto', pergunta: 'REF X tá em alta ou baixa?', resposta_esperada: 'Tendência: comparar últimos 30d com 30d anteriores. Resposta em %.' },
  { categoria: 'produto', pergunta: 'Qual cor mais vende da REF X?', resposta_esperada: 'Cor top da REF nos últimos 30 dias.' },
  { categoria: 'produto', pergunta: 'Qual tamanho mais sai?', resposta_esperada: 'Tam top geral ou da REF se especificada.' },
  { categoria: 'produto', pergunta: 'A REF X vendia e parou?', resposta_esperada: 'Comparar 30d atuais com 30d anteriores. Se queda > 50%, alertar.' },
  { categoria: 'produto', pergunta: 'Vendas da REF X esse mês?', resposta_esperada: 'Qtd vendida. Faturamento e ticket médio só pra admin.' },

  // ─── FICHA TÉCNICA (4) ─────────────────────────────────────
  { categoria: 'ficha', pergunta: 'Qual valor da REF X?', resposta_esperada: 'TODOS veem. Mostrar 3 preços: Silva Teles, Bom Retiro (+R$10), Varejo (+R$40 sobre BR).' },
  { categoria: 'ficha', pergunta: 'Custo da REF X?', resposta_esperada: 'TODOS veem. Custo unitário. Não mostrar margem (essa fica pra admin).' },
  { categoria: 'ficha', pergunta: 'Preço Silva Teles da REF X?', resposta_esperada: 'Só o preço ST específico. Se busca por descrição (sem REF), aceitar match parcial.' },
  { categoria: 'ficha', pergunta: 'Compara preço REF X e REF Y?', resposta_esperada: 'Tabela compacta dos 3 preços de cada uma. ADMIN também vê custo e margem.' },
];

const DEFAULT_CONFIG = {
  rate_limit_users: 15,
  orcamento_brl_mensal: 80,
  hard_stop_pct: 95,
  alerta_pct: 70,
  filtrar_monetario_naoadmin: true,
  ficha_liberada_todos: true,
  glossario_custom: null, // null = backend usa GLOSSARIO_DEFAULT
  qa_seed: QA_SEED,
};


// ══════════════════════════════════════════════════════════
// UI: BOTÃO DO CABEÇALHO (exportado pra App.tsx usar)
// ══════════════════════════════════════════════════════════

export const IABotaoCabecalho = ({ onClick }) => (
  <button
    onClick={onClick}
    title="Perguntar à IA"
    style={{
      background: C.iaBg, color: C.iaDarker,
      border: 'none', borderRadius: 8,
      padding: '5px 9px', cursor: 'pointer',
      fontSize: 16, lineHeight: 1,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}
  >🤖</button>
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', width: '100%' }}>
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
                    flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box',
                    border: `1px solid ${C.border}`, borderRadius: 10,
                    padding: '9px 12px', fontFamily: SANS, fontSize: 16,
                    outline: 'none', resize: 'none',
                    background: loading ? '#eee' : C.appBg, color: C.text,
                    minHeight: 40, maxHeight: 120,
                  }}
                />
                <button
                  onClick={enviarPergunta}
                  disabled={loading || !input.trim()}
                  style={{
                    flexShrink: 0,
                    background: loading || !input.trim() ? C.cream : C.iaDarker,
                    color: loading || !input.trim() ? C.muted : C.iaBg,
                    border: 'none', borderRadius: 10, padding: '10px 14px',
                    cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                    fontSize: 18, minWidth: 44, height: 40,
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
          {secao === 'limites' && <SecaoLimites supabase={supabase} />}
          {secao === 'treinamento' && <SecaoTreinamento supabase={supabase} />}
          {secao === 'glossario' && <SecaoGlossario supabase={supabase} />}
          {secao === 'alertas' && <SecaoAlertas requesterId={userId} />}
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


// ══════════════════════════════════════════════════════════
// SEÇÃO: Limites & orçamento
// ══════════════════════════════════════════════════════════

function SecaoLimites({ supabase }) {
  const [config, setConfig] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    apiBuscarConfig(supabase).then(c => setConfig(c || { ...DEFAULT_CONFIG }));
  }, [supabase]);

  if (!config) {
    return <div style={{ color: C.muted, fontFamily: SANS }}>Carregando configurações…</div>;
  }

  const updateField = (field, value) => setConfig({ ...config, [field]: value });

  const salvar = async () => {
    setSalvando(true);
    setMsg(null);
    try {
      // Limpa qa_seed do config — ele fica só na constante (não vai pro banco a cada save)
      const { qa_seed: _, ...semQa } = config;
      await apiSalvarConfig(supabase, semQa);
      setMsg({ tipo: 'ok', texto: '✓ Configurações salvas' });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: 'Erro: ' + e.message });
    } finally {
      setSalvando(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const restaurar = () => {
    if (!confirm('Restaurar valores padrão? As configurações atuais serão sobrescritas.')) return;
    setConfig({ ...DEFAULT_CONFIG });
    setMsg({ tipo: 'ok', texto: 'Valores padrão carregados — clique em Salvar pra confirmar' });
  };

  return (
    <div style={{ fontFamily: SANS, maxWidth: 680 }}>
      <h2 style={{ fontFamily: SERIF, color: C.blueDark, fontSize: 20, marginBottom: 4 }}>Limites & orçamento</h2>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 24 }}>
        Configura quantas perguntas/dia o pool compartilhado de funcionários pode fazer e o teto mensal de gasto Anthropic.
      </div>

      <FieldGroup titulo="🧑‍🤝‍🧑 Pool de funcionários (compartilhado)">
        <Field label="Perguntas/dia (não-admin)" sub="Reset à meia-noite BRT. Admin é ilimitado.">
          <NumberInput value={config.rate_limit_users} onChange={v => updateField('rate_limit_users', v)} min={1} max={500} />
        </Field>
      </FieldGroup>

      <FieldGroup titulo="💰 Orçamento mensal (Anthropic)">
        <Field label="Teto mensal R$" sub="Gasto Anthropic por mês (Sonnet 4.6)">
          <NumberInput value={config.orcamento_brl_mensal} onChange={v => updateField('orcamento_brl_mensal', v)} min={1} max={1000} prefix="R$" />
        </Field>
        <Field label="Alerta visual em (%)" sub="Mostra aviso amarelo no painel admin quando atinge isso">
          <NumberInput value={config.alerta_pct} onChange={v => updateField('alerta_pct', v)} min={1} max={100} suffix="%" />
        </Field>
        <Field label="Hard-stop em (%)" sub="Trava TODAS as perguntas quando o gasto atinge esse %">
          <NumberInput value={config.hard_stop_pct} onChange={v => updateField('hard_stop_pct', v)} min={1} max={100} suffix="%" />
        </Field>
      </FieldGroup>

      <FieldGroup titulo="🔒 Filtros de privacidade">
        <Toggle
          label="Filtrar valores R$ pra não-admin"
          sub="Funcionário não vê faturamento, lucro, margem, ticket médio nem custo de produção."
          value={config.filtrar_monetario_naoadmin}
          onChange={v => updateField('filtrar_monetario_naoadmin', v)}
        />
        <Toggle
          label="Ficha técnica liberada pra todos"
          sub="Exceção: na ficha, custo + 3 preços de venda ficam visíveis pra qualquer user."
          value={config.ficha_liberada_todos}
          onChange={v => updateField('ficha_liberada_todos', v)}
        />
      </FieldGroup>

      <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
        <button onClick={salvar} disabled={salvando} style={{
          background: C.iaDarker, color: C.iaBg, border: 'none', borderRadius: 8,
          padding: '10px 22px', cursor: salvando ? 'wait' : 'pointer',
          fontFamily: SANS, fontSize: 13, fontWeight: 600,
        }}>{salvando ? 'Salvando…' : '✓ Salvar configurações'}</button>
        <button onClick={restaurar} style={{
          background: 'transparent', color: C.muted, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '10px 18px', cursor: 'pointer',
          fontFamily: SANS, fontSize: 12,
        }}>↺ Restaurar padrão</button>
        {msg && (
          <span style={{
            fontFamily: SANS, fontSize: 12,
            color: msg.tipo === 'ok' ? C.success : C.critical,
          }}>{msg.texto}</span>
        )}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════
// SEÇÃO: Treinamento (Q&A)
// ══════════════════════════════════════════════════════════

function SecaoTreinamento({ supabase }) {
  const [config, setConfig] = useState(null);
  const [filtro, setFiltro] = useState('todos');
  const [editando, setEditando] = useState(null); // null | 'novo' | índice
  const [draft, setDraft] = useState({ categoria: 'estoque', pergunta: '', resposta_esperada: '' });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    apiBuscarConfig(supabase).then(c => {
      const conf = c || { ...DEFAULT_CONFIG };
      // Se não tem qa salvo, usa o seed
      if (!conf.qa || conf.qa.length === 0) conf.qa = [...QA_SEED];
      setConfig(conf);
    });
  }, [supabase]);

  if (!config) return <div style={{ color: C.muted, fontFamily: SANS }}>Carregando…</div>;

  const qaList = filtro === 'todos' ? config.qa : config.qa.filter(q => q.categoria === filtro);

  const salvarTudo = async (qaAtualizado) => {
    setSalvando(true);
    setMsg(null);
    try {
      const novoConfig = { ...config, qa: qaAtualizado };
      const { qa_seed: _, ...persistir } = novoConfig;
      await apiSalvarConfig(supabase, persistir);
      setConfig(novoConfig);
      setEditando(null);
      setDraft({ categoria: 'estoque', pergunta: '', resposta_esperada: '' });
      setMsg({ tipo: 'ok', texto: '✓ Q&A salvo' });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: 'Erro: ' + e.message });
    } finally {
      setSalvando(false);
      setTimeout(() => setMsg(null), 2500);
    }
  };

  const adicionar = () => {
    if (!draft.pergunta.trim() || !draft.resposta_esperada.trim()) {
      setMsg({ tipo: 'erro', texto: 'Pergunta e resposta esperada são obrigatórias' });
      return;
    }
    salvarTudo([...config.qa, { ...draft }]);
  };

  const remover = (idx) => {
    if (!confirm(`Remover a Q&A "${config.qa[idx].pergunta}"?`)) return;
    salvarTudo(config.qa.filter((_, i) => i !== idx));
  };

  const restaurarSeed = () => {
    if (!confirm('Restaurar as 25 Q&A originais? Q&A customizadas que você adicionou serão perdidas.')) return;
    salvarTudo([...QA_SEED]);
  };

  return (
    <div style={{ fontFamily: SANS, maxWidth: 820 }}>
      <h2 style={{ fontFamily: SERIF, color: C.blueDark, fontSize: 20, marginBottom: 4 }}>Treinamento (Q&A)</h2>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>
        Q&A de referência que ajudam a IA a entender padrões esperados de pergunta/resposta. Não são respostas fixas — a IA usa só como guia.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        {['todos', 'estoque', 'producao', 'produto', 'ficha'].map(f => (
          <button key={f} onClick={() => setFiltro(f)} style={{
            padding: '5px 12px', borderRadius: 14, border: 'none',
            background: filtro === f ? C.iaDarker : C.cream,
            color: filtro === f ? C.iaBg : C.text,
            cursor: 'pointer', fontSize: 11, fontWeight: 600,
            letterSpacing: 0.3, textTransform: 'uppercase',
          }}>{f === 'todos' ? `Todos (${config.qa.length})` : f}</button>
        ))}
        <button onClick={() => setEditando('novo')} style={{
          marginLeft: 'auto', padding: '6px 14px', borderRadius: 8,
          background: C.success, color: '#fff', border: 'none',
          cursor: 'pointer', fontSize: 12, fontWeight: 600,
        }}>+ Nova Q&A</button>
        <button onClick={restaurarSeed} title="Restaura as 25 originais" style={{
          padding: '6px 12px', borderRadius: 8, background: 'transparent',
          color: C.muted, border: `1px solid ${C.border}`,
          cursor: 'pointer', fontSize: 11,
        }}>↺ Seed</button>
      </div>

      {editando === 'novo' && (
        <div style={{
          background: C.appBg, border: `2px dashed ${C.iaDarker}`, borderRadius: 10,
          padding: 14, marginBottom: 14,
        }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: C.iaDarker }}>+ Nova Q&A</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <select value={draft.categoria} onChange={e => setDraft({ ...draft, categoria: e.target.value })}
              style={{ padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: SANS }}>
              <option value="estoque">📦 Estoque</option>
              <option value="producao">✂️ Produção</option>
              <option value="produto">🛒 Produto</option>
              <option value="ficha">💎 Ficha</option>
            </select>
            <input value={draft.pergunta} onChange={e => setDraft({ ...draft, pergunta: e.target.value })}
              placeholder='Ex: "Quanto custa a REF X?"' style={{
                flex: 1, padding: '7px 10px', borderRadius: 6,
                border: `1px solid ${C.border}`, fontSize: 12, fontFamily: SANS,
              }} />
          </div>
          <textarea value={draft.resposta_esperada} onChange={e => setDraft({ ...draft, resposta_esperada: e.target.value })}
            placeholder="Como a IA deve responder esse padrão de pergunta..." rows={3} style={{
              width: '100%', padding: 10, borderRadius: 6, border: `1px solid ${C.border}`,
              fontSize: 12, fontFamily: SANS, resize: 'vertical',
            }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={adicionar} disabled={salvando} style={{
              padding: '7px 16px', background: C.iaDarker, color: C.iaBg,
              border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>{salvando ? 'Salvando…' : '✓ Adicionar'}</button>
            <button onClick={() => { setEditando(null); setDraft({ categoria: 'estoque', pergunta: '', resposta_esperada: '' }); }}
              style={{ padding: '7px 14px', background: 'transparent', color: C.muted,
                border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>Cancelar</button>
            {msg && <span style={{ fontSize: 11, color: msg.tipo === 'ok' ? C.success : C.critical, alignSelf: 'center' }}>{msg.texto}</span>}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {qaList.map((q, idx) => {
          const realIdx = config.qa.indexOf(q);
          return (
            <div key={realIdx} style={{
              background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 8,
              padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'flex-start',
            }}>
              <CategoriaChip categoria={q.categoria} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, color: C.text, fontWeight: 600, marginBottom: 4 }}>{q.pergunta}</div>
                <div style={{ fontSize: 11.5, color: C.textSoft, lineHeight: 1.5 }}>{q.resposta_esperada}</div>
              </div>
              <button onClick={() => remover(realIdx)} title="Remover" style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontSize: 14, color: C.critical, opacity: 0.6, padding: '0 4px',
              }}>✕</button>
            </div>
          );
        })}
      </div>

      {msg && editando !== 'novo' && (
        <div style={{
          marginTop: 12, fontSize: 12, color: msg.tipo === 'ok' ? C.success : C.critical,
        }}>{msg.texto}</div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════════════════
// SEÇÃO: Glossário
// ══════════════════════════════════════════════════════════

function SecaoGlossario({ supabase }) {
  const [config, setConfig] = useState(null);
  const [texto, setTexto] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    apiBuscarConfig(supabase).then(c => {
      const conf = c || { ...DEFAULT_CONFIG };
      setConfig(conf);
      setTexto(conf.glossario_custom || GLOSSARIO_DEFAULT);
    });
  }, [supabase]);

  if (!config) return <div style={{ color: C.muted, fontFamily: SANS }}>Carregando…</div>;

  const usandoCustom = config.glossario_custom != null;

  const salvar = async () => {
    setSalvando(true);
    setMsg(null);
    try {
      const novo = { ...config, glossario_custom: texto.trim() };
      const { qa_seed: _, ...persistir } = novo;
      await apiSalvarConfig(supabase, persistir);
      setConfig(novo);
      setMsg({ tipo: 'ok', texto: '✓ Glossário salvo' });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: 'Erro: ' + e.message });
    } finally {
      setSalvando(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  const restaurar = async () => {
    if (!confirm('Voltar ao glossário padrão? Suas customizações serão perdidas.')) return;
    setSalvando(true);
    setMsg(null);
    try {
      const novo = { ...config, glossario_custom: null };
      const { qa_seed: _, ...persistir } = novo;
      await apiSalvarConfig(supabase, persistir);
      setConfig(novo);
      setTexto(GLOSSARIO_DEFAULT);
      setMsg({ tipo: 'ok', texto: '✓ Glossário restaurado pro padrão' });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: 'Erro: ' + e.message });
    } finally {
      setSalvando(false);
      setTimeout(() => setMsg(null), 3000);
    }
  };

  return (
    <div style={{ fontFamily: SANS, maxWidth: 820 }}>
      <h2 style={{ fontFamily: SERIF, color: C.blueDark, fontSize: 20, marginBottom: 4 }}>Glossário</h2>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 16, lineHeight: 1.6 }}>
        Termos internos do Grupo Amícia que a IA precisa entender. A IA injeta esse texto no system prompt, então sinônimos e abreviações ajudam a responder corretamente quando o user usa linguagem informal. Use formato de lista com hífen.
      </div>

      <div style={{
        marginBottom: 10, padding: '8px 12px', borderRadius: 6,
        background: usandoCustom ? C.warningBg : C.successBg,
        color: usandoCustom ? '#8a6500' : C.success,
        fontSize: 11, fontFamily: SANS,
      }}>
        {usandoCustom
          ? '⚠ Glossário customizado em uso (sobrescreve o padrão do backend)'
          : '✓ Usando glossário padrão do backend'}
      </div>

      <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={20} style={{
        width: '100%', padding: 14, borderRadius: 8,
        border: `1px solid ${C.border}`, fontSize: 12, fontFamily: 'Consolas, Monaco, monospace',
        lineHeight: 1.6, resize: 'vertical', background: '#fff', color: C.text,
      }} />

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
        <button onClick={salvar} disabled={salvando} style={{
          background: C.iaDarker, color: C.iaBg, border: 'none', borderRadius: 8,
          padding: '10px 22px', cursor: salvando ? 'wait' : 'pointer',
          fontFamily: SANS, fontSize: 13, fontWeight: 600,
        }}>{salvando ? 'Salvando…' : '✓ Salvar glossário'}</button>
        <button onClick={restaurar} style={{
          background: 'transparent', color: C.muted, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: '10px 18px', cursor: 'pointer',
          fontFamily: SANS, fontSize: 12,
        }}>↺ Restaurar padrão</button>
        {msg && (
          <span style={{
            fontFamily: SANS, fontSize: 12,
            color: msg.tipo === 'ok' ? C.success : C.critical,
          }}>{msg.texto}</span>
        )}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════
// SEÇÃO: Bugs & alertas
// ══════════════════════════════════════════════════════════

function SecaoAlertas({ requesterId }) {
  const [duplicados, setDuplicados] = useState([]);
  const [topSemana, setTopSemana] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    Promise.all([
      apiUsersDuplicados({ requester_id: requesterId }),
      apiTopSemana({ requester_id: requesterId, limite: 10 }),
    ]).then(([dup, top]) => {
      setDuplicados(dup.duplicados || []);
      setTopSemana(top.top || []);
    }).finally(() => setCarregando(false));
  }, [requesterId]);

  if (carregando) return <div style={{ color: C.muted, fontFamily: SANS }}>Carregando alertas…</div>;

  return (
    <div style={{ fontFamily: SANS, maxWidth: 820 }}>
      <h2 style={{ fontFamily: SERIF, color: C.blueDark, fontSize: 20, marginBottom: 4 }}>Bugs & alertas</h2>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 24 }}>
        Coisas que merecem sua atenção: usuários duplicados (bug conhecido) e padrões de uso da semana.
      </div>

      {/* Bug: nomes duplicados */}
      <div style={{
        background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 10,
        marginBottom: 18, overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 16px', borderBottom: `1px solid ${C.cream}`,
          background: duplicados.length > 0 ? C.warningBg : C.successBg,
          fontFamily: SERIF, fontSize: 14, fontWeight: 700,
          color: duplicados.length > 0 ? '#8a6500' : C.success,
        }}>
          {duplicados.length > 0 ? '⚠️' : '✓'} Usuários com nomes duplicados
          {duplicados.length > 0 && (
            <span style={{ fontFamily: SANS, fontSize: 11, marginLeft: 10, fontWeight: 400 }}>
              {duplicados.length} caso{duplicados.length === 1 ? '' : 's'} detectado{duplicados.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {duplicados.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12, color: C.muted }}>
            Nenhum nome duplicado no histórico. ✨
          </div>
        ) : (
          <>
            <div style={{ padding: '10px 16px', fontSize: 11, color: C.textSoft, background: C.appBg, borderBottom: `1px solid ${C.cream}` }}>
              💡 Como o histórico é isolado por user_id (numérico, não pelo nome), perguntas ficam corretamente separadas mesmo com nomes iguais. Mas o painel pode confundir. <strong>Sugestão:</strong> renomear os duplicados em "Usuários" pra algo distinto (ex: "ana", "ana.silva").
            </div>
            {duplicados.map((d, i) => (
              <div key={i} style={{
                padding: '10px 16px', borderBottom: i < duplicados.length - 1 ? `1px solid ${C.appBg}` : 'none',
                fontSize: 12, display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <strong style={{ color: C.text, fontFamily: SERIF, fontSize: 14 }}>{d.user_name}</strong>
                <span style={{ color: C.muted, fontSize: 11 }}>{d.qtd} IDs distintos:</span>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10.5, color: C.textSoft }}>
                  {(d.ids || []).join(' · ')}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Top perguntas da semana */}
      <div style={{
        background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 10, overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 16px', borderBottom: `1px solid ${C.cream}`,
          background: C.appBg, fontFamily: SERIF, fontSize: 14, fontWeight: 700,
          color: C.blueDark,
        }}>📈 Top perguntas da semana</div>
        {topSemana.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12, color: C.muted }}>
            Sem perguntas suficientes nos últimos 7 dias.
          </div>
        ) : topSemana.map((t, i) => (
          <div key={i} style={{
            padding: '10px 16px', borderBottom: i < topSemana.length - 1 ? `1px solid ${C.appBg}` : 'none',
            display: 'grid', gridTemplateColumns: '30px 1fr 80px 70px',
            gap: 10, alignItems: 'center', fontSize: 12,
          }}>
            <span style={{ fontFamily: SERIF, fontSize: 16, fontWeight: 700, color: C.muted }}>{i + 1}</span>
            <span style={{ color: C.text }}>{t.exemplo}</span>
            {t.categoria && <CategoriaChip categoria={t.categoria} />}
            <span style={{ textAlign: 'right', color: C.text, fontSize: 11 }}>
              <strong>{t.vezes}×</strong>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════════════════
// HELPERS DE FORM (usados nas seções)
// ══════════════════════════════════════════════════════════

const FieldGroup = ({ titulo, children }) => (
  <div style={{
    background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 10,
    padding: '14px 18px', marginBottom: 14,
  }}>
    <div style={{
      fontFamily: SERIF, fontSize: 14, fontWeight: 700, color: C.blueDark,
      marginBottom: 12,
    }}>{titulo}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
  </div>
);

const Field = ({ label, sub, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
    <div>{children}</div>
  </div>
);

const NumberInput = ({ value, onChange, min, max, prefix, suffix }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    {prefix && <span style={{ fontSize: 12, color: C.muted }}>{prefix}</span>}
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => {
        const v = e.target.value === '' ? '' : Number(e.target.value);
        onChange(v);
      }}
      style={{
        width: 80, padding: '6px 10px', textAlign: 'right',
        border: `1px solid ${C.border}`, borderRadius: 6,
        fontFamily: SANS, fontSize: 13, fontWeight: 600,
        color: C.blueDark,
      }}
    />
    {suffix && <span style={{ fontSize: 12, color: C.muted }}>{suffix}</span>}
  </div>
);

const Toggle = ({ label, sub, value, onChange }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
    <button onClick={() => onChange(!value)} style={{
      width: 42, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
      background: value ? C.success : C.border,
      position: 'relative', transition: 'background 0.15s',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: value ? 20 : 2,
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  </div>
);
