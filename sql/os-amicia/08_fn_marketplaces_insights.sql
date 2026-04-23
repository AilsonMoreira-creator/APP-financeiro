-- OS Amicia - Sprint 4 - Funcao orquestradora Marketplaces
-- Versao: 1.0 - Data: 21/04/2026
--
-- RODAR DEPOIS de 07_views_marketplaces.sql.
-- Idempotente: CREATE OR REPLACE FUNCTION.
--
-- Funcao fn_ia_marketplaces_insights():
--   Consolida as views 8-16 do Sprint 4 em um JSONB unico pro Claude
--   Sonnet 4.6 consumir via /api/ia-cron?escopo=marketplaces.
--
-- NAO inclui:
--   - Card 1 (vw_lucro_marketplace_mes): admin-only, endpoint dedicado
--     /api/ia-lucro-mes. Nao vai pro Claude.
--   - Card 2 (vw_vendas_mensais_24m): dado visual, grafico do frontend.
--
-- Formato de saida (compativel com regras do briefing):
--   {
--     "gerado_em": "<ISO>",
--     "versao": "1.0",
--     "canais_comparativo":   [...],  -- Card 3
--     "contas_bling_7v7":     [...],  -- Card 4
--     "concentracao_quedas":  [...],  -- Card 4 detalhe (top 3 por conta)
--     "top_movers_unificado": [...],  -- Card 5 c1 (top 10)
--     "top_movers_conta":     [...],  -- Card 5 c2 (top 5 por conta)
--     "top_movers_cruzamento":[...],  -- Card 5 c3
--     "margens_urgencia":     [...],  -- Card 6 faixa urgencia_maxima/critico
--     "margens_atencao":      [...],  -- Card 6 faixa atencao
--     "plano_ajuste":         [...],  -- Card 6 preco sugerido (so priorizados)
--     "oportunidades":        [...]   -- Card 7
--   }
--
-- SECURITY DEFINER: funcao roda com privilegios do owner pra ler views
-- que dependem de bling_vendas_detalhe, amicia_data, etc (RLS-protected).
-- Caller esperado: /api/ia-cron via service role.

CREATE OR REPLACE FUNCTION fn_ia_marketplaces_insights()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  resultado jsonb;
  canais_comp       jsonb;
  contas_7v7        jsonb;
  concentracao      jsonb;
  movers_unif       jsonb;
  movers_conta      jsonb;
  movers_cruz       jsonb;
  margens_urg       jsonb;
  margens_at        jsonb;
  plano_ajuste      jsonb;
  oportunidades     jsonb;
BEGIN
  -- Card 3: canais comparativo 7v7 + 30v30
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'canal',         canal_norm,
    'u_ult7',        u_ult7,
    'u_ant7',        u_ant7,
    'var_7v7_pct',   var_7v7_pct,
    'u_ult30',       u_ult30,
    'u_ant30',       u_ant30,
    'var_30v30_pct', var_30v30_pct
  )), '[]'::jsonb)
  INTO canais_comp
  FROM vw_canais_comparativo
  WHERE u_ult30 + u_ant30 >= 10;  -- filtra ruido

  -- Card 4: contas Bling 7v7
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'conta',              conta,
    'pedidos_ult7',       pedidos_ult7,
    'pedidos_ant7',       pedidos_ant7,
    'receita_ult7',       receita_ult7,
    'receita_ant7',       receita_ant7,
    'var_pedidos_7v7_pct', var_pedidos_7v7_pct
  )), '[]'::jsonb)
  INTO contas_7v7
  FROM vw_contas_bling_7v7;

  -- Card 4 detalhe: top 3 refs em queda por conta
  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
  INTO concentracao
  FROM (
    SELECT jsonb_build_object(
      'conta',  conta,
      'ref',    ref_norm,
      'u_ult7', u_ult7,
      'u_ant7', u_ant7,
      'delta',  delta
    ) AS item,
    ROW_NUMBER() OVER (PARTITION BY conta ORDER BY delta ASC) AS rk
    FROM vw_contas_bling_concentracao_queda
  ) t
  WHERE rk <= 3;

  -- Card 5 c1: top 10 movers unificados (maior variacao absoluta)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ref',       ref_norm,
    'descricao', descricao,
    'u_ult7',    u_ult7,
    'u_ant7',    u_ant7,
    'delta',     delta,
    'var_pct',   var_pct
  )), '[]'::jsonb)
  INTO movers_unif
  FROM (
    SELECT * FROM vw_top_movers_unificado LIMIT 10
  ) t;

  -- Card 5 c2: top 5 movers por conta
  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
  INTO movers_conta
  FROM (
    SELECT jsonb_build_object(
      'conta',    conta,
      'ref',      ref_norm,
      'u_ult7',   u_ult7,
      'u_ant7',   u_ant7,
      'delta',    delta,
      'var_pct',  var_pct
    ) AS item,
    ROW_NUMBER() OVER (PARTITION BY conta ORDER BY ABS(delta) DESC) AS rk
    FROM vw_top_movers_por_conta
  ) t
  WHERE rk <= 5;

  -- Card 5 c3: cruzamento (so os mais divergentes)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ref',             ref_norm,
    'var_exitus',      var_exitus,
    'var_lumia',       var_lumia,
    'var_muniam',      var_muniam,
    'u7_exitus',       u7_exitus,
    'u7_lumia',        u7_lumia,
    'u7_muniam',       u7_muniam,
    'n_contas',        n_contas,
    'spread_var_pct',  spread_var_pct
  )), '[]'::jsonb)
  INTO movers_cruz
  FROM (
    SELECT * FROM vw_top_movers_cruzamento LIMIT 10
  ) t;

  -- Card 6 faixa urgencia+critico
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ref',            ref_norm,
    'descricao',      descricao,
    'canal',          canal_norm,
    'preco_venda',    preco_venda,
    'custo_producao', custo_producao,
    'lucro_peca',     lucro_peca,
    'faixa',          faixa
  )), '[]'::jsonb)
  INTO margens_urg
  FROM (
    SELECT *
    FROM vw_margem_por_produto_canal
    WHERE faixa IN ('urgencia_maxima', 'critico')
    ORDER BY lucro_peca ASC
    LIMIT 30
  ) t;

  -- Card 6 faixa atencao (separado pra Claude priorizar urgencia antes)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ref',            ref_norm,
    'descricao',      descricao,
    'canal',          canal_norm,
    'preco_venda',    preco_venda,
    'custo_producao', custo_producao,
    'lucro_peca',     lucro_peca
  )), '[]'::jsonb)
  INTO margens_at
  FROM (
    SELECT *
    FROM vw_margem_por_produto_canal
    WHERE faixa = 'atencao'
    ORDER BY lucro_peca ASC
    LIMIT 20
  ) t;

  -- Card 6 plano de ajuste (so itens em faixa critica, com sugestao de preco)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ref',                     ref_norm,
    'descricao',               descricao,
    'canal',                   canal_norm,
    'preco_venda',             preco_venda,
    'lucro_peca',              lucro_peca,
    'preco_sugerido_lucro_10', preco_sugerido_lucro_10,
    'preco_sugerido_lucro_14', preco_sugerido_lucro_14,
    'ajuste_para_lucro_10',    ajuste_para_lucro_10,
    'ajuste_para_lucro_14',    ajuste_para_lucro_14
  )), '[]'::jsonb)
  INTO plano_ajuste
  FROM (
    SELECT * FROM vw_plano_ajuste_gradual
    WHERE lucro_peca < 10
    ORDER BY lucro_peca ASC
    LIMIT 15
  ) t;

  -- Card 7 oportunidades: margem boa + venda baixa
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ref',                  ref_norm,
    'descricao',            descricao,
    'canal',                canal_norm,
    'preco_venda',          preco_venda,
    'lucro_peca',           lucro_peca,
    'faixa',                faixa,
    'unidades_30d',         unidades_30d,
    'lucro_acumulado_30d',  lucro_acumulado_30d
  )), '[]'::jsonb)
  INTO oportunidades
  FROM (
    SELECT * FROM vw_oportunidades_margem
    ORDER BY lucro_peca DESC
    LIMIT 15
  ) t;

  -- Monta payload final
  resultado := jsonb_build_object(
    'gerado_em',             to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'versao',                '1.0',
    'canais_comparativo',    canais_comp,
    'contas_bling_7v7',      contas_7v7,
    'concentracao_quedas',   concentracao,
    'top_movers_unificado',  movers_unif,
    'top_movers_conta',      movers_conta,
    'top_movers_cruzamento', movers_cruz,
    'margens_urgencia',      margens_urg,
    'margens_atencao',       margens_at,
    'plano_ajuste',          plano_ajuste,
    'oportunidades',         oportunidades
  );

  RETURN resultado;
END;
$$;

COMMENT ON FUNCTION fn_ia_marketplaces_insights() IS
  'Orquestra views Card 3-7 do Sprint 4 em JSONB unico pro Claude. NAO inclui Card 1 (admin-only) nem Card 2 (grafico).';

-- Permissoes
REVOKE ALL ON FUNCTION fn_ia_marketplaces_insights() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_ia_marketplaces_insights() FROM anon;
GRANT  EXECUTE ON FUNCTION fn_ia_marketplaces_insights() TO service_role;
GRANT  EXECUTE ON FUNCTION fn_ia_marketplaces_insights() TO authenticated;

-- SMOKE TEST (rodar manualmente):
--
-- 1) SELECT fn_ia_marketplaces_insights();
-- 2) SELECT jsonb_pretty(fn_ia_marketplaces_insights());
-- 3) SELECT jsonb_array_length((fn_ia_marketplaces_insights())->'canais_comparativo');
-- 4) SELECT (fn_ia_marketplaces_insights())->'margens_urgencia';
