// ============================================================================
// _meluni-tags-anexar.js — anexa as tags (por telefone canonico) a uma lista de
// linhas dos endpoints de list das abas Clientes/Carrinho/SAC, pro front pintar
// os chips e filtrar. A tag na Meluni e transversal (mora em meluni_tags_vinculos
// por chaveTel), entao a mesma marca aparece nas 3 abas. Ailson 07/07/2026.
//
// getTel: extrator do telefone de cada linha (cada aba casa por um campo:
//   SAC = .telefone, carrinho = cliente_whatsapp||telefone, clientes = whatsapp||telefone).
// Muta cada linha adicionando .tags (array) e .reserva_alerta_em (quando houver).
// ============================================================================
import { chaveTel } from './_meluni-tel.js';

export async function anexarTags(supabase, linhas, getTel = (l) => l.telefone) {
  if (!Array.isArray(linhas) || !linhas.length) return linhas;
  const chaves = [...new Set(linhas.map(l => chaveTel(getTel(l))).filter(Boolean))];
  const porChave = {};
  if (chaves.length) {
    const { data: vincs } = await supabase.from('meluni_tags_vinculos')
      .select('telefone, tags, reserva_alerta_em')
      .in('telefone', chaves);
    for (const v of (vincs || [])) porChave[v.telefone] = v;
  }
  for (const l of linhas) {
    const ch = chaveTel(getTel(l));
    const v = ch ? porChave[ch] : null;
    l.tags = (v && Array.isArray(v.tags)) ? v.tags : [];
    if (v && v.reserva_alerta_em) l.reserva_alerta_em = v.reserva_alerta_em;
  }
  return linhas;
}
