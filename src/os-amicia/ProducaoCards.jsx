/**
 * ProducaoCards.jsx — Sugestões de Corte do TabProdução (Sprint 6.5).
 *
 * Substitui a versão simplificada do Sprint 3 (TabProdução com texto
 * livre do Claude) pela UI rica do contrato visual em
 * docs/pacote-os-amicia/05_Tela_Sugestao_Corte.html
 *
 * Cada card representa 1 sugestão de corte (1 ref) e mostra:
 *   - Header: pills (Severidade + Confiança), validade, título, cobertura
 *   - Bloco GRADE (1P · 1G · 2GG, peças por módulo)
 *   - Bloco CORES E ROLOS (com swatch + tendência)
 *   - Bloco MATRIZ (cor × tamanho, peças estimadas por célula)
 *   - Bloco TOTAL em evidência (X rolos · Y peças)
 *   - "Por quê" (justificativa textual gerada da IA)
 *   - Aviso de validade (7 dias)
 *   - Ações: Sim · Editar · Não · Explicar
 *
 * FASE 4a: estrutura base sem edição inline (botões "✎ editar" mostram
 * mas ainda não funcionam — fica pra Fase 4b).
 *
 * FASE 5 (futura): modais de Análise / Editar / Explicar + botão
 * "Gerar Ordem de Corte" que integra com OrdemDeCorte.jsx existente.
 *
 * ENDPOINT: GET /api/ia-cortes-dados (Sprint 6.5 Fase 3)
 *   Header: X-User: <usuario admin>
 *   Query: ?limite=30 (default)
 *
 * Padrão visual: idêntico a EstoqueCards.jsx + MarketplacesCards.jsx.
 *   - useFetch com loading/erro/refresh
 *   - CardShell wrapper
 *   - Helpers fmtInt, fmtPct
 */
import { useEffect, useState, useCallback, useMemo } from 'react';

// ─── Helpers de formato ───────────────────────────────────────────────

const fmtInt = (v) => (Number(v) || 0).toLocaleString('pt-BR');

const fmtPct = (v) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return (n >= 0 ? '+' : '') + n.toFixed(0) + '%';
};

const fmtData = (isoStr) => {
  if (!isoStr) return '—';
  try {
    const [y, m, d] = String(isoStr).slice(0, 10).split('-');
    return `${d}/${m}`;
  } catch { return '—'; }
};

// Calcula dias entre agora e expira_em (truncado)
const diasAteExpirar = (expiraIso) => {
  if (!expiraIso) return null;
  const ms = new Date(expiraIso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
};

// Mapeia nome de cor pra hex (swatch). Cores comuns do catálogo Amícia.
// Pra cores não mapeadas, retorna cinza default.
const corHex = (nome) => {
  if (!nome) return '#999';
  const k = String(nome).toLowerCase().trim();
  const map = {
    'preto':         '#1a1a1a',
    'branco':        '#f5f5f5',
    'bege':          '#d4c5a9',
    'marrom':        '#6b4423',
    'marrom escuro': '#3e2818',
    'marinho':       '#1a2845',
    'azul marinho':  '#1a2845',
    'azul':          '#3a5a8c',
    'azul serenity': '#92b4d4',
    'azul bebe':     '#a8c8e0',
    'verde militar': '#4a5d3a',
    'verde agua':    '#9dc8b9',
    'verde água':    '#9dc8b9',
    'vinho':         '#5e1f2c',
    'vermelho':      '#b8242b',
    'rosa':          '#d89aa3',
    'figo':          '#5a3848',
    'cappuccino':    '#a08568',
    'capuccino':     '#a08568',
    'cinza':         '#888',
    'amarelo':       '#e8c547',
    'laranja':       '#d8773b',
    'lilas':         '#9b85b8',
    'lilás':         '#9b85b8',
    'roxo':          '#5a2e8c',
  };
  return map[k] || '#999';
};

// Converte proporcao_pct (do SQL) em modulos absolutos do enfesto.
// Regra: modulos = ROUND(proporcao_pct / 100 * max_modulos)
// Ex: max=5, [P=20%, M=40%, G=20%, GG=20%] -> [1P, 2M, 1G, 1GG]
// Garante minimo 1 modulo por tamanho que entra na grade (nunca 0).
function gradeProporcaoParaModulos(grade, maxModulos) {
  if (!Array.isArray(grade) || grade.length === 0) return [];
  const max = Number(maxModulos) || 5;
  return grade.map(g => ({
    tam: g.tam,
    modulos: Math.max(1, Math.round((Number(g.proporcao_pct) || 0) / 100 * max)),
  }));
}

// Soma total de modulos do enfesto (1+2+1+1 = 5)
function somarModulos(gradeModulos) {
  return (gradeModulos || []).reduce((s, g) => s + (Number(g.modulos) || 0), 0);
}

// Tamanhos disponiveis pra adicionar a grade (padrao moda feminina)
const TAMANHOS_DISPONIVEIS = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3'];

// Calcula matriz cor x tamanho a partir de modulos atuais (nao usa do payload).
// Pecas[cor][tam] = rolos_da_cor * modulos_do_tam * rendimento
function calcularMatriz(coresEditadas, gradeModulos, rendimento) {
  const r = Number(rendimento) || 20;
  const matriz = [];
  (coresEditadas || []).forEach(c => {
    (gradeModulos || []).forEach(g => {
      const rolos = Number(c.rolos) || 0;
      const mods  = Number(g.modulos) || 0;
      if (rolos > 0 && mods > 0) {
        matriz.push({
          cor: c.cor || c.nome,
          tam: g.tam,
          pecas: Math.round(rolos * mods * r),
        });
      }
    });
  });
  return matriz;
}

// ─── Hook de fetch ────────────────────────────────────────────────────

function useCortesData(usuario) {
  const [dados, setDados]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState(null);

  const carregar = useCallback(async () => {
    if (!usuario) {
      setErro('Usuário admin não identificado');
      return;
    }
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch('/api/ia-cortes-dados?limite=30', {
        headers: { 'X-User': usuario },
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setDados(j);
    } catch (e) {
      setErro(e.message || 'Erro ao carregar sugestões');
    } finally {
      setLoading(false);
    }
  }, [usuario]);

  useEffect(() => { carregar(); }, [carregar]);

  return { dados, loading, erro, recarregar: carregar };
}

// ─── Componente raiz ──────────────────────────────────────────────────

export function TabProducao({ usuario, C, SERIF, CALIBRI }) {
  const { dados, loading, erro, recarregar } = useCortesData(usuario);

  // Estado: feedback dado a cada ref (Sim/Editar/Não)
  // Por enquanto local; Sprint 6.2 vai persistir em tabela ia_feedback_cortes
  const [feedbackPorRef, setFeedbackPorRef] = useState({});

  const onFeedback = (ref, tipo) => {
    setFeedbackPorRef(prev => ({ ...prev, [ref]: tipo }));
    // TODO Sprint 6.2: POST /api/ia-cortes-feedback
    console.log(`[ProducaoCards] feedback ref=${ref} tipo=${tipo}`);
  };

  if (loading && !dados) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: C.muted, fontFamily: SERIF }}>
        Carregando sugestões de corte…
      </div>
    );
  }

  if (erro && !dados) {
    return (
      <div style={{
        padding: 18, background: '#fdeaea', border: `1px solid ${C.critical}`,
        borderRadius: 8, color: C.critical, fontFamily: SERIF,
      }}>
        <strong>Erro:</strong> {erro}
        <button
          onClick={recarregar}
          style={{
            marginLeft: 12, background: 'transparent', border: `1px solid ${C.critical}`,
            color: C.critical, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            fontFamily: CALIBRI, fontSize: 12,
          }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const refs = dados?.refs || [];
  const totalCortes = dados?.capacidade_semanal?.total_cortes ?? refs.length;
  const capacidadeStatus = dados?.capacidade_semanal?.status || 'normal';
  const limiteNormal = dados?.capacidade_semanal?.limite_normal;
  const validadeDias = dados?.validade_dias ?? 7;
  const expiraEm = dados?.expira_em;

  return (
    <div>
      {/* Header global da TabProdução */}
      <CapacidadeHeader
        totalCortes={totalCortes}
        status={capacidadeStatus}
        limiteNormal={limiteNormal}
        validadeDias={validadeDias}
        expiraEm={expiraEm}
        loading={loading}
        onRefresh={recarregar}
        C={C} SERIF={SERIF} CALIBRI={CALIBRI}
      />

      {/* Lista de refs sugeridas */}
      {refs.length === 0 ? (
        <div style={{
          padding: 18, background: '#f7f4f0', borderRadius: 8,
          color: C.muted, fontFamily: SERIF, textAlign: 'center', marginTop: 12,
        }}>
          Nenhuma sugestão de corte para a semana.
        </div>
      ) : (
        refs.map(ref => (
          <CardSugestaoCorte
            key={ref.ref}
            ref_={ref}
            feedback={feedbackPorRef[ref.ref]}
            onFeedback={onFeedback}
            C={C} SERIF={SERIF} CALIBRI={CALIBRI}
          />
        ))
      )}
    </div>
  );
}

// ─── Header de capacidade semanal ─────────────────────────────────────

function CapacidadeHeader({ totalCortes, status, limiteNormal, validadeDias, expiraEm, loading, onRefresh, C, SERIF, CALIBRI }) {
  const dias = diasAteExpirar(expiraEm);

  const statusLabel = {
    normal:  { texto: 'Capacidade normal', cor: C.success },
    corrida: { texto: 'Semana corrida',    cor: C.warning },
    excesso: { texto: 'Excesso de cortes', cor: C.critical },
  }[status] || { texto: status, cor: C.muted };

  return (
    <div style={{
      background: 'linear-gradient(135deg, #fff 0%, #f7f4f0 100%)',
      border: `1px solid ${C.cream}`,
      borderRadius: 12,
      padding: '14px 18px',
      marginBottom: 14,
      fontFamily: SERIF,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            Sugestões da semana
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.iaDarker, marginTop: 2 }}>
            {fmtInt(totalCortes)} cortes
            {limiteNormal != null && (
              <span style={{ fontSize: 13, color: C.muted, fontWeight: 400, marginLeft: 8 }}>
                · limite {limiteNormal}/sem
              </span>
            )}
          </div>
        </div>

        <div style={{
          padding: '4px 10px', borderRadius: 12,
          background: statusLabel.cor + '22',
          color: statusLabel.cor, fontFamily: CALIBRI, fontSize: 11, fontWeight: 700,
        }}>
          {statusLabel.texto}
        </div>

        {dias != null && (
          <div style={{ fontFamily: CALIBRI, fontSize: 11, color: C.muted }}>
            ⏳ válida por <strong style={{ color: C.warning }}>{dias} dia{dias !== 1 ? 's' : ''}</strong>
          </div>
        )}
      </div>

      <button
        onClick={onRefresh}
        disabled={loading}
        style={{
          background: 'transparent', border: `1px solid ${C.cream}`,
          color: C.muted, borderRadius: 6, padding: '6px 12px',
          fontSize: 11, fontFamily: CALIBRI, cursor: loading ? 'wait' : 'pointer',
        }}
      >
        {loading ? '…' : '↻ atualizar'}
      </button>
    </div>
  );
}

// ─── Card individual de uma sugestão de corte ────────────────────────

function CardSugestaoCorte({ ref_, feedback, onFeedback, C, SERIF, CALIBRI }) {
  // Pills de severidade
  const sevConfig = {
    alta:  { texto: '🔴 Crítico',    bg: '#fdeaea', cor: C.critical },
    media: { texto: '🟡 Atenção',    bg: '#faf6ec', cor: C.warning },
    baixa: { texto: '🟢 Normal',     bg: '#eafbf0', cor: C.success },
  }[ref_.severidade] || { texto: ref_.severidade, bg: '#eee', cor: C.muted };

  const conConfig = {
    alta:  { texto: '✓ Confiança Alta',   cor: C.success },
    media: { texto: '~ Confiança Média',  cor: C.warning },
    baixa: { texto: '? Confiança Baixa',  cor: C.critical },
  }[ref_.confianca_ref] || { texto: ref_.confianca_ref, cor: C.muted };

  // Cobertura — pegar a menor entre as variações em ruptura
  const minCobertura = (ref_.variacoes_em_ruptura || [])
    .map(v => v.cobertura_projetada_dias)
    .filter(v => v != null)
    .reduce((min, v) => v < min ? v : min, Infinity);
  const coberturaTexto = isFinite(minCobertura)
    ? `Cobertura mínima ${minCobertura.toFixed(1)} dias · ${ref_.qtd_variacoes_em_ruptura || 0} variação(ões) em ruptura`
    : 'Sem ruptura crítica';

  // Estado de edição da grade (modulos absolutos, calculados da proporcao_pct do SQL)
  const gradeInicial = useMemo(
    () => gradeProporcaoParaModulos(ref_.grade || [], ref_.max_modulos),
    [ref_.grade, ref_.max_modulos]
  );
  const [gradeEditada, setGradeEditada] = useState(gradeInicial);
  const [editandoGrade, setEditandoGrade] = useState(false);

  // Estado de edição das cores (cor + rolos)
  const coresIniciais = useMemo(
    () => (ref_.cores || []).map(c => ({
      cor: c.cor,
      rolos: c.rolos,
      tendencia_label: c.tendencia_label,
      tendencia_pct: c.tendencia_pct,
    })),
    [ref_.cores]
  );
  const [coresEditadas, setCoresEditadas] = useState(coresIniciais);
  const [editandoCores, setEditandoCores] = useState(false);

  // Resetar estado se ref mudar (ex: após refresh da lista)
  useEffect(() => {
    setGradeEditada(gradeInicial);
    setEditandoGrade(false);
  }, [gradeInicial]);
  useEffect(() => {
    setCoresEditadas(coresIniciais);
    setEditandoCores(false);
  }, [coresIniciais]);

  // Matriz recalculada dinamicamente (não usa do payload original)
  const rendimento = ref_.rendimento_sala || 20;
  const matrizDinamica = useMemo(
    () => calcularMatriz(coresEditadas, gradeEditada, rendimento),
    [coresEditadas, gradeEditada, rendimento]
  );

  // Total de rolos = soma de rolos de todas cores ativas
  const totalRolosDinamico = (coresEditadas || []).reduce((s, c) => s + (Number(c.rolos) || 0), 0);

  // Total de peças = soma da matriz
  const totalPecasDinamico = (matrizDinamica || []).reduce((s, m) => s + (Number(m.pecas) || 0), 0);

  // Detecta se foi editado vs sugestão original
  const foiEditado = (
    JSON.stringify(gradeEditada) !== JSON.stringify(gradeInicial) ||
    JSON.stringify(coresEditadas) !== JSON.stringify(coresIniciais)
  );

  return (
    <div style={{
      background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 12,
      padding: 18, marginBottom: 12, fontFamily: SERIF,
      borderLeft: `4px solid ${sevConfig.cor}`,
    }}>
      {/* Pills + curva */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <Pill bg={sevConfig.bg} cor={sevConfig.cor}>{sevConfig.texto}</Pill>
        <Pill cor={conConfig.cor}>{conConfig.texto}</Pill>
        {ref_.curva && ref_.curva !== 'outras' && (
          <Pill cor={C.iaDark}>Curva {ref_.curva.toUpperCase()}</Pill>
        )}
        {foiEditado && !feedback && (
          <Pill bg='#faf6ec' cor={C.warning}>✎ Editado</Pill>
        )}
        {feedback && (
          <Pill bg='#eafbf0' cor={C.success}>
            {feedback === 'sim' ? '✓ Aprovado' : feedback === 'editar' ? '✎ Editado' : '✗ Rejeitado'}
          </Pill>
        )}
      </div>

      {/* Título + cobertura */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: C.iaDarker }}>
          ref {ref_.ref} · {ref_.descricao || 'Sem descrição'}
        </div>
        <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
          {coberturaTexto}
          {ref_.pecas_perdidas_se_nao_cortar > 0 && (
            <span style={{ color: C.critical, fontWeight: 600, marginLeft: 8 }}>
              · perde ~{fmtInt(ref_.pecas_perdidas_se_nao_cortar)} peças se não cortar
            </span>
          )}
        </div>
      </div>

      {/* Bloco GRADE - editável */}
      <Bloco
        label='Grade do enfesto'
        editavel
        editando={editandoGrade}
        onToggleEdit={() => setEditandoGrade(v => !v)}
        C={C} SERIF={SERIF} CALIBRI={CALIBRI}
      >
        <BlocoGrade
          gradeModulos={gradeEditada}
          setGradeModulos={setGradeEditada}
          editando={editandoGrade}
          maxModulos={ref_.max_modulos || 5}
          categoria={ref_.categoria_peca}
          C={C} CALIBRI={CALIBRI}
        />
      </Bloco>

      {/* Bloco CORES - editável */}
      <Bloco
        label='Cores e rolos'
        editavel
        editando={editandoCores}
        onToggleEdit={() => setEditandoCores(v => !v)}
        C={C} SERIF={SERIF} CALIBRI={CALIBRI}
      >
        <BlocoCores
          cores={coresEditadas}
          setCores={setCoresEditadas}
          editando={editandoCores}
          C={C} CALIBRI={CALIBRI}
        />
      </Bloco>

      {/* Bloco MATRIZ - calculada dinamicamente */}
      <Bloco
        label='Estimativa de peças · cor × tamanho'
        rightExtra={`≈ ${rendimento} peças/rolo`}
        C={C} SERIF={SERIF} CALIBRI={CALIBRI}
      >
        <BlocoMatriz matriz={matrizDinamica} C={C} CALIBRI={CALIBRI} />
      </Bloco>

      {/* TOTAL em evidência - dinâmico */}
      <BlocoTotalDestaque
        rolos={totalRolosDinamico}
        pecas={totalPecasDinamico}
        cores={coresEditadas.length}
        tamanhos={gradeEditada.length}
        C={C} SERIF={SERIF} CALIBRI={CALIBRI}
      />

      {/* Por quê (justificativa) */}
      {ref_.motivo && (
        <BlocoPorque motivo={ref_.motivo} C={C} CALIBRI={CALIBRI} />
      )}

      {/* Aviso validade */}
      <AvisoValidade C={C} CALIBRI={CALIBRI} />

      {/* Ações */}
      <Acoes ref={ref_.ref} feedback={feedback} onFeedback={onFeedback} C={C} CALIBRI={CALIBRI} />
    </div>
  );
}

// ─── Sub-componentes de blocos ────────────────────────────────────────

function Pill({ bg = '#eee', cor, children }) {
  return (
    <span style={{
      padding: '3px 8px', borderRadius: 12, background: bg,
      color: cor, fontSize: 10, fontWeight: 700, letterSpacing: 0.3,
      fontFamily: 'Calibri, sans-serif', textTransform: 'uppercase',
    }}>
      {children}
    </span>
  );
}

function Bloco({ label, rightExtra, editavel, editando, onToggleEdit, children, C, SERIF, CALIBRI }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 6,
      }}>
        <span style={{
          fontSize: 9.5, color: C.muted, letterSpacing: 1.2,
          textTransform: 'uppercase', fontFamily: CALIBRI, fontWeight: 700,
        }}>
          {label}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {rightExtra && (
            <span style={{ fontSize: 9, color: C.muted, fontFamily: CALIBRI }}>
              {rightExtra}
            </span>
          )}
          {editavel && (
            <button
              onClick={onToggleEdit}
              style={{
                background: 'transparent',
                border: `1px solid ${editando ? C.success : C.cream}`,
                color: editando ? C.success : C.muted,
                borderRadius: 4, padding: '2px 8px',
                fontSize: 10, fontFamily: CALIBRI, cursor: 'pointer',
                fontWeight: editando ? 700 : 400,
              }}
            >
              {editando ? '✓ pronto' : '✎ editar'}
            </button>
          )}
        </div>
      </div>
      <div style={{
        background: editando ? '#fffbf0' : '#f7f4f0',
        borderRadius: 6, padding: 10,
        border: editando ? `1px dashed ${C.warning}` : 'none',
      }}>
        {children}
      </div>
    </div>
  );
}

function BlocoGrade({ gradeModulos, setGradeModulos, editando, maxModulos, categoria, C, CALIBRI }) {
  const totalModulos = somarModulos(gradeModulos);
  const ultrapassou = totalModulos > maxModulos;

  // MODO DISPLAY (não editando)
  if (!editando) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {gradeModulos.length === 0 ? (
            <span style={{ color: C.muted, fontSize: 11, fontFamily: CALIBRI }}>
              Sem grade definida
            </span>
          ) : (
            gradeModulos.map((g, i) => (
              <div key={i} style={{
                background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 6,
                padding: '6px 10px', fontFamily: CALIBRI, fontSize: 13,
                color: C.iaDarker, fontWeight: 700,
              }}>
                {g.modulos}{g.tam}
              </div>
            ))
          )}
          <span style={{ fontFamily: CALIBRI, fontSize: 10, color: C.muted, marginLeft: 'auto' }}>
            enfesto: {totalModulos} peças · {categoria === 'pequena_media' ? 'peça pequena' : 'peça grande'} (padrão {maxModulos})
          </span>
        </div>
        {ultrapassou && (
          <div style={{ fontSize: 10, color: C.warning, fontFamily: CALIBRI, marginTop: 6 }}>
            ⚠ enfesto de {totalModulos} módulos — acima do padrão {maxModulos}
          </div>
        )}
      </div>
    );
  }

  // MODO EDITOR
  // Tamanhos disponiveis pra adicionar = padrao - ja na grade
  const tamsNaGrade = new Set(gradeModulos.map(g => g.tam));
  const tamsDisponiveis = TAMANHOS_DISPONIVEIS.filter(t => !tamsNaGrade.has(t));

  const adicionarTam = (tam) => {
    setGradeModulos([...gradeModulos, { tam, modulos: 1 }]);
  };

  const removerTam = (tam) => {
    setGradeModulos(gradeModulos.filter(g => g.tam !== tam));
  };

  const atualizarModulos = (tam, novoVal) => {
    const v = Math.max(0, parseInt(novoVal, 10) || 0);
    setGradeModulos(gradeModulos.map(g => g.tam === tam ? { ...g, modulos: v } : g));
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {gradeModulos.map((g, i) => (
          <div key={i} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: '#fff', border: `1px solid ${C.cream}`, borderRadius: 6,
            padding: '4px 6px', fontFamily: CALIBRI, fontSize: 12,
          }}>
            <input
              type="number"
              min="0"
              value={g.modulos}
              onChange={(e) => atualizarModulos(g.tam, e.target.value)}
              style={{
                width: 32, padding: '2px 4px', border: `1px solid ${C.cream}`,
                borderRadius: 3, fontSize: 12, fontFamily: CALIBRI,
                textAlign: 'center', fontWeight: 700, color: C.iaDarker,
              }}
            />
            <span style={{ color: C.iaDarker, fontWeight: 700 }}>{g.tam}</span>
            <button
              onClick={() => removerTam(g.tam)}
              style={{
                background: 'transparent', border: 'none', color: C.critical,
                cursor: 'pointer', fontSize: 14, padding: '0 2px', lineHeight: 1,
              }}
              title={`Remover ${g.tam}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {tamsDisponiveis.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: C.muted, fontFamily: CALIBRI }}>+ adicionar:</span>
          {tamsDisponiveis.map(t => (
            <button
              key={t}
              onClick={() => adicionarTam(t)}
              style={{
                background: '#fff', border: `1px dashed ${C.muted}`, borderRadius: 4,
                padding: '2px 8px', fontFamily: CALIBRI, fontSize: 11,
                color: C.muted, cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 10, fontFamily: CALIBRI, color: ultrapassou ? C.warning : C.muted }}>
        {ultrapassou ? '⚠ ' : ''}enfesto: {totalModulos} peças (padrão {maxModulos})
      </div>
    </div>
  );
}

function BlocoCores({ cores, setCores, editando, C, CALIBRI }) {
  const [novaCorNome, setNovaCorNome] = useState('');
  const [novaCorRolos, setNovaCorRolos] = useState(1);

  // MODO DISPLAY
  if (!editando) {
    if (cores.length === 0) {
      return <div style={{ color: C.muted, fontSize: 11, fontFamily: CALIBRI }}>Sem cores definidas</div>;
    }
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 6 }}>
        {cores.map((c, i) => {
          const tendCfg = {
            alta:   { sigla: '↑', cor: C.success, label: 'em alta' },
            baixa:  { sigla: '↓', cor: C.critical, label: 'em queda' },
            nova:   { sigla: '★', cor: C.iaDark, label: 'aposta nova' },
            normal: { sigla: '·', cor: C.muted, label: 'estável' },
          }[c.tendencia_label] || { sigla: '·', cor: C.muted, label: '' };

          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: '#fff', borderRadius: 6, padding: '6px 10px',
              fontFamily: CALIBRI, fontSize: 12,
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 3, background: corHex(c.cor),
                  border: '1px solid rgba(0,0,0,0.1)', display: 'inline-block',
                }} />
                <span style={{ color: C.iaDarker, fontWeight: 600 }}>{c.cor}</span>
                {c.tendencia_label && c.tendencia_label !== 'normal' && (
                  <span style={{
                    fontSize: 9, color: tendCfg.cor, fontWeight: 700,
                    background: tendCfg.cor + '22', padding: '1px 4px', borderRadius: 3,
                  }}>
                    {tendCfg.sigla} {c.tendencia_pct != null ? fmtPct(c.tendencia_pct) : tendCfg.label}
                  </span>
                )}
              </span>
              <span style={{ color: C.muted, fontSize: 11 }}>
                <strong style={{ color: C.iaDarker, fontSize: 13 }}>{c.rolos}</strong> rolo{c.rolos !== 1 ? 's' : ''}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // MODO EDITOR
  const atualizarRolos = (idx, novoVal) => {
    const v = Math.max(0, parseInt(novoVal, 10) || 0);
    setCores(cores.map((c, i) => i === idx ? { ...c, rolos: v } : c));
  };

  const removerCor = (idx) => {
    setCores(cores.filter((_, i) => i !== idx));
  };

  const adicionarCor = () => {
    const nome = novaCorNome.trim();
    const rolos = Math.max(1, parseInt(novaCorRolos, 10) || 1);
    if (!nome) return;
    // Evita duplicata
    if (cores.some(c => (c.cor || '').toLowerCase() === nome.toLowerCase())) {
      alert(`Cor "${nome}" já existe na lista`);
      return;
    }
    setCores([...cores, { cor: nome, rolos, tendencia_label: 'nova', tendencia_pct: null }]);
    setNovaCorNome('');
    setNovaCorRolos(1);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, marginBottom: 10 }}>
        {cores.map((c, idx) => (
          <div key={idx} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#fff', borderRadius: 6, padding: '6px 8px',
            fontFamily: CALIBRI, fontSize: 12,
          }}>
            <span style={{
              width: 14, height: 14, borderRadius: 3, background: corHex(c.cor),
              border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0,
            }} />
            <span style={{ color: C.iaDarker, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.cor}
            </span>
            <input
              type="number" min="0" value={c.rolos}
              onChange={(e) => atualizarRolos(idx, e.target.value)}
              style={{
                width: 44, padding: '2px 4px', border: `1px solid ${C.cream}`,
                borderRadius: 3, fontSize: 12, fontFamily: CALIBRI,
                textAlign: 'center', fontWeight: 700, color: C.iaDarker,
              }}
            />
            <span style={{ fontSize: 10, color: C.muted }}>rolo{c.rolos !== 1 ? 's' : ''}</span>
            <button
              onClick={() => removerCor(idx)}
              style={{
                background: 'transparent', border: 'none', color: C.critical,
                cursor: 'pointer', fontSize: 16, padding: '0 2px', lineHeight: 1,
              }}
              title={`Remover ${c.cor}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div style={{
        display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
        padding: 8, background: '#fff', borderRadius: 6,
        border: `1px dashed ${C.muted}`,
      }}>
        <input
          type="text"
          placeholder="Nome da nova cor (ex: Marrom)"
          value={novaCorNome}
          onChange={(e) => setNovaCorNome(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') adicionarCor(); }}
          style={{
            flex: 1, minWidth: 140, padding: '4px 8px', border: `1px solid ${C.cream}`,
            borderRadius: 4, fontSize: 12, fontFamily: CALIBRI, color: C.iaDarker,
          }}
        />
        <input
          type="number" min="1" value={novaCorRolos}
          onChange={(e) => setNovaCorRolos(e.target.value)}
          style={{
            width: 50, padding: '4px 6px', border: `1px solid ${C.cream}`,
            borderRadius: 4, fontSize: 12, fontFamily: CALIBRI, textAlign: 'center',
          }}
        />
        <span style={{ fontSize: 10, color: C.muted, fontFamily: CALIBRI }}>rolos</span>
        <button
          onClick={adicionarCor}
          disabled={!novaCorNome.trim()}
          style={{
            background: novaCorNome.trim() ? C.success : '#ddd',
            color: '#fff', border: 'none', borderRadius: 4,
            padding: '4px 12px', fontSize: 11, fontFamily: CALIBRI,
            cursor: novaCorNome.trim() ? 'pointer' : 'default',
            fontWeight: 700,
          }}
        >
          + adicionar
        </button>
      </div>
    </div>
  );
}

function BlocoMatriz({ matriz, C, CALIBRI }) {
  if (matriz.length === 0) {
    return <div style={{ color: C.muted, fontSize: 11, fontFamily: CALIBRI }}>Sem matriz disponível</div>;
  }

  // Pivot: linhas = cores, colunas = tamanhos
  const cores = [...new Set(matriz.map(m => m.cor))];
  const tams  = [...new Set(matriz.map(m => m.tam))];
  const idx = {};
  matriz.forEach(m => { idx[`${m.cor}|${m.tam}`] = m.pecas; });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse', fontFamily: CALIBRI, fontSize: 11,
      }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 6px', color: C.muted, fontWeight: 600 }}>Cor</th>
            {tams.map(t => (
              <th key={t} style={{ textAlign: 'right', padding: '4px 6px', color: C.muted, fontWeight: 600 }}>
                {t}
              </th>
            ))}
            <th style={{ textAlign: 'right', padding: '4px 6px', color: C.iaDarker, fontWeight: 700 }}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {cores.map(cor => {
            const total = tams.reduce((s, t) => s + (idx[`${cor}|${t}`] || 0), 0);
            return (
              <tr key={cor} style={{ borderTop: `1px solid ${C.cream}` }}>
                <td style={{ padding: '4px 6px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: 2, background: corHex(cor),
                    display: 'inline-block', border: '1px solid rgba(0,0,0,0.1)',
                  }} />
                  <span style={{ color: C.iaDarker }}>{cor}</span>
                </td>
                {tams.map(t => (
                  <td key={t} style={{ textAlign: 'right', padding: '4px 6px', color: C.iaDarker }}>
                    {idx[`${cor}|${t}`] || 0}
                  </td>
                ))}
                <td style={{ textAlign: 'right', padding: '4px 6px', color: C.iaDarker, fontWeight: 700 }}>
                  {fmtInt(total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BlocoTotalDestaque({ rolos, pecas, cores, tamanhos, C, SERIF, CALIBRI }) {
  return (
    <div style={{
      background: `linear-gradient(135deg, ${C.iaDarker}, ${C.iaDark})`,
      color: '#fff', borderRadius: 8, padding: '12px 16px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      fontFamily: CALIBRI, marginBottom: 12,
    }}>
      <div>
        <div style={{ fontSize: 9, letterSpacing: 1, opacity: 0.8, textTransform: 'uppercase' }}>
          Total
        </div>
        <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>
          {cores} cor{cores !== 1 ? 'es' : ''} · {tamanhos} tamanho{tamanhos !== 1 ? 's' : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
          {fmtInt(rolos)} rolos
        </div>
        <div style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>
          ≈ {fmtInt(pecas)} peças estimadas
        </div>
      </div>
    </div>
  );
}

function BlocoPorque({ motivo, C, CALIBRI }) {
  // Traduz motivo técnico em texto legível
  const motivoTexto = {
    demanda_ativa_e_critico: 'Demanda ativa com cobertura crítica',
    ruptura_disfarcada:      'Ruptura disfarçada (vendia e parou)',
    excesso_estoque:         'Estoque em excesso prolongado',
  }[motivo] || motivo;

  return (
    <div style={{
      background: '#f0f4fa', borderLeft: `3px solid ${C.blue}`,
      padding: '10px 12px', borderRadius: 6, marginBottom: 10,
      fontSize: 11.5, lineHeight: 1.4, color: C.text, fontFamily: CALIBRI,
    }}>
      <strong style={{ color: C.iaDarker }}>Por quê:</strong> {motivoTexto}
    </div>
  );
}

function AvisoValidade({ C, CALIBRI }) {
  return (
    <div style={{
      background: '#faf6ec', borderLeft: `3px solid ${C.warning}`,
      padding: '8px 12px', borderRadius: 6, marginBottom: 12,
      fontSize: 10.5, color: C.text, fontFamily: CALIBRI,
    }}>
      ⏳ <strong style={{ color: C.warning }}>Sugestão válida por 7 dias.</strong>{' '}
      Se você não decidir nesse prazo, a OS Amícia pode re-sugerir com dados atualizados.
    </div>
  );
}

function Acoes({ ref, feedback, onFeedback, C, CALIBRI }) {
  const Btn = ({ onClick, bg, cor, border, children, flex }) => (
    <button
      onClick={onClick}
      disabled={!!feedback}
      style={{
        background: bg, color: cor, border: border || 'none',
        padding: '10px 14px', borderRadius: 6, fontFamily: CALIBRI,
        fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
        cursor: feedback ? 'default' : 'pointer',
        opacity: feedback ? 0.5 : 1,
        flex: flex || 'initial',
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Btn onClick={() => onFeedback(ref, 'sim')}
           bg={C.success} cor='#fff' flex={1}>✓ Sim, vou cortar</Btn>
      <Btn onClick={() => onFeedback(ref, 'editar')}
           bg={C.warning} cor='#fff'>✎ Editar</Btn>
      <Btn onClick={() => onFeedback(ref, 'nao')}
           bg='#eee' cor={C.text} border={`1px solid ${C.cream}`}>✗ Não</Btn>
      <Btn onClick={() => alert('Modal Explicar virá na Fase 5')}
           bg='transparent' cor={C.blue} border={`1px dashed ${C.blue}`}>💬 Explicar</Btn>
    </div>
  );
}
