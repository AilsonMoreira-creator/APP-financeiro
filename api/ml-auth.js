import { supabase, saveToken, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolivre.com.br';

async function exchangeCode(code) {
  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      code,
      redirect_uri: process.env.ML_REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`ML exchange error: ${JSON.stringify(err)}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
      const { action, code, brand } = req.query;

      if (action === 'url') {
        const authUrl = `${ML_AUTH}/authorization?response_type=code&client_id=${process.env.ML_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.ML_REDIRECT_URI)}`;
        return res.json({ url: authUrl });
      }

      if (action === 'callback' && code) {
        const tokenData = await exchangeCode(code);
        const brandName = brand || 'Unknown';
        const saved = await saveToken(brandName, tokenData);
        return res.json({ success: true, brand: brandName, seller_id: saved.seller_id });
      }

      if (action === 'status') {
        const { data } = await supabase
          .from('ml_tokens')
          .select('brand, seller_id, expires_at, updated_at');
        const statuses = (data || []).map(t => ({
          brand: t.brand,
          seller_id: t.seller_id,
          active: new Date(t.expires_at) > new Date(),
          expires_at: t.expires_at,
          updated_at: t.updated_at,
        }));
        return res.json({ tokens: statuses });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    if (req.method === 'POST') {
      const { action, brand } = req.body;
      if (action === 'refresh' && brand) {
        const token = await getValidToken(brand);
        return res.json({ success: true, brand });
      }
      return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[ml-auth]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
