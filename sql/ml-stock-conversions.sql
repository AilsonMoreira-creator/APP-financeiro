-- Rodar no Supabase SQL Editor — Ofertas de estoque + Conversões

-- Ofertas de estoque (fluxo cor → confirmação → alerta)
CREATE TABLE IF NOT EXISTS ml_stock_offers (
  id BIGSERIAL PRIMARY KEY,
  brand TEXT NOT NULL,
  item_id TEXT NOT NULL,
  question_id TEXT,
  buyer_id TEXT NOT NULL,
  cores TEXT[] DEFAULT '{}',
  tamanho TEXT,
  status TEXT DEFAULT 'aguardando_confirmacao',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  expired_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mso_buyer_item ON ml_stock_offers(buyer_id, item_id);
CREATE INDEX IF NOT EXISTS idx_mso_status ON ml_stock_offers(status);

-- Conversões: perguntas que geraram vendas
CREATE TABLE IF NOT EXISTS ml_conversions (
  id BIGSERIAL PRIMARY KEY,
  brand TEXT,
  buyer_id TEXT,
  question_id TEXT,
  question_text TEXT,
  answered_by TEXT,
  order_id TEXT,
  order_value NUMERIC(12,2),
  item_id TEXT,
  item_title TEXT,
  question_at TIMESTAMPTZ,
  order_at TIMESTAMPTZ,
  time_to_buy_minutes INTEGER,
  conversion_type TEXT DEFAULT 'direta',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_mconv_brand ON ml_conversions(brand);
CREATE INDEX IF NOT EXISTS idx_mconv_order ON ml_conversions(order_at DESC);
