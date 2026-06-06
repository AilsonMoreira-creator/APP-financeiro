// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-promover.js — Reavalia esfriamento + Perdida 3d
// ═══════════════════════════════════════════════════════════════════════════
// Cron que roda periodicamente (sugestão: a cada hora) e:
//
//   1. Marca conversas Quente sem evolução há >24h com badge 'esfriando'
//      (seta esfriando_desde, mantém etapa='quente')
//
//   2. Marca conversas em qualquer etapa ATIVA (não vendeu/perdida) sem
//      atividade há >3d como 'perdida' (motivo='sem_resposta_3d')
//
//   3. Conversas em 'esfriando' há >2d → 'perdida' (motivo='esfriou_total')
//
// TODO (Ailson 27/05/2026 — aguardando 3 templates):
//   4. Conversas em 'conversando' SEM virar quente apos N dias E com sinais
//      de potencial residual → 'follow_up'.
//      Sinais a detectar via Claude (ja temos a conversa em lojas_whats_mensagens):
//        - "vou pensar" / "depois decido" / "indeciso"
//        - "vou voltar no site pra comprar" (e sem venda em 3d)
//        - Pediu catalogo e nao respondeu
//      Move pra 'follow_up' e agenda proximo envio (3-5d).
//   5. Conversas em 'follow_up' com 2 tentativas sem resposta → 'perdida'.
//   6. Cron novo (ou estende cron-processar) pra disparar HSM de follow-up
//      respeitando janela 24h vs HSM templates.
//
// Configurável em lojas_whats_config:
//   - regua_dias_perdida (default 3)
//   - regua_quente_esfriando_dias (default 1)
//
// Pode ser chamado por:
//   - Cron Vercel (vercel.json schedule)
//   - Manualmente via POST (botão admin no UI)
//
// GET retorna estatísticas sem fazer nada
// POST executa
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro, getConfig } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    // GET com ?executar=1 ou cron header da Vercel = executa
    if (req.query.executar === '1' || req.headers['user-agent']?.includes('vercel-cron')) {
      try {
        const resultado = await executar();
        return res.status(200).json({ ok: true, ...resultado });
      } catch (e) {
        logErro('cron-promover', e);
        return res.status(500).json({ error: e.message });
      }
    }
    return await preview(req, res);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const resultado = await executar();
    return res.status(200).json({ ok: true, ...resultado });
  } catch (e) {
    logErro('cron-promover', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── PREVIEW (GET) ────────────────────────────────────────────────────────

async function preview(req, res) {
  try {
    const diasPerdida = await getConfig('regua_dias_perdida', 3);
    const diasEsfriando = await getConfig('regua_quente_esfriando_dias', 1);
    const diasAtendidaFup = await getConfig('regua_dias_atendida_followup', 3);
    const diasFollowupMax = await getConfig('regua_dias_followup_max', 15); // so informativo no preview (acao pendente)

    const cutoffPerdida = new Date(Date.now() - diasPerdida * 86400000).toISOString();
    const cutoffEsfriando = new Date(Date.now() - diasEsfriando * 86400000).toISOString();
    const cutoffEsfriouTotal = new Date(Date.now() - (diasEsfriando + 2) * 86400000).toISOString();
    const cutoffAtendida = new Date(Date.now() - diasAtendidaFup * 86400000).toISOString();
    const cutoffFollowup15 = new Date(Date.now() - diasFollowupMax * 86400000).toISOString();

    const [{ count: paraEsfriando }, { count: paraFollowup }, { count: paraPerdida }, { count: paraEsfriouTotal }, { count: followupVencidos }] = await Promise.all([
      // Quente sem evoluir há > diasEsfriando E ainda não esfriando
      supabase.from('lojas_whats_conversas')
        .select('*', { count: 'exact', head: true })
        .eq('etapa', 'quente')
        .is('esfriando_desde', null)
        .lt('ultima_atividade_em', cutoffEsfriando),
      // Atendida sem venda há > diasAtendidaFup → follow_up
      supabase.from('lojas_whats_conversas')
        .select('*', { count: 'exact', head: true })
        .eq('etapa', 'atendida')
        .lt('ultima_atividade_em', cutoffAtendida),
      // Etapa ativa (exceto atendida/follow_up/vendeu/etc) sem atividade > diasPerdida
      supabase.from('lojas_whats_conversas')
        .select('*', { count: 'exact', head: true })
        .not('etapa', 'in', '(perdida,vendeu,feedback,inativo,atendida,follow_up)')
        .lt('ultima_atividade_em', cutoffPerdida),
      // Esfriando há > 2d → vai pra perdida
      supabase.from('lojas_whats_conversas')
        .select('*', { count: 'exact', head: true })
        .eq('etapa', 'quente')
        .not('esfriando_desde', 'is', null)
        .lt('esfriando_desde', cutoffEsfriouTotal),
      // INFORMATIVO: follow_up parado ha > 15d (acao pendente — Ailson decide)
      supabase.from('lojas_whats_conversas')
        .select('*', { count: 'exact', head: true })
        .eq('etapa', 'follow_up')
        .lt('follow_up_entrou_em', cutoffFollowup15),
    ]);

    return res.status(200).json({
      ok: true,
      preview: true,
      regras: {
        dias_perdida: diasPerdida,
        dias_esfriando: diasEsfriando,
        dias_atendida_followup: diasAtendidaFup,
        dias_followup_max: diasFollowupMax,
        cutoffs: { perdida: cutoffPerdida, esfriando: cutoffEsfriando, esfriou_total: cutoffEsfriouTotal, atendida: cutoffAtendida }
      },
      seriam_processadas: {
        marcar_esfriando: paraEsfriando || 0,
        atendida_para_followup: paraFollowup || 0,
        marcar_perdida_sem_resposta: paraPerdida || 0,
        marcar_perdida_esfriou_total: paraEsfriouTotal || 0
      },
      informativo: {
        followup_parados_mais_de_15d: followupVencidos || 0 // sem acao por enquanto
      }
    });
  } catch (e) {
    logErro('cron-promover/preview', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── EXECUTAR (POST) ──────────────────────────────────────────────────────

async function executar() {
  const diasPerdida = await getConfig('regua_dias_perdida', 3);
  const diasEsfriando = await getConfig('regua_quente_esfriando_dias', 1);
  const diasAtendidaFup = await getConfig('regua_dias_atendida_followup', 3); // atendida sem venda Xd -> follow_up (Ailson 06/06)
  const agora = new Date().toISOString();

  const cutoffPerdida = new Date(Date.now() - diasPerdida * 86400000).toISOString();
  const cutoffEsfriando = new Date(Date.now() - diasEsfriando * 86400000).toISOString();
  const cutoffEsfriouTotal = new Date(Date.now() - (diasEsfriando + 2) * 86400000).toISOString();
  const cutoffAtendida = new Date(Date.now() - diasAtendidaFup * 86400000).toISOString();

  // ─── 1. Marca Quente parado como esfriando ────────────────────────────
  const { data: paraEsfriando, error: err1 } = await supabase
    .from('lojas_whats_conversas')
    .update({
      esfriando_desde: agora,
      atualizado_em: agora
    })
    .eq('etapa', 'quente')
    .is('esfriando_desde', null)
    .lt('ultima_atividade_em', cutoffEsfriando)
    .select('id');
  if (err1) logErro('cron-promover/esfriando', err1);

  // ─── 2. Atendida sem venda há > diasAtendidaFup → follow_up ────────────
  // Regra Ailson 06/06: o card fica na aba Atendida ate ~3 dias. Quem vendeu
  // ja saiu pra 'vendeu' (capi-match / leads-conversoes-cron), entao quem
  // CONTINUA em 'atendida' apos 3d e justamente quem NAO vendeu → follow_up.
  // NAO seta follow_up_vence_em de proposito: o card so estaciona na aba, SEM
  // disparar HSM (o cron-followup so atua em quem tem follow_up_vence_em).
  const { data: paraFollowup, error: errFup } = await supabase
    .from('lojas_whats_conversas')
    .update({
      etapa: 'follow_up',
      follow_up_entrou_em: agora,
      follow_up_origem: 'cron_atendida_sem_venda',
      follow_up_motivo: 'sem_venda_apos_atendida',
      atualizado_em: agora
    })
    .eq('etapa', 'atendida')
    .lt('ultima_atividade_em', cutoffAtendida)
    .select('id');
  if (errFup) logErro('cron-promover/atendida-followup', errFup);

  // ─── 3. Marca como perdida sem resposta ───────────────────────────────
  // 'vendeu' nunca sai (fica pra sempre, ate pra remarketing). 'atendida' agora
  // vai pra follow_up (regra 2 acima). 'follow_up' estaciona (decisao dos 15d
  // pendente — Ailson decide depois). Por isso os 3 ficam de fora daqui.
  const { data: paraPerdida, error: err2 } = await supabase
    .from('lojas_whats_conversas')
    .update({
      etapa: 'perdida',
      motivo_perdida: 'sem_resposta_3d',
      perdida_em: agora,
      atualizado_em: agora
    })
    .not('etapa', 'in', '(perdida,vendeu,feedback,inativo,atendida,follow_up)')
    .lt('ultima_atividade_em', cutoffPerdida)
    .select('id');
  if (err2) logErro('cron-promover/perdida-sem-resposta', err2);

  // ─── 3. Esfriou de vez → perdida ──────────────────────────────────────
  const { data: paraEsfriouTotal, error: err3 } = await supabase
    .from('lojas_whats_conversas')
    .update({
      etapa: 'perdida',
      motivo_perdida: 'esfriou_total',
      perdida_em: agora,
      atualizado_em: agora
    })
    .eq('etapa', 'quente')
    .not('esfriando_desde', 'is', null)
    .lt('esfriando_desde', cutoffEsfriouTotal)
    .select('id');
  if (err3) logErro('cron-promover/esfriou-total', err3);

  // ─── 4. Auto-dispensa sugestoes pendentes de conversas perdidas ───────
  const perdidasIds = [
    ...(paraPerdida || []).map(c => c.id),
    ...(paraEsfriouTotal || []).map(c => c.id)
  ];
  let sugDispensadas = 0;
  if (perdidasIds.length > 0) {
    const { data: sugs } = await supabase
      .from('lojas_whats_sugestoes')
      .update({ status: 'dispensada', aprovada_em: agora, atualizada_em: agora })
      .in('conversa_id', perdidasIds)
      .eq('status', 'pendente')
      .select('id');
    sugDispensadas = sugs?.length || 0;
  }

  const resultado = {
    executado_em: agora,
    regras: { dias_perdida: diasPerdida, dias_esfriando: diasEsfriando, dias_atendida_followup: diasAtendidaFup },
    processadas: {
      marcadas_esfriando: paraEsfriando?.length || 0,
      atendida_movidas_followup: paraFollowup?.length || 0,
      marcadas_perdida_sem_resposta: paraPerdida?.length || 0,
      marcadas_perdida_esfriou_total: paraEsfriouTotal?.length || 0,
      sugestoes_dispensadas: sugDispensadas
    }
  };
  log('cron-promover', JSON.stringify(resultado.processadas));
  return resultado;
}
