// api/fase3-check.js — Fase 3 (25/09/2026): confere se a chave SUPABASE_JWT_SECRET
// esta no Vercel e se o Supabase ACEITA um token assinado com ela. Nunca mostra a chave.
// GET → { chave_presente, supabase_aceita, status_rest, papel_visto }
import crypto from 'crypto';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export default async function handler(req, res) {
  const segredo = process.env.SUPABASE_JWT_SECRET || '';
  const out = { chave_presente: !!segredo, supabase_aceita: false, status_rest: null, papel_visto: null };
  if (!segredo) return res.status(200).json(out);
  try {
    const agora = Math.floor(Date.now() / 1000);
    const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const p = b64u(JSON.stringify({ role: 'authenticated', sub: 'fase3-check', aud: 'authenticated', iat: agora, exp: agora + 60 }));
    const sig = b64u(crypto.createHmac('sha256', segredo).update(`${h}.${p}`).digest());
    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const apikey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
    // lojas_avisos: tabela que o navegador ja le hoje (so conta 1 linha, sem trazer dado)
    const r = await fetch(`${url}/rest/v1/lojas_avisos?select=id&limit=1`, {
      headers: { apikey, Authorization: `Bearer ${h}.${p}.${sig}` },
    });
    out.status_rest = r.status;
    out.supabase_aceita = r.ok;
    if (!r.ok) out.papel_visto = (await r.text()).slice(0, 160);
  } catch (e) { out.erro = String(e?.message || e).slice(0, 160); }
  return res.status(200).json(out);
}
