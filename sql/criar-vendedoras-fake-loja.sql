-- ═══════════════════════════════════════════════════════════════════════════
-- Vendedoras FAKE — Loja Bom Retiro / Loja Silva Teles
-- Sessao Ailson 06/05/2026.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CONCEITO: vendas com vendedor desconhecido (vazio, "LOJA BOM RETIRO",
-- "LOJA SILVA TELES", vendedora teste tipo "Julia" sem cadastro etc) NAO
-- devem cair na vendedora padrao da loja (Celia/Cleide), porque inflam
-- a comissao delas com vendas que nao foram suas.
--
-- SOLUCAO: criar 2 "vendedoras fake" no sistema:
--   - Loja Bom Retiro  (loja=Bom Retiro)
--   - Loja Silva Teles (loja=Silva Teles)
--
-- Toda venda sem vendedor identificado vai pra fake correta da loja.
-- Cliente continua absorvido por Celia/Cleide (regra cliente intocada).
--
-- COMPORTAMENTO:
-- - Card de metas mostra a fake como linha separada (transparencia total)
-- - Total da loja BR/ST inclui a fake (ja blindado pelo fix anterior)
-- - Quando vendedora teste virar fixa, admin migra clientes/vendas dela
--   manualmente do historico da fake
--
-- IDEMPOTENTE: usa ON CONFLICT DO NOTHING — pode rodar varias vezes
-- ═══════════════════════════════════════════════════════════════════════════

-- Inserir vendedoras fake
INSERT INTO lojas_vendedoras (
  nome,
  loja,
  ativa,
  is_placeholder,
  is_padrao_loja,
  aliases,
  user_id,
  created_at
) VALUES
  ('Loja Bom Retiro',  'Bom Retiro',  true, false, false, ARRAY['LOJA BOM RETIRO', 'LOJA BR'],   'fake-br', now()),
  ('Loja Silva Teles', 'Silva Teles', true, false, false, ARRAY['LOJA SILVA TELES', 'LOJA ST'], 'fake-st', now())
ON CONFLICT (nome) DO NOTHING;

-- Validacao: confirmar criacao
SELECT id, nome, loja, ativa, is_placeholder, is_padrao_loja, aliases
FROM lojas_vendedoras
WHERE nome IN ('Loja Bom Retiro', 'Loja Silva Teles')
ORDER BY loja;
