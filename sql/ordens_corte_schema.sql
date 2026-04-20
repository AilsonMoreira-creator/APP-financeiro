-- =====================================================================
-- FASE A · Sala de Corte · Schema Ordens de Corte
-- Versão: 1.0 · Data: 20/04/2026
-- Grupo Amícia · App Financeiro v6.8
-- =====================================================================
--
-- COMO RODAR:
--   1. Supabase → SQL Editor → New query
--   2. Colar este arquivo INTEIRO
--   3. Run
--   4. Verificar mensagem de sucesso (esperado: ~5s)
--
-- REVERSÍVEL: bloco DROP comentado no final
-- IDEMPOTENTE: usa IF NOT EXISTS, pode rodar 2x sem quebrar
-- =====================================================================


-- ─── Tabela 1: ordens_corte (principal) ──────────────────────────────
CREATE TABLE IF NOT EXISTS ordens_corte (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificação do produto (vem do cadastro Oficinas)
  ref TEXT NOT NULL,
  descricao TEXT,
  tecido TEXT NOT NULL,
  grupo INTEGER CHECK (grupo IS NULL OR (grupo >= 0 AND grupo <= 9)),

  -- Detalhamento do corte
  grade JSONB NOT NULL,            -- ex: {"P": 1, "G": 1, "GG": 2}
  cores JSONB NOT NULL,            -- ex: [{"nome":"Preto","rolos":3,"hex":"#1c1c1c"}]
  total_rolos INTEGER NOT NULL CHECK (total_rolos > 0),

  -- Status (lifecycle)
  status TEXT NOT NULL DEFAULT 'aguardando'
    CHECK (status IN ('aguardando','separado','na_sala','concluido','cancelado')),

  -- Origem (manual hoje, IA na Fase B)
  origem TEXT NOT NULL DEFAULT 'manual'
    CHECK (origem IN ('manual','os_amicia')),
  insight_id UUID,                 -- preenche só se origem='os_amicia' (Fase B)

  -- Execução (preenche conforme avança no fluxo)
  sala TEXT,                       -- Antonio | Adalecio | Chico | (outras)
  separado_por TEXT,               -- usuário que confirmou tecido separado
  separado_em TIMESTAMPTZ,
  enviado_sala_em TIMESTAMPTZ,
  concluido_em TIMESTAMPTZ,        -- preenche AUTO quando corte vinculado fecha
  corte_id BIGINT,                 -- vínculo ao corte criado em salas-corte (id = Date.now())

  -- Auditoria leve
  motivo_exclusao TEXT,
  motivo_edicao TEXT,

  -- Autoria
  criada_por TEXT NOT NULL,        -- usuarioLogado.usuario
  aprovada_por TEXT,               -- preenche só se origem='os_amicia'
  aprovacao_tipo TEXT CHECK (aprovacao_tipo IS NULL OR aprovacao_tipo IN ('sim','editar')),

  -- Validade (só ordens vindas da IA expiram)
  validade_ate TIMESTAMPTZ,

  -- Concorrência (optimistic locking)
  version INTEGER NOT NULL DEFAULT 1,

  -- Timestamps automáticos
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─── Índices pra performance ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ordens_corte_status
  ON ordens_corte(status);

CREATE INDEX IF NOT EXISTS idx_ordens_corte_ref
  ON ordens_corte(ref);

CREATE INDEX IF NOT EXISTS idx_ordens_corte_origem
  ON ordens_corte(origem);

CREATE INDEX IF NOT EXISTS idx_ordens_corte_created
  ON ordens_corte(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ordens_corte_corte_id
  ON ordens_corte(corte_id) WHERE corte_id IS NOT NULL;

-- Índice composto: usado pela busca "tem ordem na_sala pra essa ref+sala?"
CREATE INDEX IF NOT EXISTS idx_ordens_corte_ref_sala_status
  ON ordens_corte(ref, sala, status) WHERE status = 'na_sala';


-- ─── Tabela 2: ordens_corte_historico (auditoria) ────────────────────
CREATE TABLE IF NOT EXISTS ordens_corte_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem_id UUID NOT NULL REFERENCES ordens_corte(id) ON DELETE CASCADE,
  acao TEXT NOT NULL
    CHECK (acao IN ('criada','editada','status_alterado','tecido_separado',
                    'sala_definida','concluida','excluida','cores_editadas')),
  payload_antes JSONB,
  payload_depois JSONB,
  motivo TEXT,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ordens_hist_ordem
  ON ordens_corte_historico(ordem_id);

CREATE INDEX IF NOT EXISTS idx_ordens_hist_created
  ON ordens_corte_historico(created_at DESC);


-- ─── Trigger: auto-update updated_at + version a cada UPDATE ─────────
CREATE OR REPLACE FUNCTION ordens_corte_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.version = OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ordens_corte_touch ON ordens_corte;
CREATE TRIGGER trg_ordens_corte_touch
  BEFORE UPDATE ON ordens_corte
  FOR EACH ROW
  EXECUTE FUNCTION ordens_corte_touch();


-- ─── RLS: NÃO HABILITADO nesta fase (decisão consciente) ─────────────
-- Justificativa: o app hoje não usa Supabase Auth — usa usuarioLogado em
-- memória + anon key. Habilitar RLS agora quebraria 100% das queries.
-- O controle real de acesso fica nos endpoints (admin-only no backend).
--
-- Quando migrar pra Supabase Auth (Sprint futuro), descomentar:
--
-- ALTER TABLE ordens_corte ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ordens_corte_historico ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY ordens_corte_all ON ordens_corte
--   FOR ALL USING (auth.role() = 'authenticated');
-- CREATE POLICY ordens_corte_hist_all ON ordens_corte_historico
--   FOR ALL USING (auth.role() = 'authenticated');


-- ─── Realtime: habilitar pra tabela principal ────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE ordens_corte;


-- =====================================================================
-- VALIDAÇÃO RÁPIDA (descomentar pra testar antes de implementar UI)
-- =====================================================================
--
-- INSERT INTO ordens_corte (ref, descricao, tecido, grade, cores, total_rolos, criada_por)
-- VALUES (
--   'TESTE-001',
--   'Teste de criação',
--   'Linho sem elastano',
--   '{"P": 1, "G": 1, "GG": 2}'::jsonb,
--   '[{"nome":"Preto","rolos":3,"hex":"#1c1c1c"}]'::jsonb,
--   3,
--   'admin'
-- );
--
-- SELECT id, ref, status, version, created_at, updated_at
-- FROM ordens_corte WHERE ref = 'TESTE-001';
--
-- -- testa o trigger (version deve ir pra 2):
-- UPDATE ordens_corte SET grupo = 1 WHERE ref = 'TESTE-001';
-- SELECT version, updated_at FROM ordens_corte WHERE ref = 'TESTE-001';
--
-- -- limpa o teste:
-- DELETE FROM ordens_corte WHERE ref = 'TESTE-001';


-- =====================================================================
-- ROLLBACK COMPLETO (descomentar e rodar se precisar desfazer TUDO)
-- =====================================================================
--
-- DROP TABLE IF EXISTS ordens_corte_historico CASCADE;
-- DROP TABLE IF EXISTS ordens_corte CASCADE;
-- DROP FUNCTION IF EXISTS ordens_corte_touch();
-- ALTER PUBLICATION supabase_realtime DROP TABLE ordens_corte;
