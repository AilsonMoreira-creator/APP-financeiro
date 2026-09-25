// api/lojas-perf.js — grava o tempo de abertura do modulo Lojas (24/09/2026).
// POST { usuario, vendedora_id, admin, total_ms, tela_ms, de_cache, clientes, etapas }
// So medicao: nunca derruba nada, sempre responde 200.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
  { auth: { persistSession: false } },
);
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(600000, Math.round(Number(v)))) : null);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  try {
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const etapas = {};
    for (const [k, v] of Object.entries(b.etapas || {}).slice(0, 20)) etapas[String(k).slice(0, 30)] = num(v);
    await supabase.from('lojas_perf_abertura').insert({
      usuario: String(b.usuario || '').slice(0, 40) || null,
      vendedora_id: String(b.vendedora_id || '').slice(0, 60) || null,
      admin: !!b.admin, total_ms: num(b.total_ms), tela_ms: num(b.tela_ms), de_cache: !!b.de_cache,
      clientes: num(b.clientes), etapas,
      aparelho: String(req.headers['user-agent'] || '').slice(0, 160),
      ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null,
    });
  } catch (e) { console.error('[lojas-perf]', e?.message || e); }
  return res.status(200).json({ ok: true });
}
