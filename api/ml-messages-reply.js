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

    // Envia no ML
    const mlRes = await fetch(
      `${ML_API}/messages/packs/${conv.pack_id}/sellers/${conv.seller_id}?tag=post_sale`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { user_id: conv.seller_id },
          to: { user_id: conv.buyer_id },
          text: { plain: text },
        }),
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
        error_body: err,
      });
      return res.status(mlRes.status).json({
        error: 'ML API error',
        status: mlRes.status,
        detail: err,
      });
    }

    const mlData = await mlRes.json();

    // Salva mensagem no Supabase
    const msgId = mlData.id || `sent_${Date.now()}`;
    await supabase.from('ml_messages').insert({
      conversation_id: conv.id,
      pack_id: conv.pack_id,
      message_id: String(msgId),
      brand: conv.brand,
      from_type: 'seller',
      from_id: conv.seller_id,
      text,
      date_created: new Date().toISOString(),
      sent_via,
    });

    // Atualiza conversa
    await supabase.from('ml_conversations').update({
      last_message_text: text,
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
