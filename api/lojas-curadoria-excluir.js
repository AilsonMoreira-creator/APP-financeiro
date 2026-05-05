/**
 * lojas-curadoria-excluir.js
 *
 * Veta uma REF da curadoria automatica. Some das telas e da IA ate
 * o admin reativar manualmente.
 *
 * Sprint Ailson 04/05/2026.
 *
 * POST /api/lojas-curadoria-excluir
 * Body: { ref, tipo, motivo? }
 *
 * Auth: so admin.
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });

  const { ref, tipo, motivo } = req.body || {};
  if (!ref || !tipo) {
    return res.status(400).json({ error: 'ref e tipo sao obrigatorios' });
  }
  if (!['best_seller', 'em_alta', 'novidade_manual'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo invalido' });
  }

  try {
    const { error } = await supabase
      .from('lojas_curadoria_exclusoes')
      .upsert({
        ref: String(ref).trim(),
        tipo,
        motivo: motivo || null,
        excluida_por: auth.userId,
        excluida_em: new Date().toISOString(),
      }, { onConflict: 'ref,tipo' });

    if (error) {
      console.error('[lojas-curadoria-excluir]', error);
      return res.status(500).json({ error: error.message });
    }
    return res.json({ ok: true, ref, tipo });
  } catch (e) {
    console.error('[lojas-curadoria-excluir] erro:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
