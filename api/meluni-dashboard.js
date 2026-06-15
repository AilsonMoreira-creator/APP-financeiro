// ============================================================================
// MELUNI — dashboard (agregados, via service-role).
// Query: dias (default 30) ou de/ate (YYYY-MM-DD) ou tudo=1.
// Retorna vendas, devoluções, VALOR REAL (vendas - devoluções), ticket,
// carrinhos e a série diária pro gráfico. Ailson 13/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

const diaISO = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const ate = q.ate || new Date().toISOString().slice(0, 10);
  const de = q.de || (q.tudo ? '2000-01-01' : diaISO(parseInt(q.dias || '30', 10) || 30));

  try {
    const [vd, dv, cr] = await Promise.all([
      supabase.from('meluni_vendas').select('data_pedido,total_pedido').gte('data_pedido', de).lte('data_pedido', ate),
      supabase.from('meluni_devolucoes').select('data_devolucao,valor,convertr_id,pedido_ref').gte('data_devolucao', de).lte('data_devolucao', ate),
      supabase.from('meluni_carrinhos').select('data_carrinho').gte('data_carrinho', de).lte('data_carrinho', ate + 'T23:59:59'),
    ]);
    if (vd.error) throw new Error('vendas: ' + vd.error.message);
    const vendas = vd.data || [], devol = dv.data || [], carr = cr.data || [];

    const vSoma = vendas.reduce((a, v) => a + (Number(v.total_pedido) || 0), 0);
    const dSoma = devol.reduce((a, v) => a + (Number(v.valor) || 0), 0);
    const devolQtd = new Set(devol.map(d => d.convertr_id || d.pedido_ref)).size;

    // série diária
    const dias = {};
    const add = (k, campo, val) => {
      if (!k) return;
      dias[k] = dias[k] || { data: k, vendas_valor: 0, vendas_qtd: 0, devol_valor: 0, carrinhos_qtd: 0 };
      dias[k][campo] += val;
    };
    vendas.forEach(v => { add(v.data_pedido, 'vendas_valor', Number(v.total_pedido) || 0); add(v.data_pedido, 'vendas_qtd', 1); });
    devol.forEach(v => add(v.data_devolucao, 'devol_valor', Number(v.valor) || 0));
    carr.forEach(v => add(String(v.data_carrinho || '').slice(0, 10), 'carrinhos_qtd', 1));
    const serie = Object.values(dias).sort((a, b) => (a.data < b.data ? -1 : 1));

    return res.json({
      ok: true, periodo: { de, ate },
      vendas: { qtd: vendas.length, soma: vSoma },
      devolucoes: { qtd: devolQtd, soma: dSoma },
      valor_real: vSoma - dSoma,
      ticket: vendas.length ? vSoma / vendas.length : 0,
      carrinhos: { qtd: carr.length },
      serie,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
