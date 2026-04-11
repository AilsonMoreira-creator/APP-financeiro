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
  const results = [];

  for (const brand of BRANDS) {
    results.push(await syncBrand(brand));
  }

  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(`[ml-msg-sync] ✓ ${duracao}s —`, results.map(r => `${r.brand}: ${r.newMessages} msgs`).join(', '));

  return res.status(200).json({ ok: true, duracao: duracao + 's', results });
}
