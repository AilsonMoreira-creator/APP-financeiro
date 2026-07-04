// ============================================================================
// /api/meluni-email-webhook — recebe eventos do Resend (abertura/clique/bounce)
// e carimba meluni_email_envios pelo resend_id. Sem isso, a aba "Abertura" fica
// sempre em 0 (nada nunca marca aberto_em). Ailson 04/07/2026.
//
// CONFIG NO RESEND (feito pelo Ailson, 1x):
//   1) Domínio > Tracking: ligar "Open tracking" (e "Click tracking" se quiser).
//   2) Webhooks > Add: URL = https://app-financeiro-brown.vercel.app/api/meluni-email-webhook?token=SEU_TOKEN
//      eventos: email.opened, email.clicked, email.bounced, email.complained.
//   3) Setar env EMAIL_WEBHOOK_TOKEN no Vercel com o mesmo token da URL.
// ============================================================================
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'POST only' });

  // guarda leve: se o token estiver setado no env, exige na URL
  const tokenEnv = process.env.EMAIL_WEBHOOK_TOKEN || null;
  if (tokenEnv && (req.query?.token || '') !== tokenEnv) {
    return res.status(401).json({ ok: false, erro: 'token invalido' });
  }

  try {
    const evt = req.body || {};
    const type = evt.type || evt.event || '';
    const emailId = evt?.data?.email_id || evt?.data?.id || null;
    if (!emailId) return res.json({ ok: true, ignorado: 'sem email_id' });

    const agora = new Date().toISOString();
    let patch = null;
    if (type === 'email.opened') patch = { aberto_em: agora };
    else if (type === 'email.clicked') patch = { clicado_em: agora };
    else if (type === 'email.bounced') patch = { status: 'bounced' };
    else if (type === 'email.complained') patch = { status: 'reclamado' };

    if (!patch) return res.json({ ok: true, ignorado: type });

    // só carimba a 1a vez (não sobrescreve aberto_em/clicado_em já existente)
    let q = supabase.from('meluni_email_envios').update(patch).eq('resend_id', emailId);
    if (patch.aberto_em) q = q.is('aberto_em', null);
    if (patch.clicado_em) q = q.is('clicado_em', null);
    await q;

    return res.json({ ok: true, type, emailId });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
