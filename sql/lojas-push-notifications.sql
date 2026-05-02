-- ═══════════════════════════════════════════════════════════════════════════
-- PUSH NOTIFICATIONS — Sessão Ailson 02/05/2026
-- ═══════════════════════════════════════════════════════════════════════════
-- Cron seg-sex 10:30 + retry 14:00 lembra vendedoras que nao abriram o app.
-- "Abriu" = pelo menos 1 min de foco no app no dia (registrado pelo cliente).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Colunas em lojas_vendedoras
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE lojas_vendedoras
  ADD COLUMN IF NOT EXISTS push_subscription jsonb,
  ADD COLUMN IF NOT EXISTS push_ativado_em timestamptz,
  ADD COLUMN IF NOT EXISTS ultimo_acesso_em timestamptz;

CREATE INDEX IF NOT EXISTS idx_vendedoras_ultimo_acesso
  ON lojas_vendedoras(ultimo_acesso_em);

CREATE INDEX IF NOT EXISTS idx_vendedoras_push_ativo
  ON lojas_vendedoras(id)
  WHERE push_subscription IS NOT NULL;

COMMENT ON COLUMN lojas_vendedoras.push_subscription IS
  'JSON com endpoint+keys do navegador da vendedora. NULL = nao ativou.';

COMMENT ON COLUMN lojas_vendedoras.push_ativado_em IS
  'Quando a vendedora ativou push pela ultima vez (pra debug e re-ativacao).';

COMMENT ON COLUMN lojas_vendedoras.ultimo_acesso_em IS
  'Ultima vez que a vendedora ficou >=1 min com app em foco. Cron usa isso.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Tabela de log de pushes enviados (auditoria + evita duplo envio)
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas_push_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedora_id    uuid NOT NULL REFERENCES lojas_vendedoras(id) ON DELETE CASCADE,
  enviado_em      timestamptz NOT NULL DEFAULT now(),
  tipo            text NOT NULL CHECK (tipo IN ('lembrete_1030', 'lembrete_1400', 'manual', 'aviso_admin')),
  mensagem        text NOT NULL,
  sucesso         boolean NOT NULL,
  erro            text,                    -- preenchido se sucesso=false
  status_http     int                      -- da resposta do push service
);

CREATE INDEX IF NOT EXISTS idx_push_log_vendedora_dia
  ON lojas_push_log(vendedora_id, enviado_em DESC);

-- Indice (tipo, enviado_em DESC) — IMMUTABLE, performance equivalente
-- pro caso de uso "buscar logs do tipo X no periodo Y" usado pelos crons
CREATE INDEX IF NOT EXISTS idx_push_log_tipo_data
  ON lojas_push_log(tipo, enviado_em DESC);

ALTER TABLE lojas_push_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_push_log_select" ON lojas_push_log;
DROP POLICY IF EXISTS "lojas_push_log_modify" ON lojas_push_log;
CREATE POLICY "lojas_push_log_select" ON lojas_push_log FOR SELECT USING (true);
CREATE POLICY "lojas_push_log_modify" ON lojas_push_log FOR ALL USING (true) WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. View pro dashboard admin: status do dia por vendedora
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW vw_lojas_acesso_hoje AS
SELECT
  v.id                                          AS vendedora_id,
  v.nome                                        AS vendedora_nome,
  v.loja                                        AS loja,
  v.ativa                                       AS vendedora_ativa,
  (v.push_subscription IS NOT NULL)             AS push_ativo,
  v.ultimo_acesso_em,
  -- Abriu hoje? (>=1 min com foco no app HOJE no fuso BRT)
  CASE
    WHEN v.ultimo_acesso_em IS NULL THEN false
    WHEN v.ultimo_acesso_em AT TIME ZONE 'America/Sao_Paulo' >= (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo') THEN true
    ELSE false
  END                                           AS abriu_hoje,
  -- Status visual pro dashboard
  CASE
    WHEN v.push_subscription IS NULL THEN 'sem_push'
    WHEN v.ultimo_acesso_em IS NULL THEN 'nunca_abriu'
    WHEN v.ultimo_acesso_em AT TIME ZONE 'America/Sao_Paulo' >= (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo') THEN 'abriu_hoje'
    ELSE 'sem_acesso_hoje'
  END                                           AS status_acesso
FROM lojas_vendedoras v
WHERE v.ativa = true AND v.is_placeholder = false
ORDER BY v.nome;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Placeholder Tamara_admin pra receber push de admin
-- ───────────────────────────────────────────────────────────────────────────
-- Tamara e admin (acesso total), mas precisa receber lembrete de abrir o app
-- igual as vendedoras. Solucao: criar uma "vendedora" placeholder so pra ela.
-- is_placeholder=true → nao aparece nas listagens normais, nao recebe vendas,
-- nao tem carteira. Fica so como alvo de push.
-- Backend (api/lojas-push-register, api/lojas-push-touch) detecta user_id='tamara'
-- e redireciona automaticamente pra esta row.
INSERT INTO lojas_vendedoras (nome, loja, ativa, is_placeholder, is_padrao_loja, aliases, ordem_display)
VALUES ('Tamara_admin', 'Bom Retiro', true, true, false, ARRAY['TAMARA'], 99)
ON CONFLICT DO NOTHING;
