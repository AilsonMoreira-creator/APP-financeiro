// ============================================================================
// MELUNI — leitura das devoluções (cards, via service-role). Agrupa por pedido
// (uma devolução = N itens). Query: status (opcional), limite (default 100).
// Ailson 13/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const status = q.status || null;
  const limite = Math.min(500, parseInt(q.limite || '200', 10) || 200);

  try {
    let qy = supabase.from('meluni_devolucoes')
      .select('id,convertr_id,nome,telefone,cliente_id,pedido_ref,produto,ref,motivo,status,valor,data_devolucao,dados_extra')
      .order('data_devolucao', { ascending: false, nullsFirst: false })
      .limit(limite);
    if (status) qy = qy.eq('status', status);

    const { data, error } = await qy;
    if (error) throw new Error(error.message);

    // agrupa por devolução (convertr_id; fallback pedido_ref)
    const grupos = new Map();
    for (const d of data || []) {
      const chave = d.convertr_id || d.pedido_ref || d.id;
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          chave, convertr_id: d.convertr_id, pedido_ref: d.pedido_ref,
          nome: d.nome, telefone: d.telefone, cliente_id: d.cliente_id,
          motivo: d.motivo, status: d.status, data_devolucao: d.data_devolucao,
          tipo: d.dados_extra?.tipo || null, mensagem: d.dados_extra?.mensagem || null,
          rastreio: d.dados_extra?.rastreio || null,
          itens: [], total: 0,
        });
      }
      const g = grupos.get(chave);
      g.itens.push({ produto: d.produto, ref: d.ref, tamanho: d.dados_extra?.tamanho || null, valor: d.valor });
      g.total += Number(d.valor) || 0;
    }

    return res.json({ ok: true, total: grupos.size, devolucoes: [...grupos.values()] });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
