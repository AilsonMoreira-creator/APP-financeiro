// ═══════════════════════════════════════════════════════════════════════════
// /api/wms-cancelados — ABA CANCELADOS (Ailson 29/08/2026)
// ---------------------------------------------------------------------------
// Fluxo definido por ele:
//   1. o marketplace diz que o envio foi CANCELADO (hoje: ml_ship_status =
//      'cancelled', gravado pelo agenda-sync ou pela consulta do modal)
//   2. o pedido cai aqui, com a nota ainda viva — pra equipe cancelar no Bling
//   3. cancelou no Bling (nf_situacao 2) → some da aba, ciclo completo
//
// Sem API de cancelamento: a nota e cancelada A MAO no Bling, de proposito —
// cancelamento de NF e irreversivel e tem prazo legal.
//
// GET → { ok, total, pedidos: [...] }
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };

// Situações da NF no Bling (as mesmas do wms-classificar):
//   2 CANCELADA · 5 autorizada · 6 DANFE emitida
const NOME_SIT = {
  1: 'pendente', 2: 'cancelada', 3: 'aguardando recibo', 4: 'rejeitada',
  5: 'autorizada', 6: 'DANFE emitida', 7: 'registrada', 8: 'aguardando protocolo',
  9: 'denegada', 11: 'bloqueada',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  // POST { ids: [...] } → ARQUIVAR (ordem dele 29/08): o card some da lista e
  // do contador sem depender da nota ser cancelada no Bling. Nao mexe na nota
  // nem no pedido — so tira da vista da equipe.
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const ids = (body?.ids || []).map(String).filter(Boolean).slice(0, 200);
    if (!ids.length) return res.status(400).json({ ok: false, erro: 'sem ids' });
    const { error } = await supabase.from('wms_pedidos')
      .update({ cancelado_arquivado_em: new Date().toISOString() })
      .in('pedido_id', ids);
    if (error) return res.status(500).json({ ok: false, erro: error.message });
    return res.status(200).json({ ok: true, arquivados: ids.length });
  }

  try {
    const desde = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    let q = supabase.from('wms_pedidos')
      .select('pedido_id, conta, numero, numero_loja, canal_geral, cliente_nome, itens, data_pedido, nf_id, nf_situacao, ml_ship_status, ml_ship_checado_em, etiqueta_impressa_em, nf_agendada_impressa_em, status_wms')
      .eq('ml_ship_status', 'cancelled')
      .is('cancelado_arquivado_em', null)
      .gte('data_pedido', desde)
      .order('data_pedido', { ascending: false })
      .limit(200);
    if (req.query?.contas && req.query.contas !== 'todas') {
      q = q.in('conta', String(req.query.contas).split(','));
    }
    const { data, error } = await q;
    if (error) throw error;

    const pedidos = (data || [])
      // ciclo completo: nota cancelada no Bling → sai da aba.
      // Pedido sem nota nenhuma tambem nao interessa aqui (nada a cancelar).
      .filter(p => p.nf_id && p.nf_situacao !== 2)
      .map(p => {
        const it0 = (p.itens || [])[0] || {};
        return {
          pedido_id: p.pedido_id,
          numero: p.numero,
          numero_loja: p.numero_loja,
          conta: p.conta,
          canal: p.canal_geral,
          cliente: p.cliente_nome || '',
          ref: String(it0.ref || it0.codigo || '').replace(/^0+/, ''),
          data_pedido: p.data_pedido,
          nf_id: p.nf_id,
          nf_situacao: p.nf_situacao,
          nf_situacao_nome: NOME_SIT[p.nf_situacao] || `situação ${p.nf_situacao}`,
          detectado_em: p.ml_ship_checado_em,
          // sinal pra equipe: se ja saiu papel desse pedido, tem etiqueta/nota
          // impressa circulando que precisa ser descartada
          ja_imprimiu: !!(p.etiqueta_impressa_em || p.nf_agendada_impressa_em),
        };
      });

    return res.status(200).json({ ok: true, total: pedidos.length, pedidos });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
