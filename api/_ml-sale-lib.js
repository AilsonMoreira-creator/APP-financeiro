/**
 * _ml-sale-lib.js — miolo do "Sale" (sugestão de promoções do Mercado Livre por REF).
 * Ailson, 19/09/2026. Usado por ml-sale.js (API/cron) e ml-webhook.js (candidatos/ofertas).
 *
 * Fontes no ML (todas app_version=v2):
 *   GET /seller-promotions/users/{seller}            -> promoções da conta
 *   GET /seller-promotions/items/{MLB}               -> promoções em que o anúncio está/pode entrar
 *   GET /seller-promotions/promotions/{id}/items     -> itens de uma promoção (carga em lote)
 *   POST /seller-promotions/items/{MLB}              -> entrar numa promoção
 *
 * Formatos de anúncio:
 *   antigo  = 1 MLB com variações (SKUs das variações apontam pra REF)
 *   novo    = 1 MLB por cor/tamanho, agrupados por family_id; o SKU do filho é o
 *             código da variação no Bling (ex.: I4f457jku7812) -> ml_sku_ref_map -> REF
 *
 * Regra do "%" (decisão dele): o que conta é o que sai do bolso do VENDEDOR no
 * MENOR desconto possível. seller_percentage quando o ML manda; senão calculado
 * de max_discounted_price (menor desconto) sobre original_price.
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const BASE = 'https://api.mercadolibre.com';
export const CONTAS = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
export const SUBMETE_PERMITIDO = ['exitus'];   // por enquanto só Exitus submete (decisão 19/09)

export function brandDe(conta) { return CONTAS[String(conta || '').toLowerCase()] || null; }

export async function sellerIdDe(conta) {
  const brand = brandDe(conta);
  const { data } = await supabase.from('ml_tokens').select('seller_id').eq('brand', brand).maybeSingle();
  return data?.seller_id ? String(data.seller_id) : null;
}

export async function tokenDe(conta) { return getValidToken(brandDe(conta)); }

export async function mlGet(token, path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = { _texto: t.slice(0, 300) }; }
  return { http: r.status, ok: r.ok, body: j };
}
export async function mlPost(token, path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = { _texto: t.slice(0, 300) }; }
  return { http: r.status, ok: r.ok, body: j };
}

// ── REF ↔ SKU ────────────────────────────────────────────────────────────────
export function normRef(ref) { return String(ref || '').trim().replace(/^0+(?=\d)/, ''); }

export async function skusDaRef(ref) {
  const r = normRef(ref);
  const cands = [...new Set([r, r.padStart(4, '0'), r.padStart(5, '0'), String(ref || '').trim()])].filter(Boolean);
  const { data } = await supabase.from('ml_sku_ref_map').select('sku, ref').in('ref', cands).limit(500);
  return [...new Set((data || []).map(x => String(x.sku)))];
}

export async function refsDosSkus(skus) {
  const lista = [...new Set((skus || []).filter(Boolean).map(String))];
  const out = {};
  for (let i = 0; i < lista.length; i += 200) {
    const { data } = await supabase.from('ml_sku_ref_map').select('sku, ref').in('sku', lista.slice(i, i + 200));
    for (const x of data || []) out[String(x.sku)] = normRef(x.ref);
  }
  return out;
}

// ── Anúncios ─────────────────────────────────────────────────────────────────
const ATTRS = 'id,title,price,thumbnail,pictures,status,listing_type_id,available_quantity,seller_custom_field,family_id,family_name,shipping,variations';

function montarAnuncio(conta, b, mapaRef) {
  const skus = [];
  if (b.seller_custom_field) skus.push(String(b.seller_custom_field));
  for (const v of b.variations || []) if (v.seller_custom_field) skus.push(String(v.seller_custom_field));
  let ref = null;
  for (const s of skus) { if (mapaRef[s]) { ref = mapaRef[s]; break; } }
  return {
    conta: String(conta).toLowerCase(), item_id: b.id,
    family_id: b.family_id != null ? String(b.family_id) : null, family_name: b.family_name || null,
    title: b.title || null, sku: b.seller_custom_field || null, skus: [...new Set(skus)], ref,
    price: b.price ?? null, capa: b.pictures?.[0]?.secure_url || b.pictures?.[0]?.url || null, thumbnail: b.thumbnail || null,
    status: b.status || null, listing_type: b.listing_type_id || null, logistic_type: b.shipping?.logistic_type || null,
    available_quantity: b.available_quantity ?? null, atualizado_em: new Date().toISOString(),
  };
}

// Busca vários anúncios de uma vez (multiget de 20) e grava no cache.
export async function carregarAnuncios(conta, token, ids) {
  const lista = [...new Set((ids || []).filter(Boolean))];
  const out = [];
  for (let i = 0; i < lista.length; i += 20) {
    const lote = lista.slice(i, i + 20);
    const r = await mlGet(token, `/items?ids=${lote.join(',')}&attributes=${ATTRS}`);
    if (!r.ok || !Array.isArray(r.body)) continue;
    const corpos = r.body.filter(x => x?.code === 200 && x.body?.id).map(x => x.body);
    // o multiget nem sempre traz as variacoes (anuncios grandes): busca uma a uma o que veio sem SKU
    for (const b of corpos) {
      if (!b.seller_custom_field && !(b.variations || []).some(v => v.seller_custom_field)) {
        const one = await mlGet(token, `/items/${b.id}?attributes=variations,seller_custom_field`);
        if (one.ok) { b.variations = one.body?.variations || b.variations; b.seller_custom_field = b.seller_custom_field || one.body?.seller_custom_field; }
      }
    }
    const todosSkus = corpos.flatMap(b => [b.seller_custom_field, ...(b.variations || []).map(v => v.seller_custom_field)]).filter(Boolean);
    const mapaRef = await refsDosSkus(todosSkus);
    for (const b of corpos) out.push(montarAnuncio(conta, b, mapaRef));
  }
  if (out.length) {
    // NUNCA apagar uma REF ja conhecida com null (aconteceu 20/09: a varredura das 02:20
    // sobrescreveu a REF dos anuncios do Full 2277/2601). Fontes de REF, em ordem:
    // SKU->ml_sku_ref_map, cache do Full (full_estoque_cache.anuncio->ref), valor que ja estava.
    const ids = out.map(a => a.item_id);
    const { data: exist } = await supabase.from('ml_sale_anuncios').select('item_id, ref').eq('conta', String(conta).toLowerCase()).in('item_id', ids);
    const { data: full } = await supabase.from('full_estoque_cache').select('anuncio, ref').in('anuncio', ids);
    const refExist = Object.fromEntries((exist || []).map(x => [x.item_id, x.ref]));
    const refFull = Object.fromEntries((full || []).filter(x => /^\d{3,6}$/.test(String(x.ref || '').trim())).map(x => [x.anuncio, normRef(x.ref)]));  // so REF numerica (o cache do Full tem linhas '?I81f…' que nao sao REF)
    for (const a of out) a.ref = a.ref || refFull[a.item_id] || refExist[a.item_id] || null;
    await supabase.from('ml_sale_anuncios').upsert(out, { onConflict: 'conta,item_id' });
  }
  return out;
}

// Anúncios de uma REF: cache; se vazio, descobre pelo SKU no ML e grava.
// A varredura de ativos do ML (search_type=scan) NAO e completa: o MLB5283859330 (Full
// da 2601, ativo, 568 pecas) nao vinha nela. Por isso, alem do cache, a REF e
// descoberta pelo SKU do vendedor: na primeira abertura, quando o cache da REF tem
// mais de 12h, e sempre no botao "atualizar".
export async function anunciosDaRef(conta, ref, { forcar = false } = {}) {
  const c = String(conta).toLowerCase();
  const r = normRef(ref);
  const { data: cache } = await supabase.from('ml_sale_anuncios').select('*').eq('conta', c).eq('ref', r);
  const maisNovo = Math.max(0, ...(cache || []).map(a => new Date(a.atualizado_em || 0).getTime()));
  if (!forcar && cache?.length && Date.now() - maisNovo < 12 * 3600000) return cache;
  const skus = await skusDaRef(r);
  if (!skus.length) return cache || [];
  const token = await tokenDe(c);
  const sid = await sellerIdDe(c);
  const ids = new Set((cache || []).map(a => a.item_id));
  // busca por SKU do vendedor (cobre filho do formato novo e variacao do antigo); orcamento de tempo
  const t0 = Date.now();
  for (const sku of skus) {
    if (Date.now() - t0 > 20000) break;
    const s = await mlGet(token, `/users/${sid}/items/search?seller_sku=${encodeURIComponent(sku)}&limit=50`);
    for (const id of s.body?.results || []) ids.add(id);
    if (ids.size >= 120) break;
  }
  if (!ids.size) return cache || [];
  const carregados = await carregarAnuncios(c, token, [...ids]);
  // garante a REF mesmo quando o mapa não tinha o SKU (veio da busca por SKU dela)
  const semRef = carregados.filter(a => !a.ref).map(a => ({ ...a, ref: r }));
  if (semRef.length) await supabase.from('ml_sale_anuncios').upsert(semRef, { onConflict: 'conta,item_id' });
  return carregados.map(a => (a.ref ? a : { ...a, ref: r })).filter(a => a.ref === r);
}

// ── Promoções por anúncio ────────────────────────────────────────────────────
function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function pct(orig, preco) { const o = num(orig), p = num(preco); if (!o || p == null) return null; return Math.round(((o - p) / o) * 10000) / 100; }
function dt(x) { if (!x) return null; const d = new Date(x); return isNaN(d) ? null : d.toISOString(); }

export function normalizarPromo(conta, itemId, p, origFallback) {
  const original = num(p.original_price) ?? num(origFallback);
  const tipo = p.type || null;
  const promoId = p.id || null;
  let seller = num(p.seller_percentage);
  let meli = num(p.meli_percentage) ?? 0;
  let price = num(p.price) || null;
  const maxP = num(p.max_discounted_price), minP = num(p.min_discounted_price), sugP = num(p.suggested_discounted_price);
  if (seller == null) {
    if (maxP != null) seller = pct(original, maxP);          // menor desconto possível (regra dele)
    else if (price != null) seller = pct(original, price);   // já com preço definido (ativa/pendente)
  }
  if (price == null && seller != null && original) price = Math.round(original * (1 - (seller + meli) / 100) * 100) / 100;
  return {
    conta: String(conta).toLowerCase(), item_id: itemId, promo_key: promoId || tipo || 'SEM_ID',
    promo_id: promoId, tipo, nome: p.name || null, status: p.status?.id || p.status || null, ref_id: p.ref_id || null,
    original_price: original, price, seller_pct: seller, meli_pct: meli,
    min_price: minP, max_price: maxP, suggested_price: sugP,
    stock_min: num(p.stock?.min), stock_max: num(p.stock?.max), stock_remaining: num(p.stock?.remaining_stock),
    start_date: dt(p.start_date), finish_date: dt(p.finish_date), deadline_date: dt(p.deadline_date),
    raw: p, atualizado_em: new Date().toISOString(),
  };
}

// Lê as promoções de UM anúncio no ML e grava (preserva visto_em/visto_por).
export async function carregarPromocoesDoItem(conta, token, itemId, origFallback) {
  const c = String(conta).toLowerCase();
  const r = await mlGet(token, `/seller-promotions/items/${itemId}?app_version=v2`);
  if (!r.ok || !Array.isArray(r.body)) return { ok: false, http: r.http, n: 0 };
  const linhas = r.body.map(p => normalizarPromo(c, itemId, p, origFallback));
  // preserva visto: upsert não pode sobrescrever visto_em -> lê os existentes
  const { data: exist } = await supabase.from('ml_sale_promocoes').select('promo_key, visto_em, visto_por, start_date, finish_date, entrou_em, entrou_por').eq('conta', c).eq('item_id', itemId);
  const vistos = Object.fromEntries((exist || []).map(x => [x.promo_key, x]));
  for (const l of linhas) { const v = vistos[l.promo_key]; if (v) { l.visto_em = v.visto_em; l.visto_por = v.visto_por; if (!l.start_date && v.start_date) l.start_date = v.start_date; if (!l.finish_date && v.finish_date) l.finish_date = v.finish_date;
    // "entrou" local: vale enquanto o ML ainda mostrar candidate (ele demora a virar); some quando o status muda
    if (v.entrou_em && l.status === 'candidate') { l.entrou_em = v.entrou_em; l.entrou_por = v.entrou_por; } } }
  // promoções que sumiram no ML somem do cache
  const chaves = new Set(linhas.map(l => l.promo_key));
  const sumiram = (exist || []).map(x => x.promo_key).filter(k => !chaves.has(k));
  if (sumiram.length) await supabase.from('ml_sale_promocoes').delete().eq('conta', c).eq('item_id', itemId).in('promo_key', sumiram);
  if (linhas.length) await supabase.from('ml_sale_promocoes').upsert(linhas, { onConflict: 'conta,item_id,promo_key' });
  return { ok: true, n: linhas.length };
}

// ── Agrupamento (família) e regra do verde ───────────────────────────────────
export const TIPOS_RELAMPAGO = new Set(['LIGHTNING']);
export const STATUS_ATIVO = new Set(['started', 'active', 'pending', 'programmed']);
export const STATUS_CANDIDATO = new Set(['candidate']);

function media(xs) { const v = xs.filter(x => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null; }

/** Monta os grupos (1 por anúncio antigo ou por família) com as promoções agregadas. */
// Faixa padrao (decisao dele 20/09): 6% campanhas / 10% relampago. Excecoes por REF em ml_sale_config.
export const FAIXA_PADRAO = { campanha_pct: 6, relampago_pct: 10 };
export function faixaEfetiva(config) {
  return { campanha_pct: config?.campanha_pct ?? FAIXA_PADRAO.campanha_pct, relampago_pct: config?.relampago_pct ?? FAIXA_PADRAO.relampago_pct, padrao: !config };
}

export function agrupar(anuncios, promocoes, config) {
  config = faixaEfetiva(config);
  const porItem = {};
  for (const p of promocoes) (porItem[p.item_id] = porItem[p.item_id] || []).push(p);
  const grupos = {};
  for (const a of anuncios) {
    const chave = a.family_id ? `F${a.family_id}` : a.item_id;
    const g = grupos[chave] = grupos[chave] || { chave, family_id: a.family_id || null, titulo: a.family_name || a.title, formato: a.family_id ? 'novo' : 'antigo', filhos: [], promocoes: {} };
    g.filhos.push({ ...a, promocoes: porItem[a.item_id] || [] });
  }
  const out = [];
  for (const g of Object.values(grupos)) {
    g.filhos.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    const capa = g.filhos.find(f => f.status === 'active' && f.capa) || g.filhos.find(f => f.capa);
    g.capa = capa?.capa || null; g.thumbnail = capa?.thumbnail || null;
    g.preco = media(g.filhos.map(f => f.price));
    g.estoque = g.filhos.reduce((s, f) => s + (f.available_quantity || 0), 0);
    g.full = g.filhos.some(f => f.logistic_type === 'fulfillment');
    g.status = g.filhos.some(f => f.status === 'active') ? 'active' : (g.filhos[0]?.status || null);
    g.item_ids = g.filhos.map(f => f.item_id);
    // agrega promoções por promo_key
    const agg = {};
    for (const f of g.filhos) for (const p of f.promocoes) {
      const a = agg[p.promo_key] = agg[p.promo_key] || { promo_key: p.promo_key, promo_id: p.promo_id, tipo: p.tipo, nome: p.nome, relampago: TIPOS_RELAMPAGO.has(p.tipo), filhos: [], status: {}, };
      a.filhos.push({ item_id: f.item_id, title: f.title, sku: f.sku, status: p.entrou_em && p.status === 'candidate' ? 'enviado' : p.status, original_price: p.original_price, price: p.price, seller_pct: p.seller_pct, meli_pct: p.meli_pct, min_price: p.min_price, max_price: p.max_price, suggested_price: p.suggested_price, stock_min: p.stock_min, stock_max: p.stock_max, stock_remaining: p.stock_remaining, visto_em: p.visto_em, entrou_em: p.entrou_em, available_quantity: f.available_quantity });
      a.status[p.status || '?'] = (a.status[p.status || '?'] || 0) + 1;
      a.start_date = a.start_date || p.start_date; a.finish_date = a.finish_date || p.finish_date; a.deadline_date = a.deadline_date || p.deadline_date;
    }
    g.promocoes = Object.values(agg).map(a => {
      const enviada = a.filhos.some(f => f.status === 'enviado');
      const ativa = a.filhos.some(f => STATUS_ATIVO.has(f.status)) || enviada;
      const candidata = a.filhos.some(f => STATUS_CANDIDATO.has(f.status));
      const seller = media(a.filhos.map(f => f.seller_pct));
      const meli = media(a.filhos.map(f => f.meli_pct));
      const preco = media(a.filhos.map(f => f.price));
      const original = media(a.filhos.map(f => f.original_price));
      const vistoTodos = a.filhos.every(f => !!f.visto_em);
      const faixa = a.relampago ? config?.relampago_pct : config?.campanha_pct;
      // PRICE_DISCOUNT ("desconto por preco", sem campanha) esta sempre disponivel e
      // acenderia tudo -> aparece na lista mas nunca pinta de verde
      const elegivel = a.tipo !== 'PRICE_DISCOUNT';
      const dentro = elegivel && faixa != null && seller != null && seller <= Number(faixa);
      return { ...a, ativa, enviada, candidata, seller_pct: seller, meli_pct: meli, price: preco, original_price: original, visto: vistoTodos, dentro_faixa: dentro,
        verde: dentro && candidata && !ativa && !vistoTodos, n_filhos: a.filhos.length, sem_campanha: a.tipo === 'PRICE_DISCOUNT' };
    }).sort((x, y) => (Number(y.ativa) - Number(x.ativa)) || (Number(x.sem_campanha) - Number(y.sem_campanha)) || ((x.seller_pct ?? 999) - (y.seller_pct ?? 999)));   // ativas, depois campanhas por menor % dele, desconto por preco por ultimo
    g.n_ativas = g.promocoes.filter(p => p.ativa).length;
    g.verde_campanha = g.promocoes.some(p => p.verde && !p.relampago);
    g.verde_relampago = g.promocoes.some(p => p.verde && p.relampago);
    out.push(g);
  }
  out.sort((a, b) => (Number(b.status === 'active') - Number(a.status === 'active')) || String(a.titulo).localeCompare(String(b.titulo)));
  return out;
}

// Lista de promoções da conta (nome, prazo de aceite) — pra completar o que o
// endpoint por item não traz (deadline_date). Cache de 10 min no processo.
const _promosConta = {};
export async function promocoesDaConta(conta, token) {
  const c = String(conta).toLowerCase();
  const hit = _promosConta[c];
  if (hit && Date.now() - hit.em < 600000) return hit.mapa;
  const sid = await sellerIdDe(c);
  const r = await mlGet(token, `/seller-promotions/users/${sid}?app_version=v2`);
  const mapa = {};
  for (const p of r.body?.results || []) if (p.id) mapa[p.id] = { nome: p.name || null, deadline_date: p.deadline_date || null, start_date: p.start_date || null, finish_date: p.finish_date || null, status: p.status || null };
  _promosConta[c] = { em: Date.now(), mapa };
  return mapa;
}

export async function configDaRef(ref) {
  const { data } = await supabase.from('ml_sale_config').select('*').eq('ref', normRef(ref)).maybeSingle();
  return data || null;
}

export async function registrarLog(l) {
  try { await supabase.from('ml_sale_log').insert({ ...l, conta: String(l.conta || '').toLowerCase() }); } catch { /* log nunca derruba */ }
}
