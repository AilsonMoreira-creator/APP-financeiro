// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-cron-catalogo
// ═══════════════════════════════════════════════════════════════════════════
// Roda 1x por hora. Dois estagios:
//
// FASE 1 — 6h apos catalogo enviado, cliente nao respondeu:
//   - Sofia gera msg automatica ("ficou alguma duvida? conseguiu olhar?")
//   - Envia DIRETO via Meta (sem passar por Tamara — Ailson 27/05/2026)
//   - Marca catalogo_followup_6h_em=NOW
//
// FASE 2 — 24h apos a msg de 6h, cliente ainda nao respondeu:
//   - Move conversa pra etapa='follow_up' com tag '1d'
//   - cron-followup ja existente pega normal pra gerar msg de retomada
//
// Webhook reseta catalogo_enviado_em e catalogo_followup_6h_em quando
// cliente manda QUALQUER msg — entao cron so pega conversas silentes.
//
// Ailson 27/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro, contarSofiaSemResposta } from './_lojas-whats-helpers.js';
import { enviarTexto, enviarTemplate } from './_lojas-whats-meta-client.js';

const VARIACOES_MSG_6H = [
  'Oi {nome}! Conseguiu dar uma olhadinha no catálogo? Ficou alguma dúvida em algum modelo? 🤗',
  'Oi {nome}, tudo bem? Deu pra ver o catálogo? Posso te ajudar com alguma peça em específico?',
  'Oi {nome}! Passando aqui pra saber se vc viu o catálogo… alguma dúvida? Posso te mandar mais info de algum modelo?',
  'Olá {nome}! Conseguiu olhar o catálogo? Se ficou na dúvida em algo, me chama que te ajudo 🙌',
];

function escolherMsg6h(conversaId, nomeCliente) {
  // Pseudo-aleatorio determinista baseado no id da conversa pra ela receber
  // sempre a mesma variacao (idempotencia se cron rodar 2x)
  const idStr = String(conversaId);
  let h = 0;
  for (let i = 0; i < idStr.length; i++) h = (h * 31 + idStr.charCodeAt(i)) | 0;
  const template = VARIACOES_MSG_6H[Math.abs(h) % VARIACOES_MSG_6H.length];
  // Pega primeiro nome — mais natural. Se vazio, fallback educado.
  const primeiroNome = (nomeCliente || '').split(' ')[0].trim();
  return primeiroNome
    ? template.replace('{nome}', primeiroNome)
    : template.replace('Oi {nome}!', 'Oi!').replace('Oi {nome},', 'Oi, tudo bem?').replace('Olá {nome}!', 'Olá!');
}

export default async function handler(req, res) {
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({ error: 'Cron only. Use ?force=1 pra teste.' });
  }

  try {
    // ─── Janela 9h-20h BRT (Ailson 27/05/2026) ────────────────────────────
    // Cliente nao recebe msg auto antes das 9h nem depois das 20h.
    // FASE 1 (envio direto pro cliente) respeita estritamente.
    // FASE 2 (mudanca de etapa, sem envio) roda sempre — quem envia depois
    // eh cron-followup gerando SUGESTAO pendente (Tamara aprova manual).
    const horaBRT = parseInt(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })
    , 10);
    const dentroJanela9_20 = horaBRT >= 9 && horaBRT < 20;

    const agora = new Date();
    const cutoff6h  = new Date(Date.now() - 6  * 60 * 60 * 1000).toISOString();
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // ─── FASE 1 — 6h, dispara msg automatica ──────────────────────────────
    let f1 = [];
    let f1Resultados = [];
    if (!dentroJanela9_20) {
      // Posterga FASE 1 pra proxima rodada dentro do horario comercial
      log('cron-catalogo', `FASE 1 pulada — hora BRT ${horaBRT}h fora da janela 9-20h`);
    } else {
      const { data: f1Data, error: errF1 } = await supabase
        .from('lojas_whats_conversas')
        .select('id, telefone, nome_cliente, etapa')
        .not('catalogo_enviado_em', 'is', null)
        .lt('catalogo_enviado_em', cutoff6h)
        .is('catalogo_followup_6h_em', null)
        .eq('catalogo_followup_pausado', false)
        .in('etapa', ['conversando', 'quente']);
      if (errF1) throw errF1;
      f1 = f1Data || [];

      for (const conv of f1) {
        try {
          // Regra Ailson 30/05/2026: nunca a 3a mensagem sem resposta.
          if (await contarSofiaSemResposta(conv.id) >= 2) {
            f1Resultados.push({ id: conv.id, motivo: '2_sem_resposta' });
            continue;
          }
          // CLAIM antes de enviar: marca catalogo_followup_6h_em ANTES, so se
          // ainda estiver null. Se o envio/insert falhar depois, NAO reenvia na
          // hora seguinte (antes marcava so apos enviar -> spam hora a hora).
          // Ailson 30/05/2026.
          const { data: claimed } = await supabase
            .from('lojas_whats_conversas')
            .update({
              catalogo_followup_6h_em: agora.toISOString(),
              ultima_atividade_em: agora.toISOString(),
              atualizado_em: agora.toISOString(),
            })
            .eq('id', conv.id)
            .is('catalogo_followup_6h_em', null)
            .select('id');
          if (!claimed?.length) {
            f1Resultados.push({ id: conv.id, motivo: 'ja_claimed' });
            continue;
          }

          const texto = escolherMsg6h(conv.id, conv.nome_cliente);
          const r = await enviarTexto(conv.telefone, texto);
          const metaMsgId = r?.messages?.[0]?.id || null;
          if (!metaMsgId) throw new Error('meta_sem_message_id');

          await supabase.from('lojas_whats_mensagens').insert({
            conversa_id: conv.id,
            direcao: 'saida',
            autor: 'assistente',
            tipo_midia: 'text',
            texto,
            meta_message_id: metaMsgId,
            status: 'enviando',
            enviada_em: agora.toISOString(),
          });

          f1Resultados.push({ id: conv.id, tel: conv.telefone, ok: true });
          log('cron-catalogo/6h', `conv=${conv.id} msg auto enviada`);
        } catch (e) {
          f1Resultados.push({ id: conv.id, tel: conv.telefone, erro: e.message });
          logErro('cron-catalogo/6h', e);
        }
      }
    }

    // ─── FASE 2 — 24h apos msg de 6h ─────────────────────────────────────
    // Ailson 27/05/2026: agora ENVIA AUTOMATICAMENTE o template HSM
    // followup_catalogo_24h_v1 (fora da janela 24h Meta → precisa HSM)
    // e depois move pra follow_up. Respeita janela 9-20h BRT igual FASE 1.
    const { data: f2, error: errF2 } = await supabase
      .from('lojas_whats_conversas')
      .select('id, telefone, nome_cliente, etapa')
      .not('catalogo_followup_6h_em', 'is', null)
      .lt('catalogo_followup_6h_em', cutoff24h)
      .eq('catalogo_followup_pausado', false)
      .in('etapa', ['conversando', 'quente']);
    if (errF2) throw errF2;

    const venceEm1d = new Date(Date.now() + 86400000).toISOString();
    const f2Resultados = [];

    if (!dentroJanela9_20 && (f2 || []).length > 0) {
      log('cron-catalogo', `FASE 2 pulada — hora BRT ${horaBRT}h fora da janela 9-20h (${f2.length} pendentes)`);
    } else {
      for (const conv of f2 || []) {
        try {
          // Regra Ailson 30/05/2026: nunca a 3a mensagem sem resposta.
          if (await contarSofiaSemResposta(conv.id) >= 2) {
            f2Resultados.push({ id: conv.id, motivo: '2_sem_resposta' });
            continue;
          }
          // CLAIM antes de enviar o template: move pra follow_up ANTES, so se
          // ainda estiver elegivel (etapa conversando/quente + marcador 6h).
          // Atomico: dois runs nao claimam o mesmo. Se o envio falhar depois, a
          // conversa ja esta em follow_up (cron-followup cuida) — nunca reenvia
          // o template hora a hora. Ailson 30/05/2026.
          const { data: claimed } = await supabase
            .from('lojas_whats_conversas')
            .update({
              etapa: 'follow_up',
              follow_up_tag: '1d',
              follow_up_vence_em: venceEm1d,
              follow_up_entrou_em: agora.toISOString(),
              follow_up_origem: 'cron_catalogo_24h',
              follow_up_motivo: 'cliente nao respondeu apos catalogo + msg 6h (template auto enviado)',
              catalogo_enviado_em: null,
              catalogo_followup_6h_em: null,
              ultima_atividade_em: agora.toISOString(),
              atualizado_em: agora.toISOString(),
            })
            .eq('id', conv.id)
            .in('etapa', ['conversando', 'quente'])
            .not('catalogo_followup_6h_em', 'is', null)
            .select('id');
          if (!claimed?.length) {
            f2Resultados.push({ id: conv.id, motivo: 'ja_claimed' });
            continue;
          }

          const primeiroNome = (conv.nome_cliente || 'cliente').split(' ')[0];
          const r = await enviarTemplate(conv.telefone, 'followup_catalogo_24h_v1', [primeiroNome]);
          const metaMsgId = r?.messages?.[0]?.id || null;
          if (!metaMsgId) throw new Error('meta_sem_message_id');

          const textoMsg = `Oii ${primeiroNome}! 😊\n\nVc conseguiu dar uma olhadinha no catálogo? Ficou alguma dúvida sobre algum modelo, tamanho ou entrega?`;

          await supabase.from('lojas_whats_mensagens').insert({
            conversa_id: conv.id,
            direcao: 'saida',
            autor: 'assistente',
            tipo_midia: 'text',
            texto: textoMsg,
            template_name: 'followup_catalogo_24h_v1',
            template_vars: { '1': primeiroNome },
            meta_message_id: metaMsgId,
            status: 'enviando',
            enviada_em: agora.toISOString(),
          });

          f2Resultados.push({ id: conv.id, ok: true });
          log('cron-catalogo/24h', `conv=${conv.id} template enviado + follow_up tag=1d`);
        } catch (e) {
          f2Resultados.push({ id: conv.id, erro: e.message });
          logErro('cron-catalogo/24h', e);
        }
      }
    }

    return res.status(200).json({
      ok: true,
      hora_brt: horaBRT,
      dentro_janela_9_20: dentroJanela9_20,
      fase_1_6h: { processadas: f1.length, resultados: f1Resultados },
      fase_2_24h: { processadas: (f2 || []).length, resultados: f2Resultados },
    });
  } catch (e) {
    logErro('cron-catalogo', e);
    return res.status(500).json({ error: e.message });
  }
}
