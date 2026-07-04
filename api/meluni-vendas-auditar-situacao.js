// ============================================================================
// MELUNI — AUDITORIA de situação dos pedidos (Bling Lumia, canal Outros).
// Percorre meluni_vendas, consulta a situação ATUAL de cada pedido no Bling e
// grava em situacao_id/situacao_verificada_em. Serve pra achar pedidos que
// entraram no cache como Atendido (9) e depois foram CANCELADOS (12) — caso
// típico: Convertr manda o pedido no checkout, Pix expira sem pagar, pedido é
// cancelado, mas o snapshot ficou. Descoberto com a Ingrid (funcionária) que
// recebeu pós-compra de um Pix de teste nunca pago. Ailson 04/07/2026.
//
// GET ?limite=200  -> processa até N pedidos SEM verificação (incremental)
// GET ?tudo=1      -> re-verifica todos (ignora situacao_verificada_em)
// Só consulta e grava a situação. NÃO apaga nada.
// ============================================================================
import { supabase, refreshBlingToken, blingFetch } from './_bling-helpers.js';

export const config = { maxDuration: 300 };
const API = 'https://api.bling.com.br/Api/v3';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const q = req.query || {};
    const limite = Math.max(1, Math.min(300, parseInt(q.limite || '200', 10) || 200));
    const tudo = q.tudo === '1';

    let sel = supabase.from('meluni_vendas')
      .select('pedido_id, cliente_id, data_pedido, total_pedido, situacao_id')
      .order('data_pedido', { ascending: false }).limit(limite);
    if (!tudo) sel = sel.is('situacao_verificada_em', null);
    const { data: vendas, error } = await sel;
    if (error) throw new Error(error.message);
    if (!vendas?.length) return res.json({ ok: true, verificados: 0, msg: 'nada pendente de verificação' });

    const token = await refreshBlingToken('lumia');
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

    const porSituacao = {};
    const cancelados = [];
    let verificados = 0, erros = 0;

    for (const v of vendas) {
      try {
        const r = await blingFetch(`${API}/pedidos/vendas/${v.pedido_id}`, headers);
        const j = await r.json().catch(() => null);
        if (r.status !== 200 || !j?.data) { erros++; await sleep(350); continue; }
        const sid = j.data.situacao?.id ?? null;
        await supabase.from('meluni_vendas').update({
          situacao_id: sid, situacao_verificada_em: new Date().toISOString(),
        }).eq('pedido_id', v.pedido_id);
        verificados++;
        const k = String(sid);
        porSituacao[k] = (porSituacao[k] || 0) + 1;
        if (sid === 12) cancelados.push({ pedido_id: v.pedido_id, cliente_id: v.cliente_id, data: v.data_pedido, total: v.total_pedido });
      } catch { erros++; }
      await sleep(350); // ~3 req/s Bling
    }

    return res.json({ ok: true, verificados, erros, por_situacao: porSituacao, cancelados_amostra: cancelados.slice(0, 30), cancelados_total: cancelados.length, legenda: { 6: 'Em aberto', 9: 'Atendido', 12: 'Cancelado', 15: 'Em andamento' } });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
