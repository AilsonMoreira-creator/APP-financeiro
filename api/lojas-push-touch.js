// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-push-touch
// ═══════════════════════════════════════════════════════════════════════════
// POST: cliente confirma que ficou >=1min com app aberto hoje.
// Atualiza ultimo_acesso_em da vendedora.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { vendedora_id, user_id } = req.body || {};

    let targetId = vendedora_id;
    const userIdLower = String(user_id || '').toLowerCase().trim();

    if (userIdLower === 'tamara') {
      const { data: tamaraRow } = await supabase
        .from('lojas_vendedoras')
        .select('id')
        .eq('nome', 'Tamara_admin')
        .eq('is_placeholder', true)
        .maybeSingle();
      if (tamaraRow?.id) targetId = tamaraRow.id;
    }

    if (!targetId) {
      return res.status(400).json({ error: 'vendedora_id obrigatorio (ou user_id=tamara)' });
    }

    const { error } = await supabase
      .from('lojas_vendedoras')
      .update({ ultimo_acesso_em: new Date().toISOString() })
      .eq('id', targetId);

    if (error) {
      console.error('[push-touch] erro Supabase:', error);
      return res.status(500).json({ error: 'erro salvar', detalhe: error.message });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[push-touch] erro:', e);
    return res.status(500).json({ error: e.message });
  }
}
