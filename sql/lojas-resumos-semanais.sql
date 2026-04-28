-- ═══════════════════════════════════════════════════════════════════════════
-- lojas-resumos-semanais.sql — Tabela pra armazenar resumos semanais da IA
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Como rodar: cole no Supabase SQL Editor → Run.
-- Idempotente (IF NOT EXISTS, ON CONFLICT DO NOTHING).
--
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lojas_resumos_semanais (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedora_id                uuid NOT NULL REFERENCES lojas_vendedoras(id) ON DELETE CASCADE,
  
  -- período (segunda → domingo)
  semana_inicio               date NOT NULL,
  semana_fim                  date NOT NULL,
  
  -- métricas brutas
  mensagens_enviadas          int DEFAULT 0,
  sugestoes_geradas           int DEFAULT 0,
  sugestoes_dispensadas       int DEFAULT 0,
  
  -- conversão (regra dos 30 dias)
  mensagens_atencao_inativo   int DEFAULT 0,    -- denominador
  conversoes_sucesso          int DEFAULT 0,    -- numerador
  taxa_conversao              numeric(5,2) DEFAULT 0,  -- 0-100 (%)
  
  -- destaques
  top_clientes                jsonb DEFAULT '[]'::jsonb,
  -- estrutura: [{cliente_id, nome, qtd_pedidos, total_comprado}]
  
  conversoes_detalhe          jsonb DEFAULT '[]'::jsonb,
  -- estrutura: [{cliente_id, cliente_nome, data_msg, data_venda, dias, valor}]
  
  -- IA
  mensagem_motivacional       text,
  modelo_ia                   text,
  tokens_input                int DEFAULT 0,
  tokens_output               int DEFAULT 0,
  custo_brl                   numeric(10,4) DEFAULT 0,
  
  -- meta
  gerado_em                   timestamptz NOT NULL DEFAULT now(),
  visualizado_em              timestamptz,
  
  -- evita gerar 2 resumos pra mesma semana/vendedora
  UNIQUE (vendedora_id, semana_inicio)
);

CREATE INDEX IF NOT EXISTS idx_resumos_vendedora_data 
  ON lojas_resumos_semanais(vendedora_id, semana_inicio DESC);

CREATE INDEX IF NOT EXISTS idx_resumos_semana 
  ON lojas_resumos_semanais(semana_inicio DESC);

-- ─── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE lojas_resumos_semanais ENABLE ROW LEVEL SECURITY;

-- Política: leitura aberta (igual lojas_vendedoras — admin lê tudo,
-- vendedora vê só dela)
DROP POLICY IF EXISTS lojas_resumos_select_aberto ON lojas_resumos_semanais;
CREATE POLICY lojas_resumos_select_aberto
  ON lojas_resumos_semanais
  FOR SELECT
  USING (true);

-- ─── CHECAGEM ───────────────────────────────────────────────────────────────

SELECT
  'tabela criada' AS check_item,
  EXISTS (SELECT 1 FROM information_schema.tables 
          WHERE table_name = 'lojas_resumos_semanais') AS ok
UNION ALL
SELECT 'indices criados',
  (SELECT count(*) >= 2 FROM pg_indexes 
   WHERE tablename = 'lojas_resumos_semanais')
UNION ALL
SELECT 'rls habilitado',
  EXISTS (SELECT 1 FROM pg_tables 
          WHERE tablename = 'lojas_resumos_semanais' AND rowsecurity = true);
