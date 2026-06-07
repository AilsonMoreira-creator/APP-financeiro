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
  Send, X, RefreshCw,
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
// COMPONENTE DE ABA (renderizado dentro do Sofia)
// ═══════════════════════════════════════════════════════════════════════════

export default function ClientesTab({ userId, refreshTick }) {
  const isDesktop = useIsDesktop();           // split: desktop = 2 paineis; mobile = tela cheia
  const [chatId, setChatId] = useState(null); // conversa aberta no split (antes era overlay no parent)
  const [modalEditar, setModalEditar] = useState(null);
  const [modalEnviar, setModalEnviar] = useState(null);
  const [subTab, setSubTab] = useState('feedback'); // 'feedback' | 'inativos'
  const [ordenar, setOrdenar] = useState('lifetime'); // 'lifetime' | 'az'
  const [envio, setEnvio] = useState('todos'); // 'todos' | 'enviadas' | 'nao_enviadas'
  const [abrindoId, setAbrindoId] = useState(null);   // cliente_id sendo aberto no chat
  const [selecionados, setSelecionados] = useState(() => new Set()); // seleção p/ massa
  const [modalMassa, setModalMassa] = useState(false);
  const [vendFiltro, setVendFiltro] = useState('todas');
  const [tickLocal, setTickLocal] = useState(0);
  const tick = refreshTick + tickLocal;

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
      const etapa = subTab === 'inativos' ? 'inativo' : 'feedback';
      const r = await fetch('/api/lojas-whats-conversa-abrir-cliente', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente_id: clienteId, etapa }),
      });
      const d = await r.json();
      if (!r.ok || !d.conversa_id) { alert('Erro ao abrir conversa: ' + (d.error || r.status)); return; }
      setChatId(d.conversa_id);
    } catch (e) {
      alert('Erro ao abrir conversa: ' + e.message);
    } finally {
      setAbrindoId(null);
    }
  }, [abrindoId, subTab]);

  const conteudoLista = (
    <div style={{ background: palette.bg, minHeight: 'calc(100vh - 110px)', fontFamily: FONT }}>
      {/* sub-abas Feedback | Inativos */}
      <div style={{
        display: 'flex', gap: 6, padding: '10px 16px 0',
        background: palette.surface, borderBottom: `1px solid ${palette.beige}`,
      }}>
        <SubTab id="feedback" label="Feedback" Icon={MessageSquare} ativo={subTab === 'feedback'} onClick={setSubTab} />
        <SubTab id="inativos" label="Inativos" Icon={Clock} ativo={subTab === 'inativos'} onClick={setSubTab} />
      </div>

      {/* filtro único (vale pra sub-aba ativa) */}
      <FiltroBar ordenar={ordenar} setOrdenar={setOrdenar} envio={envio} setEnvio={setEnvio}
        vendFiltro={vendFiltro} setVendFiltro={setVendFiltro} vendMap={vendMap}
        onRefresh={() => setTickLocal(t => t + 1)} />

      {subTab === 'feedback' && (
        <FeedbackTab refreshTick={tick} ordenar={ordenar} vendFiltro={vendFiltro}
          bloqueadosRef={bloqueadosRef} bloqueados={bloqueados} onToggle={toggleBloqueio} vendMap={vendMap}
          onAbrir={abrirChat} abrindoId={abrindoId}
          selecionados={selecionados} onToggleSel={toggleSel} envio={envio} />
      )}
      {subTab === 'inativos' && (
        <InativosTab refreshTick={tick} ordenar={ordenar} vendFiltro={vendFiltro}
          bloqueadosRef={bloqueadosRef} bloqueados={bloqueados} onToggle={toggleBloqueio} vendMap={vendMap}
          onAbrir={abrirChat} abrindoId={abrindoId}
          selecionados={selecionados} onToggleSel={toggleSel} envio={envio} />
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
          etapa={subTab === 'inativos' ? 'inativo' : 'feedback'}
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
  else arr.sort((a, b) => Number(b.lifetime_total || 0) - Number(a.lifetime_total || 0));
  return arr;
}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-ABA FEEDBACK
// ═══════════════════════════════════════════════════════════════════════════

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

        const [cads, fbs, vendas, enviadoSet, vendaVendMap, dedup] = await Promise.all([
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
          const c = cadMap.get(k.cliente_id) || {};
          out.push({
            cliente_id: k.cliente_id,
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

        const [cads, enviadoSet, vendaVendMap] = await Promise.all([
          selectInBatches('lojas_clientes', 'id, razao_social, comprador_nome, telefone_principal, vendedora_id', 'id', ids),
          fetchEnviadoSet(ids),
          fetchVendedoraSet(ids),
        ]);
        const cadMap = new Map(cads.map(c => [c.id, c]));

        const out = [];
        for (const k of (kpis || [])) {
          if (bloqueadosRef.current.has(k.cliente_id)) continue;
          const c = cadMap.get(k.cliente_id) || {};
          out.push({
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
          </ClienteCard>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD (nome + vendedora que atende + contato + campos + toggle bloqueio)
// ═══════════════════════════════════════════════════════════════════════════

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
  // feedback usa 2 templates (a distância × presencial); a Sofia escolhe por cliente.
  // inativo usa 1 só. Nomes batem com os cadastrados na Meta (tudo minúsculo).
  const tplDefs = etapa === 'inativo'
    ? [{ name: 'inativos_v1', label: null }]
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
          etapa {etapa} · {etapa === 'inativo' ? 'template inativos_v1' : 'a Sofia escolhe a versão por cliente'} · envio irreversível
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
