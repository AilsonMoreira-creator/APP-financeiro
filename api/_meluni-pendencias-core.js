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

// 17/09 (Ailson): resposta AUTOMÁTICA do WhatsApp da cliente ("assim que possível
// te respondo", "mensagem automática", "estou dirigindo"…) não é pergunta — não vira
// pendência. Lista curta e conservadora de propósito: só frases que existem em
// auto-resposta e não em conversa de verdade. Qualquer texto maior que ~180
// caracteres ou com pergunta ("?") NUNCA é tratado como automático.
const PADROES_AUTO = [
  'assim que possivel te respondo', 'assim que possivel respondo', 'retorno assim que possivel',
  'responderei assim que possivel', 'mensagem automatica', 'resposta automatica',
  'estou dirigindo', 'no momento nao posso atender', 'nao posso atender no momento',
  'estou ocupada no momento', 'retornarei o mais breve', 'obrigada pelo contato em breve',
  'em breve retornaremos', 'esta e uma mensagem automatica',
];
export function ehAutoResposta(texto) {
  const t = String(texto || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // tira acento
    .replace(/\s+/g, ' ').trim();
  if (!t || t.length > 180) return false;
  // "?" só desqualifica quando NÃO é a saudação colada na auto-resposta
  // ("Olá, tudo bem? Assim que possível te respondo" é automática).
  const bate = PADROES_AUTO.some(p => t.includes(p));
  if (!bate) return false;
  const semSaudacao = t.replace(/^(ola|oi|bom dia|boa tarde|boa noite)[ ,!]*(tudo bem|td bem)?[ ,!?]*/i, '');
  return !semSaudacao.includes('?');
}

// Dos candidatos a pendência, quais têm como ÚLTIMA mensagem da cliente uma
// auto-resposta. Uma consulta só, e só pros candidatos (hoje são poucos).
export async function idsComAutoResposta(sb, ids) {
  const out = new Set();
  const lista = [...new Set((ids || []).filter(Boolean))];
  if (!lista.length) return out;
  const { data } = await sb.from('meluni_mensagens')
    .select('conversa_id, texto, enviada_em, direcao')
    .in('conversa_id', lista)
    .in('direcao', ['in', 'entrada'])
    .order('enviada_em', { ascending: false })
    .limit(2000);
  const visto = new Set();
  for (const m of (data || [])) {
    if (visto.has(m.conversa_id)) continue;   // já peguei a última desta conversa
    visto.add(m.conversa_id);
    if (ehAutoResposta(m.texto)) out.add(m.conversa_id);
  }
  return out;
}

// true se a conversa (origem carrinho, última msg de ENTRADA) é pendência real
// de recuperação: não-vista E o telefone não é de quem já comprou.
export function pendenciaCarrinho(c, convTel) {
  if (!naoVista(c)) return false;
  if (ehAutoResposta(c.ultima_msg_texto)) return false;   // 17/09: auto-resposta não pede resposta
  const k = chaveTel(c.telefone);
  if (k && convTel && convTel.has(k)) return false; // já comprou
  return true;
}
