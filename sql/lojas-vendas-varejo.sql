-- ═══════════════════════════════════════════════════════════════════════════
-- VENDAS VAREJO — Sessão Ailson 04/05/2026
-- ═══════════════════════════════════════════════════════════════════════════
-- Decisao: tabela SEPARADA pra varejo (em vez de juntar com lojas_vendas).
-- Razao: nao mexer no fluxo de atacado que ja funciona ha meses. View consolida.
--
-- Varejo nao tem cliente_id (cliente balcao raramente cadastrado), nao precisa
-- detalhe historico, so precisa: vendedora, data, valor liquido, loja, qtd
-- pecas. Suficiente pra calcular metas + comissao.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lojas_vendas_varejo (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_pedido               text NOT NULL,
  loja                        text NOT NULL CHECK (loja IN ('Bom Retiro', 'Silva Teles')),
  data_venda                  date NOT NULL,
  vendedora_id                uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  vendedora_nome_raw          text,    -- nome bruto da planilha (audit)
  qtd_pecas                   int NOT NULL DEFAULT 0,
  qtd_devolvida               int NOT NULL DEFAULT 0,
  valor_total                 numeric(12,2) NOT NULL DEFAULT 0,   -- total bruto
  valor_devolucao             numeric(12,2) NOT NULL DEFAULT 0,
  valor_liquido               numeric(12,2) NOT NULL DEFAULT 0,   -- pra meta/comissao
  valor_desconto              numeric(12,2) NOT NULL DEFAULT 0,
  pct_desconto                numeric(5,2) NOT NULL DEFAULT 0,
  valor_custo                 numeric(12,2) NOT NULL DEFAULT 0,
  forma_pagamento_raw         text,
  forma_pagamento_categoria   text,
  hora_venda                  time,
  cidade                      text,
  uf                          text,
  -- Audit/import
  importacao_id               uuid,
  imported_at                 timestamptz NOT NULL DEFAULT now(),
  -- Idempotencia (mesmo pedido + loja nao duplica)
  CONSTRAINT uq_vendas_varejo_pedido_loja UNIQUE (numero_pedido, loja)
);

CREATE INDEX IF NOT EXISTS idx_vendas_varejo_data
  ON lojas_vendas_varejo(data_venda DESC);

CREATE INDEX IF NOT EXISTS idx_vendas_varejo_vendedora_data
  ON lojas_vendas_varejo(vendedora_id, data_venda DESC)
  WHERE vendedora_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vendas_varejo_loja_data
  ON lojas_vendas_varejo(loja, data_venda DESC);

ALTER TABLE lojas_vendas_varejo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_vendas_varejo_select" ON lojas_vendas_varejo;
DROP POLICY IF EXISTS "lojas_vendas_varejo_modify" ON lojas_vendas_varejo;
CREATE POLICY "lojas_vendas_varejo_select" ON lojas_vendas_varejo FOR SELECT USING (true);
CREATE POLICY "lojas_vendas_varejo_modify" ON lojas_vendas_varejo FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE lojas_vendas_varejo IS
  'Vendas de varejo (CPF/CNPJ vazio ou invalido). Tabela paralela a lojas_vendas (que segue so com atacado). Nao guarda cliente_id (cliente balcao nao cadastrado). Usado pra calculo de metas/comissao da vendedora.';

-- ───────────────────────────────────────────────────────────────────────────
-- View consolidada pra calculo de metas (atacado + varejo)
-- ───────────────────────────────────────────────────────────────────────────
-- Sprint A do card de metas le esta view ao inves das tabelas individuais.
-- Filtra so vendas com vendedora_id (sem vendedor responsavel nao entra
-- na meta — vai pra "loja" ou descartado).
CREATE OR REPLACE VIEW vw_lojas_vendas_completo AS
-- Atacado: vem de lojas_vendas (canal_origem='fisico' filtra Vesti/Convertr)
SELECT
  v.id::uuid                AS id,
  'atacado'::text           AS categoria,
  v.numero_pedido,
  v.loja,
  v.data_venda,
  v.vendedora_id,
  COALESCE(v.qtd_pecas, 0)  AS qtd_pecas,
  COALESCE(v.valor_liquido, 0) AS valor_liquido,
  v.forma_pagamento_categoria
FROM lojas_vendas v
WHERE v.canal_origem = 'fisico'
  AND v.vendedora_id IS NOT NULL

UNION ALL

-- Varejo: vem de lojas_vendas_varejo
SELECT
  vv.id,
  'varejo'::text            AS categoria,
  vv.numero_pedido,
  vv.loja,
  vv.data_venda,
  vv.vendedora_id,
  COALESCE(vv.qtd_pecas, 0) AS qtd_pecas,
  COALESCE(vv.valor_liquido, 0) AS valor_liquido,
  vv.forma_pagamento_categoria
FROM lojas_vendas_varejo vv
WHERE vv.vendedora_id IS NOT NULL;

COMMENT ON VIEW vw_lojas_vendas_completo IS
  'Vendas fisicas consolidadas (atacado + varejo) pra calculo de metas/comissao. Categoria diferencia origem. Filtra so vendas com vendedora_id atribuida.';
