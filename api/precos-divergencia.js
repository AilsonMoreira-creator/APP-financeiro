/**
 * precos-divergencia.js — compara o preço PRATICADO nos anúncios com o preço
 * DEFINIDO na calculadora, por REF (Ailson 08/08/2026).
 *
 * Regras combinadas:
 *  - Uma REF pode ter até 3 anúncios. Vale o MENOR preço praticado.
 *  - Se o produto está em campanha/promoção, considera o preço NORMAL
 *    (ML: original_price quando existe; Shopee: price_info.original_price).
 *  - Divergência = diferença de mais de 2% (pra cima ou pra baixo) contra a
 *    calculadora. Abaixo disso é ruído de arredondamento.
 *
 * Fontes:
 *  - Mercado Livre Exitus: /users/{seller}/items/search + /items?ids= (token de
 *    ml_tokens). REF vem de ml_reviews_mlb_map (mlb→ref) e, no que faltar, do
 *    seller_custom_field/SKU via ml_sku_ref_map e ml_scf_ref_map.
 *  - Shopee Exitus: product.get_item_list + product.get_item_base_info. REF vem
 *    do item_sku (e do model_sku quando o item não tem).
 *  - Calculadora: amicia_data user_id='calc-meluni', payload.prs, chave
 *    "REF|canal" (mercadolivre | shopee).
 *
 * Query:
 *   ?canal=ml|shopee|todos   (default todos)
 *   ?tol=2                   tolerância em % (default 2)
 *   ?cru=1                   inclui a lista de anúncios por REF
 */
import { supabase } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';
import { authShopee, chamarShopee } from './_shopee-api.js';

export const config = { maxDuration: 300 };

// REF sem zero à esquerda — regra do app inteiro
const nRef = (r) => String(r ?? '').trim().replace(/^0+/, '') || '';
const num = (x) => { const v = Number(x); return Number.isFinite(v) && v > 0 ? v : null; };

// ── Calculadora ────────────────────────────────────────────────────────────
async function precosCalculadora() {
  const { data } = await supabase.from('amicia_data').select('payload').eq('user_id', 'calc-meluni').maybeSingle();
  const prs = data?.payload?.prs || {};
  const prods = data?.payload?.prods || [];
  const desc = {};
  for (const p of prods) desc[nRef(p.ref)] = p.descricao || null;
  const out = { mercadolivre: {}, shopee: {} };
  for (const [k, v] of Object.entries(prs)) {
    const [refBruta, canal] = String(k).split('|');
    if (!canal || !(canal in out)) continue;
    const preco = num(v);
    if (!preco) continue;
    const ref = nRef(refBruta);
    if (!ref) continue;
    // se a mesma REF aparecer com e sem sufixo, fica o menor (é o praticado)
    if (!out[canal][ref] || preco < out[canal][ref]) out[canal][ref] = preco;
  }
  return { precos: out, desc };
}

// ── Mercado Livre ──────────────────────────────────────────────────────────
async function anunciosML(brand = 'Exitus') {
  const token = await getValidToken(brand);
  const { data: tok } = await supabase.from('ml_tokens').select('seller_id').eq('brand', brand).maybeSingle();
  const seller = tok?.seller_id;
  if (!seller) return { erro: `sem seller_id pra ${brand}` };

  // 1. todos os ids de anúncio do vendedor (paginado por scroll_id)
  const ids = [];
  let scroll = null;
  for (let i = 0; i < 20; i++) {
    const u = new URL(`https://api.mercadolibre.com/users/${seller}/items/search`);
    u.searchParams.set('limit', '100');
    u.searchParams.set('search_type', 'scan');
    if (scroll) u.searchParams.set('scroll_id', scroll);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return { erro: `items/search ${r.status}` };
    const d = await r.json();
    (d.results || []).forEach(x => ids.push(x));
    scroll = d.scroll_id;
    if (!scroll || !(d.results || []).length) break;
  }
  if (!ids.length) return { erro: 'nenhum anúncio' };

  // 2. detalhe em lote de 20
  const itens = [];
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20).join(',');
    const r = await fetch(`https://api.mercadolibre.com/items?ids=${lote}&attributes=id,title,price,original_price,status,seller_custom_field,variations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) continue;
    const d = await r.json();
    for (const w of (d || [])) {
      const b = w.body || w;
      if (!b?.id) continue;
      if (b.status && b.status !== 'active') continue;      // só anúncio no ar
      // preço NORMAL: se está em promoção, o de tabela é o original_price
      const preco = num(b.original_price) || num(b.price);
      if (!preco) continue;
      const skus = [b.seller_custom_field, ...((b.variations || []).map(v => v.seller_custom_field))].filter(Boolean);
      itens.push({ id: b.id, titulo: b.title, preco, promo: !!num(b.original_price), skus });
    }
  }

  // 3. MLB -> REF (mapa dos reviews primeiro, SKU depois)
  const { data: mapa } = await supabase.from('ml_reviews_mlb_map').select('mlb_id, ref').eq('brand', brand);
  const porMlb = new Map((mapa || []).map(m => [m.mlb_id, nRef(m.ref)]));
  const { data: skuMap } = await supabase.from('ml_sku_ref_map').select('sku, ref');
  const porSku = new Map((skuMap || []).map(m => [String(m.sku), nRef(m.ref)]));
  const { data: scfMap } = await supabase.from('ml_scf_ref_map').select('scf, ref');
  const porScf = new Map((scfMap || []).map(m => [String(m.scf), nRef(m.ref)]));

  const porRef = {};
  const semRef = [];
  for (const it of itens) {
    let ref = porMlb.get(it.id) || null;
    if (!ref) for (const s of it.skus) { ref = porSku.get(String(s)) || porScf.get(String(s)) || null; if (ref) break; }
    if (!ref) { semRef.push({ id: it.id, titulo: it.titulo, preco: it.preco, skus: it.skus }); continue; }
    (porRef[ref] || (porRef[ref] = [])).push(it);
  }
  return { porRef, semRef, anuncios: itens.length };
}

// ── Shopee ─────────────────────────────────────────────────────────────────
async function anunciosShopee(conta = 'exitus', raw = false) {
  const a = await authShopee(conta);
  if (a.erro) return { erro: a.erro, detalhe: a.detalhe };
  const { auth, ctx } = a;

  // 1. ids dos itens NORMAL (no ar)
  const ids = [];
  let offset = 0;
  for (let i = 0; i < 20; i++) {
    const d = await chamarShopee('/api/v2/product/get_item_list', {
      offset: String(offset), page_size: '100', item_status: 'NORMAL',
    }, auth, ctx);
    if (d.error) return { erro: `get_item_list ${d.error}`, mensagem: d.message };
    const lote = d.response?.item || [];
    lote.forEach(x => ids.push(x.item_id));
    if (!d.response?.has_next_page) break;
    offset = d.response?.next_offset ?? (offset + lote.length);
  }
  if (!ids.length) return { erro: 'nenhum item' };

  // 2. base info em lote de 50 (traz price_info e item_sku)
  const itens = [];
  const semPreco = [];
  const amostra = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await chamarShopee('/api/v2/product/get_item_base_info', {
      item_id_list: ids.slice(i, i + 50).join(','),
    }, auth, ctx);
    if (d.error) { if (raw && amostra.length < 2) amostra.push({ etapa: 'base_info', erro: d.error, msg: d.message }); continue; }
    for (const it of (d.response?.item_list || [])) {
      if (raw && amostra.length < 2) amostra.push(it);
      const pi = (it.price_info || [])[0] || {};
      const preco = num(pi.original_price) || num(pi.current_price);
      const skus = [it.item_sku, ...((it.model_list || []).map(m => m.model_sku))].filter(Boolean);
      if (!preco) { semPreco.push({ id: String(it.item_id), titulo: it.item_name, skus }); continue; }
      itens.push({
        id: String(it.item_id), titulo: it.item_name, preco,
        promo: num(pi.current_price) && num(pi.original_price) ? Number(pi.current_price) < Number(pi.original_price) : false,
        skus,
      });
    }
  }

  // Item com VARIAÇÃO (cor/tamanho) não traz price_info no base_info — o preço
  // mora em cada model. Busca modelo por modelo e usa o MENOR preço normal.
  for (const it of semPreco) {
    const d = await chamarShopee('/api/v2/product/get_model_list', { item_id: it.id }, auth, ctx);
    if (raw && amostra.length < 4) amostra.push({ etapa: 'model_list', item: it.id, resp: d.response || d });
    if (d.error) continue;
    const models = d.response?.model || [];
    let melhor = null, emPromo = false;
    const skus = [...it.skus];
    for (const m of models) {
      const pi = (m.price_info || [])[0] || {};
      const p = num(pi.original_price) || num(pi.current_price);
      if (!p) continue;
      if (num(pi.current_price) && num(pi.original_price) && Number(pi.current_price) < Number(pi.original_price)) emPromo = true;
      if (melhor === null || p < melhor) melhor = p;
      if (m.model_sku) skus.push(m.model_sku);
    }
    if (melhor) itens.push({ id: it.id, titulo: it.titulo, preco: melhor, promo: emPromo, skus });
  }

  const porRef = {};
  const semRef = [];
  for (const it of itens) {
    // a REF é o começo do SKU da Shopee (ex "2671-MARROM-GG")
    let ref = null;
    for (const s of it.skus) {
      const m = String(s).match(/\d{3,5}/);
      if (m) { ref = nRef(m[0]); break; }
    }
    if (!ref) { semRef.push({ id: it.id, titulo: it.titulo, preco: it.preco, skus: it.skus }); continue; }
    (porRef[ref] || (porRef[ref] = [])).push(it);
  }
  return { porRef, semRef, anuncios: itens.length, ...(raw ? { amostra } : {}) };
}

// ── Comparação ─────────────────────────────────────────────────────────────
function comparar(porRef, precosCalc, desc, tol) {
  const linhas = [];
  for (const [ref, lista] of Object.entries(porRef)) {
    const menor = lista.reduce((a, b) => (b.preco < a.preco ? b : a));
    const calc = precosCalc[ref] || null;
    if (!calc) {
      linhas.push({ ref, descricao: desc[ref] || null, praticado: menor.preco, calculadora: null, dif_pct: null, situacao: 'sem preço na calculadora', anuncios: lista.length, anuncio: menor.id, titulo: menor.titulo, promo: menor.promo });
      continue;
    }
    const dif = ((menor.preco - calc) / calc) * 100;
    linhas.push({
      ref, descricao: desc[ref] || null,
      praticado: Math.round(menor.preco * 100) / 100, calculadora: calc,
      dif_pct: Math.round(dif * 10) / 10,
      situacao: Math.abs(dif) <= tol ? 'ok' : (dif < 0 ? 'ABAIXO da calculadora' : 'acima da calculadora'),
      anuncios: lista.length, anuncio: menor.id, titulo: menor.titulo, promo: menor.promo,
    });
  }
  // pior divergência primeiro (o que está vendendo barato demais no topo)
  linhas.sort((a, b) => (a.dif_pct ?? 999) - (b.dif_pct ?? 999));
  return linhas;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const canal = ['ml', 'shopee', 'todos'].includes(req.query?.canal) ? req.query.canal : 'todos';
  const tol = Math.max(0, parseFloat(req.query?.tol) || 2);
  const cru = req.query?.cru === '1';

  try {
    const { precos, desc } = await precosCalculadora();
    const out = { ok: true, tolerancia_pct: tol, gerado_em: new Date().toISOString() };

    if (canal === 'ml' || canal === 'todos') {
      const ml = await anunciosML('Exitus');
      if (ml.erro) out.mercado_livre = { erro: ml.erro };
      else {
        const linhas = comparar(ml.porRef, precos.mercadolivre, desc, tol);
        out.mercado_livre = {
          anuncios: ml.anuncios, refs: Object.keys(ml.porRef).length,
          anuncios_sem_ref: ml.semRef.length,
          divergentes: linhas.filter(l => l.situacao !== 'ok' && l.calculadora),
          sem_preco_calc: linhas.filter(l => !l.calculadora).map(l => l.ref),
          ok: linhas.filter(l => l.situacao === 'ok').length,
          ...(cru ? { todas: linhas, sem_ref: ml.semRef } : {}),
        };
      }
    }

    if (canal === 'shopee' || canal === 'todos') {
      const sh = await anunciosShopee('exitus', req.query?.raw === '1');
      if (sh.erro) out.shopee = { erro: sh.erro, mensagem: sh.mensagem, detalhe: sh.detalhe };
      else {
        const linhas = comparar(sh.porRef, precos.shopee, desc, tol);
        out.shopee = {
          anuncios: sh.anuncios, refs: Object.keys(sh.porRef).length,
          anuncios_sem_ref: sh.semRef.length,
          divergentes: linhas.filter(l => l.situacao !== 'ok' && l.calculadora),
          sem_preco_calc: linhas.filter(l => !l.calculadora).map(l => l.ref),
          ok: linhas.filter(l => l.situacao === 'ok').length,
          ...(cru ? { todas: linhas, sem_ref: sh.semRef } : {}),
          ...(sh.amostra ? { amostra: sh.amostra } : {}),
        };
      }
    }

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e.message });
  }
}
