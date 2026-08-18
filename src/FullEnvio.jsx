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

export default function FullEnvio({ refProduto, desc, usuario, onClose }) {
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
        const r = await fetch(`/api/full-recomendacao?ref=${encodeURIComponent(refProduto)}`);
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

  return (
    <div onClick={() => onClose?.()} style={{ position: 'fixed', inset: 0, background: 'rgba(44,62,80,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 230, backdropFilter: 'blur(3px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '92vh', overflow: 'auto', fontFamily: F }}>

        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borda}`, background: C.bege, position: 'sticky', top: 0, zIndex: 2 }}>
          <div style={{ fontSize: 11, color: C.azul, fontWeight: 700 }}>REF {refProduto} · ENVIO PARA O FULL</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>{desc || ''}</div>
          <div style={{ fontSize: 11.5, color: C.suave, marginTop: 3 }}>
            {carregando ? 'calculando…'
              : `cobertura de ${d?.regras?.cobertura ?? 14} dias (${d?.regras?.basicas ?? 20} nas básicas) + ${d?.regras?.transito ?? 5} de trânsito`}
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
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: C.azul, color: '#fff' }}>
                      {['Cor', 'Tam', 'Full', 'Fábrica', 'Venda/dia', 'Cobertura', 'Ideal', 'Possível', 'Enviar'].map((h, i) => (
                        <th key={h} style={{ padding: '8px 8px', fontSize: 10, letterSpacing: .5, textTransform: 'uppercase', textAlign: i < 2 ? 'left' : 'right' }}>{h}</th>
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
                          <td style={{ ...cel, color: C.azul, fontWeight: 700 }}>{l.tam}</td>
                          <td style={{ ...cel, textAlign: 'right' }}>{l.estoqueFull}</td>
                          <td style={{ ...cel, textAlign: 'right', color: C.suave }}>{l.estoqueFabrica}</td>
                          <td style={{ ...cel, textAlign: 'right' }}>{l.vendaDia}</td>
                          <td style={{ ...cel, textAlign: 'right', color: baixa ? C.erro : C.suave, fontWeight: baixa ? 700 : 400 }}>
                            {l.cobertura_atual === null ? '—' : `${l.cobertura_atual}d`}
                          </td>
                          <td style={{ ...cel, textAlign: 'right', color: C.suave }}>{l.qtd_ideal || '—'}</td>
                          <td style={{ ...cel, textAlign: 'right' }}>{l.qtd_possivel || '—'}</td>
                          <td style={{ ...cel, textAlign: 'right' }}>
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
