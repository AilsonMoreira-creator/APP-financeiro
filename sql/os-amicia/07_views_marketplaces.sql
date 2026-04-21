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
  -- Replica parseFloat(p[k]||0) do React: trata "" como 0.
  -- NULLIF converte "" para NULL antes do cast; COALESCE finaliza em 0.
  ROUND((
    COALESCE(NULLIF(prod->>'tecido',     '')::NUMERIC, 0) +
    COALESCE(NULLIF(prod->>'forro',      '')::NUMERIC, 0) +
    COALESCE(NULLIF(prod->>'oficina',    '')::NUMERIC, 0) +
    COALESCE(NULLIF(prod->>'passadoria', '')::NUMERIC, 0) +
    COALESCE(NULLIF(prod->>'ziper',      '')::NUMERIC, 0) +
    COALESCE(NULLIF(prod->>'botao',      '')::NUMERIC, 0) +
    COALESCE(NULLIF(prod->>'aviamentos', '')::NUMERIC, 0) +
    COALESCE(NULLIF(prod->>'modelista',  '')::NUMERIC, 0) +
    COALESCE(NULLIF(prod->>'salaCorte',  '')::NUMERIC, 0)
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


-- ============================================================================
-- 5. VIEW vw_marketplaces_base (view-mae hibrida)
--
-- Consolida vendas em granularidade (ref_norm, canal_norm, conta, ano, mes):
--   - Historico (Jan/2025 a Fev/2026): amicia_data.historico_vendas.refs[].vendas
--   - Recente   (Mar/2026 em diante):  bling_vendas_detalhe.itens[]
--
-- No historico:
--   - canal granular ja no formato {canal}_{conta} (ex: mercado_exitus)
--   - tiktok nao tem breakdown de conta
--   - meluni e magalu NAO existem (so via bling_vendas_detalhe)
--
-- No detalhe recente:
--   - bling_vendas_detalhe.canal_geral ja normalizado
--   - conta vem direto da coluna conta (lowercase: exitus/lumia/muniam)
--   - itens expandido via jsonb_array_elements: (ref, quantidade)
--
-- NAO inclui valor/receita aqui - apenas unidades. Views downstream
-- calculam receita cruzando com vw_calc_precos ou total_produtos do Bling.
-- ============================================================================

DROP VIEW IF EXISTS vw_marketplaces_base CASCADE;
CREATE VIEW vw_marketplaces_base AS
WITH historico_raw AS (
  SELECT
    (refkey) AS ref_chave,
    mes_data.key AS ano_mes,
    canal_data.key AS canal_granular,
    (canal_data.value)::text::int AS unidades
  FROM amicia_data,
    LATERAL jsonb_each(COALESCE(payload->'refs', '{}'::jsonb)) AS refs_kv(refkey, refval),
    LATERAL jsonb_each(COALESCE(refval->'vendas', '{}'::jsonb)) AS mes_data,
    LATERAL jsonb_each(COALESCE(mes_data.value, '{}'::jsonb)) AS canal_data
  WHERE user_id = 'historico_vendas'
    AND jsonb_typeof(canal_data.value) = 'number'
    AND (canal_data.value)::text::int > 0
),
historico_norm AS (
  SELECT
    NULLIF(LTRIM(ref_chave, '0'), '') AS ref_norm,
    CASE
      WHEN canal_granular LIKE 'mercado_%' THEN 'mercadolivre'
      WHEN canal_granular LIKE 'shein_%'   THEN 'shein'
      WHEN canal_granular LIKE 'shopee_%'  THEN 'shopee'
      WHEN canal_granular = 'tiktok'       THEN 'tiktok'
      ELSE 'outros'
    END AS canal_norm,
    CASE
      WHEN canal_granular LIKE '%_exitus' THEN 'exitus'
      WHEN canal_granular LIKE '%_lumia'  THEN 'lumia'
      WHEN canal_granular LIKE '%_muniam' THEN 'muniam'
      ELSE NULL
    END AS conta,
    SPLIT_PART(ano_mes, '-', 1)::int AS ano,
    SPLIT_PART(ano_mes, '-', 2)::int AS mes,
    (SPLIT_PART(ano_mes, '-', 1) || '-' || SPLIT_PART(ano_mes, '-', 2) || '-01')::date AS data_ref,
    unidades,
    'historico'::text AS fonte
  FROM historico_raw
  WHERE (SPLIT_PART(ano_mes, '-', 1) || '-' || SPLIT_PART(ano_mes, '-', 2) || '-01')::date < '2026-03-01'
),
recente_raw AS (
  SELECT
    bvd.data_pedido,
    LOWER(TRIM(bvd.conta)) AS conta,
    CASE
      WHEN bvd.canal_geral ILIKE '%mercado%livre%' THEN 'mercadolivre'
      WHEN bvd.canal_geral ILIKE 'shein%'          THEN 'shein'
      WHEN bvd.canal_geral ILIKE 'shopee%'         THEN 'shopee'
      WHEN bvd.canal_geral ILIKE 'tiktok%'         THEN 'tiktok'
      WHEN bvd.canal_geral ILIKE 'meluni%'         THEN 'meluni'
      ELSE 'outros'
    END AS canal_norm,
    NULLIF(LTRIM(item->>'ref', '0'), '') AS ref_norm,
    COALESCE(NULLIF(item->>'quantidade', '')::int, 0) AS unidades
  FROM bling_vendas_detalhe bvd
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bvd.itens, '[]'::jsonb)) AS item
  WHERE bvd.data_pedido >= '2026-03-01'
    AND item->>'ref' IS NOT NULL
),
recente_norm AS (
  SELECT
    ref_norm,
    canal_norm,
    conta,
    EXTRACT(YEAR FROM data_pedido)::int AS ano,
    EXTRACT(MONTH FROM data_pedido)::int AS mes,
    DATE_TRUNC('month', data_pedido)::date AS data_ref,
    SUM(unidades) AS unidades,
    'recente'::text AS fonte
  FROM recente_raw
  WHERE unidades > 0
    AND ref_norm IS NOT NULL
  GROUP BY ref_norm, canal_norm, conta, ano, mes, data_ref
)
SELECT ref_norm, canal_norm, conta, ano, mes, data_ref, unidades, fonte
FROM historico_norm
WHERE ref_norm IS NOT NULL
UNION ALL
SELECT ref_norm, canal_norm, conta, ano, mes, data_ref, unidades, fonte
FROM recente_norm;



-- ============================================================================
-- 6. VIEW vw_lucro_marketplace_mes (Card 1 admin-only)
--
-- Lucro liquido do mes corrente por canal.
-- Formula: Sum(unidades_mes_ref_canal * lucro_peca) * (1 - devolucao_global)
-- devolucao_global = 10 pct (hardcoded por ora).
--
-- Usa ate o ULTIMO DIA dos dados em bling_vendas_detalhe (mes em progresso).
-- Nao usa media diaria projetada - apenas realizado ate agora.
-- ============================================================================

DROP VIEW IF EXISTS vw_lucro_marketplace_mes CASCADE;
CREATE VIEW vw_lucro_marketplace_mes AS
WITH vendas_mes_atual AS (
  SELECT
    LOWER(TRIM(bvd.conta)) AS conta,
    CASE
      WHEN bvd.canal_geral ILIKE '%mercado%livre%' THEN 'mercadolivre'
      WHEN bvd.canal_geral ILIKE 'shein%'          THEN 'shein'
      WHEN bvd.canal_geral ILIKE 'shopee%'         THEN 'shopee'
      WHEN bvd.canal_geral ILIKE 'tiktok%'         THEN 'tiktok'
      WHEN bvd.canal_geral ILIKE 'meluni%'         THEN 'meluni'
      ELSE 'outros'
    END AS canal_norm,
    NULLIF(LTRIM(item->>'ref', '0'), '') AS ref_norm,
    COALESCE(NULLIF(item->>'quantidade', '')::int, 0) AS unidades,
    COALESCE(NULLIF(item->>'valor', '')::numeric, 0) *
      COALESCE(NULLIF(item->>'quantidade', '')::int, 0) AS receita_item
  FROM bling_vendas_detalhe bvd
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bvd.itens, '[]'::jsonb)) AS item
  WHERE bvd.data_pedido >= DATE_TRUNC('month', CURRENT_DATE)
    AND bvd.data_pedido < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
    AND item->>'ref' IS NOT NULL
),
agg_canal AS (
  SELECT
    v.canal_norm,
    SUM(v.unidades) AS unidades_canal,
    SUM(v.receita_item) AS receita_bruta_canal,
    SUM(v.unidades * COALESCE(lu.lucro_peca, 0)) AS lucro_bruto_canal
  FROM vendas_mes_atual v
  LEFT JOIN vw_calc_lucro_unitario lu
    ON lu.ref_norm = v.ref_norm AND lu.canal_norm = v.canal_norm
  GROUP BY v.canal_norm
)
SELECT
  canal_norm,
  unidades_canal,
  ROUND(receita_bruta_canal, 2) AS receita_bruta_canal,
  ROUND(lucro_bruto_canal, 2) AS lucro_bruto_canal,
  ROUND(lucro_bruto_canal * 0.90, 2) AS lucro_liquido_canal
FROM agg_canal;



-- ============================================================================
-- 7. VIEW vw_vendas_mensais_24m (Card 2)
--
-- Serie temporal dos ultimos 24 meses a partir do mes atual.
-- Agrega vw_marketplaces_base por (ano, mes) ignorando conta e canal.
-- Retorna com data_ref como primeiro dia do mes para facilitar chart.
-- ============================================================================

DROP VIEW IF EXISTS vw_vendas_mensais_24m CASCADE;
CREATE VIEW vw_vendas_mensais_24m AS
WITH limite AS (
  SELECT DATE_TRUNC('month', CURRENT_DATE)::date AS mes_atual,
         (DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '23 months')::date AS mes_inicio
)
SELECT
  b.ano,
  b.mes,
  b.data_ref,
  SUM(b.unidades) AS unidades_total,
  SUM(CASE WHEN b.canal_norm = 'mercadolivre' THEN b.unidades ELSE 0 END) AS u_ml,
  SUM(CASE WHEN b.canal_norm = 'shein'        THEN b.unidades ELSE 0 END) AS u_shein,
  SUM(CASE WHEN b.canal_norm = 'shopee'       THEN b.unidades ELSE 0 END) AS u_shopee,
  SUM(CASE WHEN b.canal_norm = 'tiktok'       THEN b.unidades ELSE 0 END) AS u_tiktok,
  SUM(CASE WHEN b.canal_norm = 'meluni'       THEN b.unidades ELSE 0 END) AS u_meluni,
  SUM(CASE WHEN b.canal_norm = 'outros'       THEN b.unidades ELSE 0 END) AS u_outros
FROM vw_marketplaces_base b, limite l
WHERE b.data_ref >= l.mes_inicio
  AND b.data_ref <= l.mes_atual
GROUP BY b.ano, b.mes, b.data_ref
ORDER BY b.data_ref;



-- ============================================================================
-- 8. VIEW vw_canais_comparativo (Card 3)
--
-- Compara performance por canal em duas janelas curtas:
--   7v7:  ultimos 7 dias vs 7 dias anteriores
--   30v30: ultimos 30 dias vs 30 dias anteriores
--
-- Fonte: apenas bling_vendas_detalhe (janelas cabem nos 45d de cache).
-- Nao usa vw_marketplaces_base pois precisa granularidade diaria.
-- ============================================================================

DROP VIEW IF EXISTS vw_canais_comparativo CASCADE;
CREATE VIEW vw_canais_comparativo AS
WITH periodos AS (
  SELECT
    CURRENT_DATE AS hoje,
    CURRENT_DATE - INTERVAL '7 days'  AS d7,
    CURRENT_DATE - INTERVAL '14 days' AS d14,
    CURRENT_DATE - INTERVAL '30 days' AS d30,
    CURRENT_DATE - INTERVAL '60 days' AS d60
),
vendas AS (
  SELECT
    bvd.data_pedido,
    CASE
      WHEN bvd.canal_geral ILIKE '%mercado%livre%' THEN 'mercadolivre'
      WHEN bvd.canal_geral ILIKE 'shein%'          THEN 'shein'
      WHEN bvd.canal_geral ILIKE 'shopee%'         THEN 'shopee'
      WHEN bvd.canal_geral ILIKE 'tiktok%'         THEN 'tiktok'
      WHEN bvd.canal_geral ILIKE 'meluni%'         THEN 'meluni'
      ELSE 'outros'
    END AS canal_norm,
    COALESCE(NULLIF(item->>'quantidade', '')::int, 0) AS unidades
  FROM bling_vendas_detalhe bvd
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bvd.itens, '[]'::jsonb)) AS item
  WHERE bvd.data_pedido >= CURRENT_DATE - INTERVAL '60 days'
)
SELECT
  v.canal_norm,
  SUM(CASE WHEN v.data_pedido >  p.d7               THEN v.unidades ELSE 0 END) AS u_ult7,
  SUM(CASE WHEN v.data_pedido <= p.d7  AND v.data_pedido > p.d14 THEN v.unidades ELSE 0 END) AS u_ant7,
  SUM(CASE WHEN v.data_pedido >  p.d30              THEN v.unidades ELSE 0 END) AS u_ult30,
  SUM(CASE WHEN v.data_pedido <= p.d30 AND v.data_pedido > p.d60 THEN v.unidades ELSE 0 END) AS u_ant30,
  ROUND(
    CASE
      WHEN SUM(CASE WHEN v.data_pedido <= p.d7 AND v.data_pedido > p.d14 THEN v.unidades ELSE 0 END) > 0
      THEN 100.0 * (
        SUM(CASE WHEN v.data_pedido > p.d7 THEN v.unidades ELSE 0 END)::numeric
        -
        SUM(CASE WHEN v.data_pedido <= p.d7 AND v.data_pedido > p.d14 THEN v.unidades ELSE 0 END)::numeric
      ) / NULLIF(SUM(CASE WHEN v.data_pedido <= p.d7 AND v.data_pedido > p.d14 THEN v.unidades ELSE 0 END), 0)
      ELSE NULL
    END, 1
  ) AS var_7v7_pct,
  ROUND(
    CASE
      WHEN SUM(CASE WHEN v.data_pedido <= p.d30 AND v.data_pedido > p.d60 THEN v.unidades ELSE 0 END) > 0
      THEN 100.0 * (
        SUM(CASE WHEN v.data_pedido > p.d30 THEN v.unidades ELSE 0 END)::numeric
        -
        SUM(CASE WHEN v.data_pedido <= p.d30 AND v.data_pedido > p.d60 THEN v.unidades ELSE 0 END)::numeric
      ) / NULLIF(SUM(CASE WHEN v.data_pedido <= p.d30 AND v.data_pedido > p.d60 THEN v.unidades ELSE 0 END), 0)
      ELSE NULL
    END, 1
  ) AS var_30v30_pct
FROM vendas v
CROSS JOIN periodos p
GROUP BY v.canal_norm, p.d7, p.d14, p.d30, p.d60
ORDER BY u_ult30 DESC;



-- ============================================================================
-- 9. VIEW vw_contas_bling_7v7 (Card 4)
--
-- Performance por conta Bling (Exitus/Lumia/Muniam) em janela 7v7.
-- So bling_vendas_detalhe. Usa total_pedido como proxy de receita.
-- ============================================================================

DROP VIEW IF EXISTS vw_contas_bling_7v7 CASCADE;
CREATE VIEW vw_contas_bling_7v7 AS
WITH p AS (
  SELECT
    CURRENT_DATE - INTERVAL '7 days'  AS d7,
    CURRENT_DATE - INTERVAL '14 days' AS d14
)
SELECT
  LOWER(TRIM(bvd.conta)) AS conta,
  COUNT(*) FILTER (WHERE bvd.data_pedido >  p.d7) AS pedidos_ult7,
  COUNT(*) FILTER (WHERE bvd.data_pedido <= p.d7 AND bvd.data_pedido > p.d14) AS pedidos_ant7,
  ROUND(SUM(bvd.total_pedido) FILTER (WHERE bvd.data_pedido >  p.d7), 2) AS receita_ult7,
  ROUND(SUM(bvd.total_pedido) FILTER (WHERE bvd.data_pedido <= p.d7 AND bvd.data_pedido > p.d14), 2) AS receita_ant7,
  ROUND(
    CASE
      WHEN COUNT(*) FILTER (WHERE bvd.data_pedido <= p.d7 AND bvd.data_pedido > p.d14) > 0
      THEN 100.0 * (
        COUNT(*) FILTER (WHERE bvd.data_pedido > p.d7)::numeric
        -
        COUNT(*) FILTER (WHERE bvd.data_pedido <= p.d7 AND bvd.data_pedido > p.d14)::numeric
      ) / NULLIF(COUNT(*) FILTER (WHERE bvd.data_pedido <= p.d7 AND bvd.data_pedido > p.d14), 0)
      ELSE NULL
    END, 1
  ) AS var_pedidos_7v7_pct
FROM bling_vendas_detalhe bvd
CROSS JOIN p
WHERE bvd.conta IS NOT NULL
  AND LOWER(TRIM(bvd.conta)) IN ('exitus', 'lumia', 'muniam')
  AND bvd.data_pedido >= CURRENT_DATE - INTERVAL '14 days'
GROUP BY LOWER(TRIM(bvd.conta)), p.d7, p.d14
ORDER BY receita_ult7 DESC NULLS LAST;



-- ============================================================================
-- 10. VIEW vw_contas_bling_concentracao_queda (Card 4 detalhe)
--
-- Top refs em queda por conta (ult7 vs ant7).
-- Retorna (conta, ref, u_ult7, u_ant7, delta). App filtra top 5 por conta.
-- ============================================================================

DROP VIEW IF EXISTS vw_contas_bling_concentracao_queda CASCADE;
CREATE VIEW vw_contas_bling_concentracao_queda AS
WITH p AS (
  SELECT
    CURRENT_DATE - INTERVAL '7 days'  AS d7,
    CURRENT_DATE - INTERVAL '14 days' AS d14
),
vendas_ref_conta AS (
  SELECT
    LOWER(TRIM(bvd.conta)) AS conta,
    NULLIF(LTRIM(item->>'ref', '0'), '') AS ref_norm,
    COALESCE(NULLIF(item->>'quantidade', '')::int, 0) AS unidades,
    bvd.data_pedido
  FROM bling_vendas_detalhe bvd
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bvd.itens, '[]'::jsonb)) AS item
  WHERE LOWER(TRIM(bvd.conta)) IN ('exitus', 'lumia', 'muniam')
    AND bvd.data_pedido >= CURRENT_DATE - INTERVAL '14 days'
    AND item->>'ref' IS NOT NULL
)
SELECT
  v.conta,
  v.ref_norm,
  SUM(CASE WHEN v.data_pedido >  p.d7                              THEN v.unidades ELSE 0 END) AS u_ult7,
  SUM(CASE WHEN v.data_pedido <= p.d7 AND v.data_pedido > p.d14    THEN v.unidades ELSE 0 END) AS u_ant7,
  SUM(CASE WHEN v.data_pedido >  p.d7                              THEN v.unidades ELSE 0 END)
  -
  SUM(CASE WHEN v.data_pedido <= p.d7 AND v.data_pedido > p.d14    THEN v.unidades ELSE 0 END) AS delta
FROM vendas_ref_conta v
CROSS JOIN p
WHERE v.ref_norm IS NOT NULL
GROUP BY v.conta, v.ref_norm
HAVING (
  SUM(CASE WHEN v.data_pedido <= (CURRENT_DATE - INTERVAL '7 days')
            AND v.data_pedido > (CURRENT_DATE - INTERVAL '14 days') THEN v.unidades ELSE 0 END)
  >
  SUM(CASE WHEN v.data_pedido > (CURRENT_DATE - INTERVAL '7 days')  THEN v.unidades ELSE 0 END)
)
ORDER BY v.conta, delta ASC;



-- ============================================================================
-- 11. VIEW vw_top_movers_unificado (Card 5 camada 1)
--
-- Refs com maior variacao absoluta ult7 vs ant7, somando todas contas/canais.
-- Filtro de significancia: u_ult7 + u_ant7 >= 5 (evita ruido de refs minusculas).
-- ============================================================================

DROP VIEW IF EXISTS vw_top_movers_unificado CASCADE;
CREATE VIEW vw_top_movers_unificado AS
WITH p AS (
  SELECT
    CURRENT_DATE - INTERVAL '7 days'  AS d7,
    CURRENT_DATE - INTERVAL '14 days' AS d14
),
vendas_ref AS (
  SELECT
    NULLIF(LTRIM(item->>'ref', '0'), '') AS ref_norm,
    COALESCE(NULLIF(item->>'quantidade', '')::int, 0) AS unidades,
    bvd.data_pedido
  FROM bling_vendas_detalhe bvd
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bvd.itens, '[]'::jsonb)) AS item
  WHERE bvd.data_pedido >= CURRENT_DATE - INTERVAL '14 days'
    AND item->>'ref' IS NOT NULL
),
agg AS (
  SELECT
    v.ref_norm,
    SUM(CASE WHEN v.data_pedido >  p.d7                           THEN v.unidades ELSE 0 END) AS u_ult7,
    SUM(CASE WHEN v.data_pedido <= p.d7 AND v.data_pedido > p.d14 THEN v.unidades ELSE 0 END) AS u_ant7
  FROM vendas_ref v CROSS JOIN p
  WHERE v.ref_norm IS NOT NULL
  GROUP BY v.ref_norm
)
SELECT
  a.ref_norm,
  c.descricao,
  a.u_ult7,
  a.u_ant7,
  a.u_ult7 - a.u_ant7 AS delta,
  ROUND(
    CASE WHEN a.u_ant7 > 0 THEN 100.0 * (a.u_ult7 - a.u_ant7)::numeric / a.u_ant7
         ELSE NULL END, 1
  ) AS var_pct
FROM agg a
LEFT JOIN vw_calc_custos c USING (ref_norm)
WHERE a.u_ult7 + a.u_ant7 >= 5
ORDER BY ABS(a.u_ult7 - a.u_ant7) DESC;



-- ============================================================================
-- 12. VIEW vw_top_movers_por_conta (Card 5 camada 2)
--
-- Igual vw_top_movers_unificado mas com breakdown por conta.
-- Filtro de significancia mais leve: u_ult7 + u_ant7 >= 3 por conta.
-- ============================================================================

DROP VIEW IF EXISTS vw_top_movers_por_conta CASCADE;
CREATE VIEW vw_top_movers_por_conta AS
WITH p AS (
  SELECT
    CURRENT_DATE - INTERVAL '7 days'  AS d7,
    CURRENT_DATE - INTERVAL '14 days' AS d14
),
vendas_ref_conta AS (
  SELECT
    LOWER(TRIM(bvd.conta)) AS conta,
    NULLIF(LTRIM(item->>'ref', '0'), '') AS ref_norm,
    COALESCE(NULLIF(item->>'quantidade', '')::int, 0) AS unidades,
    bvd.data_pedido
  FROM bling_vendas_detalhe bvd
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bvd.itens, '[]'::jsonb)) AS item
  WHERE LOWER(TRIM(bvd.conta)) IN ('exitus', 'lumia', 'muniam')
    AND bvd.data_pedido >= CURRENT_DATE - INTERVAL '14 days'
    AND item->>'ref' IS NOT NULL
),
agg AS (
  SELECT
    v.conta,
    v.ref_norm,
    SUM(CASE WHEN v.data_pedido >  p.d7                           THEN v.unidades ELSE 0 END) AS u_ult7,
    SUM(CASE WHEN v.data_pedido <= p.d7 AND v.data_pedido > p.d14 THEN v.unidades ELSE 0 END) AS u_ant7
  FROM vendas_ref_conta v CROSS JOIN p
  WHERE v.ref_norm IS NOT NULL
  GROUP BY v.conta, v.ref_norm
)
SELECT
  a.conta,
  a.ref_norm,
  a.u_ult7,
  a.u_ant7,
  a.u_ult7 - a.u_ant7 AS delta,
  ROUND(
    CASE WHEN a.u_ant7 > 0 THEN 100.0 * (a.u_ult7 - a.u_ant7)::numeric / a.u_ant7
         ELSE NULL END, 1
  ) AS var_pct
FROM agg a
WHERE a.u_ult7 + a.u_ant7 >= 3
ORDER BY a.conta, ABS(a.u_ult7 - a.u_ant7) DESC;



-- ============================================================================
-- 13. VIEW vw_top_movers_cruzamento (Card 5 camada 3)
--
-- Refs que aparecem em >=2 contas com variacoes divergentes.
-- Ex: ref subindo +50 pct em Exitus mas caindo -30 pct em Lumia.
-- App filtra onde max(var_pct) - min(var_pct) > 40 pontos.
-- ============================================================================

DROP VIEW IF EXISTS vw_top_movers_cruzamento CASCADE;
CREATE VIEW vw_top_movers_cruzamento AS
SELECT
  ref_norm,
  MAX(CASE WHEN conta = 'exitus' THEN var_pct END) AS var_exitus,
  MAX(CASE WHEN conta = 'lumia'  THEN var_pct END) AS var_lumia,
  MAX(CASE WHEN conta = 'muniam' THEN var_pct END) AS var_muniam,
  MAX(CASE WHEN conta = 'exitus' THEN u_ult7 END)  AS u7_exitus,
  MAX(CASE WHEN conta = 'lumia'  THEN u_ult7 END)  AS u7_lumia,
  MAX(CASE WHEN conta = 'muniam' THEN u_ult7 END)  AS u7_muniam,
  COUNT(DISTINCT conta) AS n_contas,
  MAX(var_pct) - MIN(var_pct) AS spread_var_pct
FROM vw_top_movers_por_conta
WHERE var_pct IS NOT NULL
GROUP BY ref_norm
HAVING COUNT(DISTINCT conta) >= 2
   AND MAX(var_pct) - MIN(var_pct) >= 40
ORDER BY spread_var_pct DESC;



-- ============================================================================
-- 14. VIEW vw_margem_por_produto_canal (Card 6)
--
-- Classifica lucro_peca em 5 faixas (regra hardcoded no React: CALC_LMIN=10,
-- CALC_LBOM=14; faixa de alerta vermelha abaixo de 8).
-- ============================================================================

DROP VIEW IF EXISTS vw_margem_por_produto_canal CASCADE;
CREATE VIEW vw_margem_por_produto_canal AS
SELECT
  ref_norm,
  descricao,
  canal_norm,
  preco_venda,
  custo_producao,
  lucro_peca,
  CASE
    WHEN lucro_peca IS NULL     THEN 'sem_dados'
    WHEN lucro_peca < 0         THEN 'urgencia_maxima'
    WHEN lucro_peca < 8         THEN 'critico'
    WHEN lucro_peca < 10        THEN 'atencao'
    WHEN lucro_peca < 14        THEN 'bom'
    ELSE                             'otimo'
  END AS faixa
FROM vw_calc_lucro_unitario;



-- ============================================================================
-- 15. VIEW vw_plano_ajuste_gradual (Card 6)
--
-- Para refs em faixas criticas/atencao, calcula preco sugerido pra atingir:
--   - lucro R$ 10 (minimo aceitavel)
--   - lucro R$ 14 (lucro bom)
--
-- Formula reversa de fn_calc_lucro_real (isolando preco).
-- Por simplificacao usa linearizacao por faixa do Shopee/ML.
-- ============================================================================

DROP VIEW IF EXISTS vw_plano_ajuste_gradual CASCADE;
CREATE VIEW vw_plano_ajuste_gradual AS
WITH base AS (
  SELECT
    ref_norm,
    descricao,
    canal_norm,
    preco_venda,
    custo_producao,
    lucro_peca,
    -- Inverso de fn_calc_lucro_real pra cada canal/faixa.
    -- preco = (lucro_alvo + custo_fixo + frete + custo) / (1 - taxa_pct)
    -- taxa_pct e fixo dependem do canal (e da faixa no Shopee).
    -- Aproximacao: usa a mesma faixa do preco_venda atual.
    CASE canal_norm
      WHEN 'mercadolivre' THEN
        CASE WHEN preco_venda <= 78.99 THEN 6 ELSE 16 END
      WHEN 'shopee' THEN
        CASE
          WHEN preco_venda <= 79.99 THEN 4
          WHEN preco_venda <= 99.99 THEN 16
          ELSE 20
        END
      WHEN 'shein'  THEN 6
      WHEN 'tiktok' THEN 4
      WHEN 'meluni' THEN 20
      ELSE 0
    END AS fixo_canal,
    CASE canal_norm
      WHEN 'mercadolivre' THEN 0.22
      WHEN 'shopee' THEN
        CASE
          WHEN preco_venda <= 79.99 THEN 0.03 + 0.20
          ELSE 0.03 + 0.14
        END
      WHEN 'shein'  THEN 0.22
      WHEN 'tiktok' THEN 0.21
      WHEN 'meluni' THEN 0.27
      ELSE 0
    END AS pct_canal
  FROM vw_calc_lucro_unitario
  WHERE canal_norm IN ('mercadolivre', 'shopee', 'shein', 'tiktok', 'meluni')
)
SELECT
  ref_norm,
  descricao,
  canal_norm,
  preco_venda,
  custo_producao,
  lucro_peca,
  ROUND(
    (10 + 5 + fixo_canal + custo_producao) / NULLIF(1 - (0.11 + pct_canal), 0),
    2
  ) AS preco_sugerido_lucro_10,
  ROUND(
    (14 + 5 + fixo_canal + custo_producao) / NULLIF(1 - (0.11 + pct_canal), 0),
    2
  ) AS preco_sugerido_lucro_14,
  ROUND(
    ((10 + 5 + fixo_canal + custo_producao) / NULLIF(1 - (0.11 + pct_canal), 0))
    - preco_venda,
    2
  ) AS ajuste_para_lucro_10,
  ROUND(
    ((14 + 5 + fixo_canal + custo_producao) / NULLIF(1 - (0.11 + pct_canal), 0))
    - preco_venda,
    2
  ) AS ajuste_para_lucro_14
FROM base
WHERE lucro_peca IS NOT NULL
  AND lucro_peca < 14
ORDER BY lucro_peca ASC;



-- ============================================================================
-- 16. VIEW vw_oportunidades_margem (Card 7)
--
-- Cruza refs com margem BOA ou OTIMA (>=10) + venda baixa (<10 pecas em 30d).
-- Ideia: refs lucrativas que estao vendendo pouco = investir em trafego/ads.
-- ============================================================================

DROP VIEW IF EXISTS vw_oportunidades_margem CASCADE;
CREATE VIEW vw_oportunidades_margem AS
WITH vendas_30d AS (
  SELECT
    NULLIF(LTRIM(item->>'ref', '0'), '') AS ref_norm,
    CASE
      WHEN bvd.canal_geral ILIKE '%mercado%livre%' THEN 'mercadolivre'
      WHEN bvd.canal_geral ILIKE 'shein%'          THEN 'shein'
      WHEN bvd.canal_geral ILIKE 'shopee%'         THEN 'shopee'
      WHEN bvd.canal_geral ILIKE 'tiktok%'         THEN 'tiktok'
      WHEN bvd.canal_geral ILIKE 'meluni%'         THEN 'meluni'
      ELSE 'outros'
    END AS canal_norm,
    COALESCE(NULLIF(item->>'quantidade', '')::int, 0) AS unidades
  FROM bling_vendas_detalhe bvd
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bvd.itens, '[]'::jsonb)) AS item
  WHERE bvd.data_pedido >= CURRENT_DATE - INTERVAL '30 days'
    AND item->>'ref' IS NOT NULL
),
agg_vendas AS (
  SELECT ref_norm, canal_norm, SUM(unidades) AS u_30d
  FROM vendas_30d
  WHERE ref_norm IS NOT NULL
  GROUP BY ref_norm, canal_norm
)
SELECT
  m.ref_norm,
  m.descricao,
  m.canal_norm,
  m.preco_venda,
  m.lucro_peca,
  m.faixa,
  COALESCE(v.u_30d, 0) AS unidades_30d,
  m.lucro_peca * COALESCE(v.u_30d, 0) AS lucro_acumulado_30d
FROM vw_margem_por_produto_canal m
LEFT JOIN agg_vendas v USING (ref_norm, canal_norm)
WHERE m.faixa IN ('bom', 'otimo')
  AND COALESCE(v.u_30d, 0) < 10
ORDER BY m.lucro_peca DESC, unidades_30d ASC;
