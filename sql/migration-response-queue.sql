-- ═══════════════════════════════════════════════════════════
-- MIGRAÇÃO: Fila de respostas com delay (2 min)
-- Rodar no SQL Editor do Supabase
-- ═══════════════════════════════════════════════════════════

-- Coluna buyer_id na qa_history (pra conversões)
ALTER TABLE ml_qa_history ADD COLUMN IF NOT EXISTS buyer_id TEXT;

-- Tabela de fila de respostas
CREATE TABLE IF NOT EXISTS ml_response_queue (
  id BIGSERIAL PRIMARY KEY,
  question_id BIGINT NOT NULL,
  brand TEXT NOT NULL,
  item_id TEXT,
  question_text TEXT,
  response_text TEXT NOT NULL,
  answered_by TEXT NOT NULL,
  buyer_id TEXT,
  respond_after TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'queued',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  error TEXT
);

-- Índice pra busca rápida do cron
CREATE INDEX IF NOT EXISTS idx_queue_status_respond 
  ON ml_response_queue(status, respond_after) 
  WHERE status = 'queued';
