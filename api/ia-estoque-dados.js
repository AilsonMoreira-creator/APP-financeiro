/**
 * ia-estoque-dados.js  -  4 cards do TabEstoque (Sprint 6.1).
 *
 * GET /api/ia-estoque-dados?card=<nome>
 *   Header: X-User: <usuario admin>
 *
 * Cards suportados:
 *   - saude_geral         (Card 1) - contadores e percentuais por status de cobertura
 *   - tendencia_12m       (Card 2) - serie mensal de estoque total
 *   - ruptura_critica     (Card 3) - variacoes zeradas com demanda ativa
 *   - ruptura_disfarcada  (Card 4) - variacoes que paravam de vender
 *
 * Arquitetura:
 *   - ADMIN-ONLY RIGIDO (dupla validacao): decisao #5 do PROMPT MESTRE
 *     ('Home so admin na v1.0 - schema multi-user pronto pra expansao').
 *     Estoque e' info sensivel de saude operacional.
 *   - Endpoint unico com ?card= (mesmo padrao do ia-marketplaces-dados).
 *   - Cache s-maxage=60: views recalculam em O(segundos), alivia bursts.
 *   - Limit defensivo em ruptura_critica/disfarcada pro Safari mobile.
 *
 * Formato de resposta (ok=true):
 *   {
 *     "ok": true,
 *     "card": "<nome>",
 *     "tempo_ms": NNN,
 *     ...payload especifico do card
 *   }
 *
 * Formato de erro:
 *   - 400: parametro card ausente ou invalido
 *   - 401/403: falha de auth admin
 *   - 500: erro interno ao consultar view
 */
import { supabase, validarAdmin, setCors } from './_ia-helpers.js';

// Limites defensivos: Safari mobile sofre com payload >1MB
const LIMITS = {
  ruptura_critica: 50,
  ruptura_disfarcada: 30,
  excesso_estoque: 100,
};

// Handlers por card. Cada um retorna { ...payload } ou throw.
const CARD_HANDLERS = {
  async saude_geral() {
    const { data, error } = await supabase
      .from('vw_estoque_saude_geral')
      .select('*');
    if (error) throw new Error(`vw_estoque_saude_geral: ${error.message}`);
    // View retorna exatamente 1 linha (agregacao global)
    return { saude: Array.isArray(data) && data.length > 0 ? data[0] : null };
  },

  async tendencia_12m() {
    const { data, error } = await supabase
      .from('vw_estoque_tendencia_12m')
      .select('ano_mes, qtd_total, qtd_refs, snapshot_date, delta_vs_mes_ant, var_pct_vs_mes_ant')
      .order('ano_mes', { ascending: true });
    if (error) throw new Error(`vw_estoque_tendencia_12m: ${error.message}`);
    return { serie: data || [] };
  },

  async ruptura_critica() {
    const { data, error } = await supabase
      .from('vw_estoque_ruptura_critica')
      .select('ref, descricao, cor, tam, estoque_atual, vendas_15d, vendas_30d, velocidade_dia, cobertura_dias, cobertura_status, demanda_status, confianca')
      .limit(LIMITS.ruptura_critica);
    if (error) throw new Error(`vw_estoque_ruptura_critica: ${error.message}`);
    return { variacoes: data || [] };
  },

  async ruptura_disfarcada() {
    const { data, error } = await supabase
      .from('vw_estoque_ruptura_disfarcada')
      .select('ref, descricao, cor, tam, estoque_atual, vendas_15d, vendas_30d, vendas_mes_ant, vendas_90d, ultima_venda, cobertura_status, confianca')
      .limit(LIMITS.ruptura_disfarcada);
    if (error) throw new Error(`vw_estoque_ruptura_disfarcada: ${error.message}`);
    return { variacoes: data || [] };
  },

  // Sprint 6.7: variacoes em excesso (cobertura > 60d AND estoque >= 20 pcs).
  // View ja vem ordenada por curva A>B>outras, depois excedente DESC.
  // Frontend agrupa por ref e calcula score de gravidade.
  async excesso_estoque() {
    const { data, error } = await supabase
      .from('vw_estoque_excesso')
      .select('ref, descricao, cor, tam, curva, estoque_atual, pecas_em_corte, pecas_excedentes, vendas_15d, vendas_30d, velocidade_dia, cobertura_dias, confianca')
      .limit(LIMITS.excesso_estoque);
    if (error) throw new Error(`vw_estoque_excesso: ${error.message}`);
    return { variacoes: data || [] };
  },
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  // 1a validacao: helper padrao (X-User + amicia_data.usuarios)
  const admin = await validarAdmin(req);
  if (!admin.ok) {
    return res.status(admin.status).json({ ok: false, error: admin.error });
  }

  // 2a validacao (redundante por seguranca): admin === true explicito
  // Mesmo padrao do ia-lucro-mes.js (decisao #5 admin-only rigido)
  if (admin.user?.admin !== true) {
    return res.status(403).json({ ok: false, error: 'Acesso restrito a admin' });
  }

  const card = String(req.query.card || '').trim();

  if (!card) {
    return res.status(400).json({
      ok: false,
      error: 'Parametro "card" obrigatorio',
      cards_disponiveis: Object.keys(CARD_HANDLERS),
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

    // Cache curto: views recalculam rapido; 1min alivia bursts quando
    // o usuario recarrega varios cards no mesmo minuto.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');

    return res.status(200).json({
      ok: true,
      card,
      tempo_ms: ms,
      ...payload,
    });
  } catch (e) {
    console.error(`[ia-estoque-dados] card=${card}:`, e);
    return res.status(500).json({
      ok: false,
      card,
      error: e.message || 'erro interno',
    });
  }
}
