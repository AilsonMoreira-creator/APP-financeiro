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
-- Agrega vw_variacoes_classificadas por ref (pior status entre variacoes
-- ganha) e produz contadores e percentuais pra os 4 mini-cards do header:
--   refs_ativas, pct_saudaveis, pct_atencao, pct_ruptura_critica
--
-- TODO Sprint 6.2: faixa de alerta "N refs cruzaram pra ruptura nas
-- ultimas 24h" requer snapshot historico de cobertura_status por dia,
-- que ainda nao temos. Vai entrar quando o cron de estoque comecar a
-- gravar essa serie em amicia_data ou tabela nova.
-- =====================================================================

DROP VIEW IF EXISTS vw_estoque_saude_geral CASCADE;

CREATE VIEW vw_estoque_saude_geral AS
WITH por_ref AS (
  -- Consolida variacoes (ref+cor+tam) em ref. Pior status ganha.
  -- Ordem de gravidade: critica/zerada > atencao > saudavel > excesso > sem_demanda
  SELECT
    ref,
    SUM(estoque_atual)                                       AS estoque_ref,
    BOOL_OR(demanda_status = 'ativa')                        AS tem_demanda_ativa,
    CASE
      WHEN BOOL_OR(cobertura_status IN ('critica','zerada')) THEN 'critica'
      WHEN BOOL_OR(cobertura_status = 'atencao')             THEN 'atencao'
      WHEN BOOL_OR(cobertura_status = 'saudavel')            THEN 'saudavel'
      WHEN BOOL_OR(cobertura_status = 'excesso')             THEN 'excesso'
      ELSE 'sem_demanda'
    END                                                      AS status_pior
  FROM vw_variacoes_classificadas
  GROUP BY ref
)
SELECT
  COUNT(*)                                                                       AS refs_total,
  COUNT(*) FILTER (WHERE tem_demanda_ativa)                                      AS refs_ativas,
  COUNT(*) FILTER (WHERE status_pior = 'saudavel')                               AS refs_saudaveis,
  COUNT(*) FILTER (WHERE status_pior = 'atencao')                                AS refs_atencao,
  COUNT(*) FILTER (WHERE status_pior = 'critica')                                AS refs_ruptura_critica,
  COUNT(*) FILTER (WHERE status_pior = 'excesso')                                AS refs_excesso,
  COUNT(*) FILTER (WHERE status_pior = 'sem_demanda')                            AS refs_sem_demanda,
  -- Percentuais (denominador inclui todas as refs com status calculavel)
  ROUND(100.0 * COUNT(*) FILTER (WHERE status_pior = 'saudavel')         / NULLIF(COUNT(*), 0), 1) AS pct_saudaveis,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status_pior = 'atencao')          / NULLIF(COUNT(*), 0), 1) AS pct_atencao,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status_pior = 'critica')          / NULLIF(COUNT(*), 0), 1) AS pct_ruptura_critica,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status_pior = 'excesso')          / NULLIF(COUNT(*), 0), 1) AS pct_excesso,
  -- Total de unidades em estoque consolidado (todas refs)
  SUM(estoque_ref)                                                               AS unidades_total
FROM por_ref;



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
