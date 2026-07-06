// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-debug-conversa — consulta READ-ONLY pra investigacao
// ═══════════════════════════════════════════════════════════════════════════
// Usado quando precisa auditar uma conversa (etapa errada, msg sumida etc)
// sem depender de acesso direto ao banco. Ailson 06/07/2026.
//
// GET ?nome=kemilly   | ?tel=17992699697 | ?conversa_id=uuid
// Retorna: conversa completa + ultimas 20 mensagens + sugestoes recentes.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { nome, tel, conversa_id } = req.query || {};
  if (!nome && !tel && !conversa_id) return res.status(400).json({ error: 'nome, tel ou conversa_id obrigatorio' });

  try {
    let q = supabase.from('lojas_whats_conversas').select('*').limit(3);
    if (conversa_id) q = q.eq('id', conversa_id);
    else if (nome) q = q.ilike('nome_cliente', `%${nome}%`);
    else q = q.like('telefone', `%${String(tel).replace(/\D/g, '')}%`);

    const { data: convs, error } = await q.order('iniciada_em', { ascending: false });
    if (error) throw error;
    if (!convs?.length) return res.status(404).json({ error: 'nenhuma conversa encontrada' });

    const conv = convs[0];
    const [{ data: msgs }, { data: sugs }] = await Promise.all([
      supabase.from('lojas_whats_mensagens')
        .select('direcao, autor, tipo_midia, status, enviada_em, texto')
        .eq('conversa_id', conv.id)
        .order('enviada_em', { ascending: false }).limit(20),
      supabase.from('lojas_whats_sugestoes')
        .select('id, tipo, status, criada_em, atualizada_em, motivo_proposta')
        .eq('conversa_id', conv.id)
        .order('criada_em', { ascending: false }).limit(10),
    ]);

    return res.status(200).json({
      total_matches: convs.length,
      conversa: conv,
      mensagens: (msgs || []).map(m => ({ ...m, texto: m.texto ? m.texto.slice(0, 120) : null })),
      sugestoes: sugs || [],
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
