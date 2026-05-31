// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-clientes-massa — ENFILEIRA disparo em massa (módulo Clientes)
// ═══════════════════════════════════════════════════════════════════════════
// POST { cliente_ids: [...], etapa: 'feedback'|'inativo' }
//
// Template escolhido pela etapa: feedback → Feedback_v1 | inativo → Inativos_v1
//
// Insere os clientes na fila (clientes_sofia_fila) e processa um primeiro lote
// inline (resposta rápida). O resto é drenado pelo cron lojas-whats-clientes-fila-cron.
// O envio mantém a etapa da conversa (feedback/inativo).
//
// Retorna { lote_id, total, enviados, erros, restantes }.
// ═══════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'crypto';
import { supabase } from './_lojas-whats-helpers.js';
import { processarFila } from './_lojas-whats-clientes-fila.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const TEMPLATE_POR_ETAPA = { feedback: 'Feedback_v1', inativo: 'Inativos_v1' };
const LIMITE = 1000;
const PRIMEIRO_LOTE = 25; // processa inline pra dar feedback imediato

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { cliente_ids, etapa } = req.body || {};
    if (!Array.isArray(cliente_ids) || cliente_ids.length === 0) {
      return res.status(400).json({ error: 'cliente_ids_obrigatorio' });
    }
    if (cliente_ids.length > LIMITE) return res.status(400).json({ error: `limite_${LIMITE}_excedido` });

    const etapaFinal = (etapa === 'inativo') ? 'inativo' : 'feedback';
    const templateName = TEMPLATE_POR_ETAPA[etapaFinal];

    // template precisa existir + ativo (Ailson cria Feedback_v1 / Inativos_v1)
    const { data: tpl } = await supabase
      .from('lojas_whats_templates')
      .select('name')
      .eq('name', templateName)
      .eq('ativo', true)
      .maybeSingle();
    if (!tpl) return res.status(400).json({ error: `template_${templateName}_inexistente_ou_inativo` });

    // enfileira
    const lote_id = randomUUID();
    const linhas = cliente_ids.map(cid => ({
      lote_id, cliente_id: cid, etapa: etapaFinal, template_name: templateName, status: 'pendente',
    }));
    // insere em blocos (evita payload gigante)
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await supabase.from('clientes_sofia_fila').insert(linhas.slice(i, i + 500));
      if (error) throw error;
    }

    // processa um primeiro lote inline (resto vai no cron)
    const r = await processarFila(PRIMEIRO_LOTE);

    return res.status(200).json({
      ok: true, lote_id, total: cliente_ids.length,
      enviados: r.enviados, erros: r.erros, restantes: r.restantes,
    });
  } catch (e) {
    console.error('[lojas-whats-clientes-massa]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
