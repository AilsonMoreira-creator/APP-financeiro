// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-cron-varejo — move conversas Quente sem resposta -> Varejo
// ═══════════════════════════════════════════════════════════════════════════
// Roda de hora em hora. Pega conversas com oferta_varejo_em > 24h atras
// (Sofia ofereceu upgrade 1-2->3 OU +R$30 em 3-7) e cliente nao respondeu
// (porque webhook reseta oferta_varejo_em qdo cliente manda msg nova).
//
// Move pra etapa='varejo'. Vendedora atende manualmente pela aba Varejo.
// Idempotente: nao re-processa as ja movidas (oferta_varejo_em e zerado).
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  try {
    const limite = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Pega conversas com oferta ha 24h+ e cliente nao respondeu
    // (oferta_varejo_em ainda setada = cliente nunca mandou msg desde a oferta)
    const { data: candidatas, error: errSel } = await supabase
      .from('lojas_whats_conversas')
      .select('id, telefone, etapa, oferta_varejo_em, qtd_pecas')
      .not('oferta_varejo_em', 'is', null)
      .lt('oferta_varejo_em', limite)
      // Nao mexe em conversas que ja sairam pro caminho da vendedora,
      // ja venderam ou ja foram pra perdida/varejo manualmente.
      .not('etapa', 'in', '(atendida,vendeu,perdida,varejo)');

    if (errSel) throw errSel;
    if (!candidatas || candidatas.length === 0) {
      return res.status(200).json({ ok: true, movidas: 0, msg: 'sem candidatas' });
    }

    // Move pra varejo + zera marker
    const ids = candidatas.map(c => c.id);
    const { error: errUp } = await supabase
      .from('lojas_whats_conversas')
      .update({
        etapa: 'varejo',
        oferta_varejo_em: null,
        ultima_atividade_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      })
      .in('id', ids);
    if (errUp) throw errUp;

    candidatas.forEach(c => {
      log('cron-varejo', `conversa=${c.id} tel=${c.telefone} (era ${c.etapa}, qtd_pecas=${c.qtd_pecas}) → varejo`);
    });

    return res.status(200).json({
      ok: true,
      movidas: candidatas.length,
      ids,
    });
  } catch (e) {
    logErro('cron-varejo', e);
    return res.status(500).json({ error: e.message });
  }
}
