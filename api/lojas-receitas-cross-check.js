// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-receitas-cross-check
// ═══════════════════════════════════════════════════════════════════════════
// Investiga vendas mal classificadas por loja. Caso real Ailson 08/05/2026:
// planilha do Bom Retiro foi colocada por engano na pasta Silva Teles do
// Drive, fazendo o parser classificar vendas BR como loja='Silva Teles'.
// Outro chat tratou parcialmente, mas pode ter sobras.
//
// Pra o periodo informado, lista 4 grupos de inconsistencia:
//
// A) Pedidos duplicados em LOJAS diferentes
//    Mesmo numero_pedido em lojas_vendas + lojas_vendas_varejo (em qualquer
//    combinacao) com lojas diferentes. So pode existir um.
//
// B) Pedidos duplicados em TIPOS diferentes na mesma loja
//    Mesmo numero_pedido em lojas_vendas (atacado) E lojas_vendas_varejo.
//    Caso 91742 IZABEL FAGUNDES no dia 04/05/2026.
//
// C) Vendas com loja inconsistente com vendedora
//    venda.loja='Silva Teles' mas vendedora resolvida via aliases tem
//    loja='Bom Retiro'. Smoking gun de import na pasta errada.
//
// D) Resumo por loja x dia: qtd_pedidos e total_liquido em cada tabela.
//
// Uso:
//   GET /api/lojas-receitas-cross-check?user=ailson&data_inicio=2026-05-04&data_fim=2026-05-04
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ADMINS = ['ailson', 'amicia-admin', 'admin', 'tamara'];

// Resolve nome cru de vendedora pra lojas[]. Usa aliases. Pode dar match
// em multiplas (raro mas possivel — Joelma+Regilania ambos sao do ST).
function resolverLojaPorVendedora(nomeRaw, vendedoras) {
  if (!nomeRaw) return null;
  const norm = String(nomeRaw).trim().toUpperCase();
  for (const v of vendedoras) {
    if (String(v.nome).toUpperCase() === norm) return v.loja;
    if (Array.isArray(v.aliases)) {
      for (const a of v.aliases) {
        if (String(a).toUpperCase() === norm) return v.loja;
      }
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = req.query.user || '';
  if (!ADMINS.includes(user)) {
    return res.status(403).json({ error: 'Auth: ?user=ailson|amicia-admin|tamara' });
  }

  const di = req.query.data_inicio;
  const df = req.query.data_fim || di;

  if (!di || !/^\d{4}-\d{2}-\d{2}$/.test(di)) {
    return res.status(400).json({ error: 'data_inicio obrigatoria, formato YYYY-MM-DD' });
  }

  try {
    // 1. Carrega vendedoras pra resolver loja por nome
    const { data: vendedoras, error: errVend } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome, loja, aliases');
    if (errVend) throw new Error('vendedoras: ' + errVend.message);

    // 2. Atacado no periodo
    const { data: atacado, error: errA } = await supabase
      .from('lojas_vendas')
      .select('numero_pedido, loja, data_venda, valor_liquido, vendedora_nome_raw, cliente_razao_raw, canal_origem, created_at')
      .gte('data_venda', di)
      .lte('data_venda', df)
      .order('numero_pedido');
    if (errA) throw new Error('atacado: ' + errA.message);

    // 3. Varejo no periodo
    const { data: varejo, error: errV } = await supabase
      .from('lojas_vendas_varejo')
      .select('numero_pedido, loja, data_venda, valor_liquido, vendedora_nome_raw, forma_pagamento, created_at')
      .gte('data_venda', di)
      .lte('data_venda', df)
      .order('numero_pedido');
    if (errV) throw new Error('varejo: ' + errV.message);

    // ─── A) Duplicados em LOJAS diferentes ─────────────────────────────
    const porPedido = new Map();
    const todos = [
      ...(atacado || []).map(v => ({ ...v, _tabela: 'atacado' })),
      ...(varejo || []).map(v => ({ ...v, _tabela: 'varejo' })),
    ];
    for (const v of todos) {
      const key = String(v.numero_pedido);
      if (!porPedido.has(key)) porPedido.set(key, []);
      porPedido.get(key).push(v);
    }

    const duplicadosLojas = [];
    const duplicadosTipos = [];
    for (const [pedido, regs] of porPedido) {
      const lojasDistintas = new Set(regs.map(r => r.loja));
      const tabelasDistintas = new Set(regs.map(r => r._tabela));
      if (lojasDistintas.size > 1) {
        duplicadosLojas.push({ pedido, regs });
      }
      if (tabelasDistintas.size > 1 && lojasDistintas.size === 1) {
        duplicadosTipos.push({ pedido, loja: regs[0].loja, regs });
      }
    }

    // ─── C) Loja inconsistente com vendedora ────────────────────────────
    const inconsistentes = [];
    for (const v of todos) {
      const lojaEsperada = resolverLojaPorVendedora(v.vendedora_nome_raw, vendedoras || []);
      if (lojaEsperada && lojaEsperada !== v.loja) {
        inconsistentes.push({
          pedido: v.numero_pedido,
          tabela: v._tabela,
          data: v.data_venda,
          loja_no_banco: v.loja,
          loja_esperada_pela_vendedora: lojaEsperada,
          vendedora_nome_raw: v.vendedora_nome_raw,
          valor_liquido: v.valor_liquido,
          cliente: v.cliente_razao_raw || null,
          created_at: v.created_at,
        });
      }
    }

    // ─── D) Resumo por loja+tabela ──────────────────────────────────────
    const resumo = {};
    for (const v of todos) {
      const key = `${v.loja}|${v._tabela}|${v.data_venda}`;
      if (!resumo[key]) resumo[key] = { loja: v.loja, tabela: v._tabela, data: v.data_venda, qtd: 0, total: 0 };
      resumo[key].qtd += 1;
      resumo[key].total += Number(v.valor_liquido || 0);
    }
    const resumoArr = Object.values(resumo)
      .map(r => ({ ...r, total: Math.round(r.total * 100) / 100 }))
      .sort((a, b) => a.data.localeCompare(b.data) || a.loja.localeCompare(b.loja));

    return res.json({
      ok: true,
      consulta: { data_inicio: di, data_fim: df },
      contagem_geral: {
        total_pedidos_unicos: porPedido.size,
        total_registros_atacado: atacado?.length || 0,
        total_registros_varejo: varejo?.length || 0,
      },
      a_duplicados_em_lojas_diferentes: duplicadosLojas,
      b_duplicados_atacado_e_varejo_mesma_loja: duplicadosTipos,
      c_loja_inconsistente_com_vendedora: inconsistentes,
      d_resumo_por_loja_tabela_data: resumoArr,
    });
  } catch (e) {
    console.error('[cross-check] erro:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
