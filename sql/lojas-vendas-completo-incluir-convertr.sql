-- ═══════════════════════════════════════════════════════════════════════════
-- Atualiza vw_lojas_vendas_completo pra incluir canal 'convertr'
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Motivo: vendas captadas pela agência Convertr (Meta Ads) devem entrar
-- na base de meta + comissão das vendedoras de Bom Retiro. View original
-- (Sprint A, 04/05/2026) só pegava 'fisico' + 'vesti'.
--
-- Sessão Ailson 09/05/2026 — debug do módulo Folha de Pagamento revelou
-- diferença em Bom Retiro vs valor real.
--
-- Idempotente (CREATE OR REPLACE).
-- Afeta: src/FolhaPagamento.jsx, api/lojas-ia.js (metas_dashboard),
--        api/lojas-receitas-cron-diario.js, api/folha-debug.js
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW vw_lojas_vendas_completo AS
SELECT
  v.numero_pedido,
  v.loja,
  v.data_venda,
  v.vendedora_id,
  v.valor_liquido,
  'atacado'::text                                     AS categoria,
  v.canal_origem,
  v.cliente_id
FROM lojas_vendas v
WHERE v.canal_origem IN ('fisico', 'vesti', 'convertr')   -- + convertr 09/05/2026

UNION ALL

SELECT
  vr.numero_pedido,
  vr.loja,
  vr.data_venda,
  vr.vendedora_id,
  vr.valor_liquido,
  'varejo'::text                                      AS categoria,
  'fisico'::text                                      AS canal_origem,
  NULL::uuid                                          AS cliente_id
FROM lojas_vendas_varejo vr;

COMMENT ON VIEW vw_lojas_vendas_completo IS
  'Une atacado (lojas_vendas: fisico + vesti + convertr) + varejo (lojas_vendas_varejo) pro card de metas e Folha de Pagamento. Convertr=Meta Ads adicionado 09/05/2026 (Ailson).';

-- ─── Validação: quanto entrou de convertr em Abril/2026 ───────────────────
SELECT 
  loja,
  canal_origem,
  COUNT(*) AS qtd_pedidos,
  ROUND(SUM(valor_liquido)::numeric, 2) AS total
FROM vw_lojas_vendas_completo
WHERE data_venda >= '2026-04-01' AND data_venda <= '2026-04-30'
GROUP BY loja, canal_origem
ORDER BY loja, canal_origem;
