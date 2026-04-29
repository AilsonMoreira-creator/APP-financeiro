-- ═══════════════════════════════════════════════════════════════════════════
-- LOJAS — VENDAS ITENS (Relatório BI do Mire, granular por SKU)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Origem: planilha "RELATÓRIO PARA BI" exportada do Mire (loja física Amícia)
--   - 1 linha = 1 SKU vendido em 1 pedido
--   - Disponível desde 01.03.2026
--   - Alimentada semanalmente via Drive (junto com os outros parsers)
--
-- Tabela complementa lojas_vendas (que tem 1 linha por pedido agregado).
-- O parser extrai REF do SKU usando refFromSku() — regra:
--   - 95%: primeiros 4 dígitos do SKU
--   - Exceção 1: REFs 395 e 376 (3 dígitos)
--   - Exceção 2: REFs 0020 e 0050 (zero à esquerda preservado)
--
-- Decisão Ailson 28/04/2026: usar essa tabela como fonte de best_sellers /
-- em_alta da loja física Amícia. NÃO MISTURAR com vendas Bling
-- (marketplaces de marcas Exitus/Lumia/Muniam — fonte completamente
-- diferente, módulo Marketplaces).
--
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lojas_vendas_itens (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- chave de dedup: (numero_pedido + loja + sku) é único
  numero_pedido   text NOT NULL,
  loja            text NOT NULL CHECK (loja IN ('Silva Teles','Bom Retiro')),
  sku             text NOT NULL,

  -- ref extraída do sku via refFromSku (regra 4 dígitos com exceções)
  ref             text NOT NULL,

  -- vínculos (desnormalizados pra query rápida em vw_lojas_top_vendas_loja_fisica)
  venda_id        uuid REFERENCES lojas_vendas(id) ON DELETE SET NULL,
  cliente_id      uuid REFERENCES lojas_clientes(id) ON DELETE SET NULL,
  vendedora_id    uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,

  -- contexto da venda
  data_venda      date NOT NULL,
  documento_cliente_raw   text,    -- backup pra resolver venda_id depois se importou item antes do pedido
  cliente_razao_raw       text,

  -- detalhes do item (do Mire)
  descricao       text,
  qtd             int DEFAULT 1,
  custo_unit      numeric(12,2) DEFAULT 0,
  preco_unit      numeric(12,2) DEFAULT 0,
  desconto_unit   numeric(12,2) DEFAULT 0,
  liquido_unit    numeric(12,2) DEFAULT 0,
  frete_unit      numeric(12,2) DEFAULT 0,

  -- meta
  importacao_id   uuid,            -- referencia lojas_importacoes
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Dedup: (pedido + loja + sku) único
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendas_itens_dedup
  ON lojas_vendas_itens(numero_pedido, loja, sku);

-- Queries comuns
CREATE INDEX IF NOT EXISTS idx_vendas_itens_ref_data
  ON lojas_vendas_itens(ref, data_venda DESC);

CREATE INDEX IF NOT EXISTS idx_vendas_itens_cliente
  ON lojas_vendas_itens(cliente_id, data_venda DESC)
  WHERE cliente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vendas_itens_venda
  ON lojas_vendas_itens(venda_id)
  WHERE venda_id IS NOT NULL;

COMMENT ON TABLE lojas_vendas_itens IS
  'Detalhe de SKU por pedido. Origem: Relatório BI do Mire. 1 linha = 1 SKU vendido. '
  'Fonte de best_sellers da loja física Amícia. NÃO MISTURAR com vendas Bling (marketplaces).';


-- ═══════════════════════════════════════════════════════════════════════════
-- VIEW: vw_lojas_top_vendas_loja_fisica
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Top REFs vendidos na loja física Amícia (Silva Teles + Bom Retiro) nos
-- últimos 45 dias. Usada pelo backend lojas-ia.js como fonte automática
-- de best_sellers/em_alta:
--   - Top 10 (curva A) → best_sellers
--   - Top 11-20 (curva B) → em_alta
-- Curadoria manual (lojas_produtos_curadoria) tem PRIORIDADE sobre essa view.
--
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_lojas_top_vendas_loja_fisica AS
WITH agregado AS (
  SELECT
    ref,
    SUM(qtd)                                AS pecas_45d,
    SUM(liquido_unit * qtd)                 AS receita_45d,
    COUNT(DISTINCT cliente_id)              AS clientes_45d,
    COUNT(DISTINCT numero_pedido || loja)   AS pedidos_45d,
    MAX(data_venda)                         AS ultima_venda,
    MIN(data_venda)                         AS primeira_venda_no_periodo
  FROM lojas_vendas_itens
  WHERE data_venda >= CURRENT_DATE - INTERVAL '45 days'
  GROUP BY ref
)
SELECT
  ref,
  pecas_45d,
  receita_45d,
  clientes_45d,
  pedidos_45d,
  ultima_venda,
  primeira_venda_no_periodo,
  RANK() OVER (ORDER BY pecas_45d DESC, receita_45d DESC) AS posicao_ranking,
  CASE
    WHEN RANK() OVER (ORDER BY pecas_45d DESC, receita_45d DESC) <= 10 THEN 'a'
    WHEN RANK() OVER (ORDER BY pecas_45d DESC, receita_45d DESC) <= 20 THEN 'b'
    ELSE 'c'
  END AS curva
FROM agregado
ORDER BY posicao_ranking;

COMMENT ON VIEW vw_lojas_top_vendas_loja_fisica IS
  'Top REFs vendidos nas lojas físicas Amícia 45d. Fonte: lojas_vendas_itens. '
  'Curva A=top10, B=11-20, C=21+. Usada pela IA do módulo Lojas como auto best_sellers.';


-- ═══════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE lojas_vendas_itens ENABLE ROW LEVEL SECURITY;

-- Service role bypass (todos os endpoints internos usam service role)
DROP POLICY IF EXISTS service_role_all ON lojas_vendas_itens;
CREATE POLICY service_role_all ON lojas_vendas_itens FOR ALL USING (true);


-- ═══════════════════════════════════════════════════════════════════════════
-- VALIDAÇÃO PÓS-CRIAÇÃO (rodar manual)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Depois da 1ª importação:
--   SELECT COUNT(*), MIN(data_venda), MAX(data_venda) FROM lojas_vendas_itens;
--   SELECT * FROM vw_lojas_top_vendas_loja_fisica LIMIT 20;
--
-- Sanity check da regra refFromSku (esses devem aparecer com REF certa):
--   SELECT sku, ref FROM lojas_vendas_itens WHERE sku LIKE '395%' LIMIT 3;  -- ref='395'
--   SELECT sku, ref FROM lojas_vendas_itens WHERE sku LIKE '376%' LIMIT 3;  -- ref='376'
--   SELECT sku, ref FROM lojas_vendas_itens WHERE sku LIKE '0020%' LIMIT 3; -- ref='0020'
--   SELECT sku, ref FROM lojas_vendas_itens WHERE sku LIKE '0050%' LIMIT 3; -- ref='0050'
