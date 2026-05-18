/**
 * Lojas_FeedbackResumo.jsx — Painel agregado das respostas do modal de fechamento
 *
 * Sessao Ailson 18/05/2026 (extensao Sprint A).
 *
 * Tela admin que mostra as respostas mais recorrentes do feedback diario,
 * separadas por prioridade_origem (atencao_6plus, atencao_3plus, etc).
 *
 * Le da view vw_lojas_feedback_status_sugestao (status_badge calculado)
 * e da tabela lojas_feedback_diario (respostas Q1, Q2, Q3).
 *
 * Janela padrao: ultimos 30 dias.
 */
import React, { useState, useEffect } from 'react';
import { palette, FONT, fz, sz, supabase } from './Lojas_Shared.jsx';
import { ChevronLeft, BarChart3, AlertTriangle, AlertCircle, Pencil, Sparkles, Shuffle } from 'lucide-react';

// Labels amigaveis das prioridades_origem
// Ailson 18/05/2026: removida categoria 'editou_muito' (nao agregava valor).
const PRIORIDADE_LABEL = {
  atencao_6plus: { label: 'Clientes 6+',     icon: AlertTriangle, cor: palette.warn || '#c97a16', sub: '6+ meses sem comprar ou 6x média de janela' },
  atencao_3plus: { label: 'Clientes 3+',     icon: AlertCircle,   cor: palette.accent || '#5a6470', sub: '3+ meses sem comprar ou 3x média de janela' },
  cliente_novo:  { label: 'Clientes novos',  icon: Sparkles,      cor: palette.ok || '#3a7a3c', sub: '1ª compra recente' },
  aleatorio:     { label: 'Outros',          icon: Shuffle,       cor: palette.inkSoft || '#6a7280', sub: 'Sorteados aleatoriamente' },
};

// Labels amigaveis das respostas
const Q1_LABELS = {
  respondeu:     '✅ Respondeu',
  sem_resposta: '💭 Sem resposta',
  ignorou:       '😶 Ignorou',
  vou_insistir:  '💪 Vou insistir',
};
const Q2_LABELS = {
  com_certeza:   '👍 Com certeza',
  talvez:        '🤔 Talvez',
  dificil:       '😬 Difícil',
  ja_era:        '⚰️ Já era',
};
const Q3_LABELS = {
  mandar_outra:  '📨 Mandar outra',
  esperar:       '⏳ Esperar',
  outro_canal:   '📞 Outro canal',
  deixar_quieta: '🤫 Deixar quieta',
};

export default function FeedbackResumoScreen({ lojas, onBack }) {
  const [janela, setJanela] = useState(30);  // dias
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);

    (async () => {
      try {
        const dataLimite = new Date();
        dataLimite.setDate(dataLimite.getDate() - janela);
        const dataLimiteISO = dataLimite.toISOString().slice(0, 10);

        const { data, error } = await supabase
          .from('lojas_feedback_diario')
          .select('vendedora_id, cliente_id, prioridade_origem, resposta_q1, resposta_q2, resposta_q3, motivo_encerramento, data_pergunta')
          .gte('data_pergunta', dataLimiteISO)
          .order('data_pergunta', { ascending: false });

        if (error) throw error;
        if (cancelado) return;

        setDados(data || []);
      } catch (e) {
        if (cancelado) return;
        setErro(e.message);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();

    return () => { cancelado = true; };
  }, [janela]);

  // ─── Agregacoes ────────────────────────────────────────────────────────

  const agregados = React.useMemo(() => {
    if (!dados || dados.length === 0) return null;

    // Por prioridade_origem
    const porPrioridade = {};
    for (const f of dados) {
      const p = f.prioridade_origem;
      if (!porPrioridade[p]) {
        porPrioridade[p] = { total: 0, q1: {}, q2: {}, q3: {}, status: { completo: 0, early_exit: 0, parcial: 0, abandonou: 0 } };
      }
      const bucket = porPrioridade[p];
      bucket.total++;
      if (f.resposta_q1) bucket.q1[f.resposta_q1] = (bucket.q1[f.resposta_q1] || 0) + 1;
      if (f.resposta_q2) bucket.q2[f.resposta_q2] = (bucket.q2[f.resposta_q2] || 0) + 1;
      if (f.resposta_q3) bucket.q3[f.resposta_q3] = (bucket.q3[f.resposta_q3] || 0) + 1;
      // Status
      if (f.motivo_encerramento === 'completo')          bucket.status.completo++;
      else if (f.motivo_encerramento === '2_negativas')  bucket.status.early_exit++;
      else if (f.motivo_encerramento === 'abandonou')    bucket.status.abandonou++;
      else if (f.resposta_q1 || f.resposta_q2)           bucket.status.parcial++;
    }

    // Total geral
    const totalGeral = dados.length;
    const clientesUnicos = new Set(dados.map(d => d.cliente_id)).size;

    return { porPrioridade, totalGeral, clientesUnicos };
  }, [dados]);

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: palette.bg, fontFamily: FONT, paddingBottom: 24 }}>
      {/* Header */}
      <div style={{
        background: palette.ink, color: '#fff', padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 10, position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={onBack} style={{
          background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer',
          padding: 4, display: 'flex', alignItems: 'center',
        }}>
          <ChevronLeft size={sz(24)} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: fz(18), fontWeight: 700 }}>Feedback Vendedoras</div>
          <div style={{ fontSize: fz(13), opacity: 0.75 }}>Respostas do modal de fechamento</div>
        </div>
      </div>

      {/* Filtro de janela */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[7, 30, 90].map(d => (
          <button
            key={d}
            onClick={() => setJanela(d)}
            style={{
              background: janela === d ? palette.ink : palette.surface,
              color: janela === d ? '#fff' : palette.ink,
              border: `1px solid ${janela === d ? palette.ink : palette.beige}`,
              borderRadius: 8, padding: '6px 14px',
              fontSize: fz(14), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
            }}
          >
            {d} dias
          </button>
        ))}
      </div>

      {/* Conteudo */}
      <div style={{ padding: '0 16px' }}>
        {carregando && (
          <div style={{ padding: 32, textAlign: 'center', color: palette.inkSoft }}>
            Carregando…
          </div>
        )}

        {erro && (
          <div style={{ padding: 14, background: '#fde8e8', borderRadius: 10, color: '#7a1c1c', fontSize: fz(14) }}>
            Erro ao carregar: {erro}
          </div>
        )}

        {!carregando && !erro && (!agregados || agregados.totalGeral === 0) && (
          <div style={{
            padding: 24, background: palette.surface, borderRadius: 12,
            border: `1px solid ${palette.beige}`, textAlign: 'center',
          }}>
            <BarChart3 size={sz(36)} color={palette.inkMuted} style={{ marginBottom: 8 }}/>
            <div style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink, marginBottom: 4 }}>
              Sem feedback ainda
            </div>
            <div style={{ fontSize: fz(14), color: palette.inkSoft }}>
              Quando as vendedoras responderem o modal de fechamento, as agregações aparecem aqui.
            </div>
          </div>
        )}

        {!carregando && !erro && agregados && agregados.totalGeral > 0 && (
          <>
            {/* Resumo geral */}
            <ResumoGeral agregados={agregados} janela={janela} />

            {/* Por categoria */}
            {Object.entries(agregados.porPrioridade)
              .sort(([a], [b]) => {
                const ordem = ['atencao_6plus','atencao_3plus','cliente_novo','aleatorio'];
                return ordem.indexOf(a) - ordem.indexOf(b);
              })
              .map(([prio, b]) => (
                <CardCategoria key={prio} prioridade={prio} bucket={b} />
              ))
            }
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
// SUBCOMPONENTES
// ───────────────────────────────────────────────────────────────────────

function ResumoGeral({ agregados, janela }) {
  const { totalGeral, clientesUnicos } = agregados;
  // Conta status global
  const statusGlobal = { completo: 0, early_exit: 0, parcial: 0, abandonou: 0 };
  for (const b of Object.values(agregados.porPrioridade)) {
    statusGlobal.completo += b.status.completo;
    statusGlobal.early_exit += b.status.early_exit;
    statusGlobal.parcial += b.status.parcial;
    statusGlobal.abandonou += b.status.abandonou;
  }

  return (
    <div style={{
      background: palette.surface, border: `1px solid ${palette.beige}`,
      borderRadius: 12, padding: 14, marginBottom: 12,
    }}>
      <div style={{ fontSize: fz(13), color: palette.inkSoft, marginBottom: 6, fontWeight: 600 }}>
        ÚLTIMOS {janela} DIAS
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: fz(32), fontWeight: 700, color: palette.ink }}>
          {clientesUnicos}
        </span>
        <span style={{ fontSize: fz(14), color: palette.inkSoft }}>
          {clientesUnicos === 1 ? 'cliente ouvido' : 'clientes ouvidos'}
          {totalGeral !== clientesUnicos && ` (${totalGeral} respostas)`}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: fz(13), color: palette.inkSoft }}>
        {statusGlobal.completo > 0 && <span>✅ {statusGlobal.completo} completos</span>}
        {statusGlobal.early_exit > 0 && <span>🛑 {statusGlobal.early_exit} early-exit</span>}
        {statusGlobal.parcial > 0 && <span>⚡ {statusGlobal.parcial} parciais</span>}
        {statusGlobal.abandonou > 0 && <span>🚪 {statusGlobal.abandonou} abandonados</span>}
      </div>
    </div>
  );
}

function CardCategoria({ prioridade, bucket }) {
  const meta = PRIORIDADE_LABEL[prioridade] || { label: prioridade, icon: BarChart3, cor: palette.inkSoft, sub: '' };
  const Icone = meta.icon;
  const total = bucket.total;

  return (
    <div style={{
      background: palette.surface, border: `1px solid ${palette.beige}`,
      borderRadius: 12, padding: 14, marginBottom: 12,
    }}>
      {/* Header da categoria */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, background: `${meta.cor}22`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icone size={sz(22)} color={meta.cor}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: fz(16), fontWeight: 700, color: palette.ink }}>
            {meta.label} <span style={{ color: palette.inkSoft, fontWeight: 500 }}>· {total}</span>
          </div>
          <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 2 }}>{meta.sub}</div>
        </div>
      </div>

      {/* 3 perguntas */}
      <Pergunta titulo="Estado" respostas={bucket.q1} labels={Q1_LABELS} total={total} cor={meta.cor}/>
      <Pergunta titulo="Percepção" respostas={bucket.q2} labels={Q2_LABELS} total={total} cor={meta.cor}/>
      <Pergunta titulo="Plano" respostas={bucket.q3} labels={Q3_LABELS} total={total} cor={meta.cor}/>
    </div>
  );
}

function Pergunta({ titulo, respostas, labels, total, cor }) {
  const entries = Object.entries(respostas).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: fz(12), color: palette.inkSoft, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {titulo}
        </div>
        <div style={{ fontSize: fz(13), color: palette.inkMuted, fontStyle: 'italic' }}>
          Ninguém respondeu
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: fz(12), color: palette.inkSoft, fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {titulo}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.map(([resp, qtd]) => {
          const pct = Math.round((qtd / total) * 100);
          return (
            <div key={resp} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fz(13) }}>
              <div style={{ minWidth: 130, color: palette.ink }}>{labels[resp] || resp}</div>
              <div style={{
                flex: 1, height: 16, background: palette.beigeSoft, borderRadius: 4, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${pct}%`, height: '100%', background: cor,
                  transition: 'width .3s ease',
                }}/>
              </div>
              <div style={{ minWidth: 56, textAlign: 'right', color: palette.inkSoft, fontVariantNumeric: 'tabular-nums' }}>
                {qtd} · {pct}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
