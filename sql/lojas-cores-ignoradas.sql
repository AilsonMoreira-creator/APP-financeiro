-- ═══════════════════════════════════════════════════════════════════════════
-- LOJAS_CORES_IGNORADAS
-- Cores do Top Bling que admin NAO quer que a IA mencione.
-- Sessao Ailson 30/04/2026 - chips clicaveis na aba Cores da Curadoria.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS lojas_cores_ignoradas (
  cor_key       text PRIMARY KEY,
  cor           text NOT NULL,
  motivo        text,
  ignorado_por  text,
  ignorado_em   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE lojas_cores_ignoradas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_cores_ig_select" ON lojas_cores_ignoradas;
DROP POLICY IF EXISTS "lojas_cores_ig_modify" ON lojas_cores_ignoradas;
CREATE POLICY "lojas_cores_ig_select" ON lojas_cores_ignoradas FOR SELECT USING (true);
CREATE POLICY "lojas_cores_ig_modify" ON lojas_cores_ignoradas FOR ALL    USING (true) WITH CHECK (true);
