/**
 * FullEnvio.jsx — modal do botão FULL no card de produto (Ailson 17/08/2026)
 *
 * Mostra o cenário possível e o ideal, e a Cris decide na coluna Enviar.
 * Mesmo padrão visual da tela de estoque do módulo Bling.
 */
import { useState, useEffect, useMemo } from 'react';

const F = 'Georgia,serif';
const C = {
  navy: '#2c3e50', azul: '#4a7fa5', suave: '#6b7c8c', borda: '#e8e2da', bege: '#f7f4f0',
  ok: '#1f7a48', okBg: '#e9f5ee', alerta: '#8a6500', alertaBg: '#fff8e8', erro: '#a33',
};
const ORDEM_TAM = { PP: 0, P: 1, M: 2, G: 3, GG: 4, G1: 5, G2: 6, G3: 7 };

export default function FullEnvio({ refProduto, desc, usuario, onClose, getProj, onVerCortes, reposicao }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [edit, setEdit] = useState({});          // "cor|tam" → quantidade
  const [salvando, setSalvando] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true); setErro('');
      try {
        // 14/09: manda a matriz de reposição (cortes ativos) pra régua considerar fábrica zerada com corte
        const r = await fetch(`/api/full-recomendacao?ref=${encodeURIComponent(refProduto)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ref: refProduto, reposicao: reposicao || {} }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
        if (!vivo) return;
        setD(j);
        const e = {};
        for (const l of (j.linhas || [])) e[`${l.cor}|${l.tam}`] = l.qtd_enviar;
        setEdit(e);
      } catch (e) { if (vivo) setErro(e.message); }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [refProduto]);

  const linhas = useMemo(() => (d?.linhas || []).slice().sort((a, b) =>
    String(a.cor).localeCompare(String(b.cor)) || (ORDEM_TAM[a.tam] ?? 9) - (ORDEM_TAM[b.tam] ?? 9)), [d]);

  const total = Object.values(edit).reduce((s, v) => s + (Number(v) || 0), 0);
  const travado = linhas.some(l => l.travado);

  const acao = async (tipo) => {
    setSalvando(tipo);
    try {
      const corpo = tipo === 'confirmar'
        ? { ref: refProduto, linhas: linhas.map(l => ({ cor: l.cor, tam: l.tam, qtd: Number(edit[`${l.cor}|${l.tam}`]) || 0 })) }
        : { ref: refProduto };
      const r = await fetch(`/api/full-envio?acao=${tipo}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-User': usuario || 'equipe' },
        body: JSON.stringify(corpo),
      });
      const j = await r.json();
      if (j?.erro) throw new Error(j.erro);
      onClose?.(true);
    } catch (e) { alert(e.message); }
    finally { setSalvando(''); }
  };

  const cel = { padding: '7px 8px', fontSize: 12.5, borderBottom: `1px solid ${C.borda}` };
  // 13/09 (pedido dele): numeros um degrau maiores, sempre inteiros (nunca quebrados)
  const num = { ...cel, fontSize: 14.5, textAlign: 'center', fontVariantNumeric: 'tabular-nums' };
  const inteiro = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? '—' : String(Math.round(Number(v)));

  return (
    <div onClick={() => onClose?.()} style={{ position: 'fixed', inset: 0, background: 'rgba(44,62,80,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 230, backdropFilter: 'blur(3px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '92vh', overflow: 'auto', fontFamily: F }}>

        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borda}`, background: C.bege }}>
          <div style={{ fontSize: 11, color: C.azul, fontWeight: 700 }}>REF {refProduto} · ENVIO PARA O FULL</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>{desc || ''}</div>
          <div style={{ fontSize: 11.5, color: C.suave, marginTop: 3 }}>
            {carregando ? 'calculando…'
              : `cobertura de ${d?.regras?.cobertura ?? 14} dias (${d?.regras?.basicas ?? 20} nas básicas) + ${d?.regras?.transito ?? 5} de trânsito · Proj. 10 dias = quantas peças o FULL deve vender desta REF nos próximos 10 dias`}
          </div>
        </div>

        <div style={{ padding: 14 }}>
          {erro && <div style={{ background: '#fdecea', color: C.erro, padding: 10, borderRadius: 8, fontSize: 12.5 }}>{erro}</div>}
          {carregando && <div style={{ color: C.suave, padding: 24, textAlign: 'center', fontSize: 13 }}>⏳ lendo vendas, estoques e o Full…</div>}

          {!carregando && d && (
            <>
              {travado && (
                <div style={{ background: C.okBg, border: `1px solid #cfe6d8`, color: C.ok, padding: '8px 11px', borderRadius: 8, fontSize: 12.5, marginBottom: 10 }}>
                  Esta referência já está confirmada para a semana — as quantidades abaixo são as que você definiu.
                </div>
              )}
              {Array.isArray(d.cores_sugeridas) && d.cores_sugeridas.length > 0 && (
                <div style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 12, background: '#eef8f0', border: '1px solid #bfe0c8' }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#1e6e42', marginBottom: 2 }}>🎯 Cores que deveriam estar no Full</div>
                  <div style={{ fontSize: 11, color: '#4f7a5c', marginBottom: 8 }}>top 20 do ranking · 20+ vendas na REF em 15 dias · fábrica com 5+ (ou corte ativo) em todos os tamanhos · fora do Full ou sub-estocada</div>
                  {d.cores_sugeridas.map(c => (
                    <div key={c.cor_key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid #d8ecdd' }}>
                      <div style={{ minWidth: 120 }}><b style={{ color: C.navy, fontSize: 14 }}>{c.cor}</b><div style={{ fontSize: 11, color: c.situacao === 'fora do Full' ? '#c0392b' : '#b3541e' }}>{c.situacao}{c.full_total ? ` (${c.full_total} pç)` : ''}</div></div>
                      <div style={{ fontSize: 12, color: C.suave }}>{c.vendas_15d} vendas em 15 dias</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {c.tamanhos.map(t => <span key={t.tam} style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, background: '#fff', border: '1px solid #cfe3d5', color: C.navy }}><b>{t.tam}</b> fáb {t.fabrica}{t.full ? ` · full ${t.full}` : ''}</span>)}
                      </div>
                      <button onClick={() => { setEdit(s => { const e = { ...s }; for (const t of c.tamanhos) e[`${c.cor}|${t.tam}`] = t.enviar; return e; }); }}
                        style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 8, border: 'none', background: '#1e6e42', color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>
                        Enviar {c.total_enviar} ({c.tamanhos.map(t => t.enviar).join('/')})
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div>{/* 13/09: sem overflow aqui — senao o cabecalho "sticky" nao gruda no scroll do modal */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    {/* 13/09: cabecalho FIXO ao rolar; Venda/dia + Cobertura viraram "Proj. 10 dias" */}
                    <tr style={{ background: C.azul, color: '#fff' }}>
                      {[['Cor', '20%', 'left'], ['Tam', '7%', 'center'], ['Full', '9%', 'center'], ['Fábrica', '9%', 'center'], ['Reposição', '9%', 'center'],
                        ['Proj. 10 dias', '11%', 'center'], ['Ideal', '9%', 'center'], ['Possível', '9%', 'center'], ['Enviar', '17%', 'center']].map(([h, w, al]) => (
                        <th key={h} style={{ width: w, padding: '9px 6px', fontSize: 10.5, letterSpacing: .5, textTransform: 'uppercase', textAlign: al,
                          position: 'sticky', top: 0, zIndex: 3, background: h === 'Full' ? C.navy : C.azul }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l, i) => {
                      const k = `${l.cor}|${l.tam}`;
                      const baixa = l.cobertura_atual !== null && l.cobertura_atual < 7;
                      return (
                        <tr key={k} style={{ background: i % 2 ? C.bege : '#fff' }}>
                          <td style={{ ...cel, fontWeight: 700, color: C.navy }}>
                            {l.cor}
                            {l.nova_no_full && (
                              <span style={{ fontSize: 9, fontWeight: 800, marginLeft: 6, padding: '2px 6px', borderRadius: 999,
                                background: '#fdf0e3', color: '#9a5b00', border: '1px solid #f0d5b5' }}>NÃO TEM NO FULL</span>
                            )}
                          </td>
                          <td style={{ ...cel, color: C.azul, fontWeight: 700, textAlign: 'center' }}>{l.tam}</td>
                          <td style={{ ...num, fontWeight: 800, color: C.navy, background: '#eef5fb' }}>{inteiro(l.estoqueFull)}</td>
                          <td style={{ ...num, fontSize: 13, fontWeight: 400, color: C.navy }}>{inteiro(l.estoqueFabrica)}</td>
                          {(() => { const proj = getProj ? (getProj(l.cor, l.tam) || 0) : 0;
                            return <td onClick={proj > 0 && onVerCortes ? () => onVerCortes(l.cor, l.tam) : undefined} title={proj > 0 ? 'Ver cortes que geram a reposição' : undefined}
                              style={{ ...num, fontSize: 13, color: proj > 0 ? '#1e6e42' : C.suave, fontWeight: proj > 0 ? 800 : 400, cursor: proj > 0 ? 'pointer' : 'default', textDecoration: proj > 0 ? 'underline dotted' : 'none' }}>
                              {proj > 0 ? `+${inteiro(proj)}` : '—'}</td>; })()}
                          <td style={{ ...num, color: baixa ? C.erro : C.navy, fontWeight: baixa ? 800 : 500 }}
                            title={`Full: ${Number(l.vendaDiaFull || 0).toFixed(2)}/dia · todos os canais: ${Number(l.vendaDia || 0).toFixed(2)}/dia · cobertura ${l.cobertura_atual === null ? '—' : Math.round(l.cobertura_atual) + ' dias'}`}>
                            {inteiro((Number(l.vendaDiaFull) || 0) * 10)}
                          </td>
                          <td style={{ ...num, color: C.suave }}>{l.qtd_ideal ? inteiro(l.qtd_ideal) : '—'}</td>
                          <td style={{ ...num }}>{l.qtd_possivel ? inteiro(l.qtd_possivel) : '—'}</td>
                          <td style={{ ...cel, textAlign: 'center' }}>
                            <input type="number" min="0" value={edit[k] ?? 0}
                              onChange={ev => setEdit(s => ({ ...s, [k]: ev.target.value }))}
                              style={{ width: 58, padding: '5px 6px', textAlign: 'center', fontSize: 13, fontWeight: 800,
                                borderRadius: 7, border: `2px solid ${(Number(edit[k]) || 0) > 0 ? C.azul : C.borda}`,
                                background: (Number(edit[k]) || 0) > 0 ? '#eef5fb' : '#fff', fontFamily: F, color: C.navy }} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* motivos das linhas que o sistema sugeriu */}
              <div style={{ marginTop: 10, fontSize: 11, color: C.suave, lineHeight: 1.6 }}>
                {linhas.filter(l => l.qtd_sugerida > 0 || (l.qtd_ideal > 0 && l.qtd_sugerida === 0)).slice(0, 8).map(l => (
                  <div key={`m-${l.cor}-${l.tam}`}><b style={{ color: C.navy }}>{l.cor} {l.tam}:</b> {l.motivo}</div>
                ))}
              </div>

              {(d.novas_no_full > 0 || d.ocultas > 0) && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: C.suave, lineHeight: 1.6 }}>
                  {d.novas_no_full > 0 && <div><b style={{ color: '#9a5b00' }}>{d.novas_no_full} cor(es) que ainda não estão no Full</b> entraram como recomendação de estreia.</div>}
                  {d.ocultas > 0 && <div>{d.ocultas} linha(s) ocultas: cor parada no Full e fora do ranking de vendas{d.ocultas_exemplo?.length ? ` (${d.ocultas_exemplo.join(' · ')}${d.ocultas > 6 ? '…' : ''})` : ''}.</div>}
                </div>
              )}
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.borda}`, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: C.navy }}>{total} peças</div>
                <div style={{ flex: 1 }} />
                <button onClick={() => acao('fora_da_semana')} disabled={!!salvando}
                  style={{ padding: '11px 16px', borderRadius: 10, border: `1px solid ${C.borda}`, background: '#fff', color: C.suave, fontFamily: F, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {salvando === 'fora_da_semana' ? 'salvando…' : 'Não incluir esta semana'}
                </button>
                <button onClick={() => acao('confirmar')} disabled={!!salvando || !total}
                  style={{ padding: '11px 20px', borderRadius: 10, border: 'none', background: total ? C.navy : '#c8c0b6', color: '#fff', fontFamily: F, fontWeight: 800, fontSize: 13.5, cursor: total ? 'pointer' : 'default' }}>
                  {salvando === 'confirmar' ? 'salvando…' : 'Confirmar pra semana'}
                </button>
              </div>
              <div style={{ fontSize: 11, color: C.suave, marginTop: 8 }}>
                A confirmação vale por 72 horas. Depois disso, ou assim que o envio for gerado, a referência volta a mostrar a sugestão automática.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
