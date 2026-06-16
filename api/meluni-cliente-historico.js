// ============================================================================
// MELUNI — histórico de compras de um cliente (pro chat + contexto da Lara).
// Alimenta a personalizacao e o cross-sell: o que ja comprou (ref, produto,
// cor, tamanho, valor, data). Query: cliente_id. Ailson 15/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const clienteId = (req.query || {}).cliente_id;
  if (!clienteId) return res.status(400).json({ ok: false, erro: 'cliente_id obrigatorio' });

  try {
    const { data: cli } = await supabase.from('meluni_clientes')
      .select('nome, whatsapp, telefone, cpf, n_compras, valor_lifetime, ticket_medio, primeira_compra, ultima_compra')
      .eq('id', clienteId).single();

    const { data: vendas } = await supabase.from('meluni_vendas')
      .select('pedido_id, data_pedido, total_pedido, itens')
      .eq('cliente_id', clienteId)
      .order('data_pedido', { ascending: false });

    const pedidos = (vendas || []).map(v => ({
      pedido_id: v.pedido_id,
      data: v.data_pedido,
      total: Number(v.total_pedido) || 0,
      itens: (Array.isArray(v.itens) ? v.itens : []).map(i => ({
        ref: i.ref || null,
        produto: i.descLimpa || i.descricao || i.ref || 'item',
        cor: i.cor || null,
        tamanho: i.tamanho || null,
        valor: Number(i.valor) || 0,
        qtd: i.quantidade || 1,
      })),
    }));

    // refs e produtos distintos ja comprados (base do cross-sell: nao reofertar o mesmo)
    const vistos = new Set();
    const produtosComprados = [];
    for (const p of pedidos) for (const it of p.itens) {
      if (it.ref && !vistos.has(it.ref)) { vistos.add(it.ref); produtosComprados.push({ ref: it.ref, produto: it.produto }); }
    }

    return res.json({
      ok: true,
      cliente: cli || null,
      pedidos,
      refs_comprados: [...vistos],
      produtos_comprados: produtosComprados,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
