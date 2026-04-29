-- ═══════════════════════════════════════════════════════════════════════════
-- LOJAS — Cron Health Log
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tabela simples pra rastrear TODA invocação de cron (lojas-ia-cron-diario,
-- lojas-ia-cron-semanal, lojas-drive-cron). Logamos na PRIMEIRA linha do
-- handler, antes de qualquer processamento, garantindo que se o cron foi
-- chamado, vai aparecer aqui — mesmo se o resto falhar.
--
-- Uso pra debug:
--   SELECT * FROM lojas_cron_health
--   WHERE cron_name = 'lojas-ia-cron-diario'
--   ORDER BY started_at DESC
--   LIMIT 30;
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lojas_cron_health (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cron_name       text NOT NULL,                              -- 'lojas-ia-cron-diario'
  origem          text NOT NULL,                              -- 'vercel-cron' | 'manual-admin' | 'unknown'
  user_agent      text,
  triggered_by    text,                                        -- ?user= ou X-User
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  duracao_ms      int,
  status          text NOT NULL DEFAULT 'iniciada' CHECK (status IN ('iniciada','sucesso','erro','timeout')),
  total_alvos     int,                                         -- nro vendedoras processadas
  sucessos        int,
  erros           int,
  erro_msg        text,
  detalhes        jsonb                                        -- payload livre
);

CREATE INDEX IF NOT EXISTS idx_cron_health_name_data
  ON lojas_cron_health(cron_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_cron_health_status
  ON lojas_cron_health(status, started_at DESC)
  WHERE status != 'sucesso';

ALTER TABLE lojas_cron_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON lojas_cron_health;
CREATE POLICY service_role_all ON lojas_cron_health FOR ALL USING (true);

COMMENT ON TABLE lojas_cron_health IS
  'Log de invocacoes de cron. Toda chamada eh registrada na primeira linha do handler. Util pra detectar quando Vercel nao dispara o schedule.';
