// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-cron-responder
// ═══════════════════════════════════════════════════════════════════════════
// Roda a cada 1 min (Vercel Pro permite "* * * * *").
//
// Resposta da Sofia "na hora", com debounce. Antes o webhook disparava a IA
// inline via fetch fire-and-forget pra /api/lojas-whats-ia — mas o serverless
// encerra a function logo apos o 200 pro WhatsApp e matava o fetch em voo, entao
// a sugestao saia atrasada (0-40 min) ou nunca. Agora:
//
//   1. Webhook, a cada inbound do cliente, seta responder_em = now()+60s
//      (empurra sempre → agrupa rajada, nao responde no meio da digitacao).
//   2. Este cron pega conversas com responder_em <= now() cuja ultima msg eh do
//      cliente (ultima_msg_direcao='entrada'), gera a sugestao via
//      processarConversa() IN-PROCESS (sem hop HTTP fragil) e zera responder_em.
//
// processarConversa ja eh idempotente: pula conversa fechada, pula se a ultima
// msg nao eh do cliente, e pula se ja existe sugestao 'pendente'. Entao mesmo
// que dois runs se sobreponham, nao gera sugestao duplicada.
//
// Ailson 29/05/2026.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro } from './_lojas-whats-helpers.js';
import { processarConversa } from './lojas-whats-ia.js';

// Quanto pegamos por run. Mantido modesto: cada processarConversa faz 1 chamada
// ao Claude (alguns segundos). 12 * ~5s = ~60s, folgado dentro do maxDuration.
// Como roda 1x/min, a vazao sobra pro volume real (poucas vendedoras + Sofia).
const LIMITE_POR_RUN = 12;

// Etapas terminais: nao geramos resposta.
const ETAPAS_FECHADAS = ['vendeu', 'perdida'];

export default async function handler(req, res) {
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({ error: 'Cron only. Use ?force=1 pra teste.' });
  }

  const agoraIso = new Date().toISOString();
  let gerados = 0, pulados = 0, erros = 0;
  const detalhe = [];

  try {
    // 1. Conversas com debounce vencido e ultima msg do cliente.
    const { data: conversas, error: errSel } = await supabase
      .from('lojas_whats_conversas')
      .select('id, etapa, responder_em, ultima_msg_direcao')
      .not('responder_em', 'is', null)
      .lte('responder_em', agoraIso)
      .eq('ultima_msg_direcao', 'entrada')
      .order('responder_em', { ascending: true })
      .limit(LIMITE_POR_RUN);
    if (errSel) throw errSel;

    if (!conversas?.length) {
      return res.status(200).json({ ok: true, total_pegos: 0, gerados, pulados, erros });
    }

    log('cron-responder', `pegou ${conversas.length} conversa(s) com debounce vencido`);

    // 2. Processa sequencialmente (evita estourar rate limit do Claude e mantem
    //    memoria baixa).
    for (const c of conversas) {
      // Pula etapas fechadas sem nem chamar a IA (e zera o timer).
      if (ETAPAS_FECHADAS.includes(c.etapa)) {
        await zerarResponderEm(c.id);
        pulados++;
        detalhe.push({ id: c.id, motivo: 'etapa_fechada', etapa: c.etapa });
        continue;
      }

      // Claim: zera responder_em ANTES de processar pra reduzir janela de
      // sobreposicao entre runs. Idempotencia real fica por conta do guard de
      // sugestao pendente dentro do processarConversa.
      await zerarResponderEm(c.id);

      try {
        const r = await processarConversa(c.id);
        // Sucesso = criou sugestao de replica. Demais motivos sao skips
        // legitimos (ja_tem_sugestao_pendente, sem_mensagem_cliente_pra_responder,
        // conversa_ja_fechada).
        if (r?.motivo === 'replica_proposta') {
          gerados++;
          detalhe.push({ id: c.id, motivo: r.motivo });
        } else {
          pulados++;
          detalhe.push({ id: c.id, motivo: r?.motivo || 'sem_acao' });
        }
      } catch (e) {
        erros++;
        logErro('cron-responder/processar', e);
        detalhe.push({ id: c.id, motivo: 'erro', erro: e.message });
        // Re-arma pra retry em ~2 min (bounded — nao martela a cada minuto).
        await supabase
          .from('lojas_whats_conversas')
          .update({ responder_em: new Date(Date.now() + 120 * 1000).toISOString() })
          .eq('id', c.id);
      }
    }

    log('cron-responder', `gerados=${gerados} pulados=${pulados} erros=${erros}`);
    return res.status(200).json({
      ok: true,
      total_pegos: conversas.length,
      gerados,
      pulados,
      erros,
      detalhe,
    });
  } catch (e) {
    logErro('cron-responder', e);
    return res.status(500).json({ error: e.message });
  }
}

async function zerarResponderEm(conversaId) {
  const { error } = await supabase
    .from('lojas_whats_conversas')
    .update({ responder_em: null })
    .eq('id', conversaId);
  if (error) logErro('cron-responder/zerar', error);
}
