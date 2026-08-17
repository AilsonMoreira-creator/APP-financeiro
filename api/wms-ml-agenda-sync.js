/**
 * wms-ml-agenda-sync.js — data de AGENDAMENTO dos envios do Mercado Livre
 * (Ailson 17/08/2026)
 *
 * No ML existem pedidos programados: a cliente compra hoje e o envio só é
 * liberado num dia futuro. O shipment vem como:
 *    status: 'pending' · substatus: 'buffered'
 *    shipping_option.buffering.date  → a data em que libera
 *
 * O fluxo da equipe: imprime a NF antes (com a data escrita em cima) e separa
 * a mercadoria; no dia, imprime só a etiqueta logística e despacha. A NF
 * continua válida mesmo dias depois.
 *
 * Grava em wms_pedidos: ml_agendado_em, ml_ship_status, ml_ship_substatus.
 * GET ?contas=exitus,lumia,muniam&limite=120
 */
import { supabase } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 300 };
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const contas = String(req.query?.contas || 'exitus,lumia,muniam').split(',').map(c => c.trim());
  const limite = Math.min(parseInt(req.query?.limite) || 120, 300);
  const inicio = Date.now();
  const resumo = { contas: {}, agendados: 0, liberados: 0 };

  try {
    for (const conta of contas) {
      const r = resumo.contas[conta] = { olhados: 0, agendados: 0, liberados: 0, erros: 0 };
      let token;
      try { token = await getValidToken(BRAND[conta]); } catch { r.erro = 'token'; continue; }
      const h = { Authorization: `Bearer ${token}` };

      // pedidos ML recentes que ainda podem estar em jogo
      const { data: peds } = await supabase.from('wms_pedidos')
        .select('pedido_id, numero, numero_loja, status_wms, ml_ship_checado_em')
        .eq('conta', conta).ilike('canal_geral', '%mercado%')
        .not('numero_loja', 'is', null)
        .neq('status_wms', 'cancelado')
        .gte('data_pedido', new Date(Date.now() - 20 * 86400000).toISOString())
        .order('data_pedido', { ascending: false }).limit(limite);

      for (const p of (peds || [])) {
        if (Date.now() - inicio > 260000) { r.aviso = 'tempo esgotado'; break; }
        try {
          const o = await (await fetch(`https://api.mercadolibre.com/orders/${p.numero_loja}`, { headers: h })).json();
          const sid = o?.shipping?.id;
          if (!sid) continue;
          await espera(120);
          const s = await (await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: h })).json();
          r.olhados++;

          const buffering = s?.shipping_option?.buffering?.date || null;
          const agendado = buffering ? String(buffering).slice(0, 10) : null;
          const liberado = s?.status === 'ready_to_ship' || s?.substatus === 'ready_to_print';

          await supabase.from('wms_pedidos').update({
            ml_agendado_em: agendado,
            ml_ship_status: s?.status || null,
            ml_ship_substatus: s?.substatus || null,
            ml_ship_checado_em: new Date().toISOString(),
          }).eq('pedido_id', p.pedido_id);

          if (agendado) { r.agendados++; resumo.agendados++; }
          if (liberado) { r.liberados++; resumo.liberados++; }
        } catch { r.erros++; }
        await espera(140);
      }
    }
    resumo.segundos = Math.round((Date.now() - inicio) / 1000);
    return res.status(200).json(resumo);
  } catch (e) {
    return res.status(500).json({ erro: e.message, resumo });
  }
}
