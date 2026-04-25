-- =====================================================================
-- OS Amícia · Sprint 8 · IA Pergunta · Variações em ruptura (cores aprovadas)
-- Versão: 1.0 · Data: 25/04/2026
-- =====================================================================
--
-- COMO RODAR:
--   Supabase → SQL Editor → New query → colar este arquivo INTEIRO → Run
--   Idempotente (CREATE OR REPLACE VIEW). ASCII puro.
--
-- PROPÓSITO:
-- Resolve perguntas tipo "tem alguma variação prestes a zerar?" sem o
-- usuário precisar dar uma REF específica. A IA Pergunta v1 só
-- conseguia responder isso quando o user citava a REF — agora pode
-- listar as TOP variações urgentes do catálogo inteiro.
--
-- LÓGICA:
-- Cruza vw_variacoes_classificadas (granular cor+tam) com
-- vw_distribuicao_cores_por_ref (filtro top do catálogo + ≥2 var/cor)
-- mantendo só:
--   - demanda_status = 'ativa' (variação ainda vende)
--   - cobertura_status em ('critica', 'zerada') (vai zerar mesmo)
--   - classificacao = 'principal' (cor aprovada — não inclui verde lima)
--
-- COLUNAS DE SAÍDA:
--   ref, cor, tam, estoque_atual, pecas_em_corte
--   vendas_15d, vendas_30d, velocidade_dia
--   cobertura_dias, cobertura_projetada_dias, cobertura_status
--   rank_cor_na_ref (rank dentro da REF — 1=carro-chefe da REF)
--   rank_catalogo (rank global da cor no catálogo Bling)
--
-- =====================================================================

CREATE OR REPLACE VIEW vw_ia_variacoes_em_ruptura AS
SELECT
  v.ref,
  v.cor,
  v.cor_key,
  v.tam,
  v.estoque_atual,
  v.pecas_em_corte,
  v.vendas_15d,
  v.vendas_30d,
  v.vendas_mes_ant,
  v.velocidade_dia,
  v.cobertura_dias,
  v.cobertura_projetada_dias,
  v.cobertura_status,
  v.demanda_status,
  d.rank_cor                                                    AS rank_cor_na_ref,
  d.rank_catalogo,
  d.classificacao
FROM vw_variacoes_classificadas v
INNER JOIN vw_distribuicao_cores_por_ref d
  ON d.ref = v.ref AND d.cor_key = v.cor_key
WHERE v.demanda_status = 'ativa'
  AND v.cobertura_status IN ('critica', 'zerada')
  AND d.classificacao = 'principal';

COMMENT ON VIEW vw_ia_variacoes_em_ruptura IS
  'IA Pergunta v1.0 - Variacoes (cor+tam) em ruptura critica/zerada com '
  'demanda ativa, JA filtradas pelas cores aprovadas (classificacao=principal). '
  'Resolve pergunta "tem variacao prestes a zerar?" sem precisar de REF especifica.';

GRANT SELECT ON vw_ia_variacoes_em_ruptura TO authenticated;
GRANT SELECT ON vw_ia_variacoes_em_ruptura TO service_role;

-- =====================================================================
-- SMOKE TESTS
--
-- 1) Quantas variações em ruptura existem no catálogo todo?
--    SELECT COUNT(*) FROM vw_ia_variacoes_em_ruptura;
--
-- 2) Top 30 mais urgentes:
--    SELECT ref, cor, tam, estoque_atual, pecas_em_corte,
--           cobertura_projetada_dias, cobertura_status
--    FROM vw_ia_variacoes_em_ruptura
--    ORDER BY cobertura_projetada_dias NULLS FIRST
--    LIMIT 30;
--
-- 3) Variações em ruptura de uma REF específica:
--    SELECT * FROM vw_ia_variacoes_em_ruptura
--    WHERE ref = '02277'
--    ORDER BY cobertura_projetada_dias NULLS FIRST;
-- =====================================================================
