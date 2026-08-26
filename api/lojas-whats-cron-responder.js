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

import { supabase, log, logErro, getConfig, tagsCongelamEnvio } from './_lojas-whats-helpers.js';
import { processarConversa } from './lojas-whats-ia.js';
import { processarUma } from './lojas-whats-aprovar.js';
import { enviarAberturaApresentacao, enviarAberturaTextoFotos } from './_lojas-whats-apresentacao.js';
import { rodarResgates } from './_lojas-whats-resgate.js';
import { rodarCiclo24 } from './_lojas-whats-ciclo24.js';

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
  let autoEnviadas = 0, autoFalhas = 0, congeladas = 0;
  const detalhe = [];

  // Chave liga/desliga do auto-envio da Sofia (default DESLIGADO).
  // Ailson 31/05/2026 — Sofia responde sozinha so quando isto estiver true.
  const autoAtivo = await getConfig('sofia_auto_resposta_ativa', false) === true;

  try {
    // 1. Conversas com debounce vencido e ultima msg do cliente.
    const { data: conversas, error: errSel } = await supabase
      .from('lojas_whats_conversas')
      .select('id, etapa, responder_em, ultima_msg_direcao, apresentacao_grupo, apresentacao_variante, apresentacao_enviada_em, telefone, nome_cliente, tags')
      .not('responder_em', 'is', null)
      .lte('responder_em', agoraIso)
      .eq('ultima_msg_direcao', 'entrada')
      .order('responder_em', { ascending: true })
      .limit(LIMITE_POR_RUN);
    if (errSel) throw errSel;

    if (!conversas?.length) {
      // Mesmo sem conversa com debounce, a fase de RESGATE roda (sugestoes
      // pendentes paradas 30+ min nao dependem de inbound novo).
      let resgateVazio = null;
      try {
        resgateVazio = await rodarResgates();
      } catch (eRes) {
        logErro('cron-responder/resgate', eRes);
        resgateVazio = { erro: eRes.message };
      }
      // Ciclo 24h (relógio + gancho) roda mesmo sem debounce vencido.
      let ciclo24Vazio = null;
      try {
        ciclo24Vazio = await rodarCiclo24();
      } catch (eC24) {
        logErro('cron-responder/ciclo24', eC24);
        ciclo24Vazio = { erro: eC24.message };
      }
      return res.status(200).json({ ok: true, total_pegos: 0, gerados, pulados, erros, resgate: resgateVazio, ciclo24: ciclo24Vazio });
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

      // Abertura A/B (Ailson 11/06/2026): a PRIMEIRA resposta do grupo
      // apresentacao depende da variante sorteada no webhook:
      //   'video'       → vídeo da Tamara + legenda
      //   'texto_fotos' → texto curto do atacado + fotos ref='abertura'
      // Depois disso a Sofia espera a interação e segue o fluxo normal
      // (oferece o catálogo ou o cliente pede).
      // Tag congelante (Ailson 07/07/2026): conversa marcada (ex: Atenção)
      // não recebe NENHUM envio automático — nem abertura, nem auto-send.
      // A sugestão também não é gerada aqui: quando a atendente resolver e
      // remover a tag, o fluxo volta ao normal no próximo tick.
      if (await tagsCongelamEnvio(c.tags)) { congeladas++; continue; }

      if (c.apresentacao_grupo && !c.apresentacao_enviada_em) {
        await zerarResponderEm(c.id);
        const variante = c.apresentacao_variante === 'texto_fotos' ? 'texto_fotos' : 'video';
        let raOk = false;
        try {
          const ra = variante === 'texto_fotos'
            ? await enviarAberturaTextoFotos(c.id, c.telefone, c.nome_cliente)
            : await enviarAberturaApresentacao(c.id, c.telefone, c.nome_cliente);
          raOk = !!ra.ok;
          if (!ra.ok) logErro('cron-responder/apresentacao', new Error(ra.erro || 'falha'));
        } catch (e) {
          logErro('cron-responder/apresentacao', e);
        }
        // Marca como enviada SEMPRE (mesmo em falha) pra não repetir a abertura.
        await supabase
          .from('lojas_whats_conversas')
          .update(raOk
            ? { apresentacao_enviada_em: new Date().toISOString(), ultima_msg_direcao: 'saida' }
            : { apresentacao_enviada_em: new Date().toISOString() })
          .eq('id', c.id);
        if (raOk) {
          gerados++;
          detalhe.push({ id: c.id, motivo: variante === 'texto_fotos' ? 'apresentacao_texto_fotos' : 'apresentacao_video' });
          continue; // próximo toque (catálogo) vem depois, no fluxo normal
        }
        // Falhou (ex: .mov rejeitado): cai pro fluxo normal abaixo pra o lead
        // ainda receber uma resposta.
      }

      // 26/08 (caso Luciana, mensagens 2x com 4s de diferenca): o claim
      // virou ATOMICO — o update condicional so afeta a linha se responder_em
      // AINDA estiver preenchido; a execucao paralela encontra null, afeta 0
      // linhas e PULA a conversa. Fim da corrida entre runs sobrepostos.
      const ganhou = await claimAtomico(c.id);
      if (!ganhou) { pulados.push({ id: c.id, motivo: 'claim_perdido_para_run_paralelo' }); continue; }

      try {
        const r = await processarConversa(c.id);
        // Sucesso = criou sugestao de replica. Demais motivos sao skips
        // legitimos (ja_tem_sugestao_pendente, sem_mensagem_cliente_pra_responder,
        // conversa_ja_fechada).
        if (r?.motivo === 'replica_proposta') {
          gerados++;
          let autoInfo = null;
          // Auto-envio: so se a chave estiver ligada E o gate classificou como AUTO.
          // Reusa o MESMO pipeline da aprovacao (processarUma), so que disparado
          // pelo sistema (aprovada_por='sofia_auto'). Falha aqui nao derruba o run:
          // a sugestao fica 'falhou' e a Tamara ve. Na duvida, fica pendente.
          if (autoAtivo && r.autoEnviar && r.sugestaoId) {
            try {
              await processarUma(r.sugestaoId, 'aprovar', null, 'sofia_auto');
              autoEnviadas++;
              autoInfo = { auto_enviada: true, fase: r.faseAuto, motivo_auto: r.motivoAuto };
            } catch (eAuto) {
              autoFalhas++;
              logErro('cron-responder/auto-envio', eAuto);
              autoInfo = { auto_enviada: false, erro: eAuto.message };
            }
          }
          detalhe.push({ id: c.id, motivo: r.motivo, auto: autoInfo });
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

    // 3. RESGATE 30 MIN (Ailson 01/07/2026): sugestoes pendentes paradas ha
    // 30+ min sem aprovacao humana — Sofia reavalia e, se confianca >= 80 e
    // tema nao delicado, envia sozinha (max 2 por conversa). Falha aqui nao
    // derruba o run principal.
    let resgate = null;
    try {
      resgate = await rodarResgates();
    } catch (eRes) {
      logErro('cron-responder/resgate', eRes);
      resgate = { erro: eRes.message };
    }

    // 4. CICLO 24H (Ailson 02/07/2026): relógio da janela do WhatsApp + gancho
    // leve da Sofia. Falha aqui não derruba o run principal.
    let ciclo24 = null;
    try {
      ciclo24 = await rodarCiclo24();
    } catch (eC24) {
      logErro('cron-responder/ciclo24', eC24);
      ciclo24 = { erro: eC24.message };
    }

    return res.status(200).json({
      ok: true,
      total_pegos: conversas.length,
      gerados,
      pulados,
      congeladas,
      erros,
      auto_ativo: autoAtivo,
      auto_enviadas: autoEnviadas,
      auto_falhas: autoFalhas,
      resgate,
      ciclo24,
      detalhe,
    });
  } catch (e) {
    logErro('cron-responder', e);
    return res.status(500).json({ error: e.message });
  }
}

async function claimAtomico(conversaId) {
  const { data, error } = await supabase
    .from('lojas_whats_conversas')
    .update({ responder_em: null })
    .eq('id', conversaId)
    .not('responder_em', 'is', null)
    .select('id');
  if (error) { logErro('cron-responder/claim', error); return false; }
  return (data || []).length > 0;
}
