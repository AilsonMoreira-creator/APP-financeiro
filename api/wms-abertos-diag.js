// /api/wms-abertos-diag — one-off: lista os pedidos status_wms='aberto'
// do funil de separação com os campos que explicam por que estão ali.
import { supabase } from './_ml-helpers.js';

export default async function handler(req, res) {
  try {
    const { data } = await supabase.from('wms_pedidos')
      .select('numero, conta, canal_geral, status_wms, situacao_nome, situacao_bling, qtd_pecas, data_pedido, criado_em, impresso_em, nf_situacao, ml_logistic_type, ml_ship_status, etiqueta_impressa_em, finalizado_em')
      .eq('status_wms', 'aberto')
      .order('criado_em', { ascending: true })
      .limit(20);
    return res.status(200).json({ abertos: data || [] });
  } catch (e) {
    return res.status(500).json({ erro: String(e?.message || e) });
  }
}
