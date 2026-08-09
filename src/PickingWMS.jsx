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
import { Package, ClipboardList, RefreshCw, Printer, ArrowLeft, CheckCircle2, Clock, Boxes, Undo2, Settings } from 'lucide-react';
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
      const g = porRef.get(ref) || { ref, loc: '', cores: {}, pedidosSet: new Set(), porSku: {}, pecas: 0, descLimpa: it.descLimpa || '', tentativas: 1 };
      if (it.estoque && !g.loc) g.loc = it.estoque;
      if (!g.descLimpa && it.descLimpa) g.descLimpa = it.descLimpa;
      const cor = it.cor || '—';
      const tam = String(it.tamanho || '—').toUpperCase();
      g.cores[cor] = g.cores[cor] || {};
      g.cores[cor][tam] = (g.cores[cor][tam] || 0) + (it.quantidade || 1);
      const kSku = cor + '|' + tam;
      (g.porSku[kSku] = g.porSku[kSku] || []).push(p.id);
      if ((p.tentativas || 1) > (g.tentativas || 1)) g.tentativas = p.tentativas;
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
function MatrizRef({ g, modoFalta, faltaDe, onTapSku }) {
  return (
    <table style={{ borderCollapse: 'collapse', fontSize: 12.5, fontFamily: FONT }}>
      <thead><tr>
        <th style={thTd(true)}></th>
        {g.tamanhos.map(t => <th key={t} style={thTd(true)}>{t}</th>)}
      </tr></thead>
      <tbody>
        {/* coluna Σ removida a pedido do Ailson (08/08/2026): o total por cor
            não ajuda na separação e roubava largura no celular */}
        {Object.keys(g.cores).sort().map(cor => {
          return (
            <tr key={cor}>
              <td style={{ ...thTd(), fontWeight: 700, textAlign: 'left' }}>{cor}</td>
              {g.tamanhos.map(t => {
                const q = g.cores[cor][t];
                const f = modoFalta && q ? (faltaDe(cor, t) || 0) : 0;
                return (
                  <td key={t}
                    onClick={modoFalta && q ? () => onTapSku(cor, t, q) : undefined}
                    title={modoFalta && q ? 'Toque pra marcar falta (toca de novo pra somar; passa do total volta a zero)' : undefined}
                    style={{ ...thTd(), fontWeight: q ? 800 : 400, color: q ? palette.ink : '#c8c0b6',
                      cursor: modoFalta && q ? 'pointer' : 'default',
                      background: f ? '#fdf0d5' : '#fff',
                      boxShadow: f ? 'inset 0 0 0 2px #d9a441' : undefined }}>
                    {q ? (f ? `${q - f}+⏳${f}` : q) : '·'}
                  </td>
                );
              })}
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
function ListaRef({ g, modoFalta, faltaDe, onTapSku }) {
  const linhas = [];
  for (const cor of Object.keys(g.cores).sort()) {
    for (const t of Object.keys(g.cores[cor]).sort((a, b) => idxTam(a) - idxTam(b))) {
      linhas.push({ cor, t, q: g.cores[cor][t] });
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13.5 }}>
      {linhas.map((l, i) => {
        const f = modoFalta ? (faltaDe(l.cor, l.t) || 0) : 0;
        return (
          <div key={i}
            onClick={modoFalta ? () => onTapSku(l.cor, l.t, l.q) : undefined}
            style={{ display: 'flex', gap: 8, cursor: modoFalta ? 'pointer' : 'default',
              background: f ? '#fdf0d5' : 'transparent', borderRadius: 6, padding: modoFalta ? '2px 6px' : 0,
              border: f ? '1px solid #d9a441' : '1px solid transparent' }}>
            <span style={{ fontWeight: 800, minWidth: 26, textAlign: 'right' }}>{l.q}</span>
            <span>{l.cor} <b>{l.t}</b></span>
            {f > 0 && <span style={{ color: '#9a6b00', fontWeight: 800 }}>⏳ faltou {f}</span>}
          </div>
        );
      })}
    </div>
  );
}

const CANAIS_CONFIG = ['Mercado Livre', 'Shopee', 'Shein', 'TikTok', 'Magalu', 'Outros'];
const SITUACOES_CONHECIDAS = ['em aberto', 'em andamento', 'atendido', 'verificado'];

function ConfigScreen({ config, salvando, onSalvar, API }) {
  const [abertas, setAbertas] = useState(config.situacoes_aberto || []);
  const [finalizadas, setFinalizadas] = useState(config.situacoes_finalizado || []);
  const [novaSit, setNovaSit] = useState('');
  // Avisos (Ailson 06/08/2026)
  const [avisosFluxo, setAvisosFluxo] = useState(config.avisos_fluxo_ativo !== false);
  const [avisoProd, setAvisoProd] = useState(config.aviso_prod_ativo !== false);
  const [refManual, setRefManual] = useState(config.fluxo_ref_manual || {});
  const [refModo, setRefModo] = useState(config.fluxo_ref_modo || {});
  const [prodManual, setProdManual] = useState(config.prod_ref_manual ?? '');
  const [prodModo, setProdModo] = useState(config.prod_ref_modo === 'manual' ? 'manual' : 'auto');
  const [dur, setDur] = useState(config.duracoes || {});
  const [medias, setMedias] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API}/wms-listas?acao=medias`);
        const d = await r.json();
        if (d.ok) setMedias(d);
      } catch { /* silencioso */ }
    })();
  }, [API]);
  const [novaSitDestino, setNovaSitDestino] = useState('aberto');
  const [canais, setCanais] = useState(() => CANAIS_CONFIG.map(nome => {
    const ex = (config.canais || []).find(c => String(c.canal).toLowerCase() === nome.toLowerCase());
    return ex ? { ...ex, canal: nome } : { canal: nome, corte: '', envio: '', alerta_min: 30 };
  }));

  const todasConhecidas = useMemo(() => {
    const set = new Set([...SITUACOES_CONHECIDAS, ...abertas, ...finalizadas]);
    return [...set];
  }, [abertas, finalizadas]);

  const toggle = (lista, setLista, sit) => setLista(lista.includes(sit) ? lista.filter(x => x !== sit) : [...lista, sit]);

  const chip = (ativo, cor) => ({
    padding: '7px 13px', borderRadius: 9, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700,
    border: ativo ? `1.5px solid ${cor}` : `1px solid ${palette.beige}`,
    background: ativo ? cor + '18' : '#fff', color: ativo ? cor : palette.inkMuted,
  });

  const setCanal = (i, campo, valor) => setCanais(cs => cs.map((c, j) => j === i ? { ...c, [campo]: valor } : c));

  return (
    <div style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>
      {/* situações do funil */}
      <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: palette.ink, marginBottom: 4 }}>Situações que alimentam os cards</div>
        <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 13 }}>O nome precisa bater com a situação do Bling — mas relaxa: maiúsculas, acentos e variações são considerados ("Em andamento" casa com "andamento"). Pode marcar mais de uma.</div>

        <div style={{ fontSize: 13, fontWeight: 800, color: palette.accent, marginBottom: 8 }}>📦 Pedidos Abertos (entram no funil de separação)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
          {todasConhecidas.map(sit => (
            <button key={'a' + sit} onClick={() => toggle(abertas, setAbertas, sit)} style={chip(abertas.includes(sit), '#4a7fa5')}>{sit}</button>
          ))}
        </div>

        <div style={{ fontSize: 13, fontWeight: 800, color: '#1e8e4e', marginBottom: 8 }}>✅ Finalizados (saem do funil automaticamente)</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>
          {todasConhecidas.map(sit => (
            <button key={'f' + sit} onClick={() => toggle(finalizadas, setFinalizadas, sit)} style={chip(finalizadas.includes(sit), '#1e8e4e')}>{sit}</button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={novaSit} onChange={e => setNovaSit(e.target.value)} placeholder="Nova situação (ex: Separado)"
            style={{ flex: 1, minWidth: 170, padding: '9px 12px', borderRadius: 9, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13.5 }} />
          <select value={novaSitDestino} onChange={e => setNovaSitDestino(e.target.value)} style={{ padding: '9px 10px', borderRadius: 9, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13 }}>
            <option value="aberto">→ Pedidos Abertos</option>
            <option value="finalizado">→ Finalizados</option>
          </select>
          <button onClick={() => {
            const sit = novaSit.trim().toLowerCase();
            if (!sit) return;
            if (novaSitDestino === 'aberto') { if (!abertas.includes(sit)) setAbertas([...abertas, sit]); }
            else { if (!finalizadas.includes(sit)) setFinalizadas([...finalizadas, sit]); }
            setNovaSit('');
          }} style={{ padding: '9px 15px', borderRadius: 9, border: 'none', background: palette.accent, color: '#fff', fontWeight: 800, fontFamily: FONT, fontSize: 13, cursor: 'pointer' }}>+ Adicionar</button>
        </div>
      </div>

      {/* horarios por canal */}
      <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: palette.ink, marginBottom: 4 }}>Horários de corte e envio por canal</div>
        <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 13 }}>O alerta dispara quando faltam N minutos pro envio e ainda tem pedidos do canal pendentes (gerados antes do corte). Meluni e canais sem match entram em "Outros". Deixa em branco pra não monitorar o canal.</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: '8px 10px', alignItems: 'center', fontSize: 13 }}>
          <div style={{ fontWeight: 800, color: palette.inkSoft, fontSize: 11.5 }}>CANAL</div>
          <div style={{ fontWeight: 800, color: palette.inkSoft, fontSize: 11.5 }}>CORTE</div>
          <div style={{ fontWeight: 800, color: palette.inkSoft, fontSize: 11.5 }}>ENVIO</div>
          <div style={{ fontWeight: 800, color: palette.inkSoft, fontSize: 11.5 }}>ALERTA (min antes)</div>
          {canais.map((c, i) => (
            <React.Fragment key={c.canal}>
              <div style={{ fontWeight: 700 }}>{c.canal}{c.canal === 'Outros' ? ' (Meluni etc.)' : ''}</div>
              <input type="time" value={c.corte} onChange={e => setCanal(i, 'corte', e.target.value)} style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13 }} />
              <input type="time" value={c.envio} onChange={e => setCanal(i, 'envio', e.target.value)} style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13 }} />
              <input type="number" min="0" max="240" value={c.alerta_min} onChange={e => setCanal(i, 'alerta_min', e.target.value)} style={{ width: 70, padding: '6px 8px', borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13 }} />
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* AVISOS DE FLUXO */}
      <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginBottom: 4 }}>
          <input type="checkbox" checked={avisosFluxo} onChange={e => setAvisosFluxo(e.target.checked)} style={{ width: 17, height: 17 }} />
          <span style={{ fontSize: 14.5, fontWeight: 800, color: palette.ink }}>Mensagens de fluxo (10:30 · 11:30 · 13:00)</span>
        </label>
        <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 12 }}>
          Comparam o dia com a média das 2 últimas ocorrências do mesmo dia da semana e projetam a hora de término.
        </div>
        {avisosFluxo && (<>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px 10px', alignItems: 'center', fontSize: 13, marginBottom: 12 }}>
            <div style={{ fontWeight: 800, color: palette.inkSoft, fontSize: 11.5 }}>MARCO</div>
            <div style={{ fontWeight: 800, color: palette.inkSoft, fontSize: 11.5 }}>MÉDIA AUTOMÁTICA</div>
            <div style={{ fontWeight: 800, color: palette.inkSoft, fontSize: 11.5 }}>MANUAL · USAR QUAL</div>
            {['10:30', '11:30', '13:00'].map(m => {
              const info = medias?.marcos?.[m];
              return (
                <React.Fragment key={m}>
                  <div style={{ fontWeight: 700 }}>{m}</div>
                  <div style={{ color: palette.inkMuted, fontSize: 12.5 }}>
                    {info == null ? '…' : info.media == null ? 'sem histórico ainda'
                      : `${info.media} finalizados (${info.valores.join(' e ')} nos ${info.dias_usados.length} dia(s) usados)`}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <input type="number" min="0" placeholder="—" value={refManual[m] ?? ''}
                      onChange={e => setRefManual(r => ({ ...r, [m]: e.target.value }))}
                      style={{ width: 72, padding: '6px 8px', borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13 }} />
                    <div style={{ display: 'flex', gap: 4 }}>
                      {[['auto', 'auto'], ['manual', 'manual']].map(([v, l]) => {
                        const on = (refModo[m] === 'manual' ? 'manual' : 'auto') === v;
                        return (
                          <button key={v} onClick={() => setRefModo(r => ({ ...r, [m]: v }))} style={{
                            padding: '4px 9px', borderRadius: 7, fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: FONT,
                            border: on ? `1.5px solid ${palette.accent}` : `1px solid ${palette.beige}`,
                            background: on ? palette.accentSoft : '#fff', color: on ? palette.accent : palette.inkMuted,
                          }}>{l}</button>
                        );
                      })}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: palette.inkSoft, marginBottom: 7 }}>Tempo que cada aviso fica na tela (minutos)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {[
              ['m1030', '10:30'], ['m1130_normal', '11:30 normal'], ['m1130_atencao', '11:30 atenção'],
              ['m1300_normal', '13:00 normal'], ['m1300_atencao', '13:00 atenção'],
            ].map(([k, l]) => (
              <label key={k} style={{ fontSize: 12, color: palette.inkSoft }}>
                {l}<br />
                <input type="number" min="1" max="180" value={dur[k] ?? ''}
                  onChange={e => setDur(d => ({ ...d, [k]: parseInt(e.target.value) || 0 }))}
                  style={{ width: 70, padding: '6px 8px', borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13, marginTop: 3 }} />
              </label>
            ))}
            <label style={{ fontSize: 12, color: palette.inkSoft }}>
              13:00 vermelho até<br />
              <input type="time" value={dur.m1300_vermelho_ate || '14:30'}
                onChange={e => setDur(d => ({ ...d, m1300_vermelho_ate: e.target.value }))}
                style={{ padding: '6px 8px', borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13, marginTop: 3 }} />
            </label>
          </div>
        </>)}
      </div>

      {/* AVISO DE PRODUTIVIDADE */}
      <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', marginBottom: 4 }}>
          <input type="checkbox" checked={avisoProd} onChange={e => setAvisoProd(e.target.checked)} style={{ width: 17, height: 17 }} />
          <span style={{ fontSize: 14.5, fontWeight: 800, color: palette.ink }}>Aviso de produtividade das 13:30</span>
        </label>
        <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 12 }}>
          Média por pedido e pedidos/hora do dia (janela até 12:45), comparados com a referência. Não aparece quando há risco de estourar o envio.
        </div>
        {avisoProd && (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 12.5, color: palette.inkMuted }}>
              Média que temos:<br />
              <b style={{ fontSize: 15, color: palette.ink }}>
                {medias?.produtividade?.media != null ? `${medias.produtividade.media} pedidos/h` : 'sem histórico ainda'}
              </b>
              {medias?.produtividade?.dias ? <span> · {medias.produtividade.dias} dia(s)</span> : null}
            </div>
            <label style={{ fontSize: 12, color: palette.inkSoft }}>
              Manual (pedidos/h)<br />
              <input type="number" min="0" step="0.1" placeholder="—" value={prodManual}
                onChange={e => setProdManual(e.target.value)}
                style={{ width: 100, padding: '6px 8px', borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13, marginTop: 3 }} />
            </label>
            <div style={{ fontSize: 12, color: palette.inkSoft }}>
              Usar qual<br />
              <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
                {[['auto', 'automática'], ['manual', 'manual']].map(([v, l]) => (
                  <button key={v} onClick={() => setProdModo(v)} style={{
                    padding: '5px 11px', borderRadius: 8, fontSize: 11.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT,
                    border: prodModo === v ? `1.5px solid ${palette.accent}` : `1px solid ${palette.beige}`,
                    background: prodModo === v ? palette.accentSoft : '#fff', color: prodModo === v ? palette.accent : palette.inkMuted,
                  }}>{l}</button>
                ))}
              </div>
            </div>
            <label style={{ fontSize: 12, color: palette.inkSoft }}>
              Fica na tela (min)<br />
              <input type="number" min="1" max="180" value={dur.prod ?? 40}
                onChange={e => setDur(d => ({ ...d, prod: parseInt(e.target.value) || 0 }))}
                style={{ width: 80, padding: '6px 8px', borderRadius: 8, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13, marginTop: 3 }} />
            </label>
          </div>
        )}
      </div>

      <button onClick={() => onSalvar({
        situacoes_aberto: abertas, situacoes_finalizado: finalizadas,
        canais: canais.filter(c => c.corte || c.envio),
        avisos_fluxo_ativo: avisosFluxo, aviso_prod_ativo: avisoProd,
        fluxo_ref_manual: refManual, fluxo_ref_modo: refModo,
        prod_ref_manual: prodManual, prod_ref_modo: prodModo,
        duracoes: dur,
      })} disabled={salvando} style={{ width: '100%', padding: '14px', borderRadius: 13, border: 'none', background: '#1e8e4e', color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, opacity: salvando ? 0.6 : 1 }}>
        {salvando ? 'Salvando…' : '💾 Salvar configurações'}
      </button>
      <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 9, textAlign: 'center' }}>As situações valem a partir do próximo "Sincronizar Bling". Pedido que entrar numa situação de Finalizado sai do funil sozinho.</div>
    </div>
  );
}

// ── Produtividade: formatação e avaliação da variação ──
function fmtDur(seg) {
  if (seg == null) return '—';
  const s = Math.round(seg), m = Math.floor(s / 60), r = s % 60;
  if (m === 0) return `${r} segundos`;
  return `${m} minuto${m > 1 ? 's' : ''}${r ? ` e ${r} segundo${r > 1 ? 's' : ''}` : ''}`;
}
// Janela neutra: -10% a +5% (Ailson 05/08). Abaixo de -10% = queda com
// incentivo; acima de +10% = parabéns.
function avaliarVariacao(v) {
  if (v == null) return { tipo: 'neutro', cor: palette.inkSoft, seta: '', msg: 'Primeiro dia com medição — a partir de amanhã dá pra comparar.' };
  if (v < -10) return { tipo: 'baixa', cor: '#c0392b', seta: '▼', msg: `Tivemos uma queda de ${Math.abs(v).toFixed(0)}%. Bora time, dá pra recuperar esse tempo! 💪` };
  if (v > 10) return { tipo: 'alta', cor: '#1e8e4e', seta: '▲', msg: `Parabéns time! Tivemos um aumento de ${v.toFixed(0)}% na produtividade! 👏` };
  return { tipo: 'neutro', cor: palette.inkSoft, seta: v > 0 ? '▲' : v < 0 ? '▼' : '', msg: `Ritmo dentro do esperado (${v > 0 ? '+' : ''}${v.toFixed(0)}% em relação à média).` };
}

// ── Gráfico de barras simples (pedidos/hora por dia) ──
function GraficoBarras({ dados, referencia }) {
  if (!dados.length) return <div style={{ color: palette.inkMuted, fontSize: 13, padding: 18, textAlign: 'center' }}>Sem histórico ainda. Cada dia fechado às 12:00 vira uma barra aqui.</div>;
  const max = Math.max(...dados.map(d => Number(d.pedidos_por_hora) || 0), referencia || 0) * 1.15 || 1;
  const H = 150, W = Math.max(280, dados.length * 46);
  const yRef = referencia ? H - (referencia / max) * H : null;
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={W} height={H + 30} style={{ display: 'block' }}>
        {yRef != null && (<>
          <line x1="0" y1={yRef} x2={W} y2={yRef} stroke="#c8c0b6" strokeDasharray="4 4" />
          <text x="2" y={yRef - 4} fontSize="9.5" fill="#8a99a8" fontFamily="Georgia, serif">média {referencia.toFixed(0)}/h</text>
        </>)}
        {dados.map((d, i) => {
          const v = Number(d.pedidos_por_hora) || 0;
          const h = (v / max) * H;
          const x = i * 46 + 8, cor = referencia && v < referencia * 0.9 ? '#c0392b' : referencia && v > referencia * 1.1 ? '#1e8e4e' : '#4a7fa5';
          return (
            <g key={d.data}>
              <rect x={x} y={H - h} width="30" height={h} rx="4" fill={cor} opacity="0.85" />
              <text x={x + 15} y={H - h - 4} fontSize="10" fill="#5a6b7d" textAnchor="middle" fontFamily="Georgia, serif">{v.toFixed(0)}</text>
              <text x={x + 15} y={H + 14} fontSize="9.5" fill="#8a99a8" textAnchor="middle" fontFamily="Georgia, serif">{d.data.slice(8, 10)}/{d.data.slice(5, 7)}</text>
              <text x={x + 15} y={H + 25} fontSize="8.5" fill="#b0a89e" textAnchor="middle" fontFamily="Georgia, serif">{d.pedidos_finalizados}p</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Tela "Aguardando mercadoria": agrupa os pendentes por ref; 1 toque devolve
//    pro funil (volta no topo da próxima lista como 2ª tentativa) ──
function TelaAguardando({ API, onVoltar, onErro }) {
  const [pedidos, setPedidos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`${API}/wms-listas?acao=pedidos&status=pendente`);
      const d = await r.json();
      if (d.ok) setPedidos(d.pedidos || []);
    } catch (e) { onErro && onErro(e.message); }
    setCarregando(false);
  }, [API, onErro]);
  useEffect(() => { carregar(); }, [carregar]);

  const grupos = useMemo(() => {
    const m = new Map();
    for (const p of pedidos) {
      for (const it of (p.itens || [])) {
        const k = p.conta + '|' + (it.ref || '?');
        const g = m.get(k) || { conta: p.conta, ref: it.ref || '?', loc: it.estoque || '', linhas: [], ids: new Set(), desc: it.descLimpa || '' };
        g.linhas.push({ cor: it.cor, tam: String(it.tamanho || '').toUpperCase(), q: it.quantidade || 1, pedido: p.numero });
        g.ids.add(p.id);
        m.set(k, g);
      }
    }
    return [...m.values()];
  }, [pedidos]);

  const chegou = async (ids) => {
    if (!window.confirm('Mercadoria chegou?\n\nEsses pedidos voltam pro funil de abertos e aparecem no topo da próxima lista como 2ª tentativa.')) return;
    setSalvando(true);
    try {
      const r = await fetch(`${API}/wms-listas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'pendente_chegou', pedido_ids: [...ids] }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'falhou');
      await carregar();
    } catch (e) { onErro && onErro('Chegou: ' + e.message); }
    setSalvando(false);
  };

  return (
    <div style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>
      {carregando && <div style={{ textAlign: 'center', padding: 30, color: palette.inkMuted }}>Carregando…</div>}
      {!carregando && !grupos.length && (
        <div style={{ textAlign: 'center', padding: 40, color: palette.inkMuted, fontSize: 14.5 }}>
          Nada aguardando mercadoria 🎉<br />
          <span style={{ fontSize: 12.5 }}>As faltas repassadas na separação aparecem aqui.</span>
        </div>
      )}
      {grupos.map(g => (
        <div key={g.conta + g.ref} style={{ background: '#fff', border: '1px solid #e0c98a', borderRadius: 12, padding: 13, marginBottom: 10, display: 'flex', gap: 13, alignItems: 'flex-start' }}>
          <FotoRef refProd={g.ref} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontSize: 16, fontWeight: 800 }}>REF {g.ref}</span>
              {g.loc && <span style={{ fontSize: 12, fontWeight: 800, color: '#7a5c99' }}>📍 {g.loc}</span>}
              <span style={{ fontSize: 11.5, color: palette.inkMuted }}>{NOME_CONTA[g.conta] || g.conta} · {g.ids.size} pedidos</span>
            </div>
            {g.desc && <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 6 }}>{g.desc}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 9 }}>
              {g.linhas.map((l, i) => (
                <div key={i} style={{ fontSize: 13.5 }}><b>{l.q}</b> {l.cor} <b>{l.tam}</b> <span style={{ color: palette.inkMuted, fontSize: 11.5 }}>#{l.pedido}</span></div>
              ))}
            </div>
            <button onClick={() => chegou(g.ids)} disabled={salvando} style={{ padding: '8px 15px', borderRadius: 10, border: 'none', background: '#1e8e4e', color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
              ✓ Chegou, voltar pro funil
            </button>
          </div>
        </div>
      ))}
      {grupos.length > 0 && (
        <button onClick={() => chegou(new Set(pedidos.map(p => p.id)))} disabled={salvando} style={{ width: '100%', marginTop: 8, padding: '12px', borderRadius: 12, border: `1.5px solid #1e8e4e`, background: '#fff', color: '#1e8e4e', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
          ✓ Chegou tudo ({pedidos.length} pedidos)
        </button>
      )}
    </div>
  );
}

export default function PickingWMS({ userId = '', isAdmin = false, onBack }) {
  const [tela, setTela] = useState('dashboard'); // dashboard | separacao | config | detalhes
  const [detStatus, setDetStatus] = useState('aberto');
  const [detPedidos, setDetPedidos] = useState([]);
  const [detCarregando, setDetCarregando] = useState(false);
  const [detBusca, setDetBusca] = useState('');
  const [porContaAberto, setPorContaAberto] = useState(false);
  const [prod, setProd] = useState(null);
  const [andamento, setAndamento] = useState(null);
  // Repasse de faltas (Ailson 05/08): auxiliar circula no papel, responsável
  // toca na tela. Map 'conta|ref|cor|tam' → quantidade que faltou.
  const [modoFalta, setModoFalta] = useState(false);
  const [faltas, setFaltas] = useState(() => new Map());
  const [salvandoFaltas, setSalvandoFaltas] = useState(false);
  const [dash, setDash] = useState(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  // filtros da lista de separação
  const [fConta, setFConta] = useState('todas');
  const [fLoja, setFLoja] = useState('todas');
  const [fStatus, setFStatus] = useState('aberto'); // aberto | em_separacao
  const [fJanela, setFJanela] = useState('todos');  // todos | ate_corte (Ailson 07/08)
  const [fEnvio, setFEnvio] = useState('todos');    // todos | flex (Ailson 07/08)
  const [vendasAberto, setVendasAberto] = useState(false); // card vendas do dia (oculto por padrão)
  const [corteEm, setCorteEm] = useState(null);     // instante do corte de hoje (ISO)
  const [ordem, setOrdem] = useState('qtd');        // qtd | loc
  const [visual, setVisual] = useState('auto');     // auto | matriz | lista
  const [pedidos, setPedidos] = useState([]);
  const [imprimindo, setImprimindo] = useState(false);
  const [config, setConfig] = useState(null);
  const [salvandoCfg, setSalvandoCfg] = useState(false);
  // modo por card: ausente='imprimir' (default) | 'ja' (já impresso) | 'nao'
  // (nenhuma caixinha marcada). Caixinhas mutuamente exclusivas (Ailson 05/08).
  const [modoImpressao, setModoImpressao] = useState(() => new Map());
  const modoDe = (chave) => modoImpressao.get(chave) || 'imprimir';
  const setModo = (chave, modo) => setModoImpressao(prev => {
    const n = new Map(prev);
    if (modo === 'imprimir') n.delete(chave); else n.set(chave, modo);
    return n;
  });
  const toggleCaixa = (chave, caixa) => {
    const atual = modoDe(chave);
    if (caixa === 'imprimir') setModo(chave, atual === 'imprimir' ? 'nao' : 'imprimir');
    else setModo(chave, atual === 'ja' ? 'nao' : 'ja');
  };

  const carregarDash = useCallback(async () => {
    try {
      const r = await fetch(`${API}/wms-listas?acao=dashboard`);
      const d = await r.json();
      if (d.ok) { setDash(d); if (d.config) setConfig(d.config); }
    } catch (e) { setErro(e.message); }
  }, []);
  useEffect(() => { carregarDash(); }, [carregarDash]);

  const carregarProd = useCallback(async () => {
    try {
      const r = await fetch(`${API}/wms-listas?acao=produtividade`);
      const d = await r.json();
      if (d.ok) setProd(d);
    } catch { /* silencioso: métrica não bloqueia a operação */ }
  }, []);
  useEffect(() => { carregarProd(); }, [carregarProd]);

  // avisos parciais de andamento (10:30, 11:30, 13:00) — reconsulta a cada 2min
  const carregarAndamento = useCallback(async () => {
    try {
      const r = await fetch(`${API}/wms-listas?acao=andamento`);
      const d = await r.json();
      if (d.ok) setAndamento(d);
    } catch { /* silencioso */ }
  }, []);
  useEffect(() => {
    carregarAndamento();
    const t = setInterval(carregarAndamento, 120000);
    return () => clearInterval(t);
  }, [carregarAndamento]);

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

  const carregarDetalhes = useCallback(async (status) => {
    setDetCarregando(true); setErro('');
    try {
      const r = await fetch(`${API}/wms-listas?acao=pedidos&status=${status}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'falhou');
      setDetPedidos(d.pedidos || []);
    } catch (e) { setErro(e.message); }
    setDetCarregando(false);
  }, []);
  useEffect(() => { if (tela === 'detalhes') carregarDetalhes(detStatus); }, [tela, detStatus, carregarDetalhes]);

  const carregarPedidos = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const r = await fetch(`${API}/wms-listas?acao=pedidos&status=${fStatus}`);
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'falhou');
      setPedidos(d.pedidos || []);
      if (d.corte_em) setCorteEm(d.corte_em);
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

  // corte de hoje em ms (fallback: 12:00 local, se o endpoint ainda nao voltou)
  const corteMs = useMemo(() => {
    if (corteEm) return new Date(corteEm).getTime();
    const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime();
  }, [corteEm]);
  const ehPosCorte = useCallback((p) => !!p.criado_em && new Date(p.criado_em).getTime() >= corteMs, [corteMs]);
  // Flex = self_service no Mercado Livre (coleta cedo, costuma ter prioridade)
  const ehFlexPed = useCallback((p) => p.ml_logistic_type === 'self_service', []);

  const pedidosFiltrados = useMemo(() => pedidos.filter(p =>
    (fConta === 'todas' || p.conta === fConta) &&
    (fLoja === 'todas' || p.canal_geral === fLoja) &&
    (fJanela === 'todos' || !ehPosCorte(p)) &&
    (fEnvio === 'todos' || ehFlexPed(p))
  ), [pedidos, fConta, fLoja, fJanela, fEnvio, ehPosCorte, ehFlexPed]);
  const qtdFlex = useMemo(() => pedidos.filter(p =>
    (fConta === 'todas' || p.conta === fConta) &&
    (fLoja === 'todas' || p.canal_geral === fLoja) && ehFlexPed(p)
  ).length, [pedidos, fConta, fLoja, ehFlexPed]);
  const qtdPosCorte = useMemo(() => pedidos.filter(p =>
    (fConta === 'todas' || p.conta === fConta) &&
    (fLoja === 'todas' || p.canal_geral === fLoja) && ehPosCorte(p)
  ).length, [pedidos, fConta, fLoja, ehPosCorte]);

  // blocos por conta (padrão: as 3 separadas)
  const blocos = useMemo(() => {
    const contas = fConta === 'todas' ? CONTAS : [fConta];
    return contas.map(conta => {
      const doConta = pedidosFiltrados.filter(p => p.conta === conta);
      const mono = agregarMonoSku(doConta);
      // 2ª tentativa (voltou do Aguardando) sempre no topo, depois a ordem escolhida
      mono.sort((a, b) => ((b.tentativas || 1) > 1) - ((a.tentativas || 1) > 1)
        || (ordem === 'loc'
          ? (a.loc || 'Z').localeCompare(b.loc || 'Z') || b.pecas - a.pecas
          : b.pecas - a.pecas));
      const multi = doConta.filter(p => p.multi_sku);
      return { conta, mono, multi, nPedidos: doConta.length, nPecas: doConta.reduce((s, p) => s + (p.qtd_pecas || 0), 0) };
    }).filter(b => b.nPedidos > 0);
  }, [pedidosFiltrados, fConta, ordem]);

  const usaMatriz = (g) => visual === 'matriz' || (visual === 'auto' && g.nCores > 1 && g.tamanhos.length > 2);

  const tapSku = (conta, ref, cor, tam, qtdTotal) => {
    const k = `${conta}|${ref}|${cor}|${tam}`;
    setFaltas(prev => {
      const n = new Map(prev);
      const atual = n.get(k) || 0;
      const proximo = atual + 1 > qtdTotal ? 0 : atual + 1; // passou do total, zera
      if (proximo === 0) n.delete(k); else n.set(k, proximo);
      return n;
    });
  };

  const confirmarFaltas = async (blocosAtuais) => {
    // resolve as faltas (cor|tam) em pedido_ids concretos
    const ids = [];
    for (const b of blocosAtuais) {
      for (const g of b.mono) {
        for (const [k, qtd] of faltas.entries()) {
          const [cta, rf, cor, tam] = k.split('|');
          if (cta !== b.conta || rf !== g.ref) continue;
          const lista = (g.porSku?.[cor + '|' + tam] || []).slice(0, qtd);
          ids.push(...lista);
        }
      }
      for (const p of b.multi) {
        if (faltas.has('ped|' + p.id)) ids.push(p.id);
      }
    }
    const unicos = [...new Set(ids)];
    if (!unicos.length) { setModoFalta(false); return; }
    if (!window.confirm(`Marcar ${unicos.length} pedidos como aguardando mercadoria?\n\nEles saem da separação e voltam no topo da próxima lista, marcados como 2ª tentativa.`)) return;
    setSalvandoFaltas(true);
    try {
      const r = await fetch(`${API}/wms-listas`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'marcar_pendente', pedido_ids: unicos }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'falhou');
      setFaltas(new Map()); setModoFalta(false);
      await carregarPedidos(); await carregarDash();
    } catch (e) { setErro('Faltas: ' + e.message); }
    setSalvandoFaltas(false);
  };

  const chaveDoPedido = (p) => {
    if (p.multi_sku) return 'ped|' + p.id;
    const ref = (p.itens?.[0]?.ref) || '(sem ref)';
    return 'ref|' + p.conta + '|' + ref;
  };
  const pedidosIncluidos = useMemo(() => pedidosFiltrados.filter(p => modoDe(chaveDoPedido(p)) === 'imprimir'), [pedidosFiltrados, modoImpressao]);
  const pedidosJaImpressos = useMemo(() => pedidosFiltrados.filter(p => modoDe(chaveDoPedido(p)) === 'ja'), [pedidosFiltrados, modoImpressao]);

  const imprimirLista = async () => {
    const ids = pedidosIncluidos.map(p => p.id);
    const idsJa = pedidosJaImpressos.map(p => p.id);
    if (!ids.length && !idsJa.length) return;
    const partes = [];
    if (ids.length) partes.push(`${ids.length} pedidos no papel`);
    if (idsJa.length) partes.push(`${idsJa.length} marcados como já impressos (sem papel)`);
    if (!window.confirm(`Iniciar a separação?\n\n${partes.join(' + ')} vão pra "Em separação".${modoImpressao.size && [...modoImpressao.values()].includes('nao') ? '\n(Cards sem caixinha marcada ficam de fora e continuam abertos.)' : ''}`)) return;
    setImprimindo(true);
    try {
      if (idsJa.length) {
        const rj = await fetch(`${API}/wms-listas`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: 'marcar_impresso', pedido_ids: idsJa }),
        });
        const dj = await rj.json();
        if (!dj.ok) throw new Error(dj.error || 'já impressos falhou');
      }
      if (ids.length) {
        const r = await fetch(`${API}/wms-listas`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: 'imprimir', pedido_ids: ids, criado_por: userId, filtros: { conta: fConta, loja: fLoja, ordem } }),
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'falhou');
        setTimeout(() => window.print(), 300);
      }
      await carregarDash();
      setModoImpressao(new Map());
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

  // avisos de prazo POR CANAL (config: corte/envio/alerta_min por canal;
  //  Meluni e canais não mapeados entram como "Outros")
  const canalConfigDe = useCallback((canalGeral) => {
    const cg = String(canalGeral || '').toLowerCase();
    const canais = config?.canais || [];
    const acha = (nome) => canais.find(c => String(c.canal).toLowerCase() === nome);
    if (cg.includes('mercado')) return acha('mercado livre');
    if (cg.includes('shopee')) return acha('shopee');
    if (cg.includes('shein')) return acha('shein');
    if (cg.includes('tiktok')) return acha('tiktok');
    if (cg.includes('magalu') || cg.includes('magazine')) return acha('magalu');
    return acha('outros');
  }, [config]);

  const avisosPrazo = useMemo(() => {
    if (!dash?.por_canal) return [];
    const agora = new Date();
    const hAgora = agora.getHours() * 60 + agora.getMinutes();
    const min = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
    const out = [];
    const canais = config?.canais || [];
    if (!canais.length) {
      // sem config: aviso genérico 12:00/14:00
      const pend = (dash.total?.abertos || 0) + (dash.total?.em_separacao || 0);
      if (pend && hAgora >= 720 && hAgora < 840) out.push({ cor: '#c0392b', txt: `⏰ ${pend} pedidos pendentes e o envio é até 14:00 — prioridade na separação! (configura os horários por canal no ⚙)` });
      else if (pend && hAgora >= 630 && hAgora < 720) out.push({ cor: '#9a6b00', txt: `⏳ Corte às 12:00 — ${pend} pedidos pendentes. Bom momento pra imprimir a lista. (configura os horários por canal no ⚙)` });
      return out;
    }
    // agrega pendentes por canal de config
    const pendPorCfg = {};
    for (const [cg, v] of Object.entries(dash.por_canal)) {
      const cfgC = canalConfigDe(cg);
      if (!cfgC) continue;
      pendPorCfg[cfgC.canal] = (pendPorCfg[cfgC.canal] || 0) + (v.pendentes || 0);
    }
    for (const c of canais) {
      const pend = pendPorCfg[c.canal] || 0;
      if (!pend) continue;
      const mEnvio = min(c.envio), mCorte = min(c.corte);
      if (mEnvio != null && c.alerta_min > 0 && hAgora >= mEnvio - c.alerta_min && hAgora < mEnvio) {
        out.push({ cor: '#c0392b', txt: `🚨 ${c.canal}: ${pend} pedidos pendentes e o envio é às ${c.envio} (faltam ${mEnvio - hAgora} min)!` });
      } else if (mCorte != null && hAgora >= mCorte && (mEnvio == null || hAgora < mEnvio)) {
        out.push({ cor: '#9a6b00', txt: `⏳ ${c.canal}: corte das ${c.corte} já passou — ${pend} pedidos pendentes pro envio${c.envio ? ` das ${c.envio}` : ''}.` });
      }
    }
    return out;
  }, [dash, config, canalConfigDe]);

  const btn = (ativo) => ({
    padding: '7px 13px', borderRadius: 9, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 700,
    border: ativo ? `1.5px solid ${palette.accent}` : `1px solid ${palette.beige}`,
    background: ativo ? palette.accentSoft : '#fff', color: ativo ? palette.accent : palette.inkSoft,
  });
  // rótulo dos blocos da barra de filtros (Ailson 07/08: barra ficou confusa)
  const rotuloFiltro = {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
    color: palette.inkMuted, minWidth: 92,
  };

  return (
    <div style={{ fontFamily: FONT, background: palette.bg, minHeight: '100vh', paddingBottom: 40 }}>
      {/* print CSS: imprime só a área da lista */}
      <style>{`
      @page { size: A4; margin: 11mm; }
      @media print {
        .wms-no-print, .wms-skip-print { display: none !important; }
        .wms-print-area { box-shadow: none !important; }
        .wms-print-header { display: block !important; }
        body { background: #fff !important; }
      }`}</style>

      {/* Header */}
      <div className="wms-no-print" style={{ background: palette.ink, color: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={tela === 'dashboard' ? onBack : () => setTela('dashboard')} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 9, padding: 8, cursor: 'pointer', color: '#fff', display: 'flex' }}>
          <ArrowLeft size={19} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17.5, fontWeight: 800 }}>📦 Picking WMS</div>
          <div style={{ fontSize: 12, opacity: 0.92 }}>{tela === 'dashboard' ? 'Separação de pedidos dos marketplaces' : tela === 'config' ? 'Configurações' : tela === 'detalhes' ? 'Detalhar pedidos' : tela === 'produtividade' ? 'Produtividade da separação' : tela === 'aguardando' ? 'Aguardando mercadoria' : 'Lista de separação'}</div>
        </div>
        <button onClick={() => setTela('config')} title="Configurações" style={{ background: tela === 'config' ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 9, padding: 8, cursor: 'pointer', color: '#fff', display: 'flex' }}>
          <Settings size={18} />
        </button>
        <button onClick={sincronizar} disabled={sincronizando} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 9, padding: '8px 13px', cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, fontFamily: FONT, opacity: sincronizando ? 0.6 : 1 }}>
          <RefreshCw size={16} style={sincronizando ? { animation: 'spin 1s linear infinite' } : undefined} />
          {sincronizando ? 'Sincronizando…' : 'Sincronizar Bling'}
        </button>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {erro && <div className="wms-no-print" style={{ margin: 14, padding: '10px 14px', background: '#fdeaea', border: '1px solid #e8b4b4', borderRadius: 10, color: '#c0392b', fontSize: 13.5 }}>{erro}</div>}

      {tela === 'dashboard' && (
        <div style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {[
              { k: 'abertos', titulo: 'Pedidos Abertos', sub: 'lista ainda não impressa', Icon: Package, cor: palette.accent, extra: dash?.total ? `${dash.total.pecas_abertas} peças` : '' },
              {
                k: 'em_separacao', titulo: 'Em Separação', Icon: ClipboardList, cor: '#9a6b00',
                // NF geradas sobre os que REALMENTE geram nota; Flex e Meluni
                // ficam de fora da conta e aparecem à parte (Ailson 07/08)
                sub: dash?.total?.em_separacao
                  ? [
                    `NF geradas ${dash.total.em_separacao_nf || 0} de ${dash.total.em_separacao_com_nf_prevista || 0}`,
                    dash.total.em_separacao_flex ? `${dash.total.em_separacao_flex} pedidos Flex` : '',
                    dash.total.em_separacao_meluni ? `${dash.total.em_separacao_meluni} pedidos Meluni` : '',
                  ].filter(Boolean).join(' · ')
                  : 'lista impressa, separando',
              },
              { k: 'finalizados_hoje', titulo: 'Finalizados Hoje', sub: 'bipados + etiqueta (Verificado)', Icon: CheckCircle2, cor: '#1e8e4e' },
              { k: 'aguardando', titulo: 'Aguardando', sub: 'faltou mercadoria · volta na próxima onda', Icon: Clock, cor: '#9a6b00' },
              // fila de amanhã: entrou depois do corte, vira "aberto" na virada do dia (Ailson 07/08)
              { k: 'pra_amanha', titulo: 'Pedidos pra Amanhã', sub: 'entraram depois do corte das 12:00', Icon: Clock, cor: palette.inkSoft },
            ].map(c => (
              <div key={c.k} onClick={c.k === 'aguardando' ? () => setTela('aguardando') : undefined}
                style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 18, boxShadow: '0 1px 4px rgba(44,62,80,0.05)', cursor: c.k === 'aguardando' ? 'pointer' : 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <c.Icon size={22} color={c.cor} strokeWidth={1.8} />
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: palette.inkSoft }}>{c.titulo}</span>
                </div>
                <div style={{ fontSize: 34, fontWeight: 800, color: c.cor, lineHeight: 1 }}>{dash?.total?.[c.k] ?? '—'}</div>
                <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 6 }}>{c.sub}{c.extra ? ` · ${c.extra}` : ''}</div>
              </div>
            ))}
          </div>

          {/* Vendas do dia — oculto por padrão pra não competir com o funil.
              Full não passa pela separação, por isso fica à parte (Ailson 07/08) */}
          <div className="wms-no-print" style={{ marginTop: 12 }}>
            {!vendasAberto && (
              <button onClick={() => setVendasAberto(true)} style={{ background: 'none', border: 'none', color: palette.inkMuted, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT, padding: '4px 2px' }}>
                ▸ Ver vendas do dia
              </button>
            )}
            {vendasAberto && (
              <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 16, boxShadow: '0 1px 4px rgba(44,62,80,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: palette.inkSoft }}>Vendas do dia</span>
                  <button onClick={() => setVendasAberto(false)} style={{ background: 'none', border: 'none', color: palette.inkMuted, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>ocultar</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
                  {[
                    { l: 'Total do dia', v: dash?.vendas_dia?.total ?? '—', d: 'finalizados loja + Full de hoje' },
                    { l: 'Pedidos loja', v: dash?.vendas_dia?.loja_finalizados ?? '—', d: 'finalizados hoje (de qualquer dia)' },
                    { l: 'Pedidos Full', v: dash?.vendas_dia?.full ?? '—', d: 'que entraram hoje (00h→24h)' },
                  ].map(x => (
                    <div key={x.l}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: palette.ink, lineHeight: 1.1 }}>{x.v}</div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: palette.inkSoft, marginTop: 3 }}>{x.l}</div>
                      <div style={{ fontSize: 11, color: palette.inkMuted }}>{x.d}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Notificação de produtividade: aparece 12:30, dura 40 min (Ailson 05/08) */}
          {(() => {
            if (!prod?.hoje?.pedidos_por_hora) return null;
            const agora = new Date();
            const minAgora = agora.getHours() * 60 + agora.getMinutes();
            if (config && config.aviso_prod_ativo === false) return null;
            const durProd = Number(config?.duracoes?.prod ?? 40);
            if (minAgora < 810 || minAgora > 810 + durProd) return null; // 13:30 + duração
            // com risco de estourar o envio, nada de parabéns (Ailson 06/08)
            if (andamento?.risco_estouro) return null;
            const refManualProd = config?.prod_ref_modo === 'manual' ? config?.prod_ref_manual : null;
            let varPct = prod.hoje.variacao_pct;
            if (refManualProd != null && refManualProd > 0 && prod.hoje.pedidos_por_hora) {
              varPct = +(((Number(prod.hoje.pedidos_por_hora) - refManualProd) / refManualProd) * 100).toFixed(1);
            }
            const av = avaliarVariacao(varPct);
            return (
              <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 13, background: av.tipo === 'alta' ? '#e8f6ee' : av.tipo === 'baixa' ? '#fdeaea' : '#f4f0ea', border: `1.5px solid ${av.cor}55` }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: palette.inkSoft, marginBottom: 7 }}>⏱ Produtividade da separação de hoje</div>
                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 11.5, color: palette.inkMuted }}>Média por pedido</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: palette.ink }}>{fmtDur(prod.hoje.media_seg_por_pedido)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11.5, color: palette.inkMuted }}>Pedidos por hora</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color: av.cor }}>
                      {av.seta} {Number(prod.hoje.pedidos_por_hora).toFixed(0)}
                      {varPct != null && <span style={{ fontSize: 13, marginLeft: 6 }}>({varPct > 0 ? '+' : ''}{varPct}%)</span>}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: av.cor }}>{av.msg}</div>
              </div>
            );
          })()}

          {/* aviso parcial de andamento (Ailson 06/08) — abaixo dos cards */}
          {andamento?.aviso && (() => {
            const a = andamento.aviso;
            const cor = a.situacao === 'vermelho' ? '#c0392b'
              : a.situacao === 'risco' || a.situacao === 'atencao' ? '#9a6b00' : '#1e8e4e';
            const fundo = a.situacao === 'vermelho' ? '#fdeaea'
              : a.situacao === 'risco' || a.situacao === 'atencao' ? '#fff6e5' : '#e8f6ee';
            return (
              <div style={{ marginTop: 14, padding: '13px 16px', borderRadius: 13, background: fundo, border: `1.5px solid ${cor}55` }}>
                <div style={{ fontSize: 11.5, color: palette.inkMuted, marginBottom: 3 }}>Andamento · {a.marco}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: cor, marginBottom: 4 }}>{a.titulo}</div>
                <div style={{ fontSize: 13.5, color: palette.inkSoft }}>{a.texto}</div>
              </div>
            );
          })()}

          {/* avisos abaixo dos cards (Ailson 05/08: foco total nos 3 cards) */}
          <div style={{ marginTop: 14 }}>
            {avisosPrazo.map((a, i) => (
              <div key={i} style={{ marginBottom: 8, padding: '10px 14px', borderRadius: 11, background: a.cor === '#c0392b' ? '#fdeaea' : '#fff6e5', border: `1.5px solid ${a.cor}44`, color: a.cor, fontSize: 13.5, fontWeight: 700 }}>
                {a.txt}
              </div>
            ))}
          </div>

          {/* por conta — retraído, clica pra expandir */}
          {dash?.por_conta && Object.keys(dash.por_conta).length > 0 && (
            <div style={{ marginTop: 6, background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: '12px 16px' }}>
              <button onClick={() => setPorContaAberto(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 800, color: palette.inkSoft, padding: 0 }}>
                <Boxes size={17} strokeWidth={1.8} /> Por conta
                <span style={{ marginLeft: 'auto', fontSize: 12, color: palette.inkMuted }}>{porContaAberto ? '▲ recolher' : '▼ expandir'}</span>
              </button>
              {porContaAberto && (<div style={{ marginTop: 8 }}>
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
              </div>)}
              {dash.ultimo_sync && <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={13} /> Último sync: {new Date(dash.ultimo_sync).toLocaleString('pt-BR')}</div>}
            </div>
          )}

          <button onClick={() => setTela('separacao')} style={{ marginTop: 18, width: '100%', padding: '15px', borderRadius: 13, border: 'none', background: palette.accent, color: '#fff', fontSize: 15.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}>
            <ClipboardList size={19} /> Abrir Lista de Separação
          </button>
          <button onClick={() => setTela('detalhes')} style={{ marginTop: 10, width: '100%', padding: '13px', borderRadius: 13, border: `1.5px solid ${palette.accent}`, background: '#fff', color: palette.accent, fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Boxes size={18} /> Detalhar Pedidos
          </button>
          <button onClick={() => setTela('produtividade')} style={{ marginTop: 10, width: '100%', padding: '13px', borderRadius: 13, border: `1.5px solid ${palette.beige}`, background: '#fff', color: palette.inkSoft, fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Clock size={18} /> Produtividade
          </button>
        </div>
      )}

      {tela === 'config' && config && (
        <ConfigScreen config={config} API={API} salvando={salvandoCfg} onSalvar={async (nova) => {
          setSalvandoCfg(true); setErro('');
          try {
            const r = await fetch(`${API}/wms-listas`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ acao: 'config', config: nova }),
            });
            const d = await r.json();
            if (!d.ok) throw new Error(d.error || 'falhou');
            setConfig(d.config);
            setTela('dashboard');
            await carregarDash();
          } catch (e) { setErro('Config: ' + e.message); }
          setSalvandoCfg(false);
        }} />
      )}
      {tela === 'config' && !config && <div style={{ textAlign: 'center', padding: 40, color: palette.inkMuted }}>Carregando configurações…</div>}

      {tela === 'aguardando' && (
        <TelaAguardando API={API} onVoltar={async () => { await carregarDash(); setTela('dashboard'); }} onErro={setErro} />
      )}

      {tela === 'produtividade' && (
        <div style={{ padding: 16, maxWidth: 760, margin: '0 auto' }}>
          {!prod && <div style={{ textAlign: 'center', padding: 30, color: palette.inkMuted }}>Carregando…</div>}
          {prod && !prod.hoje && (
            <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 18, marginBottom: 14, fontSize: 13.5, color: palette.inkMuted }}>
              O cronômetro de hoje ainda não começou. Ele dispara na primeira impressão da lista (com 10 minutos de margem) e o corte é às 12:00.
            </div>
          )}
          {prod?.hoje && (() => {
            const h = prod.hoje, av = avaliarVariacao(h.variacao_pct);
            const hhmm = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            return (
              <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 17, marginBottom: 14 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: palette.ink, marginBottom: 3 }}>Hoje {prod.fechado ? '(fechado às 12:00)' : '(parcial, fecha às 12:00)'}</div>
                <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 13 }}>
                  Cronômetro de {hhmm(h.inicio_em)} até {hhmm(h.corte_em)} · {h.pedidos_em_separacao} pedidos em separação no corte descontaram {Math.round(h.segundos_descontados / 60)} min
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                  {[
                    { l: 'Finalizados', v: h.pedidos_finalizados, c: palette.ink },
                    { l: 'Média por pedido', v: fmtDur(h.media_seg_por_pedido), c: palette.ink },
                    { l: 'Pedidos por hora', v: `${av.seta} ${h.pedidos_por_hora ? Number(h.pedidos_por_hora).toFixed(0) : '—'}`, c: av.cor },
                  ].map(k => (
                    <div key={k.l} style={{ background: palette.bg, borderRadius: 11, padding: 12 }}>
                      <div style={{ fontSize: 11.5, color: palette.inkMuted, marginBottom: 3 }}>{k.l}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: k.c }}>{k.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, fontSize: 13.5, fontWeight: 700, color: av.cor }}>{av.msg}</div>
                {prod.referencia && <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 5 }}>Média de referência (últimos dias): {Number(prod.referencia).toFixed(0)} pedidos/hora</div>}
              </div>
            );
          })()}

          <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 14, padding: 17 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: palette.ink, marginBottom: 11 }}>📈 Histórico diário (pedidos por hora)</div>
            <GraficoBarras dados={prod?.historico || []} referencia={prod?.referencia} />
            <button onClick={async () => {
              if (!window.confirm('Limpar TODO o histórico de produtividade?\n\nOs dias já registrados somem e a média de referência recomeça do zero. (Use enquanto o módulo está em testes.)')) return;
              try {
                const r = await fetch(`${API}/wms-listas`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ acao: 'limpar_produtividade' }),
                });
                const d = await r.json();
                if (!d.ok) throw new Error(d.error || 'falhou');
                await carregarProd();
              } catch (e) { setErro('Limpar histórico: ' + e.message); }
            }} style={{ marginTop: 12, padding: '8px 14px', borderRadius: 9, border: `1px solid ${palette.beige}`, background: '#fff', color: palette.inkMuted, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
              🗑 Limpar histórico (fase de testes)
            </button>

            {(prod?.historico || []).length > 0 && (
              <div style={{ marginTop: 14, fontSize: 12.5 }}>
                {[...prod.historico].reverse().slice(0, 10).map(d => {
                  const av = avaliarVariacao(d.variacao_pct != null ? Number(d.variacao_pct) : null);
                  return (
                    <div key={d.data} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid #f4f0ea', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, minWidth: 52 }}>{d.data.slice(8, 10)}/{d.data.slice(5, 7)}</span>
                      <span style={{ color: palette.inkSoft }}>{d.pedidos_finalizados} pedidos</span>
                      <span style={{ color: palette.inkSoft }}>{fmtDur(d.media_seg_por_pedido)}/pedido</span>
                      <span style={{ fontWeight: 800, color: av.cor, marginLeft: 'auto' }}>{av.seta} {Number(d.pedidos_por_hora || 0).toFixed(0)}/h</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tela === 'detalhes' && (
        <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 7, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {[['aberto', 'Abertos'], ['em_separacao', 'Em Separação'], ['finalizado', 'Finalizados']].map(([v, l]) => (
              <button key={v} onClick={() => setDetStatus(v)} style={{
                padding: '8px 15px', borderRadius: 10, cursor: 'pointer', fontFamily: FONT, fontSize: 13.5, fontWeight: 800,
                border: detStatus === v ? `1.5px solid ${palette.accent}` : `1px solid ${palette.beige}`,
                background: detStatus === v ? palette.accentSoft : '#fff', color: detStatus === v ? palette.accent : palette.inkSoft,
              }}>{l}</button>
            ))}
            <input value={detBusca} onChange={e => setDetBusca(e.target.value)} placeholder="🔍 nº pedido, cliente ou ref"
              style={{ flex: 1, minWidth: 180, padding: '8px 12px', borderRadius: 10, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13.5 }} />
          </div>

          {detCarregando && <div style={{ textAlign: 'center', padding: 30, color: palette.inkMuted }}>Carregando…</div>}
          {!detCarregando && (() => {
            const b = detBusca.trim().toLowerCase();
            const lista = detPedidos.filter(p => !b ||
              String(p.numero || '').toLowerCase().includes(b) ||
              String(p.numero_loja || '').toLowerCase().includes(b) ||
              String(p.cliente_nome || '').toLowerCase().includes(b) ||
              (p.itens || []).some(it => String(it.ref || '').includes(b)));
            if (!lista.length) return <div style={{ textAlign: 'center', padding: 36, color: palette.inkMuted, fontSize: 14 }}>Nenhum pedido {b ? 'na busca' : 'nesse status'}.</div>;
            return (<>
              <div style={{ fontSize: 12.5, color: palette.inkMuted, marginBottom: 9 }}>{lista.length} pedidos · {lista.reduce((sm, p) => sm + (p.qtd_pecas || 0), 0)} peças</div>
              {lista.map(p => (
                <div key={p.id} style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 12, padding: '11px 14px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 5, fontSize: 13 }}>
                    <span style={{ fontWeight: 800, fontSize: 14.5 }}>#{p.numero}</span>
                    {p.numero_loja && <span style={{ color: palette.inkMuted, fontSize: 11.5 }}>({p.numero_loja})</span>}
                    <span style={{ fontWeight: 800, color: palette.accent, fontSize: 12, background: palette.accentSoft, borderRadius: 6, padding: '1px 8px' }}>{NOME_CONTA[p.conta] || p.conta}</span>
                    <span style={{ color: palette.inkSoft, fontWeight: 700 }}>{p.canal_geral || p.loja_nome || '—'}</span>
                    <span style={{ color: palette.inkMuted }}>{p.data_pedido ? p.data_pedido.split('-').reverse().join('/') : ''}</span>
                    {p.multi_sku && <span style={{ color: '#9a6b00', fontWeight: 800, fontSize: 11.5 }}>🧺 multi</span>}
                  </div>
                  {p.cliente_nome && <div style={{ fontSize: 13, color: palette.ink, fontWeight: 700, marginBottom: 5 }}>👤 {p.cliente_nome}</div>}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {(p.itens || []).map((it, i) => (
                      <div key={i} style={{ fontSize: 13, color: palette.inkSoft }}>
                        <b>{it.quantidade}x</b> REF <b>{it.ref || '?'}</b> {it.cor} <b>{String(it.tamanho || '').toUpperCase()}</b>{it.estoque ? <span style={{ color: '#7a5c99', fontWeight: 700 }}> · 📍{it.estoque}</span> : ''}
                      </div>
                    ))}
                  </div>
                  {(p.impresso_em || p.finalizado_em) && (
                    <div style={{ fontSize: 11, color: palette.inkMuted, marginTop: 6 }}>
                      {p.impresso_em ? `🖨 impresso ${new Date(p.impresso_em).toLocaleString('pt-BR')}` : ''}
                      {p.finalizado_em ? `  ·  ✅ finalizado ${new Date(p.finalizado_em).toLocaleString('pt-BR')}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </>);
          })()}
        </div>
      )}

      {tela === 'separacao' && (
        <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
          {/* filtros */}
          <div className="wms-no-print" style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 13, padding: 13, marginBottom: 14, display: 'grid', gap: 10 }}>
            {/* 3 blocos rotulados em vez de tudo numa linha só (Ailson 07/08) */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={rotuloFiltro}>O que separar</span>
              <button onClick={() => setFStatus('aberto')} style={btn(fStatus === 'aberto')}>Abertos</button>
              <button onClick={() => setFStatus('em_separacao')} style={btn(fStatus === 'em_separacao')}>Em separação</button>
              <span style={{ width: 1, height: 20, background: palette.beige }} />
              <button onClick={() => setFJanela('todos')} style={btn(fJanela === 'todos')}>Todos os pedidos</button>
              <button onClick={() => setFJanela('ate_corte')} style={btn(fJanela === 'ate_corte')}>Até o corte (12:00)</button>
              <span style={{ width: 1, height: 20, background: palette.beige }} />
              <button onClick={() => setFEnvio(fEnvio === 'flex' ? 'todos' : 'flex')} style={btn(fEnvio === 'flex')}>
                ⚡ Só Flex{qtdFlex ? ` (${qtdFlex})` : ''}
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={rotuloFiltro}>De onde</span>
              {['todas', ...CONTAS].map(c => (
                <button key={c} onClick={() => { setFConta(c); setFLoja('todas'); }} style={btn(fConta === c)}>{c === 'todas' ? 'Todas' : NOME_CONTA[c]}</button>
              ))}
              <select value={fLoja} onChange={e => setFLoja(e.target.value)} style={{ ...btn(fLoja !== 'todas'), appearance: 'auto' }}>
                <option value="todas">Todas as lojas</option>
                {lojasDisponiveis.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={rotuloFiltro}>Como mostrar</span>
              <button onClick={() => setOrdem(ordem === 'qtd' ? 'loc' : 'qtd')} style={btn(true)}>
                {ordem === 'qtd' ? '↓ Maior quantidade' : '📍 Por localização'}
              </button>
              {[['auto', 'Auto'], ['matriz', 'Matriz'], ['lista', 'Lista']].map(([v, l]) => (
                <button key={v} onClick={() => setVisual(v)} style={btn(visual === v)}>{l}</button>
              ))}
            </div>

            {fEnvio === 'todos' && fJanela === 'todos' && qtdPosCorte > 0 && (
              <span style={{ fontSize: 11.5, color: palette.inkMuted }}>
                {qtdPosCorte} {qtdPosCorte === 1 ? 'pedido entrou' : 'pedidos entraram'} depois do corte das 12:00.
              </span>
            )}
          </div>

          {/* ações */}
          <div className="wms-no-print" style={{ display: 'flex', gap: 9, marginBottom: 14, flexWrap: 'wrap' }}>
            {fStatus === 'aberto' && (
              <button onClick={imprimirLista} disabled={imprimindo || (!pedidosIncluidos.length && !pedidosJaImpressos.length)} style={{ flex: 1, minWidth: 220, padding: '13px', borderRadius: 12, border: 'none', background: (pedidosIncluidos.length || pedidosJaImpressos.length) ? palette.accent : '#c8c0b6', color: '#fff', fontSize: 14.5, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Printer size={18} /> Imprimir e iniciar separação ({pedidosIncluidos.length} no papel{pedidosJaImpressos.length ? ` · ${pedidosJaImpressos.length} já impressos` : ''}{pedidosFiltrados.length - pedidosIncluidos.length - pedidosJaImpressos.length > 0 ? ` · ${pedidosFiltrados.length - pedidosIncluidos.length - pedidosJaImpressos.length} de fora` : ''})
              </button>
            )}
            {fStatus === 'em_separacao' && !modoFalta && (
              <button onClick={() => setModoFalta(true)} style={{ flex: 1, minWidth: 190, padding: '12px', borderRadius: 12, border: '1.5px solid #d9a441', background: '#fdf6e3', color: '#9a6b00', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                ⏳ Repassar faltas
              </button>
            )}
            {fStatus === 'em_separacao' && modoFalta && (<>
              <div style={{ flexBasis: '100%', fontSize: 13, color: '#9a6b00', fontWeight: 700, background: '#fdf6e3', border: '1px solid #e0c98a', borderRadius: 10, padding: '9px 13px' }}>
                Toque nas peças que o auxiliar circulou no papel. Cada toque soma 1; passando do total, zera. {faltas.size > 0 ? `${[...faltas.values()].reduce((a, x) => a + x, 0)} peças marcadas.` : ''}
              </div>
              <button onClick={() => confirmarFaltas(blocos)} disabled={salvandoFaltas || !faltas.size} style={{ flex: 1, minWidth: 190, padding: '12px', borderRadius: 12, border: 'none', background: faltas.size ? '#9a6b00' : '#c8c0b6', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: FONT }}>
                {salvandoFaltas ? 'Salvando…' : '⏳ Confirmar faltas'}
              </button>
              <button onClick={() => { setFaltas(new Map()); setModoFalta(false); }} style={{ padding: '12px 15px', borderRadius: 12, border: `1px solid ${palette.beige}`, background: '#fff', color: palette.inkSoft, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT }}>
                Cancelar
              </button>
            </>)}
            {fStatus === 'em_separacao' && !modoFalta && (<>
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
            <div className="wms-print-header" style={{ display: 'none', marginBottom: 14, borderBottom: '2px solid #2c3e50', paddingBottom: 8 }}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>📦 Lista de Separação — Picking WMS</div>
              <div style={{ fontSize: 12, color: '#5a6b7d' }}>{new Date().toLocaleString('pt-BR')} · {fConta === 'todas' ? 'Todas as contas' : NOME_CONTA[fConta]}{fLoja !== 'todas' ? ` · ${fLoja}` : ''} · ordem: {ordem === 'qtd' ? 'maior quantidade' : 'localização'}</div>
            </div>
            {blocos.map(b => (
              <div key={b.conta} style={{ marginBottom: 26, pageBreakInside: 'avoid' }}>
                <div style={{ fontSize: 17, fontWeight: 800, color: palette.ink, padding: '9px 13px', background: '#f4f0ea', borderRadius: 11, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>🏷 {NOME_CONTA[b.conta]}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: palette.inkSoft }}>{b.nPedidos} pedidos · {b.nPecas} peças</span>
                </div>

                {/* mono-SKU agregado por ref */}
                {b.mono.map(g => {
                  const chave = 'ref|' + b.conta + '|' + g.ref;
                  const modo = modoDe(chave);
                  const fora = modo !== 'imprimir';
                  return (
                  <div key={g.ref} className={fora ? 'wms-skip-print' : undefined} style={{ background: '#fff', border: `1px solid ${modo === 'nao' ? '#e8b4b4' : modo === 'ja' ? '#d9c88f' : palette.beige}`, borderRadius: 12, padding: 13, marginBottom: 10, display: 'flex', gap: 13, alignItems: 'flex-start', pageBreakInside: 'avoid', opacity: modo === 'nao' ? 0.55 : 1 }}>
                    <FotoRef refProd={g.ref} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, flexWrap: 'wrap', marginBottom: 7 }}>
                        {fStatus === 'aberto' && (
                          <div className="wms-no-print" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label title="Entra na lista de impressão e vai pra Em Separação" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: modo === 'imprimir' ? '#1e8e4e' : palette.inkMuted, cursor: 'pointer' }}>
                              <input type="checkbox" checked={modo === 'imprimir'} onChange={() => toggleCaixa(chave, 'imprimir')} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                              imprimir
                            </label>
                            <label title="Já vi na tela e já busquei no estoque: vai pra Em Separação sem sair no papel" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: modo === 'ja' ? '#9a6b00' : palette.inkMuted, cursor: 'pointer' }}>
                              <input type="checkbox" checked={modo === 'ja'} onChange={() => toggleCaixa(chave, 'ja')} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                              já impresso
                            </label>
                          </div>
                        )}
                        <span style={{ fontSize: 16.5, fontWeight: 800 }}>REF {g.ref}</span>
                        {g.loc && <span style={{ fontSize: 12.5, fontWeight: 800, color: '#7a5c99', background: '#f3eefb', border: '1px solid #ddd0f0', borderRadius: 7, padding: '2px 9px' }}>📍 {g.loc}</span>}
                        {(g.tentativas || 1) > 1 && <span style={{ fontSize: 11.5, fontWeight: 800, color: '#9a6b00', background: '#fdf0d5', border: '1px solid #e0c98a', borderRadius: 7, padding: '2px 8px' }}>⏳ {g.tentativas}ª tentativa</span>}
                        <span style={{ fontSize: 12, color: palette.inkMuted }}>{g.pedidos} pedidos · {g.pecas} pçs</span>
                      </div>
                      {g.descLimpa && <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 8 }}>{g.descLimpa}</div>}
                      {usaMatriz(g)
                        ? <MatrizRef g={g} modoFalta={modoFalta && fStatus === 'em_separacao'} faltaDe={(c, t) => faltas.get(`${b.conta}|${g.ref}|${c}|${t}`)} onTapSku={(c, t, q) => tapSku(b.conta, g.ref, c, t, q)} />
                        : <ListaRef g={g} modoFalta={modoFalta && fStatus === 'em_separacao'} faltaDe={(c, t) => faltas.get(`${b.conta}|${g.ref}|${c}|${t}`)} onTapSku={(c, t, q) => tapSku(b.conta, g.ref, c, t, q)} />}
                    </div>
                  </div>
                );})}

                {/* multi-SKU: um bloco por pedido */}
                {b.multi.length > 0 && (
                  <div style={{ pageBreakBefore: 'always' }}>
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#9a6b00', padding: '7px 13px', background: '#fff6e5', borderRadius: 10, margin: '14px 0 10px' }}>
                      🧺 Pedidos com múltiplos SKUs — {NOME_CONTA[b.conta]} ({b.multi.length})
                    </div>
                    {b.multi.map(p => {
                      const chave = 'ped|' + p.id;
                      const modo = modoDe(chave);
                      const fora = modo !== 'imprimir';
                      return (
                      <div key={p.id} className={fora ? 'wms-skip-print' : undefined} style={{ background: '#fff', border: `1px solid ${modo === 'nao' ? '#e8b4b4' : modo === 'ja' ? '#d9c88f' : palette.beige}`, borderRadius: 12, padding: 13, marginBottom: 10, pageBreakInside: 'avoid', opacity: modo === 'nao' ? 0.55 : 1 }}>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 8, fontSize: 13 }}>
                          {fStatus === 'aberto' && (
                            <div className="wms-no-print" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: modo === 'imprimir' ? '#1e8e4e' : palette.inkMuted, cursor: 'pointer' }}>
                                <input type="checkbox" checked={modo === 'imprimir'} onChange={() => toggleCaixa(chave, 'imprimir')} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                                imprimir
                              </label>
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, color: modo === 'ja' ? '#9a6b00' : palette.inkMuted, cursor: 'pointer' }}>
                                <input type="checkbox" checked={modo === 'ja'} onChange={() => toggleCaixa(chave, 'ja')} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                                já impresso
                              </label>
                            </div>
                          )}
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
                    );})}
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
