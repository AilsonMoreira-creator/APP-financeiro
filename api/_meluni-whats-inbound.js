// ============================================================================
// MELUNI — ingestão de mensagens do WhatsApp da Lara (canal 'whatsapp').
// ----------------------------------------------------------------------------
// Espelha o webhook do Instagram, mas pro WhatsApp Cloud API. NÃO é um webhook
// próprio: o webhook único (lojas-whats-webhook.js) roteia pra cá quando o
// value.metadata.phone_number_id == META_WA_PHONE_ID_LARA. Grava no MESMO inbox
// do Meluni (meluni_conversas / meluni_mensagens), canal='whatsapp'.
//
// S1 = RECEBER: cria/acha a conversa, grava a entrada, seta o debounce
// (responder_em) pro cron-responder da Lara. Mídia é baixada e salva no Storage
// (bucket sofia-midias, prefixo meluni-inbound/); áudio é transcrito no Whisper
// (texto = transcrição) e imagem fica com URL pública pra IA "ver" (visão na ia).
//
// Dedup por meta_message_id (índice único parcial) — a Meta reenvia em retry.
// Ailson 16/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';
import { obterUrlMidia, baixarMidia } from './_lojas-whats-meta-client.js';

const DEBOUNCE_MS = 60 * 1000; // 60s — agrupa rajada antes da IA (igual Sofia)

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';
const MIDIA_TIMEOUT_MS = 30000;

const normTel = (s) => String(s || '').replace(/\D/g, '');
// Canônico BR: tira o DDI 55 quando vem com 12/13 dígitos, pra bater com o
// telefone que o disparo de carrinho grava (sem 55). Ailson 17/06/2026.
const canonTel = (s) => {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d;
};

// Baixa a mídia da Meta (mesmo token da Sofia) e salva no Storage público
// (bucket sofia-midias, prefixo meluni-inbound/). Retorna { url, buffer, mime }.
// Falha não derruba a ingestão — quem chama trata o null.
async function baixarESalvarMidia(midiaId) {
  const meta = await obterUrlMidia(midiaId);
  if (!meta?.url) return null;
  const buffer = await baixarMidia(meta.url);
  const mime = (meta.mime_type || '').split(';')[0].trim() || 'application/octet-stream';
  const ext = mime.split('/').pop() || 'bin';
  const path = `meluni-inbound/${Date.now()}_${midiaId}.${ext}`;
  const { error } = await supabase.storage.from('sofia-midias').upload(path, buffer, { contentType: mime, upsert: false });
  if (error) { console.error('[meluni-inbound] upload midia:', error.message); return null; }
  const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(path);
  return { url: pub?.publicUrl || null, buffer, mime };
}

// Transcreve um buffer de áudio direto no Whisper (sem re-download). pt-BR.
async function transcreverBuffer(buffer, mime) {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!buffer || buffer.length === 0 || buffer.length > 25 * 1024 * 1024) return null;
  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime || 'audio/ogg' }), 'audio.ogg');
    form.append('model', WHISPER_MODEL);
    form.append('language', 'pt');
    form.append('response_format', 'json');
    const r = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(MIDIA_TIMEOUT_MS),
    });
    if (!r.ok) { console.error('[meluni-inbound] whisper status', r.status); return null; }
    const j = await r.json();
    return (j.text || '').trim() || null;
  } catch (e) {
    console.error('[meluni-inbound] transcrever:', e?.message || e);
    return null;
  }
}

// extrai tipo + texto + media_id da mensagem do WhatsApp
function conteudoMsg(msg) {
  switch (msg.type) {
    case 'text':     return { tipo: 'text',     texto: msg.text?.body || '',                              midiaId: null };
    case 'image':    return { tipo: 'image',    texto: msg.image?.caption || '',                          midiaId: msg.image?.id || null };
    case 'video':    return { tipo: 'video',    texto: msg.video?.caption || '',                          midiaId: msg.video?.id || null };
    case 'audio':    return { tipo: 'audio',    texto: '',                                                midiaId: msg.audio?.id || null };
    case 'document': return { tipo: 'document', texto: msg.document?.caption || msg.document?.filename || '', midiaId: msg.document?.id || null };
    case 'sticker':  return { tipo: 'sticker',  texto: '',                                                midiaId: msg.sticker?.id || null };
    case 'button':   return { tipo: 'text',     texto: msg.button?.text || '',                            midiaId: null };
    case 'interactive': {
      const i = msg.interactive || {};
      return { tipo: 'text', texto: i.button_reply?.title || i.list_reply?.title || '', midiaId: null };
    }
    default:         return { tipo: 'outro',    texto: '',                                                midiaId: null };
  }
}

async function acharOuCriarConversa(telefone, nome, ref) {
  // casa por SUFIXO (últimos 11 e, como fallback, 10 dígitos) pra cobrir números
  // gravados com e sem o DDI 55 — senão a resposta cria conversa duplicada no SAC.
  const d = String(telefone || '').replace(/\D/g, '');
  const suf11 = d.slice(-11);
  const { data: cand } = await supabase
    .from('meluni_conversas')
    .select('id, telefone, origem, ultima_msg_em')
    .eq('canal', 'whatsapp')
    .ilike('telefone', `%${suf11}`)
    .order('ultima_msg_em', { ascending: false })
    .limit(10);
  const norm = (t) => String(t || '').replace(/\D/g, '');
  const match =
    (cand || []).find(c => norm(c.telefone).slice(-11) === suf11) ||
    (cand || []).find(c => norm(c.telefone).slice(-10) === d.slice(-10));
  if (match?.id) return match.id;

  const { data: nova, error } = await supabase
    .from('meluni_conversas')
    .insert({
      canal: 'whatsapp',
      telefone,
      externo_id: telefone,
      nome_cliente: nome || null,
      origem: 'whatsapp',
      etapa: 'conversando',
      ultima_msg_direcao: 'entrada',
      ultima_msg_em: new Date().toISOString(),
      ctwa_clid: ref?.ctwa_clid || null,
      meta_ad_id: ref?.ad_id || null,
    })
    .select('id')
    .single();
  if (error) {
    console.error('[meluni-inbound] criar conversa erro:', error.message);
    return null;
  }
  return nova?.id || null;
}

export async function processarMensagemMeluni(msg, value) {
  try {
    const telefone = canonTel(msg.from);
    if (!telefone) return;
    const nome = value?.contacts?.[0]?.profile?.name || null;
    const ref = msg.referral
      ? { ctwa_clid: msg.referral.ctwa_clid || null, ad_id: msg.referral.source_id || null }
      : null;

    const conversaId = await acharOuCriarConversa(telefone, nome, ref);
    if (!conversaId) return;

    const c = conteudoMsg(msg);
    const ts = parseInt(msg.timestamp, 10);

    // baixa/salva a mídia (imagem/áudio/vídeo/doc/sticker); em áudio, transcreve.
    // download/transcrição nunca derrubam a ingestão — caem no fallback meta:<id>.
    let texto = c.texto || null;
    let midiaUrl = null;
    let transcricao = null;
    if (c.midiaId) {
      let salvo = null;
      try { salvo = await baixarESalvarMidia(c.midiaId); } catch (e) { console.error('[meluni-inbound] midia:', e?.message || e); }
      if (salvo?.url) {
        midiaUrl = salvo.url;
        if (c.tipo === 'audio') {
          transcricao = await transcreverBuffer(salvo.buffer, salvo.mime);
          texto = transcricao || '[áudio]';
        } else if (!texto) {
          texto = `[${c.tipo}]`;
        }
      } else {
        midiaUrl = `meta:${c.midiaId}`;
        if (!texto) texto = `[${c.tipo}]`;
      }
    } else if (!texto && c.tipo !== 'text' && c.tipo !== 'outro') {
      texto = `[${c.tipo}]`;
    }
    const enviadaEm = new Date((Number.isFinite(ts) ? ts * 1000 : Date.now())).toISOString();

    const ins = await supabase.from('meluni_mensagens').insert({
      conversa_id: conversaId,
      direcao: 'entrada',
      autor: 'cliente',
      tipo_midia: c.tipo,
      texto,
      midia_url: midiaUrl,
      audio_transcricao: transcricao,
      meta_message_id: msg.id,
      enviada_em: enviadaEm,
    });
    if (ins.error) {
      if (ins.error.code === '23505') return; // retry da Meta — dedup, ignora
      console.error('[meluni-inbound] insert msg erro:', ins.error.message);
    }

    // atualiza a conversa + arma o debounce pro cron-responder da Lara (S2)
    await supabase.from('meluni_conversas').update({
      ultima_msg_direcao: 'entrada',
      ultima_msg_em: new Date().toISOString(),
      responder_em: new Date(Date.now() + DEBOUNCE_MS).toISOString(),
      etapa: 'conversando',
      ...(nome ? { nome_cliente: nome } : {}),
    }).eq('id', conversaId);

    console.log(`[meluni-inbound] msg de ${telefone} (${c.tipo}) -> conversa ${conversaId}`);

    // se essa cliente tem carrinho no funil (enviada/segundo_envio), a resposta dela
    // move pra 'conversando' e marca a interação (alimenta o relógio de 3 dias).
    try {
      const tel10 = telefone.replace(/\D/g, '').slice(-10);
      const { data: carts } = await supabase.from('meluni_carrinhos')
        .select('id, telefone')
        .in('status', ['enviada', 'segundo_envio', 'perdida'])
        .is('convertido_em', null);
      const alvo = (carts || []).find(x => (x.telefone || '').replace(/\D/g, '').slice(-10) === tel10);
      if (alvo) {
        await supabase.from('meluni_carrinhos').update({
          status: 'conversando', ultima_interacao_em: new Date().toISOString(),
        }).eq('id', alvo.id);
      }
    } catch (e) { console.error('[meluni-inbound] carrinho->conversando:', e?.message || e); }
  } catch (e) {
    console.error('[meluni-inbound] ERRO:', e?.message || e);
  }
}
