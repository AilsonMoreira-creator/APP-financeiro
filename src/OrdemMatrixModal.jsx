/**
 * OrdemMatrixModal.jsx — Modal compartilhado mostrando detalhes completos de 1 ordem
 *
 * Usado em 2 lugares:
 *   1. Botão expandir card na tela Ordem de Corte (admin)
 *   2. Ícone matrix em linha de corte vinculado na Análise/Lista do Salas de Corte
 *
 * Props:
 *   - ordem: objeto da ordem (ou só o ordemId — nesse caso busca via API)
 *   - ordemId: alternativa ao ordem (busca via /api/ordens-corte-get)
 *   - onClose: callback fechar
 */

import { useState, useEffect } from 'react';

const FN = "Calibri,'Segoe UI',Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const STATUS_LABEL = {
  aguardando: { txt: '⏳ Aguardando', bg: '#faf6ec', color: '#c8a040', border: '#c8a040' },
  separado: { txt: '🧵 Tecido separado', bg: '#f0f4fa', color: '#4a7fa5', border: '#4a7fa5' },
  na_sala: { txt: '✂️ Na sala de corte', bg: '#eafbf0', color: '#27ae60', border: '#27ae60' },
  concluido: { txt: '✅ Concluída', bg: '#f0f4fa', color: '#5a7faa', border: '#a8c0d8' },
  cancelado: { txt: '🚫 Cancelada', bg: '#fdeaea', color: '#c0392b', border: '#c0392b' },
};

export default function OrdemMatrixModal({ ordem: ordemProp, ordemId, onClose }) {
  const [ordem, setOrdem] = useState(ordemProp || null);
  const [loading, setLoading] = useState(!ordemProp && !!ordemId);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    if (ordemProp) { setOrdem(ordemProp); return; }
    if (!ordemId) return;
    setLoading(true);
    fetch(`/api/ordens-corte-get?id=${encodeURIComponent(ordemId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setErro(d.error); }
        else setOrdem(d.ordem);
      })
      .catch(e => setErro(e?.message || 'erro ao carregar'))
      .finally(() => setLoading(false));
  }, [ordemId, ordemProp]);

  // ESC fecha
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const overlayStyle = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.45)', zIndex: 99999,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20,
  };
  const boxStyle = {
    background: '#fff', borderRadius: 12, maxWidth: 720, width: '100%',
    maxHeight: '90vh', overflowY: 'auto', padding: 24,
    fontFamily: SERIF, color: '#2c3e50',
    boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
  };

  if (loading) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={{ ...boxStyle, padding: 40, textAlign: 'center' }}>Carregando...</div>
      </div>
    );
  }
  if (erro || !ordem) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={{ ...boxStyle, padding: 40, textAlign: 'center', color: '#c0392b' }}>
          {erro || 'Ordem não encontrada'}
          <div style={{ marginTop: 16 }}>
            <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #e8e2da', background: '#fff', cursor: 'pointer' }}>Fechar</button>
          </div>
        </div>
      </div>
    );
  }

  const status = STATUS_LABEL[ordem.status] || { txt: ordem.status, bg: '#eee', color: '#666', border: '#ccc' };
  const grade = ordem.grade || {};
  const cores = ordem.cores || [];
  const tamanhos = Object.keys(grade);
  const totalModulos = Object.values(grade).reduce((s, v) => s + Number(v || 0), 0);

  // Matriz cor × tamanho: pra cada cor (rolos × módulo do tamanho)
  // Assumimos rendimento default de 20 peças/rolo dividido entre os tamanhos proporcionalmente aos módulos
  const PECAS_POR_ROLO = 20;
  const totalCores = cores.reduce((s, c) => s + Number(c.rolos || 0), 0);

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div style={boxStyle}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
              REF {ordem.ref}{ordem.descricao ? ` · ${ordem.descricao}` : ''}
            </div>
            <div style={{ fontSize: 13, color: '#6b7c8a' }}>
              🧵 {ordem.tecido}
            </div>
          </div>
          <span style={{ background: status.bg, color: status.color, border: `1px solid ${status.border}`, padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {status.txt}
          </span>
        </div>

        {/* Resumo: Total rolos + grupo */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 20, padding: 12, background: '#f7f4f0', borderRadius: 8 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: FN, color: '#2c3e50' }}>{ordem.total_rolos}</div>
            <div style={{ fontSize: 10, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5 }}>rolos</div>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: FN, color: ordem.grupo != null ? '#2c3e50' : '#c0b8b0' }}>{ordem.grupo != null ? ordem.grupo : '—'}</div>
            <div style={{ fontSize: 10, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5 }}>grupo</div>
          </div>
          {ordem.sala && (
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#27ae60' }}>✂️ {ordem.sala}</div>
              <div style={{ fontSize: 10, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5 }}>sala</div>
            </div>
          )}
        </div>

        {/* Grade */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Grade do enfesto</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {tamanhos.map(t => (
              <div key={t} style={{ padding: '6px 12px', background: '#fff', border: '1px solid #e8e2da', borderRadius: 6, fontFamily: FN, fontSize: 13, fontWeight: 600 }}>
                {grade[t]}{t}
              </div>
            ))}
          </div>
        </div>

        {/* Cores e rolos */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Cores e rolos</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
            {cores.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fff', border: '1px solid #e8e2da', borderRadius: 6 }}>
                <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: c.hex || '#999', border: '1px solid rgba(0,0,0,0.1)' }} />
                <span style={{ flex: 1, fontSize: 12 }}>{c.nome}</span>
                <span style={{ fontFamily: FN, fontWeight: 700, fontSize: 13 }}>{c.rolos}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Matriz cor × tamanho */}
        {tamanhos.length > 0 && cores.length > 0 && totalModulos > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Matriz estimada · cor × tamanho ({PECAS_POR_ROLO} pç/rolo)</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FN, fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f7f4f0' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #e8e2da' }}>Cor</th>
                  {tamanhos.map(t => (
                    <th key={t} style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #e8e2da' }}>{t}</th>
                  ))}
                  <th style={{ padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #e8e2da', fontWeight: 700 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {cores.map((c, i) => {
                  const totalPecasCor = Number(c.rolos || 0) * PECAS_POR_ROLO;
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #f0ebe4' }}>
                      <td style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: c.hex || '#999' }} />
                        {c.nome} · {c.rolos}r
                      </td>
                      {tamanhos.map(t => (
                        <td key={t} style={{ padding: '6px 8px', textAlign: 'center' }}>
                          {Math.round(totalPecasCor * (Number(grade[t] || 0) / totalModulos))}
                        </td>
                      ))}
                      <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700 }}>{totalPecasCor}</td>
                    </tr>
                  );
                })}
                <tr style={{ background: '#f7f4f0', fontWeight: 700 }}>
                  <td style={{ padding: '6px 8px' }}>Total · {totalCores} rolos</td>
                  {tamanhos.map(t => (
                    <td key={t} style={{ padding: '6px 8px', textAlign: 'center' }}>
                      {Math.round(totalCores * PECAS_POR_ROLO * (Number(grade[t] || 0) / totalModulos))}
                    </td>
                  ))}
                  <td style={{ padding: '6px 8px', textAlign: 'center' }}>{totalCores * PECAS_POR_ROLO}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Metadados */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16, padding: 12, background: '#f7f4f0', borderRadius: 8, fontSize: 11 }}>
          <div>
            <div style={{ color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Criada em</div>
            <div style={{ color: '#2c3e50', fontWeight: 600 }}>{new Date(ordem.created_at).toLocaleString('pt-BR')}</div>
          </div>
          <div>
            <div style={{ color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Criada por</div>
            <div style={{ color: '#2c3e50', fontWeight: 600 }}>{ordem.criada_por || '—'}</div>
          </div>
          {ordem.separado_em && (
            <div>
              <div style={{ color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Tecido separado</div>
              <div style={{ color: '#2c3e50', fontWeight: 600 }}>{new Date(ordem.separado_em).toLocaleString('pt-BR')} · {ordem.separado_por}</div>
            </div>
          )}
          {ordem.enviado_sala_em && (
            <div>
              <div style={{ color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Enviada à sala</div>
              <div style={{ color: '#2c3e50', fontWeight: 600 }}>{new Date(ordem.enviado_sala_em).toLocaleString('pt-BR')}</div>
            </div>
          )}
          {ordem.concluido_em && (
            <div>
              <div style={{ color: '#8a9aa4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>Concluída</div>
              <div style={{ color: '#2c3e50', fontWeight: 600 }}>{new Date(ordem.concluido_em).toLocaleString('pt-BR')}</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'right' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', borderRadius: 6, border: '1px solid #e8e2da', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: SERIF, color: '#2c3e50' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
