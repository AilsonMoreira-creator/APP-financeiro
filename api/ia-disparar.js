/**
 * ia-disparar.js — Admin dispara o cron manualmente.
 *
 * POST /api/ia-disparar
 *   Body: (vazio)
 *   Admin-only.
 *
 * Na Fase 1 (Sprint 1), este endpoint é apenas um placeholder que:
 *   - Valida admin
 *   - Registra a tentativa em ia_usage (pra auditar quem disparou)
 *   - Devolve 202 (Accepted) sem fazer nada
 *
 * No Sprint 3 será estendido pra realmente invocar /api/ia-cron
 * e aguardar o retorno.
 */
import { supabase, validarAdmin, setCors } from './_ia-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const admin = await validarAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  try {
    // Placeholder Sprint 1: só registra a tentativa.
    // No Sprint 3 este endpoint vai chamar /api/ia-cron internamente.
    const hoje = new Date().toISOString().slice(0, 10);
    const anoMes = hoje.slice(0, 7);

    // Registra que admin disparou (custo 0, só auditoria)
    await supabase.from('ia_usage').insert({
      data: hoje,
      ano_mes: anoMes,
      tipo: 'cron',
      modelo: 'placeholder-sprint-1',
      input_tokens: 0,
      output_tokens: 0,
      custo_usd: 0,
      custo_brl: 0,
      user_id: admin.user.usuario,
    });

    return res.status(202).json({
      ok: true,
      msg: 'Disparo registrado. Cron real entrará no Sprint 3 (orquestração + Claude).',
      registrado_por: admin.user.usuario,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
