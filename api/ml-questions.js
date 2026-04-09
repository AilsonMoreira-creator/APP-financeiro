import { supabase, getValidToken, BRANDS, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const itemCache = {};

async function fetchItemDetails(itemId, token) {
  if (itemCache[itemId]) return itemCache[itemId];
  try {
    const res = await fetch(
      `${ML_API}/items/${itemId}?attributes=id,title,thumbnail,pictures,permalink`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const item = await res.json();
      itemCache[itemId] = {
        id: item.id, title: item.title, thumbnail: item.thumbnail,
        picture_url: item.pictures?.[0]?.secure_url || item.thumbnail,
        permalink: item.permalink,
      };
      return itemCache[itemId];
    }
  } catch (err) { console.error(`[ml-questions] Item error ${itemId}:`, err.message); }
  return { id: itemId, title: itemId, thumbnail: null, picture_url: null, permalink: null };
}

async function fetchQuestionsForBrand(brand, status) {
  const token = await getValidToken(brand);
  const { data: tokenRecord } = await supabase
    .from('ml_tokens').select('seller_id').eq('brand', brand).single();
  if (!tokenRecord) throw new Error(`No seller_id for ${brand}`);

  const url = `${ML_API}/questions/search?seller_id=${tokenRecord.seller_id}&status=${status}&api_version=4&limit=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`ML API error ${brand}: ${res.status}`);

  const data = await res.json();
  return Promise.all((data.questions || []).map(async (q) => {
    const item = await fetchItemDetails(q.item_id, token);
    return {
      id: q.id, brand, seller_id: tokenRecord.seller_id,
      item_id: q.item_id, item_title: item.title,
      item_thumbnail: item.thumbnail, item_picture: item.picture_url,
      item_permalink: item.permalink, question_text: q.text,
      question_status: q.status, date_created: q.date_created,
      buyer_id: q.from?.id || null,
      answer: q.answer ? { text: q.answer.text, status: q.answer.status, date_created: q.answer.date_created } : null,
      minutes_elapsed: Math.floor((Date.now() - new Date(q.date_created).getTime()) / 60000),
    };
  }));
}

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { brand, status = 'UNANSWERED' } = req.query;
    const brandsToFetch = brand ? [brand] : BRANDS;
    const allQuestions = [];

    await Promise.all(brandsToFetch.map(async (b) => {
      try {
        const questions = await fetchQuestionsForBrand(b, status);
        allQuestions.push(...questions);
      } catch (err) { console.error(`[ml-questions] ${b}:`, err.message); }
    }));

    allQuestions.sort((a, b) => new Date(a.date_created) - new Date(b.date_created));
    return res.json({ total: allQuestions.length, questions: allQuestions, fetched_at: new Date().toISOString() });
  } catch (err) {
    console.error('[ml-questions]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
