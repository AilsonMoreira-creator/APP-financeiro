// ═══════════════════════════════════════════════════════════════════════════
// /api/sofia-push-register — registra/desativa subscription Web Push da Sofia
// ═══════════════════════════════════════════════════════════════════════════
// POST { user_id, subscription } → salva subscription pro user
// DELETE { endpoint }            → remove subscription
// Tabela: sofia_push_subscriptions
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'POST') {
      const { user_id, subscription } = req.body || {};
      if (!user_id) return res.status(400).json({ error: 'user_id_obrigatorio' });
      if (!subscription?.endpoint || !subscription?.keys) {
        return res.status(400).json({ error: 'subscription_invalida' });
      }
      const { error } = await supabase
        .from('sofia_push_subscriptions')
        .upsert(
          {
            user_id: String(user_id),
            endpoint: subscription.endpoint,
            subscription,
            ativada_em: new Date().toISOString(),
            ultimo_uso_em: new Date().toISOString(),
          },
          { onConflict: 'endpoint' }
        );
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { endpoint } = req.body || {};
      if (!endpoint) return res.status(400).json({ error: 'endpoint_obrigatorio' });
      const { error } = await supabase
        .from('sofia_push_subscriptions')
        .delete()
        .eq('endpoint', endpoint);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[sofia-push-register]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
