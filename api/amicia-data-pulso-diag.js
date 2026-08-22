// /api/amicia-data-pulso-diag — one-off: carimbo _updated dos payloads que
// tinham realtime. Duas chamadas espacadas mostram a FREQUENCIA de escrita
// (suspeita de eco entre sessoes).
import { supabase } from './_ml-helpers.js';

export default async function handler(req, res) {
  const alvos = ['amicia-admin', 'ailson_cortes', 'salas-corte', 'backup-diario'];
  const { data } = await supabase.from('amicia_data').select('user_id, payload').in('user_id', alvos);
  const agora = Date.now();
  const linhas = (data || []).map(r => {
    const up = r.payload?._updated || r.payload?._ts || null;
    return {
      user_id: r.user_id,
      _updated: up ? new Date(up).toISOString() : null,
      ha_segundos: up ? Math.round((agora - up) / 1000) : null,
    };
  });
  return res.status(200).json({ agora: new Date(agora).toISOString(), linhas });
}
