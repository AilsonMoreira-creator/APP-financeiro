-- ═══════════════════════════════════════════════════════════════════════════
-- Sprint Curadoria de Produtos — visibilidade total + exclusões
-- Sessão Ailson 04/05/2026 madrugada
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Decisões fechadas com Ailson:
--
--   • Mostrar manual + automático misturados nas telas (badge MANUAL/AUTO)
--   • Manual ganha em duplicata (mostra so 1 vez)
--   • Excluir auto = some ate admin reativar
--
--   • REGRA CORRIGIDA (o codigo atual diverge):
--       - best_sellers = SO manual (Ailson cadastra)
--       - em_alta      = manual + top 10 curva A (vw_lojas_top_vendas_loja_fisica)
--       - curva B NAO entra em nada
--       - novidades    = manual + 5-12 dias apos entrega da oficina
--
--   • Novidade automatica nunca rodou ate hoje. Coluna lojas_produtos.
--     data_entrega_oficina existe mas esta NULL pra todos. Vamos ler
--     direto do payload de cortes (amicia_data user_id='ailson_cortes').
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Tabela de exclusoes (admin "vetou" um produto automatico)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas_curadoria_exclusoes (
  ref          TEXT NOT NULL,
  tipo         TEXT NOT NULL CHECK (tipo IN ('novidade_manual', 'em_alta', 'best_seller')),
  excluida_em  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  excluida_por TEXT,
  motivo       TEXT,
  PRIMARY KEY (ref, tipo)
);

CREATE INDEX IF NOT EXISTS idx_curadoria_exclusoes_tipo
  ON lojas_curadoria_exclusoes(tipo);

COMMENT ON TABLE lojas_curadoria_exclusoes IS
  'Refs que foram vetadas pelo admin da curadoria automatica. Permanece ate o admin reativar manualmente.';


-- ───────────────────────────────────────────────────────────────────────────
-- 2. View de novidades automaticas (5-12 dias apos entrega da oficina)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Le do payload de cortes do modulo Oficinas (amicia_data user_id='ailson_cortes').
-- Cortes tem campos: ref, entregue (bool), dataEntrega ("DD/MM/YYYY" string BR).
--
-- Janela: 5-12 dias. Se a mesma REF tem multiplos cortes, pega o mais recente.
--
-- IMPORTANTE: filtrar so user_id='ailson_cortes'. Outros users (backup-diario,
-- salas-corte) tem cortes mas com proposito diferente (sala de corte = corta
-- tecido; oficinas = entrega pra costureira).
--
CREATE OR REPLACE VIEW vw_lojas_novidades_auto AS
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
    AND c->>'dataEntrega' ~ '^\d{2}/\d{2}/\d{4}$'  -- valida formato BR
    AND c->>'ref' IS NOT NULL
    AND TRIM(c->>'ref') != ''
),
mais_recente_por_ref AS (
  -- Se mesma REF tem multiplos cortes entregues, pega o mais recente
  SELECT DISTINCT ON (ref)
    ref, data_entrega, qtd_entregue, marca
  FROM cortes_validos
  ORDER BY ref, data_entrega DESC
)
SELECT
  ref,
  data_entrega,
  CURRENT_DATE - data_entrega AS dias_apos_entrega,
  qtd_entregue,
  marca
FROM mais_recente_por_ref
WHERE CURRENT_DATE - data_entrega BETWEEN 5 AND 12
ORDER BY data_entrega DESC;

COMMENT ON VIEW vw_lojas_novidades_auto IS
  'Refs que entregaram da oficina entre 5 e 12 dias atras. Le payload ailson_cortes. Sprint curadoria 04/05/2026.';


-- ───────────────────────────────────────────────────────────────────────────
-- VALIDACAO: rode pra ver se a view tem dados
-- ───────────────────────────────────────────────────────────────────────────
-- SELECT COUNT(*) FROM vw_lojas_novidades_auto;
-- SELECT * FROM vw_lojas_novidades_auto LIMIT 10;
