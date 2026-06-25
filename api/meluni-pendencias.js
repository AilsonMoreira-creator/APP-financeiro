// MELUNI — contagem leve de pendências por seção, pro badge vermelho das abas
// do topo (Clientes / Carrinho / SAC). "Pendente" = conversa com última mensagem
// de ENTRADA ainda não vista. Carrinho exclui quem já comprou (mesma regra da
// lista, via _meluni-pendencias-core), pra o badge e a lista nunca divergirem.
// Uma leitura de meluni_conversas + uma de carrinhos convertidos. Ailson 24/06/2026.
import { supabase } from './_meluni-whats-helpers.js';
import { telefonesConvertidos, naoVista, pendenciaCarrinho } from './_meluni-pendencias-core.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const { data: convs, error } = await supabase
      .from('meluni_conversas')
      .select('origem, canal, ultima_msg_direcao, ultima_msg_em, visto_em, telefone')
      .in('ultima_msg_direcao', ['in', 'entrada'])
      .limit(5000);
    if (error) return res.status(500).json({ ok: false, erro: error.message });

    // mesma exclusão de convertidos que a lista usa (fonte única)
    const convTel = await telefonesConvertidos(supabase);

    let sac = 0, clientes = 0, carrinho = 0;
    for (const c of (convs || [])) {
      // carrinho: regra compartilhada (não-vista + não é quem já comprou)
      if (c.origem === 'carrinho') { if (pendenciaCarrinho(c, convTel)) carrinho++; continue; }
      if (!naoVista(c)) continue;
      if (c.origem === 'cliente') { clientes++; continue; }
      // SAC = site + Direct (whatsapp/direct_insta), exclui carrinho/cliente, entrada não-vista
      if (['whatsapp', 'direct_insta'].includes(c.canal) && c.ultima_msg_direcao === 'entrada') sac++;
    }
    return res.json({ ok: true, clientes, carrinho, sac });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
