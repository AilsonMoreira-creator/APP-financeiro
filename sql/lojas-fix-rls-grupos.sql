-- ═══════════════════════════════════════════════════════════════════════════
-- LOJAS — Liberar RLS pra TODAS tabelas Lojas (escrita via anon key)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA: as policies criadas no schema usam auth.uid()::text, mas o app
-- usa anon key (sem Supabase Auth próprio). Resultado: auth.uid() retorna
-- null, lojas_eh_admin(null) retorna false, e qualquer INSERT/UPDATE pelo
-- frontend é bloqueado.
--
-- Sintomas reportados:
--   - 'new row violates row-level security policy for table "lojas_grupos"'
--   - 'new row violates row-level security policy for table "lojas_promocoes"'
--   - (e provavelmente outros que ainda nao testou)
--
-- SOLUÇÃO: policy permissiva 'app_full_access' em TODAS tabelas Lojas.
-- Segurança permanece na camada da aplicação (login + filtros explícitos
-- de vendedora_id no código frontend), igual já era pras tabelas que
-- funcionavam.
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'lojas_admins',
    'lojas_vendedoras',
    'lojas_grupos',
    'lojas_clientes',
    'lojas_clientes_kpis',
    'lojas_vendas',
    'lojas_pedidos_sacola',
    'lojas_produtos',
    'lojas_produtos_curadoria',
    'lojas_promocoes',
    'lojas_sugestoes_diarias',
    'lojas_ia_chamadas_log',
    'lojas_importacoes',
    'lojas_carteira_historico',
    'lojas_acoes',
    'lojas_agenda',
    'lojas_config'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS app_full_access ON %I;
      CREATE POLICY app_full_access ON %I
        FOR ALL
        USING (true)
        WITH CHECK (true);
    ', t, t);
  END LOOP;
END $$;

-- Validação:
--   SELECT tablename, policyname, cmd
--   FROM pg_policies
--   WHERE schemaname = 'public' AND tablename LIKE 'lojas_%'
--   ORDER BY tablename, policyname;
