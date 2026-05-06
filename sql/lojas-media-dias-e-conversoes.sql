-- ═══════════════════════════════════════════════════════════════════════════
-- MEDIA DIAS ENTRE COMPRAS + ARQUIVO DE CONVERSÕES
-- Sessão Ailson 01/05/2026
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Adiciona coluna media_dias_compras em kpis
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE lojas_clientes_kpis
  ADD COLUMN IF NOT EXISTS media_dias_compras numeric(6,2);

-- Coluna auxiliar pra saber se a média é "confiável" (>= 5 compras)
ALTER TABLE lojas_clientes_kpis
  ADD COLUMN IF NOT EXISTS media_dias_confiavel boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_kpis_media_dias
  ON lojas_clientes_kpis(media_dias_compras);

COMMENT ON COLUMN lojas_clientes_kpis.media_dias_compras IS
  'Média ponderada de dias entre compras (últimas 5 compras, recentes pesam mais). '
  'Usada pra calcular status custom: cliente trimestral (média 90d) só entra em '
  'atenção em 72d (90 × 0.8), não em 45d. Recalculada no cron de KPIs.';

COMMENT ON COLUMN lojas_clientes_kpis.media_dias_confiavel IS
  'TRUE quando cliente tem >=5 compras. Quando FALSE, usa faixas default '
  '(45/90/180/365) sem aplicar fórmula custom.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Tabela de arquivo de conversões (histórico permanente)
-- ───────────────────────────────────────────────────────────────────────────
-- Conversão = mensagem enviada pra cliente status atencao/semAtividade/inativo
-- e cliente comprou da MESMA vendedora em até 15 dias depois.
-- Cron diário de KPIs grava aqui pra preservar histórico mesmo se mensagem
-- ou venda forem deletadas/arquivadas depois.
CREATE TABLE IF NOT EXISTS lojas_conversoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedora_id      uuid NOT NULL REFERENCES lojas_vendedoras(id) ON DELETE CASCADE,
  cliente_id        uuid NOT NULL REFERENCES lojas_clientes(id)   ON DELETE CASCADE,
  -- Mensagem original (pode ter sido arquivada — guardamos snapshot)
  mensagem_id       uuid,                  -- referencia a lojas_acoes (sem FK pra preservar)
  data_mensagem     date NOT NULL,
  status_no_envio   text NOT NULL CHECK (status_no_envio IN ('atencao','semAtividade','inativo')),
  -- Venda que converteu
  venda_id          uuid,                  -- referencia a lojas_vendas
  data_venda        date NOT NULL,
  dias_ate_compra   int NOT NULL CHECK (dias_ate_compra >= 0 AND dias_ate_compra <= 15),
  valor_venda       numeric(12,2),
  -- Snapshot do cliente (pra historico estavel)
  cliente_nome      text,
  -- Auditoria
  registrado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversoes_vendedora_data
  ON lojas_conversoes(vendedora_id, data_venda DESC);
CREATE INDEX IF NOT EXISTS idx_conversoes_cliente
  ON lojas_conversoes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_conversoes_mensagem
  ON lojas_conversoes(mensagem_id);
-- Evita duplicar mesma conversão (mensagem→venda) se cron rodar várias vezes
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversoes_msg_venda
  ON lojas_conversoes(mensagem_id, venda_id)
  WHERE mensagem_id IS NOT NULL AND venda_id IS NOT NULL;

ALTER TABLE lojas_conversoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_conversoes_select" ON lojas_conversoes;
DROP POLICY IF EXISTS "lojas_conversoes_modify" ON lojas_conversoes;
CREATE POLICY "lojas_conversoes_select" ON lojas_conversoes FOR SELECT USING (true);
CREATE POLICY "lojas_conversoes_modify" ON lojas_conversoes FOR ALL    USING (true) WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. View consolidada de conversões por vendedora x período
-- ───────────────────────────────────────────────────────────────────────────
-- Usada pelo dashboard pra mostrar card "Conversões" com filtros de período.
-- Frontend filtra por vendedora_id + data_venda.
CREATE OR REPLACE VIEW vw_lojas_conversoes_dashboard AS
SELECT
  vendedora_id,
  data_venda,
  status_no_envio,
  dias_ate_compra,
  valor_venda,
  cliente_id,
  cliente_nome
FROM lojas_conversoes
ORDER BY data_venda DESC;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. (REMOVIDO 06/05/2026 — funcao bugada)
-- ───────────────────────────────────────────────────────────────────────────
-- Esse arquivo originalmente tinha um CREATE OR REPLACE FUNCTION
-- lojas_recalcular_kpis_cliente que SOBRESCREVIA a versao canonica do
-- sql/lojas-modulo-schema.sql. A versao aqui era incompleta:
--   - Nao tinha a Camada 1 (canal_cadastro='vesti' prevalece)
--   - Gravava 'fisico' (sem sufixo _dominante)
-- Resultado: 41 clientes Vesti viraram 'fisico' depois que essa migracao
-- rodou. Bug descoberto em 06/05/2026 e corrigido com sql/fix-recalcular-
-- kpis-canal-vesti.sql que reinstalou a versao correta.
--
-- A FUNCAO CANONICA EH a do schema principal (sql/lojas-modulo-schema.sql
-- linhas 930-1091). NAO criar mais funcoes com esse nome.
--
-- A logica de media_dias_compras que estava aqui foi perdida. Se for
-- preciso recalcular media_dias_compras, criar uma funcao SEPARADA
-- (ex: lojas_recalcular_media_dias_cliente) e chama-la apos a funcao
-- principal — NAO sobrescrever lojas_recalcular_kpis_cliente.


-- Rodar UMA VEZ pra recalcular todos os clientes com a nova fórmula:
--   SELECT lojas_recalcular_kpis_todos();
-- (já existente — não precisa alterar)


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Atualizar CHECK de lojas_sugestoes_diarias.tipo
-- ───────────────────────────────────────────────────────────────────────────
-- Adiciona 'inativo' e 'semAtividade' (nova distribuição). Mantém 'reativar'
-- por compatibilidade com sugestões antigas no histórico.
ALTER TABLE lojas_sugestoes_diarias DROP CONSTRAINT IF EXISTS lojas_sugestoes_diarias_tipo_check;
ALTER TABLE lojas_sugestoes_diarias ADD CONSTRAINT lojas_sugestoes_diarias_tipo_check
  CHECK (tipo IN (
    'reativar','atencao','novidade','followup','followup_nova','sacola',
    'reposicao','aviso_admin','inativo','semAtividade'
  ));
