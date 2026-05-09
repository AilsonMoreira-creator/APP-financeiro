-- ═══════════════════════════════════════════════════════════════════════════
-- Adiciona 'FRANCISCA' nos aliases da Fran em lojas_vendedoras.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Motivo: o módulo Folha de Pagamento usa nome_planilha='FRANCISCA'
-- pra match em lojas_vendedoras (categoria vendedora).
-- Sem o alias, vendas dela ficam zeradas no card de fechamento.
--
-- Sessão Ailson 09/05/2026 — auditoria pós-deploy do módulo Folha.
-- Idempotente (usa array_append apenas se já não tiver).
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE lojas_vendedoras
SET aliases = ARRAY['FRAN', 'FRANCISCA']
WHERE nome = 'Fran'
  AND NOT ('FRANCISCA' = ANY(aliases));

-- Validação:
SELECT id, nome, loja, aliases, ativa
FROM lojas_vendedoras
WHERE nome = 'Fran';
