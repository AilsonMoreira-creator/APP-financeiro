-- OS Amícia · Sprint 4 · Views Marketplaces (13 views + 1 função aux)
-- Versão: 1.0 · Data: 21/04/2026
--
-- RODAR DEPOIS de 01_tables.sql + 02_seed_ia_config.sql + 05_views_corte.sql.
-- Idempotente: usa CREATE OR REPLACE (função e views).
--
-- ORDEM DE CRIAÇÃO (dependências importam):
--   1. fn_calc_lucro_real(canal, custo, preco)  → replica calcLucroReal do React
--   2. vw_calc_custos                           → unpivot prods[] da Calculadora
--   3. vw_calc_precos                           → unpivot prs{} da Calculadora
--   4. vw_marketplaces_base                     → híbrida: historico_vendas + bling_vendas_detalhe
--   5. vw_lucro_marketplace_mes                 → Card 1 · admin-only
--   6. vw_vendas_mensais_24m                    → Card 2
--   7. vw_canais_comparativo                    → Card 3
--   8. vw_contas_bling_7v7                      → Card 4
--   9. vw_contas_bling_concentracao_queda       → Card 4 (detalhe)
--  10. vw_top_movers_unificado                  → Card 5 · camada 1
--  11. vw_top_movers_por_conta                  → Card 5 · camada 2
--  12. vw_top_movers_cruzamento                 → Card 5 · camada 3
--  13. vw_margem_por_produto_canal              → Card 6
--  14. vw_plano_ajuste_gradual                  → Card 6
--  15. vw_oportunidades_margem                  → Card 7
--  16. vw_historico_ajustes_precos              → Card 6 (regra 30d)
--
-- FONTES DE DADOS (schema real descoberto no Passo 0):
--   - amicia_data(user_id='calc-meluni', payload.prods[], payload.prs{})
--       Calculadora: custos de produção + preço de venda por canal
--       prods: [{ref, descricao, tecido, forro, oficina, ziper, botao,
--               passadoria, modelista, salaCorte, aviamentos, foto, marca}]
--       prs:   {"{ref}|{canal}": preco_venda} · canais:
--              shein | shopee | meluni | tiktok | mercadolivre
--   - amicia_data(user_id='historico_vendas', payload.refs.{refKey}.vendas{YYYY-MM}{canal_granular})
--       Histórico Jan/2025 → Fev/2026 · granularidade ref×mês×canal_conta
--       canais granulares: tiktok | shein_{conta} | shopee_{conta} | mercado_{conta}
--       (contas: exitus, lumia, muniam)
--   - bling_vendas_detalhe (tabela, cache 45d, cron a cada 10min)
--       Colunas: id, conta, pedido_id, data_pedido, canal_geral, canal_detalhe,
--                total_produtos, total_pedido, itens(jsonb), loja_id, ...
--       canal_geral: Mercado Livre | Shein | Shopee | TikTok Shop | Meluni | ...
--
-- NORMALIZAÇÃO DE REF:
--   LTRIM(ref, '0') em TODAS as junções. O app grava tanto "2277" quanto "02277"
--   em prs (duplicatas). Views pegam por LTRIM, em caso de conflito no mesmo
--   canal preferem a chave SEM zero (convenção canônica do app React).
--
-- NORMALIZAÇÃO DE CANAL:
--   Dimensão unificada `canal_norm` com 5 valores canônicos:
--     mercadolivre | shopee | shein | tiktok | meluni
--   (mesmos tokens que a chave de prs do Calculadora)
--   Mapeamento:
--     historico_vendas.{canal_granular}: prefix antes de "_" (mercado→mercadolivre)
--     bling_vendas_detalhe.canal_geral:  normaliza string
--
-- REGRAS DE LUCRO (fn_calc_lucro_real):
--   Fonte da verdade: src/App.tsx linhas 6189-6209 (CALC_PLATS + calcLucroReal)
--   Atualização dessas constantes exige mudança no React E aqui, em paralelo.
--
-- LEITURA DE ia_config:
--   - devolucao_global_pct (default 0.10 se não existir)
--   - marketplaces_janela_short_dias (default 7)
--   - marketplaces_janela_long_dias (default 30)
--   - marketplaces_min_unidades_significancia (default 5)
--
-- VIGILÂNCIA DE CONFIANÇA:
--   historico_vendas._meta.observacoes documenta que Nov/2025 e Ago/2025 foram
--   extrapolados com fator 0.85. Views históricas NÃO forçam precisão nesses
--   meses (usa dado como está) mas a função orquestradora (08_fn_*) deve
--   sinalizar essa confiança ao Claude via campo `confianca='media_meses_extrapolados'`.



-- ────────────────────────────────────────────────────────────────────────────
-- 1 · FUNÇÃO fn_calc_lucro_real(canal, custo, preco) → numeric
--
-- Réplica SQL de calcLucroReal do App.tsx (linha 6209).
-- Dado um canal, o custo de produção e o preço de venda praticado, devolve
-- o lucro líquido por peça (após impostos, comissões, frete e custo fixo).
-- Retorna NULL se canal desconhecido ou preço inválido.
--
-- CALC_GERAIS do React: imposto=11%, custoFixo=R$5 (sempre)
-- Regras por canal: ver comentários inline.
-- ────────────────────────────────────────────────────────────────────────────

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
    -- Comissão 14% + Ads 6% + Descontos 2% = 22% pct
    -- Frete: R$6 até R$78,99 | R$16 acima
    v_taxa_pct := v_taxa_pct + 0.22;
    IF p_preco <= 78.99 THEN
      v_fixo := v_fixo + 6;
    ELSE
      v_fixo := v_fixo + 16;
    END IF;

  ELSIF p_canal = 'shopee' THEN
    -- Afiliados 3% + faixa:
    --   até R$79,99  → 20% pct + R$4  fixo
    --   até R$99,99  → 14% pct + R$16 fixo
    --   até R$139    → 14% pct + R$20 fixo (aplicável também p/ preço > R$139)
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
    -- Comissão 20% + Descontos 2% = 22% pct | Frete R$6 fixo
    v_taxa_pct := v_taxa_pct + 0.22;
    v_fixo := v_fixo + 6;

  ELSIF p_canal = 'tiktok' THEN
    -- Comissão 14% + Afiliados 7% = 21% pct | Frete R$4 fixo
    v_taxa_pct := v_taxa_pct + 0.21;
    v_fixo := v_fixo + 4;

  ELSIF p_canal = 'meluni' THEN
    -- Cartão 8% + Converter 2% + Propaganda 10% + Cupons 7% = 27% pct
    -- Frete R$15 + Plataforma R$5 = R$20 fixo
    v_taxa_pct := v_taxa_pct + 0.27;
    v_fixo := v_fixo + 20;

  ELSE
    RETURN NULL;  -- canal desconhecido
  END IF;

  RETURN ROUND(
    (p_preco - p_preco * v_taxa_pct - v_fixo - p_custo)::NUMERIC,
    2
  );
END;
$$;

COMMENT ON FUNCTION fn_calc_lucro_real(TEXT, NUMERIC, NUMERIC) IS
  'Replica calcLucroReal do App.tsx · canais: mercadolivre|shopee|shein|tiktok|meluni · fonte da verdade: CALC_PLATS no React';



-- ────────────────────────────────────────────────────────────────────────────
-- 2 · VIEW vw_calc_custos
--
-- Expande o array amicia_data.prods em tabela (ref_norm, descricao, custo).
-- custo = soma dos 9 campos de custo de produção (CALC_CK do React).
--
-- Normalização: ref_norm = LTRIM(ref, '0') — garante join com outras fontes.
-- ────────────────────────────────────────────────────────────────────────────

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

COMMENT ON VIEW vw_calc_custos IS
  'Custo de produção por ref · lido de amicia_data.calc-meluni.prods[] · normaliza ref via LTRIM';



-- ────────────────────────────────────────────────────────────────────────────
-- 3 · VIEW vw_calc_precos
--
-- Expande o objeto amicia_data.prs{} em tabela (ref_norm, canal_norm, preco).
-- prs tem formato chave-valor: "{ref}|{canal}" → preco
-- Ex: "2277|shein" = 84.9
--
-- DUPLICATAS: o app grava "2277|shein" E "02277|shein" às vezes. Preferimos
-- a versão SEM zero à esquerda (convenção canônica do React que exibe prod.ref
-- direto). Em caso de empate, MAX(preco) quebra (improvável conflito real).
-- ────────────────────────────────────────────────────────────────────────────

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
    -- preferência por ref SEM zero à esquerda (canônica)
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

COMMENT ON VIEW vw_calc_precos IS
  'Preço de venda por ref×canal · lido de amicia_data.calc-meluni.prs{} · dedup prefere chave sem zero à esquerda';



-- ────────────────────────────────────────────────────────────────────────────
-- 4 · VIEW vw_calc_lucro_unitario
--
-- Junta custo (vw_calc_custos) + preço (vw_calc_precos) + função de lucro.
-- Resultado: lucro_peca por (ref_norm, canal_norm).
-- Usado como base por Card 1, Card 6, Card 7.
-- ────────────────────────────────────────────────────────────────────────────

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

COMMENT ON VIEW vw_calc_lucro_unitario IS
  'Lucro por peça em ref×canal · custo (prods) + preço (prs) + fn_calc_lucro_real';
