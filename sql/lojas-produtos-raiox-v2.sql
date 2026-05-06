-- ═══════════════════════════════════════════════════════════════════════════
-- Sprint Raio-X Produtos — Atualizações 05/05/2026 (noite)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- MUDANCAS pedidas pelo Ailson:
--   1. Top vendidas: janela 45 → 60 dias
--   2. Aba 'Primeira compra' atual: renomear conceitualmente para 'Compras'
--      (mesma logica, apenas janela 45 → 60d)
--   3. NOVA aba 'Primeira compra' = clientes verdadeiramente novos
--      (sem nenhuma venda anterior a 60d, lookback ate 01/01/2025)
--   4. Recompra mantem 90d
--   5. Matches mantem 90d
--
-- IMPORTANTE: a view de matches usa as top refs vendidas (45d → 60d agora),
-- entao precisa REFRESH MATERIALIZED VIEW depois de aplicar este SQL.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. TOP VENDIDAS (45 → 60 dias)
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS vw_lojas_top_vendidas_45d CASCADE;
DROP VIEW IF EXISTS vw_lojas_top_vendidas_60d CASCADE;
CREATE VIEW vw_lojas_top_vendidas_60d AS
SELECT
  i.ref,
  i.loja,
  SUM(i.qtd) AS pecas,
  COUNT(DISTINCT i.cliente_id) AS clientes_distintos,
  COUNT(DISTINCT (i.numero_pedido, i.loja)) AS pedidos_distintos
FROM lojas_vendas_itens i
WHERE i.data_venda >= CURRENT_DATE - 60
  AND i.ref IS NOT NULL
  AND TRIM(i.ref) != ''
GROUP BY i.ref, i.loja;

COMMENT ON VIEW vw_lojas_top_vendidas_60d IS
  'Vendas por (ref, loja) ultimos 60d. Ailson 05/05/2026 (noite).';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. COMPRAS (antiga 'primeira compra', renomeada — 45 → 60 dias)
-- ───────────────────────────────────────────────────────────────────────────
-- Pra cada cliente, identifica a primeira venda DENTRO da janela.
-- Cliente pode ja ter comprado antes — eh a primeira compra DO PERIODO.
--
DROP VIEW IF EXISTS vw_lojas_primeira_compra_45d CASCADE;
DROP VIEW IF EXISTS vw_lojas_compras_periodo_60d CASCADE;
CREATE VIEW vw_lojas_compras_periodo_60d AS
WITH primeira_venda_periodo AS (
  SELECT DISTINCT ON (cliente_id)
    id AS venda_id, cliente_id, canal_origem, loja, data_venda
  FROM lojas_vendas
  WHERE data_venda >= CURRENT_DATE - 60
    AND cliente_id IS NOT NULL
  ORDER BY cliente_id, data_venda ASC, id ASC
)
SELECT
  i.ref, pv.canal_origem, pv.loja,
  COUNT(DISTINCT pv.cliente_id) AS clientes,
  SUM(i.qtd) AS pecas
FROM primeira_venda_periodo pv
JOIN lojas_vendas_itens i ON i.venda_id = pv.venda_id
WHERE i.ref IS NOT NULL AND TRIM(i.ref) != ''
GROUP BY i.ref, pv.canal_origem, pv.loja;

COMMENT ON VIEW vw_lojas_compras_periodo_60d IS
  'Refs na primeira compra de cada cliente DENTRO do periodo (60d). Cliente pode ser antigo. Filtravel por canal_origem.';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. PRIMEIRA COMPRA REAL (NOVA — clientes verdadeiramente novos)
-- ───────────────────────────────────────────────────────────────────────────
-- Cliente eh 'novo de verdade' se:
--   - Tem compra nos ultimos 60 dias
--   - E NAO tem nenhuma compra anterior a 60 dias
--     (lookback total ate 01/01/2025, primeira data em lojas_vendas)
--
-- A logica usa NOT EXISTS pra garantir performance.
--
DROP VIEW IF EXISTS vw_lojas_clientes_novos_60d CASCADE;
CREATE VIEW vw_lojas_clientes_novos_60d AS
WITH clientes_novos AS (
  SELECT DISTINCT v.cliente_id, v.canal_origem, v.loja, v.id AS venda_id, v.data_venda
  FROM lojas_vendas v
  WHERE v.data_venda >= CURRENT_DATE - 60
    AND v.cliente_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM lojas_vendas v2
      WHERE v2.cliente_id = v.cliente_id
        AND v2.data_venda < CURRENT_DATE - 60
    )
),
primeira_venda_de_cada_novo AS (
  SELECT DISTINCT ON (cliente_id)
    cliente_id, canal_origem, loja, venda_id, data_venda
  FROM clientes_novos
  ORDER BY cliente_id, data_venda ASC, venda_id ASC
)
SELECT
  i.ref, p.canal_origem, p.loja,
  COUNT(DISTINCT p.cliente_id) AS clientes,
  SUM(i.qtd) AS pecas
FROM primeira_venda_de_cada_novo p
JOIN lojas_vendas_itens i ON i.venda_id = p.venda_id
WHERE i.ref IS NOT NULL AND TRIM(i.ref) != ''
GROUP BY i.ref, p.canal_origem, p.loja;

COMMENT ON VIEW vw_lojas_clientes_novos_60d IS
  'Refs presentes na PRIMEIRA COMPRA DA VIDA dos clientes que estrearam nos ultimos 60d. Lookback total: 01/01/2025.';


-- ───────────────────────────────────────────────────────────────────────────
-- 4. MATCHES — atualizar pra usar nova view (60d em vez de 45d)
-- ───────────────────────────────────────────────────────────────────────────
-- Recriar materialized view + function de refresh.
--
DROP MATERIALIZED VIEW IF EXISTS mv_lojas_matches_90d CASCADE;
CREATE MATERIALIZED VIEW mv_lojas_matches_90d AS
WITH top_30_refs AS (
  SELECT ref FROM (
    SELECT ref, SUM(pecas) AS total
    FROM vw_lojas_top_vendidas_60d
    GROUP BY ref ORDER BY total DESC LIMIT 30
  ) t
),
compras_top AS (
  SELECT DISTINCT i.numero_pedido, i.loja, i.ref AS ref_top
  FROM lojas_vendas_itens i
  WHERE i.ref IN (SELECT ref FROM top_30_refs)
    AND i.data_venda >= CURRENT_DATE - 90
),
total_compras_por_top AS (
  SELECT ref_top, COUNT(*) AS total_compras
  FROM compras_top GROUP BY ref_top
),
matches_brutos AS (
  SELECT ct.ref_top, i2.ref AS ref_match, ct.numero_pedido, ct.loja
  FROM compras_top ct
  JOIN lojas_vendas_itens i2
    ON i2.numero_pedido = ct.numero_pedido
    AND i2.loja = ct.loja
    AND i2.data_venda >= CURRENT_DATE - 90
    AND i2.ref != ct.ref_top
    AND i2.ref IS NOT NULL AND TRIM(i2.ref) != ''
)
SELECT
  mb.ref_top, mb.ref_match,
  COUNT(DISTINCT (mb.numero_pedido, mb.loja)) AS coocorrencias,
  tc.total_compras,
  ROUND(100.0 * COUNT(DISTINCT (mb.numero_pedido, mb.loja)) / NULLIF(tc.total_compras, 0), 1) AS pct
FROM matches_brutos mb
JOIN total_compras_por_top tc ON tc.ref_top = mb.ref_top
GROUP BY mb.ref_top, mb.ref_match, tc.total_compras
HAVING COUNT(DISTINCT (mb.numero_pedido, mb.loja)) >= 5
ORDER BY mb.ref_top, pct DESC;

CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_lojas_matches_90d
  ON mv_lojas_matches_90d (ref_top, ref_match);

-- Function refresh permanece igual (so depende do nome mv_lojas_matches_90d)
-- Mas como recriei a view, preciso recriar a function pra resolver dependencia
CREATE OR REPLACE FUNCTION refresh_matches_raiox()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  start_ts timestamptz;
  duracao_ms int;
BEGIN
  start_ts := clock_timestamp();
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_lojas_matches_90d;
  duracao_ms := EXTRACT(EPOCH FROM (clock_timestamp() - start_ts)) * 1000;
  RETURN json_build_object(
    'ok', true,
    'duracao_ms', duracao_ms,
    'refreshed_at', clock_timestamp()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_matches_raiox TO service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- 5. RECOMPRA — mantem 90d, sem mudanca
-- ───────────────────────────────────────────────────────────────────────────
-- Nada a fazer. View ja existe com janela 90d.


-- ───────────────────────────────────────────────────────────────────────────
-- VALIDACOES (rodar depois pra confirmar)
-- ───────────────────────────────────────────────────────────────────────────
--
-- 1. Top vendidas:
--    SELECT ref, SUM(pecas) FROM vw_lojas_top_vendidas_60d
--    GROUP BY ref ORDER BY SUM(pecas) DESC LIMIT 5;
--
-- 2. Compras periodo:
--    SELECT ref, SUM(clientes) FROM vw_lojas_compras_periodo_60d
--    GROUP BY ref ORDER BY SUM(clientes) DESC LIMIT 5;
--
-- 3. Clientes novos (PRIMEIRA COMPRA REAL):
--    SELECT ref, SUM(clientes) FROM vw_lojas_clientes_novos_60d
--    GROUP BY ref ORDER BY SUM(clientes) DESC LIMIT 5;
--
-- 4. Quantos clientes novos foram detectados:
--    SELECT COUNT(DISTINCT cliente_id) FROM lojas_vendas v
--    WHERE data_venda >= CURRENT_DATE - 60
--      AND NOT EXISTS (SELECT 1 FROM lojas_vendas v2
--                       WHERE v2.cliente_id = v.cliente_id
--                         AND v2.data_venda < CURRENT_DATE - 60);
--
-- 5. Matches (apos refresh):
--    SELECT refresh_matches_raiox();
--
