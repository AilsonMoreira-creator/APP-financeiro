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

// ── Janela de envio AUTOMÁTICO da Lara: seg–sáb, 09:00–20:00 (America/São_Paulo) ──
// Fora dela os crons de envio NÃO mandam mensagem; seguram até a próxima janela.
// (antes das 09:00 → mesmo dia às 09:00; depois das 20:00 ou domingo → próximo
//  dia útil às 09:00). Vale só pra disparo automático — envio manual não passa aqui.
export const JANELA_ENVIO = { horaIni: 9, horaFim: 20, diasOk: [1, 2, 3, 4, 5, 6] }; // 0=domingo

export function dentroJanelaEnvio(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  if (!JANELA_ENVIO.diasOk.includes(wd)) return false;
  let h = parseInt(p.hour, 10); if (h === 24) h = 0;
  const mins = h * 60 + parseInt(p.minute, 10);
  return mins >= JANELA_ENVIO.horaIni * 60 && mins < JANELA_ENVIO.horaFim * 60;
}
