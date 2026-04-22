-- =====================================================================
-- OS Amicia - Sprint 6.1 Fase 6 - Regra da janela de producao na cobertura
-- Versao: 1.0 - Data: 21/04/2026
-- Grupo Amicia - App Financeiro v6.8
-- =====================================================================
--
-- COMO RODAR:
--   1. Supabase -> SQL Editor -> New query
--   2. Colar este arquivo INTEIRO
--   3. Run
--
-- IDEMPOTENTE: CREATE OR REPLACE VIEW. Reroda sem risco.
-- ASCII PURO.
--
-- PROPOSITO:
-- Corrige uma distorcao semantica na vw_variacoes_classificadas original
-- (Sprint 2) que estava inflando a contagem de "ruptura critica" no Card
-- 1 do Tab Estoque.
--
-- PROBLEMA ORIGINAL:
-- A view calculava cobertura_dias = estoque_atual / velocidade_dia, sem
-- considerar pecas que ja foram cortadas e estao em producao nas oficinas.
-- Resultado: variacoes zeradas no ML mas com corte em andamento apareciam
-- como "ruptura critica" quando na realidade o corte chega em 22 dias.
--
-- SOLUCAO (opcao A2 - aberta por ref+cor+tam):
-- Abre a matriz detalhes.cores x detalhes.tamanhos de cada corte pendente
-- em amicia_data (user_id='salas-corte'). Calcula pecas de cada variacao:
--   pecas_variacao = grade_do_tam x folhas_da_cor
-- Soma por ref+cor+tam e adiciona em "cobertura_projetada_dias" que
-- substitui cobertura_dias na classificacao de status.
--
-- REGRA DE NEGOCIO (Ailson 21/04):
-- "Se o corte ja foi pra oficina, conta. Lead time 22 dias e' suficiente
--  pra cobrir. Atraso/erro de oficina sao excecao, nao a regra."
--
-- COMPATIBILIDADE COM SPRINT 2:
-- - cobertura_dias (coluna original) CONTINUA existindo, com a mesma
--   formula antiga (estoque_atual / velocidade_dia). Se algum consumidor
--   usa ela, nao quebra.
-- - cobertura_projetada_dias e' uma coluna NOVA.
-- - cobertura_status agora usa cobertura_projetada_dias (a versao com
--   oficinas). Esse e o unico comportamento que muda pro Sprint 2.
--
-- VALIDACAO:
-- Apos rodar, a contagem de variacoes_ruptura_critica em vw_estoque_saude_geral
-- deve cair significativamente. Estimativa: 148 -> algo entre 30 e 80.
-- =====================================================================

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
-- Desagrega JSONB de vendas (igual Sprint 2)
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
-- Agrega vendas por janelas (igual Sprint 2)
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
-- Desagrega JSONB de estoque ML (igual Sprint 2)
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
-- ====================================================================
-- NOVO (Fase 6): abre matriz dos cortes pendentes em ref+cor+tam.
-- Cada corte tem detalhes.tamanhos[{tam,grade}] e detalhes.cores[{nome,folhas}].
-- Pecas de uma variacao = grade_do_tam x folhas_da_cor.
-- Fallback: se corte NAO tem detalhes completos (apenas qtdPecas no total),
-- ignora nesse calculo granular. Admin deve manter a matriz preenchida
-- ao lancar cortes, como combinado (decisao Ailson 21/04).
-- ====================================================================
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
  COALESCE(v.ref, e.ref, c.ref)                                   AS ref,
  COALESCE(v.cor_display, e.cor_display, c.cor_display,
           v.cor_key, e.cor_key, c.cor_key)                       AS cor,
  COALESCE(v.cor_key, e.cor_key, c.cor_key)                       AS cor_key,
  COALESCE(v.tam, e.tam, c.tam)                                   AS tam,
  COALESCE(e.descricao, '')                                       AS descricao,
  COALESCE(e.estoque_atual, 0)                                    AS estoque_atual,
  -- NOVO: pecas em corte pendentes (oficinas) pra essa variacao
  COALESCE(c.pecas_em_corte, 0)                                   AS pecas_em_corte,
  COALESCE(v.vendas_15d, 0)                                       AS vendas_15d,
  COALESCE(v.vendas_30d, 0)                                       AS vendas_30d,
  COALESCE(v.vendas_mes_ant, 0)                                   AS vendas_mes_ant,
  COALESCE(v.vendas_90d, 0)                                       AS vendas_90d,
  v.ultima_venda,
  e.estoque_updated_at,
  e.alerta_duplicata,

  -- Velocidade de venda (ajustada por devolucao)
  ROUND(
    (COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)),
    3
  )::numeric AS velocidade_dia,

  -- cobertura_dias: formula ORIGINAL do Sprint 2 (so estoque, sem oficina).
  -- Mantida pra compatibilidade caso algum consumidor especifico precise.
  CASE
    WHEN COALESCE(v.vendas_30d, 0) = 0 THEN NULL
    ELSE ROUND(
      COALESCE(e.estoque_atual, 0)::numeric
      / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0),
      1
    )
  END AS cobertura_dias,

  -- NOVO: cobertura_projetada_dias considera estoque + pecas em corte.
  -- Essa e' a coluna usada pra classificar cobertura_status agora.
  CASE
    WHEN COALESCE(v.vendas_30d, 0) = 0 THEN NULL
    ELSE ROUND(
      (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0))::numeric
      / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0),
      1
    )
  END AS cobertura_projetada_dias,

  -- Classificacao de demanda (igual Sprint 2)
  CASE
    WHEN COALESCE(v.vendas_15d, 0) >= cfg.gate_ativa                                           THEN 'ativa'
    WHEN COALESCE(v.vendas_15d, 0) BETWEEN cfg.gate_fraca_min AND cfg.gate_fraca_max           THEN 'fraca'
    WHEN COALESCE(v.vendas_15d, 0) = 0 AND COALESCE(v.vendas_mes_ant, 0) >= cfg.gate_ruptura_min THEN 'ruptura_disfarcada'
    ELSE 'inativa'
  END AS demanda_status,

  -- MUDANCA CHAVE: cobertura_status usa cobertura_projetada_dias (com oficinas)
  -- em vez de cobertura_dias (so ML). Resolve as 148 inflacionadas.
  CASE
    WHEN COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0) = 0                                                     THEN 'zerada'
    WHEN COALESCE(v.vendas_30d, 0) = 0                                                                                        THEN 'sem_demanda'
    WHEN (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0)) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) < cfg.cob_critica       THEN 'critica'
    WHEN (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0)) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) < cfg.cob_saudavel_min  THEN 'atencao'
    WHEN (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0)) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) <= cfg.cob_saudavel_max THEN 'saudavel'
    ELSE 'excesso'
  END AS cobertura_status,

  -- Confianca (igual Sprint 2)
  CASE
    WHEN e.alerta_duplicata = true THEN 'media'
    ELSE 'alta'
  END AS confianca

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
  'Base ref+cor+tam com classificacoes demanda/cobertura. '
  'Fase 6 do Sprint 6.1: cobertura_status agora considera pecas em corte pendentes '
  '(matriz detalhes.cores x detalhes.tamanhos em amicia_data/salas-corte). '
  'cobertura_dias mantida pra compatibilidade; cobertura_projetada_dias e nova.';

-- =====================================================================
-- SMOKE TESTS apos rodar:
--
-- 1) Validar que a contagem de ruptura caiu:
--    SELECT variacoes_ruptura_critica, pct_ruptura_critica,
--           variacoes_saudaveis, pct_saudaveis
--    FROM vw_estoque_saude_geral;
--    -- Esperado: ruptura caiu de 148 pra algo entre 30-80.
--
-- 2) Inspeccionar casos especificos:
--    SELECT ref, cor, tam, estoque_atual, pecas_em_corte,
--           cobertura_dias, cobertura_projetada_dias, cobertura_status
--    FROM vw_variacoes_classificadas
--    WHERE ref = '2601' AND pecas_em_corte > 0
--    ORDER BY cor, tam;
--    -- Esperado: variacoes que antes estavam zeradas mas tem
--    -- pecas_em_corte > 0 agora aparecem como 'atencao' ou 'saudavel'.
--
-- 3) Confirmar que tabela de cortes esta sendo lida:
--    SELECT ref, SUM(pecas_em_corte) AS total_em_corte
--    FROM vw_variacoes_classificadas
--    WHERE pecas_em_corte > 0
--    GROUP BY ref
--    ORDER BY total_em_corte DESC;
--    -- Deve mostrar as refs que tem corte ativo.
-- =====================================================================
