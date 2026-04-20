/**
 * HistoricoVendas.jsx — Dashboard de histórico de vendas por marketplace
 *
 * Consome dados importados na chave Supabase user_id='historico_vendas'.
 * Estrutura do payload:
 *   {
 *     _meta: { refsTotal, mesesTotal, periodo, canais, observacoes },
 *     refs: {
 *       "2601": { refDisplay, descricao, vendas: { "2025-01": {shein_lumia, ...}, ... } },
 *       ...
 *     }
 *   }
 */

import { useState, useEffect, useMemo } from 'react';

const SERIF = "Georgia,'Times New Roman',serif";
const NUM   = "Calibri,'Segoe UI',Arial,sans-serif";

// Paleta do app
const C = {
  bg:       '#f7f4f0',
  card:     '#fff',
  border:   '#e8e2da',
  text:     '#2c3e50',
  muted:    '#8a9aa4',
  accent:   '#4a7fa5',
  softBg:   '#f0ebe4',
  alert:    '#c0392b',
  ok:       '#27ae60',
};

// Cores para cada plataforma
const COR_PLATAFORMA = {
  shein:   '#2a6b7b',
  shopee:  '#d97033',
  mercado: '#d4a500',
  tiktok:  '#1a1a1a',
};

// Cores para cada marca
const COR_MARCA = {
  lumia:  '#8fa7b8',
  exitus: '#b89475',
  muniam: '#6a7f94',
};

// Canais em ordem fixa de exibição
const CANAIS = [
  { id: 'shein_lumia',    plat: 'shein',   marca: 'lumia',  label: 'Shein · Lumia' },
  { id: 'shein_exitus',   plat: 'shein',   marca: 'exitus', label: 'Shein · Exitus' },
  { id: 'shein_muniam',   plat: 'shein',   marca: 'muniam', label: 'Shein · Muniam' },
  { id: 'shopee_lumia',   plat: 'shopee',  marca: 'lumia',  label: 'Shopee · Lumia' },
  { id: 'shopee_exitus',  plat: 'shopee',  marca: 'exitus', label: 'Shopee · Exitus' },
  { id: 'shopee_muniam',  plat: 'shopee',  marca: 'muniam', label: 'Shopee · Muniam' },
  { id: 'mercado_lumia',  plat: 'mercado', marca: 'lumia',  label: 'ML · Lumia' },
  { id: 'mercado_exitus', plat: 'mercado', marca: 'exitus', label: 'ML · Exitus' },
  { id: 'mercado_muniam', plat: 'mercado', marca: 'muniam', label: 'ML · Muniam' },
  { id: 'tiktok',         plat: 'tiktok',  marca: null,     label: 'TikTok' },
];

const PLATAFORMAS = [
  { id: 'shein',   label: 'Shein'   },
  { id: 'shopee',  label: 'Shopee'  },
  { id: 'mercado', label: 'Mercado Livre' },
  { id: 'tiktok',  label: 'TikTok'  },
];

const MARCAS = [
  { id: 'lumia',  label: 'Lumia'  },
  { id: 'exitus', label: 'Exitus' },
  { id: 'muniam', label: 'Muniam' },
];

// Nome curto dos meses em pt-BR
const MES_LABEL = {
  '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun',
  '07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez',
};
const labelMes = (mes) => {
  const [y, m] = mes.split('-');
  return `${MES_LABEL[m] || m}/${y.slice(2)}`;
};

const fmtNum = (n) => (n || 0).toLocaleString('pt-BR');

// ═══════════════════════════════════════════════════════════════════════════════

export default function HistoricoVendas({ supabase }) {
  const [loading, setLoading]   = useState(true);
  const [erro, setErro]         = useState(null);
  const [dados, setDados]       = useState(null);   // payload bruto do Supabase
  const [filtroMarca, setFiltroMarca]       = useState('todas');
  const [filtroPlat, setFiltroPlat]         = useState('todas');
  const [filtroMesDe, setFiltroMesDe]       = useState(null); // null = desde o inicio
  const [filtroMesAte, setFiltroMesAte]     = useState(null); // null = ate o fim
  const [refSelecionada, setRefSelecionada] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('amicia_data')
          .select('payload')
          .eq('user_id', 'historico_vendas')
          .maybeSingle();
        if (error) throw error;
        if (!data?.payload?.refs) {
          setErro('Histórico não encontrado. Importe o histórico primeiro.');
          return;
        }
        setDados(data.payload);
      } catch (e) {
        setErro(e?.message || 'Erro ao carregar histórico');
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase]);

  // Canais ativos baseados nos filtros
  const canaisAtivos = useMemo(() => {
    return CANAIS.filter(c => {
      if (filtroPlat !== 'todas' && c.plat !== filtroPlat) return false;
      if (filtroMarca !== 'todas' && c.marca !== filtroMarca) return false;
      return true;
    });
  }, [filtroMarca, filtroPlat]);

  // Lista de meses disponíveis no dataset (ordenada ascendente)
  const mesesDisponiveis = useMemo(() => {
    if (!dados?.refs) return [];
    const primeiraRef = Object.values(dados.refs)[0];
    if (!primeiraRef?.vendas) return [];
    return Object.keys(primeiraRef.vendas).sort();
  }, [dados]);

  // Meses filtrados — todos os cálculos operam sobre essa lista
  const meses = useMemo(() => {
    return mesesDisponiveis.filter(m => {
      if (filtroMesDe && m < filtroMesDe) return false;
      if (filtroMesAte && m > filtroMesAte) return false;
      return true;
    });
  }, [mesesDisponiveis, filtroMesDe, filtroMesAte]);

  // Processamento: soma filtrada por ref/mês/canal
  const somaRefMes = (refData, mes) => {
    const vendasMes = refData.vendas?.[mes] || {};
    let soma = 0;
    for (const canal of canaisAtivos) soma += (vendasMes[canal.id] || 0);
    return soma;
  };
  const somaRefTotal = (refData) => {
    let soma = 0;
    for (const mes of meses) soma += somaRefMes(refData, mes);
    return soma;
  };

  // KPIs principais
  const kpis = useMemo(() => {
    if (!dados?.refs) return null;
    let totalGeral = 0;
    const porMes = {};
    const porPlat = { shein:0, shopee:0, mercado:0, tiktok:0 };
    const porMarca = { lumia:0, exitus:0, muniam:0, _tiktok:0 };

    for (const ref of Object.values(dados.refs)) {
      for (const mes of meses) {
        const v = ref.vendas?.[mes] || {};
        for (const canal of canaisAtivos) {
          const q = v[canal.id] || 0;
          totalGeral += q;
          porMes[mes] = (porMes[mes] || 0) + q;
          porPlat[canal.plat] = (porPlat[canal.plat] || 0) + q;
          if (canal.marca) porMarca[canal.marca] = (porMarca[canal.marca] || 0) + q;
          else porMarca._tiktok += q;
        }
      }
    }
    // Melhor de cada
    const melhorMes = Object.entries(porMes).sort((a,b)=>b[1]-a[1])[0];
    const melhorPlat = Object.entries(porPlat).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1])[0];
    // Melhor marca ignora _tiktok (que é "marca sem marca")
    const melhorMarca = Object.entries(porMarca).filter(([k])=>k!=='_tiktok').sort((a,b)=>b[1]-a[1])[0];

    return { totalGeral, porMes, porPlat, porMarca, melhorMes, melhorPlat, melhorMarca };
  }, [dados, canaisAtivos, meses]);

  // Top refs (pós-filtro)
  const topRefs = useMemo(() => {
    if (!dados?.refs) return [];
    const lista = Object.entries(dados.refs).map(([canonica, rd]) => ({
      canonica, ...rd, total: somaRefTotal(rd),
    }));
    lista.sort((a,b)=>b.total-a.total);
    return lista.filter(r => r.total > 0).slice(0, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, canaisAtivos, meses]);

  // Série do gráfico de linha — total por mês (pós-filtro)
  const serieMensal = useMemo(() => {
    if (!kpis) return [];
    return meses.map(m => ({ mes: m, total: kpis.porMes[m] || 0 }));
  }, [kpis, meses]);

  // ─────────────────────────────────────────────────────────────────
  // RENDERIZAÇÃO
  // ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: C.muted, fontSize: 13, fontFamily: SERIF }}>
        Carregando histórico…
      </div>
    );
  }
  if (erro) {
    return (
      <div style={{ background: '#fdeaea', color: C.alert, padding: 16, borderRadius: 8, fontSize: 13, fontFamily: SERIF }}>
        ⚠ {erro}
      </div>
    );
  }
  if (!dados || !kpis) return null;

  return (
    <div style={{ fontFamily: SERIF }}>
      {/* Header com período */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>📊 Histórico de Vendas</div>
        <div style={{ fontSize: 11, color: C.muted }}>
          {dados._meta?.periodo || '—'} · {dados._meta?.refsTotal || Object.keys(dados.refs).length} refs · {meses.length} de {mesesDisponiveis.length} meses
        </div>
        {dados._meta?.observacoes?.length > 0 && (
          <div style={{ fontSize: 10, color: C.muted, fontStyle: 'italic', flex: '1 1 100%' }}>
            ⓘ {dados._meta.observacoes.join(' · ')}
          </div>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.muted }}>Marca:</span>
        <FilterButton active={filtroMarca==='todas'} onClick={()=>setFiltroMarca('todas')}>Todas</FilterButton>
        {MARCAS.map(m => (
          <FilterButton key={m.id} active={filtroMarca===m.id} onClick={()=>setFiltroMarca(m.id)} color={COR_MARCA[m.id]}>{m.label}</FilterButton>
        ))}
        <div style={{ width: 1, height: 14, background: C.border, margin: '0 6px' }} />
        <span style={{ fontSize: 11, color: C.muted }}>Plataforma:</span>
        <FilterButton active={filtroPlat==='todas'} onClick={()=>setFiltroPlat('todas')}>Todas</FilterButton>
        {PLATAFORMAS.map(p => (
          <FilterButton key={p.id} active={filtroPlat===p.id} onClick={()=>setFiltroPlat(p.id)} color={COR_PLATAFORMA[p.id]}>{p.label}</FilterButton>
        ))}
      </div>

      {/* Filtro de mês (range) */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.muted }}>Mês:</span>
        <FilterButton
          active={!filtroMesDe && !filtroMesAte}
          onClick={()=>{ setFiltroMesDe(null); setFiltroMesAte(null); }}
        >Todos</FilterButton>
        <FilterButton
          active={filtroMesDe==='2025-01' && filtroMesAte==='2025-12'}
          onClick={()=>{ setFiltroMesDe('2025-01'); setFiltroMesAte('2025-12'); }}
        >2025</FilterButton>
        <FilterButton
          active={filtroMesDe==='2026-01' && filtroMesAte==='2026-02'}
          onClick={()=>{ setFiltroMesDe('2026-01'); setFiltroMesAte('2026-02'); }}
        >2026</FilterButton>
        {mesesDisponiveis.length >= 3 && (
          <FilterButton
            active={filtroMesDe===mesesDisponiveis[mesesDisponiveis.length-3] && filtroMesAte===mesesDisponiveis[mesesDisponiveis.length-1]}
            onClick={()=>{ setFiltroMesDe(mesesDisponiveis[mesesDisponiveis.length-3]); setFiltroMesAte(mesesDisponiveis[mesesDisponiveis.length-1]); }}
          >Últimos 3 meses</FilterButton>
        )}
        {mesesDisponiveis.length >= 6 && (
          <FilterButton
            active={filtroMesDe===mesesDisponiveis[mesesDisponiveis.length-6] && filtroMesAte===mesesDisponiveis[mesesDisponiveis.length-1]}
            onClick={()=>{ setFiltroMesDe(mesesDisponiveis[mesesDisponiveis.length-6]); setFiltroMesAte(mesesDisponiveis[mesesDisponiveis.length-1]); }}
          >Últimos 6 meses</FilterButton>
        )}
        <div style={{ width: 1, height: 14, background: C.border, margin: '0 6px' }} />
        <span style={{ fontSize: 11, color: C.muted }}>De:</span>
        <select
          value={filtroMesDe || ''}
          onChange={e => setFiltroMesDe(e.target.value || null)}
          style={{ padding: '3px 6px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, fontFamily: SERIF, color: C.text, background: C.card, cursor: 'pointer' }}
        >
          <option value="">(início)</option>
          {mesesDisponiveis.map(m => <option key={m} value={m}>{labelMes(m)}</option>)}
        </select>
        <span style={{ fontSize: 11, color: C.muted }}>até:</span>
        <select
          value={filtroMesAte || ''}
          onChange={e => setFiltroMesAte(e.target.value || null)}
          style={{ padding: '3px 6px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, fontFamily: SERIF, color: C.text, background: C.card, cursor: 'pointer' }}
        >
          <option value="">(fim)</option>
          {mesesDisponiveis.map(m => <option key={m} value={m}>{labelMes(m)}</option>)}
        </select>
        {(filtroMesDe || filtroMesAte) && (
          <span style={{ fontSize: 10, color: C.muted, marginLeft: 8, fontStyle: 'italic' }}>
            · {meses.length} mês(es) no filtro
          </span>
        )}
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
        <KpiCard
          label="Total de peças"
          value={fmtNum(kpis.totalGeral)}
          sub={`${meses.length} mês(es) · ${canaisAtivos.length} canal(is)`}
        />
        <KpiCard
          label="Melhor plataforma"
          value={kpis.melhorPlat ? PLATAFORMAS.find(p=>p.id===kpis.melhorPlat[0])?.label || kpis.melhorPlat[0] : '—'}
          sub={kpis.melhorPlat ? `${fmtNum(kpis.melhorPlat[1])} peças` : ''}
          color={kpis.melhorPlat ? COR_PLATAFORMA[kpis.melhorPlat[0]] : C.accent}
        />
        <KpiCard
          label="Melhor marca"
          value={kpis.melhorMarca ? MARCAS.find(m=>m.id===kpis.melhorMarca[0])?.label || kpis.melhorMarca[0] : '—'}
          sub={kpis.melhorMarca ? `${fmtNum(kpis.melhorMarca[1])} peças` : ''}
          color={kpis.melhorMarca ? COR_MARCA[kpis.melhorMarca[0]] : C.accent}
        />
        <KpiCard
          label="Melhor mês"
          value={kpis.melhorMes ? labelMes(kpis.melhorMes[0]) : '—'}
          sub={kpis.melhorMes ? `${fmtNum(kpis.melhorMes[1])} peças` : ''}
        />
      </div>

      {/* Grid principal: gráfico à esquerda + top refs à direita */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: 14, alignItems: 'flex-start' }}>
        {/* Gráfico de linha — total por mês */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>
            Evolução mensal
          </div>
          <GraficoLinha serie={serieMensal} cor={C.accent} />
          <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>
            Soma de todos os canais filtrados por mês
          </div>

          {/* Mini gráficos por plataforma */}
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>
              Participação por plataforma
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {PLATAFORMAS.map(p => {
                const v = kpis.porPlat[p.id] || 0;
                const pct = kpis.totalGeral ? (v / kpis.totalGeral) * 100 : 0;
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                    <div style={{ width: 90, color: C.text, fontWeight: 600 }}>{p.label}</div>
                    <div style={{ flex: 1, background: C.softBg, borderRadius: 4, height: 12, position: 'relative', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: COR_PLATAFORMA[p.id], borderRadius: 4 }} />
                    </div>
                    <div style={{ width: 90, textAlign: 'right', fontFamily: NUM, color: C.text }}>
                      {fmtNum(v)} <span style={{ color: C.muted, fontSize: 10 }}>({pct.toFixed(1)}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Top refs */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>
            Top 20 referências
          </div>
          {topRefs.length === 0 ? (
            <div style={{ fontSize: 12, color: C.muted, padding: 20, textAlign: 'center' }}>
              Nenhuma ref com vendas nos filtros atuais
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {topRefs.map((ref, idx) => {
                const maxTotal = topRefs[0].total;
                const pct = maxTotal ? (ref.total / maxTotal) * 100 : 0;
                const expandida = refSelecionada === ref.canonica;
                return (
                  <div key={ref.canonica} style={{ borderBottom: `1px solid ${C.softBg}` }}>
                    <div
                      onClick={() => setRefSelecionada(expandida ? null : ref.canonica)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px',
                        cursor: 'pointer', fontSize: 12,
                        background: expandida ? C.softBg : 'transparent',
                        borderRadius: 4,
                      }}
                    >
                      <div style={{ width: 20, fontSize: 10, color: C.muted, textAlign: 'right' }}>{idx+1}</div>
                      <div style={{ width: 52, fontFamily: NUM, fontWeight: 700, color: C.text }}>
                        {ref.refDisplay || ref.canonica}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text, fontSize: 11 }}>
                        {ref.descricao}
                      </div>
                      <div style={{ width: 90, background: C.softBg, borderRadius: 3, height: 10, position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: C.accent, borderRadius: 3 }} />
                      </div>
                      <div style={{ width: 60, textAlign: 'right', fontFamily: NUM, fontWeight: 700, color: C.text }}>
                        {fmtNum(ref.total)}
                      </div>
                      <div style={{ width: 14, color: C.muted, fontSize: 10, transform: expandida ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</div>
                    </div>
                    {expandida && (
                      <DetalheRef ref_={ref} meses={meses} canaisAtivos={canaisAtivos} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBCOMPONENTES
// ═══════════════════════════════════════════════════════════════════════════════

function FilterButton({ active, onClick, children, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? (color || C.text) : C.card,
        color: active ? '#fff' : C.text,
        border: active ? 'none' : `1px solid ${C.border}`,
        borderRadius: 6,
        padding: '4px 9px',
        fontSize: 11,
        cursor: 'pointer',
        fontFamily: SERIF,
        fontWeight: active ? 700 : 400,
      }}
    >
      {children}
    </button>
  );
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.text, fontFamily: NUM, marginTop: 6, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/**
 * Gráfico de linha SVG simples.
 * serie = [{ mes: "2025-01", total: N }, ...]
 */
function GraficoLinha({ serie, cor }) {
  const w = 640, h = 200;
  const pad = { top: 10, right: 16, bottom: 28, left: 48 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top  - pad.bottom;

  if (!serie || serie.length === 0) {
    return <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 12 }}>Sem dados</div>;
  }
  const max = Math.max(...serie.map(p => p.total), 1);
  const step = serie.length > 1 ? innerW / (serie.length - 1) : 0;

  const x = (i) => pad.left + i * step;
  const y = (v) => pad.top + innerH - (v / max) * innerH;

  // Path da linha
  const pathD = serie.map((p, i) => `${i===0?'M':'L'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
  // Gridlines horizontais (4 divisões)
  const gridY = [0, 0.25, 0.5, 0.75, 1].map(f => pad.top + innerH * f);
  // Valores dos gridlines
  const gridV = [1, 0.75, 0.5, 0.25, 0].map(f => Math.round(max * f));

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', maxWidth: '100%' }} preserveAspectRatio="xMidYMid meet">
      {/* Gridlines */}
      {gridY.map((gy, i) => (
        <g key={i}>
          <line x1={pad.left} y1={gy} x2={pad.left + innerW} y2={gy} stroke={C.border} strokeDasharray="2 3" />
          <text x={pad.left - 6} y={gy + 3} fontSize="9" fill={C.muted} textAnchor="end" fontFamily={NUM}>
            {fmtNum(gridV[i])}
          </text>
        </g>
      ))}
      {/* Área sob a curva */}
      <path
        d={`${pathD} L${x(serie.length-1).toFixed(1)},${pad.top+innerH} L${x(0).toFixed(1)},${pad.top+innerH} Z`}
        fill={cor}
        fillOpacity="0.08"
      />
      {/* Linha */}
      <path d={pathD} stroke={cor} strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
      {/* Pontos + labels no eixo X */}
      {serie.map((p, i) => (
        <g key={p.mes}>
          <circle cx={x(i)} cy={y(p.total)} r="3" fill={cor} />
          <text x={x(i)} y={h - 10} fontSize="9" fill={C.muted} textAnchor="middle" fontFamily={NUM}>
            {labelMes(p.mes)}
          </text>
          {/* Label de valor no topo do ponto - só se destaque (>75% do máx) */}
          {p.total >= max * 0.75 && (
            <text x={x(i)} y={y(p.total) - 8} fontSize="9" fill={C.text} textAnchor="middle" fontFamily={NUM} fontWeight="700">
              {fmtNum(p.total)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

/**
 * Detalhe expandido de uma ref: tabela mensal × canal
 */
function DetalheRef({ ref_, meses, canaisAtivos }) {
  // Soma por canal (filtrado)
  const porCanal = {};
  for (const c of canaisAtivos) porCanal[c.id] = 0;
  for (const m of meses) {
    const v = ref_.vendas?.[m] || {};
    for (const c of canaisAtivos) porCanal[c.id] += (v[c.id] || 0);
  }
  const canaisOrdenados = [...canaisAtivos].sort((a,b)=>porCanal[b.id]-porCanal[a.id]);
  const topCanais = canaisOrdenados.filter(c=>porCanal[c.id]>0).slice(0, 6);

  if (topCanais.length === 0) {
    return (
      <div style={{ padding: 10, fontSize: 11, color: C.muted, fontStyle: 'italic' }}>
        Sem vendas em nenhum canal filtrado.
      </div>
    );
  }

  const maxCanal = porCanal[topCanais[0].id] || 1;

  return (
    <div style={{ padding: '8px 10px 12px 28px', fontSize: 11 }}>
      <div style={{ color: C.muted, marginBottom: 6 }}>Top canais dessa ref:</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {topCanais.map(c => {
          const v = porCanal[c.id];
          const pct = maxCanal ? (v / maxCanal) * 100 : 0;
          const platCor = COR_PLATAFORMA[c.plat] || C.accent;
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 120, color: C.text }}>{c.label}</div>
              <div style={{ flex: 1, background: C.softBg, borderRadius: 3, height: 8, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: platCor, borderRadius: 3 }} />
              </div>
              <div style={{ width: 50, textAlign: 'right', fontFamily: NUM, fontWeight: 600, color: C.text }}>
                {fmtNum(v)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
