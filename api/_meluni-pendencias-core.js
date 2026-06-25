// ============================================================================
// _meluni-pendencias-core.js — FONTE ÚNICA da regra "conversa de carrinho é
// pendência de recuperação?". Usada pelo badge das abas (meluni-pendencias) E
// pela lista de carrinhos (meluni-carrinhos-list) pra os dois NUNCA divergirem.
//
// Bug que isto resolve: a regra estava escrita em 2 lugares. Em 24/06 a lista
// passou a excluir quem já comprou (cliente convertido que segue mandando msg
// pós-venda), mas o badge ficou na versão antiga e continuava contando essas
// conversas — que nem têm card na aba (estão em Conversão), então o número
// nunca zerava. Centralizando aqui, qualquer mudança futura vale pros dois.
// Ailson 24/06/2026.
// ============================================================================
import { chaveTel } from './_meluni-tel.js';

// Set de chaveTel de quem já comprou (carrinho convertido). Quem comprou e
// segue mandando mensagem NÃO é pendência de recuperação de carrinho.
export async function telefonesConvertidos(sb) {
  const { data } = await sb.from('meluni_carrinhos')
    .select('telefone')
    .or('status.eq.conversao,convertido_em.not.is.null');
  const set = new Set();
  for (const r of (data || [])) { const k = chaveTel(r.telefone); if (k) set.add(k); }
  return set;
}

// não-vista: sem visto_em, ou a última msg da cliente veio DEPOIS do último "visto".
export function naoVista(c) {
  return !c.visto_em || (!!c.ultima_msg_em && new Date(c.ultima_msg_em) > new Date(c.visto_em));
}

// true se a conversa (origem carrinho, última msg de ENTRADA) é pendência real
// de recuperação: não-vista E o telefone não é de quem já comprou.
export function pendenciaCarrinho(c, convTel) {
  if (!naoVista(c)) return false;
  const k = chaveTel(c.telefone);
  if (k && convTel && convTel.has(k)) return false; // já comprou
  return true;
}
