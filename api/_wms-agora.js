// _wms-agora.js — ENVIOS AGORA do Mercado Livre (Ailson 04/09/2026)
//
// Modalidade nova do ML: pedido entra, 25 MINUTOS pra embalar, motoboy passa.
// Identificacao (descoberta no 1o pedido, Lumia 71526, 04/09): o shipment
// vem como logistic_type=cross_docking (igual ao normal!) — o que marca e
// `tags` contendo "proximity" e/ou shipping_option.name === "Instant".
//
// Fluxo: o webhook do ML (orders_v2 / shipments) chama registrarAgora() em
// segundos; a tabela wms_agora guarda o pedido com a HORA REAL do ML (o Bling
// so tem a data). A aba "Envios Agora" imprime casada do produto + logistica
// (ZPL do ML), sem NF (decisao dele). A TV mostra o cronometro regressivo.

import { createClient } from '@supabase/supabase-js';
import { getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
export const AGORA_PRAZO_MIN = 25;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
const CONTA_POR_BRAND = { Exitus: 'exitus', Lumia: 'lumia', Muniam: 'muniam' };

export function ehEnviosAgora(shipment) {
  if (!shipment) return false;
  const tags = Array.isArray(shipment.tags) ? shipment.tags.map(t => String(t).toLowerCase()) : [];
  if (tags.includes('proximity')) return true;
  const nome = String(shipment.shipping_option?.name || '').toLowerCase();
  return nome === 'instant';
}

async function mlGet(path, token) {
  const r = await fetch(`${ML_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

function itensDaOrder(order) {
  return (order?.order_items || []).map(oi => {
    const it = oi.item || {};
    const attrs = Array.isArray(it.variation_attributes) ? it.variation_attributes : [];
    const cor = attrs.find(a => /cor|color/i.test(a.name || a.id || ''))?.value_name || null;
    const tam = attrs.find(a => /tamanho|size/i.test(a.name || a.id || ''))?.value_name || null;
    return { sku: it.seller_sku || it.seller_custom_field || null, descricao: it.title || '', quantidade: Number(oi.quantity) || 1, cor, tamanho: tam };
  });
}

/**
 * Registra/atualiza um Envios Agora a partir de um order do ML.
 * Devolve { agora: true|false, novo, linha } — agora=false quando o shipment
 * nao e da modalidade (chamador ignora).
 */
export async function registrarAgoraDeOrder(orderId, brand) {
  const token = await getValidToken(brand);
  let order = await mlGet(`/orders/${orderId}`, token);
  if (!order) {
    // numero pode ser o PACK (carrinho): resolve a primeira order do pack
    const pack = await mlGet(`/packs/${orderId}`, token);
    const oid = pack?.orders?.[0]?.id;
    if (oid) order = await mlGet(`/orders/${oid}`, token);
  }
  if (!order) return { agora: false, motivo: 'order nao lida' };
  const sid = order.shipping?.id;
  if (!sid) return { agora: false, motivo: 'sem shipment' };
  const sh = await mlGet(`/shipments/${sid}`, token);
  if (!ehEnviosAgora(sh)) return { agora: false, motivo: 'nao e proximity/instant' };
  return upsertAgora({ order, shipment: sh, brand });
}

export async function registrarAgoraDeShipment(shipmentId, brand) {
  const token = await getValidToken(brand);
  const sh = await mlGet(`/shipments/${shipmentId}`, token);
  if (!sh) return { agora: false, motivo: 'shipment nao lido' };
  if (!ehEnviosAgora(sh)) return { agora: false, motivo: 'nao e proximity/instant' };
  // shipment -> order (pra itens/cliente); o shipment traz order_id
  const orderId = sh.order_id || (Array.isArray(sh.shipping_items) ? null : null);
  const order = orderId ? await mlGet(`/orders/${orderId}`, token) : null;
  return upsertAgora({ order, shipment: sh, brand });
}

async function upsertAgora({ order, shipment, brand }) {
  const conta = CONTA_POR_BRAND[brand] || String(brand || '').toLowerCase();
  const orderId = String(order?.id || shipment.order_id || '');
  const packId = order?.pack_id ? String(order.pack_id) : null;
  const numeroLoja = packId || orderId;
  if (!numeroLoja) return { agora: false, motivo: 'sem numero' };
  const criado = new Date(shipment.date_created || order?.date_created || Date.now());
  const prazo = new Date(criado.getTime() + AGORA_PRAZO_MIN * 60000);
  const cliente = order?.buyer
    ? [order.buyer.first_name, order.buyer.last_name].filter(Boolean).join(' ') || order.buyer.nickname || null
    : (shipment.receiver_address?.receiver_name || null);
  const status = shipment.status || null, sub = shipment.substatus || null;
  // atendido pelo painel/coleta: qualquer estagio pos-impressao
  const atendidoMl = status === 'shipped' || status === 'delivered' || status === 'cancelled'
    || (status === 'ready_to_ship' && sub && sub !== 'ready_to_print' && sub !== 'invoice_pending' && sub !== 'buffered');

  const { data: ex } = await supabase.from('wms_agora').select('id, atendido_em, etiqueta_impressa_em').eq('conta', conta).eq('numero_loja', numeroLoja).maybeSingle();
  const base = {
    conta, numero_loja: numeroLoja, order_id: orderId || null, pack_id: packId, shipment_id: String(shipment.id),
    cliente_nome: cliente, ml_criado_em: criado.toISOString(), prazo_em: prazo.toISOString(),
    ml_status: status, ml_substatus: sub, atualizado_em: new Date().toISOString(),
  };
  if (order) base.itens = itensDaOrder(order);
  if (atendidoMl && !ex?.atendido_em) {
    base.atendido_em = new Date().toISOString();
    base.atendido_por = (status === 'shipped' || status === 'delivered') ? 'coleta' : 'painel';
  }
  if (ex) {
    await supabase.from('wms_agora').update(base).eq('id', ex.id);
    return { agora: true, novo: false, linha: { ...base, id: ex.id } };
  }
  const { data: ins } = await supabase.from('wms_agora').insert(base).select('id').single();
  return { agora: true, novo: true, linha: { ...base, id: ins?.id } };
}

/** Abertos = ainda nao atendidos, dos ultimos 2 dias (protege de lixo antigo). */
export async function agoraAbertos() {
  const { data } = await supabase.from('wms_agora').select('*')
    .is('atendido_em', null)
    .gte('ml_criado_em', new Date(Date.now() - 2 * 86400000).toISOString())
    .order('ml_criado_em', { ascending: true });
  return data || [];
}

export async function marcarAgoraImpresso(ids) {
  if (!ids?.length) return;
  const agora = new Date().toISOString();
  await supabase.from('wms_agora').update({ etiqueta_impressa_em: agora, atendido_em: agora, atendido_por: 'app', atualizado_em: agora }).in('id', ids);
}


// ── 04/09 (ele perguntou "o webhook do meli ajuda nos outros pedidos?"):
// SIM — o mesmo aviso de shipment atualiza o ESPELHO (wms_pedidos) em
// segundos, com a mesma regra do agenda-sync horario: status/substatus,
// data de agendamento (nunca apagada por null), MELI_AGENDADO quando
// buffered. Liberadas, impressas no painel, coletadas e canceladas deixam
// de esperar a proxima varredura. O sync horario vira rede de seguranca.
export async function aplicarShipmentNoEspelho(shipmentId, brand, shipmentJa) {
  const token = await getValidToken(brand);
  const sh = shipmentJa || await mlGet(`/shipments/${shipmentId}`, token);
  if (!sh) return { ok: false, motivo: 'shipment nao lido' };
  const conta = CONTA_POR_BRAND[brand] || String(brand || '').toLowerCase();
  // o espelho guarda numero_loja = pack (carrinho) ou order
  const orderId = sh.order_id ? String(sh.order_id) : null;
  let numeros = [];
  if (orderId) {
    numeros.push(orderId);
    const order = await mlGet(`/orders/${orderId}`, token);
    if (order?.pack_id) numeros.push(String(order.pack_id));
  }
  if (!numeros.length) return { ok: false, motivo: 'sem order' };
  const buffering = sh.shipping_option?.buffering?.date || null;
  const agendado = buffering ? String(buffering).slice(0, 10) : null;
  const upd = { ml_ship_status: sh.status || null, ml_ship_substatus: sh.substatus || null, ml_ship_checado_em: new Date().toISOString() };
  // 05/09: tipo de logistica no primeiro sinal — Flex (self_service) vira Flex na hora
  if (sh.logistic_type) upd.ml_logistic_type = sh.logistic_type;
  if (agendado) upd.ml_agendado_em = agendado;
  if (agendado || sh.substatus === 'buffered') upd.print_regra = 'MELI_AGENDADO';
  if (sh.status === 'cancelled') upd.status_wms = 'cancelado';
  const { data } = await supabase.from('wms_pedidos').update(upd).eq('conta', conta).in('numero_loja', numeros).select('pedido_id');
  return { ok: true, atualizados: (data || []).length, agendado, status: sh.status, substatus: sh.substatus };
}

export async function aplicarOrderNoEspelho(orderId, brand) {
  const token = await getValidToken(brand);
  const order = await mlGet(`/orders/${orderId}`, token);
  if (!order) return { ok: false, motivo: 'order nao lida' };
  const conta = CONTA_POR_BRAND[brand] || String(brand || '').toLowerCase();
  const numeros = [String(order.id)]; if (order.pack_id) numeros.push(String(order.pack_id));
  const cancelada = order.status === 'cancelled';
  if (!cancelada) return { ok: true, atualizados: 0, motivo: 'sem acao (so cancelamento e tratado aqui)' };
  const { data } = await supabase.from('wms_pedidos').update({ status_wms: 'cancelado', ml_ship_status: 'cancelled' })
    .eq('conta', conta).in('numero_loja', numeros).select('pedido_id');
  return { ok: true, atualizados: (data || []).length, cancelada: true };
}


// ── 05/09 (2 Flex vazaram pro NF+transporte): pedido do ML nasce no espelho
// via Bling SEM tipo de logistica — o aviso do ML costuma chegar ANTES de o
// pedido existir aqui e se perde. Ao criar o pedido, UMA consulta ao ML
// grava logistic_type/status/agendamento: nasce classificado (Flex e Flex,
// agendado e agendado) antes de qualquer lote. Melhor esforco: nunca trava
// a criacao.
export async function hidratarPedidoMl(numeroLoja, conta) {
  try {
    const brand = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' }[String(conta || '').toLowerCase()];
    if (!brand || !numeroLoja) return { ok: false };
    const token = await getValidToken(brand);
    let order = await mlGet(`/orders/${numeroLoja}`, token);
    if (!order) {
      const pack = await mlGet(`/packs/${numeroLoja}`, token);
      const oid = pack?.orders?.[0]?.id;
      if (oid) order = await mlGet(`/orders/${oid}`, token);
    }
    const sid = order?.shipping?.id;
    if (!sid) return { ok: false, motivo: 'sem shipment' };
    const sh = await mlGet(`/shipments/${sid}`, token);
    if (!sh) return { ok: false, motivo: 'shipment nao lido' };
    const r = await aplicarShipmentNoEspelho(sid, brand, sh);
    // Envios Agora tambem nasce aqui, se for o caso
    const agora = ehEnviosAgora(sh);
    if (agora) await upsertAgora({ order, shipment: sh, brand }).catch(() => null);
    return { ok: true, logistic_type: sh.logistic_type, agora, ...r };
  } catch (e) { return { ok: false, erro: String(e?.message || e) }; }
}
