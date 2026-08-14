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
  const [porEmpresa, setPorEmpresa] = useState(false);    // Exitus inteira → Lumia → Muniam
  const [reimprimir, setReimprimir] = useState(false);   // trava: só com escolha consciente
  const [verFinalizados, setVerFinalizados] = useState(false);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(false);

  const qs = useCallback((extra = {}) => {
    const q = new URLSearchParams({ contas: fConta, loja: fLoja, tipo: fTipo, ...extra });
    if (fJanela === 'ate_corte') q.set('corte', corteHora);
    if (fRef.trim()) q.set('ref', fRef.trim());
    if (porEmpresa) q.set('por_empresa', '1');
    if (reimprimir) q.set('reimprimir', '1');
    if (verFinalizados) q.set('incluir_finalizados', '1');
    return q.toString();
  }, [fConta, fLoja, fTipo, fJanela, fRef, corteHora, reimprimir, verFinalizados, porEmpresa]);

  const [imprimindo, setImprimindo] = useState('');

  // QZ Tray (já instalado na máquina da expedição): carrega a lib sob demanda
  const carregarQz = () => new Promise((ok, falha) => {
    if (window.qz) return ok(window.qz);
    const el = document.createElement('script');
    el.src = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';
    el.onload = () => ok(window.qz);
    el.onerror = () => falha(new Error('não consegui carregar a biblioteca do QZ Tray'));
    document.head.appendChild(el);
  });

  const imprimirTermica = async () => {
    // a etiqueta muda o status no marketplace — confirma antes (13/08)
    if (!window.confirm(`Imprimir ${vaiSair} etiqueta(s)?\n\nAo confirmar, elas são puxadas do Bling e os pedidos passam a constar como "aguardando coleta" nos marketplaces.`)) return;
    try {
      setImprimindo('Preparando as etiquetas…');
      const r = await fetch(`${API}/wms-etiquetas?${qs({ zpl: '1' })}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
      if (!j.total) throw new Error('Nenhuma etiqueta pronta nesses filtros.');

      setImprimindo('Conectando na impressora…');
      const qz = await carregarQz();
      if (!qz.websocket.isActive()) await qz.websocket.connect();
      const impressora = await qz.printers.getDefault();
      const config = qz.configs.create(impressora);

      setImprimindo(`Imprimindo ${j.total} etiqueta(s) em ${impressora}…`);
      // ZPL vai como raw (nativo da térmica); PDF (Shein) o próprio QZ Tray
      // imprime como imagem — não precisa converter nada
      const zpl = j.blocos.filter(b => b.tipo !== 'etiqueta_pdf' && b.zpl);
      const pdfs = j.blocos.filter(b => b.tipo === 'etiqueta_pdf' && b.pdf);
      if (zpl.length) {
        await qz.print(config, zpl.map(b => ({ type: 'raw', format: 'plain', data: b.zpl })));
      }
      if (pdfs.length) {
        const cfgPdf = qz.configs.create(impressora, { size: { width: 4, height: 6 }, units: 'in', scaleContent: true });
        await qz.print(cfgPdf, pdfs.map(b => ({ type: 'pixel', format: 'pdf', flavor: 'base64', data: b.pdf })));
      }

      // só marca como impressa depois que a térmica aceitou o trabalho
      for (let i = 0; i < j.ids.length; i += 30) {
        await fetch(`${API}/wms-etiquetas?marcar=1&ids=${j.ids.slice(i, i + 30).join(',')}`);
      }
      setImprimindo(`✅ ${j.total} etiqueta(s) enviadas para ${impressora}`);
      carregar();
      setTimeout(() => setImprimindo(''), 8000);
    } catch (e) {
      setImprimindo(`⚠ ${e.message}`);
      onErro?.(e.message);
      setTimeout(() => setImprimindo(''), 12000);
    }
  };

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
  const prontas = dados?.prontas || 0;
  const aguardando = dados?.aguardando || 0;
  const jaImpressas = dados?.ja_impressas || 0;
  const vaiSair = reimprimir ? prontas + jaImpressas : prontas;

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
          disabled={!vaiSair}
          style={{ flex: 1, minWidth: 240, padding: '14px', borderRadius: 12, border: 'none',
            background: vaiSair ? palette.ink : '#c8c0b6', color: '#fff', fontSize: 15, fontWeight: 800,
            cursor: vaiSair ? 'pointer' : 'default', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Printer size={18} /> Gerar etiquetas ({vaiSair} {vaiSair === 1 ? 'etiqueta' : 'etiquetas'})
        </button>
        <button onClick={carregar} style={{ padding: '14px 16px', borderRadius: 12, border: `1.5px solid ${palette.beige}`, background: '#fff', color: palette.inkSoft, cursor: 'pointer', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700 }}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      <button onClick={imprimirTermica} disabled={!vaiSair || !!imprimindo}
        style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', marginBottom: 14,
          background: vaiSair && !imprimindo ? palette.accent : '#c8c0b6', color: '#fff', fontSize: 15, fontWeight: 800,
          cursor: vaiSair && !imprimindo ? 'pointer' : 'default', fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Printer size={18} /> {imprimindo || `Imprimir na térmica · ZPL direto (${vaiSair})`}
      </button>

      {/* grupos na ordem de impressão */}
      <div style={{ background: '#fff', border: `1px solid ${palette.beige}`, borderRadius: 13, padding: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: palette.ink, marginBottom: 3 }}>Ordem de impressão</div>
        <div style={{ fontSize: 12, color: palette.inkMuted, marginBottom: 10 }}>
          Por localização e, dentro dela, as referências de maior quantidade primeiro — cada grupo sai com uma folha separadora antes das etiquetas (NF + transporte).
        </div>
        {!!totalPedidos && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: palette.ok, background: palette.okSoft, padding: '6px 11px', borderRadius: 999 }}>
              {prontas} pronta{prontas === 1 ? '' : 's'} pra imprimir
            </span>
            {jaImpressas > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: palette.inkSoft, background: palette.beigeSoft, padding: '6px 11px', borderRadius: 999 }}>
                {jaImpressas} já impressa{jaImpressas === 1 ? '' : 's'}
              </span>
            )}
            {aguardando > 0 && (
              <span style={{ fontSize: 12, fontWeight: 700, color: palette.warn, background: palette.warnSoft, padding: '6px 11px', borderRadius: 999 }}>
                {aguardando} aguardando etiqueta no Bling
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: palette.inkSoft, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: FONT }}>
            <input type="checkbox" checked={porEmpresa} onChange={e => setPorEmpresa(e.target.checked)} />
            Separar por empresa (Exitus → Lumia → Muniam)
          </label>
          <label style={{ fontSize: 12, color: palette.inkSoft, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: FONT }}>
            <input type="checkbox" checked={reimprimir} onChange={e => setReimprimir(e.target.checked)} />
            Incluir as já impressas (reimprimir)
          </label>
          <label style={{ fontSize: 12, color: palette.inkSoft, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: FONT }}>
            <input type="checkbox" checked={verFinalizados} onChange={e => setVerFinalizados(e.target.checked)} />
            Mostrar pedidos já finalizados
          </label>
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
                📍 {g.loc} <span style={{ fontWeight: 600, color: palette.inkSoft, fontSize: 13 }}>· REF {g.ref}</span>
                {g.empresa && <span style={{ fontWeight: 700, color: palette.accent, fontSize: 12 }}> · {NOME_CONTA[g.empresa] || g.empresa}</span>}
              </div>
              <div style={{ fontSize: 11.5, color: palette.inkMuted }}>{(g.canais || []).join(', ')}{g.contas?.length ? ` · ${g.contas.map(c => NOME_CONTA[c] || c).join(', ')}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: g.prontas ? palette.ok : palette.inkMuted }}>{g.prontas || 0}/{g.pedidos}</div>
              <div style={{ fontSize: 10.5, color: palette.inkMuted }}>
                {g.impressas ? `${g.impressas} impressa${g.impressas === 1 ? '' : 's'}` : 'prontas'}
              </div>
            </div>
          </div>
        ))}

        {dados?.nota && <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 12 }}>{dados.nota}</div>}
      </div>

      <div style={{ fontSize: 11.5, color: palette.inkMuted, marginTop: 12, lineHeight: 1.6 }}>
        A etiqueta só é puxada do Bling no momento em que você manda imprimir — antes disso o pedido continua pendente no marketplace (na Shein, baixar a etiqueta já muda o status pra "aguardando coleta"). Formato 10x15. Na térmica o ZPL vai direto pela QZ Tray (mais rápido e mais nítido, é o formato nativo que o Bling entrega); o PDF fica como alternativa pra impressora comum. O PDF sai limpo, só com separadores e etiquetas — nenhum aviso no papel. Cada etiqueta gerada fica registrada como impressa e não sai de novo sem você marcar "reimprimir". A etiqueta só existe depois de gerada no Bling (nasce junto com a NF); quem ainda não tem fica como "aguardando" aqui na tela e entra na próxima geração.
      </div>
    </div>
  );
}
