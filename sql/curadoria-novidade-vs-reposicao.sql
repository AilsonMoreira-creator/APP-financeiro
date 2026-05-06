-- ═══════════════════════════════════════════════════════════════════════════
-- Curadoria — separar Novidade vs Reposição
-- Sessao Ailson 06/05/2026.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ATE AGORA: vw_lojas_novidades_auto retornava TUDO que entregou da oficina
-- entre 5-12d. Mas misturava novidade real (ref nunca vendida antes) com
-- REPOSICAO (ref ja vendida antes, voltou ao estoque).
--
-- AGORA:
--   - vw_lojas_novidades_auto continua existindo (nao mudo signature),
--     mas FILTRA: ref nao pode ter venda antes da janela 5-12d.
--   - vw_lojas_reposicoes_auto NOVA: ref que TEM venda antes da janela.
--   - Tabelas lojas_produtos_curadoria e lojas_curadoria_exclusoes ganham
--     novo tipo 'reposicao'.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Nova view: reposicoes_auto (ref ja foi vendida antes da janela)
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS vw_lojas_reposicoes_auto CASCADE;
CREATE VIEW vw_lojas_reposicoes_auto AS
WITH cortes_validos AS (
  SELECT
    c->>'ref' AS ref,
    TO_DATE(c->>'dataEntrega', 'DD/MM/YYYY') AS data_entrega,
    (c->>'qtdEntregue')::int AS qtd_entregue,
    c->>'marca' AS marca
  FROM amicia_data,
       jsonb_array_elements(payload->'cortes') c
  WHERE user_id = 'ailson_cortes'
    AND (c->>'entregue')::boolean = true
    AND c->>'dataEntrega' IS NOT NULL
    AND c->>'dataEntrega' ~ '^\d{2}/\d{2}/\d{4}$'
    AND c->>'ref' IS NOT NULL
    AND TRIM(c->>'ref') != ''
),
mais_recente_por_ref AS (
  SELECT DISTINCT ON (ref) ref, data_entrega, qtd_entregue, marca
  FROM cortes_validos
  ORDER BY ref, data_entrega DESC
),
janela AS (
  SELECT * FROM mais_recente_por_ref
  WHERE CURRENT_DATE - data_entrega BETWEEN 5 AND 12
)
SELECT
  j.ref,
  j.data_entrega,
  CURRENT_DATE - j.data_entrega AS dias_apos_entrega,
  j.qtd_entregue,
  j.marca
FROM janela j
WHERE EXISTS (
  -- Ref TEM venda antes da janela = reposição
  SELECT 1 FROM lojas_vendas_itens v
  WHERE v.ref = j.ref
    AND v.data_venda < j.data_entrega
)
ORDER BY j.data_entrega DESC;

COMMENT ON VIEW vw_lojas_reposicoes_auto IS
  'Refs que entregaram da oficina 5-12d atras E ja foram vendidas antes (reposicao). Sprint Ailson 06/05/2026.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. Atualizar vw_lojas_novidades_auto pra excluir reposicoes
-- ───────────────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS vw_lojas_novidades_auto CASCADE;
CREATE VIEW vw_lojas_novidades_auto AS
WITH cortes_validos AS (
  SELECT
    c->>'ref' AS ref,
    TO_DATE(c->>'dataEntrega', 'DD/MM/YYYY') AS data_entrega,
    (c->>'qtdEntregue')::int AS qtd_entregue,
    c->>'marca' AS marca
  FROM amicia_data,
       jsonb_array_elements(payload->'cortes') c
  WHERE user_id = 'ailson_cortes'
    AND (c->>'entregue')::boolean = true
    AND c->>'dataEntrega' IS NOT NULL
    AND c->>'dataEntrega' ~ '^\d{2}/\d{2}/\d{4}$'
    AND c->>'ref' IS NOT NULL
    AND TRIM(c->>'ref') != ''
),
mais_recente_por_ref AS (
  SELECT DISTINCT ON (ref) ref, data_entrega, qtd_entregue, marca
  FROM cortes_validos
  ORDER BY ref, data_entrega DESC
),
janela AS (
  SELECT * FROM mais_recente_por_ref
  WHERE CURRENT_DATE - data_entrega BETWEEN 5 AND 12
)
SELECT
  j.ref,
  j.data_entrega,
  CURRENT_DATE - j.data_entrega AS dias_apos_entrega,
  j.qtd_entregue,
  j.marca
FROM janela j
WHERE NOT EXISTS (
  -- Ref NAO tem venda antes da janela = novidade real
  SELECT 1 FROM lojas_vendas_itens v
  WHERE v.ref = j.ref
    AND v.data_venda < j.data_entrega
)
ORDER BY j.data_entrega DESC;

COMMENT ON VIEW vw_lojas_novidades_auto IS
  'Refs que entregaram da oficina 5-12d atras E NUNCA foram vendidas antes (novidade real). Atualizada Ailson 06/05/2026.';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. Adicionar tipo 'reposicao' nos CHECKs das 2 tabelas
-- ───────────────────────────────────────────────────────────────────────────
-- lojas_produtos_curadoria
ALTER TABLE lojas_produtos_curadoria
  DROP CONSTRAINT IF EXISTS lojas_produtos_curadoria_tipo_check;
ALTER TABLE lojas_produtos_curadoria
  ADD CONSTRAINT lojas_produtos_curadoria_tipo_check
  CHECK (tipo IN ('best_seller', 'em_alta', 'novidade_manual', 'reposicao'));

-- lojas_curadoria_exclusoes
ALTER TABLE lojas_curadoria_exclusoes
  DROP CONSTRAINT IF EXISTS lojas_curadoria_exclusoes_tipo_check;
ALTER TABLE lojas_curadoria_exclusoes
  ADD CONSTRAINT lojas_curadoria_exclusoes_tipo_check
  CHECK (tipo IN ('best_seller', 'em_alta', 'novidade_manual', 'reposicao'));


-- ───────────────────────────────────────────────────────────────────────────
-- VALIDACAO
-- ───────────────────────────────────────────────────────────────────────────
-- SELECT 'novidades' AS v, COUNT(*) FROM vw_lojas_novidades_auto
-- UNION ALL SELECT 'reposicoes', COUNT(*) FROM vw_lojas_reposicoes_auto;
