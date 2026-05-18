/**
 * Lojas_ModalFeedback.jsx — Modal de fechamento do dia (3 perguntas progressivas)
 *
 * Disparado quando vendedora abre a 7ª (última) sugestão do dia.
 * Pergunta sobre 1 cliente que recebeu mensagem ONTEM, com 3 sinais:
 *   Q1 (ESTADO):    respondeu | quietou | ignorou | vou_insistir
 *   Q2 (PERCEPÇÃO): com_certeza | talvez | dificil | ja_era
 *   Q3 (AÇÃO):      mandar_outra | esperar | outro_canal | deixar_quieta
 *
 * Early-exit: se Q1 e Q2 ambas NEGATIVAS, pula Q3 (cliente claramente morto).
 *   Negativas Q1: quietou, ignorou
 *   Negativas Q2: dificil, ja_era
 *
 * Templates de intro/close + alternativas rotacionados pelo backend.
 *
 * Sessão Ailson 18/05/2026 — Sprint A.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { palette, FONT, fz, sz } from './Lojas_Shared.jsx';

const NEGATIVAS_Q1 = new Set(['quietou', 'ignorou']);
const NEGATIVAS_Q2 = new Set(['dificil', 'ja_era']);

async function chamarApi(path, opts) {
  const res = await fetch(path, opts);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

// Ailson 18/05/2026: referencia temporal natural da data da sugestao.
// "ontem" / "anteontem" / "na sexta" / "no dia 12/05".
// Usado nas perguntas do modal pra nao ficar hardcoded em "ontem".
function referenciaTemporal(dataISO) {
  if (!dataISO) return 'naquela conversa';
  // Parse ISO sem timezone bug (date-only)
  const [y, m, d] = dataISO.split('-').map(Number);
  if (!y || !m || !d) return 'naquela conversa';
  const data = new Date(y, m - 1, d);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diffDias = Math.round((hoje - data) / 86400000);
  if (diffDias === 1) return 'ontem';
  if (diffDias === 2) return 'anteontem';
  if (diffDias >= 3 && diffDias <= 7) {
    const dias = ['no domingo', 'na segunda', 'na terça', 'na quarta', 'na quinta', 'na sexta', 'no sábado'];
    return dias[data.getDay()];
  }
  return `no dia ${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// HOOK: gerencia carregamento + persistência das respostas
// ═══════════════════════════════════════════════════════════════════════════

function useFeedbackDiario({ userId, vendedoraId, ativo }) {
  const [estado, setEstado] = useState({
    carregando: true,
    erro: null,
    dados: null,
    semCandidatos: false,
    jaRespondeuHoje: false,
  });

  // Carrega candidato ao montar (se ativo)
  useEffect(() => {
    if (!ativo || !userId) return;

    let cancelado = false;
    setEstado(e => ({ ...e, carregando: true, erro: null }));

    chamarApi('/api/lojas-feedback-selecionar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User': userId },
      body: JSON.stringify({}),
    })
      .then(r => {
        if (cancelado) return;
        if (r.ja_respondeu_hoje) {
          setEstado({ carregando: false, erro: null, dados: null, semCandidatos: false, jaRespondeuHoje: true });
        } else if (r.sem_candidatos) {
          setEstado({ carregando: false, erro: null, dados: null, semCandidatos: true, jaRespondeuHoje: false });
        } else {
          setEstado({ carregando: false, erro: null, dados: r, semCandidatos: false, jaRespondeuHoje: false });
        }
      })
      .catch(err => {
        if (cancelado) return;
        setEstado({ carregando: false, erro: err.message, dados: null, semCandidatos: false, jaRespondeuHoje: false });
      });

    return () => { cancelado = true; };
  }, [ativo, userId, vendedoraId]);

  const registrar = useCallback(async (payload) => {
    if (!estado.dados?.feedback_id) return;
    return chamarApi('/api/lojas-feedback-registrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User': userId },
      body: JSON.stringify({ feedback_id: estado.dados.feedback_id, ...payload }),
    });
  }, [estado.dados?.feedback_id, userId]);

  return { estado, registrar };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE: ModalFeedbackDiario
// ═══════════════════════════════════════════════════════════════════════════

export default function ModalFeedbackDiario({
  userId,
  vendedoraId,
  vendedoraNome,
  onClose,
}) {
  const { estado, registrar } = useFeedbackDiario({ userId, vendedoraId, ativo: true });
  const [pergunta, setPergunta] = useState(1);                    // 1, 2, 3
  const [respostas, setRespostas] = useState({ q1: null, q2: null, q3: null });
  const [salvando, setSalvando] = useState(false);
  const [encerrado, setEncerrado] = useState(false);
  const [showAgradecimento, setShowAgradecimento] = useState(false);

  // Fecha modal se backend disse que não tem candidatos OU já respondeu hoje
  useEffect(() => {
    if (estado.jaRespondeuHoje || estado.semCandidatos) {
      onClose?.();
    }
  }, [estado.jaRespondeuHoje, estado.semCandidatos, onClose]);

  // Handler quando vendedora abandona modal sem completar
  // Marca como 'abandonou' no backend pra IA saber que dropou
  const handleAbandonar = useCallback(() => {
    if (encerrado || !estado.dados?.feedback_id) {
      onClose?.();
      return;
    }
    registrar({ motivo_encerramento: 'abandonou' })
      .catch(() => {})  // silent — não trava UX
      .finally(() => onClose?.());
  }, [encerrado, estado.dados?.feedback_id, registrar, onClose]);

  // Click numa alternativa da pergunta atual
  const handleResponder = useCallback(async (valor) => {
    if (salvando) return;
    setSalvando(true);

    const novasResp = { ...respostas };
    if (pergunta === 1) novasResp.q1 = valor;
    if (pergunta === 2) novasResp.q2 = valor;
    if (pergunta === 3) novasResp.q3 = valor;
    setRespostas(novasResp);

    // Decide próximo passo
    let proximaPergunta = pergunta + 1;
    let motivo = null;

    if (pergunta === 2) {
      // Early-exit: Q1 e Q2 ambas negativas → pula Q3
      if (NEGATIVAS_Q1.has(novasResp.q1) && NEGATIVAS_Q2.has(novasResp.q2)) {
        proximaPergunta = 999;
        motivo = '2_negativas';
      }
    } else if (pergunta === 3) {
      proximaPergunta = 999;
      motivo = 'completo';
    }

    try {
      await registrar({
        q1: pergunta === 1 ? valor : undefined,
        q2: pergunta === 2 ? valor : undefined,
        q3: pergunta === 3 ? valor : undefined,
        motivo_encerramento: motivo || undefined,
      });
    } catch (e) {
      // Erro silencioso — vendedora não deve ser bloqueada
      console.warn('[ModalFeedback] erro registrar:', e.message);
    }

    setSalvando(false);

    if (proximaPergunta === 999) {
      setEncerrado(true);
      setShowAgradecimento(true);
      setTimeout(() => onClose?.(), 2200);  // 2.2s de "brigada parceira" e fecha
    } else {
      setPergunta(proximaPergunta);
    }
  }, [pergunta, respostas, registrar, salvando, onClose]);

  // ─── Renders ───────────────────────────────────────────────────────────

  if (estado.carregando) {
    return (
      <Overlay onClick={null}>
        <Card>
          <div style={{ textAlign: 'center', padding: 24, fontFamily: FONT, fontSize: fz(15), color: palette.inkSoft }}>
            Carregando…
          </div>
        </Card>
      </Overlay>
    );
  }

  if (estado.erro || (!estado.dados && !showAgradecimento)) {
    // Não bloqueia se erro — fecha silencioso
    setTimeout(() => onClose?.(), 0);
    return null;
  }

  if (showAgradecimento) {
    return (
      <Overlay onClick={null}>
        <Card>
          <div style={{ textAlign: 'center', padding: '32px 24px', fontFamily: FONT }}>
            <div style={{ fontSize: fz(34), marginBottom: 8 }}>🚀</div>
            <div style={{ fontSize: fz(20), fontWeight: 700, color: palette.ink, marginBottom: 6 }}>
              Brigada, parceira!
            </div>
            <div style={{ fontSize: fz(15), color: palette.inkSoft }}>
              Boa noite 🌙
            </div>
          </div>
        </Card>
      </Overlay>
    );
  }

  const dados = estado.dados;
  const introTexto = (dados.template_intro?.texto || 'Ô {nome}! Antes de bater ponto, conta rapidinho 👀')
    .replace('{nome}', vendedoraNome || 'vendedora');
  const closeTexto = dados.template_q3_close?.texto || 'Tá quase! Última, prometo 😄';

  // Pergunta 1 — ESTADO
  if (pergunta === 1) {
    const quando = referenciaTemporal(dados.data_sugestao);
    return (
      <ModalSkeleton
        intro={introTexto}
        progresso={`Pergunta 1 de 3`}
        cliente={dados.cliente_nome}
        contextoPergunta={`Como foi com ${dados.cliente_nome} ${quando}?`}
        alternativas={dados.alternativas?.q1 || []}
        onClick={handleResponder}
        onPular={handleAbandonar}
        salvando={salvando}
      />
    );
  }

  // Pergunta 2 — PERCEPÇÃO
  if (pergunta === 2) {
    return (
      <ModalSkeleton
        intro={introTexto}
        progresso={`Pergunta 2 de 3`}
        cliente={dados.cliente_nome}
        contextoPergunta={`Tu acha que ela ainda compra com a gente?`}
        alternativas={dados.alternativas?.q2 || []}
        onClick={handleResponder}
        onPular={handleAbandonar}
        salvando={salvando}
      />
    );
  }

  // Pergunta 3 — AÇÃO
  if (pergunta === 3) {
    return (
      <ModalSkeleton
        intro={closeTexto}
        progresso={`Pergunta 3 de 3`}
        cliente={dados.cliente_nome}
        contextoPergunta={`E o teu plano com ${dados.cliente_nome}?`}
        alternativas={dados.alternativas?.q3 || []}
        onClick={handleResponder}
        onPular={handleAbandonar}
        salvando={salvando}
      />
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBCOMPONENTES VISUAIS
// ═══════════════════════════════════════════════════════════════════════════

function Overlay({ children, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9000, padding: 16, fontFamily: FONT,
      }}
    >
      {children}
    </div>
  );
}

function Card({ children }) {
  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: palette.surface,
        borderRadius: 16,
        maxWidth: 420, width: '100%',
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

function ModalSkeleton({
  intro, progresso, cliente, contextoPergunta, alternativas, onClick, onPular, salvando,
}) {
  return (
    <Overlay onClick={onPular}>
      <Card>
        <div style={{ padding: '20px 22px 4px' }}>
          <div style={{ fontSize: fz(11), fontWeight: 600, color: palette.accent, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
            {progresso}
          </div>
          <div style={{ fontSize: fz(18), fontWeight: 700, color: palette.ink, marginBottom: 6 }}>
            {intro}
          </div>
          <div style={{ fontSize: fz(15), color: palette.inkSoft, marginBottom: 16 }}>
            {contextoPergunta}
          </div>
        </div>
        <div style={{
          padding: '4px 22px 18px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
        }}>
          {alternativas.map(alt => (
            <button
              key={alt.id}
              onClick={() => onClick(alt.id)}
              disabled={salvando}
              style={{
                background: palette.beigeSoft,
                border: `1px solid ${palette.beige}`,
                borderRadius: 10,
                padding: '14px 8px',
                cursor: salvando ? 'wait' : 'pointer',
                fontFamily: FONT,
                fontSize: fz(15),
                fontWeight: 600,
                color: palette.ink,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                transition: 'transform .12s ease, background .12s ease',
              }}
              onMouseDown={e => { e.currentTarget.style.transform = 'scale(0.97)'; }}
              onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              <span style={{ fontSize: fz(26) }}>{alt.emoji}</span>
              <span>{alt.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onPular}
          disabled={salvando}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            borderTop: `1px solid ${palette.beige}`,
            padding: '10px 14px',
            fontSize: fz(13),
            color: palette.inkSoft,
            cursor: 'pointer',
            fontFamily: FONT,
          }}
        >
          Agora não, vou bater ponto
        </button>
      </Card>
    </Overlay>
  );
}
