// ============================================================================
// MELUNI — ingestão de mensagens do WhatsApp da Lara (canal 'whatsapp').
// ----------------------------------------------------------------------------
// Espelha o webhook do Instagram, mas pro WhatsApp Cloud API. NÃO é um webhook
// próprio: o webhook único (lojas-whats-webhook.js) roteia pra cá quando o
// value.metadata.phone_number_id == META_WA_PHONE_ID_LARA. Grava no MESMO inbox
// do Meluni (meluni_conversas / meluni_mensagens), canal='whatsapp'.
//
// S1 = só RECEBER: cria/acha a conversa, grava a mensagem de entrada, seta o
// debounce (responder_em) pro futuro cron-responder da Lara (S2). Mídia entra
// como referência (download/transcrição ficam pra S2, junto da IA).
//
// Dedup por meta_message_id (índice único parcial) — a Meta reenvia em retry.
// Ailson 16/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

const DEBOUNCE_MS = 60 * 1000; // 60s — agrupa rajada antes da IA (igual Sofia)

const normTel = (s) => String(s || '').replace(/\D/g, '');

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
  const { data: ex } = await supabase
    .from('meluni_conversas')
    .select('id')
    .eq('canal', 'whatsapp')
    .eq('telefone', telefone)
    .order('ultima_msg_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ex?.id) return ex.id;

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
    const telefone = normTel(msg.from);
    if (!telefone) return;
    const nome = value?.contacts?.[0]?.profile?.name || null;
    const ref = msg.referral
      ? { ctwa_clid: msg.referral.ctwa_clid || null, ad_id: msg.referral.source_id || null }
      : null;

    const conversaId = await acharOuCriarConversa(telefone, nome, ref);
    if (!conversaId) return;

    const c = conteudoMsg(msg);
    // S1: mídia entra como referência (meta:<id>); download + transcrição na S2.
    const texto = c.texto || (c.tipo !== 'text' && c.tipo !== 'outro' ? `[${c.tipo}]` : null);
    const midiaUrl = c.midiaId ? `meta:${c.midiaId}` : null;
    const ts = parseInt(msg.timestamp, 10);
    const enviadaEm = new Date((Number.isFinite(ts) ? ts * 1000 : Date.now())).toISOString();

    const ins = await supabase.from('meluni_mensagens').insert({
      conversa_id: conversaId,
      direcao: 'entrada',
      autor: 'cliente',
      tipo_midia: c.tipo,
      texto,
      midia_url: midiaUrl,
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
  } catch (e) {
    console.error('[meluni-inbound] ERRO:', e?.message || e);
  }
}
