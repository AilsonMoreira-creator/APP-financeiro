// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-webhook.js — Webhook Meta WhatsApp Business
// ═══════════════════════════════════════════════════════════════════════════
// URL publica: https://app-financeiro-brown.vercel.app/api/lojas-whats-webhook
//
// GET:  Meta envia handshake quando registra a URL (verify_token)
// POST: Meta envia eventos:
//        - Mensagens recebidas dos clientes
//        - Status de mensagens enviadas (sent/delivered/read/failed)
//        - Mudancas em templates (aprovado/rejeitado)
//
// Validacoes:
//   - GET: compara hub.verify_token com env META_WA_VERIFY_TOKEN
//   - POST: valida HMAC-SHA256 do body usando META_WA_APP_SECRET
//
// Acoes do POST:
//   1. Persiste msg recebida em lojas_whats_mensagens
//   2. Atualiza status de msgs enviadas
//   3. Se cliente respondeu: avanca conversa pra 'conversando'
//   4. Logs detalhados pra debug
//
// NAO faz aqui (proximos passos):
//   - Gerar replica da IA (proximo endpoint lojas-whats-ia)
//   - Detectar gatilhos Quente (proximo endpoint lojas-whats-promover)
// ═══════════════════════════════════════════════════════════════════════════

import {
  supabase,
  setCors,
  log,
  logErro,
  normalizarTelefone,
  chaveTel,
  primeiroNome,
  getConfig
} from './_lojas-whats-helpers.js';
import {
  verifyWebhookHandshake,
  verifyWebhookSignature,
  marcarComoLida,
  obterUrlMidia,
  baixarMidia,
  enviarTexto,
  enviarTextoFracionado
} from './_lojas-whats-meta-client.js';
import { enviarPushSofia } from './_push-helpers.js';
import { enviarMidiaSofia } from './_lojas-whats-midia-sender.js';
import { transcreverAudio } from './lojas-whats-transcrever.js';
import { processarMensagemMeluni } from './_meluni-whats-inbound.js';

// IMPORTANT: precisamos do body CRU pra validar HMAC.
// Vercel/Next API por padrao parseia body. Desligamos isso aqui:
export const config = {
  api: {
    bodyParser: false
  }
};

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ─── GET: Handshake da Meta (verify_token) ────────────────────────────
  if (req.method === 'GET') {
    const { ok, challenge } = verifyWebhookHandshake(req.query);
    if (ok) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(challenge);
    }
    return res.status(403).send('verify_token mismatch');
  }

  // ─── POST: Eventos (mensagens recebidas, status, templates) ───────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (e) {
    logErro('webhook', e);
    return res.status(400).json({ error: 'cant_read_body' });
  }

  // Valida assinatura HMAC
  const signature = req.headers['x-hub-signature-256'];
  if (!verifyWebhookSignature(rawBody, signature)) {
    logErro('webhook', 'assinatura invalida — descartando');
    return res.status(401).json({ error: 'invalid_signature' });
  }

  // Parse JSON
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    logErro('webhook', 'JSON invalido: ' + e.message);
    return res.status(400).json({ error: 'invalid_json' });
  }

  log('webhook', `evento recebido: ${payload.object}`);

  // Responde 200 IMEDIATAMENTE (Meta exige).
  // Processamento real pode ser async, mas pra MVP fazemos inline mesmo.
  // Se demorar, o webhook fica timeoutando. Pro MVP ta ok.
  try {
    await processarEvento(payload);
  } catch (e) {
    logErro('webhook-processar', e);
    // Mesmo assim retorna 200 (senao Meta reenviar e podemos duplicar)
  }

  return res.status(200).json({ ok: true });
}

// ─── PROCESSAMENTO DE EVENTOS ─────────────────────────────────────────────

async function processarEvento(payload) {
  if (payload.object !== 'whatsapp_business_account') {
    log('webhook', `objeto desconhecido: ${payload.object}`);
    return;
  }
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      // Roteamento por número (mesma WABA, 2 linhas): a Lara (Meluni B2C) cai
      // no inbox do Meluni; a Sofia (B2B) segue o fluxo de sempre. Ailson 16/06.
      const phoneId = value.metadata?.phone_number_id || null;
      const ehLara = !!phoneId && phoneId === process.env.META_WA_PHONE_ID_LARA;

      // Mensagens recebidas dos clientes
      if (value.messages?.length) {
        for (const msg of value.messages) {
          if (ehLara) await processarMensagemMeluni(msg, value);
          else await processarMensagemRecebida(msg, value);
        }
      }

      // Status de mensagens enviadas (sent/delivered/read/failed) — por número.
      // A Lara terá tratamento próprio na S2; por ora ignora os status dela.
      if (value.statuses?.length && !ehLara) {
        for (const st of value.statuses) {
          await processarStatusMensagem(st);
        }
      }

      // Status de aprovacao de templates pela Meta (APPROVED/REJECTED/...)
      // Ailson 25/05/2026: antes nao tinha handler — banco ficava parado
      // em 'pendente_aprovacao' mesmo apos Meta aprovar. Tinha que UPDATE
      // manual. Agora sincroniza automatico via webhook.
      // (Template é no nível da WABA — vale pros dois números.)
      if (change.field === 'message_template_status_update' && value.event) {
        await processarStatusTemplate(value);
      }
    }
  }
}

// ─── STATUS DE TEMPLATE (aprovacao/rejeicao Meta) ─────────────────────────
async function processarStatusTemplate(value) {
  // Payload Meta:
  // {
  //   event: 'APPROVED' | 'REJECTED' | 'PENDING_DELETION' | 'FLAGGED' | 'PAUSED' | 'PENDING',
  //   message_template_id: 962474963078755,
  //   message_template_name: 'carrinho_abandonado_site_amicia',
  //   message_template_language: 'pt_BR',
  //   reason: 'NONE' | motivo de rejeicao
  // }
  const event = value.event;
  const name = value.message_template_name;
  const lang = value.message_template_language;

  log('template-status', `${name} (${lang}): ${event}${value.reason && value.reason !== 'NONE' ? ' — ' + value.reason : ''}`);

  // Mapeia event Meta -> status interno
  const statusMap = {
    APPROVED: 'aprovado',
    REJECTED: 'rejeitado',
    PENDING: 'pendente_aprovacao',
    PAUSED: 'pausado',
    PENDING_DELETION: 'aprovado',  // mantem aprovado, so marca delete
    FLAGGED: 'aprovado',           // mantem aprovado, mas flag pra revisar
    DISABLED: 'rejeitado',
  };
  const statusInterno = statusMap[event] || 'pendente_aprovacao';

  const { error } = await supabase
    .from('lojas_whats_templates')
    .update({
      status: statusInterno,
      atualizado_em: new Date().toISOString(),
    })
    .eq('name', name)
    .eq('language', lang);

  if (error) {
    logErro('template-status/update', error);
  }
}

// ─── MSG RECEBIDA ─────────────────────────────────────────────────────────

async function processarMensagemRecebida(msg, valueCtx) {
  const telefone = normalizarTelefone(msg.from);
  const profile = valueCtx.contacts?.[0]?.profile || {};
  const nomeCliente = profile.name || null;
  log('msg-in', `from=${telefone} type=${msg.type} id=${msg.id}`);

  // 1. Acha (ou cria) conversa pra esse telefone
  // Ailson 25/05/2026: passa referral + texto pra detectar origem (CTWA)
  const primeiraTextoMaybe = msg.type === 'text' ? msg.text?.body : null;
  const conversa = await acharOuCriarConversa(telefone, nomeCliente, {
    referral: msg.referral || null,
    primeiraTexto: primeiraTextoMaybe,
  });
  if (!conversa) {
    logErro('msg-in', `nao consegui criar conversa pra ${telefone}`);
    return;
  }

  // 2. Extrai texto/midia da mensagem
  const dadosMsg = extrairConteudo(msg);

  // Ailson 25/05/2026: se for midia (image/video/audio/document/sticker)
  // baixa da Meta e salva no Supabase Storage ANTES do INSERT, pra
  // midia_url ficar com URL publica permanente (nao o media_id temporario).
  let midiaUrlFinal = dadosMsg.midia_url;
  const TIPOS_BAIXAVEIS = ['image', 'video', 'audio', 'document', 'sticker'];
  if (TIPOS_BAIXAVEIS.includes(dadosMsg.tipo) && dadosMsg.midia_url) {
    const urlSalva = await baixarESalvarMidiaInbound(
      dadosMsg.midia_url, dadosMsg.mime, dadosMsg.filename || ''
    );
    if (urlSalva) midiaUrlFinal = urlSalva;
    // Se falhar, mantem o media_id (degrade gracefully, evita perder a msg)
  }

  // 3. Salva em lojas_whats_mensagens
  // Dedup via UNIQUE(meta_message_id): se Meta enviar retry, ignora silencioso.
  // Ailson 26/05/2026 (auditoria ponto 5).
  const { data: msgInserida, error: errMsg } = await supabase
    .from('lojas_whats_mensagens')
    .insert({
      conversa_id: conversa.id,
      direcao: 'entrada',
      autor: 'cliente',
      tipo_midia: dadosMsg.tipo,
      texto: dadosMsg.texto,
      midia_url: midiaUrlFinal,
      meta_message_id: msg.id,
      status: 'entregue',
      enviada_em: new Date(parseInt(msg.timestamp, 10) * 1000).toISOString()
    })
    .select('id')
    .maybeSingle();
  if (errMsg) {
    // Codigo 23505 = unique_violation. Eh retry da Meta — ignora.
    if (errMsg.code === '23505') {
      log('msg-in', `retry meta_message_id=${msg.id} ignorado (dedup)`);
      return;  // sai do handler, nao processa mais nada deste retry
    }
    logErro('msg-in-save', errMsg);
  }

  // Push pra usuarios inscritos na Sofia. Tag por conversa_id deduplica
  // notifs do mesmo cliente. silentIfOpen no payload → SW silencia se
  // app esta aberto (Ailson 27/05/2026: so toca se app fechado).
  // So dispara se msg eh recente (5 min) — protege contra retry/historico.
  const msgRecente = (Date.now() - parseInt(msg.timestamp, 10) * 1000) < 5 * 60 * 1000;
  if (msgInserida && msgRecente) {
    const nomeBonito = primeiroNome(conversa.nome_cliente) || 'Cliente';
    const previewTxt = dadosMsg.texto
      ? dadosMsg.texto.slice(0, 80)
      : (dadosMsg.tipo === 'image' ? '📷 imagem'
        : dadosMsg.tipo === 'audio' ? '🎤 audio'
        : dadosMsg.tipo === 'video' ? '🎥 video'
        : dadosMsg.tipo === 'document' ? '📎 documento'
        : '(anexo)');
    enviarPushSofia({
      titulo: `💬 Sofia · ${nomeBonito}`,
      mensagem: previewTxt,
      url: '/?modulo=sofia',
      tag: `sofia-conv-${conversa.id}`,
    }).catch(e => console.warn('[lojas-whats-webhook] push falhou:', e.message));
  }

  // ─── SLA DE PICO: cliente mandando lista de pecas = momento mais quente da
  // venda (analise vendas x near-miss 28/06: latencia nesse ponto e o killer nº1).
  // Detecta >=2 fotos seguidas (sem resposta da loja entre elas) OU texto "quero
  // essas/esses". Quando dispara: liga a estrela (lead_prioritario), carimba
  // pico_pedido_em (pra medir o gap ate a loja confirmar) e FURA A FILA com um
  // push distinto pra quem auxilia a Sofia. So fura 1x por pico (guarda 30min).
  if (msgInserida && msgRecente) {
    const txtPico = (dadosMsg.texto || '').toLowerCase();
    const pediuEssas = /quero\s+ess[ae]s?\b|vou\s+querer\s+ess|me\s+separa\s+ess|pode\s+separar\s+ess|fecha\s+ess/.test(txtPico);

    let burstFotos = false;
    if (dadosMsg.tipo === 'image') {
      const { data: ult } = await supabase
        .from('lojas_whats_mensagens')
        .select('direcao, tipo_midia')
        .eq('conversa_id', conversa.id)
        .order('enviada_em', { ascending: false })
        .limit(6);
      let seq = 0;
      for (const m of (ult || [])) {
        if (m.direcao === 'entrada' && m.tipo_midia === 'image') seq++;
        else break; // para na 1a saida da loja ou msg nao-imagem
      }
      burstFotos = seq >= 2;
    }

    if (pediuEssas || burstFotos) {
      const { data: cPico } = await supabase
        .from('lojas_whats_conversas')
        .select('pico_pedido_em, nome_cliente')
        .eq('id', conversa.id)
        .maybeSingle();
      const recemCarimbado = cPico?.pico_pedido_em
        ? (Date.now() - new Date(cPico.pico_pedido_em).getTime()) < 30 * 60 * 1000
        : false;
      if (!recemCarimbado) {
        const nm = primeiroNome(cPico?.nome_cliente || conversa.nome_cliente) || 'Cliente';
        await supabase
          .from('lojas_whats_conversas')
          .update({ lead_prioritario: true, pico_pedido_em: new Date().toISOString() })
          .eq('id', conversa.id);
        enviarPushSofia({
          titulo: `⭐ PEDIDO QUENTE · ${nm}`,
          mensagem: burstFotos
            ? 'Cliente mandando a lista de peças, confirmar cores e tamanhos JÁ'
            : 'Cliente quer fechar essas peças, confirmar disponibilidade JÁ',
          url: '/?modulo=sofia',
          tag: `sofia-pico-${conversa.id}`,
        }).catch(e => console.warn('[lojas-whats-webhook] push pico falhou:', e.message));
        // Auto-reply IMEDIATO: segura a cliente enquanto a equipe/IA confirma a
        // grade. Ganha tempo no momento mais quente. A IA depois emenda a
        // confirmacao itemizada (prompt manda NAO repetir essa linha).
        try {
          const ack = burstFotos
            ? 'Boa, vou confirmar cada uma pra vc 😊'
            : 'Boa, já confirmo essas pra vc 😊';
          const rAck = await enviarTexto(telefone, ack);
          await supabase.from('lojas_whats_mensagens').insert({
            conversa_id: conversa.id, direcao: 'saida', autor: 'sofia_ia',
            tipo_midia: 'text', texto: ack,
            meta_message_id: rAck?.messages?.[0]?.id || null,
            status: 'enviando', enviada_em: new Date().toISOString(),
          });
        } catch (e) { console.warn('[lojas-whats-webhook] ack pico falhou:', e.message); }
        log('pico', `conversa ${conversa.id} pick-list (fotos=${burstFotos} texto=${pediuEssas})`);
      }
    }
  }

  // STT automatico: se for audio, transcreve via Whisper IN-PROCESS.
  // Ailson 28/05/2026: antes chamava /api/lojas-whats-transcrever via fetch
  // HTTP (funcao Vercel -> funcao Vercel), que falhava silenciosamente (audio
  // baixava mas audio_transcricao ficava null) — Sofia recebia "[audio sem
  // transcricao]" e respondia off-topic. Agora chama a funcao direto, sem o
  // hop HTTP fragil. Awaited ANTES do disparo da IA (linha abaixo), entao a
  // transcricao ja esta salva quando a Sofia le o historico.
  if (msgInserida && dadosMsg.tipo === 'audio' && midiaUrlFinal?.startsWith('http')) {
    try {
      const tr = await transcreverAudio(msgInserida.id);
      if (!tr.ok) log('webhook/transcrever', `falha: ${tr.erro}`);
    } catch (e) {
      log('webhook/transcrever', `erro: ${e.message}`);
    }
  }

  // ─── 3.5 PESQUISA DE MOTIVO: clique em botao do template sofia_pesquisa_motivo
  // Se a conversa tem pesquisa enviada e ainda nao respondida, este clique e a
  // resposta. Grava o motivo, move pra aba 'pesquisa', trava catalogo automatico
  // e dispara a resposta scriptada (determinística, NAO IA). Desvia do fluxo
  // normal (nao seta responder_em, nao volta pra 'conversando'). Ailson 21/06/2026.
  if (dadosMsg.botao) {
    const { data: pq } = await supabase
      .from('lojas_whats_conversas')
      .select('pesquisa_enviada_em, pesquisa_respondida_em, nome_cliente')
      .eq('id', conversa.id)
      .maybeSingle();
    if (pq?.pesquisa_enviada_em && !pq?.pesquisa_respondida_em) {
      const motivo = motivoDoBotao(dadosMsg.botao_texto);
      const nomeFinal = pq.nome_cliente || nomeCliente;
      const agoraIso = new Date().toISOString();
      const rp = respostaPesquisaVariante(motivo, primeiroNome(nomeFinal));

      await supabase.from('lojas_whats_pesquisa_respostas').insert({
        conversa_id: conversa.id,
        telefone,
        nome: nomeFinal,
        template: 'sofia_pesquisa_motivo_v1',
        motivo,
        variante: rp?.variante || null,
        botao_texto: dadosMsg.botao_texto,
        respondido_em: agoraIso,
        raw: msg,
      });

      const updPq = {
        etapa: 'pesquisa',
        pesquisa_motivo: motivo,
        pesquisa_respondida_em: agoraIso,
        pesquisa_recontato_em: rp?.partes?.length ? agoraIso : null,
        catalogo_auto_bloqueado: true,   // trava catalogo auto + follow-up daqui pra frente
        auto_resposta_bloqueada: true,   // no recontato a Sofia gera resposta mas espera aprovacao
        // Zera unread: o clique no botao da pesquisa NAO conta como "conversa
        // aberta" (Ailson 22/06/2026 — Opcao A). A msg do botao ja bumpou
        // unread_count la em cima; aqui zeramos pra pesquisa/perdida nunca ficar
        // com badge vermelho de nao-lido. O card so vira nao-lido quando a
        // cliente responde com TEXTO (fluxo normal abaixo, fora deste branch).
        unread_count: 0,
        ultima_atividade_em: agoraIso,
        atualizado_em: agoraIso,
      };

      // Marca respondida + trava ANTES de enviar: se a Meta reentregar o webhook
      // durante os envios (texto + catalogo), o branch nao reprocessa. Ailson 23/06/2026.
      await supabase.from('lojas_whats_conversas').update(updPq).eq('id', conversa.id);

      // Resposta scriptada por motivo, em 2 mensagens (outros = sem resposta) +
      // catalogo amarrado ao motivo (deterministico, NAO depende da IA):
      //   preco -> catalogo de PROMOCAO ; quantidade de pecas -> catalogo ATUALIZADO/normal.
      if (rp?.partes?.length) {
        try {
          await enviarDuasPartes(telefone, conversa.id, rp.partes);
          if (motivo === 'preco') {
            await new Promise(r => setTimeout(r, 1800 + Math.floor(Math.random() * 1200)));
            await enviarCatalogoPesquisa(telefone, conversa.id, true);
          } else if (motivo === 'minimo_pecas') {
            await new Promise(r => setTimeout(r, 1800 + Math.floor(Math.random() * 1200)));
            await enviarCatalogoPesquisa(telefone, conversa.id, false);
          }
        } catch (e) {
          logErro('pesquisa-resposta', e);
        }
      }

      await marcarComoLida(msg.id);

      enviarPushSofia({
        titulo: `📋 Pesquisa · ${primeiroNome(nomeFinal) || 'Cliente'}`,
        mensagem: `Motivo: ${dadosMsg.botao_texto}`,
        url: '/?modulo=sofia',
        tag: `sofia-conv-${conversa.id}`,
      }).catch(e => console.warn('[lojas-whats-webhook] push pesquisa falhou:', e.message));

      log('pesquisa', `conversa ${conversa.id} respondeu motivo=${motivo} (${dadosMsg.botao_texto})`);
      return; // bypassa fluxo normal de inbound
    }
  }

  // ─── 3.6 PESQUISA DE FOLLOW-UP: se a conversa recebeu a pesquisa de follow-up
  // (sofia_followup_motivo) e ainda nao respondeu, QUALQUER resposta (botao ou
  // texto) marca como respondida e corta o follow-up de catalogo
  // (catalogo_auto_bloqueado=true, mesma regra das perdidas). NAO desvia: o
  // fluxo normal logo abaixo ja volta a conversa de 'follow_up' pra
  // 'conversando' e a Sofia retoma o atendimento. Colunas proprias
  // (followup_pesq_*) — nao colide com a pesquisa de perdidas. Ailson 28/06/2026.
  {
    const { data: fu } = await supabase
      .from('lojas_whats_conversas')
      .select('followup_pesq_enviada_em, followup_pesq_respondida_em')
      .eq('id', conversa.id)
      .maybeSingle();
    if (fu?.followup_pesq_enviada_em && !fu?.followup_pesq_respondida_em) {
      const fuAgora = new Date().toISOString();
      await supabase.from('lojas_whats_conversas').update({
        followup_pesq_respondida_em: fuAgora,
        followup_pesq_motivo: dadosMsg.botao ? (dadosMsg.botao_texto || null) : null,
        catalogo_auto_bloqueado: true,   // nao recebe mais follow-up de catalogo
      }).eq('id', conversa.id);
      log('followup-pesquisa', `conversa ${conversa.id} respondeu (${dadosMsg.botao ? dadosMsg.botao_texto : 'texto'})`);
    }
  }

  // 4. Avanca etapa quando cliente responde
  const updates = {
    ultima_atividade_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString(),
    // Incrementa contador de msgs nao vistas (badge vermelho na UI).
    // Vendedora zera ao abrir conversa via /api/lojas-whats-conversa-vista.
    unread_count: (conversa.unread_count || 0) + 1,
    // Cliente respondeu → reseta timer de oferta varejo (cron nao move)
    oferta_varejo_em: null,
    // Cliente respondeu → reseta timers de catalogo (cron-catalogo nao
    // dispara msg de 6h nem move pra follow_up de 1d)
    catalogo_enviado_em: null,
    catalogo_followup_6h_em: null,
    // Debounce de resposta da Sofia: empurra responder_em pra now()+60s a CADA
    // inbound. Se o cliente manda em rajada, cada msg adia +60s e o cron agrupa
    // (responde 1x depois que ele para de digitar). Quem gera eh o cron
    // lojas-whats-cron-responder (1/min), NAO inline — serverless mata o
    // fire-and-forget e responder inline ignoraria o debounce. Ailson 29/05/2026.
    responder_em: new Date(Date.now() + 60 * 1000).toISOString(),
  };
  // Etapas terminais/intermediarias voltam pra 'conversando' quando cliente
  // manda msg nova (Ailson 27/05/2026 — cliente em qualquer aba pode voltar
  // a interagir). Excecoes que PERMANECEM: 'conversando', 'quente',
  // 'processando', 'aprovar' (ja sao ativos/em transito) e 'vendeu' (Ailson
  // 06/06: venda fica fixa na aba pro remarketing; a msg nova so faz o card
  // subir na lista + badge unread, e a assistente move manual pra conversando
  // se quiser. O cron-responder ja nao responde 'vendeu', entao a Sofia nao
  // fala sozinha aqui).
  const ETAPAS_QUE_VOLTAM = ['enviada', 'follow_up', 'atendida', 'perdida', 'varejo', 'pesquisa'];
  if (ETAPAS_QUE_VOLTAM.includes(conversa.etapa)) {
    updates.etapa = 'conversando';
    updates.cliente_respondeu_em = new Date().toISOString();
    // Se estava em follow_up, limpa contexto do follow_up tambem
    if (conversa.etapa === 'follow_up') {
      updates.follow_up_tag = null;
      updates.follow_up_vence_em = null;
      updates.follow_up_entrou_em = null;
      updates.follow_up_origem = null;
      updates.follow_up_motivo = null;
      // follow_up_tentativas NAO reseta — historico preservado
    }
    log('msg-in', `conversa ${conversa.id} retornou: ${conversa.etapa} -> conversando`);
  }
  await supabase
    .from('lojas_whats_conversas')
    .update(updates)
    .eq('id', conversa.id);

  // 5. Marca como lida no WhatsApp (boa pratica — mostra checkmark azul)
  await marcarComoLida(msg.id);

  // 6. Resposta da Sofia: NAO gera inline. O bloco de updates acima ja setou
  //    responder_em = now()+60s. O cron lojas-whats-cron-responder (1/min) pega
  //    e gera a sugestao via processarConversa. Antes era fire-and-forget pra
  //    /api/lojas-whats-ia, mas o serverless encerra a function depois do 200
  //    pro WhatsApp e matava o fetch em voo (resposta saia atrasada ou nunca).
  //    Ailson 29/05/2026.
}

// ─── PESQUISA DE MOTIVO: mapeamento botao -> motivo + respostas scriptadas ──

function motivoDoBotao(txt) {
  const t = (txt || '').toLowerCase();
  if (t.includes('12') || t.includes('peç') || t.includes('pec')) return 'minimo_pecas';
  if (t.includes('preç') || t.includes('prec') || t.includes('valor')) return 'preco';
  if (t.includes('variedade')) return 'variedade';
  return 'outros';
}

function respostaPesquisaVariante(motivo, primeiro) {
  const ola = primeiro ? `${primeiro}, ` : '';
  const variantes = {
    minimo_pecas: [
      ['A', [
        `${ola}que bom que vc respondeu! Como recebemos bastante retorno sobre quantidade de peças, essa semana a gente liberou o mínimo de 6 peças.`,
        `Mudou bastante coisa desde a última vez que vc deu uma olhada. Vou te mandar aqui o catálogo atualizado pra vc ver as novidades.`,
      ]],
      ['B', [
        `${ola}fico feliz que vc respondeu! Sobre o número de peças, ouvimos bastante isso, então essa semana liberamos um mínimo de 6 peças pra começar mais leve.`,
        `Desde a última vez que vc viu por aqui entrou bastante novidade. Te mando aqui o catálogo atualizado pra vc conferir.`,
      ]],
    ],
    preco: [
      ['A', [
        `${ola}que bom que vc respondeu! Sobre o valor, tô com uma condição de 30% de desconto rodando agora.`,
        `É uma boa pra vc conhecer os modelos da Amícia com um custo menor, ver a qualidade e como vende bem. Vou te mandar aqui o catálogo da promoção pra vc dar uma olhada.`,
      ]],
      ['B', [
        `${ola}obrigada por responder! Sobre preço, a gente tá com 30% de desconto agora, então dá pra entrar com um valor bem melhor.`,
        `Bom momento pra testar os modelos da Amícia, ver a qualidade de perto e como giram na sua loja. Te mando aqui o catálogo com a promoção.`,
      ]],
    ],
    variedade: [
      ['A', [
        `${ola}que bom que vc respondeu! Sobre variedade, quero te ajudar a acertar no que vende.`,
        `Me conta: qual tipo de modelo tem mais saída na sua loja? Com base no que gira bem aí, eu monto um pedido junto com vc.`,
      ]],
      ['B', [
        `${ola}obrigada por responder! Dá pra montar bem direcionado pro seu público.`,
        `Qual estilo costuma sair mais na sua loja? Me fala que eu seleciono uma grade em cima do que vende bem aí, junto com vc.`,
      ]],
    ],
  };
  const lista = variantes[motivo];
  if (!lista) return null; // outros: sem resposta por enquanto
  const escolha = lista[Math.floor(Math.random() * lista.length)];
  return { variante: escolha[0], partes: escolha[1] };
}

// Envia a resposta da pesquisa em 2 mensagens (mais humano), com delay entre
// elas, e registra AS DUAS em lojas_whats_mensagens (o enviarTextoFracionado
// nao loga a 1a parte). Ailson 21/06/2026.
async function enviarDuasPartes(telefone, conversaId, partes) {
  for (let i = 0; i < partes.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1800 + Math.floor(Math.random() * 1700)));
    let metaId = null;
    try {
      const r = await enviarTexto(telefone, partes[i]);
      metaId = r?.messages?.[0]?.id || null;
    } catch (e) {
      logErro('pesquisa-parte', e);
      continue;
    }
    await supabase.from('lojas_whats_mensagens').insert({
      conversa_id: conversaId, direcao: 'saida', autor: 'sofia_ia', tipo_midia: 'text',
      texto: partes[i], meta_message_id: metaId, status: 'enviando',
      enviada_em: new Date().toISOString(),
    });
  }
}

// Catalogo amarrado ao motivo da pesquisa (deterministico, NAO depende da IA).
// querPromo=true  -> catalogo de PROMOCAO (promocao=true)
// querPromo=false -> catalogo geral/ATUALIZADO mais recente (promocao=false)
// Ailson 23/06/2026.
async function enviarCatalogoPesquisa(telefone, conversaId, querPromo) {
  try {
    const { data: cat } = await supabase
      .from('lojas_whats_midias')
      .select('id, tipo, ref, nome_arquivo, storage_path, mime_type, size_bytes, descricao')
      .eq('tipo', 'catalogo').eq('ativa', true).eq('promocao', !!querPromo)
      .order('criada_em', { ascending: false }).limit(1).maybeSingle();
    if (!cat) { log('pesquisa', `catalogo (promocao=${!!querPromo}) nao encontrado`); return; }
    const r = await enviarMidiaSofia({ telefone, midia: cat, conversaId, mensagemId: null, decididaPor: 'pesquisa' });
    if (!r?.ok) log('pesquisa', `catalogo pesquisa erro: ${r?.erro || 'desconhecido'}`);
  } catch (e) {
    logErro('pesquisa-catalogo', e);
  }
}

function extrairConteudo(msg) {
  switch (msg.type) {
    case 'text':
      return { tipo: 'text', texto: msg.text?.body || '', midia_url: null, mime: null };
    case 'image':
      return { tipo: 'image', texto: msg.image?.caption || null, midia_url: msg.image?.id, mime: msg.image?.mime_type || 'image/jpeg' };
    case 'audio':
      return { tipo: 'audio', texto: null, midia_url: msg.audio?.id, mime: msg.audio?.mime_type || 'audio/ogg' };
    case 'video':
      return { tipo: 'video', texto: msg.video?.caption || null, midia_url: msg.video?.id, mime: msg.video?.mime_type || 'video/mp4' };
    case 'document':
      return { tipo: 'document', texto: msg.document?.caption || null, midia_url: msg.document?.id, mime: msg.document?.mime_type || 'application/pdf', filename: msg.document?.filename };
    case 'sticker':
      return { tipo: 'sticker', texto: null, midia_url: msg.sticker?.id, mime: msg.sticker?.mime_type || 'image/webp' };
    case 'location':
      return { tipo: 'text', texto: `[localizacao: ${msg.location?.latitude}, ${msg.location?.longitude}]`, midia_url: null, mime: null };
    case 'reaction': {
      // Cliente reagiu a uma msg com emoji (ou removeu). Antes caia no default
      // e virava "[tipo nao suportado: reaction]". Ailson 29/05/2026.
      const emo = msg.reaction?.emoji;
      return { tipo: 'text', texto: emo ? `[reagiu com ${emo}]` : '[removeu a reação]', midia_url: null, mime: null };
    }
    case 'button': {
      // Clique em botao de TEMPLATE (quick reply). Vem em msg.button.{text,payload}.
      // Antes caia no default e virava "[tipo nao suportado: button]". Ailson 21/06/2026.
      const bt = msg.button?.text || msg.button?.payload || '';
      return { tipo: 'text', texto: bt, midia_url: null, mime: null, botao: true, botao_texto: bt };
    }
    case 'interactive': {
      // Botoes/listas interativas (nao-template): button_reply.title / list_reply.title.
      const ir = msg.interactive || {};
      const t = ir.button_reply?.title || ir.list_reply?.title || ir.nfm_reply?.name || '';
      return { tipo: 'text', texto: t, midia_url: null, mime: null, botao: true, botao_texto: t };
    }
    default:
      // Meta classifica como 'unsupported' arquivos que a Cloud API não consegue
      // processar (vCards, stickers animados de origem desconhecida, etc).
      // O motivo costuma vir em msg.errors[]. Capturamos pra Tamara entender.
      const errMeta = Array.isArray(msg.errors) && msg.errors[0]
        ? `${msg.errors[0].title || msg.errors[0].message || ''} (code ${msg.errors[0].code || '?'})`
        : 'sem detalhes';
      return {
        tipo: msg.type,
        texto: `[tipo nao suportado: ${msg.type}] ${errMeta}`,
        midia_url: null,
        mime: null,
      };
  }
}

// Ailson 25/05/2026: cliente envia foto/video/audio/doc -> Meta nos da
// um media_id (temporario, validade ~5min). Pra mostrar no app a gente
// precisa baixar e salvar no nosso Supabase Storage, gerar URL publica
// permanente. Caso contrario o frontend so tem o ID e nao consegue exibir.
async function baixarESalvarMidiaInbound(mediaId, mime, sufixoNome = '') {
  try {
    const meta = await obterUrlMidia(mediaId);
    if (!meta?.url) {
      logErro('webhook/midia-inbound', new Error(`obterUrlMidia retornou sem url: ${JSON.stringify(meta).slice(0,150)}`));
      return null;
    }
    const buf = await baixarMidia(meta.url);
    // Mime do WhatsApp pode vir com parametros (ex: 'audio/ogg; codecs=opus').
    // Supabase Storage so aceita mime "puro" (sem ;codecs=...) na lista de
    // allowed_mime_types — strip qq coisa apos ;.
    const mimePuro = (mime || '').split(';')[0].trim();
    const ext = mimePuro.split('/').pop() || 'bin';
    const safeSufixo = (sufixoNome || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
    const fileName = `${Date.now()}_${mediaId}${safeSufixo ? '_' + safeSufixo : ''}.${ext}`;
    const path = `inbound/${fileName}`;
    const { error: errUp } = await supabase.storage
      .from('sofia-midias')
      .upload(path, buf, { contentType: mimePuro, upsert: false });
    if (errUp) {
      logErro('webhook/midia-inbound-upload', errUp);
      return null;
    }
    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(path);
    log('midia-inbound', `salva ${mediaId} -> ${path}, ${buf.length} bytes (mime=${mimePuro})`);
    return pub?.publicUrl || null;
  } catch (e) {
    logErro('webhook/midia-inbound', e);
    return null;
  }
}

// ─── STATUS DE MSG ENVIADA ────────────────────────────────────────────────

async function processarStatusMensagem(status) {
  const id = status.id;
  const novoStatus = status.status; // sent | delivered | read | failed
  log('status', `meta_id=${id} status=${novoStatus}`);

  const updates = { status: novoStatus };
  if (novoStatus === 'delivered') updates.entregue_em = new Date(parseInt(status.timestamp, 10) * 1000).toISOString();
  if (novoStatus === 'read') updates.lida_em = new Date(parseInt(status.timestamp, 10) * 1000).toISOString();
  if (novoStatus === 'failed') {
    updates.erro = status.errors?.[0]?.message || 'falhou (sem detalhe)';
  }

  const { error } = await supabase
    .from('lojas_whats_mensagens')
    .update(updates)
    .eq('meta_message_id', id);
  if (error) logErro('status-update', error);
}

// ─── CONVERSAS: acha ou cria ──────────────────────────────────────────────

/**
 * Acha conversa ativa pra esse telefone, ou cria nova.
 * "Ativa" = qualquer etapa que nao seja 'perdida' ou 'vendeu' antiga.
 * MVP: pega a mais recente nao perdida. Se nao tem, cria nova em 'conversando'
 * (mensagem do cliente chegando sem conversa pre-existente = inbound espontaneo).
 *
 * Ailson 25/05/2026 - Sprint Attribution: agora recebe refInfo opcional
 * com { referral, primeiraTexto } pra detectar origem do lead.
 * Referral vem do payload Meta quando lead clica em CTA de anuncio (CTWA).
 * Texto da 1a msg eh fallback (frase CTA padrao "Gostaria de informacoes
 * pra comprar no Atacado").
 */

// Frases CTA do anuncio Instagram (Ailson definiu: "Gostaria de
// informacoes pra comprar no Atacado"). Regex flexivel pra suportar
// variacoes que cliente possa digitar/editar.
const REGEX_CTA_INSTAGRAM = /\b(gostaria|quero|tenho\s+interesse|preciso)[\s\S]{0,60}\b(informa\w*|comprar|saber|valor|preco)[\s\S]{0,40}\batacado\b/i;
const REGEX_ATACADO_PURO = /\b(comprar|comprar\s+no|info\w*\s+(do|sobre)|valores?\s+(do|de))\s+atacado\b/i;

// Frases dos links manuais que Ailson cola no Instagram (Stories + Linktree).
// Ailson 28/05/2026 — Sprint Instagram Organico (Rotina C).
// Stories: "Olá!! Vi vcs no insta e preciso de informação para comprar no atacado!!"
// Linktree: "Olá!! Gostaria de informações pra comprar no atacado!!"
const REGEX_INSTA_STORIES = /\bvi\s+v(?:cs|oc[êe]s?)\s+no\s+insta\b/i;
// Linktree usa frase quase identica ao CTA do anuncio; so consegue distinguir
// pela AUSENCIA de referral (=ad). Por isso o check vem antes do REGEX_CTA_INSTAGRAM
// e so rola se nao tinha referral=ad.
const REGEX_INSTA_LINKTREE = /\bgostaria\s+de\s+informa\S*\s+pr[ao]\s+comprar\s+no\s+atacado\b/i;

// LINKTREE V2 (Ailson 01/06/2026) — frase nova, ASSINATURA UNICA e inequivoca:
// "Olá! Vim pelo link e quero conhecer o atacado da Amícia". So quem clica no
// botao do Linktree manda exatamente isso (prefill do wa.me). Casa "vim pelo
// link ... atacado". Substitui a frase generica antiga (REGEX_INSTA_LINKTREE),
// que era ambigua. A antiga FICA durante a transicao (leads que ja mandaram a
// frase velha) e sai depois de uns dias.
const REGEX_INSTA_LINKTREE_V2 = /vim\s+pelo\s+link[\s\S]{0,40}atacado/i;

// Mensagem pronta do anuncio CTWA (Campanha 03): "Quero comprar no ATACADO
// (nao apague esta mensagem)". O trecho "nao apague esta mensagem" so existe
// nessa msg pronta — fingerprint perfeito do anuncio. Backup de atribuicao
// pros casos raros em que o referral=ad nao vem no payload. Ailson 29/05/2026.
const REGEX_AD_PRONTA = /n[ãa]o\s+apague\s+esta\s+mensagem/i;

// Frase prefill da campanha do FACEBOOK (Ailson 30/05/2026):
// "Olá! Tenho interesse e queria mais informações pra comprar Atacado".
// Distingue anuncio do FACEBOOK do anuncio do INSTAGRAM entre os leads CTWA
// (so aplica quando ja tem referral=ad — sem referral nao e anuncio).
const REGEX_AD_FACEBOOK = /tenho\s+interesse\s+e\s+queria\s+mais\s+informa\w*[\s\S]{0,20}atacado/i;

// SAC do site Amícia (Ailson 14/06/2026): botão de atendimento do site usa o
// prefill "Olá!! vim do site Amícia / Preciso tirar uma dúvida". Assinatura
// única "vim do site" — nenhuma outra origem usa essa frase. Não tem referral
// (não é anúncio), então a detecção é por texto, igual stories/linktree.
const REGEX_SAC_SITE = /\bvim\s+do\s+site\b/i;

function detectarOrigemLead(refInfo) {
  if (!refInfo) return { origem: 'desconhecida', confianca: 0, meta: {} };

  // 1. PRIMARY — referral.source_type='ad' do payload Meta (CTWA)
  //    Vem direto da Meta, robusto contra cliente editar mensagem.
  //    Distingue FACEBOOK x INSTAGRAM pela frase prefill da campanha:
  //    a do Facebook usa "tenho interesse e queria mais informações...".
  if (refInfo.referral?.source_type === 'ad') {
    const ehFacebook = refInfo.primeiraTexto && REGEX_AD_FACEBOOK.test(refInfo.primeiraTexto);
    return {
      origem: ehFacebook ? 'anuncio_facebook' : 'anuncio_instagram',
      confianca: 1.0,
      meta: {
        ctwa_clid: refInfo.referral.ctwa_clid || null,
        ad_source_id: refInfo.referral.source_id || null,
        ad_headline: refInfo.referral.headline || null,
        ref_data: refInfo.referral,
      }
    };
  }

  // 1B. BACKUP DE ATRIBUICAO — fingerprint da msg pronta do anuncio.
  //     Cobre o caso raro de referral=ad nao chegar no payload mas o cliente
  //     ter mantido a msg pronta ("nao apague esta mensagem"). Ailson 29/05/2026.
  if (refInfo.primeiraTexto && REGEX_AD_PRONTA.test(refInfo.primeiraTexto)) {
    return { origem: 'anuncio_instagram', confianca: 0.85, meta: { via: 'msg_pronta_texto' } };
  }

  // 1C. BACKUP FACEBOOK — frase prefill da campanha do Facebook sem referral
  //     no payload. Checa ANTES do bloco linktree (a frase tambem casa o CTA
  //     generico, que mandaria pra linktree). Ailson 30/05/2026.
  if (refInfo.primeiraTexto && REGEX_AD_FACEBOOK.test(refInfo.primeiraTexto)) {
    return { origem: 'anuncio_facebook', confianca: 0.85, meta: { via: 'frase_fb_fallback' } };
  }

  // 2. INSTAGRAM ORGANICO — links manuais (stories/linktree). Checa ANTES do
  //    CTA generico pq a frase do linktree e identica ao CTA do anuncio
  //    (so distingue por nao ter referral=ad — ja descartado no passo 1).
  if (refInfo.primeiraTexto) {
    // SAC do site Amícia — assinatura única "vim do site". Checa antes de tudo.
    // Não recebe a abertura de captação (não está em ORIGENS_TESTE_APRESENTACAO):
    // cai direto na dúvida do cliente. Ailson 14/06/2026.
    if (REGEX_SAC_SITE.test(refInfo.primeiraTexto)) {
      return { origem: 'sac', confianca: 0.95, meta: { via: 'site_amicia' } };
    }
    if (REGEX_INSTA_STORIES.test(refInfo.primeiraTexto)) {
      return { origem: 'instagram_stories', confianca: 0.95, meta: {} };
    }
    // V2 — assinatura unica nova do Linktree (alta confianca). Ailson 01/06/2026.
    if (REGEX_INSTA_LINKTREE_V2.test(refInfo.primeiraTexto)) {
      return { origem: 'instagram_linktree', confianca: 0.95, meta: { via: 'linktree_v2' } };
    }
    if (REGEX_INSTA_LINKTREE.test(refInfo.primeiraTexto)) {
      return { origem: 'instagram_linktree', confianca: 0.9, meta: {} };
    }

    // 3. SECONDARY — texto bate com frase CTA generica de atacado, mas SEM referral=ad.
    //    Anuncio real SEMPRE traz referral (passo 1); sem ele, NAO e anuncio.
    //    A frase generica e a mesma do link organico (linktree/insta), entao
    //    trata como instagram_linktree — nunca anuncio. Ailson 29/05/2026.
    if (REGEX_CTA_INSTAGRAM.test(refInfo.primeiraTexto) || REGEX_ATACADO_PURO.test(refInfo.primeiraTexto)) {
      return { origem: 'instagram_linktree', confianca: 0.6, meta: {} };
    }
  }

  // 4. FALLBACK — origem desconhecida (admin pode reclassificar via UI)
  return { origem: 'desconhecida', confianca: 0, meta: {} };
}

async function acharOuCriarConversa(telefone, nomeCliente, refInfo) {
  if (!telefone) return null;
  // Busca a conversa mais recente do telefone — INCLUSIVE perdida. Antes
  // excluia perdida (.not etapa in perdida), entao um cliente perdido que
  // mandava msg gerava uma CONVERSA NOVA e o historico ficava partido em dois
  // cards (parecia "mensagem sumindo"). Agora reativa o MESMO card: a msg cai
  // na thread existente e o handler principal move perdida->conversando.
  // Mensagens nunca sao apagadas; a thread fica continua. Ailson 01/06/2026.
  // Match tolerante ao 9o digito: o wa_id da Meta as vezes vem COM o 9, as
  // vezes SEM (ex: 5531998331534 vs 553198331534) e o .eq exato criava conversa
  // DUPLICADA (o historico ficava partido em dois cards). Agora casa por sufixo
  // de 8 digitos + confirma a chave canonica (chaveTel). Pega a mais recente.
  // Ailson 22/06/2026.
  const suf8 = String(telefone).replace(/\D/g, '').slice(-8);
  const chaveAlvo = chaveTel(telefone);
  const { data: cands } = await supabase
    .from('lojas_whats_conversas')
    .select('*')
    .ilike('telefone', `%${suf8}`)
    .order('iniciada_em', { ascending: false })
    .limit(10);
  const existente = (cands || []).find(c => chaveTel(c.telefone) === chaveAlvo) || null;
  if (existente) {
    // Se existente nao tinha ctwa_clid e agora veio um, atualiza
    // (cliente pode ter voltado pelo anuncio depois de uma conversa antiga)
    if (refInfo?.referral?.source_type === 'ad' && !existente.ctwa_clid) {
      const det = detectarOrigemLead(refInfo);
      await supabase.from('lojas_whats_conversas').update({
        ctwa_clid: det.meta.ctwa_clid,
        meta_ad_source_id: det.meta.ad_source_id,
        meta_ad_headline: det.meta.ad_headline,
        meta_referral_data: det.meta.ref_data,
        // Nao sobrescreve origem se ja tinha — historico preservado
      }).eq('id', existente.id);
      log('conversa', `existente=${existente.id} ganhou ctwa_clid de nova click`);
    }
    return existente;
  }

  // Detecta origem do lead novo
  const origem = detectarOrigemLead(refInfo);
  log('conversa', `nova conversa inbound: tel=${telefone} origem=${origem.origem} conf=${origem.confianca}`);

  // Teste A/B da ABERTURA (Ailson 11/06/2026): nas origens de lead
  // (stories/linktree/ads), TODA conversa nova entra no teste:
  //   'video'       → vídeo da Tamara como 1ª resposta (definido 10/06)
  //   'texto_fotos' → texto curto do atacado + fotos ref='abertura'
  // Config apresentacao_teste_pct = % que recebe o VÍDEO (default 50).
  // Sticky: decidido 1x aqui. Vesti DESLIGADO (catalogo sempre pdf).
  const ORIGENS_TESTE_APRESENTACAO = ['instagram_stories', 'instagram_linktree', 'anuncio_facebook', 'anuncio_instagram'];
  let apresentacaoGrupo = false;
  let apresentacaoVariante = null;
  if (ORIGENS_TESTE_APRESENTACAO.includes(origem.origem)) {
    apresentacaoGrupo = true;
    const pct = Number(await getConfig('apresentacao_teste_pct', 50)) || 0;
    apresentacaoVariante = Math.random() * 100 < pct ? 'video' : 'texto_fotos';
  }
  const catalogoFormato = 'pdf';

  const { data: nova, error } = await supabase
    .from('lojas_whats_conversas')
    .insert({
      telefone,
      nome_cliente: nomeCliente,
      etapa: 'conversando',
      iniciada_em: new Date().toISOString(),
      cliente_respondeu_em: new Date().toISOString(),
      ultima_atividade_em: new Date().toISOString(),
      origem_lead: origem.origem,
      origem_lead_confianca: origem.confianca,
      catalogo_formato: catalogoFormato,
      apresentacao_grupo: apresentacaoGrupo,
      apresentacao_variante: apresentacaoVariante,
      ctwa_clid: origem.meta.ctwa_clid || null,
      meta_ad_source_id: origem.meta.ad_source_id || null,
      meta_ad_headline: origem.meta.ad_headline || null,
      meta_referral_data: origem.meta.ref_data || null,
    })
    .select('*')
    .single();
  if (error) {
    logErro('conversa-criar', error);
    return null;
  }
  return nova;
}
