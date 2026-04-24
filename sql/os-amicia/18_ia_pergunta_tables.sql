-- ═══════════════════════════════════════════════════════════════════════════
-- 18_ia_pergunta_tables.sql — Sprint 8 · Módulo IA Perguntar
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Cria infra pra o módulo "Perguntar à IA" (botão global no cabeçalho do app):
--
-- 1. Tabela ia_pergunta_historico — log de TODAS as perguntas feitas
--    (isolado por user_id numérico, admin vê tudo, funcionário vê só as suas)
--
-- 2. Função fn_ia_pergunta_pool_hoje() — conta perguntas de não-admin do dia
--    corrente (timezone BRT). Usada pra aplicar o rate limit de 15/dia do pool
--    compartilhado de funcionários. Admin é ilimitado (não entra na contagem).
--
-- 3. Função fn_ia_pergunta_stats_dia() — estatísticas agregadas pro painel
--    admin (visão geral: total hoje, por categoria, custo acumulado).
--
-- Convenções do módulo:
--   - user_id = Date.now() do cadastro (numérico, único mesmo com nomes duplicados)
--   - categoria: 'estoque' | 'producao' | 'produto' | 'ficha' | 'outros'
--   - r_bloqueado: TRUE se filtrou campos R$ pra não-admin
--
-- Config fica em: amicia_data.user_id='ia-pergunta-config'.payload.config
-- (padrão igual ao SAC — evita tabela extra pra config que muda com frequência)
--
-- Idempotente: pode rodar várias vezes sem quebrar.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── TABELA PRINCIPAL: histórico de perguntas ─────────────────────────────
CREATE TABLE IF NOT EXISTS ia_pergunta_historico (
  id              BIGSERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL,
  user_name       TEXT NOT NULL,
  user_is_admin   BOOLEAN NOT NULL DEFAULT FALSE,
  pergunta        TEXT NOT NULL,
  resposta        TEXT,
  categoria       TEXT CHECK (categoria IN ('estoque','producao','produto','ficha','outros')),
  ref_detectada   TEXT,
  tokens_in       INTEGER DEFAULT 0,
  tokens_out      INTEGER DEFAULT 0,
  custo_brl       NUMERIC(10,4) DEFAULT 0,
  tempo_ms        INTEGER DEFAULT 0,
  r_bloqueado     BOOLEAN DEFAULT FALSE,
  erro            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices pros filtros típicos do painel admin
CREATE INDEX IF NOT EXISTS idx_ia_pergunta_user_date
  ON ia_pergunta_historico(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ia_pergunta_date
  ON ia_pergunta_historico(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ia_pergunta_categoria
  ON ia_pergunta_historico(categoria, created_at DESC)
  WHERE categoria IS NOT NULL;

-- Índice parcial pro rate-limit (só não-admin, pra query ficar rápida mesmo
-- quando admin acumular muitas perguntas)
CREATE INDEX IF NOT EXISTS idx_ia_pergunta_naoadmin_date
  ON ia_pergunta_historico(created_at DESC)
  WHERE user_is_admin = FALSE;


COMMENT ON TABLE  ia_pergunta_historico IS 'Log de perguntas do módulo IA Perguntar (Sprint 8). Admin vê tudo, funcionário só as suas via filtro user_id.';
COMMENT ON COLUMN ia_pergunta_historico.user_id       IS 'ID numérico Date.now() do cadastro (estável mesmo com usuarios duplicados)';
COMMENT ON COLUMN ia_pergunta_historico.r_bloqueado   IS 'TRUE se a resposta filtrou campos R$ por ser user não-admin';
COMMENT ON COLUMN ia_pergunta_historico.categoria     IS 'Classificação automática feita pelo backend: estoque|producao|produto|ficha|outros';


-- ── FUNÇÃO: conta perguntas do pool compartilhado (não-admin) no dia ─────
-- Usada pelo backend pra decidir se pode aceitar nova pergunta ou responder
-- "limite estourado". Admin nunca entra nessa contagem.
CREATE OR REPLACE FUNCTION fn_ia_pergunta_pool_hoje()
RETURNS INTEGER
LANGUAGE SQL STABLE
AS $$
  SELECT COUNT(*)::INTEGER
  FROM ia_pergunta_historico
  WHERE user_is_admin = FALSE
    AND erro IS NULL
    AND (created_at AT TIME ZONE 'America/Sao_Paulo')::DATE
      = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE;
$$;


-- ── FUNÇÃO: estatísticas agregadas do dia pro painel admin ──────────────
-- Retorna JSON com tudo que o card "Visão Geral" precisa em uma chamada só.
CREATE OR REPLACE FUNCTION fn_ia_pergunta_stats_dia()
RETURNS JSONB
LANGUAGE SQL STABLE
AS $$
  WITH hoje AS (
    SELECT *
    FROM ia_pergunta_historico
    WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')::DATE
        = (NOW() AT TIME ZONE 'America/Sao_Paulo')::DATE
      AND erro IS NULL
  ),
  mes AS (
    SELECT *
    FROM ia_pergunta_historico
    WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')
        >= DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
      AND erro IS NULL
  )
  SELECT jsonb_build_object(
    'hoje', jsonb_build_object(
      'total',         (SELECT COUNT(*) FROM hoje),
      'funcionarios',  (SELECT COUNT(*) FROM hoje WHERE user_is_admin = FALSE),
      'admin',         (SELECT COUNT(*) FROM hoje WHERE user_is_admin = TRUE),
      'pool_usado',    (SELECT COUNT(*) FROM hoje WHERE user_is_admin = FALSE),
      'tempo_medio_ms',(SELECT COALESCE(AVG(tempo_ms),0)::INTEGER FROM hoje),
      'por_categoria', (
        SELECT COALESCE(jsonb_object_agg(categoria, qtd), '{}'::jsonb)
        FROM (
          SELECT COALESCE(categoria,'outros') AS categoria, COUNT(*) AS qtd
          FROM hoje
          GROUP BY 1
        ) t
      ),
      'bloqueadas_r$', (SELECT COUNT(*) FROM hoje WHERE r_bloqueado = TRUE)
    ),
    'mes', jsonb_build_object(
      'total',         (SELECT COUNT(*) FROM mes),
      'custo_brl',     (SELECT COALESCE(SUM(custo_brl),0)::NUMERIC(10,2) FROM mes),
      'tokens_in',     (SELECT COALESCE(SUM(tokens_in),0)::BIGINT FROM mes),
      'tokens_out',    (SELECT COALESCE(SUM(tokens_out),0)::BIGINT FROM mes)
    ),
    'atualizado_em', (NOW() AT TIME ZONE 'America/Sao_Paulo')::TEXT
  );
$$;


-- ── FUNÇÃO: top N perguntas mais frequentes (últimos 7 dias) ────────────
-- Usada pelo card "Top perguntas da semana" do painel admin. Normaliza a
-- pergunta (lowercase + trim) pra agrupar variações pequenas de digitação.
CREATE OR REPLACE FUNCTION fn_ia_pergunta_top_semana(limite INTEGER DEFAULT 10)
RETURNS TABLE(pergunta_norm TEXT, categoria TEXT, vezes BIGINT, exemplo TEXT)
LANGUAGE SQL STABLE
AS $$
  SELECT
    LOWER(TRIM(pergunta))                           AS pergunta_norm,
    MODE() WITHIN GROUP (ORDER BY categoria)        AS categoria,
    COUNT(*)                                        AS vezes,
    (ARRAY_AGG(pergunta ORDER BY created_at DESC))[1] AS exemplo
  FROM ia_pergunta_historico
  WHERE (created_at AT TIME ZONE 'America/Sao_Paulo')
      >= (NOW() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '7 days'
    AND erro IS NULL
  GROUP BY LOWER(TRIM(pergunta))
  ORDER BY COUNT(*) DESC, MAX(created_at) DESC
  LIMIT limite;
$$;


-- ── FUNÇÃO: detecta usuários com nome duplicado ─────────────────────────
-- Usado pelo alerta do painel admin. Retorna lista de nomes que aparecem
-- em mais de 1 user_id no histórico (bug conhecido — ver handoff).
CREATE OR REPLACE FUNCTION fn_ia_pergunta_users_duplicados()
RETURNS TABLE(user_name TEXT, ids BIGINT[], qtd INTEGER)
LANGUAGE SQL STABLE
AS $$
  SELECT
    LOWER(TRIM(user_name))                 AS user_name,
    ARRAY_AGG(DISTINCT user_id)            AS ids,
    COUNT(DISTINCT user_id)::INTEGER       AS qtd
  FROM ia_pergunta_historico
  GROUP BY LOWER(TRIM(user_name))
  HAVING COUNT(DISTINCT user_id) > 1
  ORDER BY COUNT(DISTINCT user_id) DESC, LOWER(TRIM(user_name));
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- SMOKE TESTS (rodar manualmente no SQL Editor pra validar após deploy)
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT fn_ia_pergunta_pool_hoje();              -- deve retornar 0 no começo
-- SELECT fn_ia_pergunta_stats_dia();              -- JSON com zeros
-- SELECT * FROM fn_ia_pergunta_top_semana(5);     -- vazio
-- SELECT * FROM fn_ia_pergunta_users_duplicados();-- vazio
--
-- -- Insert fake pra testar:
-- INSERT INTO ia_pergunta_historico
--   (user_id, user_name, user_is_admin, pergunta, resposta, categoria, tempo_ms, custo_brl)
-- VALUES
--   (1712345678901, 'ana', FALSE, 'Tem 2277 bege M?', 'Sim, 12 pç', 'estoque', 1400, 0.03);
--
-- -- Depois verificar:
-- SELECT fn_ia_pergunta_pool_hoje();              -- agora 1
-- SELECT fn_ia_pergunta_stats_dia();              -- hoje.total = 1
-- ═══════════════════════════════════════════════════════════════════════════
