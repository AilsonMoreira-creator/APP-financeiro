/**
 * OrdemDeCorte.jsx — Tela admin de gerenciamento de Ordens de Corte
 *
 * Props:
 *   - supabase: cliente Supabase
 *   - usuarioLogado: { usuario, admin, ... }
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import OrdemMatrixModal from './OrdemMatrixModal';

const FN = "Calibri,'Segoe UI',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

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

// Carrega ranking de cores do Bling (já existe no localStorage)
function loadCoresRanking() {
  try {
    const raw = localStorage.getItem('amica_bling_cores_top');
    if (!raw) return [];
    const d = JSON.parse(raw);
    return d?.cores || [];
  } catch { return []; }
}

export default function OrdemDeCorte({ supabase, usuarioLogado }) {
  const [ordens, setOrdens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [expandidas, setExpandidas] = useState(new Set());
  const [matrixOrdem, setMatrixOrdem] = useState(null);

  // Modais
  const [showNova, setShowNova] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [excluindoId, setExcluindoId] = useState(null);

  const usuario = usuarioLogado?.usuario || '';

  // ── Carrega ordens (chamado em mount + sempre que precisar refresh) ──
  const carregar = useCallback(async () => {
    try {
      setLoading(true);
      setErro(null);
      const r = await fetch('/api/ordens-corte-listar?perfil=admin');
      const d = await r.json();
      if (d.error) { setErro(d.error); return; }
      setOrdens(d.ordens || []);
    } catch (e) {
      setErro(e?.message || 'erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // ── Realtime: sync entre dispositivos ──
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel('sync-ordens-corte')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordens_corte' }, () => {
        // Qualquer mudança → recarrega lista (simples e seguro)
        carregar();
      })
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [supabase, carregar]);

  // ── Filtra ordens ──
  const ordensFiltradas = useMemo(() => {
    let r = ordens;
    if (filtroStatus !== 'todos') r = r.filter(o => o.status === filtroStatus);
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      r = r.filter(o => String(o.ref).toLowerCase().includes(q));
    }
    // Ordem visual: aguardando > separado > na_sala > concluido > cancelado, depois por created_at desc
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
      {/* Header */}
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

      {/* Filtros status */}
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

      {/* Estado: loading/erro/vazio */}
      {loading && <div style={{ padding: 32, textAlign: 'center', color: '#8a9aa4' }}>Carregando ordens...</div>}
      {erro && <div style={{ padding: 16, background: '#fdeaea', color: '#c0392b', borderRadius: 8, marginBottom: 12 }}>⚠ {erro}</div>}
      {!loading && ordensFiltradas.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: '#8a9aa4', background: '#f7f4f0', borderRadius: 8 }}>
          {ordens.length === 0
            ? 'Nenhuma ordem criada ainda. Clique em "+ Nova ordem" pra começar.'
            : 'Nenhuma ordem encontrada com esses filtros.'}
        </div>
      )}

      {/* Lista de cards */}
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

      {/* Modal Matrix */}
      {matrixOrdem && (
        <OrdemMatrixModal ordem={matrixOrdem} onClose={() => setMatrixOrdem(null)} />
      )}

      {/* Modal Nova/Editar ordem */}
      {(showNova || editandoId) && (
        <ModalOrdem
          ordemEditando={ordemEditando}
          usuario={usuario}
          onClose={() => { setShowNova(false); setEditandoId(null); }}
          onSalvo={() => { setShowNova(false); setEditandoId(null); carregar(); }}
        />
      )}

      {/* Modal Excluir */}
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
// CARD DE ORDEM
// ════════════════════════════════════════════════════════════════════════════

function OrdemCard({ ordem, expandida, onToggleExpand, onEditar, onExcluir, onAbrirMatrix }) {
  const status = STATUS_PILL[ordem.status] || STATUS_PILL.aguardando;
  const cores = ordem.cores || [];
  const podeEditar = ordem.status === 'aguardando' || ordem.status === 'separado';
  const podeExcluir = ordem.status !== 'na_sala' && ordem.status !== 'concluido' && ordem.status !== 'cancelado';
  const isFinalizada = ordem.status === 'na_sala' || ordem.status === 'concluido';

  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e8e2da',
      borderRadius: 10,
      padding: 14,
      opacity: isFinalizada ? 0.85 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        {/* Status pill */}
        <span style={{ background: status.bg, color: status.color, border: `1px solid ${status.border}`, padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {status.txt}
        </span>

        {/* Info principal */}
        <div style={{ flex: '1 1 250px', minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#2c3e50' }}>
            REF {ordem.ref}{ordem.descricao ? ` · ${ordem.descricao}` : ''}
          </div>
          <div style={{ fontSize: 11, color: '#8a9aa4', marginTop: 2 }}>
            🧵 {ordem.tecido} · Grade {Object.entries(ordem.grade || {}).map(([t, v]) => `${v}${t}`).join(' · ')}
          </div>
        </div>

        {/* Cores resumo */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: '0 1 auto' }}>
          {cores.slice(0, 4).map((c, i) => (
            <span key={i} style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#f7f4f0', borderRadius: 10 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: c.hex || hexCor(c.nome) }} />
              {c.nome} {c.rolos}
            </span>
          ))}
          {cores.length > 4 && <span style={{ fontSize: 10, color: '#8a9aa4' }}>+{cores.length - 4}</span>}
        </div>

        {/* Total rolos + grupo */}
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

        {/* Sala (se na_sala) */}
        {ordem.sala && (
          <div style={{ textAlign: 'center', padding: '4px 10px', background: '#eafbf0', borderRadius: 6, color: '#27ae60', fontSize: 11, fontWeight: 600 }}>
            ✂️ {ordem.sala}
          </div>
        )}

        {/* Ações */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          <button onClick={onAbrirMatrix} title="Ver matriz" style={{ padding: 6, background: '#fff', border: '1px solid #e8e2da', borderRadius: 4, cursor: 'pointer', fontSize: 14 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          </button>
          {podeEditar && (
            <button onClick={onEditar} title="Editar" style={{ padding: 6, background: '#fff', border: '1px solid #e8e2da', borderRadius: 4, cursor: 'pointer', fontSize: 14, color: '#4a7fa5' }}>✎</button>
          )}
          {podeExcluir && (
            <button onClick={onExcluir} title="Excluir" style={{ padding: 6, background: '#fff', border: '1px solid #e8e2da', borderRadius: 4, cursor: 'pointer', fontSize: 14, color: '#c0392b' }}>✕</button>
          )}
          <button onClick={onToggleExpand} title="Expandir" style={{ padding: 6, background: '#fff', border: '1px solid #e8e2da', borderRadius: 4, cursor: 'pointer', fontSize: 14, transform: expandida ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▾</button>
        </div>
      </div>

      {/* Área expandida */}
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
// MODAL NOVA/EDITAR ORDEM
// ════════════════════════════════════════════════════════════════════════════

function ModalOrdem({ ordemEditando, usuario, onClose, onSalvo }) {
  const isEdit = !!ordemEditando;
  const [refBusca, setRefBusca] = useState(ordemEditando?.ref || '');
  const [autocomplete, setAutocomplete] = useState([]);
  const [produtoSel, setProdutoSel] = useState(isEdit ? { ref: ordemEditando.ref, descricao: ordemEditando.descricao, tecido: ordemEditando.tecido } : null);
  const [grupo, setGrupo] = useState(ordemEditando?.grupo ?? '');
  const [grade, setGrade] = useState(ordemEditando?.grade || {});
  const [novoTam, setNovoTam] = useState('');
  const [cores, setCores] = useState(ordemEditando?.cores || []);
  const [novaCor, setNovaCor] = useState({ nome: '', rolos: '', hex: '' });
  const [coresRanking] = useState(loadCoresRanking());
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState(null);

  // Autocomplete de ref (com debounce)
  useEffect(() => {
    if (isEdit) return;
    if (!refBusca.trim() || produtoSel?.ref === refBusca.trim()) { setAutocomplete([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/ordens-corte-buscar-ref?q=${encodeURIComponent(refBusca.trim())}`);
        const d = await r.json();
        setAutocomplete(d.produtos || []);
      } catch { setAutocomplete([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [refBusca, produtoSel, isEdit]);

  const escolherProduto = (p) => {
    setProdutoSel(p);
    setRefBusca(p.ref);
    setAutocomplete([]);
    if (!p.tecido) setErro('⚠ Esse produto não tem tecido cadastrado em Oficinas. Não dá pra criar ordem.');
    else setErro(null);
  };

  const addTamanho = () => {
    const t = novoTam.trim().toUpperCase();
    if (!t || grade[t] !== undefined) { setNovoTam(''); return; }
    setGrade(g => ({ ...g, [t]: 1 }));
    setNovoTam('');
  };
  const setQtdTam = (t, v) => setGrade(g => ({ ...g, [t]: Math.max(1, parseInt(v) || 1) }));
  const removerTam = (t) => setGrade(g => { const n = { ...g }; delete n[t]; return n; });

  const addCor = (preset) => {
    const c = preset || { nome: novaCor.nome.trim(), rolos: parseInt(novaCor.rolos) || 1, hex: novaCor.hex || hexCor(novaCor.nome) };
    if (!c.nome) return;
    if (cores.some(x => x.nome.toLowerCase() === c.nome.toLowerCase())) { setErro(`Cor "${c.nome}" já adicionada`); return; }
    setCores(prev => [...prev, c]);
    setNovaCor({ nome: '', rolos: '', hex: '' });
    setErro(null);
  };
  const setRolosCor = (i, v) => setCores(prev => prev.map((c, idx) => idx === i ? { ...c, rolos: Math.max(1, parseInt(v) || 1) } : c));
  const removerCor = (i) => setCores(prev => prev.filter((_, idx) => idx !== i));

  const totalRolos = cores.reduce((s, c) => s + (Number(c.rolos) || 0), 0);

  const salvar = async () => {
    setErro(null);
    if (!produtoSel?.ref) { setErro('Selecione uma ref válida'); return; }
    if (!produtoSel.tecido) { setErro('Produto sem tecido cadastrado'); return; }
    if (Object.keys(grade).length === 0) { setErro('Adicione pelo menos 1 tamanho na grade'); return; }
    if (cores.length === 0) { setErro('Adicione pelo menos 1 cor com rolos'); return; }
    if (isEdit && !motivo.trim()) { setErro('Motivo da edição obrigatório'); return; }

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
        body = { ref: produtoSel.ref, grade, cores, grupo: grupoNum, criada_por: usuario };
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

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 99998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, maxWidth: 720, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 24, fontFamily: SERIF, color: '#2c3e50' }}>
        <h2 style={{ margin: '0 0 16px 0', fontSize: 18 }}>{isEdit ? '✎ Editar ordem de corte' : '+ Nova ordem de corte'}</h2>

        {/* REF + autocomplete */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5 }}>Ref do produto</label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              value={refBusca}
              onChange={e => { setRefBusca(e.target.value); if (!isEdit) { setProdutoSel(null); } }}
              disabled={isEdit}
              placeholder="Ex: 02277"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #e8e2da', borderRadius: 6, fontSize: 14, fontFamily: SERIF, marginTop: 4, boxSizing: 'border-box', background: isEdit ? '#f7f4f0' : '#fff' }}
            />
            {autocomplete.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e8e2da', borderRadius: 6, marginTop: 2, maxHeight: 200, overflowY: 'auto', zIndex: 10 }}>
                {autocomplete.map(p => (
                  <div key={p.ref} onClick={() => escolherProduto(p)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f0ebe4' }} onMouseEnter={e => e.currentTarget.style.background = '#f7f4f0'} onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <strong>{p.ref}</strong> · {p.descricao} <span style={{ color: '#8a9aa4', fontSize: 11 }}>{p.tecido ? `· ${p.tecido}` : '⚠ sem tecido'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {produtoSel && (
            <div style={{ marginTop: 6, fontSize: 12, color: produtoSel.tecido ? '#27ae60' : '#c0392b' }}>
              {produtoSel.tecido ? `🧵 ${produtoSel.tecido}` : '⚠ Esse produto não tem tecido cadastrado em Oficinas'}
            </div>
          )}
        </div>

        {/* Grupo */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5 }}>Grupo (opcional, 0-9)</label>
          <input type="number" min="0" max="9" value={grupo} onChange={e => setGrupo(e.target.value)} style={{ display: 'block', marginTop: 4, padding: '9px 12px', border: '1px solid #e8e2da', borderRadius: 6, fontSize: 14, fontFamily: FN, width: 80 }} />
        </div>

        {/* Grade */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5 }}>Grade do enfesto</label>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {Object.entries(grade).map(([t, v]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f7f4f0', padding: '4px 6px 4px 10px', borderRadius: 6 }}>
                <span style={{ fontWeight: 600 }}>{t}</span>
                <input type="number" min="1" value={v} onChange={e => setQtdTam(t, e.target.value)} style={{ width: 40, padding: '3px 4px', border: '1px solid #e8e2da', borderRadius: 4, fontFamily: FN, fontSize: 12, textAlign: 'center' }} />
                <button onClick={() => removerTam(t)} style={{ padding: '0 4px', background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b' }}>×</button>
              </div>
            ))}
            <input type="text" value={novoTam} onChange={e => setNovoTam(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTamanho()} placeholder="P, M, GG..." style={{ width: 80, padding: '5px 8px', border: '1px solid #e8e2da', borderRadius: 4, fontSize: 12, textTransform: 'uppercase' }} />
            <button onClick={addTamanho} style={{ padding: '5px 12px', background: '#5a7faa', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>+ tam</button>
          </div>
        </div>

        {/* Cores */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5 }}>Cores e rolos · Total: <strong>{totalRolos}r</strong></label>

          {/* Cores adicionadas */}
          {cores.length > 0 && (
            <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
              {cores.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: '#fff', border: '1px solid #e8e2da', borderRadius: 6 }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: c.hex || hexCor(c.nome) }} />
                  <span style={{ flex: 1, fontSize: 12 }}>{c.nome}</span>
                  <input type="number" min="1" value={c.rolos} onChange={e => setRolosCor(i, e.target.value)} style={{ width: 40, padding: '2px 4px', border: '1px solid #e8e2da', borderRadius: 4, fontFamily: FN, fontSize: 12, textAlign: 'center' }} />
                  <button onClick={() => removerCor(i)} style={{ background: 'none', border: 'none', color: '#c0392b', cursor: 'pointer' }}>×</button>
                </div>
              ))}
            </div>
          )}

          {/* Sugestões Bling */}
          {coresRanking.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: '#8a9aa4', marginBottom: 4 }}>📊 Cores sugeridas (Ranking Bling)</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {coresRanking.slice(0, 16).map(c => {
                  const ja = cores.some(x => x.nome.toLowerCase() === c.nome.toLowerCase());
                  return (
                    <button
                      key={c.nome}
                      onClick={() => !ja && addCor({ nome: c.nome, rolos: 1, hex: c.hex || hexCor(c.nome) })}
                      disabled={ja}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 8px', background: ja ? '#f7f4f0' : '#fff',
                        border: '1px solid #e8e2da', borderRadius: 12,
                        cursor: ja ? 'default' : 'pointer', fontSize: 11,
                        opacity: ja ? 0.5 : 1,
                      }}
                    >
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.hex || hexCor(c.nome) }} />
                      {c.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add cor manual */}
          <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
            <input type="text" value={novaCor.nome} onChange={e => setNovaCor(p => ({ ...p, nome: e.target.value }))} placeholder="Nome da cor" style={{ flex: 1, padding: '6px 10px', border: '1px solid #e8e2da', borderRadius: 4, fontSize: 12 }} />
            <input type="number" min="1" value={novaCor.rolos} onChange={e => setNovaCor(p => ({ ...p, rolos: e.target.value }))} placeholder="Rolos" style={{ width: 60, padding: '6px 8px', border: '1px solid #e8e2da', borderRadius: 4, fontSize: 12, fontFamily: FN, textAlign: 'center' }} />
            <input type="color" value={novaCor.hex || '#999999'} onChange={e => setNovaCor(p => ({ ...p, hex: e.target.value }))} style={{ width: 36, height: 32, padding: 2, border: '1px solid #e8e2da', borderRadius: 4, cursor: 'pointer' }} />
            <button onClick={() => addCor()} style={{ padding: '5px 12px', background: '#5a7faa', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>+ cor</button>
          </div>
        </div>

        {/* Motivo de edição (só pra editar) */}
        {isEdit && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5 }}>Motivo da edição *</label>
            <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex: Adicionar cor Bege" style={{ display: 'block', marginTop: 4, width: '100%', padding: '9px 12px', border: '1px solid #e8e2da', borderRadius: 6, fontSize: 13, fontFamily: SERIF, boxSizing: 'border-box' }} />
          </div>
        )}

        {/* Erro */}
        {erro && <div style={{ padding: 10, background: '#fdeaea', color: '#c0392b', borderRadius: 6, marginBottom: 12, fontSize: 12 }}>{erro}</div>}

        {/* Ações */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={saving} style={{ padding: '9px 18px', background: '#fff', color: '#5a6b7a', border: '1px solid #e8e2da', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontFamily: SERIF }}>Cancelar</button>
          <button onClick={salvar} disabled={saving || !produtoSel?.tecido} style={{ padding: '9px 22px', background: saving ? '#8a9aa4' : '#27ae60', color: '#fff', border: 'none', borderRadius: 6, cursor: saving ? 'wait' : 'pointer', fontSize: 13, fontFamily: SERIF, fontWeight: 600 }}>
            {saving ? 'Salvando...' : (isEdit ? 'Salvar alterações' : 'Criar ordem')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL EXCLUIR
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
          REF <strong>{ordem.ref}</strong> · {ordem.total_rolos} rolos<br/>
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
