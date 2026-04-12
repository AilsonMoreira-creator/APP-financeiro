-- ═══════════════════════════════════════════════════════════
-- MIGRAÇÃO: Fix canal detection + quantidades
-- Rodar no SQL Editor do Supabase ANTES de reprocessar
-- ═══════════════════════════════════════════════════════════

-- 1. Adicionar colunas novas pra armazenar dados do Bling
ALTER TABLE bling_vendas_detalhe 
  ADD COLUMN IF NOT EXISTS loja_id BIGINT,
  ADD COLUMN IF NOT EXISTS intermediador JSONB,
  ADD COLUMN IF NOT EXISTS numero_pedido_loja TEXT;

-- 2. Recriar fn_vendas_resumo com soma de quantidades reais
-- (ANTES: contava jsonb_array_length = nº de linhas, não unidades)
CREATE OR REPLACE FUNCTION fn_vendas_resumo(p_data_inicio DATE, p_data_fim DATE)
RETURNS TABLE (
  data_pedido DATE,
  conta TEXT,
  canal_geral TEXT,
  canal_detalhe TEXT,
  pedidos BIGINT,
  bruto NUMERIC,
  frete NUMERIC,
  total_itens BIGINT
) AS $$
  SELECT
    bvd.data_pedido,
    bvd.conta,
    COALESCE(bvd.canal_geral, 'Outros') AS canal_geral,
    COALESCE(bvd.canal_detalhe, 'Outros') AS canal_detalhe,
    COUNT(*) AS pedidos,
    COALESCE(SUM(bvd.total_produtos), 0) AS bruto,
    COALESCE(SUM(GREATEST(bvd.total_pedido - bvd.total_produtos, 0)), 0) AS frete,
    COALESCE(SUM((
      SELECT SUM(COALESCE((item->>'quantidade')::INT, 1))
      FROM jsonb_array_elements(bvd.itens) AS item
    )), 0) AS total_itens
  FROM bling_vendas_detalhe bvd
  WHERE bvd.data_pedido >= p_data_inicio
    AND bvd.data_pedido <= p_data_fim
  GROUP BY bvd.data_pedido, bvd.conta, bvd.canal_geral, bvd.canal_detalhe
  ORDER BY bvd.data_pedido, bvd.conta, bvd.canal_geral;
$$ LANGUAGE sql STABLE;

-- 3. Recriar as outras RPCs (sem alteração funcional, só pra garantir)
CREATE OR REPLACE FUNCTION fn_vendas_produtos(p_data_inicio DATE, p_data_fim DATE)
RETURNS TABLE (
  data_pedido DATE,
  conta TEXT,
  canal_geral TEXT,
  ref TEXT,
  desc_limpa TEXT,
  cor TEXT,
  tamanho TEXT,
  qtd BIGINT,
  valor NUMERIC
) AS $$
  SELECT
    bvd.data_pedido,
    bvd.conta,
    COALESCE(bvd.canal_geral, 'Outros') AS canal_geral,
    item->>'ref' AS ref,
    item->>'descLimpa' AS desc_limpa,
    item->>'cor' AS cor,
    item->>'tamanho' AS tamanho,
    SUM(COALESCE((item->>'quantidade')::INT, 1)) AS qtd,
    SUM(COALESCE((item->>'valor')::NUMERIC, 0) * COALESCE((item->>'quantidade')::INT, 1)) AS valor
  FROM bling_vendas_detalhe bvd,
       jsonb_array_elements(bvd.itens) AS item
  WHERE bvd.data_pedido >= p_data_inicio
    AND bvd.data_pedido <= p_data_fim
    AND item->>'ref' IS NOT NULL
    AND item->>'ref' != ''
    AND item->>'ref' != 'SEM-REF'
  GROUP BY bvd.data_pedido, bvd.conta, bvd.canal_geral, item->>'ref', item->>'descLimpa', item->>'cor', item->>'tamanho'
  ORDER BY qtd DESC;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_vendas_total(p_data_inicio DATE, p_data_fim DATE)
RETURNS TABLE (
  total_pedidos BIGINT,
  total_bruto NUMERIC
) AS $$
  SELECT
    COUNT(*) AS total_pedidos,
    COALESCE(SUM(total_produtos), 0) AS total_bruto
  FROM bling_vendas_detalhe
  WHERE data_pedido >= p_data_inicio
    AND data_pedido <= p_data_fim;
$$ LANGUAGE sql STABLE;
