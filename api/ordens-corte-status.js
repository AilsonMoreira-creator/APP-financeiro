// api/ordens-corte-status.js — Transições de status (com side effects críticos)
// POST /api/ordens-corte-status
//
// Body: {
//   id: uuid,                  // OBRIGATÓRIO
//   novoStatus: string,        // OBRIGATÓRIO - aguardando|separado|na_sala|concluido
//   usuario: string,           // OBRIGATÓRIO (ou header X-User)
//   sala?: string,             // OBRIGATÓRIO se novoStatus='na_sala'
//   cores?: array,             // opcional - permite editar cores na transição (Fila mobile)
// }
//
// Transições válidas:
//   aguardando → separado    : qualquer (Admin/Funcionário)
//                              salva separado_por, separado_em
//   separado → na_sala       : qualquer
//                              salva sala, enviado_sala_em
//                              ⚡ CRIA corte no payload salas-corte (side effect)
//                              ⚡ Atualiza ordens_corte.corte_id
//   na_sala → concluido      : qualquer (chamado AUTO pelo front quando corte fecha)
//                              salva concluido_em
//   qualquer → cancelado     : usar /api/ordens-corte-excluir
//
// Retorna 200 { ordem, corte_id? } ou 400/404/409

import {
  supabase, setCors, getUserFromReq, parseBody,
  validateCores, calcTotalRolos,
  criarCorteEmSalasCorte, insertHistorico
} from './_ordens-corte-helpers.js';

// Mapa de transições válidas: from → [permitidos]
const TRANSICOES = {
  aguardando: ['separado'],
  separado: ['na_sala', 'aguardando'], // permite voltar (admin override)
  na_sala: ['concluido'],
  concluido: [], // estado final
  cancelado: [], // estado final
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = parseBody(req);
    const usuario = getUserFromReq(req) || body.usuario;

    if (!usuario) return res.status(400).json({ error: 'usuario (ou header X-User) obrigatório' });
    if (!body.id) return res.status(400).json({ error: 'id obrigatório' });
    if (!body.novoStatus) return res.status(400).json({ error: 'novoStatus obrigatório' });

    // ── Lê ordem atual ──
    const { data: atual, error: errLoad } = await supabase
      .from('ordens_corte')
      .select('*')
      .eq('id', body.id)
      .maybeSingle();
    if (errLoad) return res.status(500).json({ error: errLoad.message });
    if (!atual) return res.status(404).json({ error: 'ordem não encontrada' });

    // ── Valida transição ──
    const permitidos = TRANSICOES[atual.status] || [];
    if (!permitidos.includes(body.novoStatus)) {
      return res.status(400).json({
        error: `Transição inválida: ${atual.status} → ${body.novoStatus}`,
        codigo: 'TRANSICAO_INVALIDA',
        permitidos,
      });
    }

    // ── Monta updates baseado na transição ──
    const updates = { status: body.novoStatus };
    const agora = new Date().toISOString();

    if (body.novoStatus === 'separado') {
      updates.separado_por = usuario;
      updates.separado_em = agora;
      // Permite editar cores no momento de separar (Fila mobile)
      if (body.cores) {
        const errCores = validateCores(body.cores);
        if (errCores) return res.status(400).json({ error: errCores });
        updates.cores = body.cores;
        updates.total_rolos = calcTotalRolos(body.cores);
      }
    }

    if (body.novoStatus === 'na_sala') {
      const sala = (body.sala || '').toString().trim();
      if (!sala) return res.status(400).json({ error: 'sala obrigatória pra status na_sala' });
      updates.sala = sala;
      updates.enviado_sala_em = agora;
    }

    if (body.novoStatus === 'concluido') {
      updates.concluido_em = agora;
    }

    if (body.novoStatus === 'aguardando') {
      // Admin override: limpa campos de "separado"
      updates.separado_por = null;
      updates.separado_em = null;
    }

    // ── Aplica UPDATE ──
    const { data: updated, error: errUpd } = await supabase
      .from('ordens_corte')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();

    if (errUpd) {
      console.error('status erro update:', errUpd);
      return res.status(500).json({ error: errUpd.message });
    }

    // ── SIDE EFFECT CRÍTICO: criar corte no salas-corte quando vai pra na_sala ──
    let corteResult = null;
    if (body.novoStatus === 'na_sala') {
      corteResult = await criarCorteEmSalasCorte({ ordem: updated });

      if (!corteResult.ok) {
        // Falhou ao criar corte — REVERTE a ordem pra status anterior pra manter consistência
        console.error('status: falha criar corte salas-corte, revertendo ordem');
        await supabase
          .from('ordens_corte')
          .update({
            status: atual.status,
            sala: atual.sala,
            enviado_sala_em: atual.enviado_sala_em,
          })
          .eq('id', body.id);

        return res.status(500).json({
          error: 'Falha ao criar corte no Salas de Corte: ' + corteResult.error + '. Status revertido.',
          codigo: 'SIDE_EFFECT_FALHOU',
        });
      }

      // Sucesso: vincula corte_id na ordem
      const { data: comCorteId } = await supabase
        .from('ordens_corte')
        .update({ corte_id: corteResult.corte_id })
        .eq('id', body.id)
        .select()
        .single();
      if (comCorteId) Object.assign(updated, comCorteId);
    }

    // ── Histórico ──
    const acaoMap = {
      separado: 'tecido_separado',
      na_sala: 'sala_definida',
      concluido: 'concluida',
    };
    await insertHistorico({
      ordem_id: updated.id,
      acao: acaoMap[body.novoStatus] || 'status_alterado',
      payload_antes: { status: atual.status, sala: atual.sala, cores: atual.cores },
      payload_depois: { status: updated.status, sala: updated.sala, cores: updated.cores, corte_id: updated.corte_id },
      user_id: usuario,
    });

    return res.status(200).json({
      ordem: updated,
      corte_id: corteResult?.corte_id || null,
    });
  } catch (e) {
    console.error('status catch:', e);
    return res.status(500).json({ error: e?.message || 'erro interno' });
  }
}
