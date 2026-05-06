-- ═══════════════════════════════════════════════════════════════════════════
-- Trigger: auto-recalcular KPI quando canal_cadastro muda
-- Sessao Ailson 06/05/2026.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO: quando UPDATE de canal_cadastro eh feito em massa (via planilha),
-- o KPI nao recalcula automaticamente. Resultado: cliente fica marcado como
-- Vesti em lojas_clientes mas KPI continua 'fisico_dominante'.
--
-- SOLUCAO: trigger AFTER UPDATE em lojas_clientes que chama
-- lojas_recalcular_kpis_cliente(NEW.id) sempre que canal_cadastro muda.
--
-- BENEFICIOS:
--   - Garante consistencia automatica entre canal_cadastro e canal_dominante
--   - Funciona com UPDATE em massa (uma planilha de 100 clientes dispara 100
--     recalcs em 1 transacao)
--   - Idempotente (rodar varias vezes nao quebra)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION trg_lojas_clientes_canal_change()
RETURNS TRIGGER AS $$
BEGIN
  -- So recalcula se canal_cadastro mudou (evita loop e custo desnecessario)
  IF NEW.canal_cadastro IS DISTINCT FROM OLD.canal_cadastro THEN
    PERFORM lojas_recalcular_kpis_cliente(NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canal_cadastro_change ON lojas_clientes;

CREATE TRIGGER trg_canal_cadastro_change
AFTER UPDATE OF canal_cadastro ON lojas_clientes
FOR EACH ROW
EXECUTE FUNCTION trg_lojas_clientes_canal_change();

COMMENT ON TRIGGER trg_canal_cadastro_change ON lojas_clientes IS
  'Recalcula KPI automaticamente quando canal_cadastro muda. Garante '
  'que canal_dominante (em KPI) reflita canal_cadastro (em cliente). '
  'Ailson 06/05/2026.';

-- ═══════════════════════════════════════════════════════════════════════════
-- TESTE (opcional, rodar pra validar):
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Pega 1 cliente fisico
-- SELECT id, canal_cadastro FROM lojas_clientes WHERE canal_cadastro='fisico' LIMIT 1;
--
-- 2. Atualiza pra vesti (substituir UUID)
-- UPDATE lojas_clientes SET canal_cadastro='vesti' WHERE id='<UUID>';
--
-- 3. Confere se canal_dominante mudou pra vesti_dominante
-- SELECT canal_dominante FROM lojas_clientes_kpis WHERE cliente_id='<UUID>';
--
-- 4. Reverte
-- UPDATE lojas_clientes SET canal_cadastro='fisico' WHERE id='<UUID>';
-- ═══════════════════════════════════════════════════════════════════════════
