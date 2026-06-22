// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-cron-catalogo
// ═══════════════════════════════════════════════════════════════════════════
// Roda de hora em hora + uma rodada dedicada às 19:30 BRT. Dois estágios:
//
// FASE 1 — follow-up do catálogo (Ailson 08/06/2026):
//   - Dispara às 19:30 do mesmo dia se o catálogo foi recebido ANTES das 18h;
//     se recebido às 18h ou depois, dispara às 9h do dia seguinte (fluxo antigo).
//   - Objetivo: pegar a lojista num horário que ela tem mais tempo pra olhar.
//   - Só dentro da janela de 24h (free text). Se já passou, perde o envio (a
//     FASE 2 manda o HSM).
//   - Mensagem padrão: "Aproveita esse minutinho pra olhar com calma nosso
//     catálogo 😉". Vesti mantém pergunta do link + PDF.
//   - Envia DIRETO via Meta (sem passar por Tamara). Marca catalogo_followup_6h_em.
//
// FASE 2 — 24h após o catálogo, cliente ainda não respondeu:
//   - Envia o HSM followup_catalogo_24h_v1 e move pra etapa='follow_up' (tag 1d).
//
// Webhook reseta catalogo_enviado_em e catalogo_followup_6h_em quando o cliente
// manda QUALQUER msg — então o cron só pega conversas silentes.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro, contarSofiaSemResposta, getConfig } from './_lojas-whats-helpers.js';
import { enviarTexto, enviarTemplate } from './_lojas-whats-meta-client.js';
import { enviarMidiaSofia } from './_lojas-whats-midia-sender.js';

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
  const bruto = (nomeCliente || '').split(' ')[0].trim();
  const primeiroNome = bruto ? bruto.charAt(0).toUpperCase() + bruto.slice(1).toLowerCase() : ''; // LUCIMARA → Lucimara (Ailson 11/06/2026)
  return primeiroNome
    ? template.replace('{nome}', primeiroNome)
    : template.replace('Oi {nome}!', 'Oi!').replace('Oi {nome},', 'Oi, tudo bem?').replace('Olá {nome}!', 'Olá!');
}

// Mensagem do follow-up de catálogo padrão (novo horário 19:30/9h). Ailson 08/06/2026.
const MSG_CATALOGO_FOLLOWUP = 'Aproveita esse minutinho pra olhar com calma nosso catálogo 😉';

// Horário agendado do follow-up de catálogo (Date UTC):
//   catálogo recebido < 18h BRT  → MESMO dia 19:30 BRT (22:30 UTC)
//   catálogo recebido >= 18h BRT → dia SEGUINTE 09:00 BRT (12:00 UTC) [fluxo antigo]
// BRT = UTC-3 fixo (sem horário de verão). Ailson 08/06/2026.
function agendadoPara(catalogoEnviadoEm) {
  const brt = new Date(new Date(catalogoEnviadoEm).getTime() - 3 * 3600 * 1000);
  const y = brt.getUTCFullYear(), m = brt.getUTCMonth(), d = brt.getUTCDate(), h = brt.getUTCHours();
  return h < 18
    ? new Date(Date.UTC(y, m, d, 22, 30, 0))     // mesmo dia 19:30 BRT
    : new Date(Date.UTC(y, m, d + 1, 12, 0, 0));  // dia seguinte 09:00 BRT
}

export default async function handler(req, res) {
  const ua = req.headers?.['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers?.['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({ error: 'Cron only. Use ?force=1 pra teste.' });
  }

  try {
    // ─── Janela 9h-20h BRT, seg-sáb (Ailson 27/05 + 30/05/2026) ───────────
    // Cliente nao recebe msg auto antes das 9h, depois das 20h, nem no DOMINGO.
    // FASE 1 (envio direto) e FASE 2 (template auto) respeitam estritamente.
    const horaBRT = parseInt(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })
    , 10);
    const diaSemanaBRT = new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' });
    const ehDomingo = diaSemanaBRT === 'Sun';
    const dentroJanela9_20 = horaBRT >= 9 && horaBRT < 20 && !ehDomingo;

    const agora = new Date();
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // ─── FASE 1 — 6h, dispara msg automatica ──────────────────────────────
    let f1 = [];
    let f1Resultados = [];
    if (!dentroJanela9_20) {
      // Posterga FASE 1 pra proxima rodada dentro do horario comercial
      log('cron-catalogo', `FASE 1 pulada — ${ehDomingo ? "domingo" : "hora BRT "+horaBRT+"h"} fora da janela`);
    } else {
      const { data: f1Data, error: errF1 } = await supabase
        .from('lojas_whats_conversas')
        .select('id, telefone, nome_cliente, etapa, catalogo_formato, catalogo_enviado_em')
        .not('catalogo_enviado_em', 'is', null)
        .is('catalogo_followup_6h_em', null)
        .eq('catalogo_followup_pausado', false)
        .eq('catalogo_auto_bloqueado', false)
        .in('etapa', ['conversando', 'quente']);
      if (errF1) throw errF1;
      f1 = f1Data || [];

      // Catalogo PDF ativo (fallback do follow-up vesti). Ailson 04/06/2026.
      let catAtivo = null;
      try {
        const { data: c } = await supabase
          .from('lojas_whats_midias')
          .select('id, tipo, nome_arquivo, storage_path, mime_type')
          .eq('tipo', 'catalogo')
          .eq('ativa', true)
          .order('criada_em', { ascending: false })
          .limit(1)
          .maybeSingle();
        catAtivo = c || null;
      } catch (e) { logErro('cron-catalogo/cat-ativo', e); }

      for (const conv of f1) {
        try {
          // Agendamento novo (Ailson 08/06/2026): em vez de 6h, manda às 19:30
          // (catálogo recebido antes das 18h) ou 9h do dia seguinte (>= 18h).
          const sched = agendadoPara(conv.catalogo_enviado_em);
          if (agora < sched) {
            f1Resultados.push({ id: conv.id, motivo: 'aguardando_horario', agendado: sched.toISOString() });
            continue;
          }
          // Free text só sai dentro da janela de 24h. Se já passou, perde o envio
          // (a FASE 2 manda o HSM). Ailson 08/06/2026.
          if (agora.getTime() - new Date(conv.catalogo_enviado_em).getTime() > 24 * 60 * 60 * 1000) {
            f1Resultados.push({ id: conv.id, motivo: 'fora_da_janela_24h' });
            continue;
          }
          // Regra Ailson 30/05/2026: catálogo + 6h + 24h = 3 toques legítimos.
          // Jamais a 4a sem resposta (>= 3 sem resposta -> nao envia mais).
          if (await contarSofiaSemResposta(conv.id) >= 3) {
            f1Resultados.push({ id: conv.id, motivo: '3_sem_resposta' });
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

          if (conv.catalogo_formato === 'vesti') {
            // VESTI 6h (Ailson 04/06/2026): a cliente recebeu o LINK. No follow-up
            // de 6h a Sofia pergunta se ela conseguiu abrir e manda o PDF tambem,
            // caso prefira ver por aqui. 1 toque = 2 mensagens (texto + PDF).
            const brutoV = (conv.nome_cliente || '').split(' ')[0].trim();
            const primeiroNome = brutoV ? brutoV.charAt(0).toUpperCase() + brutoV.slice(1).toLowerCase() : ''; // title case (Ailson 11/06/2026)
            const tplVesti = await getConfig('vesti_followup_6h',
              'Oii {nome} 😊 vc conseguiu abrir o link do catálogo?? Tô te encaminhando o catálogo em PDF também, caso vc prefira ver por aqui');
            const texto = primeiroNome
              ? tplVesti.replace('{nome}', primeiroNome)
              : tplVesti.replace('Oii {nome} 😊', 'Oii 😊').replace('{nome}', '');
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
            // Manda o PDF como alternativa (se houver catalogo ativo)
            if (catAtivo) {
              const rm = await enviarMidiaSofia({
                telefone: conv.telefone,
                midia: catAtivo,
                conversaId: conv.id,
                mensagemId: null,
                decididaPor: 'ia_automatica',
              });
              if (rm.ok) {
                const pub = supabase.storage.from('sofia-midias').getPublicUrl(catAtivo.storage_path);
                await supabase.from('lojas_whats_mensagens').insert({
                  conversa_id: conv.id,
                  direcao: 'saida',
                  autor: 'assistente',
                  tipo_midia: 'document',
                  texto: null,
                  midia_url: pub?.data?.publicUrl || null,
                  meta_message_id: rm.message_id || null,
                  status: 'enviando',
                  enviada_em: agora.toISOString(),
                });
              } else {
                log('cron-catalogo/6h', `conv=${conv.id} PDF vesti falhou: ${rm.erro}`);
              }
            }
            f1Resultados.push({ id: conv.id, tel: conv.telefone, ok: true, vesti: true });
            log('cron-catalogo/6h', `conv=${conv.id} VESTI 6h (pergunta + PDF) enviado`);
          } else {
            const texto = MSG_CATALOGO_FOLLOWUP;
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
          }
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
      .not('catalogo_enviado_em', 'is', null)
      .lt('catalogo_enviado_em', cutoff24h)
      .eq('catalogo_followup_pausado', false)
      .eq('catalogo_auto_bloqueado', false)
      .in('etapa', ['conversando', 'quente']);
    if (errF2) throw errF2;

    const venceEm1d = new Date(Date.now() + 86400000).toISOString();
    const f2Resultados = [];

    if (!dentroJanela9_20 && (f2 || []).length > 0) {
      log('cron-catalogo', `FASE 2 pulada — ${ehDomingo ? "domingo" : "hora BRT "+horaBRT+"h"} fora da janela (${f2.length} pendentes)`);
    } else {
      for (const conv of f2 || []) {
        try {
          // Regra Ailson 30/05/2026: catálogo + 6h + 24h = 3 toques legítimos.
          // Jamais a 4a sem resposta (>= 3 sem resposta -> nao envia mais).
          if (await contarSofiaSemResposta(conv.id) >= 3) {
            f2Resultados.push({ id: conv.id, motivo: '3_sem_resposta' });
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
            .not('catalogo_enviado_em', 'is', null)
            .select('id');
          if (!claimed?.length) {
            f2Resultados.push({ id: conv.id, motivo: 'ja_claimed' });
            continue;
          }

          const bruto24 = (conv.nome_cliente || 'cliente').split(' ')[0];
          const primeiroNome = bruto24.charAt(0).toUpperCase() + bruto24.slice(1).toLowerCase(); // title case (Ailson 11/06/2026)
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
