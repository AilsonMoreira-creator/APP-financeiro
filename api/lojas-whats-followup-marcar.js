// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-followup-marcar.js — Marca conversa pra Follow-up manualmente
// ═══════════════════════════════════════════════════════════════════════════
//
// Endpoint chamado quando assistente/vendedora escolhe a tag de follow-up
// no card da conversa.
//
// POST body: {
//   conversa_id: uuid,
//   tag: '1d' | '3d' | '7d',
//   motivo?: string,   // opcional, ex: "cliente disse vai pensar"
//   usuario?: string,  // pra audit
// }
//
// Acoes:
//   1. Update conversa: etapa='follow_up', follow_up_tag, follow_up_vence_em,
//      follow_up_origem='vendedora_manual', follow_up_motivo,
//      follow_up_entrou_em=NOW(). NAO incrementa tentativas (admin pode
//      marcar e desmarcar varias vezes).
//   2. Loga evento de aprendizado pra Sofia aprender padroes.
//
// Ailson 25/05/2026 (Sprint B Sofia Follow-up)
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro } from './_lojas-whats-helpers.js';

const DIAS_POR_TAG = { '1d': 1, '3d': 3, '7d': 7 };

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { conversa_id, tag, motivo, usuario } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id_obrigatorio' });
    if (!DIAS_POR_TAG[tag]) return res.status(400).json({ error: 'tag_invalida', validas: Object.keys(DIAS_POR_TAG) });

    // Verifica conversa existe
    const { data: conv } = await supabase
      .from('lojas_whats_conversas')
      .select('id, etapa, follow_up_tentativas')
      .eq('id', conversa_id).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'conversa_nao_encontrada' });
    if (['vendeu', 'perdida'].includes(conv.etapa)) {
      return res.status(400).json({ error: 'conversa_fechada', etapa: conv.etapa });
    }

    const venceEm = new Date(Date.now() + DIAS_POR_TAG[tag] * 86400000).toISOString();
    const agora = new Date().toISOString();

    const { error: errUp } = await supabase
      .from('lojas_whats_conversas')
      .update({
        etapa: 'follow_up',
        follow_up_tag: tag,
        follow_up_vence_em: venceEm,
        follow_up_entrou_em: agora,
        follow_up_origem: 'vendedora_manual',
        follow_up_motivo: motivo || `${usuario || 'vendedora'} marcou ${tag} manualmente`,
        ultima_atividade_em: agora,
        atualizado_em: agora,
      })
      .eq('id', conversa_id);
    if (errUp) {
      logErro('followup-marcar', errUp);
      return res.status(500).json({ error: 'update_falhou', detalhe: errUp.message });
    }

    log('followup-marcar', `conv=${conversa_id} tag=${tag} por=${usuario || '?'}`);
    return res.status(200).json({
      ok: true,
      conversa_id,
      tag,
      vence_em: venceEm,
      etapa: 'follow_up',
    });
  } catch (e) {
    logErro('followup-marcar/excecao', e);
    return res.status(500).json({ error: e.message });
  }
}
