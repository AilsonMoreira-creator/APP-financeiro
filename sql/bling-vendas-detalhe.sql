-- Rodar no Supabase SQL Editor — Tabela de cache de vendas detalhadas do Bling
-- Substitui as chamadas pesadas que batiam no rate limit

CREATE TABLE IF NOT EXISTS bling_vendas_detalhe (
  id BIGSERIAL PRIMARY KEY,
  conta TEXT NOT NULL,                    -- exitus, lumia, muniam
  pedido_id BIGINT NOT NULL,             -- ID do pedido no Bling
  data_pedido DATE NOT NULL,             -- Data do pedido (YYYY-MM-DD)
  canal_geral TEXT DEFAULT 'Outros',     -- Mercado Livre, Shopee, Shein, etc.
  canal_detalhe TEXT DEFAULT 'Outros',   -- ML Full, ML Clássico, etc.
  total_produtos NUMERIC(12,2) DEFAULT 0,
  total_pedido NUMERIC(12,2) DEFAULT 0,
  itens JSONB DEFAULT '[]',              -- Array com items parseados (ref, tam, cor, valor, qtd)
  loja_nome TEXT,                        -- Nome original da loja no Bling
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conta, pedido_id)
);

-- Índices para queries rápidas
CREATE INDEX IF NOT EXISTS idx_bvd_data ON bling_vendas_detalhe(data_pedido);
CREATE INDEX IF NOT EXISTS idx_bvd_conta_data ON bling_vendas_detalhe(conta, data_pedido);
