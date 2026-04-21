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

        {area !== 'home' && (
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
