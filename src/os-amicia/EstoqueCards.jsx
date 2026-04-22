/**
 * EstoqueCards.jsx — Cards 1-4 do TabEstoque (Sprint 6.1).
 *
 * Cada card consome /api/ia-estoque-dados?card=<nome> (admin-only) e
 * renderiza uma visualização dos dados das 4 views do Sprint 6.1.
 *
 * Padrão visual idêntico ao MarketplacesCards.jsx (Sprint 5):
 *   - useCardData hook com fetch + loading + erro + refresh
 *   - CardShell wrapper com gradiente, eyebrow, título, botão refresh
 *   - Helpers fmtInt, fmtPct, etc
 *
 * ORDEM DOS CARDS (decisão Ailson, opção 1 do briefing):
 *   1. Saúde geral         (visão contextual)
 *   2. Ruptura crítica     (ação mais urgente)
 *   3. Ruptura disfarçada  (próxima ação)
 *   4. Tendência 12m       (histórico, por último porque só temos 1 mês)
 *
 * CARD 2 (Ruptura crítica) · decisão Ailson: agrupar por ref com expand.
 * Visual default: 1 linha por ref com resumo ("N variações zeradas").
 * Toque no ▸ abre detalhe por cor+tam.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';

// ─── Helpers de formato (escopo do arquivo) ───────────────────────────

const fmtInt = (v) =>
  (Number(v) || 0).toLocaleString('pt-BR');

const fmtPct = (v) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
};

const fmtDataBR = (isoStr) => {
  if (!isoStr) return '—';
  try {
    const [y, m, d] = String(isoStr).slice(0, 10).split('-');
    return `${d}/${m}`;
  } catch { return '—'; }
};

// Data/hora BRT pra comparar últimas vendas
const diasAtras = (isoStr) => {
  if (!isoStr) return null;
  const ms = Date.now() - new Date(isoStr).getTime();
  const d = Math.floor(ms / (1000 * 60 * 60 * 24));
  return d;
};

// Cor de faixa de cobertura (semântica compartilhada com EstoqueView do app)
const corFaixa = (status, C) => {
  switch (status) {
    case 'critica':
    case 'zerada':    return C.critical;
    case 'atencao':   return C.warning;
    case 'saudavel':  return C.success;
    case 'excesso':   return C.blue;
    default:          return C.muted;
  }
};

// ─── Hook de fetch · admin-only (manda X-User header) ─────────────────

function useCardData(cardName, usuario) {
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
      const r = await fetch(`/api/ia-estoque-dados?card=${cardName}`, {
        headers: { 'X-User': usuario },
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDados(d);
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [cardName, usuario]);

  useEffect(() => { carregar(); }, [carregar]);

  return { dados, loading, erro, carregar };
}

// ─── Wrapper visual comum (cópia fiel do MarketplacesCards) ───────────

function CardShell({ eyebrow, titulo, children, loading, erro, onRefresh, C, SERIF }) {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #fff 0%, #f7f4f0 100%)',
        border: `1px solid ${C.cream}`,
        borderRadius: 12,
        padding: 18,
        marginBottom: 14,
        fontFamily: SERIF,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            {eyebrow}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.iaDarker, marginTop: 2 }}>
            {titulo}
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            background: 'transparent',
            border: `1px solid ${C.cream}`,
            color: C.muted,
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 11,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontFamily: SERIF,
            flexShrink: 0,
          }}
        >
          {loading ? '…' : '🔄'}
        </button>
      </div>

      {erro ? (
        <div style={{ fontSize: 12, color: C.critical, padding: 10 }}>❌ {erro}</div>
      ) : (
        children
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Card 1 · Saúde geral (4 mini-cards + percentuais)
// ═══════════════════════════════════════════════════════════════════════

export function Card1EstoqueSaude({ usuario, C, SERIF, CALIBRI }) {
  const { dados, loading, erro, carregar } = useCardData('saude_geral', usuario);
  const s = dados?.saude;

  return (
    <CardShell
      eyebrow="Card 1 · Saúde do estoque"
      titulo="Visão geral das variações ativas"
      loading={loading} erro={erro} onRefresh={carregar}
      C={C} SERIF={SERIF}
    >
      {!s ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>
          {loading ? 'Carregando…' : 'Sem dados de saúde geral.'}
        </div>
      ) : (
        <>
          {/* Linha 1: total + refs com atividade */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12, fontFamily: CALIBRI }}>
            <div>
              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                Estoque total
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.iaDarker, marginTop: 2 }}>
                {fmtInt(s.unidades_total)} un
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                Refs com atividade
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.iaDarker, marginTop: 2 }}>
                {fmtInt(s.refs_com_atividade)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                Variações ativas
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: C.iaDarker, marginTop: 2 }}>
                {fmtInt(s.variacoes_total)}
              </div>
            </div>
          </div>

          {/* Linha 2: 4 mini-cards de distribuição */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, fontFamily: CALIBRI }}>
            <MiniCardSaude
              label="Saudáveis"
              valor={s.variacoes_saudaveis}
              pct={s.pct_saudaveis}
              cor={C.success}
              C={C}
            />
            <MiniCardSaude
              label="Atenção"
              valor={s.variacoes_atencao}
              pct={s.pct_atencao}
              cor={C.warning}
              C={C}
            />
            <MiniCardSaude
              label="Ruptura crítica"
              valor={s.variacoes_ruptura_critica}
              pct={s.pct_ruptura_critica}
              cor={C.critical}
              C={C}
              destaque
            />
            <MiniCardSaude
              label="Excesso"
              valor={s.variacoes_excesso}
              pct={s.pct_excesso}
              cor={C.blue}
              C={C}
            />
          </div>

          {/* Rodapé: ruptura disfarçada como contexto */}
          {s.variacoes_ruptura_disfarcada > 0 && (
            <div style={{ marginTop: 10, fontSize: 11, color: C.muted, fontFamily: CALIBRI, fontStyle: 'italic' }}>
              + {s.variacoes_ruptura_disfarcada} variações em ruptura disfarçada (detalhe no Card 3)
            </div>
          )}
        </>
      )}
    </CardShell>
  );
}

function MiniCardSaude({ label, valor, pct, cor, C, destaque }) {
  return (
    <div
      style={{
        background: destaque ? `${cor}14` : '#fff',
        border: `1px solid ${destaque ? cor : C.cream}`,
        borderRadius: 8,
        padding: '8px 10px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: cor, marginTop: 2 }}>
        {fmtInt(valor)}
      </div>
      <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
        {pct != null ? `${Number(pct).toFixed(1)}%` : '—'}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Card 2 · Ruptura crítica · AGRUPADA POR REF com expand
// ═══════════════════════════════════════════════════════════════════════

export function Card2EstoqueRupturaCritica({ usuario, C, SERIF, CALIBRI }) {
  const { dados, loading, erro, carregar } = useCardData('ruptura_critica', usuario);
  const variacoes = dados?.variacoes || [];
  const [expandido, setExpandido] = useState({}); // { "2601": true, ... }

  // Agrupa variações por ref e soma estatísticas.
  // Preserva a ordem de chegada (o endpoint já ordenou por cobertura ASC).
  const refsAgrupadas = useMemo(() => {
    const mapa = new Map();
    for (const v of variacoes) {
      const k = v.ref;
      if (!mapa.has(k)) {
        mapa.set(k, {
          ref: k,
          descricao: v.descricao || '',
          variacoes: [],
          vendas_30d_total: 0,
          vendas_15d_total: 0,
        });
      }
      const agg = mapa.get(k);
      agg.variacoes.push(v);
      agg.vendas_30d_total += Number(v.vendas_30d || 0);
      agg.vendas_15d_total += Number(v.vendas_15d || 0);
      // Pega a descrição não-vazia se ainda não tiver uma
      if (!agg.descricao && v.descricao) agg.descricao = v.descricao;
    }
    return Array.from(mapa.values());
  }, [variacoes]);

  const toggle = (ref) => setExpandido(prev => ({ ...prev, [ref]: !prev[ref] }));

  return (
    <CardShell
      eyebrow={`Card 2 · ${variacoes.length} variações zeradas`}
      titulo="Ruptura crítica com demanda ativa"
      loading={loading} erro={erro} onRefresh={carregar}
      C={C} SERIF={SERIF}
    >
      {refsAgrupadas.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>
          {loading ? 'Carregando…' : 'Nenhuma ref ativa em ruptura crítica no momento.'}
        </div>
      ) : (
        <div style={{ fontFamily: CALIBRI }}>
          {/* Header compacto */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto auto auto',
              gap: 10,
              fontSize: 10,
              color: C.muted,
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              padding: '6px 4px',
              borderBottom: `1px solid ${C.cream}`,
            }}
          >
            <div>Ref · Descrição</div>
            <div style={{ textAlign: 'right' }}>Variações</div>
            <div style={{ textAlign: 'right' }}>Vendas 30d</div>
            <div style={{ textAlign: 'right', width: 24 }}>&nbsp;</div>
          </div>

          {/* Lista agrupada */}
          {refsAgrupadas.map(agg => {
            const aberto = !!expandido[agg.ref];
            const desc = agg.descricao ? agg.descricao.trim().slice(0, 40) : '—';
            return (
              <div key={agg.ref} style={{ borderBottom: `1px solid ${C.cream}` }}>
                <div
                  onClick={() => toggle(agg.ref)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto auto',
                    gap: 10,
                    padding: '10px 4px',
                    fontSize: 13,
                    cursor: 'pointer',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: C.iaDarker }}>REF {agg.ref}</div>
                    <div
                      style={{
                        fontSize: 11,
                        color: C.muted,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        marginTop: 1,
                      }}
                      title={agg.descricao}
                    >
                      {desc}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', color: C.critical, fontWeight: 700 }}>
                    {agg.variacoes.length}
                  </div>
                  <div style={{ textAlign: 'right', color: C.iaDarker, fontWeight: 700 }}>
                    {fmtInt(agg.vendas_30d_total)}
                  </div>
                  <div
                    style={{
                      textAlign: 'right',
                      width: 24,
                      color: C.muted,
                      fontSize: 14,
                      transform: aberto ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.15s',
                    }}
                  >
                    ▸
                  </div>
                </div>

                {/* Detalhe expandido: lista de variações */}
                {aberto && (
                  <div style={{ padding: '4px 4px 10px 10px', background: '#faf8f5' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ color: C.muted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                          <th style={{ textAlign: 'left', padding: '4px 4px', fontWeight: 600 }}>Cor · Tam</th>
                          <th style={{ textAlign: 'right', padding: '4px 4px', fontWeight: 600 }}>30d</th>
                          <th style={{ textAlign: 'right', padding: '4px 4px', fontWeight: 600 }}>15d</th>
                          <th style={{ textAlign: 'right', padding: '4px 4px', fontWeight: 600 }}>Vel/dia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {agg.variacoes.map((v, i) => (
                          <tr key={i} style={{ borderTop: `1px solid ${C.cream}` }}>
                            <td style={{ padding: '5px 4px', color: C.iaDarker }}>
                              {v.cor} · <span style={{ fontWeight: 700 }}>{v.tam}</span>
                              {v.confianca === 'media' && (
                                <span style={{ fontSize: 9, color: C.warning, marginLeft: 5 }}>(conf média)</span>
                              )}
                            </td>
                            <td style={{ padding: '5px 4px', textAlign: 'right', color: C.iaDarker, fontWeight: 600 }}>
                              {fmtInt(v.vendas_30d)}
                            </td>
                            <td style={{ padding: '5px 4px', textAlign: 'right', color: C.iaDarker }}>
                              {fmtInt(v.vendas_15d)}
                            </td>
                            <td style={{ padding: '5px 4px', textAlign: 'right', color: C.muted }}>
                              {Number(v.velocidade_dia || 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CardShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Card 3 · Ruptura disfarçada · lista plana (volume menor, cabe)
// ═══════════════════════════════════════════════════════════════════════

export function Card3EstoqueRupturaDisfarcada({ usuario, C, SERIF, CALIBRI }) {
  const { dados, loading, erro, carregar } = useCardData('ruptura_disfarcada', usuario);
  const variacoes = dados?.variacoes || [];

  return (
    <CardShell
      eyebrow={`Card 3 · ${variacoes.length} variações`}
      titulo="Ruptura disfarçada · pararam de vender"
      loading={loading} erro={erro} onRefresh={carregar}
      C={C} SERIF={SERIF}
    >
      {variacoes.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>
          {loading ? 'Carregando…' : 'Nenhuma variação em ruptura disfarçada.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', fontFamily: CALIBRI }}>
          <table
            style={{
              width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 480,
            }}
          >
            <thead>
              <tr style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 600 }}>Ref · Variação</th>
                <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600 }}>Mês ant.</th>
                <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600 }}>Últ 15d</th>
                <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600 }}>Estoque</th>
                <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600 }}>Últ venda</th>
              </tr>
            </thead>
            <tbody>
              {variacoes.map((v, idx) => {
                const temEstoque = Number(v.estoque_atual || 0) > 0;
                return (
                  <tr key={idx} style={{ borderTop: `1px solid ${C.cream}` }}>
                    <td style={{ padding: '7px 4px', color: C.iaDarker }}>
                      <div style={{ fontWeight: 700 }}>
                        REF {v.ref} {temEstoque && (
                          <span
                            title="Tem estoque mas não vende — investigar anúncio"
                            style={{ fontSize: 9, color: C.warning, marginLeft: 4, fontWeight: 600 }}
                          >
                            ⚠ com estoque
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
                        {v.descricao ? `${v.descricao.trim().slice(0, 28)} · ` : ''}
                        {v.cor} · <span style={{ fontWeight: 600 }}>{v.tam}</span>
                      </div>
                    </td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', color: C.iaDarker, fontWeight: 700 }}>
                      {fmtInt(v.vendas_mes_ant)}
                    </td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', color: C.critical, fontWeight: 700 }}>
                      {fmtInt(v.vendas_15d)}
                    </td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', color: temEstoque ? C.warning : C.muted }}>
                      {fmtInt(v.estoque_atual)}
                    </td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', color: C.muted, fontSize: 11 }}>
                      {v.ultima_venda ? `${fmtDataBR(v.ultima_venda)} (${diasAtras(v.ultima_venda)}d)` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </CardShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Card 4 · Tendência 12 meses · tabela simples (histórico ainda curto)
// ═══════════════════════════════════════════════════════════════════════

export function Card4EstoqueTendencia({ usuario, C, SERIF, CALIBRI }) {
  const { dados, loading, erro, carregar } = useCardData('tendencia_12m', usuario);
  const serie = dados?.serie || [];

  return (
    <CardShell
      eyebrow={`Card 4 · ${serie.length} ${serie.length === 1 ? 'mês' : 'meses'} de histórico`}
      titulo="Tendência do estoque total"
      loading={loading} erro={erro} onRefresh={carregar}
      C={C} SERIF={SERIF}
    >
      {serie.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>
          {loading ? 'Carregando…' : 'Sem histórico de estoque total.'}
        </div>
      ) : (
        <>
          {serie.length < 3 && (
            <div
              style={{
                fontSize: 11, color: C.muted, fontFamily: CALIBRI,
                fontStyle: 'italic', marginBottom: 10, padding: '6px 10px',
                background: '#faf8f5', borderRadius: 6, border: `1px solid ${C.cream}`,
              }}
            >
              Histórico mensal começou recentemente. Tendência completa disponível após 3+ meses.
            </div>
          )}
          <div style={{ overflowX: 'auto', fontFamily: CALIBRI }}>
            <table
              style={{
                width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 340,
              }}
            >
              <thead>
                <tr style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                  <th style={{ textAlign: 'left', padding: '6px 4px', fontWeight: 600 }}>Mês</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600 }}>Estoque</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600 }}>Refs</th>
                  <th style={{ textAlign: 'right', padding: '6px 4px', fontWeight: 600 }}>Δ mês ant.</th>
                </tr>
              </thead>
              <tbody>
                {serie.map((m, idx) => (
                  <tr key={m.ano_mes || idx} style={{ borderTop: `1px solid ${C.cream}` }}>
                    <td style={{ padding: '7px 4px', color: C.iaDarker, fontWeight: 600 }}>
                      {m.ano_mes}
                    </td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', color: C.iaDarker, fontWeight: 700 }}>
                      {fmtInt(m.qtd_total)} un
                    </td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', color: C.muted }}>
                      {fmtInt(m.qtd_refs)}
                    </td>
                    <td
                      style={{
                        padding: '7px 4px',
                        textAlign: 'right',
                        color: m.var_pct_vs_mes_ant == null ? C.muted
                          : Number(m.var_pct_vs_mes_ant) >= 0 ? C.success : C.critical,
                        fontWeight: 600,
                      }}
                    >
                      {fmtPct(m.var_pct_vs_mes_ant)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </CardShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Componente agregador TabEstoque — ordem fixa (opção 1 do briefing)
// ═══════════════════════════════════════════════════════════════════════

export function TabEstoque({ usuario, C, SERIF, CALIBRI }) {
  return (
    <div>
      <Card1EstoqueSaude              usuario={usuario} C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
      <Card2EstoqueRupturaCritica     usuario={usuario} C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
      <Card3EstoqueRupturaDisfarcada  usuario={usuario} C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
      <Card4EstoqueTendencia          usuario={usuario} C={C} SERIF={SERIF} CALIBRI={CALIBRI} />
    </div>
  );
}
