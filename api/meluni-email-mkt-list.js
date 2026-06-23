// ============================================================================
// MELUNI — E-mail Mkt: listagem das 3 etapas (cards, sem chat).
//  - processando : carrinhos elegíveis (view vw_meluni_email_elegiveis)
//  - enviados    : meluni_email_envios com enviado_em no período
//  - abertura    : meluni_email_envios com aberto_em no período
// Query: etapa (default processando), periodo (mes_atual|15d|7d|mes_passado),
//        limite (default 80), offset (0). Ailson 19/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

function rangePeriodo(periodo) {
  const now = new Date();
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (periodo === '7d')  return { de: new Date(Date.now() - 7  * 86400000).toISOString(), ate: null };
  if (periodo === '15d') return { de: new Date(Date.now() - 15 * 86400000).toISOString(), ate: null };
  if (periodo === 'mes_passado') {
    return { de: new Date(Date.UTC(y, m - 1, 1)).toISOString(), ate: new Date(Date.UTC(y, m, 1)).toISOString() };
  }
  // mes_atual (default)
  return { de: new Date(Date.UTC(y, m, 1)).toISOString(), ate: null };
}

async function contar(tabela, campo, de, ate, extra) {
  let q = supabase.from(tabela).select('*', { count: 'exact', head: true });
  if (campo) { q = q.gte(campo, de); if (ate) q = q.lt(campo, ate); }
  if (extra === 'aberto') q = q.not('aberto_em', 'is', null);
  const { count } = await q;
  return count || 0;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const q = req.query || {};
  const etapa = ['processando', 'enviados', 'abertura', 'arquivadas'].includes(q.etapa) ? q.etapa : 'processando';
  const periodo = q.periodo || 'mes_atual';
  const limite = Math.min(200, parseInt(q.limite || '80', 10) || 80);
  const offset = Math.max(0, parseInt(q.offset || '0', 10) || 0);
  const { de, ate } = rangePeriodo(periodo);

  try {
    // contagens das 3 abas (badges), todas no período escolhido
    const [cProc, cEnv, cAb, cArq] = await Promise.all([
      contar('vw_meluni_email_elegiveis', 'data_carrinho', de, ate),
      contar('meluni_email_envios', 'enviado_em', de, ate),
      contar('meluni_email_envios', 'aberto_em', de, ate, 'aberto'),
      contar('meluni_carrinhos', 'email_mkt_bloqueado_em', de, ate),
    ]);
    const counts = { processando: cProc, enviados: cEnv, abertura: cAb, arquivadas: cArq };

    let cards = [], total = 0;

    if (etapa === 'processando') {
      let query = supabase.from('vw_meluni_email_elegiveis')
        .select('id,nome,email,valor,itens,data_carrinho', { count: 'exact' })
        .gte('data_carrinho', de);
      if (ate) query = query.lt('data_carrinho', ate);
      const { data, count, error } = await query
        .order('data_carrinho', { ascending: false, nullsFirst: false })
        .range(offset, offset + limite - 1);
      if (error) throw new Error(error.message);
      total = count || 0;
      cards = (data || []).map(c => ({
        id: c.id, carrinho_id: c.id, nome: c.nome, email: c.email,
        valor: c.valor, itens: c.itens, data: c.data_carrinho,
      }));
    } else if (etapa === 'arquivadas') {
      let query = supabase.from('meluni_carrinhos')
        .select('id,nome,email,valor,itens,data_carrinho,email_mkt_bloqueado_em', { count: 'exact' })
        .not('email_mkt_bloqueado_em', 'is', null)
        .gte('email_mkt_bloqueado_em', de);
      if (ate) query = query.lt('email_mkt_bloqueado_em', ate);
      const { data, count, error } = await query
        .order('email_mkt_bloqueado_em', { ascending: false, nullsFirst: false })
        .range(offset, offset + limite - 1);
      if (error) throw new Error(error.message);
      total = count || 0;
      cards = (data || []).map(c => ({
        id: c.id, carrinho_id: c.id, nome: c.nome, email: c.email,
        valor: c.valor, itens: c.itens, data: c.email_mkt_bloqueado_em,
      }));
    } else {
      const campo = etapa === 'abertura' ? 'aberto_em' : 'enviado_em';
      let query = supabase.from('meluni_email_envios')
        .select('id,carrinho_id,nome,email,valor,enviado_em,aberto_em,clicado_em', { count: 'exact' })
        .gte(campo, de);
      if (ate) query = query.lt(campo, ate);
      if (etapa === 'abertura') query = query.not('aberto_em', 'is', null);
      const { data, count, error } = await query
        .order(campo, { ascending: false, nullsFirst: false })
        .range(offset, offset + limite - 1);
      if (error) throw new Error(error.message);
      total = count || 0;
      cards = (data || []).map(e => ({
        id: e.id, carrinho_id: e.carrinho_id, nome: e.nome, email: e.email,
        valor: e.valor, data: campo === 'aberto_em' ? e.aberto_em : e.enviado_em,
        enviado_em: e.enviado_em, aberto_em: e.aberto_em, clicado_em: e.clicado_em,
      }));
    }

    return res.json({ ok: true, etapa, periodo, de, ate, total, counts, cards });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
