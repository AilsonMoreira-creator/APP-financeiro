// ============================================================================
// MELUNI — webhook de entrada do Instagram Direct da Lara (canal 'direct_insta').
// ----------------------------------------------------------------------------
// Diferente do WhatsApp, o Instagram tem objeto de webhook próprio ('instagram'),
// então este é um endpoint dedicado (GET verifica o handshake, POST recebe).
// Grava no MESMO inbox do Meluni (meluni_conversas / meluni_mensagens), mas com
// canal='direct_insta' (que o SAC já lista) e a conversa é chaveada pelo IGSID
// do cliente (externo_id), telefone fica null.
//
// Token: o mesmo System User do app "claude" (META_WA_ACCESS_TOKEN) — já tem
// instagram_basic / instagram_manage_messages / instagram_manage_comments.
// Mídia (imagem/áudio/vídeo) vem com URL direta no attachment: baixa e salva no
// Storage (bucket sofia-midias, prefixo meluni-ig-inbound/); áudio é transcrito
// no Whisper. Eco (mensagem que NÓS enviamos) e recibos são ignorados.
// Só processa a conta da Meluni (MELUNI_IG_ID) — Amícia compartilha o mesmo app.
// Dedup por meta_message_id (mid). Ailson 18/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_WA_ACCESS_TOKEN;
const MELUNI_IG_ID = '17841467501146555'; // @meluni.loja
const AMICIA_IG_ID = '17841400655798460'; // @amicia.fashion (excluir; divide o app)
const IG_VERIFY = 'meluni-ig-verify-9b3f'; // token de verificação do Passo 3 (digitar igual no painel)
const DEBOUNCE_MS = 60 * 1000;
const MIDIA_TIMEOUT_MS = 30000;
const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const enc = encodeURIComponent;

async function baixarESalvarUrl(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(MIDIA_TIMEOUT_MS) });
    if (!r.ok) return null;
    const mime = (r.headers.get('content-type') || '').split(';')[0].trim() || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    const ext = (mime.split('/').pop() || 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
    const path = `meluni-ig-inbound/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('sofia-midias').upload(path, buf, { contentType: mime, upsert: false });
    if (error) { console.error('[meluni-ig] upload midia:', error.message); return null; }
    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(path);
    return { url: pub?.publicUrl || null, buffer: buf, mime };
  } catch (e) { console.error('[meluni-ig] baixar midia:', e?.message || e); return null; }
}

async function transcreverBuffer(buffer, mime) {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!buffer || buffer.length === 0 || buffer.length > 25 * 1024 * 1024) return null;
  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime || 'audio/mp4' }), 'audio.m4a');
    form.append('model', 'whisper-1');
    form.append('language', 'pt');
    form.append('response_format', 'json');
    const r = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(MIDIA_TIMEOUT_MS),
    });
    if (!r.ok) { console.error('[meluni-ig] whisper status', r.status); return null; }
    const j = await r.json();
    return (j.text || '').trim() || null;
  } catch (e) { console.error('[meluni-ig] transcrever:', e?.message || e); return null; }
}

// username do remetente (best effort; o webhook não traz)
async function nomeDoIgsid(igsid) {
  try {
    const r = await fetch(`${GRAPH}/${igsid}?fields=username,name&access_token=${enc(TOKEN)}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.username ? '@' + j.username : (j.name || null);
  } catch { return null; }
}

async function acharOuCriarConversaIG(igsid, nome) {
  const { data: ex } = await supabase
    .from('meluni_conversas')
    .select('id')
    .eq('canal', 'direct_insta')
    .eq('externo_id', igsid)
    .limit(1);
  if (ex && ex[0]?.id) return ex[0].id;

  const { data: nova, error } = await supabase
    .from('meluni_conversas')
    .insert({
      canal: 'direct_insta',
      externo_id: igsid,
      telefone: null,
      nome_cliente: nome || null,
      origem: 'instagram',
      etapa: 'conversando',
      ultima_msg_direcao: 'entrada',
      ultima_msg_em: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) { console.error('[meluni-ig] criar conversa:', error.message); return null; }
  return nova?.id || null;
}

async function processarDM(m) {
  const igsid = m.sender?.id;
  const msg = m.message;
  if (!igsid || !msg) return;          // postback/seen/reaction sem message
  if (msg.is_echo) return;             // mensagem que a própria conta enviou
  if (m.read || m.reaction || m.delivery) return;
  const mid = msg.mid || null;

  let texto = (msg.text || '').trim() || null;
  let tipo = 'text';
  let midiaUrl = null;
  let transcricao = null;

  const att = (msg.attachments || [])[0];
  if (att) {
    const t = att.type || 'outro';
    tipo = t === 'ig_reel' ? 'video' : t; // image|audio|video|share|story_mention|...
    const url = att.payload?.url || null;
    if (url) {
      const salvo = await baixarESalvarUrl(url);
      if (salvo?.url) {
        midiaUrl = salvo.url;
        if (tipo === 'audio') { transcricao = await transcreverBuffer(salvo.buffer, salvo.mime); texto = transcricao || '[áudio]'; }
        else if (!texto) texto = `[${tipo}]`;
      } else { midiaUrl = url; if (!texto) texto = `[${tipo}]`; }
    } else if (!texto) { texto = `[${tipo}]`; }
  }
  if (!texto && tipo === 'text') return; // nada aproveitável

  const nome = await nomeDoIgsid(igsid);
  const conversaId = await acharOuCriarConversaIG(igsid, nome);
  if (!conversaId) return;

  const ins = await supabase.from('meluni_mensagens').insert({
    conversa_id: conversaId,
    direcao: 'entrada',
    autor: 'cliente',
    tipo_midia: tipo,
    texto,
    midia_url: midiaUrl,
    audio_transcricao: transcricao,
    meta_message_id: mid,
    enviada_em: new Date().toISOString(),
  });
  if (ins.error) {
    if (ins.error.code === '23505') return; // retry da Meta — dedup
    console.error('[meluni-ig] insert msg:', ins.error.message);
  }

  await supabase.from('meluni_conversas').update({
    ultima_msg_direcao: 'entrada',
    ultima_msg_em: new Date().toISOString(),
    responder_em: new Date(Date.now() + DEBOUNCE_MS).toISOString(),
    etapa: 'conversando',
    ...(nome ? { nome_cliente: nome } : {}),
  }).eq('id', conversaId);

  console.log(`[meluni-ig] DM de ${nome || igsid} (${tipo}) -> conversa ${conversaId}`);
}

export default async function handler(req, res) {
  // GET — handshake de verificação da Meta
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && (token === process.env.META_WA_VERIFY_TOKEN || token === IG_VERIFY)) {
      return res.status(200).send(String(challenge ?? ''));
    }
    return res.status(403).send('forbidden');
  }
  if (req.method !== 'POST') return res.status(405).json({ erro: 'use POST' });

  try {
    const body = req.body || {};
    if (body.object !== 'instagram') return res.status(200).json({ ok: true, ignorado: body.object || null });
    for (const entry of (body.entry || [])) {
      if (entry.id && entry.id === AMICIA_IG_ID) continue; // só exclui Amícia; Meluni passa
      for (const m of (entry.messaging || [])) {
        await processarDM(m);
      }
      for (const ch of (entry.changes || [])) {
        if (ch.field === 'comments') console.log('[meluni-ig] comentário (tratado depois):', ch.value?.id);
      }
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[meluni-ig] webhook ERRO:', e?.message || e);
    return res.status(200).json({ ok: false }); // 200 evita re-tentativa em loop da Meta
  }
}
