-- =====================================================================
-- OS Amícia · Sprint 2 · 10 views do fluxo de corte
-- Versão: 1.0 · Data: 21/04/2026
-- =====================================================================
--
-- RODAR DEPOIS de 01_tables.sql + 02_seed_ia_config.sql.
-- Idempotente: usa CREATE OR REPLACE VIEW.
--
-- ORDEM DE CRIAÇÃO (dependências importam):
--   1. vw_variacoes_classificadas       → base ref+cor+tam com classificações
--   2. vw_refs_elegiveis_corte          → depende de (1)
--   3. vw_tamanhos_em_gap_por_ref       → depende de (1)
--   4. vw_grade_otimizada_por_ref       → depende de (3)
--   5. vw_distribuicao_cores_por_ref    → depende de (1) + (9)
--   6. vw_rendimento_sala_corte         → independente
--   7. vw_projecao_22_dias_por_ref      → depende de (1)
--   8. vw_ranking_curvas_bling          → independente
--   9. vw_tendencia_cor_catalogo        → independente
--  10. vw_cortes_recomendados_semana    → depende de (2,4,5,6,7,8,9)
--
-- PREMISSAS DE NORMALIZAÇÃO (aplicadas em TODAS as views):
--   - ref: LTRIM(ref, '0') — bling tem "02601", salas-corte tem "2601"
--   - cor: join via LOWER(TRIM(cor)); output mantém grafia original como cor_display
--   - tam: alias padronizado; "tamanho" (bling) e "tam" (ml_estoque) unificados
--
-- LEITURA DE ia_config:
--   Cada view usa CTE "cfg" no topo com subqueries escalares. Roda 1× por
--   execução, totalmente legível, zero hardcode de thresholds.
--
-- COLUNA confianca (alta|media|baixa):
--   Incluída onde aplicável — requisito da regra #5 do prompt de sistema.
-- =====================================================================


-- =====================================================================
-- VIEW 1 · vw_variacoes_classificadas
-- =====================================================================
-- Base por ref+cor+tam com todas as métricas e 3 classificações:
--   (a) demanda_status   = ativa | fraca | inativa | ruptura_disfarcada
--   (b) cobertura_status = zerada | critica | atencao | saudavel | excesso
--   (c) confianca        = alta (padrão — todos os dados são diretos)
--
-- FONTES:
--   - bling_vendas_detalhe.itens (jsonb array) → vendas por ref+cor+tam
--   - ml_estoque_ref_atual.variations (jsonb array) → estoque atual
--
-- REGRAS (ver 02_seed_ia_config.sql):
--   - ativa:   vendas_15d >= gatekeeper_vendas_ativa_15d (6)
--   - fraca:   vendas_15d BETWEEN 1 E 5
--   - inativa: vendas_15d = 0
--   - ruptura_disfarcada: vendas_15d = 0 E vendas_mes_ant >= 12
-- =====================================================================

CREATE OR REPLACE VIEW vw_variacoes_classificadas AS
WITH cfg AS (
  SELECT
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'gatekeeper_vendas_ativa_15d')       AS gate_ativa,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'gatekeeper_vendas_fraca_min_15d')   AS gate_fraca_min,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'gatekeeper_vendas_fraca_max_15d')   AS gate_fraca_max,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'ruptura_disfarcada_min_mes_ant')    AS gate_ruptura_min,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'cobertura_critica_dias')            AS cob_critica,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'cobertura_saudavel_min_dias')       AS cob_saudavel_min,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'cobertura_saudavel_max_dias')       AS cob_saudavel_max,
    (SELECT (valor #>> '{}' )::numeric FROM ia_config WHERE chave = 'devolucao_global_pct')          AS devol_pct
),
-- Desagrega JSONB de vendas
vendas_expandidas AS (
  SELECT
    LTRIM(COALESCE(item->>'ref',''), '0')           AS ref,
    LOWER(TRIM(COALESCE(item->>'cor','')))          AS cor_key,
    COALESCE(item->>'cor','')                       AS cor_display,
    UPPER(TRIM(COALESCE(item->>'tamanho','')))      AS tam,
    COALESCE((item->>'quantidade')::int, 0)         AS qtd,
    v.data_pedido
  FROM bling_vendas_detalhe v,
       jsonb_array_elements(v.itens) AS item
  WHERE item->>'ref' IS NOT NULL
    AND item->>'ref' <> ''
),
-- Agrega vendas por janelas
vendas_agregadas AS (
  SELECT
    ref,
    cor_key,
    MAX(cor_display) AS cor_display,  -- pega uma grafia; tanto faz se tem variações de caps
    tam,
    SUM(qtd) FILTER (WHERE data_pedido >= CURRENT_DATE - INTERVAL '15 days')                                              AS vendas_15d,
    SUM(qtd) FILTER (WHERE data_pedido >= CURRENT_DATE - INTERVAL '30 days')                                              AS vendas_30d,
    SUM(qtd) FILTER (WHERE data_pedido >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
                       AND data_pedido <  DATE_TRUNC('month', CURRENT_DATE))                                              AS vendas_mes_ant,
    SUM(qtd) FILTER (WHERE data_pedido >= CURRENT_DATE - INTERVAL '90 days')                                              AS vendas_90d,
    MAX(data_pedido) AS ultima_venda
  FROM vendas_expandidas
  GROUP BY ref, cor_key, tam
),
-- Desagrega JSONB de estoque (apenas refs sem alerta_duplicata ou sem_dados)
estoque_expandido AS (
  SELECT
    LTRIM(COALESCE(e.ref,''), '0')                     AS ref,
    LOWER(TRIM(COALESCE(v->>'cor','')))                AS cor_key,
    COALESCE(v->>'cor','')                             AS cor_display,
    UPPER(TRIM(COALESCE(v->>'tam','')))                AS tam,
    COALESCE((v->>'qtd')::int, 0)                      AS estoque_atual,
    e.descricao                                        AS descricao,
    e.sem_dados,
    e.alerta_duplicata,
    e.updated_at                                       AS estoque_updated_at
  FROM ml_estoque_ref_atual e,
       jsonb_array_elements(e.variations) AS v
  WHERE e.sem_dados = false
)
SELECT
  COALESCE(v.ref, e.ref)                               AS ref,
  COALESCE(v.cor_display, e.cor_display, e.cor_key)    AS cor,
  COALESCE(v.cor_key, e.cor_key)                       AS cor_key,
  COALESCE(v.tam, e.tam)                               AS tam,
  COALESCE(e.descricao, '')             AS descricao,
  COALESCE(e.estoque_atual, 0)          AS estoque_atual,
  COALESCE(v.vendas_15d, 0)             AS vendas_15d,
  COALESCE(v.vendas_30d, 0)             AS vendas_30d,
  COALESCE(v.vendas_mes_ant, 0)         AS vendas_mes_ant,
  COALESCE(v.vendas_90d, 0)             AS vendas_90d,
  v.ultima_venda,
  e.estoque_updated_at,
  e.alerta_duplicata,

  -- Velocidade de venda (ajustada por devolução global)
  -- Uso vendas_30d / 30 pra suavizar ruído dos últimos 15d
  ROUND(
    (COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)),
    3
  )::numeric AS velocidade_dia,

  -- Cobertura em dias (estoque / velocidade_dia). NULL se velocidade=0.
  CASE
    WHEN COALESCE(v.vendas_30d, 0) = 0 THEN NULL
    ELSE ROUND(
      COALESCE(e.estoque_atual, 0)::numeric
      / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0),
      1
    )
  END AS cobertura_dias,

  -- Classificação de demanda
  CASE
    WHEN COALESCE(v.vendas_15d, 0) >= cfg.gate_ativa                                           THEN 'ativa'
    WHEN COALESCE(v.vendas_15d, 0) BETWEEN cfg.gate_fraca_min AND cfg.gate_fraca_max           THEN 'fraca'
    WHEN COALESCE(v.vendas_15d, 0) = 0 AND COALESCE(v.vendas_mes_ant, 0) >= cfg.gate_ruptura_min THEN 'ruptura_disfarcada'
    ELSE 'inativa'
  END AS demanda_status,

  -- Classificação de cobertura
  CASE
    WHEN COALESCE(e.estoque_atual, 0) = 0                                                                                         THEN 'zerada'
    WHEN COALESCE(v.vendas_30d, 0) = 0                                                                                            THEN 'sem_demanda'
    WHEN COALESCE(e.estoque_atual, 0) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) < cfg.cob_critica       THEN 'critica'
    WHEN COALESCE(e.estoque_atual, 0) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) < cfg.cob_saudavel_min  THEN 'atencao'
    WHEN COALESCE(e.estoque_atual, 0) / NULLIF((COALESCE(v.vendas_30d, 0) / 30.0) * (1 - (cfg.devol_pct / 100.0)), 0) <= cfg.cob_saudavel_max THEN 'saudavel'
    ELSE 'excesso'
  END AS cobertura_status,

  -- Confiança: alta por padrão (decisão do Prompt Mestre — dados diretos da fonte)
  -- Cai pra media se ref tem duplicata no ML
  CASE
    WHEN e.alerta_duplicata = true THEN 'media'
    ELSE 'alta'
  END AS confianca

FROM vendas_agregadas v
FULL OUTER JOIN estoque_expandido e
  ON v.ref = e.ref AND v.cor_key = e.cor_key AND v.tam = e.tam
CROSS JOIN cfg
WHERE COALESCE(v.ref, e.ref) <> ''
  AND COALESCE(v.tam, e.tam) NOT IN ('ÚNICO','UNICO','U');  -- decisão #3 HANDOFF: Único fora do OS

COMMENT ON VIEW vw_variacoes_classificadas IS
  'Base por ref+cor+tam com vendas (15d/30d/mes_ant/90d), estoque atual, '
  'velocidade_dia ajustada por devolução, cobertura_dias, e 3 classificações. '
  'Exclui Tamanho Único (decisão #3 HANDOFF). Fontes: bling_vendas_detalhe + ml_estoque_ref_atual.';


-- =====================================================================
-- VIEW 2 · vw_refs_elegiveis_corte
-- =====================================================================
-- Refs com pelo menos 1 variação em cobertura crítica/atenção E
-- pelo menos 1 variação em demanda ativa (gatekeeper).
--
-- Exceção: ruptura_disfarcada também qualifica (ref zerada no mês mas
-- vendia bem no mês anterior — pode ser sinal de listing problem).
-- =====================================================================

CREATE OR REPLACE VIEW vw_refs_elegiveis_corte AS
WITH por_ref AS (
  SELECT
    ref,
    MAX(descricao) AS descricao,
    COUNT(*)                                                                           AS total_variacoes,
    COUNT(*) FILTER (WHERE demanda_status = 'ativa')                                   AS qtd_ativa,
    COUNT(*) FILTER (WHERE demanda_status = 'fraca')                                   AS qtd_fraca,
    COUNT(*) FILTER (WHERE demanda_status = 'inativa')                                 AS qtd_inativa,
    COUNT(*) FILTER (WHERE demanda_status = 'ruptura_disfarcada')                      AS qtd_ruptura,
    COUNT(*) FILTER (WHERE cobertura_status IN ('zerada','critica'))                   AS qtd_criticas,
    COUNT(*) FILTER (WHERE cobertura_status = 'atencao')                               AS qtd_atencao,
    COUNT(*) FILTER (WHERE cobertura_status = 'saudavel')                              AS qtd_saudavel,
    COUNT(*) FILTER (WHERE cobertura_status = 'excesso')                               AS qtd_excesso,
    SUM(estoque_atual)                                                                 AS estoque_total,
    SUM(vendas_30d)                                                                    AS vendas_30d_total,
    SUM(vendas_15d)                                                                    AS vendas_15d_total,
    MAX(ultima_venda)                                                                  AS ultima_venda,
    -- Confiança da ref = min das confianças das variações (menor vence)
    CASE WHEN BOOL_OR(confianca = 'baixa') THEN 'baixa'
         WHEN BOOL_OR(confianca = 'media') THEN 'media'
         ELSE 'alta' END                                                               AS confianca
  FROM vw_variacoes_classificadas
  GROUP BY ref
)
SELECT *,
  -- Motivo de elegibilidade (qual caminho a ref entrou)
  CASE
    WHEN qtd_ruptura > 0 AND qtd_ativa = 0 THEN 'ruptura_disfarcada'
    WHEN qtd_ativa > 0 AND qtd_criticas > 0 THEN 'demanda_ativa_e_critico'
    WHEN qtd_ativa > 0 AND qtd_atencao > 0 THEN 'demanda_ativa_e_atencao'
    ELSE 'nao_elegivel'
  END AS motivo_elegibilidade
FROM por_ref
WHERE (
    (qtd_ativa > 0 AND (qtd_criticas > 0 OR qtd_atencao > 0))
    OR qtd_ruptura > 0
  )
  AND ref <> '';

COMMENT ON VIEW vw_refs_elegiveis_corte IS
  'Refs que passam no gatekeeper: >=1 variação ativa + >=1 crítica/atenção, '
  'OU ruptura disfarçada. Agrega métricas por ref.';


-- =====================================================================
-- VIEW 3 · vw_tamanhos_em_gap_por_ref
-- =====================================================================
-- Pra cada ref elegível, lista os tamanhos com problema e calcula a
-- proporção esperada de cada tamanho baseado nas vendas totais.
--
-- Proporção esperada = participação do tamanho no total de vendas 90d
-- (janela mais larga pra estabilidade estatística).
-- =====================================================================

CREATE OR REPLACE VIEW vw_tamanhos_em_gap_por_ref AS
WITH vendas_por_tam AS (
  SELECT
    v.ref,
    v.tam,
    SUM(v.vendas_90d)     AS vendas_90d_tam,
    SUM(v.estoque_atual)  AS estoque_tam,
    BOOL_OR(v.cobertura_status IN ('zerada','critica','atencao')) AS em_gap
  FROM vw_variacoes_classificadas v
  INNER JOIN vw_refs_elegiveis_corte r ON r.ref = v.ref
  GROUP BY v.ref, v.tam
),
totais AS (
  SELECT ref, SUM(vendas_90d_tam) AS total_90d
  FROM vendas_por_tam
  GROUP BY ref
)
SELECT
  vt.ref,
  vt.tam,
  vt.vendas_90d_tam,
  vt.estoque_tam,
  vt.em_gap,
  t.total_90d,
  CASE
    WHEN t.total_90d > 0 THEN ROUND((vt.vendas_90d_tam::numeric / t.total_90d) * 100, 1)
    ELSE 0
  END AS proporcao_esperada_pct
FROM vendas_por_tam vt
INNER JOIN totais t ON t.ref = vt.ref
WHERE vt.vendas_90d_tam > 0;  -- tamanhos que nunca venderam são filtrados

COMMENT ON VIEW vw_tamanhos_em_gap_por_ref IS
  'Tamanhos com problema (zerada/crítica/atenção) por ref elegível + '
  'proporção esperada baseada em vendas 90d. em_gap=true marca os que precisam repor.';


-- =====================================================================
-- VIEW 4 · vw_grade_otimizada_por_ref
-- =====================================================================
-- Aplica regra 6/8 módulos baseado em palavra-chave na descrição:
--   - Se descricao contém "vestido" ou "macacão"/"macacao" → grande, máx 6
--   - Caso contrário → pequena/média, máx 8
--
-- Princípio de ouro: grade MÍNIMA que entrega a proporção.
-- Algoritmo: ordena tamanhos por proporção_esperada desc, pega até o
-- máximo de módulos permitido, renormaliza proporções.
-- =====================================================================

CREATE OR REPLACE VIEW vw_grade_otimizada_por_ref AS
WITH cfg AS (
  SELECT
    (SELECT (valor #>> '{}' )::int  FROM ia_config WHERE chave = 'grade_max_modulos_peca_grande')  AS max_grande,
    (SELECT (valor #>> '{}' )::int  FROM ia_config WHERE chave = 'grade_max_modulos_peca_pequena') AS max_pequena,
    (SELECT valor                FROM ia_config WHERE chave = 'grade_palavras_peca_grande')    AS palavras_grande
),
classif_ref AS (
  SELECT
    r.ref,
    r.descricao,
    cfg.max_grande,
    cfg.max_pequena,
    -- Categoria: grande se qualquer palavra do array bater no descricao
    CASE
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(cfg.palavras_grande) AS kw
        WHERE LOWER(r.descricao) LIKE '%' || kw || '%'
      ) THEN 'grande' ELSE 'pequena_media'
    END AS categoria_peca,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(cfg.palavras_grande) AS kw
        WHERE LOWER(r.descricao) LIKE '%' || kw || '%'
      ) THEN cfg.max_grande ELSE cfg.max_pequena
    END AS max_modulos
  FROM vw_refs_elegiveis_corte r
  CROSS JOIN cfg
),
-- Ordena tamanhos em gap por proporção e pega top-N (N = max_modulos)
ranked AS (
  SELECT
    t.ref,
    t.tam,
    t.proporcao_esperada_pct,
    t.vendas_90d_tam,
    ROW_NUMBER() OVER (PARTITION BY t.ref ORDER BY t.proporcao_esperada_pct DESC) AS rnk
  FROM vw_tamanhos_em_gap_por_ref t
  INNER JOIN classif_ref c ON c.ref = t.ref
  WHERE t.em_gap = true
),
selecionados AS (
  SELECT
    r.ref,
    r.tam,
    r.proporcao_esperada_pct
  FROM ranked r
  INNER JOIN classif_ref c ON c.ref = r.ref
  WHERE r.rnk <= c.max_modulos
),
-- Renormaliza pra que a soma das proporções selecionadas = 100
renormalizado AS (
  SELECT
    s.ref,
    s.tam,
    s.proporcao_esperada_pct AS proporcao_original_pct,
    ROUND(
      s.proporcao_esperada_pct
      / NULLIF(SUM(s.proporcao_esperada_pct) OVER (PARTITION BY s.ref), 0)
      * 100,
      1
    ) AS proporcao_final_pct
  FROM selecionados s
)
SELECT
  cr.ref,
  cr.descricao,
  cr.categoria_peca,
  cr.max_modulos,
  rn.tam,
  rn.proporcao_original_pct,
  rn.proporcao_final_pct
FROM renormalizado rn
INNER JOIN classif_ref cr ON cr.ref = rn.ref;

COMMENT ON VIEW vw_grade_otimizada_por_ref IS
  'Grade 6/8 módulos por ref. Detecta vestido/macacão no descricao. '
  'Top-N tamanhos por proporção 90d, renormalizados.';


-- =====================================================================
-- NOTA: View 9 foi movida pra antes da view 5 porque vw_distribuicao_cores_por_ref
-- faz LEFT JOIN vw_tendencia_cor_catalogo. Numeração segue o Prompt Mestre.
-- VIEW 9 · vw_tendencia_cor_catalogo (criada fora de ordem — ver nota acima)
-- =====================================================================
-- Tendência agregada de cada cor somando todos os modelos onde aparece.
-- Compara janela recente (últimos 30d) vs janela anterior (30-60d antes).
-- Flag alta se >=tendencia_cor_alta_min_modelos (5) com +30%+.
-- Flag queda se >=tendencia_cor_queda_min_modelos (3) com -30%+.
-- =====================================================================

CREATE OR REPLACE VIEW vw_tendencia_cor_catalogo AS
WITH cfg AS (
  SELECT
    (SELECT (valor #>> '{}' )::numeric FROM ia_config WHERE chave = 'tendencia_cor_alta_pct')         AS alta_pct,
    (SELECT (valor #>> '{}' )::int     FROM ia_config WHERE chave = 'tendencia_cor_alta_min_modelos') AS alta_min_mod,
    (SELECT (valor #>> '{}' )::numeric FROM ia_config WHERE chave = 'tendencia_cor_queda_pct')        AS queda_pct,
    (SELECT (valor #>> '{}' )::int     FROM ia_config WHERE chave = 'tendencia_cor_queda_min_modelos')AS queda_min_mod
),
-- Vendas por cor × modelo × janela
por_cor_modelo AS (
  SELECT
    LOWER(TRIM(COALESCE(item->>'cor','')))  AS cor_key,
    MAX(COALESCE(item->>'cor',''))          AS cor,
    LTRIM(COALESCE(item->>'ref',''), '0')   AS ref,
    SUM((item->>'quantidade')::int) FILTER (
      WHERE v.data_pedido >= CURRENT_DATE - INTERVAL '30 days'
    ) AS pecas_recente,
    SUM((item->>'quantidade')::int) FILTER (
      WHERE v.data_pedido >= CURRENT_DATE - INTERVAL '60 days'
        AND v.data_pedido <  CURRENT_DATE - INTERVAL '30 days'
    ) AS pecas_anterior
  FROM bling_vendas_detalhe v,
       jsonb_array_elements(v.itens) AS item
  WHERE item->>'cor' IS NOT NULL AND item->>'cor' <> ''
  GROUP BY LOWER(TRIM(COALESCE(item->>'cor',''))),
           LTRIM(COALESCE(item->>'ref',''), '0')
),
-- Variação por (cor, modelo). Evita divisão por zero com NULLIF.
variacao_por_modelo AS (
  SELECT
    cor_key,
    cor,
    ref,
    pecas_recente,
    pecas_anterior,
    CASE
      WHEN COALESCE(pecas_anterior, 0) = 0 AND COALESCE(pecas_recente, 0) > 0 THEN 999  -- novo
      WHEN COALESCE(pecas_anterior, 0) = 0 THEN NULL
      ELSE ROUND((pecas_recente::numeric - pecas_anterior) / pecas_anterior * 100, 1)
    END AS var_pct
  FROM por_cor_modelo
),
-- Agrega por cor: quantos modelos em alta, quantos em queda
por_cor AS (
  SELECT
    cor_key,
    MAX(cor) AS cor,
    COUNT(*) FILTER (WHERE var_pct >=  (SELECT alta_pct FROM cfg))  AS modelos_em_alta,
    COUNT(*) FILTER (WHERE var_pct <= -(SELECT queda_pct FROM cfg)) AS modelos_em_queda,
    SUM(pecas_recente)  AS total_recente,
    SUM(pecas_anterior) AS total_anterior
  FROM variacao_por_modelo
  GROUP BY cor_key
)
SELECT
  pc.cor_key,
  pc.cor,
  pc.modelos_em_alta,
  pc.modelos_em_queda,
  pc.total_recente,
  pc.total_anterior,
  CASE
    WHEN pc.modelos_em_alta  >= cfg.alta_min_mod  THEN 'alta'
    WHEN pc.modelos_em_queda >= cfg.queda_min_mod THEN 'queda'
    ELSE 'estavel'
  END AS tendencia
FROM por_cor pc
CROSS JOIN cfg;

COMMENT ON VIEW vw_tendencia_cor_catalogo IS
  'Tendência de cor agregada em todos os modelos. Assimetria intencional: '
  '5 modelos pra alta (consistência), 3 pra queda (alerta sensível).';


-- =====================================================================
-- VIEW 5 · vw_distribuicao_cores_por_ref
-- =====================================================================
-- Participação de cada cor no total de vendas da ref + multiplicador
-- de tendência (alta/estavel/queda) aplicado ao número de rolos.
--
-- Depende da view 9 (tendência da cor no catálogo).
-- =====================================================================

CREATE OR REPLACE VIEW vw_distribuicao_cores_por_ref AS
WITH cfg AS (
  SELECT
    (SELECT (valor #>> '{}' )::int     FROM ia_config WHERE chave = 'rolos_min_por_cor')          AS rolos_min,
    (SELECT (valor #>> '{}' )::numeric FROM ia_config WHERE chave = 'multiplicador_cor_alta')     AS mult_alta,
    (SELECT (valor #>> '{}' )::numeric FROM ia_config WHERE chave = 'multiplicador_cor_estavel')  AS mult_estavel,
    (SELECT (valor #>> '{}' )::numeric FROM ia_config WHERE chave = 'multiplicador_cor_queda')    AS mult_queda
),
vendas_por_cor AS (
  SELECT
    v.ref,
    v.cor_key,
    MAX(v.cor) AS cor,  -- grafia original pra output
    SUM(v.vendas_90d) AS vendas_90d_cor,
    SUM(v.vendas_30d) AS vendas_30d_cor
  FROM vw_variacoes_classificadas v
  INNER JOIN vw_refs_elegiveis_corte r ON r.ref = v.ref
  GROUP BY v.ref, v.cor_key
),
totais AS (
  SELECT ref, SUM(vendas_90d_cor) AS total_90d
  FROM vendas_por_cor
  GROUP BY ref
)
SELECT
  vc.ref,
  vc.cor,
  vc.cor_key,
  vc.vendas_90d_cor,
  vc.vendas_30d_cor,
  t.total_90d,
  CASE
    WHEN t.total_90d > 0 THEN ROUND((vc.vendas_90d_cor::numeric / t.total_90d) * 100, 1)
    ELSE 0
  END AS participacao_pct,

  -- Busca tendência da cor (view 9) — default estavel se cor não aparece
  COALESCE(tc.tendencia, 'estavel') AS tendencia_cor,

  -- Multiplicador aplicado
  CASE COALESCE(tc.tendencia, 'estavel')
    WHEN 'alta'   THEN cfg.mult_alta
    WHEN 'queda'  THEN cfg.mult_queda
    ELSE cfg.mult_estavel
  END AS multiplicador,

  cfg.rolos_min AS rolos_minimos
FROM vendas_por_cor vc
INNER JOIN totais t ON t.ref = vc.ref
CROSS JOIN cfg
LEFT JOIN vw_tendencia_cor_catalogo tc ON tc.cor_key = vc.cor_key
WHERE vc.vendas_90d_cor > 0;  -- só cores que já venderam

COMMENT ON VIEW vw_distribuicao_cores_por_ref IS
  'Participação de cada cor no catálogo da ref + tendência + multiplicador. '
  'Depende da view 9. Só cores que já venderam entram.';


-- =====================================================================
-- VIEW 6 · vw_rendimento_sala_corte
-- =====================================================================
-- Rendimento médio (peças/rolo) por ref × sala com fallback N1→N2:
--   N1: ref com >=1 corte histórico concluído → rendimento próprio (alta)
--   N2: ref sem histórico → busca palavra-chave no descricao e usa
--       média da categoria com piso de 2 cortes (média)
--   Nunca N3 (decisão #2 HANDOFF)
--
-- FONTE: amicia_data user_id='salas-corte' → payload->cortes
--   Cada item: {id, data, sala, ref, descricao, marca, qtdRolos,
--               qtdPecas, rendimento, status, alerta, visto}
--
-- Saída: uma linha por (ref, sala) com rendimento recomendado.
-- =====================================================================

CREATE OR REPLACE VIEW vw_rendimento_sala_corte AS
WITH cfg AS (
  SELECT
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'rendimento_n1_min_cortes_ref')       AS n1_min,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'rendimento_n2_min_cortes_categoria') AS n2_min,
    (SELECT valor               FROM ia_config WHERE chave = 'rendimento_categorias_chaves')     AS categorias
),
-- Explode todos os cortes históricos concluídos
cortes_raw AS (
  SELECT
    LTRIM(COALESCE(c->>'ref',''), '0')        AS ref,
    COALESCE(c->>'sala','')                   AS sala,
    COALESCE(c->>'descricao','')              AS descricao,
    COALESCE((c->>'qtdRolos')::int, 0)        AS rolos,
    COALESCE((c->>'qtdPecas')::int, 0)        AS pecas,
    COALESCE((c->>'rendimento')::numeric, 0)  AS rendimento,
    (c->>'data')::date                        AS data_corte
  FROM amicia_data,
       jsonb_array_elements(payload->'cortes') AS c
  WHERE user_id = 'salas-corte'
    AND (c->>'status') = 'concluido'
    AND COALESCE((c->>'qtdPecas')::int, 0) > 0
    AND COALESCE((c->>'qtdRolos')::int, 0) > 0
),
-- Categoriza cada corte histórico (primeira palavra-chave que bater vence)
cortes_categorizados AS (
  SELECT
    cr.*,
    (
      SELECT kw
      FROM jsonb_array_elements_text(cfg.categorias) WITH ORDINALITY AS t(kw, ord)
      WHERE LOWER(cr.descricao) LIKE '%' || kw || '%'
      ORDER BY ord
      LIMIT 1
    ) AS categoria
  FROM cortes_raw cr
  CROSS JOIN cfg
),
-- N1: rendimento próprio por ref × sala
n1_ref_sala AS (
  SELECT
    ref,
    sala,
    AVG(rendimento)    AS rendimento_medio,
    COUNT(*)           AS qtd_cortes,
    MAX(data_corte)    AS ultimo_corte
  FROM cortes_raw
  WHERE sala <> ''
  GROUP BY ref, sala
  HAVING COUNT(*) >= (SELECT n1_min FROM cfg)
),
-- N2: rendimento médio por categoria × sala (pra refs sem histórico)
n2_categoria_sala AS (
  SELECT
    categoria,
    sala,
    AVG(rendimento)    AS rendimento_medio,
    COUNT(*)           AS qtd_cortes
  FROM cortes_categorizados
  WHERE categoria IS NOT NULL
    AND sala <> ''
  GROUP BY categoria, sala
  HAVING COUNT(*) >= (SELECT n2_min FROM cfg)
),
-- Universo: todas refs elegíveis × todas salas com histórico
refs_x_salas AS (
  SELECT DISTINCT r.ref, r.descricao, s.sala
  FROM vw_refs_elegiveis_corte r
  CROSS JOIN (SELECT DISTINCT sala FROM cortes_raw WHERE sala <> '') s
),
-- Categoria da ref elegível (mesma lógica de categorização)
refs_categorizadas AS (
  SELECT
    rs.*,
    (
      SELECT kw
      FROM jsonb_array_elements_text(cfg.categorias) WITH ORDINALITY AS t(kw, ord)
      WHERE LOWER(rs.descricao) LIKE '%' || kw || '%'
      ORDER BY ord
      LIMIT 1
    ) AS categoria
  FROM refs_x_salas rs
  CROSS JOIN cfg
)
SELECT
  rc.ref,
  rc.descricao,
  rc.sala,
  rc.categoria,
  COALESCE(n1.rendimento_medio, n2.rendimento_medio) AS rendimento_pc_por_rolo,
  CASE
    WHEN n1.rendimento_medio IS NOT NULL THEN 'N1_ref_propria'
    WHEN n2.rendimento_medio IS NOT NULL THEN 'N2_categoria'
    ELSE 'indisponivel'
  END AS nivel_fallback,
  CASE
    WHEN n1.rendimento_medio IS NOT NULL THEN 'alta'
    WHEN n2.rendimento_medio IS NOT NULL THEN 'media'
    ELSE 'baixa'
  END AS confianca,
  COALESCE(n1.qtd_cortes, n2.qtd_cortes, 0) AS base_amostral,
  n1.ultimo_corte
FROM refs_categorizadas rc
LEFT JOIN n1_ref_sala n1 ON n1.ref = rc.ref AND n1.sala = rc.sala
LEFT JOIN n2_categoria_sala n2 ON n2.categoria = rc.categoria AND n2.sala = rc.sala
-- Filtra: só linhas com rendimento (N1 ou N2). Indisponíveis não viram recomendação.
WHERE COALESCE(n1.rendimento_medio, n2.rendimento_medio) IS NOT NULL;

COMMENT ON VIEW vw_rendimento_sala_corte IS
  'Rendimento por ref × sala com fallback N1→N2 (decisão #2 HANDOFF). '
  'Nunca N3. Confiança alta se N1, media se N2.';


-- =====================================================================
-- VIEW 7 · vw_projecao_22_dias_por_ref
-- =====================================================================
-- Projeção de saldo em 22 dias (lead time padrão) com 3 cenários:
--   A (otimista):  velocidade atual × 0.85 (demanda cai 15%)
--   B (base):      velocidade atual
--   C (pessimista): velocidade atual × 1.15 (demanda sobe 15%)
--
-- Inclui cortes em andamento (amicia_data/salas-corte/cortes status=pendente).
-- =====================================================================

CREATE OR REPLACE VIEW vw_projecao_22_dias_por_ref AS
WITH cfg AS (
  SELECT
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'lead_time_dias') AS lead_time
),
-- Agrega métricas por ref a partir da view 1
por_ref AS (
  SELECT
    ref,
    SUM(estoque_atual) AS estoque_atual,
    SUM(velocidade_dia) AS velocidade_dia
  FROM vw_variacoes_classificadas
  GROUP BY ref
),
-- Cortes em andamento (pendentes) — somados em peças esperadas
cortes_pendentes AS (
  SELECT
    LTRIM(COALESCE(c->>'ref',''), '0') AS ref,
    SUM(
      -- Se qtdPecas for null (comum em pendente), estima por rendimento_pecas_por_rolo_default
      COALESCE(
        (c->>'qtdPecas')::int,
        (c->>'qtdRolos')::int * (
          SELECT (valor #>> '{}' )::int FROM ia_config
          WHERE chave = 'rendimento_pecas_por_rolo_default'
        )
      )
    ) AS pecas_em_corte
  FROM amicia_data,
       jsonb_array_elements(payload->'cortes') AS c
  WHERE user_id = 'salas-corte'
    AND (c->>'status') = 'pendente'
  GROUP BY LTRIM(COALESCE(c->>'ref',''), '0')
)
SELECT
  p.ref,
  p.estoque_atual,
  p.velocidade_dia,
  COALESCE(cp.pecas_em_corte, 0) AS pecas_em_corte,
  cfg.lead_time AS dias_projecao,
  -- Cenário A (otimista — demanda cai 15%)
  ROUND(
    p.estoque_atual + COALESCE(cp.pecas_em_corte, 0) - (p.velocidade_dia * 0.85 * cfg.lead_time),
    0
  ) AS saldo_cenario_a,
  -- Cenário B (base)
  ROUND(
    p.estoque_atual + COALESCE(cp.pecas_em_corte, 0) - (p.velocidade_dia * cfg.lead_time),
    0
  ) AS saldo_cenario_b,
  -- Cenário C (pessimista — demanda sobe 15%)
  ROUND(
    p.estoque_atual + COALESCE(cp.pecas_em_corte, 0) - (p.velocidade_dia * 1.15 * cfg.lead_time),
    0
  ) AS saldo_cenario_c
FROM por_ref p
CROSS JOIN cfg
LEFT JOIN cortes_pendentes cp ON cp.ref = p.ref;

COMMENT ON VIEW vw_projecao_22_dias_por_ref IS
  'Saldo projetado em 22d com 3 cenários A/B/C. Inclui cortes pendentes '
  '(amicia_data/salas-corte). Usa rendimento_pecas_por_rolo_default pra estimar pendentes sem qtdPecas.';


-- =====================================================================
-- VIEW 8 · vw_ranking_curvas_bling
-- =====================================================================
-- Classifica refs em curva A/B/outras baseado em vendas dos últimos 30d,
-- com tetos aplicados (curva_a_teto_pecas, curva_b_teto_pecas).
-- =====================================================================

CREATE OR REPLACE VIEW vw_ranking_curvas_bling AS
WITH cfg AS (
  SELECT
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'curva_a_min_pecas')   AS a_min,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'curva_a_teto_pecas')  AS a_teto,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'curva_b_min_pecas')   AS b_min,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'curva_b_teto_pecas')  AS b_teto
),
vendas_30d AS (
  SELECT
    LTRIM(COALESCE(item->>'ref',''), '0')   AS ref,
    SUM((item->>'quantidade')::int)         AS pecas_30d,
    SUM((item->>'quantidade')::int * (item->>'valor')::numeric) AS faturamento_30d
  FROM bling_vendas_detalhe v,
       jsonb_array_elements(v.itens) AS item
  WHERE v.data_pedido >= CURRENT_DATE - INTERVAL '30 days'
    AND item->>'ref' IS NOT NULL
    AND item->>'ref' <> ''
  GROUP BY LTRIM(COALESCE(item->>'ref',''), '0')
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (ORDER BY pecas_30d DESC) AS rank_pecas
  FROM vendas_30d
)
SELECT
  r.ref,
  r.pecas_30d,
  r.faturamento_30d,
  r.rank_pecas,
  -- Estimativa pra 30d seguintes (mesma velocidade, capada pelo teto da curva)
  CASE
    WHEN r.pecas_30d >= cfg.a_min THEN LEAST(r.pecas_30d, cfg.a_teto)
    WHEN r.pecas_30d >= cfg.b_min THEN LEAST(r.pecas_30d, cfg.b_teto)
    ELSE r.pecas_30d
  END AS pecas_estimadas_proximo_corte,
  CASE
    WHEN r.pecas_30d >= cfg.a_min THEN 'A'
    WHEN r.pecas_30d >= cfg.b_min THEN 'B'
    ELSE 'outras'
  END AS curva
FROM ranked r
CROSS JOIN cfg;

COMMENT ON VIEW vw_ranking_curvas_bling IS
  'Ranking por vendas 30d, classifica A (>=300), B (>=200) ou outras. '
  'Aplica tetos 750/450 pras estimativas do próximo corte.';


-- =====================================================================
-- VIEW 10 · vw_cortes_recomendados_semana
-- =====================================================================
-- CONSOLIDADORA FINAL. Junta as views 2, 4, 5, 6, 7, 8 numa linha por ref.
-- Calcula rolos totais por cor (participação × rolos base estimados
-- pelo rendimento + multiplicador de tendência), define sala recomendada
-- (melhor rendimento disponível), aplica semáforo de capacidade.
--
-- NOTA: O detalhamento por tamanho (grade) e por cor fica nas views 4 e 5.
--       Aqui é a visão ref-level pro Claude consumir.
-- =====================================================================

CREATE OR REPLACE VIEW vw_cortes_recomendados_semana AS
WITH cfg AS (
  SELECT
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'cobertura_alvo_dias')           AS cob_alvo,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'capacidade_cortes_normal_max')  AS cap_normal,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'capacidade_cortes_corrida_max') AS cap_corrida,
    (SELECT (valor #>> '{}' )::int FROM ia_config WHERE chave = 'rolos_min_por_cor')             AS rolos_min_cor
),
-- Quantas peças precisa cortar: velocidade_dia × cobertura_alvo − saldo projetado base
necessidade_pecas AS (
  SELECT
    pr.ref,
    pr.velocidade_dia,
    pr.saldo_cenario_b,
    cfg.cob_alvo,
    GREATEST(
      CEIL(pr.velocidade_dia * cfg.cob_alvo - GREATEST(pr.saldo_cenario_b, 0))::int,
      0
    ) AS pecas_a_cortar
  FROM vw_projecao_22_dias_por_ref pr
  CROSS JOIN cfg
),
-- Sala recomendada: melhor rendimento disponível (N1 ganha de N2)
melhor_sala AS (
  SELECT DISTINCT ON (ref)
    ref,
    sala            AS sala_recomendada,
    rendimento_pc_por_rolo AS rendimento,
    nivel_fallback,
    confianca       AS confianca_sala
  FROM vw_rendimento_sala_corte
  ORDER BY
    ref,
    CASE nivel_fallback WHEN 'N1_ref_propria' THEN 1 WHEN 'N2_categoria' THEN 2 ELSE 3 END,
    rendimento_pc_por_rolo DESC NULLS LAST
),
-- Rolos totais estimados pela ref (peças ÷ rendimento da melhor sala)
rolos_por_ref AS (
  SELECT
    np.ref,
    np.pecas_a_cortar,
    ms.sala_recomendada,
    ms.rendimento,
    ms.nivel_fallback,
    ms.confianca_sala,
    CASE
      WHEN ms.rendimento > 0 THEN CEIL(np.pecas_a_cortar / ms.rendimento)::int
      ELSE NULL
    END AS rolos_totais_estimados
  FROM necessidade_pecas np
  LEFT JOIN melhor_sala ms ON ms.ref = np.ref
),
-- Rolos por cor = participação × rolos totais × multiplicador de tendência
-- Piso: rolos_min_por_cor
rolos_por_cor AS (
  SELECT
    d.ref,
    d.cor,
    d.cor_key,
    d.participacao_pct,
    d.tendencia_cor,
    d.multiplicador,
    rp.rolos_totais_estimados,
    CASE
      WHEN rp.rolos_totais_estimados IS NULL THEN NULL
      ELSE GREATEST(
        CEIL(rp.rolos_totais_estimados * (d.participacao_pct / 100.0) * d.multiplicador)::int,
        cfg.rolos_min_cor
      )
    END AS rolos_cor
  FROM vw_distribuicao_cores_por_ref d
  INNER JOIN rolos_por_ref rp ON rp.ref = d.ref
  CROSS JOIN cfg
),
-- Consolida cores num array JSONB por ref
cores_agg AS (
  SELECT
    ref,
    jsonb_agg(
      jsonb_build_object(
        'cor', cor,
        'participacao_pct', participacao_pct,
        'tendencia', tendencia_cor,
        'rolos', rolos_cor
      )
      ORDER BY participacao_pct DESC
    ) AS cores,
    SUM(rolos_cor) AS rolos_efetivos_somados
  FROM rolos_por_cor
  WHERE rolos_cor IS NOT NULL
  GROUP BY ref
),
-- Consolida grade num array JSONB por ref
grade_agg AS (
  SELECT
    ref,
    MAX(categoria_peca) AS categoria_peca,
    MAX(max_modulos)    AS max_modulos,
    jsonb_agg(
      jsonb_build_object(
        'tam', tam,
        'proporcao_pct', proporcao_final_pct
      )
      ORDER BY proporcao_final_pct DESC
    ) AS grade
  FROM vw_grade_otimizada_por_ref
  GROUP BY ref
),
-- Curva (view 8)
curvas AS (
  SELECT ref, curva, pecas_estimadas_proximo_corte
  FROM vw_ranking_curvas_bling
)
SELECT
  rp.ref,
  r.descricao,
  rp.pecas_a_cortar,
  rp.sala_recomendada,
  rp.rendimento                            AS rendimento_sala_pc_por_rolo,
  rp.nivel_fallback                        AS rendimento_fallback,
  rp.confianca_sala,
  rp.rolos_totais_estimados,
  COALESCE(ca.rolos_efetivos_somados, rp.rolos_totais_estimados) AS rolos_efetivos,
  ga.categoria_peca,
  ga.max_modulos,
  ga.grade,
  ca.cores,
  c.curva,
  c.pecas_estimadas_proximo_corte,
  r.motivo_elegibilidade,
  r.confianca                              AS confianca_ref,
  -- Severidade: crítico se tem variação zerada/crítica e demanda ativa
  CASE
    WHEN r.qtd_ruptura > 0                               THEN 'alta'
    WHEN r.qtd_criticas > 0 AND r.qtd_ativa > 0          THEN 'alta'
    WHEN r.qtd_atencao  > 0 AND r.qtd_ativa > 0          THEN 'media'
    ELSE 'baixa'
  END AS severidade,
  r.qtd_ativa,
  r.qtd_criticas,
  r.qtd_atencao,
  r.estoque_total,
  r.vendas_30d_total
FROM rolos_por_ref rp
INNER JOIN vw_refs_elegiveis_corte r ON r.ref = rp.ref
LEFT JOIN cores_agg ca ON ca.ref = rp.ref
LEFT JOIN grade_agg ga ON ga.ref = rp.ref
LEFT JOIN curvas    c  ON c.ref  = rp.ref
WHERE rp.pecas_a_cortar > 0
ORDER BY
  CASE WHEN COALESCE(c.curva, 'outras') = 'A' THEN 1
       WHEN COALESCE(c.curva, 'outras') = 'B' THEN 2
       ELSE 3 END,
  rp.pecas_a_cortar DESC;

COMMENT ON VIEW vw_cortes_recomendados_semana IS
  'Consolidadora final do fluxo de corte. Uma linha por ref recomendada, '
  'com grade, cores, rolos, sala e curva. Base pro JSON de saída da função.';


-- =====================================================================
-- FIM · 10 views criadas
-- Validar com: SELECT COUNT(*) FROM vw_cortes_recomendados_semana;
-- =====================================================================
