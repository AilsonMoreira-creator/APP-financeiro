/**
 * ml-messages.js — Lista conversas e mensagens pós-venda
 * GET: lista conversas (com filtros)
 * POST: busca mensagens de uma conversa específica
 */
import { supabase, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // GET — Lista conversas
    if (req.method === 'GET') {
      const { brand, status, tag, limit = 50 } = req.query || {};

      let query = supabase
        .from('ml_conversations')
        .select('*')
        .order('last_message_at', { ascending: false })
        .limit(parseInt(limit));

      if (brand && brand !== 'Todas') query = query.eq('brand', brand);
      if (status) query = query.eq('status', status);
      if (tag) query = query.eq('tag', tag);

      const { data, error } = await query;
      if (error) return res.status(500).json({ error: error.message });

      return res.json({ conversations: data || [] });
    }

    // POST — Busca mensagens de uma conversa
    if (req.method === 'POST') {
      const { action, conversation_id, pack_id, brand } = req.body;

      if (action === 'messages' && conversation_id) {
        const { data, error } = await supabase
          .from('ml_messages')
          .select('*')
          .eq('conversation_id', conversation_id)
          .order('date_created', { ascending: true });

        if (error) return res.status(500).json({ error: error.message });

        // Marca como lido
        await supabase.from('ml_conversations')
          .update({ unread_count: 0 })
          .eq('id', conversation_id);

        return res.json({ messages: data || [] });
      }

      // Sync: busca mensagens do ML e atualiza Supabase
      if (action === 'sync' && pack_id && brand) {
        const { data: conv } = await supabase
          .from('ml_conversations')
          .select('*')
          .eq('pack_id', pack_id)
          .eq('brand', brand)
          .single();

        if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

        const token = await getValidToken(brand);
        const mlRes = await fetch(
          `${ML_API}/messages/packs/${pack_id}/sellers/${conv.seller_id}?tag=post_sale&mark_as_read=false`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (!mlRes.ok) return res.status(200).json({ error: 'ML fetch failed', status: mlRes.status });
        const mlData = await mlRes.json();
        const mlMessages = mlData.messages || [];

        let newCount = 0;
        for (const m of mlMessages) {
          const fromType = String(m.from?.user_id) === conv.seller_id ? 'seller' : 'buyer';
          const attachments = (m.message_attachments || []).map(a => ({
            id: a.filename || a.id, filename: a.filename || '', type: a.type || 'unknown',
          }));

          const { error: msgErr } = await supabase.from('ml_messages').upsert({
            conversation_id: conv.id,
            pack_id,
            message_id: String(m.id),
            brand,
            from_type: fromType,
            from_id: String(m.from?.user_id || ''),
            text: m.text?.plain || m.text || '',
            attachments,
            date_created: m.date_created || new Date().toISOString(),
          }, { onConflict: 'message_id,brand' });

          if (!msgErr) newCount++;
        }

        // Atualiza conversa com última mensagem
        if (mlMessages.length > 0) {
          const last = mlMessages[mlMessages.length - 1];
          const lastFrom = String(last.from?.user_id) === conv.seller_id ? 'seller' : 'buyer';
          await supabase.from('ml_conversations').update({
            last_message_text: last.text?.plain || last.text || '',
            last_message_from: lastFrom,
            last_message_at: last.date_created,
            updated_at: new Date().toISOString(),
            // Atualiza buyer info se não tinha
            ...(conv.buyer_nickname ? {} : (() => {
              const buyerMsg = mlMessages.find(m => String(m.from?.user_id) !== conv.seller_id);
              return buyerMsg ? { buyer_id: String(buyerMsg.from?.user_id || '') } : {};
            })()),
          }).eq('id', conv.id);
        }

        return res.json({ synced: newCount, total: mlMessages.length });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('[ml-messages]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
