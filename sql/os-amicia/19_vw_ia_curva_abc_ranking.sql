-- =====================================================================
-- OS Amícia · Sprint 8 · IA Pergunta · Curva ABC por POSIÇÃO no ranking
-- Versão: 1.0 · Data: 25/04/2026
-- =====================================================================
--
-- COMO RODAR:
--   Supabase → SQL Editor → New query → colar este arquivo INTEIRO → Run
--   Idempotente (CREATE OR REPLACE VIEW). ASCII puro.
--
-- PROPÓSITO:
-- Esta view é EXCLUSIVA da IA Pergunta (módulo /api/ia-pergunta).
-- NÃO substitui vw_ranking_curvas_bling (que continua sendo usada pela
-- OS Amícia com regra própria >=300/>=200, janela 30d).
--
-- DECISÕES VALIDADAS COM AILSON (25/04):
--   1. Curva ABC por POSIÇÃO absoluta no ranking (não Pareto):
--        Posição 1-10  = Curva A
--        Posição 11-20 = Curva B
--        Posição 21+   = Curva C (incluindo refs sem venda)
--      Regra alinhada com "Top Ranking 30" do Bling que o Ailson usa.
--
--   2. Janela 45 dias (limite onde o Bling ainda mantém detalhe
--      cor/tamanho. Mais antigo só tem agregado por ref).
--
--   3. Soma das 3 marcas (Exitus + Lumia + Muniam): bling_vendas_detalhe
--      já consolida todas. Filtro adicional não necessário.
--
--   4. Considera devolução global (10%) na velocidade — alinhado com
--      vw_variacoes_classificadas (chave devolucao_global_pct).
--
--   5. Tamanho ÚNICO (UNICO/U) excluído por consistência (mesma regra
--      da vw_variacoes_classificadas).
--
--   6. dias_ate_zerar SEM oficina e COM oficina:
--        - dias_ate_zerar_ml_atual = qtd_total / vendas_dia
--        - dias_ate_zerar_com_oficinas = (qtd_total + peças_em_corte) / vendas_dia
--      Permite IA explicar "vai zerar em 5 dias, mas com oficinas chega
--      até 22 dias" — granularidade que o Ailson valoriza.
--
-- COLUNAS DE SAÍDA:
--   ref                          text     (ref normalizada sem zero à esquerda)
--   posicao_ranking              int      (1..N — só refs que venderam)
--   curva                        text     ('A' | 'B' | 'C')
--   vendas_45d                   int      (peças vendidas nos últimos 45d)
--   vendas_dia                   numeric  (média ajustada por devolução 10%)
--   qtd_total_estoque            int      (estoque ML atual)
--   pecas_em_corte               int      (oficinas em produção)
--   dias_ate_zerar_ml_atual      int      (NULL se não vende)
--   dias_ate_zerar_com_oficinas  int      (NULL se não vende)
--   sem_dados                    boolean  (flag de ml_estoque_ref_atual)
--
-- USO ESPERADO (api/_ia-pergunta-helpers.js):
--   SELECT * FROM vw_ia_curva_abc_ranking
--   WHERE curva = 'A' AND dias_ate_zerar_com_oficinas <= 14
--   ORDER BY dias_ate_zerar_com_oficinas NULLS LAST;
--
-- =====================================================================

CREATE OR REPLACE VIEW vw_ia_curva_abc_ranking AS
WITH cfg AS (
  SELECT
    (SELECT (valor #>> '{}')::numeric FROM ia_config WHERE chave = 'devolucao_global_pct') AS devol_pct
),
-- 1. Expande os itens das vendas dos últimos 45 dias.
--    bling_vendas_detalhe.itens é jsonb array com cada item tendo
--    {ref, cor, tamanho, quantidade, ...}.
vendas_expandidas AS (
  SELECT
    LTRIM(COALESCE(item->>'ref', ''), '0')              AS ref,
    UPPER(TRIM(COALESCE(item->>'tamanho', '')))         AS tam,
    COALESCE((item->>'quantidade')::int, 0)             AS qtd
  FROM bling_vendas_detalhe v,
       LATERAL jsonb_array_elements(v.itens) AS item
  WHERE v.data_pedido >= CURRENT_DATE - INTERVAL '45 days'
    AND item->>'ref' IS NOT NULL
    AND item->>'ref' <> ''
),
-- 2. Agrega vendas 45d por ref (todas as marcas + cores + tamanhos somados,
--    exceto tamanho ÚNICO).
vendas_por_ref AS (
  SELECT
    ref,
    SUM(qtd)::int AS vendas_45d
  FROM vendas_expandidas
  WHERE tam NOT IN ('UNICO', 'U', 'ÚNICO')
  GROUP BY ref
  HAVING SUM(qtd) > 0
),
-- 3. Ranking absoluto por posição (1-indexed). Empate desambiguado por ref.
ranking_refs AS (
  SELECT
    ref,
    vendas_45d,
    ROW_NUMBER() OVER (ORDER BY vendas_45d DESC, ref) AS posicao_ranking
  FROM vendas_por_ref
),
-- 4. Peças em produção nas oficinas (somado por ref).
--    Reusa lógica do vw_variacoes_classificadas: lê amicia_data
--    user_id='ailson_cortes' filtrando entregue=false e somando qtd.
pecas_em_corte_por_ref AS (
  SELECT
    LTRIM(COALESCE(c->>'ref', ''), '0')           AS ref,
    SUM(COALESCE((c->>'qtd')::int, 0))::int       AS pecas_em_corte
  FROM amicia_data,
       LATERAL jsonb_array_elements(payload->'cortes') AS c
  WHERE user_id = 'ailson_cortes'
    AND COALESCE((c->>'entregue')::boolean, false) = false
  GROUP BY 1
  HAVING SUM(COALESCE((c->>'qtd')::int, 0)) > 0
),
-- 5. Junta tudo: estoque (base) ⨝ ranking ⨝ peças em corte
unidos AS (
  SELECT
    e.ref,
    COALESCE(e.qtd_total, 0)::int                 AS qtd_total_estoque,
    COALESCE(e.sem_dados, false)                  AS sem_dados,
    COALESCE(rr.vendas_45d, 0)::int               AS vendas_45d,
    rr.posicao_ranking,
    COALESCE(pec.pecas_em_corte, 0)::int          AS pecas_em_corte
  FROM ml_estoque_ref_atual e
  LEFT JOIN ranking_refs rr        ON rr.ref = e.ref
  LEFT JOIN pecas_em_corte_por_ref pec ON pec.ref = e.ref
  -- Inclui também refs que vendem mas não estão no ml_estoque_ref_atual
  -- (caso raro mas pode acontecer com refs novas)
  UNION
  SELECT
    rr.ref,
    0                                             AS qtd_total_estoque,
    true                                          AS sem_dados,
    rr.vendas_45d,
    rr.posicao_ranking,
    COALESCE(pec.pecas_em_corte, 0)::int          AS pecas_em_corte
  FROM ranking_refs rr
  LEFT JOIN ml_estoque_ref_atual e ON e.ref = rr.ref
  LEFT JOIN pecas_em_corte_por_ref pec ON pec.ref = rr.ref
  WHERE e.ref IS NULL
)
SELECT
  u.ref,
  u.posicao_ranking,
  CASE
    WHEN u.posicao_ranking IS NULL    THEN 'C'    -- ref sem venda 45d
    WHEN u.posicao_ranking <= 10      THEN 'A'
    WHEN u.posicao_ranking <= 20      THEN 'B'
    ELSE                                   'C'
  END                                              AS curva,
  u.vendas_45d,
  -- Velocidade ajustada por devolução global (mesma fórmula da vw_variacoes_classificadas)
  ROUND(
    (u.vendas_45d::numeric / 45.0) * (1 - cfg.devol_pct / 100.0),
    3
  )                                                AS vendas_dia,
  u.qtd_total_estoque,
  u.pecas_em_corte,
  -- dias_ate_zerar_ml_atual: só estoque, sem contar oficinas
  CASE
    WHEN u.vendas_45d = 0 THEN NULL
    ELSE FLOOR(
      u.qtd_total_estoque::numeric
      / NULLIF((u.vendas_45d::numeric / 45.0) * (1 - cfg.devol_pct / 100.0), 0)
    )::int
  END                                              AS dias_ate_zerar_ml_atual,
  -- dias_ate_zerar_com_oficinas: estoque + peças em corte
  CASE
    WHEN u.vendas_45d = 0 THEN NULL
    ELSE FLOOR(
      (u.qtd_total_estoque + u.pecas_em_corte)::numeric
      / NULLIF((u.vendas_45d::numeric / 45.0) * (1 - cfg.devol_pct / 100.0), 0)
    )::int
  END                                              AS dias_ate_zerar_com_oficinas,
  u.sem_dados
FROM unidos u
CROSS JOIN cfg;

COMMENT ON VIEW vw_ia_curva_abc_ranking IS
  'IA Pergunta v1.0 - Curva ABC por POSICAO absoluta (1-10=A, 11-20=B, 21+=C). '
  'Janela 45d. Soma 3 marcas. Devolucao 10% aplicada na velocidade. '
  'EXCLUSIVA da IA Pergunta - nao substitui vw_ranking_curvas_bling.';

-- Permissões: pública pra leitura (auth) — é só SELECT, sem dados sensíveis.
GRANT SELECT ON vw_ia_curva_abc_ranking TO authenticated;
GRANT SELECT ON vw_ia_curva_abc_ranking TO service_role;

-- =====================================================================
-- SMOKE TESTS (rodar após aplicar)
--
-- 1) View existe?
--    SELECT * FROM vw_ia_curva_abc_ranking LIMIT 5;
--
-- 2) Quantas refs em cada curva?
--    SELECT curva, COUNT(*) FROM vw_ia_curva_abc_ranking GROUP BY curva;
--
-- 3) Top 10 (Curva A) ordenado por posição:
--    SELECT * FROM vw_ia_curva_abc_ranking
--    WHERE curva = 'A' ORDER BY posicao_ranking;
--
-- 4) Refs em risco real (Curva A + ≤14 dias considerando oficinas):
--    SELECT ref, posicao_ranking, vendas_dia, qtd_total_estoque,
--           pecas_em_corte, dias_ate_zerar_ml_atual,
--           dias_ate_zerar_com_oficinas
--    FROM vw_ia_curva_abc_ranking
--    WHERE curva = 'A' AND dias_ate_zerar_com_oficinas <= 14
--    ORDER BY dias_ate_zerar_com_oficinas NULLS LAST;
--
-- 5) Refs paradas (vendas baixas mas estoque alto — problema oposto):
--    SELECT ref, vendas_45d, qtd_total_estoque
--    FROM vw_ia_curva_abc_ranking
--    WHERE curva = 'C' AND qtd_total_estoque > 100 AND vendas_45d <= 5
--    ORDER BY qtd_total_estoque DESC LIMIT 20;
-- =====================================================================
