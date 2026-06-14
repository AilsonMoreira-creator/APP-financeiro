/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ClientesSofia.jsx — ABA "CLIENTES" (outreach) dentro do módulo Sofia
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Renderiza como aba dentro de LojasWhats (Sofia). Tabelas próprias clientes_sofia_*.
 *
 * REGRA DE OURO:
 *   1) SÓ escreve em clientes_sofia_bloqueios / clientes_sofia_feedback.
 *      lojas_clientes / lojas_clientes_kpis / lojas_vendas = SOMENTE LEITURA.
 *   2) Bloqueio é GLOBAL no módulo (toggle liga/desliga). Bloqueado é excluído
 *      das abas no (re)carregamento; some de todas as abas.
 *
 * Sub-abas: 💬 Feedback (pós-1ª-compra) · 💤 Inativos (>=180d sem comprar).
 * Cada card mostra a vendedora que atende. Filtro único (A-Z | maior lifetime).
 *
 * PENDENTE (a definir com Ailson): clique no card abre o chat (idêntico Sofia) +
 * enviar-vendedora pré-selecionada. Como 490/491 clientes não têm conversa,
 * falta definir a criação/abertura da conversa — não wireado ainda.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2, AlertCircle, Phone, ShoppingCart, User as UserIcon,
  Ban, ArrowDownAZ, ArrowDown01, Clock, MessageSquare, CheckCircle2,
  Send, X, RefreshCw, ArrowLeft,
} from 'lucide-react';
import { supabase, palette, FONT, SectionTitle } from './Lojas_Shared.jsx';
// Reuso do chat e do split do Sofia (import circular seguro: uso so em render).
import {
  ConversaDetail, EditarLeadModal, EnviarVendedoraModal,
  useIsDesktop, LARGURA_LISTA_SPLIT,
} from './LojasWhats.jsx';

// ─── helpers locais (mesmos do Sofia) ───
const fz = (n) => `${n}px`;
const sz = (n) => n;
const fmtMoney = (v) => Number(v || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 2,
});
const fmtPhone = (tel) => {
  if (!tel) return '—';
  const s = String(tel).replace(/\D/g, '');
  if (s.length === 13 && s.startsWith('55')) return `+55 (${s.slice(2,4)}) ${s.slice(4,9)}-${s.slice(9)}`;
  if (s.length === 12 && s.startsWith('55')) return `+55 (${s.slice(2,4)}) ${s.slice(4,8)}-${s.slice(8)}`;
  return tel;
};
const fmtDataBR = (d) => {
  if (!d) return '—';
  const dt = new Date(d + (String(d).length === 10 ? 'T00:00:00' : ''));
  return isNaN(dt) ? '—' : dt.toLocaleDateString('pt-BR');
};
const btnBase = {
  padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
  fontFamily: FONT, fontSize: fz(13), fontWeight: 600,
  border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

// IN() do PostgREST quebra acima de ~1000 itens → fatiar em 200.
async function selectInBatches(tabela, colunas, coluna, ids, size = 200) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await supabase.from(tabela).select(colunas).in(coluna, ids.slice(i, i + size));
    if (error) throw error;
    if (data) out.push(...data);
  }
  return out;
}

// Set de cliente_ids que já têm conversa com mensagem enviada (primeira_msg_enviada_em)
async function fetchEnviadoSet(ids, size = 200) {
  const set = new Set();
  for (let i = 0; i < ids.length; i += size) {
    const { data } = await supabase
      .from('lojas_whats_conversas')
      .select('cliente_id')
      .not('primeira_msg_enviada_em', 'is', null)
      .in('cliente_id', ids.slice(i, i + size));
    (data || []).forEach(r => { if (r.cliente_id) set.add(r.cliente_id); });
  }
  return set;
}

// ─── Status detalhado do envio (Ailson 11/06/2026) ──────────────────────────
// Map cliente_id → { status: 'na_fila'|'enviada'|'erro'|'nao_entregue', erro, em }
// Combina 2 fontes:
//   1. clientes_sofia_fila (item mais recente por cliente): pendente/enviado/erro
//   2. lojas_whats_mensagens: template com status='failed' = Meta aceitou mas a
//      entrega falhou ("Message undeliverable" — nº sem Whats etc). Antes esses
//      erros ficavam invisíveis na tela ("2 erros" sem dizer quais).
async function fetchEnvioInfo(ids, size = 200) {
  const map = new Map();
  try {
    for (let i = 0; i < ids.length; i += size) {
      const fatia = ids.slice(i, i + size);
      const { data: fila } = await supabase
        .from('clientes_sofia_fila')
        .select('cliente_id, status, etapa, erro, processado_em, criado_em')
        .in('cliente_id', fatia)
        .order('criado_em', { ascending: false });
      (fila || []).forEach(f => {
        if (!f.cliente_id || map.has(f.cliente_id)) return; // pega só o mais recente
        const status = f.status === 'enviado' ? 'enviada' : f.status === 'erro' ? 'erro' : 'na_fila';
        map.set(f.cliente_id, {
          status, erro: f.erro || null, em: f.processado_em || f.criado_em,
          etapa: f.etapa || null,
          // disparo_em: marco da régua — base pra 'conversando' e 'reativado' (Ailson 12/06/2026)
          disparo_em: f.status === 'enviado' ? (f.processado_em || f.criado_em) : null,
        });
      });
      // Falhas de entrega (webhook da Meta marca a mensagem como failed)
      const { data: convs } = await supabase
        .from('lojas_whats_conversas')
        .select('id, cliente_id, unread_count, ultima_atividade_em')
        .in('cliente_id', fatia);
      const convPorId = new Map((convs || []).map(c => [c.id, c.cliente_id]));
      // Não lidas por cliente (indicador vermelho no card, igual o CRM da
      // Sofia). Ailson 11/06/2026.
      (convs || []).forEach(c => {
        if (!c.cliente_id) return;
        const atual = map.get(c.cliente_id) || { status: null, erro: null, em: null };
        const patch = {};
        if (c.unread_count > 0) patch.unread = (atual.unread || 0) + c.unread_count;
        // última atividade (qualquer direção) — régua dos 3 dias do 'conversando'
        if (c.ultima_atividade_em && (!atual.ultima_atividade || c.ultima_atividade_em > atual.ultima_atividade)) {
          patch.ultima_atividade = c.ultima_atividade_em;
        }
        if (Object.keys(patch).length) map.set(c.cliente_id, { ...atual, ...patch });
      });
      if (convPorId.size > 0) {
        const { data: falhas } = await supabase
          .from('lojas_whats_mensagens')
          .select('conversa_id, erro, enviada_em')
          .in('conversa_id', [...convPorId.keys()])
          .eq('tipo_midia', 'template')
          .eq('status', 'failed');
        (falhas || []).forEach(m => {
          const cid = convPorId.get(m.conversa_id);
          if (!cid) return;
          const atual = map.get(cid) || {};
          map.set(cid, { ...atual, status: 'nao_entregue', erro: m.erro || 'entrega falhou', em: m.enviada_em });
        });
        // Última RESPOSTA da cliente (Ailson 11/06/2026): resposta a qualquer
        // momento sobe o card pro topo e ganha badge 💬.
        const { data: respostas } = await supabase
          .from('lojas_whats_mensagens')
          .select('conversa_id, enviada_em')
          .in('conversa_id', [...convPorId.keys()])
          .eq('direcao', 'entrada')
          .order('enviada_em', { ascending: false });
        (respostas || []).forEach(m => {
          const cid = convPorId.get(m.conversa_id);
          if (!cid) return;
          const atual = map.get(cid) || { status: null, erro: null, em: null };
          if (!atual.resposta_em) map.set(cid, { ...atual, resposta_em: m.enviada_em });
        });
      }
    }
  } catch (e) { console.error('fetchEnvioInfo:', e?.message); }
  return map;
}

// ─── Estado 'conversando' (Ailson 12/06/2026) ───────────────────────────────
// Cliente respondeu DEPOIS do disparo da régua e a conversa teve atividade
// nos últimos 3 dias. Depois de 3d parado: sai do 'conversando' e volta pro
// fluxo normal da aba. Se ele mandar mensagem de novo (a qualquer momento),
// resposta_em atualiza e ele volta direto pro 'conversando' com o histórico.
const TRES_DIAS_MS = 3 * 86400000;
function ehConversando(envio) {
  if (!envio?.resposta_em || !envio?.disparo_em) return false;
  if (new Date(envio.resposta_em).getTime() <= new Date(envio.disparo_em).getTime()) return false;
  const ult = envio.ultima_atividade || envio.resposta_em;
  return (Date.now() - new Date(ult).getTime()) <= TRES_DIAS_MS;
}

// Badge do status de envio no card (Ailson 11/06/2026)
function EnvioBadge({ envio }) {
  if (!envio) return null;
  const fmtHora = (d) => { try { const x = new Date(d); return x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
  const cfg = {
    enviada:      { txt: `✓ enviada ${fmtHora(envio.em)}`, bg: '#eafbf0', fg: '#1e8e4e', bd: '#b8dfc8' },
    na_fila:      { txt: '🕐 na fila de envio',            bg: palette.beigeSoft, fg: palette.inkSoft, bd: palette.beige },
    erro:         { txt: `❌ erro: ${String(envio.erro || '').slice(0, 38)}`, bg: '#fdeaea', fg: '#c0392b', bd: '#f4b8b8' },
    nao_entregue: { txt: `❌ não entregue: ${String(envio.erro || '').slice(0, 30)}`, bg: '#fdeaea', fg: '#c0392b', bd: '#f4b8b8' },
  }[envio.status];
  return (
    <>
      {cfg && (
        <span title={envio.erro || cfg.txt} style={{
          fontSize: fz(10.5), padding: '2px 8px', borderRadius: 5, fontWeight: 700,
          background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.bd}`, whiteSpace: 'nowrap',
        }}>{cfg.txt}</span>
      )}
      {envio.resposta_em && (
        <span title="Cliente respondeu — abre a conversa pra ver" style={{
          fontSize: fz(10.5), padding: '2px 8px', borderRadius: 5, fontWeight: 700,
          background: '#e8f1fa', color: '#2667a3', border: '1px solid #bcd6ee', whiteSpace: 'nowrap',
        }}>💬 respondeu {fmtHora(envio.resposta_em)}</span>
      )}
      {/* Badge VERMELHO de não lidas — mesmo estilo do CRM da Sofia (Ailson 11/06/2026) */}
      {envio.unread > 0 && (
        <span title={`${envio.unread} mensagem(ns) nova(s) do cliente — não vista(s)`} style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          minWidth: 18, height: 18, padding: '0 5px',
          borderRadius: 9, fontSize: fz(10), fontWeight: 700,
          background: '#dc2626', color: '#fff', lineHeight: 1, flexShrink: 0,
        }}>{envio.unread}</span>
      )}
    </>
  );
}

// Map cliente_id → vendedora_id da ÚLTIMA venda (quem atende; cadastro vem 81% nulo)
async function fetchVendedoraSet(ids, size = 200) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += size) {
    const { data } = await supabase
      .from('lojas_vendas')
      .select('cliente_id, vendedora_id, data_venda, created_at')
      .in('cliente_id', ids.slice(i, i + size))
      .not('vendedora_id', 'is', null)
      .order('data_venda', { ascending: false })
      .order('created_at', { ascending: false });
    (data || []).forEach(r => { if (!map.has(r.cliente_id)) map.set(r.cliente_id, r.vendedora_id); });
  }
  return map;
}

function filtrarVend(linhas, vendFiltro) {
  if (!vendFiltro || vendFiltro === 'todas') return linhas;
  if (vendFiltro === '__sem__') return linhas.filter(l => !l.vendedora_id);
  return linhas.filter(l => l.vendedora_id === vendFiltro);
}

function filtrarEnvio(linhas, envio) {
  if (envio === 'enviadas') return linhas.filter(l => l.enviado);
  if (envio === 'nao_enviadas') return linhas.filter(l => !l.enviado);
  return linhas;
}

const STATUS_FB = {
  pendente:        { label: 'Pendente',         cor: palette.inkMuted, soft: palette.beigeSoft },
  card_enviado:    { label: 'Card enviado',     cor: palette.accent,   soft: palette.accentSoft },
  pesquisa_enviada:{ label: 'Pesquisa enviada', cor: palette.warn,     soft: palette.warnSoft },
  respondeu:       { label: 'Respondeu',        cor: palette.ok,       soft: palette.okSoft },
  dispensado:      { label: 'Dispensado',       cor: palette.inkMuted, soft: palette.beigeSoft },
};

// ═══════════════════════════════════════════════════════════════════════════
// CRM CLIENTES — 2 RÉGUAS (Novos Clientes / Reativar), 4+1 abas cada
// (Ailson 12/06/2026). As réguas NUNCA cruzam cards: 'feedback' e 'inativo'
// são populações separadas; só compartilham a estrutura visual e o chat.
// Fases (carteira/enviados/conversando/followup) vêm de fn_clientes_sofia_fases.
// ═══════════════════════════════════════════════════════════════════════════

// Busca o mapa de fases da régua (cliente_id → {fase, tag, ...}) via RPC.
async function fetchFases(reguaEtapa) {
  const { data, error } = await supabase.rpc('fn_clientes_sofia_fases', { p_regua: reguaEtapa });
  if (error) { console.error('fetchFases:', error.message); return new Map(); }
  const m = new Map();
  (data || []).forEach(r => m.set(r.cliente_id, r));
  return m;
}

// Move cliente PRA / DE follow-up (estado manual persistente)
async function setFollowup(clienteId, regua, ligar, userId) {
  if (ligar) {
    return supabase.from('clientes_sofia_acompanhamento')
      .upsert({ cliente_id: clienteId, regua, movido_por: userId || null }, { onConflict: 'cliente_id,regua' });
  }
  return supabase.from('clientes_sofia_acompanhamento')
    .delete().eq('cliente_id', clienteId).eq('regua', regua);
}

// Tag visual da fase (tag vinda da fn)
function TagFase({ tag }) {
  const cfg = {
    conversando:           { txt: '💬 conversando',            bg: '#e8f1fa', fg: '#2667a3', bd: '#bcd6ee' },
    enviado:               { txt: '📤 enviada',                bg: '#eafbf0', fg: '#1e8e4e', bd: '#b8dfc8' },
    enviado_sem_resposta:  { txt: '📤 enviada · sem resposta', bg: palette.beigeSoft, fg: palette.inkSoft, bd: palette.beige },
    followup:              { txt: '📌 follow-up',              bg: '#fdf3e3', fg: '#b9772a', bd: '#f0d9b5' },
  }[tag];
  if (!cfg) return null;
  return (
    <span style={{
      fontSize: fz(10.5), padding: '2px 8px', borderRadius: 5, fontWeight: 700,
      background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.bd}`, whiteSpace: 'nowrap',
    }}>{cfg.txt}</span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENTE DE ABA (renderizado dentro do Sofia)
// ═══════════════════════════════════════════════════════════════════════════

export default function ClientesTab({ userId, refreshTick, reguaInicial = 'novos', abaInicial = null, soVendedora = false, vendedoraId = null, onVoltarHome = null, onVoltarSofia = null }) {
  const isDesktop = useIsDesktop();           // split: desktop = 2 paineis; mobile = tela cheia
  const [chatId, setChatId] = useState(null); // conversa aberta no split (antes era overlay no parent)
  const [modalEditar, setModalEditar] = useState(null);
  const [modalEnviar, setModalEnviar] = useState(null);
  // Régua ativa: 'novos' (feedback) | 'reativar' (inativo). Vendedora trava em 'reativar'.
  const [regua, setRegua] = useState(soVendedora ? 'reativar' : reguaInicial);
  // Aba dentro da régua: 'carteira' | 'enviados' | 'conversando' | 'followup' | 'reativados'
  const [aba, setAba] = useState(abaInicial || (soVendedora ? 'conversando' : 'carteira'));
  const [ordenar, setOrdenar] = useState('lifetime'); // 'lifetime' | 'az'
  const [envio, setEnvio] = useState('todos'); // 'todos' | 'enviadas' | 'nao_enviadas'
  const [abrindoId, setAbrindoId] = useState(null);   // cliente_id sendo aberto no chat
  const [selecionados, setSelecionados] = useState(() => new Set()); // seleção p/ massa
  const [modalMassa, setModalMassa] = useState(false);
  const [vendFiltro, setVendFiltro] = useState('todas');
  const [tickLocal, setTickLocal] = useState(0);
  const tick = refreshTick + tickLocal;

  // Etapa no banco da régua atual (feedback = novos clientes; inativo = reativar)
  const reguaEtapa = regua === 'reativar' ? 'inativo' : 'feedback';
  // Vendedora vê só os cards dela em todas as abas (filtro forçado)
  const vendForcado = soVendedora ? vendedoraId : null;

  const toggleSel = useCallback((id) => {
    setSelecionados(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  // Set GLOBAL de bloqueados (toggle) + realtime
  const [bloqueados, setBloqueados] = useState(() => new Set());
  const bloqueadosRef = useRef(bloqueados);
  bloqueadosRef.current = bloqueados;

  // Mapa vendedora_id → nome (pra mostrar a vendedora que atende no card)
  const [vendMap, setVendMap] = useState(() => new Map());

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: blo }, { data: vend }] = await Promise.all([
        supabase.from('clientes_sofia_bloqueios').select('cliente_id'),
        supabase.from('lojas_vendedoras').select('id, nome'),
      ]);
      if (!vivo) return;
      if (blo) setBloqueados(new Set(blo.map(r => r.cliente_id)));
      if (vend) setVendMap(new Map(vend.map(v => [v.id, v.nome])));
    })();
    const ch = supabase.channel('clientes-sofia-bloqueios')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'clientes_sofia_bloqueios' },
        (p) => setBloqueados(prev => { const n = new Set(prev); n.add(p.new.cliente_id); return n; }))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'clientes_sofia_bloqueios' },
        (p) => setBloqueados(prev => { const n = new Set(prev); n.delete(p.old.cliente_id); return n; }))
      .subscribe();
    return () => { vivo = false; try { supabase.removeChannel(ch); } catch {} };
  }, []);

  // Toggle liga/desliga: bloqueado → desbloqueia (delete); ativo → bloqueia (upsert)
  const toggleBloqueio = useCallback(async (clienteId) => {
    const estaBloqueado = bloqueadosRef.current.has(clienteId);
    setBloqueados(prev => {
      const n = new Set(prev);
      if (estaBloqueado) n.delete(clienteId); else n.add(clienteId);
      return n;
    });
    let error;
    if (estaBloqueado) {
      ({ error } = await supabase.from('clientes_sofia_bloqueios').delete().eq('cliente_id', clienteId));
    } else {
      ({ error } = await supabase.from('clientes_sofia_bloqueios')
        .upsert({ cliente_id: clienteId, bloqueado_por: userId || null }, { onConflict: 'cliente_id' }));
    }
    if (error) {
      // rollback
      setBloqueados(prev => {
        const n = new Set(prev);
        if (estaBloqueado) n.add(clienteId); else n.delete(clienteId);
        return n;
      });
      alert('Erro ao alterar bloqueio: ' + error.message);
    }
  }, [userId]);

  // Clique no card → acha/cria conversa zerada e abre o MESMO chat do Sofia.
  const abrirChat = useCallback(async (clienteId) => {
    if (abrindoId) return;
    setAbrindoId(clienteId);
    try {
      const etapa = reguaEtapa;
      const r = await fetch('/api/lojas-whats-conversa-abrir-cliente', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: clienteId, etapa }),
      });
      const d = await r.json();
      if (!r.ok || !d.conversa_id) { alert('Erro ao abrir conversa: ' + (d.error || r.status)); return; }
      // Zera o contador de não lidas (Ailson 11/06/2026): antes só o CRM da
      // Sofia zerava — abrir pelo módulo Clientes deixava o badge fantasma
      // no botão "Clientes" pra sempre.
      fetch('/api/lojas-whats-conversa-vista', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversa_id: d.conversa_id }),
      }).catch(() => {});
      setChatId(d.conversa_id);
    } catch (e) {
      alert('Erro ao abrir conversa: ' + e.message);
    } finally {
      setAbrindoId(null);
    }
  }, [abrindoId, reguaEtapa]);

  // Abas da régua ativa. Reativar tem Reativados a mais. (Ailson 12/06/2026)
  const ABAS_REGUA = regua === 'reativar'
    ? [
        { id: 'carteira', label: 'Carteira', Icon: UserIcon },
        { id: 'enviados', label: 'Enviados', Icon: Send },
        { id: 'conversando', label: 'Conversando', Icon: MessageSquare },
        { id: 'followup', label: 'Follow-up', Icon: CheckCircle2 },
        { id: 'reativados', label: 'Reativados', Icon: ShoppingCart },
      ]
    : [
        { id: 'carteira', label: 'Carteira', Icon: UserIcon },
        { id: 'enviados', label: 'Enviados', Icon: Send },
        { id: 'conversando', label: 'Conversando', Icon: MessageSquare },
        { id: 'followup', label: 'Follow-up', Icon: CheckCircle2 },
      ];

  const conteudoLista = (
    <div style={{ background: palette.bg, minHeight: 'calc(100vh - 110px)', fontFamily: FONT }}>
      {/* HEADER da régua: título + troca de régua (admin) / voltar (vendedora) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
        background: palette.surface, borderBottom: `1px solid ${palette.beige}`,
      }}>
        {soVendedora ? (
          onVoltarHome && (
            <button onClick={onVoltarHome} style={{ ...btnBase, background: 'transparent', gap: 5, color: palette.inkMuted }}>
              <ArrowLeft size={sz(16)} /> Home
            </button>
          )
        ) : (
          <>
            <button onClick={() => { setRegua('novos'); setAba('carteira'); }} style={{
              ...btnBase, gap: 5, background: regua === 'novos' ? palette.accent : 'transparent',
              color: regua === 'novos' ? palette.bg : palette.inkMuted,
              border: regua === 'novos' ? 'none' : `1px solid ${palette.beige}`,
            }}>
              <UserIcon size={sz(14)} /> Novos Clientes
            </button>
            <button onClick={() => { setRegua('reativar'); setAba('carteira'); }} style={{
              ...btnBase, gap: 5, background: regua === 'reativar' ? palette.accent : 'transparent',
              color: regua === 'reativar' ? palette.bg : palette.inkMuted,
              border: regua === 'reativar' ? 'none' : `1px solid ${palette.beige}`,
            }}>
              <RefreshCw size={sz(14)} /> Reativar Clientes
            </button>
            {onVoltarSofia && (
              <button onClick={onVoltarSofia} style={{ ...btnBase, marginLeft: 'auto', background: 'transparent', gap: 5, color: palette.inkMuted, border: `1px solid ${palette.beige}` }}>
                <ArrowLeft size={sz(14)} /> Sofia
              </button>
            )}
          </>
        )}
      </div>

      {/* Abas da régua */}
      <div style={{
        display: 'flex', gap: 6, padding: '10px 16px 0', overflowX: 'auto',
        background: palette.surface, borderBottom: `1px solid ${palette.beige}`,
      }}>
        {ABAS_REGUA.map(a => (
          <SubTab key={a.id} id={a.id} label={a.label} Icon={a.Icon} ativo={aba === a.id} onClick={setAba} />
        ))}
      </div>

      {/* filtro (vendedora não vê filtro de vendedora — já é forçado) */}
      <FiltroBar ordenar={ordenar} setOrdenar={setOrdenar} envio={envio} setEnvio={setEnvio}
        vendFiltro={soVendedora ? null : vendFiltro} setVendFiltro={setVendFiltro} vendMap={vendMap}
        onRefresh={() => setTickLocal(t => t + 1)} />

      {/* ── CARTEIRA ── novos=feedback / reativar=inativos (exclui quem está em outra fase) */}
      {aba === 'carteira' && regua === 'novos' && (
        <>
          <LoteFeedbackBanner tick={tick} onAprovado={() => setTickLocal(t => t + 1)} />
          <FeedbackTab refreshTick={tick} ordenar={ordenar} vendFiltro={vendForcado || vendFiltro}
            bloqueadosRef={bloqueadosRef} bloqueados={bloqueados} onToggle={toggleBloqueio} vendMap={vendMap}
            onAbrir={abrirChat} abrindoId={abrindoId}
            selecionados={selecionados} onToggleSel={toggleSel} envio={envio} />
        </>
      )}
      {aba === 'carteira' && regua === 'reativar' && (
        <InativosTab refreshTick={tick} ordenar={ordenar} vendFiltro={vendForcado || vendFiltro}
          bloqueadosRef={bloqueadosRef} bloqueados={bloqueados} onToggle={toggleBloqueio} vendMap={vendMap}
          onAbrir={abrirChat} abrindoId={abrindoId}
          selecionados={selecionados} onToggleSel={toggleSel} envio={envio} />
      )}

      {/* ── ENVIADOS / FOLLOW-UP ── via fn_clientes_sofia_fases */}
      {(aba === 'enviados' || aba === 'followup') && (
        <FaseTab key={`${regua}-${aba}`} fase={aba} regua={reguaEtapa}
          refreshTick={tick} ordenar={ordenar} vendForcado={vendForcado} vendFiltro={vendFiltro}
          bloqueadosRef={bloqueadosRef} bloqueados={bloqueados} onToggle={toggleBloqueio} vendMap={vendMap}
          onAbrir={abrirChat} abrindoId={abrindoId} userId={userId}
          selecionados={selecionados} onToggleSel={toggleSel} onTick={() => setTickLocal(t => t + 1)} />
      )}

      {/* ── CONVERSANDO ── */}
      {aba === 'conversando' && (
        <ConversandoTab key={`${regua}-conv`} etapa={reguaEtapa}
          refreshTick={tick} ordenar={ordenar} vendFiltro={vendForcado || vendFiltro}
          bloqueadosRef={bloqueadosRef} bloqueados={bloqueados} onToggle={toggleBloqueio} vendMap={vendMap}
          onAbrir={abrirChat} abrindoId={abrindoId}
          selecionados={selecionados} onToggleSel={toggleSel} />
      )}

      {/* ── REATIVADOS ── só na régua reativar */}
      {aba === 'reativados' && regua === 'reativar' && (
        <ReativadosTab refreshTick={tick} ordenar={ordenar} vendFiltro={vendForcado || vendFiltro}
          bloqueadosRef={bloqueadosRef} bloqueados={bloqueados} onToggle={toggleBloqueio} vendMap={vendMap}
          onAbrir={abrirChat} abrindoId={abrindoId}
          selecionados={selecionados} onToggleSel={toggleSel} />
      )}

      {/* Barra de ação em massa (aparece quando há seleção) */}
      {selecionados.size > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, zIndex: 20,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', background: palette.ink,
          borderTop: `1px solid ${palette.beige}`,
        }}>
          <span style={{ color: palette.bg, fontSize: fz(13), fontWeight: 600 }}>
            {selecionados.size} selecionado(s)
          </span>
          <button onClick={() => setModalMassa(true)} style={{
            ...btnBase, marginLeft: 'auto', background: palette.accent, color: palette.bg, gap: 5,
          }}>
            <Send size={sz(14)} /> Enviar em massa
          </button>
          <button onClick={() => setSelecionados(new Set())} style={{
            ...btnBase, background: 'transparent', color: palette.bg,
            border: `1px solid rgba(255,255,255,0.3)`,
          }}>
            Limpar
          </button>
        </div>
      )}

      {modalMassa && (
        <ModalMassa
          clienteIds={[...selecionados]}
          etapa={reguaEtapa}
          onClose={() => setModalMassa(false)}
          onEnviado={() => { setModalMassa(false); setSelecionados(new Set()); }}
        />
      )}
    </div>
  );

  // Chat aberto a partir de um card: split IGUAL ao Sofia (Conversas).
  // Desktop = lista a esquerda (LARGURA_LISTA_SPLIT) + ConversaDetail a direita.
  // Mobile = chat em tela cheia. Aposenta o overlay chatOverlayId do parent.
  // Ailson 31/05/2026.
  const modaisChat = (
    <>
      {modalEditar && (
        <EditarLeadModal
          conversa={modalEditar.conversa}
          onClose={() => setModalEditar(null)}
          onSucesso={() => setModalEditar(null)}
          onErro={(msg) => alert(msg)}
          onEnviarVendedora={(conv) => setModalEnviar({ conversa: conv })}
        />
      )}
      {modalEnviar && (
        <EnviarVendedoraModal
          conversa={modalEnviar.conversa}
          onClose={() => setModalEnviar(null)}
          onSucesso={(msg) => { setModalEnviar(null); setChatId(null); setTickLocal(t => t + 1); alert(msg); }}
          onErro={(msg) => alert(msg)}
        />
      )}
    </>
  );

  if (chatId) {
    const chat = (
      <ConversaDetail
        conversaId={chatId}
        userId={userId}
        idsNaAba={[]}
        onNavegar={(id) => setChatId(id)}
        onBack={() => { setChatId(null); setTickLocal(t => t + 1); }}
        onEditarLead={(conv) => setModalEditar({ conversa: conv })}
        onEnviarVendedora={(conv) => setModalEnviar({ conversa: conv })}
        splitLeft={isDesktop ? LARGURA_LISTA_SPLIT : 0}
      />
    );

    // MOBILE — chat em tela cheia (esconde a lista)
    if (!isDesktop) return <>{chat}{modaisChat}</>;

    // DESKTOP — split: lista a esquerda + chat a direita
    return (
      <>
        <div style={{
          position: 'fixed', top: 0, left: 0, bottom: 0,
          width: LARGURA_LISTA_SPLIT, zIndex: 101,
          background: palette.bg, borderRight: `1px solid ${palette.beige}`,
          overflowY: 'auto', fontFamily: FONT,
        }}>
          {conteudoLista}
        </div>
        {chat}
        {modaisChat}
      </>
    );
  }

  return conteudoLista;
}

function SubTab({ id, label, Icon, ativo, onClick }) {
  return (
    <button onClick={() => onClick(id)} style={{
      ...btnBase, padding: '8px 14px', fontSize: fz(14),
      background: 'transparent', borderRadius: 0, gap: 6,
      color: ativo ? palette.ink : palette.inkMuted, fontWeight: ativo ? 600 : 400,
      borderBottom: ativo ? `2.5px solid ${palette.accent}` : '2.5px solid transparent',
    }}>
      <Icon size={sz(16)} /> {label}
    </button>
  );
}

function FiltroBar({ ordenar, setOrdenar, envio, setEnvio, vendFiltro, setVendFiltro, vendMap, onRefresh }) {
  const vendOpts = Array.from((vendMap || new Map()).entries())
    .map(([id, nome]) => ({ id, nome }))
    .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));
  const OptOrd = ({ id, label, Icon }) => {
    const a = ordenar === id;
    return (
      <button onClick={() => setOrdenar(id)} style={{
        ...btnBase, padding: '5px 10px', fontSize: fz(12), gap: 5,
        background: a ? palette.accent : palette.surface, color: a ? palette.bg : palette.inkSoft,
        border: `1px solid ${a ? palette.accent : palette.beige}`,
      }}>
        <Icon size={sz(14)} /> {label}
      </button>
    );
  };
  const OptEnv = ({ id, label }) => {
    const a = envio === id;
    return (
      <button onClick={() => setEnvio(id)} style={{
        ...btnBase, padding: '5px 10px', fontSize: fz(12),
        background: a ? palette.ink : palette.surface, color: a ? palette.bg : palette.inkSoft,
        border: `1px solid ${a ? palette.ink : palette.beige}`,
      }}>
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', flexWrap: 'wrap',
      background: palette.surface, borderBottom: `1px solid ${palette.beige}` }}>
      <span style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Ordenar</span>
      <OptOrd id="lifetime" label="Maior valor" Icon={ArrowDown01} />
      <OptOrd id="az" label="A–Z" Icon={ArrowDownAZ} />
      <OptOrd id="recentes" label="Recentes" Icon={Clock} />
      <span style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: 6 }}>Envio</span>
      <OptEnv id="todos" label="Todos" />
      <OptEnv id="enviadas" label="Com msg enviada" />
      <OptEnv id="nao_enviadas" label="Sem msg enviada" />
      <span style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: 6 }}>Vendedora</span>
      <select value={vendFiltro} onChange={e => setVendFiltro(e.target.value)} style={{
        padding: '5px 8px', borderRadius: 8, border: `1px solid ${palette.beige}`,
        background: palette.surface, color: palette.inkSoft, fontFamily: FONT, fontSize: fz(12), cursor: 'pointer',
      }}>
        <option value="todas">Todas</option>
        {vendOpts.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
        <option value="__sem__">Sem vendedora</option>
      </select>
      <button onClick={onRefresh} title="Atualizar" style={{
        ...btnBase, marginLeft: 'auto', padding: '5px 9px', background: palette.surface,
        color: palette.inkSoft, border: `1px solid ${palette.beige}`,
      }}>
        <RefreshCw size={sz(14)} />
      </button>
    </div>
  );
}

function ordenarLista(lista, modo) {
  const arr = [...lista];
  if (modo === 'az') arr.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' }));
  else if (modo === 'recentes') arr.sort((a, b) =>
    String(b.primeira_compra || b.ultima_compra || '').localeCompare(String(a.primeira_compra || a.ultima_compra || '')));
  else arr.sort((a, b) => Number(b.lifetime_total || 0) - Number(a.lifetime_total || 0));
  // Atividade sobe pro topo, independente do modo de ordenação:
  //   1º) RESPOSTA da cliente — sobe SEMPRE, em qualquer momento (Ailson 11/06)
  //   2º) envio nas últimas 24h (inclusive erros)
  // Depois o card volta pra posição natural e vai "descendo" conforme entram
  // atividades novas.
  const corte = Date.now() - 24 * 60 * 60 * 1000;
  const ts = (l) => {
    const resp = l.envio?.resposta_em ? new Date(l.envio.resposta_em).getTime() : 0;
    if (resp) return resp + 1e15; // respostas sempre acima dos envios
    const env = l.envio?.em ? new Date(l.envio.em).getTime() : 0;
    return env > corte ? env : 0;
  };
  arr.sort((a, b) => ts(b) - ts(a) || 0);
  return arr;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-ABA FEEDBACK
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// BANNER "LOTE DO DIA" — clientes que o cron deixou prontos no 15º dia.
// Aprovação em 1 toque (libera todos de uma vez e dispara).
// ═══════════════════════════════════════════════════════════════════════════
function LoteFeedbackBanner({ tick, onAprovado }) {
  const [n, setN] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [tickLocal, setTickLocal] = useState(0);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { count } = await supabase
        .from('clientes_sofia_fila')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'aguardando_aprovacao')
        .eq('etapa', 'feedback');
      if (vivo) setN(count || 0);
    })();
    return () => { vivo = false; };
  }, [tick, tickLocal]);

  if (n === 0) return null;

  const aprovar = async () => {
    if (enviando) return;
    if (!window.confirm(`Aprovar e enviar o feedback pra ${n} cliente(s) agora?`)) return;
    setEnviando(true);
    try {
      const r = await fetch('/api/lojas-whats-clientes-aprovar-lote', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'erro');
      setN(0);
      setTickLocal(t => t + 1);
      if (onAprovado) onAprovado();
    } catch (e) {
      alert('Erro ao aprovar: ' + (e.message || e));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{
      margin: '12px 16px 0', padding: '12px 14px', borderRadius: 10,
      background: palette.warnSoft, border: `1px solid ${palette.warn}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
      fontFamily: FONT,
    }}>
      <div style={{ fontSize: fz(13), color: palette.ink }}>
        <b>Lote do dia:</b> {n} cliente(s) no 15º dia, prontos pra disparar o feedback.
      </div>
      <button onClick={aprovar} disabled={enviando} style={{
        background: palette.ok, color: '#fff', border: 'none', borderRadius: 8,
        padding: '8px 14px', fontSize: fz(13), fontWeight: 600, cursor: enviando ? 'not-allowed' : 'pointer',
        fontFamily: FONT, opacity: enviando ? 0.6 : 1,
      }}>
        {enviando ? 'Enviando...' : 'Aprovar e enviar todos'}
      </button>
    </div>
  );
}

function FeedbackTab({ refreshTick, ordenar, bloqueadosRef, bloqueados, onToggle, vendMap, onAbrir, abrindoId, selecionados, onToggleSel, envio, vendFiltro }) {
  const [linhas, setLinhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [ocultados, setOcultados] = useState(0);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true); setErro(null);
      try {
        const d15 = new Date(); d15.setDate(d15.getDate() - 15);
        const dataLimite = d15.toISOString().slice(0, 10);

        const { data: kpis, error: e1 } = await supabase
          .from('lojas_clientes_kpis')
          .select('cliente_id, primeira_compra, lifetime_total, qtd_compras_fisicas, qtd_compras_vesti')
          .gte('primeira_compra', dataLimite);
        if (e1) throw e1;

        const elegiveis = (kpis || []).filter(k =>
          (Number(k.qtd_compras_fisicas || 0) + Number(k.qtd_compras_vesti || 0)) > 0);
        const ids = elegiveis.map(k => k.cliente_id);
        if (ids.length === 0) { if (vivo) { setLinhas([]); setLoading(false); } return; }

        const [cads, fbs, vendas, enviadoSet, vendaVendMap, dedup, envioInfo, fasesMap] = await Promise.all([
          selectInBatches('lojas_clientes', 'id, razao_social, comprador_nome, telefone_principal, vendedora_id', 'id', ids),
          selectInBatches('clientes_sofia_feedback', 'cliente_id, status', 'cliente_id', ids),
          supabase.from('lojas_vendas')
            .select('cliente_id, valor_liquido, data_venda, created_at')
            .in('cliente_id', ids)
            .order('data_venda', { ascending: true }).order('created_at', { ascending: true })
            .then(r => { if (r.error) throw r.error; return r.data || []; }),
          fetchEnviadoSet(ids),
          fetchVendedoraSet(ids),
          selectInBatches('vw_lojas_clientes_feedback', 'cliente_id, perfil_entrega, falso_novo', 'cliente_id', ids),
          fetchEnvioInfo(ids),
          fetchFases('feedback'),
        ]);

        const cadMap = new Map(cads.map(c => [c.id, c]));
        const fbMap = new Map(fbs.map(f => [f.cliente_id, f]));
        const dedupMap = new Map((dedup || []).map(d => [d.cliente_id, d]));
        const primeiraVenda = new Map();
        for (const v of vendas) if (!primeiraVenda.has(v.cliente_id)) primeiraVenda.set(v.cliente_id, v.valor_liquido);

        const out = [];
        let ocult = 0;
        for (const k of elegiveis) {
          const status = fbMap.get(k.cliente_id)?.status || 'pendente';
          if (status === 'respondeu' || status === 'dispensado') continue;
          if (bloqueadosRef.current.has(k.cliente_id)) continue; // exclui bloqueado no carregamento
          const dd = dedupMap.get(k.cliente_id);
          if (dd && dd.falso_novo) { ocult++; continue; } // já era cliente (mesmo telefone, grupo ou CNPJ em cadastro anterior)
          // Carteira esconde quem está em outra fase (enviados/conversando/followup).
          // Quem voltou (3d sem resposta) reaparece aqui com a tag enviado_sem_resposta.
          const faseCli = fasesMap.get(k.cliente_id);
          if (faseCli && faseCli.fase !== 'arquivar') continue; // está em Enviados/Conversando/Follow-up
          const c = cadMap.get(k.cliente_id) || {};
          out.push({
            cliente_id: k.cliente_id,
            tagVolta: faseCli && faseCli.tag === 'enviado_sem_resposta' ? 'enviado_sem_resposta' : null,
            nome: c.razao_social || c.comprador_nome || '—',
            telefone: c.telefone_principal,
            vendedora_id: vendaVendMap.get(k.cliente_id) || null,
            vendedora_nome: vendMap.get(vendaVendMap.get(k.cliente_id)) || '—',
            primeira_compra: k.primeira_compra,
            valor_primeira: primeiraVenda.get(k.cliente_id) ?? null,
            lifetime_total: k.lifetime_total,
            perfil: dd?.perfil_entrega || 'presencial',
            status,
            enviado: enviadoSet.has(k.cliente_id),
            envio: envioInfo.get(k.cliente_id) || null,
          });
        }
        if (vivo) { setLinhas(out); setOcultados(ocult); }
      } catch (err) { if (vivo) setErro(err.message || String(err)); }
      finally { if (vivo) setLoading(false); }
    })();
    return () => { vivo = false; };
  }, [refreshTick, vendMap]);

  const visiveis = ordenarLista(filtrarVend(filtrarEnvio(linhas, envio), vendFiltro), ordenar);
  if (loading) return <Carregando />;
  if (erro) return <ErroBox msg={erro} />;
  if (visiveis.length === 0) return <Vazio msg="Nenhum cliente nesse filtro." />;

  return (
    <div style={{ padding: '12px 16px' }}>
      <SectionTitle icon={MessageSquare}>{visiveis.length} cliente(s)</SectionTitle>
      {ocultados > 0 && (
        <div style={{ fontSize: fz(11), color: palette.inkMuted, margin: '-4px 0 8px' }}>
          {ocultados} oculto(s): já eram clientes (mesmo telefone, grupo ou CNPJ em cadastro anterior)
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visiveis.map(l => (
          <ClienteCard key={l.cliente_id} l={l} bloqueado={bloqueados.has(l.cliente_id)} onToggle={onToggle} onAbrir={onAbrir} abrindo={abrindoId === l.cliente_id} selecionado={selecionados.has(l.cliente_id)} onToggleSel={onToggleSel}>
            <Campo Icon={ShoppingCart} label="1ª compra" valor={l.valor_primeira != null ? fmtMoney(l.valor_primeira) : '—'} destaque />
            <Campo label="em" valor={fmtDataBR(l.primeira_compra)} />
            <span style={{ fontSize: fz(10), padding: '1px 7px', borderRadius: 4, background: palette.beige, color: palette.inkSoft, fontWeight: 600 }}>
              {l.perfil === 'distancia' ? 'a distância' : 'na loja'}
            </span>
            <StatusBadge status={l.status} />
            <EnvioBadge envio={l.envio} />
          </ClienteCard>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-ABA INATIVOS
// ═══════════════════════════════════════════════════════════════════════════

function InativosTab({ refreshTick, ordenar, bloqueadosRef, bloqueados, onToggle, vendMap, onAbrir, abrindoId, selecionados, onToggleSel, envio, vendFiltro }) {
  const [linhas, setLinhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true); setErro(null);
      try {
        const { data: kpis, error: e1 } = await supabase
          .from('lojas_clientes_kpis')
          .select('cliente_id, lifetime_total, qtd_compras, dias_sem_comprar, ultima_compra')
          .gte('dias_sem_comprar', 180)
          .order('lifetime_total', { ascending: false });
        if (e1) throw e1;

        const ids = (kpis || []).map(k => k.cliente_id);
        if (ids.length === 0) { if (vivo) { setLinhas([]); setLoading(false); } return; }

        const [cads, enviadoSet, vendaVendMap, envioInfo, reaRes, fasesMap] = await Promise.all([
          selectInBatches('lojas_clientes', 'id, razao_social, comprador_nome, telefone_principal, vendedora_id, grupo_id', 'id', ids),
          fetchEnviadoSet(ids),
          fetchVendedoraSet(ids),
          fetchEnvioInfo(ids),
          supabase.from('vw_clientes_sofia_reativados').select('cliente_id'),
          fetchFases('inativo'),
        ]);
        const cadMap = new Map(cads.map(c => [c.id, c]));
        const reativados = new Set((reaRes?.data || []).map(r => r.cliente_id));

        // ─── Regra de GRUPOS (Ailson 12/06/2026, mesma do módulo Lojas) ─────
        // 1. Grupo com QUALQUER CNPJ ativo (compra <180d) → grupo inteiro sai
        //    da lista (mesmo dono já comprando por outro CNPJ).
        // 2. Grupo todo inativo → mostra SÓ o CNPJ principal (maior lifetime),
        //    com badge do grupo.
        const grupoIds = [...new Set(cads.map(c => c.grupo_id).filter(Boolean))];
        const grupoAtivo = new Set();          // grupos com algum doc ativo
        const principalDoGrupo = new Map();    // grupo_id → cliente_id principal
        const docsPorGrupo = new Map();        // grupo_id → qtd CNPJs
        if (grupoIds.length > 0) {
          const docs = await selectInBatches('lojas_clientes', 'id, grupo_id', 'grupo_id', grupoIds);
          const docIds = docs.map(d => d.id);
          const kdocs = await selectInBatches('lojas_clientes_kpis', 'cliente_id, dias_sem_comprar, lifetime_total', 'cliente_id', docIds);
          const kdocMap = new Map(kdocs.map(k => [k.cliente_id, k]));
          for (const g of grupoIds) {
            const dg = docs.filter(d => d.grupo_id === g);
            docsPorGrupo.set(g, dg.length);
            let melhor = null, melhorLt = -1;
            for (const d of dg) {
              const kd = kdocMap.get(d.id) || {};
              if ((kd.dias_sem_comprar ?? 9999) < 180) grupoAtivo.add(g);
              const lt = Number(kd.lifetime_total || 0);
              if (lt > melhorLt) { melhorLt = lt; melhor = d.id; }
            }
            principalDoGrupo.set(g, melhor);
          }
        }

        const out = [];
        for (const k of (kpis || [])) {
          if (bloqueadosRef.current.has(k.cliente_id)) continue;
          if (reativados.has(k.cliente_id)) continue;                 // está na aba Reativados
          const faseCli = fasesMap.get(k.cliente_id);
          if (faseCli && faseCli.fase !== 'arquivar') continue;       // Enviados/Conversando/Follow-up
          const c = cadMap.get(k.cliente_id) || {};
          if (c.grupo_id) {
            if (grupoAtivo.has(c.grupo_id)) continue;                       // grupo tem CNPJ ativo
            if (principalDoGrupo.get(c.grupo_id) !== k.cliente_id) continue; // só o principal aparece
          }
          out.push({
            grupo_qtd: c.grupo_id ? (docsPorGrupo.get(c.grupo_id) || 0) : 0,
            cliente_id: k.cliente_id,
            nome: c.razao_social || c.comprador_nome || '—',
            telefone: c.telefone_principal,
            vendedora_id: vendaVendMap.get(k.cliente_id) || null,
            vendedora_nome: vendMap.get(vendaVendMap.get(k.cliente_id)) || '—',
            lifetime_total: k.lifetime_total,
            qtd_compras: k.qtd_compras,
            dias_sem_comprar: k.dias_sem_comprar,
            ultima_compra: k.ultima_compra,
            enviado: enviadoSet.has(k.cliente_id),
            envio: envioInfo.get(k.cliente_id) || null,
          });
        }
        if (vivo) setLinhas(out);
      } catch (err) { if (vivo) setErro(err.message || String(err)); }
      finally { if (vivo) setLoading(false); }
    })();
    return () => { vivo = false; };
  }, [refreshTick, vendMap]);

  const visiveis = ordenarLista(filtrarVend(filtrarEnvio(linhas, envio), vendFiltro), ordenar);
  if (loading) return <Carregando />;
  if (erro) return <ErroBox msg={erro} />;
  if (visiveis.length === 0) return <Vazio msg="Nenhum cliente inativo nesse filtro." />;

  return (
    <div style={{ padding: '12px 16px' }}>
      <SectionTitle icon={Clock}>{visiveis.length} cliente(s) inativo(s)</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visiveis.map(l => (
          <ClienteCard key={l.cliente_id} l={l} bloqueado={bloqueados.has(l.cliente_id)} onToggle={onToggle} onAbrir={onAbrir} abrindo={abrindoId === l.cliente_id} selecionado={selecionados.has(l.cliente_id)} onToggleSel={onToggleSel}>
            <Campo Icon={ShoppingCart} label="lifetime" valor={fmtMoney(l.lifetime_total)} destaque />
            <Campo label="compras" valor={String(l.qtd_compras ?? 0)} />
            <Campo label="sem comprar" valor={`${l.dias_sem_comprar ?? '—'}d`} alerta />
            {l.grupo_qtd > 1 && (
              <span title={`Grupo com ${l.grupo_qtd} CNPJs — mostrando só o principal (maior lifetime)`} style={{
                fontSize: fz(10.5), padding: '2px 8px', borderRadius: 5, fontWeight: 700,
                background: '#eef0fa', color: '#4a5ba5', border: '1px solid #c9d0ee', whiteSpace: 'nowrap',
              }}>🏢 grupo · {l.grupo_qtd} CNPJs</span>
            )}
            <EnvioBadge envio={l.envio} />
          </ClienteCard>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ABA FASE — Enviados / Follow-up (Ailson 12/06/2026)
// Usa fn_clientes_sofia_fases(regua): 'enviados' = disparado <3d sem resposta;
// 'followup' = marcado manualmente (permanente até a vendedora soltar).
// ═══════════════════════════════════════════════════════════════════════════
function FaseTab({ fase, regua, refreshTick, ordenar, vendForcado, vendFiltro, bloqueadosRef, bloqueados, onToggle, vendMap, onAbrir, abrindoId, selecionados, onToggleSel, userId, onTick }) {
  const [linhas, setLinhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true); setErro(null);
      try {
        const fasesMap = await fetchFases(regua);
        let alvo = [...fasesMap.values()].filter(f => f.fase === fase);
        if (alvo.length === 0) { if (vivo) { setLinhas([]); setLoading(false); } return; }
        const ids = alvo.map(f => f.cliente_id).filter(id => !bloqueadosRef.current.has(id));
        if (ids.length === 0) { if (vivo) { setLinhas([]); setLoading(false); } return; }

        const [cads, kpis, vendaVendMap] = await Promise.all([
          selectInBatches('lojas_clientes', 'id, razao_social, comprador_nome, telefone_principal', 'id', ids),
          selectInBatches('lojas_clientes_kpis', 'cliente_id, lifetime_total, qtd_compras, dias_sem_comprar', 'cliente_id', ids),
          fetchVendedoraSet(ids),
        ]);
        const cadMap = new Map(cads.map(c => [c.id, c]));
        const kpiMap = new Map(kpis.map(k => [k.cliente_id, k]));

        const out = [];
        for (const id of ids) {
          const f = fasesMap.get(id) || {};
          const c = cadMap.get(id) || {};
          const k = kpiMap.get(id) || {};
          out.push({
            cliente_id: id,
            nome: c.razao_social || c.comprador_nome || '—',
            telefone: c.telefone_principal,
            vendedora_id: vendaVendMap.get(id) || null,
            vendedora_nome: vendMap.get(vendaVendMap.get(id)) || '—',
            lifetime_total: k.lifetime_total ?? 0,
            qtd_compras: k.qtd_compras,
            dias_sem_comprar: k.dias_sem_comprar,
            tag: f.tag,
          });
        }
        if (vivo) setLinhas(out);
      } catch (err) { if (vivo) setErro(err.message || String(err)); }
      finally { if (vivo) setLoading(false); }
    })();
    return () => { vivo = false; };
  }, [refreshTick, fase, regua, vendMap]);

  const ehFollowup = fase === 'followup';
  const visiveis = ordenarLista(filtrarVend(linhas, vendForcado || vendFiltro), ordenar);
  if (loading) return <Carregando />;
  if (erro) return <ErroBox msg={erro} />;
  if (visiveis.length === 0) return <Vazio msg={ehFollowup ? 'Nenhum cliente em follow-up.' : 'Ninguém enviado aguardando resposta.'} />;

  return (
    <div style={{ padding: '12px 16px' }}>
      <SectionTitle icon={ehFollowup ? CheckCircle2 : Send}>
        {visiveis.length} {ehFollowup ? 'em follow-up' : 'enviado(s), aguardando'}
      </SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visiveis.map(l => (
          <ClienteCard key={l.cliente_id} l={l} bloqueado={bloqueados.has(l.cliente_id)} onToggle={onToggle} onAbrir={onAbrir} abrindo={abrindoId === l.cliente_id} selecionado={selecionados.has(l.cliente_id)} onToggleSel={onToggleSel}>
            {l.tag === 'enviado' && <span style={{ fontSize: fz(10.5), padding: '2px 8px', borderRadius: 5, fontWeight: 700, background: '#fef3c7', color: '#926a1e', border: '1px solid #fcd34d', whiteSpace: 'nowrap' }}>🕐 aguardando</span>}
            <Campo Icon={ShoppingCart} label="lifetime" valor={fmtMoney(l.lifetime_total)} destaque />
            <Campo label="compras" valor={String(l.qtd_compras ?? 0)} />
            <Campo label="sem comprar" valor={`${l.dias_sem_comprar ?? '—'}d`} alerta />
            <button onClick={(e) => { e.stopPropagation(); setFollowup(l.cliente_id, regua, !ehFollowup, userId).then(() => onTick && onTick()); }}
              title={ehFollowup ? 'Tirar do follow-up (volta pra régua geral)' : 'Mover pra follow-up (não some)'}
              style={{
                fontSize: fz(10.5), padding: '2px 9px', borderRadius: 5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                background: ehFollowup ? '#fef3c7' : '#eef0fa', color: ehFollowup ? '#b45309' : '#4a5ba5',
                border: `1px solid ${ehFollowup ? '#fcd34d' : '#c9d0ee'}`,
              }}>
              {ehFollowup ? '📌 tirar' : '📌 follow-up'}
            </button>
          </ClienteCard>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD (nome + vendedora que atende + contato + campos + toggle bloqueio)
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// ABA CONVERSANDO (Fb 💬 / In 💬) — Ailson 12/06/2026
// Quem respondeu ao disparo da régua e teve atividade nos últimos 3 dias.
// Depois de 3d parado, sai daqui: feedback some (fluxo normal mostra só
// novos), inativo volta pra aba Inativos. O histórico fica na conversa —
// nova mensagem do cliente o traz de volta automaticamente.
// ═══════════════════════════════════════════════════════════════════════════
function ConversandoTab({ etapa, refreshTick, ordenar, bloqueadosRef, bloqueados, onToggle, vendMap, onAbrir, abrindoId, selecionados, onToggleSel, vendFiltro }) {
  const [linhas, setLinhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true); setErro(null);
      try {
        const { data: fila, error: e1 } = await supabase
          .from('clientes_sofia_fila')
          .select('cliente_id')
          .eq('etapa', etapa).eq('status', 'enviado');
        if (e1) throw e1;
        const ids = [...new Set((fila || []).map(f => f.cliente_id).filter(Boolean))];
        if (ids.length === 0) { if (vivo) { setLinhas([]); setLoading(false); } return; }

        let reativados = new Set();
        if (etapa === 'inativo') {
          const { data: rea } = await supabase.from('vw_clientes_sofia_reativados').select('cliente_id');
          reativados = new Set((rea || []).map(r => r.cliente_id));
        }

        const [cads, kpis, vendaVendMap, envioInfo] = await Promise.all([
          selectInBatches('lojas_clientes', 'id, razao_social, comprador_nome, telefone_principal', 'id', ids),
          selectInBatches('lojas_clientes_kpis', 'cliente_id, lifetime_total, qtd_compras, dias_sem_comprar', 'cliente_id', ids),
          fetchVendedoraSet(ids),
          fetchEnvioInfo(ids),
        ]);
        const cadMap = new Map(cads.map(c => [c.id, c]));
        const kpiMap = new Map(kpis.map(k => [k.cliente_id, k]));

        const out = [];
        for (const id of ids) {
          if (bloqueadosRef.current.has(id)) continue;
          if (reativados.has(id)) continue; // já comprou: tá na aba Reativados
          const envio = envioInfo.get(id);
          if (!ehConversando(envio)) continue;
          const c = cadMap.get(id) || {};
          const k = kpiMap.get(id) || {};
          out.push({
            cliente_id: id,
            nome: c.razao_social || c.comprador_nome || '—',
            telefone: c.telefone_principal,
            vendedora_id: vendaVendMap.get(id) || null,
            vendedora_nome: vendMap.get(vendaVendMap.get(id)) || '—',
            lifetime_total: k.lifetime_total ?? 0,
            qtd_compras: k.qtd_compras,
            dias_sem_comprar: k.dias_sem_comprar,
            enviado: true,
            envio,
          });
        }
        if (vivo) setLinhas(out);
      } catch (err) { if (vivo) setErro(err.message || String(err)); }
      finally { if (vivo) setLoading(false); }
    })();
    return () => { vivo = false; };
  }, [refreshTick, vendMap, etapa]);

  const visiveis = ordenarLista(filtrarVend(linhas, vendFiltro), ordenar);
  if (loading) return <Carregando />;
  if (erro) return <ErroBox msg={erro} />;
  if (visiveis.length === 0) return <Vazio msg="Ninguém conversando agora. Quem responder aos disparos aparece aqui." />;

  return (
    <div style={{ padding: '12px 16px' }}>
      <SectionTitle icon={MessageSquare}>{visiveis.length} cliente(s) conversando</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visiveis.map(l => (
          <ClienteCard key={l.cliente_id} l={l} bloqueado={bloqueados.has(l.cliente_id)} onToggle={onToggle} onAbrir={onAbrir} abrindo={abrindoId === l.cliente_id} selecionado={selecionados.has(l.cliente_id)} onToggleSel={onToggleSel}>
            <Campo Icon={ShoppingCart} label="lifetime" valor={fmtMoney(l.lifetime_total)} destaque />
            {etapa === 'inativo' && <Campo label="sem comprar" valor={`${l.dias_sem_comprar ?? '—'}d`} alerta />}
            <EnvioBadge envio={l.envio} />
          </ClienteCard>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ABA REATIVADOS — Ailson 12/06/2026
// Inativo que recebeu mensagem e COMPROU em até 7 dias (venda do Miré em
// lojas_vendas). Fica aqui pra sempre: é o placar da régua de reativação.
// Mandou mensagem depois? A conversa abre normal daqui de dentro.
// ═══════════════════════════════════════════════════════════════════════════
function ReativadosTab({ refreshTick, ordenar, bloqueadosRef, bloqueados, onToggle, vendMap, onAbrir, abrindoId, selecionados, onToggleSel, vendFiltro }) {
  const [linhas, setLinhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true); setErro(null);
      try {
        const { data: rea, error: e1 } = await supabase
          .from('vw_clientes_sofia_reativados')
          .select('cliente_id, data_mensagem, data_venda, valor_venda, dias_ate_compra');
        if (e1) throw e1;
        const ids = (rea || []).map(r => r.cliente_id);
        if (ids.length === 0) { if (vivo) { setLinhas([]); setLoading(false); } return; }

        const [cads, kpis, vendaVendMap, envioInfo] = await Promise.all([
          selectInBatches('lojas_clientes', 'id, razao_social, comprador_nome, telefone_principal', 'id', ids),
          selectInBatches('lojas_clientes_kpis', 'cliente_id, lifetime_total, qtd_compras', 'cliente_id', ids),
          fetchVendedoraSet(ids),
          fetchEnvioInfo(ids),
        ]);
        const cadMap = new Map(cads.map(c => [c.id, c]));
        const kpiMap = new Map(kpis.map(k => [k.cliente_id, k]));

        const out = [];
        for (const r of (rea || [])) {
          if (bloqueadosRef.current.has(r.cliente_id)) continue;
          const c = cadMap.get(r.cliente_id) || {};
          const k = kpiMap.get(r.cliente_id) || {};
          out.push({
            cliente_id: r.cliente_id,
            nome: c.razao_social || c.comprador_nome || '—',
            telefone: c.telefone_principal,
            vendedora_id: vendaVendMap.get(r.cliente_id) || null,
            vendedora_nome: vendMap.get(vendaVendMap.get(r.cliente_id)) || '—',
            lifetime_total: k.lifetime_total ?? 0,
            qtd_compras: k.qtd_compras,
            valor_venda: r.valor_venda,
            data_venda: r.data_venda,
            dias_ate_compra: r.dias_ate_compra,
            enviado: true,
            envio: envioInfo.get(r.cliente_id) || null,
          });
        }
        if (vivo) setLinhas(out);
      } catch (err) { if (vivo) setErro(err.message || String(err)); }
      finally { if (vivo) setLoading(false); }
    })();
    return () => { vivo = false; };
  }, [refreshTick, vendMap]);

  const fmtData = (d) => { try { return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return d; } };
  const visiveis = ordenarLista(filtrarVend(linhas, vendFiltro), ordenar);
  if (loading) return <Carregando />;
  if (erro) return <ErroBox msg={erro} />;
  if (visiveis.length === 0) return <Vazio msg="Nenhum reativado ainda. Inativo que comprar em até 7 dias após a mensagem aparece aqui." />;

  return (
    <div style={{ padding: '12px 16px' }}>
      <SectionTitle icon={ShoppingCart}>{visiveis.length} cliente(s) reativado(s) 🎉</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visiveis.map(l => (
          <ClienteCard key={l.cliente_id} l={l} bloqueado={bloqueados.has(l.cliente_id)} onToggle={onToggle} onAbrir={onAbrir} abrindo={abrindoId === l.cliente_id} selecionado={selecionados.has(l.cliente_id)} onToggleSel={onToggleSel}>
            <span style={{
              fontSize: fz(10.5), padding: '2px 8px', borderRadius: 5, fontWeight: 700,
              background: '#eafbf0', color: '#1e8e4e', border: '1px solid #b8dfc8', whiteSpace: 'nowrap',
            }}>💰 {fmtMoney(l.valor_venda)} · {fmtData(l.data_venda)} · {l.dias_ate_compra}d após msg</span>
            <Campo Icon={ShoppingCart} label="lifetime" valor={fmtMoney(l.lifetime_total)} destaque />
            <EnvioBadge envio={l.envio} />
          </ClienteCard>
        ))}
      </div>
    </div>
  );
}

function ClienteCard({ l, bloqueado, onToggle, onAbrir, abrindo, selecionado, onToggleSel, children }) {
  return (
    <div
      onClick={() => { if (!abrindo && onAbrir) onAbrir(l.cliente_id); }}
      title="Abrir conversa (chat Sofia)"
      style={{
        background: palette.surface, borderRadius: 12, padding: 12,
        border: `1px solid ${bloqueado ? palette.alert : palette.beige}`,
        opacity: bloqueado ? 0.6 : (abrindo ? 0.7 : 1),
        cursor: abrindo ? 'wait' : 'pointer',
        transition: 'opacity 0.15s, border-color 0.15s',
      }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <input
          type="checkbox"
          checked={!!selecionado}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); onToggleSel && onToggleSel(l.cliente_id); }}
          style={{ width: 18, height: 18, cursor: 'pointer', marginTop: 2, flexShrink: 0 }}
        />
        <UserIcon size={sz(15)} color={palette.accent} style={{ marginTop: 3, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: fz(15), fontWeight: 600, color: palette.ink }}>{l.nome}</span>
            <span style={{
              fontSize: fz(10), padding: '1px 7px', borderRadius: 4,
              background: palette.accentSoft, color: palette.accent, fontWeight: 600,
            }}>
              👩‍💼 {l.vendedora_nome}
            </span>
          </div>
          <div style={{ fontSize: fz(12), color: palette.inkMuted, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span><Phone size={sz(11)} style={{ verticalAlign: 'middle' }} /> {fmtPhone(l.telefone)}</span>
            {children}
          </div>
        </div>
        {/* toggle liga/desliga bloqueio */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(l.cliente_id); }}
          title={bloqueado ? 'Desbloquear cliente' : 'Bloquear (sai de todas as abas; nenhuma ação é disparada)'}
          style={{
            ...btnBase, padding: '5px 9px', fontSize: fz(11), gap: 4, flexShrink: 0,
            background: bloqueado ? palette.alert : palette.surface,
            color: bloqueado ? palette.bg : palette.alert,
            border: `1px solid ${bloqueado ? palette.alert : palette.beige}`,
          }}
        >
          <Ban size={sz(13)} /> {bloqueado ? 'Bloqueado' : 'Bloquear'}
        </button>
      </div>
    </div>
  );
}

function Campo({ Icon, label, valor, destaque, alerta }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {Icon && <Icon size={sz(11)} style={{ verticalAlign: 'middle' }} />}
      <span style={{ color: palette.inkMuted }}>{label}:</span>
      <strong style={{ color: alerta ? palette.alert : (destaque ? palette.ok : palette.inkSoft), fontWeight: 600 }}>{valor}</strong>
    </span>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_FB[status] || STATUS_FB.pendente;
  return (
    <span style={{ fontSize: fz(10), padding: '1px 7px', borderRadius: 4, background: s.soft, color: s.cor, fontWeight: 600 }}>
      {s.label}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL ENVIO EM MASSA — mostra a mensagem (template) que vai pra todos selecionados
// ═══════════════════════════════════════════════════════════════════════════

function ModalMassa({ clienteIds, etapa, onClose, onEnviado }) {
  // feedback usa 2 templates (a distância × presencial); inativo usa 2 (por
  // lifetime: ≤4 × ≥5). A regra escolhe por cliente no backend (massa).
  const tplDefs = etapa === 'inativo'
    ? [
        { name: 'reativacao_ate4_v1', label: 'Até 4 compras (geral)' },
        { name: 'reativacao_5mais_v1', label: '5+ compras (cliente importante)' },
      ]
    : [
        { name: 'feedback_v1', label: 'A distância (fala de entrega)' },
        { name: 'feedback_loja_v1', label: 'Presencial / na loja' },
      ];

  const [tpls, setTpls] = useState(null); // [{ name, label, body, ativo }]
  const [carregando, setCarregando] = useState(true);
  const [passo, setPasso] = useState('aprovar'); // aprovar | confirmar | progresso
  const [enviando, setEnviando] = useState(false);
  const [lote, setLote] = useState(null);
  const [prog, setProg] = useState(null); // { enviado, erro, pend, total }
  const [resumo, setResumo] = useState(null); // resposta do enfileirar (pulados etc)

  useEffect(() => {
    (async () => {
      const nomes = tplDefs.map(t => t.name);
      const { data } = await supabase
        .from('lojas_whats_templates')
        .select('name, body_text, ativo')
        .in('name', nomes);
      const byName = new Map((data || []).map(d => [d.name, d]));
      setTpls(tplDefs.map(t => ({
        ...t,
        body: byName.get(t.name)?.body_text || null,
        ativo: !!byName.get(t.name)?.ativo,
      })));
      setCarregando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa]);

  // polling do progresso da fila do lote
  useEffect(() => {
    if (passo !== 'progresso' || !lote) return;
    let vivo = true;
    const tick = async () => {
      const { data } = await supabase.from('clientes_sofia_fila').select('status').eq('lote_id', lote);
      if (!vivo || !data) return;
      const c = { enviado: 0, erro: 0, pend: 0, total: data.length };
      data.forEach(r => {
        if (r.status === 'enviado') c.enviado++;
        else if (r.status === 'erro') c.erro++;
        else c.pend++;
      });
      setProg(c);
    };
    tick();
    const iv = setInterval(tick, 2500);
    return () => { vivo = false; clearInterval(iv); };
  }, [passo, lote]);

  const faltando = (tpls || []).filter(t => !t.ativo || !t.body).map(t => t.name);

  const disparar = async () => {
    setEnviando(true);
    try {
      const r = await fetch('/api/lojas-whats-clientes-massa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_ids: clienteIds, etapa }),
      });
      const d = await r.json();
      if (!r.ok || d.error) { alert('Erro: ' + (d.error || r.status)); return; }
      setResumo(d); setLote(d.lote_id); setPasso('progresso');
    } catch (e) {
      alert('Erro: ' + e.message);
    } finally {
      setEnviando(false);
    }
  };

  const wrap = (children) => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: palette.bg, borderRadius: 12, padding: 20, maxWidth: 480, width: '100%', fontFamily: FONT }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: fz(16), color: palette.ink, fontWeight: 700 }}>Enviar em massa</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}>
            <X size={sz(22)} color={palette.inkMuted} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );

  if (carregando) return wrap(
    <div style={{ padding: 20, textAlign: 'center' }}>
      <Loader2 size={26} color={palette.accent} style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  );

  if (passo === 'aprovar' && faltando.length > 0) return wrap(
    <div>
      <div style={{ fontSize: fz(13), color: palette.alert, background: palette.alertSoft, padding: 12, borderRadius: 8, marginBottom: 14 }}>
        Falta aprovar na Meta: <strong>{faltando.join(', ')}</strong>. Assim que ficar ativo, o envio libera sozinho.
      </div>
      <button onClick={onClose} style={{ ...btnBase, width: '100%', background: palette.surface, color: palette.ink, border: `1px solid ${palette.beige}` }}>Fechar</button>
    </div>
  );

  if (passo === 'aprovar') return wrap(
    <div>
      {etapa !== 'inativo' && (
        <div style={{ fontSize: fz(12), color: palette.inkSoft, marginBottom: 10, lineHeight: 1.5 }}>
          A Sofia escolhe a versão por cliente: quem comprou a distância (ou pela Vesti) recebe a que fala de entrega; quem comprou na loja recebe a neutra. Quem já era cliente (mesmo telefone, grupo ou CNPJ em cadastro anterior) é pulado.
        </div>
      )}
      {tpls.map(t => (
        <div key={t.name} style={{ marginBottom: 12 }}>
          {t.label && <div style={{ fontSize: fz(11), color: palette.inkMuted, marginBottom: 4, fontWeight: 600 }}>{t.label}</div>}
          <div style={{ background: palette.surface, border: `1px solid ${palette.beige}`, borderRadius: 8, padding: 12,
            fontSize: fz(13), color: palette.ink, whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 200, overflowY: 'auto' }}>
            {t.body.replaceAll('{{1}}', 'Maria')}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
        <button onClick={onClose} style={{ ...btnBase, flex: 1, background: palette.surface, color: palette.ink, border: `1px solid ${palette.beige}` }}>Cancelar</button>
        <button onClick={() => setPasso('confirmar')} style={{ ...btnBase, flex: 1, background: palette.accent, color: palette.bg }}>Aprovar mensagem</button>
      </div>
    </div>
  );

  if (passo === 'confirmar') return wrap(
    <div>
      <div style={{ fontSize: fz(15), color: palette.ink, textAlign: 'center', margin: '8px 0 16px', lineHeight: 1.5 }}>
        <strong>{clienteIds.length}</strong> cliente(s) selecionado(s)
        <div style={{ fontSize: fz(12), color: palette.inkMuted, marginTop: 4 }}>
          etapa {etapa} · {'a Sofia escolhe a versão por cliente'} · envio irreversível
        </div>
        {etapa !== 'inativo' && (
          <div style={{ fontSize: fz(11), color: palette.inkMuted, marginTop: 4 }}>
            quem já era cliente é pulado automaticamente
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setPasso('aprovar')} disabled={enviando} style={{ ...btnBase, flex: 1, background: palette.surface, color: palette.ink, border: `1px solid ${palette.beige}` }}>Voltar</button>
        <button onClick={disparar} disabled={enviando} style={{ ...btnBase, flex: 1, background: palette.ok, color: palette.bg, gap: 5 }}>
          {enviando ? <Loader2 size={sz(14)} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={sz(14)} />}
          {enviando ? 'Enfileirando…' : 'Confirmar e disparar'}
        </button>
      </div>
    </div>
  );

  // progresso
  const enviado = prog?.enviado ?? 0;
  const erro = prog?.erro ?? 0;
  const total = prog?.total ?? clienteIds.length;
  const done = prog && prog.pend === 0;
  return wrap(
    <div style={{ textAlign: 'center' }}>
      <div style={{ margin: '6px 0 12px' }}>
        {done
          ? <CheckCircle2 size={40} color={palette.ok} style={{ margin: '0 auto' }} />
          : <Loader2 size={36} color={palette.accent} style={{ margin: '0 auto', animation: 'spin 1s linear infinite' }} />}
      </div>
      <div style={{ fontSize: fz(18), fontWeight: 700, color: palette.ok }}>
        {enviado} enviada(s) com sucesso
      </div>
      <div style={{ fontSize: fz(13), color: palette.inkSoft, margin: '4px 0 8px' }}>
        {done ? `de ${total} · concluído` : `enviando… ${enviado + erro}/${total}`}
        {erro > 0 && <span style={{ color: palette.alert }}> · {erro} erro(s)</span>}
      </div>
      {resumo && (resumo.pulados_ja_cliente > 0 || resumo.pulados_template_inativo > 0) && (
        <div style={{ fontSize: fz(12), color: palette.inkMuted, marginBottom: 12 }}>
          {resumo.pulados_ja_cliente > 0 && <span>{resumo.pulados_ja_cliente} pulado(s): já eram clientes</span>}
          {resumo.pulados_template_inativo > 0 && <span> · {resumo.pulados_template_inativo} sem template ativo</span>}
        </div>
      )}
      <button onClick={onEnviado} style={{ ...btnBase, width: '100%', background: palette.accent, color: palette.bg }}>
        {done ? 'Fechar' : 'Fechar (continua em segundo plano)'}
      </button>
    </div>
  );
}

function Carregando() {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: palette.inkMuted, fontFamily: FONT }}>
      <Loader2 size={32} color={palette.accent} style={{ animation: 'spin 1s linear infinite' }} />
      <div style={{ marginTop: 10, fontSize: fz(13) }}>Carregando clientes…</div>
    </div>
  );
}
function ErroBox({ msg }) {
  return (
    <div style={{ padding: 24, textAlign: 'center', fontFamily: FONT }}>
      <AlertCircle size={32} color={palette.alert} style={{ margin: '0 auto 8px' }} />
      <div style={{ fontSize: fz(13), color: palette.alert }}>{msg}</div>
    </div>
  );
}
function Vazio({ msg }) {
  return (
    <div style={{ padding: 36, textAlign: 'center', color: palette.inkMuted, fontFamily: FONT }}>
      <CheckCircle2 size={30} color={palette.inkMuted} style={{ margin: '0 auto 8px', opacity: 0.6 }} />
      <div style={{ fontSize: fz(13) }}>{msg}</div>
    </div>
  );
}
