// /api/wms-contador-diag — COMPARADOR: replica o chip e o ramo "prontas" da
// previa na MESMA execucao e lista os pedidos que divergem, com os campos.
import { supabase } from './_ml-helpers.js';

export default async function handler(req, res) {
  try {
    const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
    const desde7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const { data, error } = await supabase.from('wms_pedidos')
      .select('pedido_id, numero, conta, canal_geral, ml_logistic_type, print_regra, print_estado, print_etiqueta, ml_agendado_em, ml_ship_status, ml_ship_substatus, nf_agendada_impressa_em, nf_id, nf_situacao, etiqueta_impressa_em, status_wms, situacao_bling')
      .neq('status_wms', 'cancelado')
      .gte('data_pedido', desde7)
      .limit(4000);
    if (error) return res.status(200).json({ erro: error.message });

    const idsP = (data || []).filter(p => p.ml_ship_substatus === 'printed' && !p.etiqueta_impressa_em).map(p => p.pedido_id);
    let dl = new Set();
    if (idsP.length) {
      const { data: dcs } = await supabase.from('wms_documentos').select('pedido_id').in('pedido_id', idsP).in('tipo', ['ETIQUETA', 'PREVIA_PNG']);
      dl = new Set((dcs || []).map(d => String(d.pedido_id)));
    }
    const painelMl = (p) => p.ml_ship_substatus === 'printed' && !p.etiqueta_impressa_em && !dl.has(String(p.pedido_id));

    const chip = new Map(); const previa = new Map();
    for (const p of (data || [])) {
      const tag = `${p.numero}·${p.conta}·${p.canal_geral}·regra:${p.print_regra || '-'}·estado:${p.print_estado || '-'}·sit:${p.nf_situacao ?? '-'}·bling:${p.situacao_bling ?? '-'}·wms:${p.status_wms}·sub:${p.ml_ship_substatus || '-'}·etiq:${p.print_etiqueta === false ? 'nao' : 'sim'}·carimbo:${p.etiqueta_impressa_em ? 'S' : 'N'}`;
      const full = p.print_regra === 'ML_FULL' || p.ml_logistic_type === 'fulfillment';
      const flex = p.ml_logistic_type === 'self_service';
      const agendadoFut = p.ml_agendado_em && String(p.ml_agendado_em) > hoje;

      // ── CHIP (algebra atual do contador) ──
      do {
        if (full) break;
        if (p.print_regra === 'MELI_AGENDADO' || agendadoFut || p.ml_ship_substatus === 'buffered') break;
        if (p.print_regra === 'MELUNI' || p.canal_geral === 'Meluni') break;
        const prontoCont = p.print_estado === 'PRONTO' || (p.nf_situacao === 5 && p.print_estado !== 'IMPRESSO' && !p.etiqueta_impressa_em);
        if (!prontoCont) break;
        if (p.ml_ship_status === 'cancelled') break;
        if (painelMl(p)) break;
        if (p.nf_situacao === 6) break;
        if (p.print_regra === 'MELI_FLEX' || flex) break; // vai pro flex, nao pro nf_transporte
        chip.set(String(p.pedido_id), tag);
      } while (0);

      // ── PREVIA ramo prontas (tipo nf_transporte, pedidosFiltrados + else-if) ──
      do {
        if (full) break;
        if (flex || p.canal_geral === 'Meluni') break;
        if (agendadoFut) break;
        // else-if chain da previa:
        const sit = p.nf_situacao;
        const liberada = p.ml_agendado_em && String(p.ml_agendado_em).slice(0, 10) <= hoje
          && p.ml_ship_status === 'ready_to_ship' && p.ml_ship_substatus === 'ready_to_print' && !p.etiqueta_impressa_em;
        if (liberada) break; // na previa do nf_transporte nao ha ramo liberada... (só no tipo proprio) — nao quebra: seguir
      } while (0);
      // refaz sem o break errado da liberada:
      (() => {
        if (full) return;
        if (flex || p.canal_geral === 'Meluni') return;
        if (agendadoFut) return;
        const sit = p.nf_situacao;
        if (sit === 6 || painelMl(p) || p.etiqueta_impressa_em || p.print_estado === 'IMPRESSO') return; // ramo impressas
        if ((sit === 5 || p.print_estado === 'PRONTO') && p.ml_ship_status !== 'cancelled') previa.set(String(p.pedido_id), tag);
      })();
    }

    const soChip = [...chip.keys()].filter(k => !previa.has(k)).map(k => chip.get(k));
    const soPrevia = [...previa.keys()].filter(k => !chip.has(k)).map(k => previa.get(k));
    return res.status(200).json({ chip_nf_transporte: chip.size, previa_prontas: previa.size, so_no_chip: soChip.slice(0, 15), so_na_previa: soPrevia.slice(0, 15) });
  } catch (e) {
    return res.status(200).json({ erro_geral: String(e?.message || e) });
  }
}
