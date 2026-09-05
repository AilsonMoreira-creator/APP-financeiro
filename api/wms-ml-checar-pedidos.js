// ═══════════════════════════════════════════════════════════════════════════
// /api/wms-ml-checar-pedidos — CONSULTA NA HORA (Ailson 29/08/2026)
// ---------------------------------------------------------------------------
// Nasceu do caso 156647/156649/156653: os tres eram AGENDADOS (02/09, 31/08,
// 31/08) e vazaram pro NF+transporte porque tinham entrado as 10:06-10:30 e o
// agenda-sync so voltaria as 11:30 — no espelho, ml_agendado_em / substatus /
// print_regra estavam TODOS nulos. A regua de exclusao depende desses sinais,
// entao nao tinha como saber. Ausencia de dado virou "nao e agendado".
//
// Aqui a informacao e buscada NO INSTANTE da decisao: a tela chama este
// endpoint com os pedidos que ficaram de fora do lote e mostra o veredito no
// lugar da mensagem de erro.
//
// POST { ids: [pedido_id, ...] }  ->  { agendados, cancelados, liberados, sem_resposta }
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 120 };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const soData = (d) => (d ? String(d).slice(0, 10) : null);
const brDia = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : '');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'POST esperado' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const ids = (body?.ids || []).map(String).filter(Boolean).slice(0, 40);
  if (!ids.length) return res.status(400).json({ ok: false, erro: 'sem ids' });

  const inicio = Date.now();
  const agendados = [], cancelados = [], liberados = [], semResposta = [];

  try {
    const { data: peds } = await supabase.from('wms_pedidos')
      .select('pedido_id, conta, numero, numero_loja, canal_geral, ml_agendado_em, print_regra')
      .in('pedido_id', ids);

    // so Mercado Livre — os outros canais nao tem essa consulta
    const alvo = (peds || []).filter(p => /mercado/i.test(String(p.canal_geral || '')) && p.numero_loja);
    const naoMl = (peds || []).length - alvo.length;

    const tokens = {};
    for (const p of alvo) {
      if (Date.now() - inicio > 100000) { semResposta.push({ numero: p.numero, motivo: 'tempo esgotado' }); continue; }
      try {
        // 05/09: o token e guardado por brand capitalizada (Exitus/Lumia/Muniam);
        // com a conta em minuscula vinha sempre "sem token da conta"
        const brandDe = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
        if (!(p.conta in tokens)) tokens[p.conta] = await getValidToken(brandDe[p.conta] || p.conta).catch(() => null);
        const tk = tokens[p.conta];
        if (!tk) { semResposta.push({ numero: p.numero, motivo: 'sem token da conta' }); continue; }
        const h = { Authorization: `Bearer ${tk}` };

        const o = await (await fetch(`https://api.mercadolibre.com/orders/${p.numero_loja}`, { headers: h })).json();
        let sid = o?.shipping?.id;
        // compra em carrinho: numero_loja e o PACK id (orders/{pack} = 404)
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
        if (!sid) { semResposta.push({ numero: p.numero, motivo: 'sem envio no ML' }); continue; }

        await espera(120);
        const s = await (await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: h })).json();
        const agendado = soData(s?.shipping_option?.buffering?.date);
        const cancelado = s?.status === 'cancelled';
        const liberado = s?.status === 'ready_to_ship' && s?.substatus === 'ready_to_print';

        const upd = {
          ml_ship_status: s?.status || null,
          ml_ship_substatus: s?.substatus || null,
          ml_ship_checado_em: new Date().toISOString(),
        };
        // mesma protecao do sync: data conhecida nao e apagada por null
        if (agendado) upd.ml_agendado_em = agendado;
        // carimba a regra pra o pedido nao depender so da data na proxima volta
        if (agendado || s?.substatus === 'buffered') upd.print_regra = 'MELI_AGENDADO';
        await supabase.from('wms_pedidos').update(upd).eq('pedido_id', p.pedido_id);

        const dataMostrar = agendado || soData(p.ml_agendado_em);
        if (cancelado) cancelados.push({ numero: p.numero, conta: p.conta });
        else if (agendado || s?.substatus === 'buffered') {
          agendados.push({ numero: p.numero, conta: p.conta, em: dataMostrar, em_br: brDia(dataMostrar) });
        } else if (liberado) liberados.push({ numero: p.numero, conta: p.conta });
        else semResposta.push({ numero: p.numero, motivo: `ML: ${s?.status || '?'}/${s?.substatus || '?'}` });
      } catch (e) {
        semResposta.push({ numero: p.numero, motivo: String(e?.message || 'falha na consulta') });
      }
      await espera(140);
    }

    return res.status(200).json({
      ok: true, consultados: alvo.length, nao_ml: naoMl,
      agendados, cancelados, liberados, sem_resposta: semResposta,
      segundos: Math.round((Date.now() - inicio) / 1000),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
