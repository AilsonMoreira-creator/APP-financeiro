/**
 * Lojas_Shared.jsx — Tokens, supabase client e primitives UI compartilhados.
 *
 * ⚠️ Esse arquivo NÃO importa de Lojas.jsx, Lojas_Telas_Vendedora.jsx ou
 *    Lojas_Telas_Admin.jsx. Importa apenas de libs externas (react,
 *    lucide-react, @supabase/supabase-js).
 *
 * Por que existe?
 * Antes, Lojas.jsx ↔ Lojas_Telas_Vendedora.jsx ↔ Lojas_Telas_Admin.jsx
 * formavam um ciclo de imports. Em produção minificada, Vite não conseguia
 * resolver a ordem de inicialização das const, dando o erro:
 *   "Uncaught ReferenceError: Cannot access 'X' before initialization"
 *
 * Solução padrão: extrair os primitives compartilhados pra um arquivo neutro
 * que não importa dos outros (esse aqui). Cadeia linear, sem ciclo.
 *
 * Diagrama:
 *
 *   Lojas_Shared.jsx       (este — só exporta, não importa dos outros 3)
 *          ↑                    ↑                       ↑
 *          │                    │                       │
 *     Lojas.jsx       Lojas_Telas_Vendedora.jsx   Lojas_Telas_Admin.jsx
 *          │                                            │
 *          │             ModalMensagem ←────────────────┘
 *          │                  ↑
 *          └──────────────────┴── importa pra renderizar
 */

import { createClient } from '@supabase/supabase-js';
import * as React from 'react';
import {
  ArrowLeft, Loader2, AlertCircle, WifiOff, Phone, Copy, Check,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// SUPABASE CLIENT (independente — igual MLPerguntas)
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 10 } },
});

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS (do v5, com adições)
// ═══════════════════════════════════════════════════════════════════════════

export const palette = {
  bg: '#f7f4f0', surface: '#ffffff',
  beige: '#e8e2da', beigeSoft: '#f0ebe3',
  ink: '#2c3e50', inkSoft: '#5a6b7d', inkMuted: '#8a99a8',
  accent: '#4a7fa5', accentSoft: '#e5eef5',
  alert: '#c0392b', alertSoft: '#fde8e6',
  warn: '#d4a017', warnSoft: '#fdf6e3',
  ok: '#2d8659', okSoft: '#e0f0e8',
  archive: '#7a6e5d', archiveSoft: '#ede7dd',
  yellow: '#f5b800',
  // ⭐ NOVO: roxo pra status SEPARANDO_SACOLA
  purple: '#a855f7', purpleSoft: '#f3e8ff',
};
export const FONT = "Georgia, 'Times New Roman', serif";

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSIVO (mesmo padrão de SalasCorteContent no App.tsx)
// ═══════════════════════════════════════════════════════════════════════════
//
// Uso:
//   import { fz, sz, useLojasW } from './Lojas_Shared.jsx';
//
//   // No componente raiz, chamar useLojasW pra forçar re-render em resize:
//   const w = useLojasW();
//   const mobile = w < 640;
//
//   // Em qualquer lugar, fz/sz adicionam +1px no desktop:
//   fontSize: fz(14)   // mobile=14, desktop=15
//   <Icon size={sz(16)} />
//
// fz/sz são funções puras que leem cache atualizado pelo listener global.
// Mobile = idêntico ao código antigo (zero regressão). Desktop = +1px linear.

let _lojasW = typeof window !== 'undefined' ? window.innerWidth : 900;
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => { _lojasW = window.innerWidth; });
}

export function useLojasW() {
  // Hook simples — só re-renderiza componente raiz em resize. Os filhos
  // herdam re-render normal do React e fz/sz leem o cache atualizado.
  const [w, setW] = React.useState(_lojasW);
  React.useEffect(() => {
    const h = () => setW(_lojasW);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}

/** Font-size: mobile mantém valor, desktop ganha +1px. */
export const fz = (n) => _lojasW < 640 ? n : n + 1;

/** Icon-size: mesma regra. */
export const sz = (n) => _lojasW < 640 ? n : n + 1;

// ═══════════════════════════════════════════════════════════════════════════
// MAPAS DE STATUS / SUBTIPOS / FASES (visuais — cor + label + emoji)
// ═══════════════════════════════════════════════════════════════════════════

export const statusMap = {
  ativo: { cor: palette.ok, soft: palette.okSoft, label: 'Ativo', emoji: '🟢' },
  atencao: { cor: palette.warn, soft: palette.warnSoft, label: 'Atenção', emoji: '🟡' },
  semAtividade: { cor: '#e67e22', soft: '#fef0e6', label: 'S/Atividade', emoji: '🟠' },
  inativo: { cor: palette.alert, soft: palette.alertSoft, label: 'Inativo', emoji: '🔴' },
  arquivo: { cor: palette.archive, soft: palette.archiveSoft, label: 'Arquivo', emoji: '📁' },
  separandoSacola: { cor: palette.purple, soft: palette.purpleSoft, label: 'Sacola', emoji: '🟣' },
};

export const subtipoSacolaMap = {
  incentivar_acrescentar: { cor: palette.accent, label: 'Acrescentar peça (6-10d)', emoji: '✨' },
  fechar_pedido: { cor: palette.ok, label: 'Fechar pedido (11-15d)', emoji: '💛' },
  cobranca_incisiva: { cor: '#e67e22', label: 'Cobrar pagamento (16-23d)', emoji: '⏰' },
  desfazer_sacola: { cor: palette.alert, label: 'Sugerir desfazer (24+d)', emoji: '🚨' },
};

export const faseClienteNovaMap = {
  nova_aguardando: { cor: palette.inkMuted, label: 'Aguardando (0-14d)', emoji: '⏳' },
  nova_checkin_pronto: { cor: palette.purple, label: 'Check-in dia 15!', emoji: '👋' },
  nova_em_analise: { cor: palette.inkMuted, label: 'Em análise (16-30d)', emoji: '🤔' },
  normal: { cor: palette.inkSoft, label: 'Cliente regular', emoji: '✓' },
  sem_compras_ainda: { cor: palette.archive, label: 'Sem compras', emoji: '—' },
};

// ═══════════════════════════════════════════════════════════════════════════
// LOAD PHASES (estados do hook useLojasModule)
// ═══════════════════════════════════════════════════════════════════════════

export const LOAD_PHASES = {
  IDLE: 'idle',
  LOADING_USER: 'loading_user',
  LOADING_VENDEDORAS: 'loading_vendedoras',
  LOADING_CARTEIRA: 'loading_carteira',
  LOADING_PRODUTOS: 'loading_produtos',
  LOADING_SUGESTOES: 'loading_sugestoes',
  READY: 'ready',
  ERROR: 'error',
};

// ═══════════════════════════════════════════════════════════════════════════
// PRIMITIVES UI (ícones + componentes reutilizáveis)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LampIcon: usa o robô IA do app (mesmo padrão do SAC/IAPergunta).
 * Aparece nos botões "Pedir sugestão de mensagem" e indicadores de IA.
 * Lâmpada amarela ficou reservada pra contextos de "ideia gerada"
 * (sac-icons/sugestao_ia.png — uso pontual no Lojas_Telas_Vendedora).
 */
export const LampIcon = ({ size = 16 }) => (
  <img src="/robo-ia.png" alt="IA" width={size} height={size} style={{ display: 'block', objectFit: 'contain' }} />
);

/**
 * LojaIcon: PNG da fachada com letra A (criado pelo Ailson).
 * Aparece no header do módulo quando NÃO tem botão de voltar.
 */
export const LojaIcon = ({ size = 32 }) => (
  <img src="/loja.png" alt="Loja" width={size} height={size} style={{ display: 'block', objectFit: 'contain', flexShrink: 0 }} />
);

/**
 * Header sticky no topo de cada tela do módulo. Mostra título,
 * subtítulo opcional, botão de voltar (quando relevante) e
 * área pra ações no canto direito.
 */
export const Header = ({ title, subtitle, onBack, rightContent }) => (
  <div style={{
    background: palette.ink, color: palette.bg, padding: '14px 16px',
    fontFamily: FONT, position: 'sticky', top: 0, zIndex: 10,
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
        {onBack && (
          <button onClick={onBack} style={{
            background: 'transparent', border: 'none', color: palette.bg,
            cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
          }}>
            <ArrowLeft size={sz(25)} />
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          {!onBack && <LojaIcon size={sz(32)} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: fz(20), fontWeight: 600, letterSpacing: 0.3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{title}</div>
            {subtitle && (<div style={{ fontSize: fz(13), opacity: 0.7, marginTop: 2 }}>{subtitle}</div>)}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {rightContent}
      </div>
    </div>
  </div>
);

/**
 * StatusDot: bolinha colorida (ok/warn/alert) pra indicar status visual.
 */
export const StatusDot = ({ status }) => {
  const cores = { ok: palette.ok, warn: palette.warn, alert: palette.alert };
  return <span style={{
    display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
    background: cores[status] || palette.ok, flexShrink: 0,
  }} />;
};

/**
 * TabBar: barra de abas horizontal (sticky abaixo do Header).
 * Recebe array de { id, label, icon } e dispara onChange(id).
 */
export const TabBar = ({ tabs, activeTab, onChange }) => (
  <div style={{
    background: palette.surface, borderBottom: `1px solid ${palette.beige}`,
    padding: '0 4px', position: 'sticky', top: 60, zIndex: 9,
    fontFamily: FONT, display: 'flex', overflowX: 'auto', WebkitOverflowScrolling: 'touch',
  }}>
    {tabs.map(tab => {
      const active = activeTab === tab.id;
      const Icon = tab.icon;
      return (
        <button key={tab.id} onClick={() => onChange(tab.id)} style={{
          background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: FONT,
          padding: '14px 16px', fontSize: fz(16),
          color: active ? palette.ink : palette.inkMuted,
          fontWeight: active ? 600 : 400,
          borderBottom: active ? `2.5px solid ${palette.accent}` : '2.5px solid transparent',
          display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'all 0.15s',
        }}>
          <Icon size={sz(18)} />
          {tab.label}
        </button>
      );
    })}
  </div>
);

/**
 * SectionTitle: título uppercase pequeno pra seções dentro de telas.
 * Aceita ícone opcional (componente Lucide) à esquerda.
 */
export const SectionTitle = ({ icon: Icon, children }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: fz(13), fontWeight: 600, color: palette.inkSoft,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10,
  }}>
    {Icon && <Icon size={sz(15)} />}
    {children}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// LOADING SCREEN (mostrado durante phases de carregamento ou erro)
// ═══════════════════════════════════════════════════════════════════════════

export function LoadingScreen({ phase, error, online }) {
  const messages = {
    [LOAD_PHASES.LOADING_USER]: 'Verificando autenticação…',
    [LOAD_PHASES.LOADING_VENDEDORAS]: 'Carregando vendedoras…',
    [LOAD_PHASES.LOADING_CARTEIRA]: 'Carregando carteira…',
    [LOAD_PHASES.LOADING_PRODUTOS]: 'Carregando produtos e promoções…',
    [LOAD_PHASES.LOADING_SUGESTOES]: 'Buscando sugestões do dia…',
  };
  
  if (phase === LOAD_PHASES.ERROR) {
    return (
      <div style={{
        background: palette.bg, minHeight: '100vh', fontFamily: FONT,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24, textAlign: 'center',
      }}>
        <div style={{
          width: 60, height: 60, borderRadius: '50%', background: palette.alertSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        }}>
          <AlertCircle size={sz(34)} color={palette.alert} />
        </div>
        <div style={{ fontSize: fz(20), fontWeight: 600, color: palette.ink, marginBottom: 8 }}>
          Não foi possível carregar
        </div>
        <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.5, maxWidth: 320 }}>
          {error || 'Erro desconhecido'}
        </div>
        <button onClick={() => window.location.reload()} style={{
          marginTop: 20, background: palette.accent, color: palette.bg, border: 'none',
          borderRadius: 10, padding: '12px 24px', fontSize: fz(16), fontWeight: 600,
          cursor: 'pointer', fontFamily: FONT,
        }}>
          Tentar novamente
        </button>
      </div>
    );
  }
  
  return (
    <div style={{
      background: palette.bg, minHeight: '100vh', fontFamily: FONT,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 24, textAlign: 'center',
    }}>
      <div style={{ marginBottom: 16, animation: 'spin 1s linear infinite' }}>
        <Loader2 size={sz(46)} color={palette.accent} />
      </div>
      <div style={{ fontSize: fz(16), color: palette.inkSoft }}>
        {messages[phase] || 'Carregando…'}
      </div>
      {!online && (
        <div style={{
          marginTop: 16, padding: '8px 14px', background: palette.warnSoft,
          color: palette.warn, borderRadius: 8, fontSize: fz(14), display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <WifiOff size={sz(16)} /> Sem conexão
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SAUDAÇÃO MOTIVACIONAL DO DIA (CardDiaScreen)
// ═══════════════════════════════════════════════════════════════════════════
//
// Mostra "Bom dia/Boa tarde/Boa noite, [Nome]!" + frase motivacional escolhida
// deterministicamente por (data + vendedora). Mesma frase o dia inteiro pra
// mesma vendedora. Vendedoras diferentes veem frases diferentes. Próximo dia
// → nova frase. Total de ~30 frases = ~1 mês sem repetir pra mesma vendedora.

export const FRASES_MOTIVACIONAIS = [
  // Engraçadas / casuais
  'Reage mulher, boleto não espera 😂',
  'Bora vender que o Pix não cai sozinho 💸',
  'Cliente não entra sozinho, chama ele! 📣',
  'Parada aí por quê? A meta não bate sozinha 😅',
  'Se não vender hoje, amanhã vende dobrado 👀',
  'Mais conversa, mais comissão 😉',
  'Olhar de vendedora, atitude de milionária 😎',
  'Quem fica parada vira estoque 😂',
  'Vamos trabalhar que o café já fez efeito ☕',
  'Cliente entrou = sorriso automático 😁',
  'Reage mulher!! 🚀',
  'Bora trabalhar!! 💼',
  'Vamos estourar nas vendas hj!!! 🔥',
  'Tô sentindo q hj vamos vender muito!!! ✨',
  'É hj q vamos vender muito!!! 🔥',
  // Motivacionais (energia de resultado)
  'Hoje é dia de vender MUITO 📈',
  'Bora fazer esse caixa girar 💰',
  'Meta na cabeça, foco na venda 🎯',
  'Vamos fazer acontecer hoje ⚡',
  'Dia fraco não existe pra gente 💪',
  'Venda é atitude 😎',
  'Confia no processo e vende 🙌',
  'Hoje é dia de comissão boa 💸',
  // Foco em meta
  'Temos meta e vamos bater 💪',
  'Falta pouco, acelera! 🏃‍♀️',
  'Cada venda conta 💯',
  'Não para até bater a meta 🚀',
  'Ritmo de loja cheia 🛍️',
  'Vamos subir esse faturamento 📊',
  'Hora de virar o jogo 🎯',
  'Foco total nas clientes 👀',
  'Hoje ninguém sai sem comprar 🛍️',
  'Vamos q temos uma meta pra bater!! 🎯',
];

/** Retorna "Bom dia" / "Boa tarde" / "Boa noite" pela hora local. */
export function saudacaoHora(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Emoji combinando com saudacaoHora — sol/café/lua. */
export function emojiHora(date = new Date()) {
  const h = date.getHours();
  if (h >= 5 && h < 12) return '☀️';
  if (h >= 12 && h < 18) return '☕';
  return '🌙';
}

/** Hash simples (djb2) pra gerar índice determinístico a partir de string. */
function _hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return Math.abs(h);
}

/** Escolhe frase pelo dia + seed (nome da vendedora, normalmente).
 *  Mesma seed + mesma data = mesma frase o dia inteiro. */
export function fraseDoDia(seed = '', date = new Date()) {
  const dia = date.toISOString().slice(0, 10); // "2026-04-28"
  const idx = _hash(dia + '|' + String(seed)) % FRASES_MOTIVACIONAIS.length;
  return FRASES_MOTIVACIONAIS[idx];
}
//
// Padrão Brasil:
//   10 dígitos (fixo ou celular antigo): (DD)NNNN-NNNN
//   11 dígitos (celular atual c/ o 9):   (DD)NNNNN-NNNN
//
// Exemplo:
//   "1374151597"  → "(13)7415-1597"
//   "11987654321" → "(11)98765-4321"

export function formatarTelefone(num) {
  if (!num) return '';
  const dig = String(num).replace(/\D/g, '');
  if (dig.length === 11) return `(${dig.slice(0, 2)})${dig.slice(2, 7)}-${dig.slice(7)}`;
  if (dig.length === 10) return `(${dig.slice(0, 2)})${dig.slice(2, 6)}-${dig.slice(6)}`;
  // Fallback: número fora do padrão BR — devolve só os dígitos
  return dig;
}

/**
 * Mostra telefone formatado + botão pequeno de copiar.
 * Uso: <TelefoneCopiavel telefone={cliente.telefone_principal} />
 */
export function TelefoneCopiavel({ telefone }) {
  const [copiado, setCopiado] = React.useState(false);
  if (!telefone) return null;
  const formatado = formatarTelefone(telefone);
  const copiar = async (e) => {
    e.stopPropagation();
    try {
      // Copia só os dígitos (mais útil pra colar em discador / WhatsApp)
      const dig = String(telefone).replace(/\D/g, '');
      await navigator.clipboard.writeText(dig);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Fallback antigo
      const ta = document.createElement('textarea');
      ta.value = String(telefone).replace(/\D/g, '');
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1500);
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fz(15), color: palette.inkSoft }}>
      <Phone size={sz(15)} />
      <span style={{ fontFamily: 'monospace', letterSpacing: 0.3 }}>{formatado}</span>
      <button
        onClick={copiar}
        title={copiado ? 'Copiado!' : 'Copiar número'}
        style={{
          marginLeft: 4, width: sz(28), height: sz(28), borderRadius: 6,
          background: copiado ? palette.okSoft : palette.beigeSoft,
          border: `1px solid ${copiado ? palette.ok : palette.beige}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', flexShrink: 0, transition: 'all 0.15s',
        }}
      >
        {copiado
          ? <Check size={sz(14)} color={palette.ok} />
          : <Copy size={sz(14)} color={palette.inkSoft} />
        }
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FOTO DE PRODUTO (mesmo padrão FotoProdLarge do App.tsx)
// ═══════════════════════════════════════════════════════════════════════════
//
// Bucket: produtos/{REF}.{jpg|png|webp}
// REF pode ter zero-padding diferente entre Bling/UI/storage. Tenta sequência:
//   norm → orig (se diferente) → pad4 → pad5 → placeholder
//
// Uso:
//   <FotoProdutoLojas refProd={produto.ref} size={56} />
//   <FotoProdutoLojas refProd={produto.ref} aspectRatio /> (full width 3/4)

const SBURL_LOJAS = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) || '';
const STORAGE_PRODUTOS = SBURL_LOJAS ? `${SBURL_LOJAS}/storage/v1/object/public/produtos/` : '';

export function FotoProdutoLojas({ refProd, size = null, aspectRatio = false, onZoom = null }) {
  const orig = String(refProd || '').toUpperCase();
  const norm = orig.replace(/^0+/, '');

  // Sem URL do supabase ou sem ref: placeholder
  if (!STORAGE_PRODUTOS || !orig) {
    return (
      <div style={{
        ...(aspectRatio
          ? { width: '100%', aspectRatio: '3/4' }
          : { width: size || 56, height: size || 56 }),
        background: 'linear-gradient(135deg,#f0ebe3,#e8e2da)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#c0b8b0', fontSize: fz(10), fontFamily: FONT, fontStyle: 'italic',
        borderRadius: 8, flexShrink: 0,
      }}>
        foto ref {String(refProd)}
      </div>
    );
  }

  // Sequência de tentativas
  const cb = '?v=' + new Date().toISOString().slice(0, 10);
  const urls = [norm + '.jpg', norm + '.png', norm + '.webp'];
  if (orig !== norm) urls.push(orig + '.jpg', orig + '.png', orig + '.webp');
  const pad4 = norm.padStart(4, '0');
  const pad5 = norm.padStart(5, '0');
  if (pad4 !== norm && pad4 !== orig) urls.push(pad4 + '.jpg', pad4 + '.png', pad4 + '.webp');
  if (pad5 !== norm && pad5 !== orig && pad5 !== pad4) urls.push(pad5 + '.jpg', pad5 + '.png', pad5 + '.webp');

  const onError = (e) => {
    const cur = e.target.src;
    const idx = urls.findIndex(u => cur.includes(u));
    if (idx >= 0 && idx < urls.length - 1) {
      e.target.src = STORAGE_PRODUTOS + urls[idx + 1] + cb;
    } else {
      e.target.style.display = 'none';
      const ph = e.target.nextSibling;
      if (ph) ph.style.display = 'flex';
    }
  };

  const onClick = (e) => {
    e.stopPropagation();
    if (onZoom) onZoom(e.target.src);
  };

  if (aspectRatio) {
    return (
      <div style={{
        width: '100%', aspectRatio: '3/4', position: 'relative',
        overflow: 'hidden', borderRadius: 8,
        background: 'linear-gradient(135deg,#f0ebe3,#e8e2da)',
      }}>
        <img src={STORAGE_PRODUTOS + urls[0] + cb} onError={onError} onClick={onClick}
          style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: onZoom ? 'pointer' : 'default', display: 'block' }} />
        <div style={{
          display: 'none', width: '100%', height: '100%',
          alignItems: 'center', justifyContent: 'center',
          color: '#c0b8b0', fontSize: fz(10), fontFamily: FONT, fontStyle: 'italic',
        }}>
          foto ref {String(refProd)}
        </div>
      </div>
    );
  }

  // Tamanho fixo
  const s = size || 56;
  return (
    <div style={{
      width: s, height: s, borderRadius: 8, overflow: 'hidden',
      background: 'linear-gradient(135deg,#f0ebe3,#e8e2da)',
      flexShrink: 0, position: 'relative',
    }}>
      <img src={STORAGE_PRODUTOS + urls[0] + cb} onError={onError} onClick={onClick}
        style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: onZoom ? 'pointer' : 'default', display: 'block' }} />
      <div style={{
        display: 'none', width: '100%', height: '100%',
        alignItems: 'center', justifyContent: 'center',
        color: '#c0b8b0', fontSize: fz(9), fontFamily: FONT, fontStyle: 'italic',
        position: 'absolute', top: 0, left: 0,
      }}>
        ref {String(refProd)}
      </div>
    </div>
  );
}
