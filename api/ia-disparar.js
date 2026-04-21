/**
 * ia-disparar.js — Admin dispara o cron manualmente (Sprint 3).
 *
 * POST /api/ia-disparar
 *   Header: X-User: <usuario admin>
 *   Body:   (vazio)
 *
 * Valida admin e chama internamente /api/ia-cron com header X-Cron-Secret,
 * devolvendo o payload real do cron (não mais 202 placeholder).
 */
import { validarAdmin, setCors } from './_ia-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const admin = await validarAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET não configurado no ambiente' });
  }

  // Monta URL interna. Prioridade:
  //   1. Protocol+host do próprio request (mesma instância Vercel/local)
  //   2. VERCEL_URL (fallback)
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || process.env.VERCEL_URL;
  if (!host) {
    return res.status(500).json({ error: 'Não foi possível determinar host pra chamada interna' });
  }

  // Aceita escopo no body (producao|marketplaces). Default 'producao' preserva Sprint 3.
  const escopo = (req.body?.escopo || 'producao').toLowerCase();
  if (!['producao', 'marketplaces'].includes(escopo)) {
    return res.status(400).json({ error: `Escopo inválido: ${escopo}` });
  }

  const url = `${proto}://${host}/api/ia-cron?janela=manual&escopo=${escopo}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Secret': cronSecret,
      },
      body: JSON.stringify({ escopo }),
      // Marketplaces pode ter runs mais pesados (input ~5k tokens + retry).
      // Timeout generoso: Claude 40s x 2 tentativas = 80s + overhead = 100s.
      signal: AbortSignal.timeout(100000),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return res.status(r.status).json({
        error: data.error || `ia-cron retornou ${r.status}`,
        disparado_por: admin.user.usuario,
        escopo,
        ...data,
      });
    }

    return res.json({
      ok: true,
      disparado_por: admin.user.usuario,
      escopo,
      ...data,
    });
  } catch (e) {
    const msg = e.name === 'TimeoutError' || e.name === 'AbortError'
      ? 'Timeout esperando ia-cron (> 100s)'
      : (e.message || 'erro interno');
    return res.status(500).json({ error: msg });
  }
}
