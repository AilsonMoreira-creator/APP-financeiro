-- =====================================================================
-- OS Amicia - Sprint 6.5 Fase 2 - Estender fn_ia_cortes_recomendados
-- Versao: 1.0 - Data: 22/04/2026
-- Grupo Amicia - App Financeiro v6.8
-- =====================================================================
--
-- COMO RODAR:
--   1. Sprint 6.1 ja deve estar aplicado (ate Fase 9)
--   2. Sprint 2 ja deve estar aplicado (06_fn_cortes_recomendados.sql)
--   3. Supabase -> SQL Editor -> New query
--   4. Colar este arquivo INTEIRO e Run
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION.
-- ASCII PURO.
--
-- PROPOSITO:
-- O Sprint 3 (TabProducao atual) usa fn_ia_cortes_recomendados() pra
-- gerar uma versao simplificada da UI. O Sprint 6.5 vai refazer essa
-- UI seguindo o contrato visual em
-- docs/pacote-os-amicia/05_Tela_Sugestao_Corte.html
-- que pede 8 dados adicionais que a funcao atual nao retorna.
--
-- DECISOES (Ailson 22/04):
-- - Score 0-100 NAO sera implementado (tela usa Severidade + Confianca)
-- - Lead time = 22 dias (chave ja existe em ia_config)
-- - Validade = 7 dias (reusa chave 'ordem_os_validade_dias')
-- - Tendencia de cor: % se tem historico, "nova" se nao
-- - Matriz cor x tamanho usa rendimento_sala_pc_por_rolo (nao 20 fixo)
-- - Pecas em producao usa pecas_em_corte da Fase 8 do Sprint 6.1
--   (que ja le de ailson_cortes corretamente)
--
-- 8 CAMPOS NOVOS por ref:
--   1. validade_dias        (constante via ia_config)
--   2. expira_em            (gerado_em + validade_dias)
--   3. cobertura_dias_ref   (agregado de vw_variacoes_classificadas)
--   4. lead_time_dias       (constante via ia_config)
--   5. cores[*].tendencia_pct e cores[*].tendencia_label
--      (% comparando vendas_15d vs vendas_15d_anteriores por cor;
--       label = "alta"|"normal"|"baixa"|"nova")
--   6. matriz_cor_tamanho   (cor x tamanho com pecas_estimadas_celula)
--   7. projecao_22d_sem_corte
--   8. projecao_22d_com_corte
--   EXTRA: pecas_em_producao (soma pecas_em_corte da Fase 8 6.1)
--
-- ESTRUTURA DE SAIDA NOVA (campos novos marcados com [+]):
--   {
--     "gerado_em": "...",
--     "expira_em": "...",            [+]
--     "validade_dias": 7,            [+]
--     "lead_time_dias": 22,          [+]
--     "versao": "1.1",
--     "capacidade_semanal": {...},
--     "refs": [
--       {
--         ...todos os campos antigos...,
--         "cobertura_dias_ref": 6.7,           [+]
--         "pecas_em_producao": 0,              [+]
--         "projecao_22d_sem_corte": -110,      [+]
--         "projecao_22d_com_corte": 72,        [+]
--         "matriz_cor_tamanho": [              [+]
--           {"cor":"Preto","tam":"P","pecas":15},
--           {"cor":"Preto","tam":"G","pecas":15},
--           ...
--         ],
--         "cores": [                          [estendido com 2 campos]
--           {
--             "cor":"Bege",
--             "participacao_pct":40,
--             "rolos":4,
--             "tendencia":"alta",              [ja existia]
--             "tendencia_pct": 38,             [+]
--             "tendencia_label": "alta"        [+] ("alta"|"normal"|"baixa"|"nova")
--           },
--           ...
--         ]
--       }
--     ]
--   }
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_ia_cortes_recomendados()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  resultado          jsonb;
  refs_array         jsonb;
  total_cortes       int;
  cap_normal         int;
  cap_corrida        int;
  cap_status         text;
  v_lead_time        int;
  v_validade         int;
  v_gerado_em        text;
  v_expira_em        text;
BEGIN
  -- Le thresholds de capacidade direto do ia_config
  SELECT (valor #>> '{}')::int INTO cap_normal  FROM ia_config WHERE chave = 'capacidade_cortes_normal_max';
  SELECT (valor #>> '{}')::int INTO cap_corrida FROM ia_config WHERE chave = 'capacidade_cortes_corrida_max';

  -- Novos: lead time e validade da sugestao
  SELECT (valor #>> '{}')::int INTO v_lead_time FROM ia_config WHERE chave = 'lead_time_dias';
  SELECT (valor #>> '{}')::int INTO v_validade  FROM ia_config WHERE chave = 'ordem_os_validade_dias';

  -- Defaults defensivos caso ia_config nao tenha as chaves
  v_lead_time := COALESCE(v_lead_time, 22);
  v_validade  := COALESCE(v_validade, 7);

  -- Timestamps
  v_gerado_em := to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS');
  v_expira_em := to_char((NOW() + (v_validade || ' days')::interval) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS');

  -- Monta array de refs recomendadas
  -- (LEFT JOIN com cobertura_ref_agg + pecas_em_producao_agg + tendencias_cor)
  WITH
  -- Cobertura agregada por ref a partir das variacoes ativas (Sprint 6.1 Fase 9)
  -- Cobertura "da ref" = media ponderada por estoque das variacoes ativas
  cobertura_ref_agg AS (
    SELECT
      ref,
      ROUND(
        SUM(estoque_atual * cobertura_projetada_dias) / NULLIF(SUM(estoque_atual), 0),
        1
      ) AS cobertura_dias_ref,
      SUM(pecas_em_corte) AS pecas_em_producao
    FROM vw_variacoes_classificadas
    WHERE demanda_status = 'ativa'
    GROUP BY ref
  ),
  -- Vendas por cor em 2 janelas: ultimos 15d vs 15d anteriores
  -- Pra calcular tendencia de cada cor
  vendas_cor_15d AS (
    SELECT
      LTRIM(COALESCE(item->>'ref',''), '0')          AS ref,
      LOWER(TRIM(COALESCE(item->>'cor','')))         AS cor_key,
      SUM(COALESCE((item->>'quantidade')::int, 0))   AS vendas_15d
    FROM bling_vendas_detalhe v,
         jsonb_array_elements(v.itens) AS item
    WHERE v.data_pedido >= CURRENT_DATE - INTERVAL '15 days'
      AND item->>'ref' IS NOT NULL AND item->>'ref' <> ''
      AND COALESCE(item->>'cor','') <> ''
    GROUP BY ref, cor_key
  ),
  vendas_cor_15d_ant AS (
    SELECT
      LTRIM(COALESCE(item->>'ref',''), '0')          AS ref,
      LOWER(TRIM(COALESCE(item->>'cor','')))         AS cor_key,
      SUM(COALESCE((item->>'quantidade')::int, 0))   AS vendas_15d_ant
    FROM bling_vendas_detalhe v,
         jsonb_array_elements(v.itens) AS item
    WHERE v.data_pedido >= CURRENT_DATE - INTERVAL '30 days'
      AND v.data_pedido <  CURRENT_DATE - INTERVAL '15 days'
      AND item->>'ref' IS NOT NULL AND item->>'ref' <> ''
      AND COALESCE(item->>'cor','') <> ''
    GROUP BY ref, cor_key
  ),
  -- Tendencia por (ref, cor): label + % de variacao
  tendencia_cor AS (
    SELECT
      COALESCE(a.ref, b.ref)         AS ref,
      COALESCE(a.cor_key, b.cor_key) AS cor_key,
      a.vendas_15d,
      b.vendas_15d_ant,
      CASE
        WHEN COALESCE(b.vendas_15d_ant, 0) = 0
             AND COALESCE(a.vendas_15d, 0) > 0  THEN 'nova'
        WHEN COALESCE(a.vendas_15d, 0) = 0      THEN 'baixa'
        WHEN COALESCE(b.vendas_15d_ant, 0) = 0  THEN 'nova'
        WHEN a.vendas_15d::numeric / b.vendas_15d_ant >= 1.20  THEN 'alta'
        WHEN a.vendas_15d::numeric / b.vendas_15d_ant <= 0.80  THEN 'baixa'
        ELSE 'normal'
      END AS tendencia_label,
      CASE
        WHEN COALESCE(b.vendas_15d_ant, 0) = 0 THEN NULL
        ELSE ROUND(((a.vendas_15d::numeric - b.vendas_15d_ant) / b.vendas_15d_ant) * 100, 0)
      END::int AS tendencia_pct
    FROM vendas_cor_15d a
    FULL OUTER JOIN vendas_cor_15d_ant b
      ON a.ref = b.ref AND a.cor_key = b.cor_key
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      -- Campos antigos (mantidos pra retrocompat)
      'ref',                  r.ref,
      'descricao',            r.descricao,
      'severidade',           r.severidade,
      'confianca_ref',        r.confianca_ref,
      'motivo',               r.motivo_elegibilidade,
      'curva',                COALESCE(r.curva, 'outras'),
      'pecas_a_cortar',       r.pecas_a_cortar,
      'pecas_estimadas_proximo_corte', r.pecas_estimadas_proximo_corte,
      'rolos_estimados',      r.rolos_totais_estimados,
      'rolos_efetivos',       r.rolos_efetivos,
      'sala_recomendada',     r.sala_recomendada,
      'rendimento_sala',      r.rendimento_sala_pc_por_rolo,
      'rendimento_fallback',  r.rendimento_fallback,
      'confianca_sala',       r.confianca_sala,
      'grade',                COALESCE(r.grade, '[]'::jsonb),
      'cores',                -- estendido: junta tendencia_pct e tendencia_label
        COALESCE((
          SELECT jsonb_agg(
            cor_obj || jsonb_build_object(
              'tendencia_pct',
                (SELECT tc.tendencia_pct FROM tendencia_cor tc
                 WHERE tc.ref = r.ref
                   AND tc.cor_key = LOWER(TRIM(cor_obj->>'cor'))),
              'tendencia_label',
                COALESCE(
                  (SELECT tc.tendencia_label FROM tendencia_cor tc
                   WHERE tc.ref = r.ref
                     AND tc.cor_key = LOWER(TRIM(cor_obj->>'cor'))),
                  'normal'
                )
            )
          )
          FROM jsonb_array_elements(r.cores) AS cor_obj
        ), '[]'::jsonb),
      'categoria_peca',       r.categoria_peca,
      'max_modulos',          r.max_modulos,
      'qtd_variacoes_ativas', r.qtd_ativa,
      'qtd_variacoes_criticas', r.qtd_criticas,
      'qtd_variacoes_atencao',  r.qtd_atencao,
      'vendas_30d_total',     r.vendas_30d_total,
      'estoque_total',        r.estoque_total,

      -- CAMPOS NOVOS (Fase 2 do Sprint 6.5)
      'cobertura_dias_ref',   COALESCE(cra.cobertura_dias_ref, NULL),
      'pecas_em_producao',    COALESCE(cra.pecas_em_producao, 0),

      -- Projecao em 22d (lead time)
      'projecao_22d_sem_corte',
        CASE
          WHEN r.vendas_30d_total > 0 THEN
            (COALESCE(r.estoque_total, 0) + COALESCE(cra.pecas_em_producao, 0)
              - ROUND((r.vendas_30d_total::numeric / 30.0) * v_lead_time))::int
          ELSE NULL
        END,
      'projecao_22d_com_corte',
        CASE
          WHEN r.vendas_30d_total > 0 THEN
            (COALESCE(r.estoque_total, 0) + COALESCE(cra.pecas_em_producao, 0)
              + COALESCE(r.pecas_a_cortar, 0)
              - ROUND((r.vendas_30d_total::numeric / 30.0) * v_lead_time))::int
          ELSE NULL
        END,

      -- Matriz cor x tamanho (pecas estimadas = rolos_cor x prop_grade x rendimento)
      'matriz_cor_tamanho',
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'cor',   cor_obj->>'cor',
            'tam',   tam_obj->>'tam',
            'pecas',
              ROUND(
                COALESCE((cor_obj->>'rolos')::numeric, 0)
                * COALESCE((tam_obj->>'proporcao_pct')::numeric, 0) / 100.0
                * COALESCE(r.rendimento_sala_pc_por_rolo, 20)
              )::int
          ))
          FROM jsonb_array_elements(r.cores) AS cor_obj,
               jsonb_array_elements(r.grade) AS tam_obj
          WHERE COALESCE((cor_obj->>'rolos')::numeric, 0) > 0
            AND COALESCE((tam_obj->>'proporcao_pct')::numeric, 0) > 0
        ), '[]'::jsonb)
    )
  ), '[]'::jsonb)
  INTO refs_array
  FROM vw_cortes_recomendados_semana r
  LEFT JOIN cobertura_ref_agg cra ON cra.ref = r.ref;

  -- Total de cortes = numero de refs recomendadas
  total_cortes := jsonb_array_length(refs_array);

  -- Semaforo de capacidade
  cap_status := CASE
    WHEN total_cortes <= cap_normal  THEN 'normal'
    WHEN total_cortes <= cap_corrida THEN 'corrida'
    ELSE 'excesso'
  END;

  -- Monta resultado final
  resultado := jsonb_build_object(
    'gerado_em',         to_jsonb(v_gerado_em),
    'expira_em',         to_jsonb(v_expira_em),
    'validade_dias',     v_validade,
    'lead_time_dias',    v_lead_time,
    'versao',            '1.1',
    'capacidade_semanal', jsonb_build_object(
      'total_cortes',    total_cortes,
      'status',          cap_status,
      'limite_normal',   cap_normal,
      'limite_corrida',  cap_corrida
    ),
    'refs',              refs_array
  );

  RETURN resultado;
END;
$$;

COMMENT ON FUNCTION fn_ia_cortes_recomendados() IS
  'Orquestra views do fluxo de corte e devolve JSONB consolidado. v1.1 - Sprint 6.5 Fase 2: '
  'adicionou cobertura_dias_ref, pecas_em_producao, projecao_22d_sem_corte, projecao_22d_com_corte, '
  'matriz_cor_tamanho, expira_em, validade_dias, lead_time_dias, e estendeu cores[] com '
  'tendencia_pct e tendencia_label. Pecas em producao vem de vw_variacoes_classificadas (Sprint 6.1 Fase 8). '
  'Rendimento de cada cor vem de vw_rendimento_sala_corte (Sprint 2). '
  'Chamada por /api/ia-cron e novo /api/ia-cortes-dados (Sprint 6.5 Fase 3).';

-- Permissoes (preserva)
REVOKE ALL ON FUNCTION fn_ia_cortes_recomendados() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_ia_cortes_recomendados() FROM anon;
GRANT  EXECUTE ON FUNCTION fn_ia_cortes_recomendados() TO service_role;
GRANT  EXECUTE ON FUNCTION fn_ia_cortes_recomendados() TO authenticated;

-- =====================================================================
-- SMOKE TESTS (rodar apos aplicar)
--
-- 1) Funcao retorna versao 1.1?
--    SELECT (fn_ia_cortes_recomendados())->>'versao';
--    Esperado: 1.1
--
-- 2) Tem expira_em e validade_dias no topo?
--    SELECT
--      fn_ia_cortes_recomendados()->>'gerado_em'   AS gerado,
--      fn_ia_cortes_recomendados()->>'expira_em'   AS expira,
--      fn_ia_cortes_recomendados()->>'validade_dias' AS validade,
--      fn_ia_cortes_recomendados()->>'lead_time_dias' AS lead_time;
--
-- 3) Primeira ref tem todos os 8 campos novos?
--    SELECT
--      ref,
--      cobertura_dias_ref,
--      pecas_em_producao,
--      projecao_22d_sem_corte,
--      projecao_22d_com_corte,
--      jsonb_array_length(matriz_cor_tamanho) AS matriz_celulas
--    FROM jsonb_to_recordset(
--      ((fn_ia_cortes_recomendados())->'refs')
--    ) AS x(
--      ref text, cobertura_dias_ref numeric, pecas_em_producao int,
--      projecao_22d_sem_corte int, projecao_22d_com_corte int,
--      matriz_cor_tamanho jsonb
--    )
--    LIMIT 3;
--
-- 4) Cores tem tendencia_pct e tendencia_label?
--    SELECT
--      ref,
--      jsonb_array_elements(cores) AS cor_obj
--    FROM jsonb_to_recordset(
--      ((fn_ia_cortes_recomendados())->'refs')
--    ) AS x(ref text, cores jsonb)
--    WHERE ref = '2277'
--    LIMIT 5;
--    Esperado: cada cor com 'tendencia_pct' (numero ou null) e 'tendencia_label'
--    ('alta', 'normal', 'baixa', 'nova')
--
-- 5) Matriz cor x tamanho de uma ref especifica:
--    SELECT
--      cor_tam->>'cor' AS cor,
--      cor_tam->>'tam' AS tam,
--      (cor_tam->>'pecas')::int AS pecas
--    FROM jsonb_to_recordset(
--      ((fn_ia_cortes_recomendados())->'refs')
--    ) AS x(ref text, matriz_cor_tamanho jsonb),
--    jsonb_array_elements(matriz_cor_tamanho) AS cor_tam
--    WHERE ref = '2277'
--    ORDER BY cor, tam;
-- =====================================================================
