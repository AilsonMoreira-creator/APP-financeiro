-- =====================================================================
-- OS Amicia - Sprint 6.1 - Views do Tab Estoque
-- Versao: 1.0 - Data: 21/04/2026
-- Grupo Amicia - App Financeiro v6.8
-- =====================================================================
--
-- COMO RODAR:
--   1. Supabase -> SQL Editor -> New query
--   2. Colar este arquivo INTEIRO
--   3. Run
--   4. Conferir mensagem "CREATE VIEW" 4 vezes (sem erros)
--
-- IDEMPOTENTE: usa DROP VIEW IF EXISTS antes de cada CREATE VIEW.
-- ASCII PURO: nenhum acento, sem setas, sem bullets.
--
-- DEPENDENCIAS (todas ja existem):
--   - vw_variacoes_classificadas  (Sprint 2, em 05_views_corte.sql)
--   - ml_estoque_total_mensal     (tabela populada por api/ml-estoque-cron.js)
--
-- ESCOPO DESTE ARQUIVO (Sprint 6.1, 4 cards):
--   - vw_estoque_saude_geral        (Card 1)
--   - vw_estoque_tendencia_12m      (Card 2)
--   - vw_estoque_ruptura_critica    (Card 3)
--   - vw_estoque_ruptura_disfarcada (Card 4)
--
-- FORA DO 6.1 (ficam pra sub-sprints futuros):
--   - Card 5 (cobertura por tecido) - precisa Ficha Tecnica + decisao
--   - Card 6 (reposicao sugerida)   - usa fn_ia_cortes_recomendados existente
-- =====================================================================



-- =====================================================================
-- 1. vw_estoque_saude_geral (Card 1 do Tab Estoque)
--
-- Conta VARIACOES (ref+cor+tam) por status de cobertura. Nao agrega por
-- ref: uma ref pode ter uma variacao zerada e outra saudavel, e isso
-- importa - o Gatekeeper do Sprint 2 decide na mesma granularidade.
--
-- Corrige o bug da v1 onde "pior status ganha" inflacionava a contagem
-- de refs criticas: 1 variacao zerada em ref com 60 variacoes fazia a
-- ref inteira contar como critica.
--
-- Denominador dos percentuais: total de variacoes ATIVAS OU EM RUPTURA
-- DISFARCADA (sai o ruido de inativas sem demanda ha muito tempo). Essa
-- linha e importante - sem ela, refs saidas de linha com estoque parado
-- inflam o denominador e mascarram a saude real.
--
-- TODO Sprint 6.2: faixa de alerta "N variacoes cruzaram pra ruptura nas
-- ultimas 24h" requer snapshot historico de cobertura_status por dia,
-- que ainda nao temos.
-- =====================================================================

DROP VIEW IF EXISTS vw_estoque_saude_geral CASCADE;

CREATE VIEW vw_estoque_saude_geral AS
WITH variacoes_relevantes AS (
  -- Filtra so variacoes que importam pra saude do estoque:
  -- ativas (tem venda recente) OU ruptura_disfarcada (vendiam e pararam).
  -- Exclui inativas (saidas de linha / refs antigas) pra nao inflar base.
  SELECT
    ref, cor_key, tam,
    estoque_atual,
    cobertura_status,
    demanda_status
  FROM vw_variacoes_classificadas
  WHERE demanda_status IN ('ativa','ruptura_disfarcada')
),
-- Contagem global de estoque: independente do filtro acima, soma tudo
-- que existe em ml_estoque_ref_atual (inclusive refs inativas paradas
-- no galpao). Esse numero tem que bater com o "Estoque total" do app.
estoque_global AS (
  SELECT SUM(vc.estoque_atual) AS unidades_total
  FROM vw_variacoes_classificadas vc
)
SELECT
  -- Contagens por status (so variacoes relevantes)
  COUNT(*)                                                                  AS variacoes_total,
  COUNT(*) FILTER (WHERE demanda_status = 'ativa')                          AS variacoes_ativas,
  COUNT(*) FILTER (WHERE cobertura_status = 'saudavel')                     AS variacoes_saudaveis,
  COUNT(*) FILTER (WHERE cobertura_status = 'atencao')                      AS variacoes_atencao,
  COUNT(*) FILTER (WHERE cobertura_status IN ('critica','zerada'))          AS variacoes_ruptura_critica,
  COUNT(*) FILTER (WHERE cobertura_status = 'excesso')                      AS variacoes_excesso,
  COUNT(*) FILTER (WHERE demanda_status   = 'ruptura_disfarcada')           AS variacoes_ruptura_disfarcada,
  -- Contagem auxiliar: quantas refs distintas tem variacoes relevantes
  COUNT(DISTINCT ref)                                                       AS refs_com_atividade,
  -- Percentuais sobre variacoes_total
  ROUND(100.0 * COUNT(*) FILTER (WHERE cobertura_status = 'saudavel')              / NULLIF(COUNT(*), 0), 1) AS pct_saudaveis,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cobertura_status = 'atencao')               / NULLIF(COUNT(*), 0), 1) AS pct_atencao,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cobertura_status IN ('critica','zerada'))   / NULLIF(COUNT(*), 0), 1) AS pct_ruptura_critica,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cobertura_status = 'excesso')               / NULLIF(COUNT(*), 0), 1) AS pct_excesso,
  -- Total global de unidades em estoque (todas refs, bate com app principal)
  (SELECT unidades_total FROM estoque_global)                               AS unidades_total
FROM variacoes_relevantes;



-- =====================================================================
-- 2. vw_estoque_tendencia_12m (Card 2 do Tab Estoque)
--
-- Serie mensal do total de unidades em estoque consolidado, ate 12 meses
-- pra tras. Fonte: ml_estoque_total_mensal (populada pelo cron 6h em 6h
-- por api/ml-estoque-cron.js fase 8).
--
-- LIMITACAO: o historico depende de quanto tempo o cron ja roda. Se a
-- tabela tiver so 3 meses, a view retorna 3 linhas. Card no front deve
-- tratar serie curta sem quebrar.
--
-- delta_vs_mes_ant e var_pct_vs_mes_ant calculados via LAG. Mes mais
-- antigo da janela tem ambos NULL (esperado).
-- =====================================================================

DROP VIEW IF EXISTS vw_estoque_tendencia_12m CASCADE;

CREATE VIEW vw_estoque_tendencia_12m AS
WITH janela AS (
  SELECT
    ano_mes,
    qtd_total,
    qtd_refs,
    snapshot_date
  FROM ml_estoque_total_mensal
  WHERE ano_mes >= TO_CHAR(CURRENT_DATE - INTERVAL '12 months', 'YYYY-MM')
)
SELECT
  ano_mes,
  qtd_total,
  qtd_refs,
  snapshot_date,
  qtd_total - LAG(qtd_total) OVER (ORDER BY ano_mes)                                                 AS delta_vs_mes_ant,
  ROUND(
    100.0 * (qtd_total - LAG(qtd_total) OVER (ORDER BY ano_mes))::numeric
          / NULLIF(LAG(qtd_total) OVER (ORDER BY ano_mes), 0),
    1
  )                                                                                                  AS var_pct_vs_mes_ant
FROM janela
ORDER BY ano_mes;



-- =====================================================================
-- 3. vw_estoque_ruptura_critica (Card 3 do Tab Estoque)
--
-- Variacoes (ref+cor+tam) em ruptura critica COM demanda ativa.
-- "Critica" inclui zerada (estoque=0) e cobertura<10d (configuravel
-- via ia_config.cobertura_critica_dias).
--
-- Filtro do gatekeeper: demanda_status='ativa' (>=6 vendas em 15 dias).
-- Variacoes inativas/fracas NAO entram aqui mesmo se zeradas - regra
-- nao-negociavel do PROMPT MESTRE: "Estoque zerado nunca implica
-- producao sem demanda recente".
--
-- Ordem: cobertura_dias ASC (mais critico primeiro), com NULL no topo
-- (zeradas com vendas vao primeiro).
-- =====================================================================

DROP VIEW IF EXISTS vw_estoque_ruptura_critica CASCADE;

CREATE VIEW vw_estoque_ruptura_critica AS
SELECT
  ref,
  descricao,
  cor,
  tam,
  estoque_atual,
  vendas_15d,
  vendas_30d,
  velocidade_dia,
  cobertura_dias,
  cobertura_status,
  demanda_status,
  confianca
FROM vw_variacoes_classificadas
WHERE cobertura_status IN ('critica','zerada')
  AND demanda_status   = 'ativa'
ORDER BY cobertura_dias ASC NULLS FIRST, vendas_15d DESC;



-- =====================================================================
-- 4. vw_estoque_ruptura_disfarcada (Card 4 do Tab Estoque)
--
-- Variacoes que vendiam bem mes anterior (>=12 unidades por padrao,
-- configuravel via ia_config.ruptura_disfarcada_min_mes_ant) e zeraram
-- vendas nos ultimos 15 dias. Sintoma classico: anuncio caiu, foto
-- ruim, perdeu posicao no algoritmo, ou estoque acabou silenciosamente.
--
-- Quem dispara: demanda_status='ruptura_disfarcada' (calculado em
-- vw_variacoes_classificadas usando vendas_15d=0 AND vendas_mes_ant >=
-- ruptura_disfarcada_min_mes_ant). NAO precisa estar em cobertura
-- critica - pode ate ter estoque, mas ninguem ta comprando.
--
-- Ordem: maior vendas_mes_ant primeiro (perda potencial maior).
-- =====================================================================

DROP VIEW IF EXISTS vw_estoque_ruptura_disfarcada CASCADE;

CREATE VIEW vw_estoque_ruptura_disfarcada AS
SELECT
  ref,
  descricao,
  cor,
  tam,
  estoque_atual,
  vendas_15d,
  vendas_30d,
  vendas_mes_ant,
  vendas_90d,
  ultima_venda,
  cobertura_status,
  confianca
FROM vw_variacoes_classificadas
WHERE demanda_status = 'ruptura_disfarcada'
ORDER BY vendas_mes_ant DESC, vendas_90d DESC;



-- =====================================================================
-- FIM DO ARQUIVO
--
-- Validacao rapida apos rodar (esperado: 4 linhas, uma por view):
--   SELECT viewname FROM pg_views
--   WHERE schemaname = 'public'
--     AND viewname LIKE 'vw_estoque_%'
--   ORDER BY viewname;
--
-- Smoke test de cada view:
--   SELECT * FROM vw_estoque_saude_geral;
--   SELECT * FROM vw_estoque_tendencia_12m LIMIT 12;
--   SELECT * FROM vw_estoque_ruptura_critica LIMIT 10;
--   SELECT * FROM vw_estoque_ruptura_disfarcada LIMIT 10;
-- =====================================================================
