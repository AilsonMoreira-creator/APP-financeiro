-- ═══════════════════════════════════════════════════════════════════════════
-- Janelas de novidade e reposição com caseado
-- Sessão Ailson 04/05/2026 madrugada
-- ═══════════════════════════════════════════════════════════════════════════
--
-- REGRAS (já existentes em api/lojas-helpers-business.js):
--   tem_caseado = ficha técnica.botao != ''
--
--   Novidade pura (REF nunca vendeu):
--     5-12 dias após entrega oficina (sem caseado)
--     7-14 dias após entrega oficina (com caseado)
--
--   Reposição (REF já vendeu antes — Ailson 04/05/2026):
--     5-10 dias após entrega oficina (sem caseado)
--     7-12 dias após entrega oficina (com caseado)
--   "Considerar reposição o prazo 5 ou 7 + 5 dias"
--
-- Ficha técnica está em amicia_data.user_id='ficha-tecnica'.payload.produtos[]
--   - campo 'ref' (string com leading zero ex "0020")
--   - campo 'botao' (string vazia "" = sem caseado)
--   - campo 'marca' ('Amícia' ou 'Meluni')
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. View auxiliar: ficha técnica em formato tabular (com tem_caseado)
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_lojas_ficha_tecnica AS
SELECT
  -- ref normalizada (sem leading zeros) pra fazer join com cortes
  LTRIM(p->>'ref', '0') AS ref,
  p->>'ref' AS ref_original,
  p->>'descricao' AS descricao,
  p->>'marca' AS marca,
  p->>'botao' AS botao,
  -- caseado = tem botao não-vazio
  (COALESCE(p->>'botao', '') != '') AS tem_caseado
FROM amicia_data,
     jsonb_array_elements(payload->'produtos') p
WHERE user_id = 'ficha-tecnica'
  AND p->>'ref' IS NOT NULL
  AND TRIM(p->>'ref') != '';

COMMENT ON VIEW vw_lojas_ficha_tecnica IS
  'Ficha técnica tabular. tem_caseado = botao não-vazio. REF normalizada sem zero pra join com cortes.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. View NOVIDADES com janela ajustada por caseado (substitui a versão antiga)
-- ───────────────────────────────────────────────────────────────────────────
-- Janela: 5-12d (sem caseado) ou 7-14d (com caseado)
-- Filtro marca='Amícia' (loja física)
-- Le ficha técnica pra detectar caseado
--
CREATE OR REPLACE VIEW vw_lojas_novidades_auto AS
WITH cortes_validos AS (
  SELECT
    -- ref normalizada (sem leading zeros) pra cruzar com ficha técnica
    LTRIM(c->>'ref', '0') AS ref,
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
    AND c->>'marca' = 'Amícia'
),
mais_recente_por_ref AS (
  SELECT DISTINCT ON (ref)
    ref, data_entrega, qtd_entregue, marca
  FROM cortes_validos
  ORDER BY ref, data_entrega DESC
),
com_caseado AS (
  SELECT
    mr.ref,
    mr.data_entrega,
    mr.qtd_entregue,
    mr.marca,
    COALESCE(ft.tem_caseado, false) AS tem_caseado,
    CURRENT_DATE - mr.data_entrega AS dias_apos_entrega
  FROM mais_recente_por_ref mr
  LEFT JOIN vw_lojas_ficha_tecnica ft ON ft.ref = mr.ref
)
SELECT
  ref,
  data_entrega,
  dias_apos_entrega,
  qtd_entregue,
  marca,
  tem_caseado
FROM com_caseado
WHERE
  -- Janela depende de caseado
  (tem_caseado = false AND dias_apos_entrega BETWEEN 5 AND 12)
  OR
  (tem_caseado = true AND dias_apos_entrega BETWEEN 7 AND 14)
ORDER BY data_entrega DESC;

COMMENT ON VIEW vw_lojas_novidades_auto IS
  'Refs em janela de novidade (5-12d sem caseado / 7-14d com caseado). Le ficha técnica pra caseado. Sprint Ailson 04/05/2026.';


-- ───────────────────────────────────────────────────────────────────────────
-- 3. View REPOSIÇÕES — janela ajustada (5+5 dias = 5-10d / 7+5 dias = 7-12d)
-- ───────────────────────────────────────────────────────────────────────────
-- Reposição = REF já vendeu antes em lojas_vendas_itens
-- Janela: 5-10d (sem caseado) ou 7-12d (com caseado)
-- Filtro marca='Amícia'
--
CREATE OR REPLACE VIEW vw_lojas_reposicoes_auto AS
WITH cortes_validos AS (
  SELECT
    LTRIM(c->>'ref', '0') AS ref,
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
    AND c->>'marca' = 'Amícia'
),
mais_recente_por_ref AS (
  SELECT DISTINCT ON (ref)
    ref, data_entrega, qtd_entregue, marca
  FROM cortes_validos
  ORDER BY ref, data_entrega DESC
),
com_caseado AS (
  SELECT
    mr.ref,
    mr.data_entrega,
    mr.qtd_entregue,
    mr.marca,
    COALESCE(ft.tem_caseado, false) AS tem_caseado,
    CURRENT_DATE - mr.data_entrega AS dias_apos_entrega
  FROM mais_recente_por_ref mr
  LEFT JOIN vw_lojas_ficha_tecnica ft ON ft.ref = mr.ref
),
em_janela AS (
  SELECT *
  FROM com_caseado
  WHERE
    (tem_caseado = false AND dias_apos_entrega BETWEEN 5 AND 10)
    OR
    (tem_caseado = true AND dias_apos_entrega BETWEEN 7 AND 12)
),
com_vendas AS (
  -- Pra ser reposição, REF tem que ter vendido alguma vez antes.
  -- Cruza com lojas_vendas_itens (ref já normalizada nessa tabela).
  SELECT DISTINCT ej.*
  FROM em_janela ej
  WHERE EXISTS (
    SELECT 1 FROM lojas_vendas_itens lvi
    WHERE lvi.ref = ej.ref
  )
)
SELECT
  ref,
  data_entrega,
  dias_apos_entrega,
  qtd_entregue,
  marca,
  tem_caseado
FROM com_vendas
ORDER BY data_entrega DESC;

COMMENT ON VIEW vw_lojas_reposicoes_auto IS
  'Refs em janela de reposição (5-10d sem caseado / 7-12d com caseado) que JA venderam antes. Sprint Ailson 04/05/2026.';


-- ───────────────────────────────────────────────────────────────────────────
-- VALIDAÇÃO — rode pra ver os resultados
-- ───────────────────────────────────────────────────────────────────────────

-- 1. Ficha técnica tabular
-- SELECT COUNT(*), COUNT(*) FILTER (WHERE tem_caseado) AS com_caseado
-- FROM vw_lojas_ficha_tecnica;

-- 2. Novidades por janela
-- SELECT tem_caseado, COUNT(*) FROM vw_lojas_novidades_auto GROUP BY tem_caseado;

-- 3. Reposições
-- SELECT * FROM vw_lojas_reposicoes_auto LIMIT 20;
