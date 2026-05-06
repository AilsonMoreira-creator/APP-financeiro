-- ═══════════════════════════════════════════════════════════════════════════
-- Curadoria — adicionar tipo 'reposicao' aos CHECKs
-- Sessao Ailson 06/05/2026 (CORRECAO)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- VERSAO ANTERIOR DESTE ARQUIVO CRIAVA views novas, MAS as views ja existem
-- com logica mais sofisticada em sql/lojas-novidades-reposicoes-com-caseado.sql:
--   - vw_lojas_novidades_auto (5-10d sem caseado, 7-12d com caseado, marca=Amicia)
--   - vw_lojas_reposicoes_auto (mesma janela + ja vendeu antes)
--
-- ESTAS VIEWS JA SAO USADAS PELA IA (api/lojas-ia.js linha 526 e 706).
-- Sobrescrever ia perder regra do caseado e filtro Amicia.
--
-- ESTE ARQUIVO AGORA SO ALTERA OS CHECKs pra aceitar 'reposicao' como tipo
-- valido nas tabelas de curadoria manual e exclusoes.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE lojas_produtos_curadoria
  DROP CONSTRAINT IF EXISTS lojas_produtos_curadoria_tipo_check;
ALTER TABLE lojas_produtos_curadoria
  ADD CONSTRAINT lojas_produtos_curadoria_tipo_check
  CHECK (tipo IN ('best_seller', 'em_alta', 'novidade_manual', 'reposicao'));

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
