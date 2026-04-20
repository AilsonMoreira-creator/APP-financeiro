// api/ordens-corte-atualizar.js — Atualiza ordem de corte com optimistic locking
// PUT /api/ordens-corte-atualizar
//
// Body: {
//   id: uuid,                 // OBRIGATÓRIO
//   version: integer,         // OBRIGATÓRIO - versão atual no cliente (anti race)
//   usuario: string,          // OBRIGATÓRIO (ou via header X-User)
//
//   // Campos editáveis (todos opcionais, só os enviados são alterados):
//   grade?: object,           // se mudar, exige motivo_edicao
//   cores?: array,            // se mudar, exige motivo_edicao
//   grupo?: integer | null,
//   motivo_edicao?: string    // obrigatório se mudar grade/cores/grupo
// }
//
// Retorna 200 { ordem: {...} }
//         409 { error, version_atual } se version não bate (outro usuário atualizou)
//         400 com erro de validação
//
// Não permite editar ordens em status na_sala/concluido/cancelado.

import {
  supabase, setCors, getUserFromReq, parseBody,
  validateGrade, validateCores, calcTotalRolos,
  insertHistorico
} from './_ordens-corte-helpers.js';

const STATUS_EDITAVEIS = ['aguardando', 'separado'];
const CAMPOS_CRITICOS = ['grade', 'cores', 'grupo'];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT' && req.method !== 'POST') {
    return res.status(405).json({ error: 'PUT ou POST' });
  }

  try {
    const body = parseBody(req);
    const usuario = getUserFromReq(req) || body.usuario;

    if (!usuario) return res.status(400).json({ error: 'usuario (ou header X-User) obrigatório' });
    if (!body.id) return res.status(400).json({ error: 'id obrigatório' });
    if (typeof body.version !== 'number') {
      return res.status(400).json({ error: 'version obrigatória (inteiro)' });
    }

    // ── Lê o registro atual ──
    const { data: atual, error: errLoad } = await supabase
      .from('ordens_corte')
      .select('*')
      .eq('id', body.id)
      .maybeSingle();
    if (errLoad) return res.status(500).json({ error: errLoad.message });
    if (!atual) return res.status(404).json({ error: 'ordem não encontrada' });

    // ── Bloqueia edição em status finalizado ──
    if (!STATUS_EDITAVEIS.includes(atual.status)) {
      return res.status(400).json({
        error: `Ordens em status "${atual.status}" não podem ser editadas`,
        codigo: 'STATUS_NAO_EDITAVEL'
      });
    }

    // ── Detecta mudanças nos campos editáveis ──
    const updates = {};
    if (body.grade !== undefined) {
      const err = validateGrade(body.grade);
      if (err) return res.status(400).json({ error: err });
      if (JSON.stringify(body.grade) !== JSON.stringify(atual.grade)) updates.grade = body.grade;
    }
    if (body.cores !== undefined) {
      const err = validateCores(body.cores);
      if (err) return res.status(400).json({ error: err });
      if (JSON.stringify(body.cores) !== JSON.stringify(atual.cores)) {
        updates.cores = body.cores;
        updates.total_rolos = calcTotalRolos(body.cores);
      }
    }
    if (body.grupo !== undefined && body.grupo !== atual.grupo) {
      if (body.grupo !== null && (!Number.isInteger(body.grupo) || body.grupo < 0 || body.grupo > 9)) {
        return res.status(400).json({ error: 'grupo deve ser inteiro entre 0 e 9 (ou null)' });
      }
      updates.grupo = body.grupo;
    }

    // Detecta se houve mudança em campo crítico → motivo obrigatório
    const mudouCritico = CAMPOS_CRITICOS.some(c => updates[c] !== undefined);
    if (mudouCritico && !body.motivo_edicao?.trim()) {
      return res.status(400).json({
        error: 'motivo_edicao obrigatório ao alterar grade, cores ou grupo',
        codigo: 'MOTIVO_OBRIGATORIO'
      });
    }
    if (mudouCritico) updates.motivo_edicao = body.motivo_edicao.trim();

    if (Object.keys(updates).length === 0) {
      return res.status(200).json({ ordem: atual, info: 'sem mudanças' });
    }

    // ── UPDATE com optimistic locking ──
    const { data: updated, error: errUpd } = await supabase
      .from('ordens_corte')
      .update(updates)
      .eq('id', body.id)
      .eq('version', body.version)
      .select()
      .maybeSingle();

    if (errUpd) {
      console.error('atualizar erro:', errUpd);
      return res.status(500).json({ error: errUpd.message });
    }

    // Se 0 rows afetadas → version não bateu = race condition
    if (!updated) {
      return res.status(409).json({
        error: 'Ordem foi atualizada por outro usuário, recarregando...',
        codigo: 'VERSION_CONFLICT',
        version_atual: atual.version,
      });
    }

    await insertHistorico({
      ordem_id: updated.id,
      acao: 'editada',
      payload_antes: atual,
      payload_depois: updated,
      motivo: body.motivo_edicao || null,
      user_id: usuario,
    });

    return res.status(200).json({ ordem: updated });
  } catch (e) {
    console.error('atualizar catch:', e);
    return res.status(500).json({ error: e?.message || 'erro interno' });
  }
}
