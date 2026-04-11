/**
 * ml-messages-webhook.js — Recebe notificações de mensagens pós-venda do ML
 * Topic: "messages"
 * Salva conversa + mensagem no Supabase
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(200).end();

    const { resource, user_id, topic } = req.body;
    if (topic !== 'messages' || !resource) return res.status(200).json({ ignored: true });

    // Identifica a marca pelo seller_id
    const { data: tokenRec } = await supabase
      .from('ml_tokens').select('brand, seller_id').eq('seller_id', String(user_id)).single();
    if (!tokenRec) return res.status(200).json({ ignored: true, reason: 'unknown_seller' });

    const brand = tokenRec.brand;
    const sellerId = tokenRec.seller_id;
    const token = await getValidToken(brand);

    // Busca a mensagem individual
    const msgRes = await fetch(`${ML_API}${resource}?tag=post_sale`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!msgRes.ok) return res.status(200).json({ error: 'fetch_msg_failed', status: msgRes.status });
    const msg = await msgRes.json();

    // Extrai pack_id da mensagem
    const packId = msg.message_resources?.pack?.id || msg.resource_id || null;
    if (!packId) return res.status(200).json({ error: 'no_pack_id' });

    const fromType = String(msg.from?.user_id) === sellerId ? 'seller' : 'buyer';

    // Busca/cria conversa
    let { data: conv } = await supabase
      .from('ml_conversations')
      .select('id')
      .eq('pack_id', String(packId))
      .eq('brand', brand)
      .maybeSingle();

    // Se conversa não existe, busca dados do pedido/item
    if (!conv) {
      let itemId = '', itemTitle = '', itemThumb = '', buyerId = '', buyerNick = '', orderId = '';

      // Tenta buscar pack info
      try {
        const packRes = await fetch(`${ML_API}/packs/${packId}?tag=post_sale`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (packRes.ok) {
          const pack = await packRes.json();
          orderId = pack.orders?.[0]?.id || '';
          if (orderId) {
            const orderRes = await fetch(`${ML_API}/orders/${orderId}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (orderRes.ok) {
              const order = await orderRes.json();
              buyerId = String(order.buyer?.id || '');
              buyerNick = order.buyer?.nickname || '';
              const firstItem = order.order_items?.[0]?.item;
              if (firstItem) {
                itemId = firstItem.id || '';
                itemTitle = firstItem.title || '';
              }
            }
          }
        }
      } catch (e) { console.error('[ml-msg-webhook] pack/order fetch:', e.message); }

      // Busca thumbnail
      if (itemId) {
        try {
          const itemRes = await fetch(`${ML_API}/items/${itemId}?attributes=thumbnail`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (itemRes.ok) {
            const item = await itemRes.json();
            itemThumb = item.thumbnail || '';
          }
        } catch {}
      }

      // Se não conseguiu buyer do order, pega da mensagem
      if (!buyerId && fromType === 'buyer') {
        buyerId = String(msg.from?.user_id || '');
      }

      const { data: newConv, error: convErr } = await supabase
        .from('ml_conversations')
        .upsert({
          pack_id: String(packId),
          brand,
          seller_id: sellerId,
          buyer_id: buyerId,
          buyer_nickname: buyerNick,
          order_id: String(orderId),
          item_id: itemId,
          item_title: itemTitle,
          item_thumbnail: itemThumb,
          last_message_text: msg.text?.plain || msg.text || '',
          last_message_from: fromType,
          last_message_at: msg.date_created || new Date().toISOString(),
          unread_count: fromType === 'buyer' ? 1 : 0,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'pack_id,brand' })
        .select('id')
        .single();

      if (convErr) {
        console.error('[ml-msg-webhook] conv upsert:', convErr.message);
        return res.status(200).json({ error: convErr.message });
      }
      conv = newConv;
    } else {
      // Atualiza conversa existente
      const update = {
        last_message_text: msg.text?.plain || msg.text || '',
        last_message_from: fromType,
        last_message_at: msg.date_created || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (fromType === 'buyer') {
        // Incrementa unread
        await supabase.rpc('increment_unread', { conv_id: conv.id }).catch(() => {
          // Fallback: se RPC não existe, faz update simples
          supabase.from('ml_conversations').update({ ...update, unread_count: 1 }).eq('id', conv.id);
        });
      }
      await supabase.from('ml_conversations').update(update).eq('id', conv.id);
    }

    // Parse attachments
    const attachments = (msg.message_attachments || []).map(a => ({
      id: a.filename || a.id,
      filename: a.filename || '',
      type: a.type || 'unknown',
    }));

    // Salva mensagem individual
    const msgId = msg.id || `${packId}_${Date.now()}`;
    await supabase.from('ml_messages').upsert({
      conversation_id: conv.id,
      pack_id: String(packId),
      message_id: String(msgId),
      brand,
      from_type: fromType,
      from_id: String(msg.from?.user_id || ''),
      text: msg.text?.plain || msg.text || '',
      attachments,
      date_created: msg.date_created || new Date().toISOString(),
    }, { onConflict: 'message_id,brand' });

    return res.status(200).json({ processed: true, pack_id: packId, message_id: msgId });
  } catch (err) {
    console.error('[ml-msg-webhook]', err.message);
    return res.status(200).json({ error: err.message });
  }
}
