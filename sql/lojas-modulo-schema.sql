-- ═══════════════════════════════════════════════════════════════════════════
-- MÓDULO LOJAS — SCHEMA COMPLETO
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Versão: 1.0.0
-- Data: 2026-04-27
-- Banco: Supabase (PostgreSQL 15+)
--
-- Como aplicar:
--   1. Copia o arquivo todo
--   2. Cola no Supabase SQL Editor
--   3. Executa de uma vez (Ctrl+Enter)
--   4. Confere mensagens de sucesso
--
-- Estrutura:
--   • 19 tabelas
--   • Indexes otimizados
--   • RLS (Row Level Security) habilitado em todas
--   • Triggers automáticos (updated_at, version)
--   • Views agregadas (vw_lojas_carteira, vw_lojas_grupos)
--   • Funções helper (recalcular_kpis, resolver_status)
--   • Seed inicial (7 vendedoras + listas curadoria)
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  EXTENSIONS                                                              │
-- └──────────────────────────────────────────────────────────────────────────┘

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- pra busca por similaridade de nomes

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  HELPER FUNCTIONS (criadas antes pra usar em triggers)                   │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Trigger genérico: atualiza updated_at + incrementa version a cada UPDATE
CREATE OR REPLACE FUNCTION lojas_tgr_atualiza_versao()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  NEW.version = COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Helper: verifica se user_id é admin (consulta lojas_admins)
CREATE OR REPLACE FUNCTION lojas_eh_admin(p_user_id text)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM lojas_admins WHERE user_id = LOWER(p_user_id)
  );
END;
$$ LANGUAGE plpgsql STABLE;


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  GRUPO 1 — IDENTIDADE E PERMISSÕES                                       │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1.1 ADMINS ─────────────────────────────────────────────────────────────
-- Usuários com acesso total ao módulo Lojas
CREATE TABLE IF NOT EXISTS lojas_admins (
  user_id     text PRIMARY KEY,           -- ex: 'amicia-admin', 'ailson', 'tamara'
  nome        text,
  observacao  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed admins (idempotente)
INSERT INTO lojas_admins (user_id, nome, observacao) VALUES
  ('amicia-admin', 'Admin Amícia', 'admin original do app'),
  ('ailson', 'Ailson', 'dono'),
  ('tamara', 'Tamara', 'esposa do dono')
ON CONFLICT (user_id) DO NOTHING;


-- ─── 1.2 VENDEDORAS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas_vendedoras (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome             text NOT NULL,
  loja             text NOT NULL CHECK (loja IN ('Silva Teles', 'Bom Retiro')),
  
  -- estado
  ativa            boolean NOT NULL DEFAULT true,
  is_placeholder   boolean NOT NULL DEFAULT false,
  is_padrao_loja   boolean NOT NULL DEFAULT false,
  
  -- aliases (variações do nome que aparecem nas vendas)
  aliases          text[] NOT NULL DEFAULT '{}',
  
  -- usuário Supabase pra login (opcional)
  user_id          text,
  
  -- ordem de exibição na UI
  ordem_display    int DEFAULT 0,
  
  -- meta
  observacao       text,
  version          int NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       text
);

CREATE INDEX idx_vendedoras_loja_ativa 
  ON lojas_vendedoras(loja) WHERE ativa = true;
CREATE INDEX idx_vendedoras_user_id 
  ON lojas_vendedoras(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX idx_vendedoras_padrao_loja 
  ON lojas_vendedoras(loja) WHERE is_padrao_loja = true;

CREATE TRIGGER tg_lojas_vendedoras_versao
  BEFORE UPDATE ON lojas_vendedoras
  FOR EACH ROW EXECUTE FUNCTION lojas_tgr_atualiza_versao();

-- Seed vendedoras
INSERT INTO lojas_vendedoras (nome, loja, ativa, is_placeholder, is_padrao_loja, aliases, ordem_display) VALUES
  ('Joelma',      'Silva Teles', true, false, false, ARRAY['JOELMA','REGILANIA','KELLY'],                   1),
  ('Cleide',      'Silva Teles', true, false, true,  ARRAY['CLEIDE','CARINA','KARINA'],                     2),
  ('Vendedora_3', 'Silva Teles', true, true,  false, ARRAY['PERLA','GISLENE','GI','POLYANA','POLI','POLLY'], 3),
  ('Célia',       'Bom Retiro',  true, false, true,  ARRAY['CELIA','CÉLIA'],                                1),
  ('Vanessa',     'Bom Retiro',  true, false, false, ARRAY['VANESSA','VANESSA BOM','VANESSA BOM RETIRO'],   2),
  ('Fran',        'Bom Retiro',  true, false, false, ARRAY['FRAN'],                                         3),
  ('Vendedora_4', 'Bom Retiro',  true, true,  false, ARRAY['ROSANGELA','ROSÂNGELA','MAIRLA','MAILA','LUCIA'], 4)
ON CONFLICT DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  GRUPO 2 — CLIENTES (e GRUPOS DE CLIENTES)                               │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 2.1 GRUPOS DE CLIENTES (multi-CNPJ) ───────────────────────────────────
-- Lojista que tem várias unidades cadastradas com CNPJs diferentes
CREATE TABLE IF NOT EXISTS lojas_grupos (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome_grupo    text NOT NULL,
  apelido       text,
  vendedora_id  uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  observacao    text,
  
  -- meta
  arquivado_em  timestamptz,
  version       int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

CREATE INDEX idx_grupos_vendedora ON lojas_grupos(vendedora_id);
CREATE INDEX idx_grupos_ativos ON lojas_grupos(id) WHERE arquivado_em IS NULL;

CREATE TRIGGER tg_lojas_grupos_versao
  BEFORE UPDATE ON lojas_grupos
  FOR EACH ROW EXECUTE FUNCTION lojas_tgr_atualiza_versao();


-- ─── 2.2 CLIENTES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas_clientes (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- identificação
  documento                   text NOT NULL UNIQUE,
  tipo_documento              text NOT NULL CHECK (tipo_documento IN ('cpf','cnpj')),
  razao_social                text NOT NULL,
  nome_fantasia               text,
  apelido                     text,
  comprador_nome              text,
  
  -- contato
  telefone_principal          text,
  telefone_principal_origem   text CHECK (telefone_principal_origem IN ('whatsapp','celular','fone')),
  telefone_principal_valido   boolean DEFAULT false,
  telefone_brutos             jsonb,
  email                       text,
  instagram                   text,
  
  -- endereço
  endereco_logradouro         text,
  endereco_numero             text,
  endereco_complemento        text,
  endereco_bairro             text,
  endereco_cidade             text,
  endereco_uf                 text,
  endereco_cep                text,
  
  -- origem
  loja_origem                 text CHECK (loja_origem IN ('Silva Teles','Bom Retiro')),
  data_cadastro_origem        date,
  sistema_origem              text DEFAULT 'mire' CHECK (sistema_origem IN ('futura','mire','manual','derivado_vendas')),
  id_cliente_mire             text,
  
  -- canal
  canal_cadastro              text DEFAULT 'fisico' CHECK (canal_cadastro IN ('fisico','vesti','convertr')),
  
  -- atribuição de vendedora
  vendedora_id                uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  vendedor_a_definir          boolean NOT NULL DEFAULT false,
  fonte_atribuicao            text,
  data_atribuicao             timestamptz,
  
  -- vínculo a grupo
  grupo_id                    uuid REFERENCES lojas_grupos(id) ON DELETE SET NULL,
  
  -- ciclo de vida e estado
  arquivado_em                timestamptz,
  arquivado_por               text,
  arquivado_motivo            text,
  pular_ate                   date,
  
  -- meta
  observacao                  text,
  version                     int NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  text,
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text
);

CREATE INDEX idx_clientes_documento ON lojas_clientes(documento);
CREATE INDEX idx_clientes_telefone ON lojas_clientes(telefone_principal) WHERE telefone_principal IS NOT NULL;
CREATE INDEX idx_clientes_arquivado ON lojas_clientes(id) WHERE arquivado_em IS NULL;
CREATE INDEX idx_clientes_grupo ON lojas_clientes(grupo_id) WHERE grupo_id IS NOT NULL;
CREATE INDEX idx_clientes_loja ON lojas_clientes(loja_origem);
CREATE INDEX idx_clientes_canal ON lojas_clientes(canal_cadastro);
CREATE INDEX idx_clientes_vendedora ON lojas_clientes(vendedora_id) WHERE arquivado_em IS NULL;
CREATE INDEX idx_clientes_pendente ON lojas_clientes(vendedor_a_definir) WHERE vendedor_a_definir = true;
CREATE INDEX idx_clientes_razao_trgm ON lojas_clientes USING gin (razao_social gin_trgm_ops);

CREATE TRIGGER tg_lojas_clientes_versao
  BEFORE UPDATE ON lojas_clientes
  FOR EACH ROW EXECUTE FUNCTION lojas_tgr_atualiza_versao();


-- ─── 2.3 KPIs DO CLIENTE (calculado) ────────────────────────────────────────
-- Tabela de cache pra performance. Atualizada por job batch após importação.
CREATE TABLE IF NOT EXISTS lojas_clientes_kpis (
  cliente_id                    uuid PRIMARY KEY REFERENCES lojas_clientes(id) ON DELETE CASCADE,
  
  -- compras agregadas (todos canais)
  qtd_compras                   int DEFAULT 0,
  qtd_pecas                     int DEFAULT 0,
  lifetime_total                numeric(12,2) DEFAULT 0,
  ticket_medio                  numeric(12,2) DEFAULT 0,
  primeira_compra               date,
  ultima_compra                 date,
  
  -- compras por canal
  qtd_compras_fisicas           int DEFAULT 0,
  qtd_compras_vesti             int DEFAULT 0,
  qtd_compras_convertr          int DEFAULT 0,
  lifetime_fisico               numeric(12,2) DEFAULT 0,
  lifetime_marketplace          numeric(12,2) DEFAULT 0,
  
  -- canal dominante
  canal_dominante               text,
  
  -- perfil de presença
  perfil_presenca               text,         -- presencial | remota | fiel_cheque | hibrida | desconhecido
  pct_compras_presenciais       numeric(5,2),
  paga_com_cheque               boolean DEFAULT false,
  
  -- ciclo de vida
  fase_ciclo_vida               text,         -- nova_aguardando | nova_checkin_pronto | nova_em_analise | normal
  dias_sem_comprar              int,
  status_atual                  text,         -- ativo | atencao | semAtividade | inativo | arquivo | separandoSacola
  
  -- estilo dominante (calculado das categorias dos produtos comprados)
  estilo_dominante              text[],
  tamanhos_frequentes           text[],
  
  -- meta
  ultima_atualizacao            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kpis_status ON lojas_clientes_kpis(status_atual);
CREATE INDEX idx_kpis_dias_sem ON lojas_clientes_kpis(dias_sem_comprar);
CREATE INDEX idx_kpis_lifetime ON lojas_clientes_kpis(lifetime_total DESC);
CREATE INDEX idx_kpis_fase ON lojas_clientes_kpis(fase_ciclo_vida);


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  GRUPO 3 — VENDAS                                                        │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 3.1 VENDAS ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas_vendas (
  id                          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- chave de dedup (numero_pedido + loja é único)
  numero_pedido               text NOT NULL,
  loja                        text NOT NULL CHECK (loja IN ('Silva Teles','Bom Retiro')),
  
  -- cliente
  cliente_id                  uuid REFERENCES lojas_clientes(id) ON DELETE CASCADE,
  documento_cliente_raw       text,
  cliente_razao_raw           text,
  cliente_whatsapp_raw        text,
  cliente_cidade              text,
  cliente_uf                  text,
  
  -- vendedora
  vendedora_nome_raw          text,
  vendedora_id                uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  
  -- datas
  data_cadastro_cliente       date,
  data_venda                  date NOT NULL,                 -- "Finalizado" do Miré
  hora_venda                  time,
  
  -- valores
  qtd_pecas                   int DEFAULT 0,
  qtd_devolvida               int DEFAULT 0,
  valor_bruto                 numeric(12,2) DEFAULT 0,
  valor_devolucao             numeric(12,2) DEFAULT 0,
  valor_total                 numeric(12,2) DEFAULT 0,
  valor_desconto              numeric(12,2) DEFAULT 0,
  pct_desconto                numeric(5,2) DEFAULT 0,
  valor_liquido               numeric(12,2) NOT NULL DEFAULT 0,
  custo_total                 numeric(12,2) DEFAULT 0,
  
  -- pagamento
  forma_pagamento             text,
  forma_pagamento_categoria   text,                          -- vem_na_loja | distancia | fiel_confianca | multiplo
  
  -- canal e nota fiscal
  canal_origem                text NOT NULL DEFAULT 'fisico' CHECK (canal_origem IN ('fisico','vesti','convertr')),
  numero_nf                   text,
  marketplace_raw             text,
  
  -- meta
  loja_origem_raw             text,
  importacao_id               uuid,                          -- referencia lojas_importacoes
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- chave única: dedup por número de pedido dentro da loja
CREATE UNIQUE INDEX idx_vendas_pedido_loja 
  ON lojas_vendas(numero_pedido, loja);

CREATE INDEX idx_vendas_cliente_data ON lojas_vendas(cliente_id, data_venda DESC);
CREATE INDEX idx_vendas_vendedora_data ON lojas_vendas(vendedora_id, data_venda DESC);
CREATE INDEX idx_vendas_data ON lojas_vendas(data_venda DESC);
CREATE INDEX idx_vendas_canal ON lojas_vendas(canal_origem);


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  GRUPO 4 — PEDIDOS EM ESPERA (SACOLA SEPARANDO)                          │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 4.1 PEDIDOS SACOLA ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas_pedidos_sacola (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- chave de dedup (numero + loja)
  numero_pedido            text NOT NULL,
  loja                     text NOT NULL CHECK (loja IN ('Silva Teles','Bom Retiro')),
  
  -- cliente
  cliente_id               uuid REFERENCES lojas_clientes(id) ON DELETE CASCADE,
  documento_raw            text NOT NULL,
  
  -- vendedor
  vendedor_nome_raw        text,
  vendedora_id             uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  
  -- datas (CRÍTICAS - data_cadastro é fixa, atualizado muda)
  data_cadastro_sacola     date NOT NULL,                    -- fixa: quando virou em espera
  data_ultima_atualizacao  date,                             -- muda: cliente acrescentando
  hora                     time,
  
  -- valores
  qtd_pecas                int DEFAULT 0,
  valor_total              numeric(12,2) DEFAULT 0,
  
  -- estado (calculado)
  status                   text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','fechado','cancelado')),
  ativo                    boolean NOT NULL DEFAULT true,
  fechado_em               timestamptz,
  
  -- sub-tipo da sugestão IA (calculado por dias)
  subtipo_sugerido         text,    -- acrescentar_novidade | lembrete_finalizacao | resgate_pedido | urgencia_admin
  
  -- meta
  importacao_id            uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_sacola_pedido_loja 
  ON lojas_pedidos_sacola(numero_pedido, loja);

CREATE INDEX idx_sacola_cliente_ativo ON lojas_pedidos_sacola(cliente_id) WHERE ativo = true;
CREATE INDEX idx_sacola_vendedora_ativa ON lojas_pedidos_sacola(vendedora_id) WHERE ativo = true;
CREATE INDEX idx_sacola_data_cadastro ON lojas_pedidos_sacola(data_cadastro_sacola);


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  GRUPO 5 — PRODUTOS                                                      │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 5.1 PRODUTOS ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas_produtos (
  ref                      text PRIMARY KEY,                  -- REF normalizada (sem zero)
  ref_original             text,                              -- como veio do Miré
  descricao                text,
  categoria                text,                              -- CALÇA, BLUSA, VESTIDO, CONJUNTO, MACACÃO...
  
  -- preços (referencial, do Miré)
  preco_inicial            numeric(10,2),
  preco_medio              numeric(10,2),
  
  -- vendas e estoque
  qtd_total_vendida        int DEFAULT 0,
  qtd_devolvida            int DEFAULT 0,
  qtd_estoque              int DEFAULT 0,
  
  -- flags de oferta
  pode_oferecer            boolean DEFAULT false,
  motivo_pode_oferecer     text,    -- estoque | best_seller | em_alta | novidade
  tem_zero_a_esquerda      boolean DEFAULT false,
  
  -- ciclo de vida (novidade vinda do módulo OFICINAS, não sala de corte)
  data_entrega_oficina     date,                              -- ⚠️ módulo OFICINAS
  tem_caseado              boolean DEFAULT false,             -- Ficha Técnica.custo_caseado > 0
  novidade_inicia_em       date,                              -- entrega + 5 ou + 7 dias
  novidade_termina_em      date,                              -- inicia + 7 dias
  
  -- meta
  origem_dado              text DEFAULT 'mire_relatorio',
  ultima_atualizacao       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_produtos_pode_oferecer ON lojas_produtos(pode_oferecer) WHERE pode_oferecer = true;
CREATE INDEX idx_produtos_categoria ON lojas_produtos(categoria);
CREATE INDEX idx_produtos_novidade_ativa 
  ON lojas_produtos(novidade_inicia_em, novidade_termina_em);
-- Filtro de data deve ser feito na query, não no índice
-- (PostgreSQL não permite CURRENT_DATE em predicado de índice porque não é IMMUTABLE)


-- ─── 5.2 CURADORIA DE PRODUTOS (best-sellers, em alta) ─────────────────────
CREATE TABLE IF NOT EXISTS lojas_produtos_curadoria (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ref                 text NOT NULL,
  tipo                text NOT NULL CHECK (tipo IN ('best_seller','em_alta','novidade_manual')),
  ativo               boolean NOT NULL DEFAULT true,
  data_inicio         date,
  data_fim            date,                                   -- pra novidades 15d
  motivo              text,
  ordem_prioridade    int DEFAULT 0,
  adicionado_por      text,
  adicionado_em       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_curadoria_ref_tipo_ativo 
  ON lojas_produtos_curadoria(ref, tipo) 
  WHERE ativo = true;
CREATE INDEX idx_curadoria_ativos 
  ON lojas_produtos_curadoria(tipo, ref) 
  WHERE ativo = true;

-- Seed: best-sellers iniciais
INSERT INTO lojas_produtos_curadoria (ref, tipo, motivo, ordem_prioridade) VALUES
  ('1871', 'best_seller', 'classico_historico', 1),
  ('395',  'best_seller', 'best_seller', 2),
  ('376',  'best_seller', 'best_seller', 3),
  ('2842', 'best_seller', 'best_seller', 4),
  ('2818', 'best_seller', 'best_seller', 5),
  ('2586', 'best_seller', 'best_seller', 6),
  ('2759', 'best_seller', 'best_seller', 7),
  ('2558', 'best_seller', 'best_seller', 8),
  ('3181', 'em_alta', 'momentum', 1),
  ('2918', 'em_alta', 'momentum', 2),
  ('3167', 'em_alta', 'momentum', 3),
  ('2920', 'em_alta', 'momentum', 4),
  ('2925', 'em_alta', 'momentum', 5),
  ('3188', 'novidade_manual', 'novidade_inicial', 1),
  ('3171', 'novidade_manual', 'novidade_inicial', 2),
  ('3176', 'novidade_manual', 'novidade_inicial', 3),
  ('3189', 'novidade_manual', 'novidade_inicial', 4)
ON CONFLICT DO NOTHING;

-- Para novidades manuais, define janela de 15 dias
UPDATE lojas_produtos_curadoria
SET data_inicio = CURRENT_DATE,
    data_fim = CURRENT_DATE + INTERVAL '15 days'
WHERE tipo = 'novidade_manual' AND data_fim IS NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  GRUPO 6 — PROMOÇÕES                                                     │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 6.1 PROMOÇÕES ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas_promocoes (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome_curto            text NOT NULL,                        -- "Linho 20% off"
  descricao_completa    text NOT NULL,
  categoria             text,                                  -- linho | viscolinho | alfaiataria | todos
  
  -- vigência
  data_inicio           date NOT NULL,
  data_fim              date NOT NULL,
  ativo                 boolean NOT NULL DEFAULT true,
  
  -- regras
  pedido_minimo         numeric(10,2),
  desconto_pct          numeric(5,2),
  
  -- meta
  criado_por            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_promocoes_ativas 
  ON lojas_promocoes(data_fim) 
  WHERE ativo = true;
-- Filtro de data deve ser feito na query (CURRENT_DATE não é IMMUTABLE)


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  GRUPO 7 — IA: SUGESTÕES E MENSAGENS                                     │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 7.1 SUGESTÕES DIÁRIAS ─────────────────────────────────────────────────
-- Geradas pela IA (Prompt A) toda terça 06:30 após importação
CREATE TABLE IF NOT EXISTS lojas_sugestoes_diarias (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedora_id          uuid NOT NULL REFERENCES lojas_vendedoras(id) ON DELETE CASCADE,
  data_geracao          date NOT NULL DEFAULT CURRENT_DATE,
  
  -- ordem na lista do dia (1-7)
  prioridade            int NOT NULL,
  
  -- tipo da sugestão
  tipo                  text NOT NULL CHECK (tipo IN ('reativar','atencao','novidade','followup','followup_nova','sacola')),
  subtipo_sacola        text,
  
  -- alvo
  alvo_tipo             text NOT NULL CHECK (alvo_tipo IN ('cliente','grupo')),
  cliente_id            uuid REFERENCES lojas_clientes(id) ON DELETE CASCADE,
  grupo_id              uuid REFERENCES lojas_grupos(id) ON DELETE CASCADE,
  alvo_nome_display     text,
  
  -- conteúdo
  titulo                text NOT NULL,
  contexto              text,
  fatos                 jsonb,
  acao_sugerida         text,
  
  -- produtos/promoções
  produto_ref           text,
  produto_nome          text,
  promocao_id           uuid REFERENCES lojas_promocoes(id) ON DELETE SET NULL,
  
  -- estado da sugestão
  status                text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','executada','dispensada','expirada')),
  executada_em          timestamptz,
  dispensada_em         timestamptz,
  motivo_dispensa       text,
  
  -- mensagem gerada (cache, evita regenerar)
  mensagem_gerada       text,
  mensagem_gerada_em    timestamptz,
  
  -- meta IA
  fallback_used         boolean DEFAULT false,
  metadados_ia          jsonb,
  
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sugestoes_vendedora_dia 
  ON lojas_sugestoes_diarias(vendedora_id, data_geracao DESC);
CREATE INDEX idx_sugestoes_cliente 
  ON lojas_sugestoes_diarias(cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX idx_sugestoes_pendentes 
  ON lojas_sugestoes_diarias(vendedora_id, prioridade) 
  WHERE status = 'pendente';


-- ─── 7.2 LOG DE CHAMADAS À IA ──────────────────────────────────────────────
-- Auditoria de uso da API + custos
CREATE TABLE IF NOT EXISTS lojas_ia_chamadas_log (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedora_id          uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  user_id               text,
  tipo_prompt           text NOT NULL CHECK (tipo_prompt IN ('sugestoes','mensagem')),
  
  -- métricas
  modelo                text,
  tokens_input          int,
  tokens_output         int,
  tokens_cache_read     int,
  tokens_cache_write    int,
  custo_estimado_usd    numeric(10,4),
  latencia_ms           int,
  
  -- request/response (truncado)
  request_summary       text,
  response_summary      text,
  
  -- erro (se houve)
  erro                  text,
  
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ia_log_vendedora_data 
  ON lojas_ia_chamadas_log(vendedora_id, created_at DESC);
CREATE INDEX idx_ia_log_data 
  ON lojas_ia_chamadas_log(created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  GRUPO 8 — IMPORTAÇÕES (auditoria + dedup)                               │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 8.1 LOG DE IMPORTAÇÕES ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lojas_importacoes (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- arquivo
  nome_arquivo          text NOT NULL,
  tipo_arquivo          text NOT NULL CHECK (tipo_arquivo IN (
    'cadastro_clientes_futura',
    'vendas_clientes_st','vendas_clientes_br',
    'vendas_historico_st','vendas_historico_br',
    'vendas_semanal_st','vendas_semanal_br',
    'produtos_semanal',
    'sacola_st','sacola_br'
  )),
  loja                  text CHECK (loja IS NULL OR loja IN ('Silva Teles','Bom Retiro')),
  drive_file_id         text,
  
  -- estatísticas
  registros_total       int DEFAULT 0,
  registros_inseridos   int DEFAULT 0,
  registros_atualizados int DEFAULT 0,
  registros_ignorados   int DEFAULT 0,
  detalhes_ignorados    jsonb,                        -- {"varejo": 23, "convertr": 12, ...}
  
  -- estado
  status                text NOT NULL DEFAULT 'iniciada' CHECK (status IN ('iniciada','sucesso','erro','parcial')),
  erro                  text,
  
  -- auditoria
  iniciada_em           timestamptz NOT NULL DEFAULT now(),
  finalizada_em         timestamptz,
  duracao_ms            int,
  iniciada_por          text
);

CREATE INDEX idx_importacoes_data ON lojas_importacoes(iniciada_em DESC);
CREATE INDEX idx_importacoes_tipo ON lojas_importacoes(tipo_arquivo);
CREATE INDEX idx_importacoes_status ON lojas_importacoes(status);


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  GRUPO 9 — HISTÓRICO E AÇÕES                                             │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 9.1 HISTÓRICO DE CARTEIRA (auditoria de transferências) ───────────────
CREATE TABLE IF NOT EXISTS lojas_carteira_historico (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id          uuid NOT NULL REFERENCES lojas_clientes(id) ON DELETE CASCADE,
  vendedora_anterior  uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  vendedora_nova      uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  motivo              text,                          -- transferencia | venda_recente | importacao_inicial | manual_admin
  acao_por            text,
  observacao          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_carteira_hist_cliente ON lojas_carteira_historico(cliente_id, created_at DESC);


-- ─── 9.2 AÇÕES DA VENDEDORA (interações com sugestões) ─────────────────────
CREATE TABLE IF NOT EXISTS lojas_acoes (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedora_id        uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  cliente_id          uuid REFERENCES lojas_clientes(id) ON DELETE CASCADE,
  grupo_id            uuid REFERENCES lojas_grupos(id) ON DELETE CASCADE,
  sugestao_id         uuid REFERENCES lojas_sugestoes_diarias(id) ON DELETE SET NULL,
  
  tipo_acao           text NOT NULL,                 -- mensagem_enviada | sacola_acrescentada | promo_oferecida | dispensada | etc
  resultado           text,                          -- sucesso | sem_resposta | recusada | venda
  observacao          text,
  
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_acoes_vendedora_data ON lojas_acoes(vendedora_id, created_at DESC);
CREATE INDEX idx_acoes_cliente ON lojas_acoes(cliente_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  GRUPO 10 — CONFIGURAÇÕES E AGENDA                                       │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 10.1 AGENDA DE FOLLOW-UPS ──────────────────────────────────────────────
-- Lembretes manuais que vendedora pode criar
CREATE TABLE IF NOT EXISTS lojas_agenda (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  vendedora_id        uuid REFERENCES lojas_vendedoras(id) ON DELETE SET NULL,
  cliente_id          uuid REFERENCES lojas_clientes(id) ON DELETE CASCADE,
  grupo_id            uuid REFERENCES lojas_grupos(id) ON DELETE CASCADE,
  
  data_agendada       date NOT NULL,
  titulo              text NOT NULL,
  observacao          text,
  status              text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','feito','cancelado')),
  
  feito_em            timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agenda_vendedora_data 
  ON lojas_agenda(vendedora_id, data_agendada) 
  WHERE status = 'pendente';


-- ─── 10.2 CONFIGURAÇÕES DO MÓDULO ──────────────────────────────────────────
-- Key-value pra parâmetros editáveis (rate limit, modelo IA, etc)
CREATE TABLE IF NOT EXISTS lojas_config (
  chave               text PRIMARY KEY,
  valor               jsonb NOT NULL,
  descricao           text,
  tipo                text DEFAULT 'string' CHECK (tipo IN ('string','number','boolean','json','date')),
  editavel_admin      boolean DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text
);

-- Seed inicial de config
INSERT INTO lojas_config (chave, valor, descricao, tipo) VALUES
  ('modelo_ia',             '"claude-sonnet-4-6"',  'Modelo Anthropic usado',                           'string'),
  ('rate_limit_ms',         '3000',                 'Mínimo entre chamadas IA por vendedora',           'number'),
  ('cache_ttl_seconds',     '300',                  'TTL do cache do system prompt',                    'number'),
  ('horario_geracao_diaria','"06:30"',              'Hora que job de geração de sugestões roda',        'string'),
  ('estoque_minimo_oferta', '100',                  'Mínimo de estoque pra oferta geral',               'number'),
  ('janela_novidade_dias',          '{"inicio": 5, "fim": 12}',  'Janela padrão',  'json'),
  ('janela_novidade_caseado_dias',  '{"inicio": 7, "fim": 14}',  'Janela caseado', 'json')
ON CONFLICT (chave) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  VIEWS                                                                   │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── V1: CARTEIRA EFETIVA (cliente OU grupo, com kpis prontos) ──────────────
-- Une clientes + grupos em uma visão única pra UI
CREATE OR REPLACE VIEW vw_lojas_carteira AS
SELECT 
  c.id                          AS alvo_id,
  'cliente'                     AS alvo_tipo,
  COALESCE(c.apelido, c.razao_social) AS alvo_display,
  c.razao_social,
  c.documento,
  c.telefone_principal,
  c.endereco_cidade,
  c.endereco_uf,
  c.canal_cadastro,
  c.loja_origem,
  c.vendedora_id,
  c.grupo_id,
  k.qtd_compras,
  k.qtd_pecas,
  k.lifetime_total,
  k.ticket_medio,
  k.ultima_compra,
  k.dias_sem_comprar,
  k.status_atual,
  k.fase_ciclo_vida,
  k.canal_dominante,
  k.perfil_presenca,
  k.paga_com_cheque,
  k.estilo_dominante,
  c.arquivado_em,
  c.pular_ate,
  c.created_at,
  c.updated_at
FROM lojas_clientes c
LEFT JOIN lojas_clientes_kpis k ON k.cliente_id = c.id
WHERE c.arquivado_em IS NULL
  AND c.grupo_id IS NULL;  -- clientes em grupos aparecem só agregados


-- ─── V2: GRUPOS AGREGADOS (1 linha por grupo, soma dos clientes) ────────────
CREATE OR REPLACE VIEW vw_lojas_grupos_agregados AS
SELECT 
  g.id                                AS alvo_id,
  'grupo'                             AS alvo_tipo,
  COALESCE(g.apelido, g.nome_grupo)   AS alvo_display,
  g.nome_grupo,
  g.vendedora_id,
  COUNT(c.id)                         AS qtd_documentos,
  ARRAY_AGG(c.razao_social ORDER BY c.razao_social) AS razoes_lojas,
  ARRAY_AGG(c.documento ORDER BY c.documento) AS documentos,
  -- agregados de KPIs
  COALESCE(SUM(k.qtd_compras), 0)     AS qtd_compras_total,
  COALESCE(SUM(k.lifetime_total), 0)  AS lifetime_grupo,
  CASE WHEN COALESCE(SUM(k.qtd_compras), 0) > 0
       THEN COALESCE(SUM(k.lifetime_total), 0) / SUM(k.qtd_compras)
       ELSE 0 END                     AS ticket_medio_grupo,
  MAX(k.ultima_compra)                AS ultima_compra_grupo,
  MIN(k.dias_sem_comprar)             AS dias_sem_comprar_grupo,  -- mais recente do grupo
  -- pega telefone do "principal" (primeiro CNPJ ativo)
  (SELECT telefone_principal FROM lojas_clientes 
   WHERE grupo_id = g.id AND arquivado_em IS NULL 
   ORDER BY created_at LIMIT 1)        AS telefone_grupo,
  g.created_at,
  g.updated_at
FROM lojas_grupos g
LEFT JOIN lojas_clientes c ON c.grupo_id = g.id AND c.arquivado_em IS NULL
LEFT JOIN lojas_clientes_kpis k ON k.cliente_id = c.id
WHERE g.arquivado_em IS NULL
GROUP BY g.id, g.nome_grupo, g.apelido, g.vendedora_id, g.created_at, g.updated_at;


-- ─── V3: SUGESTÕES PENDENTES POR VENDEDORA (do dia atual) ──────────────────
CREATE OR REPLACE VIEW vw_lojas_sugestoes_hoje AS
SELECT 
  s.*,
  v.nome AS vendedora_nome,
  v.loja AS vendedora_loja,
  CASE 
    WHEN s.alvo_tipo = 'cliente' THEN c.razao_social
    WHEN s.alvo_tipo = 'grupo' THEN g.nome_grupo
  END AS alvo_razao_completa,
  CASE 
    WHEN s.alvo_tipo = 'cliente' THEN c.telefone_principal
    WHEN s.alvo_tipo = 'grupo' THEN (
      SELECT telefone_principal FROM lojas_clientes 
      WHERE grupo_id = s.grupo_id LIMIT 1
    )
  END AS telefone
FROM lojas_sugestoes_diarias s
JOIN lojas_vendedoras v ON v.id = s.vendedora_id
LEFT JOIN lojas_clientes c ON c.id = s.cliente_id
LEFT JOIN lojas_grupos g ON g.id = s.grupo_id
WHERE s.data_geracao = CURRENT_DATE
  AND s.status = 'pendente'
ORDER BY v.nome, s.prioridade;


-- ─── V4: PRODUTOS OFERECÍVEIS (combinando todas as fontes) ─────────────────
CREATE OR REPLACE VIEW vw_lojas_produtos_oferecveis AS
WITH curadoria_ativa AS (
  SELECT ref, tipo
  FROM lojas_produtos_curadoria
  WHERE ativo = true
    AND (data_fim IS NULL OR data_fim >= CURRENT_DATE)
)
SELECT 
  p.ref,
  p.descricao,
  p.categoria,
  p.qtd_estoque,
  p.preco_medio,
  -- consolida razão de oferta
  CASE 
    WHEN p.novidade_inicia_em <= CURRENT_DATE 
         AND p.novidade_termina_em >= CURRENT_DATE 
      THEN 'novidade_oficina'
    WHEN cur_bs.tipo = 'best_seller'      THEN 'best_seller'
    WHEN cur_alta.tipo = 'em_alta'        THEN 'em_alta'
    WHEN cur_nov.tipo = 'novidade_manual' THEN 'novidade_manual'
    WHEN p.qtd_estoque > 100              THEN 'estoque'
    ELSE NULL
  END AS motivo_oferta,
  -- score pra ranking
  CASE 
    WHEN p.novidade_inicia_em <= CURRENT_DATE AND p.novidade_termina_em >= CURRENT_DATE THEN 100
    WHEN cur_bs.tipo IS NOT NULL    THEN 80
    WHEN cur_alta.tipo IS NOT NULL  THEN 70
    WHEN cur_nov.tipo IS NOT NULL   THEN 90
    WHEN p.qtd_estoque > 100        THEN 50
    ELSE 0
  END AS score_relevancia
FROM lojas_produtos p
LEFT JOIN curadoria_ativa cur_bs    ON cur_bs.ref = p.ref AND cur_bs.tipo = 'best_seller'
LEFT JOIN curadoria_ativa cur_alta  ON cur_alta.ref = p.ref AND cur_alta.tipo = 'em_alta'
LEFT JOIN curadoria_ativa cur_nov   ON cur_nov.ref = p.ref AND cur_nov.tipo = 'novidade_manual'
WHERE p.tem_zero_a_esquerda = false  -- só REFs cadastradas sem zero
  AND p.descricao IS NOT NULL
  AND (
    -- pelo menos uma razão pra oferecer
    (p.novidade_inicia_em <= CURRENT_DATE AND p.novidade_termina_em >= CURRENT_DATE)
    OR cur_bs.tipo IS NOT NULL
    OR cur_alta.tipo IS NOT NULL
    OR cur_nov.tipo IS NOT NULL
    OR p.qtd_estoque > 100
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  FUNÇÕES DE NEGÓCIO                                                      │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── F1: RECALCULAR KPIs DE UM CLIENTE ─────────────────────────────────────
CREATE OR REPLACE FUNCTION lojas_recalcular_kpis_cliente(p_cliente_id uuid)
RETURNS void AS $$
DECLARE
  v_qtd_compras int;
  v_qtd_pecas int;
  v_lifetime numeric(12,2);
  v_ticket numeric(12,2);
  v_primeira date;
  v_ultima date;
  v_dias_sem int;
  v_qtd_fisicas int;
  v_qtd_vesti int;
  v_qtd_convertr int;
  v_lifetime_fisico numeric(12,2);
  v_lifetime_marketplace numeric(12,2);
  v_canal_dominante text;
  v_qtd_pres int;
  v_qtd_dist int;
  v_qtd_fiel int;
  v_perfil text;
  v_paga_cheque boolean;
  v_status text;
  v_fase text;
  v_tem_sacola boolean;
  v_dias_desde_1a int;
BEGIN
  -- Agrega vendas (só vendas reais, ignora canceladas)
  SELECT 
    COUNT(*), 
    COALESCE(SUM(qtd_pecas), 0),
    COALESCE(SUM(valor_liquido), 0),
    MIN(data_venda),
    MAX(data_venda),
    COUNT(*) FILTER (WHERE canal_origem = 'fisico'),
    COUNT(*) FILTER (WHERE canal_origem = 'vesti'),
    COUNT(*) FILTER (WHERE canal_origem = 'convertr'),
    COALESCE(SUM(valor_liquido) FILTER (WHERE canal_origem = 'fisico'), 0),
    COALESCE(SUM(valor_liquido) FILTER (WHERE canal_origem IN ('vesti','convertr')), 0),
    COUNT(*) FILTER (WHERE forma_pagamento_categoria = 'vem_na_loja'),
    COUNT(*) FILTER (WHERE forma_pagamento_categoria = 'distancia'),
    COUNT(*) FILTER (WHERE forma_pagamento_categoria = 'fiel_confianca')
  INTO 
    v_qtd_compras, v_qtd_pecas, v_lifetime, v_primeira, v_ultima,
    v_qtd_fisicas, v_qtd_vesti, v_qtd_convertr,
    v_lifetime_fisico, v_lifetime_marketplace,
    v_qtd_pres, v_qtd_dist, v_qtd_fiel
  FROM lojas_vendas
  WHERE cliente_id = p_cliente_id;
  
  -- Ticket médio
  v_ticket := CASE WHEN v_qtd_compras > 0 THEN v_lifetime / v_qtd_compras ELSE 0 END;
  
  -- Dias sem comprar
  -- BUG FIX (28/04/2026): EXTRACT(DAY FROM date-date) retorna NULL silencioso
  -- porque date - date já é integer em Postgres. Subtração direta é o certo.
  v_dias_sem := CASE WHEN v_ultima IS NULL THEN NULL 
                     ELSE (CURRENT_DATE - v_ultima)::int END;
  
  -- Canal dominante (70%+)
  v_canal_dominante := CASE 
    WHEN v_qtd_compras = 0 THEN NULL
    WHEN v_qtd_fisicas::float / v_qtd_compras >= 0.7 THEN 'fisico_dominante'
    WHEN v_qtd_vesti::float / v_qtd_compras >= 0.7 THEN 'vesti_dominante'
    WHEN v_qtd_convertr::float / v_qtd_compras >= 0.7 THEN 'convertr_dominante'
    ELSE 'misto'
  END;
  
  -- Perfil de presença (denominador ignora multiplo/desconhecido)
  v_perfil := CASE 
    WHEN (v_qtd_pres + v_qtd_dist + v_qtd_fiel) = 0 THEN 'desconhecido'
    WHEN v_qtd_pres::float / (v_qtd_pres + v_qtd_dist + v_qtd_fiel) >= 0.7 THEN 'presencial_dominante'
    WHEN v_qtd_dist::float / (v_qtd_pres + v_qtd_dist + v_qtd_fiel) >= 0.7 THEN 'remota_dominante'
    WHEN v_qtd_fiel::float / (v_qtd_pres + v_qtd_dist + v_qtd_fiel) >= 0.7 THEN 'fiel_cheque'
    ELSE 'hibrida'
  END;
  
  v_paga_cheque := v_qtd_fiel > 0;
  
  -- Tem pedido em sacola ativo?
  SELECT EXISTS (
    SELECT 1 FROM lojas_pedidos_sacola 
    WHERE cliente_id = p_cliente_id AND ativo = true
  ) INTO v_tem_sacola;
  
  -- Status visual
  v_status := CASE
    WHEN v_tem_sacola                THEN 'separandoSacola'
    WHEN v_dias_sem IS NULL          THEN 'arquivo'
    WHEN v_dias_sem <= 45            THEN 'ativo'
    WHEN v_dias_sem <= 90            THEN 'atencao'
    WHEN v_dias_sem <= 180           THEN 'semAtividade'
    WHEN v_dias_sem <= 365           THEN 'inativo'
    ELSE 'arquivo'
  END;
  
  -- Fase ciclo de vida
  -- BUG FIX (28/04/2026): mesma causa do v_dias_sem acima
  v_dias_desde_1a := CASE WHEN v_primeira IS NULL THEN NULL
                          ELSE (CURRENT_DATE - v_primeira)::int END;
  v_fase := CASE
    WHEN v_dias_desde_1a IS NULL              THEN 'sem_compras_ainda'
    WHEN v_dias_desde_1a <= 14                THEN 'nova_aguardando'
    WHEN v_dias_desde_1a = 15                 THEN 'nova_checkin_pronto'
    WHEN v_dias_desde_1a <= 30                THEN 'nova_em_analise'
    ELSE 'normal'
  END;
  
  -- Upsert no kpis
  INSERT INTO lojas_clientes_kpis (
    cliente_id, qtd_compras, qtd_pecas, lifetime_total, ticket_medio,
    primeira_compra, ultima_compra, dias_sem_comprar,
    qtd_compras_fisicas, qtd_compras_vesti, qtd_compras_convertr,
    lifetime_fisico, lifetime_marketplace, canal_dominante,
    perfil_presenca, pct_compras_presenciais, paga_com_cheque,
    fase_ciclo_vida, status_atual, ultima_atualizacao
  ) VALUES (
    p_cliente_id, v_qtd_compras, v_qtd_pecas, v_lifetime, v_ticket,
    v_primeira, v_ultima, v_dias_sem,
    v_qtd_fisicas, v_qtd_vesti, v_qtd_convertr,
    v_lifetime_fisico, v_lifetime_marketplace, v_canal_dominante,
    v_perfil, 
    CASE WHEN v_qtd_compras > 0 THEN v_qtd_pres::numeric * 100 / v_qtd_compras ELSE 0 END,
    v_paga_cheque,
    v_fase, v_status, now()
  )
  ON CONFLICT (cliente_id) DO UPDATE SET
    qtd_compras = EXCLUDED.qtd_compras,
    qtd_pecas = EXCLUDED.qtd_pecas,
    lifetime_total = EXCLUDED.lifetime_total,
    ticket_medio = EXCLUDED.ticket_medio,
    primeira_compra = EXCLUDED.primeira_compra,
    ultima_compra = EXCLUDED.ultima_compra,
    dias_sem_comprar = EXCLUDED.dias_sem_comprar,
    qtd_compras_fisicas = EXCLUDED.qtd_compras_fisicas,
    qtd_compras_vesti = EXCLUDED.qtd_compras_vesti,
    qtd_compras_convertr = EXCLUDED.qtd_compras_convertr,
    lifetime_fisico = EXCLUDED.lifetime_fisico,
    lifetime_marketplace = EXCLUDED.lifetime_marketplace,
    canal_dominante = EXCLUDED.canal_dominante,
    perfil_presenca = EXCLUDED.perfil_presenca,
    pct_compras_presenciais = EXCLUDED.pct_compras_presenciais,
    paga_com_cheque = EXCLUDED.paga_com_cheque,
    fase_ciclo_vida = EXCLUDED.fase_ciclo_vida,
    status_atual = EXCLUDED.status_atual,
    ultima_atualizacao = now();
END;
$$ LANGUAGE plpgsql;


-- ─── F2: RECALCULAR KPIs DE TODOS OS CLIENTES ──────────────────────────────
-- Roda em batch após importação semanal
CREATE OR REPLACE FUNCTION lojas_recalcular_kpis_todos()
RETURNS int AS $$
DECLARE
  v_count int := 0;
  r record;
BEGIN
  FOR r IN SELECT id FROM lojas_clientes WHERE arquivado_em IS NULL LOOP
    PERFORM lojas_recalcular_kpis_cliente(r.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;


-- ─── F3: BUSCAR ALVO (cliente OU grupo) ────────────────────────────────────
-- Helper pra UI que busca cliente, mas se cliente faz parte de grupo, retorna grupo
CREATE OR REPLACE FUNCTION lojas_buscar_alvo(p_documento text)
RETURNS TABLE(alvo_tipo text, alvo_id uuid, alvo_display text) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE WHEN c.grupo_id IS NOT NULL THEN 'grupo' ELSE 'cliente' END,
    COALESCE(c.grupo_id, c.id),
    CASE WHEN c.grupo_id IS NOT NULL 
         THEN (SELECT COALESCE(g.apelido, g.nome_grupo) FROM lojas_grupos g WHERE g.id = c.grupo_id)
         ELSE COALESCE(c.apelido, c.razao_social)
    END
  FROM lojas_clientes c
  WHERE c.documento = REGEXP_REPLACE(p_documento, '\D', '', 'g')
    AND c.arquivado_em IS NULL
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  RLS — ROW LEVEL SECURITY                                                │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════
-- Princípio:
--   • Admins (amicia-admin, ailson, tamara) veem tudo
--   • Vendedoras veem só a própria carteira (vendedora_id = sua)
--   • Tabelas globais (produtos, promoções, config) leitura livre

-- Habilita RLS em todas as tabelas
ALTER TABLE lojas_admins              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_vendedoras          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_grupos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_clientes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_clientes_kpis       ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_vendas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_pedidos_sacola      ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_produtos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_produtos_curadoria  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_promocoes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_sugestoes_diarias   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_ia_chamadas_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_importacoes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_carteira_historico  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_acoes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_agenda              ENABLE ROW LEVEL SECURITY;
ALTER TABLE lojas_config              ENABLE ROW LEVEL SECURITY;

-- ─── POLÍTICA: ADMINS VEEM TUDO ────────────────────────────────────────────
-- Aplicada a TODAS as tabelas
DO $$
DECLARE
  t text;
  tabelas text[] := ARRAY[
    'lojas_admins','lojas_vendedoras','lojas_grupos','lojas_clientes',
    'lojas_clientes_kpis','lojas_vendas','lojas_pedidos_sacola',
    'lojas_produtos','lojas_produtos_curadoria','lojas_promocoes',
    'lojas_sugestoes_diarias','lojas_ia_chamadas_log','lojas_importacoes',
    'lojas_carteira_historico','lojas_acoes','lojas_agenda','lojas_config'
  ];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('
      DROP POLICY IF EXISTS admin_all_access ON %I;
      CREATE POLICY admin_all_access ON %I
        FOR ALL
        USING (lojas_eh_admin(auth.uid()::text))
        WITH CHECK (lojas_eh_admin(auth.uid()::text));
    ', t, t);
  END LOOP;
END $$;

-- ─── POLÍTICA: VENDEDORA VÊ SÓ PRÓPRIA CARTEIRA (clientes) ─────────────────
DROP POLICY IF EXISTS vendedora_propria_carteira ON lojas_clientes;
CREATE POLICY vendedora_propria_carteira ON lojas_clientes
  FOR SELECT
  USING (
    vendedora_id IN (
      SELECT id FROM lojas_vendedoras WHERE user_id = auth.uid()::text
    )
  );

-- ─── POLÍTICA: VENDEDORA VÊ KPIs DA PRÓPRIA CARTEIRA ───────────────────────
DROP POLICY IF EXISTS vendedora_proprio_kpi ON lojas_clientes_kpis;
CREATE POLICY vendedora_proprio_kpi ON lojas_clientes_kpis
  FOR SELECT
  USING (
    cliente_id IN (
      SELECT c.id FROM lojas_clientes c
      JOIN lojas_vendedoras v ON v.id = c.vendedora_id
      WHERE v.user_id = auth.uid()::text
    )
  );

-- ─── POLÍTICA: VENDEDORA VÊ VENDAS DA PRÓPRIA CARTEIRA ─────────────────────
DROP POLICY IF EXISTS vendedora_proprias_vendas ON lojas_vendas;
CREATE POLICY vendedora_proprias_vendas ON lojas_vendas
  FOR SELECT
  USING (
    vendedora_id IN (
      SELECT id FROM lojas_vendedoras WHERE user_id = auth.uid()::text
    )
  );

-- ─── POLÍTICA: VENDEDORA VÊ SACOLA DA PRÓPRIA CARTEIRA ─────────────────────
DROP POLICY IF EXISTS vendedora_propria_sacola ON lojas_pedidos_sacola;
CREATE POLICY vendedora_propria_sacola ON lojas_pedidos_sacola
  FOR SELECT
  USING (
    vendedora_id IN (
      SELECT id FROM lojas_vendedoras WHERE user_id = auth.uid()::text
    )
  );

-- ─── POLÍTICA: VENDEDORA VÊ PRÓPRIAS SUGESTÕES ─────────────────────────────
DROP POLICY IF EXISTS vendedora_propria_sugestao ON lojas_sugestoes_diarias;
CREATE POLICY vendedora_propria_sugestao ON lojas_sugestoes_diarias
  FOR ALL
  USING (
    vendedora_id IN (
      SELECT id FROM lojas_vendedoras WHERE user_id = auth.uid()::text
    )
  );

-- ─── POLÍTICA: VENDEDORA VÊ PRÓPRIA AGENDA ─────────────────────────────────
DROP POLICY IF EXISTS vendedora_propria_agenda ON lojas_agenda;
CREATE POLICY vendedora_propria_agenda ON lojas_agenda
  FOR ALL
  USING (
    vendedora_id IN (
      SELECT id FROM lojas_vendedoras WHERE user_id = auth.uid()::text
    )
  );

-- ─── POLÍTICA: VENDEDORA REGISTRA PRÓPRIAS AÇÕES ───────────────────────────
DROP POLICY IF EXISTS vendedora_propria_acao ON lojas_acoes;
CREATE POLICY vendedora_propria_acao ON lojas_acoes
  FOR ALL
  USING (
    vendedora_id IN (
      SELECT id FROM lojas_vendedoras WHERE user_id = auth.uid()::text
    )
  );

-- ─── POLÍTICA: TODAS LEEM PRODUTOS, PROMOÇÕES, CURADORIA, CONFIG ──────────
DROP POLICY IF EXISTS todos_leem_produtos ON lojas_produtos;
CREATE POLICY todos_leem_produtos ON lojas_produtos
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS todos_leem_curadoria ON lojas_produtos_curadoria;
CREATE POLICY todos_leem_curadoria ON lojas_produtos_curadoria
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS todos_leem_promocoes ON lojas_promocoes;
CREATE POLICY todos_leem_promocoes ON lojas_promocoes
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS todos_leem_vendedoras ON lojas_vendedoras;
CREATE POLICY todos_leem_vendedoras ON lojas_vendedoras
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS todos_leem_config ON lojas_config;
CREATE POLICY todos_leem_config ON lojas_config
  FOR SELECT USING (auth.role() = 'authenticated');


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  REALTIME (notificar mudanças pra UI)                                    │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════
-- Tabelas que notificam mudanças via Supabase Realtime:
--   • Sugestões (vendedora vê alteração em tempo real)
--   • Pedidos sacola (status muda — atualizar contador)
--   • Importações (admin vê progresso)

ALTER PUBLICATION supabase_realtime ADD TABLE lojas_sugestoes_diarias;
ALTER PUBLICATION supabase_realtime ADD TABLE lojas_pedidos_sacola;
ALTER PUBLICATION supabase_realtime ADD TABLE lojas_importacoes;
ALTER PUBLICATION supabase_realtime ADD TABLE lojas_clientes_kpis;


-- ═══════════════════════════════════════════════════════════════════════════
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  COMENTÁRIOS NAS TABELAS (documentação inline)                           │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE lojas_admins IS 'Usuários com acesso total ao módulo Lojas (veem todas carteiras)';
COMMENT ON TABLE lojas_vendedoras IS 'Vendedoras das 2 lojas físicas. Aliases mapeiam variações de nome do Miré';
COMMENT ON TABLE lojas_grupos IS 'Grupos de clientes (lojista com múltiplos CNPJs)';
COMMENT ON TABLE lojas_clientes IS 'Clientes (lojistas atacado). Chave única: documento (CNPJ/CPF)';
COMMENT ON TABLE lojas_clientes_kpis IS 'Cache de KPIs do cliente. Atualizado por job batch após cada importação';
COMMENT ON TABLE lojas_vendas IS 'Vendas detalhadas. Dedup por (numero_pedido + loja). Importadas semanalmente';
COMMENT ON TABLE lojas_pedidos_sacola IS 'Pedidos em espera (sacola separando). data_cadastro_sacola é fixa';
COMMENT ON TABLE lojas_produtos IS 'Produtos do catálogo. Filtro de oferta: estoque > 100 OU em curadoria OU novidade';
COMMENT ON TABLE lojas_produtos_curadoria IS 'Best-sellers + em alta + novidades manuais (atualizado pelo admin)';
COMMENT ON TABLE lojas_sugestoes_diarias IS 'Sugestões geradas pela IA. 7 por vendedora/dia';
COMMENT ON TABLE lojas_importacoes IS 'Auditoria de cada importação de arquivo (sucesso/erro/contagens)';
COMMENT ON COLUMN lojas_produtos.data_entrega_oficina IS 'IMPORTANTE: vem do MÓDULO OFICINAS, não da sala de corte';
COMMENT ON COLUMN lojas_pedidos_sacola.data_cadastro_sacola IS 'Data fixa quando virou em espera. Usar pra calcular dias';
COMMENT ON COLUMN lojas_pedidos_sacola.data_ultima_atualizacao IS 'Muda quando cliente acrescenta peças. Indicador auxiliar';


-- ═══════════════════════════════════════════════════════════════════════════
-- FIM DO SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- Próximos passos (já fora deste arquivo):
--   1. Edge Functions de importação (lê CSV/PDF do Drive, popula tabelas)
--   2. Edge Function de geração de sugestões (chama Anthropic API)
--   3. Lojas.jsx (UI que consome estas tabelas)
--
-- Pra resetar (desenvolvimento):
--   DROP TABLE lojas_admins, lojas_vendedoras, ... CASCADE;
--   DROP VIEW vw_lojas_carteira, ... ;
--   DROP FUNCTION lojas_recalcular_kpis_cliente, ... ;
--
-- ═══════════════════════════════════════════════════════════════════════════
