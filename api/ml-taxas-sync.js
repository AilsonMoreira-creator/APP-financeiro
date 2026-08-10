/**
 * ml-taxas-sync.js — busca na API do Mercado Livre o que REALMENTE aconteceu em
 * cada pedido (Ailson 08/08/2026).
 *
 * Motivo: o item do Bling grava o valor que o CLIENTE PAGOU — com frete dentro —
 * e o `total_pedido` mistura cupom da plataforma com desconto do vendedor. Isso
 * inflava preços acima da faixa de tarifa dos R$79 e inventava descontos que
 * nunca existiram. O ML entrega os quatro números separados:
 *
 *   unit_price      preço real do anúncio (é ESTE que decide a faixa de tarifa)
 *   full_unit_price preço cheio, antes do desconto de campanha do VENDEDOR
 *   coupon_amount   cupom do Mercado Livre — subsídio da PLATAFORMA, não sai do bolso
 *   shipping_cost   frete pago pelo comprador — não é receita nem custo do produto
 *   sale_fee        comissão REAL cobrada (não a estimada da calculadora)
 *
 * Query:
 *   ?desde=YYYY-MM-DD  ?ate=YYYY-MM-DD   (default: mês corrente)
 *   ?limite=N          pedidos por rodada (default 150)
 *   ?conta=exitus      (default: todas com token)
 *   ?tudo=1            recheca os já gravados
 */
import { supabase } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 300 };

const API = 'https://api.mercadolibre.com';
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
const n = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };

async function ml(path, token) {
  // pagamentos moram no host do Mercado Pago (no do ML dão 404)
  const host = path.startsWith('/v1/payments') ? 'https://api.mercadopago.com' : API;
  const r = await fetch(`${host}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { erro: r.status };
  return r.json();
}

async function pedidoDoML(numeroLoja, token) {
  const id = String(numeroLoja || '').trim();
  if (!/^\d+$/.test(id)) return { erro: 'numero nao numerico' };

  // Um PACK junta VÁRIOS pedidos no mesmo envio e o Bling grava tudo num
  // pedido só. Pegar apenas o primeiro subestimava o preço real (era o que
  // fazia o Bling parecer "inflado" em R$86 num pack de 2). Ailson 08/08/2026.
  let ordens = [];
  const direto = await ml(`/orders/${id}`, token);
  if (!direto.erro) ordens = [direto];
  else {
    const pack = await ml(`/packs/${id}`, token);
    if (pack.erro) return { erro: `orders/packs ${direto.erro}/${pack.erro}` };
    for (const o of (pack.orders || [])) {
      const det = await ml(`/orders/${o.id}`, token);
      if (!det.erro) ordens.push(det);
    }
    if (!ordens.length) return { erro: 'pack sem pedidos legíveis' };
  }
  const p = { ...ordens[0] };
  p.order_items = ordens.flatMap(o => o.order_items || []);
  p.payments = ordens.flatMap(o => o.payments || []);

  const itens = (p.order_items || []).map(it => ({
    sku: it.item?.seller_sku || it.item?.seller_custom_field || null,
    titulo: it.item?.title || null,
    qtd: n(it.quantity),
    unit_price: n(it.unit_price),
    full_unit_price: n(it.full_unit_price) || n(it.unit_price),
    sale_fee: n(it.sale_fee),
    listing_type: it.listing_type_id || null,
  }));
  // /orders/{id}/discounts é o ÚNICO lugar que separa quem pagou o desconto de
  // campanha: amounts.total = desconto cheio, amounts.seller = a parte que sai
  // do bolso do vendedor (o resto é subsídio do ML). Ailson 08/08/2026.
  let dTotal = 0, dSeller = 0;
  for (const o of ordens) {
    const dd = await ml(`/orders/${o.id}/discounts`, token);
    if (dd?.erro) continue;
    for (const det of (dd.details || [])) {
      for (const it of (det.items || [])) {
        dTotal += n(it.amounts?.total);
        dSeller += n(it.amounts?.seller);
      }
    }
  }

  const pag = p.payments || [];

  // ── Mercado Pago: o líquido REAL e a data de liberação (Ailson 10/08) ─────
  // net_received_amount já vem DEFINIDO na aprovação — é ele que o DRE usa;
  // money_release_date/status servem pra confirmar o repasse depois.
  let netRecebido = 0, releaseDate = null, releaseStatus = null, pagoEm = null;
  for (const pg of pag.slice(0, 4)) {
    if (!pg?.id || String(pg.status) !== 'approved') continue;
    const mp = await ml(`/v1/payments/${pg.id}`, token);
    if (mp?.erro) continue;
    netRecebido += n(mp.transaction_details?.net_received_amount);
    if (!releaseDate && mp.money_release_date) releaseDate = mp.money_release_date.slice(0, 10);
    if (mp.money_release_status) releaseStatus = mp.money_release_status;
    if (!pagoEm && mp.date_approved) pagoEm = mp.date_approved;
  }

  // ── frete real: quanto o VENDEDOR paga e quanto o comprador pagou ─────────
  let freteVendedor = 0, freteComprador = 0, logisticType = null;
  const shipId = p.shipping?.id;
  if (shipId) {
    const [ship, custos] = await Promise.all([
      ml(`/shipments/${shipId}`, token),
      ml(`/shipments/${shipId}/costs`, token),
    ]);
    if (!ship?.erro) logisticType = ship.logistic_type || null;
    if (!custos?.erro) {
      freteVendedor = (custos.senders || []).reduce((t, x) => t + n(x.cost), 0);
      freteComprador = n(custos.receiver?.cost);
    }
  }

  return {
    net_recebido: Math.round(netRecebido * 100) / 100,
    release_date: releaseDate, release_status: releaseStatus, pago_em: pagoEm,
    frete_vendedor: Math.round(freteVendedor * 100) / 100,
    frete_comprador: Math.round(freteComprador * 100) / 100,
    logistic_type: logisticType,
    status_ml: p.status || null,
    desconto_total: Math.round(dTotal * 100) / 100,
    desconto_vendedor: Math.round(dSeller * 100) / 100,
    desconto_plataforma: Math.round((dTotal - dSeller) * 100) / 100,
    ml_order_id: String(p.id),
    data: (p.date_created || '').slice(0, 10) || null,
    preco_produtos: itens.reduce((s, i) => s + i.unit_price * i.qtd, 0),
    full_price: itens.reduce((s, i) => s + i.full_unit_price * i.qtd, 0),
    sale_fee: itens.reduce((s, i) => s + i.sale_fee * i.qtd, 0),
    coupon_amount: pag.reduce((s, x) => s + n(x.coupon_amount), 0),
    // O frete pago pelo comprador NEM SEMPRE vem em shipping_cost: no ML ele
    // costuma aparecer como a diferença entre o que foi pago e o preço do
    // produto (ex: produto 78,93, pago 89,29 -> 10,36 de frete).
    shipping_cost: Math.max(
      pag.reduce((s, x) => s + n(x.shipping_cost), 0),
      Math.round((pag.reduce((s, x) => s + n(x.total_paid_amount), 0)
        - itens.reduce((s, i) => s + i.unit_price * i.qtd, 0)
        + pag.reduce((s, x) => s + n(x.coupon_amount), 0)) * 100) / 100
    ),
    total_paid: pag.reduce((s, x) => s + n(x.total_paid_amount), 0),
    listing_type: itens[0]?.listing_type || null,
    itens,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const inicio = Date.now();

  // ?releases=1 — só reconfere a LIBERAÇÃO dos que estão pending (a data já
  // passou ou está perto). Não rebusca pedido inteiro: 1 chamada por pagamento.
  if (req.query?.releases === '1') {
    const { data: pend } = await supabase.from('ml_pedido_taxas')
      .select('id, conta, ml_order_id')
      .eq('release_status', 'pending')
      .lte('release_date', new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10))
      .limit(200);
    const toks = {}; let atualizados = 0;
    for (const row of (pend || [])) {
      if (Date.now() - inicio > 270000) break;
      const brand = BRAND[row.conta]; if (!brand) continue;
      if (!toks[brand]) { try { toks[brand] = await getValidToken(brand); } catch { toks[brand] = null; } }
      if (!toks[brand]) continue;
      const o = await ml(`/orders/${row.ml_order_id}`, toks[brand]);
      if (o?.erro) continue;
      let st = null, dt = null;
      for (const pg of (o.payments || []).slice(0, 4)) {
        if (String(pg.status) !== 'approved') continue;
        const mp = await ml(`/v1/payments/${pg.id}`, toks[brand]);
        if (mp?.erro) continue;
        if (mp.money_release_status) st = mp.money_release_status;
        if (mp.money_release_date) dt = mp.money_release_date.slice(0, 10);
      }
      if (st && st !== 'pending') {
        await supabase.from('ml_pedido_taxas')
          .update({ release_status: st, ...(dt ? { release_date: dt } : {}) })
          .eq('id', row.id);
        atualizados++;
      }
    }
    return res.status(200).json({ ok: true, modo: 'releases', pendentes_checados: (pend || []).length, liberados_agora: atualizados });
  }
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.desde || '') ? req.query.desde : hoje.slice(0, 8) + '01';
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.ate || '') ? req.query.ate : hoje;
  const limite = Math.min(400, Math.max(1, parseInt(req.query?.limite) || 150));
  const contaFiltro = req.query?.conta || null;
  const tudo = req.query?.tudo === '1';

  // ?completar=1 — reprocessa os JÁ GRAVADOS que ainda não têm o líquido do
  // MP (net_recebido null) — é o backfill dos campos novos de 10/08
  const completar = req.query?.completar === '1';
  if (completar) {
    let qc = supabase.from('ml_pedido_taxas')
      .select('conta, pedido_id, numero_loja, data_pedido')
      .is('net_recebido', null)
      .gte('data_pedido', desde).lte('data_pedido', ate)
      .order('data_pedido', { ascending: false }).limit(limite);
    if (contaFiltro) qc = qc.eq('conta', contaFiltro);
    const { data: falta, error: eF } = await qc;
    if (eF) return res.status(500).json({ erro: eF.message });
    const alvoC = (falta || []).map(f => ({ conta: f.conta, pedido_id: f.pedido_id, numero_pedido_loja: f.numero_loja, data_pedido: f.data_pedido }));
    return await processar(alvoC, res, inicio, desde, ate);
  }

  // pedidos do ML com número da loja preenchido
  let q = supabase.from('bling_vendas_detalhe')
    .select('conta, pedido_id, numero_pedido_loja, data_pedido')
    .ilike('canal_geral', '%mercado%livre%')
    .not('numero_pedido_loja', 'is', null)
    .gte('data_pedido', desde).lte('data_pedido', ate)
    .order('data_pedido', { ascending: false })
    .limit(limite * 3);
  if (contaFiltro) q = q.eq('conta', contaFiltro);
  const { data: pedidos, error } = await q;
  if (error) return res.status(500).json({ erro: error.message });

  let jaFeitos = new Set();
  if (!tudo) {
    const { data: feitos } = await supabase.from('ml_pedido_taxas')
      .select('conta, numero_loja').gte('data_pedido', desde).lte('data_pedido', ate).limit(5000);
    (feitos || []).forEach(f => jaFeitos.add(`${f.conta}|${f.numero_loja}`));
  }

  const alvo = (pedidos || []).filter(p => tudo || !jaFeitos.has(`${p.conta}|${p.numero_pedido_loja}`)).slice(0, limite);
  return await processar(alvo, res, inicio, desde, ate);
}

async function processar(alvo, res, inicio, desde, ate) {
  const tokens = {};
  const r = { janela: `${desde} a ${ate}`, candidatos: alvo.length, gravados: 0, erros: 0, pulados: 0 };

  for (const p of alvo) {
    if (Date.now() - inicio > 275000) { r.parcial = 'tempo esgotado — rode de novo pra continuar'; break; }
    const brand = BRAND[p.conta];
    if (!brand) { r.pulados++; continue; }
    if (!tokens[brand]) {
      try { tokens[brand] = await getValidToken(brand); } catch { tokens[brand] = null; }
    }
    if (!tokens[brand]) { r.erros++; continue; }

    const d = await pedidoDoML(p.numero_pedido_loja, tokens[brand]);
    if (d.erro) { r.erros++; continue; }
    const { error: eUp } = await supabase.from('ml_pedido_taxas').upsert({
      conta: p.conta, pedido_id: p.pedido_id, numero_loja: String(p.numero_pedido_loja),
      ml_order_id: d.ml_order_id, data_pedido: p.data_pedido,
      preco_produtos: d.preco_produtos, full_price: d.full_price, sale_fee: d.sale_fee,
      coupon_amount: d.coupon_amount, shipping_cost: d.shipping_cost, total_paid: d.total_paid,
      listing_type: d.listing_type, itens: d.itens, checado_em: new Date().toISOString(),
      status_ml: d.status_ml, desconto_total: d.desconto_total,
      desconto_vendedor: d.desconto_vendedor, desconto_plataforma: d.desconto_plataforma,
      net_recebido: d.net_recebido, release_date: d.release_date,
      release_status: d.release_status, pago_em: d.pago_em,
      frete_vendedor: d.frete_vendedor, frete_comprador: d.frete_comprador,
      logistic_type: d.logistic_type,
    }, { onConflict: 'conta,numero_loja' });
    if (eUp) { r.erros++; continue; }
    r.gravados++;
  }

  return res.status(200).json({ ok: true, ...r });
}
