-- =====================================================================
-- OS Amícia · Fase 1 · Seed ia_sazonalidade (5 datas)
-- Versão: 1.0 · Data: 21/04/2026
-- =====================================================================
--
-- RODAR DEPOIS de 01_tables.sql.
--
-- Popula as 5 datas hardcoded de sazonalidade.
-- Admin pode editar/adicionar/desativar depois via endpoint.
--
-- IMPORTANTE: as datas são do ano corrente (2026). A cada ano, admin
-- deve atualizar as datas pra o ano corrente (ou criamos função que
-- rola automaticamente — ver Sprint 7).
-- =====================================================================


-- Remove datas antigas só se ninguém adicionou customizadas ainda.
-- Usamos UPSERT-like: insere se não existir pelo nome + ano.
INSERT INTO ia_sazonalidade (nome, data, janela_dias_antes, multiplicador_demanda, observacao, ativo)
SELECT * FROM (VALUES
  ('Dia das Mães',        DATE '2026-05-10', 30, 1.40, 'Pico tradicional — vestidos, blusas elegantes', true),
  ('Dia dos Namorados',   DATE '2026-06-12', 21, 1.20, 'Vestidos midi, peças românticas', true),
  ('Liquida Mercado Livre', DATE '2026-08-15', 14, 1.30, 'Evento de promoção ML — estocar com antecedência', true),
  ('Black Friday',        DATE '2026-11-27', 45, 1.60, 'Maior pico do ano — estocar com bastante antecedência', true),
  ('Natal',               DATE '2026-12-20', 30, 1.35, 'Pico final do ano — vestidos de festa, peças brilhantes', true)
) AS v(nome, data, janela_dias_antes, multiplicador_demanda, observacao, ativo)
WHERE NOT EXISTS (
  SELECT 1 FROM ia_sazonalidade s
  WHERE s.nome = v.nome AND EXTRACT(YEAR FROM s.data) = EXTRACT(YEAR FROM v.data)
);
