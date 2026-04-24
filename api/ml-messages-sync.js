/**
 * ml-messages-sync.js — Cron: sincroniza mensagens pós-venda do ML
 * Roda a cada 5 min (Vercel Pro)
 * Busca mensagens não lidas das 3 contas e atualiza Supabase
 */
import { supabase, getValidToken, BRANDS } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export const config = { maxDuration: 120 };

async function syncBrand(brand) {
  const result = { brand, newMessages: 0, errors: 0 };

  try {
    const token = await getValidToken(brand);

    // Busca conversas abertas desta marca
    const { data: convs } = await supabase
      .from('ml_conversations')
      .select('*')
      .eq('brand', brand)
      .eq('status', 'aberto')
      .order('last_message_at', { ascending: false })
      .limit(30);

    if (!convs || convs.length === 0) return result;

    for (const conv of convs) {
      try {
        const mlRes = await fetch(
          `${ML_API}/messages/packs/${conv.pack_id}/sellers/${conv.seller_id}?tag=post_sale&mark_as_read=false`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (!mlRes.ok) { result.errors++; continue; }
        const mlData = await mlRes.json();
        const msgs = mlData.messages || [];

        for (const m of msgs) {
          const fromType = String(m.from?.user_id) === conv.seller_id ? 'seller' : 'buyer';
          const attachments = (m.message_attachments || []).map(a => ({
            id: a.filename || a.id, filename: a.filename || '', type: a.type || 'unknown',
          }));

          const { error } = await supabase.from('ml_messages').upsert({
            conversation_id: conv.id,
            pack_id: conv.pack_id,
            message_id: String(m.id),
            brand,
            from_type: fromType,
            from_id: String(m.from?.user_id || ''),
            text: m.text?.plain || m.text || '',
            attachments,
            date_created: m.date_created,
          }, { onConflict: 'message_id,brand' });

          if (!error) result.newMessages++;
        }

        // Atualiza último msg
        if (msgs.length > 0) {
          const last = msgs[msgs.length - 1];
          const lastFrom = String(last.from?.user_id) === conv.seller_id ? 'seller' : 'buyer';
          const unreadCount = msgs.filter(m => String(m.from?.user_id) !== conv.seller_id && m.date_created > (conv.last_message_at || '2000-01-01')).length;

          await supabase.from('ml_conversations').update({
            last_message_text: last.text?.plain || last.text || '',
            last_message_from: lastFrom,
            last_message_at: last.date_created,
            ...(unreadCount > 0 ? { unread_count: unreadCount } : {}),
            updated_at: new Date().toISOString(),
          }).eq('id', conv.id);
        }

        // Delay entre packs (respeita rate limit ML)
        await new Promise(r => setTimeout(r, 300));
      } catch (e) {
        console.error(`[ml-msg-sync] ${brand} pack ${conv.pack_id}:`, e.message);
        result.errors++;
      }
    }
  } catch (e) {
    console.error(`[ml-msg-sync] ${brand}:`, e.message);
    result.errors++;
  }

  return result;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const inicio = Date.now();

  // ── ETAPA 1: DISCOVER — descobre conversas novas via /messages/unread ──
  // Backup contra falha do webhook (mesmo padrão das perguntas que tem cron 8h).
  // Inline pra evitar custo de import dinamico em cada execucao.
  let discoverStats = { criadas: 0, ja_existiam: 0, erros: 0 };
  try {
    for (const brand of BRANDS) {
      try {
        const token = await getValidToken(brand);
        const { data: tokenRec } = await supabase
          .from('ml_tokens').select('seller_id').eq('brand', brand).single();
        const sellerId = tokenRec?.seller_id;
        if (!sellerId) continue;

        const r = await fetch(
          `${ML_API}/messages/unread?role=seller&tag=post_sale&limit=500`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!r.ok) continue;
        const data = await r.json();
        const items = data?.results || [];

        for (const item of items) {
          // Extrai pack_id do campo "resource": "/packs/PACK_ID/sellers/SELLER_ID"
          let packId = null;
          if (item.resource && typeof item.resource === 'string') {
            const m = item.resource.match(/\/packs\/(\d+)\//);
            if (m) packId = m[1];
          }
          if (!packId) { discoverStats.erros++; continue; }

          // Skip se conversa ja existe
          const { data: exists } = await supabase
            .from('ml_conversations')
            .select('id')
            .eq('pack_id', String(packId))
            .eq('brand', brand)
            .maybeSingle();

          if (exists) { discoverStats.ja_existiam++; continue; }

          // Cria conversa minima — o syncBrand abaixo + sync pos-criacao buscam mais detalhes
          // Tentamos buscar pack/order pra dados ricos, mas se falhar criamos sem
          let itemId = '', itemTitle = '', itemThumb = '', buyerId = '', buyerNick = '', orderId = '';
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
          } catch {}
          if (itemId) {
            try {
              const iRes = await fetch(`${ML_API}/items/${itemId}?attributes=thumbnail`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (iRes.ok) itemThumb = (await iRes.json()).thumbnail || '';
            } catch {}
          }

          const { error: convErr } = await supabase
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
              last_message_text: '',
              last_message_from: 'buyer',
              last_message_at: new Date().toISOString(),
              unread_count: 1,
              status: 'aberto',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'pack_id,brand' });

          if (convErr) { discoverStats.erros++; continue; }
          discoverStats.criadas++;
          await new Promise(r => setTimeout(r, 200));
        }
      } catch (e) {
        console.error(`[ml-msg-sync] discover ${brand}:`, e.message);
        discoverStats.erros++;
      }
    }
  } catch (e) {
    console.error('[ml-msg-sync] discover global:', e.message);
  }

  // ── ETAPA 2: SYNC — para cada conversa em ml_conversations, busca msgs novas ──
  const results = [];
  for (const brand of BRANDS) {
    results.push(await syncBrand(brand));
  }

  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`[ml-msg-sync] ✓ ${duracao}s — discover:`, JSON.stringify(discoverStats), '— sync:', results.map(r => `${r.brand}: ${r.newMessages} msgs`).join(', '));

  return res.status(200).json({ ok: true, duracao: duracao + 's', discover: discoverStats, sync: results });
}
