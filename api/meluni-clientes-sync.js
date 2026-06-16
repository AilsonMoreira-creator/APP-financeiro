// ============================================================================
// MELUNI — sync de clientes + vendas a partir do Bling (conta LUMIA, canal Outros)
// ----------------------------------------------------------------------------
// As vendas da Meluni (B2C site Convertr) entram no Bling LUMIA como canal "Outros".
// O cache de vendas (bling_vendas_detalhe) ja tem pedido/itens/total, mas NAO tem o
// cliente. Aqui a gente busca o contato por pedido no Bling, popula meluni_clientes
// e meluni_vendas, e recalcula os KPIs (n_compras, lifetime, ticket, 1a/ult compra).
//
// Incremental: so processa pedidos que ainda nao estao em meluni_vendas.
// Params (query ou body): dias (janela, default 120), limite (pedidos por run, default 80).
// O WhatsApp definitivo vem depois do cruzamento com a planilha de cadastro do Convertr;
// aqui guardamos telefone/celular do Bling como base. Ailson 13/06/2026.
// ============================================================================
import { supabase, refreshBlingToken, blingFetch } from './_bling-helpers.js';

export const config = { maxDuration: 300 };

const API = 'https://api.bling.com.br/Api/v3';
const soDigitos = (s) => (s ? String(s).replace(/\D/g, '') : '') || null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));  // throttle anti rate-limit Bling (~3 req/s)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = { ...(req.query || {}), ...(req.body || {}) };
  const dias = Math.max(1, parseInt(q.dias || '120', 10) || 120);
  const limite = Math.max(1, Math.min(300, parseInt(q.limite || '80', 10) || 80));
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);

  try {
    // 1. Pedidos Meluni (lumia / Outros) na janela
    const { data: pedidos, error: pErr } = await supabase
      .from('bling_vendas_detalhe')
      .select('pedido_id, data_pedido, total_pedido, total_produtos, itens')
      .eq('conta', 'lumia').eq('canal_geral', 'Outros')
      .gte('data_pedido', desde)
      .order('data_pedido', { ascending: false })
      .limit(3000);
    if (pErr) throw new Error('bling_vendas_detalhe: ' + pErr.message);

    const todos = pedidos || [];
    if (!todos.length) return res.json({ ok: true, novos: 0, msg: 'sem pedidos lumia/Outros na janela' });

    // 2. Filtra os que ainda nao estao em meluni_vendas (incremental)
    const ids = todos.map(p => Number(p.pedido_id));
    const jaTemSet = new Set();
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data: jt } = await supabase.from('meluni_vendas').select('pedido_id').in('pedido_id', chunk);
      for (const v of jt || []) jaTemSet.add(Number(v.pedido_id));
    }
    const pendentes = todos.filter(p => !jaTemSet.has(Number(p.pedido_id))).slice(0, limite);

    const token = await refreshBlingToken('lumia');
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

    // BACKFILL: clientes que JA existem com bling_contato_id mas sem nome/CPF
    // (o contato falhou num sync anterior). Re-busca o contato no Bling, com throttle.
    // Roda mesmo quando nao ha pedido novo.
    const backfillLimite = Math.max(0, Math.min(300, parseInt(q.backfill_limite || '130', 10) || 130));
    let backfillFeitos = 0, backfillSemDado = 0;
    {
      const { data: faltando } = await supabase
        .from('meluni_clientes')
        .select('id, bling_contato_id')
        .not('bling_contato_id', 'is', null)
        .or('nome.is.null,cpf.is.null')
        .limit(backfillLimite);
      for (const cl of faltando || []) {
        try {
          await sleep(340);
          const r = await blingFetch(`${API}/contatos/${cl.bling_contato_id}`, headers);
          const j = await r.json();
          const d = j?.data;
          if (d && (d.nome || d.numeroDocumento)) {
            await supabase.from('meluni_clientes').update({
              nome: d.nome || null,
              cpf: soDigitos(d.numeroDocumento),
              telefone: soDigitos(d.celular) || soDigitos(d.telefone),
              email: d.email || null,
              atualizado_em: new Date().toISOString(),
            }).eq('id', cl.id);
            backfillFeitos++;
          } else backfillSemDado++;
        } catch (e) { backfillSemDado++; }
      }
    }

    if (!pendentes.length) {
      let reconciliado = false;
      try { await supabase.rpc('fn_meluni_reconciliar_contatos'); reconciliado = true; } catch (e) { /* segue */ }
      return res.json({
        ok: true, novos: 0, msg: 'sem pedido novo; backfill de contato executado',
        backfill_feitos: backfillFeitos, backfill_sem_dado: backfillSemDado, reconciliado,
      });
    }

    // 3. Pra cada pedido: pega contato.id (detalhe do pedido)
    const pedidoContato = {}; // pedido_id -> contatoId
    const contatoIds = new Set();
    for (const p of pendentes) {
      try {
        await sleep(340);
        const r = await blingFetch(`${API}/pedidos/vendas/${p.pedido_id}`, headers);
        const j = await r.json();
        const c = j?.data?.contato;
        if (c?.id) {
          pedidoContato[p.pedido_id] = String(c.id);
          contatoIds.add(String(c.id));
        }
      } catch (e) { /* segue sem contato; venda ainda entra */ }
    }

    // 4. Pra cada contato unico: nome, CPF, telefone/celular, email
    const contatoInfo = {};
    let contatoErros = 0;
    for (const cid of contatoIds) {
      try {
        await sleep(340);
        const r = await blingFetch(`${API}/contatos/${cid}`, headers);
        const j = await r.json();
        const d = j?.data;
        if (d) contatoInfo[cid] = {
          nome: d.nome || null,
          cpf: soDigitos(d.numeroDocumento),
          telefone: soDigitos(d.celular) || soDigitos(d.telefone),
          email: d.email || null,
        };
        else contatoErros++;
      } catch (e) { contatoErros++; }
    }

    // 5. Upsert clientes (por bling_contato_id). Nao toca em whatsapp/dados_extra
    //    (vem da planilha Convertr depois).
    const clienteIdPorContato = {};
    for (const cid of contatoIds) {
      const info = contatoInfo[cid] || {};
      const row = {
        bling_contato_id: cid,
        nome: info.nome || null,
        cpf: info.cpf || null,
        email: info.email || null,
        telefone: info.telefone || null,
        origem_cadastro: 'bling_lumia',
        atualizado_em: new Date().toISOString(),
      };
      const { data: up, error: uErr } = await supabase
        .from('meluni_clientes')
        .upsert(row, { onConflict: 'bling_contato_id' })
        .select('id').single();
      if (!uErr && up?.id) clienteIdPorContato[cid] = up.id;
    }

    // 6. Upsert vendas (liga cliente_id)
    let novos = 0;
    for (const p of pendentes) {
      const cid = pedidoContato[p.pedido_id];
      const clienteId = cid ? clienteIdPorContato[cid] : null;
      const { error: vErr } = await supabase.from('meluni_vendas').upsert({
        pedido_id: p.pedido_id,
        cliente_id: clienteId || null,
        bling_contato_id: cid || null,
        data_pedido: p.data_pedido,
        total_pedido: p.total_pedido,
        total_produtos: p.total_produtos,
        itens: p.itens || [],
      }, { onConflict: 'pedido_id' });
      if (!vErr) novos++;
    }

    // 7. Recalcula KPIs dos clientes afetados (agrega TODAS as vendas dele)
    const afetados = [...new Set(Object.values(clienteIdPorContato))];
    for (const clienteId of afetados) {
      const { data: vs } = await supabase
        .from('meluni_vendas').select('total_pedido, data_pedido').eq('cliente_id', clienteId);
      if (!vs || !vs.length) continue;
      const n = vs.length;
      const soma = vs.reduce((a, v) => a + (parseFloat(v.total_pedido) || 0), 0);
      const datas = vs.map(v => v.data_pedido).filter(Boolean).sort();
      await supabase.from('meluni_clientes').update({
        n_compras: n,
        valor_lifetime: Number(soma.toFixed(2)),
        ticket_medio: n ? Number((soma / n).toFixed(2)) : 0,
        primeira_compra: datas[0] || null,
        ultima_compra: datas[datas.length - 1] || null,
        atualizado_em: new Date().toISOString(),
      }).eq('id', clienteId);
    }

    // 8. Casa comprador (Bling) com cadastro (Convertr) por CPF e preenche
    //    whatsapp/nome faltantes; tambem reconcilia carrinho/devolucao.
    let reconciliado = false;
    try { await supabase.rpc('fn_meluni_reconciliar_contatos'); reconciliado = true; }
    catch (e) { /* nao bloqueia o sync */ }

    return res.json({
      ok: true,
      janela_dias: dias,
      pedidos_pendentes: pendentes.length,
      vendas_gravadas: novos,
      contatos_bling: contatoIds.size,
      contatos_sem_dado: contatoErros,
      backfill_feitos: backfillFeitos,
      backfill_sem_dado: backfillSemDado,
      clientes_kpi_recalc: afetados.length,
      reconciliado,
    });
  } catch (e) {
    console.error('[meluni-clientes-sync] ERRO:', e?.message || e);
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
