-- ═══════════════════════════════════════════════════════════════════════════
-- lojas-rls-aberto-leitura.sql — Permite leitura aberta nas tabelas Lojas
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Por quê: o app usa anon key (sem auth.uid). Políticas com 
-- auth.role()='authenticated' falham. Precisa USING (true) pra anon ler.
-- 
-- Escritas continuam restritas via Edge Functions usando service_role_key.
-- ═══════════════════════════════════════════════════════════════════════════

-- lojas_clientes
DROP POLICY IF EXISTS lojas_clientes_select_aberto ON lojas_clientes;
CREATE POLICY lojas_clientes_select_aberto ON lojas_clientes
  FOR SELECT USING (true);

-- lojas_clientes_kpis
DROP POLICY IF EXISTS lojas_clientes_kpis_select_aberto ON lojas_clientes_kpis;
CREATE POLICY lojas_clientes_kpis_select_aberto ON lojas_clientes_kpis
  FOR SELECT USING (true);

-- lojas_grupos
DROP POLICY IF EXISTS lojas_grupos_select_aberto ON lojas_grupos;
CREATE POLICY lojas_grupos_select_aberto ON lojas_grupos
  FOR SELECT USING (true);

-- lojas_vendas
DROP POLICY IF EXISTS lojas_vendas_select_aberto ON lojas_vendas;
CREATE POLICY lojas_vendas_select_aberto ON lojas_vendas
  FOR SELECT USING (true);

-- lojas_pedidos_sacola
DROP POLICY IF EXISTS lojas_pedidos_sacola_select_aberto ON lojas_pedidos_sacola;
CREATE POLICY lojas_pedidos_sacola_select_aberto ON lojas_pedidos_sacola
  FOR SELECT USING (true);

-- lojas_produtos
DROP POLICY IF EXISTS lojas_produtos_select_aberto ON lojas_produtos;
CREATE POLICY lojas_produtos_select_aberto ON lojas_produtos
  FOR SELECT USING (true);

-- lojas_produtos_curadoria
DROP POLICY IF EXISTS lojas_produtos_curadoria_select_aberto ON lojas_produtos_curadoria;
CREATE POLICY lojas_produtos_curadoria_select_aberto ON lojas_produtos_curadoria
  FOR SELECT USING (true);

-- lojas_promocoes
DROP POLICY IF EXISTS lojas_promocoes_select_aberto ON lojas_promocoes;
CREATE POLICY lojas_promocoes_select_aberto ON lojas_promocoes
  FOR SELECT USING (true);

-- lojas_sugestoes_diarias
DROP POLICY IF EXISTS lojas_sugestoes_diarias_select_aberto ON lojas_sugestoes_diarias;
CREATE POLICY lojas_sugestoes_diarias_select_aberto ON lojas_sugestoes_diarias
  FOR SELECT USING (true);

-- lojas_acoes
DROP POLICY IF EXISTS lojas_acoes_select_aberto ON lojas_acoes;
CREATE POLICY lojas_acoes_select_aberto ON lojas_acoes
  FOR SELECT USING (true);

-- lojas_importacoes
DROP POLICY IF EXISTS lojas_importacoes_select_aberto ON lojas_importacoes;
CREATE POLICY lojas_importacoes_select_aberto ON lojas_importacoes
  FOR SELECT USING (true);

-- lojas_config
DROP POLICY IF EXISTS lojas_config_select_aberto ON lojas_config;
CREATE POLICY lojas_config_select_aberto ON lojas_config
  FOR SELECT USING (true);

-- lojas_admins (precisa pra função ehAdmin)
DROP POLICY IF EXISTS lojas_admins_select_aberto ON lojas_admins;
CREATE POLICY lojas_admins_select_aberto ON lojas_admins
  FOR SELECT USING (true);

-- ─── Verificação ────────────────────────────────────────────────────────────

SELECT 
  tablename,
  COUNT(*) FILTER (WHERE policyname LIKE '%select_aberto%') AS politica_aberta
FROM pg_policies
WHERE tablename LIKE 'lojas_%'
GROUP BY tablename
ORDER BY tablename;
