/**
 * ml-reviews-orfaos-count.js — Conta reviews dos MLBs orfaos
 *
 * Sessao Ailson 15/05/2026. Pra decidir Caminho C: se os 44 orfaos
 * remanescentes tem volume relevante de reviews ou nao.
 *
 * GET /api/ml-reviews-orfaos-count?user=ailson
 *
 * Bate /reviews/item/{mlb}?limit=1 pra cada orfao e pega paging.total.
 * Retorna lista ordenada por qtd_reviews DESC + agregados.
 *
 * Custo: zero (so consulta ML API). ~30s pra 44 MLBs.
 */
import { supabase, getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 120 };

const ML_API = 'https://api.mercadolibre.com';
const DELAY_MS = 100;
const ADMINS = ['ailson', 'amicia-admin', 'tamara'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userId = req.query?.user || req.headers['x-user'];
  if (!ADMINS.includes(userId)) {
    return res.status(403).json({ error: 'Apenas admin' });
  }

  // Pega todos os orfaos
  const { data: orfaos, error } = await supabase
    .from('ml_reviews_mlb_map')
    .select('mlb_id, brand, titulo, scf_origem, thumbnail')
    .is('ref', null)
    .order('brand');

  if (error) return res.status(500).json({ error: error.message });
  if (!orfaos || orfaos.length === 0) {
    return res.json({ ok: true, qtd_orfaos: 0, total_reviews: 0, resultados: [] });
  }

  // Cache de tokens por brand
  const tokens = {};
  async function getToken(brand) {
    if (!tokens[brand]) tokens[brand] = await getValidToken(brand);
    return tokens[brand];
  }

  const resultados = [];
  let totalReviews = 0;
  let erros = 0;

  for (const o of orfaos) {
    try {
      const token = await getToken(o.brand);
      const r = await fetch(
        `${ML_API}/reviews/item/${o.mlb_id}?limit=1`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) {
        // 404 = MLB sem endpoint de reviews (normal)
        resultados.push({ ...o, qtd_reviews: 0, http: r.status });
        if (r.status !== 404) erros++;
      } else {
        const d = await r.json();
        const qtd = d.paging?.total || 0;
        resultados.push({ ...o, qtd_reviews: qtd });
        totalReviews += qtd;
      }
    } catch (e) {
      erros++;
      resultados.push({ ...o, qtd_reviews: 0, erro: e.message });
    }
    await sleep(DELAY_MS);
  }

  // Ordena por qtd_reviews DESC pra ver os mais relevantes em cima
  resultados.sort((a, b) => (b.qtd_reviews || 0) - (a.qtd_reviews || 0));

  // Agregados por brand e por SCF
  const porBrand = {};
  const porScf = {};
  for (const r of resultados) {
    porBrand[r.brand] = (porBrand[r.brand] || 0) + (r.qtd_reviews || 0);
    const scfKey = r.scf_origem || '(sem SCF)';
    if (!porScf[scfKey]) porScf[scfKey] = { qtd_mlbs: 0, qtd_reviews: 0, brands: new Set() };
    porScf[scfKey].qtd_mlbs++;
    porScf[scfKey].qtd_reviews += (r.qtd_reviews || 0);
    porScf[scfKey].brands.add(r.brand);
  }
  // Serializa Sets
  const porScfArr = Object.entries(porScf)
    .map(([scf, v]) => ({ scf, ...v, brands: Array.from(v.brands) }))
    .sort((a, b) => b.qtd_reviews - a.qtd_reviews);

  return res.json({
    ok: true,
    qtd_orfaos_inspecionados: orfaos.length,
    total_reviews_orfaos: totalReviews,
    erros,
    por_brand: porBrand,
    por_scf_top: porScfArr.slice(0, 20),
    top_10_individuais: resultados.slice(0, 10).map(r => ({
      mlb_id: r.mlb_id,
      brand: r.brand,
      titulo: r.titulo,
      scf: r.scf_origem,
      qtd_reviews: r.qtd_reviews,
    })),
  });
}
