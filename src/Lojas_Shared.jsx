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
import {
  ArrowLeft, Loader2, AlertCircle, WifiOff,
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
            <ArrowLeft size={25} />
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          {!onBack && <LojaIcon size={32} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 20, fontWeight: 600, letterSpacing: 0.3,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{title}</div>
            {subtitle && (<div style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>{subtitle}</div>)}
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
          padding: '14px 16px', fontSize: 16,
          color: active ? palette.ink : palette.inkMuted,
          fontWeight: active ? 600 : 400,
          borderBottom: active ? `2.5px solid ${palette.accent}` : '2.5px solid transparent',
          display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'all 0.15s',
        }}>
          <Icon size={18} />
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
    fontSize: 13, fontWeight: 600, color: palette.inkSoft,
    letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10,
  }}>
    {Icon && <Icon size={15} />}
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
          <AlertCircle size={34} color={palette.alert} />
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, color: palette.ink, marginBottom: 8 }}>
          Não foi possível carregar
        </div>
        <div style={{ fontSize: 15, color: palette.inkSoft, lineHeight: 1.5, maxWidth: 320 }}>
          {error || 'Erro desconhecido'}
        </div>
        <button onClick={() => window.location.reload()} style={{
          marginTop: 20, background: palette.accent, color: palette.bg, border: 'none',
          borderRadius: 10, padding: '12px 24px', fontSize: 16, fontWeight: 600,
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
        <Loader2 size={46} color={palette.accent} />
      </div>
      <div style={{ fontSize: 16, color: palette.inkSoft }}>
        {messages[phase] || 'Carregando…'}
      </div>
      {!online && (
        <div style={{
          marginTop: 16, padding: '8px 14px', background: palette.warnSoft,
          color: palette.warn, borderRadius: 8, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <WifiOff size={16} /> Sem conexão
        </div>
      )}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
