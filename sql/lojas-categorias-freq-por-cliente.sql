-- ═══════════════════════════════════════════════════════════════════════════
-- VIEW: vw_lojas_categorias_freq_por_cliente
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Decisão Ailson 30/04/2026: além das top 3 REFs específicas, IA também
-- precisa saber em quais CATEGORIAS o cliente compra muito (calça, blusa,
-- vestido, macacão...). Isso permite oferecer uma novidade/best_seller que
-- é dessa categoria mesmo que a REF específica não esteja no top 3 dela.
--
-- Janela: TODAS as compras (sem cutoff). Histórico vale — define perfil
-- duradouro da cliente.
--
-- Threshold de inclusão: pct >= 15% das peças totais. Filtragem fina
-- (>=30% pra "dominante") fica no backend pra ajuste sem mexer na view.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_lojas_categorias_freq_por_cliente AS
WITH agregado AS (
  SELECT
    vi.cliente_id,
    UPPER(TRIM(p.categoria)) AS categoria,
    SUM(vi.qtd) AS pecas,
    COUNT(DISTINCT vi.numero_pedido || vi.loja) AS pedidos
  FROM lojas_vendas_itens vi
  JOIN lojas_produtos p ON p.ref = vi.ref
  WHERE vi.cliente_id IS NOT NULL
    AND p.categoria IS NOT NULL
    AND TRIM(p.categoria) != ''
  GROUP BY vi.cliente_id, UPPER(TRIM(p.categoria))
),
totais AS (
  SELECT
    cliente_id,
    SUM(pecas) AS total_pecas
  FROM agregado
  GROUP BY cliente_id
)
SELECT
  a.cliente_id,
  a.categoria,
  a.pecas,
  a.pedidos,
  t.total_pecas,
  ROUND(100.0 * a.pecas / NULLIF(t.total_pecas, 0), 1) AS pct
FROM agregado a
JOIN totais t ON t.cliente_id = a.cliente_id
WHERE 100.0 * a.pecas / NULLIF(t.total_pecas, 0) >= 15
ORDER BY a.cliente_id, a.pecas DESC;

COMMENT ON VIEW vw_lojas_categorias_freq_por_cliente IS
  'Distribuição de compras por categoria (CALÇA, BLUSA, etc) por cliente. '
  'Filtrado em pct>=15% (categorias relevantes). Backend filtra >=30% pra '
  'considerar dominante. Usado pela IA pra oferecer novidades de categoria '
  'que o cliente compra bem mesmo sem REF específica no top 3.';

-- ─── Validação pós-criação ───────────────────────────────────────────────
-- SELECT cliente_id, ARRAY_AGG(categoria || '=' || pct || '%' ORDER BY pecas DESC)
-- FROM vw_lojas_categorias_freq_por_cliente
-- GROUP BY cliente_id LIMIT 10;
