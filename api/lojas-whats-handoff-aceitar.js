// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-handoff-aceitar.js — Vendedora aceita o lead Sofia
// ═══════════════════════════════════════════════════════════════════════════
//
// Chamado quando vendedora clica no card "Lead da Sofia" acima das 7 sugestões.
// Aceita o handoff EM ABERTO mais recente pra essa vendedora.
//
// Efeitos:
//   - handoff.status = 'aceita', vendedora_abriu_em=NOW
//   - conversa.etapa = 'atendida', vendedora_atribuida_id=vendedora_id
//   - cancela rotação (cron-rotacionar para de buscar)
//
// Body: { vendedora_id, handoff_id? (opcional — se omitido, pega último ativo) }
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST esperado' });

  try {
    const { vendedora_id, handoff_id } = req.body || {};
    if (!vendedora_id) return res.status(400).json({ error: 'vendedora_id obrigatorio' });

    // Acha o handoff
    let qb = supabase
      .from('lojas_whats_handoffs')
      .select('id, conversa_id, status, vendedora_id, expirou_em')
      .eq('vendedora_id', vendedora_id)
      .eq('status', 'aguardando')
      .gt('expirou_em', new Date().toISOString())  // expirou_em precisa estar no FUTURO
      .order('criado_em', { ascending: false })
      .limit(1);
    if (handoff_id) qb = qb.eq('id', handoff_id);

    const { data: handoffs, error: errH } = await qb;
    if (errH) return res.status(500).json({ error: errH.message });
    if (!handoffs || handoffs.length === 0) {
      return res.status(404).json({ 
        error: 'Lead nao disponivel — janela de 30min ja passou ou outra vendedora ja atendeu.',
      });
    }
    const handoff = handoffs[0];

    // Marca handoff aceito
    const agora = new Date();
    const { error: errUpd } = await supabase
      .from('lojas_whats_handoffs')
      .update({
        status: 'aceita',
        vendedora_abriu_em: agora.toISOString(),
        atualizado_em: agora.toISOString(),
      })
      .eq('id', handoff.id);
    if (errUpd) return res.status(500).json({ error: errUpd.message });

    // Atualiza conversa -> etapa 'atendida' + vendedora atribuida
    const { error: errCv } = await supabase
      .from('lojas_whats_conversas')
      .update({
        etapa: 'atendida',
        vendedora_atribuida_id: vendedora_id,
        atualizado_em: agora.toISOString(),
      })
      .eq('id', handoff.conversa_id);
    if (errCv) return res.status(500).json({ error: errCv.message });

    // Incrementa contador vendedora (best effort)
    try {
      const { data: vw } = await supabase
        .from('lojas_whats_vendedoras')
        .select('total_leads_recebidos')
        .eq('vendedora_id', vendedora_id).maybeSingle();
      await supabase
        .from('lojas_whats_vendedoras')
        .update({
          total_leads_recebidos: (vw?.total_leads_recebidos || 0) + 1,
          atualizado_em: agora.toISOString(),
        })
        .eq('vendedora_id', vendedora_id);
    } catch {}

    return res.json({
      ok: true,
      handoff_id: handoff.id,
      conversa_id: handoff.conversa_id,
      etapa_nova: 'atendida',
    });
  } catch (e) {
    console.error('[handoff-aceitar] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
