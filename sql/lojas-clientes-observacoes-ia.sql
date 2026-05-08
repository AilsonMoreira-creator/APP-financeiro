-- ═══════════════════════════════════════════════════════════════════════════
-- OBSERVAÇÕES DA VENDEDORA SOBRE CLIENTE — Sessão Ailson 07/05/2026
-- ═══════════════════════════════════════════════════════════════════════════
-- Quando vendedora pede sugestão de mensagem pra uma cliente específica,
-- ela pode preencher um modal com perguntas guiadas + texto livre sobre
-- a personalidade/contexto da cliente. Essas observações:
--
--   1. Persistem por cliente (ficam salvas pra próximas sugestões)
--   2. Vão pra IA como contexto extra (calibra tom/conteúdo)
--   3. NUNCA aparecem na mensagem em si (só calibram)
--
-- Estrutura: 1 row por cliente (coluna nova em lojas_clientes).
-- Exemplos de uso:
--   { "personalidade": "doce", "evento_recente": "gravidez",
--     "preferencias": "só linho, odeia preto",
--     "observacao_livre": "Pediu pra avisar quando chegar verde militar",
--     "atualizado_em": "2026-05-07T22:30:00Z",
--     "atualizado_por": "ailson" }

ALTER TABLE lojas_clientes
  ADD COLUMN IF NOT EXISTS observacoes_ia JSONB;

COMMENT ON COLUMN lojas_clientes.observacoes_ia IS
  'Observações livres da vendedora sobre a cliente, usadas como contexto pra IA na geração de mensagens. Estrutura: { personalidade, evento_recente, preferencias, observacao_livre, atualizado_em, atualizado_por }';
