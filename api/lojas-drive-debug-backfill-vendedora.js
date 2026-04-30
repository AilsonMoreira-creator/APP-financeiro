/**
 * lojas-drive-debug-backfill-vendedora.js
 *
 * Diagnóstico: por que o backfill de vendedora não atribui Joelma aos
 * clientes que passaram por KELLY/REGILANIA?
 *
 * Hipótese a confirmar: parseRelatorioVendasClientes seta vendedora_id
 * baseado no agregado do Mire ANTES do backfill rodar. Como o backfill
 * só toca clientes com vendedora_id IS NULL, a regra de absorção
 * (forte > fraca > última) nunca é aplicada.
 *
 * Acesso: GET /api/lojas-drive-debug-backfill-vendedora?user=ailson
 */

import { supabase, setCors } from './_lojas-helpers.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query.user !== 'ailson') {
    return res.status(403).json({ error: 'Apenas admin (?user=ailson)' });
  }

  const out = {};

  try {
    // ─── Q1: distribuição de fonte por loja ─────────────────────────────
    for (const loja of ['Silva Teles', 'Bom Retiro']) {
      const { data, error } = await supabase
        .from('lojas_clientes')
        .select('fonte_atribuicao')
        .eq('loja_origem', loja);
      if (error) return res.status(500).json({ erro: `q1 ${loja}`, detail: error.message });
      out[`q1_fonte_${loja.replace(' ', '_').toLowerCase()}`] =
        contarPor(data, r => r.fonte_atribuicao || '<null>');
    }

    const { count: totalClientes } = await supabase
      .from('lojas_clientes')
      .select('*', { count: 'exact', head: true });
    out.q1_total_clientes = totalClientes;

    const { count: totalSemVend } = await supabase
      .from('lojas_clientes')
      .select('*', { count: 'exact', head: true })
      .is('vendedora_id', null);
    out.q1_total_sem_vendedora = totalSemVend;

    // ─── Q2: clientes que passaram por KELLY/REGILANIA ──────────────────
    const { data: vendasKelly, error: e2 } = await supabase
      .from('lojas_vendas')
      .select('cliente_id, vendedora_nome_raw')
      .or('vendedora_nome_raw.ilike.%KELLY%,vendedora_nome_raw.ilike.%REGILANIA%')
      .not('cliente_id', 'is', null);
    if (e2) return res.status(500).json({ erro: 'q2', detail: e2.message });

    const clienteIdsKelly = [...new Set((vendasKelly || []).map(v => v.cliente_id))];
    out.q2_total_clientes_kelly_ou_regilania = clienteIdsKelly.length;
    out.q2_total_vendas = (vendasKelly || []).length;

    const nomesRaw = new Set((vendasKelly || []).map(v => v.vendedora_nome_raw));
    out.q2_nomes_raw_encontrados = [...nomesRaw];

    if (clienteIdsKelly.length > 0) {
      const clientesKelly = [];
      for (let i = 0; i < clienteIdsKelly.length; i += 200) {
        const lote = clienteIdsKelly.slice(i, i + 200);
        const { data, error } = await supabase
          .from('lojas_clientes')
          .select('id, vendedora_id, fonte_atribuicao, loja_origem')
          .in('id', lote);
        if (error) return res.status(500).json({ erro: 'q2b', detail: error.message });
        clientesKelly.push(...(data || []));
      }

      const { data: joelmaRow } = await supabase
        .from('lojas_vendedoras')
        .select('id')
        .eq('nome', 'Joelma')
        .maybeSingle();
      const joelmaId = joelmaRow?.id;
      out.q2_joelma_id = joelmaId;

      const vendIds = [...new Set(clientesKelly.map(c => c.vendedora_id).filter(Boolean))];
      const { data: vendsRes } = await supabase
        .from('lojas_vendedoras')
        .select('id, nome')
        .in('id', vendIds);
      const vidToNome = new Map((vendsRes || []).map(v => [v.id, v.nome]));

      const cruz = new Map();
      for (const c of clientesKelly) {
        const nome = c.vendedora_id ? (vidToNome.get(c.vendedora_id) || '<id desconhecido>') : '<sem vendedora>';
        const fonte = c.fonte_atribuicao || '<null>';
        const key = `${nome} | ${fonte}`;
        cruz.set(key, (cruz.get(key) || 0) + 1);
      }
      out.q2_cruz_vendedora_x_fonte = Object.fromEntries(
        [...cruz.entries()].sort((a, b) => b[1] - a[1])
      );

      out.q2_com_joelma = clientesKelly.filter(c => c.vendedora_id === joelmaId).length;
      out.q2_SEM_joelma = clientesKelly.filter(c => c.vendedora_id !== joelmaId).length;
    }

    // ─── Q3: aliases REAIS no banco ─────────────────────────────────────
    const { data: vendsAtivas } = await supabase
      .from('lojas_vendedoras')
      .select('nome, loja, aliases, ativa, is_padrao_loja, is_placeholder')
      .eq('ativa', true)
      .order('loja')
      .order('nome');
    out.q3_vendedoras_ativas = (vendsAtivas || []).map(v => ({
      nome: v.nome,
      loja: v.loja,
      qtd_aliases: (v.aliases || []).length,
      aliases: v.aliases,
      is_padrao_loja: v.is_padrao_loja,
      is_placeholder: v.is_placeholder,
    }));

    // ─── Q4: top 30 nomes únicos no histórico ST ────────────────────────
    const { data: nomesSt } = await supabase
      .from('lojas_vendas')
      .select('vendedora_nome_raw')
      .eq('loja', 'Silva Teles')
      .not('vendedora_nome_raw', 'is', null);

    const cont = new Map();
    for (const r of (nomesSt || [])) {
      const n = (r.vendedora_nome_raw || '').toUpperCase().trim();
      if (n) cont.set(n, (cont.get(n) || 0) + 1);
    }
    const sorted = [...cont.entries()].sort((a, b) => b[1] - a[1]);
    out.q4_nomes_no_historico_st = Object.fromEntries(sorted.slice(0, 30));
    out.q4_total_nomes_distintos_st = sorted.length;

    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ erro: err.message, stack: err.stack?.split('\n').slice(0, 8) });
  }
}

function contarPor(rows, fn) {
  const m = new Map();
  for (const r of (rows || [])) {
    const k = fn(r);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));
}
