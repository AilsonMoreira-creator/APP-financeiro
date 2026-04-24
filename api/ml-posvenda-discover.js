/**
 * ml-posvenda-discover.js — Descoberta proativa de conversas pós-venda
 *
 * Resolve a brecha do webhook: usa GET /messages/unread?role=seller&tag=post_sale
 * pra listar TODAS as conversas com mensagens não lidas e popula ml_conversations
 * com as que ainda não existem.
 *
 * Uso:
 *   GET /api/ml-posvenda-discover                → descobre + popula tudo
 *   GET /api/ml-posvenda-discover?dry_run=1     → só inspeciona, não grava
 *   GET /api/ml-posvenda-discover?brand=Exitus  → uma marca só
 *
 * Recomendado rodar uma vez manualmente, depois adicionar ao cron de 5min.
 */
import { supabase, BRANDS, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

async function discoverBrand(brand, dryRun) {
  const out = { brand, http_status: null, total_unread: 0, criadas: 0, ja_existiam: 0, erros: 0, amostras: [] };

  try {
    const token = await getValidToken(brand);
    const { data: tokenRec } = await supabase
      .from('ml_tokens').select('seller_id').eq('brand', brand).single();
    const sellerId = tokenRec?.seller_id;
    if (!sellerId) { out.erros++; out.error = 'sem seller_id'; return out; }

    // 1. Lista conversas com mensagens não lidas (até 500)
    const r = await fetch(
      `${ML_API}/messages/unread?role=seller&tag=post_sale&limit=500`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    out.http_status = r.status;
    if (!r.ok) { out.erros++; out.error = `unread fetch: ${r.status}`; return out; }

    const data = await r.json();
    const results = data?.results || [];
    out.total_unread = data?.total ?? results.length;

    // 2. Pra cada resultado, extrai pack_id (a estrutura pode variar)
    for (const item of results) {
      try {
        // Possíveis caminhos do pack_id na resposta
        const packId = item.pack_id
          || item.id
          || item.resource_id
          || item.message_resources?.find(r => r.id_type === 'pack')?.id
          || item.resources?.pack?.id
          || null;

        // Se não tiver pack_id, salva amostra pra debug
        if (!packId) {
          if (out.amostras.length < 2) out.amostras.push({ keys: Object.keys(item), preview: item });
          out.erros++;
          continue;
        }

        // Salva amostra das primeiras 2 pra inspeção
        if (out.amostras.length < 2) {
          out.amostras.push({
            keys: Object.keys(item),
            pack_id: packId,
            preview_resumido: {
              date: item.date_created || item.last_message_date,
              from: item.from?.user_id || item.from_user_id,
              text_preview: (item.text?.plain || item.text || item.last_message_text || '').slice(0, 50),
            },
          });
        }

        if (dryRun) {
          out.criadas++; // simula
          continue;
        }

        // 3. Verifica se já existe
        const { data: exists } = await supabase
          .from('ml_conversations')
          .select('id')
          .eq('pack_id', String(packId))
          .eq('brand', brand)
          .maybeSingle();

        if (exists) {
          out.ja_existiam++;
          continue;
        }

        // 4. Busca dados ricos da conversa (pack + order + item)
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
        } catch (e) { /* segue mesmo sem dados ricos */ }

        // Thumbnail do item
        if (itemId) {
          try {
            const iRes = await fetch(`${ML_API}/items/${itemId}?attributes=thumbnail`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (iRes.ok) itemThumb = (await iRes.json()).thumbnail || '';
          } catch {}
        }

        // 5. Busca a mensagem mais recente pra preencher last_message_*
        let lastText = '', lastFrom = 'buyer', lastDate = new Date().toISOString();
        try {
          const mRes = await fetch(
            `${ML_API}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale&mark_as_read=false`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (mRes.ok) {
            const mData = await mRes.json();
            const msgs = mData.messages || [];
            const last = msgs[msgs.length - 1];
            if (last) {
              lastText = last.text?.plain || last.text || '';
              lastFrom = String(last.from?.user_id) === sellerId ? 'seller' : 'buyer';
              lastDate = last.date_created || lastDate;
            }
          }
        } catch {}

        // 6. CRIA a conversa
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
            last_message_text: lastText,
            last_message_from: lastFrom,
            last_message_at: lastDate,
            unread_count: 1,
            status: 'aberto',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'pack_id,brand' });

        if (convErr) { out.erros++; continue; }
        out.criadas++;

        // pequeno delay pra respeitar rate limit ML (500 rpm = ~1 req cada 120ms)
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        out.erros++;
      }
    }
  } catch (e) {
    out.erros++;
    out.error = e.message;
  }

  return out;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const dryRun = req.query.dry_run === '1' || req.query.dry_run === 'true';
  const filterBrand = req.query.brand ? String(req.query.brand) : null;
  const brands = filterBrand ? [filterBrand] : BRANDS;

  const inicio = Date.now();
  const results = [];
  for (const brand of brands) {
    results.push(await discoverBrand(brand, dryRun));
  }

  const totalCriadas = results.reduce((a, r) => a + r.criadas, 0);
  const totalJa = results.reduce((a, r) => a + r.ja_existiam, 0);
  const totalErros = results.reduce((a, r) => a + r.erros, 0);

  return res.status(200).json({
    ok: true,
    dry_run: dryRun,
    duracao_ms: Date.now() - inicio,
    resumo: {
      total_criadas: totalCriadas,
      total_ja_existiam: totalJa,
      total_erros: totalErros,
    },
    por_marca: results,
  });
}
