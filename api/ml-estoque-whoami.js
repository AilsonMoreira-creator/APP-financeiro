/**
 * ml-estoque-whoami.js — Verificação rápida de qual conta ML estamos lendo
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    const brand = req.query?.brand || 'Lumia';

    // ── 1. Token salvo no banco ──
    const { data: tok } = await supabase.from('ml_tokens')
      .select('brand, seller_id, expires_at, updated_at').eq('brand', brand).single();

    // ── 2. Chamar /users/me pra ver qual conta o token autentica ──
    const token = await getValidToken(brand);
    const meRes = await fetch(`${ML_API}/users/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const me = meRes.ok ? await meRes.json() : { erro: meRes.status };

    // ── 3. Contar anúncios active/paused/closed ──
    const statuses = ['active', 'paused', 'closed'];
    const counts = {};
    for (const st of statuses) {
      const r = await fetch(
        `${ML_API}/users/${me.id}/items/search?status=${st}&limit=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (r.ok) {
        const d = await r.json();
        counts[st] = d.paging?.total || 0;
      }
    }

    // ── 4. Pegar 5 anúncios active com título ──
    const listRes = await fetch(
      `${ML_API}/users/${me.id}/items/search?status=active&limit=10`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    let samples = [];
    if (listRes.ok) {
      const listData = await listRes.json();
      const ids = (listData.results || []).slice(0, 10);
      if (ids.length > 0) {
        const multi = await fetch(
          `${ML_API}/items?ids=${ids.join(',')}&attributes=id,title,status`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const arr = await multi.json();
        samples = arr
          .filter(e => e.code === 200 && e.body)
          .map(e => ({ mlb: e.body.id, title: e.body.title, status: e.body.status }));
      }
    }

    return res.json({
      brand_consultada: brand,
      token_salvo_banco: {
        brand: tok?.brand,
        seller_id: tok?.seller_id,
        expires_at: tok?.expires_at,
        updated_at: tok?.updated_at,
      },
      conta_real_do_token: {
        id: me.id,
        nickname: me.nickname,
        site_id: me.site_id,
        registration_date: me.registration_date,
      },
      id_salvo_bate_com_conta_real: String(tok?.seller_id) === String(me.id),
      totais_anuncios_dessa_conta: counts,
      amostra_10_anuncios_ativos: samples,
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
