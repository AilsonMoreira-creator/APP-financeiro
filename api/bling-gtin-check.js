/**
 * bling-gtin-check.js — Verifica se os SKUs do catálogo Bling têm GTIN
 * (código de barras EAN-13) preenchido. Só leitura, não escreve nada.
 *
 * Responde 3 coisas:
 *  1) o gtin vem na LISTAGEM /produtos ou só no DETALHE? (list_keys + detalhe_amostra)
 *  2) quantos SKUs têm gtin preenchido (e de 13 dígitos)
 *  3) amostra de SKUs com e sem gtin
 *
 * Uso:
 *   GET /api/bling-gtin-check                 - 5 páginas (~500 SKUs), conta lumia
 *   GET /api/bling-gtin-check?paginas=all     - varre o catálogo todo (cap 200 pág)
 *   GET /api/bling-gtin-check?paginas=10
 *   GET /api/bling-gtin-check?conta=exitus
 */
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';

export const config = { maxDuration: 120 };
const API = 'https://api.bling.com.br/Api/v3';
const PAGE = 100;
const DELAY = 350;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const conta = (req.query?.conta || 'lumia').toLowerCase();
  const maxPag = req.query?.paginas === 'all' ? 200 : Math.max(1, Math.min(200, parseInt(req.query?.paginas || '5', 10)));

  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };

    let total = 0, comGtin = 0, comGtin13 = 0, semGtin = 0, pag = 1;
    let firstKeys = null, firstId = null;
    const amostraCom = [], amostraSem = [];

    for (; pag <= maxPag; pag++) {
      const r = await blingFetch(`${API}/produtos?pagina=${pag}&limite=${PAGE}`, headers);
      if (!r.ok) break;
      const j = await r.json().catch(() => ({}));
      const prods = j.data || [];
      if (!prods.length) break;
      for (const p of prods) {
        if (!firstKeys) { firstKeys = Object.keys(p); firstId = p.id; }
        total++;
        const g = String(p.gtin || '').trim();
        if (!g) { semGtin++; if (amostraSem.length < 12) amostraSem.push({ codigo: p.codigo, nome: (p.nome || '').slice(0, 90) }); }
        else { comGtin++; if (/^\d{13}$/.test(g)) comGtin13++; if (amostraCom.length < 12) amostraCom.push({ codigo: p.codigo, gtin: g, nome: (p.nome || '').slice(0, 90) }); }
      }
      await new Promise(s => setTimeout(s, DELAY));
    }

    // Detalhe do 1º produto: confirma se o gtin existe no detalhe (caso a lista não traga)
    let detalhe = null;
    if (firstId) {
      try {
        const rd = await blingFetch(`${API}/produtos/${firstId}`, headers);
        const jd = await rd.json().catch(() => ({}));
        const d = jd.data || {};
        detalhe = { id: firstId, codigo: d.codigo, nome: (d.nome || '').slice(0, 90), gtin: d.gtin || null, detalhe_keys_tem_gtin: Object.keys(d).includes('gtin') };
      } catch { /* ignore */ }
    }

    return res.status(200).json({
      ok: true, conta, paginas_lidas: pag - 1, total,
      gtin_na_listagem: firstKeys ? firstKeys.includes('gtin') : null,
      list_keys: firstKeys,
      com_gtin: comGtin, com_gtin_13: comGtin13, sem_gtin: semGtin,
      pct_preenchido: total ? Math.round(comGtin / total * 100) : 0,
      detalhe_amostra: detalhe,
      amostra_com: amostraCom, amostra_sem: amostraSem,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
}
