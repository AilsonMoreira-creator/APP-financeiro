// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-clientes-aprovar-lote — aprova o "lote do dia" de feedback
// ═══════════════════════════════════════════════════════════════════════════
// POST (sem body): libera TODOS os clientes que o cron deixou em
// 'aguardando_aprovacao' (etapa='feedback') → vira 'pendente' e processa a fila.
// É o "1 toque aprova todos". Em modo automático o cron já manda direto e este
// endpoint não tem nada pra fazer.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase } from './_lojas-whats-helpers.js';
import { processarFila } from './_lojas-whats-clientes-fila.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    const { data: liberados, error } = await supabase
      .from('clientes_sofia_fila')
      .update({ status: 'pendente' })
      .eq('status', 'aguardando_aprovacao')
      .eq('etapa', 'feedback')
      .select('id');
    if (error) throw error;
    const aprovados = (liberados || []).length;

    let enviados = 0, erros = 0, restantes = 0;
    if (aprovados > 0) {
      const r = await processarFila(50);
      enviados = r.enviados; erros = r.erros; restantes = r.restantes;
    }
    return res.status(200).json({ ok: true, aprovados, enviados, erros, restantes });
  } catch (e) {
    console.error('[lojas-whats-clientes-aprovar-lote]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
