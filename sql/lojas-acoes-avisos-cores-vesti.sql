-- ═══════════════════════════════════════════════════════════════════════════
-- AÇÕES, AVISOS, CORES MANUAIS, LINKS VESTI
-- Sessão Ailson 30/04/2026 — pacote único pra rodar de uma vez
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- TRIGGER timestamp util (cria se não existir)
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'lojas_atualizar_timestamp') THEN
    CREATE FUNCTION lojas_atualizar_timestamp() RETURNS trigger AS $f$
    BEGIN
      NEW.atualizado_em := now();
      RETURN NEW;
    END;
    $f$ LANGUAGE plpgsql;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. AÇÕES (mensagens contextuais por período)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lojas_acoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  texto           text NOT NULL,
  data_inicio     date NOT NULL,
  data_fim        date NOT NULL,
  ativa           boolean NOT NULL DEFAULT true,
  criado_por      text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CHECK (data_fim >= data_inicio),
  CHECK (length(trim(texto)) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_lojas_acoes_periodo
  ON lojas_acoes (data_inicio, data_fim) WHERE ativa = true;

DROP TRIGGER IF EXISTS trg_lojas_acoes_timestamp ON lojas_acoes;
CREATE TRIGGER trg_lojas_acoes_timestamp
  BEFORE UPDATE ON lojas_acoes
  FOR EACH ROW EXECUTE FUNCTION lojas_atualizar_timestamp();

ALTER TABLE lojas_acoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_acoes_select_all" ON lojas_acoes;
DROP POLICY IF EXISTS "lojas_acoes_modify_all" ON lojas_acoes;
CREATE POLICY "lojas_acoes_select_all" ON lojas_acoes FOR SELECT USING (true);
CREATE POLICY "lojas_acoes_modify_all" ON lojas_acoes FOR ALL    USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. AVISOS (disparo único pra vendedora)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lojas_avisos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  texto           text NOT NULL,
  data_disparo    date NOT NULL,
  vendedoras_ids  uuid[],
  cliente_id      uuid REFERENCES lojas_clientes(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'consumido', 'cancelado')),
  consumido_em    timestamptz,
  criado_por      text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(texto)) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_lojas_avisos_disparo_pendente
  ON lojas_avisos (data_disparo) WHERE status = 'pendente';

DROP TRIGGER IF EXISTS trg_lojas_avisos_timestamp ON lojas_avisos;
CREATE TRIGGER trg_lojas_avisos_timestamp
  BEFORE UPDATE ON lojas_avisos
  FOR EACH ROW EXECUTE FUNCTION lojas_atualizar_timestamp();

ALTER TABLE lojas_avisos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_avisos_select_all" ON lojas_avisos;
DROP POLICY IF EXISTS "lojas_avisos_modify_all" ON lojas_avisos;
CREATE POLICY "lojas_avisos_select_all" ON lojas_avisos FOR SELECT USING (true);
CREATE POLICY "lojas_avisos_modify_all" ON lojas_avisos FOR ALL    USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. CORES MANUAIS (auto vem de vw_ranking_cores_catalogo)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lojas_cores_curadoria_manual (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cor_key         text NOT NULL UNIQUE,
  cor             text NOT NULL,
  motivo          text,
  ativa           boolean NOT NULL DEFAULT true,
  criado_por      text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CHECK (length(trim(cor_key)) >= 2)
);

DROP TRIGGER IF EXISTS trg_lojas_cores_manual_timestamp ON lojas_cores_curadoria_manual;
CREATE TRIGGER trg_lojas_cores_manual_timestamp
  BEFORE UPDATE ON lojas_cores_curadoria_manual
  FOR EACH ROW EXECUTE FUNCTION lojas_atualizar_timestamp();

ALTER TABLE lojas_cores_curadoria_manual ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_cores_select_all" ON lojas_cores_curadoria_manual;
DROP POLICY IF EXISTS "lojas_cores_modify_all" ON lojas_cores_curadoria_manual;
CREATE POLICY "lojas_cores_select_all" ON lojas_cores_curadoria_manual FOR SELECT USING (true);
CREATE POLICY "lojas_cores_modify_all" ON lojas_cores_curadoria_manual FOR ALL    USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. LINKS VESTI por vendedora
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE lojas_vendedoras
  ADD COLUMN IF NOT EXISTS vesti_link_1     text,
  ADD COLUMN IF NOT EXISTS vesti_link_2     text,
  ADD COLUMN IF NOT EXISTS vesti_link_3     text,
  ADD COLUMN IF NOT EXISTS vesti_link_ativo int;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'lojas_vendedoras_vesti_link_ativo_check'
  ) THEN
    ALTER TABLE lojas_vendedoras
      ADD CONSTRAINT lojas_vendedoras_vesti_link_ativo_check
      CHECK (vesti_link_ativo IS NULL OR vesti_link_ativo IN (1, 2, 3));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. ATUALIZAR CHECK de lojas_sugestoes_diarias.tipo
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE lojas_sugestoes_diarias DROP CONSTRAINT IF EXISTS lojas_sugestoes_diarias_tipo_check;
ALTER TABLE lojas_sugestoes_diarias ADD CONSTRAINT lojas_sugestoes_diarias_tipo_check
  CHECK (tipo IN ('reativar','atencao','novidade','followup','followup_nova','sacola','reposicao','aviso_admin'));
