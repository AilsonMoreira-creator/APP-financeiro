// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-push-register
// ═══════════════════════════════════════════════════════════════════════════
// POST: vendedora ativou push no celular dela. Salva subscription.
// DELETE: vendedora desativou. Limpa subscription.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'POST') {
    return await registrar(req, res);
  }
  if (req.method === 'DELETE') {
    return await desativar(req, res);
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function registrar(req, res) {
  try {
    const { vendedora_id, subscription, user_id } = req.body || {};

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'subscription invalida' });
    }

    // Resolve vendedora_id final.
    // Caso especial Tamara: ela e admin, ativa entrando na carteira de
    // qualquer vendedora. Backend redireciona pra placeholder Tamara_admin.
    let targetId = vendedora_id;

    const userIdLower = String(user_id || '').toLowerCase().trim();
    const ehTamara = userIdLower === 'tamara';

    if (ehTamara) {
      // Busca placeholder Tamara_admin
      const { data: tamaraRow } = await supabase
        .from('lojas_vendedoras')
        .select('id')
        .eq('nome', 'Tamara_admin')
        .eq('is_placeholder', true)
        .maybeSingle();
      if (tamaraRow?.id) {
        targetId = tamaraRow.id;
      } else {
        return res.status(404).json({
          error: 'Placeholder Tamara_admin nao encontrado. Rode o SQL primeiro.',
        });
      }
    }

    if (!targetId) {
      return res.status(400).json({ error: 'vendedora_id obrigatorio (ou user_id=tamara)' });
    }

    const { error } = await supabase
      .from('lojas_vendedoras')
      .update({
        push_subscription: subscription,
        push_ativado_em: new Date().toISOString(),
      })
      .eq('id', targetId);

    if (error) {
      console.error('[push-register] erro Supabase:', error);
      return res.status(500).json({ error: 'erro salvar', detalhe: error.message });
    }

    return res.json({ ok: true, registrado_para: targetId, redirecionado_admin: ehTamara });
  } catch (e) {
    console.error('[push-register] erro:', e);
    return res.status(500).json({ error: e.message });
  }
}

async function desativar(req, res) {
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
      return res.status(400).json({ error: 'vendedora_id obrigatorio' });
    }

    const { error } = await supabase
      .from('lojas_vendedoras')
      .update({ push_subscription: null })
      .eq('id', targetId);

    if (error) {
      return res.status(500).json({ error: 'erro limpar', detalhe: error.message });
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
