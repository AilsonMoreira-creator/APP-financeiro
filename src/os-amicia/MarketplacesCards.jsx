/**
 * MarketplacesCards.jsx — Cards 2-7 do TabMarketplaces (Sprint 5).
 *
 * Cada card consome /api/ia-marketplaces-dados?card=<nome> e renderiza
 * uma visualização sobre os dados das 12 views criadas no Sprint 4.
 *
 * Design:
 *   - Um único hook `useCardData` padroniza fetch + loading + erro + refresh.
 *   - `CardShell` centraliza wrapper visual (gradiente, header, botão refresh).
 *   - Constantes de canal (label, cor, texto) são compartilhadas com o Card1.
 *   - Helpers de formatação (fmtInt, fmtReal, fmtPct, corVar) em escopo único.
 *   - SVG nativo no Card 2 (histórico 24m) pra evitar recharts (~200kb).
 *   - Mobile-first: tabelas grandes usam overflowX, grids usam auto-fit.
 *
 * Ordem no arquivo (mesma dos cards visuais, pra facilitar leitura):
 *   - helpers + CardShell + useCardData
 *   - Card2Vendas24m      (serie unidades por mes, 5 canais)
 *   - Card3CanaisComp     (tabela 7v7 e 30v30 por canal)
 *   - Card4ContasBling    (3 contas + drill-down top refs em queda)
 *   - Card5TopMovers      (3 abas: Geral / Por conta / Cruzamento)
 *   - Card6Margens        (heatmap ref x canal + plano de ajuste)
 *   - Card7Oportunidades  (lista com destaque pros alto-potencial)
 */
import { useEffect, useState, useCallback, useMemo } from 'react';

// ─── Constantes compartilhadas ─────────────────────────────────────────

export const CANAL_LABEL = {
  mercadolivre: 'Mercado Livre',
  shopee:       'Shopee',
  shein:        'Shein',
  tiktok:       'TikTok Shop',
  meluni:       'Meluni',
  outros:       'Outros',
};

export const CANAL_COR = {
  mercadolivre: '#FFE600',
  shopee:       '#EE4D2D',
  shein:        '#000000',
  tiktok:       '#010101',
  meluni:       '#8B7355',
  outros:       '#8a9aa4',
};

export const CANAL_TEXT_COR = {
  mercadolivre: '#2D3277',
  shopee:       '#ffffff',
  shein:        '#ffffff',
  tiktok:       '#ffffff',
  meluni:       '#ffffff',
  outros:       '#ffffff',
};

// ─── Formatadores ──────────────────────────────────────────────────────

const fmtInt = (v) =>
  (Number(v) || 0).toLocaleString('pt-BR');

const fmtReal = (v) =>
  'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

const fmtPct = (v) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
};

const corVar = (v, C) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return C.muted;
  return Number(v) >= 0 ? C.success : C.critical;
};

// ─── Hook padrão de fetch ──────────────────────────────────────────────

function useCardData(cardName) {
  const [dados, setDados]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const r = await fetch(`/api/ia-marketplaces-dados?card=${cardName}`);
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDados(d);
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [cardName]);

  useEffect(() => { carregar(); }, [carregar]);

  return { dados, loading, erro, carregar };
}

// ─── Wrapper visual comum ──────────────────────────────────────────────

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
// Card 2 · Histórico 24 meses · SVG nativo (evita recharts)
// ═══════════════════════════════════════════════════════════════════════

export function Card2Vendas24m({ C, SERIF, CALIBRI }) {
  const { dados, loading, erro, carregar } = useCardData('vendas_mensais_24m');
  // Canal em foco (null = mostra todos). Clique na legenda foca/desfoca.
  const [foco, setFoco] = useState(null);

  const serie = dados?.serie || [];

  // Canais a desenhar (label, key na view, cor)
  const CANAIS = [
    { id: 'mercadolivre', key: 'u_ml',     cor: CANAL_COR.mercadolivre },
    { id: 'shopee',       key: 'u_shopee', cor: CANAL_COR.shopee },
    { id: 'shein',        key: 'u_shein',  cor: CANAL_COR.shein },
    { id: 'tiktok',       key: 'u_tiktok', cor: CANAL_COR.tiktok },
    { id: 'meluni',       key: 'u_meluni', cor: CANAL_COR.meluni },
  ];

  // Dimensões do SVG (responsivo por viewBox)
  const W = 600, H = 220, PAD_L = 40, PAD_R = 12, PAD_T = 10, PAD_B = 32;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const maxY = useMemo(() => {
    if (!serie.length) return 1;
    let m = 0;
    for (const row of serie) {
      for (const c of CANAIS) {
        const v = Number(row[c.key]) || 0;
        if (v > m) m = v;
      }
    }
    return m || 1;
  }, [serie]);

  const xAt = (i) => serie.length <= 1
    ? PAD_L + plotW / 2
    : PAD_L + (i / (serie.length - 1)) * plotW;
  const yAt = (v) => PAD_T + plotH - (Number(v) / maxY) * plotH;

  // Label do mês no eixo X: a cada 3 meses
  const mesAbrev = (mes) => {
    const m = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    return m[(Number(mes) - 1) % 12] || '—';
  };

  return (
    <CardShell
      eyebrow="Card 2 · Últimos 24 meses"
      titulo="Histórico de vendas por canal"
      loading={loading} erro={erro} onRefresh={carregar}
      C={C} SERIF={SERIF}
    >
      {!dados ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>Carregando…</div>
      ) : serie.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>
          Sem dados de vendas nos últimos 24 meses.
        </div>
      ) : (
        <>
          {/* Legenda (toggle foco) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10, fontFamily: CALIBRI }}>
            {CANAIS.map(c => {
              const ativo = foco === null || foco === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setFoco(foco === c.id ? null : c.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    border: `1px solid ${ativo ? C.iaDark : C.cream}`,
                    background: ativo ? '#fff' : 'transparent',
                    borderRadius: 999,
                    padding: '3px 10px',
                    fontSize: 11,
                    color: ativo ? C.iaDarker : C.muted,
                    cursor: 'pointer',
                    opacity: ativo ? 1 : 0.5,
                    fontFamily: CALIBRI,
                  }}
                >
                  <span style={{
                    width: 10, height: 10, borderRadius: 2, background: c.cor,
                    border: c.id === 'shein' || c.id === 'tiktok' ? '1px solid #ccc' : 'none',
                  }} />
                  {CANAL_LABEL[c.id]}
                </button>
              );
            })}
            {foco && (
              <button
                onClick={() => setFoco(null)}
                style={{
                  fontSize: 10, border: 'none', background: 'transparent',
                  color: C.blue, cursor: 'pointer', fontFamily: CALIBRI,
                }}
              >
                limpar foco
              </button>
            )}
          </div>

          {/* SVG */}
          <div style={{ width: '100%', overflow: 'hidden' }}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
              {/* Grid Y (4 linhas) */}
              {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
                const y = PAD_T + plotH * (1 - t);
                const val = Math.round(maxY * t);
                return (
                  <g key={idx}>
                    <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={C.cream} strokeWidth={1} />
                    <text x={PAD_L - 4} y={y + 3} textAnchor="end" fontSize={9} fill={C.muted} fontFamily={CALIBRI}>
                      {fmtInt(val)}
                    </text>
                  </g>
                );
              })}

              {/* Eixo X (labels a cada 3 meses) */}
              {serie.map((row, i) => {
                if (i % 3 !== 0 && i !== serie.length - 1) return null;
                return (
                  <text
                    key={`xl-${i}`}
                    x={xAt(i)} y={H - 8}
                    textAnchor="middle" fontSize={9} fill={C.muted} fontFamily={CALIBRI}
                  >
                    {mesAbrev(row.mes)}/{String(row.ano).slice(2)}
                  </text>
                );
              })}

              {/* Linhas por canal */}
              {CANAIS.map(c => {
                const ativo = foco === null || foco === c.id;
                const d = serie
                  .map((row, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${yAt(row[c.key]).toFixed(2)}`)
                  .join(' ');
                return (
                  <path
                    key={c.id} d={d} fill="none"
                    stroke={c.cor}
                    strokeWidth={foco === c.id ? 2.5 : 1.6}
                    opacity={ativo ? 1 : 0.12}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>
          </div>

          {/* Totais resumidos (último mês) */}
          {serie.length > 0 && (
            <div style={{
              marginTop: 10, fontSize: 11, color: C.muted, fontFamily: CALIBRI,
              display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6,
            }}>
              <span>
                Último mês ({mesAbrev(serie[serie.length - 1].mes)}/{String(serie[serie.length - 1].ano).slice(2)}):{' '}
                <b style={{ color: C.iaDarker }}>
                  {fmtInt(serie[serie.length - 1].unidades_total)} un
                </b>
              </span>
              <span>
                {serie.length} meses de histórico
              </span>
            </div>
          )}
        </>
      )}
    </CardShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Card 3 · Canais Comparativo · tabela 7v7 e 30v30
// ═══════════════════════════════════════════════════════════════════════

export function Card3CanaisComp({ C, SERIF, CALIBRI }) {
  const { dados, loading, erro, carregar } = useCardData('canais_comparativo');
  const canais = dados?.canais || [];

  return (
    <CardShell
      eyebrow="Card 3 · Últimos 7 e 30 dias"
      titulo="Canais subindo e caindo"
      loading={loading} erro={erro} onRefresh={carregar}
      C={C} SERIF={SERIF}
    >
      {!dados ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>Carregando…</div>
      ) : canais.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>
          Sem vendas nos últimos 60 dias.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%', borderCollapse: 'collapse', fontFamily: CALIBRI,
              fontSize: 12, minWidth: 440,
            }}
          >
            <thead>
              <tr style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                <th style={thL}>Canal</th>
                <th style={thR}>Ult 7</th>
                <th style={thR}>Ant 7</th>
                <th style={thR}>Var 7v7</th>
                <th style={thR}>Ult 30</th>
                <th style={thR}>Ant 30</th>
                <th style={thR}>Var 30v30</th>
              </tr>
            </thead>
            <tbody>
              {canais.map((c, idx) => (
                <tr key={c.canal_norm || idx} style={{ borderTop: `1px solid ${C.cream}` }}>
                  <td style={{ ...tdL, fontWeight: 600, color: C.iaDarker }}>
                    <span style={{
                      display: 'inline-block', width: 10, height: 10, borderRadius: 2,
                      background: CANAL_COR[c.canal_norm] || C.muted,
                      marginRight: 7, verticalAlign: 'middle',
                      border: c.canal_norm === 'shein' || c.canal_norm === 'tiktok' ? '1px solid #ccc' : 'none',
                    }} />
                    {CANAL_LABEL[c.canal_norm] || c.canal_norm}
                  </td>
                  <td style={tdR}>{fmtInt(c.u_ult7)}</td>
                  <td style={{ ...tdR, color: C.muted }}>{fmtInt(c.u_ant7)}</td>
                  <td style={{ ...tdR, color: corVar(c.var_7v7_pct, C), fontWeight: 700 }}>
                    {fmtPct(c.var_7v7_pct)}
                  </td>
                  <td style={tdR}>{fmtInt(c.u_ult30)}</td>
                  <td style={{ ...tdR, color: C.muted }}>{fmtInt(c.u_ant30)}</td>
                  <td style={{ ...tdR, color: corVar(c.var_30v30_pct, C), fontWeight: 700 }}>
                    {fmtPct(c.var_30v30_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CardShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Card 4 · Contas Bling · 3 linhas + drill top refs em queda
// ═══════════════════════════════════════════════════════════════════════

export function Card4ContasBling({ C, SERIF, CALIBRI }) {
  const { dados, loading, erro, carregar } = useCardData('contas_bling');
  const [expand, setExpand] = useState(null);

  const resumo = dados?.resumo || [];
  const quedas = dados?.quedas || [];

  // Agrupar quedas por conta pra drill rápido
  const quedasPorConta = useMemo(() => {
    const m = {};
    for (const q of quedas) {
      if (!m[q.conta]) m[q.conta] = [];
      m[q.conta].push(q);
    }
    return m;
  }, [quedas]);

  const CONTA_LABEL = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

  return (
    <CardShell
      eyebrow="Card 4 · Comparativo 7v7"
      titulo="Contas Bling"
      loading={loading} erro={erro} onRefresh={carregar}
      C={C} SERIF={SERIF}
    >
      {!dados ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>Carregando…</div>
      ) : resumo.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>
          Sem pedidos nas contas Bling nos últimos 14 dias.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontFamily: CALIBRI }}>
          {resumo.map(r => {
            const refsQueda = (quedasPorConta[r.conta] || []).slice(0, 5);
            const aberto = expand === r.conta;
            return (
              <div key={r.conta} style={{ border: `1px solid ${C.cream}`, borderRadius: 8, overflow: 'hidden' }}>
                <button
                  onClick={() => setExpand(aberto ? null : r.conta)}
                  disabled={refsQueda.length === 0}
                  style={{
                    width: '100%', display: 'grid',
                    gridTemplateColumns: '1.2fr 0.8fr 1fr 0.8fr 0.3fr',
                    gap: 8, alignItems: 'center',
                    padding: '10px 12px', background: '#fff', border: 'none',
                    cursor: refsQueda.length === 0 ? 'default' : 'pointer',
                    textAlign: 'left', fontFamily: CALIBRI, fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, color: C.iaDarker, fontSize: 13 }}>
                    {CONTA_LABEL[r.conta] || r.conta}
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Pedidos
                    </div>
                    <div>{fmtInt(r.pedidos_ult7)} <span style={{ color: C.muted, fontSize: 10 }}>vs {fmtInt(r.pedidos_ant7)}</span></div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 1 }}>
                      Receita 7d
                    </div>
                    <div>{fmtReal(r.receita_ult7)}</div>
                  </div>
                  <div style={{ color: corVar(r.var_pedidos_7v7_pct, C), fontWeight: 700, fontSize: 13 }}>
                    {fmtPct(r.var_pedidos_7v7_pct)}
                  </div>
                  <div style={{ textAlign: 'right', color: C.muted, fontSize: 14 }}>
                    {refsQueda.length === 0 ? '' : aberto ? '▾' : '▸'}
                  </div>
                </button>

                {aberto && refsQueda.length > 0 && (
                  <div style={{ background: C.appBg, padding: '8px 12px', borderTop: `1px solid ${C.cream}` }}>
                    <div style={{ fontSize: 10, color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>
                      Top 5 refs em queda
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <tbody>
                        {refsQueda.map((q, i) => (
                          <tr key={q.ref_norm || i} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.cream}` }}>
                            <td style={{ padding: '4px 0', fontWeight: 600, color: C.iaDarker }}>{q.ref_norm}</td>
                            <td style={{ padding: '4px 0', textAlign: 'right', color: C.muted }}>
                              {fmtInt(q.u_ant7)} → {fmtInt(q.u_ult7)}
                            </td>
                            <td style={{ padding: '4px 0', textAlign: 'right', color: C.critical, fontWeight: 700 }}>
                              {q.delta > 0 ? '+' : ''}{fmtInt(q.delta)} un
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
// Card 5 · Top Movers · ranking global 15d vs 15d
// ═══════════════════════════════════════════════════════════════════════
// Ordem: maior delta positivo primeiro, negativos no final (posicoes 25-30
// tipicamente). Mostra 5 refs inicialmente, expand mostra ate 30.
// ═══════════════════════════════════════════════════════════════════════

export function Card5TopMovers({ C, SERIF, CALIBRI }) {
  const { dados, loading, erro, carregar } = useCardData('top_movers');
  const [expandido, setExpandido] = useState(false);

  // Usa view 15d (nova). Fallback pra versao 7d antiga se API ainda nao
  // foi atualizada (primeiras horas pos-deploy).
  const rows = dados?.unificado_15d?.length > 0
    ? dados.unificado_15d
    : (dados?.unificado || []).map(r => ({
        ...r,
        u_ult15: r.u_ult7,
        u_ant15: r.u_ant7,
      }));

  const LIMITE_COMPACTO = 5;
  const LIMITE_EXPANDIDO = 30;

  const totalDisponivel = rows.length;
  const rowsVisiveis = expandido
    ? rows.slice(0, LIMITE_EXPANDIDO)
    : rows.slice(0, LIMITE_COMPACTO);

  const podeExpandir = totalDisponivel > LIMITE_COMPACTO;

  return (
    <CardShell
      eyebrow="Card 5 · Movimento 15 dias"
      titulo="Top Movers"
      loading={loading} erro={erro} onRefresh={carregar}
      C={C} SERIF={SERIF}
    >
      {!dados ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>Carregando…</div>
      ) : rowsVisiveis.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>
          Sem dados de movimento nos últimos 15 dias.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <TableMovers15d rows={rowsVisiveis} C={C} CALIBRI={CALIBRI} />
          </div>

          {podeExpandir && (
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              <button
                onClick={() => setExpandido(v => !v)}
                style={{
                  background: 'transparent',
                  border: `1px solid ${C.cream}`,
                  color: C.muted,
                  borderRadius: 6,
                  padding: '6px 16px',
                  fontSize: 11,
                  fontFamily: CALIBRI,
                  cursor: 'pointer',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{
                  display: 'inline-block',
                  transform: expandido ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s',
                }}>▼</span>
                {expandido
                  ? 'mostrar apenas top 5'
                  : `ver top ${Math.min(LIMITE_EXPANDIDO, totalDisponivel)}`}
              </button>
            </div>
          )}
        </>
      )}
    </CardShell>
  );
}

function TableMovers15d({ rows, C, CALIBRI }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: CALIBRI, minWidth: 420 }}>
      <thead>
        <tr style={{ color: C.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
          <th style={thL}>Ref</th>
          <th style={thL}>Descrição</th>
          <th style={thR}>Últ 15</th>
          <th style={thR}>Ant 15</th>
          <th style={thR}>Δ</th>
          <th style={thR}>Var%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={`${r.ref_norm}-${i}`} style={{ borderTop: `1px solid ${C.cream}` }}>
            <td style={{ ...tdL, fontWeight: 700, color: C.iaDarker }}>{r.ref_norm}</td>
            <td style={{ ...tdL, color: C.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.descricao || '—'}
            </td>
            <td style={tdR}>{fmtInt(r.u_ult15)}</td>
            <td style={{ ...tdR, color: C.muted }}>{fmtInt(r.u_ant15)}</td>
            <td style={{ ...tdR, color: corVar(r.delta, C), fontWeight: 700 }}>
              {Number(r.delta) > 0 ? '+' : ''}{fmtInt(r.delta)}
            </td>
            <td style={{ ...tdR, color: corVar(r.var_pct, C), fontWeight: 700 }}>{fmtPct(r.var_pct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Card 6 · Margens · heatmap ref x canal + plano de ajuste ao clicar
// ═══════════════════════════════════════════════════════════════════════

const FAIXA_COR = {
  urgencia_maxima: '#7a1e12',
  critico:         '#c0392b',
  atencao:         '#c8a040',
  bom:             '#5a8f6c',
  otimo:           '#27ae60',
  sem_dados:       '#d7d2cb',
};
const FAIXA_LABEL = {
  urgencia_maxima: 'Urgência',
  critico:         'Crítico',
  atencao:         'Atenção',
  bom:             'Bom',
  otimo:           'Ótimo',
  sem_dados:       'Sem dados',
};

export function Card6Margens({ C, SERIF, CALIBRI }) {
  const { dados, loading, erro, carregar } = useCardData('margens');
  const [mostrarSaudaveis, setMostrarSaudaveis] = useState(false);
  const [sel, setSel] = useState(null); // { ref, canal }

  const margem = dados?.margem || [];
  const plano  = dados?.plano_ajuste || [];

  // Ordem fixa de canais (mesma das views)
  const CANAIS_HEATMAP = ['mercadolivre','shopee','shein','tiktok','meluni'];

  // Indexar margem por ref -> canal -> row
  const matriz = useMemo(() => {
    const m = {};
    for (const r of margem) {
      if (!m[r.ref_norm]) m[r.ref_norm] = { descricao: r.descricao, canais: {} };
      m[r.ref_norm].canais[r.canal_norm] = r;
    }
    return m;
  }, [margem]);

  // Refs a mostrar: só as que têm pelo menos 1 célula critica/urgente/atencao,
  // a menos que o toggle esteja ligado.
  const refsVisiveis = useMemo(() => {
    const all = Object.keys(matriz).sort();
    if (mostrarSaudaveis) return all;
    return all.filter(ref => {
      const cels = Object.values(matriz[ref].canais);
      return cels.some(c => ['urgencia_maxima','critico','atencao'].includes(c.faixa));
    });
  }, [matriz, mostrarSaudaveis]);

  // Lookup do plano
  const planoLookup = useMemo(() => {
    const m = {};
    for (const p of plano) m[`${p.ref_norm}|${p.canal_norm}`] = p;
    return m;
  }, [plano]);

  const selPlano = sel ? planoLookup[`${sel.ref}|${sel.canal}`] : null;
  const selMargem = sel ? matriz[sel.ref]?.canais[sel.canal] : null;

  return (
    <CardShell
      eyebrow="Card 6 · Margem atual por canal"
      titulo="Heatmap de margens + plano de ajuste"
      loading={loading} erro={erro} onRefresh={carregar}
      C={C} SERIF={SERIF}
    >
      {!dados ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>Carregando…</div>
      ) : margem.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>
          Sem dados de margem calculados.
        </div>
      ) : (
        <>
          {/* Legenda + toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            flexWrap: 'wrap', fontFamily: CALIBRI, fontSize: 10, color: C.muted,
          }}>
            {['urgencia_maxima','critico','atencao','bom','otimo'].map(f => (
              <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: FAIXA_COR[f] }} />
                {FAIXA_LABEL[f]}
              </span>
            ))}
            <label style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={mostrarSaudaveis}
                onChange={e => setMostrarSaudaveis(e.target.checked)}
                style={{ margin: 0 }}
              />
              Mostrar saudáveis
            </label>
          </div>

          {/* Heatmap */}
          <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto', border: `1px solid ${C.cream}`, borderRadius: 6 }}>
            <table style={{ borderCollapse: 'collapse', fontFamily: CALIBRI, fontSize: 11, width: '100%', minWidth: 420 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 1 }}>
                  <th style={{ ...thL, padding: '6px 8px' }}>Ref</th>
                  {CANAIS_HEATMAP.map(cn => (
                    <th key={cn} style={{ ...thR, padding: '6px 4px', fontSize: 9 }}>
                      {CANAL_LABEL[cn].split(' ')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {refsVisiveis.length === 0 ? (
                  <tr><td colSpan={CANAIS_HEATMAP.length + 1} style={{ padding: 14, textAlign: 'center', color: C.muted }}>
                    Todas as margens visíveis estão saudáveis. ✓
                  </td></tr>
                ) : refsVisiveis.map((ref, i) => (
                  <tr key={ref} style={{ borderTop: `1px solid ${C.cream}` }}>
                    <td style={{ padding: '4px 8px', fontWeight: 700, color: C.iaDarker, whiteSpace: 'nowrap' }}>
                      {ref}
                    </td>
                    {CANAIS_HEATMAP.map(cn => {
                      const cel = matriz[ref].canais[cn];
                      if (!cel) {
                        return <td key={cn} style={{ padding: 3, background: '#fafafa' }}>
                          <div style={{ width: '100%', height: 22, borderRadius: 3, background: FAIXA_COR.sem_dados, opacity: 0.3 }} />
                        </td>;
                      }
                      const ativa = sel?.ref === ref && sel?.canal === cn;
                      return (
                        <td key={cn} style={{ padding: 2 }}>
                          <button
                            onClick={() => setSel(ativa ? null : { ref, canal: cn })}
                            title={`${CANAL_LABEL[cn]} · ${fmtReal(cel.lucro_peca)} lucro/peça · ${FAIXA_LABEL[cel.faixa]}`}
                            style={{
                              width: '100%', height: 24, borderRadius: 3,
                              background: FAIXA_COR[cel.faixa] || C.muted,
                              color: '#fff', fontSize: 10, fontWeight: 700,
                              border: ativa ? `2px solid ${C.iaDarker}` : 'none',
                              cursor: 'pointer', fontFamily: CALIBRI,
                            }}
                          >
                            {(Number(cel.lucro_peca) || 0).toFixed(0)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Drill: detalhes + plano */}
          {sel && (
            <div style={{
              marginTop: 12, background: C.appBg, border: `1px solid ${C.cream}`,
              borderRadius: 8, padding: 12, fontFamily: CALIBRI, fontSize: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <span style={{ fontWeight: 700, color: C.iaDarker }}>Ref {sel.ref}</span>
                  <span style={{ color: C.muted, margin: '0 8px' }}>·</span>
                  <span>{CANAL_LABEL[sel.canal]}</span>
                </div>
                <button
                  onClick={() => setSel(null)}
                  style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 14, cursor: 'pointer' }}
                >✕</button>
              </div>
              {selMargem && (
                <div style={{ color: C.muted, fontSize: 11, marginBottom: 8 }}>
                  {matriz[sel.ref]?.descricao || ''}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                {selMargem && (
                  <>
                    <Kvp label="Preço atual" val={fmtReal(selMargem.preco_venda)} C={C} />
                    <Kvp label="Custo produção" val={fmtReal(selMargem.custo_producao)} C={C} />
                    <Kvp
                      label="Lucro/peça"
                      val={fmtReal(selMargem.lucro_peca)}
                      C={C}
                      cor={FAIXA_COR[selMargem.faixa]}
                    />
                  </>
                )}
                {selPlano ? (
                  <>
                    <Kvp
                      label="Preço p/ R$10 lucro"
                      val={fmtReal(selPlano.preco_sugerido_lucro_10)}
                      hint={`${selPlano.ajuste_para_lucro_10 >= 0 ? '+' : ''}${fmtReal(selPlano.ajuste_para_lucro_10)}`}
                      C={C}
                    />
                    <Kvp
                      label="Preço p/ R$14 lucro"
                      val={fmtReal(selPlano.preco_sugerido_lucro_14)}
                      hint={`${selPlano.ajuste_para_lucro_14 >= 0 ? '+' : ''}${fmtReal(selPlano.ajuste_para_lucro_14)}`}
                      C={C}
                    />
                  </>
                ) : (
                  <div style={{ gridColumn: 'span 2', color: C.muted, fontSize: 11, alignSelf: 'center' }}>
                    Sem plano de ajuste (margem já ≥ R$14 ou canal fora do plano).
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: 10, color: C.muted, fontFamily: CALIBRI }}>
            {refsVisiveis.length} refs visíveis · {margem.length} combinações ref×canal total ·{' '}
            {plano.length} no plano de ajuste
          </div>
        </>
      )}
    </CardShell>
  );
}

function Kvp({ label, val, hint, cor, C }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1, textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: cor || C.iaDarker, marginTop: 2 }}>
        {val}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>{hint}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Card 7 · Oportunidades · lista com destaque pros alto-potencial
// ═══════════════════════════════════════════════════════════════════════

export function Card7Oportunidades({ C, SERIF, CALIBRI }) {
  const { dados, loading, erro, carregar } = useCardData('oportunidades');
  const oportunidades = dados?.oportunidades || [];

  // Alto potencial: lucro/peça >= 15 e unidades_30d < 5
  const altoPotencial = (o) => Number(o.lucro_peca) >= 15 && Number(o.unidades_30d) < 5;

  return (
    <CardShell
      eyebrow="Card 7 · Margem boa, venda baixa"
      titulo="Oportunidades"
      loading={loading} erro={erro} onRefresh={carregar}
      C={C} SERIF={SERIF}
    >
      {!dados ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>Carregando…</div>
      ) : oportunidades.length === 0 ? (
        <div style={{ fontSize: 12, color: C.muted, padding: 10 }}>
          Sem oportunidades identificadas no momento. ✓
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: CALIBRI }}>
          {oportunidades.map((o, i) => {
            const alto = altoPotencial(o);
            return (
              <div
                key={`${o.ref_norm}-${o.canal_norm}-${i}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto auto auto',
                  gap: 10, alignItems: 'center',
                  padding: '8px 10px',
                  background: alto ? '#fff9e6' : '#fff',
                  border: `1px solid ${alto ? C.warning : C.cream}`,
                  borderLeft: alto ? `3px solid ${C.warning}` : `1px solid ${C.cream}`,
                  borderRadius: 6, fontSize: 11,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {alto && <span style={{ fontSize: 12 }}>⭐</span>}
                    <span style={{ fontWeight: 700, color: C.iaDarker }}>{o.ref_norm}</span>
                    <span style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 999,
                      background: CANAL_COR[o.canal_norm] || C.muted,
                      color: CANAL_TEXT_COR[o.canal_norm] || '#fff',
                      border: o.canal_norm === 'shein' || o.canal_norm === 'tiktok' ? '1px solid #ccc' : 'none',
                    }}>
                      {CANAL_LABEL[o.canal_norm]}
                    </span>
                  </div>
                  <div style={{ color: C.muted, fontSize: 10, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.descricao || '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1, textTransform: 'uppercase' }}>Lucro</div>
                  <div style={{ fontWeight: 700, color: C.success }}>{fmtReal(o.lucro_peca)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1, textTransform: 'uppercase' }}>30d</div>
                  <div style={{ fontWeight: 700, color: alto ? C.critical : C.iaDarker }}>
                    {fmtInt(o.unidades_30d)} un
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 9, color: C.muted, letterSpacing: 1, textTransform: 'uppercase' }}>Preço</div>
                  <div style={{ color: C.muted }}>{fmtReal(o.preco_venda)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {oportunidades.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 10, color: C.muted, fontFamily: CALIBRI }}>
          ⭐ = lucro ≥ R$15 e menos de 5 unidades em 30 dias (alto potencial)
        </div>
      )}
    </CardShell>
  );
}

// ─── Estilos de tabela compartilhados ──────────────────────────────────

const thL = { textAlign: 'left',  padding: '6px 4px', fontWeight: 600 };
const thR = { textAlign: 'right', padding: '6px 4px', fontWeight: 600 };
const tdL = { textAlign: 'left',  padding: '6px 4px' };
const tdR = { textAlign: 'right', padding: '6px 4px' };
