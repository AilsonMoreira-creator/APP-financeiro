/**
 * ml-conversions-cron.js — Cron: cruza perguntas com pedidos pra detectar conversões
 * Roda a cada 30min (Vercel Pro)
 * Busca pedidos pagos das últimas 48h e verifica se o buyer fez alguma pergunta
 */
import { supabase, getValidToken, BRANDS } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export const config = { maxDuration: 120 };

async function syncBrand(brand) {
  const result = { brand, orders: 0, conversions: 0, errors: 0 };

  try {
    const token = await getValidToken(brand);
    const { data: tokenRec } = await supabase
      .from('ml_tokens').select('seller_id').eq('brand', brand).single();
    if (!tokenRec?.seller_id) return result;

    const sellerId = tokenRec.seller_id;
    const now = new Date();
    const from = new Date(now.getTime() - 48 * 3600000);

    // Busca pedidos pagos das últimas 48h
    let orders = [];
    let offset = 0;
    while (true) {
      const url = `${ML_API}/orders/search?seller=${sellerId}&order.status=paid&order.date_created.from=${from.toISOString()}&order.date_created.to=${now.toISOString()}&sort=date_desc&limit=50&offset=${offset}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) {
        console.error(`[ml-conv] ${brand}: orders HTTP ${resp.status}`);
        result.errors++;
        break;
      }
      const data = await resp.json();
      const results = data.results || [];
      orders.push(...results);
      result.orders += results.length;
      if (results.length < 50) break;
      offset += 50;
      await new Promise(r => setTimeout(r, 300));
    }

    if (orders.length === 0) return result;

    // Busca perguntas dos últimos 3 dias (buyer_id + item_id)
    const threeDaysAgo = new Date(now.getTime() - 72 * 3600000).toISOString();
    const { data: recentQuestions } = await supabase
      .from('ml_qa_history')
      .select('question_id, brand, item_id, question_text, answer_text, answered_by, answered_at')
      .eq('brand', brand)
      .gte('answered_at', threeDaysAgo);

    const { data: pendingQuestions } = await supabase
      .from('ml_pending_questions')
      .select('question_id, brand, item_id, question_text, buyer_id, date_created')
      .eq('brand', brand)
      .gte('date_created', threeDaysAgo);

    // Build buyer→questions map from pending (has buyer_id)
    const buyerQuestions = {};
    for (const q of (pendingQuestions || [])) {
      if (!q.buyer_id) continue;
      if (!buyerQuestions[q.buyer_id]) buyerQuestions[q.buyer_id] = [];
      buyerQuestions[q.buyer_id].push(q);
    }

    // Cross-reference: for each order, check if buyer made a question
    for (const order of orders) {
      const buyerId = String(order.buyer?.id || '');
      if (!buyerId || !buyerQuestions[buyerId]) continue;

      const orderDate = new Date(order.date_created);
      const orderItems = order.order_items || [];

      for (const q of buyerQuestions[buyerId]) {
        const questionDate = new Date(q.date_created);
        // Question must be BEFORE the order
        if (questionDate > orderDate) continue;
        // And within 48h
        const diffMs = orderDate.getTime() - questionDate.getTime();
        if (diffMs > 48 * 3600000) continue;

        const timeToByMins = Math.round(diffMs / 60000);

        // Determine conversion type
        const sameItem = orderItems.some(oi => oi.item?.id === q.item_id);
        const convType = sameItem ? 'direta' : 'indireta';

        // Get total order value
        const orderValue = parseFloat(order.total_amount || 0);

        // Find answered_by from qa_history
        const qaMatch = (recentQuestions || []).find(qa => qa.question_id === q.question_id);
        const answeredBy = qaMatch?.answered_by || 'unknown';

        // Get item title
        const itemTitle = orderItems[0]?.item?.title || '';

        // Upsert conversion (unique on order_id + question_id)
        const { error } = await supabase.from('ml_conversions').upsert({
          brand,
          buyer_id: buyerId,
          question_id: q.question_id,
          question_text: q.question_text,
          answered_by: answeredBy,
          order_id: String(order.id),
          order_value: orderValue,
          item_id: q.item_id,
          item_title: itemTitle,
          question_at: q.date_created,
          order_at: order.date_created,
          time_to_buy_minutes: timeToByMins,
          conversion_type: convType,
        }, { onConflict: 'order_id,question_id' });

        if (!error) result.conversions++;
        else if (error.code !== '23505') result.errors++; // ignore duplicate
      }
    }
  } catch (e) {
    console.error(`[ml-conv] ${brand}:`, e.message);
    result.errors++;
  }

  return result;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const inicio = Date.now();

  // Also expire old stock offers (>48h without confirmation)
  try {
    await supabase.from('ml_stock_offers')
      .update({ status: 'expirado', expired_at: new Date().toISOString() })
      .in('status', ['aguardando_confirmacao', 'aguardando_cor'])
      .lt('created_at', new Date(Date.now() - 48 * 3600000).toISOString());
  } catch (e) { console.error('[ml-conv] expire offers:', e.message); }

  const results = [];
  for (const brand of BRANDS) {
    results.push(await syncBrand(brand));
    await new Promise(r => setTimeout(r, 500));
  }

  const duracao = ((Date.now() - inicio) / 1000).toFixed(1);
  const totalConv = results.reduce((s, r) => s + r.conversions, 0);
  console.log(`[ml-conv] ✓ ${duracao}s — ${totalConv} conversões`);

  return res.status(200).json({ ok: true, duracao: duracao + 's', results });
}
