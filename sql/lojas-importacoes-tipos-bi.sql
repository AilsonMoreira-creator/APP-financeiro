-- ═══════════════════════════════════════════════════════════════════════════
-- LOJAS — adicionar 'relatorio_bi_*' no CHECK de tipo_arquivo
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Decisão Ailson 28/04/2026: Relatório BI do Mire é tipo novo (xlsx por SKU).
-- O CHECK constraint original (criado em sql/lojas-modulo-schema.sql) não
-- inclui 'relatorio_bi_st' e 'relatorio_bi_br', o que faz inserts em
-- lojas_importacoes falharem silenciosamente quando o trigger processa esses
-- arquivos.
--
-- Esse SQL recria o CHECK adicionando os 2 novos valores. Idempotente
-- (DROP IF EXISTS + ADD).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE lojas_importacoes
  DROP CONSTRAINT IF EXISTS lojas_importacoes_tipo_arquivo_check;

ALTER TABLE lojas_importacoes
  ADD CONSTRAINT lojas_importacoes_tipo_arquivo_check
  CHECK (tipo_arquivo IN (
    'cadastro_clientes_futura',
    'vendas_clientes_st','vendas_clientes_br',
    'vendas_historico_st','vendas_historico_br',
    'vendas_semanal_st','vendas_semanal_br',
    'produtos_semanal',
    'sacola_st','sacola_br',
    'relatorio_bi_st','relatorio_bi_br'
  ));

-- Validação
-- SELECT DISTINCT tipo_arquivo FROM lojas_importacoes ORDER BY tipo_arquivo;
