/**
 * lojas-curadoria-reativar.js
 *
 * Remove a exclusao — REF volta a aparecer como sugestao automatica.
 *
 * Sprint Ailson 04/05/2026.
 *
 * POST /api/lojas-curadoria-reativar
 * Body: { ref, tipo }
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

  const { ref, tipo } = req.body || {};
  if (!ref || !tipo) {
    return res.status(400).json({ error: 'ref e tipo sao obrigatorios' });
  }

  try {
    const { error } = await supabase
      .from('lojas_curadoria_exclusoes')
      .delete()
      .eq('ref', String(ref).trim())
      .eq('tipo', tipo);

    if (error) {
      console.error('[lojas-curadoria-reativar]', error);
      return res.status(500).json({ error: error.message });
    }
    return res.json({ ok: true, ref, tipo });
  } catch (e) {
    console.error('[lojas-curadoria-reativar] erro:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
