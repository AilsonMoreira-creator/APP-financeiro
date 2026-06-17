// ============================================================================
// /api/meluni-whats-midia-enviar — atendente anexa uma imagem (da fototeca/arquivos)
// e a Lara envia pela Cloud API. POST { conversa_id|telefone, base64, mime, caption? }.
// Sobe pro bucket sofia-midias/meluni-outbound, envia por link e grava a saída.
// Só funciona dentro da janela de 24h (mídia livre). Ailson 17/06/2026.
// ============================================================================
import { supabase } from './_meluni-whats-helpers.js';
import { enviarImagemLara } from './_meluni-whats-meta.js';

const normTel = (s) => String(s || '').replace(/\D/g, '');
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  const operador = (b.operador || 'atendente').toString().slice(0, 60);
  const caption = (b.caption || '').toString().slice(0, 1000);
  const mime = (b.mime || 'image/jpeg').toString().toLowerCase();
  let base64 = (b.base64 || '').toString();
  if (base64.includes(',')) base64 = base64.split(',').pop(); // tira data URL prefix
  if (!base64) return res.status(400).json({ ok: false, erro: 'imagem obrigatoria' });
  if (!EXT[mime]) return res.status(400).json({ ok: false, erro: 'formato nao suportado (use jpg/png/webp)' });

  try {
    // conversa
    let conversa = null;
    if (b.conversa_id) {
      const { data } = await supabase.from('meluni_conversas').select('*').eq('id', b.conversa_id).maybeSingle();
      conversa = data || null;
    } else if (b.telefone) {
      const { data } = await supabase.from('meluni_conversas')
        .select('*').eq('canal', 'whatsapp').eq('telefone', normTel(b.telefone))
        .order('ultima_msg_em', { ascending: false }).limit(1).maybeSingle();
      conversa = data || null;
    }
    if (!conversa?.telefone) return res.status(400).json({ ok: false, erro: 'conversa nao encontrada (cliente precisa ter escrito antes)' });

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ ok: false, erro: 'imagem muito grande (max 5MB)' });

    const path = `meluni-outbound/${Date.now()}.${EXT[mime]}`;
    const up = await supabase.storage.from('sofia-midias').upload(path, buffer, { contentType: mime, upsert: false });
    if (up.error) return res.status(500).json({ ok: false, erro: `upload_falhou: ${up.error.message}` });
    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(path);
    const url = pub?.publicUrl;
    if (!url) return res.status(500).json({ ok: false, erro: 'sem url publica' });

    let metaMsgId = null;
    try {
      const resp = await enviarImagemLara(conversa.telefone, url, caption);
      metaMsgId = resp?.messages?.[0]?.id || null;
    } catch (e) {
      return res.status(400).json({ ok: false, erro: `envio_falhou: ${e?.message || e}` });
    }

    const agora = new Date().toISOString();
    await supabase.from('meluni_mensagens').insert({
      conversa_id: conversa.id, direcao: 'saida', autor: operador,
      tipo_midia: 'image', midia_url: url, texto: caption || '[imagem]',
      meta_message_id: metaMsgId, enviada_em: agora,
    });
    await supabase.from('meluni_sugestoes').update({ status: 'descartada', decidido_em: agora, decidido_por: operador })
      .eq('conversa_id', conversa.id).eq('status', 'pendente');
    await supabase.from('meluni_conversas').update({
      ultima_msg_direcao: 'saida', ultima_msg_em: agora, responder_em: null,
      ...(conversa.atendida_desde ? {} : { atendida_desde: agora, atendida_por: operador }),
    }).eq('id', conversa.id);

    return res.json({ ok: true, url, meta_message_id: metaMsgId });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
