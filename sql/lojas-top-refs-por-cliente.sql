-- ═══════════════════════════════════════════════════════════════════════════
-- VIEW: vw_lojas_top_refs_por_cliente
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Decisão Ailson 28/04/2026: top 3 REFs que cada cliente compra bem.
-- Usado pela IA pra:
--   1. Saber se uma REF "vende bem" pra ela (top 3)
--   2. Disparar sugestão de REPOSIÇÃO quando volta uma novidade dessa REF
--   3. Alternar entre os 3 ao longo dos dias (anti-monotonia)
--
-- SCORE MESCLADO (decisão Ailson):
--   peças × 0.7 + (vezes_comprou × 3.0)
--
-- Reflete TANTO volume quanto RECORRÊNCIA. Cliente que comprou
-- a mesma REF em 5 pedidos diferentes (15 peças) tem score MAIOR
-- que cliente que comprou tudo de uma vez só (15 peças, 1 pedido).
-- A recorrência tem peso 3x maior porque é sinal mais forte de
-- afinidade real com o modelo.
--
-- Janela: TODAS as compras (sem cutoff). Histórico vale.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_lojas_top_refs_por_cliente AS
WITH agregado AS (
  SELECT
    cliente_id,
    ref,
    SUM(qtd) AS pecas_total,
    COUNT(DISTINCT numero_pedido || loja) AS vezes_comprou,
    SUM(liquido_unit * qtd) AS receita_cliente_ref,
    MIN(data_venda) AS primeira_compra_ref,
    MAX(data_venda) AS ultima_compra_ref,
    -- Score mesclado: 70% peças + 30% recorrência (com peso 3x na rec)
    (SUM(qtd) * 0.7 + COUNT(DISTINCT numero_pedido || loja) * 3.0) AS score
  FROM lojas_vendas_itens
  WHERE cliente_id IS NOT NULL
  GROUP BY cliente_id, ref
),
ranqueado AS (
  SELECT
    cliente_id,
    ref,
    pecas_total,
    vezes_comprou,
    receita_cliente_ref,
    primeira_compra_ref,
    ultima_compra_ref,
    score,
    ROW_NUMBER() OVER (
      PARTITION BY cliente_id
      ORDER BY score DESC, ultima_compra_ref DESC
    ) AS posicao
  FROM agregado
)
SELECT
  cliente_id,
  ref,
  posicao,
  pecas_total,
  vezes_comprou,
  receita_cliente_ref,
  primeira_compra_ref,
  ultima_compra_ref,
  score
FROM ranqueado
WHERE posicao <= 3
ORDER BY cliente_id, posicao;

COMMENT ON VIEW vw_lojas_top_refs_por_cliente IS
  'Top 3 REFs por cliente. Score = peças*0.7 + vezes_comprou*3.0. '
  'Usado pela IA pra: 1) detectar reposição relevante; 2) alternar '
  'recomendações entre os 3 sem repetir.';

-- ─── Validação pós-criação ───────────────────────────────────────────────
-- SELECT * FROM vw_lojas_top_refs_por_cliente LIMIT 30;
-- SELECT cliente_id, COUNT(*) FROM vw_lojas_top_refs_por_cliente GROUP BY cliente_id LIMIT 5;
