// full-estoque-sync.js — estoque REAL do armazem do ML, todas as REFs (Ailson 13/09/2026)
//
// Percorre os anuncios com logistic_type=fulfillment da Exitus, le as variacoes
// (cor+tamanho) e, pra cada uma COM inventory_id, consulta
// /inventories/{id}/stock/fulfillment. Grava em full_estoque_cache.
//
//   GET /api/full-estoque-sync            -> sincroniza (cron ou admin)
//   GET /api/full-estoque-sync?auditoria=1 -> divergencias: anuncio diz X, armazem tem Y
//
// A REF vem do seller_sku da variacao (5 primeiros digitos = REF no padrao do
// Bling) ou do titulo ("REF 2700"). O available_quantity da variacao e o numero
// que o Bling empurra — e o "qtd_anuncio" aqui, so pra auditoria.

import { supabase, chaveCor } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 300 };

const n = (v) => Number(v) || 0;
const pausa = (ms) => new Promise(r => setTimeout(r, ms));

// 13/09: a REF vem do CADASTRO DO BLING (bling_estoque.bling_sku -> ref), que
// e a fonte certa. O SKU do ML nao segue o padrao numerico do Bling.
function skuDe(variacao, item) {
  return String(variacao?.seller_custom_field || (variacao?.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name || item?.seller_custom_field || '').trim();
}
function refDe(item, variacao, skuParaRef) {
  const sku = skuDe(variacao, item);
  if (sku && skuParaRef[sku]) return skuParaRef[sku];
  const t = /REF\.?\s*0*(\d{3,5})\b/i.exec(String(item?.title || ''));
  return t ? String(t[1]).replace(/^0+/, '') : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.query?.auditoria === '1') {
    const { data } = await supabase.from('full_estoque_cache').select('ref, cor, tam, qtd_anuncio, qtd_armazem, inventory_id, atualizado_em').order('ref');
    const rows = data || [];
    const div = rows.filter(r => r.qtd_anuncio !== r.qtd_armazem);
    const porRef = {};
    for (const r of div) { porRef[r.ref] = porRef[r.ref] || []; porRef[r.ref].push(`${r.cor} ${r.tam}: anúncio ${r.qtd_anuncio} → armazém ${r.qtd_armazem}${r.inventory_id ? '' : ' (sem inventário)'}`); }
    return res.status(200).json({ variacoes: rows.length, refs: new Set(rows.map(r => r.ref)).size, divergentes: div.length,
      refs_com_divergencia: Object.keys(porRef).length, ultima_sync: rows[0]?.atualizado_em || null, por_ref: porRef });
  }

  const inicio = Date.now();
  // mapa SKU (Bling) -> REF, do cadastro
  const skuParaRef = {};
  for (let off = 0; off < 100000; off += 1000) {
    const { data } = await supabase.from('bling_estoque').select('ref, bling_sku').not('bling_sku', 'is', null).range(off, off + 999);
    for (const r of (data || [])) if (r.bling_sku) skuParaRef[String(r.bling_sku).trim()] = String(r.ref).replace(/^0+/, '');
    if (!data || data.length < 1000) break;
  }
  const token = await getValidToken('Exitus');
  const h = { Authorization: `Bearer ${token}` };
  const me = await (await fetch('https://api.mercadolibre.com/users/me', { headers: h })).json();
  // todos os anuncios Full
  const ids = [];
  let offset = 0;
  while (true) {
    const b = await (await fetch(`https://api.mercadolibre.com/users/${me.id}/items/search?logistic_type=fulfillment&limit=50&offset=${offset}`, { headers: h })).json();
    ids.push(...(b?.results || []));
    if (!b?.results?.length || ids.length >= n(b?.paging?.total)) break;
    offset += 50;
    await pausa(100);
  }
  let variacoes = 0, consultas = 0, gravadas = 0, semRef = 0;
  for (const itemId of ids) {
    if (Date.now() - inicio > 270000) break;   // deixa 30s de folga
    const it = await (await fetch(`https://api.mercadolibre.com/items/${itemId}?include_attributes=all`, { headers: h })).json();
    const linhas = [];
    for (const v of (it.variations || [])) {
      const combo = v.attribute_combinations || [];
      const cor = (combo.find(a => /cor|color/i.test(a.id || a.name)) || {}).value_name;
      const tam = (combo.find(a => /size|tamanho/i.test(a.id || a.name)) || {}).value_name;
      if (!cor || !tam) continue;
      variacoes++;
      // 14/09: variacao sem REF no cadastro entra com ref '?' + sku do ML, pra
      // a conta fechar e ele ver quais SKUs faltam mapear
      let ref = refDe(it, v, skuParaRef);
      if (!ref) { semRef++; ref = '?' + skuDe(v, it).slice(0, 30); }
      let arm = 0, tot = 0, naoDisp = '';
      if (v.inventory_id) {
        try {
          const st = await (await fetch(`https://api.mercadolibre.com/inventories/${v.inventory_id}/stock/fulfillment`, { headers: h })).json();
          consultas++;
          arm = n(st?.available_quantity); tot = n(st?.total);
          naoDisp = (st?.not_available_detail || []).map(d => `${d.status}:${d.quantity}`).join(',');
        } catch { /* fica 0 */ }
        await pausa(80);
      }
      linhas.push({ anuncio: itemId, ref, cor: chaveCor(cor), tam: String(tam).toUpperCase().trim(), inventory_id: v.inventory_id || null,
        qtd_anuncio: n(v.available_quantity), qtd_armazem: arm, total_armazem: tot, nao_disponivel: naoDisp || null, status_anuncio: it.status, atualizado_em: new Date().toISOString() });
    }
    if (linhas.length) { const { error } = await supabase.from('full_estoque_cache').upsert(linhas, { onConflict: 'anuncio,cor,tam' }); if (!error) gravadas += linhas.length; }
    await pausa(100);
  }
  return res.status(200).json({ ok: true, anuncios: ids.length, variacoes, consultas_armazem: consultas, gravadas, sem_ref: semRef, segundos: Math.round((Date.now() - inicio) / 1000) });
}
