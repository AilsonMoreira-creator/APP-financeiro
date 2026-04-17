/**
 * ml-check-listed.js — Diagnóstico: verifica se um MLB aparece na listagem
 * /users/{seller_id}/items/search?status=active da Lumia, usada pelo cron.
 *
 * GET /api/ml-check-listed?mlb=MLB4919060970
 *
 * Retorna:
 *   - seller_id_stored: o que está em ml_tokens.brand='Lumia'
 *   - total_ids_listados: quantos IDs a API devolveu
 *   - mlb_aparece: true/false
 *   - posicao_na_listagem: se aparecer, em qual offset foi encontrado
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  const mlbBusca = String(req.query?.mlb || '').trim();
  if (!mlbBusca) return res.status(400).json({ ok: false, erro: 'use ?mlb=MLBxxx' });

  try {
    const { data: tokRec } = await supabase
      .from('ml_tokens')
      .select('seller_id, brand')
      .eq('brand', 'Lumia')
      .single();

    const sellerId = tokRec?.seller_id;
    const token = await getValidToken('Lumia');

    const ids = [];
    let offset = 0;
    let posicaoEncontrada = -1;
    let totalReportadoPelaAPI = null;
    const SAFETY_CAP = 5000;

    while (offset < SAFETY_CAP) {
      const r = await fetch(
        `${ML_API}/users/${sellerId}/items/search?status=active&offset=${offset}&limit=100`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) {
        return res.json({
          ok: false,
          erro_http: r.status,
          body: (await r.text().catch(() => '')).slice(0, 300),
          seller_id_stored: sellerId,
        });
      }
      const d = await r.json();
      const results = d.results || [];
      if (totalReportadoPelaAPI === null) totalReportadoPelaAPI = d.paging?.total || 0;

      if (results.length === 0) break;

      const idx = results.indexOf(mlbBusca);
      if (idx !== -1) posicaoEncontrada = offset + idx;

      ids.push(...results);
      if (ids.length >= totalReportadoPelaAPI || results.length < 100) break;
      offset += 100;
      await new Promise(r => setTimeout(r, 200));
    }

    return res.json({
      ok: true,
      mlb_busca: mlbBusca,
      seller_id_stored: sellerId,
      total_reportado_pela_api: totalReportadoPelaAPI,
      total_ids_capturados: ids.length,
      mlb_aparece: posicaoEncontrada !== -1,
      posicao_na_listagem: posicaoEncontrada,
      amostra_10_primeiros: ids.slice(0, 10),
      amostra_10_ultimos: ids.slice(-10),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
