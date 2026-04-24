/**
 * ml-messages-reply.js — Envia resposta pós-venda no ML
 */
import { supabase, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const { conversation_id, text, sent_via = 'manual' } = req.body;
    if (!conversation_id || !text) return res.status(400).json({ error: 'Falta conversation_id ou text' });

    // Busca conversa
    const { data: conv, error: convErr } = await supabase
      .from('ml_conversations')
      .select('*')
      .eq('id', conversation_id)
      .single();

    if (convErr || !conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    const token = await getValidToken(conv.brand);

    // Limpa caracteres de controle/zero-width que quebram o parse do ML
    // (comum ao colar texto de outros apps ou teclado emoji)
    const textoLimpo = String(text)
      .replace(/[\u0000-\u001F\u007F]/g, '') // control chars
      .replace(/[\u200B-\u200F\uFEFF]/g, '') // zero-width chars
      .trim();

    if (!textoLimpo) {
      return res.status(400).json({ error: 'Texto vazio depois da limpeza' });
    }

    // user_id PRECISA ser number (int64) — se vier como string, ML falha com
    // "Unexpected exception parsing json string"
    const sellerIdNum = Number(conv.seller_id);
    const buyerIdNum = Number(conv.buyer_id);

    if (!Number.isFinite(sellerIdNum) || !Number.isFinite(buyerIdNum)) {
      return res.status(500).json({
        error: 'seller_id ou buyer_id inválido na conversa',
        seller_id: conv.seller_id,
        buyer_id: conv.buyer_id,
      });
    }

    const mlBody = {
      from: { user_id: sellerIdNum },
      to: { user_id: buyerIdNum },
      text: { plain: textoLimpo },
    };

    // Envia no ML
    const mlRes = await fetch(
      `${ML_API}/messages/packs/${conv.pack_id}/sellers/${conv.seller_id}?tag=post_sale`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(mlBody),
      }
    );

    if (!mlRes.ok) {
      const err = await mlRes.json().catch(() => ({}));
      // Log completo pro Vercel capturar a causa raiz
      console.error('[ml-messages-reply] ML API error:', {
        status: mlRes.status,
        pack_id: conv.pack_id,
        seller_id: conv.seller_id,
        buyer_id: conv.buyer_id,
        brand: conv.brand,
        conversation_id: conv.id,
        text_length: textoLimpo.length,
        body_sent: mlBody,
        error_body: err,
      });
      return res.status(mlRes.status).json({
        error: 'ML API error',
        status: mlRes.status,
        detail: err,
      });
    }

    const mlData = await mlRes.json();

    // Salva mensagem no Supabase (usando texto limpo, igual ao que foi enviado)
    const msgId = mlData.id || `sent_${Date.now()}`;
    await supabase.from('ml_messages').insert({
      conversation_id: conv.id,
      pack_id: conv.pack_id,
      message_id: String(msgId),
      brand: conv.brand,
      from_type: 'seller',
      from_id: conv.seller_id,
      text: textoLimpo,
      date_created: new Date().toISOString(),
      sent_via,
    });

    // Atualiza conversa
    await supabase.from('ml_conversations').update({
      last_message_text: textoLimpo,
      last_message_from: 'seller',
      last_message_at: new Date().toISOString(),
      unread_count: 0,
      updated_at: new Date().toISOString(),
    }).eq('id', conv.id);

    return res.json({ success: true, message_id: msgId });
  } catch (err) {
    console.error('[ml-messages-reply]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
