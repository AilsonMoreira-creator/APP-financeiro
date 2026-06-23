// ============================================================================
// MELUNI — GET thread da conversa + sugestão pendente da Lara.
// query: ?conversa_id=  OU  ?telefone=   (telefone resolve a conversa whatsapp)
// retorna { ok, conversa, mensagens[], sugestao }. Ailson 16/06/2026.
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';
import { acharConversaWhats } from './_meluni-tel.js';

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
      // resolve por telefone canônico (ignora 55 e o 9º dígito do meio): o carrinho
      // passa o número com o 9 e a conversa do WhatsApp às vezes está sem, então o
      // match exato não achava a conversa e o visto_em nunca era gravado. Ailson 23/06.
      const match = await acharConversaWhats(supabase, telefone);
      if (match?.id) {
        const { data } = await supabase.from('meluni_conversas').select('*').eq('id', match.id).maybeSingle();
        conversa = data || null;
        conversaId = conversa?.id || null;
      }
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

    // marca a conversa como vista AGORA → zera o badge de não-lido dela.
    // (o front faz poll enquanto aberta, então msgs que chegam com a conversa
    //  aberta já entram como vistas; ao fechar, o visto_em congela e uma nova
    //  entrada posterior volta a marcar como não-lida.)
    try { await supabase.from('meluni_conversas').update({ visto_em: new Date().toISOString() }).eq('id', conversaId); } catch { /* não bloqueia a leitura */ }

    const { data: sugestao } = await supabase.from('meluni_sugestoes')
      .select('id, texto, status, criado_em')
      .eq('conversa_id', conversaId).eq('status', 'pendente')
      .order('criado_em', { ascending: false }).limit(1).maybeSingle();

    return res.json({ ok: true, conversa, mensagens: mensagens || [], sugestao: sugestao || null });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
