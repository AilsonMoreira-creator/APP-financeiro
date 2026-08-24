// /api/wms-contador-diag — one-off: replica o funil do contador de
// NF+transporte e conta quantos pedidos caem em CADA gate, com amostras.
import { supabase } from './_ml-helpers.js';

export default async function handler(req, res) {
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const desde7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const { data } = await supabase.from('wms_pedidos')
    .select('pedido_id, numero, conta, canal_geral, ml_logistic_type, print_regra, print_estado, ml_agendado_em, ml_ship_status, ml_ship_substatus, nf_agendada_impressa_em, nf_id, nf_situacao, etiqueta_impressa_em, status_wms, situacao_bling')
    .neq('status_wms', 'cancelado')
    .gte('data_pedido', desde7)
    .limit(3000);

  // printed sem download nosso
  const idsP = (data || []).filter(p => p.ml_ship_substatus === 'printed' && !p.etiqueta_impressa_em).map(p => p.pedido_id);
  let dl = new Set();
  if (idsP.length) {
    const { data: dcs } = await supabase.from('wms_documentos').select('pedido_id').in('pedido_id', idsP).in('tipo', ['ETIQUETA', 'PREVIA_PNG']);
    dl = new Set((dcs || []).map(d => String(d.pedido_id)));
  }

  const g = {}; const add = (k, p) => { (g[k] = g[k] || { qtd: 0, amostra: [] }); g[k].qtd++; if (g[k].amostra.length < 6) g[k].amostra.push(`${p.numero}·${p.canal_geral}·${p.ml_ship_substatus || '-'}·sit${p.nf_situacao ?? '-'}`); };

  for (const p of (data || [])) {
    if (p.print_regra === 'ML_FULL' || p.ml_logistic_type === 'fulfillment') { continue; }
    const agendado = p.ml_agendado_em && String(p.ml_agendado_em) > hoje;
    if (p.print_regra === 'MELI_AGENDADO' || agendado || p.ml_ship_substatus === 'buffered') { add('gate_agendada', p); continue; }
    if (p.print_regra === 'MELUNI') { continue; }
    if (p.print_estado !== 'PRONTO') { continue; }
    if (p.ml_ship_status === 'cancelled') { add('gate_cancelled', p); continue; }
    if (p.ml_ship_substatus === 'printed' && !p.etiqueta_impressa_em && !dl.has(String(p.pedido_id))) { add('gate_painel_ml', p); continue; }
    if (p.nf_situacao === 6) { add('gate_danfe6', p); continue; }
    if (p.print_regra === 'MELI_FLEX') { add('contado_flex', p); continue; }
    if (p.print_regra === 'NORMAL') { add('contado_nf_transporte', p); continue; }
    add('sem_regra', p);
  }
  return res.status(200).json(g);
}
