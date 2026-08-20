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
    const row = {
      corte_id: corte.id,
      ref: corte.ref ?? null,
      descricao: corte.descricao ?? null,
      marca: corte.marca ?? null,
      oficina: corte.oficina ?? null,
      caseado_nome: caseadoNome ?? null,
      qtd: corte.qtd ?? null,
      nome,
      definido_por: getUsuario(),
      definido_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('oficinas_passadoria').upsert(row, { onConflict: 'corte_id' });
    if (error) { console.error('[passadoria] definir:', error.message); return { ok: false, erro: error.message }; }
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
    await carregarRegistros();
    return { ok: true };
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

  return { registros, nomes, loading, registroPorCorte, definir, toggleEntregue, remover, addNome, removeNome };
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

function diasNaPassadoria(reg) {
  if (!reg?.definido_em) return 0;
  const ini = new Date(reg.definido_em).getTime();
  const fim = reg.entregue && reg.entregue_em ? new Date(reg.entregue_em).getTime() : Date.now();
  return Math.max(0, Math.floor((fim - ini) / 86400000));
}
function fmtData(x) { try { return new Date(x).toLocaleDateString('pt-BR'); } catch { return '—'; } }

const inputPass = { padding: '11px 12px', fontSize: 15, border: '1px solid #d8e2ea', borderRadius: 8, fontFamily: 'Georgia,serif', color: '#2c3e50', outline: 'none', background: '#fff', colorScheme: 'light', WebkitAppearance: 'none', appearance: 'none' };
function chipStyle(active) {
  return { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: `1px solid ${active ? '#4a7fa5' : '#d8e2ea'}`, background: active ? '#4a7fa5' : '#fff', color: active ? '#fff' : '#5a6470', whiteSpace: 'nowrap', lineHeight: 1.2 };
}

// ── Tela Passadoria (aba ao lado de Caseado no módulo Oficinas) ──────────────
export function TelaPassadoria({ api }) {
  const [busca, setBusca] = useState('');
  const [nomeFiltro, setNomeFiltro] = useState('todos');
  const [statusFiltro, setStatusFiltro] = useState('todos'); // todos | aberto | entregue
  const [gerenciar, setGerenciar] = useState(false);
  const registros = api?.registros || [];
  const nomes = api?.nomes || [];

  const termo = busca.trim().toLowerCase();
  let lista = registros.filter(r => {
    if (statusFiltro === 'aberto' && r.entregue) return false;
    if (statusFiltro === 'entregue' && !r.entregue) return false;
    if (nomeFiltro !== 'todos' && r.nome !== nomeFiltro) return false;
    if (termo) { const hay = (String(r.ref || '') + ' ' + String(r.descricao || '')).toLowerCase(); if (!hay.includes(termo)) return false; }
    return true;
  });
  lista = [...lista].sort((a, b) => {
    if (!!a.entregue !== !!b.entregue) return a.entregue ? 1 : -1;
    const ta = new Date(a.entregue && a.entregue_em ? a.entregue_em : a.definido_em).getTime();
    const tb = new Date(b.entregue && b.entregue_em ? b.entregue_em : b.definido_em).getTime();
    return tb - ta;
  });
  const nAbertos = registros.filter(r => !r.entregue).length;
  const nEntregues = registros.filter(r => r.entregue).length;
  const contaPorNome = (n) => registros.filter(r => r.nome === n).length;

  return (
    <div>
      {/* Filtro por passadoria (chips) + gerenciar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <button onClick={() => setNomeFiltro('todos')} style={chipStyle(nomeFiltro === 'todos')}>Todas ({registros.length})</button>
        {nomes.map(n => (
          <button key={n} onClick={() => setNomeFiltro(n)} style={chipStyle(nomeFiltro === n)}><PassadoriaTabIcon size={13} />{n} ({contaPorNome(n)})</button>
        ))}
        <button onClick={() => setGerenciar(true)} title="Cadastrar / remover passadorias" style={{ marginLeft: 'auto', padding: '8px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid #d8e2ea', background: '#fff', color: '#5a6470', cursor: 'pointer', whiteSpace: 'nowrap' }}>⚙ Gerenciar</button>
      </div>

      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar ref ou descrição..." style={{ ...inputPass, width: '100%', boxSizing: 'border-box', marginBottom: 8 }} />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <button onClick={() => setStatusFiltro('todos')} style={chipStyle(statusFiltro === 'todos')}>Todos</button>
        <button onClick={() => setStatusFiltro('aberto')} style={chipStyle(statusFiltro === 'aberto')}>Em aberto</button>
        <button onClick={() => setStatusFiltro('entregue')} style={chipStyle(statusFiltro === 'entregue')}>Entregues</button>
        <span style={{ fontSize: 12, color: '#8a9aa4', marginLeft: 'auto' }}>{nAbertos} aberto(s) · {nEntregues} entregue(s)</span>
      </div>

      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30, color: '#a89f94', fontSize: 14 }}>
          {registros.length === 0 ? 'Nenhum corte na passadoria ainda. Defina pelo ícone de ferro na lista de Cortes.' : 'Nenhum resultado pros filtros.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lista.map(reg => {
            const dias = diasNaPassadoria(reg);
            const ent = !!reg.entregue;
            return (
              <div key={reg.id} style={{ background: '#fff', border: `1px solid ${ent ? '#d4edc4' : '#e8e2da'}`, borderRadius: 10, padding: 12, opacity: ent ? 0.92 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <FotoPassadoria refProd={reg.ref} />
                  <div style={{ flex: '1 1 200px', minWidth: 150 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                      <span style={{ background: ent ? '#eafbf0' : '#fff8ea', color: ent ? '#27ae60' : '#b7791f', border: `1px solid ${ent ? '#c6e9cf' : '#f0dca8'}`, padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {ent ? '✓ Entregue' : 'Na passadoria'}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: '#1f6f6b', background: '#e8f6f5', border: '1px solid #c2e4e2', borderRadius: 10, padding: '3px 9px' }}><PassadoriaTabIcon size={13} />{reg.nome}</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#2c3e50' }}>REF {reg.ref}{reg.descricao ? ` · ${reg.descricao}` : ''}</div>
                    <div style={{ fontSize: 11, color: '#8a9aa4', marginTop: 2 }}>
                      🧵 {reg.oficina || '—'}{reg.caseado_nome ? ` · caseado: ${reg.caseado_nome}` : ''} · {reg.qtd != null ? `${reg.qtd} pç` : '—'} · chegou {fmtData(reg.definido_em)}{ent && reg.entregue_em ? ` · entregue ${fmtData(reg.entregue_em)}` : ''}
                    </div>
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
    </div>
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
