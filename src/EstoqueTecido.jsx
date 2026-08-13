/**
 * EstoqueTecido.jsx — Estoque de tecido da Sala de Corte (Ailson 13/08/2026)
 *
 * Desenho combinado: cards por tecido; cada card lista as cores com bolinha,
 * rolos e a metragem que isso representa; entrada de rolos em poucos toques
 * (o funcionário lança pelo celular); log de quem mexeu, quanto tinha e
 * quanto ficou; só admin tira, ajusta, arquiva ou exclui.
 * Cores vêm da MESMA fonte da ordem de corte (ranking + cores manuais).
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { listarCoresManuais, adicionarCorManual } from './cores-manuais.js';

const FONT = "'Calibri','Segoe UI',sans-serif";
const C = {
  ink: '#2c3e50', inkSoft: '#5a6b7d', inkMuted: '#8a9aa8',
  bege: '#e8dfd0', begeSoft: '#f6f1e8', fundo: '#fbf9f5',
  azul: '#4a7fa5', azulSoft: '#e3edf5', ok: '#1f7a48', okSoft: '#e6f4ec',
  alerta: '#8a6a1a', alertaSoft: '#f7ecd0', erro: '#a33',
};

const CORES_FALLBACK = [
  { nome: 'Preto', hex: '#1a1a1a' }, { nome: 'Bege', hex: '#d4c4a4' },
  { nome: 'Marrom', hex: '#5c3a20' }, { nome: 'Figo', hex: '#6b3a4c' },
  { nome: 'Azul Marinho', hex: '#1c2e4a' }, { nome: 'Caramelo', hex: '#a8743b' },
  { nome: 'Branco', hex: '#f5f0e8' }, { nome: 'Verde Sálvia', hex: '#a3b899' },
  { nome: 'Rosa', hex: '#d9b4d3' }, { nome: 'Amarelo', hex: '#ede72e' },
  { nome: 'Bege Claro', hex: '#ebdcc0' },
];

function coresDaOrdemDeCorte() {
  try {
    const raw = localStorage.getItem('amica_bling_cores_top');
    const lista = raw ? (JSON.parse(raw)?.cores || []) : [];
    if (lista.length) return lista;
  } catch { /* usa o fallback */ }
  return CORES_FALLBACK;
}

export default function EstoqueTecido({ usuarioLogado, onVoltar }) {
  const usuario = usuarioLogado?.usuario || usuarioLogado?.nome || 'desconhecido';
  const isAdmin = usuarioLogado?.admin === true;

  const [tecidos, setTecidos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null);       // tecido_id expandido
  const [modal, setModal] = useState(null);          // {tipo, ...}
  const [tela, setTela] = useState('cards');         // cards | log
  const [logs, setLogs] = useState([]);
  const [coresPre, setCoresPre] = useState(CORES_FALLBACK);
  const [salvando, setSalvando] = useState(false);

  const api = useCallback(async (metodo, corpo, query = '') => {
    const r = await fetch(`/api/tecidos${query}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'X-User': usuario },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }, [usuario]);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const j = await api('GET', null, '?acao=listar');
      setTecidos(j.tecidos || []);
    } catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  }, [api]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    (async () => {
      const manuais = await listarCoresManuais().catch(() => []);
      const base = coresDaOrdemDeCorte();
      const mapa = new Map();
      [...base, ...(manuais || [])].forEach(c => { if (c?.nome) mapa.set(c.nome, { nome: c.nome, hex: c.hex || '#ccc' }); });
      setCoresPre([...mapa.values()]);
    })();
  }, []);

  const abrirLog = async (tecidoId = null) => {
    setTela('log');
    try {
      const j = await api('GET', null, `?acao=log${tecidoId ? `&tecido_id=${tecidoId}` : ''}`);
      setLogs(j.movimentos || []);
    } catch (e) { setErro(e.message); }
  };

  const acao = async (corpo) => {
    setSalvando(true);
    try { await api('POST', corpo); setModal(null); await carregar(); }
    catch (e) { setErro(e.message); alert(e.message); }
    finally { setSalvando(false); }
  };

  // ── estilos base (números grandes, toque fácil) ──
  const btn = (cor = C.azul) => ({
    padding: '12px 16px', borderRadius: 11, border: 'none', background: cor, color: '#fff',
    fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
  });
  const btnLeve = {
    padding: '10px 14px', borderRadius: 11, border: `1px solid ${C.bege}`, background: '#fff',
    color: C.inkSoft, fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
  };

  if (tela === 'log') {
    return (
      <div style={{ fontFamily: FONT, background: C.fundo, minHeight: '100vh', padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button onClick={() => setTela('cards')} style={btnLeve}>← Voltar</button>
          <h2 style={{ margin: 0, fontSize: 19, color: C.ink }}>📜 Movimentações</h2>
        </div>
        <div style={{ background: '#fff', border: `1px solid ${C.bege}`, borderRadius: 13, overflow: 'hidden' }}>
          {logs.length === 0 && <div style={{ padding: 16, color: C.inkMuted }}>Nada registrado ainda.</div>}
          {logs.map((m, i) => (
            <div key={m.id} style={{ padding: '11px 13px', background: i % 2 ? C.begeSoft : '#fff', display: 'flex', gap: 10, alignItems: 'center' }}>
              <div style={{ fontSize: 20, width: 26, textAlign: 'center' }}>
                {m.tipo === 'entrada' ? '➕' : m.tipo === 'saida_corte' ? '✂️' : m.tipo === 'estorno_corte' ? '↩️' : m.tipo === 'conferencia' ? '📋' : '⚙️'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: C.ink }}>
                  {m.tecido_nome} · {m.cor_nome}
                  <span style={{ color: Number(m.rolos) >= 0 ? C.ok : C.erro, marginLeft: 8 }}>
                    {Number(m.rolos) > 0 ? '+' : ''}{Number(m.rolos)} rolo(s)
                  </span>
                </div>
                <div style={{ fontSize: 12, color: C.inkMuted }}>
                  {Number(m.rolos_antes)} → <b>{Number(m.rolos_depois)}</b> · {m.usuario} · {new Date(m.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {m.motivo ? ` · ${m.motivo}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, background: C.fundo, minHeight: '100vh', padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        {onVoltar && <button onClick={onVoltar} style={btnLeve}>←</button>}
        <h2 style={{ margin: 0, fontSize: 20, color: C.ink, flex: 1 }}>🧵 Estoque de tecido</h2>
        <button onClick={() => abrirLog()} style={btnLeve}>📜 Log</button>
        {isAdmin && <button onClick={() => setModal({ tipo: 'novo_tecido', nome: '', metragem: 50 })} style={btn()}>+ Tecido</button>}
      </div>
      <div style={{ fontSize: 12.5, color: C.inkMuted, marginBottom: 14 }}>
        A baixa acontece quando a ordem vai pra sala — e volta pro estoque se a ordem sair de lá.
      </div>

      {erro && <div style={{ background: '#fdecea', color: C.erro, padding: 11, borderRadius: 10, marginBottom: 12, fontSize: 13.5 }}>{erro}</div>}
      {carregando && <div style={{ color: C.inkMuted }}>Carregando…</div>}

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {tecidos.map(t => {
          const totalRolos = (t.cores || []).reduce((s, c) => s + Number(c.rolos || 0), 0);
          const totalRes = (t.cores || []).reduce((s, c) => s + Number(c.reservado || 0), 0);
          const expandido = aberto === t.id;
          return (
            <div key={t.id} style={{ background: '#fff', border: `1px solid ${C.bege}`, borderRadius: 14, overflow: 'hidden' }}>
              <div onClick={() => setAberto(expandido ? null : t.id)}
                style={{ padding: 14, cursor: 'pointer', background: C.begeSoft, borderBottom: expandido ? `1px solid ${C.bege}` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, flex: 1 }}>{t.nome}</div>
                  <div style={{ fontSize: 12, color: C.inkMuted }}>{expandido ? '▲' : '▼'}</div>
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <div><span style={{ fontSize: 26, fontWeight: 800, color: C.ink }}>{totalRolos}</span>
                    <span style={{ fontSize: 13, color: C.inkSoft }}> rolos</span></div>
                  <div style={{ fontSize: 15, color: C.inkSoft, fontWeight: 700 }}>
                    {(totalRolos * Number(t.metragem_rolo || 50)).toLocaleString('pt-BR')} m
                  </div>
                  {totalRes > 0 && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.alerta, background: C.alertaSoft, padding: '3px 9px', borderRadius: 999 }}>
                      {totalRes} reservados
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: C.inkMuted, marginTop: 4 }}>rolo de {Number(t.metragem_rolo || 50)} m · {(t.cores || []).length} cor(es)</div>
              </div>

              {expandido && (
                <div>
                  {(t.cores || []).map((c, i) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 13px', background: i % 2 ? C.begeSoft : '#fff' }}>
                      <div style={{ width: 22, height: 22, borderRadius: '50%', background: c.hex || '#ccc', border: '1px solid rgba(0,0,0,.15)', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{c.nome}</div>
                        <div style={{ fontSize: 12, color: C.inkMuted }}>
                          {(Number(c.rolos) * Number(t.metragem_rolo || 50)).toLocaleString('pt-BR')} m
                          {Number(c.reservado) > 0 ? ` · ${c.reservado} reservado(s)` : ''}
                        </div>
                      </div>
                      <button onClick={() => setModal({ tipo: 'entrada', tecido: t, cor: c, rolos: '', digitando: true })}
                        title="Tocar pra digitar a quantidade"
                        style={{ fontSize: 22, fontWeight: 800, color: Number(c.rolos) > 0 ? C.ink : C.inkMuted, minWidth: 46, textAlign: 'right',
                          background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, padding: '4px 2px' }}>{Number(c.rolos)}</button>
                      <button onClick={() => setModal({ tipo: 'entrada', tecido: t, cor: c, rolos: 1 })}
                        style={{ ...btn(C.ok), padding: '10px 14px', fontSize: 18, lineHeight: 1 }}>+</button>
                      {isAdmin && (
                        <button onClick={() => setModal({ tipo: 'admin_cor', tecido: t, cor: c, rolos: 1, contado: Number(c.rolos) })}
                          style={{ ...btnLeve, padding: '10px 11px' }}>⋯</button>
                      )}
                    </div>
                  ))}

                  <div style={{ padding: 12, display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: `1px solid ${C.bege}` }}>
                    <button onClick={() => setModal({ tipo: 'add_cor', tecido: t, nome: '', hex: '#cccccc' })} style={btnLeve}>+ Cor</button>
                    <button onClick={() => abrirLog(t.id)} style={btnLeve}>📜 Log</button>
                    {isAdmin && <button onClick={() => setModal({ tipo: 'metragem', tecido: t, metragem: Number(t.metragem_rolo || 50) })} style={btnLeve}>📏 Metragem do rolo</button>}
                    {isAdmin && <button onClick={() => acao({ acao: 'arquivar', tecido_id: t.id, arquivar: true })} style={btnLeve}>📦 Arquivar</button>}
                    {isAdmin && <button onClick={() => { if (window.confirm(`Excluir "${t.nome}" e todas as cores? Não dá pra desfazer.`)) acao({ acao: 'excluir', tecido_id: t.id }); }}
                      style={{ ...btnLeve, color: C.erro }}>🗑 Excluir</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!carregando && !tecidos.length && (
        <div style={{ background: '#fff', border: `1px dashed ${C.bege}`, borderRadius: 13, padding: 24, textAlign: 'center', color: C.inkMuted }}>
          Nenhum tecido ainda. {isAdmin ? 'Toque em "+ Tecido" pra criar o primeiro.' : 'Peça pro admin criar.'}
        </div>
      )}

      {/* ─────────── modais ─────────── */}
      {modal && (
        <div onClick={() => !salvando && setModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(20,25,35,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 90 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 18, width: '100%', maxWidth: 420 }}>

            {modal.tipo === 'novo_tecido' && (
              <>
                <h3 style={{ margin: '0 0 12px', fontSize: 18, color: C.ink }}>Novo tecido</h3>
                <input autoFocus value={modal.nome} onChange={e => setModal({ ...modal, nome: e.target.value })}
                  placeholder="Ex: Linho s/ elastano"
                  style={{ width: '100%', boxSizing: 'border-box', padding: 13, fontSize: 16, borderRadius: 11, border: `1px solid ${C.bege}`, fontFamily: FONT, marginBottom: 10 }} />
                <label style={{ fontSize: 13, color: C.inkSoft }}>Metragem padrão do rolo</label>
                <input type="number" inputMode="decimal" value={modal.metragem} onChange={e => setModal({ ...modal, metragem: e.target.value })}
                  style={{ width: '100%', boxSizing: 'border-box', padding: 13, fontSize: 18, fontWeight: 700, borderRadius: 11, border: `1px solid ${C.bege}`, fontFamily: FONT, marginBottom: 14 }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModal(null)} style={btnLeve}>Cancelar</button>
                  <button disabled={salvando || !modal.nome.trim()} onClick={() => acao({ acao: 'criar_tecido', nome: modal.nome, metragem_rolo: modal.metragem })} style={btn()}>Criar</button>
                </div>
              </>
            )}

            {modal.tipo === 'add_cor' && (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: 18, color: C.ink }}>Cores · {modal.tecido.nome}</h3>
                <div style={{ fontSize: 12.5, color: C.inkMuted, marginBottom: 12 }}>As mesmas cores da ordem de corte — toque pra adicionar.</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, maxHeight: 260, overflowY: 'auto', marginBottom: 14 }}>
                  {coresPre.filter(cp => !(modal.tecido.cores || []).some(c => c.nome === cp.nome)).map(cp => (
                    <button key={cp.nome} disabled={salvando}
                      onClick={() => acao({ acao: 'add_cor', tecido_id: modal.tecido.id, nome: cp.nome, hex: cp.hex })}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 12px', borderRadius: 999, border: `1px solid ${C.bege}`, background: '#fff', cursor: 'pointer', fontFamily: FONT, fontSize: 14 }}>
                      <span style={{ width: 16, height: 16, borderRadius: '50%', background: cp.hex, border: '1px solid rgba(0,0,0,.15)' }} />
                      {cp.nome}
                    </button>
                  ))}
                </div>
                <div style={{ borderTop: `1px solid ${C.bege}`, paddingTop: 12 }}>
                  <div style={{ fontSize: 13, color: C.inkSoft, marginBottom: 7 }}>Não está na lista? Crie:</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={modal.nome} onChange={e => setModal({ ...modal, nome: e.target.value })} placeholder="Nome da cor"
                      style={{ flex: 1, padding: 12, fontSize: 15, borderRadius: 11, border: `1px solid ${C.bege}`, fontFamily: FONT }} />
                    <input type="color" value={modal.hex} onChange={e => setModal({ ...modal, hex: e.target.value })}
                      style={{ width: 52, height: 46, border: `1px solid ${C.bege}`, borderRadius: 11, background: '#fff' }} />
                    <button disabled={salvando || !modal.nome.trim()}
                      onClick={async () => { await adicionarCorManual(modal.nome.trim(), modal.hex).catch(() => {}); acao({ acao: 'add_cor', tecido_id: modal.tecido.id, nome: modal.nome.trim(), hex: modal.hex }); }}
                      style={btn()}>Criar</button>
                  </div>
                </div>
              </>
            )}

            {modal.tipo === 'entrada' && (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: 18, color: C.ink }}>Acrescentar rolos</h3>
                <div style={{ fontSize: 14, color: C.inkSoft, marginBottom: 14 }}>
                  {modal.tecido.nome} · <b>{modal.cor.nome}</b> — tem {Number(modal.cor.rolos)} rolo(s)
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center', marginBottom: 8 }}>
                  <button onClick={() => setModal({ ...modal, rolos: Math.max(1, (Number(modal.rolos) || 0) - 1) })} style={{ ...btn(C.azul), fontSize: 26, padding: '10px 20px' }}>−</button>
                  <input type="number" inputMode="numeric" min="1" autoFocus={modal.digitando}
                    value={modal.rolos} placeholder="0"
                    onFocus={e => e.target.select()}
                    onChange={e => setModal({ ...modal, rolos: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter' && Number(modal.rolos) > 0 && !salvando) acao({ acao: 'entrada', cor_id: modal.cor.id, rolos: modal.rolos }); }}
                    style={{ width: 116, textAlign: 'center', padding: 12, fontSize: 32, fontWeight: 800, borderRadius: 12,
                      border: `2px solid ${C.azul}`, background: C.azulSoft, fontFamily: FONT, color: C.ink }} />
                  <button onClick={() => setModal({ ...modal, rolos: (Number(modal.rolos) || 0) + 1 })} style={{ ...btn(C.azul), fontSize: 26, padding: '10px 20px' }}>+</button>
                </div>
                <div style={{ textAlign: 'center', fontSize: 13, color: C.inkMuted, marginBottom: 6 }}>toque no número pra digitar</div>
                <div style={{ textAlign: 'center', fontSize: 14, color: C.inkSoft, marginBottom: 16 }}>
                  = {((Number(modal.rolos) || 0) * Number(modal.tecido.metragem_rolo || 50)).toLocaleString('pt-BR')} m · fica com <b>{Number(modal.cor.rolos) + (Number(modal.rolos) || 0)}</b> rolo(s)
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModal(null)} style={btnLeve}>Cancelar</button>
                  <button disabled={salvando || !(Number(modal.rolos) > 0)} onClick={() => acao({ acao: 'entrada', cor_id: modal.cor.id, rolos: modal.rolos })} style={btn(Number(modal.rolos) > 0 ? C.ok : '#c8c0b6')}>
                    {salvando ? 'Salvando…' : 'Acrescentar'}
                  </button>
                </div>
              </>
            )}

            {modal.tipo === 'admin_cor' && (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: 18, color: C.ink }}>{modal.cor.nome}</h3>
                <div style={{ fontSize: 13.5, color: C.inkSoft, marginBottom: 14 }}>{modal.tecido.nome} · {Number(modal.cor.rolos)} rolo(s) em estoque</div>

                <div style={{ background: C.begeSoft, borderRadius: 12, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 8 }}>📋 Conferência física</div>
                  <div style={{ fontSize: 12.5, color: C.inkMuted, marginBottom: 8 }}>Conte os rolos e digite o que existe de verdade — a diferença fica registrada.</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="number" inputMode="numeric" value={modal.contado} onChange={e => setModal({ ...modal, contado: e.target.value })}
                      style={{ width: 110, padding: 12, fontSize: 22, fontWeight: 800, textAlign: 'center', borderRadius: 11, border: `1px solid ${C.bege}`, fontFamily: FONT }} />
                    <button disabled={salvando} onClick={() => acao({ acao: 'conferencia', cor_id: modal.cor.id, contado: modal.contado })} style={btn(C.azul)}>Registrar contagem</button>
                  </div>
                </div>

                <div style={{ background: C.begeSoft, borderRadius: 12, padding: 12, marginBottom: 14 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: C.ink, marginBottom: 8 }}>⚙️ Tirar rolos (baixa manual)</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="number" inputMode="numeric" value={modal.rolos} onChange={e => setModal({ ...modal, rolos: e.target.value })}
                      style={{ width: 90, padding: 12, fontSize: 20, fontWeight: 700, textAlign: 'center', borderRadius: 11, border: `1px solid ${C.bege}`, fontFamily: FONT }} />
                    <input value={modal.motivo || ''} onChange={e => setModal({ ...modal, motivo: e.target.value })} placeholder="Motivo"
                      style={{ flex: 1, padding: 12, fontSize: 14, borderRadius: 11, border: `1px solid ${C.bege}`, fontFamily: FONT }} />
                  </div>
                  <button disabled={salvando || !String(modal.motivo || '').trim()}
                    onClick={() => acao({ acao: 'ajuste', cor_id: modal.cor.id, rolos: -Math.abs(Number(modal.rolos)), motivo: modal.motivo })}
                    style={{ ...btn(C.erro), marginTop: 8, width: '100%' }}>Tirar do estoque</button>
                </div>

                <button onClick={() => setModal(null)} style={{ ...btnLeve, width: '100%' }}>Fechar</button>
              </>
            )}

            {modal.tipo === 'metragem' && (
              <>
                <h3 style={{ margin: '0 0 4px', fontSize: 18, color: C.ink }}>Metragem do rolo</h3>
                <div style={{ fontSize: 13, color: C.inkMuted, marginBottom: 12 }}>Vale pra todas as cores de {modal.tecido.nome}.</div>
                <input type="number" inputMode="decimal" value={modal.metragem} onChange={e => setModal({ ...modal, metragem: e.target.value })}
                  style={{ width: '100%', boxSizing: 'border-box', padding: 13, fontSize: 24, fontWeight: 800, textAlign: 'center', borderRadius: 11, border: `1px solid ${C.bege}`, fontFamily: FONT, marginBottom: 14 }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setModal(null)} style={btnLeve}>Cancelar</button>
                  <button disabled={salvando} onClick={() => acao({ acao: 'editar_tecido', tecido_id: modal.tecido.id, metragem_rolo: modal.metragem })} style={btn()}>Salvar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
