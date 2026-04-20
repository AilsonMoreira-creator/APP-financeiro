/**
 * OrdemDeCorte.jsx — Tela admin de gerenciamento de Ordens de Corte
 *
 * Props:
 *   - supabase: cliente Supabase
 *   - usuarioLogado: { usuario, admin, ... }
 *   - mediaRef: objeto { [ref]: { media: number, ... } } com rendimento histórico
 *               do módulo Salas de Corte (pra cálculo de estimativa da matriz)
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import OrdemMatrixModal from './OrdemMatrixModal';

const FN = "Calibri,'Segoe UI',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

// Thumbnail do produto a partir do bucket `produtos` do Supabase.
// Tenta jpg → png → webp (ref normalizada e com zero-padding).
// Fallback: placeholder cinza com 📷.
function FotoOrdem({ refProd }) {
  const sbUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL)
    || (typeof localStorage !== 'undefined' && localStorage.getItem('sb_url'))
    || '';
  const storageBase = sbUrl ? `${sbUrl}/storage/v1/object/public/produtos/` : '';
  const placeholder = (
    <div style={{
      width: 52, height: 66, borderRadius: 6,
      background: 'linear-gradient(135deg,#f0ebe3,#e8e2da)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '1px solid #e8e2da', flexShrink: 0, color: '#c0b8b0', fontSize: 16,
    }}>📷</div>
  );
  if (!storageBase || !refProd) return placeholder;
  const orig = String(refProd).toUpperCase();
  const norm = orig.replace(/^0+/, '') || '0';
  const urls = [norm + '.jpg', norm + '.png', norm + '.webp'];
  if (orig !== norm) urls.push(orig + '.jpg', orig + '.png', orig + '.webp');
  const pad4 = norm.padStart(4, '0'), pad5 = norm.padStart(5, '0');
  if (pad4 !== norm && pad4 !== orig) urls.push(pad4 + '.jpg', pad4 + '.png', pad4 + '.webp');
  if (pad5 !== norm && pad5 !== orig && pad5 !== pad4) urls.push(pad5 + '.jpg', pad5 + '.png', pad5 + '.webp');
  const cb = '?v=' + new Date().toISOString().slice(0, 10);
  return (
    <div style={{ position: 'relative', width: 52, height: 66, flexShrink: 0 }}>
      <img
        src={storageBase + urls[0] + cb}
        alt={`REF ${refProd}`}
        onError={(e) => {
          const cur = e.target.src;
          const idx = urls.findIndex(u => cur.includes(u));
          if (idx >= 0 && idx < urls.length - 1) {
            e.target.src = storageBase + urls[idx + 1] + cb;
          } else {
            e.target.style.display = 'none';
            const ph = e.target.nextSibling;
            if (ph) ph.style.display = 'flex';
          }
        }}
        style={{ width: 52, height: 66, objectFit: 'cover', borderRadius: 6, border: '1px solid #e8e2da' }}
      />
      <div style={{
        width: 52, height: 66, borderRadius: 6,
        background: 'linear-gradient(135deg,#f0ebe3,#e8e2da)',
        display: 'none', alignItems: 'center', justifyContent: 'center',
        border: '1px solid #e8e2da', position: 'absolute', top: 0, left: 0,
        color: '#c0b8b0', fontSize: 16,
      }}>📷</div>
    </div>
  );
}

const TAMANHOS_PADRAO = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3'];

const STATUS_OPTIONS = [
  { id: 'todos', label: 'Todos' },
  { id: 'aguardando', label: '⏳ Aguardando' },
  { id: 'separado', label: '🧵 Tecido separado' },
  { id: 'na_sala', label: '✂️ Na sala de corte' },
  { id: 'concluido', label: '✅ Concluídas' },
  { id: 'cancelado', label: '🚫 Canceladas' },
];

const STATUS_PILL = {
  aguardando: { txt: '⏳ Aguardando', bg: '#faf6ec', color: '#c8a040', border: '#c8a040' },
  separado: { txt: '🧵 Tecido separado', bg: '#f0f4fa', color: '#4a7fa5', border: '#4a7fa5' },
  na_sala: { txt: '✂️ Na sala de corte', bg: '#eafbf0', color: '#27ae60', border: '#27ae60' },
  concluido: { txt: '✅ Concluída', bg: '#f0f4fa', color: '#5a7faa', border: '#a8c0d8' },
  cancelado: { txt: '🚫 Cancelada', bg: '#fdeaea', color: '#c0392b', border: '#c0392b' },
};

// Mapa de hex pra cores fora do ranking Bling (fallback)
const COR_FALLBACK_HEX = {
  preto: '#1c1c1c', marinho: '#1e2c4a', bege: '#c9b896', branco: '#f5f0e8',
  marrom: '#5a3a26', figo: '#6b2d3a', verde: '#3d6b3a', off: '#e8e0d0',
  vermelho: '#a02828', cinza: '#7a7a7a', azul: '#2d5a8c', rosa: '#d49ab0',
  amarelo: '#d4b740', laranja: '#d47a3a', roxo: '#6b3a8c',
};

function hexCor(nome) {
  if (!nome) return '#999';
  const k = nome.toLowerCase().trim();
  return COR_FALLBACK_HEX[k] || '#999';
}

// Fallback hardcoded (cópia de CORES_RANKING_INICIAL do App.tsx)
// Usado quando localStorage amica_bling_cores_top está vazio
// (ex: em ambiente de preview sem ter passado pelo Bling Produtos)
const CORES_RANKING_FALLBACK = [
  { nome: 'Preto',         hex: '#1a1a1a' },
  { nome: 'Bege',          hex: '#d4c4a4' },
  { nome: 'Marrom',        hex: '#5c3a20' },
  { nome: 'Figo',          hex: '#6b3a4c' },
  { nome: 'Azul Marinho',  hex: '#1c2e4a' },
  { nome: 'Caramelo',      hex: '#a8743b' },
  { nome: 'Verde Militar', hex: '#4a5d3a' },
  { nome: 'Nude',          hex: '#e8c8b0' },
  { nome: 'Azul Serenity', hex: '#91a8d0' },
  { nome: 'Marrom Escuro', hex: '#3d2418' },
  { nome: 'Verde Sálvia',  hex: '#87a96b' },
  { nome: 'Azul Claro',    hex: '#a8c8e0' },
  { nome: 'Vinho',         hex: '#5c1a2e' },
  { nome: 'Bege Claro',    hex: '#ebdcc0' },
];

function loadCoresRanking() {
  try {
    const raw = localStorage.getItem('amica_bling_cores_top');
    if (raw) {
      const d = JSON.parse(raw);
      const lista = d?.cores || [];
      if (lista.length > 0) return lista;
    }
  } catch {}
  // Fallback: ranking hardcoded quando localStorage vazio
  return CORES_RANKING_FALLBACK;
}

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

export default function OrdemDeCorte({ supabase, usuarioLogado, mediaRef = {} }) {
  const [ordens, setOrdens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [expandidas, setExpandidas] = useState(new Set());
  const [matrixOrdem, setMatrixOrdem] = useState(null);

  const [showNova, setShowNova] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [excluindoId, setExcluindoId] = useState(null);

  const usuario = usuarioLogado?.usuario || '';

  const carregar = useCallback(async () => {
    try {
      setLoading(true); setErro(null);
      const r = await fetch('/api/ordens-corte-listar?perfil=admin');
      const d = await r.json();
      if (d.error) { setErro(d.error); return; }
      setOrdens(d.ordens || []);
    } catch (e) { setErro(e?.message || 'erro ao carregar'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel('sync-ordens-corte')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordens_corte' }, () => carregar())
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [supabase, carregar]);

  const ordensFiltradas = useMemo(() => {
    let r = ordens;
    if (filtroStatus !== 'todos') r = r.filter(o => o.status === filtroStatus);
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      r = r.filter(o => String(o.ref).toLowerCase().includes(q));
    }
    const ordemStatus = { aguardando: 1, separado: 2, na_sala: 3, concluido: 4, cancelado: 5 };
    return [...r].sort((a, b) => {
      const sa = ordemStatus[a.status] || 99;
      const sb = ordemStatus[b.status] || 99;
      if (sa !== sb) return sa - sb;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }, [ordens, filtroStatus, busca]);

  const toggleExpand = (id) => {
    setExpandidas(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const ordemEditando = ordens.find(o => o.id === editandoId);
  const ordemExcluindo = ordens.find(o => o.id === excluindoId);

  return (
    <div style={{ fontFamily: SERIF, color: '#2c3e50', padding: 16, maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>📋 Ordem de Corte</h1>
          <div style={{ fontSize: 12, color: '#8a9aa4', marginTop: 2 }}>Gerencie ordens de corte aguardando preparação e envio à sala</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="🔍 Buscar por ref..."
            style={{ padding: '8px 12px', border: '1px solid #e8e2da', borderRadius: 6, fontSize: 13, fontFamily: SERIF, minWidth: 200 }}
          />
          <button
            onClick={() => setShowNova(true)}
            style={{ padding: '9px 18px', background: '#2c3e50', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontFamily: SERIF, cursor: 'pointer', fontWeight: 600 }}
          >
            + Nova ordem
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {STATUS_OPTIONS.map(opt => {
          const n = opt.id === 'todos' ? ordens.length : ordens.filter(o => o.status === opt.id).length;
          const ativo = filtroStatus === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setFiltroStatus(opt.id)}
              style={{
                padding: '6px 12px',
                background: ativo ? '#2c3e50' : '#fff',
                color: ativo ? '#fff' : '#5a6b7a',
                border: `1px solid ${ativo ? '#2c3e50' : '#e8e2da'}`,
                borderRadius: 6, fontSize: 12, fontFamily: SERIF, cursor: 'pointer',
              }}
            >
              {opt.label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{n}</span>
            </button>
          );
        })}
      </div>

      {loading && <div style={{ padding: 32, textAlign: 'center', color: '#8a9aa4' }}>Carregando ordens...</div>}
      {erro && <div style={{ padding: 16, background: '#fdeaea', color: '#c0392b', borderRadius: 8, marginBottom: 12 }}>⚠ {erro}</div>}
      {!loading && ordensFiltradas.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#8a9aa4', background: '#f7f4f0', borderRadius: 8 }}>
          {ordens.length === 0
            ? 'Nenhuma ordem criada ainda. Clique em "+ Nova ordem" pra começar.'
            : 'Nenhuma ordem encontrada com esses filtros.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {ordensFiltradas.map(o => (
          <OrdemCard
            key={o.id}
            ordem={o}
            expandida={expandidas.has(o.id)}
            onToggleExpand={() => toggleExpand(o.id)}
            onEditar={() => setEditandoId(o.id)}
            onExcluir={() => setExcluindoId(o.id)}
            onAbrirMatrix={() => setMatrixOrdem(o)}
          />
        ))}
      </div>

      {matrixOrdem && (
        <OrdemMatrixModal ordem={matrixOrdem} onClose={() => setMatrixOrdem(null)} />
      )}

      {(showNova || editandoId) && (
        <ModalOrdem
          ordemEditando={ordemEditando}
          usuario={usuario}
          mediaRef={mediaRef}
          onClose={() => { setShowNova(false); setEditandoId(null); }}
          onSalvo={() => { setShowNova(false); setEditandoId(null); carregar(); }}
        />
      )}

      {excluindoId && ordemExcluindo && (
        <ModalExcluir
          ordem={ordemExcluindo}
          usuario={usuario}
          onClose={() => setExcluindoId(null)}
          onExcluido={() => { setExcluindoId(null); carregar(); }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CARD DE ORDEM (intocado)
// ════════════════════════════════════════════════════════════════════════════

function OrdemCard({ ordem, expandida, onToggleExpand, onEditar, onExcluir, onAbrirMatrix }) {
  const status = STATUS_PILL[ordem.status] || STATUS_PILL.aguardando;
  const cores = ordem.cores || [];
  const isFinalizada = ordem.status === 'na_sala' || ordem.status === 'concluido' || ordem.status === 'cancelado';

  // Editar/excluir sempre visíveis e funcionais.
  // Editar ordem finalizada exige confirmação extra (abrir modal de edição pra algo concluído pode ser acidente).
  // Excluir NÃO usa window.confirm aqui porque o ModalExcluir já pede motivo explícito.
  const handleEditar = () => {
    if (isFinalizada) {
      const msg = `Essa ordem já está "${status.txt}". Deseja editar mesmo assim?`;
      if (!window.confirm(msg)) return;
    }
    onEditar();
  };
  const handleExcluir = () => {
    // Sem confirm aqui — o ModalExcluir abre em seguida e exige motivo obrigatório.
    onExcluir();
  };

  return (
    <div style={{
      background: '#fff', border: '1px solid #e8e2da', borderRadius: 10, padding: 14,
      opacity: isFinalizada ? 0.85 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {/* Thumbnail do produto (Supabase Storage bucket `produtos`) */}
        <FotoOrdem refProd={ordem.ref} />

        <span style={{ background: status.bg, color: status.color, border: `1px solid ${status.border}`, padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {status.txt}
        </span>

        <div style={{ flex: '1 1 250px', minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#2c3e50' }}>
            REF {ordem.ref}{ordem.descricao ? ` · ${ordem.descricao}` : ''}
          </div>
          <div style={{ fontSize: 11, color: '#8a9aa4', marginTop: 2 }}>
            🧵 {ordem.tecido} · Grade {Object.entries(ordem.grade || {}).map(([t, v]) => `${v}${t}`).join(' · ')}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '0 1 auto' }}>
          {cores.slice(0, 4).map((c, i) => (
            <span key={i} style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#f7f4f0', borderRadius: 10 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: c.hex || hexCor(c.nome) }} />
              {c.nome} {c.rolos}
            </span>
          ))}
          {cores.length > 4 && <span style={{ fontSize: 10, color: '#8a9aa4' }}>+{cores.length - 4}</span>}
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: FN, color: '#2c3e50' }}>{ordem.total_rolos}</div>
            <div style={{ fontSize: 9, color: '#8a9aa4', textTransform: 'uppercase' }}>rolos</div>
          </div>
          <div style={{ textAlign: 'center', minWidth: 30 }}>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: FN, color: ordem.grupo != null ? '#2c3e50' : '#c0b8b0' }}>{ordem.grupo != null ? ordem.grupo : '—'}</div>
            <div style={{ fontSize: 9, color: '#8a9aa4', textTransform: 'uppercase' }}>grupo</div>
          </div>
        </div>

        {ordem.sala && (
          <div style={{ textAlign: 'center', padding: '4px 10px', background: '#eafbf0', borderRadius: 6, color: '#27ae60', fontSize: 11, fontWeight: 600 }}>
            ✂️ {ordem.sala}
          </div>
        )}

        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button onClick={onAbrirMatrix} title="Ver matriz" style={{ padding: 6, background: '#fff', border: '1px solid #e8e2da', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          </button>
          {/* Editar/excluir SEMPRE visíveis — confirmação extra se ordem finalizada */}
          <button onClick={handleEditar} title={isFinalizada ? "Editar (ordem finalizada)" : "Editar"} style={{ padding: 6, background: '#fff', border: '1px solid #e8e2da', borderRadius: 4, cursor: 'pointer', fontSize: 14, color: '#4a7fa5' }}>✎</button>
          <button onClick={handleExcluir} title={isFinalizada ? "Excluir (ordem finalizada)" : "Excluir"} style={{ padding: 6, background: '#fff', border: '1px solid #e8e2da', borderRadius: 4, cursor: 'pointer', fontSize: 14, color: '#c0392b' }}>✕</button>
          <button onClick={onToggleExpand} title="Expandir" style={{ padding: 6, background: '#fff', border: '1px solid #e8e2da', borderRadius: 4, cursor: 'pointer', fontSize: 14, transform: expandida ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</button>
        </div>
      </div>

      {expandida && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0ebe4', fontSize: 12, color: '#5a6b7a' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: '#8a9aa4', textTransform: 'uppercase', marginBottom: 2 }}>Criada em</div>
              <div style={{ fontWeight: 600 }}>{new Date(ordem.created_at).toLocaleString('pt-BR')}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#8a9aa4', textTransform: 'uppercase', marginBottom: 2 }}>Criada por</div>
              <div style={{ fontWeight: 600 }}>{ordem.criada_por}</div>
            </div>
            {ordem.separado_em && (
              <div>
                <div style={{ fontSize: 10, color: '#8a9aa4', textTransform: 'uppercase', marginBottom: 2 }}>Tecido separado</div>
                <div style={{ fontWeight: 600 }}>{new Date(ordem.separado_em).toLocaleString('pt-BR')} · {ordem.separado_por}</div>
              </div>
            )}
            {ordem.enviado_sala_em && (
              <div>
                <div style={{ fontSize: 10, color: '#8a9aa4', textTransform: 'uppercase', marginBottom: 2 }}>Enviada à sala</div>
                <div style={{ fontWeight: 600 }}>{new Date(ordem.enviado_sala_em).toLocaleString('pt-BR')}</div>
              </div>
            )}
            {ordem.concluido_em && (
              <div>
                <div style={{ fontSize: 10, color: '#8a9aa4', textTransform: 'uppercase', marginBottom: 2 }}>Concluída em</div>
                <div style={{ fontWeight: 600 }}>{new Date(ordem.concluido_em).toLocaleString('pt-BR')}</div>
              </div>
            )}
            {ordem.motivo_exclusao && (
              <div>
                <div style={{ fontSize: 10, color: '#c0392b', textTransform: 'uppercase', marginBottom: 2 }}>Motivo cancelamento</div>
                <div style={{ fontWeight: 600, color: '#c0392b' }}>{ordem.motivo_exclusao}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL NOVA/EDITAR ORDEM — novo design
// ════════════════════════════════════════════════════════════════════════════

// Sub: editor de cores (lista + chips ranking + manual)
function CoresEditor({ cores, onChange, coresRanking, corManual, setCorManual, onErro }) {
  const addCor = (c) => {
    if (cores.some(x => x.nome.toLowerCase() === c.nome.toLowerCase())) {
      onErro && onErro(`Cor "${c.nome}" já adicionada`);
      return;
    }
    onChange([...cores, { nome: c.nome, hex: c.hex || hexCor(c.nome), rolos: 1 }]);
    onErro && onErro(null);
  };
  const setRolos = (i, v) => {
    const n = Math.max(1, parseInt(v) || 1);
    onChange(cores.map((c, idx) => idx === i ? { ...c, rolos: n } : c));
  };
  const remover = (i) => onChange(cores.filter((_, idx) => idx !== i));
  const addManual = () => {
    const nome = corManual.nome.trim();
    if (!nome) {
      onErro && onErro('Digite o nome da cor antes de incluir');
      return;
    }
    if (cores.some(x => x.nome.toLowerCase() === nome.toLowerCase())) {
      onErro && onErro(`Cor "${nome}" já adicionada`);
      return;
    }
    onChange([...cores, { nome, hex: corManual.hex || '#888', rolos: parseInt(corManual.rolos) || 1 }]);
    setCorManual({ nome: '', rolos: 1, hex: '#888' });
    onErro && onErro(null);
  };

  return (
    <div>
      {cores.length === 0 ? (
        <div style={{ padding: 14, textAlign: 'center', color: '#8a9aa4', fontFamily: SERIF, fontSize: 13, fontStyle: 'italic' }}>
          nenhuma cor ainda — adicione uma abaixo
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {cores.map((c, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #e8e2da', borderRadius: 6, padding: '6px 10px' }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', background: c.hex || hexCor(c.nome), border: '1px solid rgba(0,0,0,0.1)', flexShrink: 0 }} />
              <span style={{ flex: 1, fontFamily: SERIF, fontSize: 13, color: '#1C2533' }}>{c.nome}</span>
              <input type="number" min={1} value={c.rolos}
                onChange={e => setRolos(i, e.target.value)}
                style={{ width: 56, padding: 5, border: '1px solid #e8e2da', borderRadius: 4, fontFamily: FN, fontSize: 13, fontWeight: 'bold', textAlign: 'center' }} />
              <span style={{ fontFamily: FN, fontSize: 11, color: '#8a9aa4' }}>rolos</span>
              <button type="button" onClick={() => remover(i)} style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer', fontSize: 15, padding: '0 4px' }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {coresRanking.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #e8e2da' }}>
          <div style={{ fontFamily: FN, fontSize: 13, color: '#8a9aa4', marginBottom: 6 }}>📊 Ranking Bling · clique pra adicionar</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {coresRanking.slice(0, 16).map((r, idx) => {
              const ja = cores.some(c => c.nome.toLowerCase() === r.nome.toLowerCase());
              return (
                <button key={r.nome} type="button" onClick={() => !ja && addCor(r)} disabled={ja}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    padding: '5px 10px', background: '#fff',
                    border: '1px solid #e8e2da', borderRadius: 14,
                    cursor: ja ? 'default' : 'pointer', fontSize: 13,
                    fontFamily: SERIF, color: '#1C2533', opacity: ja ? 0.4 : 1,
                  }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: r.hex || hexCor(r.nome) }} />
                  {r.nome} <span style={{ fontFamily: FN, fontSize: 11, color: '#8a9aa4' }}>#{idx + 1}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ fontFamily: FN, fontSize: 13, color: '#8a9aa4', marginTop: 14, marginBottom: 6 }}>✎ Não achou a cor? Adicione manualmente:</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input type="text" value={corManual.nome}
          onChange={e => setCorManual(p => ({ ...p, nome: e.target.value }))}
          onKeyDown={e => e.key === 'Enter' && addManual()}
          placeholder="digite o nome da cor"
          style={{ flex: 1, padding: '7px 10px', border: '1px dashed #8a9aa4', borderRadius: 6, fontFamily: SERIF, fontSize: 13 }} />
        <input type="number" min={1} value={corManual.rolos}
          onChange={e => setCorManual(p => ({ ...p, rolos: e.target.value }))}
          style={{ width: 64, padding: 7, border: '1px dashed #8a9aa4', borderRadius: 6, fontFamily: FN, fontSize: 13, fontWeight: 'bold', textAlign: 'center' }} />
        <input type="color" value={corManual.hex}
          onChange={e => setCorManual(p => ({ ...p, hex: e.target.value }))}
          title="escolher cor"
          style={{ width: 40, height: 34, padding: 2, border: '1px dashed #8a9aa4', borderRadius: 6, cursor: 'pointer' }} />
        <button type="button" onClick={addManual}
          style={{ padding: '7px 14px', background: '#4a7fa5', color: '#fff', border: 'none', borderRadius: 6, fontFamily: SERIF, fontSize: 13, cursor: 'pointer', fontWeight: 'bold' }}>
          + cor
        </button>
      </div>
    </div>
  );
}

// Sub: matriz de estimativa
function MatrizEstimativa({ grade, cores, pcrolo, refStr }) {
  const tamsAtivos = TAMANHOS_PADRAO.filter(t => grade[t] > 0);
  const totalModulos = tamsAtivos.reduce((s, t) => s + grade[t], 0);
  const totalRolos = cores.reduce((s, c) => s + (c.rolos || 0), 0);

  if (tamsAtivos.length === 0 || cores.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', fontFamily: SERIF, fontSize: 13, color: '#8a9aa4', fontStyle: 'italic', background: '#fff', borderRadius: 6 }}>
        adicione pelo menos 1 tamanho e 1 cor pra ver a estimativa
      </div>
    );
  }

  if (!pcrolo) {
    return (
      <div style={{ padding: 20, textAlign: 'center', fontFamily: SERIF, fontSize: 13, color: '#8a9aa4', fontStyle: 'italic', background: '#fff', borderRadius: 6 }}>
        📊 sem histórico de rendimento pra ref {refStr || ''}<br />
        <span style={{ fontSize: 12 }}>corte ao menos 1x essa ref pra ter estimativa automática</span>
      </div>
    );
  }

  const linhas = cores.map(c => {
    const totalCor = c.rolos * pcrolo;
    const cells = tamsAtivos.map(t => Math.round(totalCor * (grade[t] / totalModulos)));
    const total = cells.reduce((s, n) => s + n, 0);
    return { cor: c, cells, total };
  });
  const colTotals = tamsAtivos.map((_, i) => linhas.reduce((s, l) => s + l.cells[i], 0));
  const totalGeral = linhas.reduce((s, l) => s + l.total, 0);

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FN }}>
        <thead>
          <tr style={{ background: '#e8e2da' }}>
            <th style={{ padding: '8px 10px', fontSize: 13, fontWeight: 'bold', color: '#373F51', textTransform: 'uppercase', textAlign: 'left' }}>Cor</th>
            {tamsAtivos.map(t => (
              <th key={t} style={{ padding: '8px 10px', fontSize: 13, fontWeight: 'bold', color: '#373F51', textTransform: 'uppercase', textAlign: 'center' }}>{t}</th>
            ))}
            <th style={{ padding: '8px 10px', fontSize: 13, fontWeight: 'bold', color: '#373F51', textTransform: 'uppercase', textAlign: 'center' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #e8e2da' }}>
              <td style={{ padding: '8px 10px', fontSize: 13, color: '#1C2533', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: l.cor.hex || hexCor(l.cor.nome) }} />
                {l.cor.nome} · {l.cor.rolos}r
              </td>
              {l.cells.map((n, j) => (
                <td key={j} style={{ padding: '8px 10px', fontSize: 13, color: '#1C2533', textAlign: 'center' }}>{n}</td>
              ))}
              <td style={{ padding: '8px 10px', fontSize: 13, color: '#1C2533', fontWeight: 'bold', background: '#f7f4f0', textAlign: 'center' }}>{l.total}</td>
            </tr>
          ))}
          <tr style={{ background: '#f7f4f0' }}>
            <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 'bold', color: '#1C2533' }}>Total · {totalRolos} rolos</td>
            {colTotals.map((n, j) => (
              <td key={j} style={{ padding: '8px 10px', fontSize: 13, fontWeight: 'bold', color: '#1C2533', textAlign: 'center' }}>{n}</td>
            ))}
            <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 'bold', color: '#1C2533', textAlign: 'center' }}>{totalGeral}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ModalOrdem({ ordemEditando, usuario, mediaRef = {}, onClose, onSalvo }) {
  const isEdit = !!ordemEditando;

  // Etapa: 'ref' (escolhendo ref) ou 'completa' (ref escolhida, preenchendo grade/cores)
  const [etapa, setEtapa] = useState(isEdit ? 'completa' : 'ref');

  // Produto selecionado
  const [produto, setProduto] = useState(
    isEdit ? { ref: ordemEditando.ref, descricao: ordemEditando.descricao, tecido: ordemEditando.tecido } : null
  );

  // Campos da ordem
  const [grupo, setGrupo] = useState(ordemEditando?.grupo ?? '');
  const [grade, setGrade] = useState(ordemEditando?.grade || {});
  const [cores, setCores] = useState(ordemEditando?.cores || []);

  // Edição (obrigatório motivo ao editar)
  const [motivo, setMotivo] = useState('');

  // Auxiliares
  const [refBusca, setRefBusca] = useState('');
  const [autocomplete, setAutocomplete] = useState([]);
  const [coresRanking] = useState(loadCoresRanking());
  const [corManual, setCorManual] = useState({ nome: '', rolos: 1, hex: '#888' });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState(null);

  // Autocomplete ref (só modo novo)
  useEffect(() => {
    if (isEdit) return;
    if (!refBusca.trim()) { setAutocomplete([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/ordens-corte-buscar-ref?q=${encodeURIComponent(refBusca.trim())}`);
        const d = await r.json();
        setAutocomplete(d.produtos || []);
      } catch { setAutocomplete([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [refBusca, isEdit]);

  const escolherProduto = (p) => {
    if (!p.tecido) { setErro('⚠ Esse produto não tem tecido cadastrado em Oficinas. Complete o cadastro antes.'); return; }
    setProduto(p);
    setRefBusca('');
    setAutocomplete([]);
    setEtapa('completa');
    setErro(null);
  };

  const trocarRef = () => {
    setProduto(null);
    setGrade({});
    setCores([]);
    setGrupo('');
    setEtapa('ref');
  };

  const pcrolo = produto ? (mediaRef?.[produto.ref]?.media || null) : null;
  const totalRolos = cores.reduce((s, c) => s + (Number(c.rolos) || 0), 0);
  const tamsAtivos = TAMANHOS_PADRAO.filter(t => grade[t] > 0);
  const totalModulos = tamsAtivos.reduce((s, t) => s + grade[t], 0);
  const pecasEstimadas = pcrolo && tamsAtivos.length > 0 && cores.length > 0 ? totalRolos * pcrolo : null;

  const podeSalvar = produto?.ref && produto?.tecido && tamsAtivos.length > 0 && cores.length > 0 && (!isEdit || motivo.trim());

  const salvar = async () => {
    setErro(null);
    if (!podeSalvar) {
      if (!produto?.ref) setErro('Selecione uma ref');
      else if (!produto.tecido) setErro('Produto sem tecido cadastrado');
      else if (tamsAtivos.length === 0) setErro('Adicione pelo menos 1 tamanho na grade');
      else if (cores.length === 0) setErro('Adicione pelo menos 1 cor');
      else if (isEdit && !motivo.trim()) setErro('Motivo da edição obrigatório');
      return;
    }

    setSaving(true);
    try {
      const grupoNum = grupo === '' || grupo === null ? null : Math.max(0, Math.min(9, parseInt(grupo) || 0));
      let body, url, method;
      if (isEdit) {
        url = '/api/ordens-corte-atualizar';
        method = 'PUT';
        body = { id: ordemEditando.id, version: ordemEditando.version, usuario, grade, cores, grupo: grupoNum, motivo_edicao: motivo.trim() };
      } else {
        url = '/api/ordens-corte-criar';
        method = 'POST';
        body = { ref: produto.ref, grade, cores, grupo: grupoNum, criada_por: usuario };
      }
      const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-User': usuario }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setErro(d.error || 'Erro ao salvar'); setSaving(false); return; }
      onSalvo && onSalvo();
    } catch (e) {
      setErro(e?.message || 'erro');
    } finally {
      setSaving(false);
    }
  };

  // Responsividade (4 colunas no celular pra grade)
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 600 : false);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const cssMobileGrade = isMobile ? { gridTemplateColumns: 'repeat(4, 1fr)' } : {};

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.45)', zIndex: 99998,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: isMobile ? 8 : 20, overflowY: 'auto',
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#fff', borderRadius: isMobile ? 10 : 14,
        maxWidth: 720, width: '100%', padding: isMobile ? 16 : 24,
        fontFamily: SERIF, color: '#2c3e50',
        boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: isMobile ? 16 : 20, fontWeight: 'bold', color: '#1C2533' }}>
            {isEdit ? '✎ Editar ordem de corte' : '+ Nova ordem de corte'}
          </h2>
          <button onClick={onClose} title="Fechar"
            style={{ background: 'none', border: 'none', fontSize: 26, color: '#8a9aa4', cursor: 'pointer', padding: '0 6px', lineHeight: 1 }}>×</button>
        </div>

        {/* ETAPA 1: Escolher ref */}
        {etapa === 'ref' && (
          <div>
            <label style={{ display: 'block', fontFamily: FN, fontSize: 13, fontWeight: 'bold', color: '#373F51', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Ref do produto</label>
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <input type="text" value={refBusca} onChange={e => setRefBusca(e.target.value)} autoFocus
                placeholder="Ex: 02277"
                style={{
                  width: '100%', padding: '11px 14px',
                  border: '1px solid #e8e2da', borderRadius: 8,
                  fontSize: 16, fontFamily: FN, fontWeight: 'bold',
                  color: '#1C2533', boxSizing: 'border-box',
                }} />
              {autocomplete.length > 0 && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  background: '#fff', border: '1px solid #e8e2da', borderRadius: 8,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.12)', maxHeight: 240, overflowY: 'auto', zIndex: 10,
                }}>
                  {autocomplete.map(p => (
                    <div key={p.ref} onClick={() => escolherProduto(p)}
                      onMouseEnter={e => e.currentTarget.style.background = '#f7f4f0'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                      style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f7f4f0' }}>
                      <div style={{ fontFamily: FN, fontWeight: 'bold', fontSize: 14, color: '#1C2533' }}>{p.ref}</div>
                      <div style={{ fontSize: 12, color: '#5a6b7a' }}>{p.descricao || '—'}</div>
                      <div style={{ fontSize: 11, color: p.tecido ? '#8a9aa4' : '#c0392b', marginTop: 2 }}>
                        {p.tecido ? `🧵 ${p.tecido}` : '⚠ sem tecido cadastrado em Oficinas'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {erro && <div style={{ padding: 10, background: '#fdeaea', color: '#c0392b', borderRadius: 6, fontSize: 12 }}>{erro}</div>}
            <div style={{ textAlign: 'right', marginTop: 16 }}>
              <button onClick={onClose} style={{ padding: '9px 18px', background: '#fff', color: '#5a6b7a', border: '1px solid #e8e2da', borderRadius: 8, fontSize: 13, fontFamily: SERIF, cursor: 'pointer' }}>Cancelar</button>
            </div>
          </div>
        )}

        {/* ETAPA 2: Produto escolhido, preencher tudo */}
        {etapa === 'completa' && produto && (
          <>
            {/* Título + tecido */}
            <h2 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 'bold', color: '#1C2533', margin: '0 0 4px 0', lineHeight: 1.2 }}>
              ref {produto.ref} · {produto.descricao || '—'}
            </h2>
            <p style={{ fontSize: 14, color: '#5a6b7a', margin: '0 0 16px 0' }}>
              🧵 {produto.tecido}
              {pcrolo ? (
                <span style={{ color: '#8a9aa4', fontFamily: FN, fontSize: 13, marginLeft: 8 }}>· média {pcrolo} pç/rolo</span>
              ) : (
                <span style={{ color: '#c8a040', fontFamily: FN, fontSize: 13, marginLeft: 8 }}>· sem histórico de rendimento</span>
              )}
              {!isEdit && (
                <a href="#" onClick={e => { e.preventDefault(); trocarRef(); }}
                  style={{ marginLeft: 14, color: '#4a7fa5', fontSize: 13, fontFamily: SERIF, textDecoration: 'underline' }}>trocar ref</a>
              )}
            </p>

            {/* Grupo */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
              background: '#f7f4f0', border: '1px solid #e8e2da', borderRadius: 8,
              padding: isMobile ? '10px 12px' : '12px 16px', flexWrap: 'wrap',
            }}>
              <span style={{ fontFamily: FN, fontSize: 13, fontWeight: 'bold', color: '#373F51', textTransform: 'uppercase', letterSpacing: 1 }}>Grupo</span>
              <input type="text" maxLength={1} value={grupo}
                onChange={e => setGrupo(e.target.value.replace(/[^0-9]/g, '').slice(0, 1))}
                placeholder="—"
                style={{
                  width: 48, height: 44, textAlign: 'center',
                  border: '1.5px solid #e8e2da', borderRadius: 8,
                  fontFamily: FN, fontSize: 22, fontWeight: 'bold',
                  color: '#1C2533', background: '#fff',
                }} />
              <span style={{ fontSize: 13, color: '#5a6b7a', fontStyle: 'italic', flex: isMobile ? '100%' : 'none' }}>
                opcional · 0–9 · identifica o enfesto no chão de fábrica
              </span>
            </div>

            {/* Grade */}
            <div style={{ background: '#f7f4f0', border: '1px solid #e8e2da', borderRadius: 8, padding: isMobile ? '12px' : '14px 16px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontFamily: FN, fontSize: 13, fontWeight: 'bold', color: '#373F51', textTransform: 'uppercase', letterSpacing: 1 }}>Grade do enfesto</span>
              </div>
              <GradeEditorResponsive grade={grade} onChange={setGrade} isMobile={isMobile} />
            </div>

            {/* Cores */}
            <div style={{ background: '#f7f4f0', border: '1px solid #e8e2da', borderRadius: 8, padding: isMobile ? '12px' : '14px 16px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontFamily: FN, fontSize: 13, fontWeight: 'bold', color: '#373F51', textTransform: 'uppercase', letterSpacing: 1 }}>
                  Cores e rolos · total: {totalRolos}R
                </span>
              </div>
              <CoresEditor cores={cores} onChange={setCores} coresRanking={coresRanking} corManual={corManual} setCorManual={setCorManual} onErro={setErro} />
            </div>

            {/* Matriz */}
            <div style={{ background: '#f7f4f0', border: '1px solid #e8e2da', borderRadius: 8, padding: isMobile ? '12px' : '14px 16px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontFamily: FN, fontSize: 13, fontWeight: 'bold', color: '#373F51', textTransform: 'uppercase', letterSpacing: 1 }}>Estimativa · cor × tamanho</span>
                {pcrolo && tamsAtivos.length > 0 && cores.length > 0 && (
                  <span style={{ fontFamily: FN, fontSize: 10, color: '#8a9aa4' }}>base {pcrolo} pç/rolo · histórico Salas de Corte</span>
                )}
              </div>
              <MatrizEstimativa grade={grade} cores={cores} pcrolo={pcrolo} refStr={produto.ref} />
            </div>

            {/* Total footer escuro */}
            <div style={{
              background: '#1C2533', color: '#fff', borderRadius: 8,
              padding: isMobile ? '12px 14px' : '14px 18px', marginBottom: 16,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
            }}>
              <div style={{ fontSize: 13, opacity: 0.9 }}>
                {cores.length} cor(es) · {tamsAtivos.length} tamanho(s)
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: FN, fontSize: 26, fontWeight: 'bold', lineHeight: 1 }}>{totalRolos} rolos</div>
                <div style={{ fontFamily: FN, fontSize: 13, opacity: 0.8, marginTop: 3 }}>
                  {pecasEstimadas != null ? `≈ ${pecasEstimadas} peças estimadas` : 'peças sem estimativa'}
                </div>
              </div>
            </div>

            {/* Motivo (edit only) */}
            {isEdit && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', fontFamily: FN, fontSize: 13, fontWeight: 'bold', color: '#373F51', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Motivo da edição *</label>
                <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
                  placeholder="ex: Adicionar cor Bege"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid #e8e2da', borderRadius: 8, fontSize: 13, fontFamily: SERIF, boxSizing: 'border-box' }} />
              </div>
            )}

            {/* Erro */}
            {erro && <div style={{ padding: 10, background: '#fdeaea', color: '#c0392b', borderRadius: 6, marginBottom: 12, fontSize: 12 }}>{erro}</div>}

            {/* Ações */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} disabled={saving}
                style={{ padding: '11px 22px', background: '#fff', color: '#5a6b7a', border: '1px solid #e8e2da', borderRadius: 8, fontSize: 13, fontFamily: SERIF, cursor: saving ? 'wait' : 'pointer' }}>
                Cancelar
              </button>
              <button onClick={salvar} disabled={saving || !podeSalvar}
                style={{ padding: '11px 24px', background: !podeSalvar ? '#ccc' : (saving ? '#8a9aa4' : '#27ae60'), color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontFamily: SERIF, fontWeight: 'bold', cursor: (!podeSalvar || saving) ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Salvando...' : (isEdit ? 'Salvar alterações' : 'Criar ordem')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Wrapper da grade com responsividade (4 colunas no mobile, 8 no desktop)
function GradeEditorResponsive({ grade, onChange, isMobile }) {
  const setMod = (t, v) => {
    const n = Math.max(0, Math.min(99, parseInt(v) || 0));
    const next = { ...grade };
    if (n === 0) delete next[t]; else next[t] = n;
    onChange(next);
  };
  const toggle = (t) => {
    const next = { ...grade };
    if (next[t] > 0) delete next[t]; else next[t] = 1;
    onChange(next);
  };

  return (
    <div>
      <div style={{
        display: 'grid', gap: isMobile ? '10px 8px' : 8, marginBottom: 12,
        gridTemplateColumns: isMobile ? 'repeat(4, 1fr)' : 'repeat(8, 1fr)',
      }}>
        {TAMANHOS_PADRAO.map(t => {
          const incluido = grade[t] > 0;
          return (
            <div key={t} style={{ position: 'relative', paddingTop: 4 }}>
              <span style={{ display: 'block', fontFamily: FN, fontSize: 13, fontWeight: 'bold', color: '#373F51', textAlign: 'center', marginBottom: 4 }}>{t}</span>
              <input type="number" min={0} value={grade[t] || 0}
                onChange={e => setMod(t, e.target.value)}
                onFocus={e => e.target.select()}
                style={{
                  width: '100%', padding: 8, textAlign: 'center',
                  background: incluido ? '#eafbf0' : '#f5f5f5',
                  border: `1.5px solid ${incluido ? '#27ae60' : '#e8e2da'}`,
                  borderRadius: 6, fontFamily: FN, fontSize: 15, fontWeight: 'bold',
                  color: incluido ? '#1C2533' : '#ccc', boxSizing: 'border-box',
                }} />
              <button type="button" onClick={() => toggle(t)}
                style={{
                  position: 'absolute', top: -2, right: -4, width: 20, height: 20,
                  borderRadius: '50%', border: '2px solid #fff', cursor: 'pointer',
                  fontSize: 11, fontWeight: 'bold', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                  color: '#fff', background: incluido ? '#c0392b' : '#27ae60',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.15)', zIndex: 2, padding: 0,
                }}>{incluido ? '✕' : '+'}</button>
            </div>
          );
        })}
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 13, color: '#8a9aa4', fontStyle: 'italic' }}>
        Clique no <strong style={{ color: '#27ae60' }}>+</strong> pra incluir · ajuste quantidade · <strong style={{ color: '#c0392b' }}>✕</strong> remove
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL EXCLUIR (intocado)
// ════════════════════════════════════════════════════════════════════════════

function ModalExcluir({ ordem, usuario, onClose, onExcluido }) {
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState(null);
  const [saving, setSaving] = useState(false);

  const excluir = async () => {
    if (!motivo.trim()) { setErro('Motivo obrigatório'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/ordens-corte-excluir', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-User': usuario },
        body: JSON.stringify({ id: ordem.id, motivo_exclusao: motivo.trim(), usuario }),
      });
      const d = await r.json();
      if (!r.ok) { setErro(d.error || 'Erro'); setSaving(false); return; }
      onExcluido && onExcluido();
    } catch (e) { setErro(e?.message); setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 99998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, maxWidth: 480, width: '100%', padding: 24, fontFamily: SERIF, color: '#2c3e50' }}>
        <h3 style={{ margin: '0 0 8px 0', color: '#c0392b' }}>🗑 Excluir ordem?</h3>
        <p style={{ fontSize: 13, color: '#5a6b7a', marginBottom: 16 }}>
          REF <strong>{ordem.ref}</strong> · {ordem.total_rolos} rolos<br />
          Esta ação marca a ordem como cancelada (não apaga histórico).
        </p>
        <label style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase' }}>Motivo *</label>
        <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex: Ref errada" style={{ display: 'block', marginTop: 4, width: '100%', padding: '9px 12px', border: '1px solid #e8e2da', borderRadius: 6, fontSize: 13, fontFamily: SERIF, boxSizing: 'border-box' }} />
        {erro && <div style={{ padding: 8, background: '#fdeaea', color: '#c0392b', borderRadius: 6, marginTop: 10, fontSize: 12 }}>{erro}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '9px 18px', background: '#fff', border: '1px solid #e8e2da', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: SERIF }}>Cancelar</button>
          <button onClick={excluir} disabled={saving} style={{ padding: '9px 18px', background: saving ? '#8a9aa4' : '#c0392b', color: '#fff', border: 'none', borderRadius: 6, cursor: saving ? 'wait' : 'pointer', fontSize: 13, fontFamily: SERIF, fontWeight: 600 }}>
            {saving ? 'Excluindo...' : 'Excluir'}
          </button>
        </div>
      </div>
    </div>
  );
}
