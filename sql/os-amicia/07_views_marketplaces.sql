-- OS Amicia - Sprint 4 - Views Marketplaces (parte 1 de 2)
-- Versao: 1.1 ASCII-only - Data: 21/04/2026
--
-- Idempotente: usa CREATE OR REPLACE (funcao e views).
--
-- ORDEM DE CRIACAO:
--   1. fn_calc_lucro_real(canal, custo, preco) - replica calcLucroReal do React
--   2. vw_calc_custos                          - unpivot prods[] da Calculadora
--   3. vw_calc_precos                          - unpivot prs{} da Calculadora
--   4. vw_calc_lucro_unitario                  - custo + preco + lucro
--
-- FONTE DE DADOS:
--   amicia_data(user_id=calc-meluni, payload.prods[], payload.prs{})
--
-- REGRAS DE LUCRO (fn_calc_lucro_real):
--   Fonte da verdade: src/App.tsx linhas 6189-6209
--   (CALC_PLATS + calcLucroReal hardcoded no React).



-- ============================================================================
-- 1. FUNCAO fn_calc_lucro_real(canal, custo, preco) retorna numeric
-- CALC_GERAIS do React: imposto=11 pct, custoFixo=R$5 (sempre)
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_calc_lucro_real(
  p_canal TEXT,
  p_custo NUMERIC,
  p_preco NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_imposto_pct NUMERIC := 0.11;
  v_custo_fixo_geral NUMERIC := 5.00;
  v_taxa_pct NUMERIC;
  v_fixo NUMERIC;
BEGIN
  IF p_preco IS NULL OR p_preco <= 0 OR p_custo IS NULL THEN
    RETURN NULL;
  END IF;

  v_taxa_pct := v_imposto_pct;
  v_fixo := v_custo_fixo_geral;

  IF p_canal = 'mercadolivre' THEN
    v_taxa_pct := v_taxa_pct + 0.22;
    IF p_preco <= 78.99 THEN
      v_fixo := v_fixo + 6;
    ELSE
      v_fixo := v_fixo + 16;
    END IF;

  ELSIF p_canal = 'shopee' THEN
    IF p_preco <= 79.99 THEN
      v_taxa_pct := v_taxa_pct + 0.03 + 0.20;
      v_fixo := v_fixo + 4;
    ELSIF p_preco <= 99.99 THEN
      v_taxa_pct := v_taxa_pct + 0.03 + 0.14;
      v_fixo := v_fixo + 16;
    ELSE
      v_taxa_pct := v_taxa_pct + 0.03 + 0.14;
      v_fixo := v_fixo + 20;
    END IF;

  ELSIF p_canal = 'shein' THEN
    v_taxa_pct := v_taxa_pct + 0.22;
    v_fixo := v_fixo + 6;

  ELSIF p_canal = 'tiktok' THEN
    v_taxa_pct := v_taxa_pct + 0.21;
    v_fixo := v_fixo + 4;

  ELSIF p_canal = 'meluni' THEN
    v_taxa_pct := v_taxa_pct + 0.27;
    v_fixo := v_fixo + 20;

  ELSE
    RETURN NULL;
  END IF;

  RETURN ROUND(
    (p_preco - p_preco * v_taxa_pct - v_fixo - p_custo)::NUMERIC,
    2
  );
END;
$$;



-- ============================================================================
-- 2. VIEW vw_calc_custos
-- Expande amicia_data.prods[] em tabela (ref_norm, descricao, custo_producao)
-- ============================================================================

DROP VIEW IF EXISTS vw_calc_custos CASCADE;
CREATE VIEW vw_calc_custos AS
SELECT
  NULLIF(LTRIM(prod->>'ref', '0'), '') AS ref_norm,
  prod->>'ref' AS ref_original,
  prod->>'descricao' AS descricao,
  prod->>'marca' AS marca,
  ROUND((
    COALESCE((prod->>'tecido')::NUMERIC, 0)     +
    COALESCE((prod->>'forro')::NUMERIC, 0)      +
    COALESCE((prod->>'oficina')::NUMERIC, 0)    +
    COALESCE((prod->>'passadoria')::NUMERIC, 0) +
    COALESCE((prod->>'ziper')::NUMERIC, 0)      +
    COALESCE((prod->>'botao')::NUMERIC, 0)      +
    COALESCE((prod->>'aviamentos')::NUMERIC, 0) +
    COALESCE((prod->>'modelista')::NUMERIC, 0)  +
    COALESCE((prod->>'salaCorte')::NUMERIC, 0)
  )::NUMERIC, 2) AS custo_producao
FROM amicia_data
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(payload->'prods', '[]'::jsonb)
) AS prod
WHERE user_id = 'calc-meluni'
  AND prod->>'ref' IS NOT NULL;



-- ============================================================================
-- 3. VIEW vw_calc_precos
-- Expande amicia_data.prs{} em tabela (ref_norm, canal_norm, preco_venda)
-- prs: chave-valor "ref|canal" -> preco
-- Dedup: prefere chave SEM zero a esquerda
-- ============================================================================

DROP VIEW IF EXISTS vw_calc_precos CASCADE;
CREATE VIEW vw_calc_precos AS
WITH prs_raw AS (
  SELECT
    key AS chave,
    value::text::numeric AS preco
  FROM amicia_data,
    LATERAL jsonb_each(COALESCE(payload->'prs', '{}'::jsonb))
  WHERE user_id = 'calc-meluni'
    AND value IS NOT NULL
    AND jsonb_typeof(value) = 'number'
),
split AS (
  SELECT
    NULLIF(LTRIM(split_part(chave, '|', 1), '0'), '') AS ref_norm,
    split_part(chave, '|', 1) AS ref_original,
    split_part(chave, '|', 2) AS canal_norm,
    preco,
    CASE WHEN split_part(chave, '|', 1) NOT LIKE '0%' THEN 1 ELSE 2 END AS prio
  FROM prs_raw
  WHERE chave LIKE '%|%'
)
SELECT DISTINCT ON (ref_norm, canal_norm)
  ref_norm,
  canal_norm,
  preco AS preco_venda,
  ref_original
FROM split
WHERE ref_norm IS NOT NULL
  AND canal_norm IN ('mercadolivre', 'shopee', 'shein', 'tiktok', 'meluni')
ORDER BY ref_norm, canal_norm, prio, preco DESC;



-- ============================================================================
-- 4. VIEW vw_calc_lucro_unitario
-- Junta custo + preco + funcao de lucro.
-- ============================================================================

DROP VIEW IF EXISTS vw_calc_lucro_unitario CASCADE;
CREATE VIEW vw_calc_lucro_unitario AS
SELECT
  p.ref_norm,
  p.canal_norm,
  p.preco_venda,
  c.custo_producao,
  c.descricao,
  fn_calc_lucro_real(p.canal_norm, c.custo_producao, p.preco_venda) AS lucro_peca
FROM vw_calc_precos p
LEFT JOIN vw_calc_custos c USING (ref_norm);
