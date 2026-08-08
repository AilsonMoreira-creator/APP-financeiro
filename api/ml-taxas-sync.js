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
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
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
  return {
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
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.desde || '') ? req.query.desde : hoje.slice(0, 8) + '01';
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.ate || '') ? req.query.ate : hoje;
  const limite = Math.min(400, Math.max(1, parseInt(req.query?.limite) || 150));
  const contaFiltro = req.query?.conta || null;
  const tudo = req.query?.tudo === '1';

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
    }, { onConflict: 'conta,numero_loja' });
    if (eUp) { r.erros++; continue; }
    r.gravados++;
  }

  return res.status(200).json({ ok: true, ...r });
}
