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
} from 'lucide-react';
import { supabase, palette, FONT, SectionTitle } from './Lojas_Shared.jsx';

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
  const [subTab, setSubTab] = useState('feedback'); // 'feedback' | 'inativos'
  const [ordenar, setOrdenar] = useState('lifetime'); // 'lifetime' | 'az'

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

  return (
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
      <FiltroBar ordenar={ordenar} setOrdenar={setOrdenar} />

      {subTab === 'feedback' && (
        <FeedbackTab refreshTick={refreshTick} ordenar={ordenar}
          bloqueadosRef={bloqueadosRef} bloqueados={bloqueados} onToggle={toggleBloqueio} vendMap={vendMap} />
      )}
      {subTab === 'inativos' && (
        <InativosTab refreshTick={refreshTick} ordenar={ordenar}
          bloqueadosRef={bloqueadosRef} bloqueados={bloqueados} onToggle={toggleBloqueio} vendMap={vendMap} />
      )}
    </div>
  );
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

function FiltroBar({ ordenar, setOrdenar }) {
  const Opt = ({ id, label, Icon }) => {
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
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
      background: palette.surface, borderBottom: `1px solid ${palette.beige}` }}>
      <span style={{ fontSize: fz(11), color: palette.inkMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 2 }}>Ordenar</span>
      <Opt id="lifetime" label="Maior valor" Icon={ArrowDown01} />
      <Opt id="az" label="A–Z" Icon={ArrowDownAZ} />
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

function FeedbackTab({ refreshTick, ordenar, bloqueadosRef, bloqueados, onToggle, vendMap }) {
  const [linhas, setLinhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);

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

        const [cads, fbs, vendas] = await Promise.all([
          selectInBatches('lojas_clientes', 'id, razao_social, comprador_nome, telefone_principal, vendedora_id', 'id', ids),
          selectInBatches('clientes_sofia_feedback', 'cliente_id, status', 'cliente_id', ids),
          supabase.from('lojas_vendas')
            .select('cliente_id, valor_liquido, data_venda, created_at')
            .in('cliente_id', ids)
            .order('data_venda', { ascending: true }).order('created_at', { ascending: true })
            .then(r => { if (r.error) throw r.error; return r.data || []; }),
        ]);

        const cadMap = new Map(cads.map(c => [c.id, c]));
        const fbMap = new Map(fbs.map(f => [f.cliente_id, f]));
        const primeiraVenda = new Map();
        for (const v of vendas) if (!primeiraVenda.has(v.cliente_id)) primeiraVenda.set(v.cliente_id, v.valor_liquido);

        const out = [];
        for (const k of elegiveis) {
          const status = fbMap.get(k.cliente_id)?.status || 'pendente';
          if (status === 'respondeu' || status === 'dispensado') continue;
          if (bloqueadosRef.current.has(k.cliente_id)) continue; // exclui bloqueado no carregamento
          const c = cadMap.get(k.cliente_id) || {};
          out.push({
            cliente_id: k.cliente_id,
            nome: c.razao_social || c.comprador_nome || '—',
            telefone: c.telefone_principal,
            vendedora_nome: vendMap.get(c.vendedora_id) || '—',
            primeira_compra: k.primeira_compra,
            valor_primeira: primeiraVenda.get(k.cliente_id) ?? null,
            lifetime_total: k.lifetime_total,
            status,
          });
        }
        if (vivo) setLinhas(out);
      } catch (err) { if (vivo) setErro(err.message || String(err)); }
      finally { if (vivo) setLoading(false); }
    })();
    return () => { vivo = false; };
  }, [refreshTick, vendMap]);

  const visiveis = ordenarLista(linhas, ordenar);
  if (loading) return <Carregando />;
  if (erro) return <ErroBox msg={erro} />;
  if (visiveis.length === 0) return <Vazio msg="Nenhum cliente na janela de feedback (1ª compra nos últimos 15 dias)." />;

  return (
    <div style={{ padding: '12px 16px' }}>
      <SectionTitle icon={MessageSquare}>{visiveis.length} cliente(s)</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visiveis.map(l => (
          <ClienteCard key={l.cliente_id} l={l} bloqueado={bloqueados.has(l.cliente_id)} onToggle={onToggle}>
            <Campo Icon={ShoppingCart} label="1ª compra" valor={l.valor_primeira != null ? fmtMoney(l.valor_primeira) : '—'} destaque />
            <Campo label="em" valor={fmtDataBR(l.primeira_compra)} />
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

function InativosTab({ refreshTick, ordenar, bloqueadosRef, bloqueados, onToggle, vendMap }) {
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

        const cads = await selectInBatches('lojas_clientes', 'id, razao_social, comprador_nome, telefone_principal, vendedora_id', 'id', ids);
        const cadMap = new Map(cads.map(c => [c.id, c]));

        const out = [];
        for (const k of (kpis || [])) {
          if (bloqueadosRef.current.has(k.cliente_id)) continue;
          const c = cadMap.get(k.cliente_id) || {};
          out.push({
            cliente_id: k.cliente_id,
            nome: c.razao_social || c.comprador_nome || '—',
            telefone: c.telefone_principal,
            vendedora_nome: vendMap.get(c.vendedora_id) || '—',
            lifetime_total: k.lifetime_total,
            qtd_compras: k.qtd_compras,
            dias_sem_comprar: k.dias_sem_comprar,
            ultima_compra: k.ultima_compra,
          });
        }
        if (vivo) setLinhas(out);
      } catch (err) { if (vivo) setErro(err.message || String(err)); }
      finally { if (vivo) setLoading(false); }
    })();
    return () => { vivo = false; };
  }, [refreshTick, vendMap]);

  const visiveis = ordenarLista(linhas, ordenar);
  if (loading) return <Carregando />;
  if (erro) return <ErroBox msg={erro} />;
  if (visiveis.length === 0) return <Vazio msg="Nenhum cliente inativo (6+ meses sem comprar)." />;

  return (
    <div style={{ padding: '12px 16px' }}>
      <SectionTitle icon={Clock}>{visiveis.length} cliente(s) inativo(s)</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visiveis.map(l => (
          <ClienteCard key={l.cliente_id} l={l} bloqueado={bloqueados.has(l.cliente_id)} onToggle={onToggle}>
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

function ClienteCard({ l, bloqueado, onToggle, children }) {
  return (
    <div style={{
      background: palette.surface, borderRadius: 12, padding: 12,
      border: `1px solid ${bloqueado ? palette.alert : palette.beige}`,
      opacity: bloqueado ? 0.6 : 1, transition: 'opacity 0.15s, border-color 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
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
          onClick={() => onToggle(l.cliente_id)}
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
