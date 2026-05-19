/**
 * lojas-aviso-conversoes-semanal-cron.js
 *
 * Cron SEMANAL terça-feira 08:30 BRT. Pra cada vendedora que teve
 * conversões (msg → compra) na semana ANTERIOR, cria 1 aviso celebrativo
 * que aparece no primeiro card do dia dela.
 *
 * Chama lojas_aviso_conversoes_semanal_disparar() que faz a logica toda
 * em SQL. Idempotente (anti-duplicacao por vendedora+semana).
 *
 * Ailson 20/05/2026 — combinado toda terca.
 */
import { supabase, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  const tInicio = Date.now();

  try {
    const { data, error } = await supabase
      .rpc('lojas_aviso_conversoes_semanal_disparar')
      .maybeSingle();
    if (error) throw error;

    return res.status(200).json({
      ok: true,
      duracao_ms: Date.now() - tInicio,
      avisos_criados: data?.avisos_criados || 0,
      vendedoras_atingidas: data?.vendedoras_atingidas || 0,
    });
  } catch (err) {
    console.error('[lojas-aviso-conversoes-semanal-cron]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
