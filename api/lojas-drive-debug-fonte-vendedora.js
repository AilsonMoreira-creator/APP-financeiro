/**
 * lojas-drive-debug-fonte-vendedora.js
 *
 * Diagnóstico para descobrir POR QUE o backfill de vendedora não está
 * atribuindo Joelma aos clientes que passaram por KELLY/REGILANIA.
 *
 * Hipótese: parseRelatorioVendasClientes seta vendedora_id baseado no
 * agregado do Mire (lógica "última vendedora") ANTES do backfill rodar.
 * Como o backfill só toca clientes com vendedora_id IS NULL, a regra
 * de absorção nunca é aplicada.
 *
 * Acesso: GET /api/lojas-drive-debug-fonte-vendedora?user=ailson
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
    // ─── QUERY 1: distribuição de fonte de atribuição em Silva Teles ────
    // Se a hipótese estiver certa, 'relatorio_vendas_clientes' deve ser
    // MUITO maior que 'vendedora_dominante_historico' em ST.
    const { data: fontesSt, error: e1 } = await supabase
      .from('lojas_clientes')
      .select('fonte_atribuicao')
      .eq('loja_origem', 'Silva Teles');

    if (e1) return res.status(500).json({ erro: 'q1', detail: e1.message });

    out.silva_teles_por_fonte = contarPor(fontesSt, r => r.fonte_atribuicao || '<null>');

    // Mesma coisa pra BR pra comparação
    const { data: fontesBr, error: e1b } = await supabase
      .from('lojas_clientes')
      .select('fonte_atribuicao')
      .eq('loja_origem', 'Bom Retiro');

    if (e1b) return res.status(500).json({ erro: 'q1b', detail: e1b.message });

    out.bom_retiro_por_fonte = contarPor(fontesBr, r => r.fonte_atribuicao || '<null>');

    // ─── QUERY 2: clientes que passaram por KELLY/REGILANIA mas não estão
    //              com Joelma. Esse é o sintoma direto do bug. ───────────
    const { data: vendasKelly, error: e2 } = await supabase
      .from('lojas_vendas')
      .select('cliente_id, vendedora_nome_raw')
      .in('vendedora_nome_raw', ['KELLY', 'REGILANIA', 'kelly', 'regilania', 'Kelly', 'Regilania'])
      .not('cliente_id', 'is', null);

    if (e2) return res.status(500).json({ erro: 'q2', detail: e2.message });

    const clienteIdsKelly = [...new Set((vendasKelly || []).map(v => v.cliente_id))];
    out.total_clientes_que_compraram_com_kelly_ou_regilania = clienteIdsKelly.length;

    // Busca esses clientes (em lote pra evitar IN > 1000)
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

    // Achar id da Joelma
    const { data: joelmaRow } = await supabase
      .from('lojas_vendedoras')
      .select('id')
      .eq('nome', 'Joelma')
      .single();
    const joelmaId = joelmaRow?.id;

    out.joelma_id = joelmaId;

    // Resolver nome de cada vendedora_id
    const vendIdsUsados = [...new Set(clientesKelly.map(c => c.vendedora_id).filter(Boolean))];
    const { data: vendsRes } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome')
      .in('id', vendIdsUsados);
    const vidToNome = new Map((vendsRes || []).map(v => [v.id, v.nome]));

    // Cruzar: vendedora_atual x fonte_atribuicao
    const cruz = new Map();
    for (const c of clientesKelly) {
      const nome = c.vendedora_id ? vidToNome.get(c.vendedora_id) : '<sem vendedora>';
      const fonte = c.fonte_atribuicao || '<null>';
      const key = `${nome} | ${fonte}`;
      cruz.set(key, (cruz.get(key) || 0) + 1);
    }
    out.clientes_kelly_regilania_por_vendedora_e_fonte = Object.fromEntries(
      [...cruz.entries()].sort((a, b) => b[1] - a[1])
    );

    // O número que importa: quantos NÃO estão com Joelma
    const naoJoelma = clientesKelly.filter(c => c.vendedora_id !== joelmaId).length;
    const simJoelma = clientesKelly.filter(c => c.vendedora_id === joelmaId).length;
    out.clientes_kelly_com_joelma = simJoelma;
    out.clientes_kelly_SEM_joelma = naoJoelma;

    // ─── QUERY 3: aliases REAIS no banco vs hardcoded em VENDEDORAS_INICIAIS
    const { data: vendsAtivas } = await supabase
      .from('lojas_vendedoras')
      .select('nome, loja, aliases, ativa, is_padrao_loja, is_placeholder')
      .eq('ativa', true)
      .order('loja')
      .order('nome');
    out.vendedoras_no_banco = vendsAtivas;

    // ─── QUERY 4: nomes únicos no histórico ST (pra ver o que existe lá)
    const { data: nomesSt } = await supabase
      .from('lojas_vendas')
      .select('vendedora_nome_raw')
      .eq('loja', 'Silva Teles')
      .not('vendedora_nome_raw', 'is', null);

    const contNomes = new Map();
    for (const r of (nomesSt || [])) {
      const n = (r.vendedora_nome_raw || '').toUpperCase().trim();
      if (n) contNomes.set(n, (contNomes.get(n) || 0) + 1);
    }
    out.nomes_no_historico_st = Object.fromEntries(
      [...contNomes.entries()].sort((a, b) => b[1] - a[1])
    );

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
