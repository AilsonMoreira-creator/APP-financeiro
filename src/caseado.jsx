/**
 * caseado.jsx — Módulo Caseado (pregar botão) do módulo Oficinas
 *
 * Caseado é por CORTE (cada lançamento independente). O ícone de botão aparece
 * na lista de cortes só pros refs cujo custo "botao" (Botão/Caseado) > 0 — valor
 * lido da Calculadora (calc-meluni.prods) OU da Ficha Técnica (ficha-tecnica.produtos).
 *
 * Multi-usuário igual ao Salas Corte:
 *   - registros do caseado: tabela relacional public.oficinas_caseado (realtime *)
 *   - cadastro de nomes (Nando/José...): payload amicia_data user_id='caseado-config'
 *
 * Fluxo: oficina entrega o corte -> fica disponível pro caseado (bolinha amarela
 * ao lado do ícone) -> define o caseado no modal (bolinha some, vira card na tela
 * Caseado) -> caseado entrega (checkbox na tela Caseado).
 *
 * Exporta: useCaseado() (hook), CaseadoBtnIcone (ícone na linha), e
 * ModalDefinirCaseado. A tela Caseado completa entra na Etapa 2.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabase.js';

// ── Helpers ────────────────────────────────────────────────────────────────
// Normaliza ref tirando zeros à esquerda (0020 ≡ 20). Mesmo padrão do app.
export function normRef(ref) {
  return String(ref ?? '').replace(/^0+/, '') || '0';
}
// "botao" é string ("", "2.50", "2,50"). Considera caseado se > 0.
function botaoPositivo(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0;
}
function getUsuario() {
  try {
    const s = localStorage.getItem('amica_session');
    if (!s) return 'sistema';
    const u = JSON.parse(s);
    return u.usuario || u.nome || 'sistema';
  } catch { return 'sistema'; }
}
function buildRefsSet(calcPayload, fichaPayload) {
  const set = new Set();
  (calcPayload?.prods || []).forEach(p => { if (botaoPositivo(p?.botao)) set.add(normRef(p?.ref)); });
  (fichaPayload?.produtos || []).forEach(p => { if (botaoPositivo(p?.botao)) set.add(normRef(p?.ref)); });
  return set;
}

const NOMES_PADRAO = ['Nando', 'José'];

// ── Hook principal ───────────────────────────────────────────────────────────
export function useCaseado() {
  const [registros, setRegistros] = useState([]);
  const [nomes, setNomes] = useState(NOMES_PADRAO);
  const [refsSet, setRefsSet] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  // guarda os payloads de custo pra rebuild quando um deles mudar via realtime
  const calcRef = useRef(null);
  const fichaRef = useRef(null);

  const carregarRegistros = useCallback(async () => {
    try {
      const { data } = await supabase.from('oficinas_caseado').select('*');
      if (Array.isArray(data)) setRegistros(data);
    } catch (e) { console.warn('[caseado] registros:', e?.message); }
  }, []);

  const carregarNomes = useCallback(async () => {
    try {
      const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'caseado-config').maybeSingle();
      const ns = data?.payload?.nomes;
      if (Array.isArray(ns) && ns.length > 0) setNomes(ns);
    } catch (e) { console.warn('[caseado] nomes:', e?.message); }
  }, []);

  const carregarCustos = useCallback(async () => {
    try {
      const [rCalc, rFicha] = await Promise.all([
        supabase.from('amicia_data').select('payload').eq('user_id', 'calc-meluni').maybeSingle(),
        supabase.from('amicia_data').select('payload').eq('user_id', 'ficha-tecnica').maybeSingle(),
      ]);
      calcRef.current = rCalc.data?.payload || null;
      fichaRef.current = rFicha.data?.payload || null;
      setRefsSet(buildRefsSet(calcRef.current, fichaRef.current));
    } catch (e) { console.warn('[caseado] custos:', e?.message); }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      await Promise.all([carregarRegistros(), carregarNomes(), carregarCustos()]);
      if (vivo) setLoading(false);
    })();

    // Realtime: tabela de registros (qualquer mudança recarrega) + payloads de
    // config/custo (cada um atualiza sua parte). Igual padrão Salas Corte.
    const ch = supabase.channel('caseado-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'oficinas_caseado' }, () => carregarRegistros())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'amicia_data', filter: 'user_id=eq.caseado-config' },
        (payload) => { const ns = payload?.new?.payload?.nomes; if (Array.isArray(ns) && ns.length > 0) setNomes(ns); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'amicia_data', filter: 'user_id=eq.calc-meluni' },
        (payload) => { calcRef.current = payload?.new?.payload || calcRef.current; setRefsSet(buildRefsSet(calcRef.current, fichaRef.current)); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'amicia_data', filter: 'user_id=eq.ficha-tecnica' },
        (payload) => { fichaRef.current = payload?.new?.payload || fichaRef.current; setRefsSet(buildRefsSet(calcRef.current, fichaRef.current)); })
      .subscribe();

    return () => { vivo = false; try { supabase.removeChannel(ch); } catch {} };
  }, [carregarRegistros, carregarNomes, carregarCustos]);

  const precisaCaseado = useCallback((ref) => refsSet.has(normRef(ref)), [refsSet]);
  const registroPorCorte = useCallback((corteId) => registros.find(r => String(r.corte_id) === String(corteId)) || null, [registros]);

  // Define (ou troca) o caseado de um corte. definido_em sobe pra agora (ordena topo).
  // Não mexe em entregue/entregue_em (preserva quando troca o nome).
  const definir = useCallback(async (corte, nome) => {
    const row = {
      corte_id: corte.id,
      ref: corte.ref ?? null,
      descricao: corte.descricao ?? null,
      marca: corte.marca ?? null,
      oficina: corte.oficina ?? null,
      qtd: corte.qtd ?? null,
      nome,
      definido_por: getUsuario(),
      definido_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('oficinas_caseado').upsert(row, { onConflict: 'corte_id' });
    if (error) { console.error('[caseado] definir:', error.message); return { ok: false, erro: error.message }; }
    await carregarRegistros();
    return { ok: true };
  }, [carregarRegistros]);

  // Marca/desmarca entrega do caseado (independente do "entregue" do corte/oficina).
  const toggleEntregue = useCallback(async (registro) => {
    if (!registro?.id) return { ok: false };
    const novo = !registro.entregue;
    const { error } = await supabase.from('oficinas_caseado').update({
      entregue: novo,
      entregue_por: novo ? getUsuario() : null,
      entregue_em: novo ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', registro.id);
    if (error) { console.error('[caseado] entregue:', error.message); return { ok: false, erro: error.message }; }
    await carregarRegistros();
    return { ok: true };
  }, [carregarRegistros]);

  // Remove o caseado de um corte (volta ao estado original, sem caseado).
  // Reflete na tela Caseado (some o card) via realtime.
  const remover = useCallback(async (corteId) => {
    const { error } = await supabase.from('oficinas_caseado').delete().eq('corte_id', corteId);
    if (error) { console.error('[caseado] remover:', error.message); return { ok: false, erro: error.message }; }
    await carregarRegistros();
    return { ok: true };
  }, [carregarRegistros]);

  const salvarNomes = useCallback(async (novos) => {
    setNomes(novos);
    try {
      await supabase.from('amicia_data').upsert(
        { user_id: 'caseado-config', payload: { nomes: novos, _updated: new Date().toISOString() } },
        { onConflict: 'user_id' });
    } catch (e) { console.error('[caseado] salvarNomes:', e?.message); }
  }, []);
  const addNome = useCallback((n) => {
    const t = String(n || '').trim();
    if (!t) return;
    setNomes(prev => (prev.includes(t) ? prev : (salvarNomes([...prev, t]), [...prev, t])));
  }, [salvarNomes]);
  const removeNome = useCallback((n) => {
    setNomes(prev => { const novos = prev.filter(x => x !== n); salvarNomes(novos); return novos; });
  }, [salvarNomes]);

  return { registros, nomes, loading, precisaCaseado, registroPorCorte, definir, toggleEntregue, remover, addNome, removeNome };
}

// ── Ícone de botão (camisa) na linha do corte ────────────────────────────────
function SvgBotaoCamisa({ definido }) {
  const fill = definido ? '#27ae60' : '#fff';
  const stroke = definido ? '#1e8449' : '#4a7fa5';
  const furo = definido ? '#fff' : '#4a7fa5';
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="9" fill={fill} stroke={stroke} strokeWidth="1.6" />
      <circle cx="9.4" cy="9.4" r="1.4" fill={furo} />
      <circle cx="14.6" cy="9.4" r="1.4" fill={furo} />
      <circle cx="9.4" cy="14.6" r="1.4" fill={furo} />
      <circle cx="14.6" cy="14.6" r="1.4" fill={furo} />
    </svg>
  );
}

export function CaseadoBtnIcone({ corte, api }) {
  const [modal, setModal] = useState(false);
  if (!api?.precisaCaseado?.(corte?.ref)) return null;

  const reg = api.registroPorCorte(corte.id);
  const definido = !!reg;
  // bolinha amarela: corte entregue pela oficina (disponível pro caseado) e ainda sem caseado definido
  const mostrarBolinha = !!corte?.entregue && !definido;
  const titulo = definido ? `Caseado: ${reg.nome}${reg.entregue ? ' (entregue)' : ''}` : 'Definir caseado';

  return (
    <>
      <button
        type="button"
        title={titulo}
        onClick={(e) => { e.stopPropagation(); setModal(true); }}
        style={{
          position: 'relative', width: 16, height: 16, borderRadius: 4,
          background: definido ? '#eafaf0' : '#fff', border: `1px solid ${definido ? '#bfe6cd' : '#c8d8e4'}`,
          cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}
      >
        <SvgBotaoCamisa definido={definido} />
        {mostrarBolinha && (
          <span title="Disponível pro caseado" style={{ position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: '50%', background: '#f0b429', border: '1.5px solid #fff' }} />
        )}
      </button>
      {modal && (
        <ModalDefinirCaseado corte={corte} api={api} registroAtual={reg} onClose={() => setModal(false)} />
      )}
    </>
  );
}

// ── Modal "Definir Caseado" ──────────────────────────────────────────────────
export function ModalDefinirCaseado({ corte, api, registroAtual, onClose }) {
  const [escolhido, setEscolhido] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | salvando | ok | removendo | removido | erro
  const timerRef = useRef(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const ocupado = status === 'salvando' || status === 'ok' || status === 'removendo' || status === 'removido';

  const escolher = async (nome) => {
    if (ocupado) return;
    setEscolhido(nome);
    setStatus('salvando');
    const r = await api.definir(corte, nome);
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

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'relative', background: '#fff', borderRadius: 14, padding: 20, width: 360, maxWidth: '92vw', boxShadow: '0 12px 44px rgba(0,0,0,0.28)' }}>
        <button type="button" onClick={onClose} aria-label="Fechar" style={{ position: 'absolute', top: 8, right: 10, width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer', fontSize: 22, lineHeight: 1, color: '#b0b8c0' }}>×</button>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#2c3e50', fontFamily: 'Georgia,serif', textAlign: 'center', marginBottom: 4 }}>Definir Caseado</div>
        <div style={{ fontSize: 12, color: '#6b7c8a', textAlign: 'center', marginBottom: 16 }}>
          Ref {corte?.ref} · {corte?.descricao || ''}{corte?.oficina ? ` · ${corte.oficina}` : ''}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(api?.nomes || []).map(nome => {
            const ehAtual = registroAtual?.nome === nome;
            const sel = escolhido === nome;
            const destaque = sel || (ehAtual && !escolhido && status !== 'removido');
            return (
              <button key={nome} type="button" disabled={ocupado} onClick={() => escolher(nome)}
                style={{
                  position: 'relative', padding: '15px 14px', borderRadius: 10,
                  cursor: ocupado ? 'default' : 'pointer',
                  border: `2px solid ${destaque ? '#27ae60' : '#e2e8ee'}`,
                  background: destaque ? '#eafaf0' : '#f6f9fc',
                  textAlign: 'center', opacity: (escolhido && !sel) ? 0.45 : 1,
                }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#2c3e50' }}>{nome}</span>
                {destaque && (
                  <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#27ae60', fontWeight: 700, fontSize: 13 }}>
                    {sel && status === 'salvando' ? 'salvando...' : sel && status === 'ok' ? '✓ definido' : '✓'}
                  </span>
                )}
              </button>
            );
          })}
          {(!api?.nomes || api.nomes.length === 0) && (
            <div style={{ fontSize: 13, color: '#a89f94', textAlign: 'center', padding: '8px 0' }}>Nenhum caseado cadastrado. Cadastre na tela Caseado.</div>
          )}
        </div>
        {status === 'ok' && (
          <div style={{ fontSize: 13, color: '#27ae60', fontWeight: 700, textAlign: 'center', marginTop: 14 }}>✓ Caseado definido: {escolhido}</div>
        )}
        {status === 'removido' && (
          <div style={{ fontSize: 13, color: '#6b7c8a', fontWeight: 700, textAlign: 'center', marginTop: 14 }}>Caseado removido</div>
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
    </div>
  );
}
