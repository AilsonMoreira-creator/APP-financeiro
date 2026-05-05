-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill: popular cliente_id em lojas_acoes a partir da sugestao_id
-- Sessao Ailson 05/05/2026.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BUG: lojas_acoes.cliente_id estava NULL em 100% das 90 mensagens enviadas
-- (frontend nao passava cliente_id em registrarAcao). Card de conversoes
-- usa INNER JOIN com lojas_clientes — todas as 90 sumiam.
--
-- FIX FRONTEND: ja deployado (Lojas.jsx).
-- BACKFILL: este SQL preenche o cliente_id (e grupo_id) das acoes antigas
-- buscando na sugestao referenciada.
--
-- VALIDACAO PRE-EXECUCAO: rode esses SELECTs primeiro pra ver o tamanho:
--
-- 1. Quantas acoes serao atualizadas?
--    SELECT COUNT(*) FROM lojas_acoes a
--    INNER JOIN lojas_sugestoes_diarias s ON s.id = a.sugestao_id
--    WHERE a.cliente_id IS NULL AND s.cliente_id IS NOT NULL;
--
-- 2. Quantas ainda ficarao NULL (sugestao sem cliente)?
--    SELECT COUNT(*) FROM lojas_acoes a
--    LEFT JOIN lojas_sugestoes_diarias s ON s.id = a.sugestao_id
--    WHERE a.cliente_id IS NULL
--      AND (s.cliente_id IS NULL OR a.sugestao_id IS NULL);
--
-- ═══════════════════════════════════════════════════════════════════════════

-- Backfill cliente_id
UPDATE lojas_acoes a
SET cliente_id = s.cliente_id
FROM lojas_sugestoes_diarias s
WHERE a.sugestao_id = s.id
  AND a.cliente_id IS NULL
  AND s.cliente_id IS NOT NULL;

-- Backfill grupo_id (mesma logica)
UPDATE lojas_acoes a
SET grupo_id = s.grupo_id
FROM lojas_sugestoes_diarias s
WHERE a.sugestao_id = s.id
  AND a.grupo_id IS NULL
  AND s.grupo_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- VALIDACAO POS-EXECUCAO: depois de rodar, confirme com:
--
-- SELECT
--   COUNT(*) AS total,
--   COUNT(cliente_id) AS com_cliente,
--   COUNT(grupo_id) AS com_grupo,
--   COUNT(*) - COUNT(cliente_id) - COUNT(grupo_id) AS sem_alvo
-- FROM lojas_acoes
-- WHERE tipo_acao = 'mensagem_enviada';
--
-- ═══════════════════════════════════════════════════════════════════════════
