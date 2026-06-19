// ============================================================================
// _meluni-tel.js — telefone canônico BR pra casar conversas/clientes da Lara.
// ----------------------------------------------------------------------------
// Resolve dois problemas que quebram o match por igualdade/sufixo:
//   1) DDI 55 no começo (ex 55 67 9658-7704 vs 67 9658-7704).
//   2) o 9º dígito do celular, que fica NO MEIO (ex 67 9 9658-7704 vs 67 9658-7704)
//      — o WhatsApp às vezes entrega o wa_id sem ele, enquanto a origem (site/Bling)
//      grava com ele. Isso duplicava a conversa no SAC e fazia o nome "sumir".
// chaveTel = DDD (2) + 8 dígitos finais, sem 55 e sem o 9 do meio.
// Ailson 19/06/2026.
// ============================================================================

export const soDigitos = (s) => String(s || '').replace(/\D/g, '');

export function chaveTel(s) {
  let d = soDigitos(s);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);            // tira DDI
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);  // tira o 9 do meio
  if (d.length >= 10) return d.slice(0, 2) + d.slice(-8);              // DDD + 8 finais
  return d;
}

// sufixo de 8 dígitos (número do assinante) — estável entre todas as variações.
export const suf8 = (s) => soDigitos(s).slice(-8);

// Acha a conversa whatsapp do cliente por telefone canônico (ignora 55 e 9º dígito).
// Pré-filtra por sufixo de 8 dígitos no banco e confirma a chave no JS pra não
// casar DDD errado. Retorna a linha da conversa ou null.
export async function acharConversaWhats(supabase, telefone) {
  const ch = chaveTel(telefone);
  if (!ch) return null;
  const { data: cand } = await supabase
    .from('meluni_conversas')
    .select('id, telefone, origem, etapa, ultima_msg_em, nome_cliente')
    .eq('canal', 'whatsapp')
    .ilike('telefone', `%${suf8(telefone)}`)
    .order('ultima_msg_em', { ascending: false })
    .limit(20);
  return (cand || []).find((c) => chaveTel(c.telefone) === ch) || null;
}
