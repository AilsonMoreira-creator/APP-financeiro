-- ═══════════════════════════════════════════════════════════════════════════
-- LOJAS — adicionar 'historico' no CHECK de telefone_principal_origem
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Decisão Ailson 28/04/2026: quando cliente nao tem telefone na planilha
-- cadastro_clientes_futura, sistema agora tenta backfill com o campo
-- WHATSAPP da planilha relatorio_vendas_historico (ST e BR).
--
-- Origens possiveis pra telefone_principal:
--   'whatsapp' = veio da coluna WHATSAPP do cadastro
--   'celular'  = veio da coluna CELULAR do cadastro
--   'fone'     = veio da coluna FONE do cadastro
--   'historico'= veio da venda historica (NOVO - adicionado nesta migration)
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE lojas_clientes
  DROP CONSTRAINT IF EXISTS lojas_clientes_telefone_principal_origem_check;

ALTER TABLE lojas_clientes
  ADD CONSTRAINT lojas_clientes_telefone_principal_origem_check
  CHECK (
    telefone_principal_origem IS NULL
    OR telefone_principal_origem IN ('whatsapp','celular','fone','historico')
  );

-- Validação:
-- SELECT telefone_principal_origem, COUNT(*)
-- FROM lojas_clientes
-- WHERE telefone_principal IS NOT NULL
-- GROUP BY telefone_principal_origem;
