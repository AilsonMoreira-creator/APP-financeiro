/**
 * lojas-leads-pegar-lock.js — Trava de 30 min ao clicar no card
 *
 * POST { lead_id }
 *
 * Vendedora tenta pegar o lock pra "atender" o lead. Se outra vendedora
 * já tá atendendo (lock_expira_em > NOW), retorna { ok: false } com info
 * dela. Se livre / expirado / próprio → pega lock e retorna ok=true.
 *
 * Lock dura 30 min e expira sozinho (passivo — sem cron). Ao enviar
 * WhatsApp pelo lojas-leads-mensagem (action=marcar_enviada) o lock é
 * liberado explicitamente.
 *
 * Ailson 13/05/2026.
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.vendedoraId) {
    return res.status(403).json({ error: 'Apenas vendedoras podem pegar lock (admin não atende)' });
  }

  const { lead_id } = req.body || {};
  if (!lead_id) return res.status(400).json({ error: 'lead_id obrigatório' });

  try {
    const { data, error } = await supabase
      .rpc('lojas_leads_pegar_lock', {
        p_lead_id: lead_id,
        p_vendedora_id: auth.vendedoraId,
      })
      .maybeSingle();

    if (error) {
      console.error('[lojas-leads-pegar-lock] erro:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      ok: !!data?.ok,
      motivo: data?.motivo || null,
      vendedora_atendendo_id: data?.vendedora_atendendo_id || null,
      vendedora_atendendo_nome: data?.vendedora_atendendo_nome || null,
      lock_expira_em: data?.lock_expira_em || null,
    });
  } catch (e) {
    console.error('[lojas-leads-pegar-lock] exception:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}
