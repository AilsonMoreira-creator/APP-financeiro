/**
 * MLSale.jsx — botão "Sale" do card de produto (Ailson, 19/09/2026)
 *
 * Promoções do Mercado Livre (Exitus) pra REF: lista de anúncios (antigo = 1 linha;
 * formato novo = 1 linha por família com os filhos por baixo), cada um com a foto
 * de capa real, preço, estoque (Full ou depósito), vendas 7 dias e a seta que abre
 * a lista de promoções — ativas primeiro, depois da mais barata pra ele (menor %
 * que sai do bolso do vendedor) pra mais cara.
 *
 * Faixa por REF: dois percentuais (campanhas / relâmpago). Verde quando o % do
 * vendedor no MENOR desconto possível <= faixa (família = média dos filhos).
 * "Visto" apaga o verde daquela promoção; convite novo acende de novo.
 * Entrar: sempre o menor desconto; relâmpago pede a quantidade (faixa do ML).
 */
import { useState, useEffect, useMemo } from 'react';

const F = 'Georgia,serif';
const C = { navy: '#2c3e50', azul: '#4a7fa5', suave: '#6b7c8c', borda: '#e8e2da', ok: '#1f7a48', okBg: '#e9f5ee', alerta: '#8a6500', alertaBg: '#fff8e8', erro: '#a33', erroBg: '#fdecea', cinza: '#9aa5ad', cinzaBg: '#f4f2ee' };
const R$ = (v) => (v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const pct = (v) => (v == null || isNaN(v) ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const dia = (iso) => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
const hora = (iso) => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); };
const periodo = (p) => { const a = dia(p.start_date), b = dia(p.finish_date); if (a && b) return a === b ? `${a} ${hora(p.start_date)}–${hora(p.finish_date)}` : `${a}–${b}`; return a || b || '—'; };
const TIPO = { DEAL: 'Campanha', SMART: 'Smart', LIGHTNING: 'Relâmpago', DOD: 'Oferta do dia', PRICE_DISCOUNT: 'Desconto por preço', PRICE_MATCHING: 'Redução de tarifas', UNHEALTHY_STOCK: 'Full parado', BANK: 'Pix', MARKETPLACE_CAMPAIGN: 'Campanha ML', SELLER_CAMPAIGN: 'Minha campanha', PRE_NEGOTIATED: 'Pré-negociada', VOLUME: 'Volume', SELLER_COUPON_CAMPAIGN: 'Cupom' };
const usuarioLogado = () => { try { return JSON.parse(localStorage.getItem('amica_session') || '{}')?.usuario || ''; } catch { return ''; } };

async function api(path, opts) {
  const r = await fetch(`/api/ml-sale${path}`, { ...(opts || {}), headers: { 'Content-Type': 'application/json', 'X-User': usuarioLogado(), ...((opts && opts.headers) || {}) } });
  return r.json();
}

const CONTAS = [['exitus', 'Exitus'], ['lumia', 'Lumia'], ['muniam', 'Muniam']];

export default function MLSale({ refProduto: refProd, desc, conta: contaInicial = 'exitus', onClose, onMudou }) {
  const [conta, setConta] = useState(contaInicial);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState({});          // chave do grupo -> bool
  const [cfg, setCfg] = useState({ campanha_pct: '', relampago_pct: '' });
  const [salvandoCfg, setSalvandoCfg] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState(null);
  const [confirma, setConfirma] = useState(null);    // {grupo, promo, qtd}
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const mobile = typeof window !== 'undefined' && window.innerWidth < 640;

  const carregar = async (atualizar = false) => {
    setCarregando(true); setErro('');
    try {
      const j = await api(`?ref=${encodeURIComponent(refProd)}&conta=${conta}${atualizar ? '&atualizar=1' : ''}`);
      if (!j.ok) throw new Error(j.erro || 'falha');
      setDados(j);
      setCfg({ campanha_pct: j.config?.campanha_pct ?? '', relampago_pct: j.config?.relampago_pct ?? '' });
      if (!Object.keys(aberto).length && j.grupos?.length === 1) setAberto({ [j.grupos[0].chave]: true });
    } catch (e) { setErro(String(e?.message || e)); }
    setCarregando(false);
  };
  useEffect(() => { carregar(false); /* eslint-disable-next-line */ }, [refProd, conta]);

  const salvarCfg = async () => {
    setSalvandoCfg(true);
    const j = await api('', { method: 'POST', body: JSON.stringify({ acao: 'config', ref: refProd, campanha_pct: cfg.campanha_pct, relampago_pct: cfg.relampago_pct }) });
    setSalvandoCfg(false);
    if (j.ok) { await carregar(false); onMudou && onMudou(); } else setAviso(j.erro || 'não salvou');
  };

  const marcarVisto = async (g, p) => {
    const j = await api('', { method: 'POST', body: JSON.stringify({ acao: 'visto', conta, ref: refProd, item_ids: p.filhos.map(f => f.item_id), promo_key: p.promo_key, promo_nome: p.nome, tipo: p.tipo, pct: p.seller_pct, family_id: g.family_id }) });
    if (j.ok) { await carregar(false); onMudou && onMudou(); } else setAviso(j.erro || 'não marcou');
  };

  const entrar = async () => {
    if (!confirma) return;
    const { grupo: g, promo: p, qtd } = confirma;
    setEnviando(true);
    // só os filhos convidados (candidate); preço = menor desconto possível
    const itens = p.filhos.filter(f => f.status === 'candidate').map(f => {
      const deal = f.max_price ?? f.price;
      const it = { item_id: f.item_id, deal_price: deal, original_price: f.original_price, pct: f.seller_pct };
      if (p.relampago) it.stock = Math.max(f.stock_min || 1, Math.min(Number(qtd) || f.stock_min || 1, f.stock_max || Number(qtd) || 1));
      return it;
    });
    const j = await api('', { method: 'POST', body: JSON.stringify({ acao: 'entrar', conta, ref: refProd, promo_key: p.promo_key, promo_id: p.promo_id, promo_nome: p.nome, tipo: p.tipo, family_id: g.family_id, itens }) });
    setConfirma(null);
    const okN = (j.resultados || []).filter(x => x.ok).length, errN = (j.resultados || []).length - okN;
    setAviso(j.bloqueado ? `⛔ ${j.erro}` : j.expirado ? `⏳ ${j.erro}` : j.ok ? `Entrou em ${okN} anúncio(s) ✓${j.vencidos?.length ? ` · ${j.vencidos.length} convite(s) já tinha(m) expirado` : ''}` : `${okN} ok · ${errN} recusado(s) pelo ML — veja o log`);
    await carregar(true); onMudou && onMudou();
    setEnviando(false);
  };

  const abrirLog = async () => { setLogOpen(true); const j = await api(`?log=1&ref=${encodeURIComponent(refProd)}`); setLog(j.log || []); };

  const grupos = dados?.grupos || [];
  const temVerde = grupos.some(g => g.verde_campanha || g.verde_relampago);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(44,62,80,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: mobile ? 8 : 20, zIndex: 210, backdropFilter: 'blur(3px)' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 1040, maxHeight: '92vh', overflow: 'auto', fontFamily: F, boxShadow: '0 20px 50px rgba(0,0,0,.35)' }}>

        {/* cabeçalho + faixa */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.borda}`, background: '#faf8f5', position: 'sticky', top: 0, zIndex: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.azul, fontWeight: 700, letterSpacing: .4 }}>REF {refProd} · {conta.toUpperCase()}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.navy, marginTop: 2 }}>Sale · promoções do Mercado Livre</div>
              <div style={{ fontSize: 11.5, color: C.suave, marginTop: 3 }}>{desc}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                {CONTAS.map(([k, n]) => <button key={k} onClick={() => { setConta(k); setAberto({}); }} style={{ ...btn(conta === k), padding: '4px 10px' }}>{n}</button>)}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => carregar(true)} disabled={carregando} title="Reler anúncios e promoções no Mercado Livre" style={btn()}>↻ atualizar</button>
              <button onClick={abrirLog} style={btn()}>☰ log</button>
              <button onClick={onClose} style={btn()}>✕</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, color: C.suave }}>Acender quando o <b>meu %</b> for até:</span>
            <label style={{ fontSize: 11.5, color: C.navy, display: 'flex', alignItems: 'center', gap: 5 }}>Campanhas
              <input value={cfg.campanha_pct} onChange={e => setCfg(c => ({ ...c, campanha_pct: e.target.value.replace(',', '.') }))} inputMode="decimal" placeholder={String(dados?.faixa?.padrao ? 6 : (dados?.faixa?.campanha_pct ?? 6))} style={inp()} />%
            </label>
            <label style={{ fontSize: 11.5, color: C.navy, display: 'flex', alignItems: 'center', gap: 5 }}>⚡ Relâmpago
              <input value={cfg.relampago_pct} onChange={e => setCfg(c => ({ ...c, relampago_pct: e.target.value.replace(',', '.') }))} inputMode="decimal" placeholder={String(dados?.faixa?.padrao ? 10 : (dados?.faixa?.relampago_pct ?? 10))} style={inp()} />%
            </label>
            <button onClick={salvarCfg} disabled={salvandoCfg} style={btn(true)}>{salvandoCfg ? 'salvando…' : 'salvar faixa'}</button>
            {dados?.faixa?.padrao && <span style={{ fontSize: 10.5, color: C.cinza }}>padrão 6% / 10% (vazio = padrão)</span>}
            <span style={{ fontSize: 10.5, color: C.erro }}>teto: campanhas 7% · relâmpago 12% (ninguém passa)</span>
            {!dados?.submete && dados && <span style={{ fontSize: 10.5, color: C.alerta }}>só consulta nesta conta (submeter: Exitus)</span>}
            {temVerde && <span style={{ fontSize: 11, color: C.ok, background: C.okBg, padding: '3px 8px', borderRadius: 999, fontWeight: 700 }}>● tem promoção dentro da faixa</span>}
          </div>
          {aviso && <div style={{ marginTop: 8, fontSize: 12, color: C.navy, background: C.alertaBg, border: `1px solid #efd9a0`, borderRadius: 8, padding: '6px 10px', display: 'flex', justifyContent: 'space-between' }}><span>{aviso}</span><button onClick={() => setAviso('')} style={{ ...btn(), padding: '0 6px' }}>✕</button></div>}
        </div>

        <div style={{ padding: mobile ? '10px 10px 16px' : '14px 18px 20px' }}>
          {carregando && <div style={{ color: C.suave, fontSize: 13, padding: 20, textAlign: 'center' }}>Consultando o Mercado Livre…</div>}
          {erro && <div style={{ color: C.erro, fontSize: 13, padding: 12, background: C.erroBg, borderRadius: 8 }}>{erro}</div>}
          {!carregando && !erro && !grupos.length && <div style={{ color: C.suave, fontSize: 13, padding: 20, textAlign: 'center' }}>Nenhum anúncio da REF {refProd} encontrado na {conta}. Confira o mapeamento SKU × canal.</div>}

          {grupos.map(g => {
            const open = !!aberto[g.chave];
            const verde = g.verde_campanha || g.verde_relampago;
            const vermelho = g.vermelho;
            return (
              <div key={g.chave} style={{ border: `1px solid ${vermelho ? '#e3a3a3' : verde ? '#9fd3b4' : C.borda}`, borderRadius: 12, marginBottom: 12, overflow: 'hidden', background: vermelho ? '#fdf5f5' : verde ? '#f6fbf8' : '#fff' }}>
                {/* card do anúncio */}
                <div onClick={() => setAberto(a => ({ ...a, [g.chave]: !open }))} style={{ display: 'flex', gap: 12, padding: 12, cursor: 'pointer', alignItems: 'center' }}>
                  <div style={{ width: mobile ? 56 : 72, height: mobile ? 72 : 92, borderRadius: 8, background: C.cinzaBg, flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {g.capa ? <img src={g.capa} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} /> : <span style={{ fontSize: 22, color: C.cinza }}>👗</span>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, lineHeight: 1.25 }}>{g.titulo}</div>
                    <div style={{ fontSize: 11, color: C.suave, marginTop: 3 }}>
                      {g.formato === 'novo' ? `família · ${g.filhos.length} anúncios (cor/tamanho)` : g.filhos[0]?.item_id}
                      {g.status !== 'active' && <span style={{ color: C.erro }}> · {g.status}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, fontSize: 11.5 }}>
                      <span style={chip()}>{R$(g.preco)}</span>
                      <span style={chip(g.full ? C.okBg : C.cinzaBg, g.full ? C.ok : C.navy)}>{g.full ? `▣ Full · ${g.full_qtd || g.estoque} un.` : `⌂ Depósito · ${g.estoque} un.`}</span>
                      <span style={chip()}>7 dias: <b>{g.vendas_7d}</b> venda{g.vendas_7d === 1 ? '' : 's'}</span>
                      <span style={chip(g.n_ativas ? '#eef3f8' : C.cinzaBg, g.n_ativas ? C.azul : C.suave)}>{g.n_ativas} ativa{g.n_ativas === 1 ? '' : 's'}</span>
                      {vermelho && <span style={chip(C.erroBg, C.erro)}>⛔ ativa acima do teto</span>}
                      {g.verde_campanha && <span style={chip(C.okBg, C.ok)}>● campanha na faixa</span>}
                      {g.verde_relampago && <span style={chip(C.okBg, C.ok)}>⚡ relâmpago na faixa</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 18, color: C.azul, padding: '0 4px', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>⌄</div>
                </div>

                {/* promoções */}
                {open && (
                  <div style={{ borderTop: `1px solid ${C.borda}`, background: '#fff' }}>
                    {!g.promocoes.length && <div style={{ padding: 14, fontSize: 12.5, color: C.suave }}>Sem promoções disponíveis pra este anúncio agora.</div>}
                    {!!g.promocoes.length && (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
                          <thead>
                            <tr style={{ color: C.suave, fontSize: 11, textAlign: 'left' }}>
                              <th style={th()}>Promoção</th><th style={th()}>Período</th><th style={th()}>Desconto</th><th style={th()}>Preço</th><th style={th()}>Meli</th><th style={th()}>Meu %</th><th style={th()}>Anúncios</th><th style={th()}>Ação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.promocoes.map(p => {
                              const total = (p.seller_pct || 0) + (p.meli_pct || 0);
                              const cand = p.filhos.filter(f => f.status === 'candidate').length;
                              const ativos = p.filhos.filter(f => ['started', 'active', 'pending', 'programmed'].includes(f.status)).length;
                              const enviados = p.filhos.filter(f => f.status === 'enviado').length;
                              const linhaVerde = p.verde;
                              return (
                                <tr key={p.promo_key} style={{ borderTop: `1px solid ${C.borda}`, background: p.vermelho ? '#fbeaea' : linhaVerde ? '#eef8f1' : p.ativa ? '#fbfaf7' : 'transparent' }}>
                                  <td style={td()}>
                                    <div style={{ fontWeight: 700, color: C.navy }}>{p.nome || TIPO[p.tipo] || p.tipo}</div>
                                    <div style={{ fontSize: 10.5, color: C.suave }}>{TIPO[p.tipo] || p.tipo}{ativos ? <span style={{ color: C.ok, fontWeight: 700 }}> · ATIVA</span> : ''}{enviados && !ativos ? <span style={{ color: C.azul, fontWeight: 700 }}> · ENVIADO ✓ (aguardando o ML)</span> : ''}{p.visto && !p.ativa ? <span style={{ color: C.cinza }}> · visto</span> : ''}{p.sem_campanha ? <span style={{ color: C.alerta }}> · sem campanha</span> : ''}</div>
                                  </td>
                                  <td style={td()}>{p.relampago && p.start_date && !p.ativa ? <div>publica <b>{dia(p.start_date)} {hora(p.start_date)}</b>{p.finish_date ? <span style={{ color: C.suave }}> até {hora(p.finish_date)}</span> : null}</div> : periodo(p)}{p.relampago && !p.start_date ? <div style={{ fontSize: 10.5, color: C.suave }}>data: o ML define ao aceitar</div> : null}{p.deadline_date && !p.ativa ? <div style={{ fontSize: 10.5, color: C.alerta }}>aceite até {dia(p.deadline_date)}</div> : null}</td>
                                  <td style={td()}>{pct(total)}</td>
                                  <td style={td()}>{R$(p.price)}</td>
                                  <td style={td()}>{p.meli_pct ? pct(p.meli_pct) : '—'}</td>
                                  <td style={{ ...td(), fontWeight: 700, color: p.acima_teto ? C.erro : linhaVerde ? C.ok : C.navy }}>{pct(p.seller_pct)}{p.acima_teto ? <div style={{ fontSize: 10, color: C.erro, fontWeight: 400 }}>acima do teto {p.teto}%</div> : null}{p.n_filhos > 1 ? <div style={{ fontSize: 10, color: C.suave, fontWeight: 400 }}>média de {p.n_filhos}</div> : null}</td>
                                  <td style={td()}>{ativos ? <span style={{ color: C.ok }}>{ativos} ativo{ativos > 1 ? 's' : ''}</span> : null}{enviados ? <span style={{ color: C.azul }}>{ativos ? ' · ' : ''}{enviados} enviado{enviados > 1 ? 's' : ''}</span> : null}{(ativos || enviados) && cand ? ' · ' : ''}{cand ? <span>{cand} convidado{cand > 1 ? 's' : ''}</span> : null}{!ativos && !cand && !enviados ? '—' : ''}</td>
                                  <td style={td()}>
                                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                      {cand > 0 && dados?.submete && !p.acima_teto && (
                                        <button disabled={enviando} onClick={() => setConfirma({ grupo: g, promo: p, qtd: p.filhos.find(f => f.status === 'candidate')?.stock_min || 5 })} style={{ ...btn(true), opacity: enviando ? .5 : 1 }}>{p.relampago ? '⚡ ' : ''}Participar</button>
                                      )}
                                      {cand > 0 && p.acima_teto && <span style={{ fontSize: 10.5, color: C.erro, alignSelf: 'center' }}>⛔ acima do teto</span>}
                                      {((cand > 0 && !p.visto && !p.ativa) || p.vermelho) && <button onClick={() => marcarVisto(g, p)} title={p.vermelho ? 'Já vi que está ativa acima do teto — apaga o vermelho' : 'Já vi, não quero entrar — apaga o verde desta promoção'} style={btn()}>Visto</button>}
                                      {p.relampago && cand > 0 && <span style={{ fontSize: 10.5, color: C.suave, alignSelf: 'center' }}>qtd mín {p.filhos.find(f => f.status === 'candidate')?.stock_min ?? '—'}</span>}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {g.formato === 'novo' && (
                      <details style={{ padding: '6px 12px 12px', fontSize: 11.5, color: C.suave }}>
                        <summary style={{ cursor: 'pointer' }}>ver os {g.filhos.length} anúncios da família</summary>
                        <div style={{ display: 'grid', gridTemplateColumns: mobile ? '1fr' : '1fr 1fr', gap: '4px 14px', marginTop: 6 }}>
                          {g.filhos.map(f => <div key={f.item_id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>{f.thumbnail && <img src={f.thumbnail} alt="" loading="lazy" style={{ width: 22, height: 28, objectFit: 'cover', borderRadius: 3 }} />}<span style={{ color: f.status === 'active' ? C.navy : C.cinza }}>{f.title.replace(g.titulo, '').trim() || f.title}</span><span>· {f.available_quantity} un. · 7d {f.vendas_7d}</span><span style={{ color: C.cinza }}>{f.item_id}</span></div>)}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {dados?.lido_em && <div style={{ fontSize: 10.5, color: C.cinza, textAlign: 'right' }}>lido {new Date(dados.lido_em).toLocaleString('pt-BR')}</div>}
        </div>

        {/* confirmação de entrada */}
        {confirma && (
          <div onClick={() => !enviando && setConfirma(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 220, padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 18, maxWidth: 440, width: '100%', fontFamily: F }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>{confirma.promo.relampago ? '⚡ Oferta relâmpago' : 'Entrar na promoção'}</div>
              <div style={{ fontSize: 12.5, color: C.suave, marginTop: 4 }}>{confirma.promo.nome || TIPO[confirma.promo.tipo]} · {periodo(confirma.promo)}</div>
              {confirma.promo.sem_campanha && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: '#7a4a00', background: C.alertaBg, border: '1px solid #efd9a0', borderRadius: 8, padding: '8px 10px', lineHeight: 1.45 }}>
                  <b>Atenção:</b> isto é só um <b>desconto no preço</b> do anúncio. Não entra em nenhuma campanha do Mercado Livre, não ganha destaque nem selo, não tem cofinanciamento e não tem data pra acabar — fica até vc tirar.
                </div>
              )}
              <div style={{ fontSize: 12.5, color: C.navy, marginTop: 10, lineHeight: 1.5 }}>
                {confirma.promo.filhos.filter(f => f.status === 'candidate').length} anúncio(s) entram com o <b>menor desconto possível</b>: meu % médio <b>{pct(confirma.promo.seller_pct)}</b>{confirma.promo.meli_pct ? <> + Meli {pct(confirma.promo.meli_pct)}</> : null} → preço médio <b>{R$(confirma.promo.price)}</b>.
              </div>
              {confirma.promo.relampago && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: C.navy }}>
                  Quantidade reservada por anúncio: <input value={confirma.qtd} onChange={e => setConfirma(c => ({ ...c, qtd: e.target.value.replace(/\D/g, '') }))} inputMode="numeric" style={{ ...inp(), width: 60 }} />
                  <div style={{ fontSize: 10.5, color: C.suave, marginTop: 4 }}>Fica dentro da faixa do ML de cada anúncio (mín/máx). Depois de ativa, a relâmpago não pode ser removida.</div>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                <button onClick={() => setConfirma(null)} disabled={enviando} style={btn()}>cancelar</button>
                <button onClick={entrar} disabled={enviando} style={btn(true)}>{enviando ? 'enviando…' : 'confirmar e enviar ao ML'}</button>
              </div>
            </div>
          </div>
        )}

        {/* log */}
        {logOpen && (
          <div onClick={() => setLogOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 220, padding: 16 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 16, maxWidth: 640, width: '100%', maxHeight: '80vh', overflow: 'auto', fontFamily: F }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ fontSize: 15, fontWeight: 700, color: C.navy }}>Log · REF {refProd}</div><button onClick={() => setLogOpen(false)} style={btn()}>✕</button></div>
              {!log && <div style={{ color: C.suave, fontSize: 12.5, marginTop: 10 }}>carregando…</div>}
              {log && !log.length && <div style={{ color: C.suave, fontSize: 12.5, marginTop: 10 }}>Nada registrado ainda.</div>}
              {log && log.map(l => (
                <div key={l.id} style={{ borderTop: `1px solid ${C.borda}`, padding: '8px 0', fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 700, color: l.acao === 'entrou' ? C.ok : (l.acao === 'erro' || l.acao === 'bloqueado') ? C.erro : C.navy }}>{{ entrou: 'Entrou', visto: 'Visto', erro: 'Recusado pelo ML', bloqueado: 'Bloqueado pelo teto', config: 'Faixa alterada' }[l.acao] || l.acao}</span>
                    <span style={{ color: C.suave }}>{new Date(l.criado_em).toLocaleString('pt-BR')} · {l.usuario || '—'}</span>
                  </div>
                  <div style={{ color: C.navy }}>{l.promo_nome || TIPO[l.tipo] || l.promo_key || ''}{l.item_id ? ` · ${l.item_id}` : ''}{l.pct != null ? ` · ${pct(l.pct)}` : ''}{l.preco != null ? ` · ${R$(l.preco)}` : ''}{l.qtd != null ? ` · ${l.qtd} un.` : ''}</div>
                  {l.acao === 'erro' && <div style={{ color: C.erro, fontSize: 11 }}>{l.detalhe?.motivo || (typeof l.detalhe?.resposta === 'string' ? l.detalhe.resposta : JSON.stringify(l.detalhe?.resposta || '').slice(0, 200))}</div>}
                  {l.acao === 'config' && <div style={{ color: C.suave, fontSize: 11 }}>campanhas {l.detalhe?.campanha_pct ?? '—'}% · relâmpago {l.detalhe?.relampago_pct ?? '—'}%</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function btn(primario) {
  return { background: primario ? C.navy : '#fff', color: primario ? '#fff' : C.navy, border: `1px solid ${primario ? C.navy : '#c8d8e4'}`, borderRadius: 8, padding: '6px 10px', fontSize: 11.5, fontWeight: 700, fontFamily: F, cursor: 'pointer', whiteSpace: 'nowrap' };
}
function inp() { return { width: 52, padding: '4px 6px', border: `1px solid #c8d8e4`, borderRadius: 6, fontFamily: F, fontSize: 12, textAlign: 'center' }; }
function chip(bg = C.cinzaBg, cor = C.navy) { return { background: bg, color: cor, borderRadius: 999, padding: '2px 8px', fontSize: 11, whiteSpace: 'nowrap' }; }
function th() { return { padding: '8px 10px', fontWeight: 700, whiteSpace: 'nowrap' }; }
function td() { return { padding: '8px 10px', verticalAlign: 'top' }; }
