// ============================================================================
// MELUNI — cliente Gmail da LARA (canal e-mail: contato@meluniloja.com.br).
// ----------------------------------------------------------------------------
// Entrada: lista não lidos, lê a mensagem (remetente/assunto/corpo/anexos),
//          baixa anexo, marca como lido.
// Saída:   enviarEmail() monta o MIME (Re: assunto + assinatura + threading
//          via In-Reply-To/References + threadId) e manda pelo Gmail API.
// Auth via service account com DWD impersonando contato@ (_google-sa.js).
//
// Env:
//   GOOGLE_SA_JSON, GOOGLE_IMPERSONATE (default contato@meluniloja.com.br)
//   MELUNI_LARA_WHATS -> número da Lara só dígitos (ex.: 5511999999999) p/ rodapé.
// Ailson 19/06/2026.
// ============================================================================
import { tokenGoogle } from './_google-sa.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
];
const FROM_EMAIL = process.env.GOOGLE_IMPERSONATE || 'contato@meluniloja.com.br';
const FROM_NOME = 'Meluni';
const SITE = 'meluniloja.com.br';

// ---------- helpers HTTP ----------
async function gfetch(path, { method = 'GET', query, body } = {}) {
  const tk = await tokenGoogle(SCOPES, FROM_EMAIL);
  let url = `${API}${path}`;
  if (query) url += '?' + new URLSearchParams(query).toString();
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* nao json */ }
  if (!r.ok) throw new Error(`gmail ${r.status}: ${j?.error?.message || txt}`);
  return j;
}

// ---------- entrada ----------
export async function listarNaoLidos(max = 10) {
  const j = await gfetch('/messages', { query: { q: 'is:unread -in:sent', maxResults: String(max) } });
  return (j?.messages || []).map(m => ({ id: m.id, threadId: m.threadId }));
}

function header(headers, nome) {
  const h = (headers || []).find(x => x.name?.toLowerCase() === nome.toLowerCase());
  return h?.value || null;
}

export function parseRemetente(value) {
  if (!value) return { nome: '', email: '' };
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { nome: (m[1] || '').trim(), email: m[2].trim().toLowerCase() };
  return { nome: '', email: value.trim().toLowerCase() };
}

function decodeB64Url(data) {
  return Buffer.from((data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// remove o histórico citado (deixa só o que a pessoa escreveu agora)
function tirarCitado(texto) {
  if (!texto) return '';
  const linhas = texto.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const corte = /^\s*(Em .+escreveu:|On .+wrote:|-{3,}\s*Original|De:\s|From:\s|_{5,})/i;
  for (const ln of linhas) {
    if (corte.test(ln)) break;
    if (/^\s*>/.test(ln)) continue; // linha citada
    out.push(ln);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function htmlParaTexto(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n').trim();
}

// percorre o payload e extrai corpo (prefere text/plain) + anexos
function extrair(payload) {
  let textoPlain = '';
  let textoHtml = '';
  const anexos = [];
  (function walk(p) {
    if (!p) return;
    const mt = p.mimeType || '';
    const fn = p.filename || '';
    const att = p.body?.attachmentId;
    if (fn && att) {
      anexos.push({ filename: fn, mimeType: mt, attachmentId: att });
    } else if (mt === 'text/plain' && p.body?.data) {
      textoPlain += decodeB64Url(p.body.data).toString('utf8');
    } else if (mt === 'text/html' && p.body?.data) {
      textoHtml += decodeB64Url(p.body.data).toString('utf8');
    }
    (p.parts || []).forEach(walk);
  })(payload);
  let texto = textoPlain || htmlParaTexto(textoHtml);
  texto = tirarCitado(texto);
  return { texto, anexos };
}

export async function pegarMensagem(id) {
  const j = await gfetch(`/messages/${id}`, { query: { format: 'full' } });
  const hs = j?.payload?.headers || [];
  const { nome, email } = parseRemetente(header(hs, 'From'));
  const { texto, anexos } = extrair(j?.payload);
  return {
    id: j.id,
    threadId: j.threadId,
    messageId: header(hs, 'Message-ID') || header(hs, 'Message-Id'),
    assunto: header(hs, 'Subject') || '',
    fromNome: nome,
    fromEmail: email,
    data: Number(j.internalDate) || Date.now(),
    texto,
    anexos,
  };
}

export async function pegarAnexo(msgId, attachmentId) {
  const j = await gfetch(`/messages/${msgId}/attachments/${attachmentId}`);
  return decodeB64Url(j?.data); // Buffer
}

export async function marcarLido(id) {
  try {
    await gfetch(`/messages/${id}/modify`, { method: 'POST', body: { removeLabelIds: ['UNREAD'] } });
  } catch { /* nao bloqueia */ }
}

// ---------- saída ----------
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// RFC 2047 p/ acento em From/Subject
function mimeWord(s) {
  const str = String(s || '');
  if (/^[\x00-\x7F]*$/.test(str)) return str;
  return `=?UTF-8?B?${Buffer.from(str, 'utf8').toString('base64')}?=`;
}

function assinatura() {
  const num = (process.env.MELUNI_LARA_WHATS || '').replace(/\D/g, '');
  const txt = [
    '', '', '--',
    FROM_NOME,
    `https://${SITE}`,
    num ? `WhatsApp: https://wa.me/${num}` : null,
  ].filter(v => v !== null).join('\n');
  const html = [
    '<br><br>--<br>',
    `<strong>${FROM_NOME}</strong><br>`,
    `<a href="https://${SITE}">${SITE}</a><br>`,
    num ? `WhatsApp: <a href="https://wa.me/${num}">${num}</a>` : '',
  ].join('');
  return { txt, html };
}

// envia (ou responde, se inReplyTo/threadId vierem). corpo = texto puro.
export async function enviarEmail({ para, nome, assunto, corpo, inReplyTo, threadId }) {
  if (!para) throw new Error('email sem destinatario');
  const sig = assinatura();
  let subj = (assunto || '').trim();
  if (!/^re:/i.test(subj)) subj = 'Re: ' + (subj || 'Atendimento Meluni');

  const boundary = 'b_' + Math.random().toString(36).slice(2);
  const headers = [
    `From: ${mimeWord(FROM_NOME)} <${FROM_EMAIL}>`,
    `To: ${para}`,
    `Subject: ${mimeWord(subj)}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    inReplyTo ? `References: ${inReplyTo}` : null,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean).join('\r\n');

  const textPart = `${corpo || ''}${sig.txt}`;
  const htmlPart = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">${escHtml(corpo || '').replace(/\n/g, '<br>')}${sig.html}</div>`;

  const mime = [
    headers, '', '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64', '',
    Buffer.from(textPart, 'utf8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64', '',
    Buffer.from(htmlPart, 'utf8').toString('base64'),
    `--${boundary}--`, '',
  ].join('\r\n');

  const raw = Buffer.from(mime, 'utf8').toString('base64url');
  const j = await gfetch('/messages/send', {
    method: 'POST',
    body: threadId ? { raw, threadId } : { raw },
  });
  return { id: j?.id || null, threadId: j?.threadId || threadId || null };
}
