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
    const { vendedora_id, subscription } = req.body || {};

    if (!vendedora_id) {
      return res.status(400).json({ error: 'vendedora_id obrigatorio' });
    }
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'subscription invalida' });
    }

    // Atualiza vendedora — substitui qualquer subscription anterior.
    // (Se vendedora trocou de celular, a antiga vira lixo no servidor de push
    // — primeira tentativa de envio retorna 410 e a gente limpa.)
    const { error } = await supabase
      .from('lojas_vendedoras')
      .update({
        push_subscription: subscription,
        push_ativado_em: new Date().toISOString(),
      })
      .eq('id', vendedora_id);

    if (error) {
      console.error('[push-register] erro Supabase:', error);
      return res.status(500).json({ error: 'erro salvar', detalhe: error.message });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[push-register] erro:', e);
    return res.status(500).json({ error: e.message });
  }
}

async function desativar(req, res) {
  try {
    const { vendedora_id } = req.body || {};
    if (!vendedora_id) {
      return res.status(400).json({ error: 'vendedora_id obrigatorio' });
    }

    const { error } = await supabase
      .from('lojas_vendedoras')
      .update({ push_subscription: null })
      .eq('id', vendedora_id);

    if (error) {
      return res.status(500).json({ error: 'erro limpar', detalhe: error.message });
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
