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
  primeiroNome
} from './_lojas-whats-helpers.js';
import {
  verifyWebhookHandshake,
  verifyWebhookSignature,
  marcarComoLida,
  obterUrlMidia,
  baixarMidia
} from './_lojas-whats-meta-client.js';
import { enviarPushSofia } from './_push-helpers.js';

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

      // Mensagens recebidas dos clientes
      if (value.messages?.length) {
        for (const msg of value.messages) {
          await processarMensagemRecebida(msg, value);
        }
      }

      // Status de mensagens enviadas (sent/delivered/read/failed)
      if (value.statuses?.length) {
        for (const st of value.statuses) {
          await processarStatusMensagem(st);
        }
      }

      // Status de aprovacao de templates pela Meta (APPROVED/REJECTED/...)
      // Ailson 25/05/2026: antes nao tinha handler — banco ficava parado
      // em 'pendente_aprovacao' mesmo apos Meta aprovar. Tinha que UPDATE
      // manual. Agora sincroniza automatico via webhook.
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

  // STT automatico: se for audio, dispara transcricao via Whisper em
  // background (fire-and-forget). Endpoint /api/lojas-whats-transcrever
  // baixa audio do Storage, manda pra OpenAI Whisper, salva resultado
  // em lojas_whats_mensagens.audio_transcricao. Sofia IA ja consome essa
  // coluna automaticamente quando vai gerar proxima sugestao.
  // Nao await — Meta espera resposta rapida do webhook.
  if (msgInserida && dadosMsg.tipo === 'audio' && midiaUrlFinal?.startsWith('http')) {
    const host = req.headers?.host || process.env.VERCEL_URL;
    const proto = host?.includes('localhost') ? 'http' : 'https';
    const url = `${proto}://${host}/api/lojas-whats-transcrever`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mensagem_id: msgInserida.id }),
    }).catch(e => console.warn('[lojas-whats-webhook] disparo transcrever falhou:', e.message));
  }

  // 4. Avanca etapa quando cliente responde
  const updates = {
    ultima_atividade_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString()
  };
  if (conversa.etapa === 'enviada') {
    updates.etapa = 'conversando';
    updates.cliente_respondeu_em = new Date().toISOString();
    log('msg-in', `conversa ${conversa.id} avancou: enviada -> conversando`);
  } else if (conversa.etapa === 'follow_up') {
    // Sprint B Sofia Follow-up (Ailson 25/05/2026): cliente respondeu em FUp
    // -> volta pra conversando + limpa tag/contadores. Sofia pode marcar
    // de novo depois se cliente esfriar de novo.
    updates.etapa = 'conversando';
    updates.cliente_respondeu_em = new Date().toISOString();
    updates.follow_up_tag = null;
    updates.follow_up_vence_em = null;
    updates.follow_up_entrou_em = null;
    updates.follow_up_origem = null;
    updates.follow_up_motivo = null;
    // follow_up_tentativas NAO reseta — historico fica preservado pra cron
    // decidir quando 'desistir' (>= 2 tentativas sem retorno -> perdida).
    log('msg-in', `conversa ${conversa.id} retornou: follow_up -> conversando`);
  }
  await supabase
    .from('lojas_whats_conversas')
    .update(updates)
    .eq('id', conversa.id);

  // 5. Marca como lida no WhatsApp (boa pratica — mostra checkmark azul)
  await marcarComoLida(msg.id);

  // 6. Dispara IA pra gerar proposta de réplica (fire-and-forget, não bloqueia)
  //    A IA roda em segundo plano e cria sugestão pendente pra Tamara revisar.
  //    Se falhar, sem drama — Tamara pode chamar manual depois ou cron pega.
  disparouIaAsync(conversa.id);
}

// Fire-and-forget pra /api/lojas-whats-ia (não usa await — não bloqueia webhook)
function disparouIaAsync(conversaId) {
  try {
    const base = process.env.APP_URL || 'https://app-financeiro-brown.vercel.app';
    fetch(`${base}/api/lojas-whats-ia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversa_id: conversaId })
    }).catch(e => logErro('webhook/disparo-ia', e));
  } catch (e) {
    logErro('webhook/disparo-ia-sync', e);
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
    default:
      return { tipo: msg.type, texto: `[tipo nao suportado: ${msg.type}]`, midia_url: null, mime: null };
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
    const ext = (mime || '').split('/').pop()?.split(';')[0] || 'bin';
    const safeSufixo = (sufixoNome || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40);
    const fileName = `${Date.now()}_${mediaId}${safeSufixo ? '_' + safeSufixo : ''}.${ext}`;
    const path = `inbound/${fileName}`;
    const { error: errUp } = await supabase.storage
      .from('sofia-midias')
      .upload(path, buf, { contentType: mime, upsert: false });
    if (errUp) {
      logErro('webhook/midia-inbound-upload', errUp);
      return null;
    }
    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(path);
    log('midia-inbound', `salva ${mediaId} -> ${path}, ${buf.length} bytes`);
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

function detectarOrigemLead(refInfo) {
  if (!refInfo) return { origem: 'desconhecida', confianca: 0, meta: {} };

  // 1. PRIMARY — referral.source_type='ad' do payload Meta (CTWA)
  //    Vem direto da Meta, robusto contra cliente editar mensagem.
  if (refInfo.referral?.source_type === 'ad') {
    return {
      origem: 'anuncio_instagram',
      confianca: 1.0,
      meta: {
        ctwa_clid: refInfo.referral.ctwa_clid || null,
        ad_source_id: refInfo.referral.source_id || null,
        ad_headline: refInfo.referral.headline || null,
        ref_data: refInfo.referral,
      }
    };
  }

  // 2. SECONDARY — texto bate com frase CTA (caso referral nao tenha vindo)
  if (refInfo.primeiraTexto) {
    if (REGEX_CTA_INSTAGRAM.test(refInfo.primeiraTexto) || REGEX_ATACADO_PURO.test(refInfo.primeiraTexto)) {
      return { origem: 'anuncio_instagram', confianca: 0.7, meta: {} };
    }
  }

  // 3. FALLBACK — origem desconhecida (admin pode reclassificar via UI)
  return { origem: 'desconhecida', confianca: 0, meta: {} };
}

async function acharOuCriarConversa(telefone, nomeCliente, refInfo) {
  if (!telefone) return null;
  // Busca ativa
  const { data: existente } = await supabase
    .from('lojas_whats_conversas')
    .select('*')
    .eq('telefone', telefone)
    .not('etapa', 'in', '(perdida)')
    .order('iniciada_em', { ascending: false })
    .limit(1)
    .maybeSingle();
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
