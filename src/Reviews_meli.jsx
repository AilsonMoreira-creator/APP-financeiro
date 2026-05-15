/**
 * Reviews_meli.jsx — Tela admin de Inteligencia de Reviews ML
 *
 * Sessao Ailson 14/05/2026 — Sprint 3 do projeto Inteligencia Reviews.
 *
 * Funcionalidades:
 *   - Cards por REF com foto + metricas (vendas 30d, reviews 30d, nota Exitus)
 *   - Alerta amarelo se analise quinzenal detectou mudanca recorrente
 *   - Card expandido mostra 7 blocos de resumo + pontos pos/neg
 *   - Botao "lido" marca alerta como visto (lido_em=NOW)
 *   - Botao "Analise ao vivo" abre modal com Claude Sonnet (Sprint 4)
 *
 * Padroes visuais:
 *   - Cores do app (Georgia serif, #2c3e50, #4a7fa5, #f7f4f0, #e8e2da)
 *   - Icones vazados (lucide-react strokeWidth=2)
 *   - Aceita mobile (responsivo)
 *
 * Props:
 *   - sbUrl: URL do Supabase pra foto (ja existente no Bling)
 *   - onClose: callback pra fechar e voltar pro Bling
 *   - userId: pra registrar quem leu/solicitou analise
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft, RefreshCw, AlertTriangle, Check, ChevronDown, ChevronUp,
  Sparkles, TrendingUp, ShoppingBag, Star, Loader2, X,
} from 'lucide-react';
import { supabase } from './Lojas_Shared.jsx';

// ═══════════════════════════════════════════════════════════════════════
// PALETTE — segue padrao do Bling (App.tsx)
// ═══════════════════════════════════════════════════════════════════════
const palette = {
  ink: '#2c3e50',
  blue: '#4a7fa5',
  bg: '#f7f4f0',
  surface: '#fff',
  border: '#e8e2da',
  muted: '#a89f94',
  ok: '#5e8c3a',
  warn: '#c19a3e',
  warnSoft: '#fef5d4',
  alert: '#c0392b',
  alertSoft: '#fdebe8',
};
const FONT = 'Georgia, serif';

// ═══════════════════════════════════════════════════════════════════════
// FOTO PRODUTO (replica do FotoProdLarge pra nao importar App.tsx)
// ═══════════════════════════════════════════════════════════════════════
function FotoRef({ sbUrl, refProd, size = 80 }) {
  const orig = String(refProd).toUpperCase();
  const norm = orig.replace(/^0+/, '');
  const storageBase = sbUrl ? `${sbUrl}/storage/v1/object/public/produtos/` : '';
  const cb = '?v=' + new Date().toISOString().slice(0, 10);
  if (!storageBase) {
    return (
      <div style={{
        width: size, height: size * 1.33,
        borderRadius: 6, background: '#f0ebe3',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: `1px solid ${palette.border}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, opacity: 0.3 }}>📷</span>
      </div>
    );
  }
  const urls = [norm + '.jpg', norm + '.png', norm + '.webp'];
  if (orig !== norm) urls.push(orig + '.jpg', orig + '.png', orig + '.webp');
  const pad4 = norm.padStart(4, '0'), pad5 = norm.padStart(5, '0');
  if (pad4 !== norm && pad4 !== orig) urls.push(pad4 + '.jpg', pad4 + '.png', pad4 + '.webp');
  if (pad5 !== norm && pad5 !== orig && pad5 !== pad4) urls.push(pad5 + '.jpg', pad5 + '.png', pad5 + '.webp');
  return (
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
      style={{
        width: size, height: size * 1.33,
        objectFit: 'cover', borderRadius: 6,
        border: `1px solid ${palette.border}`, flexShrink: 0,
      }}
    />
  );
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════
function fmtMoeda(v) {
  if (v == null || isNaN(v)) return '—';
  return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmtNum(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR');
}
function corNota(nota) {
  if (!nota) return palette.muted;
  if (nota >= 4.5) return palette.ok;
  if (nota >= 3.5) return palette.warn;
  return palette.alert;
}

// ═══════════════════════════════════════════════════════════════════════
// CARD DE UM PRODUTO — recolhido + expandido
// ═══════════════════════════════════════════════════════════════════════
function CardProduto({ card, sbUrl, userId, onAbrirAnalise, onMarcarLido }) {
  const [expandido, setExpandido] = useState(false);
  const [marcandoLido, setMarcandoLido] = useState(false);
  
  const temAlerta = !!card.tem_alerta;
  const ultimaAnalise = card.ultima_analise_em 
    ? new Date(card.ultima_analise_em).toLocaleDateString('pt-BR')
    : null;
  
  const handleMarcarLido = async () => {
    if (!card.ultima_analise_id || marcandoLido) return;
    setMarcandoLido(true);
    try {
      await onMarcarLido(card.ultima_analise_id, card.ref_amicia);
    } finally {
      setMarcandoLido(false);
    }
  };
  
  return (
    <div style={{
      background: palette.surface,
      border: `2px solid ${temAlerta ? palette.warn : palette.border}`,
      borderRadius: 10,
      padding: 12,
      fontFamily: FONT,
      position: 'relative',
      transition: 'border-color 0.2s',
    }}>
      {/* Badge alerta no canto */}
      {temAlerta && (
        <div style={{
          position: 'absolute', top: -8, right: 10,
          background: palette.warn, color: '#fff',
          padding: '2px 8px', borderRadius: 10,
          fontSize: 10, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <AlertTriangle size={11} strokeWidth={2.5} /> ALERTA
        </div>
      )}
      
      {/* Linha 1: Foto + REF/Descricao + Metricas */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
        <FotoRef sbUrl={sbUrl} refProd={card.ref_amicia} size={64} />
        
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: palette.ink }}>
              REF {card.ref_amicia}
            </span>
            {card.nota_exitus != null && (
              <span style={{
                fontSize: 12, color: corNota(card.nota_exitus),
                fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2,
              }}>
                <Star size={12} fill={corNota(card.nota_exitus)} strokeWidth={0} />
                {Number(card.nota_exitus).toFixed(1)}
              </span>
            )}
          </div>
          <div style={{
            fontSize: 11, color: palette.muted,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginBottom: 6,
          }}>
            {card.descricao || '—'}
          </div>
          
          {/* Metricas em 3 colunas */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            gap: 4, fontSize: 10,
          }}>
            <Metrica icon={<ShoppingBag size={11} strokeWidth={2} />} 
              label="Vendas 30d" valor={fmtNum(card.vendas_30d_qtd)} 
              sub={fmtMoeda(card.vendas_30d_valor)} cor={palette.blue} />
            <Metrica icon={<TrendingUp size={11} strokeWidth={2} />} 
              label="Reviews 30d" valor={fmtNum(card.reviews_30d || 0)} 
              cor={palette.ink} />
            <Metrica icon={<Star size={11} strokeWidth={2} />} 
              label="Total Exitus" valor={fmtNum(card.qtd_reviews_exitus || 0)} 
              sub={card.nota_exitus ? `★ ${Number(card.nota_exitus).toFixed(1)}` : 'sem reviews'} 
              cor={corNota(card.nota_exitus)} />
          </div>
        </div>
      </div>
      
      {/* Alerta detalhado se mudou_recorrente */}
      {temAlerta && card.mudancas_detectadas && (
        <div style={{
          background: palette.warnSoft, padding: '8px 10px', borderRadius: 6,
          marginBottom: 8, fontSize: 11, color: '#856404',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            🟡 Mudanças recorrentes detectadas:
          </div>
          {(card.mudancas_detectadas || []).slice(0, 3).map((m, i) => (
            <div key={i} style={{ marginLeft: 8, lineHeight: 1.4 }}>
              • {m.descricao}
            </div>
          ))}
        </div>
      )}
      
      {/* Conteudo expandido — 7 blocos */}
      {expandido && card.resumo_categorias && (
        <ResumoCompleto resumo={card.resumo_categorias} 
          pontosPositivos={card.pontos_positivos} 
          pontosNegativos={card.pontos_negativos}
          ultimaAnalise={ultimaAnalise} />
      )}
      
      {expandido && !card.resumo_categorias && (
        <div style={{
          background: palette.bg, padding: 10, borderRadius: 6,
          fontSize: 12, color: palette.muted, fontStyle: 'italic',
          textAlign: 'center',
        }}>
          Análise quinzenal ainda não rodou pra essa REF. Aguarde dia 1 ou 15
          do mês — ou clique em "Análise ao vivo" pra ter insights agora.
        </div>
      )}
      
      {/* Botoes acao */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => setExpandido(e => !e)}
          style={{
            flex: 1, minWidth: 100,
            background: palette.bg, border: `1px solid ${palette.border}`,
            borderRadius: 6, padding: '6px 10px',
            fontSize: 12, fontFamily: FONT, color: palette.ink,
            cursor: 'pointer', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}
        >
          {expandido ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          {expandido ? 'Recolher' : 'Expandir'}
        </button>
        <button
          onClick={() => onAbrirAnalise(card.ref_amicia)}
          style={{
            flex: 1, minWidth: 100,
            background: palette.blue, border: 'none',
            borderRadius: 6, padding: '6px 10px',
            fontSize: 12, fontFamily: FONT, color: '#fff',
            cursor: 'pointer', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}
        >
          <Sparkles size={13} strokeWidth={2} /> Análise IA
        </button>
        {temAlerta && (
          <button
            onClick={handleMarcarLido}
            disabled={marcandoLido}
            style={{
              flex: 1, minWidth: 100,
              background: marcandoLido ? palette.muted : palette.ok,
              border: 'none', borderRadius: 6, padding: '6px 10px',
              fontSize: 12, fontFamily: FONT, color: '#fff',
              cursor: marcandoLido ? 'wait' : 'pointer', fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}
          >
            <Check size={13} strokeWidth={2.5} /> {marcandoLido ? 'Marcando...' : 'Marcar lido'}
          </button>
        )}
      </div>
    </div>
  );
}

function Metrica({ icon, label, valor, sub, cor }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 3,
        color: palette.muted, fontSize: 9, textTransform: 'uppercase',
        letterSpacing: 0.5, marginBottom: 1,
      }}>
        {icon} {label}
      </div>
      <div style={{
        fontSize: 14, fontWeight: 700, color: cor || palette.ink,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {valor}
      </div>
      {sub && (
        <div style={{ fontSize: 9, color: palette.muted, whiteSpace: 'nowrap' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// RESUMO COMPLETO — 7 blocos
// ═══════════════════════════════════════════════════════════════════════
function ResumoCompleto({ resumo, pontosPositivos, pontosNegativos, ultimaAnalise }) {
  const BLOCOS_FIXOS = [
    { key: 'tecido', label: 'Tecido' },
    { key: 'cor', label: 'Cor' },
    { key: 'encolhimento', label: 'Encolhimento' },
    { key: 'ziper', label: 'Zíper' },
    { key: 'tamanho', label: 'Tamanho' },
  ];
  
  return (
    <div style={{
      background: palette.bg, padding: 10, borderRadius: 6, marginBottom: 8,
    }}>
      {ultimaAnalise && (
        <div style={{
          fontSize: 10, color: palette.muted, marginBottom: 8,
          textAlign: 'right', fontStyle: 'italic',
        }}>
          Última análise: {ultimaAnalise}
        </div>
      )}
      
      {/* 5 blocos categorias */}
      <div style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
        {BLOCOS_FIXOS.map(b => {
          const dados = resumo[b.key] || { nota: 0, qtd_mencoes: 0 };
          if (dados.qtd_mencoes === 0) return null;
          return (
            <BlocoCategoria key={b.key} label={b.label} dados={dados} />
          );
        })}
      </div>
      
      {/* Pontos positivos */}
      {(pontosPositivos || []).length > 0 && (
        <ListaPontos 
          titulo="✓ Pontos positivos" 
          cor={palette.ok} 
          itens={pontosPositivos} />
      )}
      
      {/* Pontos negativos */}
      {(pontosNegativos || []).length > 0 && (
        <ListaPontos 
          titulo="⚠ Pontos negativos" 
          cor={palette.alert} 
          itens={pontosNegativos} />
      )}
    </div>
  );
}

function BlocoCategoria({ label, dados }) {
  const cor = corNota(dados.nota);
  return (
    <div style={{
      background: palette.surface, padding: 8, borderRadius: 5,
      border: `1px solid ${palette.border}`,
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 4,
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: palette.ink }}>
          {label}
        </span>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 11,
        }}>
          <span style={{ color: cor, fontWeight: 700 }}>
            ★ {Number(dados.nota || 0).toFixed(1)}
          </span>
          <span style={{ color: palette.muted }}>
            {dados.qtd_mencoes} {dados.qtd_mencoes === 1 ? 'menção' : 'menções'}
          </span>
        </span>
      </div>
      {(dados.top_positivos || []).length > 0 && (
        <div style={{ fontSize: 11, color: palette.ok, marginTop: 2, lineHeight: 1.4 }}>
          ✓ {dados.top_positivos.join(' · ')}
        </div>
      )}
      {(dados.top_negativos || []).length > 0 && (
        <div style={{ fontSize: 11, color: palette.alert, marginTop: 2, lineHeight: 1.4 }}>
          ⚠ {dados.top_negativos.join(' · ')}
        </div>
      )}
    </div>
  );
}

function ListaPontos({ titulo, cor, itens }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: cor, marginBottom: 3,
      }}>
        {titulo}
      </div>
      <div style={{ marginLeft: 8 }}>
        {itens.map((p, i) => (
          <div key={i} style={{ fontSize: 11, color: palette.ink, lineHeight: 1.5 }}>
            • {p}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MODAL DE ANALISE AO VIVO — Sprint 4 vai preencher o conteudo
// ═══════════════════════════════════════════════════════════════════════
function ModalAnaliseLive({ ref_amicia, onClose, userId }) {
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState(null);
  const [erro, setErro] = useState(null);
  
  useEffect(() => {
    if (!ref_amicia) return;
    let cancelado = false;
    (async () => {
      setLoading(true);
      setErro(null);
      try {
        const r = await fetch('/api/ml-reviews-analise-live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User': userId || '' },
          body: JSON.stringify({ ref: ref_amicia }),
        });
        const json = await r.json();
        if (cancelado) return;
        if (!r.ok) {
          setErro(json.error || `HTTP ${r.status}`);
        } else {
          setInsights(json);
        }
      } catch (e) {
        if (!cancelado) setErro(e.message);
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => { cancelado = true; };
  }, [ref_amicia, userId]);
  
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, fontFamily: FONT,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: palette.surface, borderRadius: 12,
          maxWidth: 600, width: '100%',
          maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${palette.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, background: palette.surface, zIndex: 1,
        }}>
          <div>
            <div style={{ fontSize: 10, color: palette.blue, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Análise IA em tempo real
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: palette.ink }}>
              REF {ref_amicia}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: palette.muted, padding: 4,
          }}>
            <X size={20} />
          </button>
        </div>
        
        {/* Body */}
        <div style={{ padding: 16 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Loader2 size={32} strokeWidth={1.5} style={{
                color: palette.blue, animation: 'spin 1s linear infinite',
              }} />
              <div style={{ fontSize: 13, color: palette.muted, marginTop: 12 }}>
                IA analisando 90 dias de reviews + cruzando com vendas...
              </div>
              <div style={{ fontSize: 11, color: palette.muted, marginTop: 4, fontStyle: 'italic' }}>
                Pode levar 15-30 segundos
              </div>
            </div>
          )}
          
          {erro && (
            <div style={{
              background: palette.alertSoft, color: palette.alert,
              padding: 12, borderRadius: 6, fontSize: 13,
            }}>
              <strong>Erro:</strong> {erro}
            </div>
          )}
          
          {insights && (
            <div>
              {insights.insights_texto && (
                <div style={{
                  whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6,
                  color: palette.ink,
                }}>
                  {insights.insights_texto}
                </div>
              )}
              {insights.custo_brl != null && (
                <div style={{
                  marginTop: 14, padding: 8, background: palette.bg,
                  borderRadius: 4, fontSize: 10, color: palette.muted,
                  textAlign: 'right', fontStyle: 'italic',
                }}>
                  Custo: R$ {Number(insights.custo_brl).toFixed(2)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════
export default function ReviewsMeli({ sbUrl, onClose, userId }) {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [ordem, setOrdem] = useState('alerta'); // alerta | reviews | vendas | nota
  const [filtro, setFiltro] = useState('todos'); // todos | com_alerta | com_reviews
  const [refAnaliseAtiva, setRefAnaliseAtiva] = useState(null);
  
  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const { data, error } = await supabase
        .from('vw_ml_reviews_cards')
        .select('*');
      if (error) throw error;
      setCards(data || []);
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => { carregar(); }, [carregar]);
  
  const handleMarcarLido = async (analiseId, refAmicia) => {
    try {
      const { error } = await supabase
        .from('ml_reviews_analise')
        .update({ lido_em: new Date().toISOString(), lido_por: userId || 'admin' })
        .eq('id', analiseId);
      if (error) throw error;
      // Atualiza localmente sem refetch
      setCards(prev => prev.map(c => 
        c.ref_amicia === refAmicia 
          ? { ...c, tem_alerta: false, lido_em: new Date().toISOString() }
          : c
      ));
    } catch (e) {
      alert('Erro ao marcar lido: ' + e.message);
    }
  };
  
  // Aplica filtro + ordenacao
  const cardsExibidos = useMemo(() => {
    let arr = [...cards];
    if (filtro === 'com_alerta') arr = arr.filter(c => c.tem_alerta);
    if (filtro === 'com_reviews') arr = arr.filter(c => (c.total_reviews || 0) > 0);
    
    arr.sort((a, b) => {
      if (ordem === 'alerta') {
        const da = a.tem_alerta ? 1 : 0, db = b.tem_alerta ? 1 : 0;
        if (db !== da) return db - da;
        return (b.vendas_30d_valor || 0) - (a.vendas_30d_valor || 0);
      }
      if (ordem === 'reviews') return (b.total_reviews || 0) - (a.total_reviews || 0);
      if (ordem === 'vendas') return (b.vendas_30d_valor || 0) - (a.vendas_30d_valor || 0);
      if (ordem === 'nota') {
        // Sem nota = ultimo
        const na = a.nota_exitus == null ? 999 : Number(a.nota_exitus);
        const nb = b.nota_exitus == null ? 999 : Number(b.nota_exitus);
        return na - nb; // pior nota primeiro
      }
      return 0;
    });
    return arr;
  }, [cards, filtro, ordem]);
  
  const totalAlertas = cards.filter(c => c.tem_alerta).length;
  
  return (
    <div style={{
      fontFamily: FONT, color: palette.ink, padding: 0,
      minHeight: '100%',
    }}>
      {/* Keyframes spinner */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      
      {/* HEADER */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
        flexWrap: 'wrap',
      }}>
        <button onClick={onClose} style={{
          background: 'none', border: `1px solid ${palette.border}`,
          borderRadius: 6, padding: '5px 12px',
          fontSize: 12, color: palette.blue, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <ArrowLeft size={14} strokeWidth={2} /> Voltar
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, color: palette.ink }}>
          📊 Reviews ML — inteligência por produto
        </div>
        {totalAlertas > 0 && (
          <div style={{
            background: palette.warn, color: '#fff',
            padding: '3px 10px', borderRadius: 12,
            fontSize: 11, fontWeight: 700,
          }}>
            🟡 {totalAlertas} {totalAlertas === 1 ? 'alerta' : 'alertas'}
          </div>
        )}
        <button onClick={carregar} disabled={loading} style={{
          marginLeft: 'auto',
          background: 'none', border: `1px solid ${palette.border}`,
          borderRadius: 6, padding: '5px 10px',
          fontSize: 11, color: palette.muted, cursor: loading ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <RefreshCw size={12} strokeWidth={2} style={loading ? { animation: 'spin 1s linear infinite' } : {}} />
          {loading ? 'Carregando...' : 'Atualizar'}
        </button>
      </div>
      
      {/* FILTROS + ORDEM */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap',
        alignItems: 'center', fontSize: 11,
      }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: palette.muted }}>Filtrar:</span>
          {[
            ['todos', 'Todos'],
            ['com_alerta', '🟡 Com alerta'],
            ['com_reviews', 'Com reviews'],
          ].map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)} style={{
              background: filtro === k ? palette.ink : palette.surface,
              color: filtro === k ? '#fff' : palette.ink,
              border: filtro === k ? 'none' : `1px solid ${palette.border}`,
              borderRadius: 6, padding: '4px 9px', fontSize: 11,
              cursor: 'pointer', fontFamily: FONT,
            }}>{l}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ color: palette.muted }}>Ordenar:</span>
          {[
            ['alerta', 'Alertas primeiro'],
            ['vendas', 'Mais vendidas'],
            ['reviews', '+ Reviews'],
            ['nota', 'Pior nota'],
          ].map(([k, l]) => (
            <button key={k} onClick={() => setOrdem(k)} style={{
              background: ordem === k ? palette.blue : palette.surface,
              color: ordem === k ? '#fff' : palette.ink,
              border: ordem === k ? 'none' : `1px solid ${palette.border}`,
              borderRadius: 6, padding: '4px 9px', fontSize: 11,
              cursor: 'pointer', fontFamily: FONT,
            }}>{l}</button>
          ))}
        </div>
      </div>
      
      {erro && (
        <div style={{
          background: palette.alertSoft, color: palette.alert,
          padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 10,
        }}>
          Erro ao carregar: {erro}
        </div>
      )}
      
      {loading && cards.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: palette.muted }}>
          <Loader2 size={32} strokeWidth={1.5} style={{
            color: palette.blue, animation: 'spin 1s linear infinite',
          }} />
          <div style={{ marginTop: 12, fontSize: 13 }}>Carregando produtos...</div>
        </div>
      )}
      
      {!loading && cardsExibidos.length === 0 && (
        <div style={{
          textAlign: 'center', padding: 40,
          color: palette.muted, fontStyle: 'italic',
        }}>
          {filtro === 'com_alerta' 
            ? '✓ Nenhum alerta no momento. Tudo sob controle.'
            : 'Nenhum produto encontrado.'}
        </div>
      )}
      
      {/* GRID DE CARDS */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
        gap: 12,
      }}>
        {cardsExibidos.map(c => (
          <CardProduto
            key={c.ref_amicia}
            card={c}
            sbUrl={sbUrl}
            userId={userId}
            onAbrirAnalise={setRefAnaliseAtiva}
            onMarcarLido={handleMarcarLido}
          />
        ))}
      </div>
      
      {/* Modal análise ao vivo */}
      {refAnaliseAtiva && (
        <ModalAnaliseLive
          ref_amicia={refAnaliseAtiva}
          userId={userId}
          onClose={() => setRefAnaliseAtiva(null)}
        />
      )}
    </div>
  );
}
