-- ═══════════════════════════════════════════════════════════════════════════
-- VIEW: cliente que necessita ATENÇÃO ESPECIAL
-- Sessao Ailson 06/05/2026 (noite)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CONCEITO: detectar mudanca de COMPORTAMENTO do cliente ANTES dele virar
-- "atencao" oficial. Cliente ainda parece ativo, mas o padrao mudou.
--
-- 4 SINAIS COM PESOS:
-- 1. Atrasou ciclo proprio (>1.3x media): peso 2
-- 2. Queda de volume (-50% peca vs media 5 ultimas): peso 2
-- 3. Queda de ticket (-50% valor vs media 5 ultimas): peso 2
-- 4. Devolucao recente (ultima compra teve devolucao): peso 3
--
-- THRESHOLD: score >= 3 = atencao especial
--
-- APLICA SO PRA cliente com:
--   - status_recalculado = 'ativo' (pega cedo, antes de oficial)
--   - media_dias_confiavel = TRUE (>=5 visitas)
--
-- ZERO mudanca em tabela. View calcula on-the-fly.
-- DROP VIEW vw_lojas_clientes_atencao_especial; pra reverter.
-- ═══════════════════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS vw_lojas_clientes_atencao_especial CASCADE;

CREATE VIEW vw_lojas_clientes_atencao_especial AS
WITH
-- 1. Compras agregadas por cliente x data (ja que pode ter parcelado/multilinhas)
compras_dia AS (
  SELECT
    cliente_id,
    data_venda,
    SUM(qtd_pecas) AS qtd_pecas,
    SUM(qtd_devolvida) AS qtd_devolvida,
    SUM(valor_liquido) AS valor_liquido,
    SUM(valor_devolucao) AS valor_devolucao
  FROM lojas_vendas
  WHERE cliente_id IS NOT NULL
  GROUP BY cliente_id, data_venda
),
-- 2. Ranking pra pegar ultimas N compras
compras_rank AS (
  SELECT
    cliente_id,
    data_venda,
    qtd_pecas,
    qtd_devolvida,
    valor_liquido,
    valor_devolucao,
    ROW_NUMBER() OVER (PARTITION BY cliente_id ORDER BY data_venda DESC) AS pos
  FROM compras_dia
),
-- 3. Ultima compra (pos=1)
ultima AS (
  SELECT
    cliente_id,
    qtd_pecas AS ultima_qtd,
    valor_liquido AS ultima_valor,
    qtd_devolvida AS ultima_devolvida,
    valor_devolucao AS ultima_valor_devolvido
  FROM compras_rank
  WHERE pos = 1
),
-- 4. Media das 5 ultimas compras EXCLUINDO a ultima (referencia "antes")
media_anteriores AS (
  SELECT
    cliente_id,
    AVG(qtd_pecas) AS media_qtd,
    AVG(valor_liquido) AS media_valor,
    COUNT(*) AS qtd_ref
  FROM compras_rank
  WHERE pos BETWEEN 2 AND 6   -- pega as 5 que vieram ANTES da ultima
  GROUP BY cliente_id
),
-- 5. Junta com janela (que ja calcula media_dias + status_recalculado)
sinais AS (
  SELECT
    j.cliente_id,
    j.nome,
    j.vendedora_id,
    j.dias_sem_comprar,
    j.media_dias_compras,
    j.media_confiavel,
    j.qtd_compras,
    j.status_recalculado,
    u.ultima_qtd,
    u.ultima_valor,
    u.ultima_devolvida,
    u.ultima_valor_devolvido,
    m.media_qtd,
    m.media_valor,
    m.qtd_ref,

    -- ─── SINAL 1: Atrasou ciclo proprio (peso 2) ───────────────────────
    -- Cliente ja passou de 1.3x da media, mas ainda dentro de "ativo"
    -- (que vai ate 0.8x do limite — entao na pratica >= 1.3x ja eh atrasado)
    CASE WHEN j.media_confiavel
              AND j.media_dias_compras > 0
              AND j.dias_sem_comprar IS NOT NULL
              AND j.dias_sem_comprar > j.media_dias_compras * 1.3
         THEN 2 ELSE 0 END AS sinal_atraso_ciclo,

    -- ─── SINAL 2: Queda de volume (peso 2) ─────────────────────────────
    -- Ultima compra teve <50% das pecas da media
    CASE WHEN m.qtd_ref >= 3
              AND m.media_qtd > 0
              AND u.ultima_qtd < m.media_qtd * 0.5
         THEN 2 ELSE 0 END AS sinal_queda_volume,

    -- ─── SINAL 3: Queda de ticket (peso 2) ─────────────────────────────
    -- Ultima compra teve <50% do valor liquido da media
    CASE WHEN m.qtd_ref >= 3
              AND m.media_valor > 0
              AND u.ultima_valor < m.media_valor * 0.5
         THEN 2 ELSE 0 END AS sinal_queda_ticket,

    -- ─── SINAL 4: Devolucao recente (peso 3) ───────────────────────────
    -- Ultima compra teve devolucao
    CASE WHEN u.ultima_devolvida > 0 OR u.ultima_valor_devolvido > 0
         THEN 3 ELSE 0 END AS sinal_devolucao
  FROM vw_lojas_clientes_janela j
  JOIN ultima u ON u.cliente_id = j.cliente_id
  LEFT JOIN media_anteriores m ON m.cliente_id = j.cliente_id
  WHERE j.media_confiavel = true
    AND j.status_recalculado = 'ativo'
    AND j.qtd_compras >= 5
)
SELECT
  cliente_id,
  nome,
  vendedora_id,
  dias_sem_comprar,
  media_dias_compras,
  qtd_compras,
  ultima_qtd,
  ultima_valor,
  ROUND(media_qtd, 1) AS media_qtd_anteriores,
  ROUND(media_valor, 2) AS media_valor_anteriores,
  ultima_devolvida,
  ultima_valor_devolvido,
  -- Sinais individuais (booleanos pra IA explicar)
  (sinal_atraso_ciclo > 0) AS tem_atraso_ciclo,
  (sinal_queda_volume > 0) AS tem_queda_volume,
  (sinal_queda_ticket > 0) AS tem_queda_ticket,
  (sinal_devolucao > 0)    AS tem_devolucao,
  -- Score total
  (sinal_atraso_ciclo + sinal_queda_volume + sinal_queda_ticket + sinal_devolucao) AS score,
  -- Lista de motivos legivel (pra IA usar na mensagem)
  ARRAY_REMOVE(ARRAY[
    CASE WHEN sinal_atraso_ciclo > 0 THEN
      'atrasou ciclo (' || dias_sem_comprar || 'd vs ' || ROUND(media_dias_compras)::text || 'd usual)'
    END,
    CASE WHEN sinal_queda_volume > 0 THEN
      'menos pecas (' || ultima_qtd || ' vs ' || ROUND(media_qtd)::text || ' usual)'
    END,
    CASE WHEN sinal_queda_ticket > 0 THEN
      'menos valor (R$ ' || ROUND(ultima_valor)::text || ' vs R$ ' || ROUND(media_valor)::text || ' usual)'
    END,
    CASE WHEN sinal_devolucao > 0 THEN
      'devolveu na ultima compra'
    END
  ], NULL) AS motivos
FROM sinais
WHERE (sinal_atraso_ciclo + sinal_queda_volume + sinal_queda_ticket + sinal_devolucao) >= 3
ORDER BY (sinal_atraso_ciclo + sinal_queda_volume + sinal_queda_ticket + sinal_devolucao) DESC;

COMMENT ON VIEW vw_lojas_clientes_atencao_especial IS
  'Clientes ativos+confiaveis com sinais de mudanca de comportamento. Score >= 3. Ailson 06/05/2026.';

-- ═══════════════════════════════════════════════════════════════════════════
-- VALIDACAO
-- ═══════════════════════════════════════════════════════════════════════════
-- Total de clientes em atencao especial:
-- SELECT COUNT(*) FROM vw_lojas_clientes_atencao_especial;
--
-- Distribuicao de scores:
-- SELECT score, COUNT(*) FROM vw_lojas_clientes_atencao_especial GROUP BY score ORDER BY score DESC;
--
-- Por vendedora:
-- SELECT vendedora_id, COUNT(*) FROM vw_lojas_clientes_atencao_especial GROUP BY vendedora_id;
--
-- Top 5 (maior score primeiro) com motivos:
-- SELECT nome, score, motivos, dias_sem_comprar, media_dias_compras
-- FROM vw_lojas_clientes_atencao_especial LIMIT 5;
