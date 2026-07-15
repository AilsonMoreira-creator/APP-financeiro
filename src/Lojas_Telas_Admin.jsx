/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Lojas_Telas_Admin.jsx — PARTE 2B
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Telas administrativas (acesso restrito a amicia-admin / ailson / tamara):
 *
 *   1. PromocoesScreen          — listagem de promoções ativas + histórico
 *   2. NovaPromocaoScreen       — form de criar/editar promoção
 *   3. RegrasScreen             — configuração de tom + regras IA
 *   4. VendedorasAdminScreen    — listagem ativas + ex-vendedoras
 *   5. NovaVendedoraScreen      — form de cadastrar/editar vendedora
 *   6. TransferirCarteiraScreen — toggle avulsa/em-massa
 *   7. CuradoriaScreen          — best-sellers / em alta / novidade manual (3 abas)
 *   8. ImportacoesScreen        — histórico semanal Drive
 *   9. GruposListScreen         — listagem de grupos + filtro vendedora
 *  10. DetalheGrupoScreen       — card grupo + docs + mensagens enviadas
 *  11. CriarGrupoModal          — wizard 3 steps
 *  12. AdicionarCnpjModal       — modal simples de adicionar CNPJ ao grupo
 *
 * Importa do Lojas.jsx (Parte 1):
 *   - hook useLojasModule (já vem com state + handlers)
 *   - tokens palette, FONT, statusMap
 *   - componentes Header, StatusDot, TabBar, SectionTitle, LampIcon
 *   - supabase client (pra queries específicas: histórico promoções, mensagens grupo)
 *
 * Decisões pragmáticas:
 *   • Doc principal do grupo = calculado dinamicamente (cliente de maior lifetime).
 *     Não persiste em DB pra evitar migração de schema.
 *   • Promoção MVP = todas vendedoras participam. UX mantém checkboxes, mas não
 *     persiste vendedoras_ids (coluna não existe). TODO: criar coluna depois.
 *   • Upload manual de importação = UI presente, mas redireciona pra info sobre
 *     Drive automático (toda terça 06:00). Edge Function fica pra Parte 5.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ArrowLeft, ChevronRight, ChevronUp, ChevronDown, Search, Settings,
  Users, Star, Sparkles, AlertTriangle, MessageCircle, Package, Tag,
  Pause, Calendar, Archive, Bot, Plus, Store, Gift, FileText,
  ArrowLeftRight, TrendingUp, BarChart3, UserCog, Heart,
  Save, Trash2, Edit3, Pencil, Clock, CheckCircle2, AlertCircle, Check, X,
  Upload, Download, FileSpreadsheet, History, UsersRound, Link2, Crown,
  Loader2, Flame, Megaphone, Bell, Palette, EyeOff, RotateCcw, RefreshCw,
} from 'lucide-react';

// Importa primitives e tokens compartilhados (sem ciclo — Lojas_Shared.jsx
// não importa dos outros arquivos do módulo)
import {
  palette, FONT, statusMap,
  Header, StatusDot, TabBar, SectionTitle, LampIcon,
  supabase, fz, sz, FotoProdutoLojas, spinKeyframes, refDisplay,
} from './Lojas_Shared.jsx';

// Importa ModalMensagem da Parte 2a (usado em DetalheGrupoScreen)
import { ModalMensagem } from './Lojas_Telas_Vendedora.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS DE FORMATAÇÃO (recriados localmente — não exportados em 2a)
// ═══════════════════════════════════════════════════════════════════════════

/** Formata número como dinheiro brasileiro abreviado. 18400 → "R$ 18.400" */
function fmtMoeda(v) {
  if (v == null) return '—';
  return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
}

/** Formata data ISO como "28/01/2026" */
function fmtData(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

/** Formata datetime ISO como "28/04 06:00" */
function fmtDataHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${dia} ${hora}`;
}

/** Calcula dias entre uma data e hoje (positivo = passou). */
function diasDesde(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const hoje = new Date();
  return Math.floor((hoje - d) / 86400000);
}

/** Calcula dias até uma data (positivo = futuro). */
function diasAte(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const hoje = new Date();
  return Math.ceil((d - hoje) / 86400000);
}

/** Pega o nome de display de um cliente. */
function nomeCliente(c) {
  return c.apelido || (c.razao_social || '').split(' ').slice(0, 3).join(' ') || c.nome_fantasia || 'Cliente';
}

/** Estilo padrão de input em forms admin. */
const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: `1.5px solid ${palette.beige}`, fontFamily: FONT, fontSize: fz(15),
  color: palette.ink, outline: 'none', boxSizing: 'border-box', background: palette.surface,
};

/** Estilo de botão "Cancelar" em footers. */
const btnCancelar = {
  flex: 1, background: palette.surface, color: palette.inkSoft,
  border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '12px',
  fontSize: fz(16), cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
};

/** Estilo de botão primário do footer (cor configurável). */
function btnPrimario(cor, salvando = false) {
  return {
    flex: 2, background: salvando ? palette.beige : cor,
    color: palette.bg, border: 'none', borderRadius: 10, padding: '12px',
    fontSize: fz(16), fontWeight: 600, fontFamily: FONT,
    cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1,
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PromocoesScreen — Listagem de promoções ativas + histórico
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, onBack, onNovaPromocao, onEditarPromocao }
// Lê:    state.promocoes (ativas) + handleLoadPromocoesHistorico (sob demanda)
// Conta: usadaEm = quantas sugestões da carteira citam essa promoção
// Escreve: handlePausarPromocao
// ═══════════════════════════════════════════════════════════════════════════

export const PromocoesScreen = ({ lojas, onBack, onNovaPromocao, onEditarPromocao }) => {
  const { state, handlePausarPromocao, handleLoadPromocoesHistorico } = lojas;
  const ativas = state.promocoes || [];

  const [historico, setHistorico] = useState([]);
  const [showHistorico, setShowHistorico] = useState(false);
  const [carregandoHist, setCarregandoHist] = useState(false);
  const [pausandoId, setPausandoId] = useState(null);

  // Carrega histórico sob demanda quando expande
  useEffect(() => {
    if (!showHistorico || historico.length > 0) return;
    setCarregandoHist(true);
    handleLoadPromocoesHistorico(20)
      .then(setHistorico)
      .catch(e => {
        console.error('[Lojas] erro carregar histórico promoções', e);
        setHistorico([]);
      })
      .finally(() => setCarregandoHist(false));
  }, [showHistorico]);

  // Conta quantas sugestões hoje citam a promoção (aproximação: id no contexto JSON)
  const usadaEm = useCallback((promocaoId) => {
    return (state.sugestoesHoje || []).filter(s => {
      const ctx = s.contexto_dados || s.contexto || {};
      // sugestões podem citar promoção via id ou nome
      if (ctx.promocao_id === promocaoId) return true;
      if (Array.isArray(ctx.promocoes_aplicaveis)) {
        return ctx.promocoes_aplicaveis.some(p => p.id === promocaoId || p === promocaoId);
      }
      return false;
    }).length;
  }, [state.sugestoesHoje]);

  const pausar = async (p) => {
    if (!confirm(`Pausar a promoção "${p.nome_curto}"?`)) return;
    setPausandoId(p.id);
    try {
      await handlePausarPromocao(p.id);
    } catch (e) {
      alert('Erro ao pausar: ' + e.message);
    } finally {
      setPausandoId(null);
    }
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title="Promoções"
        subtitle={`${ativas.length} ativa${ativas.length !== 1 ? 's' : ''} · ${historico.length} no histórico`}
        onBack={onBack}
        rightContent={
          <button onClick={onNovaPromocao} style={{
            background: palette.warn, border: 'none', color: palette.bg,
            padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4, fontSize: fz(14),
            fontFamily: FONT, fontWeight: 600,
          }}>
            <Plus size={sz(16)} /> Nova
          </button>
        }
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>

        <SectionTitle icon={Gift}>Ativas ({ativas.length})</SectionTitle>

        {ativas.length === 0 && (
          <div style={{
            padding: 24, textAlign: 'center', color: palette.inkMuted,
            fontSize: fz(15), marginBottom: 16, background: palette.surface,
            border: `1px dashed ${palette.beige}`, borderRadius: 10, lineHeight: 1.5,
          }}>
            <Gift size={sz(41)} color={palette.inkMuted} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
            Nenhuma promoção ativa no momento.<br/>
            Crie uma pra IA usar nas sugestões!
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {ativas.map(p => {
            const diasRestantes = diasAte(p.data_fim);
            const usada = usadaEm(p.id);
            const pausando = pausandoId === p.id;

            return (
              <div key={p.id} style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderLeft: `4px solid ${palette.warn}`, borderRadius: 12, padding: 14,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <Gift size={sz(21)} color={palette.warn} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink, marginBottom: 2 }}>
                      {p.nome_curto}
                    </div>
                    <div style={{ fontSize: fz(14), color: palette.inkSoft, lineHeight: 1.5 }}>
                      {p.descricao_completa}
                    </div>
                  </div>
                </div>

                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '10px 0',
                  borderTop: `1px solid ${palette.beigeSoft}`, marginTop: 8,
                }}>
                  <div>
                    <div style={{ fontSize: fz(12), color: palette.inkMuted, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                      Vigência
                    </div>
                    <div style={{ fontSize: fz(14), color: palette.ink, fontWeight: 600, marginTop: 2 }}>
                      Até {fmtData(p.data_fim)}{' '}
                      <span style={{
                        color: diasRestantes != null && diasRestantes < 5 ? palette.alert : palette.inkSoft,
                        fontWeight: 400, fontSize: fz(13),
                      }}>
                        ({diasRestantes != null ? diasRestantes + 'd' : '—'})
                      </span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: fz(12), color: palette.inkMuted, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                      Categoria
                    </div>
                    <div style={{ fontSize: fz(14), color: palette.ink, fontWeight: 600, marginTop: 2 }}>
                      {p.categoria || 'todos'}
                    </div>
                  </div>
                  {p.desconto_pct != null && (
                    <div>
                      <div style={{ fontSize: fz(12), color: palette.inkMuted, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                        Desconto
                      </div>
                      <div style={{ fontSize: fz(14), color: palette.ink, fontWeight: 600, marginTop: 2 }}>
                        {p.desconto_pct}%
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: fz(12), color: palette.inkMuted, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                      Usada em
                    </div>
                    <div style={{ fontSize: fz(14), color: palette.accent, fontWeight: 600, marginTop: 2 }}>
                      {usada} sugest{usada === 1 ? 'ão' : 'ões'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={() => onEditarPromocao(p)} style={{
                    flex: 1, background: palette.surface, color: palette.accent,
                    border: `1px solid ${palette.accent}40`, borderRadius: 6, padding: '8px',
                    fontSize: fz(14), cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}>
                    <Edit3 size={sz(14)} /> Editar
                  </button>
                  <button onClick={() => pausar(p)} disabled={pausando} style={{
                    flex: 1, background: palette.surface, color: palette.inkSoft,
                    border: `1px solid ${palette.beige}`, borderRadius: 6, padding: '8px',
                    fontSize: fz(14), cursor: pausando ? 'wait' : 'pointer',
                    fontFamily: FONT, fontWeight: 600, opacity: pausando ? 0.6 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}>
                    {pausando
                      ? <><Loader2 size={sz(14)} style={spinKeyframes} /> Pausando…</>
                      : <><Pause size={sz(14)} /> Pausar</>}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Toggle do histórico */}
        <button onClick={() => setShowHistorico(!showHistorico)} style={{
          width: '100%', background: 'transparent', border: `1px solid ${palette.beige}`,
          borderRadius: 10, padding: 12, cursor: 'pointer', fontFamily: FONT, fontSize: fz(15),
          color: palette.inkSoft,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Archive size={sz(16)} />
            Histórico {historico.length > 0 ? `(${historico.length})` : ''}
          </span>
          {showHistorico ? <ChevronUp size={sz(18)} /> : <ChevronDown size={sz(18)} />}
        </button>

        {showHistorico && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {carregandoHist && (
              <div style={{
                padding: 16, textAlign: 'center', color: palette.inkMuted, fontSize: fz(14),
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Loader2 size={sz(16)} style={spinKeyframes} /> Carregando…
              </div>
            )}
            {!carregandoHist && historico.length === 0 && (
              <div style={{
                padding: 16, textAlign: 'center', color: palette.inkMuted,
                fontSize: fz(14), fontStyle: 'italic',
              }}>
                Nenhuma promoção no histórico ainda.
              </div>
            )}
            {historico.map((p) => (
              <div key={p.id} style={{
                background: palette.beigeSoft, borderRadius: 8, padding: 10,
                fontSize: fz(14), color: palette.inkSoft,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
              }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.nome_curto}
                </span>
                <span style={{ fontSize: fz(13), color: palette.inkMuted, flexShrink: 0 }}>
                  expirou {fmtData(p.data_fim)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 2. NovaPromocaoScreen — Form de criar/editar promoção
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, promocaoExistente?, onBack, onSaved }
// Lê:    state.vendedoras (pra checkboxes UX)
// Escreve: handleSavePromocao
//
// ⚠️ Schema real:
//   - lojas_promocoes tem: nome_curto, descricao_completa, categoria,
//     data_inicio, data_fim, ativo, pedido_minimo, desconto_pct, criado_por
//   - NÃO tem: vendedoras_ids, tom_especifico
//   - vendedoras_ids: UI mantém pra UX, mas não persiste (TODO: criar coluna)
//   - tom_especifico: se preenchido, é concatenado em descricao_completa
// ═══════════════════════════════════════════════════════════════════════════

// IMPORTANTE: Field e Checkbox DECLARADOS NO MODULE LEVEL (fora do componente).
// Antes estavam dentro de NovaPromocaoScreen — a cada keystroke, o componente
// re-renderizava, criava um Field NOVO, e React desmontava+remontava o input
// → perdia foco a cada caractere digitado. Mover pra fora resolve.
const PromoField = ({ label, children, hint }) => (
  <div style={{ marginBottom: 14 }}>
    <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>{label}</div>
    {children}
    {hint && <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 4 }}>{hint}</div>}
  </div>
);

const PromoCheckbox = ({ checked, onChange, label }) => (
  <label style={{
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
    cursor: 'pointer', fontSize: fz(15), color: palette.ink,
  }}>
    <input type="checkbox" checked={checked} onChange={onChange}
      style={{ width: 16, height: 16, accentColor: palette.accent, cursor: 'pointer' }} />
    {label}
  </label>
);

export const NovaPromocaoScreen = ({ lojas, promocaoExistente = null, onBack, onSaved }) => {
  const { state, handleSavePromocao } = lojas;
  const ehEdicao = !!promocaoExistente;

  // Inicializa states com valores existentes (modo edit) ou padrões (modo criar)
  const [nome, setNome] = useState(promocaoExistente?.nome_curto || '');
  const [descricao, setDescricao] = useState(promocaoExistente?.descricao_completa || '');
  const [dataInicio, setDataInicio] = useState(
    promocaoExistente?.data_inicio || new Date().toISOString().slice(0, 10)
  );
  const [dataFim, setDataFim] = useState(promocaoExistente?.data_fim || '');
  const [pedidoMinimo, setPedidoMinimo] = useState(
    promocaoExistente?.pedido_minimo != null ? String(promocaoExistente.pedido_minimo) : ''
  );
  const [desconto, setDesconto] = useState(
    promocaoExistente?.desconto_pct != null ? String(promocaoExistente.desconto_pct) : ''
  );
  const [tom, setTom] = useState('');

  // Categorias (multi-select). Categoria salva como string única (do schema).
  const categoriaInicial = promocaoExistente?.categoria || '';
  const [categorias, setCategorias] = useState({
    linho: categoriaInicial.includes('linho'),
    viscolinho: categoriaInicial.includes('viscolinho'),
    alfaiataria: categoriaInicial.includes('alfaiataria'),
    plus: categoriaInicial.includes('plus'),
    todos: categoriaInicial === 'todos' || categoriaInicial === '',
  });

  // Vendedoras: UX só (não persiste). Padrão: todas marcadas.
  const vendedorasReais = (state.vendedoras || []).filter(
    v => v.ativa && !v.is_placeholder
  );
  const [vendedorasIds, setVendedorasIds] = useState(
    vendedorasReais.reduce((acc, v) => ({ ...acc, [v.id]: true }), {})
  );

  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (!nome.trim()) {
      alert('Preencha o nome curto da promoção');
      return;
    }
    if (!descricao.trim()) {
      alert('Preencha a descrição completa (a IA usa)');
      return;
    }
    if (!dataInicio || !dataFim) {
      alert('Preencha as datas de início e fim');
      return;
    }
    if (new Date(dataFim) < new Date(dataInicio)) {
      alert('A data fim deve ser depois da data início');
      return;
    }

    // Constrói categoria como string única (separada por vírgula se múltiplas)
    const categoriasMarcadas = Object.entries(categorias)
      .filter(([_, v]) => v)
      .map(([k]) => k);
    const categoriaStr = categoriasMarcadas.length === 0 || categorias.todos
      ? 'todos'
      : categoriasMarcadas.filter(c => c !== 'todos').join(',');

    // Concatena tom_especifico em descricao_completa se preenchido
    const descricaoFinal = tom.trim()
      ? `${descricao.trim()}\n\n[Tom da mensagem: ${tom.trim()}]`
      : descricao.trim();

    setSalvando(true);
    try {
      const payload = {
        nome_curto: nome.trim(),
        descricao_completa: descricaoFinal,
        categoria: categoriaStr,
        data_inicio: dataInicio,
        data_fim: dataFim,
        pedido_minimo: pedidoMinimo ? parseFloat(pedidoMinimo) : null,
        desconto_pct: desconto ? parseFloat(desconto) : null,
        ativo: true,
      };
      // Se for edit, preserva o id
      if (ehEdicao) payload.id = promocaoExistente.id;

      await handleSavePromocao(payload);
      onSaved();
    } catch (e) {
      alert('Erro ao salvar: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title={ehEdicao ? 'Editar promoção' : 'Nova promoção'}
        onBack={onBack}
      />
      <div style={{ padding: 16, paddingBottom: 100 }}>

        <PromoField label="Nome curto (vendedora vê)">
          <input value={nome} onChange={e => setNome(e.target.value)}
            placeholder="Ex: Linho 20% off" style={inputStyle} />
        </PromoField>

        <PromoField label="Descrição completa (IA usa)" hint="Quanto mais detalhada, melhores as mensagens">
          <textarea value={descricao} onChange={e => setDescricao(e.target.value)}
            placeholder="Ex: Toda peça de linho com 20% de desconto. Pedido mínimo R$ 800. Pode combinar com frete grátis."
            rows={4}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: FONT }} />
        </PromoField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <PromoField label="Início">
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} style={inputStyle} />
          </PromoField>
          <PromoField label="Fim">
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} style={inputStyle} />
          </PromoField>
        </div>

        <PromoField label="Categorias">
          <div style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 8, padding: '4px 12px',
          }}>
            {[
              { key: 'linho', label: 'Linho' },
              { key: 'viscolinho', label: 'Viscolinho' },
              { key: 'alfaiataria', label: 'Alfaiataria' },
              { key: 'plus', label: 'Plus size' },
              { key: 'todos', label: 'Todos' },
            ].map(c => (
              <PromoCheckbox key={c.key} checked={categorias[c.key]}
                onChange={() => setCategorias({ ...categorias, [c.key]: !categorias[c.key] })}
                label={c.label} />
            ))}
          </div>
        </PromoField>

        <PromoField label="Vendedoras participantes" hint="Padrão: todas. (Por enquanto não persiste — todas vendedoras participam)">
          <div style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 8, padding: '4px 12px',
          }}>
            {vendedorasReais.length === 0 && (
              <div style={{ fontSize: fz(14), color: palette.inkMuted, padding: 8, fontStyle: 'italic' }}>
                Nenhuma vendedora cadastrada.
              </div>
            )}
            {vendedorasReais.map(v => (
              <PromoCheckbox key={v.id} checked={!!vendedorasIds[v.id]}
                onChange={() => setVendedorasIds({ ...vendedorasIds, [v.id]: !vendedorasIds[v.id] })}
                label={`${v.nome} (${v.loja})`} />
            ))}
          </div>
        </PromoField>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <PromoField label="Pedido mínimo (R$)" hint="Opcional">
            <input type="number" value={pedidoMinimo} onChange={e => setPedidoMinimo(e.target.value)}
              placeholder="Ex: 800" style={inputStyle} />
          </PromoField>
          <PromoField label="% de desconto" hint="Opcional">
            <input type="number" value={desconto} onChange={e => setDesconto(e.target.value)}
              placeholder="Ex: 20" style={inputStyle} />
          </PromoField>
        </div>

        <PromoField label="Tom da mensagem (opcional)" hint="Diretrizes específicas pra essa promoção. Vai pro briefing da IA.">
          <textarea value={tom} onChange={e => setTom(e.target.value)}
            placeholder="Ex: Mais empolgado, criando urgência porque é por tempo limitado"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: FONT }} />
        </PromoField>
      </div>

      {/* Footer fixo */}
      <div style={{
        position: 'sticky', bottom: 0, background: palette.surface,
        borderTop: `1px solid ${palette.beige}`, padding: 12,
        display: 'flex', gap: 8, boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
      }}>
        <button onClick={onBack} disabled={salvando} style={btnCancelar}>Cancelar</button>
        <button onClick={salvar} disabled={salvando} style={btnPrimario(palette.warn, salvando)}>
          {salvando
            ? <><Loader2 size={sz(17)} style={spinKeyframes} /> Salvando…</>
            : <><Save size={sz(17)} /> {ehEdicao ? 'Salvar alterações' : 'Salvar promoção'}</>}
        </button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 3. RegrasScreen — Configuração de tom + regras IA
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, onBack }
// Lê:    lojas_config (via handleLoadConfig)
// Escreve: lojas_config (via handleSaveConfig por chave)
//
// Chaves usadas:
//   regras_ia.tom_geral, regras_ia.posicionamento, regras_ia.sempre, regras_ia.nunca
//   parametros.desconto_reativacao, parametros.desconto_atencao
//   parametros.saudacao_padrao, parametros.fechamento_padrao
// ═══════════════════════════════════════════════════════════════════════════

export const RegrasScreen = ({ lojas, onBack }) => {
  const { handleLoadConfig, handleSaveConfig } = lojas;

  // Defaults — alinhados ao tom do LojasInstrucoes (vc, sem "imperdível", etc)
  const TOM_PADRAO = 'Acolhedor mas profissional. Tratar a cliente como parceira (atacado), não consumidora final. Usar "vc" (não "você"). Mensagens entre 3 e 5 linhas. Emoji com moderação (1 por mensagem, no máximo).';
  const POSICIONAMENTO_PADRAO = 'Fabricação própria em São Paulo, com loja no Bom Retiro e no Brás. Foco em linho, viscolinho e alfaiataria. Modelagem como diferencial (todas as peças totalmente forradas).';
  const SEMPRE_PADRAO = [
    'Mencionar peça específica (REF + descrição)',
    'Usar dados reais (nunca inventar)',
    'Terminar com pergunta aberta',
    'Mensagens entre 3 e 5 linhas',
    'Tratar por "vc"',
  ];
  const NUNCA_PADRAO = [
    'Prometer prazo de entrega',
    'Falar de preço sem ter promoção',
    'Usar "incrível", "imperdível", "sensacional"',
    'Mandar mensagem sem fato concreto',
    'Sugerir bojo (nenhuma peça tem)',
  ];

  const [tom, setTom] = useState(TOM_PADRAO);
  const [posicionamento, setPosicionamento] = useState(POSICIONAMENTO_PADRAO);
  const [sempre, setSempre] = useState(SEMPRE_PADRAO);
  const [nunca, setNunca] = useState(NUNCA_PADRAO);
  const [novoSempre, setNovoSempre] = useState('');
  const [novoNunca, setNovoNunca] = useState('');
  const [descontoReat, setDescontoReat] = useState('10');
  const [descontoAten, setDescontoAten] = useState('5');
  const [saudacao, setSaudacao] = useState('Oi {nome}, tudo bem?');
  const [fechamento, setFechamento] = useState('Quer que eu te mande foto?');

  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [salvouOk, setSalvouOk] = useState(false);

  // Tracking: quais chaves estao SALVAS no banco (vs apenas default visual)
  // Ailson 07/05/2026: descoberto que admin nunca clicou 'Salvar' achando
  // que defaults estavam ativos. IA estava rodando sem regras customizadas
  // por semanas. Esse mapa indica visualmente o estado real.
  const [salvoMap, setSalvoMap] = useState({});

  // Carrega config existente do banco
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const config = await handleLoadConfig();
        if (cancelado) return;
        const novoSalvo = {};
        if (config['regras_ia.tom_geral'] != null) {
          setTom(String(config['regras_ia.tom_geral']));
          novoSalvo['tom_geral'] = true;
        }
        if (config['regras_ia.posicionamento'] != null) {
          setPosicionamento(String(config['regras_ia.posicionamento']));
          novoSalvo['posicionamento'] = true;
        }
        if (Array.isArray(config['regras_ia.sempre'])) {
          setSempre(config['regras_ia.sempre']);
          novoSalvo['sempre'] = true;
        }
        if (Array.isArray(config['regras_ia.nunca'])) {
          setNunca(config['regras_ia.nunca']);
          novoSalvo['nunca'] = true;
        }
        if (config['parametros.desconto_reativacao'] != null) {
          setDescontoReat(String(config['parametros.desconto_reativacao']));
          novoSalvo['desconto_reat'] = true;
        }
        if (config['parametros.desconto_atencao'] != null) {
          setDescontoAten(String(config['parametros.desconto_atencao']));
          novoSalvo['desconto_aten'] = true;
        }
        if (config['parametros.saudacao_padrao'] != null) {
          setSaudacao(String(config['parametros.saudacao_padrao']));
          novoSalvo['saudacao'] = true;
        }
        if (config['parametros.fechamento_padrao'] != null) {
          setFechamento(String(config['parametros.fechamento_padrao']));
          novoSalvo['fechamento'] = true;
        }
        setSalvoMap(novoSalvo);
      } catch (e) {
        console.error('[Lojas] erro carregar config', e);
        // Mantém defaults
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  const salvar = async () => {
    setSalvando(true);
    setSalvouOk(false);
    try {
      await Promise.all([
        handleSaveConfig('regras_ia.tom_geral', tom),
        handleSaveConfig('regras_ia.posicionamento', posicionamento),
        handleSaveConfig('regras_ia.sempre', sempre),
        handleSaveConfig('regras_ia.nunca', nunca),
        handleSaveConfig('parametros.desconto_reativacao', parseFloat(descontoReat) || 0),
        handleSaveConfig('parametros.desconto_atencao', parseFloat(descontoAten) || 0),
        handleSaveConfig('parametros.saudacao_padrao', saudacao),
        handleSaveConfig('parametros.fechamento_padrao', fechamento),
      ]);
      // Apos salvar, todos os campos viram 'salvo'
      setSalvoMap({
        tom_geral: true, posicionamento: true, sempre: true, nunca: true,
        desconto_reat: true, desconto_aten: true, saudacao: true, fechamento: true,
      });
      setSalvouOk(true);
      setTimeout(() => setSalvouOk(false), 2500);
    } catch (e) {
      alert('Erro ao salvar: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  // Helper: badge de status de salvamento por campo
  const StatusBadge = ({ campo }) => {
    if (carregando) return null;
    const salvo = salvoMap[campo];
    return (
      <span style={{
        display: 'inline-block',
        marginLeft: 8,
        fontSize: fz(11),
        padding: '2px 8px',
        borderRadius: 10,
        fontWeight: 600,
        background: salvo ? '#eafbf0' : '#fff3cd',
        color: salvo ? '#1e7e34' : '#856404',
        border: `1px solid ${salvo ? '#c3e6cb' : '#ffeeba'}`,
      }}>
        {salvo ? '✓ Ativo na IA' : '⚠ Só default — não salvou'}
      </span>
    );
  };

  // Verifica se NADA foi salvo (todos os campos estao em default)
  const nadaSalvo = !carregando && Object.keys(salvoMap).length === 0;

  // Sub-componente reutilizado pra "Sempre" e "Nunca"
  const ListaRegras = ({ items, onAdd, onRemove, novoValor, setNovoValor, placeholder, cor }) => (
    <div style={{
      background: palette.surface, border: `1px solid ${palette.beige}`,
      borderRadius: 10, padding: 10,
    }}>
      {items.length === 0 && (
        <div style={{ fontSize: fz(14), color: palette.inkMuted, padding: 6, fontStyle: 'italic' }}>
          Nenhuma regra. Adicione abaixo.
        </div>
      )}
      {items.map((item, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
          borderBottom: i < items.length - 1 ? `1px solid ${palette.beigeSoft}` : 'none',
        }}>
          <span style={{ color: cor, marginTop: 1 }}>•</span>
          <span style={{ flex: 1, fontSize: fz(15), color: palette.ink }}>{item}</span>
          <button onClick={() => onRemove(i)} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            padding: 4, display: 'flex',
          }}>
            <Trash2 size={sz(16)} color={palette.inkMuted} />
          </button>
        </div>
      ))}
      <div style={{
        display: 'flex', gap: 6, marginTop: 8, paddingTop: 8,
        borderTop: `1px solid ${palette.beigeSoft}`,
      }}>
        <input value={novoValor} onChange={e => setNovoValor(e.target.value)}
          placeholder={placeholder}
          onKeyDown={e => {
            if (e.key === 'Enter' && novoValor.trim()) {
              onAdd(novoValor.trim());
              setNovoValor('');
            }
          }}
          style={{ ...inputStyle, fontSize: fz(14), padding: '6px 8px' }} />
        <button onClick={() => {
          if (novoValor.trim()) {
            onAdd(novoValor.trim());
            setNovoValor('');
          }
        }} style={{
          background: cor, color: palette.bg, border: 'none', borderRadius: 6,
          padding: '6px 10px', cursor: 'pointer',
          display: 'flex', alignItems: 'center',
        }}>
          <Plus size={sz(16)} />
        </button>
      </div>
    </div>
  );

  if (carregando) {
    return (
      <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
        <Header title="Regras gerais" onBack={onBack} />
        <div style={{
          padding: 40, textAlign: 'center', color: palette.inkMuted, fontSize: fz(15),
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Loader2 size={sz(18)} style={spinKeyframes} /> Carregando configurações…
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title="Regras gerais"
        onBack={onBack}
        rightContent={
          <button onClick={salvar} disabled={salvando} style={{
            background: salvouOk ? palette.ok : palette.accent, border: 'none', color: palette.bg,
            padding: '6px 12px', borderRadius: 8, cursor: salvando ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 4, fontSize: fz(14),
            fontFamily: FONT, fontWeight: 600,
            opacity: salvando ? 0.7 : 1,
          }}>
            {salvando
              ? <><Loader2 size={sz(16)} style={spinKeyframes} /> Salvando…</>
              : salvouOk
                ? <><Check size={sz(16)} /> Salvo!</>
                : <><Save size={sz(16)} /> Salvar</>}
          </button>
        }
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>

        <SectionTitle icon={Bot}>Identidade da marca</SectionTitle>
        {nadaSalvo && (
          <div style={{
            background: '#fff3cd',
            border: '1.5px solid #ffc107',
            borderRadius: 10,
            padding: 14,
            marginBottom: 16,
            fontSize: fz(14),
            color: '#856404',
            lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>⚠ Nenhuma regra está ativa na IA</div>
            Os textos abaixo são <strong>defaults visuais</strong> — você nunca clicou em "Salvar".
            A IA está rodando apenas com o prompt fixo do sistema.
            <br/>
            <strong>Revise e clique em "Salvar configurações" no fim da página</strong> pra que a IA passe a usar essas regras.
          </div>
        )}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Tom de comunicação <StatusBadge campo="tom_geral" />
          </div>
          <textarea value={tom} onChange={e => setTom(e.target.value)} rows={4}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: FONT }} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Posicionamento <StatusBadge campo="posicionamento" />
          </div>
          <textarea value={posicionamento} onChange={e => setPosicionamento(e.target.value)} rows={3}
            style={{ ...inputStyle, resize: 'vertical', fontFamily: FONT }} />
        </div>

        <SectionTitle icon={CheckCircle2}>A IA sempre deve <StatusBadge campo="sempre" /></SectionTitle>
        <div style={{ marginBottom: 24 }}>
          <ListaRegras items={sempre}
            onAdd={(v) => setSempre([...sempre, v])}
            onRemove={(i) => setSempre(sempre.filter((_, j) => j !== i))}
            novoValor={novoSempre} setNovoValor={setNovoSempre}
            placeholder="Adicionar regra…" cor={palette.ok} />
        </div>

        <SectionTitle icon={AlertCircle}>A IA nunca deve <StatusBadge campo="nunca" /></SectionTitle>
        <div style={{ marginBottom: 24 }}>
          <ListaRegras items={nunca}
            onAdd={(v) => setNunca([...nunca, v])}
            onRemove={(i) => setNunca(nunca.filter((_, j) => j !== i))}
            novoValor={novoNunca} setNovoValor={setNovoNunca}
            placeholder="Adicionar regra…" cor={palette.alert} />
        </div>

        <SectionTitle icon={Settings}>Parâmetros padrão</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
              Desconto reativação <StatusBadge campo="desconto_reat" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" value={descontoReat}
                onChange={e => setDescontoReat(e.target.value)} style={inputStyle} />
              <span style={{ fontSize: fz(16), color: palette.inkSoft }}>%</span>
            </div>
            <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 4 }}>
              Cliente +3M
            </div>
          </div>
          <div>
            <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
              Desconto atenção <StatusBadge campo="desconto_aten" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" value={descontoAten}
                onChange={e => setDescontoAten(e.target.value)} style={inputStyle} />
              <span style={{ fontSize: fz(16), color: palette.inkSoft }}>%</span>
            </div>
            <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 4 }}>
              Cliente 45-90 dias
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Saudação padrão <StatusBadge campo="saudacao" />
          </div>
          <input value={saudacao} onChange={e => setSaudacao(e.target.value)} style={inputStyle} />
          <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 4 }}>
            Use {'{nome}'} pra placeholder do nome do cliente
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Fechamento padrão <StatusBadge campo="fechamento" />
          </div>
          <input value={fechamento} onChange={e => setFechamento(e.target.value)} style={inputStyle} />
        </div>

        <div style={{
          marginTop: 16, padding: 12, background: palette.beigeSoft,
          borderRadius: 10, fontSize: fz(13), color: palette.inkSoft, lineHeight: 1.5,
        }}>
          ℹ️ Essas regras alimentam o prompt da IA. Quanto mais específico, melhor a aderência.
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 4. VendedorasAdminScreen — Lista ativas + ex-vendedoras
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, onBack, onNovaVendedora, onEditarVendedora }
// Lê:    state.vendedoras (ativas) + query separada de inativas
// Escreve: handleInativarVendedora
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// EstiloIAInline — painel de estilo IA por vendedora (admin)
// Sessao Ailson 07/05/2026.
// ═══════════════════════════════════════════════════════════════════════════
// Responsavel por:
//   - Mostrar perfil de estilo agregado (qtd edicoes, ultima edicao)
//   - Botao "Analisar com IA" (gera analise textual)
//   - Mostrar analise quando ja existe (texto livre + estruturado)
//   - Definir vendedora referencia ("aprende com X")
//   - Mostrar quem aprende dela (aprendizes)
const EstiloIAInline = ({ vendedora, estilo, todasVendedoras, estilosMap, userId, onAtualizar, onFechar }) => {
  const [analisando, setAnalisando] = useState(false);
  const [erroAnalise, setErroAnalise] = useState(null);
  const [salvandoRef, setSalvandoRef] = useState(false);

  const qtdEd = estilo?.qtd_edicoes || 0;
  const analise = estilo?.analise;
  const aprendeCom = estilo?.aprende_com;
  const aprendeComVendedora = aprendeCom ? todasVendedoras.find(x => x.id === aprendeCom) : null;
  const aprendizes = estilo?.aprendizes || [];

  const podeAnalisar = qtdEd >= 5;
  const possiveisRef = todasVendedoras.filter(x =>
    x.id !== vendedora.id && (estilosMap[x.id]?.qtd_edicoes || 0) >= 5
  );

  const analisar = async () => {
    setAnalisando(true);
    setErroAnalise(null);
    try {
      const r = await fetch('/api/lojas-analisar-estilo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId || '' },
        body: JSON.stringify({ vendedora_id: vendedora.id }),
      });
      const d = await r.json();
      if (!r.ok) {
        // Se veio raw (parse JSON falhou), mostra preview pra ajudar debug
        const msg = d.raw
          ? `${d.error}. IA respondeu: "${String(d.raw).slice(0, 150)}..."`
          : d.error || `HTTP ${r.status}`;
        setErroAnalise(msg);
      } else {
        await onAtualizar();
      }
    } catch (e) {
      setErroAnalise(e.message || String(e));
    } finally {
      setAnalisando(false);
    }
  };

  const salvarRef = async (refId) => {
    setSalvandoRef(true);
    try {
      const r = await fetch('/api/lojas-definir-aprende-com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId || '' },
        body: JSON.stringify({ vendedora_id: vendedora.id, aprende_com: refId || null }),
      });
      if (!r.ok) {
        const d = await r.json();
        alert('Erro: ' + (d.error || `HTTP ${r.status}`));
      } else {
        await onAtualizar();
      }
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setSalvandoRef(false);
    }
  };

  const fmtData = (s) => {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return s; }
  };

  const Pill = ({ children, color = '#7c4dff' }) => (
    <span style={{
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: 12,
      background: `${color}15`,
      color,
      fontSize: fz(12),
      fontWeight: 600,
      marginRight: 4,
      marginBottom: 4,
    }}>{children}</span>
  );

  return (
    <div style={{
      marginTop: 10, padding: 12,
      background: '#f7f4fa', borderRadius: 10,
      border: `1px solid #7c4dff30`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: fz(13), fontWeight: 700, color: '#7c4dff' }}>
          🎨 Estilo aprendido pela IA
        </div>
        <button onClick={onFechar} style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: fz(16), color: palette.inkMuted, padding: '0 4px',
        }}>×</button>
      </div>

      {/* Stats */}
      <div style={{ fontSize: fz(13), color: palette.inkSoft, marginBottom: 10 }}>
        <strong>{qtdEd}</strong> mensagem{qtdEd !== 1 ? 's' : ''} editada{qtdEd !== 1 ? 's' : ''}
        {estilo?.ultima_edicao_em && <> · última: {fmtData(estilo.ultima_edicao_em)}</>}
      </div>

      {/* Status de aprendizado */}
      {aprendeComVendedora && (
        <div style={{
          fontSize: fz(13), padding: 8, borderRadius: 6,
          background: '#fff3cd', color: '#856404', marginBottom: 10,
        }}>
          ↳ Está usando estilo de <strong>{aprendeComVendedora.nome}</strong>.
          Edições próprias estão pausadas (não atualizam contadores).
        </div>
      )}
      {aprendizes.length > 0 && (
        <div style={{
          fontSize: fz(13), padding: 8, borderRadius: 6,
          background: '#fff8e1', color: '#7d5a00', marginBottom: 10,
        }}>
          ⭐ É referência de: <strong>{aprendizes.map(a => a.nome).join(', ')}</strong>
        </div>
      )}

      {/* Botão analisar */}
      {!analise && (
        <div style={{ marginBottom: 10 }}>
          {!podeAnalisar ? (
            <div style={{ fontSize: fz(13), color: palette.inkMuted, fontStyle: 'italic' }}>
              Mínimo 5 edições pra análise IA. {qtdEd === 0 ? 'Vendedora ainda não editou nenhuma mensagem.' : `Faltam ${5 - qtdEd}.`}
            </div>
          ) : (
            <button
              onClick={analisar}
              disabled={analisando}
              style={{
                background: '#7c4dff', color: 'white', border: 'none',
                borderRadius: 6, padding: '8px 14px',
                fontSize: fz(14), cursor: analisando ? 'wait' : 'pointer',
                fontFamily: FONT, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              {analisando
                ? <><Loader2 size={sz(14)} style={spinKeyframes} /> Analisando…</>
                : <>🔍 Analisar estilo com IA (custo ~R$0,10)</>}
            </button>
          )}
          {erroAnalise && (
            <div style={{ marginTop: 6, fontSize: fz(13), color: palette.alert }}>
              {erroAnalise}
            </div>
          )}
        </div>
      )}

      {/* Análise existente */}
      {analise && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.ink }}>
              📖 Análise da IA
            </div>
            <button
              onClick={analisar}
              disabled={analisando}
              style={{
                background: 'transparent', border: `1px solid #7c4dff40`,
                color: '#7c4dff', borderRadius: 4, padding: '3px 8px',
                fontSize: fz(11), cursor: analisando ? 'wait' : 'pointer',
                fontFamily: FONT, fontWeight: 600,
              }}
            >
              {analisando ? '…' : '↻ Regerar'}
            </button>
          </div>
          <div style={{ fontSize: fz(12), color: palette.inkMuted, marginBottom: 8 }}>
            Gerada em {fmtData(analise.geradoEm)} · {analise.qtd_edicoes_analisadas} edições analisadas
          </div>

          {/* Texto livre */}
          {analise.texto_livre && (
            <div style={{
              fontSize: fz(14), color: palette.ink, lineHeight: 1.5,
              padding: 10, background: 'white', borderRadius: 6, marginBottom: 10,
              fontStyle: 'italic',
            }}>
              "{analise.texto_livre}"
            </div>
          )}

          {/* Estruturado expandível */}
          {analise.estruturado && (
            <details style={{ fontSize: fz(13) }}>
              <summary style={{ cursor: 'pointer', color: '#7c4dff', fontWeight: 600, marginBottom: 6 }}>
                Ver detalhes estruturados
              </summary>
              <div style={{ padding: 10, background: 'white', borderRadius: 6 }}>
                {analise.estruturado.tom_geral && (
                  <div style={{ marginBottom: 8 }}>
                    <strong>Tom geral:</strong> {analise.estruturado.tom_geral}
                  </div>
                )}
                {analise.estruturado.saudacoes_iniciais?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <strong>Saudações iniciais:</strong><br/>
                    {analise.estruturado.saudacoes_iniciais.map((s, i) => <Pill key={i}>{s}</Pill>)}
                  </div>
                )}
                {analise.estruturado.saudacoes_finais?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <strong>Fechamentos:</strong><br/>
                    {analise.estruturado.saudacoes_finais.map((s, i) => <Pill key={i}>{s}</Pill>)}
                  </div>
                )}
                {analise.estruturado.tratamentos?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <strong>Tratamentos:</strong><br/>
                    {analise.estruturado.tratamentos.map((s, i) => <Pill key={i}>{s}</Pill>)}
                  </div>
                )}
                {analise.estruturado.emojis_frequentes?.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <strong>Emojis:</strong> {analise.estruturado.emojis_frequentes.join(' ')}
                  </div>
                )}
                {analise.estruturado.padroes_de_edicao && (
                  <>
                    {analise.estruturado.padroes_de_edicao.adiciona?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <strong>Adiciona:</strong>
                        <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
                          {analise.estruturado.padroes_de_edicao.adiciona.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                    {analise.estruturado.padroes_de_edicao.remove?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <strong>Remove:</strong>
                        <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
                          {analise.estruturado.padroes_de_edicao.remove.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </div>
                    )}
                  </>
                )}
                {analise.estruturado.comprimento_medio && (
                  <div style={{ marginBottom: 8 }}>
                    <strong>Comprimento médio:</strong> {analise.estruturado.comprimento_medio}
                  </div>
                )}
                {analise.estruturado.linguagem?.length > 0 && (
                  <div>
                    <strong>Linguagem:</strong><br/>
                    {analise.estruturado.linguagem.map((s, i) => <Pill key={i} color={palette.accent}>{s}</Pill>)}
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Definir vendedora referência */}
      <div style={{
        borderTop: `1px solid ${palette.beige}`, paddingTop: 10, marginTop: 10,
        fontSize: fz(13),
      }}>
        <div style={{ marginBottom: 6, fontWeight: 600, color: palette.ink }}>
          📥 Aprender estilo de outra vendedora
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={aprendeCom || ''}
            onChange={e => salvarRef(e.target.value || null)}
            disabled={salvandoRef}
            style={{
              padding: '6px 10px', borderRadius: 6,
              border: `1px solid ${palette.beige}`,
              fontSize: fz(13), fontFamily: FONT,
              background: palette.surface,
              cursor: salvandoRef ? 'wait' : 'pointer',
              flex: 1, minWidth: 0,
            }}
          >
            <option value="">— usar estilo próprio —</option>
            {possiveisRef.map(x => (
              <option key={x.id} value={x.id}>
                {x.nome} ({x.loja}) · {estilosMap[x.id]?.qtd_edicoes || 0} edições
              </option>
            ))}
          </select>
          {salvandoRef && <Loader2 size={sz(14)} style={spinKeyframes} />}
        </div>
        {possiveisRef.length === 0 && (
          <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 4, fontStyle: 'italic' }}>
            Nenhuma outra vendedora tem 5+ edições ainda.
          </div>
        )}
      </div>
    </div>
  );
};


export const VendedorasAdminScreen = ({ lojas, onBack, onNovaVendedora, onEditarVendedora }) => {
  const { state, handleInativarVendedora, handleSalvarLinksVesti } = lojas;
  const ativas = (state.vendedoras || []).filter(v => v.ativa);

  const [inativas, setInativas] = useState([]);
  const [carregandoInat, setCarregandoInat] = useState(true);
  const [inativandoId, setInativandoId] = useState(null);
  // Qual vendedora está com painel Vesti aberto inline (null = nenhum)
  const [vestiAbertoId, setVestiAbertoId] = useState(null);
  // Qual vendedora está com painel Estilo IA aberto inline — Ailson 07/05/2026
  const [estiloAbertoId, setEstiloAbertoId] = useState(null);
  // Mapa de estilos { vendedora_id: {qtd_edicoes, analise, aprende_com, ...} }
  const [estilosMap, setEstilosMap] = useState({});
  const [carregandoEstilos, setCarregandoEstilos] = useState(false);

  const recarregarEstilos = useCallback(async () => {
    setCarregandoEstilos(true);
    try {
      const r = await fetch('/api/lojas-estilos-vendedoras', {
        headers: { 'X-User': lojas.state.userId || '' },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      const mapa = {};
      for (const v of d.vendedoras || []) mapa[v.id] = v;
      setEstilosMap(mapa);
    } catch (e) {
      console.warn('[estilos] erro carregar:', e?.message);
    } finally {
      setCarregandoEstilos(false);
    }
  }, [lojas.state.userId]);

  useEffect(() => { recarregarEstilos(); }, [recarregarEstilos]);

  // Carrega ex-vendedoras (inativas) sob demanda
  const recarregarInativas = useCallback(async () => {
    setCarregandoInat(true);
    try {
      const { data, error } = await supabase
        .from('lojas_vendedoras')
        .select('*')
        .eq('ativa', false)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setInativas(data || []);
    } catch (e) {
      console.error('[Lojas] erro carregar ex-vendedoras', e);
      setInativas([]);
    } finally {
      setCarregandoInat(false);
    }
  }, []);

  useEffect(() => {
    recarregarInativas();
  }, [recarregarInativas]);

  // Conta clientes da carteira por vendedora
  const qtdClientes = useCallback((vendedoraId) => {
    return (state.clientes || []).filter(c => c.vendedora_id === vendedoraId).length;
  }, [state.clientes]);

  // Status visual da vendedora baseado em qtd de clientes
  const statusVendedora = (qtd) => {
    if (qtd === 0) return 'arquivo';
    if (qtd < 20) return 'atencao';
    return 'ativo';
  };

  const inativar = async (v) => {
    if (!confirm(`Inativar "${v.nome}"? A carteira fica preservada — você pode transferir depois.`)) return;
    setInativandoId(v.id);
    try {
      await handleInativarVendedora(v.id);
      await recarregarInativas();
    } catch (e) {
      alert('Erro ao inativar: ' + (e.message || e));
    } finally {      setInativandoId(null);
    }
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title="Vendedoras"
        subtitle={`${ativas.length} ativa${ativas.length !== 1 ? 's' : ''} · ${inativas.length} ex`}
        onBack={onBack}
        rightContent={
          <button onClick={onNovaVendedora} style={{
            background: palette.ok, border: 'none', color: palette.bg,
            padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4, fontSize: fz(14),
            fontFamily: FONT, fontWeight: 600,
          }}>
            <Plus size={sz(16)} /> Nova
          </button>
        }
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>

        <SectionTitle icon={UserCog}>Ativas</SectionTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {ativas.length === 0 && (
            <div style={{
              padding: 20, textAlign: 'center', color: palette.inkMuted,
              fontSize: fz(15), background: palette.surface,
              border: `1px dashed ${palette.beige}`, borderRadius: 10,
            }}>
              Nenhuma vendedora cadastrada ainda.
            </div>
          )}

          {ativas.map(v => {
            const qtd = qtdClientes(v.id);
            const status = statusVendedora(qtd);
            const inativando = inativandoId === v.id;
            const ehPlaceholder = v.is_placeholder;

            return (
              <div key={v.id} style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 12, padding: 14,
                opacity: ehPlaceholder ? 0.7 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, background: palette.beigeSoft,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Users size={sz(23)} color={palette.inkSoft} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink }}>
                        {v.nome}
                      </span>
                      {v.is_padrao_loja && (
                        <span style={{
                          fontSize: fz(10), padding: '2px 6px', borderRadius: 4,
                          background: palette.warnSoft, color: palette.warn, fontWeight: 600,
                          letterSpacing: 0.3, textTransform: 'uppercase',
                        }}>⭐ Padrão</span>
                      )}
                      {ehPlaceholder && (
                        <span style={{
                          fontSize: fz(10), padding: '2px 6px', borderRadius: 4,
                          background: palette.beigeSoft, color: palette.inkMuted, fontWeight: 600,
                          letterSpacing: 0.3, textTransform: 'uppercase',
                        }}>Placeholder</span>
                      )}
                    </div>
                    <div style={{ fontSize: fz(14), color: palette.inkMuted }}>
                      {v.loja} · {qtd} cliente{qtd !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <StatusDot status={status} />
                </div>

                {/* Variantes / aliases */}
                {Array.isArray(v.aliases) && v.aliases.length > 0 && (
                  <div style={{
                    fontSize: fz(13), color: palette.inkSoft, padding: '8px 0',
                    borderTop: `1px solid ${palette.beigeSoft}`,
                  }}>
                    <div style={{ marginBottom: 6 }}>Variantes do nome no Miré:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {v.aliases.map((alias, i) => (
                        <span key={i} style={{
                          padding: '2px 8px', background: palette.beigeSoft, borderRadius: 4,
                          fontSize: fz(13), color: palette.ink,
                        }}>{alias}</span>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button onClick={() => onEditarVendedora(v)} style={{
                    flex: 1, background: palette.surface, color: palette.accent,
                    border: `1px solid ${palette.accent}40`, borderRadius: 6, padding: '8px',
                    fontSize: fz(14), cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}>
                    <Edit3 size={sz(14)} /> Editar
                  </button>
                  <button onClick={() => setVestiAbertoId(vestiAbertoId === v.id ? null : v.id)} style={{
                    flex: 1, background: vestiAbertoId === v.id ? palette.purple : palette.surface,
                    color: vestiAbertoId === v.id ? 'white' : palette.purple,
                    border: `1px solid ${palette.purple}40`, borderRadius: 6, padding: '8px',
                    fontSize: fz(14), cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}>
                    <Link2 size={sz(14)} /> Vesti{v.vesti_link_ativo ? ' ✓' : ''}
                  </button>
                  <button onClick={() => inativar(v)} disabled={inativando || ehPlaceholder} style={{
                    flex: 1, background: palette.surface, color: palette.inkSoft,
                    border: `1px solid ${palette.beige}`, borderRadius: 6, padding: '8px',
                    fontSize: fz(14),
                    cursor: ehPlaceholder ? 'not-allowed' : (inativando ? 'wait' : 'pointer'),
                    fontFamily: FONT, fontWeight: 600,
                    opacity: (inativando || ehPlaceholder) ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}>
                    {inativando
                      ? <><Loader2 size={sz(14)} style={spinKeyframes} /> …</>
                      : <><Pause size={sz(14)} /> Inativar</>}
                  </button>
                </div>

                {/* 2ª linha: Estilo IA — Ailson 07/05/2026 */}
                {(() => {
                  const e = estilosMap[v.id];
                  const qtdEd = e?.qtd_edicoes || 0;
                  const aprendeCom = e?.aprende_com;
                  const aprendizes = e?.aprendizes || [];
                  const ehRef = aprendizes.length > 0;
                  return (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button
                        onClick={() => setEstiloAbertoId(estiloAbertoId === v.id ? null : v.id)}
                        style={{
                          flex: 1,
                          background: estiloAbertoId === v.id ? '#7c4dff' : palette.surface,
                          color: estiloAbertoId === v.id ? 'white' : '#7c4dff',
                          border: `1px solid #7c4dff40`, borderRadius: 6, padding: '8px',
                          fontSize: fz(14), cursor: 'pointer', fontFamily: FONT, fontWeight: 600,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                          flexWrap: 'wrap',
                        }}
                      >
                        🎨 Estilo IA
                        {qtdEd > 0 && (
                          <span style={{
                            fontSize: fz(11), padding: '1px 6px', borderRadius: 8,
                            background: estiloAbertoId === v.id ? 'rgba(255,255,255,0.2)' : '#7c4dff20',
                            color: estiloAbertoId === v.id ? 'white' : '#7c4dff',
                          }}>
                            {qtdEd} ed
                          </span>
                        )}
                        {ehRef && <span style={{ fontSize: fz(12) }}>⭐</span>}
                        {aprendeCom && <span style={{ fontSize: fz(12) }}>↳</span>}
                      </button>
                    </div>
                  );
                })()}

                {/* Painel Vesti inline */}
                {vestiAbertoId === v.id && (
                  <VestiLinksInline
                    vendedora={v}
                    onSalvar={handleSalvarLinksVesti}
                    onFechar={() => setVestiAbertoId(null)}
                  />
                )}

                {/* Painel Estilo IA inline — Ailson 07/05/2026 */}
                {estiloAbertoId === v.id && (
                  <EstiloIAInline
                    vendedora={v}
                    estilo={estilosMap[v.id]}
                    todasVendedoras={ativas}
                    estilosMap={estilosMap}
                    userId={lojas.state.userId}
                    onAtualizar={recarregarEstilos}
                    onFechar={() => setEstiloAbertoId(null)}
                  />
                )}
              </div>
            );
          })}
        </div>

        {(inativas.length > 0 || carregandoInat) && (
          <>
            <SectionTitle icon={Archive}>Inativas / ex-vendedoras</SectionTitle>
            {carregandoInat && (
              <div style={{
                padding: 16, textAlign: 'center', color: palette.inkMuted, fontSize: fz(14),
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Loader2 size={sz(16)} style={spinKeyframes} /> Carregando…
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {inativas.map(v => (
                <div key={v.id} style={{
                  background: palette.beigeSoft, borderRadius: 10, padding: 12,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <Archive size={sz(18)} color={palette.archive} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink }}>{v.nome}</div>
                    <div style={{ fontSize: fz(13), color: palette.inkSoft }}>
                      Saiu: {fmtData(v.updated_at)} · Loja {v.loja}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. NovaVendedoraScreen — Form de cadastrar/editar vendedora
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, vendedoraExistente?, onBack, onSaved }
// Lê:    inativas (pra "herdar carteira de")
// Escreve: handleSaveVendedora + handleTransferirEmMassa (se herdar)
// ═══════════════════════════════════════════════════════════════════════════

export const NovaVendedoraScreen = ({ lojas, vendedoraExistente = null, onBack, onSaved }) => {
  const { handleSaveVendedora, handleTransferirEmMassa } = lojas;
  const ehEdicao = !!vendedoraExistente;

  const [nome, setNome] = useState(vendedoraExistente?.nome || '');
  const [loja, setLoja] = useState(vendedoraExistente?.loja || 'Bom Retiro');
  const [variantes, setVariantes] = useState(
    Array.isArray(vendedoraExistente?.aliases) && vendedoraExistente.aliases.length > 0
      ? vendedoraExistente.aliases
      : ['']
  );
  const [email, setEmail] = useState(vendedoraExistente?.user_id || '');
  const [herda, setHerda] = useState({});

  const [inativas, setInativas] = useState([]);
  const [salvando, setSalvando] = useState(false);

  // Carrega ex-vendedoras pra opção de herdar carteira (apenas em modo criar)
  useEffect(() => {
    if (ehEdicao) return; // edição não permite herdar
    (async () => {
      try {
        const { data } = await supabase
          .from('lojas_vendedoras')
          .select('*')
          .eq('ativa', false)
          .order('updated_at', { ascending: false });
        setInativas(data || []);
      } catch (e) {
        console.error('[Lojas] erro carregar inativas', e);
      }
    })();
  }, [ehEdicao]);

  const salvar = async () => {
    if (!nome.trim()) {
      alert('Preencha o nome principal');
      return;
    }
    const aliasesValidos = variantes
      .map(v => v.trim())
      .filter(v => v.length > 0)
      .map(v => v.toUpperCase()); // padrão do schema: aliases em UPPERCASE

    setSalvando(true);
    try {
      const payload = {
        nome: nome.trim(),
        loja,
        ativa: true,
        is_placeholder: false,
        aliases: aliasesValidos,
        user_id: email.trim() || null,
      };
      if (ehEdicao) {
        payload.id = vendedoraExistente.id;
        // Preserva campos importantes
        if (vendedoraExistente.is_padrao_loja !== undefined) payload.is_padrao_loja = vendedoraExistente.is_padrao_loja;
        if (vendedoraExistente.ordem_display !== undefined) payload.ordem_display = vendedoraExistente.ordem_display;
      }

      const saved = await handleSaveVendedora(payload);

      // Se herdar carteira, transferir em massa de cada origem
      if (!ehEdicao) {
        const idsAHerdar = Object.entries(herda).filter(([_, v]) => v).map(([k]) => k);
        for (const origemId of idsAHerdar) {
          await handleTransferirEmMassa(origemId, saved.id, 'heranca_nova_vendedora');
        }
      }

      onSaved();
    } catch (e) {
      alert('Erro ao salvar: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title={ehEdicao ? 'Editar vendedora' : 'Nova vendedora'}
        onBack={onBack}
      />
      <div style={{ padding: 16, paddingBottom: 100 }}>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Nome principal
          </div>
          <input value={nome} onChange={e => setNome(e.target.value)}
            placeholder="Ex: Luna" style={inputStyle} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Loja
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {['Silva Teles', 'Bom Retiro'].map(l => (
              <button key={l} onClick={() => setLoja(l)} style={{
                flex: 1, padding: '10px',
                background: loja === l ? palette.accent : palette.surface,
                color: loja === l ? palette.bg : palette.ink,
                border: `1.5px solid ${loja === l ? palette.accent : palette.beige}`,
                borderRadius: 8, fontFamily: FONT, fontSize: fz(15), fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>{l}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Variantes do nome no Miré
          </div>
          <div style={{ fontSize: fz(12), color: palette.inkMuted, marginBottom: 6 }}>
            Como o nome aparece nos relatórios. Use mais de uma se houver inconsistência (vão ser salvas em maiúsculas).
          </div>
          {variantes.map((v, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={v} onChange={e => {
                const nv = [...variantes]; nv[i] = e.target.value; setVariantes(nv);
              }} placeholder={i === 0 ? 'Ex: LUNA' : 'Ex: LUNA BR'} style={inputStyle} />
              {variantes.length > 1 && (
                <button onClick={() => setVariantes(variantes.filter((_, j) => j !== i))} style={{
                  background: palette.surface, border: `1px solid ${palette.beige}`,
                  borderRadius: 6, padding: 8, cursor: 'pointer', display: 'flex',
                }}>
                  <Trash2 size={sz(16)} color={palette.inkMuted} />
                </button>
              )}
            </div>
          ))}
          <button onClick={() => setVariantes([...variantes, ''])} style={{
            background: 'transparent', border: `1px dashed ${palette.beige}`,
            borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontFamily: FONT,
            fontSize: fz(14), color: palette.inkSoft,
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Plus size={sz(14)} /> Adicionar variante
          </button>
        </div>

        {/* Herdar carteira (só em modo criar) */}
        {!ehEdicao && inativas.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
              Herdar carteira de
            </div>
            <div style={{
              background: palette.surface, border: `1px solid ${palette.beige}`,
              borderRadius: 8, padding: '4px 12px',
            }}>
              {inativas.map(v => (
                <label key={v.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                  cursor: 'pointer', fontSize: fz(15), color: palette.ink,
                  borderBottom: `1px solid ${palette.beigeSoft}`,
                }}>
                  <input type="checkbox" checked={!!herda[v.id]}
                    onChange={() => setHerda({ ...herda, [v.id]: !herda[v.id] })}
                    style={{ width: 16, height: 16, accentColor: palette.accent, cursor: 'pointer' }} />
                  <span>{v.nome} <span style={{ fontSize: fz(13), color: palette.inkMuted }}>(ex-vendedora)</span></span>
                </label>
              ))}
            </div>
            {Object.values(herda).some(Boolean) && (
              <div style={{
                marginTop: 8, padding: 10, background: palette.warnSoft,
                borderRadius: 8, fontSize: fz(13), color: palette.ink, lineHeight: 1.5,
              }}>
                ⚠️ <strong>Ao herdar:</strong> todos os clientes que tinham essas vendedoras como última vendedora passam pra essa nova vendedora.
              </div>
            )}
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
            Login / user_id
          </div>
          <input type="text" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="luna ou luna@grupoamicia.com.br" style={inputStyle} />
          <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 4 }}>
            Como ela faz login no app. Pode preencher depois.
          </div>
        </div>
      </div>

      {/* Footer fixo */}
      <div style={{
        position: 'sticky', bottom: 0, background: palette.surface,
        borderTop: `1px solid ${palette.beige}`, padding: 12,
        display: 'flex', gap: 8, boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
      }}>
        <button onClick={onBack} disabled={salvando} style={btnCancelar}>Cancelar</button>
        <button onClick={salvar} disabled={salvando} style={btnPrimario(palette.ok, salvando)}>
          {salvando
            ? <><Loader2 size={sz(17)} style={spinKeyframes} /> Salvando…</>
            : <><Save size={sz(17)} /> {ehEdicao ? 'Salvar alterações' : 'Cadastrar'}</>}
        </button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 6. TransferirCarteiraScreen — Toggle avulsa/em-massa
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, onBack }
// Lê:    state.clientes, state.vendedoras + ex-vendedoras (modo massa)
// Escreve: handleTransferirCliente OR handleTransferirEmMassa
// ═══════════════════════════════════════════════════════════════════════════

export const TransferirCarteiraScreen = ({ lojas, onBack }) => {
  const { state, handleTransferirCliente, handleTransferirEmMassa } = lojas;

  const [modo, setModo] = useState('avulsa');
  const [busca, setBusca] = useState('');
  const [clienteSel, setClienteSel] = useState(null);
  const [vendedoraDest, setVendedoraDest] = useState('');
  const [motivo, setMotivo] = useState('');
  const [origens, setOrigens] = useState({});
  const [exVendedoras, setExVendedoras] = useState([]);
  const [salvando, setSalvando] = useState(false);

  const ativas = (state.vendedoras || []).filter(v => v.ativa);

  // Carrega ex-vendedoras (pra modo massa)
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from('lojas_vendedoras')
          .select('*')
          .eq('ativa', false)
          .order('nome');
        setExVendedoras(data || []);
      } catch (e) {
        console.error('[Lojas] erro carregar ex-vendedoras', e);
      }
    })();
  }, []);

  // Resultados de busca (modo avulsa)
  const resultadosBusca = useMemo(() => {
    if (busca.length < 2) return [];
    const termo = busca.toLowerCase();
    return (state.clientes || [])
      .filter(c => {
        const razao = (c.razao_social || '').toLowerCase();
        const apelido = (c.apelido || '').toLowerCase();
        const fantasia = (c.nome_fantasia || '').toLowerCase();
        return razao.includes(termo) || apelido.includes(termo) || fantasia.includes(termo);
      })
      .slice(0, 4);
  }, [busca, state.clientes]);

  // Vendedora atual do cliente selecionado (pra mostrar no card)
  const vendedoraDoCliente = useMemo(() => {
    if (!clienteSel) return null;
    return ativas.find(v => v.id === clienteSel.vendedora_id)
        || exVendedoras.find(v => v.id === clienteSel.vendedora_id);
  }, [clienteSel, ativas, exVendedoras]);

  // Conta total clientes em massa (modo massa)
  const totalEmMassa = useMemo(() => {
    if (modo !== 'massa') return 0;
    const idsOrigem = Object.entries(origens).filter(([_, v]) => v).map(([k]) => k);
    if (idsOrigem.length === 0) return 0;
    return (state.clientes || []).filter(c => idsOrigem.includes(c.vendedora_id)).length;
  }, [modo, origens, state.clientes]);

  const transferir = async () => {
    setSalvando(true);
    try {
      if (modo === 'avulsa') {
        if (!clienteSel) {
          alert('Selecione um cliente');
          return;
        }
        if (!vendedoraDest) {
          alert('Selecione uma vendedora destino');
          return;
        }
        await handleTransferirCliente(clienteSel.id, vendedoraDest, motivo || 'transferencia_manual');
        const dest = ativas.find(v => v.id === vendedoraDest);
        alert(`Cliente transferido pra ${dest?.nome || 'vendedora'}!`);
      } else {
        const idsOrigem = Object.entries(origens).filter(([_, v]) => v).map(([k]) => k);
        if (idsOrigem.length === 0) {
          alert('Selecione pelo menos uma vendedora de origem');
          return;
        }
        if (!vendedoraDest) {
          alert('Selecione a vendedora destino');
          return;
        }
        let total = 0;
        for (const origemId of idsOrigem) {
          const result = await handleTransferirEmMassa(origemId, vendedoraDest, motivo || 'transferencia_em_massa');
          total += result.transferidos || 0;
        }
        alert(`${total} cliente${total !== 1 ? 's' : ''} transferido${total !== 1 ? 's' : ''}!`);
      }
      onBack();
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header title="Transferir carteira" onBack={onBack} />
      <div style={{ padding: 16, paddingBottom: 100 }}>

        {/* Toggle modo */}
        <div style={{
          display: 'flex', gap: 6, marginBottom: 16,
          background: palette.beigeSoft, padding: 4, borderRadius: 10,
        }}>
          {[
            { id: 'avulsa', label: 'Avulsa', icon: Users },
            { id: 'massa', label: 'Em massa', icon: ArrowLeftRight },
          ].map(m => {
            const Icon = m.icon;
            const ativo = modo === m.id;
            return (
              <button key={m.id} onClick={() => setModo(m.id)} style={{
                flex: 1,
                background: ativo ? palette.surface : 'transparent',
                color: ativo ? palette.ink : palette.inkSoft,
                border: 'none', borderRadius: 8, padding: '10px', fontSize: fz(15),
                fontWeight: ativo ? 600 : 400, cursor: 'pointer', fontFamily: FONT,
                boxShadow: ativo ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>
                <Icon size={sz(16)} />
                {m.label}
              </button>
            );
          })}
        </div>

        {modo === 'avulsa' && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
                Buscar cliente
              </div>
              <div style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 10, padding: '8px 12px',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Search size={sz(18)} color={palette.inkMuted} />
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Nome, apelido ou razão social"
                  style={{
                    flex: 1, border: 'none', background: 'transparent', outline: 'none',
                    fontFamily: FONT, fontSize: fz(15), color: palette.ink,
                  }} />
                {busca && (
                  <button onClick={() => { setBusca(''); setClienteSel(null); }} style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: 0, display: 'flex',
                  }}>
                    <X size={sz(16)} color={palette.inkMuted} />
                  </button>
                )}
              </div>
            </div>

            {busca.length >= 2 && (
              <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {resultadosBusca.length === 0 && (
                  <div style={{
                    padding: 12, textAlign: 'center', color: palette.inkMuted, fontSize: fz(14),
                    background: palette.surface, border: `1px dashed ${palette.beige}`, borderRadius: 8,
                  }}>
                    Nenhum cliente encontrado
                  </div>
                )}
                {resultadosBusca.map(c => {
                  const sel = clienteSel?.id === c.id;
                  const v = ativas.find(vv => vv.id === c.vendedora_id) || exVendedoras.find(vv => vv.id === c.vendedora_id);
                  const kpi = state.clientesKpis?.[c.id] || {};
                  return (
                    <button key={c.id} onClick={() => setClienteSel(c)} style={{
                      background: sel ? palette.accentSoft : palette.surface,
                      border: `1.5px solid ${sel ? palette.accent : palette.beige}`,
                      borderRadius: 10, padding: 12, textAlign: 'left',
                      cursor: 'pointer', fontFamily: FONT,
                    }}>
                      <div style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink, marginBottom: 2 }}>
                        {nomeCliente(c)}
                      </div>
                      {c.apelido && (
                        <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 4 }}>
                          {c.razao_social}
                        </div>
                      )}
                      <div style={{ fontSize: fz(13), color: palette.inkSoft }}>
                        Atual: <strong>{v ? `${v.nome} (${v.loja})` : 'sem vendedora'}</strong>
                        {kpi.dias_sem_comprar != null && ` · Última: ${kpi.dias_sem_comprar}d`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
                Transferir para
              </div>
              <select value={vendedoraDest} onChange={e => setVendedoraDest(e.target.value)} style={inputStyle}>
                <option value="">Selecionar vendedora</option>
                {ativas.filter(v => !v.is_placeholder).map(v => (
                  <option key={v.id} value={v.id}>{v.nome} ({v.loja})</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
                Motivo (opcional)
              </div>
              <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                placeholder="Ex: Cliente foi atendida na outra loja por engano"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: FONT }} />
            </div>
          </>
        )}

        {modo === 'massa' && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
                Transferir clientes que tinham como última vendedora:
              </div>
              <div style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 8, padding: '4px 12px',
              }}>
                {[...ativas, ...exVendedoras].map(v => {
                  const ehEx = !v.ativa;
                  const qtd = (state.clientes || []).filter(c => c.vendedora_id === v.id).length;
                  return (
                    <label key={v.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0',
                      cursor: 'pointer', fontSize: fz(15), color: palette.ink,
                      borderBottom: `1px solid ${palette.beigeSoft}`,
                    }}>
                      <input type="checkbox" checked={!!origens[v.id]}
                        onChange={() => setOrigens({ ...origens, [v.id]: !origens[v.id] })}
                        style={{ width: 16, height: 16, accentColor: palette.accent, cursor: 'pointer' }} />
                      <span style={{ flex: 1 }}>{v.nome} <span style={{ fontSize: fz(13), color: palette.inkMuted }}>({qtd})</span></span>
                      {ehEx && (
                        <span style={{
                          fontSize: fz(12), color: palette.archive, padding: '2px 6px',
                          background: palette.archiveSoft, borderRadius: 4, fontWeight: 600,
                          letterSpacing: 0.3, textTransform: 'uppercase',
                        }}>EX</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
                Para a vendedora
              </div>
              <select value={vendedoraDest} onChange={e => setVendedoraDest(e.target.value)} style={inputStyle}>
                <option value="">Selecionar vendedora</option>
                {ativas.filter(v => !v.is_placeholder).map(v => (
                  <option key={v.id} value={v.id}>{v.nome} ({v.loja})</option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
                Motivo (opcional)
              </div>
              <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={2}
                placeholder="Ex: Reorganização de carteiras"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: FONT }} />
            </div>

            {totalEmMassa > 0 && vendedoraDest && (
              <div style={{
                padding: 14, background: palette.warnSoft,
                border: `1.5px solid ${palette.warn}`, borderRadius: 10,
                fontSize: fz(15), color: palette.ink, lineHeight: 1.5, marginBottom: 14,
              }}>
                ⚠️ <strong>Confirmação:</strong>
                <div style={{ marginTop: 6 }}>
                  Isso vai mover <strong>{totalEmMassa} cliente{totalEmMassa !== 1 ? 's' : ''}</strong> pra carteira selecionada. Histórico antigo é preservado.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer fixo */}
      <div style={{
        position: 'sticky', bottom: 0, background: palette.surface,
        borderTop: `1px solid ${palette.beige}`, padding: 12,
        display: 'flex', gap: 8, boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
      }}>
        <button onClick={onBack} disabled={salvando} style={btnCancelar}>Cancelar</button>
        <button onClick={transferir} disabled={salvando} style={btnPrimario(palette.ok, salvando)}>
          {salvando
            ? <><Loader2 size={sz(17)} style={spinKeyframes} /> Transferindo…</>
            : <><ArrowLeftRight size={sz(17)} /> {modo === 'massa' ? 'Confirmar transferência' : 'Transferir'}</>}
        </button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 7. CuradoriaScreen — Best-sellers / Em alta / Novidade manual (3 abas)
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, onBack }
// Lê:    state.curadoria + state.produtos (busca por REF)
// Escreve: handleAdicionarCuradoria, handleRemoverCuradoria
//
// Schema lojas_produtos_curadoria:
//   - ref, tipo ('best_seller'|'em_alta'|'novidade_manual'), ativo, motivo
//   - data_inicio, data_fim (data_fim só pra novidade_manual = +15d)
//   - adicionado_por, adicionado_em
//
// Lojas.jsx adicionarCuradoria já cuida de:
//   - normalizar REF (refSemZero)
//   - setar data_fim = +15d se tipo === 'novidade_manual'
// ═══════════════════════════════════════════════════════════════════════════

export const CuradoriaScreen = ({ lojas, onBack }) => {
  const { state, handleAdicionarCuradoria, handleRemoverCuradoria } = lojas;
  const userId = state.userId;

  const TABS = [
    { id: 'best_seller',     label: 'Best-sellers', icon: Star,        cor: palette.warn },
    { id: 'em_alta',         label: 'Em alta',      icon: TrendingUp,  cor: palette.alert },
    { id: 'novidade_manual', label: 'Novidades',    icon: Sparkles,    cor: palette.accent },
    { id: 'reposicao',       label: 'Reposições',   icon: RefreshCw,   cor: palette.purple },
    { id: 'cores',           label: 'Cores',        icon: Heart,       cor: palette.purple },
  ];

  const LABEL_TIPO = {
    best_seller: 'best-seller',
    em_alta: 'em alta',
    novidade_manual: 'novidade manual',
    reposicao: 'reposição',
    cores: 'cor',
  };

  const [activeTab, setActiveTab] = useState('best_seller');
  const [showAdicionar, setShowAdicionar] = useState(false);
  const [refBusca, setRefBusca] = useState('');
  const [produtoSel, setProdutoSel] = useState(null);
  const [motivoNovo, setMotivoNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [removendoId, setRemovendoId] = useState(null);

  // Sprint curadoria 04/05/2026: itens vem da API (manual + auto misturados)
  const [itensApi, setItensApi] = useState([]);
  const [carregandoApi, setCarregandoApi] = useState(false);
  const [excluindoRef, setExcluindoRef] = useState(null);
  const [showExcluidas, setShowExcluidas] = useState(false);
  const [excluidas, setExcluidas] = useState([]);
  const [carregandoExcluidas, setCarregandoExcluidas] = useState(false);
  const [reativandoRef, setReativandoRef] = useState(null);

  // Carrega itens da API quando muda de aba (so pra abas que tem auto)
  const carregarItens = useCallback(async () => {
    if (activeTab === 'cores') return;
    setCarregandoApi(true);
    try {
      const r = await fetch(`/api/lojas-curadoria-listar?tipo=${activeTab}`, {
        headers: { 'X-User': userId || '' },
      });
      const data = await r.json();
      if (r.ok) setItensApi(data.itens || []);
      else {
        console.error('curadoria-listar:', data);
        setItensApi([]);
      }
    } catch (e) {
      console.error('curadoria-listar:', e);
      setItensApi([]);
    } finally {
      setCarregandoApi(false);
    }
  }, [activeTab, userId]);

  useEffect(() => { carregarItens(); }, [carregarItens]);
  // Recarrega quando state.curadoria muda (alguem adicionou/removeu manual)
  useEffect(() => { carregarItens(); }, [state.curadoria, carregarItens]);

  const itensDaAba = itensApi;

  const resultadosBuscaProduto = useMemo(() => {
    if (refBusca.trim().length < 1) return [];
    const termo = refBusca.trim().toLowerCase();
    // Busca nas DUAS fontes: oferecíveis (state.produtos, view com giro/estoque)
    // + cadastro completo (state.produtosCadastro, ficha técnica com TODAS as REFs,
    // inclusive novidades recém-saídas da oficina que ainda não têm venda e por
    // isso não entram na view oferecíveis). Dedup por REF, oferecíveis primeiro
    // (mantém qtd_estoque quando existe). Ailson 14/07/2026: sem isso, adicionar
    // novidade manual não encontrava a REF nova.
    const norm = (r) => String(r || '').replace(/^0+/, '').toLowerCase();
    const vistos = new Set();
    const out = [];
    for (const p of [...(state.produtos || []), ...(state.produtosCadastro || [])]) {
      const ref = String(p.ref || '').toLowerCase();
      const desc = String(p.descricao || '').toLowerCase();
      if (!(ref.includes(termo) || desc.includes(termo))) continue;
      const chave = norm(p.ref);
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      out.push(p);
      if (out.length >= 10) break;
    }
    return out;
  }, [refBusca, state.produtos, state.produtosCadastro]);

  const abrirModalAdicionar = () => {
    setRefBusca('');
    setProdutoSel(null);
    setMotivoNovo('');
    setShowAdicionar(true);
  };

  const adicionar = async () => {
    if (!produtoSel) {
      alert('Selecione um produto');
      return;
    }
    setSalvando(true);
    try {
      await handleAdicionarCuradoria(produtoSel.ref, activeTab, motivoNovo.trim() || null);
      setShowAdicionar(false);
      // useEffect [state.curadoria] vai recarregar automaticamente
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (item) => {
    if (!confirm(`Remover REF ${refDisplay(item.ref)} da curadoria?`)) return;
    setRemovendoId(item.id_curadoria);
    try {
      await handleRemoverCuradoria(item.id_curadoria);
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setRemovendoId(null);
    }
  };

  // Excluir auto (admin "vetou")
  const excluirAuto = async (item) => {
    if (!confirm(`Excluir REF ${refDisplay(item.ref)} desta lista automática?\n\nEla some até você reativar.`)) return;
    setExcluindoRef(item.ref);
    try {
      const r = await fetch('/api/lojas-curadoria-excluir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId || '' },
        body: JSON.stringify({ ref: item.ref, tipo: activeTab }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert('Erro: ' + (e.error || `HTTP ${r.status}`));
        return;
      }
      await carregarItens();
    } catch (e) {
      alert('Erro: ' + e.message);
    } finally {
      setExcluindoRef(null);
    }
  };

  // Modal "Ver excluidas"
  const abrirExcluidas = async () => {
    setShowExcluidas(true);
    setCarregandoExcluidas(true);
    try {
      const r = await fetch(`/api/lojas-curadoria-listar-excluidas?tipo=${activeTab}`, {
        headers: { 'X-User': userId || '' },
      });
      const data = await r.json();
      if (r.ok) setExcluidas(data.itens || []);
      else setExcluidas([]);
    } catch {
      setExcluidas([]);
    } finally {
      setCarregandoExcluidas(false);
    }
  };

  // Reativar
  const reativar = async (ref) => {
    setReativandoRef(ref);
    try {
      const r = await fetch('/api/lojas-curadoria-reativar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId || '' },
        body: JSON.stringify({ ref, tipo: activeTab }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        alert('Erro: ' + (e.error || `HTTP ${r.status}`));
        return;
      }
      // Remove da lista local + recarrega itens
      setExcluidas(prev => prev.filter(e => e.ref !== ref));
      await carregarItens();
    } catch (e) {
      alert('Erro: ' + e.message);
    } finally {
      setReativandoRef(null);
    }
  };

  // Helper pra pegar dados do produto a partir do ref (pra mostrar foto/desc).
  // Tenta primeiro state.produtosCadastro (TODOS os produtos, inclui clássicos
  // fora da view oferecíveis), depois state.produtos como fallback.
  // REGRA leading zero: REF pode estar gravado como "376" ou "00376". Tenta
  // ambas as formas (sem zero E com pad até 5).
  const produtoPorRef = useCallback((ref) => {
    if (!ref) return null;
    const refStr = String(ref).trim();
    const refSemZero = refStr.replace(/^0+/, '') || '0';

    const acharEm = (lista) => {
      if (!Array.isArray(lista)) return null;
      return lista.find(p => {
        if (!p?.ref) return false;
        const pRefSem = String(p.ref).trim().replace(/^0+/, '') || '0';
        return pRefSem === refSemZero;
      });
    };

    return acharEm(state.produtosCadastro) || acharEm(state.produtos) || null;
  }, [state.produtos, state.produtosCadastro]);

  const tabAtiva = TABS.find(t => t.id === activeTab);

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title="Curadoria de produtos"
        subtitle="Best-sellers · em alta · novidades manuais"
        onBack={onBack}
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>

        {/* Tabs */}
        <TabBar tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

        {/* Aba Cores tem layout proprio (auto + manual) */}
        {activeTab === 'cores' ? (
          <CoresPainel lojas={lojas} />
        ) : (
          <div style={{ marginTop: 16 }}>
            {/* Botão adicionar + Ver excluidas */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button onClick={abrirModalAdicionar} style={{
                flex: 1, background: 'transparent', border: `1.5px dashed ${palette.beige}`,
                borderRadius: 10, padding: 14, cursor: 'pointer', fontFamily: FONT,
                color: palette.accent, fontSize: fz(15), fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
                <Plus size={sz(17)} /> Adicionar produto
              </button>
              <button onClick={abrirExcluidas} style={{
                background: 'transparent', border: `1px solid ${palette.beige}`,
                borderRadius: 10, padding: '0 14px', cursor: 'pointer', fontFamily: FONT,
                color: palette.inkSoft, fontSize: fz(13), fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }} title="Ver REFs excluídas">
                <EyeOff size={sz(15)} /> Excluídas
              </button>
            </div>

            {/* Loading */}
            {carregandoApi && itensDaAba.length === 0 && (
              <div style={{
                padding: 20, textAlign: 'center', color: palette.inkMuted,
                fontSize: fz(14), background: palette.surface,
                border: `1px solid ${palette.beige}`, borderRadius: 10,
              }}>
                <Loader2 size={sz(18)} style={spinKeyframes} color={palette.inkMuted} />
                <div style={{ marginTop: 6 }}>Carregando…</div>
              </div>
            )}

            {/* Lista vazia */}
            {!carregandoApi && itensDaAba.length === 0 && (() => {
              const IconVazio = tabAtiva?.icon;
              return (
              <div style={{
                padding: 32, textAlign: 'center', color: palette.inkMuted,
                fontSize: fz(15), background: palette.surface,
                border: `1px dashed ${palette.beige}`, borderRadius: 10, lineHeight: 1.5,
              }}>
                {IconVazio && (
                  <IconVazio size={sz(41)} color={palette.inkMuted}
                    style={{ margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
                )}
                <div style={{ marginBottom: 6 }}>
                  Nenhum {LABEL_TIPO[activeTab]} disponível.
                </div>
                <div style={{ fontSize: fz(13) }}>
                  {activeTab === 'best_seller'
                    ? 'Adicione manualmente os campeões de venda.'
                    : activeTab === 'em_alta'
                    ? 'Em alta entra automático (top 10 vendas) ou manual.'
                    : 'Novidades entram automático (5-12d oficina) ou manual.'}
                </div>
              </div>
              );
            })()}

            {/* Contador manual + auto */}
            {itensDaAba.length > 0 && (
              <div style={{
                fontSize: fz(13), color: palette.inkMuted, marginBottom: 8, padding: '0 4px',
                display: 'flex', gap: 12, flexWrap: 'wrap',
              }}>
                <span>{itensDaAba.filter(i => i.origem === 'manual').length} manuais</span>
                <span>·</span>
                <span>{itensDaAba.filter(i => i.origem === 'automatica').length} automáticas</span>
              </div>
            )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {itensDaAba.map(item => {
              const isManual = item.origem === 'manual';
              const isAuto = item.origem === 'automatica';
              const removendo = removendoId === item.id_curadoria;
              const excluindo = excluindoRef === item.ref;
              const diasRestantes = item.data_fim ? diasAte(item.data_fim) : null;

              return (
                <div key={`${item.origem}-${item.ref}`} style={{
                  background: palette.surface, border: `1px solid ${palette.beige}`,
                  borderLeft: `3px solid ${tabAtiva.cor}`,
                  borderRadius: 10, padding: 12,
                  display: 'flex', alignItems: 'center', gap: 12,
                  opacity: isAuto ? 0.92 : 1, // auto fica levemente mais clara
                }}>
                  {/* Foto do produto direto do bucket Supabase */}
                  <FotoProdutoLojas refProd={item.ref} size={48} />

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                    }}>
                      <span style={{ fontSize: fz(12), color: palette.inkMuted, fontWeight: 600 }}>
                        REF {refDisplay(item.ref)}
                      </span>
                      {/* Badge origem */}
                      <span style={{
                        fontSize: fz(10), fontWeight: 700,
                        padding: '1px 6px', borderRadius: 3,
                        background: isManual ? tabAtiva.cor + '20' : palette.beigeSoft,
                        color: isManual ? tabAtiva.cor : palette.inkSoft,
                        textTransform: 'uppercase', letterSpacing: 0.3,
                      }}>
                        {isManual ? 'manual' : 'auto'}
                      </span>
                    </div>
                    <div style={{
                      fontSize: fz(15), fontWeight: 600, color: palette.ink,
                      marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {item.descricao || '(produto não encontrado no catálogo)'}
                    </div>
                    {item.motivo && (
                      <div style={{
                        fontSize: fz(14), color: palette.inkSoft, fontStyle: 'italic', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {item.motivo}
                      </div>
                    )}
                    <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {/* Manual: data adicionado + termina */}
                      {isManual && (
                        <>
                          <span>Adicionado {fmtData(item.adicionado_em)}</span>
                          {item.data_fim && (
                            <span style={{
                              padding: '1px 6px', borderRadius: 3,
                              background: diasRestantes != null && diasRestantes < 3 ? palette.alertSoft : palette.beigeSoft,
                              color: diasRestantes != null && diasRestantes < 3 ? palette.alert : palette.inkSoft,
                              fontWeight: 600,
                            }}>
                              Termina {fmtData(item.data_fim)}
                              {diasRestantes != null && ` (${diasRestantes}d)`}
                            </span>
                          )}
                        </>
                      )}
                      {/* Auto novidade: dias após oficina */}
                      {isAuto && item.dias_apos_entrega !== undefined && (
                        <span>{item.dias_apos_entrega}d da oficina</span>
                      )}
                      {/* Auto em_alta: posição ranking */}
                      {isAuto && item.posicao !== undefined && (
                        <span>#{item.posicao} do top · {item.pecas_45d || 0} peças/45d</span>
                      )}
                    </div>
                  </div>

                  {/* Botão remover (manual) ou excluir (auto) */}
                  {isManual ? (
                    <button onClick={() => remover(item)} disabled={removendo} style={{
                      background: 'transparent', border: 'none', cursor: removendo ? 'wait' : 'pointer',
                      padding: 6, display: 'flex', flexShrink: 0,
                      opacity: removendo ? 0.5 : 1,
                    }} title="Remover da curadoria manual">
                      {removendo
                        ? <Loader2 size={sz(18)} style={spinKeyframes} color={palette.inkMuted} />
                        : <Trash2 size={sz(18)} color={palette.inkMuted} />}
                    </button>
                  ) : (
                    <button onClick={() => excluirAuto(item)} disabled={excluindo} style={{
                      background: 'transparent', border: 'none', cursor: excluindo ? 'wait' : 'pointer',
                      padding: 6, display: 'flex', flexShrink: 0,
                      opacity: excluindo ? 0.5 : 1,
                    }} title="Excluir desta lista (até reativar)">
                      {excluindo
                        ? <Loader2 size={sz(18)} style={spinKeyframes} color={palette.inkMuted} />
                        : <EyeOff size={sz(18)} color={palette.inkMuted} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{
            marginTop: 24, padding: 12, background: palette.beigeSoft,
            borderRadius: 10, fontSize: fz(13), color: palette.inkSoft, lineHeight: 1.6,
          }}>
            ℹ️ Produtos curados aparecem nas sugestões da IA mesmo com estoque baixo.
            <br/>
            • <strong>Best-sellers</strong>: só manual (campeões de venda)<br/>
            • <strong>Em alta</strong>: manual + top 10 vendas reais (curva A)<br/>
            • <strong>Novidades</strong>: manual (15d) + 5-12d da oficina (7-14d se tem caseado)<br/>
            <br/>
            🔁 <strong>Reposição</strong> (auto, sem aba aqui): refs entregues 5-10d (ou 7-12d com caseado) que já venderam antes — IA prioriza pra clientes que compraram a mesma REF ou estilo similar.
            <br/><br/>
            Use <EyeOff size={sz(13)} style={{ display: 'inline', verticalAlign: 'middle' }} /> pra excluir uma sugestão automática que não faz sentido.
          </div>
        </div>
        )}
      </div>

      {/* Modal de adicionar */}
      {showAdicionar && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          padding: 16, fontFamily: FONT,
        }} onClick={() => !salvando && setShowAdicionar(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: palette.surface, borderRadius: 16, padding: 0,
            width: '100%', maxWidth: 460, maxHeight: '85vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              padding: '16px 20px', borderBottom: `1px solid ${palette.beige}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink }}>
                  Adicionar como {LABEL_TIPO[activeTab]}
                </div>
                <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 2 }}>
                  Busque pela REF ou pela descrição do produto
                </div>
              </div>
              <button onClick={() => !salvando && setShowAdicionar(false)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: palette.inkMuted, padding: 4,
              }}>
                <X size={sz(23)} />
              </button>
            </div>

            <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
              <div style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 10, padding: '8px 12px', marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Search size={sz(16)} color={palette.inkMuted} />
                <input autoFocus value={refBusca} onChange={e => setRefBusca(e.target.value)}
                  placeholder="REF ou descrição"
                  style={{
                    flex: 1, border: 'none', background: 'transparent', outline: 'none',
                    fontFamily: FONT, fontSize: fz(15), color: palette.ink,
                  }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {refBusca.length >= 1 && resultadosBuscaProduto.length === 0 && (
                  <div style={{
                    padding: 12, textAlign: 'center', color: palette.inkMuted, fontSize: fz(14),
                    background: palette.beigeSoft, borderRadius: 8,
                  }}>
                    Nenhum produto encontrado pra "{refBusca}"
                  </div>
                )}
                {resultadosBuscaProduto.map(p => {
                  const sel = produtoSel?.ref === p.ref;
                  return (
                    <button key={p.ref} onClick={() => setProdutoSel(p)} style={{
                      background: sel ? palette.accentSoft : palette.surface,
                      border: `1.5px solid ${sel ? palette.accent : palette.beige}`,
                      borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                      fontFamily: FONT, textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: `1.5px solid ${sel ? palette.accent : palette.beige}`,
                        background: sel ? palette.accent : palette.surface,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        {sel && <Check size={sz(14)} color={palette.bg} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: fz(12), color: palette.inkMuted, fontWeight: 600 }}>
                          REF {refDisplay(p.ref)}
                        </div>
                        <div style={{
                          fontSize: fz(15), fontWeight: 600, color: palette.ink,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {p.descricao}
                        </div>
                        <div style={{ fontSize: fz(13), color: palette.inkSoft }}>
                          {p.categoria || '—'} · estoque {p.qtd_estoque ?? '—'}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div>
                <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.inkSoft, marginBottom: 6 }}>
                  Motivo (opcional)
                </div>
                <textarea value={motivoNovo} onChange={e => setMotivoNovo(e.target.value)} rows={2}
                  placeholder="Ex: Sucesso pós-publicação, vira queridinha do verão"
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: FONT }} />
                <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 4 }}>
                  Visível pra IA — ajuda a contextualizar o porquê do destaque
                </div>
              </div>

              {activeTab === 'novidade_manual' && (
                <div style={{
                  marginTop: 12, padding: 10, background: palette.accentSoft,
                  borderRadius: 8, fontSize: fz(13), color: palette.ink, lineHeight: 1.5,
                }}>
                  ✨ <strong>Novidade manual:</strong> esse produto fica como novidade por <strong>15 dias</strong> a partir de hoje.
                </div>
              )}
            </div>

            <div style={{
              padding: 16, borderTop: `1px solid ${palette.beige}`,
              display: 'flex', gap: 8,
            }}>
              <button onClick={() => !salvando && setShowAdicionar(false)} disabled={salvando} style={btnCancelar}>
                Cancelar
              </button>
              <button onClick={adicionar} disabled={salvando || !produtoSel} style={{
                ...btnPrimario(palette.ok, salvando),
                background: !produtoSel ? palette.beige : (salvando ? palette.beige : palette.ok),
                cursor: !produtoSel ? 'not-allowed' : (salvando ? 'wait' : 'pointer'),
              }}>
                {salvando
                  ? <><Loader2 size={sz(17)} style={spinKeyframes} /> Salvando…</>
                  : <><Plus size={sz(17)} /> Adicionar</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Excluídas — REFs vetadas pelo admin */}
      {showExcluidas && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
          padding: 16, fontFamily: FONT,
        }} onClick={() => setShowExcluidas(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: palette.surface, borderRadius: 16, padding: 0,
            width: '100%', maxWidth: 460, maxHeight: '85vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              padding: '16px 20px', borderBottom: `1px solid ${palette.beige}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink }}>
                  Excluídas — {LABEL_TIPO[activeTab]}
                </div>
                <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 2 }}>
                  REFs que você vetou da curadoria automática
                </div>
              </div>
              <button onClick={() => setShowExcluidas(false)} style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: palette.inkMuted, padding: 4,
              }}>
                <X size={sz(23)} />
              </button>
            </div>

            <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
              {carregandoExcluidas && (
                <div style={{ textAlign: 'center', padding: 20, color: palette.inkMuted }}>
                  <Loader2 size={sz(18)} style={spinKeyframes} color={palette.inkMuted} />
                </div>
              )}
              {!carregandoExcluidas && excluidas.length === 0 && (
                <div style={{
                  padding: 24, textAlign: 'center', color: palette.inkMuted,
                  fontSize: fz(14), background: palette.beigeSoft, borderRadius: 10,
                }}>
                  Nenhuma REF excluída.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {excluidas.map(item => {
                  const reativando = reativandoRef === item.ref;
                  return (
                    <div key={item.ref} style={{
                      background: palette.surface, border: `1px solid ${palette.beige}`,
                      borderRadius: 8, padding: 10,
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <FotoProdutoLojas refProd={item.ref} size={40} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: fz(12), color: palette.inkMuted, fontWeight: 600 }}>
                          REF {refDisplay(item.ref)}
                        </div>
                        <div style={{
                          fontSize: fz(14), fontWeight: 600, color: palette.ink,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {item.descricao}
                        </div>
                        <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 2 }}>
                          Excluída {fmtData(item.excluida_em)}
                          {item.motivo ? ` · ${item.motivo}` : ''}
                        </div>
                      </div>
                      <button onClick={() => reativar(item.ref)} disabled={reativando} style={{
                        background: palette.accentSoft, border: 'none',
                        borderRadius: 6, padding: '6px 10px',
                        cursor: reativando ? 'wait' : 'pointer', fontFamily: FONT,
                        fontSize: fz(12), fontWeight: 600, color: palette.accent,
                        display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
                        opacity: reativando ? 0.6 : 1,
                      }}>
                        {reativando
                          ? <Loader2 size={sz(14)} style={spinKeyframes} />
                          : <RotateCcw size={sz(14)} />}
                        Reativar
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 8. ImportacoesScreen — Histórico semanal Drive
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, onBack }
// Lê:    state.importacoes
//
// Schema lojas_importacoes:
//   - nome_arquivo, tipo_arquivo, loja
//   - registros_total, registros_inseridos, registros_atualizados, registros_ignorados
//   - status: 'iniciada' | 'sucesso' | 'erro' | 'parcial'
//   - iniciada_em, finalizada_em, erro
//
// Upload manual: UI presente, mas redireciona pra info sobre Drive automático.
// Edge Function de Drive pull fica pra Parte 5.
// ═══════════════════════════════════════════════════════════════════════════

export const ImportacoesScreen = ({ lojas, onBack }) => {
  const { state } = lojas;
  const importacoes = state.importacoes || [];

  // Última importação = item mais recente
  const ultima = importacoes[0];

  // Importações da mesma data da última (mesmo "lote semanal")
  const ultimoLote = useMemo(() => {
    if (!ultima) return [];
    const dataUltima = new Date(ultima.iniciada_em).toDateString();
    return importacoes.filter(imp => new Date(imp.iniciada_em).toDateString() === dataUltima);
  }, [ultima, importacoes]);

  const totalRegistrosLote = ultimoLote.reduce((s, i) => s + (i.registros_total || 0), 0);
  const algumComErro = ultimoLote.some(i => i.status === 'erro' || i.status === 'parcial');
  const totalAvisos = ultimoLote.filter(i => i.status === 'parcial').length
    + ultimoLote.filter(i => i.status === 'erro').length;
  const statusGeral = algumComErro ? 'warn' : 'ok';

  // Mapa de label dos tipos do schema
  const LABEL_TIPO = {
    cadastro_clientes_futura: 'Cadastro clientes (Futura)',
    vendas_clientes_st: 'Vendas clientes ST',
    vendas_clientes_br: 'Vendas clientes BR',
    vendas_historico_st: 'Histórico vendas ST',
    vendas_historico_br: 'Histórico vendas BR',
    vendas_semanal_st: 'Vendas semanais ST',
    vendas_semanal_br: 'Vendas semanais BR',
    produtos_semanal: 'Produtos (semanal)',
    sacola_st: 'Sacolas ST',
    sacola_br: 'Sacolas BR',
    relatorio_bi_st: 'Relatório BI ST (SKUs)',
    relatorio_bi_br: 'Relatório BI BR (SKUs)',
  };

  // Estado do trigger manual
  const [importando, setImportando] = useState(false);
  const [erroImport, setErroImport] = useState(null);
  const [resultadoImport, setResultadoImport] = useState(null);

  const dispararImportacao = async () => {
    if (importando) return;
    if (!confirm('Buscar e importar TODOS os arquivos do Drive agora?\n\nLeva uns 30-60 segundos. Os crons já fazem isso automaticamente toda terça 6h, esse botão é pra rodar manual quando precisa.')) {
      return;
    }
    setImportando(true);
    setErroImport(null);
    setResultadoImport(null);
    try {
      const r = await fetch('/api/lojas-drive-trigger?user=ailson', { method: 'GET' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setResultadoImport(data);
      // Recarrega a lista de importações (usa hook do lojas se existir)
      if (lojas?.recarregar?.importacoes) {
        await lojas.recarregar.importacoes();
      }
    } catch (e) {
      setErroImport(e.message || String(e));
    } finally {
      setImportando(false);
    }
  };

  const onUploadManualClick = dispararImportacao;

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header title="Importações" subtitle="Histórico semanal" onBack={onBack} />
      <div style={{ padding: 16, paddingBottom: 32 }}>

        {/* Card "Última importação" */}
        {ultima ? (
          <div style={{
            background: statusGeral === 'ok' ? palette.okSoft : palette.warnSoft,
            border: `1px solid ${statusGeral === 'ok' ? palette.ok : palette.warn}40`,
            borderRadius: 12, padding: 14, marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {statusGeral === 'ok'
                ? <CheckCircle2 size={sz(21)} color={palette.ok} />
                : <AlertCircle size={sz(21)} color={palette.warn} />}
              <span style={{ fontSize: fz(16), fontWeight: 600, color: palette.ink }}>
                Última importação · {fmtDataHora(ultima.iniciada_em)}
              </span>
            </div>
            <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.5 }}>
              {ultimoLote.length} arquivo{ultimoLote.length !== 1 ? 's' : ''} processado{ultimoLote.length !== 1 ? 's' : ''} · {totalRegistrosLote.toLocaleString('pt-BR')} registros
              {totalAvisos > 0 && (
                <span style={{ color: palette.warn, fontWeight: 600 }}>
                  {' '}· {totalAvisos} aviso{totalAvisos !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div style={{
            padding: 20, textAlign: 'center', color: palette.inkMuted, fontSize: fz(15),
            background: palette.surface, border: `1px dashed ${palette.beige}`,
            borderRadius: 10, marginBottom: 16, lineHeight: 1.5,
          }}>
            <FileSpreadsheet size={sz(37)} color={palette.inkMuted}
              style={{ margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
            Nenhuma importação ainda.<br/>
            A primeira roda automaticamente na próxima terça às 06:00.
          </div>
        )}

        {/* Botão buscar arquivos do Drive */}
        <button onClick={dispararImportacao} disabled={importando} style={{
          width: '100%',
          background: importando ? palette.beige : palette.accent,
          border: 'none',
          borderRadius: 12, padding: 16,
          cursor: importando ? 'default' : 'pointer',
          fontFamily: FONT,
          color: importando ? palette.inkMuted : '#fff',
          fontSize: fz(15), fontWeight: 600, marginBottom: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          {importando ? (
            <>
              <Loader2 size={sz(18)} style={{ animation: 'spin 1s linear infinite' }} />
              Buscando arquivos do Drive…
            </>
          ) : (
            <>
              <Download size={sz(18)} />
              Buscar todos arquivos agora
            </>
          )}
        </button>

        {/* Resultado do disparo manual */}
        {erroImport && (
          <div style={{
            background: palette.alertSoft, border: `1px solid ${palette.alert}40`,
            borderRadius: 10, padding: 12, marginBottom: 16,
            fontSize: fz(14), color: palette.alert,
          }}>
            <strong>Erro:</strong> {erroImport}
          </div>
        )}
        {resultadoImport && (
          <div style={{
            background: resultadoImport.erros > 0 ? palette.warnSoft : palette.okSoft,
            border: `1px solid ${(resultadoImport.erros > 0 ? palette.warn : palette.ok)}40`,
            borderRadius: 10, padding: 12, marginBottom: 16,
            fontSize: fz(14), color: palette.ink, lineHeight: 1.5,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {resultadoImport.erros === 0 ? '✅ Importação concluída!' : '⚠️ Importação parcial'}
            </div>
            <div style={{ fontSize: fz(13), color: palette.inkSoft }}>
              {resultadoImport.sucessos || 0} sucesso{(resultadoImport.sucessos || 0) === 1 ? '' : 's'}
              {resultadoImport.erros > 0 && ` · ${resultadoImport.erros} erro${resultadoImport.erros === 1 ? '' : 's'}`}
              {resultadoImport.ignorados_tipo_nao_reconhecido > 0 && ` · ${resultadoImport.ignorados_tipo_nao_reconhecido} ignorados`}
              <br />Atualize a página pra ver no histórico abaixo.
            </div>
          </div>
        )}

        {/* Histórico */}
        {importacoes.length > 0 && (
          <>
            <SectionTitle icon={History}>Histórico</SectionTitle>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {importacoes.map(imp => {
                const ok = imp.status === 'sucesso';
                const erro = imp.status === 'erro';
                const corBorda = ok ? palette.ok : (erro ? palette.alert : palette.warn);

                return (
                  <div key={imp.id} style={{
                    background: palette.surface, border: `1px solid ${palette.beige}`,
                    borderLeft: `3px solid ${corBorda}`,
                    borderRadius: 10, padding: 12,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <FileSpreadsheet size={sz(16)} color={palette.inkSoft} />
                      <span style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink, flex: 1, minWidth: 0 }}>
                        {LABEL_TIPO[imp.tipo_arquivo] || imp.tipo_arquivo}
                        {imp.loja && ` · ${imp.loja}`}
                      </span>
                      {ok
                        ? <CheckCircle2 size={sz(16)} color={palette.ok} />
                        : erro
                          ? <AlertCircle size={sz(16)} color={palette.alert} />
                          : <AlertCircle size={sz(16)} color={palette.warn} />}
                    </div>

                    <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 4 }}>
                      {fmtDataHora(imp.iniciada_em)}
                      {imp.duracao_ms != null && ` · ${(imp.duracao_ms / 1000).toFixed(1)}s`}
                    </div>

                    <div style={{ fontSize: fz(14), color: palette.inkSoft }}>
                      {(imp.registros_total ?? 0).toLocaleString('pt-BR')} registros
                      {imp.registros_inseridos != null && ` · ${imp.registros_inseridos} novos`}
                      {imp.registros_atualizados != null && ` · ${imp.registros_atualizados} atualizados`}
                      {imp.registros_ignorados != null && imp.registros_ignorados > 0 && (
                        <span style={{ color: palette.warn }}> · {imp.registros_ignorados} ignorados</span>
                      )}
                    </div>

                    {imp.erro && (
                      <div style={{
                        marginTop: 6, padding: 8,
                        background: erro ? palette.alertSoft : palette.warnSoft,
                        borderRadius: 6, fontSize: fz(13),
                        color: erro ? palette.alert : palette.warn,
                        lineHeight: 1.4,
                      }}>
                        {erro ? '❌' : '⚠️'} {imp.erro}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div style={{
          marginTop: 16, padding: 12, background: palette.beigeSoft,
          borderRadius: 10, fontSize: fz(13), color: palette.inkSoft, lineHeight: 1.5,
        }}>
          ℹ️ Importações automáticas rodam toda terça às 06:00, processando os arquivos do Drive nas pastas <strong>Mire_Bom_Retiro</strong> e <strong>Mire_Silva_Teles</strong>.
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Agrega dados de um grupo (qtd docs, lifetime, status, doc principal)
// ═══════════════════════════════════════════════════════════════════════════
//
// Decisão pragmática: doc principal = cliente do grupo de maior lifetime.
// Não persistido em DB — calculado dinamicamente.
// ═══════════════════════════════════════════════════════════════════════════

function agregarGrupo(grupo, clientes, kpis, clientesEnriquecidos) {
  const docs = clientes.filter(c => c.grupo_id === grupo.id);
  if (docs.length === 0) {
    return {
      ...grupo,
      qtdDocs: 0, documentos: [],
      lifetime: 0, ticketMedio: 0, compras: 0,
      diasUltima: null, status: 'arquivo',
      docPrincipalId: null,
    };
  }

  const lifetime = docs.reduce((s, c) => s + (kpis[c.id]?.lifetime_total || 0), 0);
  const compras = docs.reduce((s, c) => s + (kpis[c.id]?.qtd_compras || 0), 0);
  const ticketMedio = compras > 0 ? lifetime / compras : 0;

  const diasArr = docs
    .map(c => kpis[c.id]?.dias_sem_comprar)
    .filter(d => d != null);
  const diasUltima = diasArr.length > 0 ? Math.min(...diasArr) : null;

  // Status agregado: pega o MELHOR (mais ativo). Se um único doc do grupo
  // está ativo, o grupo todo é ativo — porque grupo é "mesmo dono comprando
  // por CNPJs diferentes". Decisão Ailson 28/04/2026.
  // Era 'separandoSacola' primeiro (pior status ganha), o que fazia grupo
  // aparecer INATIVO mesmo com doc principal comprando há 5 dias.
  const ordemStatus = ['ativo', 'separandoSacola', 'atencao', 'semAtividade', 'inativo', 'arquivo'];
  const docsStatuses = docs.map(c => {
    const enr = clientesEnriquecidos.find(ce => ce.id === c.id);
    return enr?.statusAtual || kpis[c.id]?.status_atual || 'arquivo';
  });
  const statusGrupo = ordemStatus.find(s => docsStatuses.includes(s)) || 'ativo';

  // Doc principal: maior lifetime
  let docPrincipalId = null;
  let maiorLT = -1;
  for (const c of docs) {
    const lt = kpis[c.id]?.lifetime_total || 0;
    if (lt > maiorLT) {
      maiorLT = lt;
      docPrincipalId = c.id;
    }
  }

  return {
    ...grupo,
    qtdDocs: docs.length,
    documentos: docs,
    lifetime, compras, ticketMedio, diasUltima,
    status: statusGrupo,
    docPrincipalId,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. GruposListScreen — Lista de grupos com filtro por vendedora
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, isAdmin, onBack, onSelectGrupo, onCriarGrupo }
// Lê:    state.grupos, state.clientes, state.clientesKpis, state.vendedoras
// ═══════════════════════════════════════════════════════════════════════════

export const GruposListScreen = ({ lojas, isAdmin, onBack, onSelectGrupo, onCriarGrupo }) => {
  const { state, clientesEnriquecidos } = lojas;

  const [busca, setBusca] = useState('');
  const [filtroVendedora, setFiltroVendedora] = useState('todas');

  const ativas = (state.vendedoras || []).filter(v => v.ativa);

  // Agrega cada grupo com KPIs
  const gruposAgregados = useMemo(() => {
    return (state.grupos || [])
      .map(g => agregarGrupo(g, state.clientes || [], state.clientesKpis || {}, clientesEnriquecidos || []))
      .filter(g => g.qtdDocs > 0); // grupos sem docs não aparecem
  }, [state.grupos, state.clientes, state.clientesKpis, clientesEnriquecidos]);

  // Filtra por vendedora (admin) e busca
  const gruposFiltrados = useMemo(() => {
    let filtrados = gruposAgregados;

    if (isAdmin && filtroVendedora !== 'todas') {
      filtrados = filtrados.filter(g => g.vendedora_id === filtroVendedora);
    }

    if (busca.trim()) {
      const termo = busca.toLowerCase();
      const termoNum = busca.replace(/[^0-9]/g, '');
      filtrados = filtrados.filter(g => {
        if (g.nome_grupo?.toLowerCase().includes(termo)) return true;
        if (g.documentos.some(d => (d.razao_social || '').toLowerCase().includes(termo))) return true;
        if (g.documentos.some(d => (d.apelido || '').toLowerCase().includes(termo))) return true;
        if (termoNum.length >= 3 && g.documentos.some(d => (d.documento || '').includes(termoNum))) return true;
        return false;
      });
    }

    return filtrados;
  }, [gruposAgregados, busca, filtroVendedora, isAdmin]);

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title="Grupos de cliente"
        subtitle={isAdmin
          ? `${gruposAgregados.length} grupo${gruposAgregados.length !== 1 ? 's' : ''} · todas vendedoras`
          : `${gruposAgregados.length} grupo${gruposAgregados.length !== 1 ? 's' : ''} · sua carteira`}
        onBack={onBack}
        rightContent={
          <button onClick={onCriarGrupo} style={{
            background: palette.accent, border: 'none', color: palette.bg,
            padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4, fontSize: fz(14),
            fontFamily: FONT, fontWeight: 600,
          }}>
            <Plus size={sz(16)} /> Novo
          </button>
        }
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>

        {/* Filtro vendedora (só admin) */}
        {isAdmin && ativas.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{
              fontSize: fz(13), color: palette.inkSoft, marginBottom: 6,
              fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase',
            }}>
              Filtrar por vendedora
            </div>
            <select value={filtroVendedora} onChange={e => setFiltroVendedora(e.target.value)} style={inputStyle}>
              <option value="todas">Todas as vendedoras</option>
              {ativas.filter(v => !v.is_placeholder).map(v => (
                <option key={v.id} value={v.id}>{v.nome} ({v.loja})</option>
              ))}
            </select>
          </div>
        )}

        {/* Search */}
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderRadius: 10, padding: '8px 12px', marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Search size={sz(18)} color={palette.inkMuted} />
          <input value={busca} onChange={e => setBusca(e.target.value)}
            placeholder="Buscar nome, CNPJ, CPF ou razão"
            style={{
              flex: 1, border: 'none', background: 'transparent', outline: 'none',
              fontFamily: FONT, fontSize: fz(15), color: palette.ink,
            }} />
          {busca && (
            <button onClick={() => setBusca('')} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 0, display: 'flex',
            }}>
              <X size={sz(16)} color={palette.inkMuted} />
            </button>
          )}
        </div>

        {gruposFiltrados.length > 0 && (
          <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 8 }}>
            {gruposFiltrados.length} grupo{gruposFiltrados.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* Lista */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {gruposFiltrados.map(g => {
            const meta = statusMap[g.status] || statusMap.ativo;
            const vendedora = ativas.find(v => v.id === g.vendedora_id);
            return (
              <button key={g.id} onClick={() => onSelectGrupo(g)} style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderLeft: `3px solid ${meta.cor}`,
                borderRadius: 10, padding: 12, width: '100%', textAlign: 'left',
                cursor: 'pointer', fontFamily: FONT,
                display: 'flex', alignItems: 'flex-start', gap: 12,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, background: palette.accentSoft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <UsersRound size={sz(23)} color={palette.accent} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink }}>{g.nome_grupo}</span>
                    <span style={{
                      fontSize: fz(10), fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                      background: palette.accentSoft, color: palette.accent,
                      letterSpacing: 0.3, textTransform: 'uppercase',
                    }}>Grupo</span>
                  </div>
                  {isAdmin && vendedora && (
                    <div style={{
                      fontSize: fz(12), color: palette.inkMuted, marginBottom: 4,
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <Users size={sz(12)} /> {vendedora.nome} · {vendedora.loja}
                    </div>
                  )}
                  <div style={{ fontSize: fz(14), color: palette.inkSoft, marginBottom: 4 }}>
                    {g.qtdDocs} document{g.qtdDocs !== 1 ? 'os' : 'o'} · {fmtMoeda(g.lifetime)} · {g.compras} compra{g.compras !== 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: fz(13), color: palette.inkMuted }}>
                      Última: {g.diasUltima != null ? `${g.diasUltima}d` : '—'}
                    </span>
                    <span style={{
                      fontSize: fz(10), fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                      background: meta.soft, color: meta.cor,
                      letterSpacing: 0.3, textTransform: 'uppercase',
                    }}>{meta.label}</span>
                  </div>
                </div>
                <ChevronRight size={sz(21)} color={palette.inkMuted} />
              </button>
            );
          })}
        </div>

        {/* Estado vazio */}
        {gruposFiltrados.length === 0 && busca && (
          <div style={{
            padding: 24, textAlign: 'center', color: palette.inkMuted,
            fontSize: fz(15), marginTop: 12,
          }}>
            Nenhum grupo encontrado pra "{busca}"
          </div>
        )}

        {gruposAgregados.length === 0 && !busca && (
          <div style={{
            padding: 32, textAlign: 'center', color: palette.inkMuted,
            fontSize: fz(15), marginTop: 12, background: palette.surface,
            border: `1px dashed ${palette.beige}`, borderRadius: 10, lineHeight: 1.5,
          }}>
            <UsersRound size={sz(41)} color={palette.inkMuted}
              style={{ margin: '0 auto 12px', display: 'block', opacity: 0.4 }} />
            <div style={{ marginBottom: 8 }}>
              {isAdmin ? 'Nenhum grupo criado ainda' : 'Você ainda não tem grupos'}
            </div>
            <div style={{ fontSize: fz(13) }}>
              Use grupos pra unificar CNPJs/CPFs do mesmo dono.<br/>
              A IA gera 1 sugestão pro grupo todo.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 10. DetalheGrupoScreen — Card grupo + docs + mensagens enviadas
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, grupo, onBack, onAdicionarCnpj }
//
// Recebe `grupo` JÁ AGREGADO (via agregarGrupo) ou puro do state.grupos.
// Se vier puro, re-agrega com KPIs locais.
//
// Mostra:
//   - Card do grupo com status agregado
//   - Histórico agregado (KPIs)
//   - Lista de documentos (CNPJs do grupo)
//   - Estilo dominante (do KPI do doc principal)
//   - Mensagens enviadas (query separada)
//   - Footer fixo: "Pedir sugestão de mensagem" → abre ModalMensagem
// ═══════════════════════════════════════════════════════════════════════════

export const DetalheGrupoScreen = ({ lojas, grupo: grupoInicial, onBack, onAdicionarCnpj }) => {
  const { state, clientesEnriquecidos, handleSaveGrupo, handleEditarTelefone } = lojas;

  // Re-agrega o grupo localmente pra ter dados sempre atualizados
  const grupo = useMemo(() => {
    return agregarGrupo(grupoInicial, state.clientes || [], state.clientesKpis || {}, clientesEnriquecidos || []);
  }, [grupoInicial, state.clientes, state.clientesKpis, clientesEnriquecidos]);

  const [mensagens, setMensagens] = useState([]);
  const [carregandoMsg, setCarregandoMsg] = useState(true);
  const [showModalMsg, setShowModalMsg] = useState(false);

  // Editar grupo (Ailson 11/05/2026): modal pra editar nome do grupo
  // + WhatsApp (que sobrescreve em todos os docs).
  const [editAberto, setEditAberto] = useState(false);
  const [editNome, setEditNome] = useState('');
  const [editWhats, setEditWhats] = useState('');
  const [salvandoEdit, setSalvandoEdit] = useState(false);

  // Carrega mensagens enviadas pra qualquer doc do grupo
  useEffect(() => {
    let cancelado = false;
    const docIds = grupo.documentos.map(d => d.id);
    if (docIds.length === 0) {
      setMensagens([]);
      setCarregandoMsg(false);
      return;
    }
    setCarregandoMsg(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('lojas_sugestoes_diarias')
          .select('*')
          .in('cliente_id', docIds)
          .eq('status', 'executada')
          .order('executada_em', { ascending: false })
          .limit(5);
        if (error) throw error;
        if (!cancelado) setMensagens(data || []);
      } catch (e) {
        console.error('[Lojas] erro carregar mensagens grupo', e);
        if (!cancelado) setMensagens([]);
      } finally {
        if (!cancelado) setCarregandoMsg(false);
      }
    })();
    return () => { cancelado = true; };
  }, [grupo.id, grupo.documentos.length]);

  const meta = statusMap[grupo.status] || statusMap.ativo;
  const vendedora = (state.vendedoras || []).find(v => v.id === grupo.vendedora_id);

  // Frequência aproximada (dias entre compras)
  const frequencia = grupo.compras > 0 ? Math.round(365 / (grupo.compras / 2)) : null;

  // Estilo dominante: pega do KPI do doc principal
  const estiloDominante = useMemo(() => {
    if (!grupo.docPrincipalId) return null;
    const kpi = state.clientesKpis?.[grupo.docPrincipalId];
    if (!kpi || !Array.isArray(kpi.estilo_dominante) || kpi.estilo_dominante.length === 0) return null;
    return kpi.estilo_dominante.join(', ');
  }, [grupo.docPrincipalId, state.clientesKpis]);

  // Helpers de visual de mensagem
  const TIPO_MSG_VISUAL = {
    reativar: { icone: Flame, cor: palette.alert, label: 'Reativar' },
    atencao: { icone: AlertTriangle, cor: palette.warn, label: 'Atenção' },
    novidade: { icone: Sparkles, cor: palette.accent, label: 'Novidade' },
    followup: { icone: MessageCircle, cor: palette.ok, label: 'Vamos acompanhar' },
    followup_nova: { icone: MessageCircle, cor: palette.purple, label: 'Check-in' },
    sacola: { icone: Heart, cor: palette.purple, label: 'Sacola' },
  };

  const RESULTADO_MAP = {
    sucesso: { cor: palette.ok, label: '✅ Convertida', soft: palette.okSoft },
    sem_resposta: { cor: palette.inkMuted, label: '❌ Sem retorno', soft: palette.beigeSoft },
    recusada: { cor: palette.alert, label: '↩ Recusada', soft: palette.alertSoft },
    venda: { cor: palette.ok, label: '✅ Convertida', soft: palette.okSoft },
    aguardando: { cor: palette.warn, label: '⏳ Aguardando', soft: palette.warnSoft },
  };

  const nomeClientePorId = useCallback((cid) => {
    const c = grupo.documentos.find(d => d.id === cid);
    return c ? nomeCliente(c) : '—';
  }, [grupo.documentos]);

  // Salva edicao de nome + whatsapp do grupo (Ailson 11/05/2026)
  const salvarEditGrupo = async () => {
    const nomeLimpo = editNome.trim();
    if (!nomeLimpo) {
      alert('Nome do grupo nao pode ficar vazio');
      return;
    }
    const whatsLimpo = String(editWhats || '').replace(/\D/g, '');
    setSalvandoEdit(true);
    try {
      // 1) Atualiza nome do grupo se mudou
      if (nomeLimpo !== grupo.nome_grupo) {
        await handleSaveGrupo({
          id: grupo.id,
          nome_grupo: nomeLimpo,
          vendedora_id: grupo.vendedora_id,
        });
      }
      // 2) Atualiza WhatsApp em TODOS os docs se preenchido (>=10 digitos)
      if (whatsLimpo.length >= 10 && handleEditarTelefone) {
        for (const doc of grupo.documentos) {
          // Pula docs que ja tem esse mesmo telefone (evita updates desnecessarios)
          const atual = String(doc.telefone_principal || '').replace(/\D/g, '');
          if (atual === whatsLimpo) continue;
          try {
            await handleEditarTelefone(doc.id, whatsLimpo);
          } catch (e) {
            console.warn(`[edit-grupo] erro tel cliente ${doc.id}:`, e?.message);
          }
        }
      }
      setEditAberto(false);
    } catch (e) {
      alert('Erro ao salvar: ' + (e.message || e));
    } finally {
      setSalvandoEdit(false);
    }
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title={grupo.nome_grupo}
        subtitle={`Grupo · ${grupo.qtdDocs} documento${grupo.qtdDocs !== 1 ? 's' : ''}`}
        onBack={onBack}
      />
      <div style={{ padding: 16, paddingBottom: 100 }}>

        {/* Card do grupo */}
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderLeft: `4px solid ${meta.cor}`, borderRadius: 12, padding: 14, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 10, background: palette.accentSoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <UsersRound size={sz(25)} color={palette.accent} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                <span style={{ fontSize: fz(18), fontWeight: 600, color: palette.ink }}>{grupo.nome_grupo}</span>
                <span style={{
                  fontSize: fz(10), fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                  background: meta.soft, color: meta.cor,
                  letterSpacing: 0.3, textTransform: 'uppercase',
                }}>{meta.label}</span>
                {/* Botão editar grupo — Ailson 11/05/2026 */}
                <button
                  onClick={() => {
                    setEditNome(grupo.nome_grupo || '');
                    // Pre-preenche WhatsApp com o do doc principal ou 1o que tiver
                    const docPrincipal = grupo.documentos.find(d => d.id === grupo.docPrincipalId);
                    const docComTel = (docPrincipal?.telefone_principal ? docPrincipal : null)
                      || grupo.documentos.find(d => d.telefone_principal);
                    setEditWhats(docComTel?.telefone_principal || '');
                    setEditAberto(true);
                  }}
                  title="Editar nome do grupo e WhatsApp"
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    padding: 4, marginLeft: 2, display: 'flex', alignItems: 'center',
                    color: palette.inkMuted, borderRadius: 4,
                  }}
                >
                  <Pencil size={sz(14)} />
                </button>
              </div>
              <div style={{ fontSize: fz(13), color: palette.inkSoft }}>
                Vendedora: {vendedora ? `${vendedora.nome} · ${vendedora.loja}` : '—'}
              </div>
              {/* WhatsApp do responsavel — Ailson 07/05/2026.
                  Pega de qualquer doc do grupo (prioriza o principal,
                  fallback pro 1o que tiver telefone). Util pra abrir
                  conversa com 1 toque. */}
              {(() => {
                const docPrincipal = grupo.documentos.find(d => d.id === grupo.docPrincipalId);
                const docComTel = (docPrincipal?.telefone_principal ? docPrincipal : null)
                  || grupo.documentos.find(d => d.telefone_principal);
                if (!docComTel?.telefone_principal) return null;
                const tel = docComTel.telefone_principal;
                const telLimpo = String(tel).replace(/\D/g, '');
                const compradorNome = docComTel.comprador_nome || docComTel.apelido;
                return (
                  <div style={{ fontSize: fz(13), color: palette.inkSoft, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                    <span>Responsável:</span>
                    <a
                      href={`https://wa.me/55${telLimpo}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: '#25D366', fontWeight: 600, textDecoration: 'none',
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}
                      title={`Abrir WhatsApp${compradorNome ? ' de ' + compradorNome : ''}`}
                    >
                      💬 {tel}
                    </a>
                    {compradorNome && (
                      <span style={{ color: palette.inkMuted, fontSize: fz(12) }}>({compradorNome})</span>
                    )}
                  </div>
                );
              })()}
              {grupo.created_at && (
                <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 2 }}>
                  Criado em {fmtData(grupo.created_at)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Histórico agregado */}
        <SectionTitle icon={BarChart3}>Histórico agregado do grupo</SectionTitle>
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderRadius: 12, padding: 14, marginBottom: 16,
        }}>
          <div style={{ fontSize: fz(16), color: palette.ink, lineHeight: 1.7 }}>
            <strong>{grupo.compras} compra{grupo.compras !== 1 ? 's' : ''}</strong> · <strong>{fmtMoeda(grupo.lifetime)}</strong> lifetime
          </div>
          {grupo.ticketMedio > 0 && (
            <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.7, marginTop: 2 }}>
              Ticket médio {fmtMoeda(grupo.ticketMedio)}
            </div>
          )}
          {frequencia != null && (
            <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.7 }}>
              Frequência ~{frequencia} dias entre compras
            </div>
          )}
          <div style={{ fontSize: fz(15), color: palette.inkSoft, lineHeight: 1.7 }}>
            Última compra do grupo {grupo.diasUltima != null ? <>há <strong>{grupo.diasUltima} dia{grupo.diasUltima !== 1 ? 's' : ''}</strong></> : '—'}
          </div>
        </div>

        {/* Documentos do grupo */}
        <SectionTitle icon={Store}>Documentos do grupo ({grupo.qtdDocs})</SectionTitle>
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderRadius: 12, marginBottom: 12, overflow: 'hidden',
        }}>
          {grupo.documentos.map((d, i) => {
            const ehPrincipal = d.id === grupo.docPrincipalId;
            const enr = clientesEnriquecidos.find(ce => ce.id === d.id);
            const docMeta = statusMap[enr?.statusAtual || 'ativo'] || statusMap.ativo;
            const kpi = state.clientesKpis?.[d.id] || {};

            return (
              <div key={d.id} style={{
                padding: 12,
                borderBottom: i < grupo.documentos.length - 1 ? `1px solid ${palette.beigeSoft}` : 'none',
                background: ehPrincipal ? palette.accentSoft : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                  {ehPrincipal && <Crown size={sz(16)} color={palette.warn} style={{ flexShrink: 0 }} />}
                  <span style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink, flex: 1, minWidth: 0 }}>
                    {nomeCliente(d)}
                  </span>
                  <span style={{
                    fontSize: fz(10), fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                    background: docMeta.soft, color: docMeta.cor,
                    letterSpacing: 0.3, textTransform: 'uppercase',
                  }}>{docMeta.label}</span>
                </div>
                {d.razao_social && d.apelido && (
                  <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 4 }}>
                    {d.razao_social}
                  </div>
                )}
                <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 4 }}>
                  {d.tipo_documento === 'cnpj' ? 'CNPJ' : 'CPF'} {d.documento}
                </div>
                <div style={{ fontSize: fz(14), color: palette.inkSoft }}>
                  {kpi.qtd_compras ?? 0} compra{(kpi.qtd_compras ?? 0) !== 1 ? 's' : ''} · {fmtMoeda(kpi.lifetime_total ?? 0)} · última {kpi.dias_sem_comprar != null ? `${kpi.dias_sem_comprar}d` : '—'}
                </div>
                {ehPrincipal && (
                  <div style={{
                    marginTop: 6, fontSize: fz(12), color: palette.warn, fontWeight: 600,
                    letterSpacing: 0.3, textTransform: 'uppercase',
                  }}>⭐ Documento principal (maior lifetime)</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Botão adicionar CNPJ */}
        <button onClick={onAdicionarCnpj} style={{
          width: '100%', background: 'transparent', border: `1.5px dashed ${palette.beige}`,
          borderRadius: 10, padding: 12, cursor: 'pointer', fontFamily: FONT,
          color: palette.accent, fontSize: fz(15), fontWeight: 600, marginBottom: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <Plus size={sz(17)} /> Adicionar CNPJ ao grupo
        </button>

        {/* Estilo dominante */}
        {estiloDominante && (
          <>
            <SectionTitle icon={Heart}>Estilo dominante</SectionTitle>
            <div style={{
              background: palette.surface, border: `1px solid ${palette.beige}`,
              borderRadius: 10, padding: 12, marginBottom: 16,
            }}>
              <div style={{ fontSize: fz(16), color: palette.ink, fontWeight: 600 }}>
                {estiloDominante}
              </div>
              <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 4 }}>
                Calculado das compras do documento principal
              </div>
            </div>
          </>
        )}

        {/* Mensagens enviadas */}
        <SectionTitle icon={MessageCircle}>Mensagens enviadas (todas as lojas)</SectionTitle>
        {carregandoMsg ? (
          <div style={{
            padding: 16, textAlign: 'center', color: palette.inkMuted, fontSize: fz(14),
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Loader2 size={sz(16)} style={spinKeyframes} /> Carregando…
          </div>
        ) : mensagens.length === 0 ? (
          <div style={{
            padding: 16, textAlign: 'center', color: palette.inkMuted, fontSize: fz(14),
            background: palette.beigeSoft, borderRadius: 10, fontStyle: 'italic',
          }}>
            Nenhuma mensagem enviada ainda pros documentos desse grupo.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {mensagens.map(m => {
              const visual = TIPO_MSG_VISUAL[m.tipo] || TIPO_MSG_VISUAL.followup;
              const Icone = visual.icone;
              const res = RESULTADO_MAP[m.resultado] || RESULTADO_MAP.aguardando;
              const preview = (m.mensagem_gerada || '').slice(0, 100);

              return (
                <div key={m.id} style={{
                  background: palette.surface, border: `1px solid ${palette.beige}`,
                  borderRadius: 10, padding: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Icone size={sz(16)} color={visual.cor} />
                    <span style={{ fontSize: fz(14), color: palette.inkSoft }}>
                      {fmtData(m.executada_em)} · {visual.label}
                    </span>
                  </div>
                  <div style={{ fontSize: fz(12), color: palette.inkMuted, marginBottom: 6 }}>
                    → {nomeClientePorId(m.cliente_id)}
                  </div>
                  {preview && (
                    <div style={{
                      fontSize: fz(15), color: palette.ink, lineHeight: 1.5,
                      fontStyle: 'italic', marginBottom: 8,
                    }}>
                      "{preview}{m.mensagem_gerada?.length > 100 ? '…' : ''}"
                    </div>
                  )}
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', padding: '3px 8px',
                    background: res.soft, color: res.cor, borderRadius: 4,
                    fontSize: fz(13), fontWeight: 600,
                  }}>
                    {res.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer fixo: pedir sugestão */}
      <div style={{
        position: 'sticky', bottom: 0, background: palette.surface,
        borderTop: `1px solid ${palette.beige}`, padding: 12,
        boxShadow: '0 -2px 8px rgba(0,0,0,0.04)',
      }}>
        <button onClick={() => setShowModalMsg(true)} style={{
          background: `linear-gradient(135deg, ${palette.accent} 0%, #3d6b8c 100%)`,
          color: palette.bg, border: 'none', borderRadius: 10,
          padding: '13px 16px', fontSize: fz(16), fontWeight: 600,
          cursor: 'pointer', fontFamily: FONT, width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: '0 2px 6px rgba(74,127,165,0.25)',
        }}>
          <LampIcon size={sz(21)} />
          Pedir sugestão de mensagem
        </button>
      </div>

      {/* Modal de mensagem (avulsa, pra grupo) */}
      {showModalMsg && (
        <ModalMensagem
          lojas={lojas}
          sugestao={null}
          cliente={grupo.documentos.find(d => d.id === grupo.docPrincipalId) || grupo.documentos[0]}
          onClose={() => setShowModalMsg(false)}
          onEnviada={() => setShowModalMsg(false)}
        />
      )}

      {/* Modal Editar grupo (nome + whatsapp) — Ailson 11/05/2026 */}
      {editAberto && (
        <div
          onClick={() => !salvandoEdit && setEditAberto(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, zIndex: 9999,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: palette.surface, borderRadius: 14,
              padding: 22, maxWidth: 440, width: '100%',
              maxHeight: '85vh', overflowY: 'auto',
              fontFamily: FONT,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <Pencil size={sz(20)} color={palette.accent} />
              <div style={{ fontSize: fz(18), fontWeight: 700, color: palette.ink }}>
                Editar grupo
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>
                Nome do grupo (comprador)
              </div>
              <input
                type="text"
                value={editNome}
                onChange={e => setEditNome(e.target.value)}
                autoFocus
                placeholder="Ex: Marisa, Família Souza"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${palette.beige}`, fontFamily: FONT,
                  fontSize: fz(15), color: palette.ink, background: palette.surface,
                  boxSizing: 'border-box', fontWeight: 600,
                }}
              />
            </div>

            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 6 }}>
                WhatsApp do grupo
              </div>
              <input
                type="text"
                value={editWhats}
                onChange={e => setEditWhats(e.target.value)}
                placeholder="Ex: (11) 99999-9999"
                inputMode="tel"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 8,
                  border: `1px solid ${palette.beige}`, fontFamily: FONT,
                  fontSize: fz(14), color: palette.ink, background: palette.surface,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {grupo.documentos.length > 1 && editWhats.replace(/\D/g, '').length >= 10 && (
              <div style={{
                fontSize: fz(11), color: '#8a6d0e', marginBottom: 12, marginTop: 6, lineHeight: 1.4,
                background: '#fdf3cf', padding: '6px 9px', borderRadius: 6,
                border: '1px solid #f0e0a0',
              }}>
                ⚠️ Esse WhatsApp vai sobrescrever em todos os {grupo.documentos.length} CNPJs do grupo
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => setEditAberto(false)}
                disabled={salvandoEdit}
                style={{
                  flex: 1, background: palette.surface, color: palette.inkMuted,
                  border: `1px solid ${palette.beige}`, borderRadius: 8, padding: '12px',
                  fontSize: fz(14), fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
                }}
              >
                Cancelar
              </button>
              <button
                onClick={salvarEditGrupo}
                disabled={salvandoEdit || !editNome.trim()}
                style={{
                  flex: 2,
                  background: editNome.trim() ? palette.accent : palette.beige,
                  color: editNome.trim() ? 'white' : palette.inkMuted,
                  border: 'none', borderRadius: 8, padding: '12px',
                  fontSize: fz(14), fontWeight: 700,
                  cursor: editNome.trim() && !salvandoEdit ? 'pointer' : 'not-allowed',
                  fontFamily: FONT,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                {salvandoEdit ? <><Loader2 size={sz(15)} className="spin"/> Salvando...</> : <><Save size={sz(15)}/> Salvar</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 11. CriarGrupoModal — Wizard 3 steps
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, clienteInicial?, onClose, onCriado }
// Steps: 1=selecionar docs, 2=nome, 3=doc principal (UX, não persiste)
// Escreve: handleSaveGrupo + handleAdicionarAoGrupo (em loop)
//
// Nota: doc_principal é UX-only no MVP (não persistido). O DetalheGrupo
// calcula dinamicamente como o de maior lifetime.
// ═══════════════════════════════════════════════════════════════════════════

export const CriarGrupoModal = ({ lojas, clienteInicial = null, onClose, onCriado }) => {
  const { state, handleSaveGrupo, handleAdicionarAoGrupo, handleEditarTelefone } = lojas;

  const [step, setStep] = useState(1);
  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState(
    clienteInicial ? [clienteInicial.id] : []
  );
  const [nomeGrupo, setNomeGrupo] = useState(clienteInicial?.apelido || '');
  // WhatsApp do grupo (Ailson 11/05/2026) — opcional, sobrescreve telefone
  // de TODOS os CNPJs do grupo. Pre-preenche com o telefone do cliente
  // inicial (se existir).
  const [whatsappGrupo, setWhatsappGrupo] = useState(
    clienteInicial?.telefone_principal || ''
  );
  const [docPadrao, setDocPadrao] = useState(clienteInicial?.id || null);
  const [salvando, setSalvando] = useState(false);

  // Candidatos: clientes da carteira sem grupo ainda
  const candidatos = useMemo(() => {
    return (state.clientes || [])
      .filter(c => !c.grupo_id)
      .filter(c => {
        if (!busca.trim()) return true;
        const termo = busca.toLowerCase();
        const termoNum = busca.replace(/[^0-9]/g, '');
        return (c.razao_social || '').toLowerCase().includes(termo)
          || (c.apelido || '').toLowerCase().includes(termo)
          || (c.nome_fantasia || '').toLowerCase().includes(termo)
          || (termoNum.length >= 3 && (c.documento || '').includes(termoNum));
      });
  }, [state.clientes, busca]);

  const docsSelecionados = useMemo(() => {
    return (state.clientes || []).filter(c => selecionados.includes(c.id));
  }, [state.clientes, selecionados]);

  // Quando docs mudam e doc principal não tá entre eles, escolher um automaticamente
  useEffect(() => {
    if (docPadrao && !selecionados.includes(docPadrao)) {
      setDocPadrao(selecionados[0] || null);
    }
    if (!docPadrao && selecionados.length > 0) {
      setDocPadrao(selecionados[0]);
    }
  }, [selecionados, docPadrao]);

  const podeAvancar = useMemo(() => {
    if (step === 1) return selecionados.length >= 2;
    if (step === 2) return nomeGrupo.trim().length > 0;
    return true;
  }, [step, selecionados, nomeGrupo]);

  const criar = async () => {
    setSalvando(true);
    try {
      const vendedoraIdSugerida = state.vendedoraAtiva?.id
        || state.vendedoraLogada?.id
        || docsSelecionados[0]?.vendedora_id
        || null;

      const grupoSalvo = await handleSaveGrupo({
        nome_grupo: nomeGrupo.trim(),
        vendedora_id: vendedoraIdSugerida,
      });

      for (const clienteId of selecionados) {
        await handleAdicionarAoGrupo(clienteId, grupoSalvo.id);
      }

      // WhatsApp do grupo — Ailson 11/05/2026: aplica em TODOS os CNPJs
      // selecionados (sobrescreve se ja tiver). Normaliza pra so digitos.
      const whatsappLimpo = String(whatsappGrupo || '').replace(/\D/g, '');
      if (whatsappLimpo.length >= 10 && handleEditarTelefone) {
        for (const clienteId of selecionados) {
          try {
            await handleEditarTelefone(clienteId, whatsappLimpo);
          } catch (e) {
            console.warn(`[criar-grupo] erro telefone cliente ${clienteId}:`, e?.message);
          }
        }
      }

      // TODO: Doc principal não persiste (calculado como maior lifetime)
      onCriado(grupoSalvo);
    } catch (e) {
      alert('Erro ao criar grupo: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      padding: 16, fontFamily: FONT,
    }} onClick={() => !salvando && onClose()}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.surface, borderRadius: 16, padding: 0,
        width: '100%', maxWidth: 460, maxHeight: '90vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header com breadcrumb */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${palette.beige}` }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, background: palette.accentSoft,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <UsersRound size={sz(21)} color={palette.accent} />
              </div>
              <div style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink }}>
                Criar grupo de cliente
              </div>
            </div>
            <button onClick={() => !salvando && onClose()} disabled={salvando} style={{
              background: 'transparent', border: 'none',
              cursor: salvando ? 'wait' : 'pointer',
              color: palette.inkMuted, padding: 4,
            }}>
              <X size={sz(23)} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3].map(s => (
              <div key={s} style={{
                flex: 1, height: 4, borderRadius: 2,
                background: s <= step ? palette.accent : palette.beige,
                transition: 'background 0.2s',
              }} />
            ))}
          </div>
          <div style={{ fontSize: fz(13), color: palette.inkMuted, marginTop: 6 }}>
            Passo {step} de 3 · {step === 1 ? 'Selecionar documentos' : step === 2 ? 'Nome do grupo' : 'Documento principal'}
          </div>
        </div>

        {/* Conteúdo */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>

          {step === 1 && (
            <>
              <div style={{ fontSize: fz(15), color: palette.inkSoft, marginBottom: 12, lineHeight: 1.5 }}>
                Marque os CNPJs/CPFs que pertencem ao mesmo dono. Eles vão virar 1 grupo.
              </div>

              <div style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 10, padding: '8px 12px', marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <Search size={sz(16)} color={palette.inkMuted} />
                <input value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar nome, CNPJ ou razão"
                  style={{
                    flex: 1, border: 'none', background: 'transparent', outline: 'none',
                    fontFamily: FONT, fontSize: fz(15), color: palette.ink,
                  }} />
              </div>

              <div style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                maxHeight: 300, overflowY: 'auto',
              }}>
                {/* Já selecionados — mostra SEMPRE, não filtra pela busca.
                    Decisão Ailson 28/04/2026: ao marcar 1º cliente e digitar
                    pra buscar o 2º, o filtro escondia o já marcado, gerando
                    confusão. Agora os marcados ficam fixos no topo, separados
                    por uma linha sutil. */}
                {docsSelecionados.length > 0 && busca.trim() && (
                  <>
                    <div style={{
                      fontSize: fz(12), fontWeight: 600, color: palette.inkMuted,
                      textTransform: 'uppercase', letterSpacing: 0.5,
                      marginTop: 2, marginBottom: 2,
                    }}>
                      Já selecionados ({docsSelecionados.length})
                    </div>
                    {docsSelecionados.map(c => {
                      const kpi = state.clientesKpis?.[c.id] || {};
                      return (
                        <button key={`sel-${c.id}`} onClick={() => {
                          setSelecionados(selecionados.filter(id => id !== c.id));
                        }} style={{
                          background: palette.accentSoft,
                          border: `1.5px solid ${palette.accent}`,
                          borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                          fontFamily: FONT, textAlign: 'left',
                          display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: 4,
                            border: `1.5px solid ${palette.accent}`,
                            background: palette.accent,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            <Check size={sz(14)} color={palette.bg} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: fz(15), fontWeight: 600, color: palette.ink,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {nomeCliente(c)}
                            </div>
                            <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 2 }}>
                              {fmtMoeda(kpi.lifetime_total ?? 0)} · {kpi.qtd_compras ?? 0} compra{(kpi.qtd_compras ?? 0) !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    <div style={{
                      height: 1, background: palette.beige, margin: '8px 0',
                    }} />
                    <div style={{
                      fontSize: fz(12), fontWeight: 600, color: palette.inkMuted,
                      textTransform: 'uppercase', letterSpacing: 0.5,
                      marginBottom: 2,
                    }}>
                      Resultados da busca
                    </div>
                  </>
                )}

                {candidatos.length === 0 && (
                  <div style={{
                    padding: 16, textAlign: 'center', color: palette.inkMuted, fontSize: fz(14),
                    background: palette.beigeSoft, borderRadius: 8,
                  }}>
                    {busca ? `Nenhum cliente encontrado pra "${busca}"` : 'Nenhum cliente disponível na sua carteira (todos já estão em grupos).'}
                  </div>
                )}
                {candidatos
                  // Quando há busca + já selecionados, esconde os já-selecionados
                  // do bloco "Resultados" pra não duplicar visualmente
                  .filter(c => !(busca.trim() && selecionados.includes(c.id)))
                  .map(c => {
                  const sel = selecionados.includes(c.id);
                  const kpi = state.clientesKpis?.[c.id] || {};
                  return (
                    <button key={c.id} onClick={() => {
                      setSelecionados(sel
                        ? selecionados.filter(id => id !== c.id)
                        : [...selecionados, c.id]);
                    }} style={{
                      background: sel ? palette.accentSoft : palette.surface,
                      border: `1.5px solid ${sel ? palette.accent : palette.beige}`,
                      borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                      fontFamily: FONT, textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <div style={{
                        width: 18, height: 18, borderRadius: 4,
                        border: `1.5px solid ${sel ? palette.accent : palette.beige}`,
                        background: sel ? palette.accent : palette.surface,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        {sel && <Check size={sz(14)} color={palette.bg} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: fz(15), fontWeight: 600, color: palette.ink,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {nomeCliente(c)}
                        </div>
                        {c.apelido && c.razao_social && (
                          <div style={{
                            fontSize: fz(13), color: palette.inkMuted, marginTop: 1,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {c.razao_social}
                          </div>
                        )}
                        <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 2 }}>
                          {fmtMoeda(kpi.lifetime_total ?? 0)} · {kpi.qtd_compras ?? 0} compra{(kpi.qtd_compras ?? 0) !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selecionados.length > 0 && (
                <div style={{
                  marginTop: 12, padding: 10, background: palette.accentSoft,
                  borderRadius: 8, fontSize: fz(14), color: palette.ink,
                }}>
                  <strong>{selecionados.length}</strong> documento{selecionados.length !== 1 ? 's' : ''} selecionado{selecionados.length !== 1 ? 's' : ''}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div style={{ fontSize: fz(15), color: palette.inkSoft, marginBottom: 12, lineHeight: 1.5 }}>
                Como vc quer chamar esse grupo? Esse nome aparece pra vc na carteira e nas sugestões.
              </div>
              <input
                autoFocus value={nomeGrupo} onChange={e => setNomeGrupo(e.target.value)}
                placeholder="Ex: Marisa, Família Souza"
                style={{ ...inputStyle, fontSize: fz(18), padding: '14px 16px', marginBottom: 12 }}
              />

              {/* WhatsApp do grupo (Ailson 11/05/2026) — opcional, sobrescreve todos */}
              <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                WhatsApp (opcional)
              </div>
              <input
                value={whatsappGrupo}
                onChange={e => setWhatsappGrupo(e.target.value)}
                placeholder="Ex: (11) 99999-9999"
                inputMode="tel"
                style={{ ...inputStyle, fontSize: fz(15), padding: '11px 14px', marginBottom: 6 }}
              />
              {selecionados.length > 1 && whatsappGrupo.replace(/\D/g, '').length >= 10 && (
                <div style={{
                  fontSize: fz(11), color: '#8a6d0e', marginBottom: 12, lineHeight: 1.4,
                  background: '#fdf3cf', padding: '6px 9px', borderRadius: 6,
                  border: '1px solid #f0e0a0',
                }}>
                  ⚠️ Esse WhatsApp vai sobrescrever o atual em todos os {selecionados.length} CNPJs do grupo
                </div>
              )}

              <div style={{
                padding: 12, background: palette.beigeSoft, borderRadius: 8,
                fontSize: fz(13), color: palette.inkSoft, lineHeight: 1.5,
                marginTop: 6,
              }}>
                💡 <strong>Dica:</strong> use o nome de quem atende, não o nome da loja (a loja varia).
              </div>

              <div style={{ marginTop: 16, fontSize: fz(13), color: palette.inkMuted, marginBottom: 6 }}>
                Documentos que vão pro grupo:
              </div>
              <div style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 8, padding: 8,
              }}>
                {docsSelecionados.map(d => (
                  <div key={d.id} style={{
                    fontSize: fz(14), color: palette.inkSoft, padding: '4px 0',
                    display: 'flex', alignItems: 'center', gap: 6,
                  }}>
                    <Store size={sz(13)} color={palette.inkMuted} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {nomeCliente(d)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ fontSize: fz(15), color: palette.inkSoft, marginBottom: 12, lineHeight: 1.5 }}>
                Qual documento é o "principal" do grupo? Geralmente é a matriz ou o que mais compra.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {docsSelecionados.map(d => {
                  const isPadrao = docPadrao === d.id;
                  const kpi = state.clientesKpis?.[d.id] || {};
                  return (
                    <button key={d.id} onClick={() => setDocPadrao(d.id)} style={{
                      background: isPadrao ? palette.warnSoft : palette.surface,
                      border: `1.5px solid ${isPadrao ? palette.warn : palette.beige}`,
                      borderRadius: 8, padding: '12px 14px', cursor: 'pointer',
                      fontFamily: FONT, textAlign: 'left',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}>
                      <Crown size={sz(18)} color={isPadrao ? palette.warn : palette.beige} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: fz(15), fontWeight: 600, color: palette.ink,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {nomeCliente(d)}
                        </div>
                        <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 2 }}>
                          {fmtMoeda(kpi.lifetime_total ?? 0)} · {kpi.qtd_compras ?? 0} compra{(kpi.qtd_compras ?? 0) !== 1 ? 's' : ''}
                        </div>
                      </div>
                      {isPadrao && (
                        <span style={{
                          fontSize: fz(10), fontWeight: 600, padding: '3px 7px', borderRadius: 4,
                          background: palette.warn, color: palette.bg,
                          letterSpacing: 0.3, textTransform: 'uppercase', flexShrink: 0,
                        }}>Principal</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div style={{
                marginTop: 16, padding: 12, background: palette.accentSoft,
                borderRadius: 8, fontSize: fz(14), color: palette.ink, lineHeight: 1.6,
              }}>
                ✨ <strong>Resumo:</strong><br/>
                Grupo "<strong>{nomeGrupo}</strong>" com <strong>{docsSelecionados.length}</strong> documentos.<br/>
                A IA vai gerar 1 sugestão pro grupo todo (não por CNPJ).
              </div>

              <div style={{
                marginTop: 8, padding: 10, background: palette.beigeSoft, borderRadius: 8,
                fontSize: fz(12), color: palette.inkMuted, lineHeight: 1.5,
              }}>
                ℹ️ Por enquanto, o documento principal é UX-only e calculado automaticamente como o de maior lifetime no DetalheGrupo.
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: 16, borderTop: `1px solid ${palette.beige}`,
          display: 'flex', gap: 8,
        }}>
          {step > 1 && (
            <button onClick={() => setStep(step - 1)} disabled={salvando} style={{
              flex: 1, background: palette.surface, color: palette.inkSoft,
              border: `1.5px solid ${palette.beige}`, borderRadius: 10, padding: '12px',
              fontSize: fz(15), cursor: salvando ? 'wait' : 'pointer',
              fontFamily: FONT, fontWeight: 600,
            }}>Voltar</button>
          )}
          {step < 3 ? (
            <button onClick={() => setStep(step + 1)} disabled={!podeAvancar} style={{
              flex: 2,
              background: !podeAvancar ? palette.beige : palette.accent,
              color: palette.bg, border: 'none', borderRadius: 10, padding: '12px',
              fontSize: fz(15), fontWeight: 600,
              cursor: !podeAvancar ? 'not-allowed' : 'pointer',
              fontFamily: FONT,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
              Próximo <ChevronRight size={sz(17)} />
            </button>
          ) : (
            <button onClick={criar} disabled={salvando} style={{
              ...btnPrimario(palette.ok, salvando), flex: 2,
            }}>
              {salvando
                ? <><Loader2 size={sz(17)} style={spinKeyframes} /> Criando…</>
                : <><Check size={sz(17)} /> Criar grupo</>}
            </button>
          )}
        </div>

        {step === 1 && selecionados.length === 1 && (
          <div style={{
            padding: '0 16px 12px', fontSize: fz(13), color: palette.inkMuted, textAlign: 'center',
          }}>
            Selecione pelo menos 2 documentos pra formar um grupo
          </div>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// 12. AdicionarCnpjModal — Modal simples
// ═══════════════════════════════════════════════════════════════════════════
//
// Props: { lojas, grupo, onClose, onAdicionado }
// Adiciona N CNPJs ao grupo existente
// ═══════════════════════════════════════════════════════════════════════════

export const AdicionarCnpjModal = ({ lojas, grupo, onClose, onAdicionado }) => {
  const { state, handleAdicionarAoGrupo } = lojas;

  const [busca, setBusca] = useState('');
  const [selecionados, setSelecionados] = useState([]);
  const [salvando, setSalvando] = useState(false);

  const candidatos = useMemo(() => {
    return (state.clientes || [])
      .filter(c => !c.grupo_id)
      .filter(c => {
        if (!busca.trim()) return true;
        const termo = busca.toLowerCase();
        const termoNum = busca.replace(/[^0-9]/g, '');
        return (c.razao_social || '').toLowerCase().includes(termo)
          || (c.apelido || '').toLowerCase().includes(termo)
          || (termoNum.length >= 3 && (c.documento || '').includes(termoNum));
      });
  }, [state.clientes, busca]);

  const adicionar = async () => {
    if (selecionados.length === 0) return;
    setSalvando(true);
    try {
      for (const clienteId of selecionados) {
        await handleAdicionarAoGrupo(clienteId, grupo.id);
      }
      onAdicionado();
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(44,62,80,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
      padding: 16, fontFamily: FONT,
    }} onClick={() => !salvando && onClose()}>
      <div onClick={e => e.stopPropagation()} style={{
        background: palette.surface, borderRadius: 16, padding: 0,
        width: '100%', maxWidth: 460, maxHeight: '85vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${palette.beige}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: fz(17), fontWeight: 600, color: palette.ink }}>
              Adicionar CNPJ
            </div>
            <div style={{
              fontSize: fz(13), color: palette.inkMuted, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              Ao grupo "{grupo.nome_grupo}"
            </div>
          </div>
          <button onClick={() => !salvando && onClose()} disabled={salvando} style={{
            background: 'transparent', border: 'none',
            cursor: salvando ? 'wait' : 'pointer',
            color: palette.inkMuted, padding: 4, flexShrink: 0,
          }}>
            <X size={sz(23)} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          <div style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 10, padding: '8px 12px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Search size={sz(16)} color={palette.inkMuted} />
            <input autoFocus value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar CNPJ, CPF ou razão"
              style={{
                flex: 1, border: 'none', background: 'transparent', outline: 'none',
                fontFamily: FONT, fontSize: fz(15), color: palette.ink,
              }} />
          </div>

          <div style={{ fontSize: fz(13), color: palette.inkMuted, marginBottom: 8 }}>
            {candidatos.length} CNPJ{candidatos.length !== 1 ? 's' : ''} disponível{candidatos.length !== 1 ? 'is' : ''} na sua carteira
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {candidatos.length === 0 && (
              <div style={{
                padding: 16, textAlign: 'center', color: palette.inkMuted, fontSize: fz(14),
                background: palette.beigeSoft, borderRadius: 8,
              }}>
                {busca ? `Nenhum cliente encontrado pra "${busca}"` : 'Todos os clientes da carteira já estão em grupos.'}
              </div>
            )}
            {candidatos.map(c => {
              const sel = selecionados.includes(c.id);
              const kpi = state.clientesKpis?.[c.id] || {};
              return (
                <button key={c.id} onClick={() => {
                  setSelecionados(sel
                    ? selecionados.filter(id => id !== c.id)
                    : [...selecionados, c.id]);
                }} style={{
                  background: sel ? palette.accentSoft : palette.surface,
                  border: `1.5px solid ${sel ? palette.accent : palette.beige}`,
                  borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                  fontFamily: FONT, textAlign: 'left',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 4,
                    border: `1.5px solid ${sel ? palette.accent : palette.beige}`,
                    background: sel ? palette.accent : palette.surface,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {sel && <Check size={sz(14)} color={palette.bg} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: fz(15), fontWeight: 600, color: palette.ink,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {nomeCliente(c)}
                    </div>
                    {c.apelido && c.razao_social && (
                      <div style={{
                        fontSize: fz(13), color: palette.inkMuted, marginTop: 1,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {c.razao_social}
                      </div>
                    )}
                    <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 2 }}>
                      {fmtMoeda(kpi.lifetime_total ?? 0)} · {kpi.qtd_compras ?? 0} compra{(kpi.qtd_compras ?? 0) !== 1 ? 's' : ''}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{
          padding: 16, borderTop: `1px solid ${palette.beige}`,
          display: 'flex', gap: 8,
        }}>
          <button onClick={() => !salvando && onClose()} disabled={salvando} style={btnCancelar}>
            Cancelar
          </button>
          <button onClick={adicionar}
            disabled={salvando || selecionados.length === 0}
            style={{
              ...btnPrimario(palette.ok, salvando),
              background: selecionados.length === 0 ? palette.beige
                : (salvando ? palette.beige : palette.ok),
              cursor: selecionados.length === 0 ? 'not-allowed'
                : (salvando ? 'wait' : 'pointer'),
            }}>
            {salvando
              ? <><Loader2 size={sz(17)} style={spinKeyframes} /> Adicionando…</>
              : <><Link2 size={sz(17)} /> Adicionar{selecionados.length > 0 ? ` (${selecionados.length})` : ''}</>}
          </button>
        </div>
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// CoresPainel — sub-painel da CuradoriaScreen quando aba=cores
// ═══════════════════════════════════════════════════════════════════════════
//
// Mostra cores do TOP BLING (vw_ranking_cores_catalogo) + cores manuais.
// Cada cor é CLICAVEL: clicar marca como "ativa pra IA usar nas mensagens".
// Padrao visual igual ao modulo Oficinas (chips com bolinha colorida real).
//
// Mapeamento de hex: tenta primeiro localStorage 'amica_bling_cores_top'
// (sincronizado pelo Bling Produtos), depois fallback hardcoded baseado
// no nome.

// Fallback hardcoded — copia de CORES_RANKING_FALLBACK do OrdemDeCorte.jsx
const COR_HEX_FALLBACK = {
  'preto': '#1a1a1a',
  'bege': '#d4c4a4',
  'marrom': '#5c3a20',
  'figo': '#6b3a4c',
  'azul marinho': '#1c2e4a',
  'caramelo': '#a8743b',
  'verde militar': '#4a5d3a',
  'nude': '#e8c8b0',
  'azul serenity': '#91a8d0',
  'marrom escuro': '#3d2418',
  'verde sálvia': '#87a96b',
  'verde salvia': '#87a96b',
  'azul claro': '#a8c8e0',
  'vinho': '#5c1a2e',
  'bege claro': '#ebdcc0',
  'mocaccino': '#6f4e37',
  'creme': '#f5f0d6',
  'branco': '#fafafa',
  'verde água': '#9ce0d8',
  'verde agua': '#9ce0d8',
  'verde oliva': '#7a8b3a',
  'amarelo': '#f5d040',
  'vermelho': '#c0392b',
  'rosa': '#e88aa3',
  'rosê': '#d8a4b0',
  'rose': '#d8a4b0',
  'lilás': '#b89dd0',
  'lilas': '#b89dd0',
  'cinza': '#888888',
  'azul': '#3a6bb5',
  'verde': '#5a8a4a',
  'laranja': '#e08a3a',
  'roxo': '#7a3aa0',
  'off-white': '#f5f1e8',
  'off white': '#f5f1e8',
  'pink': '#ee5599',
  'turquesa': '#3ac0b8',
};

function hexDaCor(nome) {
  if (!nome) return '#999';
  const k = String(nome).toLowerCase().trim();
  // Tenta localStorage primeiro (Bling Produtos sincronizado)
  try {
    const raw = localStorage.getItem('amica_bling_cores_top');
    if (raw) {
      const d = JSON.parse(raw);
      const lista = d?.cores || [];
      const found = lista.find(c => String(c.nome).toLowerCase().trim() === k);
      if (found?.hex) return found.hex;
    }
  } catch {}
  return COR_HEX_FALLBACK[k] || '#999';
}

const CoresPainel = ({ lojas }) => {
  const { state, handleAdicionarCorManual, handleRemoverCorManual, handleToggleCorIgnorada } = lojas;
  const [novaCor, setNovaCor] = useState('');
  const [novoMotivo, setNovoMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [removendoId, setRemovendoId] = useState(null);

  const corAuto = state.coresAuto || [];
  const corManual = state.coresManuais || [];

  const adicionarManualLivre = async () => {
    const cor = novaCor.trim();
    if (cor.length < 2) {
      alert('Digite o nome da cor (ex: Bordô)');
      return;
    }
    setSalvando(true);
    try {
      await handleAdicionarCorManual({ cor, motivo: novoMotivo.trim() || null });
      setNovaCor('');
      setNovoMotivo('');
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  // Set de cor_keys ATIVAS (opt-in). Cor do Top Bling NAO entra pra IA por
  // padrao — admin precisa clicar pra ativar (vira entrada manual com
  // motivo='top_bling_selecionada'). Clica de novo, remove.
  const ativasSet = new Set((state.coresManuais || []).map(c => c.cor_key));

  // Toggle: se cor está ativa, remove; se não, adiciona como manual.
  const toggleCor = async (corObj) => {
    if (!corObj) return;
    const rawKey = corObj.cor_key || corObj.cor || '';
    const cor_key = String(rawKey).toLowerCase().trim();
    const cor_bonita = corObj.cor || corObj.cor_key || '';
    if (!cor_key) return;

    const jaAtiva = ativasSet.has(cor_key);
    try {
      if (jaAtiva) {
        // Remove: acha o id na lista manual e deleta
        const item = (state.coresManuais || []).find(c => c.cor_key === cor_key);
        if (item) await handleRemoverCorManual(item.id);
      } else {
        // Adiciona: marker 'top_bling_selecionada' pra distinguir das
        // cores manuais "livres" (digitadas pelo usuário com motivo proprio)
        await handleAdicionarCorManual({ cor: cor_bonita, motivo: 'top_bling_selecionada' });
      }
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    }
  };

  // Renderiza chip de cor estilo OrdemDeCorte (bolinha + nome) — clicável.
  // Default: desmarcada (chip neutro). Clicado: ativa (destacada com check).
  const renderChipCor = (cor, idx, fonte) => {
    if (!cor) return null;
    const rawKey = cor.cor_key || cor.cor || '';
    const cor_key = String(rawKey).toLowerCase().trim();
    const nomeBonito = cor.cor || cor.cor_key || '?';
    if (!cor_key) return null;
    const ativa = ativasSet.has(cor_key);
    const hex = hexDaCor(nomeBonito);
    const ehManualLivre = fonte === 'manual';

    return (
      <button
        key={cor_key}
        type="button"
        onClick={() => toggleCor(cor)}
        title={ativa ? 'Clique pra desativar (IA não usa mais)' : 'Clique pra ativar (IA pode usar)'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 11px', borderRadius: 18,
          background: ativa ? palette.purpleSoft : palette.surface,
          border: `${ativa ? 2 : 1}px solid ${ativa ? palette.purple : palette.beige}`,
          cursor: 'pointer', fontFamily: FONT, fontSize: fz(13),
          color: palette.ink,
          fontWeight: ativa ? 600 : 400,
          transition: 'all 0.15s ease',
        }}
      >
        <span style={{
          width: 12, height: 12, borderRadius: '50%',
          background: hex, flexShrink: 0,
          border: `1px solid ${palette.beige}`,
        }} />
        {nomeBonito}
        {idx != null && (
          <span style={{ fontSize: fz(10), color: palette.inkMuted, fontWeight: 400 }}>
            #{idx}
          </span>
        )}
        {ativa && <Check size={sz(13)} color={palette.purple} />}
        {ehManualLivre && (
          <Trash2
            size={sz(11)}
            color={palette.inkMuted}
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`Remover "${nomeBonito}" da lista manual?`)) {
                const item = corManual.find(c => c.cor_key === cor_key);
                if (item) handleRemoverCorManual(item.id);
              }
            }}
          />
        )}
      </button>
    );
  };


  return (
    <div style={{ marginTop: 16 }}>
      {/* Box info topo */}
      <div style={{
        padding: 12, background: palette.purpleSoft, borderRadius: 8,
        borderLeft: `3px solid ${palette.purple}`, marginBottom: 16,
        fontSize: fz(13), color: palette.inkSoft, lineHeight: 1.5,
      }}>
        Clique nas cores que a IA pode usar nas mensagens (mesmo sem REF específica).
        Ex: "Chegaram vários modelos de Marrom, tá saindo muito!"
        <br />
        <strong>Top Bling</strong> traz cores em alta automaticamente — clique pra ativar as que quiser. <strong>Manual</strong> é sua adição livre.
      </div>

      {/* Form adicionar cor manual livre */}
      <div style={{
        background: palette.beigeSoft, border: `1px solid ${palette.beige}`,
        borderRadius: 10, padding: 14, marginBottom: 16,
      }}>
        <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.ink, marginBottom: 8 }}>
          + Adicionar cor manual
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            value={novaCor}
            onChange={(e) => setNovaCor(e.target.value)}
            placeholder="Nome da cor (ex: Bordô, Oliva)"
            style={{
              flex: 1, padding: 10, border: `1px solid ${palette.beige}`,
              borderRadius: 6, fontFamily: FONT, fontSize: fz(14), background: palette.surface,
            }}
          />
          <button
            onClick={adicionarManualLivre}
            disabled={salvando || novaCor.trim().length < 2}
            style={{
              background: salvando || novaCor.trim().length < 2 ? palette.beige : palette.ok,
              color: 'white', border: 'none', padding: '10px 16px',
              borderRadius: 6, cursor: salvando ? 'wait' : 'pointer',
              fontFamily: FONT, fontSize: fz(13), fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {salvando ? <><Loader2 size={sz(15)} style={spinKeyframes} /> Salvando…</> : <><Plus size={sz(15)} /> Adicionar</>}
          </button>
        </div>
        <input
          type="text"
          value={novoMotivo}
          onChange={(e) => setNovoMotivo(e.target.value)}
          placeholder="Motivo opcional (ex: Lançamento estação)"
          style={{
            width: '100%', padding: 10, border: `1px solid ${palette.beige}`,
            borderRadius: 6, fontFamily: FONT, fontSize: fz(13), background: palette.surface,
          }}
        />
      </div>

      {/* Lista TOP Bling — clicável */}
      <div style={{
        fontSize: fz(13), fontWeight: 600, color: palette.accent,
        marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Palette size={sz(15)} /> Top Bling — automático ({corAuto.length})
      </div>
      {corAuto.length === 0 ? (
        <div style={{
          padding: 24, textAlign: 'center', color: palette.inkMuted,
          fontSize: fz(13), background: palette.surface,
          border: `1px dashed ${palette.beige}`, borderRadius: 10, marginBottom: 16,
        }}>
          Nenhuma cor disponível. Verifique vw_ranking_cores_catalogo no Supabase.
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
          {corAuto.map((c, i) => renderChipCor(c, i + 1, 'auto'))}
        </div>
      )}

      {/* Lista manual (cores adicionadas livremente — não vêm do Bling) */}
      {corManual.filter(c => c.motivo !== 'top_bling_selecionada').length > 0 && (
        <>
          <div style={{
            fontSize: fz(13), fontWeight: 600, color: palette.purple,
            marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5,
          }}>
            ✋ Manual ({corManual.filter(c => c.motivo !== 'top_bling_selecionada').length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {corManual
              .filter(c => c.motivo !== 'top_bling_selecionada')
              .map(c => renderChipCor(c, null, 'manual'))}
          </div>
        </>
      )}
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// AcoesScreen — Mensagens contextuais por período
// ═══════════════════════════════════════════════════════════════════════════
//
// IA INCORPORA o texto natural nas sugestões durante o período. Não
// consome slot. Ex: "feliz dia das mulheres", "loja fecha mais cedo".
//
const PLACEHOLDER_ACAO = 'Digite a mensagem...';

export const AcoesScreen = ({ lojas, onBack }) => {
  const { state, handleSalvarAcao, handleRemoverAcao } = lojas;
  const [texto, setTexto] = useState('');
  const [dataInicio, setDataInicio] = useState(() => new Date().toISOString().slice(0, 10));
  const [dataFim, setDataFim] = useState(() => new Date().toISOString().slice(0, 10));
  const [salvando, setSalvando] = useState(false);
  const [removendoId, setRemovendoId] = useState(null);

  const acoes = state.acoes || [];

  const salvar = async () => {
    if (texto.trim().length < 3) {
      alert('Digite o texto da ação (mínimo 3 caracteres)');
      return;
    }
    if (dataFim < dataInicio) {
      alert('Data fim não pode ser antes da data início');
      return;
    }
    setSalvando(true);
    try {
      await handleSalvarAcao({
        texto: texto.trim(),
        data_inicio: dataInicio,
        data_fim: dataFim,
        ativa: true,
      });
      setTexto('');
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (acao) => {
    if (!confirm(`Remover ação "${acao.texto.slice(0, 60)}..."?`)) return;
    setRemovendoId(acao.id);
    try {
      await handleRemoverAcao(acao.id);
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setRemovendoId(null);
    }
  };

  const hoje = new Date().toISOString().slice(0, 10);
  const acoesVigentes = acoes.filter(a => a.ativa && a.data_inicio <= hoje && a.data_fim >= hoje);
  const acoesFuturas = acoes.filter(a => a.data_inicio > hoje);
  const acoesPassadas = acoes.filter(a => a.data_fim < hoje);

  const renderCard = (acao) => {
    const removendo = removendoId === acao.id;
    return (
      <div key={acao.id} style={{
        background: palette.surface, border: `1px solid ${palette.beige}`,
        borderLeft: `3px solid ${palette.purple}`,
        borderRadius: 10, padding: 12, marginBottom: 8,
      }}>
        <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          📅 {fmtData(acao.data_inicio)} → {fmtData(acao.data_fim)}
        </div>
        <div style={{ fontSize: fz(14), color: palette.ink, fontStyle: 'italic', marginBottom: 8 }}>
          "{acao.texto}"
        </div>
        <button onClick={() => remover(acao)} disabled={removendo} style={{
          background: 'transparent', border: `1px solid ${palette.alertSoft}`,
          color: palette.alert, padding: '4px 10px', borderRadius: 4,
          cursor: removendo ? 'wait' : 'pointer', fontFamily: FONT, fontSize: fz(11),
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          {removendo ? <Loader2 size={sz(13)} style={spinKeyframes} /> : <Trash2 size={sz(13)} />}
          Excluir
        </button>
      </div>
    );
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title="Ações & contextos"
        subtitle="Mensagens que a IA incorpora nas sugestões"
        onBack={onBack}
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>

        {/* Box explicativo */}
        <div style={{
          padding: 12, background: palette.purpleSoft, borderRadius: 8,
          borderLeft: `3px solid ${palette.purple}`, marginBottom: 16,
          fontSize: fz(13), color: palette.inkSoft, lineHeight: 1.5,
        }}>
          <strong>Ações</strong> são mensagens contextuais que a IA <em>incorpora</em> nas sugestões durante o período. Não consome slot.<br/>
          Diferente de <strong>Avisos</strong> (disparo único pra UMA vendedora) e <strong>Promoções</strong> (preço/desconto).
        </div>

        {/* Form criar */}
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderRadius: 10, padding: 14, marginBottom: 20,
        }}>
          <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.ink, marginBottom: 10 }}>
            + Nova ação
          </div>

          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={PLACEHOLDER_ACAO}
            rows={3}
            style={{
              width: '100%', padding: 10, border: `1px solid ${palette.beige}`,
              borderRadius: 6, fontFamily: FONT, fontSize: fz(14),
              background: palette.surface, color: palette.ink,
              resize: 'vertical', marginBottom: 10,
            }}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: fz(11), color: palette.inkSoft, marginBottom: 4 }}>Data início</label>
              <input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                style={{
                  width: '100%', padding: 8, border: `1px solid ${palette.beige}`,
                  borderRadius: 6, fontFamily: FONT, fontSize: fz(13), background: palette.surface,
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: fz(11), color: palette.inkSoft, marginBottom: 4 }}>Data fim</label>
              <input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                style={{
                  width: '100%', padding: 8, border: `1px solid ${palette.beige}`,
                  borderRadius: 6, fontFamily: FONT, fontSize: fz(13), background: palette.surface,
                }}
              />
            </div>
          </div>

          <button
            onClick={salvar}
            disabled={salvando || texto.trim().length < 3}
            style={{
              width: '100%',
              background: salvando || texto.trim().length < 3 ? palette.beige : palette.purple,
              color: 'white', border: 'none', padding: 11, borderRadius: 6,
              cursor: salvando ? 'wait' : 'pointer',
              fontFamily: FONT, fontSize: fz(14), fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {salvando ? <><Loader2 size={sz(15)} style={spinKeyframes} /> Salvando…</> : <><Megaphone size={sz(15)} /> Criar ação</>}
          </button>
        </div>

        {/* Vigentes */}
        <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.purple, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          ⏱ Vigentes hoje ({acoesVigentes.length})
        </div>
        {acoesVigentes.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: palette.inkMuted, fontSize: fz(13), background: palette.surface, border: `1px dashed ${palette.beige}`, borderRadius: 8, marginBottom: 16 }}>
            Nenhuma ação vigente
          </div>
        ) : (
          <div style={{ marginBottom: 20 }}>{acoesVigentes.map(renderCard)}</div>
        )}

        {/* Futuras */}
        {acoesFuturas.length > 0 && (
          <>
            <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.inkSoft, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              📆 Programadas ({acoesFuturas.length})
            </div>
            <div style={{ marginBottom: 20 }}>{acoesFuturas.map(renderCard)}</div>
          </>
        )}

        {/* Passadas (collapsed) */}
        {acoesPassadas.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary style={{
              cursor: 'pointer', fontSize: fz(13), color: palette.inkMuted,
              padding: 8, userSelect: 'none',
            }}>
              📜 Histórico ({acoesPassadas.length})
            </summary>
            <div style={{ marginTop: 8 }}>{acoesPassadas.slice(0, 10).map(renderCard)}</div>
          </details>
        )}
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// AvisosScreen — disparo único pra vendedora
// ═══════════════════════════════════════════════════════════════════════════
//
// Vira a 1ª sugestão do dia da(s) vendedora(s) alvo. Após o cron daquele
// dia, status muda pra consumido.
//
const PLACEHOLDER_AVISO = 'Digite o aviso...';

export const AvisosScreen = ({ lojas, onBack }) => {
  const { state, handleSalvarAviso, handleRemoverAviso } = lojas;
  const [texto, setTexto] = useState('');
  const [dataDisparo, setDataDisparo] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1); // amanhã por padrão
    return d.toISOString().slice(0, 10);
  });
  const [vendedorasIds, setVendedorasIds] = useState([]);  // [] = todas
  const [salvando, setSalvando] = useState(false);
  const [removendoId, setRemovendoId] = useState(null);

  const avisos = state.avisos || [];
  const vendedorasAtivas = (state.vendedoras || []).filter(v => v.ativa && !v.is_placeholder);

  const toggleVend = (vid) => {
    setVendedorasIds(prev =>
      prev.includes(vid) ? prev.filter(x => x !== vid) : [...prev, vid]
    );
  };

  const salvar = async () => {
    if (texto.trim().length < 3) {
      alert('Digite o texto do aviso (mínimo 3 caracteres)');
      return;
    }
    setSalvando(true);
    try {
      await handleSalvarAviso({
        texto: texto.trim(),
        data_disparo: dataDisparo,
        vendedoras_ids: vendedorasIds.length > 0 ? vendedorasIds : null,
      });
      setTexto('');
      setVendedorasIds([]);
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  const remover = async (aviso) => {
    if (!confirm(`Remover aviso "${aviso.texto.slice(0, 60)}..."?`)) return;
    setRemovendoId(aviso.id);
    try {
      await handleRemoverAviso(aviso.id);
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setRemovendoId(null);
    }
  };

  const nomeVendedora = (vid) => {
    const v = vendedorasAtivas.find(v => v.id === vid);
    return v ? v.nome : '?';
  };

  const pendentes = avisos.filter(a => a.status === 'pendente');
  const consumidos = avisos.filter(a => a.status === 'consumido');

  const renderCard = (aviso, mostrarStatus = false) => {
    const removendo = removendoId === aviso.id;
    const isPendente = aviso.status === 'pendente';
    const corBorda = isPendente ? palette.warn : palette.ok;
    return (
      <div key={aviso.id} style={{
        background: palette.surface, border: `1px solid ${palette.beige}`,
        borderLeft: `3px solid ${corBorda}`,
        borderRadius: 10, padding: 12, marginBottom: 8,
        opacity: isPendente ? 1 : 0.65,
      }}>
        <div style={{
          fontSize: fz(11), color: palette.inkMuted, marginBottom: 4,
          textTransform: 'uppercase', letterSpacing: 0.5,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span>📅 {fmtData(aviso.data_disparo)}</span>
          <span>·</span>
          <span>👥 {!aviso.vendedoras_ids || aviso.vendedoras_ids.length === 0 ? 'Todas' : aviso.vendedoras_ids.map(nomeVendedora).join(', ')}</span>
          {mostrarStatus && (
            <span style={{
              padding: '2px 7px', borderRadius: 8, fontSize: fz(9),
              background: isPendente ? palette.warnSoft : palette.okSoft,
              color: isPendente ? palette.warn : palette.ok,
            }}>
              {aviso.status}
            </span>
          )}
        </div>
        <div style={{ fontSize: fz(14), color: palette.ink, fontStyle: 'italic', marginBottom: 8 }}>
          "{aviso.texto}"
        </div>
        {isPendente && (
          <button onClick={() => remover(aviso)} disabled={removendo} style={{
            background: 'transparent', border: `1px solid ${palette.alertSoft}`,
            color: palette.alert, padding: '4px 10px', borderRadius: 4,
            cursor: removendo ? 'wait' : 'pointer', fontFamily: FONT, fontSize: fz(11),
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            {removendo ? <Loader2 size={sz(13)} style={spinKeyframes} /> : <Trash2 size={sz(13)} />}
            Cancelar
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ background: palette.bg, minHeight: '100%', fontFamily: FONT }}>
      <Header
        title="Avisos pra vendedoras"
        subtitle="Vira a 1ª sugestão do dia"
        onBack={onBack}
      />
      <div style={{ padding: 16, paddingBottom: 32 }}>

        {/* Box explicativo */}
        <div style={{
          padding: 12, background: palette.warnSoft, borderRadius: 8,
          borderLeft: `3px solid ${palette.warn}`, marginBottom: 16,
          fontSize: fz(13), color: palette.inkSoft, lineHeight: 1.5,
        }}>
          <strong>Avisos</strong> são disparos únicos pra uma ou mais vendedoras num dia específico. Vira a <strong>1ª sugestão do dia</strong>, no lugar do reativar.
        </div>

        {/* Form criar */}
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderRadius: 10, padding: 14, marginBottom: 20,
        }}>
          <div style={{ fontSize: fz(14), fontWeight: 600, color: palette.ink, marginBottom: 10 }}>
            + Novo aviso
          </div>

          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={PLACEHOLDER_AVISO}
            rows={3}
            style={{
              width: '100%', padding: 10, border: `1px solid ${palette.beige}`,
              borderRadius: 6, fontFamily: FONT, fontSize: fz(14),
              background: palette.surface, color: palette.ink,
              resize: 'vertical', marginBottom: 10,
            }}
          />

          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: fz(11), color: palette.inkSoft, marginBottom: 6 }}>
              Vendedoras alvo {vendedorasIds.length === 0 && '(vazio = todas)'}
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {vendedorasAtivas.map(v => {
                const sel = vendedorasIds.includes(v.id);
                return (
                  <button
                    key={v.id}
                    onClick={() => toggleVend(v.id)}
                    style={{
                      background: sel ? palette.accent : palette.surface,
                      color: sel ? 'white' : palette.inkSoft,
                      border: `1px solid ${sel ? palette.accent : palette.beige}`,
                      borderRadius: 16, padding: '5px 12px',
                      cursor: 'pointer', fontFamily: FONT, fontSize: fz(12),
                      fontWeight: sel ? 600 : 400,
                    }}
                  >
                    {sel && '✓ '}{v.nome} <span style={{ opacity: 0.7 }}>({v.loja === 'Bom Retiro' ? 'BR' : 'ST'})</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ display: 'block', fontSize: fz(11), color: palette.inkSoft, marginBottom: 4 }}>Data do disparo</label>
            <input
              type="date"
              value={dataDisparo}
              onChange={(e) => setDataDisparo(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              style={{
                width: '100%', padding: 8, border: `1px solid ${palette.beige}`,
                borderRadius: 6, fontFamily: FONT, fontSize: fz(13), background: palette.surface,
              }}
            />
          </div>

          <button
            onClick={salvar}
            disabled={salvando || texto.trim().length < 3}
            style={{
              width: '100%',
              background: salvando || texto.trim().length < 3 ? palette.beige : palette.warn,
              color: 'white', border: 'none', padding: 11, borderRadius: 6,
              cursor: salvando ? 'wait' : 'pointer',
              fontFamily: FONT, fontSize: fz(14), fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {salvando ? <><Loader2 size={sz(15)} style={spinKeyframes} /> Salvando…</> : <><Bell size={sz(15)} /> Criar aviso</>}
          </button>
        </div>

        {/* Pendentes */}
        <div style={{ fontSize: fz(13), fontWeight: 600, color: palette.warn, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          ⚡ Pendentes ({pendentes.length})
        </div>
        {pendentes.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: palette.inkMuted, fontSize: fz(13), background: palette.surface, border: `1px dashed ${palette.beige}`, borderRadius: 8, marginBottom: 16 }}>
            Nenhum aviso pendente
          </div>
        ) : (
          <div style={{ marginBottom: 20 }}>{pendentes.map(a => renderCard(a, false))}</div>
        )}

        {/* Histórico (collapsed) */}
        {consumidos.length > 0 && (
          <details>
            <summary style={{
              cursor: 'pointer', fontSize: fz(13), color: palette.inkMuted,
              padding: 8, userSelect: 'none',
            }}>
              ✓ Já enviados ({consumidos.length})
            </summary>
            <div style={{ marginTop: 8 }}>{consumidos.slice(0, 10).map(a => renderCard(a, true))}</div>
          </details>
        )}
      </div>
    </div>
  );
};


// ═══════════════════════════════════════════════════════════════════════════
// VestiLinksInline — painel inline na tela de Vendedoras
// ═══════════════════════════════════════════════════════════════════════════
//
// 3 campos pra colar links Vesti + radio pra escolher 1 ativo (ou nenhum).
// IA usa o link ativo nas mensagens pra clientes Vesti. Se nenhum
// selecionado, IA fica livre.
//
const VestiLinksInline = ({ vendedora, onSalvar, onFechar }) => {
  const [link1, setLink1] = useState(vendedora.vesti_link_1 || '');
  const [link2, setLink2] = useState(vendedora.vesti_link_2 || '');
  const [link3, setLink3] = useState(vendedora.vesti_link_3 || '');
  const [ativo, setAtivo] = useState(vendedora.vesti_link_ativo || null);
  const [salvando, setSalvando] = useState(false);

  const validarUrl = (s) => {
    if (!s || !s.trim()) return true; // vazio é ok
    try {
      const u = new URL(s.trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const podeAtivar = (n) => {
    if (n === 1) return link1.trim().length > 0;
    if (n === 2) return link2.trim().length > 0;
    if (n === 3) return link3.trim().length > 0;
    return false;
  };

  const salvar = async () => {
    if (!validarUrl(link1) || !validarUrl(link2) || !validarUrl(link3)) {
      alert('Algum link parece inválido (precisa começar com http:// ou https://)');
      return;
    }
    // Se ativo aponta pra link vazio, desativa
    let ativoFinal = ativo;
    if (ativoFinal && !podeAtivar(ativoFinal)) ativoFinal = null;

    setSalvando(true);
    try {
      await onSalvar(vendedora.id, {
        link_1: link1.trim() || null,
        link_2: link2.trim() || null,
        link_3: link3.trim() || null,
        link_ativo: ativoFinal,
      });
      onFechar();
    } catch (e) {
      alert('Erro: ' + (e.message || e));
    } finally {
      setSalvando(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: 8, border: `1px solid ${palette.beige}`,
    borderRadius: 6, fontFamily: FONT, fontSize: fz(13),
    background: palette.surface, color: palette.ink,
  };

  const renderCampo = (n, valor, setValor) => {
    const ehAtivo = ativo === n;
    const temConteudo = valor.trim().length > 0;
    return (
      <div key={n} style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
      }}>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 4, cursor: temConteudo ? 'pointer' : 'not-allowed',
          opacity: temConteudo ? 1 : 0.4, flexShrink: 0,
        }}>
          <input
            type="radio"
            name={`vesti-ativo-${vendedora.id}`}
            checked={ehAtivo}
            disabled={!temConteudo}
            onChange={() => setAtivo(ehAtivo ? null : n)}
          />
          <span style={{ fontSize: fz(11), color: ehAtivo ? palette.purple : palette.inkMuted, fontWeight: ehAtivo ? 600 : 400 }}>
            {n}
          </span>
        </label>
        <input
          type="url"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={`Link Vesti ${n} (cole aqui)`}
          style={{
            ...inputStyle,
            borderColor: ehAtivo ? palette.purple : palette.beige,
            borderWidth: ehAtivo ? 2 : 1,
          }}
        />
      </div>
    );
  };

  return (
    <div style={{
      marginTop: 12, padding: 12, background: palette.purpleSoft,
      borderRadius: 8, border: `1px solid ${palette.purple}40`,
    }}>
      <div style={{
        fontSize: fz(12), color: palette.purple, fontWeight: 600,
        marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Link2 size={sz(13)} /> Links Vesti — {vendedora.nome}
      </div>

      <div style={{ fontSize: fz(11), color: palette.inkSoft, marginBottom: 10, lineHeight: 1.4 }}>
        Cole até 3 links que você gerou no Vesti. Marque o radio do link que a IA deve usar nas mensagens. Sem nenhum marcado, IA fica livre.
      </div>

      {renderCampo(1, link1, setLink1)}
      {renderCampo(2, link2, setLink2)}
      {renderCampo(3, link3, setLink3)}

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button onClick={() => setAtivo(null)} disabled={!ativo} style={{
          background: palette.surface, color: palette.inkSoft,
          border: `1px solid ${palette.beige}`, borderRadius: 6,
          padding: '7px 12px', fontFamily: FONT, fontSize: fz(12),
          cursor: ativo ? 'pointer' : 'not-allowed', opacity: ativo ? 1 : 0.4,
        }}>
          Nenhum ativo
        </button>
        <button onClick={onFechar} style={{
          background: palette.surface, color: palette.inkSoft,
          border: `1px solid ${palette.beige}`, borderRadius: 6,
          padding: '7px 12px', fontFamily: FONT, fontSize: fz(12),
          cursor: 'pointer',
        }}>
          Cancelar
        </button>
        <button onClick={salvar} disabled={salvando} style={{
          flex: 1, background: salvando ? palette.beige : palette.purple,
          color: 'white', border: 'none', borderRadius: 6,
          padding: '7px 12px', fontFamily: FONT, fontSize: fz(12), fontWeight: 600,
          cursor: salvando ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        }}>
          {salvando
            ? <><Loader2 size={sz(13)} style={spinKeyframes} /> Salvando…</>
            : <><Save size={sz(13)} /> Salvar links</>}
        </button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// InteligenciaIaScreen — dashboard admin pra Previsão Pontual + Winback
// Ailson 20/05/2026 (auditoria A + D)
// ═══════════════════════════════════════════════════════════════════════════

export const InteligenciaIaScreen = ({ lojas, onBack }) => {
  const userId = lojas?.state?.userId;
  const [aba, setAba] = useState('previsao');
  const [stats, setStats] = useState(null);
  const [trilhas, setTrilhas] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const headers = { 'X-User': userId || '' };
      const [r1, r2] = await Promise.all([
        fetch('/api/lojas-previsao-pontual-stats', { headers }),
        fetch('/api/lojas-trilha-winback-listar', { headers }),
      ]);
      const d1 = await r1.json();
      const d2 = await r2.json();
      if (!r1.ok) throw new Error(d1.error || 'Erro stats previsão');
      if (!r2.ok) throw new Error(d2.error || 'Erro trilhas');
      setStats(d1);
      setTrilhas(d2);
    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { carregar(); }, [carregar]);

  return (
    <div>
      <Header onBack={onBack} title="Inteligência IA" />
      <div style={{ padding: 16 }}>

        {/* Abas */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[
            { id: 'previsao', label: '📅 Previsão pontual' },
            { id: 'winback', label: '🔄 Trilhas winback' },
          ].map(t => (
            <button key={t.id} onClick={() => setAba(t.id)} style={{
              flex: 1, background: aba === t.id ? palette.accent : palette.surface,
              color: aba === t.id ? 'white' : palette.ink,
              border: `1px solid ${aba === t.id ? palette.accent : palette.beige}`,
              borderRadius: 8, padding: '10px 12px', fontFamily: FONT,
              fontSize: fz(13), fontWeight: 600, cursor: 'pointer',
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {erro && (
          <div style={{
            padding: 12, borderRadius: 8, background: palette.alertSoft,
            color: palette.alert, fontSize: fz(13), marginBottom: 12,
          }}>{erro}</div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: 30, color: palette.inkSoft }}>
            <Loader2 size={sz(20)} style={spinKeyframes} /> Carregando…
          </div>
        )}

        {!loading && aba === 'previsao' && stats && (
          <SecaoPrevisaoPontual stats={stats} />
        )}

        {!loading && aba === 'winback' && trilhas && (
          <SecaoWinback trilhas={trilhas} userId={userId} onMudou={carregar} />
        )}
      </div>
    </div>
  );
};

// ─── Sub-secao Previsao Pontual ──────────────────────────────────────────
const SecaoPrevisaoPontual = ({ stats }) => {
  const s = stats.stats || {};
  const cards = [
    { label: 'Disparadas', valor: s.total_disparadas || 0, cor: palette.accent },
    { label: 'Acertos', valor: s.acertos || 0, cor: palette.ok },
    { label: 'Erros', valor: s.erros || 0, cor: palette.alert },
    { label: 'Em aberto', valor: s.em_aberto || 0, cor: palette.warn },
  ];

  return (
    <div>
      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 14 }}>
        {cards.map(c => (
          <div key={c.label} style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 10, padding: 12, textAlign: 'center',
          }}>
            <div style={{ fontSize: fz(11), color: palette.inkSoft, marginBottom: 4 }}>{c.label}</div>
            <div style={{ fontSize: fz(22), fontWeight: 600, color: c.cor }}>{c.valor}</div>
          </div>
        ))}
      </div>

      {s.pct_acerto != null && (
        <div style={{
          textAlign: 'center', padding: 10, borderRadius: 8,
          background: palette.accentSoft, color: palette.accent,
          fontSize: fz(14), fontWeight: 600, marginBottom: 14,
        }}>
          % de acerto: {s.pct_acerto}%
        </div>
      )}

      {/* Distribuição de padrões */}
      {Object.keys(stats.distribuicao_padroes || {}).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <SectionTitle>Padrões dos clientes</SectionTitle>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {Object.entries(stats.distribuicao_padroes).map(([k, v]) => (
              <div key={k} style={{
                background: palette.surface, border: `1px solid ${palette.beige}`,
                borderRadius: 6, padding: '6px 10px', fontSize: fz(12),
              }}>
                <strong>{v}</strong> {k.replace(/_/g, ' ')}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Breakdown por vendedora */}
      {Object.keys(stats.por_vendedora || {}).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <SectionTitle>Por vendedora (30d)</SectionTitle>
          <div style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 8, overflow: 'hidden',
          }}>
            {Object.entries(stats.por_vendedora)
              .sort((a, b) => b[1].total - a[1].total)
              .map(([nome, v], i) => (
                <div key={nome} style={{
                  padding: 10, borderTop: i === 0 ? 'none' : `1px solid ${palette.beige}`,
                  fontSize: fz(13), display: 'flex', justifyContent: 'space-between', gap: 6,
                }}>
                  <div style={{ fontWeight: 600 }}>{nome}</div>
                  <div style={{ color: palette.inkSoft }}>
                    {v.total} total · <span style={{ color: palette.ok }}>{v.acertos} ✓</span>
                    {' '} · <span style={{ color: palette.alert }}>{v.erros} ✗</span>
                    {' '} · <span style={{ color: palette.warn }}>{v.em_aberto} aguardando</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Elegíveis hoje */}
      {(stats.elegiveis_hoje || []).length > 0 && (
        <div>
          <SectionTitle>Elegíveis hoje (top 20)</SectionTitle>
          <div style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 8, overflow: 'hidden',
          }}>
            {stats.elegiveis_hoje.map((e, i) => (
              <div key={i} style={{
                padding: 10, borderTop: i === 0 ? 'none' : `1px solid ${palette.beige}`,
                fontSize: fz(13),
              }}>
                <div style={{ fontWeight: 600 }}>
                  {e.apelido}
                  <span style={{ color: palette.inkSoft, fontWeight: 400, marginLeft: 6 }}>
                    · {e.vendedora_nome}
                  </span>
                </div>
                <div style={{ fontSize: fz(11), color: palette.inkSoft, marginTop: 2 }}>
                  Score {e.score_final} · {e.dias_pra_proxima > 0 ? '+' : ''}{e.dias_pra_proxima}d · {e.canal_dominante}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sub-secao Trilhas Winback ───────────────────────────────────────────
const MOTIVOS_ENCERRAR = [
  { id: 'cliente_bloqueou', label: 'Cliente bloqueou WhatsApp' },
  { id: 'nao_respondeu', label: 'Não respondeu (3+ tentativas)' },
  { id: 'comprou_outra_vendedora', label: 'Comprou com outra vendedora' },
  { id: 'cliente_arquivado', label: 'Cliente foi arquivado' },
  { id: 'vendedora_desistiu', label: 'Vendedora desistiu' },
  { id: 'outro', label: 'Outro motivo' },
];

const SecaoWinback = ({ trilhas, userId, onMudou }) => {
  const [encerrandoId, setEncerrandoId] = useState(null);
  const [motivoSel, setMotivoSel] = useState({});

  const encerrar = async (trilhaId) => {
    const motivo = motivoSel[trilhaId];
    if (!motivo) return;
    if (!confirm('Encerrar trilha? Não tem como reabrir.')) return;
    setEncerrandoId(trilhaId);
    try {
      const r = await fetch('/api/lojas-trilha-winback-encerrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User': userId || '' },
        body: JSON.stringify({ trilha_id: trilhaId, motivo }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erro');
      await onMudou();
    } catch (e) {
      alert('Erro: ' + e.message);
    } finally {
      setEncerrandoId(null);
    }
  };

  const ativas = trilhas.ativas || [];
  const encerradas = trilhas.encerradas_30d || [];

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderRadius: 10, padding: 12, textAlign: 'center',
        }}>
          <div style={{ fontSize: fz(11), color: palette.inkSoft, marginBottom: 4 }}>Ativas</div>
          <div style={{ fontSize: fz(22), fontWeight: 600, color: palette.purple }}>{ativas.length}</div>
        </div>
        <div style={{
          background: palette.surface, border: `1px solid ${palette.beige}`,
          borderRadius: 10, padding: 12, textAlign: 'center',
        }}>
          <div style={{ fontSize: fz(11), color: palette.inkSoft, marginBottom: 4 }}>Encerradas 30d</div>
          <div style={{ fontSize: fz(22), fontWeight: 600, color: palette.inkSoft }}>{encerradas.length}</div>
        </div>
      </div>

      {/* Ativas */}
      <SectionTitle>Trilhas ativas</SectionTitle>
      {ativas.length === 0 ? (
        <div style={{ padding: 16, textAlign: 'center', color: palette.inkSoft, fontSize: fz(13) }}>
          Nenhuma trilha ativa.
        </div>
      ) : (
        ativas.map(t => (
          <div key={t.id} style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 8, padding: 12, marginBottom: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: fz(14) }}>{t.cliente_nome}</div>
                <div style={{ fontSize: fz(11), color: palette.inkSoft, marginTop: 2 }}>
                  {t.vendedora_nome} {t.loja ? `· ${t.loja}` : ''}
                </div>
              </div>
              <div style={{
                background: palette.purpleSoft, color: palette.purple,
                borderRadius: 6, padding: '2px 8px', fontSize: fz(11), fontWeight: 600,
              }}>
                Etapa {t.etapa_atual}/3
              </div>
            </div>
            <div style={{ fontSize: fz(11), color: palette.inkSoft, marginTop: 6 }}>
              Iniciada há {t.dias_na_trilha}d · Status inicial: {t.status_inicial}
              {t.lifetime ? ` · Lifetime R$ ${Math.round(t.lifetime).toLocaleString('pt-BR')}` : ''}
            </div>

            {/* Encerrar */}
            <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
              <select
                value={motivoSel[t.id] || ''}
                onChange={(e) => setMotivoSel({ ...motivoSel, [t.id]: e.target.value })}
                style={{
                  flex: 1, padding: 6, fontSize: fz(12), fontFamily: FONT,
                  border: `1px solid ${palette.beige}`, borderRadius: 6, background: 'white',
                }}
              >
                <option value="">— motivo pra encerrar —</option>
                {MOTIVOS_ENCERRAR.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <button
                onClick={() => encerrar(t.id)}
                disabled={!motivoSel[t.id] || encerrandoId === t.id}
                style={{
                  background: motivoSel[t.id] ? palette.alert : palette.beige,
                  color: motivoSel[t.id] ? 'white' : palette.inkSoft,
                  border: 'none', borderRadius: 6, padding: '6px 12px',
                  fontFamily: FONT, fontSize: fz(12), fontWeight: 600,
                  cursor: motivoSel[t.id] ? 'pointer' : 'not-allowed',
                }}
              >
                {encerrandoId === t.id ? '…' : 'Encerrar'}
              </button>
            </div>
          </div>
        ))
      )}

      {/* Encerradas */}
      {encerradas.length > 0 && (
        <>
          <SectionTitle>Encerradas (últimos 30d)</SectionTitle>
          <div style={{
            background: palette.surface, border: `1px solid ${palette.beige}`,
            borderRadius: 8, overflow: 'hidden',
          }}>
            {encerradas.map((e, i) => (
              <div key={e.id} style={{
                padding: 10, borderTop: i === 0 ? 'none' : `1px solid ${palette.beige}`,
                fontSize: fz(12),
              }}>
                <div style={{ fontWeight: 600 }}>{e.cliente_nome}</div>
                <div style={{ color: palette.inkSoft, marginTop: 2 }}>
                  {e.vendedora_nome} · etapa {e.etapa_final} · {e.motivo} · {fmtData(e.encerrada_em)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

