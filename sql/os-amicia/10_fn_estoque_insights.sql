-- =====================================================================
-- OS Amicia - Sprint 6.1 - Funcao orquestradora do Tab Estoque
-- Versao: 1.0 - Data: 21/04/2026
-- Grupo Amicia - App Financeiro v6.8
-- =====================================================================
--
-- COMO RODAR:
--   1. DEPOIS de 09_views_estoque.sql (dependencias)
--   2. Supabase -> SQL Editor -> New query
--   3. Colar este arquivo INTEIRO
--   4. Run
--   5. Conferir mensagem "CREATE FUNCTION" 1 vez, sem erros
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION.
-- ASCII PURO: nenhum acento, sem setas, sem bullets.
--
-- DEPENDENCIAS (todas criadas em 09_views_estoque.sql):
--   - vw_estoque_saude_geral
--   - vw_estoque_tendencia_12m
--   - vw_estoque_ruptura_critica
--   - vw_estoque_ruptura_disfarcada
--
-- Formato de saida (JSONB unico, mesmo contrato da fn_ia_marketplaces_insights):
--   {
--     "gerado_em": "<ISO BRT>",
--     "versao": "1.0",
--     "saude_geral":        {...},   -- Card 1 (objeto unico, nao array)
--     "tendencia_12m":      [...],   -- Card 2 (serie mensal)
--     "ruptura_critica":    [...],   -- Card 3 (top N variacoes)
--     "ruptura_disfarcada": [...]    -- Card 4 (top N variacoes)
--   }
--
-- Limites aplicados (defensivos, pra Claude nao receber payload gigante):
--   - ruptura_critica: top 30 (ordenadas por cobertura_dias ASC)
--   - ruptura_disfarcada: top 20 (ordenadas por vendas_mes_ant DESC)
--   - tendencia_12m: ate 12 meses (view ja limita)
--
-- SECURITY DEFINER: roda com privilegios do owner pra ler views que
-- dependem de bling_vendas_detalhe, amicia_data, ml_estoque_*
-- (RLS-protected). Caller esperado: /api/ia-cron via service role.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_ia_estoque_insights()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  resultado         jsonb;
  saude             jsonb;
  tendencia         jsonb;
  ruptura_crit      jsonb;
  ruptura_disf      jsonb;
BEGIN
  -- Card 1: saude geral (linha unica da view vira objeto JSON)
  SELECT COALESCE(
    jsonb_build_object(
      'variacoes_total',              variacoes_total,
      'variacoes_ativas',             variacoes_ativas,
      'variacoes_saudaveis',          variacoes_saudaveis,
      'variacoes_atencao',            variacoes_atencao,
      'variacoes_ruptura_critica',    variacoes_ruptura_critica,
      'variacoes_excesso',            variacoes_excesso,
      'variacoes_ruptura_disfarcada', variacoes_ruptura_disfarcada,
      'refs_com_atividade',           refs_com_atividade,
      'pct_saudaveis',                pct_saudaveis,
      'pct_atencao',                  pct_atencao,
      'pct_ruptura_critica',          pct_ruptura_critica,
      'pct_excesso',                  pct_excesso,
      'unidades_total',               unidades_total
    ),
    '{}'::jsonb
  )
  INTO saude
  FROM vw_estoque_saude_geral;

  -- Card 2: serie mensal (ja limitada a 12 meses na view)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ano_mes',              ano_mes,
    'qtd_total',            qtd_total,
    'qtd_refs',             qtd_refs,
    'snapshot_date',        snapshot_date,
    'delta_vs_mes_ant',     delta_vs_mes_ant,
    'var_pct_vs_mes_ant',   var_pct_vs_mes_ant
  ) ORDER BY ano_mes), '[]'::jsonb)
  INTO tendencia
  FROM vw_estoque_tendencia_12m;

  -- Card 3: ruptura critica (top 30 mais apertadas)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ref',              ref,
    'descricao',        descricao,
    'cor',              cor,
    'tam',              tam,
    'estoque_atual',    estoque_atual,
    'vendas_15d',       vendas_15d,
    'vendas_30d',       vendas_30d,
    'velocidade_dia',   velocidade_dia,
    'cobertura_dias',   cobertura_dias,
    'cobertura_status', cobertura_status,
    'confianca',        confianca
  )), '[]'::jsonb)
  INTO ruptura_crit
  FROM (
    SELECT *
    FROM vw_estoque_ruptura_critica
    ORDER BY cobertura_dias ASC NULLS FIRST, vendas_15d DESC
    LIMIT 30
  ) t;

  -- Card 4: ruptura disfarcada (top 20 com maior perda potencial)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'ref',              ref,
    'descricao',        descricao,
    'cor',              cor,
    'tam',              tam,
    'estoque_atual',    estoque_atual,
    'vendas_15d',       vendas_15d,
    'vendas_30d',       vendas_30d,
    'vendas_mes_ant',   vendas_mes_ant,
    'vendas_90d',       vendas_90d,
    'ultima_venda',     ultima_venda,
    'cobertura_status', cobertura_status,
    'confianca',        confianca
  )), '[]'::jsonb)
  INTO ruptura_disf
  FROM (
    SELECT *
    FROM vw_estoque_ruptura_disfarcada
    ORDER BY vendas_mes_ant DESC, vendas_90d DESC
    LIMIT 20
  ) t;

  -- Monta payload final com timezone BRT (mesmo padrao da Sprint 4)
  resultado := jsonb_build_object(
    'gerado_em',          to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'versao',             '1.0',
    'saude_geral',        saude,
    'tendencia_12m',      tendencia,
    'ruptura_critica',    ruptura_crit,
    'ruptura_disfarcada', ruptura_disf
  );

  RETURN resultado;
END;
$$;

COMMENT ON FUNCTION fn_ia_estoque_insights() IS
  'Orquestra as 4 views do Tab Estoque (Sprint 6.1) em JSONB unico pro Claude. Consumido por /api/ia-cron?escopo=estoque quando a flag estoque_enabled=true em ia_config.';

-- Permissoes (mesmo padrao da fn_ia_marketplaces_insights)
REVOKE ALL ON FUNCTION fn_ia_estoque_insights() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_ia_estoque_insights() FROM anon;
GRANT  EXECUTE ON FUNCTION fn_ia_estoque_insights() TO service_role;
GRANT  EXECUTE ON FUNCTION fn_ia_estoque_insights() TO authenticated;

-- =====================================================================
-- SMOKE TESTS (rodar depois)
--
-- 1) Executar e ver se retorna JSON sem erro:
--    SELECT fn_ia_estoque_insights();
--
-- 2) Ver formatado (util pra conferir):
--    SELECT jsonb_pretty(fn_ia_estoque_insights());
--
-- 3) Validar estrutura por chave:
--    SELECT
--      jsonb_typeof((fn_ia_estoque_insights())->'saude_geral')        AS tipo_saude,
--      jsonb_array_length((fn_ia_estoque_insights())->'tendencia_12m')      AS qtd_meses,
--      jsonb_array_length((fn_ia_estoque_insights())->'ruptura_critica')    AS qtd_criticas,
--      jsonb_array_length((fn_ia_estoque_insights())->'ruptura_disfarcada') AS qtd_disfarcadas;
--    -- Esperado: tipo_saude='object', qtd_meses=1 (por enquanto), criticas<=30, disfarcadas<=20
--
-- 4) Inspecao de um campo especifico:
--    SELECT (fn_ia_estoque_insights())->'saude_geral'->>'pct_ruptura_critica';
-- =====================================================================
