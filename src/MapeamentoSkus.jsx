/**
 * MapeamentoSkus.jsx — "Verificar mapeamento" do card de produto (Ailson 13/08)
 *
 * Mostra, por EMPRESA (Exitus em cima) e por COR, se cada canal ativo tem o
 * vínculo dos tamanhos daquela cor. Sem preço, sem Full (frente separada).
 * Célula = tamanhos vinculados / tamanhos existentes no Bling — assim 3 (plus),
 * 4 (regular) e os 5 da 2361 se ajustam sozinhos.
 */
import { useState, useEffect } from 'react';

const F = 'Georgia,serif';
const C = {
  navy: '#2c3e50', azul: '#4a7fa5', suave: '#6b7c8c', borda: '#e8e2da',
  ok: '#1f7a48', okBg: '#e9f5ee', alerta: '#8a6500', alertaBg: '#fff8e8',
  erro: '#a33', erroBg: '#fdecea', cinza: '#9aa5ad', cinzaBg: '#f4f2ee',
};
const NOME = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

function hexDasCores() {
  // mesma fonte do ranking de cores do módulo Bling
  try {
    const raw = localStorage.getItem('amica_bling_cores_top');
    const lista = raw ? (JSON.parse(raw)?.cores || []) : [];
    const m = {};
    for (const c of lista) if (c?.nome) m[String(c.nome).trim().toLowerCase()] = c.hex || '#ccc';
    return m;
  } catch { return {}; }
}

export default function MapeamentoSkus({ refProduto: refProd, desc, cores, onClose }) {
  const HEX = hexDasCores();
  const bolinha = (nome) => (
    <span style={{ display: 'inline-block', width: 13, height: 13, borderRadius: '50%', marginRight: 7, verticalAlign: -1,
      background: HEX[String(nome).trim().toLowerCase()] || '#d9d3ca', border: '1px solid rgba(0,0,0,.18)' }} />
  );
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [detalhe, setDetalhe] = useState(null); // {empresa, cor, canalId}
  const [todasCores, setTodasCores] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true); setErro('');
      try {
        const q = new URLSearchParams({ ref: refProd });
        if (!todasCores && (cores || []).length) q.set('cores', cores.join(','));
        const r = await fetch(`/api/bling-mapeamento?${q}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
        if (vivo) setDados(j);
      } catch (e) { if (vivo) setErro(e.message); }
      finally { if (vivo) setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [refProd, cores, todasCores]);

  const cel = (p) => {
    if (!p) return { txt: '—', fg: C.cinza, bg: C.cinzaBg };
    // integração por SKU (Convertr/Meluni): o Bling não guarda vínculo
    if (p.por_sku) return { txt: 'n/d', fg: C.cinza, bg: C.cinzaBg };
    if (p.vinculados === 0) return { txt: '✕', fg: C.erro, bg: C.erroBg };
    if (p.sem_id > 0) return { txt: `${p.vinculados}/${p.esperados} ⚠`, fg: C.alerta, bg: C.alertaBg };
    if (p.vinculados < p.esperados) return { txt: `${p.vinculados}/${p.esperados}`, fg: C.alerta, bg: C.alertaBg };
    return { txt: '✓', fg: C.ok, bg: C.okBg };
  };

  const empresas = (dados?.empresas || []).slice().sort((a, b) => {
    const ordem = { exitus: 0, lumia: 1, muniam: 2 };
    return (ordem[a.conta] ?? 9) - (ordem[b.conta] ?? 9);
  });

  // resumo geral
  let buracos = 0, atencao = 0;
  for (const e of empresas) {
    for (const cor of Object.values(e.cores || {})) {
      for (const p of Object.values(cor.por_canal || {})) {
        if (p.vinculados === 0) buracos++;
        else if (p.vinculados < p.esperados || p.sem_id > 0) atencao++;
      }
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(44,62,80,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 210, backdropFilter: 'blur(3px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 940, maxHeight: '90vh', overflow: 'auto', fontFamily: F, boxShadow: '0 20px 50px rgba(0,0,0,.25)' }}>

        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.borda}`, background: '#faf8f5', position: 'sticky', top: 0, zIndex: 2 }}>
          <div style={{ fontSize: 11, color: C.azul, fontWeight: 700, letterSpacing: .4 }}>REF {refProd}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.navy, marginTop: 2 }}>Verificar mapeamento · SKU × canal</div>
          <div style={{ fontSize: 11.5, color: C.suave, marginTop: 4 }}>
            {carregando ? 'Consultando as 3 empresas no Bling…'
              : buracos || atencao
                ? <span><b style={{ color: C.erro }}>{buracos} sem vínculo</b>{atencao ? ` · ${atencao} pra verificar` : ''} · conferido agora</span>
                : 'Mapeamento completo nos canais ativos ✓'}
          </div>
        </div>

        <div style={{ padding: '14px 20px 20px' }}>
          {erro && <div style={{ background: C.erroBg, color: C.erro, padding: 10, borderRadius: 8, fontSize: 12.5, marginBottom: 12 }}>{erro}</div>}
          {carregando && <div style={{ color: C.suave, fontSize: 13, padding: 20, textAlign: 'center' }}>⏳ lendo produtos, variações e vínculos… (leva ~10-20s)</div>}

          {!carregando && empresas.map(emp => (
            <div key={emp.conta} style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: C.navy }}>{NOME[emp.conta] || emp.conta}</div>
                {emp.status === 'ok' && <div style={{ fontSize: 11, color: C.suave }}>{emp.auditadas} SKUs · {emp.canais.length} canais ativos</div>}
              </div>

              {emp.status === 'sem_permissao' && (
                <div style={{ background: C.alertaBg, color: C.alerta, padding: '10px 12px', borderRadius: 8, fontSize: 12.5 }}>
                  Escopo de lojas/integrações ainda não liberado nessa conta do Bling. Assim que marcar, ela aparece aqui sozinha.
                </div>
              )}
              {emp.status === 'sem_produto' && (
                <div style={{ background: C.cinzaBg, color: C.suave, padding: '10px 12px', borderRadius: 8, fontSize: 12.5 }}>
                  Não achei produto com "(ref.{refProd})" no nome nessa conta.
                </div>
              )}
              {emp.status === 'erro' && (
                <div style={{ background: C.erroBg, color: C.erro, padding: '10px 12px', borderRadius: 8, fontSize: 12.5 }}>{emp.erro}</div>
              )}

              {emp.status === 'ok' && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '7px 8px', color: C.suave, fontWeight: 600, borderBottom: `1px solid ${C.borda}` }}>Cor</th>
                        {emp.canais.map(c => (
                          <th key={c.id} style={{ padding: '7px 6px', color: C.suave, fontWeight: 600, borderBottom: `1px solid ${C.borda}`, whiteSpace: 'nowrap' }}>
                            {String(c.nome).replace(/ (Lumia|Exitus|Muniam)/i, '')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.values(emp.cores || {}).map((cor, i) => (
                        <tr key={cor.cor} style={{ background: i % 2 ? '#faf8f5' : '#fff' }}>
                          <td style={{ padding: '8px', fontWeight: 700, color: C.navy, whiteSpace: 'nowrap' }}>
                            {bolinha(cor.cor)}{cor.cor} <span style={{ fontWeight: 400, color: C.suave, fontSize: 11 }}>{cor.tamanhos.length} tam</span>
                          </td>
                          {emp.canais.map(c => {
                            const p = cor.por_canal?.[c.id];
                            const v = cel(p);
                            const aberto = detalhe && detalhe.empresa === emp.conta && detalhe.cor === cor.cor && detalhe.canalId === c.id;
                            return (
                              <td key={c.id} style={{ padding: 4, textAlign: 'center' }}>
                                <button onClick={() => setDetalhe(aberto ? null : { empresa: emp.conta, cor: cor.cor, canalId: c.id })}
                                  style={{ width: '100%', minWidth: 54, padding: '7px 4px', borderRadius: 7, cursor: 'pointer', fontFamily: F, fontSize: 12.5, fontWeight: 700,
                                    border: aberto ? `2px solid ${C.azul}` : '1px solid transparent', background: v.bg, color: v.fg }}>
                                  {v.txt}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {detalhe?.empresa === emp.conta && (() => {
                    const cor = emp.cores?.[detalhe.cor];
                    const p = cor?.por_canal?.[detalhe.canalId];
                    if (!p) return null;
                    return (
                      <div style={{ marginTop: 10, border: `1px solid ${C.borda}`, borderRadius: 10, padding: 12, background: '#fcfbf9' }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.navy, marginBottom: 8 }}>
                          {detalhe.cor} · {p.canal}
                        </div>
                        {p.por_sku && (
                          <div style={{ fontSize: 11.5, color: C.suave, marginBottom: 8 }}>
                            Esse canal puxa estoque direto pelo SKU e não cria registro de vínculo no Bling — por isso não dá pra confirmar por aqui. A confirmação viria pela API do próprio Convertr.
                          </div>
                        )}
                        {p.itens.map(it => (
                          <div key={it.tam} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0', fontSize: 12, borderTop: `1px solid ${C.borda}` }}>
                            <b style={{ width: 34, color: C.navy }}>{it.tam}</b>
                            <span style={{ color: C.suave, fontFamily: 'monospace', fontSize: 11 }}>{it.sku}</span>
                            <span style={{ flex: 1, color: it.ids.length ? C.navy : C.erro, fontFamily: 'monospace', fontSize: 11 }}>
                              {it.ids.length ? it.ids.join(' · ') : (it.vinculos ? '⚠ vínculo sem ID de anúncio' : '✕ sem vínculo')}
                            </span>
                            <span style={{ color: C.suave, fontSize: 11 }}>estoque {it.estoque ?? '—'}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {(emp.cores_ausentes || []).length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: C.erro }}>
                      ✕ Sem essas cores no Bling desta conta: {emp.cores_ausentes.join(' · ')}
                    </div>
                  )}
                  {(emp.canais_ocultos || []).length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: C.suave }}>
                      Fora da matriz (sem nenhum vínculo nesta REF): {emp.canais_ocultos.join(' · ')}
                    </div>
                  )}
                  {(emp.avisos || []).length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11.5, color: C.alerta }}>
                      {emp.avisos.slice(0, 5).map((a, i) => <div key={i}>⚠ {a}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {!carregando && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderTop: `1px solid ${C.borda}`, paddingTop: 12 }}>
              <label style={{ fontSize: 12, color: C.suave, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={todasCores} onChange={e => setTodasCores(e.target.checked)} />
                Ver todas as cores (demora mais)
              </label>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 11, color: C.suave }}>✓ tudo vinculado · n/n parcial · ⚠ sem ID de anúncio · ✕ sem vínculo · n/d integração por SKU (o Bling não registra vínculo)</div>
              <button onClick={onClose} style={{ background: C.navy, color: '#fff', border: 'none', borderRadius: 8, padding: '9px 18px', fontFamily: F, fontWeight: 700, cursor: 'pointer' }}>Fechar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
