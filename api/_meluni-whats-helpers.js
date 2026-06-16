// ============================================================================
// MELUNI — helpers compartilhados do motor da Lara (config + supabase).
// meluni_config é chave/valor (jsonb), igual o usado pelo webhook do Insta.
// Ailson 16/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';
export { supabase };

export async function cfgMeluni(chave, def = null) {
  try {
    const { data } = await supabase.from('meluni_config').select('valor').eq('chave', chave).maybeSingle();
    return data?.valor ?? def;
  } catch {
    return def;
  }
}

export async function setCfgMeluni(chave, valor) {
  await supabase.from('meluni_config')
    .upsert({ chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
}
