-- ═══════════════════════════════════════════════════════════════════════════
-- lojas-drive-importacao.sql — Migração pra Parte 5 (importação Drive)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Como rodar:
--   1. Abra o Supabase SQL Editor
--   2. Cole esse arquivo inteiro
--   3. Run
--
-- Idempotente: pode rodar múltiplas vezes sem efeito colateral
-- (todas as alterações usam IF NOT EXISTS).
--
-- O que faz:
--   1. ALTER TABLE em lojas_clientes_kpis: adiciona classificacao_abc
--   2. Cria índices úteis pra performance da carga inicial
--   3. Insere config defaults em lojas_config
--   4. Cria view auxiliar pra dashboard de importações
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. ALTER TABLES ───────────────────────────────────────────────────────

-- Adiciona classificacao_abc em kpis (vem do relatorio_vendas_clientes)
ALTER TABLE lojas_clientes_kpis
  ADD COLUMN IF NOT EXISTS classificacao_abc text
  CHECK (classificacao_abc IS NULL OR classificacao_abc IN ('A','B','C'));

CREATE INDEX IF NOT EXISTS idx_kpis_abc ON lojas_clientes_kpis(classificacao_abc)
  WHERE classificacao_abc IS NOT NULL;

-- ─── 2. ÍNDICES DE PERFORMANCE PRA CARGA INICIAL ────────────────────────────

-- Vendas: chave de dedup já existe (numero_pedido, loja). Adiciona índice
-- por documento_cliente_raw pra acelerar JOIN com lojas_clientes na carga
CREATE INDEX IF NOT EXISTS idx_vendas_doc_raw 
  ON lojas_vendas(documento_cliente_raw)
  WHERE documento_cliente_raw IS NOT NULL;

-- Pedidos sacola: índice por documento_raw pra mesma resolução
CREATE INDEX IF NOT EXISTS idx_sacola_doc_raw 
  ON lojas_pedidos_sacola(documento_raw)
  WHERE documento_raw IS NOT NULL;

-- Importações: filtro frequente por (tipo, status, data) pra dashboard
CREATE INDEX IF NOT EXISTS idx_importacoes_tipo_data
  ON lojas_importacoes(tipo_arquivo, iniciada_em DESC);

-- ─── 3. CONFIGURAÇÕES DEFAULT ──────────────────────────────────────────────
-- (lojas_config já existe. Adiciona chaves específicas da importação)

INSERT INTO lojas_config (chave, valor, descricao)
VALUES
  (
    'drive_pasta_id',
    to_jsonb(COALESCE(current_setting('app.drive_folder_id', true), '')),
    'ID da pasta raiz lojas_app/ no Google Drive (também em GOOGLE_DRIVE_FOLDER_ID env)'
  ),
  (
    'drive_corte_historico',
    '"2025-01-01"'::jsonb,
    'Data de corte do histórico de vendas: nada anterior é importado'
  ),
  (
    'drive_estoque_min_oferecer',
    '100'::jsonb,
    'Estoque mínimo de produto pra entrar em ofertas gerais (regra do briefing)'
  ),
  (
    'drive_lote_upsert',
    '500'::jsonb,
    'Tamanho do lote em upserts em massa (Supabase aguenta bem 500-1000)'
  ),
  (
    'drive_ultima_sincronizacao',
    'null'::jsonb,
    'ISO timestamp da última sincronização semanal bem-sucedida (atualizado pelo cron)'
  )
ON CONFLICT (chave) DO NOTHING;

-- ─── 4. VIEW DE DASHBOARD DE IMPORTAÇÕES ───────────────────────────────────

CREATE OR REPLACE VIEW vw_lojas_importacoes_recentes AS
SELECT
  i.id,
  i.nome_arquivo,
  i.tipo_arquivo,
  i.loja,
  i.status,
  i.registros_total,
  i.registros_inseridos,
  i.registros_ignorados,
  i.detalhes_ignorados,
  i.erro,
  i.iniciada_em,
  i.finalizada_em,
  i.duracao_ms,
  CASE
    WHEN i.duracao_ms IS NULL THEN NULL
    ELSE round(i.duracao_ms::numeric / 1000, 1)
  END AS duracao_segundos,
  i.iniciada_por
FROM lojas_importacoes i
WHERE i.iniciada_em > now() - interval '30 days'
ORDER BY i.iniciada_em DESC;

-- ─── 5. FUNÇÃO HELPER: KPI agregado de importações da semana ───────────────

CREATE OR REPLACE FUNCTION fn_lojas_importacoes_semana()
RETURNS TABLE (
  total_jobs       bigint,
  total_sucessos   bigint,
  total_erros      bigint,
  total_registros  bigint,
  total_ignorados  bigint,
  ultima_em        timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    count(*)                                                AS total_jobs,
    count(*) FILTER (WHERE status = 'sucesso')              AS total_sucessos,
    count(*) FILTER (WHERE status = 'erro')                 AS total_erros,
    coalesce(sum(registros_total), 0)                       AS total_registros,
    coalesce(sum(registros_ignorados), 0)                   AS total_ignorados,
    max(iniciada_em)                                        AS ultima_em
  FROM lojas_importacoes
  WHERE iniciada_em > now() - interval '7 days';
$$;

-- ─── 6. NOTA DE REVISÃO MANUAL ─────────────────────────────────────────────
-- Confirma se rodou:
SELECT
  'classificacao_abc adicionada' AS check,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'lojas_clientes_kpis'
      AND column_name = 'classificacao_abc'
  ) AS ok
UNION ALL
SELECT 'configs inseridas',
  (SELECT count(*) >= 5 FROM lojas_config WHERE chave LIKE 'drive_%')
UNION ALL
SELECT 'view criada',
  EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'vw_lojas_importacoes_recentes');
