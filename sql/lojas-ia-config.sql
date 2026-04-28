-- =====================================================================
-- lojas-ia-config.sql · Configurações iniciais do módulo Lojas IA
-- =====================================================================
--
-- Roda este arquivo INTEIRO no Supabase SQL Editor APÓS o deploy da
-- Parte 3 (api/lojas-ia.js no Vercel).
--
-- IDEMPOTENTE: usa ON CONFLICT, pode rodar 2x sem quebrar.
--
-- O que faz:
--   1. Sobe orçamento global de IA pra R$ 200/mês
--      (afeta IA Pergunta + Lojas — tabela compartilhada ia_config)
--   2. Garante que lojas_config tem modelo_ia, rate_limit_ms e cache_ttl
--      (já vêm do schema da Parte 1, mas reforçamos defaults)
-- =====================================================================


-- ─── 1. Orçamento global mensal ──────────────────────────────────────
-- Antes era R$ 80 (default do _ia-helpers.js da IA Pergunta).
-- Sobe pra R$ 200 pra acomodar Lojas IA também.
INSERT INTO ia_config (chave, valor, descricao, tipo, updated_by)
VALUES (
  'orcamento_brl_mensal',
  to_jsonb(200),
  'Orçamento mensal global em BRL pra IA (compartilhado entre IA Pergunta + Lojas IA).',
  'number',
  'sistema'
)
ON CONFLICT (chave) DO UPDATE
SET valor = to_jsonb(200),
    descricao = EXCLUDED.descricao,
    updated_at = now(),
    updated_by = 'sistema';


-- ─── 2. Taxa USD→BRL (se ainda não tiver) ────────────────────────────
INSERT INTO ia_config (chave, valor, descricao, tipo, updated_by)
VALUES (
  'taxa_usd_brl',
  to_jsonb(5.25),
  'Taxa USD→BRL pra calcular custo. Atualizar mensalmente se variar muito.',
  'number',
  'sistema'
)
ON CONFLICT (chave) DO NOTHING;


-- ─── 3. Configurações do módulo Lojas (reforço dos defaults) ────────
-- Já vêm do schema da Parte 1 mas garante que estão lá

INSERT INTO lojas_config (chave, valor, descricao, tipo, updated_by)
VALUES
  ('modelo_ia',             '"claude-sonnet-4-6"',  'Modelo Anthropic usado pelo Lojas IA',         'string',  'sistema'),
  ('rate_limit_ms',         '3000',                 'Mínimo entre chamadas IA por vendedora (ms)',  'number',  'sistema'),
  ('cache_ttl_seconds',     '300',                  'TTL do cache de mensagem gerada (segundos)',   'number',  'sistema')
ON CONFLICT (chave) DO NOTHING;


-- ─── 4. Verificação ──────────────────────────────────────────────────
-- Roda essas queries depois pra confirmar que tudo está como esperado:
--
-- SELECT chave, valor FROM ia_config WHERE chave IN ('orcamento_brl_mensal', 'taxa_usd_brl');
-- SELECT chave, valor FROM lojas_config WHERE chave IN ('modelo_ia', 'rate_limit_ms', 'cache_ttl_seconds');
