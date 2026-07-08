// ============================================================================
// _meluni-tags-core.js — leitura/escrita das tags por telefone canonico
// (meluni_tags_vinculos). Usado pelos fluxos automaticos: inbound (marca
// 'potencial' quando a cliente demonstra intencao) e ia (Lara marca 'atencao').
// Tudo best-effort: quem chama envolve em try/catch e nunca deixa derrubar o
// fluxo principal. Ailson 07/07/2026.
// ============================================================================
import { chaveTel } from './_meluni-tel.js';

export async function tagsDoTelefone(supabase, telefone) {
  const chave = chaveTel(telefone);
  if (!chave) return { chave: null, tags: [] };
  const { data } = await supabase.from('meluni_tags_vinculos')
    .select('tags').eq('telefone', chave).maybeSingle();
  return { chave, tags: Array.isArray(data?.tags) ? data.tags : [] };
}

// adiciona uma tag ao telefone sem duplicar. novaTag = { id } ou { id, ref }.
// retorna { aplicou, tags, chave }.
export async function aplicarTagTelefone(supabase, telefone, novaTag) {
  const { chave, tags } = await tagsDoTelefone(supabase, telefone);
  if (!chave || !novaTag?.id) return { aplicou: false, tags, chave };
  if (tags.some(t => t.id === novaTag.id)) return { aplicou: false, tags, chave };
  const novas = [...tags, novaTag].slice(0, 6);
  const { error } = await supabase.from('meluni_tags_vinculos')
    .upsert({ telefone: chave, tags: novas, atualizado_em: new Date().toISOString() }, { onConflict: 'telefone' });
  if (error) return { aplicou: false, tags, chave };
  return { aplicou: true, tags: novas, chave };
}

// Set (chaves canonicas) dos telefones com alguma tag que congela os envios
// automaticos (def congela_auto=true; hoje so 'atencao'). Os disparos carregam
// uma vez e pulam quem estiver no Set. Ailson 07/07/2026.
export async function telefonesCongelados(supabase) {
  const set = new Set();
  try {
    const { data: defs } = await supabase.from('meluni_tags').select('id').eq('congela_auto', true);
    const ids = (defs || []).map(d => d.id);
    if (!ids.length) return set;
    const { data: vincs } = await supabase.from('meluni_tags_vinculos').select('telefone, tags');
    for (const v of (vincs || [])) {
      if ((v.tags || []).some(t => ids.includes(t.id))) set.add(v.telefone);
    }
  } catch (e) { console.error('[meluni-tags] telefonesCongelados:', e?.message || e); }
  return set;
}
