// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-leads-vendedora.js — Lista leads Sofia ativos pra vendedora
// ═══════════════════════════════════════════════════════════════════════════
//
// Chamado pela UI da vendedora (Lojas_Telas_Vendedora -> CardDiaScreen)
// pra renderizar o card "Lead da Sofia" ACIMA das 7 sugestoes diarias.
//
// Retorna handoffs com status='aguardando' pra vendedora.
//
// Query: ?vendedora_id=xxx
//
// Resposta: { leads: [{ handoff_id, conversa_id, cliente_nome, telefone,
//                       resumo_ia, gatilhos, expira_em, segundos_restantes }] }
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const vendedoraId = req.query?.vendedora_id || req.body?.vendedora_id;
    if (!vendedoraId) return res.status(400).json({ error: 'vendedora_id obrigatorio' });

    const { data: handoffs, error } = await supabase
      .from('lojas_whats_handoffs')
      .select('id, conversa_id, motivo, gatilhos_detectados, resumo_ia, resumo_conversa, pecas_info, modelos_interesse, mensagem_sugerida, push_enviado_em, expirou_em, criado_em')
      .eq('vendedora_id', vendedoraId)
      .eq('status', 'aguardando')
      // Garante precisao dos 30min independente do cron de rotacao (que roda a cada 5min).
      // Se vendedora abre o app 31min apos notificacao, NAO ve o card — mesmo
      // que o cron ainda nao tenha marcado como 'expirado'.
      .gt('expirou_em', new Date().toISOString())
      .order('criado_em', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });

    // Hidrata com info da conversa
    const conversaIds = (handoffs || []).map(h => h.conversa_id).filter(Boolean);
    let conversasMap = new Map();
    if (conversaIds.length) {
      const { data: cv } = await supabase
        .from('lojas_whats_conversas')
        .select('id, telefone, nome_cliente, tipo_documento, etapa, score_quente')
        .in('id', conversaIds);
      conversasMap = new Map((cv || []).map(c => [c.id, c]));
    }

    const agora = Date.now();
    const leads = (handoffs || []).map(h => {
      const cv = conversasMap.get(h.conversa_id) || {};
      const expira = h.expirou_em ? new Date(h.expirou_em).getTime() : null;
      const segundosRestantes = expira ? Math.max(0, Math.floor((expira - agora) / 1000)) : null;
      return {
        handoff_id: h.id,
        conversa_id: h.conversa_id,
        telefone: cv.telefone,
        nome_cliente: cv.nome_cliente,
        tipo_documento: cv.tipo_documento,
        etapa: cv.etapa,
        score_quente: cv.score_quente,
        motivo: h.motivo,
        gatilhos: h.gatilhos_detectados,
        resumo_ia: h.resumo_ia,
        // Novos campos pre-gerados via Claude Haiku (Ailson 26/05/2026)
        resumo_conversa: h.resumo_conversa,
        pecas_info: h.pecas_info,
        modelos_interesse: h.modelos_interesse || [],
        mensagem_sugerida: h.mensagem_sugerida,
        expira_em: h.expirou_em,
        segundos_restantes: segundosRestantes,
      };
    });

    return res.json({ leads, total: leads.length });
  } catch (e) {
    console.error('[leads-vendedora] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
