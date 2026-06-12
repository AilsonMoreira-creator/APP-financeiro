// ═══════════════════════════════════════════════════════════════════════════
// _lojas-whats-meta-client.js — Cliente Meta WhatsApp Business Cloud API
// ═══════════════════════════════════════════════════════════════════════════
// Wrapper sobre a Cloud API da Meta:
//   - Enviar mensagens (texto, template HSM, midia)
//   - Validar assinatura de webhook (X-Hub-Signature-256)
//   - Baixar midia recebida
//   - Sincronizar status de templates
//
// Credentials vem de env vars:
//   META_WA_ACCESS_TOKEN  - token de acesso (24h temp ou System User)
//   META_WA_PHONE_ID      - phone number id do numero emissor
//   META_WA_WABA_ID       - WhatsApp Business Account ID
//   META_WA_APP_SECRET    - app secret pra validar assinatura webhook
//   META_WA_VERIFY_TOKEN  - verify token pro handshake do webhook
//
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { log, logErro } from './_lojas-whats-helpers.js';

const META_GRAPH_API = 'https://graph.facebook.com/v21.0';

// ─── HELPER: chamada base na Graph API ────────────────────────────────────

async function metaFetch(path, options = {}) {
  const url = `${META_GRAPH_API}${path}`;
  const headers = {
    'Authorization': `Bearer ${process.env.META_WA_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  // Retry transitório (Ailson 12/06/2026): a Meta às vezes responde
  // OAuthException code 1/2 com is_transient ("retry your request later").
  // Antes isso virava sugestão 'falhou' na primeira tentativa. Agora tenta
  // até 3x com backoff curto antes de desistir — só pra erro transitório.
  const MAX_TENTATIVAS = 3;
  let ultimoErr = null;
  for (let tent = 1; tent <= MAX_TENTATIVAS; tent++) {
    const res = await fetch(url, { ...options, headers });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* nao eh json */ }
    if (res.ok) return json;

    const err = new Error(`Meta API ${res.status}: ${json?.error?.message || text}`);
    err.status = res.status;
    err.metaResponse = json;
    const e = json?.error || {};
    const transitorio = e.is_transient === true || e.code === 1 || e.code === 2 || res.status >= 500;
    if (!transitorio || tent === MAX_TENTATIVAS) throw err;
    ultimoErr = err;
    log('meta-fetch', `erro transitorio (code=${e.code} tent=${tent}/${MAX_TENTATIVAS}) — retry em ${tent}s`);
    await new Promise(r => setTimeout(r, tent * 1000));
  }
  throw ultimoErr; // inalcançável, mas garante
}

// ─── VERIFY WEBHOOK (handshake GET na primeira config Meta) ───────────────

/**
 * Valida o handshake do webhook (GET) que a Meta envia quando registra a URL.
 * Retorna { ok, challenge } — se ok=true, devolve o challenge (status 200).
 *
 * Meta manda query params:
 *   hub.mode=subscribe
 *   hub.verify_token=<o que a gente cadastrou>
 *   hub.challenge=<string aleatoria que a gente devolve>
 */
export function verifyWebhookHandshake(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  const expected = process.env.META_WA_VERIFY_TOKEN;
  if (mode === 'subscribe' && token && token === expected) {
    log('webhook', 'handshake OK');
    return { ok: true, challenge };
  }
  logErro('webhook', `handshake FALHOU. mode=${mode} match=${token === expected}`);
  return { ok: false, challenge: null };
}

// ─── ASSINATURA DE EVENTOS (POST) ─────────────────────────────────────────

/**
 * Valida que o POST veio da Meta usando HMAC-SHA256 com APP_SECRET.
 * Meta manda header X-Hub-Signature-256: sha256=<hash>
 *
 * @param {string|Buffer} rawBody - corpo CRU do request (nao JSON parsed)
 * @param {string} signatureHeader - valor do header X-Hub-Signature-256
 */
export function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const secret = process.env.META_WA_APP_SECRET;
  if (!secret) {
    logErro('webhook-sign', 'META_WA_APP_SECRET nao configurado');
    return false;
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  const provided = signatureHeader.replace(/^sha256=/, '');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(provided, 'hex')
    );
  } catch (e) {
    return false;
  }
}

// ─── ENVIO DE MENSAGENS ───────────────────────────────────────────────────

/**
 * Envia mensagem de TEXTO LIVRE (so funciona dentro da janela 24h apos
 * cliente ter respondido). Pra primeira mensagem, use enviarTemplate.
 *
 * @param {string} telefone - E164 sem '+' (ex: '5511999999999')
 * @param {string} texto - corpo da mensagem
 * @param {object} opts - { preview_url: true|false }
 * @returns {object} { messages: [{ id }] } da Meta
 */
export async function enviarTexto(telefone, texto, opts = {}) {
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefone,
    type: 'text',
    text: {
      preview_url: opts.preview_url !== false, // default true (mostra preview de links)
      body: texto
    }
  };
  log('enviar-texto', `to=${telefone} len=${texto.length}`);
  return await metaFetch(`/${process.env.META_WA_PHONE_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

// ─── DIVISAO HUMANIZADA DE MENSAGENS ─────────────────────────────────────
// Ailson 12/06/2026: humano nao manda textao de 3-4 linhas de uma vez.
// Regra: ate 2 linhas = 1 mensagem; 3+ linhas divide em 2 (cap 3 pra textos
// muito longos). Quebra em ponto natural (paragrafo > linha > sentenca),
// nunca no meio de lista/valores (R$, bullets), que humano manda junto.

const _sleep = (ms) => new Promise(r => setTimeout(r, ms));
const _ehLinhaLista = (l) => /^\s*([-•*✔✓]|\d+[.)])\s/.test(l) || /R\$\s?\d/.test(l);

export function dividirMensagemHumana(texto) {
  if (!texto) return [texto];
  const t = String(texto).trim();
  const linhasUteis = t.split('\n').filter(l => l.trim());
  if (linhasUteis.length <= 2 && t.length <= 240) return [t];

  let blocos;
  let sep = '\n\n';
  const paragrafos = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  if (paragrafos.length >= 2) {
    blocos = paragrafos;
  } else {
    // Um paragrafo so: quebra por linhas, mantendo blocos de lista juntos
    sep = '\n';
    const ls = t.split('\n');
    blocos = [];
    let buf = [];
    for (let i = 0; i < ls.length; i++) {
      buf.push(ls[i]);
      const prox = ls[i + 1];
      const continuaLista = prox !== undefined && _ehLinhaLista(ls[i]) && _ehLinhaLista(prox);
      if (!continuaLista) { blocos.push(buf.join('\n')); buf = []; }
    }
    if (buf.length) blocos.push(buf.join('\n'));
    blocos = blocos.filter(b => b.trim());
    if (blocos.length < 2) {
      // Linha unica muito longa: quebra por sentenca
      if (t.length <= 300) return [t];
      sep = ' ';
      blocos = t.split(/(?<=[.!?…])\s+/).filter(Boolean);
      if (blocos.length < 2) return [t];
    }
  }

  // Agrupa blocos em N partes balanceadas por tamanho
  const total = blocos.reduce((s, b) => s + b.length, 0);
  const nPartes = (linhasUteis.length > 8 || t.length > 600) && blocos.length >= 3 ? 3 : 2;
  const alvo = total / nPartes;
  const partes = [];
  let cur = [], curLen = 0;
  for (const b of blocos) {
    if (cur.length && curLen >= alvo * 0.8 && partes.length < nPartes - 1) {
      partes.push(cur.join(sep)); cur = []; curLen = 0;
    }
    cur.push(b); curLen += b.length + sep.length;
  }
  if (cur.length) partes.push(cur.join(sep));
  return partes.map(p => p.trim()).filter(Boolean);
}

/**
 * Envia texto livre FRACIONADO como humano: divide em 2-3 mensagens com
 * delay de digitacao (1,8-3,5s) entre elas. A parte 1 e retornada como
 * metaResp pro caller registrar como mensagem principal; as partes extras
 * sao registradas aqui em lojas_whats_mensagens (precisa receber supabase).
 *
 * @returns {{ metaResp, textoPrimeiraParte, totalPartes }}
 */
export async function enviarTextoFracionado({ telefone, texto, conversaId, supabase, autor = 'sofia_ia' }) {
  const partes = dividirMensagemHumana(texto);
  const metaResp = await enviarTexto(telefone, partes[0]);
  for (let i = 1; i < partes.length; i++) {
    try {
      await _sleep(1800 + Math.floor(Math.random() * 1700));
      const r = await enviarTexto(telefone, partes[i]);
      if (conversaId && supabase) {
        await supabase.from('lojas_whats_mensagens').insert({
          conversa_id: conversaId, direcao: 'saida', autor, tipo_midia: 'text',
          texto: partes[i], meta_message_id: r?.messages?.[0]?.id || null,
          status: 'enviando', enviada_em: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error('[whats/fracionado] falha parte', i + 1, e.message);
    }
  }
  return { metaResp, textoPrimeiraParte: partes[0], totalPartes: partes.length };
}

/**
 * Envia mensagem de TEMPLATE HSM (primeira mensagem ou fora da janela 24h).
 * Template precisa estar APROVADO na Meta antes.
 *
 * @param {string} telefone - E164 sem '+'
 * @param {string} templateName - nome cadastrado na Meta (ex: 'carrinho_abandonado_site_amicia')
 * @param {Array<string>} variables - valores pras variaveis {{1}}, {{2}}, etc.
 *                                    Ex: ['Maria', '8']
 * @param {string} language - default 'pt_BR'
 */
export async function enviarTemplate(telefone, templateName, variables = [], language = 'pt_BR') {
  const components = [];
  if (variables.length > 0) {
    components.push({
      type: 'body',
      parameters: variables.map(v => ({ type: 'text', text: String(v) }))
    });
  }
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length > 0 ? { components } : {})
    }
  };
  log('enviar-template', `to=${telefone} tpl=${templateName} vars=${variables.length}`);
  return await metaFetch(`/${process.env.META_WA_PHONE_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
}

// ─── BAIXAR MIDIA RECEBIDA ────────────────────────────────────────────────

/**
 * Cliente mandou foto/audio/video — Meta envia media_id no webhook.
 * Pra baixar o conteudo real, precisa 2 chamadas:
 *   1. GET /<media_id> → retorna { url } temporaria
 *   2. GET <url> com Bearer token → bytes do arquivo
 */
export async function obterUrlMidia(mediaId) {
  return await metaFetch(`/${mediaId}`);
}

export async function baixarMidia(mediaUrl) {
  // mediaUrl ja vem completa do passo 1
  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}` }
  });
  if (!res.ok) throw new Error(`Falha baixar midia ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── ENVIAR MIDIA ─────────────────────────────────────────────────────────

/**
 * Faz upload do arquivo binario pro WhatsApp Cloud API.
 * Retorna media_id valido por 30 dias.
 *
 * @param {Buffer} buffer - binary do arquivo
 * @param {string} mime - 'image/jpeg' | 'video/mp4' | 'application/pdf'
 * @param {string} filename - nome de referencia (Meta exige)
 * @returns {string} media_id
 */
export async function uploadMidiaParaMeta(buffer, mime, filename = 'media') {
  const url = `${META_GRAPH_API}/${process.env.META_WA_PHONE_ID}/media`;

  // Ailson 25/05/2026: usar FormData NATIVO (global no Node 18+) + Blob.
  // ANTES: lib 'form-data' (npm) + fetch nativo -> Meta retornava
  // "(#100) The parameter file is required" porque fetch nao preservava
  // o Content-Type com boundary corretamente. Bug conhecido na combinacao.
  // AGORA: FormData global + Blob -> fetch monta multipart certinho.
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', mime);
  fd.append('file', new Blob([buffer], { type: mime }), filename);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}`,
      // NAO setar Content-Type — fetch seta sozinho com boundary correto
    },
    body: fd,
  });
  const j = await res.json();
  if (!res.ok || !j.id) {
    throw new Error(`Upload mídia falhou: ${JSON.stringify(j).slice(0, 200)}`);
  }
  log('upload-midia', `mime=${mime} size=${buffer.length} media_id=${j.id}`);
  return j.id;
}

/**
 * Envia mensagem de FOTO/VIDEO/DOCUMENTO via WhatsApp.
 * Usa media_id ja uploaded (de uploadMidiaParaMeta) ou link publico (link param).
 *
 * @param {string} telefone - E164 sem '+'
 * @param {string} tipoWa - 'image' | 'video' | 'document'
 * @param {object} payload - { id: media_id, caption?: text, filename?: nome (so pra document) }
 */
export async function enviarMidia(telefone, tipoWa, payload) {
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefone,
    type: tipoWa,
    [tipoWa]: payload,
  };
  log('enviar-midia', `to=${telefone} type=${tipoWa}`);
  return await metaFetch(`/${process.env.META_WA_PHONE_ID}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ─── TEMPLATES ────────────────────────────────────────────────────────────

/**
 * Consulta status de um template especifico no Meta.
 * Util pra sincronizar lojas_whats_templates.status com a Meta.
 */
export async function consultarTemplate(name, language = 'pt_BR') {
  const res = await metaFetch(
    `/${process.env.META_WA_WABA_ID}/message_templates?name=${encodeURIComponent(name)}`,
    { method: 'GET' }
  );
  const tpl = res?.data?.find(t => t.name === name && t.language === language);
  return tpl || null;
}

/**
 * Lista todos os templates da WABA. Util pra UI mostrar status.
 */
export async function listarTemplates() {
  const res = await metaFetch(
    `/${process.env.META_WA_WABA_ID}/message_templates?limit=100`,
    { method: 'GET' }
  );
  return res?.data || [];
}

// ─── SUBMETER TEMPLATE PRA APROVACAO META ─────────────────────────────────

/**
 * Submete um template pra aprovacao Meta na WABA configurada (META_WA_WABA_ID).
 *
 * O template DEVE existir no banco (lojas_whats_templates) com:
 *   - name, category, language, body_text, variables (jsonb), botoes (jsonb opcional)
 *
 * Retorna a resposta crua da Meta. Caller deve persistir meta_template_id
 * + status novo em lojas_whats_templates.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
 *
 * IMPORTANTE: Template pertence ao WABA, nao ao Phone Number.
 * Nao precisa de numero ativo na WABA pra submeter.
 */
export async function submeterTemplate(tplRow) {
  // 1. Monta componente BODY com exemplos das variaveis
  const components = [];

  // BODY (sempre presente)
  const bodyComp = { type: 'BODY', text: tplRow.body_text };
  if (Array.isArray(tplRow.variables) && tplRow.variables.length > 0) {
    // Meta exige exemplos em formato [[ex1, ex2, ...]]
    const exemplos = tplRow.variables
      .sort((a, b) => Number(a.nome) - Number(b.nome))
      .map(v => v.exemplo || 'exemplo');
    bodyComp.example = { body_text: [exemplos] };
  }
  components.push(bodyComp);

  // BUTTONS (opcional)
  if (Array.isArray(tplRow.botoes) && tplRow.botoes.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: tplRow.botoes.map(b => {
        if (b.type === 'URL') {
          return { type: 'URL', text: b.text, url: b.url };
        }
        if (b.type === 'PHONE_NUMBER') {
          return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number };
        }
        // QUICK_REPLY
        return { type: 'QUICK_REPLY', text: b.text };
      })
    });
  }

  const body = {
    name: tplRow.name,
    language: tplRow.language || 'pt_BR',
    category: tplRow.category || 'MARKETING',
    components
  };

  return await metaFetch(
    `/${process.env.META_WA_WABA_ID}/message_templates`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

// ─── MARCAR MENSAGEM COMO LIDA (boa pratica WhatsApp) ─────────────────────

export async function marcarComoLida(messageId) {
  const body = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId
  };
  try {
    return await metaFetch(`/${process.env.META_WA_PHONE_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  } catch (e) {
    // Falha silenciosa — nao bloqueia fluxo se nao conseguir marcar como lida
    logErro('marcar-lida', e);
    return null;
  }
}
