// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-estilo-vendedora
// ═══════════════════════════════════════════════════════════════════════════
// GET ?vendedora_id=X — retorna emojis mais usados pela vendedora
// (counter jsonb da tabela lojas_estilo_vendedora.emojis).
//
// Usado pelo picker de emoji no modal de edição de mensagem
// (Ailson 11/05/2026): vendedora cuja teclado nao mostra emoji ainda
// consegue inserir os mais usados via botoes no proprio app. Conforme
// edita, o counter incrementa no backend e a lista personaliza.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  // CORS minimal
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { vendedora_id } = req.query || {};
    if (!vendedora_id) {
      return res.status(400).json({ error: 'vendedora_id obrigatorio' });
    }

    const { data, error } = await supabase
      .from('lojas_estilo_vendedora')
      .select('emojis, qtd_edicoes')
      .eq('vendedora_id', vendedora_id)
      .maybeSingle();

    if (error) {
      console.error('[estilo-vendedora] erro:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      emojis: data?.emojis || {},      // { '😊': 3, '🔥': 1, ... }
      qtd_edicoes: data?.qtd_edicoes || 0,
    });
  } catch (e) {
    console.error('[estilo-vendedora] erro:', e);
    return res.status(500).json({ error: e.message });
  }
}
