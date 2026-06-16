// ============================================================================
// MELUNI — GET thread da conversa + sugestão pendente da Lara.
// query: ?conversa_id=  OU  ?telefone=   (telefone resolve a conversa whatsapp)
// retorna { ok, conversa, mensagens[], sugestao }. Ailson 16/06/2026.
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';

const normTel = (s) => String(s || '').replace(/\D/g, '');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    let conversaId = req.query.conversa_id || null;
    const telefone = req.query.telefone ? normTel(req.query.telefone) : null;

    let conversa = null;
    if (conversaId) {
      const { data } = await supabase.from('meluni_conversas').select('*').eq('id', conversaId).maybeSingle();
      conversa = data || null;
    } else if (telefone) {
      const { data } = await supabase.from('meluni_conversas')
        .select('*').eq('canal', 'whatsapp').eq('telefone', telefone)
        .order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle();
      conversa = data || null;
      conversaId = conversa?.id || null;
    }

    if (!conversaId) {
      // sem conversa ainda (número novo / cliente nunca escreveu)
      return res.json({ ok: true, conversa: null, mensagens: [], sugestao: null });
    }

    const { data: mensagens } = await supabase.from('meluni_mensagens')
      .select('id, direcao, autor, tipo_midia, texto, midia_url, enviada_em')
      .eq('conversa_id', conversaId)
      .order('enviada_em', { ascending: true })
      .limit(200);

    const { data: sugestao } = await supabase.from('meluni_sugestoes')
      .select('id, texto, status, criado_em')
      .eq('conversa_id', conversaId).eq('status', 'pendente')
      .order('criado_em', { ascending: false }).limit(1).maybeSingle();

    return res.json({ ok: true, conversa, mensagens: mensagens || [], sugestao: sugestao || null });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
