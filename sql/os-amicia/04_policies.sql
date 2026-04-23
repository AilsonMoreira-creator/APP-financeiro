-- =====================================================================
-- OS Amícia · Fase 1 · Row Level Security das 7 tabelas novas
-- Versão: 1.0 · Data: 21/04/2026
-- =====================================================================
--
-- RODAR DEPOIS de 01_tables.sql.
--
-- NOTA: o app Amícia usa anon key no frontend + service role no
-- backend (cron, endpoints). A estratégia é:
--
--   ANON (frontend) → só SELECT em tabelas públicas (ex: ia_config pra
--                     ler thresholds). WRITE via endpoint serverless.
--   SERVICE (backend) → bypass RLS total (cron escreve livremente).
--
-- Portanto o RLS aqui é uma **segunda camada** de defesa caso alguém
-- acidentalmente use o anon key pra gravar.
--
-- O controle de admin-only é feito **no endpoint serverless** (não RLS),
-- porque o app não tem auth do Supabase — a identidade do admin vive
-- em localStorage e é validada via header/body em cada requisição.
-- =====================================================================


-- Ativar RLS em todas as tabelas novas
ALTER TABLE ia_insights             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_feedback             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_config               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_usage                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ia_sazonalidade         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ml_vendas_lucro_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE calc_historico_snapshot  ENABLE ROW LEVEL SECURITY;


-- ─── ia_config: leitura pública (frontend precisa ler thresholds) ──
DROP POLICY IF EXISTS ia_config_select_anon ON ia_config;
CREATE POLICY ia_config_select_anon ON ia_config
  FOR SELECT
  USING (true);


-- ─── ia_sazonalidade: leitura pública ──────────────────────────────
DROP POLICY IF EXISTS ia_sazonalidade_select_anon ON ia_sazonalidade;
CREATE POLICY ia_sazonalidade_select_anon ON ia_sazonalidade
  FOR SELECT
  USING (true);


-- ─── ia_insights: leitura pública restrita a não-críticos admin-only
-- Em v1 só admin acessa a Home/feed. Mas se o anon key tentar ler
-- diretamente, bloqueia. Rota oficial é via endpoint serverless.
DROP POLICY IF EXISTS ia_insights_deny_anon ON ia_insights;
CREATE POLICY ia_insights_deny_anon ON ia_insights
  FOR SELECT
  USING (false);


-- ─── ia_feedback: fechado pro anon ─────────────────────────────────
DROP POLICY IF EXISTS ia_feedback_deny_anon ON ia_feedback;
CREATE POLICY ia_feedback_deny_anon ON ia_feedback
  FOR ALL
  USING (false);


-- ─── ia_usage: fechado pro anon ────────────────────────────────────
DROP POLICY IF EXISTS ia_usage_deny_anon ON ia_usage;
CREATE POLICY ia_usage_deny_anon ON ia_usage
  FOR ALL
  USING (false);


-- ─── ml_vendas_lucro_snapshot: fechadíssimo (Card 1 admin) ─────────
DROP POLICY IF EXISTS ml_vendas_lucro_deny_anon ON ml_vendas_lucro_snapshot;
CREATE POLICY ml_vendas_lucro_deny_anon ON ml_vendas_lucro_snapshot
  FOR ALL
  USING (false);


-- ─── calc_historico_snapshot: fechado pro anon ─────────────────────
DROP POLICY IF EXISTS calc_snap_deny_anon ON calc_historico_snapshot;
CREATE POLICY calc_snap_deny_anon ON calc_historico_snapshot
  FOR ALL
  USING (false);


-- =====================================================================
-- IMPORTANTE: service_role key bypassa RLS automaticamente.
-- Os endpoints serverless usam service_role (não anon), então os
-- endpoints podem escrever normal. Frontend nunca escreve direto.
-- =====================================================================
