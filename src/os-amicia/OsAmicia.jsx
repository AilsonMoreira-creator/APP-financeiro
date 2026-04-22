/**
 * OsAmicia.jsx — Casca do módulo OS Amícia (Fase 1 · Sprint 1)
 *
 * Por enquanto é só o shell: cabeçalho, tabs placeholder pras 4 áreas,
 * e um painel admin mínimo que bate em /api/ia-status.
 *
 * Sprints futuros vão preencher cada área. Este arquivo nunca deve
 * importar do App.tsx — o módulo é intencionalmente independente.
 *
 * Props:
 *   - supabase: cliente Supabase (compartilhado)
 *   - usuarioLogado: { usuario, admin }
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Card2Vendas24m,
  Card3CanaisComp,
  Card4ContasBling,
  Card5TopMovers,
  Card6Margens,
  Card7Oportunidades,
} from './MarketplacesCards.jsx';
import { TabEstoque } from './EstoqueCards.jsx';

const SERIF = "Georgia,'Times New Roman',serif";
const CALIBRI = "Calibri,'Segoe UI',Arial,sans-serif";

// Paleta oficial do OS Amícia (doc seção 2)
const C = {
  iaBg:     '#EAE0D5',
  iaDark:   '#373F51',
  iaDarker: '#1C2533',
  appBg:    '#f7f4f0',
  cream:    '#e8e2da',
  blueDark: '#2c3e50',
  blue:     '#4a7fa5',
  critical: '#c0392b',
  warning:  '#c8a040',
  success:  '#27ae60',
  muted:    '#8a9aa4',
};

const AREAS = [
  { id: 'home',         label: 'Home',         icon: '🏠' },
  { id: 'estoque',      label: 'Estoque',      icon: '📦' },
  { id: 'producao',     label: 'Produção',     icon: '✂️' },
  { id: 'marketplaces', label: 'Marketplaces', icon: '🛒' },
];

// SVG oficial (contrato visual do preview, linhas 793-804)
export function SvgOSAmicia({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="20" fill="#EAE0D5" />
      <path d="M50 35V20H75" stroke="#373F51" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 65V80H25" stroke="#373F51" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M35 50H20V30" stroke="#373F51" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M65 50H80V70" stroke="#373F51" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="75" cy="20" r="5" fill="#373F51" />
      <circle cx="25" cy="80" r="5" fill="#373F51" />
      <circle cx="20" cy="30" r="5" fill="#373F51" />
      <circle cx="80" cy="70" r="5" fill="#373F51" />
      <rect x="35" y="35" width="30" height="30" rx="6" fill="#1C2533" />
    </svg>
  );
}

export default function OsAmicia({ supabase, usuarioLogado }) {
  const [area, setArea] = useState('home');
  const [status, setStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const isAdmin = usuarioLogado?.admin === true;
  const usuario = usuarioLogado?.usuario || '';

  const carregarStatus = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingStatus(true);
    try {
      const r = await fetch('/api/ia-status', { headers: { 'X-User': usuario } });
      if (r.ok) {
        const d = await r.json();
        setStatus(d);
      }
    } catch (e) {
      console.error('[os-amicia] status:', e);
    } finally {
      setLoadingStatus(false);
    }
  }, [isAdmin, usuario]);

  useEffect(() => {
    carregarStatus();
  }, [carregarStatus]);

  // v1.0 decisão: Home só admin (schema multi-user preparado)
  if (!isAdmin) {
    return (
      <div style={{ padding: 32, fontFamily: SERIF, color: C.blueDark, textAlign: 'center' }}>
        <SvgOSAmicia size={48} />
        <h2 style={{ marginTop: 12 }}>OS Amícia</h2>
        <p style={{ color: C.muted, fontSize: 13 }}>
          Módulo em preparação. Disponível somente para admin nesta versão.
        </p>
      </div>
    );
  }

  return (
    <div style={{ background: C.appBg, minHeight: '100%', fontFamily: SERIF, color: C.blueDark }}>
      {/* Cabeçalho com gradiente bege */}
      <div
        style={{
          background: `linear-gradient(135deg, ${C.iaBg} 0%, #fff 100%)`,
          borderBottom: `1px solid ${C.cream}`,
          padding: '18px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <SvgOSAmicia size={56} />
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.iaDarker }}>OS Amícia</div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            Sistema operacional de decisão · conecta · analisa · recomenda
          </div>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>
          Fase 1 · Sprint 1 · casca em preparação
        </div>
      </div>

      {/* Tabs das 4 áreas */}
      <div
        style={{
          display: 'flex',
          background: '#fff',
          borderBottom: `1px solid ${C.cream}`,
          padding: '0 24px',
        }}
      >
        {AREAS.map(a => {
          const ativo = area === a.id;
          return (
            <button
              key={a.id}
              onClick={() => setArea(a.id)}
              style={{
                background: 'none',
                border: 'none',
                padding: '12px 20px',
                fontSize: 13,
                fontFamily: SERIF,
                fontWeight: ativo ? 700 : 400,
                color: ativo ? C.iaDarker : C.muted,
                borderBottom: ativo ? `2px solid ${C.iaDarker}` : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {a.icon} {a.label}
            </button>
          );
        })}
      </div>

      {/* Área do conteúdo */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
        {area === 'home' && (
          <>
            {/* Painel admin mínimo (Sprint 1 entrega isso) */}
            <div
              style={{
                background: '#fff',
                border: `1px solid ${C.cream}`,
                borderRadius: 12,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 15, color: C.iaDarker }}>
                  🩺 Saúde da Integração
                </h3>
                <button
                  onClick={carregarStatus}
                  disabled={loadingStatus}
                  style={{
                    background: C.iaDark,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 12px',
                    fontSize: 11,
                    cursor: 'pointer',
                    fontFamily: SERIF,
                    opacity: loadingStatus ? 0.6 : 1,
                  }}
                >
                  {loadingStatus ? 'Carregando...' : '🔄 Atualizar'}
                </button>
              </div>

              {!status ? (
                <div style={{ fontSize: 11, color: C.muted, textAlign: 'center', padding: 12 }}>
                  Carregando estado do OS Amícia...
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <StatusCard
                    label="Próximo cron"
                    valor={status.proximo_cron_brt || '—'}
                    hint="Sprint 3 ativa o cron real"
                  />
                  <StatusCard
                    label="Insights ativos"
                    valor={status.insights_ativos?.total ?? 0}
                    hint={`${status.insights_ativos?.por_severity?.critico || 0} críticos`}
                  />
                  <StatusCard
                    label="Gasto Anthropic"
                    valor={`R$ ${(status.anthropic?.gasto_brl_mes || 0).toFixed(2)}`}
                    hint={`de R$ ${status.anthropic?.orcamento_brl_mes || 80} (${status.anthropic?.pct_orcamento || 0}%)`}
                    warn={status.anthropic?.alerta_amarelo}
                  />
                </div>
              )}
            </div>

            {/* Próximos passos visíveis */}
            <div
              style={{
                background: C.iaBg,
                border: `1px solid ${C.iaDark}`,
                borderRadius: 12,
                padding: 20,
                fontSize: 13,
                color: C.iaDarker,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                📋 Próximos sprints (roadmap público)
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                <li>
                  <b>Sprint 2</b> — views SQL do fluxo de corte (1–10)
                </li>
                <li>
                  <b>Sprint 3</b> — cron 07h/14h + integração Claude Sonnet 4.6
                </li>
                <li>
                  <b>Sprint 4</b> — views Marketplaces (11–23) + Card 1 Lucro do Mês
                </li>
                <li>
                  <b>Sprint 5</b> — IA Marketplaces
                </li>
                <li>
                  <b>Sprint 6</b> — Frontend das 4 áreas (26 cards)
                </li>
                <li>
                  <b>Sprint 7</b> — Home Geral + Realtime
                </li>
                <li>
                  <b>Sprint 8</b> — Pergunta livre + polish
                </li>
              </ul>
            </div>
          </>
        )}

        {area === 'producao' && (
          <TabProducao usuario={usuario} C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
        )}

        {area === 'marketplaces' && (
          <TabMarketplaces usuario={usuario} isAdmin={isAdmin} C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
        )}

        {area === 'estoque' && isAdmin && (
          <TabEstoque usuario={usuario} C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
        )}

        {area === 'estoque' && !isAdmin && (
          <div
            style={{
              background: '#fff',
              border: `1px dashed ${C.cream}`,
              borderRadius: 12,
              padding: 40,
              textAlign: 'center',
              color: C.muted,
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>🔒</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.blueDark }}>
              Tab Estoque é admin-only na v1.0
            </div>
            <div style={{ fontSize: 12, marginTop: 6 }}>
              Visibilidade expandida está planejada para fases futuras.
            </div>
          </div>
        )}

        {area !== 'home' && area !== 'producao' && area !== 'marketplaces' && area !== 'estoque' && (
          <div
            style={{
              background: '#fff',
              border: `1px dashed ${C.cream}`,
              borderRadius: 12,
              padding: 40,
              textAlign: 'center',
              color: C.muted,
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 8 }}>
              {AREAS.find(a => a.id === area)?.icon}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.blueDark }}>
              {AREAS.find(a => a.id === area)?.label} entra no Sprint 6
            </div>
            <div style={{ fontSize: 12, marginTop: 6 }}>
              Infra de backend (tabelas, cron, IA) é construída primeiro nos Sprints 1-5.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabProducao({ usuario, C, SERIF, CALIBRI }) {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [disparando, setDisparando] = useState(false);
  const [erro, setErro] = useState(null);
  const [feedbackEnviando, setFeedbackEnviando] = useState({});
  const [feedbackDado, setFeedbackDado] = useState({});
  const [ultimoDisparo, setUltimoDisparo] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch('/api/ia-feed?area=producao&limit=50', {
        headers: { 'X-User': usuario },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setInsights(d.insights || []);
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [usuario]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const dispararAgora = async () => {
    setDisparando(true);
    setErro(null);
    setUltimoDisparo(null);
    try {
      const r = await fetch('/api/ia-disparar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': usuario },
        body: '{}',
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setUltimoDisparo({
        modo: d.modo,
        total: d.total_insights_gerados,
        custo_brl: d.custo_brl,
        duracao_ms: d.duracao_ms,
        erro_claude: d.erro_claude,
      });
      // Recarrega a lista
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setDisparando(false);
    }
  };

  const enviarFeedback = async (insightId, resposta) => {
    setFeedbackEnviando(prev => ({ ...prev, [insightId]: resposta }));
    try {
      const r = await fetch('/api/ia-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': usuario },
        body: JSON.stringify({ insight_id: insightId, resposta }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setFeedbackDado(prev => ({ ...prev, [insightId]: resposta }));
    } catch (e) {
      alert(`Erro ao enviar feedback: ${e.message}`);
    } finally {
      setFeedbackEnviando(prev => {
        const n = { ...prev };
        delete n[insightId];
        return n;
      });
    }
  };

  return (
    <div>
      {/* Barra de ação */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={dispararAgora}
          disabled={disparando}
          style={{
            background: C.iaDarker,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: SERIF,
            cursor: disparando ? 'wait' : 'pointer',
            opacity: disparando ? 0.6 : 1,
          }}
        >
          {disparando ? '⏳ Analisando…' : '⚡ Disparar agora'}
        </button>
        <button
          onClick={carregar}
          disabled={loading}
          style={{
            background: 'transparent',
            color: C.iaDarker,
            border: `1px solid ${C.iaDark}`,
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            fontFamily: SERIF,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Carregando…' : '🔄 Atualizar feed'}
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>
          {insights.length} insight{insights.length === 1 ? '' : 's'} ativo{insights.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Resultado do último disparo */}
      {ultimoDisparo && (
        <div
          style={{
            background: ultimoDisparo.modo?.startsWith('fallback') ? '#fff8e1' : '#e8f5e9',
            border: `1px solid ${ultimoDisparo.modo?.startsWith('fallback') ? C.warning : C.success}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 12,
            color: C.iaDarker,
            fontFamily: CALIBRI,
          }}
        >
          <b>Disparo concluído:</b> modo <code>{ultimoDisparo.modo}</code>,{' '}
          {ultimoDisparo.total} insight{ultimoDisparo.total === 1 ? '' : 's'} gerado
          {ultimoDisparo.total === 1 ? '' : 's'}, custo R$ {(ultimoDisparo.custo_brl || 0).toFixed(4)},{' '}
          {ultimoDisparo.duracao_ms}ms
          {ultimoDisparo.erro_claude && (
            <div style={{ marginTop: 6, color: C.critical, fontSize: 11 }}>
              ⚠ Claude: {ultimoDisparo.erro_claude}
            </div>
          )}
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div
          style={{
            background: '#fce4e4',
            border: `1px solid ${C.critical}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 12,
            color: C.critical,
          }}
        >
          ❌ {erro}
        </div>
      )}

      {/* Lista de insights */}
      {loading && insights.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.muted, fontSize: 12 }}>
          Carregando insights…
        </div>
      ) : insights.length === 0 ? (
        <div
          style={{
            background: '#fff',
            border: `1px dashed ${C.cream}`,
            borderRadius: 12,
            padding: 40,
            textAlign: 'center',
            color: C.muted,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>✂️</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.blueDark }}>
            Nenhum insight de produção ainda
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Clique em <b>⚡ Disparar agora</b> pra gerar a primeira análise.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {insights.map(i => (
            <CardInsight
              key={i.id}
              insight={i}
              onFeedback={enviarFeedback}
              enviando={feedbackEnviando[i.id]}
              jaRespondido={feedbackDado[i.id]}
              C={C}
              SERIF={SERIF}
              CALIBRI={CALIBRI}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CardInsight({ insight, onFeedback, enviando, jaRespondido, C, SERIF, CALIBRI }) {
  const severityColor = {
    critico: C.critical,
    atencao: C.warning,
    positiva: C.success,
    oportunidade: C.blue,
    info: C.muted,
  }[insight.severity] || C.muted;

  const confidenceIcon = {
    alta: '🟢',
    media: '🟡',
    baixa: '🔴',
  }[insight.confidence] || '⚪';

  const isFallback = insight.origem === 'fallback_deterministico';

  return (
    <div
      style={{
        background: '#fff',
        borderLeft: `4px solid ${severityColor}`,
        border: `1px solid ${C.cream}`,
        borderLeftWidth: 4,
        borderRadius: 8,
        padding: 16,
        fontFamily: CALIBRI,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            background: severityColor,
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 4,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            fontFamily: SERIF,
          }}
        >
          {insight.severity}
        </span>
        <span style={{ fontSize: 11, color: C.muted }}>
          {confidenceIcon} confiança {insight.confidence}
        </span>
        {insight.categoria && (
          <span
            style={{
              fontSize: 10,
              color: C.muted,
              background: C.appBg,
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {insight.categoria}
          </span>
        )}
        {isFallback && (
          <span
            style={{
              fontSize: 10,
              color: C.warning,
              background: '#fff8e1',
              padding: '2px 6px',
              borderRadius: 4,
              border: `1px solid ${C.warning}`,
            }}
          >
            fallback
          </span>
        )}
      </div>

      {/* Título */}
      <div
        style={{
          fontFamily: SERIF,
          fontSize: 15,
          fontWeight: 700,
          color: C.iaDarker,
          marginBottom: 6,
        }}
      >
        {insight.titulo}
      </div>

      {/* Resumo */}
      {insight.resumo && (
        <div style={{ fontSize: 13, color: C.blueDark, marginBottom: 6, lineHeight: 1.5 }}>
          {insight.resumo}
        </div>
      )}

      {/* Impacto */}
      {insight.impacto && (
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 6, fontStyle: 'italic' }}>
          Impacto: {insight.impacto}
        </div>
      )}

      {/* Ação sugerida */}
      {insight.acao_sugerida && (
        <div
          style={{
            background: C.appBg,
            borderRadius: 6,
            padding: 10,
            fontSize: 13,
            fontWeight: 600,
            color: C.iaDarker,
            marginTop: 8,
            marginBottom: 10,
          }}
        >
          → {insight.acao_sugerida}
        </div>
      )}

      {/* Chaves (se tem) */}
      {insight.chaves && Object.keys(insight.chaves).length > 0 && (
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 10 }}>
          {Object.entries(insight.chaves)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `${k}: ${v}`)
            .join(' · ')}
        </div>
      )}

      {/* Feedback */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          alignItems: 'center',
          borderTop: `1px solid ${C.cream}`,
          paddingTop: 10,
        }}
      >
        <span style={{ fontSize: 11, color: C.muted, marginRight: 4 }}>Útil?</span>
        {['sim', 'parcial', 'nao'].map(op => {
          const ativo = jaRespondido === op;
          const aguardando = enviando === op;
          const label = op === 'sim' ? '👍 Sim' : op === 'parcial' ? '🤔 Parcial' : '👎 Não';
          const corAtivo = op === 'sim' ? C.success : op === 'parcial' ? C.warning : C.critical;
          return (
            <button
              key={op}
              disabled={!!enviando || !!jaRespondido}
              onClick={() => onFeedback(insight.id, op)}
              style={{
                background: ativo ? corAtivo : 'transparent',
                color: ativo ? '#fff' : C.iaDarker,
                border: `1px solid ${ativo ? corAtivo : C.cream}`,
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 11,
                fontFamily: SERIF,
                cursor: (enviando || jaRespondido) ? 'default' : 'pointer',
                opacity: aguardando ? 0.6 : 1,
              }}
            >
              {aguardando ? '…' : label}
            </button>
          );
        })}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: C.muted,
            fontFamily: CALIBRI,
          }}
        >
          {new Date(insight.created_at).toLocaleString('pt-BR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
}


function TabMarketplaces({ usuario, isAdmin, C, SERIF, CALIBRI }) {
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [disparando, setDisparando] = useState(false);
  const [erro, setErro] = useState(null);
  const [feedbackEnviando, setFeedbackEnviando] = useState({});
  const [feedbackDado, setFeedbackDado] = useState({});
  const [ultimoDisparo, setUltimoDisparo] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch('/api/ia-feed?area=marketplaces&limit=50', {
        headers: { 'X-User': usuario },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setInsights(d.insights || []);
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [usuario]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const dispararAgora = async () => {
    setDisparando(true);
    setErro(null);
    setUltimoDisparo(null);
    try {
      const r = await fetch('/api/ia-disparar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': usuario },
        body: JSON.stringify({ escopo: 'marketplaces' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setUltimoDisparo({
        modo: d.modo,
        total: d.total_insights_gerados,
        custo_brl: d.custo_brl,
        duracao_ms: d.duracao_ms,
        erro_claude: d.erro_claude,
      });
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setDisparando(false);
    }
  };

  const enviarFeedback = async (insightId, resposta) => {
    setFeedbackEnviando(prev => ({ ...prev, [insightId]: resposta }));
    try {
      const r = await fetch('/api/ia-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': usuario },
        body: JSON.stringify({ insight_id: insightId, resposta }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setFeedbackDado(prev => ({ ...prev, [insightId]: resposta }));
    } catch (e) {
      alert(`Erro ao enviar feedback: ${e.message}`);
    } finally {
      setFeedbackEnviando(prev => {
        const n = { ...prev };
        delete n[insightId];
        return n;
      });
    }
  };

  return (
    <div>
      {/* Card 1 — Lucro do mês (admin-only, dupla validação no backend) */}
      {isAdmin && <Card1LucroMes usuario={usuario} C={C} SERIF={SERIF} CALIBRI={CALIBRI} />}

      {/* Cards 2-7 — dashboard operacional visual (Sprint 5) */}
      <Card3CanaisComp      C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
      <Card4ContasBling     C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
      <Card5TopMovers       C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
      <Card6Margens         C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
      <Card7Oportunidades   C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
      <Card2Vendas24m       C={C} SERIF={SERIF} CALIBRI={CALIBRI} />

      {/* Barra de ação */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <button
          onClick={dispararAgora}
          disabled={disparando}
          style={{
            background: C.iaDarker,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '10px 18px',
            fontSize: 13,
            fontWeight: 700,
            fontFamily: SERIF,
            cursor: disparando ? 'wait' : 'pointer',
            opacity: disparando ? 0.6 : 1,
          }}
        >
          {disparando ? '⏳ Analisando…' : '⚡ Disparar agora'}
        </button>
        <button
          onClick={carregar}
          disabled={loading}
          style={{
            background: 'transparent',
            color: C.iaDarker,
            border: `1px solid ${C.iaDark}`,
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 12,
            fontFamily: SERIF,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Carregando…' : '🔄 Atualizar feed'}
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: C.muted }}>
          {insights.length} insight{insights.length === 1 ? '' : 's'} ativo{insights.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Resultado do último disparo */}
      {ultimoDisparo && (
        <div
          style={{
            background: ultimoDisparo.modo?.startsWith('fallback') ? '#fff8e1' : '#e8f5e9',
            border: `1px solid ${ultimoDisparo.modo?.startsWith('fallback') ? C.warning : C.success}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 12,
            color: C.iaDarker,
            fontFamily: CALIBRI,
          }}
        >
          <b>Disparo concluído:</b> modo <code>{ultimoDisparo.modo}</code>,{' '}
          {ultimoDisparo.total} insight{ultimoDisparo.total === 1 ? '' : 's'} gerado
          {ultimoDisparo.total === 1 ? '' : 's'}, custo R$ {(ultimoDisparo.custo_brl || 0).toFixed(4)},{' '}
          {ultimoDisparo.duracao_ms}ms
          {ultimoDisparo.erro_claude && (
            <div style={{ marginTop: 6, color: C.critical, fontSize: 11 }}>
              ⚠ Claude: {ultimoDisparo.erro_claude}
            </div>
          )}
        </div>
      )}

      {/* Erro */}
      {erro && (
        <div
          style={{
            background: '#fce4e4',
            border: `1px solid ${C.critical}`,
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontSize: 12,
            color: C.critical,
          }}
        >
          ❌ {erro}
        </div>
      )}

      {/* Lista de insights */}
      {loading && insights.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: C.muted, fontSize: 12 }}>
          Carregando insights…
        </div>
      ) : insights.length === 0 ? (
        <div
          style={{
            background: '#fff',
            border: `1px dashed ${C.cream}`,
            borderRadius: 12,
            padding: 40,
            textAlign: 'center',
            color: C.muted,
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 8 }}>🛒</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.blueDark }}>
            Nenhum insight de marketplaces ainda
          </div>
          <div style={{ fontSize: 12, marginTop: 6 }}>
            Clique em <b>⚡ Disparar agora</b> pra gerar a primeira análise.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {insights.map(i => (
            <CardInsight
              key={i.id}
              insight={i}
              onFeedback={enviarFeedback}
              enviando={feedbackEnviando[i.id]}
              jaRespondido={feedbackDado[i.id]}
              C={C}
              SERIF={SERIF}
              CALIBRI={CALIBRI}
            />
          ))}
        </div>
      )}
    </div>
  );
}


function Card1LucroMes({ usuario, C, SERIF, CALIBRI }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch('/api/ia-lucro-mes', {
        headers: { 'X-User': usuario },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDados(d);
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [usuario]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const fmt = (v) => (Number(v) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

  const canalLabel = {
    mercadolivre: 'Mercado Livre',
    shopee: 'Shopee',
    shein: 'Shein',
    tiktok: 'TikTok Shop',
    meluni: 'Meluni',
    outros: 'Outros',
  };

  const canalCor = {
    mercadolivre: '#FFE600',
    shopee: '#EE4D2D',
    shein: '#000',
    tiktok: '#010101',
    meluni: '#8B7355',
    outros: C.muted,
  };

  const canalTextCor = {
    mercadolivre: '#2D3277',
    shopee: '#fff',
    shein: '#fff',
    tiktok: '#fff',
    meluni: '#fff',
    outros: '#fff',
  };

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #fff 0%, #f7f4f0 100%)',
        border: `1px solid ${C.cream}`,
        borderRadius: 12,
        padding: 20,
        marginBottom: 18,
        fontFamily: SERIF,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            Card 1 · Admin · Mês corrente ({dados?.mes_ref || '—'})
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: C.iaDarker, marginTop: 2 }}>
            Lucro líquido do mês
          </div>
        </div>
        <button
          onClick={carregar}
          disabled={loading}
          style={{
            background: 'transparent',
            border: `1px solid ${C.cream}`,
            color: C.muted,
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 11,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontFamily: SERIF,
          }}
        >
          {loading ? '…' : '🔄'}
        </button>
      </div>

      {erro ? (
        <div style={{ fontSize: 12, color: C.critical, padding: 12 }}>❌ {erro}</div>
      ) : !dados ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 12 }}>Carregando…</div>
      ) : (
        <>
          {/* Destaque: total */}
          <div
            style={{
              background: C.iaDarker,
              color: '#fff',
              borderRadius: 10,
              padding: 18,
              marginBottom: 14,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
            }}
          >
            <KpiMini label="Unidades" valor={dados.totais.unidades.toLocaleString('pt-BR')} fam={CALIBRI} />
            <KpiMini label="Receita bruta" valor={`R$ ${fmt(dados.totais.receita_bruta)}`} fam={CALIBRI} />
            <KpiMini label="Lucro bruto" valor={`R$ ${fmt(dados.totais.lucro_bruto)}`} fam={CALIBRI} />
            <KpiMini
              label={`Lucro líquido (-${dados.devolucao_aplicada_pct || 10}%)`}
              valor={`R$ ${fmt(dados.totais.lucro_liquido)}`}
              fam={CALIBRI}
              destaque
            />
          </div>

          {/* Breakdown por canal */}
          {dados.canais.length === 0 ? (
            <div style={{ fontSize: 12, color: C.muted, padding: 12, textAlign: 'center' }}>
              Sem vendas sincronizadas neste mês ainda.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              {dados.canais
                .sort((a, b) => b.lucro_liquido - a.lucro_liquido)
                .map(c => (
                  <div
                    key={c.canal}
                    style={{
                      background: canalCor[c.canal] || C.muted,
                      color: canalTextCor[c.canal] || '#fff',
                      borderRadius: 8,
                      padding: 12,
                      fontFamily: CALIBRI,
                    }}
                  >
                    <div style={{ fontSize: 10, opacity: 0.8, letterSpacing: 1, textTransform: 'uppercase', fontFamily: SERIF }}>
                      {canalLabel[c.canal] || c.canal}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800, marginTop: 3 }}>
                      R$ {fmt(c.lucro_liquido)}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.85, marginTop: 3 }}>
                      {c.unidades.toLocaleString('pt-BR')} un · R$ {fmt(c.receita_bruta)}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KpiMini({ label, valor, fam, destaque = false }) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          opacity: 0.7,
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: destaque ? 20 : 16,
          fontWeight: 800,
          marginTop: 2,
          fontFamily: fam,
          color: destaque ? '#ffe600' : '#fff',
        }}
      >
        {valor}
      </div>
    </div>
  );
}


function StatusCard({ label, valor, hint, warn = false }) {
  return (
    <div
      style={{
        background: '#f7f4f0',
        borderRadius: 8,
        padding: 12,
        border: warn ? '1px solid #c8a040' : '1px solid transparent',
      }}
    >
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: warn ? C.warning : C.iaDarker,
          fontFamily: CALIBRI,
          marginTop: 2,
        }}
      >
        {valor}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}
