/**
 * PickingWMS_Etiquetas.jsx — TELA de impressão de etiquetas (Ailson 12/08/2026)
 *
 * NÃO é modal: é uma tela do módulo, irmã da lista de separação, com os mesmos
 * filtros (empresa · loja · horário de corte · tipo) e a mesma linguagem visual
 * (azul marinho, azul claro, bege — nada fora da cartela).
 *
 * As etiquetas saem agrupadas por REFERÊNCIA e depois por LOCALIZAÇÃO:
 * todas as 2277 (loc A), todas as 2601 (loc A), todas as 2600 (loc B)… — o
 * casamento peça↔etiqueta acontece na arara, um grupo por vez.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import { palette, FONT } from './Lojas_Shared.jsx';

const CONTAS = ['exitus', 'lumia', 'muniam'];
const NOME_CONTA = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
const LOJAS = ['Mercado Livre', 'Shein', 'Shopee', 'TikTok', 'Magalu'];

export default function TelaEtiquetas({ API, corteHora = '12:30', onErro }) {
  const [fConta, setFConta] = useState('todas');
  const [fLoja, setFLoja] = useState('todas');
  const [fJanela, setFJanela] = useState('todos');   // todos | ate_corte
  const [fTipo, setFTipo] = useState('nf_transporte'); // nf_transporte | flex | meluni
  const [fRef, setFRef] = useState('');
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);

  const qs = useCallback((extra = {}) => {
    const q = new URLSearchParams({ contas: fConta, loja: fLoja, tipo: fTipo, ...extra });
    if (fJanela === 'ate_corte') q.set('corte', corteHora);
    if (fRef.trim()) q.set('ref', fRef.trim());
    return q.toString();
  }, [fConta, fLoja, fTipo, fJanela, fRef, corteHora]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(`${API}/wms-etiquetas?${qs({ previa: '1' })}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
      setDados(j);
    } catch (e) { onErro?.(e.message); setDados(null); }
    finally { setCarregando(false); }
  }, [API, qs, onErro]);

  useEffect(() => { carregar(); }, [carregar]);

  const btn = (ativo) => ({
    padding: '9px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: FONT, fontSize: 13.5,
    fontWeight: ativo ? 800 : 600,
    border: ativo ? `1.5px solid ${palette.accent}` : `1px solid ${palette.beige}`,
    background: ativo ? palette.accentSoft : '#fff',
    color: ativo ? palette.ink : palette.inkSoft,
  });
  const rotulo = { fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase', color: palette.inkMuted, minWidth: 92 };

  const grupos = dados?.grupos || [];
  const totalPedidos = dados?.total_pedidos || 0;

  return (
    <div style={{ padding: 16, maxWidth: 860, margin: '0 auto' }}>
      {/* filtros — mesma gramática da lista de separação */}
      <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 13, padding: 13, marginBottom: 14, display: 'grid', gap: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={rotulo}>Empresa</span>
          {['todas', ...CONTAS].map(c => (
            <button key={c} onClick={() => setFConta(c)} style={btn(fConta === c)}>{c === 'todas' ? 'Todas' : NOME_CONTA[c]}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={rotulo}>Loja</span>
          <button onClick={() => setFLoja('todas')} style={btn(fLoja === 'todas')}>Todas</button>
          {LOJAS.map(l => (
            <button key={l} onClick={() => setFLoja(l)} style={btn(fLoja === l)}>{l}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={rotulo}>Período</span>
          <button onClick={() => setFJanela('todos')} style={btn(fJanela === 'todos')}>Todos</button>
          <button onClick={() => setFJanela('ate_corte')} style={btn(fJanela === 'ate_corte')}>Até o corte ({corteHora})</button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={rotulo}>Imprimir</span>
          <button onClick={() => setFTipo('nf_transporte')} style={btn(fTipo === 'nf_transporte')}>NF + transporte</button>
          <button onClick={() => setFTipo('flex')} style={btn(fTipo === 'flex')}>⚡ Flex</button>
          <button onClick={() => setFTipo('meluni')} style={btn(fTipo === 'meluni')}>Meluni</button>
          <input value={fRef} onChange={e => setFRef(e.target.value)} placeholder="REF específica"
            style={{ padding: '9px 12px', borderRadius: 10, border: `1px solid ${palette.beige}`, fontFamily: FONT, fontSize: 13.5, width: 130, color: palette.ink }} />
        </div>
      </div>

      {/* ação */}
      <div style={{ display: 'flex', gap: 9, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => window.open(`${API}/wms-etiquetas?${qs({ pdf: '1' })}`, '_blank')}
          disabled={!totalPedidos}
          style={{ flex: 1, minWidth: 240, padding: '14px', borderRadius: 12, border: 'none',
            background: totalPedidos ? palette.ink : '#c8c0b6', color: '#fff', fontSize: 15, fontWeight: 800,
            cursor: totalPedidos ? 'pointer' : 'default', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Printer size={18} /> Gerar etiquetas ({totalPedidos} {totalPedidos === 1 ? 'pedido' : 'pedidos'})
        </button>
        <button onClick={carregar} style={{ padding: '14px 16px', borderRadius: 12, border: `1.5px solid ${palette.beige}`, background: '#fff', color: palette.inkSoft, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 }}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      {/* grupos na ordem de impressão */}
      <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 13, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: palette.ink, marginBottom: 3 }}>Ordem de impressão</div>
        <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 12 }}>
          Por referência e depois localização — cada grupo sai com uma folha separadora antes das etiquetas (NF + transporte).
        </div>

        {carregando && <div style={{ color: palette.inkMuted, fontSize: 13, padding: 10 }}>Carregando…</div>}
        {!carregando && !grupos.length && (
          <div style={{ color: palette.inkMuted, fontSize: 13, padding: 10 }}>Nenhum pedido nesses filtros.</div>
        )}

        {grupos.map((g, i) => (
          <div key={`${g.ref}-${g.loc}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 4px', borderBottom: i < grupos.length - 1 ? `1px solid ${palette.beigeSoft}` : 'none' }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: palette.accentSoft, color: palette.accent, fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>{i + 1}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: palette.ink }}>
                REF {g.ref} <span style={{ fontWeight: 600, color: palette.inkSoft, fontSize: 13 }}>· 📍 {g.loc}</span>
              </div>
              <div style={{ fontSize: 11.5, color: palette.inkMuted }}>{(g.canais || []).join(', ')}{g.contas?.length ? ` · ${g.contas.map(c => NOME_CONTA[c] || c).join(', ')}` : ''}</div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: palette.accent }}>{g.pedidos} {g.pedidos === 1 ? 'etiqueta' : 'etiquetas'}</div>
          </div>
        ))}

        {dados?.nota && <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 12 }}>{dados.nota}</div>}
      </div>

      <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 12, lineHeight: 1.6 }}>
        Formato 10x15 · DANFE simplificada. Sai NF das contas com escopo liberado no Bling e etiqueta de transporte dos canais já integrados; o que faltar aparece na última página como pendência, sem travar o resto.
      </div>
    </div>
  );
}
