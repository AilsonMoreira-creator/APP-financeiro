// ============================================================================
// MELUNI — cron de ENTRADA de e-mail (canal 'email'). A cada ~2 min:
//  lê não lidos de contato@meluniloja.com.br -> 1 card por e-mail do cliente
//  (canal='email', externo_id=email) -> grava msg de entrada + anexos no bucket
//  -> agenda responder_em pra Lara sugerir -> marca o e-mail como lido.
// Idêntico aos outros canais do SAC; o atendente nem percebe que é e-mail.
// Espelha o padrão do webhook do Direct. Ailson 19/06/2026.
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';
import { listarNaoLidos, pegarMensagem, pegarAnexo, marcarLido } from './_meluni-email-meta.js';
import { googleOAuthOk } from './_google-oauth.js';

const FROM_EMAIL = (process.env.MELUNI_EMAIL_ADDR || 'contato@meluniloja.com.br').toLowerCase();
const DEBOUNCE_MS = 15 * 1000;
const MAX_LOTE = 10;

function tipoPorMime(mime) {
  if (/^image\//i.test(mime)) return 'image';
  if (/pdf$/i.test(mime)) return 'pdf';
  return 'arquivo';
}

async function salvarAnexo(buf, filename, mime) {
  if (!buf || !buf.length) return null;
  const ext = ((filename || '').split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  const path = `meluni-email-inbound/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('sofia-midias')
    .upload(path, buf, { contentType: mime || 'application/octet-stream', upsert: false });
  if (error) { console.error('[meluni-email] upload anexo:', error.message); return null; }
  const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(path);
  return pub?.publicUrl || null;
}

async function acharOuCriarConversa(email, nome) {
  const { data: ex } = await supabase
    .from('meluni_conversas').select('id')
    .eq('canal', 'email').eq('externo_id', email).limit(1);
  if (ex && ex[0]?.id) return ex[0].id;

  const { data: nova, error } = await supabase
    .from('meluni_conversas')
    .insert({
      canal: 'email', externo_id: email, telefone: null,
      nome_cliente: nome || null, origem: 'email', etapa: 'conversando',
      ultima_msg_direcao: 'entrada', ultima_msg_em: new Date().toISOString(),
    })
    .select('id').single();
  if (error) { console.error('[meluni-email] criar conversa:', error.message); return null; }
  return nova?.id || null;
}

async function processarEmail(ref) {
  const m = await pegarMensagem(ref.id);
  if (!m?.fromEmail) return 'sem_remetente';
  if (m.fromEmail === FROM_EMAIL) { await marcarLido(ref.id); return 'proprio'; } // evita loop

  const conversaId = await acharOuCriarConversa(m.fromEmail, m.fromNome);
  if (!conversaId) return 'sem_conversa';

  const quando = new Date(m.data).toISOString();

  // corpo do e-mail
  const corpo = (m.texto || '').trim();
  if (corpo) {
    const ins = await supabase.from('meluni_mensagens').insert({
      conversa_id: conversaId, direcao: 'entrada', autor: 'cliente',
      tipo_midia: 'text', texto: corpo, meta_message_id: m.messageId, enviada_em: quando,
    });
    if (ins.error && ins.error.code !== '23505') console.error('[meluni-email] insert corpo:', ins.error.message);
  }

  // anexos (imagem/pdf/arquivo) -> bucket + msg própria
  for (let i = 0; i < (m.anexos || []).length; i++) {
    const a = m.anexos[i];
    try {
      const buf = await pegarAnexo(m.id, a.attachmentId);
      const url = await salvarAnexo(buf, a.filename, a.mimeType);
      if (!url) continue;
      const tipo = tipoPorMime(a.mimeType || '');
      await supabase.from('meluni_mensagens').insert({
        conversa_id: conversaId, direcao: 'entrada', autor: 'cliente',
        tipo_midia: tipo, texto: `[${tipo === 'image' ? 'imagem' : tipo}] ${a.filename || ''}`.trim(),
        midia_url: url, meta_message_id: m.messageId ? `${m.messageId}#${i}` : null, enviada_em: quando,
      });
    } catch (e) { console.error('[meluni-email] anexo falhou:', e?.message || e); }
  }

  // atualiza a conversa: nome/assunto/thread/msg-id + agenda a sugestão da Lara
  await supabase.from('meluni_conversas').update({
    ...(m.fromNome ? { nome_cliente: m.fromNome } : {}),
    email_assunto: m.assunto || null,
    email_thread_id: m.threadId || null,
    email_msg_id: m.messageId || null,
    ultima_msg_direcao: 'entrada', ultima_msg_em: quando,
    responder_em: new Date(Date.now() + DEBOUNCE_MS).toISOString(),
    etapa: 'conversando',
  }).eq('id', conversaId);

  await marcarLido(ref.id);
  console.log(`[meluni-email] ${m.fromEmail} (${(m.anexos || []).length} anexo) -> conversa ${conversaId}`);
  return 'ok';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!(await googleOAuthOk())) {
    return res.status(200).json({ ok: true, skip: 'OAuth do Google nao configurado (rode /api/meluni-email-oauth)' });
  }
  try {
    const refs = await listarNaoLidos(MAX_LOTE);
    const cont = { ok: 0, proprio: 0, erro: 0, outros: 0 };
    for (const ref of refs) {
      try {
        const r = await processarEmail(ref);
        if (r === 'ok') cont.ok++;
        else if (r === 'proprio') cont.proprio++;
        else cont.outros++;
      } catch (e) {
        cont.erro++;
        console.error('[meluni-email] processar', ref.id, e?.message || e);
      }
    }
    return res.status(200).json({ ok: true, total: refs.length, ...cont });
  } catch (e) {
    console.error('[meluni-email] cron erro:', e?.message || e);
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
