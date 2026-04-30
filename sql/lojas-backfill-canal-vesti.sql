-- ═══════════════════════════════════════════════════════════════════════════
-- LOJAS — Backfill canal_origem em vendas existentes + recalcular KPIs
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA (descoberto 28/04/2026): Parser do CSV historico do Mire estava
-- com canal_origem hardcoded='fisico' SEMPRE. Mas a coluna MARKETPLACE do
-- proprio CSV ja vem preenchida com 'VESTI' nas vendas via app Vesti
-- (40 vendas no banco com marketplace_raw='VESTI' marcadas como 'fisico').
--
-- IA nunca mencionava Vesti porque clientes_vesti_na_carteira sempre era 0.
--
-- FIX:
--   1. Parser corrigido (commit deste push) pra novas importacoes
--   2. Este SQL reclassifica as vendas que JA estao no banco
--   3. Forca recalculo dos KPIs por cliente (canal_dominante, perfil_presenca)
--      pra IA finalmente enxergar quem usa Vesti
--
-- Idempotente. Pode rodar quantas vezes quiser.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Reclassifica vendas que ja foram importadas
UPDATE lojas_vendas
SET canal_origem = 'vesti'
WHERE UPPER(TRIM(marketplace_raw)) IN ('VESTI', 'VESTISHOP')
  AND canal_origem != 'vesti';

UPDATE lojas_vendas
SET canal_origem = 'convertr'
WHERE UPPER(TRIM(marketplace_raw)) IN ('CONVERTR', 'CONVERTR.IO')
  AND canal_origem != 'convertr';

-- Validacao da reclassificacao
SELECT canal_origem, COUNT(*) AS qtd
FROM lojas_vendas
GROUP BY canal_origem
ORDER BY qtd DESC;

-- 2. Recalcula KPIs SO dos clientes afetados
-- Os clientes que tiveram alguma venda reclassificada precisam ter KPI
-- recalculado pra canal_dominante atualizar.
DO $$
DECLARE
  v_cliente_id uuid;
  v_total int := 0;
BEGIN
  FOR v_cliente_id IN
    SELECT DISTINCT cliente_id
    FROM lojas_vendas
    WHERE canal_origem IN ('vesti', 'convertr')
      AND cliente_id IS NOT NULL
  LOOP
    PERFORM lojas_recalcular_kpis_cliente(v_cliente_id);
    v_total := v_total + 1;
  END LOOP;
  RAISE NOTICE 'KPIs recalculados pra % clientes', v_total;
END $$;

-- 3. Validacao final: distribuicao de canal_dominante
SELECT
  k.canal_dominante,
  COUNT(*) AS qtd_clientes
FROM lojas_clientes_kpis k
WHERE k.qtd_compras > 0
GROUP BY k.canal_dominante
ORDER BY qtd_clientes DESC;

-- 4. Carteira da Vanessa especifico
SELECT
  c.apelido,
  k.qtd_compras,
  k.qtd_compras_vesti,
  k.canal_dominante,
  k.perfil_presenca,
  k.status_atual
FROM lojas_clientes c
JOIN lojas_clientes_kpis k ON k.cliente_id = c.id
JOIN lojas_vendedoras v ON v.id = c.vendedora_id
WHERE v.nome ILIKE 'Vanessa'
  AND k.qtd_compras_vesti > 0
ORDER BY k.qtd_compras_vesti DESC;
