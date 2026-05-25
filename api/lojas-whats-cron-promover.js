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

    const cutoffPerdida = new Date(Date.now() - diasPerdida * 86400000).toISOString();
    const cutoffEsfriando = new Date(Date.now() - diasEsfriando * 86400000).toISOString();
    const cutoffEsfriouTotal = new Date(Date.now() - (diasEsfriando + 2) * 86400000).toISOString();

    const [{ count: paraEsfriando }, { count: paraPerdida }, { count: paraEsfriouTotal }] = await Promise.all([
      // Quente sem evoluir há > diasEsfriando E ainda não esfriando
      supabase.from('lojas_whats_conversas')
        .select('*', { count: 'exact', head: true })
        .eq('etapa', 'quente')
        .is('esfriando_desde', null)
        .lt('ultima_atividade_em', cutoffEsfriando),
      // Qualquer etapa ativa sem atividade há > diasPerdida
      supabase.from('lojas_whats_conversas')
        .select('*', { count: 'exact', head: true })
        .not('etapa', 'in', '(perdida,vendeu)')
        .lt('ultima_atividade_em', cutoffPerdida),
      // Esfriando há > 2d → vai pra perdida
      supabase.from('lojas_whats_conversas')
        .select('*', { count: 'exact', head: true })
        .eq('etapa', 'quente')
        .not('esfriando_desde', 'is', null)
        .lt('esfriando_desde', cutoffEsfriouTotal),
    ]);

    return res.status(200).json({
      ok: true,
      preview: true,
      regras: {
        dias_perdida: diasPerdida,
        dias_esfriando: diasEsfriando,
        cutoffs: { perdida: cutoffPerdida, esfriando: cutoffEsfriando, esfriou_total: cutoffEsfriouTotal }
      },
      seriam_processadas: {
        marcar_esfriando: paraEsfriando || 0,
        marcar_perdida_sem_resposta: paraPerdida || 0,
        marcar_perdida_esfriou_total: paraEsfriouTotal || 0
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
  const agora = new Date().toISOString();

  const cutoffPerdida = new Date(Date.now() - diasPerdida * 86400000).toISOString();
  const cutoffEsfriando = new Date(Date.now() - diasEsfriando * 86400000).toISOString();
  const cutoffEsfriouTotal = new Date(Date.now() - (diasEsfriando + 2) * 86400000).toISOString();

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

  // ─── 2. Marca como perdida sem resposta ───────────────────────────────
  const { data: paraPerdida, error: err2 } = await supabase
    .from('lojas_whats_conversas')
    .update({
      etapa: 'perdida',
      motivo_perdida: 'sem_resposta_3d',
      perdida_em: agora,
      atualizado_em: agora
    })
    .not('etapa', 'in', '(perdida,vendeu)')
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
    regras: { dias_perdida: diasPerdida, dias_esfriando: diasEsfriando },
    processadas: {
      marcadas_esfriando: paraEsfriando?.length || 0,
      marcadas_perdida_sem_resposta: paraPerdida?.length || 0,
      marcadas_perdida_esfriou_total: paraEsfriouTotal?.length || 0,
      sugestoes_dispensadas: sugDispensadas
    }
  };
  log('cron-promover', JSON.stringify(resultado.processadas));
  return resultado;
}
