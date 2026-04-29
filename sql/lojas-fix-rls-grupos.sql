-- ═══════════════════════════════════════════════════════════════════════════
-- LOJAS — Liberar RLS pra tabelas que vendedora precisa ESCREVER
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA: as policies criadas no schema usam auth.uid()::text, mas o app
-- usa anon key (sem Supabase Auth próprio). Resultado: auth.uid() retorna
-- null, lojas_eh_admin(null) retorna false, e o INSERT é bloqueado.
--
-- Sintoma: 'new row violates row-level security policy for table "lojas_grupos"'
-- ao tentar criar grupo de cliente.
--
-- SOLUÇÃO: adicionar policy permissiva (USING true) pras tabelas que a
-- vendedora precisa CRIAR/ATUALIZAR via frontend. A segurança fica na
-- camada da aplicação (login + filtro de vendedora_id), igual já é hoje
-- pras tabelas que funcionam.
--
-- Tabelas afetadas:
--   - lojas_grupos: vendedora cria/edita grupo de clientes
--   - lojas_clientes: vendedora pode reatribuir cliente a grupo
--   - lojas_acoes: vendedora registra ações
--   - lojas_agenda: vendedora cria itens de agenda
--   - lojas_carteira_historico: log automático
--
-- Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'lojas_grupos',
    'lojas_clientes',
    'lojas_clientes_kpis',
    'lojas_acoes',
    'lojas_agenda',
    'lojas_carteira_historico',
    'lojas_pedidos_sacola',
    'lojas_produtos_curadoria',
    'lojas_sugestoes_diarias'
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
--   SELECT tablename, policyname, cmd, qual, with_check
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('lojas_grupos','lojas_clientes')
--   ORDER BY tablename, policyname;
