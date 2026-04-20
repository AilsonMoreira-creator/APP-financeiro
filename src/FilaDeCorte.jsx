/**
 * FilaDeCorte.jsx — Tela mobile da fila de corte (funcionário separa tecido + define sala)
 *
 * Props:
 *   - supabase: cliente Supabase
 *   - usuarioLogado: { usuario, admin, ... }
 */

import { useState, useEffect, useCallback } from 'react';

const FN = "Calibri,'Segoe UI',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const COR_FALLBACK_HEX = {
  preto: '#1c1c1c', marinho: '#1e2c4a', bege: '#c9b896', branco: '#f5f0e8',
  marrom: '#5a3a26', figo: '#6b2d3a', verde: '#3d6b3a', off: '#e8e0d0',
  vermelho: '#a02828', cinza: '#7a7a7a', azul: '#2d5a8c', rosa: '#d49ab0',
  amarelo: '#d4b740', laranja: '#d47a3a', roxo: '#6b3a8c',
};
function hexCor(nome) {
  if (!nome) return '#999';
  return COR_FALLBACK_HEX[nome.toLowerCase().trim()] || '#999';
}
function loadCoresRanking() {
  try {
    const raw = localStorage.getItem('amica_bling_cores_top');
    if (!raw) return [];
    return JSON.parse(raw)?.cores || [];
  } catch { return []; }
}

const SALAS_PADRAO = ['Antonio', 'Adalecio', 'Chico'];

export default function FilaDeCorte({ supabase, usuarioLogado }) {
  const [ordens, setOrdens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [aba, setAba] = useState('aguardando'); // aguardando | separado
  const [editandoTecido, setEditandoTecido] = useState(null);
  const [definindoSala, setDefinindoSala] = useState(null);

  const usuario = usuarioLogado?.usuario || '';
  const isAdmin = usuarioLogado?.admin === true;

  const carregar = useCallback(async () => {
    try {
      setLoading(true); setErro(null);
      const r = await fetch(`/api/ordens-corte-listar?perfil=${isAdmin ? 'admin' : 'funcionario'}`);
      const d = await r.json();
      if (d.error) { setErro(d.error); return; }
      setOrdens((d.ordens || []).filter(o => o.status === 'aguardando' || o.status === 'separado'));
    } catch (e) { setErro(e?.message); }
    finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { carregar(); }, [carregar]);

  // Realtime
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel('sync-ordens-corte-fila')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ordens_corte' }, () => carregar())
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [supabase, carregar]);

  const aguardando = ordens.filter(o => o.status === 'aguardando');
  const separadas = ordens.filter(o => o.status === 'separado');
  const lista = aba === 'aguardando' ? aguardando : separadas;

  const confirmarSeparado = async (ordem) => {
    try {
      const r = await fetch('/api/ordens-corte-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': usuario },
        body: JSON.stringify({ id: ordem.id, novoStatus: 'separado', usuario }),
      });
      const d = await r.json();
      if (!r.ok) { alert(d.error || 'Erro ao confirmar'); return; }
      carregar();
    } catch (e) { alert(e?.message); }
  };

  return (
    <div style={{ fontFamily: SERIF, color: '#2c3e50', maxWidth: 460, margin: '0 auto', padding: 0, minHeight: '100vh', background: '#f7f4f0' }}>
      {/* Header */}
      <div style={{ position: 'sticky', top: 0, background: '#fff', padding: '14px 18px', borderBottom: '1px solid #e8e2da', zIndex: 10, boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#2c3e50' }}>✂️ Fila de Corte</div>
          {aguardando.length > 0 && (
            <span style={{ background: '#c0392b', color: '#fff', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontFamily: FN, fontWeight: 700 }}>
              {aguardando.length} pra separar
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#8a9aa4', marginTop: 4 }}>Logado como <strong style={{ color: '#5a6b7a' }}>{usuario}</strong></div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #e8e2da', position: 'sticky', top: 70, zIndex: 9 }}>
        <button onClick={() => setAba('aguardando')} style={{ flex: 1, padding: '11px 8px', background: 'none', border: 'none', borderBottom: aba === 'aguardando' ? '2px solid #2c3e50' : '2px solid transparent', cursor: 'pointer', fontFamily: SERIF, fontSize: 13, fontWeight: aba === 'aguardando' ? 700 : 400, color: aba === 'aguardando' ? '#2c3e50' : '#8a9aa4' }}>
          Pra separar <span style={{ background: '#f0ebe4', padding: '1px 7px', borderRadius: 8, fontSize: 11, marginLeft: 4 }}>{aguardando.length}</span>
        </button>
        <button onClick={() => setAba('separado')} style={{ flex: 1, padding: '11px 8px', background: 'none', border: 'none', borderBottom: aba === 'separado' ? '2px solid #2c3e50' : '2px solid transparent', cursor: 'pointer', fontFamily: SERIF, fontSize: 13, fontWeight: aba === 'separado' ? 700 : 400, color: aba === 'separado' ? '#2c3e50' : '#8a9aa4' }}>
          Separados <span style={{
            background: separadas.length > 0 ? '#c8a040' : '#f0ebe4',
            color: separadas.length > 0 ? '#fff' : '#2c3e50',
            padding: '1px 7px', borderRadius: 8, fontSize: 11, marginLeft: 4, fontWeight: 700,
          }}>{separadas.length}</span>
        </button>
      </div>

      {/* Lista */}
      <div style={{ padding: 12 }}>
        {loading && <div style={{ padding: 32, textAlign: 'center', color: '#8a9aa4' }}>Carregando...</div>}
        {erro && <div style={{ padding: 12, background: '#fdeaea', color: '#c0392b', borderRadius: 8 }}>⚠ {erro}</div>}
        {!loading && lista.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: '#8a9aa4', background: '#fff', borderRadius: 8 }}>
            {aba === 'aguardando' ? 'Nenhum corte pra separar no momento 👌' : 'Nenhum corte separado aguardando sala'}
          </div>
        )}

        {lista.map(ordem => (
          <FilaCard
            key={ordem.id}
            ordem={ordem}
            onConfirmarSeparado={() => confirmarSeparado(ordem)}
            onEditarTecido={() => setEditandoTecido(ordem)}
            onDefinirSala={() => setDefinindoSala(ordem)}
          />
        ))}
      </div>

      {/* Modal Editar Tecido */}
      {editandoTecido && (
        <ModalEditarTecido
          ordem={editandoTecido}
          usuario={usuario}
          onClose={() => setEditandoTecido(null)}
          onSalvo={() => { setEditandoTecido(null); carregar(); }}
        />
      )}

      {/* Modal Definir Sala */}
      {definindoSala && (
        <ModalDefinirSala
          ordem={definindoSala}
          usuario={usuario}
          onClose={() => setDefinindoSala(null)}
          onSalvo={() => { setDefinindoSala(null); carregar(); }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CARD
// ════════════════════════════════════════════════════════════════════════════

function FilaCard({ ordem, onConfirmarSeparado, onEditarTecido, onDefinirSala }) {
  const isAguardando = ordem.status === 'aguardando';
  const cores = ordem.cores || [];

  return (
    <div style={{ background: '#fff', borderRadius: 10, padding: 12, marginBottom: 10, border: '1px solid #e8e2da' }}>
      {/* Top */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>REF {ordem.ref}</div>
          <div style={{ fontSize: 12, color: '#5a6b7a', marginTop: 2 }}>{ordem.descricao}</div>
        </div>
        {ordem.grupo != null && (
          <div style={{ textAlign: 'center', minWidth: 36 }}>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: FN, color: '#2c3e50' }}>{ordem.grupo}</div>
            <div style={{ fontSize: 9, color: '#8a9aa4', textTransform: 'uppercase' }}>grupo</div>
          </div>
        )}
        <span style={{
          padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600,
          background: isAguardando ? '#faf6ec' : '#f0f4fa',
          color: isAguardando ? '#c8a040' : '#4a7fa5',
          border: `1px solid ${isAguardando ? '#c8a040' : '#4a7fa5'}`,
        }}>
          {isAguardando ? '⏳ Aguardando' : '🧵 Separado'}
        </span>
      </div>

      {/* Tecido */}
      <div style={{ padding: '8px 10px', background: '#f7f4f0', borderRadius: 6, fontSize: 12, marginBottom: 10 }}>
        🧵 Tecido: <strong>{ordem.tecido}</strong>
      </div>

      {/* Cores */}
      <div style={{ marginBottom: 10 }}>
        {cores.map((c, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', borderBottom: i < cores.length - 1 ? '1px solid #f0ebe4' : 'none' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: c.hex || hexCor(c.nome) }} />
              {c.nome}
            </span>
            <span style={{ fontFamily: FN, fontWeight: 700, fontSize: 14 }}>{c.rolos}</span>
          </div>
        ))}
      </div>

      {/* Total */}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: '#f7f4f0', borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
        <span>Total</span>
        <span><strong style={{ fontFamily: FN, fontSize: 16 }}>{ordem.total_rolos}</strong> rolos</span>
      </div>

      {/* Ações */}
      {isAguardando ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button onClick={onConfirmarSeparado} style={{ padding: 14, background: '#27ae60', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontFamily: SERIF, fontWeight: 600, cursor: 'pointer' }}>
            ✓ Confirmar tecido separado
          </button>
          <button onClick={onEditarTecido} style={{ padding: 14, background: '#fff', color: '#5a6b7a', border: '1px solid #e8e2da', borderRadius: 8, fontSize: 13, fontFamily: SERIF, cursor: 'pointer' }}>
            ✎ Editar
          </button>
        </div>
      ) : (
        <button onClick={onDefinirSala} style={{ width: '100%', padding: 14, background: '#2c3e50', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontFamily: SERIF, fontWeight: 600, cursor: 'pointer' }}>
          ✂️ Definir sala de corte
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL EDITAR TECIDO (cores)
// ════════════════════════════════════════════════════════════════════════════

function ModalEditarTecido({ ordem, usuario, onClose, onSalvo }) {
  const [cores, setCores] = useState(ordem.cores || []);
  const [coresRanking] = useState(loadCoresRanking());
  const [novaCor, setNovaCor] = useState({ nome: '', rolos: '', hex: '' });
  const [erro, setErro] = useState(null);
  const [saving, setSaving] = useState(false);

  const setRolos = (i, v) => setCores(prev => prev.map((c, idx) => idx === i ? { ...c, rolos: Math.max(1, parseInt(v) || 1) } : c));
  const remover = (i) => setCores(prev => prev.filter((_, idx) => idx !== i));
  const addPreset = (c) => {
    if (cores.some(x => x.nome.toLowerCase() === c.nome.toLowerCase())) return;
    setCores(prev => [...prev, { nome: c.nome, rolos: 1, hex: c.hex || hexCor(c.nome) }]);
  };
  const addManual = () => {
    if (!novaCor.nome.trim()) return;
    if (cores.some(x => x.nome.toLowerCase() === novaCor.nome.toLowerCase())) { setErro('Cor já adicionada'); return; }
    setCores(prev => [...prev, { nome: novaCor.nome.trim(), rolos: parseInt(novaCor.rolos) || 1, hex: novaCor.hex || hexCor(novaCor.nome) }]);
    setNovaCor({ nome: '', rolos: '', hex: '' });
    setErro(null);
  };

  const salvar = async () => {
    if (cores.length === 0) { setErro('Pelo menos 1 cor'); return; }
    setSaving(true);
    try {
      // Usa endpoint atualizar pra editar só cores (já existente, com optimistic locking)
      const r = await fetch('/api/ordens-corte-atualizar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User': usuario },
        body: JSON.stringify({ id: ordem.id, version: ordem.version, usuario, cores, motivo_edicao: 'Editado pela Fila Mobile' }),
      });
      const d = await r.json();
      if (!r.ok) { setErro(d.error || 'Erro'); setSaving(false); return; }
      onSalvo && onSalvo();
    } catch (e) { setErro(e?.message); setSaving(false); }
  };

  const totalRolos = cores.reduce((s, c) => s + (Number(c.rolos) || 0), 0);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99998, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 20, fontFamily: SERIF, color: '#2c3e50' }}>
        <div style={{ width: 40, height: 4, background: '#e0d8d0', borderRadius: 2, margin: '0 auto 12px' }} />
        <h3 style={{ margin: '0 0 4px 0', fontSize: 16 }}>✎ Editar tecido</h3>
        <div style={{ fontSize: 12, color: '#8a9aa4', marginBottom: 14 }}>Ajuste cores e quantidades antes de confirmar a separação</div>

        {/* Cores atuais */}
        <div style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Cores atuais · Total: <strong>{totalRolos}r</strong></div>
        {cores.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px', background: '#f7f4f0', borderRadius: 8, marginBottom: 6 }}>
            <span style={{ width: 16, height: 16, borderRadius: '50%', background: c.hex || hexCor(c.nome) }} />
            <span style={{ flex: 1, fontSize: 13 }}>{c.nome}</span>
            <input type="number" min="1" value={c.rolos} onChange={e => setRolos(i, e.target.value)} style={{ width: 50, padding: 6, border: '1px solid #e8e2da', borderRadius: 4, fontFamily: FN, fontSize: 13, textAlign: 'center' }} />
            <button onClick={() => remover(i)} style={{ background: 'none', border: 'none', color: '#c0392b', fontSize: 16, cursor: 'pointer' }}>×</button>
          </div>
        ))}

        {/* Sugestões Bling */}
        {coresRanking.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>📊 Adicionar (Ranking Bling)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {coresRanking.slice(0, 16).map(c => {
                const ja = cores.some(x => x.nome.toLowerCase() === c.nome.toLowerCase());
                return (
                  <button key={c.nome} onClick={() => !ja && addPreset(c)} disabled={ja} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 9px', background: '#fff', border: '1px solid #e8e2da', borderRadius: 14, cursor: ja ? 'default' : 'pointer', fontSize: 11, opacity: ja ? 0.4 : 1 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.hex || hexCor(c.nome) }} />
                    {c.nome}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Cor manual */}
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Adicionar cor nova</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input type="text" value={novaCor.nome} onChange={e => setNovaCor(p => ({ ...p, nome: e.target.value }))} placeholder="Nome" style={{ flex: 1, padding: 8, border: '1px solid #e8e2da', borderRadius: 4, fontSize: 12 }} />
            <input type="number" min="1" value={novaCor.rolos} onChange={e => setNovaCor(p => ({ ...p, rolos: e.target.value }))} placeholder="Rolos" style={{ width: 60, padding: 8, border: '1px solid #e8e2da', borderRadius: 4, fontSize: 12, fontFamily: FN, textAlign: 'center' }} />
            <input type="color" value={novaCor.hex || '#999999'} onChange={e => setNovaCor(p => ({ ...p, hex: e.target.value }))} style={{ width: 40, height: 36, padding: 2, border: '1px solid #e8e2da', borderRadius: 4 }} />
            <button onClick={addManual} style={{ padding: '8px 12px', background: '#5a7faa', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>+</button>
          </div>
        </div>

        {erro && <div style={{ padding: 8, background: '#fdeaea', color: '#c0392b', borderRadius: 6, marginTop: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
          <button onClick={salvar} disabled={saving} style={{ padding: 14, background: saving ? '#8a9aa4' : '#27ae60', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontFamily: SERIF, fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? 'Salvando...' : 'Salvar edição'}
          </button>
          <button onClick={onClose} disabled={saving} style={{ padding: 14, background: '#fff', color: '#5a6b7a', border: '1px solid #e8e2da', borderRadius: 8, fontSize: 14, fontFamily: SERIF, cursor: 'pointer' }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MODAL DEFINIR SALA
// ════════════════════════════════════════════════════════════════════════════

function ModalDefinirSala({ ordem, usuario, onClose, onSalvo }) {
  const [salaSel, setSalaSel] = useState(null);
  const [erro, setErro] = useState(null);
  const [saving, setSaving] = useState(false);

  const confirmar = async () => {
    if (!salaSel) { setErro('Selecione uma sala'); return; }
    setSaving(true);
    try {
      const r = await fetch('/api/ordens-corte-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': usuario },
        body: JSON.stringify({ id: ordem.id, novoStatus: 'na_sala', sala: salaSel, usuario }),
      });
      const d = await r.json();
      if (!r.ok) { setErro(d.error || 'Erro'); setSaving(false); return; }
      onSalvo && onSalvo();
    } catch (e) { setErro(e?.message); setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 99998, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 20, fontFamily: SERIF, color: '#2c3e50' }}>
        <div style={{ width: 40, height: 4, background: '#e0d8d0', borderRadius: 2, margin: '0 auto 12px' }} />
        <h3 style={{ margin: '0 0 4px 0', fontSize: 16 }}>✂️ Definir sala de corte</h3>
        <div style={{ fontSize: 12, color: '#8a9aa4', marginBottom: 14 }}>
          REF {ordem.ref} · {ordem.total_rolos} rolos<br/>
          Escolha a sala que vai executar o corte
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {SALAS_PADRAO.map(sala => {
            const ativo = salaSel === sala;
            return (
              <button
                key={sala}
                onClick={() => { setSalaSel(sala); setErro(null); }}
                style={{
                  padding: 14,
                  background: ativo ? '#2c3e50' : '#fff',
                  color: ativo ? '#fff' : '#2c3e50',
                  border: `1px solid ${ativo ? '#2c3e50' : '#e8e2da'}`,
                  borderRadius: 8,
                  fontSize: 15,
                  fontFamily: SERIF,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                ✂️ {sala}
              </button>
            );
          })}
        </div>

        {erro && <div style={{ padding: 8, background: '#fdeaea', color: '#c0392b', borderRadius: 6, marginBottom: 10, fontSize: 12 }}>{erro}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={confirmar} disabled={saving || !salaSel} style={{ padding: 14, background: !salaSel ? '#ccc' : (saving ? '#8a9aa4' : '#27ae60'), color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontFamily: SERIF, fontWeight: 600, cursor: !salaSel ? 'not-allowed' : (saving ? 'wait' : 'pointer') }}>
            {saving ? 'Enviando pra sala...' : 'Enviar pra sala'}
          </button>
          <button onClick={onClose} disabled={saving} style={{ padding: 14, background: '#fff', color: '#5a6b7a', border: '1px solid #e8e2da', borderRadius: 8, fontSize: 14, fontFamily: SERIF, cursor: 'pointer' }}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
