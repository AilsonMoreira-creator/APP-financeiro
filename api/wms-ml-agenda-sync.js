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

      // 20/08 (5 liberadas fantasma): pedidos com substatus ready_to_print
      // pendentes SAÍAM da janela dos N mais recentes conforme pedidos novos
      // chegavam — a Sthefany imprimia no painel e o espelho nunca mais era
      // re-checado, então o contador não zerava. Agora eles são PRIORIDADE
      // fixa da varredura, independente da idade.
      const base = () => supabase.from('wms_pedidos')
        .select('pedido_id, numero, numero_loja, status_wms, ml_ship_checado_em')
        .eq('conta', conta).ilike('canal_geral', '%mercado%')
        .not('numero_loja', 'is', null)
        .neq('status_wms', 'cancelado')
        .gte('data_pedido', new Date(Date.now() - 30 * 86400000).toISOString());
      const { data: pendentes } = await base()
        .eq('ml_ship_substatus', 'ready_to_print').is('etiqueta_impressa_em', null)
        .order('data_pedido', { ascending: true }).limit(80);
      const { data: recentes } = await base()
        .order('data_pedido', { ascending: false }).limit(limite);
      // 02/09 (Sthefany: contador de liberadas bem menor que o painel): os
      // agendados de ontem/anteontem que liberam HOJE ja sairam da janela dos
      // 150 mais recentes e ficavam pending/buffered no espelho pra sempre
      // (57 hoje, sync parado nas 07:43). Prioridade fixa: agendado cujo dia
      // chegou ou e amanha, ainda nao impresso pelo app e nao despachado.
      const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T23:59:59Z';
      const { data: doDia, error: errDia } = await base()
        .not('ml_agendado_em', 'is', null).lte('ml_agendado_em', amanha)
        .is('etiqueta_impressa_em', null)
        .in('ml_ship_status', ['pending', 'handling', 'ready_to_ship'])
        .order('ml_agendado_em', { ascending: true }).limit(120);
      if (errDia) console.error('[agenda-sync] doDia:', errDia.message);
      // 02/09 (caso 157835/157848): pedido recente que o ML ainda nem agendou
      // (buffered SEM data) tambem sai da janela dos recentes e ficava cego —
      // o app o tratava como NORMAL e mandava pro NF+transporte sem etiqueta.
      const { data: semData } = await base()
        .is('ml_agendado_em', null).is('etiqueta_impressa_em', null)
        .in('ml_ship_status', ['pending', 'handling'])
        .gte('data_pedido', new Date(Date.now() - 7 * 86400000).toISOString())
        .order('data_pedido', { ascending: true }).limit(100);
      r.selecao = { pendentes: (pendentes || []).length, doDia: (doDia || []).length, doDiaErro: errDia?.message || null, semData: (semData || []).length, recentes: (recentes || []).length };
      const vistos = new Set();
      const peds = [...(pendentes || []), ...(doDia || []), ...(semData || []), ...(recentes || [])].filter(p => {
        if (vistos.has(p.pedido_id)) return false;
        vistos.add(p.pedido_id); return true;
      });

      for (const p of (peds || [])) {
        if (Date.now() - inicio > 260000) { r.aviso = 'tempo esgotado'; break; }
        try {
          const o = await (await fetch(`https://api.mercadolibre.com/orders/${p.numero_loja}`, { headers: h })).json();
          let sid = o?.shipping?.id;
          // 21/08 (diag 9585/9586): compra em CARRINHO faz o numeroLoja ser o
          // PACK id (orders/{pack} = 404) — por isso o espelho ficava "?/?"
          // e envio cancelado passava batido. Fallback: pack → order → shipment.
          if (!sid) {
            const pk = await (await fetch(`https://api.mercadolibre.com/packs/${p.numero_loja}`, { headers: h })).json().catch(() => ({}));
            const ordId = pk?.orders?.[0]?.id;
            if (ordId) {
              await espera(120);
              const o2 = await (await fetch(`https://api.mercadolibre.com/orders/${ordId}`, { headers: h })).json().catch(() => ({}));
              sid = o2?.shipping?.id || null;
            }
            if (!sid) sid = pk?.shipment?.id || null;
          }
          if (!sid) continue;
          await espera(120);
          const s = await (await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: h })).json();
          r.olhados++;

          const buffering = s?.shipping_option?.buffering?.date || null;
          const agendado = buffering ? String(buffering).slice(0, 10) : null;
          const liberado = s?.status === 'ready_to_ship' || s?.substatus === 'ready_to_print';

          // 19/08: no DIA da liberação o ML tira o buffering do shipment — se
          // gravar null por cima, o pedido perde o agendamento na hora exata
          // em que vira "liberada do dia" e some do contador. Data conhecida
          // fica; só atualiza quando o ML manda uma data.
          const upd = {
            ml_ship_status: s?.status || null,
            ml_ship_substatus: s?.substatus || null,
            ml_ship_checado_em: new Date().toISOString(),
          };
          if (agendado) upd.ml_agendado_em = agendado;
          await supabase.from('wms_pedidos').update(upd).eq('pedido_id', p.pedido_id);

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
