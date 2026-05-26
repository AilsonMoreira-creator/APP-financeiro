// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-home-kpi.js — KPI Sofia pro card da Home
// ═══════════════════════════════════════════════════════════════════════════
// Retorna contagem de conversas com mensagens novas nao respondidas nas
// ultimas 24h (ultima_msg_direcao='entrada'). Usado pelo card da home
// pra mostrar atencao necessaria sem precisar abrir o modulo Sofia.
// GET → { ok: true, naoRespondidas: N }
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from './_lojas-whats-helpers.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    // Conversas onde a ultima mensagem foi do cliente (entrada) nas ultimas 24h
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('lojas_whats_conversas')
      .select('*', { count: 'exact', head: true })
      .eq('ultima_msg_direcao', 'entrada')
      .gte('ultima_atividade_em', cutoff24h);
    if (error) throw error;
    return res.status(200).json({ ok: true, naoRespondidas: count || 0 });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
