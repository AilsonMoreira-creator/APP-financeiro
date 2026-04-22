-- =====================================================================
-- OS Amicia - Sprint 6.1 Fase 6 - Pecas em corte na cobertura (matriz)
-- Versao: 2.0 - Data: 21/04/2026 (v2: preserva ordem de colunas)
-- Grupo Amicia - App Financeiro v6.8
-- =====================================================================
--
-- COMO RODAR:
--   1. Supabase -> SQL Editor -> New query
--   2. Colar este arquivo INTEIRO
--   3. Run
--
-- IDEMPOTENTE: INSERT usa ON CONFLICT; CREATE OR REPLACE na view.
-- ASCII PURO.
--
-- v2 (21/04 tarde): corrigido erro "cannot change name of view column".
-- PostgreSQL exige que CREATE OR REPLACE VIEW mantenha ORDEM e tipo das
-- colunas existentes. Colunas novas (pecas_em_corte, cobertura_projetada_dias)
-- agora sao adicionadas no FINAL do SELECT.
--
-- REGRA IMPLEMENTADA (Fase 6):
--   cobertura_projetada_dias = (estoque_ml + pecas_em_corte) / velocidade
--   cobertura_status usa cobertura_projetada em vez de cobertura_dias.
--
-- A Fase 7 (threshold de excesso >= 15 pecas) esta no arquivo 13_fase7_*.
--
-- Granularidade: sempre ref+cor+tam (pecas_em_corte aberta via matriz
-- detalhes.cores x detalhes.tamanhos em amicia_data/salas-corte).
-- =====================================================================


-- ---------------------------------------------------------------------
-- Recriar a view incluindo pecas em corte
-- ---------------------------------------------------------------------
-- Ordem Sprint 2 (imutavel por limitacao do PG):
--   ref, cor, cor_key, tam, descricao, estoque_atual,
--   vendas_15d, vendas_30d, vendas_mes_ant, vendas_90d,
--   ultima_venda, estoque_updated_at, alerta_duplicata,
--   velocidade_dia, cobertura_dias,
--   demanda_status, cobertura_status, confianca
-- Colunas NOVAS (Fase 6/7) adicionadas no FINAL:
--   pecas_em_corte, cobertura_projetada_dias

CREATE OR REPLACE VIEW vw_variacoes_classificadas AS
WITH cfg AS (
  SELECT
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'gatekeeper_vendas_ativa_15d')       AS gate_ativa,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'gatekeeper_vendas_fraca_min_15d')   AS gate_fraca_min,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'gatekeeper_vendas_fraca_max_15d')   AS gate_fraca_max,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'ruptura_disfarcada_min_mes_ant')    AS gate_ruptura_min,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'cobertura_critica_dias')            AS cob_critica,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'cobertura_saudavel_min_dias')       AS cob_saudavel_min,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'cobertura_saudavel_max_dias')       AS cob_saudavel_max,
    (SELECT (valor #>> '{}' )::numeric FROM ia_config WHERE chave = 'devolucao_global_pct')          AS devol_pct
),
vendas_expandidas AS (
  SELECT
    LTRIM(COALESCE(item->>'ref',''), '0')           AS ref,
    LOWER(TRIM(COALESCE(item->>'cor','')))          AS cor_key,
    COALESCE(item->>'cor','')                       AS cor_display,
    UPPER(TRIM(COALESCE(item->>'tamanho','')))      AS tam,
    COALESCE((item->>'quantidade')::int, 0)         AS qtd,
    v.data_pedido
  FROM bling_vendas_detalhe v,
       jsonb_array_elements(v.itens) AS item
  WHERE item->>'ref' IS NOT NULL
    AND item->>'ref' <> ''
),
vendas_agregadas AS (
  SELECT
    ref, cor_key, MAX(cor_display) AS cor_display, tam,
    SUM(qtd) FILTER (WHERE data_pedido >= CURRENT_DATE - INTERVAL '15 days')                                              AS vendas_15d,
    SUM(qtd) FILTER (WHERE data_pedido >= CURRENT_DATE - INTERVAL '30 days')                                              AS vendas_30d,
    SUM(qtd) FILTER (WHERE data_pedido >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
                       AND data_pedido <  DATE_TRUNC('month', CURRENT_DATE))                                              AS vendas_mes_ant,
    SUM(qtd) FILTER (WHERE data_pedido >= CURRENT_DATE - INTERVAL '90 days')                                              AS vendas_90d,
    MAX(data_pedido) AS ultima_venda
  FROM vendas_expandidas
  GROUP BY ref, cor_key, tam
),
estoque_expandido AS (
  SELECT
    LTRIM(COALESCE(e.ref,''), '0')                     AS ref,
    LOWER(TRIM(COALESCE(v->>'cor','')))                AS cor_key,
    COALESCE(v->>'cor','')                             AS cor_display,
    UPPER(TRIM(COALESCE(v->>'tam','')))                AS tam,
    COALESCE((v->>'qtd')::int, 0)                      AS estoque_atual,
    e.descricao                                        AS descricao,
    e.sem_dados,
    e.alerta_duplicata,
    e.updated_at                                       AS estoque_updated_at
  FROM ml_estoque_ref_atual e,
       jsonb_array_elements(e.variations) AS v
  WHERE e.sem_dados = false
),
cortes_pendentes_matriz AS (
  SELECT
    LTRIM(COALESCE(c->>'ref',''), '0')                  AS ref,
    LOWER(TRIM(COALESCE(cor->>'nome','')))              AS cor_key,
    COALESCE(cor->>'nome','')                           AS cor_display,
    UPPER(TRIM(COALESCE(tam->>'tam','')))               AS tam,
    COALESCE((tam->>'grade')::int, 0)
      * COALESCE((cor->>'folhas')::int, 0)              AS pecas_em_corte
  FROM amicia_data,
       jsonb_array_elements(payload->'cortes') AS c,
       jsonb_array_elements(c->'detalhes'->'tamanhos') AS tam,
       jsonb_array_elements(c->'detalhes'->'cores')    AS cor
  WHERE user_id = 'salas-corte'
    AND (c->>'status') = 'pendente'
    AND c->'detalhes' IS NOT NULL
    AND jsonb_typeof(c->'detalhes'->'tamanhos') = 'array'
    AND jsonb_typeof(c->'detalhes'->'cores')    = 'array'
),
cortes_pendentes_agg AS (
  SELECT
    ref, cor_key, MAX(cor_display) AS cor_display, tam,
    SUM(pecas_em_corte) AS pecas_em_corte
  FROM cortes_pendentes_matriz
  WHERE pecas_em_corte > 0
    AND ref <> ''
    AND tam <> ''
    AND cor_key <> ''
  GROUP BY ref, cor_key, tam
)
SELECT
  -- ORDEM SPRINT 2 (preservada):
  COALESCE(v.ref, e.ref, c.ref)                                   AS ref,
  COALESCE(v.cor_display, e.cor_display, c.cor_display,
           v.cor_key, e.cor_key, c.cor_key)                       AS cor,
  COALESCE(v.cor_key, e.cor_key, c.cor_key)                       AS cor_key,
  COALESCE(v.tam, e.tam, c.tam)                                   AS tam,
  COALESCE(e.descricao, '')                                       AS descricao,
  COALESCE(e.estoque_atual, 0)                                    AS estoque_atual,
  COALESCE(v.vendas_15d, 0)                                       AS vendas_15d,
  COALESCE(v.vendas_30d, 0)                                       AS vendas_30d,
  COALESCE(v.vendas_mes_ant, 0)                                   AS vendas_mes_ant,
  COALESCE(v.vendas_90d, 0)                                       AS vendas_90d,
  v.ultima_venda,
  e.estoque_updated_at,
  e.alerta_duplicata,

  ROUND(
    (COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)),
    3
  )::numeric AS velocidade_dia,

  CASE
    WHEN COALESCE(v.vendas_30d, 0) = 0 THEN NULL
    ELSE ROUND(
      COALESCE(e.estoque_atual, 0)::numeric
      / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0),
      1
    )
  END AS cobertura_dias,

  CASE
    WHEN COALESCE(v.vendas_15d, 0) >= cfg.gate_ativa                                           THEN 'ativa'
    WHEN COALESCE(v.vendas_15d, 0) BETWEEN cfg.gate_fraca_min AND cfg.gate_fraca_max           THEN 'fraca'
    WHEN COALESCE(v.vendas_15d, 0) = 0 AND COALESCE(v.vendas_mes_ant, 0) >= cfg.gate_ruptura_min THEN 'ruptura_disfarcada'
    ELSE 'inativa'
  END AS demanda_status,

  -- cobertura_status: Fase 6 (estoque+corte)
  CASE
    WHEN COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0) = 0                                                     THEN 'zerada'
    WHEN COALESCE(v.vendas_30d, 0) = 0                                                                                        THEN 'sem_demanda'
    WHEN (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0)) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) < cfg.cob_critica       THEN 'critica'
    WHEN (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0)) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) < cfg.cob_saudavel_min  THEN 'atencao'
    WHEN (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0)) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) <= cfg.cob_saudavel_max THEN 'saudavel'
    ELSE 'excesso'
  END AS cobertura_status,

  CASE
    WHEN e.alerta_duplicata = true THEN 'media'
    ELSE 'alta'
  END AS confianca,

  -- COLUNAS NOVAS (Fase 6/7) no FINAL:
  COALESCE(c.pecas_em_corte, 0)                                   AS pecas_em_corte,

  CASE
    WHEN COALESCE(v.vendas_30d, 0) = 0 THEN NULL
    ELSE ROUND(
      (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0))::numeric
      / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0),
      1
    )
  END AS cobertura_projetada_dias

FROM vendas_agregadas v
FULL OUTER JOIN estoque_expandido e
  ON v.ref = e.ref AND v.cor_key = e.cor_key AND v.tam = e.tam
FULL OUTER JOIN cortes_pendentes_agg c
  ON COALESCE(v.ref, e.ref) = c.ref
  AND COALESCE(v.cor_key, e.cor_key) = c.cor_key
  AND COALESCE(v.tam, e.tam) = c.tam
CROSS JOIN cfg
WHERE COALESCE(v.ref, e.ref, c.ref) <> ''
  AND COALESCE(v.tam, e.tam, c.tam) NOT IN ('UNICO','U');

COMMENT ON VIEW vw_variacoes_classificadas IS
  'Base ref+cor+tam com classificacoes. '
  'Fase 6: cobertura considera pecas em corte (matriz detalhes). '
  ''
  'Ordem de colunas preservada vs Sprint 2.';

-- =====================================================================
-- SMOKE TESTS apos rodar
--
-- 1) Contagens (comparar com 148 criticas antes):
--    SELECT variacoes_ruptura_critica, pct_ruptura_critica,
--           variacoes_saudaveis, pct_saudaveis
--    FROM vw_estoque_saude_geral;
--
-- 2) Ver ref 2601 com corte pendente:
--    SELECT cor, tam, estoque_atual, pecas_em_corte,
--           cobertura_projetada_dias, cobertura_status
--    FROM vw_variacoes_classificadas
--    WHERE ref = '2601' AND pecas_em_corte > 0
--    ORDER BY cor, tam;
-- =====================================================================
