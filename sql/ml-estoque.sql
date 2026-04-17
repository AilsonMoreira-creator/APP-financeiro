-- ═══════════════════════════════════════════════════════════
-- MÓDULO ESTOQUE — tabelas pra snapshot do ML Lumia
-- Rodar no SQL Editor do Supabase antes do primeiro cron
-- ═══════════════════════════════════════════════════════════

-- 1. SNAPSHOT BRUTO — uma linha por variação ativa na Lumia
-- Sobrescreve a cada 6h (DELETE + INSERT)
-- Chave única: SKU (é universal Bling/ML/Ideris conforme confirmado)
CREATE TABLE IF NOT EXISTS ml_estoque_snapshot (
  sku TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,                   -- MLB do anúncio
  variation_id TEXT,                       -- id numérico da variação ML
  cor TEXT,
  tamanho TEXT,
  available INT DEFAULT 0,
  ml_title TEXT,
  ml_status TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mes_item ON ml_estoque_snapshot(item_id);

-- 2. MAPA SKU → REF
-- Construído a partir de bling_vendas_detalhe (pedidos Bling últimos 45 dias).
-- Quando um pedido é cacheado, cada item tem {codigo (SKU), ref}.
-- Uma vez que o mapa está populado, ele é persistente — mesmo que a ref saia
-- dos pedidos recentes, a associação continua válida.
CREATE TABLE IF NOT EXISTS ml_sku_ref_map (
  sku TEXT PRIMARY KEY,
  ref TEXT NOT NULL,
  primeira_venda TIMESTAMPTZ DEFAULT NOW(),  -- data do 1º pedido que estabeleceu o match
  ultima_venda TIMESTAMPTZ DEFAULT NOW(),
  qtd_pedidos INT DEFAULT 1,                  -- quantos pedidos confirmaram o match
  fonte TEXT DEFAULT 'bling_vendas',          -- bling_vendas | manual | futuro_ideris
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_srm_ref ON ml_sku_ref_map(ref);

-- 3. RESOLVIDO POR REF — pronto pros cards da tela
-- Populado pelo cron depois do snapshot + join com mapa SKU→ref
-- Uma linha por ref ativa da Calculadora
CREATE TABLE IF NOT EXISTS ml_estoque_ref_atual (
  ref TEXT PRIMARY KEY,
  descricao TEXT,                           -- da Calculadora (prioridade)
  qtd_total INT DEFAULT 0,                  -- soma das variações do MLB escolhido
  variations JSONB DEFAULT '[]',            -- [{sku, cor, tam, qtd}]
  mlb_escolhido TEXT,                       -- MLB usado (regra: maior estoque)
  mlbs_encontrados JSONB DEFAULT '[]',      -- todos MLBs com a ref (pra debug)
  alerta_duplicata BOOL DEFAULT FALSE,      -- true se >1 MLB ativo com essa ref
  sem_dados BOOL DEFAULT FALSE,             -- true se ref não foi encontrada no ML
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. HISTÓRICO DO TOTAL GERAL — 1 linha por mês
-- Usado pra gráfico de tendência dos últimos 12 meses
-- Upsert no 1º do mês (ou na 1ª execução do mês)
CREATE TABLE IF NOT EXISTS ml_estoque_total_mensal (
  ano_mes TEXT PRIMARY KEY,                 -- "2026-04"
  qtd_total INT DEFAULT 0,                  -- soma de todas as refs naquele mês
  qtd_refs INT DEFAULT 0,                   -- quantas refs ativas estavam computadas
  snapshot_date DATE DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. MAPA SCF → REF (NOVO)
-- scf = seller_custom_field = código do produto-pai no Ideris/Bling
-- Ex: z23041912028 → ref 2277
-- Esse mapa é populado via upload manual (endpoint /api/ml-estoque-import-scf)
-- Cobre 95% dos anúncios da Lumia que não têm SELLER_SKU preenchido nas variações
CREATE TABLE IF NOT EXISTS ml_scf_ref_map (
  scf TEXT PRIMARY KEY,                      -- código pai (ex: "z23041912028")
  ref TEXT NOT NULL,                         -- ref normalizada (ex: "2277")
  origem TEXT DEFAULT 'manual',              -- manual | import_csv | import_json
  observacao TEXT,                           -- espaço pra nota do usuário
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scf_ref ON ml_scf_ref_map(ref);
