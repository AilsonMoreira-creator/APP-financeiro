-- Rodar no Supabase SQL Editor — Tabelas do módulo Pós-Venda

-- Conversas (1 por pack/pedido)
CREATE TABLE IF NOT EXISTS ml_conversations (
  id BIGSERIAL PRIMARY KEY,
  pack_id TEXT NOT NULL,
  order_id TEXT,
  brand TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  buyer_id TEXT,
  buyer_nickname TEXT,
  item_id TEXT,
  item_title TEXT,
  item_thumbnail TEXT,
  tag TEXT DEFAULT 'normal',
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'aberto',
  last_message_text TEXT,
  last_message_from TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pack_id, brand)
);

CREATE INDEX IF NOT EXISTS idx_mc_brand_status ON ml_conversations(brand, status);
CREATE INDEX IF NOT EXISTS idx_mc_tag ON ml_conversations(tag);
CREATE INDEX IF NOT EXISTS idx_mc_last_msg ON ml_conversations(last_message_at DESC);

-- Mensagens individuais
CREATE TABLE IF NOT EXISTS ml_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT REFERENCES ml_conversations(id),
  pack_id TEXT NOT NULL,
  message_id TEXT,
  brand TEXT NOT NULL,
  from_type TEXT NOT NULL,
  from_id TEXT,
  text TEXT,
  attachments JSONB DEFAULT '[]',
  date_created TIMESTAMPTZ,
  sent_via TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, brand)
);

CREATE INDEX IF NOT EXISTS idx_mm_conv ON ml_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_mm_pack ON ml_messages(pack_id);

-- Treinamento IA pós-venda (separado do pré-venda)
CREATE TABLE IF NOT EXISTS ml_qa_history_posvenda (
  id BIGSERIAL PRIMARY KEY,
  brand TEXT,
  item_id TEXT,
  situation_text TEXT,
  answer_text TEXT,
  answered_by TEXT,
  answered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mqhpv_brand ON ml_qa_history_posvenda(brand);
