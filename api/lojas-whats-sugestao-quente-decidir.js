// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-sugestao-quente-decidir
// ═══════════════════════════════════════════════════════════════════════════
// Tamara aceita ou recusa a sugestao da Sofia de promover conversa pra quente
// (e disparar handoff pra vendedora).
//
// POST { conversa_id, decisao: 'aceitar'|'recusar', decidida_por? }
//
// ACEITAR:
//   1. Conversa vira etapa='quente', seta quente_desde
//   2. Limpa campos sugestao_quente_*
//   3. Chama /api/lojas-whats-encaminhar internamente (cria handoff rodizio)
//   4. Loga decisao em lojas_whats_sugestoes_decisoes (treino futuro)
//
// RECUSAR:
//   1. Limpa campos sugestao_quente_*
//   2. Loga decisao em lojas_whats_sugestoes_decisoes
//   3. Conversa continua em 'conversando' — Sofia segue engajando
//
// Ailson 27/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { conversa_id, decisao, decidida_por } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id_obrigatorio' });
    if (!['aceitar', 'recusar'].includes(decisao)) {
      return res.status(400).json({ error: "decisao deve ser 'aceitar' ou 'recusar'" });
    }

    // 1. Busca conversa com snapshot da sugestao pendente (pra logar)
    const { data: conv, error: errBusca } = await supabase
      .from('lojas_whats_conversas')
      .select('id, etapa, sugestao_quente_pendente_em, sugestao_quente_motivo, sugestao_quente_gatilhos')
      .eq('id', conversa_id)
      .maybeSingle();
    if (errBusca) throw errBusca;
    if (!conv) return res.status(404).json({ error: 'conversa_nao_encontrada' });
    if (!conv.sugestao_quente_pendente_em) {
      return res.status(409).json({ error: 'sem_sugestao_pendente', etapa_atual: conv.etapa });
    }

    const agora = new Date().toISOString();
    const decisaoNomeBd = decisao === 'aceitar' ? 'aceita' : 'recusada';

    // 2. Log na tabela de decisoes (input pra treinar Sofia depois)
    await supabase.from('lojas_whats_sugestoes_decisoes').insert({
      conversa_id,
      tipo_sugestao: 'promover_quente',
      sugerida_em: conv.sugestao_quente_pendente_em,
      decidida_em: agora,
      decisao: decisaoNomeBd,
      decidida_por: decidida_por || null,
      motivo: conv.sugestao_quente_motivo || null,
      gatilhos: conv.sugestao_quente_gatilhos || null,
    });

    // 3. Limpa campos da sugestao (re-pode ser sugerida no futuro)
    const updatesLimpa = {
      sugestao_quente_pendente_em: null,
      sugestao_quente_motivo: null,
      sugestao_quente_gatilhos: null,
      atualizado_em: agora,
    };

    if (decisao === 'aceitar') {
      // Promove etapa + dispara handoff via endpoint existente
      updatesLimpa.etapa = 'quente';
      updatesLimpa.quente_desde = agora;

      const { error: errUp } = await supabase
        .from('lojas_whats_conversas')
        .update(updatesLimpa)
        .eq('id', conversa_id);
      if (errUp) throw errUp;

      // Chama encaminhar pra criar handoff rodizio (pega primeira vendedora elegivel)
      try {
        const host = req.headers?.host || process.env.VERCEL_URL;
        const proto = host?.includes('localhost') ? 'http' : 'https';
        const r = await fetch(`${proto}://${host}/api/lojas-whats-encaminhar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversa_id, modo: 'rodizio', motivo: 'sugestao_aceita_tamara' }),
        });
        const handoffData = await r.json();
        log('sugestao-decidir', `conversa=${conversa_id} ACEITA → etapa=quente + handoff=${handoffData?.handoff_id || 'erro'}`);
        return res.status(200).json({
          ok: true, decisao: 'aceita',
          etapa_nova: 'quente',
          handoff: handoffData,
        });
      } catch (e) {
        // Etapa ja virou quente — handoff sera retentado pelo cron-rotacionar
        logErro('sugestao-decidir/encaminhar', e);
        return res.status(200).json({
          ok: true, decisao: 'aceita',
          etapa_nova: 'quente',
          warning: 'etapa atualizada mas falha ao criar handoff: ' + e.message,
        });
      }
    }

    // RECUSAR: limpa sugestao, conversa continua em 'conversando'
    const { error: errUp } = await supabase
      .from('lojas_whats_conversas')
      .update(updatesLimpa)
      .eq('id', conversa_id);
    if (errUp) throw errUp;
    log('sugestao-decidir', `conversa=${conversa_id} RECUSADA → continua em ${conv.etapa}`);
    return res.status(200).json({
      ok: true, decisao: 'recusada',
      etapa_mantida: conv.etapa,
    });
  } catch (e) {
    logErro('sugestao-decidir', e);
    return res.status(500).json({ error: e.message });
  }
}
