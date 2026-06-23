// ============================================================================
// MELUNI — leitura das devoluções POR PEÇA (cards + chat), via service-role.
// Lê de vw_meluni_devolucoes (deriva fluxo_status, recebido automático do
// histórico, ordena com completas/canceladas apagadas no fim, esconde arquivadas).
// Query: etapa (todas | aguardando_conferir | aguardando_estorno | canceladas).
// Marca conversa_pendente quando existe conversa de devolução com última msg "in".
// Ailson 15/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const etapa = (req.query || {}).etapa || 'todas';

  try {
    let qy = supabase.from('vw_meluni_devolucoes')
      .select('*')
      .order('rank_aberto', { ascending: true })
      .order('importado_em', { ascending: false, nullsFirst: false })
      .order('criado_em', { ascending: false, nullsFirst: false })
      .order('data_devolucao', { ascending: false, nullsFirst: false });

    if (etapa === 'aguardando_conferir') qy = qy.eq('fluxo_status', 'aguardando_conferir');
    else if (etapa === 'aguardando_estorno') qy = qy.eq('fluxo_status', 'aguardando_estorno');
    else if (etapa === 'canceladas') qy = qy.eq('fluxo_status', 'cancelada');

    const { data, error } = await qy;
    if (error) throw new Error(error.message);
    let lista = data || [];

    // conversa sem resposta: conversa origem='devolucao' com última msg "in"
    const cids = [...new Set(lista.map(d => d.cliente_id).filter(Boolean))];
    const tels = [...new Set(lista.map(d => (d.telefone || '').replace(/\D/g, '')).filter(t => t.length >= 10))];
    let convCli = new Set(), convTel = new Set();
    if (cids.length || tels.length) {
      const { data: convs } = await supabase.from('meluni_conversas')
        .select('cliente_id,telefone,ultima_msg_direcao,etapa,visto_em,ultima_msg_em')
        .eq('origem', 'devolucao')
        .in('ultima_msg_direcao', ['in', 'entrada']);
      for (const c of (convs || [])) {
        // só conta como pendente se NÃO foi vista desde a última msg recebida.
        // Abrir o chat grava visto_em (meluni-whats-conversa), igual Clientes/SAC,
        // então o badge some ao abrir e volta só com msg nova. Ailson 22/06/2026.
        if (c.visto_em && c.ultima_msg_em && new Date(c.ultima_msg_em) <= new Date(c.visto_em)) continue;
        if (c.cliente_id) convCli.add(c.cliente_id);
        const t = (c.telefone || '').replace(/\D/g, '');
        if (t.length >= 10) convTel.add(t.slice(-10));
      }
    }
    lista = lista.map(d => {
      const t = (d.telefone || '').replace(/\D/g, '').slice(-10);
      const pend = (d.cliente_id && convCli.has(d.cliente_id)) || (t && convTel.has(t));
      return { ...d, conversa_pendente: !!pend };
    });

    // contagem de conversas sem resposta por aba (badge vermelho, idêntico Sofia)
    const unread = { todas: 0, aguardando_conferir: 0, aguardando_estorno: 0, canceladas: 0 };
    if (convCli.size || convTel.size) {
      const { data: todos } = await supabase.from('vw_meluni_devolucoes')
        .select('cliente_id,telefone,fluxo_status');
      for (const d of (todos || [])) {
        const t = (d.telefone || '').replace(/\D/g, '').slice(-10);
        const pend = (d.cliente_id && convCli.has(d.cliente_id)) || (t && convTel.has(t));
        if (!pend) continue;
        unread.todas++;
        if (d.fluxo_status === 'aguardando_conferir') unread.aguardando_conferir++;
        else if (d.fluxo_status === 'aguardando_estorno') unread.aguardando_estorno++;
        else if (d.fluxo_status === 'cancelada') unread.canceladas++;
      }
    }

    // SKU -> REF (ml_sku_ref_map, igual Bling vendas/carrinho) + título curto da
    // calculadora (calc-meluni: descrições mais curtas que o desc_limpa). O SKU
    // vem no campo `ref` do item; guardamos em `sku` e pomos a REF amigável + título.
    const skus = [...new Set(
      lista.flatMap(d => Array.isArray(d.itens) ? d.itens.map(i => i?.ref).filter(Boolean) : [])
    )];
    if (skus.length) {
      const mapaSku = new Map();
      for (let i = 0; i < skus.length; i += 300) {
        const { data: rows } = await supabase.from('ml_sku_ref_map')
          .select('sku, ref, desc_limpa').in('sku', skus.slice(i, i + 300));
        for (const r of (rows || [])) mapaSku.set(r.sku, r);
      }
      // título curto pela calculadora (calc-meluni), indexado por REF sem zero
      const semZero = (r) => String(r || '').replace(/^0+/, '') || '0';
      const tituloCaso = (s) => String(s || '').trim().toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/(^|\s)\S/g, (c) => c.toUpperCase());
      const calcMap = new Map();
      try {
        const { data: calc } = await supabase.from('amicia_data').select('payload').eq('user_id', 'calc-meluni').maybeSingle();
        const prods = calc?.payload?.prods;
        if (Array.isArray(prods)) {
          for (const p of prods) {
            if (p?.ref && p?.descricao) calcMap.set(semZero(p.ref), tituloCaso(p.descricao));
          }
        }
      } catch { /* segue sem título da calc */ }
      lista = lista.map(d => {
        if (!Array.isArray(d.itens)) return d;
        const itens = d.itens.map(it => {
          const r = it?.ref ? mapaSku.get(it.ref) : null;
          const refReal = r?.ref || null;
          const titulo = (refReal && calcMap.get(semZero(refReal))) || r?.desc_limpa || it.descricao || it.produto || null;
          return { ...it, sku: it.ref || it.sku || null, ref: refReal, descricao: titulo };
        });
        return { ...d, itens };
      });
    }

    return res.json({ ok: true, etapa, total: lista.length, unread, devolucoes: lista });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
