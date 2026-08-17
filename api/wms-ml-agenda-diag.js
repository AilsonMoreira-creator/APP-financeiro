/**
 * wms-ml-agenda-diag.js — SOMENTE LEITURA (Ailson 17/08/2026)
 *
 * Caça onde o Mercado Livre guarda a DATA DE AGENDAMENTO do envio ("pedido
 * agendado pra amanhã / pro dia 18.08") e o sinal de que a etiqueta logística
 * já está liberada pra postagem. NÃO baixa etiqueta (baixar muda estado).
 *
 * GET ?conta=exitus&limite=6
 */
import { supabase } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 120 };
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus');
  const limite = Math.min(parseInt(req.query?.limite) || 6, 12);

  try {
    const token = await getValidToken(BRAND[conta]);
    const h = { Authorization: `Bearer ${token}` };

    const { data: peds } = await supabase.from('wms_pedidos')
      .select('numero, numero_loja, canal_geral, status_wms, ml_logistic_type, data_pedido')
      .eq('conta', conta).ilike('canal_geral', '%mercado%')
      .not('numero_loja', 'is', null)
      .order('data_pedido', { ascending: false }).limit(limite);

    const saida = [];
    for (const p of (peds || [])) {
      const item = { pedido: p.numero, order_id: p.numero_loja, status_wms: p.status_wms, logistica: p.ml_logistic_type };
      try {
        const o = await (await fetch(`https://api.mercadolibre.com/orders/${p.numero_loja}`, { headers: h })).json();
        const sid = o?.shipping?.id;
        item.order_status = o?.status;
        if (sid) {
          const s = await (await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: h })).json();
          item.shipment = {
            id: sid, status: s.status, substatus: s.substatus,
            logistic_type: s.logistic_type,
            date_first_printed: s.date_first_printed,
            // candidatos a "data de agendamento"
            lead_time: s.lead_time ? {
              estimated_handling_limit: s.lead_time.estimated_handling_limit,
              estimated_delivery_limit: s.lead_time.estimated_delivery_limit,
              estimated_delivery_time: s.lead_time.estimated_delivery_time,
              shipping_method: s.lead_time.shipping_method?.name,
            } : null,
            // alguns campos que às vezes trazem o agendamento
            dispatch: s.shipping_option?.estimated_handling_limit || null,
            tags: s.tags,
            chaves: Object.keys(s),
          };
        }
      } catch (e) { item.erro = String(e.message).slice(0, 120); }
      await new Promise(r => setTimeout(r, 200));
      saida.push(item);
    }
    return res.status(200).json({ conta, pedidos: saida });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}

