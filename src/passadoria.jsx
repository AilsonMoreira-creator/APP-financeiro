/**
 * passadoria.jsx — Módulo Passadoria do módulo Oficinas (20/08/2026)
 *
 * TODO corte passa pela passadoria depois de pronto. O fluxo:
 *   oficina entrega o corte
 *     → sem caseado: fica disponível pra passadoria (ícone de ferro AMARELO)
 *     → com caseado: só fica disponível quando o CASEADO entregar também
 *   define a passadoria no modal (ícone fica VERDE, vira card na tela)
 *   passadoria entrega (checkbox na tela) → ícone volta VAZADO, mas o
 *   registro de quem passou fica guardado (title do ícone e card na tela).
 *
 * Multi-usuário igual ao Caseado:
 *   - registros: tabela relacional public.oficinas_passadoria (realtime *)
 *   - cadastro de passadorias: amicia_data user_id='passadoria-config'
 *     (seed: Bom Retiro, Eliana, Perla, Guilherme, Silva Teles)
 *
 * Exporta: usePassadoria() (hook), PassadoriaBtnIcone (ícone na linha da
 * lista de cortes), TelaPassadoria (aba) e PassadoriaTabIcon (ícone da aba).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './supabase.js';

const FN = "Calibri,'Segoe UI',Arial,sans-serif";

export function normRef(ref) {
  return String(ref ?? '').replace(/^0+/, '') || '0';
}
function getUsuario() {
  try {
    const s = localStorage.getItem('amica_session');
    if (!s) return 'sistema';
    const u = JSON.parse(s);
    return u.usuario || u.nome || 'sistema';
  } catch { return 'sistema'; }
}

const NOMES_PADRAO = ['Bom Retiro', 'Eliana', 'Perla', 'Guilherme', 'Silva Teles'];

// trilha de auditoria da passadoria (botão Log na tela)
function logAcao(corteId, ref, acao, detalhe) {
  try {
    supabase.from('oficinas_passadoria_log').insert({
      corte_id: corteId ?? null, ref: ref ?? null, acao, detalhe: detalhe ?? null, usuario: getUsuario(),
    }).then(() => {}, () => {});
  } catch { /* log nunca trava o fluxo */ }
}

// ── Hook principal ───────────────────────────────────────────────────────────
export function usePassadoria() {
  const [registros, setRegistros] = useState([]);
  const [nomes, setNomes] = useState(NOMES_PADRAO);
  const [loading, setLoading] = useState(true);

  const carregarRegistros = useCallback(async () => {
    try {
      const { data } = await supabase.from('oficinas_passadoria').select('*');
      if (Array.isArray(data)) setRegistros(data);
    } catch (e) { console.warn('[passadoria] registros:', e?.message); }
  }, []);

  const carregarNomes = useCallback(async () => {
    try {
      const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'passadoria-config').maybeSingle();
      const ns = data?.payload?.nomes;
      if (Array.isArray(ns) && ns.length > 0) setNomes(ns);
    } catch (e) { console.warn('[passadoria] nomes:', e?.message); }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      await Promise.all([carregarRegistros(), carregarNomes()]);
      if (vivo) setLoading(false);
    })();
    const ch = supabase.channel('passadoria-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oficinas_passadoria' }, () => carregarRegistros())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'amicia_data', filter: 'user_id=eq.passadoria-config' },
        (payload) => { const ns = payload?.new?.payload?.nomes; if (Array.isArray(ns) && ns.length > 0) setNomes(ns); })
      .subscribe();
    return () => { vivo = false; try { supabase.removeChannel(ch); } catch {} };
  }, [carregarRegistros, carregarNomes]);

  const registroPorCorte = useCallback((corteId) => registros.find(r => String(r.corte_id) === String(corteId)) || null, [registros]);

  // Define (ou troca) a passadoria de um corte. Preserva entregue ao trocar o nome.
  const definir = useCallback(async (corte, nome, caseadoNome) => {
    // registro atual (pra logar definição × troca)
    let anterior = null;
    try {
      const { data: at } = await supabase.from('oficinas_passadoria').select('nome, pago').eq('corte_id', corte.id).maybeSingle();
      anterior = at || null;
    } catch { /* segue */ }
    if (anterior?.pago) return { ok: false, erro: 'esse corte já foi PAGO — não dá pra trocar a passadoria' };
    // 20/08: puxa o ACORDO da passadoria pra esta ref (passadoria_precos) e
    // grava a base do pagamento — qtd e valor ficam editáveis no card da tela
    let valorUnit = null;
    try {
      const { data: pr } = await supabase.from('passadoria_precos')
        .select('valor').eq('ref_norm', normRef(corte.ref)).eq('passadoria', nome).maybeSingle();
      if (pr?.valor != null) valorUnit = pr.valor;
    } catch { /* sem acordo cadastrado — campo fica em branco */ }
    const row = {
      corte_id: corte.id,
      ref: corte.ref ?? null,
      descricao: corte.descricao ?? null,
      marca: corte.marca ?? null,
      oficina: corte.oficina ?? null,
      caseado_nome: caseadoNome ?? null,
      qtd: corte.qtd ?? null,
      qtd_pagar: corte.qtd ?? null,
      valor_unit: valorUnit,
      nome,
      definido_por: getUsuario(),
      definido_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('oficinas_passadoria').upsert(row, { onConflict: 'corte_id' });
    if (error) { console.error('[passadoria] definir:', error.message); return { ok: false, erro: error.message }; }
    if (anterior && anterior.nome !== nome) logAcao(corte.id, corte.ref, 'trocou passadoria', `${anterior.nome} → ${nome}`);
    else if (!anterior) logAcao(corte.id, corte.ref, 'definiu passadoria', nome);
    // 22/08: espelha no LOG UNIFICADO de cortes do modulo Oficinas
    try { supabase.from('oficinas_cortes_log').insert({ corte_id: String(corte.id), n_corte: String(corte.nCorte || ''), ref: String(corte.ref || ''), oficina: String(corte.oficina || ''), acao: 'passadoria_definida', detalhe: anterior && anterior.nome !== nome ? `${anterior.nome} → ${nome}` : nome, usuario: getUsuario() }).then(() => {}, () => {}); } catch { /* nunca trava */ }
    await carregarRegistros();
    return { ok: true };
  }, [carregarRegistros]);

  const toggleEntregue = useCallback(async (registro) => {
    if (!registro?.id) return { ok: false };
    const novo = !registro.entregue;
    const { error } = await supabase.from('oficinas_passadoria').update({
      entregue: novo,
      entregue_por: novo ? getUsuario() : null,
      entregue_em: novo ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', registro.id);
    if (error) { console.error('[passadoria] entregue:', error.message); return { ok: false, erro: error.message }; }
    logAcao(registro.corte_id, registro.ref, novo ? 'marcou entregue' : 'desmarcou entrega', registro.nome);
    await carregarRegistros();
    return { ok: true };
  }, [carregarRegistros]);

  // edita a base do pagamento no card (peça a menos / valor renegociado)
  const salvarPagamento = useCallback(async (registro, campos) => {
    if (!registro?.id) return { ok: false };
    const { error } = await supabase.from('oficinas_passadoria').update({
      ...campos, updated_at: new Date().toISOString(),
    }).eq('id', registro.id);
    if (error) { console.error('[passadoria] pagamento:', error.message); return { ok: false }; }
    const mud = [];
    if ('qtd_pagar' in campos && campos.qtd_pagar !== (registro.qtd_pagar ?? null)) mud.push(`qtd ${registro.qtd_pagar ?? '—'} → ${campos.qtd_pagar ?? '—'}`);
    if ('valor_unit' in campos && campos.valor_unit !== (registro.valor_unit ?? null)) mud.push(`valor ${registro.valor_unit ?? '—'} → ${campos.valor_unit ?? '—'}`);
    if (mud.length) logAcao(registro.corte_id, registro.ref, 'editou qtd/valor', mud.join(' · '));
    await carregarRegistros();
    return { ok: true };
  }, [carregarRegistros]);

  // pagamento em lote: carimba os cortes selecionados como pagos
  const registrarPagamento = useCallback(async (regs, ajuste) => {
    const pagamentoId = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now());
    const agora = new Date().toISOString();
    for (const r of regs) {
      const { error } = await supabase.from('oficinas_passadoria').update({
        pago: true, pago_em: agora, pago_por: getUsuario(), pagamento_id: pagamentoId, updated_at: agora,
      }).eq('id', r.id).eq('pago', false);
      if (error) { console.error('[passadoria] pagar:', error.message); return { ok: false, erro: error.message }; }
      const tot = (r.qtd_pagar ?? 0) * (r.valor_unit ?? 0);
      logAcao(r.corte_id, r.ref, 'marcou pago', `${r.nome} · ${r.qtd_pagar} pç × ${r.valor_unit} = R$ ${tot.toFixed(2)}`);
    }
    if (ajuste?.valor && regs.length) {
      // fica na auditoria: quem pagou com acrescimo/desconto e por que
      logAcao(regs[0].corte_id, regs[0].ref, ajuste.valor > 0 ? 'acrescimo no pagamento' : 'desconto no pagamento',
        `${regs[0].nome} · R$ ${ajuste.valor.toFixed(2)}${ajuste.motivo ? ` (${ajuste.motivo})` : ''}`);
    }
    await carregarRegistros();
    return { ok: true, pagamentoId };
  }, [carregarRegistros]);

  const remover = useCallback(async (corteId) => {
    const { error } = await supabase.from('oficinas_passadoria').delete().eq('corte_id', corteId);
    if (error) { console.error('[passadoria] remover:', error.message); return { ok: false, erro: error.message }; }
    await carregarRegistros();
    return { ok: true };
  }, [carregarRegistros]);

  const salvarNomes = useCallback(async (novos) => {
    setNomes(novos);
    try {
      await supabase.from('amicia_data').upsert(
        { user_id: 'passadoria-config', payload: { nomes: novos, _updated: new Date().toISOString() } },
        { onConflict: 'user_id' });
    } catch (e) { console.error('[passadoria] salvarNomes:', e?.message); }
  }, []);
  const addNome = useCallback((n) => {
    const t = String(n || '').trim();
    if (!t) return;
    setNomes(prev => (prev.includes(t) ? prev : (salvarNomes([...prev, t]), [...prev, t])));
  }, [salvarNomes]);
  const removeNome = useCallback((n) => {
    setNomes(prev => { const novos = prev.filter(x => x !== n); salvarNomes(novos); return novos; });
  }, [salvarNomes]);

  return { registros, nomes, loading, registroPorCorte, definir, toggleEntregue, remover, addNome, removeNome, salvarPagamento, registrarPagamento };
}

// ── Ícone: ferro de passar ───────────────────────────────────────────────────
// cor: '#b7791f' (amarelo aceso), '#27ae60' (definida), '#8a9aa4' (vazado)
import { CORES_ETAPA } from './caseado.jsx';
function SvgFerro({ size = 13, cores }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
      <path d="M4 16h17v2.2c0 .5-.4.8-.9.8H4.2c-.7 0-1.1-.7-.8-1.3L4 16Z" fill={cores.fill} stroke={cores.stroke} strokeWidth="2.1" strokeLinejoin="round" />
      <path d="M6.5 16c.2-3.2 1.6-6 5.5-6h5.5c1.9 0 3.5 1.4 3.5 3.4V16" fill={cores.fill === '#fff' ? 'none' : cores.fill} stroke={cores.stroke} strokeWidth="2.1" strokeLinejoin="round" />
      <path d="M12 10c0-2 1.2-3.5 3.2-3.5H19" fill="none" stroke={cores.stroke} strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  );
}

// Ícone da aba Passadoria (ferro) — currentColor pra acompanhar a aba
export function PassadoriaTabIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M4 16h17v2.2c0 .5-.4.8-.9.8H4.2c-.7 0-1.1-.7-.8-1.3L4 16Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M6.5 16c.2-3.2 1.6-6 5.5-6h5.5c1.9 0 3.5 1.4 3.5 3.4V16" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M12 10c0-2 1.2-3.5 3.2-3.5H19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Ícone do ferro na linha da lista de cortes (último elemento do card).
 *   corte      = a linha do corte (id, ref, entregue, ...)
 *   api        = usePassadoria()
 *   caseadoApi = useCaseado() — pra saber se o corte tem botão e se o caseado entregou
 *
 * Regras (do Ailson):
 *   sem botão → habilita quando a OFICINA entregar
 *   com botão → habilita quando oficina E caseado entregarem
 *   habilitado sem passadoria → AMARELO aceso (chama atenção)
 *   passadoria definida       → VERDE
 *   passadoria entregue       → vazado, mas registra quem passou (title)
 */
export function PassadoriaBtnIcone({ corte, api, caseadoApi }) {
  const [modal, setModal] = useState(false);
  if (!corte) return null;

  const reg = api?.registroPorCorte?.(corte.id) || null;
  const temBotao = !!caseadoApi?.precisaCaseado?.(corte.ref);
  const regCaseado = temBotao ? caseadoApi?.registroPorCorte?.(corte.id) : null;
  const caseadoOk = !temBotao || !!regCaseado?.entregue;
  const disponivel = !!corte.entregue && caseadoOk;   // pronto pra passadoria

  // MESMA régua de cores do caseado (regra do Ailson 20/08):
  // AMARELO falta definir · VERDE definida · CINZA CLARO entregue · neutro antes
  const estado = reg?.entregue ? 'cinza' : reg ? 'verde' : disponivel ? 'amarelo' : 'neutro';
  const cores = CORES_ETAPA[estado];
  const titulo = reg
    ? (reg.entregue ? `Passadoria: ${reg.nome} (entregue)` : `Na passadoria: ${reg.nome}`)
    : estado === 'amarelo' ? 'Falta definir a passadoria'
    : (temBotao && corte.entregue) ? 'Passadoria (aguardando o caseado entregar)'
    : 'Passadoria (aguardando o corte ficar pronto)';

  const podeClicar = disponivel || !!reg;   // registro antigo continua consultável

  return (
    <>
      <button
        type="button"
        title={titulo}
        onClick={(e) => { e.stopPropagation(); if (podeClicar) setModal(true); }}
        style={{
          width: 17, height: 17, borderRadius: 4, padding: 0, flexShrink: 0,
          background: cores.bg, border: `1px solid ${cores.borda}`,
          cursor: podeClicar ? 'pointer' : 'default',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          opacity: podeClicar || estado !== 'neutro' ? 1 : 0.6,
        }}
      >
        <SvgFerro size={13} cores={estado === 'neutro' ? { ...cores, fill: '#fff', stroke: '#4a7fa5' } : cores} />
      </button>
      {modal && (
        <ModalDefinirPassadoria
          corte={corte} api={api} registroAtual={reg}
          caseadoNome={regCaseado?.nome || null}
          onClose={() => setModal(false)} />
      )}
    </>
  );
}

// ── Modal "Definir Passadoria" ───────────────────────────────────────────────
export function ModalDefinirPassadoria({ corte, api, registroAtual, caseadoNome, onClose }) {
  const [escolhido, setEscolhido] = useState(null);
  const [status, setStatus] = useState('idle');
  const timerRef = useRef(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const ocupado = status === 'salvando' || status === 'ok' || status === 'removendo' || status === 'removido';

  const escolher = async (nome) => {
    if (ocupado) return;
    setEscolhido(nome);
    setStatus('salvando');
    const r = await api.definir(corte, nome, caseadoNome);
    if (r?.ok) { setStatus('ok'); timerRef.current = setTimeout(onClose, 1000); }
    else { setStatus('erro'); }
  };

  const apagar = async () => {
    if (ocupado) return;
    setStatus('removendo');
    const r = await api.remover(corte.id);
    if (r?.ok) { setStatus('removido'); timerRef.current = setTimeout(onClose, 900); }
    else { setStatus('erro'); }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: '#fff', borderRadius: 14, padding: 20, width: 360, maxWidth: '92vw', boxShadow: '0 12px 44px rgba(0,0,0,0.28)' }}>
        <button type="button" onClick={onClose} aria-label="Fechar" style={{ position: 'absolute', top: 8, right: 10, width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: '#b0b8c0' }}>×</button>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#2c3e50', fontFamily: 'Georgia,serif', textAlign: 'center', marginBottom: 4 }}>Definir Passadoria</div>
        <div style={{ fontSize: 12, color: '#6b7c8a', textAlign: 'center', marginBottom: 16, overflowWrap: 'break-word', lineHeight: 1.5 }}>
          Ref <b style={{ color: '#2c3e50' }}>{corte?.ref}</b> · {corte?.descricao || ''}{corte?.oficina ? <> · <b style={{ color: '#2c3e50' }}>{corte.oficina}</b></> : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '46vh', overflowY: 'auto' }}>
          {(api?.nomes || []).map(nome => {
            const ehAtual = registroAtual?.nome === nome;
            const sel = escolhido === nome;
            const destaque = sel || (ehAtual && !escolhido && status !== 'removido');
            return (
              <button key={nome} type="button" disabled={ocupado} onClick={() => escolher(nome)}
                style={{
                  position: 'relative', padding: '14px', borderRadius: 10,
                  cursor: ocupado ? 'default' : 'pointer',
                  border: `2px solid ${destaque ? '#27ae60' : '#e2e8ee'}`,
                  background: destaque ? '#eafaf0' : '#f6f9fc',
                  textAlign: 'center', opacity: (escolhido && !sel) ? 0.45 : 1,
                }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#2c3e50' }}>{nome}</span>
                {destaque && (
                  <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#27ae60', fontWeight: 700, fontSize: 13 }}>
                    {sel && status === 'salvando' ? 'salvando...' : sel && status === 'ok' ? '✓ definida' : '✓'}
                  </span>
                )}
              </button>
            );
          })}
          {(!api?.nomes || api.nomes.length === 0) && (
            <div style={{ fontSize: 13, color: '#a89f94', textAlign: 'center', padding: '8px 0' }}>Nenhuma passadoria cadastrada. Cadastre na tela Passadoria.</div>
          )}
        </div>
        {status === 'ok' && (
          <div style={{ fontSize: 13, color: '#27ae60', fontWeight: 700, textAlign: 'center', marginTop: 14 }}>✓ Passadoria definida: {escolhido}</div>
        )}
        {status === 'removido' && (
          <div style={{ fontSize: 13, color: '#6b7c8a', fontWeight: 700, textAlign: 'center', marginTop: 14 }}>Passadoria removida</div>
        )}
        {status === 'erro' && (
          <div style={{ fontSize: 13, color: '#c0392b', fontWeight: 600, textAlign: 'center', marginTop: 14 }}>Erro. Tenta de novo.</div>
        )}
        {registroAtual && status !== 'ok' && status !== 'removido' && (
          <button type="button" onClick={apagar} disabled={ocupado} style={{ marginTop: 16, width: '100%', padding: '9px', fontSize: 13, fontWeight: 600, color: '#c0392b', background: 'none', border: 'none', cursor: ocupado ? 'default' : 'pointer', opacity: ocupado ? 0.6 : 1 }}>
            {status === 'removendo' ? 'Apagando...' : 'Apagar seleção'}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Preços por passadoria (Ailson 20/08): quanto cada passadoria recebe pra
// passar e embalar ESTE produto. Fica em passadoria_precos (ref × passadoria)
// e NÃO entra na composição de custo (o campo Passadoria do custo engloba
// tag/etiqueta/etc). Usado nos editores da Calculadora e da Ficha Técnica.
export function PassadoriaPrecosBtn({ refProd, descricao }) {
  const [aberto, setAberto] = useState(false);
  const temRef = !!String(refProd || '').trim();
  return (
    <>
      <button type="button" disabled={!temRef}
        title={temRef ? 'Valores de passadoria deste produto' : 'Preencha a referência primeiro'}
        onClick={() => temRef && setAberto(true)}
        style={{ background: '#fff', border: '1px solid #c8d8e4', borderRadius: 8, padding: '6px 10px', cursor: temRef ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 6, color: '#4a7fa5', fontWeight: 700, fontSize: 12, fontFamily: 'Georgia,serif', opacity: temRef ? 1 : 0.5 }}>
        <PassadoriaTabIcon size={15} /> Passadoria
      </button>
      {aberto && <ModalPrecosPassadoria refProd={refProd} descricao={descricao} onClose={() => setAberto(false)} />}
    </>
  );
}

function ModalPrecosPassadoria({ refProd, descricao, onClose }) {
  const refNorm = normRef(refProd);
  const [nomes, setNomes] = useState([]);
  const [valores, setValores] = useState({});
  const [status, setStatus] = useState('carregando'); // carregando | pronto | salvando | ok | erro
  useEffect(() => {
    (async () => {
      try {
        const [rN, rP] = await Promise.all([
          supabase.from('amicia_data').select('payload').eq('user_id', 'passadoria-config').maybeSingle(),
          supabase.from('passadoria_precos').select('passadoria, valor').eq('ref_norm', refNorm),
        ]);
        const ns = Array.isArray(rN.data?.payload?.nomes) && rN.data.payload.nomes.length ? rN.data.payload.nomes : NOMES_PADRAO;
        const vs = {};
        (rP.data || []).forEach(p => { vs[p.passadoria] = p.valor != null ? String(p.valor).replace('.', ',') : ''; });
        setNomes(ns); setValores(vs); setStatus('pronto');
      } catch { setStatus('erro'); }
    })();
  }, [refNorm]);

  const salvar = async () => {
    setStatus('salvando');
    try {
      for (const nome of nomes) {
        const bruto = String(valores[nome] ?? '').trim().replace(',', '.');
        const v = bruto === '' ? null : parseFloat(bruto);
        if (v == null || !Number.isFinite(v)) {
          await supabase.from('passadoria_precos').delete().eq('ref_norm', refNorm).eq('passadoria', nome);
        } else {
          await supabase.from('passadoria_precos').upsert({
            ref_norm: refNorm, passadoria: nome, valor: v,
            atualizado_em: new Date().toISOString(), atualizado_por: getUsuario(),
          }, { onConflict: 'ref_norm,passadoria' });
        }
      }
      setStatus('ok');
      setTimeout(onClose, 900);
    } catch { setStatus('erro'); }
  };

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: '#fff', borderRadius: 14, padding: 20, width: 380, maxWidth: '94vw', boxShadow: '0 12px 44px rgba(0,0,0,0.28)' }}>
        <button type="button" onClick={onClose} style={{ position: 'absolute', top: 8, right: 10, width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: '#b0b8c0' }}>×</button>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#2c3e50', fontFamily: 'Georgia,serif', textAlign: 'center', marginBottom: 4 }}>Valores de Passadoria</div>
        <div style={{ fontSize: 12, color: '#6b7c8a', textAlign: 'center', marginBottom: 14, overflowWrap: 'break-word' }}>
          Ref <b style={{ color: '#2c3e50' }}>{refProd}</b>{descricao ? ` · ${descricao}` : ''}
        </div>
        <div style={{ fontSize: 11, color: '#a89f94', textAlign: 'center', marginBottom: 12 }}>
          Quanto cada passadoria recebe pra passar e embalar este produto. Não entra na composição de custo.
        </div>
        {status === 'carregando' ? (
          <div style={{ textAlign: 'center', padding: 16, color: '#a89f94', fontSize: 13 }}>Carregando…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46vh', overflowY: 'auto' }}>
            {nomes.map(nome => (
              <div key={nome} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid #e2e8ee', borderRadius: 8, background: '#f6f9fc' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 600, color: '#2c3e50', flex: 1 }}><PassadoriaTabIcon size={14} />{nome}</span>
                <span style={{ fontSize: 12, color: '#8a9aa4' }}>R$</span>
                <input value={valores[nome] ?? ''} onChange={e => setValores(v => ({ ...v, [nome]: e.target.value }))}
                  placeholder="—" inputMode="decimal"
                  style={{ width: 74, padding: '7px 8px', fontSize: 14, textAlign: 'right', border: '1px solid #c8d8e4', borderRadius: 6, outline: 'none', fontFamily: "Calibri,'Segoe UI',Arial,sans-serif", background: '#fff', colorScheme: 'light' }} />
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={salvar} disabled={status === 'salvando' || status === 'carregando'}
          style={{ marginTop: 14, width: '100%', padding: '11px', fontSize: 14, fontWeight: 700, color: '#fff', background: status === 'ok' ? '#27ae60' : '#4a7fa5', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'Georgia,serif', opacity: status === 'salvando' ? 0.7 : 1 }}>
          {status === 'salvando' ? 'Salvando…' : status === 'ok' ? '✓ Salvo' : 'Salvar valores'}
        </button>
        {status === 'erro' && <div style={{ fontSize: 12, color: '#c0392b', textAlign: 'center', marginTop: 8 }}>Erro ao carregar/salvar. Tenta de novo.</div>}
      </div>
    </div>,
    document.body
  );
}

// ── Foto miniatura (mesmo padrão da tela Caseado) ────────────────────────────
function FotoPassadoria({ refProd, w = 44, h = 56 }) {
  const sbUrl = (supabase && supabase.supabaseUrl) || (import.meta.env && import.meta.env.VITE_SUPABASE_URL) || '';
  const base = sbUrl ? `${sbUrl}/storage/v1/object/public/produtos/` : '';
  const ph = (
    <div style={{ width: w, height: h, borderRadius: 6, background: 'linear-gradient(135deg,#f0ebe3,#e8e2da)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e8e2da', flexShrink: 0, color: '#c0b8b0', fontSize: 16 }}>📷</div>
  );
  if (!base || !refProd) return ph;
  const orig = String(refProd).toUpperCase();
  const norm = orig.replace(/^0+/, '') || '0';
  const urls = [norm + '.jpg', norm + '.png', norm + '.webp'];
  if (orig !== norm) urls.push(orig + '.jpg', orig + '.png', orig + '.webp');
  const pad4 = norm.padStart(4, '0'), pad5 = norm.padStart(5, '0');
  if (pad4 !== norm && pad4 !== orig) urls.push(pad4 + '.jpg', pad4 + '.png', pad4 + '.webp');
  if (pad5 !== norm && pad5 !== orig && pad5 !== pad4) urls.push(pad5 + '.jpg', pad5 + '.png', pad5 + '.webp');
  const cb = '?v=' + new Date().toISOString().slice(0, 10);
  return (
    <div style={{ position: 'relative', width: w, height: h, flexShrink: 0 }}>
      <img src={base + urls[0] + cb} alt={`REF ${refProd}`}
        onError={(e) => {
          const cur = e.target.src;
          const idx = urls.findIndex(u => cur.includes(u));
          if (idx >= 0 && idx < urls.length - 1) e.target.src = base + urls[idx + 1] + cb;
          else { e.target.style.display = 'none'; const n = e.target.nextSibling; if (n) n.style.display = 'flex'; }
        }}
        style={{ width: w, height: h, objectFit: 'cover', borderRadius: 6, border: '1px solid #e8e2da' }} />
      <div style={{ width: w, height: h, borderRadius: 6, background: 'linear-gradient(135deg,#f0ebe3,#e8e2da)', display: 'none', alignItems: 'center', justifyContent: 'center', border: '1px solid #e8e2da', position: 'absolute', top: 0, left: 0, color: '#c0b8b0', fontSize: 16 }}>📷</div>
    </div>
  );
}

// linha "1194 pç × R$ 1,00 = R$ 1.194,00" — qtd e valor editáveis (peça a
// menos / acordo renegociado). Sem acordo cadastrado o valor fica em branco.
function LinhaPagamento({ reg, api }) {
  const [qtd, setQtd] = useState(reg.qtd_pagar != null ? String(reg.qtd_pagar) : (reg.qtd != null ? String(reg.qtd) : ''));
  const [valor, setValor] = useState(reg.valor_unit != null ? String(reg.valor_unit).replace('.', ',') : '');
  useEffect(() => { setQtd(reg.qtd_pagar != null ? String(reg.qtd_pagar) : (reg.qtd != null ? String(reg.qtd) : '')); }, [reg.qtd_pagar, reg.qtd]);
  useEffect(() => { setValor(reg.valor_unit != null ? String(reg.valor_unit).replace('.', ',') : ''); }, [reg.valor_unit]);
  const nQtd = parseInt(qtd, 10);
  const nValor = parseFloat(String(valor).replace(',', '.'));
  const total = Number.isFinite(nQtd) && Number.isFinite(nValor) ? nQtd * nValor : null;
  const salvar = () => {
    const campos = {};
    campos.qtd_pagar = Number.isFinite(nQtd) ? nQtd : null;
    campos.valor_unit = Number.isFinite(nValor) ? nValor : null;
    if (campos.qtd_pagar !== (reg.qtd_pagar ?? null) || campos.valor_unit !== (reg.valor_unit ?? null)) api.salvarPagamento(reg, campos);
  };
  const inp = { padding: '5px 7px', fontSize: 13, textAlign: 'right', border: '1px solid #c8d8e4', borderRadius: 6, outline: 'none', fontFamily: FN, background: '#fff', colorScheme: 'light' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      <input value={qtd} onChange={e => setQtd(e.target.value.replace(/[^0-9]/g, ''))} onBlur={salvar} inputMode="numeric" title="Quantidade a pagar" style={{ ...inp, width: 58 }} />
      <span style={{ fontSize: 11, color: '#8a9aa4' }}>pç ×</span>
      <span style={{ fontSize: 11, color: '#8a9aa4' }}>R$</span>
      <input value={valor} onChange={e => setValor(e.target.value.replace(/[^0-9.,]/g, ''))} onBlur={salvar} inputMode="decimal" placeholder="—" title="Valor por peça (acordo da passadoria)" style={{ ...inp, width: 58, borderColor: valor === '' ? '#f0b429' : '#c8d8e4', background: valor === '' ? '#fffdf4' : '#fff' }} />
      <span style={{ fontSize: 13, fontWeight: 700, color: total != null ? '#1f6f6b' : '#c0b8b0', fontFamily: FN }}>
        = {total != null ? 'R$ ' + total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'R$ —'}
      </span>
    </div>
  );
}

function diasNaPassadoria(reg) {
  if (!reg?.definido_em) return 0;
  const ini = new Date(reg.definido_em).getTime();
  const fim = reg.entregue && reg.entregue_em ? new Date(reg.entregue_em).getTime() : Date.now();
  return Math.max(0, Math.floor((fim - ini) / 86400000));
}
function fmtData(x) { try { return new Date(x).toLocaleDateString('pt-BR'); } catch { return '—'; } }

const inputPass = { padding: '11px 12px', fontSize: 15, border: '1px solid #d8e2ea', borderRadius: 8, fontFamily: 'Georgia,serif', color: '#2c3e50', outline: 'none', background: '#fff', colorScheme: 'light', WebkitAppearance: 'none', appearance: 'none' };
// 31/08 (pedido dele): cada passadoria tem uma cor — tom SUAVE, vale desktop
// e celular. Identidade visual rapida: badge do card e chip do filtro.
const CORES_PASSADORIA = {
  'eliana':      { bg: '#e9f7ec', border: '#bfe3c8', text: '#1e7a45' },  // verde claro
  'guilherme':   { bg: '#f3ecfa', border: '#d9c3ee', text: '#6b3aa0' },  // lilas
  'perla':       { bg: '#fdf6dc', border: '#eeda92', text: '#8a6d1a' },  // amarelo
  'bom retiro':  { bg: '#e8f1fa', border: '#b8d4ee', text: '#2a6496' },  // azul
  'silva teles': { bg: '#fdefe0', border: '#f3cf9d', text: '#a05c1a' },  // laranja
};
const COR_PASSADORIA_PADRAO = { bg: '#e8f6f5', border: '#c2e4e2', text: '#1f6f6b' };
export function corPassadoria(nome) {
  return CORES_PASSADORIA[String(nome || '').trim().toLowerCase()] || COR_PASSADORIA_PADRAO;
}

function chipStyle(active) {
  return { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: `1px solid ${active ? '#4a7fa5' : '#d8e2ea'}`, background: active ? '#4a7fa5' : '#fff', color: active ? '#fff' : '#5a6470', whiteSpace: 'nowrap', lineHeight: 1.2 };
}

// ── Tela Passadoria (aba ao lado de Caseado no módulo Oficinas) ──────────────
export function TelaPassadoria({ api, isAdmin = true, onLancarDespesa }) {
  // 31/08 (pedido dele): card reorganizado no celular — o wrap solto deixava
  // dias/entrega/pagamento caindo em posicoes confusas.
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  useEffect(() => {
    const f = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  const [busca, setBusca] = useState('');
  const [nomeFiltro, setNomeFiltro] = useState('todos');
  const [statusFiltro, setStatusFiltro] = useState('todos'); // todos | aberto | entregue
  const [marcaFiltro, setMarcaFiltro] = useState('todas');   // 26/08 (pedido dele): todas | Meluni | Amícia
  const [gerenciar, setGerenciar] = useState(false);
  const [selecao, setSelecao] = useState(() => new Set());
  const [modalPag, setModalPag] = useState(false);
  const [modalLog, setModalLog] = useState(false);
  const [trocando, setTrocando] = useState(null); // registro sendo trocado de passadoria
  const toggleSel = (id) => setSelecao(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const registros = api?.registros || [];
  const nomes = api?.nomes || [];

  const termo = busca.trim().toLowerCase();
  let lista = registros.filter(r => {
    if (statusFiltro === 'aberto' && r.entregue) return false;
    // 31/08 (pedido dele): "Entregues" vira entregue SEM pagamento e nasce o
    // chip proprio de Pagos — espelha os 3 grupos da ordenacao.
    if (statusFiltro === 'entregue' && (!r.entregue || r.pago)) return false;
    if (statusFiltro === 'pago' && !r.pago) return false;
    if (nomeFiltro !== 'todos' && r.nome !== nomeFiltro) return false;
    if (marcaFiltro !== 'todas' && String(r.marca || '') !== marcaFiltro) return false;
    if (termo) { const hay = (String(r.ref || '') + ' ' + String(r.descricao || '')).toLowerCase(); if (!hay.includes(termo)) return false; }
    return true;
  });
  lista = [...lista].sort((a, b) => {
    // 31/08 (ordem dele): abertos -> entregues nao pagos -> pagos;
    // dentro de cada grupo, mais recente primeiro.
    const grupo = (r) => (r.pago ? 2 : r.entregue ? 1 : 0);
    if (grupo(a) !== grupo(b)) return grupo(a) - grupo(b);
    const ta = new Date(a.entregue && a.entregue_em ? a.entregue_em : a.definido_em).getTime();
    const tb = new Date(b.entregue && b.entregue_em ? b.entregue_em : b.definido_em).getTime();
    return tb - ta;
  });
  const nAbertos = registros.filter(r => !r.entregue).length;
  const nEntregues = registros.filter(r => r.entregue && !r.pago).length;
  const nPagos = registros.filter(r => !!r.pago).length;
  const contaPorNome = (n) => registros.filter(r => r.nome === n).length;

  return (
    <div>
      {/* Filtro por passadoria (chips) + gerenciar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <button onClick={() => setNomeFiltro('todos')} style={chipStyle(nomeFiltro === 'todos')}>Todas ({registros.length})</button>
        {nomes.map(n => (
          <button key={n} onClick={() => setNomeFiltro(n)} style={(() => {
            const c = corPassadoria(n); const ativo = nomeFiltro === n;
            return { ...chipStyle(ativo), background: ativo ? c.text : c.bg, border: `1px solid ${ativo ? c.text : c.border}`, color: ativo ? '#fff' : c.text };
          })()}><PassadoriaTabIcon size={13} />{n} ({contaPorNome(n)})</button>
        ))}
        <button onClick={() => setModalLog(true)} title="Histórico de ações da passadoria" style={{ marginLeft: 'auto', padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid #d8e2ea', background: '#fff', color: '#5a6470', cursor: 'pointer', whiteSpace: 'nowrap' }}>🕘 Log</button>
        <button onClick={() => setGerenciar(true)} title="Cadastrar / remover passadorias" style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid #d8e2ea', background: '#fff', color: '#5a6470', cursor: 'pointer', whiteSpace: 'nowrap' }}>⚙ Gerenciar</button>
      </div>

      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar ref ou descrição..." style={{ ...inputPass, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <button onClick={() => setStatusFiltro('todos')} style={chipStyle(statusFiltro === 'todos')}>Todos</button>
        <button onClick={() => setStatusFiltro('aberto')} style={chipStyle(statusFiltro === 'aberto')}>Em aberto</button>
        <button onClick={() => setStatusFiltro('entregue')} style={chipStyle(statusFiltro === 'entregue')}>Entregue s/ pgto</button>
        <button onClick={() => setStatusFiltro('pago')} style={chipStyle(statusFiltro === 'pago')}>💰 Pagos</button>
        <span style={{ width: 1, height: 20, background: '#d8e2ea', margin: '0 2px' }} />
        <button onClick={() => setMarcaFiltro('todas')} style={chipStyle(marcaFiltro === 'todas')}>Todas as marcas</button>
        <button onClick={() => setMarcaFiltro('Meluni')} style={chipStyle(marcaFiltro === 'Meluni')}>Meluni ({registros.filter(r => r.marca === 'Meluni').length})</button>
        <button onClick={() => setMarcaFiltro('Amícia')} style={chipStyle(marcaFiltro === 'Amícia')}>Amícia ({registros.filter(r => r.marca === 'Amícia').length})</button>
        <span style={{ fontSize: 12, color: '#8a9aa4', marginLeft: 'auto' }}>{nAbertos} aberto(s) · {nEntregues} entregue(s) s/ pgto · {nPagos} pago(s)</span>
      </div>

      {selecao.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#eafaf0', border: '1px solid #bfe6cd', borderRadius: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#1f6f6b' }}>{selecao.size} selecionado(s)</span>
          <button onClick={() => setModalPag(true)} style={{ padding: '9px 16px', fontSize: 13, fontWeight: 700, color: '#fff', background: '#27ae60', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'Georgia,serif' }}>💰 Efetuar pagamento ({selecao.size})</button>
          <button onClick={() => setSelecao(new Set())} style={{ padding: '9px 12px', fontSize: 12, fontWeight: 600, color: '#5a6470', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>limpar seleção</button>
        </div>
      )}

      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30, color: '#a89f94', fontSize: 14 }}>
          {registros.length === 0 ? 'Nenhum corte na passadoria ainda. Defina pelo ícone de ferro na lista de Cortes.' : 'Nenhum resultado pros filtros.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map(reg => {
            const dias = diasNaPassadoria(reg);
            const ent = !!reg.entregue;
            const pago = !!reg.pago;
            const selecionavel = ent && !pago && reg.valor_unit != null && reg.qtd_pagar != null;
            const badges = (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                <span style={{ background: ent ? '#eafbf0' : '#fff8ea', color: ent ? '#27ae60' : '#b7791f', border: `1px solid ${ent ? '#c6e9cf' : '#f0dca8'}`, padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {ent ? '✓ Entregue' : 'Na passadoria'}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: corPassadoria(reg.nome).text, background: corPassadoria(reg.nome).bg, border: `1px solid ${corPassadoria(reg.nome).border}`, borderRadius: 10, padding: '3px 9px' }}><PassadoriaTabIcon size={13} />{reg.nome}</span>
                {pago && <span style={{ fontSize: 11, fontWeight: 700, color: '#1e7a45', background: '#dff3e4', border: '1px solid #b9e0c4', borderRadius: 10, padding: '3px 9px' }}>💰 Pago {reg.pago_em ? fmtData(reg.pago_em) : ''}</span>}
                {!pago && (
                  <button onClick={() => setTrocando(reg)} title="Trocar a passadoria (colocou por engano?)"
                    style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#8a9aa4', padding: 2 }}>✏️</button>
                )}
              </div>
            );
            if (isMobile) return (
              <div key={reg.id} style={{ background: pago ? '#f8fbf6' : '#fff', border: `1px solid ${pago ? '#cfe6c4' : ent ? '#d4edc4' : '#e8e2da'}`, borderRadius: 10, padding: 12, opacity: pago ? 0.9 : 1 }}>
                {badges}
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 6 }}>
                  <FotoPassadoria refProd={reg.ref} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#2c3e50', lineHeight: 1.3 }}>REF {reg.ref}{reg.descricao ? ` · ${reg.descricao}` : ''}</div>
                    <div style={{ fontSize: 11, color: '#8a9aa4', marginTop: 3, lineHeight: 1.5 }}>
                      🧵 {reg.oficina || '—'}{reg.caseado_nome ? ` · caseado: ${reg.caseado_nome}` : ''}<br />
                      {reg.qtd != null ? `${reg.qtd} pç` : '—'} · chegou {fmtData(reg.definido_em)}{ent && reg.entregue_em ? ` · entregue ${fmtData(reg.entregue_em)}` : ''}
                    </div>
                  </div>
                </div>
                <LinhaPagamento reg={reg} api={api} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, paddingTop: 9, borderTop: '1px solid #f0ece6' }}>
                  {ent && !pago && (
                    <div onClick={() => selecionavel && toggleSel(reg.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: selecionavel ? 'pointer' : 'default', opacity: selecionavel ? 1 : 0.5 }}>
                      <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${selecao.has(reg.id) ? '#27ae60' : selecionavel ? '#9fc3b4' : '#dde5ea'}`, background: selecao.has(reg.id) ? '#27ae60' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {selecao.has(reg.id) && <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>✓</span>}
                      </div>
                      <span style={{ fontSize: 10, color: '#8a9aa4', textTransform: 'uppercase' }}>Pagar</span>
                    </div>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 5 }}>
                    <span style={{ fontSize: 19, fontWeight: 700, fontFamily: FN, color: (dias >= 7 && !ent) ? '#c0392b' : '#2c3e50' }}>{dias}</span>
                    <span style={{ fontSize: 9.5, color: '#8a9aa4', textTransform: 'uppercase' }}>dias</span>
                  </div>
                  <div onClick={() => api.toggleEntregue(reg)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: ent ? '#27ae60' : '#fff', border: ent ? 'none' : '2px solid #c0d0dc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {ent && <span style={{ color: '#fff', fontSize: 17, fontWeight: 700 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 10, color: '#8a9aa4', textTransform: 'uppercase' }}>Entrega</span>
                  </div>
                </div>
              </div>
            );
            return (
              <div key={reg.id} style={{ background: pago ? '#f8fbf6' : '#fff', border: `1px solid ${pago ? '#cfe6c4' : ent ? '#d4edc4' : '#e8e2da'}`, borderRadius: 10, padding: 12, opacity: ent && !pago ? 0.97 : pago ? 0.9 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  {ent && !pago && (
                    <div onClick={() => selecionavel && toggleSel(reg.id)}
                      title={selecionavel ? 'Selecionar pra pagamento' : 'Defina qtd e valor antes de selecionar'}
                      style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${selecao.has(reg.id) ? '#27ae60' : selecionavel ? '#9fc3b4' : '#dde5ea'}`, background: selecao.has(reg.id) ? '#27ae60' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: selecionavel ? 'pointer' : 'default', flexShrink: 0, opacity: selecionavel ? 1 : 0.5 }}>
                      {selecao.has(reg.id) && <span style={{ color: '#fff', fontSize: 14, fontWeight: 700 }}>✓</span>}
                    </div>
                  )}
                  <FotoPassadoria refProd={reg.ref} />
                  <div style={{ flex: '1 1 200px', minWidth: 150 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                      <span style={{ background: ent ? '#eafbf0' : '#fff8ea', color: ent ? '#27ae60' : '#b7791f', border: `1px solid ${ent ? '#c6e9cf' : '#f0dca8'}`, padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {ent ? '✓ Entregue' : 'Na passadoria'}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: corPassadoria(reg.nome).text, background: corPassadoria(reg.nome).bg, border: `1px solid ${corPassadoria(reg.nome).border}`, borderRadius: 10, padding: '3px 9px' }}><PassadoriaTabIcon size={13} />{reg.nome}</span>
                      {pago && <span style={{ fontSize: 11, fontWeight: 700, color: '#1e7a45', background: '#dff3e4', border: '1px solid #b9e0c4', borderRadius: 10, padding: '3px 9px' }}>💰 Pago {reg.pago_em ? fmtData(reg.pago_em) : ''}</span>}
                      {!pago && (
                        <button onClick={() => setTrocando(reg)} title="Trocar a passadoria (colocou por engano?)"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: '#8a9aa4', padding: 2 }}>✏️</button>
                      )}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#2c3e50' }}>REF {reg.ref}{reg.descricao ? ` · ${reg.descricao}` : ''}</div>
                    <div style={{ fontSize: 11, color: '#8a9aa4', marginTop: 2 }}>
                      🧵 {reg.oficina || '—'}{reg.caseado_nome ? ` · caseado: ${reg.caseado_nome}` : ''} · {reg.qtd != null ? `${reg.qtd} pç` : '—'} · chegou {fmtData(reg.definido_em)}{ent && reg.entregue_em ? ` · entregue ${fmtData(reg.entregue_em)}` : ''}
                    </div>
                    <LinhaPagamento reg={reg} api={api} />
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 46 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, fontFamily: FN, color: (dias >= 7 && !ent) ? '#c0392b' : '#2c3e50' }}>{dias}</div>
                    <div style={{ fontSize: 9, color: '#8a9aa4', textTransform: 'uppercase' }}>{ent ? 'dias' : 'dias na passadoria'}</div>
                  </div>
                  <div onClick={() => api.toggleEntregue(reg)} title={ent ? 'Marcar como não entregue' : 'Marcar como entregue pela passadoria'} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'pointer', minWidth: 56 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 7, background: ent ? '#27ae60' : '#fff', border: ent ? 'none' : '2px solid #c0d0dc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {ent && <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 9, color: '#8a9aa4', textTransform: 'uppercase' }}>Entrega</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {gerenciar && <ModalGerenciarPassadorias api={api} onClose={() => setGerenciar(false)} />}
      {modalLog && <ModalLogPassadoria onClose={() => setModalLog(false)} />}
      {trocando && (
        <ModalDefinirPassadoria
          corte={{ id: trocando.corte_id, ref: trocando.ref, descricao: trocando.descricao, oficina: trocando.oficina, qtd: trocando.qtd }}
          api={api} registroAtual={trocando} caseadoNome={trocando.caseado_nome}
          onClose={() => setTrocando(null)} />
      )}
      {modalPag && (
        <ModalPagamentoPassadoria
          regs={registros.filter(r => selecao.has(r.id))}
          isAdmin={isAdmin}
          onGravar={async (regsPagar, ajuste) => {
            const r = await api.registrarPagamento(regsPagar, ajuste);
            if (r?.ok) {
              // 1 lançamento por passadoria no financeiro (Despesas → Passadoria).
              // 31/08 (pedido dele): o AJUSTE (transporte etc.) soma no valor
              // lançado — cortes 4.239 + transporte 500 = despesa 4.739. O
              // modal só habilita ajuste com UMA passadoria no lote.
              if (onLancarDespesa) {
                const porNome = {};
                regsPagar.forEach(g => {
                  const t = (g.qtd_pagar ?? 0) * (g.valor_unit ?? 0);
                  porNome[g.nome] = (porNome[g.nome] || 0) + t;
                });
                if (ajuste?.valor) {
                  const unico = Object.keys(porNome)[0];
                  if (unico) porNome[unico] += ajuste.valor;
                }
                Object.entries(porNome).forEach(([nome, total]) => {
                  onLancarDespesa({ passadoria: nome, total: Math.round(total * 100) / 100, pagamentoId: r.pagamentoId, qtdCortes: regsPagar.filter(g => g.nome === nome).length });
                });
              }
              setSelecao(new Set());
            }
            return r;
          }}
          onClose={() => setModalPag(false)} />
      )}
    </div>
  );
}

// ── Modal de pagamento (lote selecionado) ────────────────────────────────────
function ModalPagamentoPassadoria({ regs, isAdmin, onGravar, onClose }) {
  const [status, setStatus] = useState('idle'); // idle | gravando | ok | erro
  // 31/08 (pedido dele): ACRESCIMO ou DESCONTO sobre a soma dos cortes — ex.
  // acordo de ajudar no transporte: cortes 4.239 + transporte 500 = despesa
  // 4.739 na planilha. Negativo = desconto. So com UMA passadoria no lote,
  // senao nao da pra saber de quem e o ajuste.
  const [ajusteValor, setAjusteValor] = useState('');
  const [ajusteMotivo, setAjusteMotivo] = useState('');
  const fmtBRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const linhas = regs.map(r => ({ ...r, total: (r.qtd_pagar ?? 0) * (r.valor_unit ?? 0) }));
  const somaGeral = linhas.reduce((s, l) => s + l.total, 0);
  const nomes = [...new Set(linhas.map(l => l.nome))];
  const ajusteHabilitado = nomes.length === 1;
  const nAjuste = ajusteHabilitado ? (parseFloat(String(ajusteValor).replace('.', '').replace(',', '.')) || 0) : 0;
  const totalFinal = somaGeral + nAjuste;

  const gerarPdf = () => {
    const hoje = new Date().toLocaleDateString('pt-BR');
    const porNome = nomes.map(n => ({ nome: n, ls: linhas.filter(l => l.nome === n) }));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Demonstrativo Passadoria</title>
<style>
  body{font-family:Georgia,serif;color:#2c3e50;margin:32px;}
  h1{font-size:20px;margin:0 0 2px;} .sub{color:#6b7c8a;font-size:12px;margin-bottom:20px;}
  h2{font-size:15px;margin:22px 0 8px;display:flex;align-items:center;gap:6px;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  th{background:#4a7fa5;color:#fff;padding:7px 8px;text-align:left;font-weight:600;}
  td{padding:7px 8px;border-bottom:1px solid #e2e8ee;}
  td.n,th.n{text-align:right;font-family:Calibri,Arial,sans-serif;}
  .subtotal td{font-weight:700;background:#f2f7fb;}
  .total{margin-top:22px;font-size:16px;font-weight:700;text-align:right;border-top:2px solid #2c3e50;padding-top:10px;}
  .rodape{margin-top:28px;font-size:11px;color:#8a9aa4;}
  @media print{.noprint{display:none}}
</style></head><body>
<h1>Grupo Am&iacute;cia &mdash; Demonstrativo de Pagamento</h1>
<div class="sub">Passadoria &middot; emitido em ${hoje}</div>
${porNome.map(g => `
  <h2>&#128204; ${g.nome}</h2>
  <table>
    <tr><th>Entrega</th><th>REF</th><th>Descri&ccedil;&atilde;o</th><th>Marca</th><th class="n">Qtd</th><th class="n">Valor p&ccedil;</th><th class="n">Total</th></tr>
    ${g.ls.map(l => `<tr>
      <td>${l.entregue_em ? new Date(l.entregue_em).toLocaleDateString('pt-BR') : '—'}</td>
      <td>${l.ref || ''}</td><td>${l.descricao || ''}</td><td>${l.marca || ''}</td>
      <td class="n">${l.qtd_pagar ?? ''}</td>
      <td class="n">${Number(l.valor_unit ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
      <td class="n">${Number(l.total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
    </tr>`).join('')}
    <tr class="subtotal"><td colspan="6">Subtotal ${g.nome}</td><td class="n">${g.ls.reduce((s, l) => s + l.total, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td></tr>
  </table>`).join('')}
${nAjuste !== 0 ? `<div style="text-align:right;font-size:13px;margin-top:14px;">Soma dos cortes: R$ ${somaGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}<br/>${nAjuste > 0 ? 'Acr&eacute;scimo' : 'Desconto'}${ajusteMotivo ? ` (${ajusteMotivo})` : ''}: R$ ${nAjuste.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>` : ''}
<div class="total">TOTAL A PAGAR: ${totalFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
<div class="rodape">Demonstrativo gerado pelo APP Financeiro Grupo Am&iacute;cia para envio junto ao comprovante Pix.</div>
<script>window.onload=function(){window.print();};</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  const gravar = async () => {
    if (!isAdmin) { alert('⚠️ Apenas admin pode gravar pagamento. Avisa o Ailson.'); return; }
    if (status !== 'idle') return;
    setStatus('gravando');
    const r = await onGravar(regs, nAjuste !== 0 ? { valor: nAjuste, motivo: ajusteMotivo.trim() } : null);
    if (r?.ok) { setStatus('ok'); setTimeout(onClose, 1200); }
    else setStatus('erro');
  };

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: '#fff', borderRadius: 14, padding: 20, width: 640, maxWidth: '96vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 12px 44px rgba(0,0,0,0.28)' }}>
        <button type="button" onClick={onClose} style={{ position: 'absolute', top: 8, right: 10, width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: '#b0b8c0' }}>×</button>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#2c3e50', fontFamily: 'Georgia,serif', textAlign: 'center', marginBottom: 4 }}>Efetuar pagamento</div>
        <div style={{ fontSize: 12, color: '#6b7c8a', textAlign: 'center', marginBottom: 14 }}>{regs.length} corte(s) · {nomes.join(' · ')}</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['Entrega', 'REF', 'Descrição', 'Marca', 'Qtd', 'Valor pç', 'Total'].map(h => (
                  <th key={h} style={{ background: '#4a7fa5', color: '#fff', padding: '7px 8px', textAlign: ['Qtd', 'Valor pç', 'Total'].includes(h) ? 'right' : 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map(l => (
                <tr key={l.id}>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #e2e8ee', whiteSpace: 'nowrap' }}>{l.entregue_em ? fmtData(l.entregue_em) : '—'}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #e2e8ee', fontWeight: 700 }}>{l.ref}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #e2e8ee' }}>{l.descricao || ''}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #e2e8ee' }}>{l.marca || ''}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #e2e8ee', textAlign: 'right', fontFamily: FN }}>{l.qtd_pagar}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #e2e8ee', textAlign: 'right', fontFamily: FN }}>{Number(l.valor_unit ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td style={{ padding: '7px 8px', borderBottom: '1px solid #e2e8ee', textAlign: 'right', fontFamily: FN, fontWeight: 700 }}>{Number(l.total).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 14, padding: '10px 12px', background: '#f7f9fb', border: '1px solid #e2e8ee', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#2c3e50', marginBottom: 6 }}>Acréscimo ou desconto {!ajusteHabilitado && <span style={{ fontWeight: 400, color: '#8a9aa4' }}>· disponível pagando uma passadoria por vez</span>}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={ajusteValor} disabled={!ajusteHabilitado}
              onChange={e => setAjusteValor(e.target.value.replace(/[^0-9,.-]/g, ''))}
              placeholder="+500 ou -200"
              inputMode="decimal"
              style={{ width: 110, padding: '9px 10px', borderRadius: 8, border: '1.5px solid #e2e8ee', fontSize: 14, fontFamily: FN, color: '#2c3e50', background: ajusteHabilitado ? '#fff' : '#f0f2f4' }} />
            <input value={ajusteMotivo} disabled={!ajusteHabilitado}
              onChange={e => setAjusteMotivo(e.target.value)}
              maxLength={60}
              placeholder="Motivo (ex.: transporte)"
              style={{ flex: 1, minWidth: 160, padding: '9px 10px', borderRadius: 8, border: '1.5px solid #e2e8ee', fontSize: 13, fontFamily: 'Georgia,serif', color: '#2c3e50', background: ajusteHabilitado ? '#fff' : '#f0f2f4' }} />
          </div>
          {nAjuste !== 0 && (
            <div style={{ fontSize: 12, color: nAjuste > 0 ? '#1f6f6b' : '#b7791f', marginTop: 6, fontFamily: FN }}>
              {fmtBRL(somaGeral)} {nAjuste > 0 ? '+' : '−'} {fmtBRL(Math.abs(nAjuste))}{ajusteMotivo ? ` (${ajusteMotivo})` : ''}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', fontSize: 16, fontWeight: 700, color: '#1f6f6b', marginTop: 12, fontFamily: FN }}>
          Total a pagar: {fmtBRL(totalFinal)}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
          <button type="button" onClick={gerarPdf} style={{ flex: 1, minWidth: 180, padding: '12px', fontSize: 14, fontWeight: 700, color: '#2c3e50', background: '#fff', border: '2px solid #4a7fa5', borderRadius: 8, cursor: 'pointer', fontFamily: 'Georgia,serif' }}>🖨 Gerar PDF (demonstrativo)</button>
          <button type="button" onClick={gravar} disabled={status !== 'idle'} style={{ flex: 1, minWidth: 180, padding: '12px', fontSize: 14, fontWeight: 700, color: '#fff', background: status === 'ok' ? '#1e7a45' : '#27ae60', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'Georgia,serif', opacity: status === 'gravando' ? 0.7 : 1 }}>
            {status === 'gravando' ? 'Gravando…' : status === 'ok' ? '✓ Pagamento gravado' : '💰 Gravar pagamentos'}
          </button>
        </div>
        {status === 'ok' && <div style={{ fontSize: 12, color: '#1e7a45', textAlign: 'center', marginTop: 10, fontWeight: 600 }}>Cortes carimbados como pagos e despesa lançada em Lançamentos → Despesas → Passadoria.</div>}
        {status === 'erro' && <div style={{ fontSize: 12, color: '#c0392b', textAlign: 'center', marginTop: 10 }}>Erro ao gravar. Tenta de novo.</div>}
      </div>
    </div>,
    document.body
  );
}

// ── Modal do log (auditoria) ─────────────────────────────────────────────────
function ModalLogPassadoria({ onClose }) {
  const [eventos, setEventos] = useState(null);
  const [filtro, setFiltro] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from('oficinas_passadoria_log')
          .select('*').order('criado_em', { ascending: false }).limit(150);
        setEventos(data || []);
      } catch { setEventos([]); }
    })();
  }, []);
  const termo = filtro.trim().toLowerCase();
  const lista = (eventos || []).filter(e => !termo || String(e.ref || '').toLowerCase().includes(termo) || String(e.acao || '').toLowerCase().includes(termo) || String(e.usuario || '').toLowerCase().includes(termo));
  const fmtDH = (x) => { try { const d = new Date(x); return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
  const corAcao = (a) => a?.includes('pago') ? '#1e7a45' : a?.includes('trocou') ? '#b7791f' : a?.includes('entregue') ? '#4a7fa5' : a?.includes('editou') ? '#8a5ec0' : '#5a6470';
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: '#fff', borderRadius: 14, padding: 20, width: 560, maxWidth: '96vw', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 44px rgba(0,0,0,0.28)' }}>
        <button type="button" onClick={onClose} style={{ position: 'absolute', top: 8, right: 10, width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: '#b0b8c0' }}>×</button>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#2c3e50', fontFamily: 'Georgia,serif', textAlign: 'center', marginBottom: 10 }}>🕘 Log da Passadoria</div>
        <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Filtrar por ref, ação ou usuário..." style={{ ...inputPass, width: '100%', boxSizing: 'border-box', marginBottom: 10, fontSize: 13, padding: '9px 11px' }} />
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {eventos === null ? (
            <div style={{ textAlign: 'center', padding: 16, color: '#a89f94', fontSize: 13 }}>Carregando…</div>
          ) : lista.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16, color: '#a89f94', fontSize: 13 }}>Nenhum evento.</div>
          ) : lista.map(e => (
            <div key={e.id} style={{ padding: '8px 10px', border: '1px solid #eef2f5', borderRadius: 8, background: '#fafcfd' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#8a9aa4', fontFamily: FN, whiteSpace: 'nowrap' }}>{fmtDH(e.criado_em)}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#2c3e50' }}>{e.usuario || '—'}</span>
                {e.ref && <span style={{ fontSize: 11, fontWeight: 700, color: '#4a7fa5' }}>REF {e.ref}</span>}
                <span style={{ fontSize: 12, fontWeight: 700, color: corAcao(e.acao) }}>{e.acao}</span>
              </div>
              {e.detalhe && <div style={{ fontSize: 11, color: '#6b7c8a', marginTop: 2 }}>{e.detalhe}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Modal pra cadastrar/remover passadorias
function ModalGerenciarPassadorias({ api, onClose }) {
  const [novo, setNovo] = useState('');
  const nomes = api?.nomes || [];
  const add = () => { const t = novo.trim(); if (!t) return; api.addNome(t); setNovo(''); };
  const rem = (n) => { if (window.confirm(`Remover a passadoria "${n}"? Não apaga os cortes já definidos com esse nome.`)) api.removeNome(n); };
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: '#fff', borderRadius: 14, padding: 20, width: 400, maxWidth: '94vw', boxShadow: '0 12px 44px rgba(0,0,0,0.28)' }}>
        <button type="button" onClick={onClose} aria-label="Fechar" style={{ position: 'absolute', top: 8, right: 10, width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: '#b0b8c0' }}>×</button>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#2c3e50', fontFamily: 'Georgia,serif', textAlign: 'center', marginBottom: 3 }}>Gerenciar passadorias</div>
        <div style={{ fontSize: 12, color: '#6b7c8a', textAlign: 'center', marginBottom: 16 }}>Cadastre ou remova passadorias.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, maxHeight: '46vh', overflowY: 'auto' }}>
          {nomes.map(n => (
            <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', border: '1px solid #e2e8ee', borderRadius: 8, background: '#f6f9fc' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 15, fontWeight: 600, color: '#2c3e50' }}><PassadoriaTabIcon size={15} />{n}</span>
              <button type="button" onClick={() => rem(n)} style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, color: '#c0392b', background: '#fbeaea', border: '1px solid #f0d0d0', borderRadius: 6, cursor: 'pointer' }}>Remover</button>
            </div>
          ))}
          {nomes.length === 0 && <div style={{ fontSize: 13, color: '#a89f94', textAlign: 'center', padding: '8px 0' }}>Nenhuma passadoria cadastrada ainda.</div>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={novo} onChange={e => setNovo(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} placeholder="Nome da passadoria" style={{ ...inputPass, flex: 1, minWidth: 0, boxSizing: 'border-box' }} />
          <button type="button" onClick={add} style={{ padding: '10px 16px', fontSize: 14, fontWeight: 600, color: '#fff', background: '#4a7fa5', border: 'none', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ Adicionar</button>
        </div>
      </div>
    </div>
  );
}
