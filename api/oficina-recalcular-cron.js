// api/oficina-recalcular-cron.js — Recalcula a snapshot oficina_ranking
//
// Por que existe: o snapshot por-corte (fn_oficina_aplicar_snapshot_corte)
// roda quando o usuario marca um corte como entregue, mas nao recalcula
// agregados como ultima_entrega/dias_medio confiavelmente — depende de o
// front detectar a transicao e disparar a RPC. Em pratica, isso esquece
// (Ailson 28/05/2026: dashboard ficou parado em 17/05 por 11 dias porque
// ninguem chamou o recalculo).
//
// Solucao: cron diario as 6h BRT (=9h UTC) chama fn_oficina_recalcular_metricas
// que recomputa tudo a partir do payload ailson_cortes em amicia_data.
//
// Agendado em vercel.json: "0 9 * * *"

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  try {
    const t0 = Date.now();
    const { data, error } = await supabase.rpc('fn_oficina_recalcular_metricas');
    if (error) {
      console.error('[oficina-recalcular-cron] erro:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
    const dur = Date.now() - t0;
    console.log('[oficina-recalcular-cron] ok em', dur, 'ms', data || '');
    return res.json({ ok: true, duracao_ms: dur, result: data });
  } catch (e) {
    console.error('[oficina-recalcular-cron] exception:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
