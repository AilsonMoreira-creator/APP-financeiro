/**
 * RaioXProduto.jsx — Raio-X da referência no card do Bling (Ailson 15/08/2026)
 *
 * Tudo que ele precisa pra decidir numa tela só: quanto vendeu (7d/mês/30d),
 * quais cores puxam, quais canais estão subindo ou caindo, se o Full está
 * girando e o que está voltando (com o % sobre o que aquele item vendeu — o
 * bege pode liderar as devoluções só por ser o mais vendido).
 */
import { useState, useEffect } from 'react';

const F = 'Georgia,serif';
const C = {
  navy: '#2c3e50', azul: '#4a7fa5', suave: '#6b7c8c', borda: '#e8e2da', fundo: '#faf8f5',
  verde: '#1f7a48', verdeBg: '#e9f5ee', vermelho: '#a33', vermelhoBg: '#fdecea',
  ambar: '#8a6500', ambarBg: '#fff8e8',
};

const PERIODOS = [['7d', '7 dias'], ['mes', 'Este mês'], ['30d', '30 dias']];

export default function RaioXProduto({ refProduto, desc, foto, onClose }) {
  const [periodo, setPeriodo] = useState('7d');
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true); setErro('');
      try {
        const r = await fetch(`/api/bling-raiox-produto?ref=${encodeURIComponent(refProduto)}&periodo=${periodo}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
        if (vivo) setD(j);
      } catch (e) { if (vivo) setErro(e.message); }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [refProduto, periodo]);

  const seta = (v) => {
    if (v === null || v === undefined) return <span style={{ color: C.suave }}>—</span>;
    const sobe = v >= 0;
    return (
      <span style={{ color: sobe ? C.verde : C.vermelho, fontWeight: 700, fontSize: 12.5 }}>
        {sobe ? '▲' : '▼'} {Math.abs(v)}%
      </span>
    );
  };

  const barra = (pct, cor = C.azul) => (
    <div style={{ height: 6, background: '#eee9e2', borderRadius: 99, overflow: 'hidden', marginTop: 3 }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: cor }} />
    </div>
  );

  const Bloco = ({ titulo, sub, children }) => (
    <div style={{ background: '#fff', border: `1px solid ${C.borda}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase', color: C.suave }}>{titulo}</div>
      {sub && <div style={{ fontSize: 11.5, color: C.suave, marginTop: 2 }}>{sub}</div>}
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(44,62,80,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 220, backdropFilter: 'blur(3px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.fundo, borderRadius: 14, width: '100%', maxWidth: 860, maxHeight: '92vh', overflow: 'auto', fontFamily: F }}>

        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borda}`, background: '#fff', position: 'sticky', top: 0, zIndex: 3, display: 'flex', gap: 12, alignItems: 'center' }}>
          {foto && <img src={foto} alt="" style={{ width: 46, height: 60, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.azul, fontWeight: 700 }}>REF {refProduto}</div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: C.navy, lineHeight: 1.2 }}>{desc || 'Raio-X do produto'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: C.suave, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ padding: 14 }}>
          {/* filtro de período — comanda a tela inteira */}
          <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap' }}>
            {PERIODOS.map(([k, l]) => (
              <button key={k} onClick={() => setPeriodo(k)}
                style={{ padding: '8px 15px', borderRadius: 9, cursor: 'pointer', fontFamily: F, fontSize: 13,
                  fontWeight: periodo === k ? 800 : 600,
                  border: periodo === k ? 'none' : `1px solid ${C.borda}`,
                  background: periodo === k ? C.navy : '#fff', color: periodo === k ? '#fff' : C.navy }}>{l}</button>
            ))}
          </div>

          {erro && <div style={{ background: C.vermelhoBg, color: C.vermelho, padding: 10, borderRadius: 8, fontSize: 12.5 }}>{erro}</div>}
          {carregando && <div style={{ color: C.suave, fontSize: 13, padding: 24, textAlign: 'center' }}>⏳ lendo as vendas…</div>}

          {!carregando && d && (
            <>
              {/* DESTAQUE: peças vendidas */}
              <div style={{ background: C.navy, color: '#fff', borderRadius: 12, padding: '16px 18px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11, opacity: .7, textTransform: 'uppercase', letterSpacing: .5 }}>Peças vendidas</div>
                  <div style={{ fontSize: 42, fontWeight: 800, lineHeight: 1 }}>{d.vendas.pecas}</div>
                  <div style={{ fontSize: 12, opacity: .75, marginTop: 3 }}>{d.vendas.pedidos} pedidos · {d.vendas.media_dia}/dia</div>
                </div>
                <div style={{ borderLeft: '1px solid rgba(255,255,255,.25)', paddingLeft: 18 }}>
                  <div style={{ fontSize: 11, opacity: .7 }}>vs período anterior</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: (d.vendas.variacao_pct ?? 0) >= 0 ? '#7ee0a8' : '#ff9b9b' }}>
                    {d.vendas.variacao_pct === null ? '—' : `${d.vendas.variacao_pct >= 0 ? '▲' : '▼'} ${Math.abs(d.vendas.variacao_pct)}%`}
                  </div>
                  <div style={{ fontSize: 11.5, opacity: .75 }}>eram {d.vendas.pecas_periodo_anterior}</div>
                </div>
              </div>

              {/* CORES */}
              <Bloco titulo="Cores que vendem" sub={`no período escolhido · ${d.cores.length} cores`}>
                {d.cores.slice(0, 10).map((c, i) => (
                  <div key={c.chave} style={{ marginBottom: 9 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13 }}>
                      <span style={{ width: 16, color: C.suave, fontSize: 11 }}>{i + 1}º</span>
                      <span style={{ flex: 1, fontWeight: 700, color: C.navy }}>{c.rotulo}</span>
                      <b style={{ color: C.navy }}>{c.qtd}</b>
                      <span style={{ color: C.suave, fontSize: 11.5, width: 44, textAlign: 'right' }}>{c.pct}%</span>
                    </div>
                    {barra(c.pct * (100 / Math.max(1, d.cores[0].pct)))}
                  </div>
                ))}
              </Bloco>

              {/* CANAIS */}
              <Bloco titulo="Canais (top 5)" sub="a tendência compara os últimos 15 dias com os 15 anteriores">
                {d.canais.map(c => (
                  <div key={c.canal} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${C.borda}` }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{c.canal}</div>
                      <div style={{ fontSize: 11, color: C.suave }}>{c.ult15} peças em 15d · antes {c.ant15}</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 62 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>{c.qtd}</div>
                      <div style={{ fontSize: 10.5, color: C.suave }}>{c.pct}%</div>
                    </div>
                    <div style={{ minWidth: 62, textAlign: 'right' }}>{seta(c.tendencia)}</div>
                  </div>
                ))}
              </Bloco>

              {/* FULL */}
              <Bloco titulo="Mercado Livre Full · Exitus" sub={d.full.vende ? 'este produto gira no Full' : null}>
                {!d.full.vende ? (
                  <div style={{ fontSize: 13, color: C.suave }}>Este produto não vende no Full.</div>
                ) : (
                  <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                    {[['7 dias', d.full.d7, d.full.d7_anterior, d.full.d7_var], ['15 dias', d.full.d15, d.full.d15_anterior, d.full.d15_var]].map(([rot, atual, ant, varp]) => (
                      <div key={rot}>
                        <div style={{ fontSize: 11, color: C.suave }}>{rot}</div>
                        <div style={{ fontSize: 26, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>{atual}</div>
                        <div style={{ fontSize: 11.5, color: C.suave }}>antes {ant} · {seta(varp)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Bloco>

              {/* DEVOLUÇÕES */}
              <Bloco titulo="Devoluções · 30 dias"
                sub={`${d.devolucoes.devolvidas} de ${d.devolucoes.vendidas30} peças · fonte: ${d.devolucoes.fonte}`}>
                <div style={{ display: 'inline-block', background: d.devolucoes.pct >= 6 ? C.vermelhoBg : d.devolucoes.pct >= 3 ? C.ambarBg : C.verdeBg,
                  color: d.devolucoes.pct >= 6 ? C.vermelho : d.devolucoes.pct >= 3 ? C.ambar : C.verde,
                  padding: '6px 13px', borderRadius: 999, fontWeight: 800, fontSize: 15, marginBottom: 12 }}>
                  {d.devolucoes.pct}% do que vendeu
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginBottom: 6 }}>Por tamanho</div>
                    {d.devolucoes.tamanhos.map(t => (
                      <div key={t.tam} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '5px 0', borderTop: `1px solid ${C.borda}` }}>
                        <b style={{ width: 30, color: C.navy }}>{t.tam}</b>
                        <span style={{ flex: 1, color: C.suave }}>{t.devolvidas} de {t.vendidas} vendidas</span>
                        <b style={{ color: t.pct_do_que_vendeu >= 6 ? C.vermelho : C.navy }}>{t.pct_do_que_vendeu}%</b>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.navy, marginBottom: 6 }}>Por cor</div>
                    {d.devolucoes.cores.slice(0, 8).map(c => (
                      <div key={c.cor} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '5px 0', borderTop: `1px solid ${C.borda}` }}>
                        <span style={{ flex: 1, fontWeight: 600, color: C.navy }}>{c.cor}</span>
                        <span style={{ color: C.suave, fontSize: 11.5 }}>{c.devolvidas} de {c.vendidas}</span>
                        <b style={{ color: c.pct_do_que_vendeu >= 8 ? C.vermelho : C.navy, minWidth: 42, textAlign: 'right' }}>{c.pct_do_que_vendeu}%</b>
                      </div>
                    ))}
                  </div>
                </div>
                {(d.devolucoes.por_canal || []).length > 0 && (
                  <div style={{ marginTop: 12, fontSize: 12, color: C.suave }}>
                    <b style={{ color: C.navy }}>Por canal:</b>{' '}
                    {d.devolucoes.por_canal.map(c => `${c.canal} ${c.qtd}`).join(' · ')}
                  </div>
                )}
                <div style={{ fontSize: 11, color: C.suave, marginTop: 10 }}>
                  O % é sobre o que aquele tamanho/cor vendeu — assim a cor mais vendida não parece a pior só por aparecer mais nas devoluções.
                </div>
              </Bloco>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
