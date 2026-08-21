// /api/sofia-busca-diag — one-off: confirma se um cliente da loja física
// existe no módulo Sofia (conversas, sacolas, leads). ?nome=eliziane
import { supabase } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  const nome = String(req.query?.nome || '').trim();
  if (nome.length < 3) return res.status(400).json({ erro: 'passa ?nome=' });
  try {
    const like = `%${nome}%`;
    const { data: convs } = await supabase.from('lojas_whats_conversas')
      .select('id, nome_cliente, telefone, etapa, criado_em, atualizado_em')
      .ilike('nome_cliente', like).order('atualizado_em', { ascending: false }).limit(10);
    const ids = (convs || []).map(c => c.id);
    let msgs = [];
    if (ids.length) {
      const { data: m } = await supabase.from('lojas_whats_mensagens')
        .select('conversa_id, enviada_em, direcao, template_name')
        .in('conversa_id', ids).order('enviada_em', { ascending: false }).limit(12);
      msgs = m || [];
    }
    let sacolas = [];
    try {
      const { data: s } = await supabase.from('lojas_pedidos_sacola')
        .select('*').ilike('cliente_nome', like).limit(5);
      sacolas = s || [];
    } catch { /* coluna pode ter outro nome */ }
    return res.status(200).json({ conversas: convs || [], ultimas_mensagens: msgs, sacolas });
  } catch (e) {
    return res.status(500).json({ erro: String(e?.message || e) });
  }
}
