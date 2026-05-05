// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-produtos-raiox-refresh
// ═══════════════════════════════════════════════════════════════════════════
// Refresh diario da materialized view mv_lojas_matches_90d.
//
// Auth:
//   - Cron Vercel (header user-agent contem 'vercel-cron')
//   - Admin manual via ?user=ailson|amicia-admin
//
// Roda em ~5-30s dependendo do volume.
//
// Sprint Ailson 05/05/2026.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase, setCors } from './_lojas-helpers.js';

export const config = {
  maxDuration: 60,
};

const ADMINS_AUTORIZADOS = ['ailson', 'amicia-admin', 'admin', 'tamara'];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth: ou eh cron, ou eh admin via query
  const userAgent = req.headers['user-agent'] || '';
  const userQuery = req.query.user || '';
  const ehCron = userAgent.startsWith('vercel-cron');
  const ehAdmin = ADMINS_AUTORIZADOS.includes(userQuery);

  if (!ehCron && !ehAdmin) {
    return res.status(403).json({ error: 'Auth: cron ou admin' });
  }

  const startedAt = Date.now();
  console.log('[raiox-refresh] iniciando refresh, origem:', ehCron ? 'cron' : `manual:${userQuery}`);

  try {
    // REFRESH CONCURRENTLY = nao bloqueia leituras (precisa unique index, ja temos)
    // Supabase: precisa usar rpc(custom_function) OU executar via SQL direto.
    // Como nao tem SQL execution em supabase-js, vamos usar a abordagem de
    // criar uma function SQL e chamar via .rpc()
    const { error } = await supabase.rpc('refresh_matches_raiox');

    if (error) {
      console.error('[raiox-refresh] erro:', error);
      return res.status(500).json({
        error: error.message,
        hint: 'Pode precisar criar a function refresh_matches_raiox no Supabase',
      });
    }

    const duracaoMs = Date.now() - startedAt;
    console.log('[raiox-refresh] sucesso em', duracaoMs, 'ms');

    return res.json({
      ok: true,
      duracao_ms: duracaoMs,
      origem: ehCron ? 'cron' : `manual:${userQuery}`,
    });
  } catch (e) {
    console.error('[raiox-refresh] exception:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
