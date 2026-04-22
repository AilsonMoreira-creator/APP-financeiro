-- =====================================================================
-- OS Amicia - Sprint 6.1 Fase 8 - Trocar fonte de cortes pra ailson_cortes
-- Versao: 1.0 - Data: 22/04/2026
-- Grupo Amicia - App Financeiro v6.8
-- =====================================================================
--
-- COMO RODAR:
--   1. DEPOIS de 13_fase7_excesso_por_volume.sql
--   2. Supabase -> SQL Editor -> New query
--   3. Colar este arquivo INTEIRO e Run
--
-- IDEMPOTENTE: CREATE OR REPLACE VIEW. Reroda sem risco.
-- ASCII PURO.
--
-- PROPOSITO:
-- A Fase 6 lia cortes de amicia_data/salas-corte (estimativa rolo x
-- rendimento). Mas a realidade operacional e que salas-corte e apenas
-- estimativa pre-corte; o corte real, com quantidade final, vive em
-- amicia_data/ailson_cortes (modulo Oficinas Cortes). E e la que as
-- pecas ficam durante as semanas de producao.
--
-- MUDANCA (regra Ailson 22/04):
-- "Sempre usar do modulo oficina cortes (com ou sem granularidade).
--  Pode ser que algum corte ainda nao tenha preenchido (no futuro isso
--  nao vai acontecer)."
--
-- ESTRUTURA DO AILSON_CORTES (pelo App.tsx):
--   { id, nCorte, ref, descricao, marca, qtd, valorUnit, valorTotal,
--     oficina, data, qtdEntregue, entregue, dataEntrega, pago,
--     dataPagamento, obs, _mod,
--     detalhes?: { cores:[{nome,folhas}], tamanhos:[{tam,grade}] } }
--
-- ESTRATEGIA DE DISTRIBUICAO:
-- Para cada corte de ailson_cortes com entregue=false:
--   (a) Se tem detalhes.cores e detalhes.tamanhos -> usa matriz exata
--       (grade x folhas por celula). Futuro ideal.
--   (b) Se NAO tem matriz -> distribui qtd proporcionalmente pelas
--       variacoes com vendas nos ultimos 30d daquela ref. Producao
--       tende a seguir o giro, essa heuristica e razoavel.
--   (c) Se ref nao tem nenhuma variacao com vendas 30d (ref nova) ->
--       distribui uniformemente pelas variacoes em estoque ML atual.
--   (d) Se nem (b) nem (c) -> pecas nao entram em granularidade
--       (ficam somadas no nivel da ref sem abertura).
--
-- ORDEM DE COLUNAS: preservada identica a Fase 7 (Postgres exige pra
-- CREATE OR REPLACE VIEW).
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
    (SELECT (valor #>> '{}' )::numeric FROM ia_config WHERE chave = 'devolucao_global_pct')          AS devol_pct,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'excesso_min_pecas')                 AS exc_min_pecas
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

-- ============================================================
-- BRANCH A: cortes em oficina COM matriz detalhada (futuro ideal)
-- ============================================================
cortes_oficina_com_matriz AS (
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
  WHERE user_id = 'ailson_cortes'
    AND COALESCE((c->>'entregue')::boolean, false) = false
    AND c->'detalhes' IS NOT NULL
    AND jsonb_typeof(c->'detalhes'->'tamanhos') = 'array'
    AND jsonb_typeof(c->'detalhes'->'cores')    = 'array'
),

-- ============================================================
-- BRANCH B: cortes em oficina SEM matriz (realidade atual)
-- So os cortes SEM detalhes entram aqui, pra nao contar duas vezes.
-- ============================================================
cortes_oficina_sem_matriz AS (
  SELECT
    LTRIM(COALESCE(c->>'ref',''), '0')  AS ref,
    COALESCE((c->>'qtd')::int, 0)       AS qtd_total
  FROM amicia_data,
       jsonb_array_elements(payload->'cortes') AS c
  WHERE user_id = 'ailson_cortes'
    AND COALESCE((c->>'entregue')::boolean, false) = false
    AND (c->'detalhes' IS NULL
         OR jsonb_typeof(c->'detalhes'->'tamanhos') <> 'array'
         OR jsonb_typeof(c->'detalhes'->'cores')    <> 'array')
    AND COALESCE((c->>'qtd')::int, 0) > 0
),
cortes_sem_matriz_por_ref AS (
  -- Agrupa por ref: pode ter varios cortes sem matriz da mesma ref
  SELECT ref, SUM(qtd_total) AS qtd_total_ref
  FROM cortes_oficina_sem_matriz
  GROUP BY ref
),

-- Pesos pra distribuicao proporcional: prioridade 1 = vendas_30d
pesos_por_vendas AS (
  SELECT
    ref,
    cor_key,
    MAX(cor_display) AS cor_display,
    tam,
    COALESCE(SUM(vendas_30d), 0) AS peso
  FROM vendas_agregadas
  GROUP BY ref, cor_key, tam
  HAVING COALESCE(SUM(vendas_30d), 0) > 0
),
-- Pesos pra distribuicao uniforme (fallback): prioridade 2 = estoque atual
-- So e consultado se a ref nao tem nenhuma variacao com vendas_30d > 0
pesos_por_estoque AS (
  SELECT
    ref,
    cor_key,
    MAX(cor_display) AS cor_display,
    tam,
    1 AS peso  -- uniforme: cada variacao ativa no ML pesa igual
  FROM estoque_expandido
  WHERE estoque_atual > 0  -- nao considera variacoes zeradas de estoque
  GROUP BY ref, cor_key, tam
),
-- Refs que tem vendas: usam peso_por_vendas; ref sem venda usa peso_por_estoque
-- Evita misturar origens dentro da mesma ref (baguncaria a proporcao).
refs_com_venda AS (
  SELECT DISTINCT ref FROM pesos_por_vendas
),
pesos_finais AS (
  SELECT ref, cor_key, cor_display, tam, peso::numeric AS peso
  FROM pesos_por_vendas

  UNION ALL

  SELECT ref, cor_key, cor_display, tam, peso::numeric AS peso
  FROM pesos_por_estoque
  WHERE ref NOT IN (SELECT ref FROM refs_com_venda)
),
-- Soma dos pesos por ref (denominador da distribuicao)
pesos_totais_por_ref AS (
  SELECT ref, SUM(peso) AS peso_total
  FROM pesos_finais
  GROUP BY ref
),

-- Distribui qtd_total_ref proporcionalmente
cortes_sem_matriz_distribuidos AS (
  SELECT
    pf.ref,
    pf.cor_key,
    pf.cor_display,
    pf.tam,
    ROUND(
      (cs.qtd_total_ref::numeric * pf.peso) / NULLIF(pt.peso_total, 0)
    )::int AS pecas_em_corte
  FROM cortes_sem_matriz_por_ref cs
  JOIN pesos_finais pf          ON pf.ref = cs.ref
  JOIN pesos_totais_por_ref pt  ON pt.ref = cs.ref
  WHERE pt.peso_total > 0
),

-- UNIAO: matriz + distribuicao
cortes_pendentes_agg AS (
  SELECT ref, cor_key, MAX(cor_display) AS cor_display, tam,
         SUM(pecas_em_corte) AS pecas_em_corte
  FROM (
    SELECT ref, cor_key, cor_display, tam, pecas_em_corte FROM cortes_oficina_com_matriz
    UNION ALL
    SELECT ref, cor_key, cor_display, tam, pecas_em_corte FROM cortes_sem_matriz_distribuidos
  ) AS uni
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

  -- cobertura_dias original (estoque puro) mantida pra compat
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

  -- cobertura_status: considera estoque + pecas_em_corte + regra excesso
  CASE
    WHEN COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0) = 0                                                     THEN 'zerada'
    WHEN COALESCE(v.vendas_30d, 0) = 0                                                                                        THEN 'sem_demanda'
    WHEN (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0)) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) < cfg.cob_critica       THEN 'critica'
    WHEN (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0)) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) < cfg.cob_saudavel_min  THEN 'atencao'
    WHEN (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0)) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) <= cfg.cob_saudavel_max THEN 'saudavel'
    WHEN (COALESCE(e.estoque_atual, 0) + COALESCE(c.pecas_em_corte, 0)) >= cfg.exc_min_pecas                                   THEN 'excesso'
    ELSE 'saudavel'
  END AS cobertura_status,

  CASE
    WHEN e.alerta_duplicata = true THEN 'media'
    ELSE 'alta'
  END AS confianca,

  -- Colunas novas no FINAL (ordem Sprint 2 preservada no meio)
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
  'Fase 8: fonte de cortes em producao = amicia_data/ailson_cortes (modulo Oficinas). '
  'Cortes com matriz usam granularidade exata; sem matriz distribui proporcional '
  'pelas vendas 30d (fallback: estoque atual). '
  'Mantem cobertura_dias pra compat Sprint 2; cobertura_projetada_dias e com oficina.';

-- =====================================================================
-- SMOKE TESTS
--
-- 1) Agora tem variacoes com pecas_em_corte > 0?
--    SELECT COUNT(*) AS variacoes_com_corte,
--           SUM(pecas_em_corte) AS total_pecas_em_corte
--    FROM vw_variacoes_classificadas
--    WHERE pecas_em_corte > 0;
--    Esperado: varios milhares de pecas distribuidas entre dezenas/centenas
--    de variacoes (todas as refs que tu tem em oficina hoje).
--
-- 2) As contagens do Card 1 Saude deveriam mudar agora:
--    SELECT variacoes_ruptura_critica, pct_ruptura_critica,
--           variacoes_saudaveis,       pct_saudaveis,
--           variacoes_atencao,         pct_atencao,
--           variacoes_excesso,         pct_excesso
--    FROM vw_estoque_saude_geral;
--    Esperado: ruptura_critica cai significativamente (as refs 2671, 2832,
--    2708, 2782, 2600, 2410 que estao na foto tem muitas pecas em corte).
--
-- 3) Inspecionar ref 2708 (525 pecas cortadas hoje):
--    SELECT ref, cor, tam, estoque_atual, pecas_em_corte, vendas_30d,
--           cobertura_projetada_dias, cobertura_status
--    FROM vw_variacoes_classificadas
--    WHERE ref = '2708'
--    ORDER BY vendas_30d DESC;
--    Esperado: pecas_em_corte distribuidas proporcionalmente.
-- =====================================================================
