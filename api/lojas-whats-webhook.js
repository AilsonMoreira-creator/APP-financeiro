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
  marcarComoLida
} from './_lojas-whats-meta-client.js';

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
    }
  }
}

// ─── MSG RECEBIDA ─────────────────────────────────────────────────────────

async function processarMensagemRecebida(msg, valueCtx) {
  const telefone = normalizarTelefone(msg.from);
  const profile = valueCtx.contacts?.[0]?.profile || {};
  const nomeCliente = profile.name || null;
  log('msg-in', `from=${telefone} type=${msg.type} id=${msg.id}`);

  // 1. Acha (ou cria) conversa pra esse telefone
  const conversa = await acharOuCriarConversa(telefone, nomeCliente);
  if (!conversa) {
    logErro('msg-in', `nao consegui criar conversa pra ${telefone}`);
    return;
  }

  // 2. Extrai texto/midia da mensagem
  const dadosMsg = extrairConteudo(msg);

  // 3. Salva em lojas_whats_mensagens
  const { error: errMsg } = await supabase
    .from('lojas_whats_mensagens')
    .insert({
      conversa_id: conversa.id,
      direcao: 'entrada',
      autor: 'cliente',
      tipo_midia: dadosMsg.tipo,
      texto: dadosMsg.texto,
      midia_url: dadosMsg.midia_url,
      meta_message_id: msg.id,
      status: 'entregue',
      enviada_em: new Date(parseInt(msg.timestamp, 10) * 1000).toISOString()
    });
  if (errMsg) logErro('msg-in-save', errMsg);

  // 4. Avanca conversa se estava em 'enviada' (cliente respondeu pela 1a vez)
  const updates = {
    ultima_atividade_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString()
  };
  if (conversa.etapa === 'enviada') {
    updates.etapa = 'conversando';
    updates.cliente_respondeu_em = new Date().toISOString();
    log('msg-in', `conversa ${conversa.id} avancou: enviada -> conversando`);
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
      return { tipo: 'text', texto: msg.text?.body || '', midia_url: null };
    case 'image':
      return { tipo: 'image', texto: msg.image?.caption || null, midia_url: msg.image?.id };
    case 'audio':
      return { tipo: 'audio', texto: null, midia_url: msg.audio?.id };
    case 'video':
      return { tipo: 'video', texto: msg.video?.caption || null, midia_url: msg.video?.id };
    case 'document':
      return { tipo: 'document', texto: msg.document?.caption || null, midia_url: msg.document?.id };
    case 'sticker':
      return { tipo: 'sticker', texto: null, midia_url: msg.sticker?.id };
    case 'location':
      return { tipo: 'text', texto: `[localizacao: ${msg.location?.latitude}, ${msg.location?.longitude}]`, midia_url: null };
    default:
      return { tipo: msg.type, texto: `[tipo nao suportado: ${msg.type}]`, midia_url: null };
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
 */
async function acharOuCriarConversa(telefone, nomeCliente) {
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
  if (existente) return existente;

  // Cria nova como inbound espontaneo (cliente puxou conversa)
  log('conversa', `nova conversa inbound espontaneo pra ${telefone}`);
  const { data: nova, error } = await supabase
    .from('lojas_whats_conversas')
    .insert({
      telefone,
      nome_cliente: nomeCliente,
      etapa: 'conversando', // ja entra conversando pq cliente que falou primeiro
      iniciada_em: new Date().toISOString(),
      cliente_respondeu_em: new Date().toISOString(),
      ultima_atividade_em: new Date().toISOString()
    })
    .select('*')
    .single();
  if (error) {
    logErro('conversa-criar', error);
    return null;
  }
  return nova;
}
