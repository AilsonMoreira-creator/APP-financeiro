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
import { supabase, refreshBlingToken, blingFetch } from './_bling-helpers.js';

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

  // POST { acao:'atualizar', ids:[...] } → RECONSULTA a nota no Bling (ordem
  // dele 29/08). Existe porque pedido com nota cancelada para de ser varrido
  // pelo nf-sync: os 4 de 16/08 tinham a nota cancelada desde o dia 17 e o
  // espelho seguia com nf_situacao NULA, segurando eles na aba a toa.
  let corpo = req.body;
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch { corpo = {}; } }
  if (req.method === 'POST' && corpo?.acao === 'atualizar') {
    return await atualizarSituacoes(corpo, res);
  }

  // POST { ids: [...] } → ARQUIVAR (ordem dele 29/08): o card some da lista e
  // do contador sem depender da nota ser cancelada no Bling. Nao mexe na nota
  // nem no pedido — so tira da vista da equipe.
  if (req.method === 'POST') {
    const body = corpo;
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

// Relê a nota de cada pedido no Bling e grava a situação real. Falha de leitura
// NÃO vira "não existe": o pedido que não responder fica como estava.
async function atualizarSituacoes(corpo, res) {
  const ids = (corpo?.ids || []).map(String).filter(Boolean).slice(0, 60);
  if (!ids.length) return res.status(400).json({ ok: false, erro: 'sem ids' });
  const { data: peds } = await supabase.from('wms_pedidos')
    .select('pedido_id, numero, conta, nf_id, nf_situacao').in('pedido_id', ids);

  const tokens = {};
  const atualizados = [], semResposta = [];
  let saiuDaAba = 0;
  for (const p of (peds || [])) {
    if (!p.nf_id) { semResposta.push({ numero: p.numero, motivo: 'pedido sem nota' }); continue; }
    try {
      if (!(p.conta in tokens)) tokens[p.conta] = await refreshBlingToken(p.conta).catch(() => null);
      const tk = tokens[p.conta];
      if (!tk) { semResposta.push({ numero: p.numero, motivo: 'sem token da conta' }); continue; }
      const r = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${p.nf_id}`, { Authorization: `Bearer ${tk}` });
      const j = r?.text ? JSON.parse(await r.text()) : null;
      const sit = j?.data?.situacao;
      if (sit == null) { semResposta.push({ numero: p.numero, motivo: 'Bling não devolveu a situação' }); continue; }
      if (sit !== p.nf_situacao) {
        await supabase.from('wms_pedidos')
          .update({ nf_situacao: sit, nf_checado_em: new Date().toISOString() })
          .eq('pedido_id', p.pedido_id);
      }
      atualizados.push({ numero: p.numero, de: p.nf_situacao, para: sit, nome: NOME_SIT[sit] || `situação ${sit}` });
      if (sit === 2) saiuDaAba++;
    } catch (e) {
      semResposta.push({ numero: p.numero, motivo: String(e?.message || 'falha na consulta') });
    }
    await new Promise(r2 => setTimeout(r2, 360));   // rate limit Bling: 3 req/s
  }
  return res.status(200).json({ ok: true, atualizados, sem_resposta: semResposta, saiu_da_aba: saiuDaAba });
}
