-- ═══════════════════════════════════════════════════════════════════════════
-- VAREJO — vendas balcao (sem cliente cadastrado)
-- Sessão Ailson 04/05/2026 — Sprint A (card metas vendedora)
-- ═══════════════════════════════════════════════════════════════════════════
-- Decisao: nao misturar varejo em lojas_vendas. Tabela paralela so com o
-- minimo necessario pra calculo de meta da vendedora.
-- - Sem cliente_id (varejo nao tem ficha)
-- - Sem itens detalhados (so total, vendedora, data)
-- - Importer salva aqui em vez de descartar (preservando comportamento
--   atual de lojas_vendas — atacado continua igual era)
-- - View vw_lojas_vendas_completo une as duas pra Sprint A consultar.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Tabela lojas_vendas_varejo
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas_vendas_varejo (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_pedido   text NOT NULL,
  loja            text NOT NULL CHECK (loja IN ('Bom Retiro', 'Silva Teles')),
  data_venda      date NOT NULL,
  vendedora_id    uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  vendedora_nome_raw text,                         -- nome cru pra debug
  valor_liquido   numeric(12,2) NOT NULL DEFAULT 0,
  valor_bruto     numeric(12,2),
  qtd_pecas       int,
  pct_desconto    numeric(5,2),
  forma_pagamento text,
  hora_venda      text,                            -- formato HH:MM da planilha
  documento_raw   text,                            -- '1', '13', vazio, etc — pra audit
  cliente_raw     text,                            -- 'CONSUMIDOR' ou vazio
  whatsapp_raw    text,                            -- WhatsApp do varejo (se vier preenchido)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Idempotencia: mesmo pedido + loja nao duplica
  UNIQUE (numero_pedido, loja)
);

CREATE INDEX IF NOT EXISTS idx_varejo_vendedora_data
  ON lojas_vendas_varejo(vendedora_id, data_venda DESC);

CREATE INDEX IF NOT EXISTS idx_varejo_loja_data
  ON lojas_vendas_varejo(loja, data_venda DESC);

CREATE INDEX IF NOT EXISTS idx_varejo_data
  ON lojas_vendas_varejo(data_venda DESC);

ALTER TABLE lojas_vendas_varejo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_varejo_select" ON lojas_vendas_varejo;
DROP POLICY IF EXISTS "lojas_varejo_modify" ON lojas_vendas_varejo;
CREATE POLICY "lojas_varejo_select" ON lojas_vendas_varejo FOR SELECT USING (true);
CREATE POLICY "lojas_varejo_modify" ON lojas_vendas_varejo FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE lojas_vendas_varejo IS
  'Vendas de balcao (varejo) sem cliente cadastrado. So pra calculo de meta. Nao mexer em lojas_vendas.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. View consolidada (atacado + varejo) pra Sprint A
-- ───────────────────────────────────────────────────────────────────────────
-- Usada pelo card de metas. Filtros tipicos: vendedora_id + data_venda + loja
-- O campo "categoria" diferencia atacado/varejo.
CREATE OR REPLACE VIEW vw_lojas_vendas_completo AS
SELECT
  v.numero_pedido,
  v.loja,
  v.data_venda,
  v.vendedora_id,
  v.valor_liquido,
  'atacado'::text                                     AS categoria,
  v.canal_origem,
  v.cliente_id
FROM lojas_vendas v
WHERE v.canal_origem = 'fisico'                       -- Sprint A so olha vendas fisicas

UNION ALL

SELECT
  vr.numero_pedido,
  vr.loja,
  vr.data_venda,
  vr.vendedora_id,
  vr.valor_liquido,
  'varejo'::text                                      AS categoria,
  'fisico'::text                                      AS canal_origem,
  NULL::uuid                                          AS cliente_id
FROM lojas_vendas_varejo vr;

COMMENT ON VIEW vw_lojas_vendas_completo IS
  'Une atacado (lojas_vendas) + varejo (lojas_vendas_varejo) pro card de metas. Sprint A.';
