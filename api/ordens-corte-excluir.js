// api/ordens-corte-excluir.js — Soft delete (cancelar) ordem
// DELETE /api/ordens-corte-excluir
//
// Body: {
//   id: uuid,                  // OBRIGATÓRIO
//   motivo_exclusao: string,   // OBRIGATÓRIO
//   usuario: string            // (ou via header X-User)
// }
//
// Bloqueia exclusão se status já é na_sala, concluido ou cancelado.
// Não apaga o registro: marca status='cancelado' + grava motivo.
//
// Retorna 200 { ordem: {...} } ou 400/404

import {
  supabase, setCors, getUserFromReq, parseBody, insertHistorico
} from './_ordens-corte-helpers.js';

const STATUS_BLOQUEADOS = ['cancelado']; // concluido e na_sala agora podem ser excluidos

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return res.status(405).json({ error: 'DELETE ou POST' });
  }

  try {
    const body = parseBody(req);
    const usuario = getUserFromReq(req) || body.usuario;

    if (!usuario) return res.status(400).json({ error: 'usuario (ou header X-User) obrigatório' });
    if (!body.id) return res.status(400).json({ error: 'id obrigatório' });
    if (!body.motivo_exclusao?.trim()) {
      return res.status(400).json({
        error: 'motivo_exclusao obrigatório',
        codigo: 'MOTIVO_OBRIGATORIO'
      });
    }

    // ── Lê ordem atual ──
    const { data: atual, error: errLoad } = await supabase
      .from('ordens_corte')
      .select('*')
      .eq('id', body.id)
      .maybeSingle();
    if (errLoad) return res.status(500).json({ error: errLoad.message });
    if (!atual) return res.status(404).json({ error: 'ordem não encontrada' });

    if (STATUS_BLOQUEADOS.includes(atual.status)) {
      return res.status(400).json({
        error: `Ordem já está cancelada.`,
        codigo: 'STATUS_BLOQUEADO',
      });
    }

    // ── Soft delete ──
    const { data: updated, error: errUpd } = await supabase
      .from('ordens_corte')
      .update({
        status: 'cancelado',
        motivo_exclusao: body.motivo_exclusao.trim(),
      })
      .eq('id', body.id)
      .select()
      .single();

    if (errUpd) {
      console.error('excluir erro:', errUpd);
      return res.status(500).json({ error: errUpd.message });
    }

    await insertHistorico({
      ordem_id: updated.id,
      acao: 'excluida',
      payload_antes: atual,
      payload_depois: updated,
      motivo: body.motivo_exclusao.trim(),
      user_id: usuario,
    });

    return res.status(200).json({ ordem: updated });
  } catch (e) {
    console.error('excluir catch:', e);
    return res.status(500).json({ error: e?.message || 'erro interno' });
  }
}
