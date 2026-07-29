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
// Re-exporta helpers de REF pra outros componentes importarem so do Shared.
import { refSemZero as _refSemZero, refDisplay as _refDisplay } from './LojasInstrucoes.jsx';
export const refSemZero = _refSemZero;
export const refDisplay = _refDisplay;
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

/** CSS de animação spin. Compartilhado entre Admin/Vendedora screens. */
export const spinKeyframes = { animation: 'spin 1s linear infinite' };

// ═══════════════════════════════════════════════════════════════════════════
// MAPAS DE STATUS / SUBTIPOS / FASES (visuais — cor + label + emoji)
// ═══════════════════════════════════════════════════════════════════════════

// Ailson 13/05/2026: renomeacao pra tom menos "perdido" — mantemos
// os identificadores internos ('semAtividade'/'inativo') pra nao quebrar
// constraint do banco, filtros e prompts da IA. So mudam labels e cores.
//   atencao    -> 'Atenção'  amarelo claro
//   semAtividade -> '+3M'    amarelo mais forte (90-180d)
//   inativo    -> '+6M'      laranja (180+ d)
export const statusMap = {
  ativo:           { cor: palette.ok,     soft: palette.okSoft,  label: 'Ativo',    emoji: '🟢' },
  atencao:         { cor: palette.warn,   soft: palette.warnSoft, label: 'Atenção',  emoji: '🟡' },
  semAtividade:    { cor: '#d4a017',      soft: '#fef5d4',        label: '+3M',      emoji: '🟡' },
  inativo:         { cor: '#e67e22',      soft: '#fef0e6',        label: '+6M',      emoji: '🟠' },
  arquivo:         { cor: palette.archive, soft: palette.archiveSoft, label: 'Arquivo', emoji: '📁' },
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
            {subtitle && (<div style={{
              fontSize: fz(13), opacity: 0.7, marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{subtitle}</div>)}
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
    padding: '0 16px 0 4px', position: 'sticky', top: 60, zIndex: 9,
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
          fontWeight: active ? 700 : 400,
          opacity: active ? 1 : 0.55,
          borderBottom: active ? `2.5px solid ${palette.accent}` : '2.5px solid transparent',
          display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', transition: 'all 0.15s',
          flexShrink: 0,
        }}>
          <Icon size={sz(18)} />
          {tab.label}
          {tab.badge > 0 && (
            <span style={{
              background: '#c0392b', color: '#fff', borderRadius: 999,
              minWidth: 18, height: 18, padding: '0 5px', fontSize: fz(11), fontWeight: 700,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginLeft: 2,
            }}>{tab.badge > 99 ? '99+' : tab.badge}</span>
          )}
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

// Frases motivacionais rotativas durante o "Carregando carteira..." (Ailson 20/05/2026).
// Tom: "estou preparando algo bom pra vc". Tira a ansiedade do loading.
const FRASES_LOADING_CARTEIRA = [
  'Preparando sua carteira pra vc vender muito hoje 💪',
  'Só um minutinho que tô preparando sua carteira 🌟',
  'Gerando a carteira pra termos os melhores resultados ⚡',
  'Organizando as clientes que mais te dão dinheiro 💸',
  'Buscando as melhores sugestões pra hoje 🎯',
  'Calculando quem tá pronta pra comprar de novo 🛍️',
  'Pensando nas suas vendas… quase pronto ✨',
  'Separando as clientes top da sua carteira 🔥',
  'Montando o seu dia de venda 📈',
  'Preparando o caminho da próxima venda 🚀',
  'Carregando histórico das suas clientes fiéis 💛',
  'Conectando tudo pra você arrasar 😎',
];

export function LoadingScreen({ phase, error, online }) {
  // Rotacao das frases (so na fase LOADING_CARTEIRA) - Ailson 20/05/2026
  const [fraseIdx, setFraseIdx] = React.useState(() =>
    Math.floor(Math.random() * FRASES_LOADING_CARTEIRA.length)
  );
  React.useEffect(() => {
    if (phase !== LOAD_PHASES.LOADING_CARTEIRA) return undefined;
    const t = setInterval(() => {
      setFraseIdx(i => (i + 1) % FRASES_LOADING_CARTEIRA.length);
    }, 3200);
    return () => clearInterval(t);
  }, [phase]);

  const messages = {
    [LOAD_PHASES.LOADING_USER]: 'Verificando autenticação…',
    [LOAD_PHASES.LOADING_VENDEDORAS]: 'Carregando vendedoras…',
    [LOAD_PHASES.LOADING_CARTEIRA]: FRASES_LOADING_CARTEIRA[fraseIdx],
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
      <div
        key={phase === LOAD_PHASES.LOADING_CARTEIRA ? fraseIdx : phase}
        style={{
          fontSize: phase === LOAD_PHASES.LOADING_CARTEIRA ? fz(17) : fz(16),
          color: phase === LOAD_PHASES.LOADING_CARTEIRA ? palette.ink : palette.inkSoft,
          lineHeight: 1.45,
          maxWidth: 320,
          padding: '0 16px',
          fontWeight: phase === LOAD_PHASES.LOADING_CARTEIRA ? 500 : 400,
          animation: 'fadein 0.5s ease',
        }}
      >
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
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes fadein { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
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
// → nova frase. Total de ~60 frases = ~2 meses sem repetir pra mesma vendedora
// (ampliada de ~30 pra ~60 a pedido do Ailson, 28/07/2026).

// Tela de atencao do freio de rajada (Ailson 28/07/2026). Nome da vendedora
// no titulo, botao libera apos 6 segundos — freio de leitura proposital.
export function AlertaRajadaModal({ nome, onConfirmar, variant = 'rajada' }) {
  const [resta, setResta] = useState(6);
  useEffect(() => {
    const t = setInterval(() => setResta(r => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, []);
  const primeiro = String(nome || '').trim().split(' ')[0];
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(30,40,50,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, maxWidth: 420, width: '100%', padding: '26px 22px', fontFamily: FONT, boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ fontSize: 34, textAlign: 'center', marginBottom: 8 }}>✋</div>
        <div style={{ fontSize: 17, fontWeight: 800, color: palette.ink, textAlign: 'center', marginBottom: 12 }}>
          Um minuto, {primeiro}!
        </div>
        {variant === 'pendentes' ? (
          <div style={{ fontSize: 13.5, color: palette.ink, lineHeight: 1.55, marginBottom: 10 }}>
            Ontem ficaram <b>sugestões sem fazer</b>. Cada cliente que fica pra trás é uma venda que não aconteceu.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13.5, color: palette.ink, lineHeight: 1.55, marginBottom: 10 }}>
              Suas últimas sugestões foram marcadas como enviadas com <b>menos de 20 segundos</b> entre uma e outra.
            </div>
            <div style={{ fontSize: 13.5, color: palette.ink, lineHeight: 1.55, marginBottom: 10 }}>
              Em 20 segundos não dá pra ler a sugestão, gerar a mensagem, editar e enviar de verdade.
            </div>
          </>
        )}
        <div style={{ fontSize: 13.5, color: palette.ink, lineHeight: 1.55, marginBottom: 18 }}>
          O app existe pra te ajudar a <b>vender mais</b>. Cada sugestão bem trabalhada é <b>comissão no seu bolso</b> e venda pra loja. Leva a sério que o resultado aparece. 💪
        </div>
        <button
          onClick={onConfirmar}
          disabled={resta > 0}
          style={{
            width: '100%', padding: '13px 0', borderRadius: 10, border: 'none',
            fontFamily: FONT, fontSize: 14.5, fontWeight: 700,
            background: resta > 0 ? '#c8c2b8' : palette.accent, color: '#fff',
            cursor: resta > 0 ? 'not-allowed' : 'pointer', transition: 'background 0.3s',
          }}>
          {resta > 0 ? `Aguarde ${resta}s…` : 'Entendi, vou fazer com atenção'}
        </button>
      </div>
    </div>
  );
}

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
  'Sorriso no rosto e maquininha na mão 😄',
  'O linho não se vende sozinho 😂',
  'Café tomado, cliente avisada, bora! ☕',
  'Provador cheio é alegria de vendedora 🛍️',
  'Quem chama cliente não passa aperto 📱',
  'Segura o batom e vai vender 💄',
  'Hoje o Pix vai cantar 🎶',
  'Cliente sumida? Chama no Whats 📲',
  'Sacola guardada é venda esperando 👀',
  'Vitrine linda, loja cheia, comissão alta 😎',
  // Motivacionais (energia de resultado)
  'Hoje é dia de vender MUITO 📈',
  'Bora fazer esse caixa girar 💰',
  'Meta na cabeça, foco na venda 🎯',
  'Vamos fazer acontecer hoje ⚡',
  'Dia fraco não existe pra gente 💪',
  'Venda é atitude 😎',
  'Confia no processo e vende 🙌',
  'Hoje é dia de comissão boa 💸',
  'Energia boa atrai venda boa ✨',
  'Atendimento com carinho fecha venda 🤝',
  'Sua simpatia é sua melhor ferramenta 😁',
  'Dia novo, clientes novas, chances novas 🌱',
  'Faz o simples bem feito que a venda vem 💪',
  'Vendedora boa cria o próprio movimento ⚡',
  'Um atendimento de cada vez, capricho em todos 🙌',
  'Constância ganha de talento 🏆',
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
  'Meta é compromisso, não sugestão 🎯',
  'Começa forte que o dia rende 🚀',
  'Cada mensagem enviada é uma porta aberta 📲',
  'Follow-up de hoje é venda de amanhã 📈',
  'Bateu a meta? Agora passa ela 😏',
  'Grandes vendas começam num oi 👋',
  'Semana boa se constrói na segunda 💼',
  'Fecha o mês com orgulho do número 📊',
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

// ═══════════════════════════════════════════════════════════════════════════
// FERIADOS 2026 (copiado de App.tsx — manter sincronizado anualmente)
// ═══════════════════════════════════════════════════════════════════════════

const FERIADOS_2026 = {
  '01/01': 'Confraternização Universal',
  '03/03': 'Carnaval', '04/03': 'Carnaval', '05/03': 'Quarta de Cinzas',
  '03/04': 'Sexta-feira Santa', '05/04': 'Páscoa',
  '21/04': 'Tiradentes', '01/05': 'Dia do Trabalho',
  '04/06': 'Corpus Christi', '07/09': 'Independência do Brasil',
  '12/10': 'N. Sra. Aparecida', '02/11': 'Finados',
  '15/11': 'Proclamação da República', '20/11': 'Consciência Negra',
  '25/12': 'Natal',
};

function _ehFeriado(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return Boolean(FERIADOS_2026[`${d}/${m}`]);
}

function _vesperaDeFeriado(date) {
  const amanha = new Date(date);
  amanha.setDate(amanha.getDate() + 1);
  return _ehFeriado(amanha);
}

function _posFeriado(date) {
  const ontem = new Date(date);
  ontem.setDate(ontem.getDate() - 1);
  return _ehFeriado(ontem);
}

// ═══════════════════════════════════════════════════════════════════════════
// POOLS ESPECIAIS DE FRASES (sobrescrevem o pool geral em dias específicos)
// ═══════════════════════════════════════════════════════════════════════════
//
// Prioridade quando mais de uma condição bate (1 ganha):
//   1. Dia 06 (pagamento) ou Dia 20 (vale) — dinheiro vence tudo
//   2. Véspera de feriado
//   3. Pós-feriado (dia depois)
//   4. Reta final do mês (dia 25+) ou Mês novo (dia 1-2)
//   5. Sexta ou Segunda (semanal)
//   6. Terça / Quarta / Quinta (vibe da semana)
//   7. Pool geral FRASES_MOTIVACIONAIS

const FRASES_DIA_06 = [  // pagamento
  'Nosso dinheiro já caiu na conta?? 😃🤑',
  'Hoje é dia 6 — confere o saldo aí 💰',
  'Dia 6, dia da alegria 🎉💸',
];

const FRASES_DIA_20 = [  // vale
  'Cadê nosso vale?? 😂',
  'Dia 20 chegou — vale gold 🤑',
  'Bora aproveitar o vale!! 💸',
];

const FRASES_VESPERA_FERIADO = [
  'Aguenta firme!!! Amanhã é feriado!!!! 🎉',
  'Nem acredito que amanhã é feriado! 🥳',
  'Tava precisando desse feriado de amanhã 😴',
];

const FRASES_POS_FERIADO = [
  'Feriadão acabou — bora retomar! 💪',
  'Recarregada do feriado, agora é trabalhar! ⚡',
  'De volta com tudo! 🚀',
];

const FRASES_RETA_FINAL_MES = [  // dia 25+
  'Reta final do mês — bora bater a meta! 🏁',
  'Últimos dias do mês — cada venda conta dobrado! 💯',
  'Fim do mês chegando — gás total! 🚀',
];

const FRASES_MES_NOVO = [  // dia 1-2
  'Mês novo, meta nova! 🆕',
  'Bora começar o mês com tudo! 🔥',
  'Primeira venda do mês — quem vai ser? 🎯',
];

const FRASES_SEXTA = [
  'Ebaaa sextou!!! 🎉',
  'Sextou, mas vamos vender muito ainda hoje! 💸',
  'Última chance da semana — sextou! 🍻',
];

const FRASES_SEGUNDA = [
  'Bora pra mais uma semana!!! 💪',
  'Preparada??? Essa semana vai bombar de vendas! 🚀',
  'Segunda chegou — vamos com tudo! ⚡',
];

const FRASES_TERCA = [
  'Bora subir o ritmo da semana 📈',
  'Terça é dia de pegar embalo! ⚡',
  'Segunda passou — agora é foco! 🎯',
];

const FRASES_QUARTA = [
  'Metade da semana, foco total 🎯',
  'Quarta-feira — cruzando o meio da semana 🚀',
  'Bora manter o ritmo! 💪',
];

const FRASES_QUINTA = [
  'Sexta tá batendo na porta, bora! 🚪',
  'Quinta — última reta antes do fim de semana! 🏃‍♀️',
  'Acelera que a semana tá quase acabando! ⚡',
];

/** Hash simples (djb2) pra gerar índice determinístico a partir de string. */
function _hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return Math.abs(h);
}

/** Escolhe pool de frases pelo dia (com prioridade) e retorna 1 frase
 *  determinística por (data + seed). Mesma vendedora vê mesma frase o
 *  dia inteiro; vendedoras diferentes veem frases diferentes. */
export function fraseDoDia(seed = '', date = new Date()) {
  const dom = date.getDate();         // dia do mês 1-31
  const dow = date.getDay();          // 0=dom, 1=seg, ..., 5=sex, 6=sab

  let pool;
  // 1. Pagamento (mais forte)
  if (dom === 6) pool = FRASES_DIA_06;
  else if (dom === 20) pool = FRASES_DIA_20;
  // 2. Véspera de feriado
  else if (_vesperaDeFeriado(date)) pool = FRASES_VESPERA_FERIADO;
  // 3. Pós-feriado
  else if (_posFeriado(date)) pool = FRASES_POS_FERIADO;
  // 4. Início ou fim do mês
  else if (dom >= 25) pool = FRASES_RETA_FINAL_MES;
  else if (dom <= 2) pool = FRASES_MES_NOVO;
  // 5. Sexta/Segunda
  else if (dow === 5) pool = FRASES_SEXTA;
  else if (dow === 1) pool = FRASES_SEGUNDA;
  // 6. Meio de semana
  else if (dow === 2) pool = FRASES_TERCA;
  else if (dow === 3) pool = FRASES_QUARTA;
  else if (dow === 4) pool = FRASES_QUINTA;
  // 7. Padrão (sábado ou qualquer outro dia)
  else pool = FRASES_MOTIVACIONAIS;

  const dia = date.toISOString().slice(0, 10);
  const idx = _hash(dia + '|' + String(seed)) % pool.length;
  return pool[idx];
}

// ═══════════════════════════════════════════════════════════════════════════
// USUÁRIO LOGADO (pra Tamara — admin que recebe a saudação)
// ═══════════════════════════════════════════════════════════════════════════

/** Lê o nome do usuário logado do localStorage (mesmo padrão de App.tsx).
 *  Retorna null se não houver sessão. */
export function getNomeUsuarioLogado() {
  if (typeof window === 'undefined') return null;
  try {
    const sess = localStorage.getItem('amica_session');
    if (sess) {
      const p = JSON.parse(sess);
      if (p?.usuario) return String(p.usuario);
    }
  } catch {}
  try {
    const json = localStorage.getItem('amicia_user');
    if (json) {
      const parsed = JSON.parse(json);
      const u = parsed?.id || parsed?.user_id || parsed?.usuario;
      if (u) return String(u);
    }
  } catch {}
  return localStorage.getItem('user_id') || localStorage.getItem('userId') || null;
}

/** Lista de admins que devem ver o card de saudação motivacional na home,
 *  apesar de serem admin (e não vendedora). Case-insensitive. */
const ADMINS_QUE_VEEM_SAUDACAO = ['tamara'];

/** Retorna info do admin se o usuário logado for um dos especiais (Tamara, etc).
 *  Retorna null caso contrário. */
export function adminComSaudacao() {
  const nome = getNomeUsuarioLogado();
  if (!nome) return null;
  const lower = nome.toLowerCase();
  for (const adm of ADMINS_QUE_VEEM_SAUDACAO) {
    if (lower.includes(adm)) {
      // Capitaliza primeira letra
      const display = adm.charAt(0).toUpperCase() + adm.slice(1);
      return { nome: display, seed: adm };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS DE DOCUMENTO (CNPJ/CPF) E NOME DE COMPRADOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tira tudo que não é dígito.
 * Útil pra normalizar antes de salvar/buscar no banco (sempre só dígitos).
 */
export function limparDocumento(doc) {
  return String(doc || '').replace(/\D/g, '');
}

/**
 * Detecta tipo pelo número de dígitos.
 * CPF = 11 dígitos, CNPJ = 14 dígitos.
 * Retorna 'cpf' / 'cnpj' / null.
 */
export function detectarTipoDocumento(doc) {
  const limpo = limparDocumento(doc);
  if (limpo.length === 11) return 'cpf';
  if (limpo.length === 14) return 'cnpj';
  return null;
}

/**
 * Formata pra exibição:
 *   CPF  → 123.456.789-09
 *   CNPJ → 12.345.678/0001-99
 *   Sem padrão reconhecido → devolve o input limpo
 */
export function formatarDocumento(doc, tipo = null) {
  const d = limparDocumento(doc);
  const t = tipo || detectarTipoDocumento(d);
  if (t === 'cnpj' && d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (t === 'cpf' && d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return d;
}

/**
 * Formata enquanto digita (vai colocando . - / conforme o user vai digitando).
 * Decide CPF vs CNPJ pela quantidade de dígitos já digitados.
 *   1-11 dígitos  → vai formatando como CPF
 *   12-14 dígitos → vira CNPJ
 */
export function formatarDocumentoLive(input) {
  const d = limparDocumento(input).slice(0, 14);
  if (d.length <= 11) {
    // Formata como CPF parcial
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  // 12-14 dígitos = CNPJ
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/**
 * Pega só o primeiro nome (palavra) do nome do comprador.
 * Usado pra mensagem WhatsApp ("Rosana Ruiva" → "Rosana").
 *
 * Regras:
 *   - Trim e split por espaços
 *   - Pega a 1ª palavra com pelo menos 2 letras (pula "Sra", "Dra" se for o caso)
 *   - Se não achar nada útil, devolve a string original
 */
export function primeiroNome(nome) {
  const s = String(nome || '').trim();
  if (!s) return '';
  const palavras = s.split(/\s+/).filter(p => p.length >= 2);
  return palavras[0] || s;
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMATAÇÃO DE TELEFONE + COMPONENTE COPIÁVEL
// ═══════════════════════════════════════════════════════════════════════════
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

// Lê sbUrl dinamicamente (não cacheia em module-load) — mesmo padrão do
// FotoProdLarge no App.tsx. Fallback pra localStorage caso env var não
// esteja disponível em runtime.
function _getSbUrl() {
  let env = '';
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      env = import.meta.env.VITE_SUPABASE_URL || '';
    }
  } catch {}
  if (env) return env;
  try {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sb_url') || '';
    }
  } catch {}
  return '';
}

// Cache em memória do path de foto da Sofia por REF (evita refazer a query a
// cada render/scroll). null = já buscou e não achou. Ailson 14/07/2026.
const _sofiaFotoCache = new Map();

async function _buscarFotoSofia(refNorm) {
  if (_sofiaFotoCache.has(refNorm)) return _sofiaFotoCache.get(refNorm);
  try {
    const alt = refNorm.padStart(4, '0');
    const alt5 = refNorm.padStart(5, '0');
    const { data } = await supabase
      .from('lojas_whats_midias')
      .select('storage_path, ativa, criada_em')
      .eq('tipo', 'foto')
      .in('ref', [refNorm, alt, alt5])
      .order('ativa', { ascending: false })
      .order('criada_em', { ascending: false })
      .limit(1);
    const path = data && data[0]?.storage_path ? data[0].storage_path : null;
    _sofiaFotoCache.set(refNorm, path);
    return path;
  } catch {
    _sofiaFotoCache.set(refNorm, null);
    return null;
  }
}

export function FotoProdutoLojas({ refProd, size = null, aspectRatio = false, onZoom = null }) {
  const sbUrl = _getSbUrl();
  const storageBase = sbUrl ? `${sbUrl}/storage/v1/object/public/produtos/` : '';
  const sofiaBase = sbUrl ? `${sbUrl}/storage/v1/object/public/sofia-midias/` : '';
  const orig = String(refProd || '').toUpperCase();
  const norm = orig.replace(/^0+/, '');

  // Fallback pelas mídias da Sofia: quando a REF não tem arquivo no bucket
  // 'produtos' (ex: reposição/novidade sem ficha técnica), busca a foto ativa
  // cadastrada na Sofia. O path tem timestamp, então precisa vir do banco.
  const [sofiaUrl, setSofiaUrl] = React.useState(() => {
    const c = _sofiaFotoCache.get(norm);
    return c ? sofiaBase + c : null;
  });
  const tentouSofiaRef = React.useRef(false);
  const buscarSofia = React.useCallback(() => {
    if (tentouSofiaRef.current || !norm || !sofiaBase) return;
    tentouSofiaRef.current = true;
    _buscarFotoSofia(norm).then(path => { if (path) setSofiaUrl(sofiaBase + path); });
  }, [norm, sofiaBase]);

  // Sem URL do supabase ou sem ref: placeholder
  if (!storageBase || !orig) {
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
    // Se já está exibindo a foto da Sofia e ela falhou, cai no placeholder.
    if (sofiaUrl && cur.includes('/sofia-midias/')) {
      e.target.style.display = 'none';
      const ph = e.target.nextSibling;
      if (ph) ph.style.display = 'flex';
      return;
    }
    const idx = urls.findIndex(u => cur.includes(u));
    if (idx >= 0 && idx < urls.length - 1) {
      e.target.src = storageBase + urls[idx + 1] + cb;
    } else if (sofiaUrl) {
      // Esgotou o bucket 'produtos' e já temos a foto da Sofia: usa ela.
      e.target.src = sofiaUrl;
    } else {
      // Esgotou 'produtos' e ainda não buscou na Sofia: busca e, se achar, o
      // setSofiaUrl re-renderiza e a img passa a apontar pra ela.
      buscarSofia();
      e.target.style.display = 'none';
      const ph = e.target.nextSibling;
      if (ph) ph.style.display = 'flex';
    }
  };

  const onClick = (e) => {
    e.stopPropagation();
    if (onZoom) onZoom(e.target.src);
  };

  // Se já resolvemos a foto da Sofia, começa direto por ela (evita piscar).
  const primeiraUrl = sofiaUrl || (storageBase + urls[0] + cb);

  if (aspectRatio) {
    return (
      <div style={{
        width: '100%', aspectRatio: '3/4', position: 'relative',
        overflow: 'hidden', borderRadius: 8,
        background: 'linear-gradient(135deg,#f0ebe3,#e8e2da)',
      }}>
        <img src={primeiraUrl} onError={onError} onClick={onClick}
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
      <img src={primeiraUrl} onError={onError} onClick={onClick}
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
