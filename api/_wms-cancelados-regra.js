// _wms-cancelados-regra.js — quem entra na aba CANCELADOS do WMS (Ailson 25/09/2026)
//
// Regra dele: a aba e pra CANCELAMENTO, nao pra DEVOLUCAO.
//   entra  = envio cancelado no ML + nota viva (nao cancelada no Bling)
//            + pacote AINDA NAO SAIU (nao foi coletado/despachado)
//            + dentro da janela de 24h em que a nota ainda pode ser cancelada
//   fica de fora = devolucao / cancelamento depois do despacho (pacote no hub,
//            saiu pra entrega, entregue...) ou nota fora da janela de 24h.
//
// A hora da nota vem do log da esteira (NF gerada pelo app); se a nota foi feita
// fora da esteira, vale a hora do pedido.
// Lista (wms-cancelados) e contador (wms-etiquetas?contadores=1) usam ESTA funcao,
// pra nunca mais mostrarem numeros diferentes.
import { supabase } from './_bling-helpers.js';

export const JANELA_H = 24;
const DESPACHADO = new Set(['in_hub', 'out_for_delivery', 'ready_for_pickup', 'delivered', 'picked_up',
  'in_transit', 'shipped', 'waiting_for_withdrawal', 'returning', 'returned', 'soon_deliver', 'at_customs']);

export async function filtrarCancelamentos(rows) {
  const vivos = (rows || []).filter(p => p.nf_id && p.nf_situacao !== 2);
  if (!vivos.length) return [];
  const ids = vivos.map(p => String(p.pedido_id));
  const horaNf = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('wms_nfe_log').select('pedido_id, criado_em')
      .in('pedido_id', ids.slice(i, i + 200)).in('etapa', ['final', 'gerar']).eq('resultado', 'ok');
    for (const l of data || []) {
      const t = new Date(l.criado_em).getTime(), k = String(l.pedido_id);
      if (!horaNf[k] || t > horaNf[k]) horaNf[k] = t;
    }
  }
  const limite = Date.now() - JANELA_H * 3600000;
  return vivos.filter(p => {
    if (DESPACHADO.has(String(p.ml_ship_substatus || '').toLowerCase())) return false;   // devolucao / pos-despacho
    const t = horaNf[String(p.pedido_id)] || new Date(p.data_pedido).getTime();
    return Number.isFinite(t) && t >= limite;
  }).map(p => ({ ...p, nf_hora: horaNf[String(p.pedido_id)] ? new Date(horaNf[String(p.pedido_id)]).toISOString() : null }));
}
