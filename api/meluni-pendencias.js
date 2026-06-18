// MELUNI — contagem leve de pendências por seção, pro badge vermelho das abas
// do topo (Clientes / Carrinho / SAC). "Pendente" = conversa com última mensagem
// de ENTRADA ainda não vista (mesma regra que cada lista usa internamente).
// Uma leitura só de meluni_conversas. Ailson 18/06/2026.
import { supabase } from './_meluni-whats-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { data: convs, error } = await supabase
      .from('meluni_conversas')
      .select('origem, canal, ultima_msg_direcao, ultima_msg_em, visto_em')
      .in('ultima_msg_direcao', ['in', 'entrada'])
      .limit(5000);
    if (error) return res.status(500).json({ ok: false, erro: error.message });

    const naoVisto = (c) => !c.visto_em || (c.ultima_msg_em && new Date(c.ultima_msg_em) > new Date(c.visto_em));

    let sac = 0, clientes = 0, carrinho = 0;
    for (const c of (convs || [])) {
      if (!naoVisto(c)) continue;
      if (c.origem === 'carrinho') { carrinho++; continue; }
      if (c.origem === 'cliente') clientes++;
      // SAC = site + Direct (whatsapp/direct_insta), exclui carrinho, entrada não-vista
      if (['whatsapp', 'direct_insta'].includes(c.canal) && c.ultima_msg_direcao === 'entrada') sac++;
    }
    return res.json({ ok: true, clientes, carrinho, sac });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
