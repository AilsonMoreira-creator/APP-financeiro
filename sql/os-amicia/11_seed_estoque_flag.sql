-- =====================================================================
-- OS Amicia - Sprint 6.1 Fase 3 - Flag de ativacao do escopo estoque
-- Versao: 1.0 - Data: 21/04/2026
-- Grupo Amicia - App Financeiro v6.8
-- =====================================================================
--
-- COMO RODAR:
--   1. Supabase -> SQL Editor -> New query
--   2. Colar e executar
--
-- IDEMPOTENTE: ON CONFLICT DO NOTHING. Se ja existir, nao sobrescreve.
-- ASCII PURO.
--
-- PROPOSITO:
-- Adiciona a flag estoque_enabled em ia_config. Comeca DESLIGADA (false).
-- O kill switch em api/ia-cron.js checa essa flag antes de rodar o
-- escopo=estoque. Se flag != true, o cron retorna 200 imediatamente com
-- modo='disabled' e nao chama RPC, nao chama Claude, nao grava insights.
--
-- COMO LIGAR (DEPOIS da validacao manual):
--   UPDATE ia_config SET valor = 'true'::jsonb, updated_at = NOW()
--   WHERE chave = 'estoque_enabled';
--
-- COMO DESLIGAR EM EMERGENCIA:
--   UPDATE ia_config SET valor = 'false'::jsonb, updated_at = NOW()
--   WHERE chave = 'estoque_enabled';
-- =====================================================================

INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  (
    'estoque_enabled',
    'false'::jsonb,
    'Kill switch do escopo estoque no ia-cron. Comeca false; ligar manualmente apos validacao do Sprint 6.1.',
    'boolean'
  )
ON CONFLICT (chave) DO NOTHING;

-- Verificacao apos rodar:
--   SELECT chave, valor, descricao FROM ia_config WHERE chave = 'estoque_enabled';
-- Esperado: 1 linha, valor=false.
