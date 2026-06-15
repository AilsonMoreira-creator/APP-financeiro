// ============================================================================
// MELUNI — leitura dos carrinhos abandonados (cards, via service-role).
// Query: status (default processando), limite (default 60), offset (0),
//   so_contato (bool: só com telefone/email). Junta nome/whatsapp do cliente.
// Ailson 13/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const status = q.status || 'processando';
  const limite = Math.min(200, parseInt(q.limite || '60', 10) || 60);
  const offset = Math.max(0, parseInt(q.offset || '0', 10) || 0);
  const soContato = q.so_contato === '1' || q.so_contato === 'true';

  try {
    let qy = supabase.from('meluni_carrinhos')
      .select('id,nome,telefone,email,valor,itens,data_carrinho,status,planilha_ref,cliente_id', { count: 'exact' })
      .eq('status', status)
      .order('data_carrinho', { ascending: false, nullsFirst: false })
      .range(offset, offset + limite - 1);
    if (soContato) qy = qy.not('telefone', 'is', null);

    const { data, count, error } = await qy;
    if (error) throw new Error(error.message);
    let lista = data || [];

    // enriquece com nome/whatsapp do cliente vinculado
    const ids = [...new Set(lista.map(c => c.cliente_id).filter(Boolean))];
    if (ids.length) {
      const { data: cls } = await supabase.from('meluni_clientes').select('id,nome,whatsapp').in('id', ids);
      const m = new Map((cls || []).map(c => [c.id, c]));
      lista = lista.map(c => {
        const cl = c.cliente_id ? m.get(c.cliente_id) : null;
        return { ...c, cliente_nome: cl?.nome || null, cliente_whatsapp: cl?.whatsapp || null };
      });
    }

    return res.json({ ok: true, total: count ?? lista.length, offset, limite, carrinhos: lista });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
