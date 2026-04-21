/**
 * ia-marketplaces-dados.js  —  Cards 2-7 do TabMarketplaces (Sprint 5).
 *
 * GET /api/ia-marketplaces-dados?card=<nome>
 *
 * Cards suportados:
 *   - vendas_mensais_24m    (Card 2) — serie de unidades por mes, 24 meses
 *   - canais_comparativo    (Card 3) — 7v7 e 30v30 por canal
 *   - contas_bling          (Card 4) — 7v7 por conta + refs em queda
 *   - top_movers            (Card 5) — 3 camadas (unificado/por_conta/cruzamento)
 *   - margens               (Card 6) — margem atual + plano de ajuste gradual
 *   - oportunidades         (Card 7) — refs com lucro bom/otimo e venda baixa
 *
 * Notas de arquitetura:
 *   - Sem admin-only: dados agregados, sem valor financeiro absoluto.
 *     Card 1 (lucro_marketplace_mes) continua em /api/ia-lucro-mes (admin).
 *   - Endpoint unico pra evitar proliferar arquivos (Sprint 5 handoff, seção 4).
 *   - Cache s-maxage=60: views recalculam em O(segundos); 1min e suficiente pra
 *     aliviar o Postgres sem atrasar perceptivelmente o dashboard.
 *   - Composite cards (contas_bling, top_movers, margens) fazem as queries em
 *     paralelo com Promise.all.
 *   - Limit defensivo nos endpoints que podem inflar (top_movers, oportunidades)
 *     pra evitar resposta > 1MB no Safari mobile.
 */
import { supabase, setCors } from './_ia-helpers.js';

// Limites defensivos por card (evita payload gigante no mobile).
const LIMITS = {
  top_movers_unificado: 50,
  top_movers_por_conta: 120,
  top_movers_cruzamento: 40,
  oportunidades: 100,
};

// Handlers por card. Cada um retorna { ok: true, ...payload } ou throw.
const CARD_HANDLERS = {
  async vendas_mensais_24m() {
    const { data, error } = await supabase
      .from('vw_vendas_mensais_24m')
      .select('ano, mes, data_ref, unidades_total, u_ml, u_shein, u_shopee, u_tiktok, u_meluni, u_outros')
      .order('data_ref', { ascending: true });
    if (error) throw new Error(`vw_vendas_mensais_24m: ${error.message}`);
    return { serie: data || [] };
  },

  async canais_comparativo() {
    const { data, error } = await supabase
      .from('vw_canais_comparativo')
      .select('canal_norm, u_ult7, u_ant7, u_ult30, u_ant30, var_7v7_pct, var_30v30_pct')
      .order('u_ult30', { ascending: false });
    if (error) throw new Error(`vw_canais_comparativo: ${error.message}`);
    return { canais: data || [] };
  },

  async contas_bling() {
    const [r1, r2] = await Promise.all([
      supabase
        .from('vw_contas_bling_7v7')
        .select('conta, pedidos_ult7, pedidos_ant7, receita_ult7, receita_ant7, var_pedidos_7v7_pct')
        .order('receita_ult7', { ascending: false, nullsFirst: false }),
      supabase
        .from('vw_contas_bling_concentracao_queda')
        .select('conta, ref_norm, u_ult7, u_ant7, delta')
        .order('delta', { ascending: true }),
    ]);
    if (r1.error) throw new Error(`vw_contas_bling_7v7: ${r1.error.message}`);
    if (r2.error) throw new Error(`vw_contas_bling_concentracao_queda: ${r2.error.message}`);
    return { resumo: r1.data || [], quedas: r2.data || [] };
  },

  async top_movers() {
    const [u, c, x] = await Promise.all([
      supabase
        .from('vw_top_movers_unificado')
        .select('ref_norm, descricao, u_ult7, u_ant7, delta, var_pct')
        .limit(LIMITS.top_movers_unificado),
      supabase
        .from('vw_top_movers_por_conta')
        .select('conta, ref_norm, u_ult7, u_ant7, delta, var_pct')
        .limit(LIMITS.top_movers_por_conta),
      supabase
        .from('vw_top_movers_cruzamento')
        .select('ref_norm, var_exitus, var_lumia, var_muniam, u7_exitus, u7_lumia, u7_muniam, n_contas, spread_var_pct')
        .order('spread_var_pct', { ascending: false })
        .limit(LIMITS.top_movers_cruzamento),
    ]);
    if (u.error) throw new Error(`vw_top_movers_unificado: ${u.error.message}`);
    if (c.error) throw new Error(`vw_top_movers_por_conta: ${c.error.message}`);
    if (x.error) throw new Error(`vw_top_movers_cruzamento: ${x.error.message}`);
    return {
      unificado: u.data || [],
      por_conta: c.data || [],
      cruzamento: x.data || [],
    };
  },

  async margens() {
    const [m, p] = await Promise.all([
      supabase
        .from('vw_margem_por_produto_canal')
        .select('ref_norm, descricao, canal_norm, preco_venda, custo_producao, lucro_peca, faixa'),
      supabase
        .from('vw_plano_ajuste_gradual')
        .select('ref_norm, descricao, canal_norm, preco_venda, custo_producao, lucro_peca, preco_sugerido_lucro_10, preco_sugerido_lucro_14, ajuste_para_lucro_10, ajuste_para_lucro_14'),
    ]);
    if (m.error) throw new Error(`vw_margem_por_produto_canal: ${m.error.message}`);
    if (p.error) throw new Error(`vw_plano_ajuste_gradual: ${p.error.message}`);
    return { margem: m.data || [], plano_ajuste: p.data || [] };
  },

  async oportunidades() {
    const { data, error } = await supabase
      .from('vw_oportunidades_margem')
      .select('ref_norm, descricao, canal_norm, preco_venda, lucro_peca, faixa, unidades_30d, lucro_acumulado_30d')
      .order('lucro_peca', { ascending: false })
      .order('unidades_30d', { ascending: true })
      .limit(LIMITS.oportunidades);
    if (error) throw new Error(`vw_oportunidades_margem: ${error.message}`);
    return { oportunidades: data || [] };
  },
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  const card = String(req.query.card || '').trim();

  if (!card) {
    return res.status(400).json({
      ok: false,
      error: 'Parametro "card" obrigatorio',
      cards_disponiveis: Object.keys(CARD_HANDLERS),
    });
  }

  // Card 1 tem endpoint proprio admin-only — redireciona explicitamente.
  if (card === 'lucro_marketplace_mes') {
    return res.status(400).json({
      ok: false,
      error: 'Card 1 (lucro_marketplace_mes) e admin-only e vive em /api/ia-lucro-mes',
    });
  }

  const handler_fn = CARD_HANDLERS[card];
  if (!handler_fn) {
    return res.status(400).json({
      ok: false,
      error: `Card "${card}" desconhecido`,
      cards_disponiveis: Object.keys(CARD_HANDLERS),
    });
  }

  try {
    const t0 = Date.now();
    const payload = await handler_fn();
    const ms = Date.now() - t0;

    // Cache curto no CDN — views recalculam rapido, mas 1min alivia bursts
    // quando o usuario clica/recarrega varios cards no mesmo minuto.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

    return res.status(200).json({
      ok: true,
      card,
      tempo_ms: ms,
      ...payload,
    });
  } catch (e) {
    console.error(`[ia-marketplaces-dados] card=${card}:`, e);
    return res.status(500).json({
      ok: false,
      card,
      error: e.message || 'erro interno',
    });
  }
}
