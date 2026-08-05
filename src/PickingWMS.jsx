/**
 * PickingWMS.jsx — módulo Picking WMS (Ailson 05/08/2026)
 * Separação de pedidos dos marketplaces (Bling: Exitus, Lumia, Muniam).
 * Padrão visual do módulo Meluni: palette/FONT do Lojas_Shared, ícones lucide
 * vazados, multiusuário via checkbox do editor de Usuários (id 'wms').
 *
 * Telas: Dashboard (contadores + prazos) e Lista de Separação (filtros por
 * conta/loja, ordenação por ref ou localização, matriz ou lista, fotos,
 * mono-SKU agregado por ref + multi-SKU por pedido, impressão).
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Package, ClipboardList, RefreshCw, Printer, ArrowLeft, CheckCircle2, Clock, Boxes, Undo2 } from 'lucide-react';
import { palette, FONT } from './Lojas_Shared.jsx';

const API = '/api';
const CONTAS = ['exitus', 'lumia', 'muniam'];
const NOME_CONTA = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
const ORDEM_TAM = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', 'G4', 'G5', 'XG', 'XGG'];
const idxTam = (t) => { const i = ORDEM_TAM.indexOf(String(t || '').toUpperCase()); return i === -1 ? 99 : i; };

// ── Foto do produto (bucket produtos/{ref}) — cascata jpg/png/webp + pads ──
function FotoRef({ refProd, size = 54 }) {
  const sbUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL)
    || (typeof localStorage !== 'undefined' && localStorage.getItem('sb_url')) || '';
  const base = sbUrl ? `${sbUrl}/storage/v1/object/public/produtos/` : '';
  const ph = (
    <div style={{ width: size, height: Math.round(size * 1.27), borderRadius: 6, background: 'linear-gradient(135deg,#f0ebe3,#e8e2da)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e8e2da', flexShrink: 0, color: '#c0b8b0', fontSize: 15 }}>📷</div>
  );
  if (!base || !refProd) return ph;
  const orig = String(refProd).toUpperCase();
  const norm = orig.replace(/^0+/, '') || '0';
  const urls = [norm + '.jpg', norm + '.png', norm + '.webp'];
  if (orig !== norm) urls.push(orig + '.jpg', orig + '.png', orig + '.webp');
  const p4 = norm.padStart(4, '0');
  if (p4 !== norm) urls.push(p4 + '.jpg', p4 + '.png', p4 + '.webp');
  const cb = '?v=' + new Date().toISOString().slice(0, 10);
  return (
    <img src={base + urls[0] + cb} alt={`REF ${refProd}`} loading="lazy"
      style={{ width: size, height: Math.round(size * 1.27), borderRadius: 6, objectFit: 'cover', border: '1px solid #e8e2da', flexShrink: 0, background: '#f4f0ea' }}
      onError={(e) => {
        const cur = e.target.src;
        const idx = urls.findIndex(u => cur.includes(u));
        if (idx >= 0 && idx < urls.length - 1) e.target.src = base + urls[idx + 1] + cb;
        else { e.target.style.display = 'none'; }
      }} />
  );
}

// ── Agregação: pedidos mono-SKU → por ref {cores{cor:{tam:qtd}}, tamanhos, pedidos, pecas, loc} ──
function agregarMonoSku(pedidos) {
  const porRef = new Map();
  for (const p of pedidos) {
    if (p.multi_sku) continue;
    for (const it of (p.itens || [])) {
      const ref = it.ref || '(sem ref)';
      const g = porRef.get(ref) || { ref, loc: '', cores: {}, pedidosSet: new Set(), pecas: 0, descLimpa: it.descLimpa || '' };
      if (it.estoque && !g.loc) g.loc = it.estoque;
      if (!g.descLimpa && it.descLimpa) g.descLimpa = it.descLimpa;
      const cor = it.cor || '—';
      const tam = String(it.tamanho || '—').toUpperCase();
      g.cores[cor] = g.cores[cor] || {};
      g.cores[cor][tam] = (g.cores[cor][tam] || 0) + (it.quantidade || 1);
      g.pedidosSet.add(p.id);
      g.pecas += it.quantidade || 1;
      porRef.set(ref, g);
    }
  }
  return [...porRef.values()].map(g => {
    const tamsSet = new Set();
    Object.values(g.cores).forEach(m => Object.keys(m).forEach(t => tamsSet.add(t)));
    const tamanhos = [...tamsSet].sort((a, b) => idxTam(a) - idxTam(b));
    return { ...g, pedidos: g.pedidosSet.size, tamanhos, nCores: Object.keys(g.cores).length };
  });
}

// ── Matriz cores × tamanhos (padrão módulo oficina) ──
function MatrizRef({ g }) {
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: 12.5, fontFamily: FONT }}>
      <thead><tr>
        <th style={thTd(true)}></th>
        {g.tamanhos.map(t => <th key={t} style={thTd(true)}>{t}</th>)}
        <th style={thTd(true)}>Σ</th>
      </tr></thead>
      <tbody>
        {Object.keys(g.cores).sort().map(cor => {
          const soma = Object.values(g.cores[cor]).reduce((s, v) => s + v, 0);
          return (
            <tr key={cor}>
              <td style={{ ...thTd(), fontWeight: 700, textAlign: 'left' }}>{cor}</td>
              {g.tamanhos.map(t => (
                <td key={t} style={{ ...thTd(), fontWeight: g.cores[cor][t] ? 800 : 400, color: g.cores[cor][t] ? palette.ink : '#c8c0b6' }}>
                  {g.cores[cor][t] || '·'}
                </td>
              ))}
              <td style={{ ...thTd(), fontWeight: 800, background: '#faf6ef' }}>{soma}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
const thTd = (head) => ({
  border: '1px solid #e8e2da', padding: '4px 9px', textAlign: 'center',
  background: head ? '#f4f0ea' : '#fff', fontWeight: head ? 800 : undefined,
  color: head ? palette.inkSoft : undefined, fontSize: head ? 11.5 : undefined,
});

// ── Lista cor+tamanho (PP→G3) ──
function ListaRef({ g }) {
  const linhas = [];
  for (const cor of Object.keys(g.cores).sort()) {
    for (const t of Object.keys(g.cores[cor]).sort((a, b) => idxTam(a) - idxTam(b))) {
      linhas.push({ cor, t, q: g.cores[cor][t] });
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13.5 }}>
      {linhas.map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: 8 }}>
          <span style={{ fontWeight: 800, minWidth: 26, textAlign: 'right' }}>{l.q}</span>
          <span>{l.cor} <b>{l.t}</b></span>
        </div>
      ))}
    </div>
  );
}

export default function PickingWMS({ userId = '', isAdmin = false, onBack }) {
  const [tela, setTela] = useState('dashboard'); // dashboard | separacao
  const [dash, setDash] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  // filtros da lista de separação
  const [fConta, setFConta] = useState('todas');
  const [fLoja, setFLoja] = useState('todas');
  const [fStatus, setFStatus] = useState('aberto'); // aberto | em_separacao
  const [ordem, setOrdem] = useState('qtd');        // qtd | loc
  const [visual, setVisual] = useState('auto');     // auto | matriz | lista
  const [pedidos, setPedidos] = useState([]);
  const [imprimindo, setImprimindo] = useState(false);

  const carregarDash = useCallback(async () => {
    try {
      const r = await fetch(`${API}/wms-listas?acao=dashboard`);
      const d = await r.json();
      if (d.ok) setDash(d);
    } catch (e) { setErro(e.message); }
  }, []);
  useEffect(() => { carregarDash(); }, [carregarDash]);

  const sincronizar = async () => {
    setSincronizando(true); setErro('');
    try {
      const r = await fetch(`${API}/wms-sync`, { method: 'POST' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'sync falhou');
      await carregarDash();
      if (tela === 'separacao') await carregarPedidos();
    } catch (e) { setErro('Sync: ' + e.message); }
    setSincronizando(false);
  };

  const carregarPedidos = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const r = await fetch(`${API}/wms-listas?acao=pedidos&status=${fStatus}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'falhou');
      setPedidos(d.pedidos || []);
    } catch (e) { setErro(e.message); }
    setCarregando(false);
  }, [fStatus]);
  useEffect(() => { if (tela === 'separacao') carregarPedidos(); }, [tela, carregarPedidos]);

  // lojas disponíveis (canal_geral) conforme filtro de conta
  const lojasDisponiveis = useMemo(() => {
    const s = new Set();
    for (const p of pedidos) {
      if (fConta !== 'todas' && p.conta !== fConta) continue;
      if (p.canal_geral) s.add(p.canal_geral);
    }
    return [...s].sort();
  }, [pedidos, fConta]);

  const pedidosFiltrados = useMemo(() => pedidos.filter(p =>
    (fConta === 'todas' || p.conta === fConta) &&
    (fLoja === 'todas' || p.canal_geral === fLoja)
  ), [pedidos, fConta, fLoja]);

  // blocos por conta (padrão: as 3 separadas)
  const blocos = useMemo(() => {
    const contas = fConta === 'todas' ? CONTAS : [fConta];
    return contas.map(conta => {
      const doConta = pedidosFiltrados.filter(p => p.conta === conta);
      const mono = agregarMonoSku(doConta);
      mono.sort((a, b) => ordem === 'loc'
        ? (a.loc || 'Z').localeCompare(b.loc || 'Z') || b.pecas - a.pecas
        : b.pecas - a.pecas);
      const multi = doConta.filter(p => p.multi_sku);
      return { conta, mono, multi, nPedidos: doConta.length, nPecas: doConta.reduce((s, p) => s + (p.qtd_pecas || 0), 0) };
    }).filter(b => b.nPedidos > 0);
  }, [pedidosFiltrados, fConta, ordem]);

  const usaMatriz = (g) => visual === 'matriz' || (visual === 'auto' && g.nCores > 1 && g.tamanhos.length > 2);

  const imprimirLista = async () => {
    const ids = pedidosFiltrados.map(p => p.id);
    if (!ids.length) return;
    if (!window.confirm(`Imprimir a lista e iniciar a separação de ${ids.length} pedidos?\n\nEles saem de "Abertos" e entram em "Em separação".`)) return;
    setImprimindo(true);
    try {
      const r = await fetch(`${API}/wms-listas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'imprimir', pedido_ids: ids, criado_por: userId, filtros: { conta: fConta, loja: fLoja, ordem } }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'falhou');
      setTimeout(() => window.print(), 300);
      await carregarDash();
      setFStatus('em_separacao');
    } catch (e) { setErro('Imprimir: ' + e.message); }
    setImprimindo(false);
  };

  const reimprimir = () => window.print();

  const finalizarLista = async () => {
    const ids = pedidosFiltrados.map(p => p.id);
    if (!ids.length) return;
    if (!window.confirm(`Marcar ${ids.length} pedidos como finalizados?\n\n(Na fase 2 a bipagem vai fazer isso automaticamente e mudar a situação no Bling pra Verificado.)`)) return;
    try {
      const r = await fetch(`${API}/wms-listas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'finalizar', pedido_ids: ids }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'falhou');
      await carregarDash(); await carregarPedidos();
    } catch (e) { setErro(e.message); }
  };

  const voltarPraAbertos = async () => {
    const ids = pedidosFiltrados.map(p => p.id);
    if (!ids.length) return;
    if (!window.confirm(`Voltar ${ids.length} pedidos pra "Abertos"? (desfaz a impressão)`)) return;
    try {
      await fetch(`${API}/wms-listas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'voltar', pedido_ids: ids }),
      });
      await carregarDash(); setFStatus('aberto');
    } catch (e) { setErro(e.message); }
  };

  // aviso de prazo: corte 12:00, despacho 14:00 (regras exatas o Ailson define depois)
  const avisoPrazo = useMemo(() => {
    if (!dash?.total) return null;
    const agora = new Date();
    const h = agora.getHours() + agora.getMinutes() / 60;
    const pend = (dash.total.abertos || 0) + (dash.total.em_separacao || 0);
    if (!pend) return null;
    if (h >= 12 && h < 14) return { cor: '#c0392b', txt: `⏰ ${pend} pedidos pendentes e o despacho é até 14:00 — prioridade total na separação!` };
    if (h >= 10.5 && h < 12) return { cor: '#9a6b00', txt: `⏳ Corte às 12:00 — ${pend} pedidos pendentes. Bom momento pra imprimir a lista.` };
    return null;
  }, [dash]);

  const btn = (ativo) => ({
    padding: '7px 13px', borderRadius: 9, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700,
    border: ativo ? `1.5px solid ${palette.accent}` : `1px solid ${palette.beige}`,
    background: ativo ? palette.accentSoft : '#fff', color: ativo ? palette.accent : palette.inkSoft,
  });

  return (
    <div style={{ fontFamily: FONT, background: palette.bg, minHeight: '100vh', paddingBottom: 40 }}>
      {/* print CSS: imprime só a área da lista */}
      <style>{`@media print {
        .wms-no-print { display: none !important; }
        .wms-print-area { box-shadow: none !important; }
        body { background: #fff !important; }
      }`}</style>

      {/* Header */}
      <div className="wms-no-print" style={{ background: palette.header, color: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={tela === 'dashboard' ? onBack : () => setTela('dashboard')} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 9, padding: 8, cursor: 'pointer', color: '#fff', display: 'flex' }}>
          <ArrowLeft size={19} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17.5, fontWeight: 800 }}>📦 Picking WMS</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{tela === 'dashboard' ? 'Separação de pedidos dos marketplaces' : 'Lista de separação'}</div>
        </div>
        <button onClick={sincronizar} disabled={sincronizando} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 9, padding: '8px 13px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, fontFamily: FONT, opacity: sincronizando ? 0.6 : 1 }}>
          <RefreshCw size={16} style={sincronizando ? { animation: 'spin 1s linear infinite' } : undefined} />
          {sincronizando ? 'Sincronizando…' : 'Sincronizar Bling'}
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {erro && <div className="wms-no-print" style={{ margin: 14, padding: '10px 14px', background: '#fdeaea', border: '1px solid #e8b4b4', borderRadius: 10, color: '#c0392b', fontSize: 13.5 }}>{erro}</div>}

      {tela === 'dashboard' && (
        <div style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>
          {avisoPrazo && (
            <div style={{ marginBottom: 14, padding: '11px 15px', borderRadius: 11, background: '#fff6e5', border: `1.5px solid ${avisoPrazo.cor}44`, color: avisoPrazo.cor, fontSize: 14, fontWeight: 700 }}>
              {avisoPrazo.txt}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {[
              { k: 'abertos', titulo: 'Pedidos Abertos', sub: 'lista ainda não impressa', Icon: Package, cor: palette.accent, extra: dash?.total ? `${dash.total.pecas_abertas} peças` : '' },
              { k: 'em_separacao', titulo: 'Em Separação', sub: 'lista impressa, separando', Icon: ClipboardList, cor: '#9a6b00' },
              { k: 'finalizados_hoje', titulo: 'Finalizados Hoje', sub: 'bipados + etiqueta (Verificado)', Icon: CheckCircle2, cor: '#1e8e4e' },
            ].map(c => (
              <div key={c.k} style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 18, boxShadow: '0 1px 4px rgba(44,62,80,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <c.Icon size={22} color={c.cor} strokeWidth={1.8} />
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: palette.inkSoft }}>{c.titulo}</span>
                </div>
                <div style={{ fontSize: 34, fontWeight: 800, color: c.cor, lineHeight: 1 }}>{dash?.total?.[c.k] ?? '—'}</div>
                <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 6 }}>{c.sub}{c.extra ? ` · ${c.extra}` : ''}</div>
              </div>
            ))}
          </div>

          {/* por conta */}
          {dash?.por_conta && Object.keys(dash.por_conta).length > 0 && (
            <div style={{ marginTop: 16, background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: palette.inkSoft, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Boxes size={17} strokeWidth={1.8} /> Por conta
              </div>
              {CONTAS.filter(c => dash.por_conta[c]).map(c => {
                const d = dash.por_conta[c];
                return (
                  <div key={c} style={{ display: 'flex', gap: 14, padding: '7px 0', borderBottom: '1px solid #f4f0ea', fontSize: 13.5, alignItems: 'center' }}>
                    <span style={{ fontWeight: 800, minWidth: 74 }}>{NOME_CONTA[c]}</span>
                    <span style={{ color: palette.accent, fontWeight: 700 }}>{d.abertos} abertos</span>
                    <span style={{ color: '#9a6b00' }}>{d.em_separacao} em separação</span>
                    <span style={{ color: '#1e8e4e' }}>{d.finalizados_hoje} finalizados hoje</span>
                  </div>
                );
              })}
              {dash.ultimo_sync && <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 9, display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={13} /> Último sync: {new Date(dash.ultimo_sync).toLocaleString('pt-BR')}</div>}
            </div>
          )}

          <button onClick={() => setTela('separacao')} style={{ marginTop: 18, width: '100%', padding: '15px', borderRadius: 13, border: 'none', background: palette.accent, color: '#fff', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
            <ClipboardList size={19} /> Abrir Lista de Separação
          </button>
        </div>
      )}

      {tela === 'separacao' && (
        <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
          {/* filtros */}
          <div className="wms-no-print" style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 13, padding: 13, marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {['todas', ...CONTAS].map(c => (
                <button key={c} onClick={() => { setFConta(c); setFLoja('todas'); }} style={btn(fConta === c)}>{c === 'todas' ? 'Todas' : NOME_CONTA[c]}</button>
              ))}
            </div>
            <select value={fLoja} onChange={e => setFLoja(e.target.value)} style={{ ...btn(fLoja !== 'todas'), appearance: 'auto' }}>
              <option value="todas">Todas as lojas</option>
              {lojasDisponiveis.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <span style={{ width: 1, height: 22, background: palette.beige }} />
            <button onClick={() => setOrdem(ordem === 'qtd' ? 'loc' : 'qtd')} style={btn(true)}>
              {ordem === 'qtd' ? '↓ Maior quantidade' : '📍 Por localização'}
            </button>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['auto', 'Auto'], ['matriz', 'Matriz'], ['lista', 'Lista']].map(([v, l]) => (
                <button key={v} onClick={() => setVisual(v)} style={btn(visual === v)}>{l}</button>
              ))}
            </div>
            <span style={{ width: 1, height: 22, background: palette.beige }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setFStatus('aberto')} style={btn(fStatus === 'aberto')}>Abertos</button>
              <button onClick={() => setFStatus('em_separacao')} style={btn(fStatus === 'em_separacao')}>Em separação</button>
            </div>
          </div>

          {/* ações */}
          <div className="wms-no-print" style={{ display: 'flex', gap: 9, marginBottom: 14, flexWrap: 'wrap' }}>
            {fStatus === 'aberto' && (
              <button onClick={imprimirLista} disabled={imprimindo || !pedidosFiltrados.length} style={{ flex: 1, minWidth: 220, padding: '13px', borderRadius: 12, border: 'none', background: pedidosFiltrados.length ? palette.accent : '#c8c0b6', color: '#fff', fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Printer size={18} /> Imprimir e iniciar separação ({pedidosFiltrados.length} pedidos)
              </button>
            )}
            {fStatus === 'em_separacao' && (<>
              <button onClick={reimprimir} disabled={!pedidosFiltrados.length} style={{ flex: 1, minWidth: 150, padding: '12px', borderRadius: 12, border: `1.5px solid ${palette.accent}`, background: '#fff', color: palette.accent, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <Printer size={17} /> Reimprimir
              </button>
              <button onClick={finalizarLista} disabled={!pedidosFiltrados.length} style={{ flex: 1, minWidth: 170, padding: '12px', borderRadius: 12, border: 'none', background: '#1e8e4e', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                <CheckCircle2 size={17} /> Finalizar ({pedidosFiltrados.length})
              </button>
              <button onClick={voltarPraAbertos} disabled={!pedidosFiltrados.length} style={{ padding: '12px 15px', borderRadius: 12, border: `1px solid ${palette.beige}`, background: '#fff', color: palette.inkSoft, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Undo2 size={16} /> Voltar pra abertos
              </button>
            </>)}
          </div>

          {carregando && <div style={{ textAlign: 'center', padding: 30, color: palette.inkMuted }}>Carregando pedidos…</div>}
          {!carregando && !blocos.length && (
            <div style={{ textAlign: 'center', padding: 40, color: palette.inkMuted, fontSize: 14.5 }}>
              Nenhum pedido {fStatus === 'aberto' ? 'aberto' : 'em separação'} nos filtros atuais.<br />
              <span style={{ fontSize: 12.5 }}>Toca em "Sincronizar Bling" no topo pra puxar os pedidos.</span>
            </div>
          )}

          {/* área de impressão */}
          <div className="wms-print-area">
            {blocos.map(b => (
              <div key={b.conta} style={{ marginBottom: 26, pageBreakInside: 'avoid' }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: palette.ink, padding: '9px 13px', background: '#f4f0ea', borderRadius: 11, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>🏷 {NOME_CONTA[b.conta]}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: palette.inkSoft }}>{b.nPedidos} pedidos · {b.nPecas} peças</span>
                </div>

                {/* mono-SKU agregado por ref */}
                {b.mono.map(g => (
                  <div key={g.ref} style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 13, marginBottom: 10, display: 'flex', gap: 13, alignItems: 'flex-start', pageBreakInside: 'avoid' }}>
                    <FotoRef refProd={g.ref} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap', marginBottom: 7 }}>
                        <span style={{ fontSize: 16.5, fontWeight: 800 }}>REF {g.ref}</span>
                        {g.loc && <span style={{ fontSize: 12.5, fontWeight: 800, color: '#7a5c99', background: '#f3eefb', border: '1px solid #ddd0f0', borderRadius: 7, padding: '2px 9px' }}>📍 {g.loc}</span>}
                        <span style={{ fontSize: 12, color: palette.inkMuted }}>{g.pedidos} pedidos · {g.pecas} pçs</span>
                      </div>
                      {g.descLimpa && <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 8 }}>{g.descLimpa}</div>}
                      {usaMatriz(g) ? <MatrizRef g={g} /> : <ListaRef g={g} />}
                    </div>
                  </div>
                ))}

                {/* multi-SKU: um bloco por pedido */}
                {b.multi.length > 0 && (
                  <div style={{ pageBreakBefore: 'always' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#9a6b00', padding: '7px 13px', background: '#fff6e5', borderRadius: 10, margin: '14px 0 10px' }}>
                      🧺 Pedidos com múltiplos SKUs — {NOME_CONTA[b.conta]} ({b.multi.length})
                    </div>
                    {b.multi.map(p => (
                      <div key={p.id} style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 12, padding: 13, marginBottom: 10, pageBreakInside: 'avoid' }}>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 8, fontSize: 13 }}>
                          <span style={{ fontWeight: 800, fontSize: 14.5 }}>Pedido {p.numero}</span>
                          <span style={{ color: palette.inkMuted }}>{p.canal_geral || p.loja_nome}</span>
                          {p.cliente_nome && <span style={{ color: palette.inkMuted }}>· {p.cliente_nome}</span>}
                          <span style={{ color: palette.inkMuted }}>· {p.qtd_pecas} pçs</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {(p.itens || []).map((it, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5 }}>
                              <FotoRef refProd={it.ref} size={36} />
                              <span style={{ fontWeight: 800, minWidth: 24, textAlign: 'right' }}>{it.quantidade}</span>
                              <span><b>REF {it.ref}</b> {it.cor} <b>{String(it.tamanho || '').toUpperCase()}</b>{it.estoque ? <span style={{ color: '#7a5c99', fontWeight: 700 }}> · 📍{it.estoque}</span> : ''}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
