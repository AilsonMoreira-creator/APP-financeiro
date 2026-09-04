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
  const order = await mlGet(`/orders/${orderId}`, token);
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
