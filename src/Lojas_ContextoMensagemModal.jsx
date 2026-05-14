/**
 * Lojas_ContextoMensagemModal.jsx — Modal de Contexto pré-mensagem
 *
 * Componente reusavel — quando IA precisa de info da vendedora antes de gerar
 * uma mensagem boa, abre esse modal com perguntas dinamicas.
 *
 * Hoje usado em: trilha winback semana 2 e 3.
 * Futuro: qualquer sugestao que precisar de contexto da vendedora.
 *
 * Props:
 *   open: bool
 *   titulo: string (ex: "Como foi com Maria semana passada?")
 *   questions: array de perguntas (formato do backend)
 *     - id: string
 *     - tipo: 'opcao' | 'texto'
 *     - pergunta: string
 *     - opcoes: [{ valor, label }] (se tipo='opcao')
 *     - obrigatoria: bool
 *     - mostrar_se: { id_outra_pergunta: ['valor1', 'valor2'] } (condicional)
 *   onClose: () => void
 *   onSubmit: (respostas) => void
 *
 * Sessão Ailson 13/05/2026 — Sprint B Trilha Win-back.
 */
import React, { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import { palette, FONT, fz } from './Lojas_Shared';

export default function ContextoMensagemModal({ open, titulo, questions, onClose, onSubmit }) {
  const [respostas, setRespostas] = useState({});
  const [enviando, setEnviando] = useState(false);

  // Reset quando abre
  React.useEffect(() => {
    if (open) {
      setRespostas({});
      setEnviando(false);
    }
  }, [open]);

  // Calcula quais perguntas devem aparecer (mostrar_se)
  const perguntasVisiveis = useMemo(() => {
    return (questions || []).filter(q => {
      if (!q.mostrar_se) return true;
      // Condicao: pelo menos uma chave bate
      for (const [keyOutra, valoresOk] of Object.entries(q.mostrar_se)) {
        const valorAtual = respostas[keyOutra];
        if (valoresOk.includes(valorAtual)) return true;
      }
      return false;
    });
  }, [questions, respostas]);

  // Valida obrigatorias
  const valido = useMemo(() => {
    return perguntasVisiveis.every(q => {
      if (!q.obrigatoria) return true;
      const v = respostas[q.id];
      return v != null && String(v).trim() !== '';
    });
  }, [perguntasVisiveis, respostas]);

  const handleSubmit = async () => {
    if (!valido || enviando) return;
    setEnviando(true);
    try {
      // Limpa respostas de perguntas escondidas (mostrar_se=false)
      const idsVisiveis = new Set(perguntasVisiveis.map(q => q.id));
      const respostasLimpas = {};
      Object.entries(respostas).forEach(([k, v]) => {
        if (idsVisiveis.has(k) && v != null && String(v).trim() !== '') {
          respostasLimpas[k] = v;
        }
      });
      await onSubmit(respostasLimpas);
    } finally {
      setEnviando(false);
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={() => !enviando && onClose && onClose()}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: palette.surface,
          borderRadius: 16,
          maxWidth: 540, width: '100%',
          maxHeight: '90vh', overflowY: 'auto',
          fontFamily: FONT,
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 18px', borderBottom: `1px solid ${palette.beige}`,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 12, position: 'sticky', top: 0, background: palette.surface, zIndex: 1,
        }}>
          <div>
            <div style={{ fontSize: fz(11), fontWeight: 700, color: palette.accent, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Antes da IA gerar a mensagem
            </div>
            <div style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink, marginTop: 3, lineHeight: 1.3 }}>
              {titulo || 'Preciso de algumas infos suas'}
            </div>
          </div>
          <button
            onClick={() => !enviando && onClose && onClose()}
            disabled={enviando}
            style={{
              background: 'none', border: 'none', padding: 4, cursor: 'pointer',
              color: palette.inkMuted, flexShrink: 0,
            }}
            title="Fechar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Texto introdutório */}
        <div style={{
          padding: '12px 18px',
          background: palette.accentSoft,
          borderBottom: `1px solid ${palette.beige}`,
          fontSize: fz(12), color: palette.inkSoft, lineHeight: 1.4,
        }}>
          💡 Suas respostas ajudam a IA a montar a mensagem certa pra essa cliente.
          Quanto melhor o contexto, melhor a mensagem.
        </div>

        {/* Perguntas */}
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {perguntasVisiveis.map((q, idx) => (
            <div key={q.id}>
              <div style={{
                fontSize: fz(13), fontWeight: 600, color: palette.ink, marginBottom: 8,
                lineHeight: 1.35,
              }}>
                {idx + 1}. {q.pergunta}
                {q.obrigatoria && <span style={{ color: palette.alert, marginLeft: 4 }}>*</span>}
              </div>

              {q.tipo === 'opcao' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(q.opcoes || []).map(op => {
                    const selecionado = respostas[q.id] === op.valor;
                    return (
                      <button
                        key={op.valor}
                        onClick={() => setRespostas(r => ({ ...r, [q.id]: op.valor }))}
                        style={{
                          padding: '10px 12px',
                          background: selecionado ? palette.ink : palette.bg,
                          color: selecionado ? palette.bg : palette.ink,
                          border: `1px solid ${selecionado ? palette.ink : palette.beige}`,
                          borderRadius: 8,
                          cursor: 'pointer', fontFamily: FONT, fontSize: fz(13),
                          textAlign: 'left', fontWeight: selecionado ? 600 : 500,
                          transition: 'all 0.15s',
                        }}
                      >
                        {op.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {q.tipo === 'texto' && (
                <textarea
                  value={respostas[q.id] || ''}
                  onChange={e => setRespostas(r => ({ ...r, [q.id]: e.target.value }))}
                  placeholder={q.placeholder || ''}
                  rows={2}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '8px 10px', fontFamily: FONT, fontSize: fz(13),
                    border: `1px solid ${palette.beige}`, borderRadius: 8,
                    background: palette.bg, color: palette.ink,
                    resize: 'vertical',
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px', borderTop: `1px solid ${palette.beige}`,
          display: 'flex', gap: 8, justifyContent: 'flex-end',
          position: 'sticky', bottom: 0, background: palette.surface,
        }}>
          <button
            onClick={() => !enviando && onClose && onClose()}
            disabled={enviando}
            style={{
              padding: '10px 16px',
              background: 'transparent', color: palette.inkSoft,
              border: `1px solid ${palette.beige}`, borderRadius: 8,
              cursor: enviando ? 'wait' : 'pointer',
              fontFamily: FONT, fontSize: fz(13), fontWeight: 500,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!valido || enviando}
            style={{
              padding: '10px 18px',
              background: valido && !enviando ? palette.ok : palette.beige,
              color: '#fff',
              border: 'none', borderRadius: 8,
              cursor: valido && !enviando ? 'pointer' : 'not-allowed',
              fontFamily: FONT, fontSize: fz(13), fontWeight: 600,
              opacity: enviando ? 0.6 : 1,
            }}
          >
            {enviando ? '⏳ Gerando…' : '✨ Gerar mensagem'}
          </button>
        </div>
      </div>
    </div>
  );
}
