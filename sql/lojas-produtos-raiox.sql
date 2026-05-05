-- ═══════════════════════════════════════════════════════════════════════════
-- Sprint Raio-X Produtos (Modulo Lojas)
-- Sessao Ailson 05/05/2026.
--
-- 4 views novas — isoladas, nenhuma alteracao em tabelas existentes.
--
-- Le de:
--   - lojas_vendas_itens (Relatorio BI Mire, populado via Drive importer)
--   - lojas_vendas       (mesma origem, tem canal_origem)
--   - lojas_produtos     (descricao, categoria — populado via outros caminhos)
--
-- Janelas:
--   - Top vendidas:        45 dias
--   - Primeira compra:     45 dias
--   - Recompra:            90 dias
--   - Matches:             90 dias
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- 1. TOP 30 VENDIDAS (45d) — view normal
-- ───────────────────────────────────────────────────────────────────────────
-- ATENCAO: filtro de loja eh aplicado no endpoint via parametro.
-- A view retorna TUDO; o backend filtra .eq('loja', ...) ou agrega.
--
DROP VIEW IF EXISTS vw_lojas_top_vendidas_45d CASCADE;
CREATE VIEW vw_lojas_top_vendidas_45d AS
SELECT
  i.ref,
  i.loja,  -- pra filtrar BR/ST no backend
  SUM(i.qtd) AS pecas,
  COUNT(DISTINCT i.cliente_id) AS clientes_distintos,
  COUNT(DISTINCT (i.numero_pedido, i.loja)) AS pedidos_distintos
FROM lojas_vendas_itens i
WHERE i.data_venda >= CURRENT_DATE - 45
  AND i.ref IS NOT NULL
  AND TRIM(i.ref) != ''
GROUP BY i.ref, i.loja;

COMMENT ON VIEW vw_lojas_top_vendidas_45d IS
  'Vendas por (ref, loja) ultimos 45d. Backend agrega/filtra. Sprint raio-x 05/05/2026.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. PRIMEIRA COMPRA (45d) — view normal
-- ───────────────────────────────────────────────────────────────────────────
-- Pra cada cliente, identifica a primeira venda no periodo (45d), e lista
-- as refs dessa venda. Backend filtra por canal_origem (geral vs vesti) e loja.
--
DROP VIEW IF EXISTS vw_lojas_primeira_compra_45d CASCADE;
CREATE VIEW vw_lojas_primeira_compra_45d AS
WITH primeira_venda_por_cliente AS (
  SELECT DISTINCT ON (cliente_id)
    id AS venda_id,
    cliente_id,
    canal_origem,
    loja,
    data_venda
  FROM lojas_vendas
  WHERE data_venda >= CURRENT_DATE - 45
    AND cliente_id IS NOT NULL
  ORDER BY cliente_id, data_venda ASC, id ASC
)
SELECT
  i.ref,
  pv.canal_origem,
  pv.loja,
  COUNT(DISTINCT pv.cliente_id) AS clientes,
  SUM(i.qtd) AS pecas
FROM primeira_venda_por_cliente pv
JOIN lojas_vendas_itens i ON i.venda_id = pv.venda_id
WHERE i.ref IS NOT NULL
  AND TRIM(i.ref) != ''
GROUP BY i.ref, pv.canal_origem, pv.loja;

COMMENT ON VIEW vw_lojas_primeira_compra_45d IS
  'Refs que aparecem na PRIMEIRA compra de cada cliente (45d). Filtravel por canal_origem (vesti vs geral) e loja.';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. RECOMPRA (90d) — view normal
-- ───────────────────────────────────────────────────────────────────────────
-- Cada compra (numero_pedido + loja) onde a ref aparece eh uma ocorrencia.
-- Mesmo cliente comprando a mesma ref em 2 datas distintas = 2 ocorrencias.
-- 'Recompra' = ref que aparece em multiplas compras (>= 2 ocorrencias).
--
DROP VIEW IF EXISTS vw_lojas_recompra_90d CASCADE;
CREATE VIEW vw_lojas_recompra_90d AS
SELECT
  i.ref,
  i.loja,
  COUNT(DISTINCT (i.numero_pedido, i.loja)) AS ocorrencias,
  COUNT(DISTINCT i.cliente_id) AS clientes_distintos
FROM lojas_vendas_itens i
WHERE i.data_venda >= CURRENT_DATE - 90
  AND i.cliente_id IS NOT NULL
  AND i.ref IS NOT NULL
  AND TRIM(i.ref) != ''
GROUP BY i.ref, i.loja
HAVING COUNT(DISTINCT (i.numero_pedido, i.loja)) >= 2;

COMMENT ON VIEW vw_lojas_recompra_90d IS
  'Refs com 2+ ocorrencias em compras distintas (90d). Cada (numero_pedido, loja) eh uma ocorrencia.';


-- ───────────────────────────────────────────────────────────────────────────
-- 4. MATCHES (90d) — MATERIALIZED VIEW
-- ───────────────────────────────────────────────────────────────────────────
-- Pra cada uma das top 30 refs (vendidas em 45d, agregado), encontra
-- outras refs que aparecem na MESMA compra (numero_pedido + loja).
--
-- Co-ocorrencia minima: 5
-- Janela: 90d
-- Sempre AGREGADO (ignora filtro de loja — Ailson 05/05)
--
-- Atualizada via REFRESH MATERIALIZED VIEW pelo cron diario 03:00 BRT.
--
DROP MATERIALIZED VIEW IF EXISTS mv_lojas_matches_90d CASCADE;
CREATE MATERIALIZED VIEW mv_lojas_matches_90d AS
WITH top_30_refs AS (
  -- Top 30 refs agregando todas lojas, ultimos 45d
  SELECT ref
  FROM (
    SELECT ref, SUM(pecas) AS total
    FROM vw_lojas_top_vendidas_45d
    GROUP BY ref
    ORDER BY total DESC
    LIMIT 30
  ) t
),
compras_top AS (
  -- Compras (numero_pedido + loja) onde uma top ref apareceu (90d)
  SELECT DISTINCT
    i.numero_pedido,
    i.loja,
    i.ref AS ref_top
  FROM lojas_vendas_itens i
  WHERE i.ref IN (SELECT ref FROM top_30_refs)
    AND i.data_venda >= CURRENT_DATE - 90
),
total_compras_por_top AS (
  -- Total de compras distintas que tem cada ref top
  SELECT ref_top, COUNT(*) AS total_compras
  FROM compras_top
  GROUP BY ref_top
),
matches_brutos AS (
  -- Pra cada compra com ref_top, lista todas as OUTRAS refs da mesma compra
  SELECT
    ct.ref_top,
    i2.ref AS ref_match,
    ct.numero_pedido,
    ct.loja
  FROM compras_top ct
  JOIN lojas_vendas_itens i2
    ON i2.numero_pedido = ct.numero_pedido
    AND i2.loja = ct.loja
    AND i2.data_venda >= CURRENT_DATE - 90
    AND i2.ref != ct.ref_top
    AND i2.ref IS NOT NULL
    AND TRIM(i2.ref) != ''
)
SELECT
  mb.ref_top,
  mb.ref_match,
  COUNT(DISTINCT (mb.numero_pedido, mb.loja)) AS coocorrencias,
  tc.total_compras,
  ROUND(100.0 * COUNT(DISTINCT (mb.numero_pedido, mb.loja)) / NULLIF(tc.total_compras, 0), 1) AS pct
FROM matches_brutos mb
JOIN total_compras_por_top tc ON tc.ref_top = mb.ref_top
GROUP BY mb.ref_top, mb.ref_match, tc.total_compras
HAVING COUNT(DISTINCT (mb.numero_pedido, mb.loja)) >= 5
ORDER BY mb.ref_top, pct DESC;

-- Unique index pra suportar REFRESH CONCURRENTLY (sem lock)
CREATE UNIQUE INDEX IF NOT EXISTS ux_mv_lojas_matches_90d
  ON mv_lojas_matches_90d (ref_top, ref_match);

COMMENT ON MATERIALIZED VIEW mv_lojas_matches_90d IS
  'Co-ocorrencia das top 30 refs (45d) com outras refs na mesma compra (90d). Min 5 coocorr. Refresh diario 03:00 BRT.';


-- ───────────────────────────────────────────────────────────────────────────
-- VALIDACAO: rodar apos criar pra confirmar resultados
-- ───────────────────────────────────────────────────────────────────────────
--
-- Top vendidas:
--   SELECT ref, SUM(pecas) AS pecas, SUM(pedidos_distintos) AS pedidos
--   FROM vw_lojas_top_vendidas_45d
--   GROUP BY ref ORDER BY pecas DESC LIMIT 10;
--
-- Primeira compra Geral:
--   SELECT ref, SUM(clientes) AS qt
--   FROM vw_lojas_primeira_compra_45d
--   GROUP BY ref ORDER BY qt DESC LIMIT 15;
--
-- Primeira compra Vesti:
--   SELECT ref, SUM(clientes) AS qt
--   FROM vw_lojas_primeira_compra_45d
--   WHERE canal_origem = 'vesti'
--   GROUP BY ref ORDER BY qt DESC LIMIT 15;
--
-- Recompra:
--   SELECT ref, SUM(ocorrencias) AS ocs
--   FROM vw_lojas_recompra_90d
--   GROUP BY ref ORDER BY ocs DESC LIMIT 15;
--
-- Matches (apos REFRESH):
--   REFRESH MATERIALIZED VIEW mv_lojas_matches_90d;
--   SELECT * FROM mv_lojas_matches_90d WHERE ref_top = '2920' LIMIT 10;
--


-- ───────────────────────────────────────────────────────────────────────────
-- 5. FUNCTION: refresh_matches_raiox()
-- ───────────────────────────────────────────────────────────────────────────
-- Function que o endpoint /api/lojas-produtos-raiox-refresh chama via .rpc()
-- (supabase-js nao tem execucao SQL direto, precisa de RPC).
--
-- SECURITY DEFINER pra rodar com permissao do owner (refresh exige owner).
-- search_path explicito pra evitar ataque de path injection.
--
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

COMMENT ON FUNCTION refresh_matches_raiox IS
  'Refresh diario da mv_lojas_matches_90d. Chamada via .rpc() pelo endpoint cron. SECURITY DEFINER.';

-- Permissao pra service_role chamar
GRANT EXECUTE ON FUNCTION refresh_matches_raiox TO service_role;
