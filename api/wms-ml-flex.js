/**
 * wms-ml-flex.js — descobre quais pedidos do Mercado Livre sao FLEX
 * (Ailson 07/08/2026)
 *
 * O Bling nao marca Flex em lugar nenhum, entao a informacao vem da API do
 * proprio ML: shipment.logistic_type
 *   self_service            -> FLEX (entrega o proprio vendedor, NAO gera NF)
 *   fulfillment             -> Full (sai do galpao do ML)
 *   cross_docking/drop_off  -> classico (agencia/coleta)
 *
 * Caminho: numero_loja (que o Bling grava como numeroLoja) e o id do pedido ou
 * do pack no ML. Tenta /orders/{id}; se for pack, cai em /packs/{id} e pega o
 * primeiro pedido. Do pedido sai shipping.id -> /shipments/{id}.
 *
 * Query:
 *   ?limite=N     quantos pedidos checar na rodada (default 60, max 300)
 *   ?teste=1      nao grava, devolve o cru dos 5 primeiros pra inspecao
 *   ?tudo=1       recheca tambem os que ja tem ml_checado_em
 */
import { supabase } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 300 };

const API = 'https://api.mercadolibre.com';
// conta do Bling -> brand da tabela ml_tokens
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

async function ml(path, token) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return { erro: r.status };
  return r.json();
}

// numero_loja -> logistic_type
async function logisticTypeDe(numeroLoja, token) {
  const id = String(numeroLoja || '').trim();
  if (!/^\d+$/.test(id)) return { erro: 'numero_loja nao numerico' };

  let pedido = await ml(`/orders/${id}`, token);
  if (pedido.erro) {
    // pode ser um PACK (varios pedidos no mesmo envio)
    const pack = await ml(`/packs/${id}`, token);
    if (pack.erro) return { erro: `orders/packs ${pedido.erro}/${pack.erro}` };
    const primeiro = pack.orders?.[0]?.id;
    if (!primeiro) return { erro: 'pack sem pedidos' };
    pedido = await ml(`/orders/${primeiro}`, token);
    if (pedido.erro) return { erro: `orders do pack ${pedido.erro}` };
  }

  const shipId = pedido.shipping?.id;
  if (!shipId) return { erro: 'pedido sem envio' };
  const envio = await ml(`/shipments/${shipId}`, token);
  if (envio.erro) return { erro: `shipments ${envio.erro}` };
  return {
    logistic_type: envio.logistic_type || null,
    modo: envio.mode || null,
    status: envio.status || null,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const limite = Math.min(300, Math.max(1, parseInt(req.query?.limite) || 60));
  const teste = req.query?.teste === '1';
  const tudo = req.query?.tudo === '1';
  const inicio = Date.now();

  let q = supabase.from('wms_pedidos')
    .select('id, conta, numero_loja, canal_detalhe, status_wms')
    .eq('canal_geral', 'Mercado Livre')
    .not('numero_loja', 'is', null)
    .order('criado_em', { ascending: false })
    .limit(teste ? 5 : limite);
  if (!tudo) q = q.is('ml_checado_em', null);

  const { data: pedidos, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  if (!pedidos?.length) return res.status(200).json({ ok: true, checados: 0, aviso: 'nada pendente' });

  const tokens = {};
  const resumo = { checados: 0, flex: 0, full: 0, outros: 0, erros: 0 };
  const amostra = [];

  for (const p of pedidos) {
    if (Date.now() - inicio > 270000) { resumo.detalhe = 'timeout: continua na proxima rodada'; break; }
    const brand = BRAND[p.conta];
    if (!brand) { resumo.erros++; continue; }
    if (!tokens[brand]) {
      try { tokens[brand] = await getValidToken(brand); } catch { tokens[brand] = null; }
    }
    if (!tokens[brand]) { resumo.erros++; continue; }

    const r = await logisticTypeDe(p.numero_loja, tokens[brand]);
    if (teste) { amostra.push({ conta: p.conta, numero_loja: p.numero_loja, canal_detalhe: p.canal_detalhe, ...r }); continue; }

    if (r.erro) { resumo.erros++; }
    else {
      if (r.logistic_type === 'self_service') resumo.flex++;
      else if (r.logistic_type === 'fulfillment') resumo.full++;
      else resumo.outros++;
    }
    // grava sempre a data da checagem (mesmo com erro nao fica em loop eterno)
    await supabase.from('wms_pedidos')
      .update({ ml_logistic_type: r.logistic_type || null, ml_checado_em: new Date().toISOString() })
      .eq('id', p.id);
    resumo.checados++;
  }

  if (teste) return res.status(200).json({ ok: true, teste: true, amostra });
  return res.status(200).json({ ok: true, ...resumo });
}
