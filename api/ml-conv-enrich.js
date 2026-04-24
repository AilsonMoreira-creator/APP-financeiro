/**
 * ml-conv-enrich.js — Enriquece conversa com dados faltantes do ML (on-demand)
 *
 * Quando uma conversa foi criada mas ficou sem item_title ou item_thumbnail
 * (webhook veio incompleto, API ML falhou, etc), o atendente precisa saber
 * do que se trata antes de responder. Este endpoint busca:
 *   - order → order_items → item_id
 *   - items/{id} → title, thumbnail, permalink
 *   - order → buyer → nickname
 * E atualiza a conversa no Supabase.
 *
 * POST /api/ml-conv-enrich
 * Body: { conversation_id }
 * Response: { ok, enriched, updates, conv }
 */
import { supabase, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const { conversation_id } = req.body;
    if (!conversation_id) return res.status(400).json({ error: 'conversation_id required' });

    const { data: conv, error: convErr } = await supabase
      .from('ml_conversations')
      .select('*')
      .eq('id', conversation_id)
      .single();
    if (convErr || !conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    // Early exit: se já tem tudo, não precisa buscar no ML
    if (conv.item_title && conv.item_thumbnail && conv.buyer_nickname) {
      return res.json({ ok: true, enriched: false, reason: 'já tinha todos os dados' });
    }

    const token = await getValidToken(conv.brand);

    const debug = {
      had_pack_id: !!conv.pack_id,
      had_order_id: !!conv.order_id,
      had_item_id: !!conv.item_id,
      token_ok: !!token,
      pack_fetch: null,
      order_fetch: null,
      item_fetch: null,
    };

    let itemId = conv.item_id || '';
    let itemTitle = conv.item_title || '';
    let itemThumb = conv.item_thumbnail || '';
    let buyerNick = conv.buyer_nickname || '';
    let buyerId = conv.buyer_id || '';
    let orderId = conv.order_id || '';

    // 1. Se não tem order_id, descobre via pack
    if (!orderId && conv.pack_id) {
      try {
        const r = await fetch(`${ML_API}/packs/${conv.pack_id}?tag=post_sale`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        debug.pack_fetch = { status: r.status, ok: r.ok };
        if (r.ok) {
          const pack = await r.json();
          orderId = pack.orders?.[0]?.id || '';
          debug.pack_fetch.got_order_id = !!orderId;
        } else {
          debug.pack_fetch.error_preview = (await r.text().catch(() => '')).slice(0, 150);
        }
      } catch (e) {
        debug.pack_fetch = { status: 'exception', error: e.message };
      }
    }

    // 2. Busca detalhes do order (buyer + first item)
    if (orderId) {
      try {
        const r = await fetch(`${ML_API}/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        debug.order_fetch = { status: r.status, ok: r.ok };
        if (r.ok) {
          const order = await r.json();
          if (!buyerId) buyerId = String(order.buyer?.id || '');
          if (!buyerNick) buyerNick = order.buyer?.nickname || '';
          const firstItem = order.order_items?.[0]?.item;
          if (firstItem) {
            if (!itemId) itemId = firstItem.id || '';
            if (!itemTitle) itemTitle = firstItem.title || '';
          }
          debug.order_fetch.got_item_id = !!itemId;
          debug.order_fetch.got_item_title = !!itemTitle;
        } else {
          debug.order_fetch.error_preview = (await r.text().catch(() => '')).slice(0, 150);
        }
      } catch (e) {
        debug.order_fetch = { status: 'exception', error: e.message };
      }
    }

    // 3. Busca thumbnail do item
    if (itemId && !itemThumb) {
      try {
        const r = await fetch(`${ML_API}/items/${itemId}?attributes=thumbnail,secure_thumbnail`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        debug.item_fetch = { status: r.status, ok: r.ok };
        if (r.ok) {
          const item = await r.json();
          itemThumb = item.secure_thumbnail || item.thumbnail || '';
          debug.item_fetch.got_thumb = !!itemThumb;
        } else {
          debug.item_fetch.error_preview = (await r.text().catch(() => '')).slice(0, 150);
        }
      } catch (e) {
        debug.item_fetch = { status: 'exception', error: e.message };
      }
    }

    // Monta updates só com os campos que mudaram
    const updates = {};
    if (itemId && itemId !== conv.item_id) updates.item_id = itemId;
    if (itemTitle && itemTitle !== conv.item_title) updates.item_title = itemTitle;
    if (itemThumb && itemThumb !== conv.item_thumbnail) updates.item_thumbnail = itemThumb;
    if (buyerNick && buyerNick !== conv.buyer_nickname) updates.buyer_nickname = buyerNick;
    if (buyerId && buyerId !== conv.buyer_id) updates.buyer_id = buyerId;
    if (orderId && String(orderId) !== String(conv.order_id || '')) updates.order_id = String(orderId);

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await supabase
        .from('ml_conversations')
        .update(updates)
        .eq('id', conversation_id);
    }

    // Log completo do que aconteceu (capturado nos Vercel logs)
    console.log('[ml-conv-enrich]', {
      conv_id: conversation_id,
      brand: conv.brand,
      pack_id: conv.pack_id,
      enriched: Object.keys(updates).length > 0,
      updates_keys: Object.keys(updates),
      debug,
    });

    return res.json({
      ok: true,
      enriched: Object.keys(updates).length > 0,
      updates,
      debug,
      conv: { ...conv, ...updates },
    });
  } catch (e) {
    console.error('[ml-conv-enrich]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
