-- =====================================================================
-- OS Amicia - Sprint 6.1 Fase 9 - Coerencia do Card 1 com Gatekeeper
-- Versao: 1.0 - Data: 22/04/2026
-- Grupo Amicia - App Financeiro v6.8
-- =====================================================================
--
-- COMO RODAR:
--   1. DEPOIS de 14_fase8_cortes_oficinas.sql
--   2. Supabase -> SQL Editor -> New query
--   3. Colar e Run
--
-- IDEMPOTENTE: DROP VIEW IF EXISTS + CREATE VIEW.
-- ASCII PURO.
--
-- PROBLEMA DETECTADO:
-- Card 1 do Tab Estoque mostrava 104 variacoes em ruptura critica.
-- Card 2 (que lista detalhe das criticas) mostrava menos de 50.
-- Numeros nao batiam entre os 2 cards mesmo sendo mesma view base.
--
-- CAUSA: definicoes diferentes de "ruptura critica":
--   - Card 1 (vw_estoque_saude_geral): cobertura_status IN ('critica','zerada')
--                                      - SEM filtro de demanda
--   - Card 2 (vw_estoque_ruptura_critica): cobertura_status IN (...)
--                                          AND demanda_status = 'ativa'
-- O PROMPT MESTRE define "ruptura critica" como "cobertura baixa COM
-- demanda ativa". Gatekeeper. Card 1 nao seguia essa regra.
--
-- Adicionalmente, o CTE variacoes_relevantes filtrava por
-- demanda IN ('ativa','ruptura_disfarcada') - misturando as duas coisas
-- nas contagens de critica/saudavel/atencao/excesso. Dupla distorcao.
--
-- REGRA NOVA (Ailson 22/04):
-- Todas as 4 metricas do Card 1 (saudavel/atencao/critica/excesso) usam
-- como BASE apenas variacoes com demanda_status='ativa'. "Ruptura
-- disfarcada" fica como metrica complementar em variacoes_ruptura_disfarcada,
-- que e' outra historia.
-- =====================================================================

DROP VIEW IF EXISTS vw_estoque_saude_geral CASCADE;

CREATE VIEW vw_estoque_saude_geral AS
WITH variacoes_ativas AS (
  -- BASE UNIFICADA: apenas variacoes com demanda ativa (>=6 vendas/15d).
  -- Mesma logica do Gatekeeper usada no Card 2 e 3 (rupturas).
  -- Variacoes inativas/fracas/disfarcadas saem das contagens de cobertura.
  SELECT
    ref, cor_key, tam,
    estoque_atual,
    cobertura_status,
    demanda_status
  FROM vw_variacoes_classificadas
  WHERE demanda_status = 'ativa'
),
-- Ruptura disfarcada continua contada separadamente (nao eh cobertura,
-- e outro sinal: variacao que vendia e parou com/sem estoque)
disfarcadas AS (
  SELECT COUNT(*) AS total
  FROM vw_variacoes_classificadas
  WHERE demanda_status = 'ruptura_disfarcada'
),
-- Estoque total nao filtra por demanda (deve bater com "Estoque total"
-- do app principal, que e valor fisico global)
estoque_global AS (
  SELECT SUM(estoque_atual) AS unidades_total
  FROM vw_variacoes_classificadas
),
-- Quantas refs tem pelo menos uma variacao ativa (mesma base das contagens)
refs_ativas_count AS (
  SELECT COUNT(DISTINCT ref) AS total
  FROM variacoes_ativas
)
SELECT
  -- Contagens por status (todas usam base variacoes_ativas)
  COUNT(*)                                                                  AS variacoes_total,
  COUNT(*) FILTER (WHERE demanda_status = 'ativa')                          AS variacoes_ativas,
  COUNT(*) FILTER (WHERE cobertura_status = 'saudavel')                     AS variacoes_saudaveis,
  COUNT(*) FILTER (WHERE cobertura_status = 'atencao')                      AS variacoes_atencao,
  COUNT(*) FILTER (WHERE cobertura_status IN ('critica','zerada'))          AS variacoes_ruptura_critica,
  COUNT(*) FILTER (WHERE cobertura_status = 'excesso')                      AS variacoes_excesso,
  -- Disfarcadas: metrica separada, vem da subquery
  (SELECT total FROM disfarcadas)                                           AS variacoes_ruptura_disfarcada,
  -- Refs ativas
  (SELECT total FROM refs_ativas_count)                                     AS refs_com_atividade,
  -- Percentuais sobre variacoes_total (que agora e so ativas)
  ROUND(100.0 * COUNT(*) FILTER (WHERE cobertura_status = 'saudavel')              / NULLIF(COUNT(*), 0), 1) AS pct_saudaveis,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cobertura_status = 'atencao')               / NULLIF(COUNT(*), 0), 1) AS pct_atencao,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cobertura_status IN ('critica','zerada'))   / NULLIF(COUNT(*), 0), 1) AS pct_ruptura_critica,
  ROUND(100.0 * COUNT(*) FILTER (WHERE cobertura_status = 'excesso')               / NULLIF(COUNT(*), 0), 1) AS pct_excesso,
  (SELECT unidades_total FROM estoque_global)                               AS unidades_total
FROM variacoes_ativas;

-- =====================================================================
-- SMOKE TEST
--
-- Esperado: agora Card 1 e Card 2 batem. Contagem de ruptura_critica
-- do Card 1 deve ser igual a COUNT(*) do Card 2:
--
--   SELECT variacoes_ruptura_critica FROM vw_estoque_saude_geral;
--   SELECT COUNT(*) FROM vw_estoque_ruptura_critica;
--   -- Os 2 numeros devem bater.
--
-- Estimativa das mudancas vs output anterior (104/178/37/29):
--   - variacoes_ruptura_critica: 104 -> ~50 (bate com Card 2)
--   - variacoes_excesso:         178 -> menor (excesso sem demanda sai)
--   - variacoes_saudaveis/atencao: ajustam pela nova base
--   - variacoes_ruptura_disfarcada: 18 (igual, vem separado)
-- =====================================================================
