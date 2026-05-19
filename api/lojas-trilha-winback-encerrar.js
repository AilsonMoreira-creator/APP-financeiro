/**
 * lojas-trilha-winback-encerrar.js
 *
 * Endpoint admin pra encerrar manualmente uma trilha de winback.
 * Motivos comuns: cliente_bloqueou, nao_respondeu, comprou_outra_vendedora,
 * vendedora_desistiu, outro.
 *
 * POST { trilha_id, motivo }
 *
 * Ailson 20/05/2026 — A da auditoria. Funcao SQL ja existia mas nao tinha
 * endpoint nem UI.
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Admin only' });

  const { trilha_id, motivo } = req.body || {};
  if (!trilha_id) return res.status(400).json({ error: 'trilha_id obrigatorio' });
  const motivoValido = String(motivo || 'manual').slice(0, 80);

  try {
    const { error } = await supabase.rpc('lojas_trilha_winback_encerrar', {
      p_trilha_id: trilha_id,
      p_motivo: motivoValido,
    });
    if (error) throw error;
    return res.status(200).json({ ok: true, trilha_id, motivo: motivoValido });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
