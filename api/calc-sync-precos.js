/**
 * calc-sync-precos.js — traz o preço de VENDA dos anúncios (Shopee/TikTok)
 * pra dentro da calculadora (Ailson 10/08/2026).
 *
 * Regra dele: nesses dois canais a PLATAFORMA manda — o valor correto é o
 * preço de venda do anúncio, NUNCA o de promoção. Mercado Livre fica de fora
 * (lá é o contrário: ele ajusta o anúncio na mão pra bater com a calculadora).
 *
 * A calculadora guarda preços em amicia_data(calc-meluni).payload.prs como
 * um mapa plano { "REF|canal": preco }.
 *
 * GET ?canal=shopee|tiktok    -> DRY-RUN (só lista as diferenças)
 *     &aplicar=1              -> grava (com backup em calc_precos_backup)
 *     &cru=1                  -> amostra crua da API (diagnóstico)
 *
 * Shopee: mesma lógica do comparador (precos-divergencia): original_price
 * (preço normal) com fallback current_price; item com variação busca os
 * models e usa o MENOR preço normal. REF via ml_scf_ref_map / ml_sku_ref_map.
 * TikTok: /product/202309/products/search; REF via tts_sku_ref_map,
 * construído cruzando line_items dos pedidos TikTok com os itens do Bling
 * (numero_pedido_loja) — pedidos de 1 item só, pra não ter ambiguidade.
 */
import { supabase } from './_bling-helpers.js';
import { authShopee, chamarShopee } from './_shopee-api.js';
import { authTts, chamarTts } from './_tts-api.js';

export const config = { maxDuration: 300 };
const num = (x) => { const v = Number(x); return Number.isFinite(v) && v > 0 ? v : 0; };
const nRef = (r) => String(r || '').trim().replace(/^0+/, '').toLowerCase();

async function precosShopee(raw) {
  const a = await authShopee('exitus');
  if (a.erro) return { erro: a.erro };
  const { auth, ctx } = a;

  const ids = [];
  let offset = 0;
  for (let p = 0; p < 20; p++) {
    const d = await chamarShopee('/api/v2/product/get_item_list', {
      offset: String(offset), page_size: '50', item_status: 'NORMAL',
    }, auth, ctx);
    if (d.error) return { erro: `item_list: ${d.error} ${d.message || ''}` };
    (d.response?.item?.length ? d.response.item : []).forEach(i => ids.push(String(i.item_id)));
    if (!d.response?.has_next_page) break;
    offset = d.response?.next_offset ?? (offset + 50);
  }

  const itens = [], semPreco = [], amostra = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await chamarShopee('/api/v2/product/get_item_base_info', {
      item_id_list: ids.slice(i, i + 50).join(','),
    }, auth, ctx);
    if (d.error) continue;
    for (const it of (d.response?.item_list || [])) {
      if (raw && amostra.length < 2) amostra.push(it);
      const pi = (it.price_info || [])[0] || {};
      const preco = num(pi.original_price) || num(pi.current_price);
      const skus = [it.item_sku, ...((it.model_list || []).map(m => m.model_sku))].filter(Boolean);
      if (!preco) { semPreco.push({ id: String(it.item_id), skus }); continue; }
      itens.push({ preco, skus });
    }
  }
  for (const it of semPreco) {
    const d = await chamarShopee('/api/v2/product/get_model_list', { item_id: it.id }, auth, ctx);
    if (d.error) continue;
    let melhor = null;
    const skus = [...it.skus];
    for (const m of (d.response?.model || [])) {
      const pi = (m.price_info || [])[0] || {};
      const p = num(pi.original_price) || num(pi.current_price);
      if (p && (melhor === null || p < melhor)) melhor = p;
      if (m.model_sku) skus.push(m.model_sku);
    }
    if (melhor) itens.push({ preco: melhor, skus });
  }

  const { data: scfMap } = await supabase.from('ml_scf_ref_map').select('scf, ref');
  const porScf = new Map((scfMap || []).map(m => [String(m.scf).trim().toLowerCase(), nRef(m.ref)]));
  const { data: skuMap } = await supabase.from('ml_sku_ref_map').select('sku, ref');
  const porSku = new Map((skuMap || []).map(m => [String(m.sku).trim().toLowerCase(), nRef(m.ref)]));

  const porRef = {};
  let semRef = 0;
  for (const it of itens) {
    let ref = null;
    for (const sk of it.skus) {
      const k = String(sk).trim().toLowerCase();
      ref = porScf.get(k) || porSku.get(k) || null;
      if (ref) break;
    }
    if (!ref) { semRef++; continue; }
    // vários anúncios da mesma REF: vale o MENOR preço de venda (conservador)
    if (!porRef[ref] || it.preco < porRef[ref]) porRef[ref] = it.preco;
  }
  return { porRef, semRef, anuncios: itens.length, amostra };
}

async function precosTikTok(raw) {
  const a = await authTts('exitus');
  if (a.erro) return { erro: a.erro };
  const { auth, ctx } = a;

  // 1. mapa seller_sku -> ref (cache em tts_sku_ref_map; completa pelos pedidos)
  const { data: mapaExistente } = await supabase.from('tts_sku_ref_map').select('seller_sku, ref');
  const mapa = new Map((mapaExistente || []).map(m => [m.seller_sku, nRef(m.ref)]));

  if (mapa.size < 5) {
    // constrói cruzando pedidos TikTok (line_items) com o Bling (itens.ref) —
    // só pedidos de UM item, pra não ter dúvida de qual sku é qual ref
    const fim = Math.floor(Date.now() / 1000);
    const ini = fim - 90 * 86400;
    let token = null, ids = [];
    for (let p = 0; p < 10; p++) {
      const pg = await chamarTts('/order/202309/orders/search',
        { page_size: '50', ...(token ? { page_token: token } : {}) }, auth, ctx,
        { method: 'POST', body: { create_time_ge: ini, create_time_lt: fim } });
      if (pg?.code !== 0) break;
      (pg.data?.orders || []).forEach(o => ids.push(o.id));
      token = pg.data?.next_page_token;
      if (!token) break;
    }
    const skuPorPedido = {};
    for (let i = 0; i < ids.length; i += 50) {
      const det = await chamarTts('/order/202309/orders', { ids: ids.slice(i, i + 50).join(',') }, auth, ctx);
      if (det?.code !== 0) continue;
      for (const o of (det.data?.orders || [])) {
        const its = o.line_items || [];
        if (its.length === 1 && its[0].seller_sku) skuPorPedido[String(o.id)] = String(its[0].seller_sku);
      }
    }
    const nums = Object.keys(skuPorPedido);
    for (let i = 0; i < nums.length; i += 100) {
      const { data: blg } = await supabase.from('bling_vendas_detalhe')
        .select('numero_pedido_loja, itens').in('numero_pedido_loja', nums.slice(i, i + 100));
      for (const b of (blg || [])) {
        const its = b.itens || [];
        if (its.length !== 1) continue;
        const ref = nRef(its[0].ref);
        const sku = skuPorPedido[String(b.numero_pedido_loja)];
        if (ref && sku && !mapa.has(sku)) {
          mapa.set(sku, ref);
          await supabase.from('tts_sku_ref_map').upsert({ seller_sku: sku, ref }, { onConflict: 'seller_sku' });
        }
      }
    }
  }

  // 2. produtos + preço de VENDA por sku
  const porRef = {};
  let semRef = 0, anuncios = 0;
  const amostra = [];
  let token = null;
  for (let p = 0; p < 20; p++) {
    const d = await chamarTts('/product/202309/products/search',
      { page_size: '50', ...(token ? { page_token: token } : {}) }, auth, ctx,
      { method: 'POST', body: { status: 'ACTIVATE' } });
    if (d?.code !== 0) return { erro: `products/search code ${d?.code}: ${d?.message}`, amostra };
    for (const prod of (d.data?.products || [])) {
      if (raw && amostra.length < 2) amostra.push(prod);
      anuncios++;
      for (const sku of (prod.skus || [])) {
        // preço de VENDA (tabela do anúncio), nunca o promocional
        const pr = sku.price || {};
        const preco = num(pr.original_price) || num(pr.tax_exclusive_price) || num(pr.sale_price);
        if (!preco) continue;
        const ref = mapa.get(String(sku.seller_sku || ''));
        if (!ref) { semRef++; continue; }
        if (!porRef[ref] || preco < porRef[ref]) porRef[ref] = preco;
      }
    }
    token = d.data?.next_page_token;
    if (!token) break;
  }
  return { porRef, semRef, anuncios, amostra, mapa_skus: mapa.size };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const canal = String(req.query?.canal || '').toLowerCase();
  if (!['shopee', 'tiktok'].includes(canal)) {
    return res.status(400).json({ erro: "use ?canal=shopee ou ?canal=tiktok (Mercado Livre fica de fora — lá o ajuste é manual, no anúncio)" });
  }
  const aplicar = req.query?.aplicar === '1';
  const raw = req.query?.cru === '1';

  try {
    const r = canal === 'shopee' ? await precosShopee(raw) : await precosTikTok(raw);
    if (r.erro) return res.status(400).json(r);
    if (raw) return res.status(200).json({ canal, amostra: r.amostra, refs_com_preco: Object.keys(r.porRef).length });

    const { data: calc } = await supabase.from('amicia_data')
      .select('payload').eq('user_id', 'calc-meluni').single();
    const prs = calc?.payload?.prs || {};

    const mudancas = {};
    const iguais = [];
    for (const [ref, precoNovo] of Object.entries(r.porRef)) {
      const chave = `${ref}|${canal}`;
      const atual = num(prs[chave]);
      if (Math.abs(atual - precoNovo) < 0.01) { iguais.push(ref); continue; }
      mudancas[chave] = { de: atual || null, para: precoNovo };
    }

    if (!aplicar) {
      return res.status(200).json({
        canal, modo: 'DRY-RUN — nada foi alterado',
        anuncios_lidos: r.anuncios, refs_encontradas: Object.keys(r.porRef).length,
        skus_sem_ref: r.semRef, ja_iguais: iguais.length,
        diferencas: Object.keys(mudancas).length, mudancas,
        aplicar: `chame com &aplicar=1 pra gravar (backup automático)`,
      });
    }

    if (Object.keys(mudancas).length) {
      await supabase.from('calc_precos_backup').insert({ canal, mudancas, prs_antes: prs });
      const novoPrs = { ...prs };
      for (const [chave, m] of Object.entries(mudancas)) novoPrs[chave] = m.para;
      const novoPayload = { ...calc.payload, prs: novoPrs };
      const { error } = await supabase.from('amicia_data')
        .update({ payload: novoPayload }).eq('user_id', 'calc-meluni');
      if (error) throw new Error(error.message);
    }
    return res.status(200).json({ ok: true, canal, aplicadas: Object.keys(mudancas).length, mudancas });
  } catch (e) {
    return res.status(500).json({ erro: e.message || 'erro interno' });
  }
}
