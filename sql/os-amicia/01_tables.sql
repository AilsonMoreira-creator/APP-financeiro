-- =====================================================================
-- OS Amícia · Fase 1 · Schema das 7 tabelas novas
-- Versão: 1.0 · Data: 21/04/2026
-- Grupo Amícia · App Financeiro v6.8
-- =====================================================================
--
-- COMO RODAR:
--   1. Supabase → SQL Editor → New query
--   2. Colar este arquivo INTEIRO
--   3. Run
--   4. Verificar mensagem "CREATE TABLE" repetida 7 vezes
--
-- IDEMPOTENTE: usa IF NOT EXISTS, pode rodar 2x sem quebrar.
-- REVERSÍVEL: bloco DROP comentado no final.
--
-- SEGURANÇA: só CRIA tabelas novas. Não toca em nada existente.
-- =====================================================================


-- ─── Tabela 1: ia_insights ───────────────────────────────────────────
-- Histórico de todos os insights gerados (cron + perguntas livres).
CREATE TABLE IF NOT EXISTS ia_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Taxonomia
  escopo TEXT NOT NULL
    CHECK (escopo IN ('estoque','producao','marketplaces','home','pergunta_livre')),
  categoria TEXT,                         -- ex: 'ruptura_critica', 'lucro_mes', 'canal_queda'
  card_id TEXT,                           -- ex: 'estoque_card_3', 'marketplaces_card_1'

  -- Classificação
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('critico','atencao','positiva','oportunidade','info')),
  confidence TEXT NOT NULL DEFAULT 'alta'
    CHECK (confidence IN ('alta','media','baixa')),
  score INTEGER CHECK (score >= 0 AND score <= 100),

  -- Conteúdo (gerado pelo Claude ou fallback determinístico)
  titulo TEXT NOT NULL,
  resumo TEXT,
  impacto TEXT,
  acao_sugerida TEXT,

  -- Chaves pra ação (ref/cor/tam/canal/oficina/sala/conta)
  chaves JSONB,                           -- ex: {"ref":"02277","cor":"Bege","tam":"M","canal":"ML"}

  -- Payload bruto (útil pra depuração e pra o Card de Sugestão de Corte)
  payload JSONB,                          -- dados complementares específicos do card

  -- Ciclo de vida
  status TEXT NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo','arquivado','expirado')),
  expires_at TIMESTAMPTZ,

  -- Rastreabilidade
  origem TEXT NOT NULL DEFAULT 'cron'
    CHECK (origem IN ('cron','pergunta_livre','fallback_deterministico')),
  modelo TEXT,                            -- 'claude-sonnet-4-6' | 'fallback' | 'determ'
  cron_run_id UUID,                       -- vincula ao disparo do cron

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ia_insights_escopo_status ON ia_insights(escopo, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ia_insights_severity ON ia_insights(severity, score DESC) WHERE status = 'ativo';
CREATE INDEX IF NOT EXISTS idx_ia_insights_cron_run ON ia_insights(cron_run_id);


-- ─── Tabela 2: ia_feedback ───────────────────────────────────────────
-- Respostas Sim/Parcial/Não/Editar do admin sobre cada insight.
CREATE TABLE IF NOT EXISTS ia_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id UUID NOT NULL REFERENCES ia_insights(id) ON DELETE CASCADE,

  resposta TEXT NOT NULL
    CHECK (resposta IN ('sim','parcial','nao','editar')),
  nota TEXT,                              -- motivo/explicação livre (opcional)
  motivo_ajuste TEXT,                     -- quando resposta='editar'
  payload_ajuste JSONB,                   -- ex: grade/cores editadas antes de gerar ordem

  -- Autoria
  user_id TEXT NOT NULL,                  -- amicia-admin hoje (v1 só admin)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ia_feedback_insight ON ia_feedback(insight_id);
CREATE INDEX IF NOT EXISTS idx_ia_feedback_user_data ON ia_feedback(user_id, created_at DESC);


-- ─── Tabela 3: ia_config ─────────────────────────────────────────────
-- Chave-valor pra thresholds ajustáveis sem deploy.
CREATE TABLE IF NOT EXISTS ia_config (
  chave TEXT PRIMARY KEY,
  valor JSONB NOT NULL,
  descricao TEXT,
  tipo TEXT NOT NULL DEFAULT 'number'
    CHECK (tipo IN ('number','string','boolean','object','array')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);


-- ─── Tabela 4: ia_usage ──────────────────────────────────────────────
-- Controle de rate limit e custo da Anthropic API.
CREATE TABLE IF NOT EXISTS ia_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL,                     -- dia do consumo (BRT)
  ano_mes TEXT NOT NULL,                  -- 'YYYY-MM' pra agregação mensal rápida

  -- O que foi consumido
  tipo TEXT NOT NULL
    CHECK (tipo IN ('cron','pergunta_livre','retry')),
  modelo TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',

  -- Tokens
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,

  -- Custo em BRL (calculado na hora do registro usando taxa USD→BRL de ia_config)
  custo_usd NUMERIC(10,6) NOT NULL DEFAULT 0,
  custo_brl NUMERIC(10,4) NOT NULL DEFAULT 0,

  -- Vínculo opcional
  insight_id UUID REFERENCES ia_insights(id) ON DELETE SET NULL,
  cron_run_id UUID,
  user_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ia_usage_ano_mes ON ia_usage(ano_mes);
CREATE INDEX IF NOT EXISTS idx_ia_usage_data ON ia_usage(data DESC);


-- ─── Tabela 5: ia_sazonalidade ───────────────────────────────────────
-- 5 datas hardcoded editáveis pelo admin.
CREATE TABLE IF NOT EXISTS ia_sazonalidade (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,                     -- 'Dia das Mães', 'Black Friday'...
  data DATE NOT NULL,                     -- data-alvo (data pico de demanda)
  janela_dias_antes INTEGER NOT NULL DEFAULT 30
    CHECK (janela_dias_antes > 0),        -- quantos dias antes começa a importar
  multiplicador_demanda NUMERIC(4,2) NOT NULL DEFAULT 1.2
    CHECK (multiplicador_demanda > 0),    -- quanto aumentar a demanda esperada
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ia_sazonalidade_ativo ON ia_sazonalidade(ativo, data) WHERE ativo = true;


-- ─── Tabela 6: ml_vendas_lucro_snapshot ──────────────────────────────
-- Lucro real por venda individual, gravado pelo cron diário.
-- Retenção: 24 meses (limpeza manual ou cron futuro).
CREATE TABLE IF NOT EXISTS ml_vendas_lucro_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL,

  -- Identificação da venda
  ref TEXT NOT NULL,
  cor TEXT,
  tam TEXT,
  canal TEXT NOT NULL,                    -- ML | Shein | Shopee | TikTok | Meluni | Outros
  conta TEXT,                             -- Exitus | Lumia | Muniam

  -- Unidade e valor
  unidades INTEGER NOT NULL CHECK (unidades > 0),
  valor_venda_unitario NUMERIC(10,2),     -- preço efetivo (se disponível)
  lucro_unitario NUMERIC(10,2) NOT NULL,  -- lucro da última linha da Calculadora
  lucro_total NUMERIC(10,2) NOT NULL,     -- unidades × lucro_unitario

  -- Rastreabilidade
  venda_origem_id TEXT,                   -- id do pedido no Bling (se disponível)
  calc_snapshot_id UUID,                  -- vínculo ao snapshot da Calculadora usado

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ml_vendas_lucro_data ON ml_vendas_lucro_snapshot(data DESC);
CREATE INDEX IF NOT EXISTS idx_ml_vendas_lucro_ref ON ml_vendas_lucro_snapshot(ref, data DESC);
CREATE INDEX IF NOT EXISTS idx_ml_vendas_lucro_canal ON ml_vendas_lucro_snapshot(canal, data DESC);


-- ─── Tabela 7: calc_historico_snapshot ───────────────────────────────
-- Snapshot da Calculadora quando valores mudam (hash detection diária).
-- Retenção: permanente (não é grande, ~500 refs × 5 canais × ~1 mudança/mês).
CREATE TABLE IF NOT EXISTS calc_historico_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref TEXT NOT NULL,
  canal TEXT NOT NULL
    CHECK (canal IN ('mercadolivre','shopee','shein','tiktok','meluni')),

  -- Decisão do Ailson (21/04): usar só o custo total, não componentes separados
  custo_total NUMERIC(10,2) NOT NULL,

  -- Preço e lucro da última linha
  preco_definido NUMERIC(10,2),           -- preço salvo manualmente (prs[ref|canal])
  lucro_ultima_linha NUMERIC(10,2),       -- lucro real no preço_definido
  preco_sugerido_10 NUMERIC(10,2),        -- degrau 1 (lucro >= R$10)
  preco_sugerido_14 NUMERIC(10,2),        -- degrau 2 (lucro >= R$14)

  -- Regras vigentes (serializado — detectar mudança de comissão/frete)
  regras_hash TEXT,                       -- SHA256 do CALC_PLATS + CALC_GERAIS
  regras_snapshot JSONB,                  -- snapshot das regras no momento

  -- Metadados
  detectado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cron_run_id UUID
);

CREATE INDEX IF NOT EXISTS idx_calc_snap_ref_canal ON calc_historico_snapshot(ref, canal, detectado_em DESC);
CREATE INDEX IF NOT EXISTS idx_calc_snap_hash ON calc_historico_snapshot(regras_hash);


-- =====================================================================
-- Trigger utilitário: updated_at automático em ia_insights e ia_config
-- =====================================================================
CREATE OR REPLACE FUNCTION os_amicia_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ia_insights_updated_at ON ia_insights;
CREATE TRIGGER trg_ia_insights_updated_at
  BEFORE UPDATE ON ia_insights
  FOR EACH ROW EXECUTE FUNCTION os_amicia_set_updated_at();

DROP TRIGGER IF EXISTS trg_ia_config_updated_at ON ia_config;
CREATE TRIGGER trg_ia_config_updated_at
  BEFORE UPDATE ON ia_config
  FOR EACH ROW EXECUTE FUNCTION os_amicia_set_updated_at();

DROP TRIGGER IF EXISTS trg_ia_sazonalidade_updated_at ON ia_sazonalidade;
CREATE TRIGGER trg_ia_sazonalidade_updated_at
  BEFORE UPDATE ON ia_sazonalidade
  FOR EACH ROW EXECUTE FUNCTION os_amicia_set_updated_at();


-- =====================================================================
-- BLOCO DE ROLLBACK (comentado — descomente pra desfazer tudo)
-- =====================================================================
-- DROP TRIGGER IF EXISTS trg_ia_sazonalidade_updated_at ON ia_sazonalidade;
-- DROP TRIGGER IF EXISTS trg_ia_config_updated_at ON ia_config;
-- DROP TRIGGER IF EXISTS trg_ia_insights_updated_at ON ia_insights;
-- DROP FUNCTION IF EXISTS os_amicia_set_updated_at();
-- DROP TABLE IF EXISTS calc_historico_snapshot;
-- DROP TABLE IF EXISTS ml_vendas_lucro_snapshot;
-- DROP TABLE IF EXISTS ia_sazonalidade;
-- DROP TABLE IF EXISTS ia_usage;
-- DROP TABLE IF EXISTS ia_feedback;
-- DROP TABLE IF EXISTS ia_insights;
-- DROP TABLE IF EXISTS ia_config;
