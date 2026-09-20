/**
 * ml-sale.js — "Sale": sugestão de promoções do Mercado Livre por REF (Ailson, 19/09/2026).
 *
 * GET  ?ref=2277&conta=exitus         -> anúncios da REF (agrupados por família) + promoções ordenadas + verde
 *      &atualizar=1                    -> força releitura no ML (anúncios e promoções)
 * GET  ?badges=1&conta=exitus          -> { ref: {campanha:bool, relampago:bool} } pra pintar o botão dos cards
 * GET  ?log=1&ref=2277                 -> histórico (quem entrou / marcou visto)
 * GET  ?sync=promocoes&conta=exitus    -> cron: carrega os itens da próxima promoção da conta (rodízio)
 * GET  ?sync=anuncios&conta=exitus     -> cron: varre os anúncios ativos da conta e atualiza o cache
 * POST {acao:'config', ref, campanha_pct, relampago_pct}
 * POST {acao:'visto', conta, ref, item_ids, promo_key}
 * POST {acao:'entrar', conta, ref, promo_key, tipo, promo_id, itens:[{item_id, deal_price, stock}]}
 * Usuário vem no header X-User (mesma convenção do app).
 */
import { supabase } from './_ml-helpers.js';
import {
  brandDe, sellerIdDe, tokenDe, mlGet, mlPost, normRef, anunciosDaRef, carregarAnuncios,
  carregarPromocoesDoItem, normalizarPromo, agrupar, configDaRef, registrarLog, SUBMETE_PERMITIDO, promocoesDaConta, faixaEfetiva, CONTAS,
} from './_ml-sale-lib.js';

export const config = { maxDuration: 60 };

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
}

// Vendas dos ultimos 7 dias POR ANUNCIO (item_id gravado em ml_pedido_taxas.itens desde 20/09;
// pedidos antigos sem item_id sao completados pelo backfill ?backfill_itens=1)
async function vendas7dPorItem(conta) {
  const desde = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase.from('ml_pedido_taxas').select('itens').eq('conta', String(conta).toLowerCase()).gte('data_pedido', desde).limit(5000);
  const m = {};
  for (const r of data || []) for (const it of (Array.isArray(r.itens) ? r.itens : [])) { const id = String(it?.item_id || ''); if (id) m[id] = (m[id] || 0) + (Number(it?.qtd) || 1); }
  return m;
}

// Completa item_id nos pedidos dos ultimos 7 dias lendo /orders/search do ML (uma vez)
async function backfillItens(conta) {
  const c = String(conta).toLowerCase(); const t0 = Date.now();
  const token = await tokenDe(c); const sid = await sellerIdDe(c);
  const desde = new Date(Date.now() - 8 * 86400000).toISOString();
  let offset = 0, lidos = 0, atualizados = 0;
  const { data: rows } = await supabase.from('ml_pedido_taxas').select('id, ml_order_id, pedido_id, itens').eq('conta', c).gte('data_pedido', desde.slice(0, 10)).limit(5000);
  const porOrder = {};
  for (const r of rows || []) { if (r.ml_order_id) porOrder[String(r.ml_order_id)] = r; }
  while (Date.now() - t0 < 45000) {
    const r = await mlGet(token, `/orders/search?seller=${sid}&order.date_created.from=${encodeURIComponent(desde)}&limit=51&offset=${offset}&sort=date_desc`);
    if (!r.ok) break;
    const ords = r.body?.results || []; lidos += ords.length;
    for (const o of ords) {
      const row = porOrder[String(o.id)]; if (!row || !Array.isArray(row.itens)) continue;
      if (row.itens.every(it => it.item_id)) continue;
      const ids = (o.order_items || []).map(it => ({ item_id: it.item?.id, sku: it.item?.seller_sku || it.item?.seller_custom_field }));
      const novos = row.itens.map(it => { if (it.item_id) return it; const m = ids.find(x => x.sku && x.sku === it.sku) || (ids.length === 1 ? ids[0] : null); return m ? { ...it, item_id: m.item_id } : it; });
      await supabase.from('ml_pedido_taxas').update({ itens: novos }).eq('id', row.id); atualizados++;
    }
    offset += 51; if (!ords.length || offset >= (r.body?.paging?.total || 0)) break;
  }
  return { ok: true, lidos, atualizados };
}

async function respostaDaRef(conta, ref, { atualizar = false } = {}) {
  const c = String(conta).toLowerCase(); const r = normRef(ref);
  let anuncios = await anunciosDaRef(c, r, { forcar: atualizar });
  if (atualizar && anuncios.length) {
    const token = await tokenDe(c);
    anuncios = await carregarAnuncios(c, token, anuncios.map(a => a.item_id));
    anuncios = anuncios.map(a => (a.ref ? a : { ...a, ref: r })).filter(a => a.ref === r);
    for (const a of anuncios) await carregarPromocoesDoItem(c, token, a.item_id, a.price);
  } else if (anuncios.length) {
    // promoções nunca lidas pra algum anúncio? lê agora (primeira abertura)
    const { data: temPromo } = await supabase.from('ml_sale_promocoes').select('item_id').eq('conta', c).in('item_id', anuncios.map(a => a.item_id));
    const com = new Set((temPromo || []).map(x => x.item_id));
    const faltam = anuncios.filter(a => !com.has(a.item_id));
    if (faltam.length) { const token = await tokenDe(c); for (const a of faltam) await carregarPromocoesDoItem(c, token, a.item_id, a.price); }
  }
  const ids = anuncios.map(a => a.item_id);
  const { data: promos } = ids.length ? await supabase.from('ml_sale_promocoes').select('*').eq('conta', c).in('item_id', ids) : { data: [] };
  const cfg = await configDaRef(r);
  const grupos = agrupar(anuncios, promos || [], cfg);
  // completa nome e prazo de aceite pela lista da conta
  try {
    const mapa = await promocoesDaConta(c, await tokenDe(c));
    for (const g of grupos) for (const p of g.promocoes) { const m = p.promo_id && mapa[p.promo_id]; if (m) { p.nome = p.nome || m.nome; p.deadline_date = p.deadline_date || m.deadline_date; p.start_date = p.start_date || m.start_date; p.finish_date = p.finish_date || m.finish_date; } }
  } catch {}
  const vendas = await vendas7dPorItem(c);
  // Full: o shipping.logistic_type do anuncio nem sempre diz "fulfillment" (o MLB4919060970
  // da 2601 tem 2.361 pecas no Full e vem "cross_docking"). A fonte certa e o inventario
  // do Full que o modulo Full ja mantem (ml_estoque_ref_atual.mlbs_encontrados).
  const fullPorItem = {};
  try {
    const { data: fa } = await supabase.from('ml_estoque_ref_atual').select('mlbs_encontrados').in('ref', [r, r.padStart(4, '0'), r.padStart(5, '0')]);
    for (const row of fa || []) for (const m of (Array.isArray(row.mlbs_encontrados) ? row.mlbs_encontrados : [])) if (m?.item_id) fullPorItem[m.item_id] = Number(m.total) || 0;
  } catch {}
  for (const g of grupos) {
    g.vendas_7d = g.filhos.reduce((s, f) => s + (vendas[f.item_id] || 0), 0);
    for (const f of g.filhos) { f.vendas_7d = vendas[f.item_id] || 0; if (fullPorItem[f.item_id] != null) { f.full_qtd = fullPorItem[f.item_id]; f.logistic_type = 'fulfillment'; } delete f.promocoes; }
    g.full_qtd = g.filhos.reduce((s, f) => s + (f.full_qtd || 0), 0);
    g.full = g.full || g.filhos.some(f => f.logistic_type === 'fulfillment');
  }
  return { ok: true, conta: c, ref: r, config: cfg, faixa: faixaEfetiva(cfg), grupos, submete: SUBMETE_PERMITIDO.includes(c), lido_em: new Date().toISOString() };
}

async function badges(conta) {
  const c = String(conta).toLowerCase();
  if (c === 'todas') {
    const out = {};
    for (const k of Object.keys(CONTAS)) { const b = await badges(k); for (const [ref, v] of Object.entries(b)) { out[ref] = out[ref] || { campanha: false, relampago: false, contas: [] }; out[ref].campanha ||= v.campanha; out[ref].relampago ||= v.relampago; out[ref].contas.push(k); } }
    return out;
  }
  const { data: cfgsDb } = await supabase.from('ml_sale_config').select('*');
  const cfgPorRef = Object.fromEntries((cfgsDb || []).map(x => [x.ref, x]));
  const { data: anuncios } = await supabase.from('ml_sale_anuncios').select('item_id, ref, family_id, family_name, title, status, price, capa, thumbnail, available_quantity, logistic_type, sku, skus').eq('conta', c).not('ref', 'is', null).limit(5000);
  if (!anuncios?.length) return {};
  const cfgs = [...new Set(anuncios.map(a => a.ref))].map(ref => cfgPorRef[ref] || { ref });   // sem config = faixa padrao
  const ids = anuncios.map(a => a.item_id);
  const promos = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await supabase.from('ml_sale_promocoes').select('item_id, promo_key, promo_id, tipo, nome, status, price, original_price, seller_pct, meli_pct, min_price, max_price, suggested_price, stock_min, stock_max, stock_remaining, visto_em, start_date, finish_date, deadline_date').eq('conta', c).in('item_id', ids.slice(i, i + 300));
    promos.push(...(data || []));
  }
  const porRef = {};
  for (const a of anuncios) (porRef[a.ref] = porRef[a.ref] || []).push(a);
  const out = {};
  for (const cfg of cfgs) {
    const an = porRef[cfg.ref]; if (!an?.length) continue;
    const idset = new Set(an.map(a => a.item_id));
    const gs = agrupar(an, promos.filter(p => idset.has(p.item_id)), cfg);
    const camp = gs.some(g => g.verde_campanha), rel = gs.some(g => g.verde_relampago);
    if (camp || rel) out[cfg.ref] = { campanha: camp, relampago: rel };
  }
  return out;
}

// ── cron: promoções em lote (uma promoção por chamada, rodízio) ──────────────
async function syncPromocoes(conta, orcamentoMs = 45000) {
  const c = String(conta).toLowerCase(); const t0 = Date.now();
  const token = await tokenDe(c); const sid = await sellerIdDe(c);
  const lista = await mlGet(token, `/seller-promotions/users/${sid}?app_version=v2`);
  const promos = (lista.body?.results || []).filter(p => p.id && p.type && p.status !== 'finished');
  if (!promos.length) return { ok: true, promos: 0 };
  const { data: est } = await supabase.from('ml_sale_sync_estado').select('*').eq('conta', c).maybeSingle();
  const idx = ((est?.proxima_promo || 0) % promos.length);
  const p = promos[idx];
  let offset = 0, total = 0, gravadas = 0, paginas = 0;
  const { data: cacheIds } = await supabase.from('ml_sale_anuncios').select('item_id, price').eq('conta', c).limit(20000);
  const conhecidos = Object.fromEntries((cacheIds || []).map(x => [x.item_id, x.price]));
  while (Date.now() - t0 < orcamentoMs) {
    const r = await mlGet(token, `/seller-promotions/promotions/${p.id}/items?promotion_type=${p.type}&app_version=v2&limit=50&offset=${offset}`);
    if (!r.ok) break;
    const itens = r.body?.results || []; total = r.body?.paging?.total || total; paginas++;
    const linhas = [];
    for (const it of itens) {
      if (!conhecidos.hasOwnProperty(it.id)) continue;  // só anúncios que a gente conhece (com REF)
      linhas.push(normalizarPromo(c, it.id, { ...it, id: p.id, type: p.type, name: p.name, deadline_date: p.deadline_date, start_date: it.start_date || p.start_date, finish_date: it.finish_date || it.end_date || p.finish_date }, conhecidos[it.id]));
    }
    if (linhas.length) {
      // preserva visto
      const { data: exist } = await supabase.from('ml_sale_promocoes').select('item_id, visto_em, visto_por').eq('conta', c).eq('promo_key', p.id).in('item_id', linhas.map(l => l.item_id));
      const v = Object.fromEntries((exist || []).map(x => [x.item_id, x]));
      for (const l of linhas) if (v[l.item_id]) { l.visto_em = v[l.item_id].visto_em; l.visto_por = v[l.item_id].visto_por; }
      await supabase.from('ml_sale_promocoes').upsert(linhas, { onConflict: 'conta,item_id,promo_key' });
      gravadas += linhas.length;
    }
    offset += 50;
    if (!itens.length || offset >= total) break;
  }
  const completa = offset >= total;
  await supabase.from('ml_sale_sync_estado').upsert({ conta: c, proxima_promo: completa ? idx + 1 : idx, ultima_lista: { promo: p.id, tipo: p.type, offset, total, gravadas, completa, em: new Date().toISOString() }, atualizado_em: new Date().toISOString() }, { onConflict: 'conta' });
  return { ok: true, promo: p.id, tipo: p.type, nome: p.name, total, gravadas, paginas, completa };
}

// ── cron: varredura dos anúncios ativos (scan) ───────────────────────────────
async function syncAnuncios(conta, orcamentoMs = 45000) {
  const c = String(conta).toLowerCase(); const t0 = Date.now();
  const token = await tokenDe(c); const sid = await sellerIdDe(c);
  const { data: est } = await supabase.from('ml_sale_sync_estado').select('*').eq('conta', c).maybeSingle();
  let scroll = est?.ultima_lista?.scroll_id || null;
  let lidos = 0, gravados = 0;
  while (Date.now() - t0 < orcamentoMs) {
    const q = scroll ? `&scroll_id=${encodeURIComponent(scroll)}` : '';
    const r = await mlGet(token, `/users/${sid}/items/search?status=active&search_type=scan&limit=100${q}`);
    if (!r.ok) break;
    const ids = r.body?.results || []; scroll = r.body?.scroll_id || scroll;
    if (!ids.length) { scroll = null; break; }
    lidos += ids.length;
    const g = await carregarAnuncios(c, token, ids); gravados += g.length;
  }
  await supabase.from('ml_sale_sync_estado').upsert({ conta: c, proxima_promo: est?.proxima_promo || 0, ultima_lista: { ...(est?.ultima_lista || {}), scroll_id: scroll, anuncios_lidos: lidos, anuncios_em: new Date().toISOString() }, atualizado_em: new Date().toISOString() }, { onConflict: 'conta' });
  return { ok: true, lidos, gravados, continua: !!scroll };
}

// ── entrar numa promoção ─────────────────────────────────────────────────────
function corpoEntrada(tipo, promoId, it) {
  const t = String(tipo || '').toUpperCase();
  if (t === 'LIGHTNING') return { deal_price: it.deal_price, stock: it.stock, promotion_type: 'LIGHTNING' };
  if (t === 'DEAL' || t === 'DOD') return { deal_price: it.deal_price, promotion_id: promoId, promotion_type: t };
  if (t === 'PRICE_DISCOUNT') return { deal_price: it.deal_price, promotion_type: 'PRICE_DISCOUNT' };
  // SMART, PRICE_MATCHING, UNHEALTHY_STOCK, MARKETPLACE_CAMPAIGN, BANK…: aceite do convite
  return { promotion_id: promoId, promotion_type: t };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const usuario = String(req.headers['x-user'] || '').trim() || null;
  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const conta = String(q.conta || 'exitus').toLowerCase();
      if (!brandDe(conta) && !((q.badges || q.sync) && conta === 'todas')) return res.status(400).json({ ok: false, erro: 'conta inválida' });
      if (q.backfill_itens) return res.status(200).json(await backfillItens(conta));
      // 'todas' = as 3 contas numa chamada so (limite de crons do Vercel): ~15s cada
      if (q.sync === 'promocoes') { if (conta === 'todas') { const out = {}; for (const k of Object.keys(CONTAS)) { try { out[k] = await syncPromocoes(k, 15000); } catch (e) { out[k] = { ok: false, erro: String(e?.message || e) }; } } return res.status(200).json({ ok: true, contas: out }); } return res.status(200).json(await syncPromocoes(conta)); }
      if (q.sync === 'anuncios') { if (conta === 'todas') { const out = {}; for (const k of Object.keys(CONTAS)) { try { out[k] = await syncAnuncios(k, 15000); } catch (e) { out[k] = { ok: false, erro: String(e?.message || e) }; } } return res.status(200).json({ ok: true, contas: out }); } return res.status(200).json(await syncAnuncios(conta)); }
      if (q.badges) return res.status(200).json({ ok: true, conta, badges: await badges(conta) });
      if (q.log) {
        const { data } = await supabase.from('ml_sale_log').select('*').eq('ref', normRef(q.ref)).order('criado_em', { ascending: false }).limit(200);
        return res.status(200).json({ ok: true, log: data || [] });
      }
      if (q.ref) return res.status(200).json(await respostaDaRef(conta, q.ref, { atualizar: !!q.atualizar }));
      return res.status(400).json({ ok: false, erro: 'informe ref, badges, log ou sync' });
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      const acao = String(b.acao || '');
      const conta = String(b.conta || 'exitus').toLowerCase();
      const ref = normRef(b.ref);
      if (acao === 'config') {
        const linha = { ref, campanha_pct: b.campanha_pct === '' || b.campanha_pct == null ? null : Number(b.campanha_pct), relampago_pct: b.relampago_pct === '' || b.relampago_pct == null ? null : Number(b.relampago_pct), atualizado_por: usuario, atualizado_em: new Date().toISOString() };
        const { error } = await supabase.from('ml_sale_config').upsert(linha, { onConflict: 'ref' });
        if (error) throw error;
        await registrarLog({ conta, ref, acao: 'config', usuario, detalhe: { campanha_pct: linha.campanha_pct, relampago_pct: linha.relampago_pct } });
        return res.status(200).json({ ok: true, config: linha });
      }
      if (acao === 'visto') {
        const ids = Array.isArray(b.item_ids) ? b.item_ids : [];
        if (!ids.length || !b.promo_key) return res.status(400).json({ ok: false, erro: 'item_ids e promo_key' });
        const { error } = await supabase.from('ml_sale_promocoes').update({ visto_em: new Date().toISOString(), visto_por: usuario }).eq('conta', conta).eq('promo_key', b.promo_key).in('item_id', ids);
        if (error) throw error;
        await registrarLog({ conta, ref, item_id: ids.length === 1 ? ids[0] : null, family_id: b.family_id || null, promo_key: b.promo_key, promo_nome: b.promo_nome || null, tipo: b.tipo || null, acao: 'visto', usuario, pct: b.pct ?? null, detalhe: { item_ids: ids } });
        return res.status(200).json({ ok: true });
      }
      if (acao === 'entrar') {
        if (!SUBMETE_PERMITIDO.includes(conta)) return res.status(403).json({ ok: false, erro: `submeter ainda não liberado pra ${conta}` });
        const itens = Array.isArray(b.itens) ? b.itens : [];
        if (!itens.length || !b.tipo) return res.status(400).json({ ok: false, erro: 'itens e tipo' });
        const token = await tokenDe(conta);
        const resultados = [];
        for (const it of itens) {
          const corpo = corpoEntrada(b.tipo, b.promo_id, it);
          const r = await mlPost(token, `/seller-promotions/items/${it.item_id}?app_version=v2`, corpo);
          const okItem = r.ok;
          resultados.push({ item_id: it.item_id, ok: okItem, http: r.http, resposta: r.body });
          await registrarLog({ conta, ref, item_id: it.item_id, family_id: b.family_id || null, promo_key: b.promo_key || null, promo_nome: b.promo_nome || null, tipo: b.tipo, acao: okItem ? 'entrou' : 'erro', usuario, pct: it.pct ?? null, preco: it.deal_price ?? null, qtd: it.stock ?? null, detalhe: { enviado: corpo, http: r.http, resposta: okItem ? r.body : (r.body?.message || r.body?.cause || r.body) } });
          try { await carregarPromocoesDoItem(conta, token, it.item_id, it.original_price); } catch {}
        }
        const okTodos = resultados.every(x => x.ok);
        return res.status(200).json({ ok: okTodos, resultados });
      }
      return res.status(400).json({ ok: false, erro: 'ação desconhecida' });
    }
    return res.status(405).json({ ok: false });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
