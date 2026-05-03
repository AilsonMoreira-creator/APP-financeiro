-- ═══════════════════════════════════════════════════════════════════════════
-- APRENDIZADO DE ESTILO DA VENDEDORA — Sessão Ailson 04/05/2026
-- ═══════════════════════════════════════════════════════════════════════════
-- Quando vendedora edita mensagem da IA antes de enviar, salvamos a edicao
-- pra IA aprender:
--   - Saudacao inicial preferida (Oi, Oii, Olá, Bom dia...)
--   - Saudacao final / fechamento (bjs, beijos, abraços)
--   - Tratamento (querida, linda, [primeiro_nome])
--   - Emojis frequentes
-- A cada N edicoes, IA "calibra" o estilo dela usando exemplos reais.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Tabela lojas_edicoes_mensagens — audit completo das edicoes
-- ───────────────────────────────────────────────────────────────────────────
-- Guarda TODAS as edicoes feitas pela vendedora pra usar como exemplos
-- few-shot no prompt da IA na proxima geracao de mensagem.
-- Tambem permite analise: quais palavras a vendedora sempre adiciona/remove.
CREATE TABLE IF NOT EXISTS lojas_edicoes_mensagens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedora_id    uuid NOT NULL REFERENCES lojas_vendedoras(id) ON DELETE CASCADE,
  sugestao_id     uuid REFERENCES lojas_sugestoes_diarias(id) ON DELETE SET NULL,
  cliente_id      uuid REFERENCES lojas_clientes(id) ON DELETE SET NULL,
  texto_original  text NOT NULL,    -- mensagem como IA gerou
  texto_editado   text NOT NULL,    -- mensagem como vendedora salvou
  criado_em       timestamptz NOT NULL DEFAULT now(),
  user_id         text              -- quem editou (vendedora logada)
);

CREATE INDEX IF NOT EXISTS idx_edicoes_vendedora_data
  ON lojas_edicoes_mensagens(vendedora_id, criado_em DESC);

ALTER TABLE lojas_edicoes_mensagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_edicoes_select" ON lojas_edicoes_mensagens;
DROP POLICY IF EXISTS "lojas_edicoes_modify" ON lojas_edicoes_mensagens;
CREATE POLICY "lojas_edicoes_select" ON lojas_edicoes_mensagens FOR SELECT USING (true);
CREATE POLICY "lojas_edicoes_modify" ON lojas_edicoes_mensagens FOR ALL USING (true) WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Tabela lojas_estilo_vendedora — perfil de estilo agregado
-- ───────────────────────────────────────────────────────────────────────────
-- 1 row por vendedora. Atualizada toda vez que ela edita uma mensagem.
-- Guarda os "tops" de cada categoria pro prompt incluir como referencia.
-- Estrutura: jsonb com counters {item: count} pra facilitar atualizacao.
CREATE TABLE IF NOT EXISTS lojas_estilo_vendedora (
  vendedora_id          uuid PRIMARY KEY REFERENCES lojas_vendedoras(id) ON DELETE CASCADE,
  saudacao_inicial      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"Oii": 5, "Bom dia": 2, ...}
  saudacao_final        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"bjs": 8, "beijos": 3, ...}
  tratamento            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"querida": 6, "linda": 2, ...}
  emojis                jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"💕": 12, "🌸": 4, ...}
  qtd_edicoes           int NOT NULL DEFAULT 0,
  ultima_edicao_em      timestamptz,
  ultima_atualizacao    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lojas_estilo_vendedora ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_estilo_select" ON lojas_estilo_vendedora;
DROP POLICY IF EXISTS "lojas_estilo_modify" ON lojas_estilo_vendedora;
CREATE POLICY "lojas_estilo_select" ON lojas_estilo_vendedora FOR SELECT USING (true);
CREATE POLICY "lojas_estilo_modify" ON lojas_estilo_vendedora FOR ALL USING (true) WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. View pro prompt: top 3 de cada categoria + ultimas 5 edicoes (few-shot)
-- ───────────────────────────────────────────────────────────────────────────
-- Backend ler dessa view pra incluir no prompt sem ter que processar JSON.
-- (Postgres jsonb_each + ORDER BY value DESC LIMIT 3 dentro da view fica
-- complicado, entao deixamos a logica de "top 3" no backend mesmo. View
-- so unifica os dados.)
CREATE OR REPLACE VIEW vw_lojas_estilo_completo AS
SELECT
  v.id                          AS vendedora_id,
  v.nome                        AS vendedora_nome,
  COALESCE(e.saudacao_inicial, '{}'::jsonb) AS saudacao_inicial,
  COALESCE(e.saudacao_final, '{}'::jsonb)   AS saudacao_final,
  COALESCE(e.tratamento, '{}'::jsonb)       AS tratamento,
  COALESCE(e.emojis, '{}'::jsonb)           AS emojis,
  COALESCE(e.qtd_edicoes, 0)                AS qtd_edicoes,
  e.ultima_edicao_em
FROM lojas_vendedoras v
LEFT JOIN lojas_estilo_vendedora e ON e.vendedora_id = v.id
WHERE v.ativa = true;
