-- =====================================================================
-- OS Amicia - Sprint 6.5 Fase 2.1 + 2.2 (hotfix)
-- Cobertura granular por variacao + projecao capada em 0
-- Versao: 1.2 - Data: 22/04/2026
-- =====================================================================
--
-- COMO RODAR:
--   1. DEPOIS de 16_fase2_estender_fn_cortes.sql
--   2. Supabase -> SQL Editor -> New query
--   3. Colar este arquivo INTEIRO e Run
--
-- IDEMPOTENTE: CREATE OR REPLACE FUNCTION.
-- ASCII PURO.
--
-- PROPOSITO:
-- Smoke test da Fase 2 revelou 2 problemas de regra de negocio:
--
-- BUG 1 (Cobertura):
--   cobertura_dias_ref usava media ponderada por estoque -> mascara o
--   problema real. REF 2601 mostrava 133.8 dias, mas tem 15 variacoes
--   em ruptura critica (cobertura 2-5d). A media engloba variacoes
--   "saudaveis" com estoque alto que escondem a urgencia.
--
--   FIX: substituir cobertura_dias_ref pela LISTA das variacoes em
--   ruptura critica (granularidade total, conforme decisao Ailson:
--   "cobertura tem que ser vista por variacao granularidade").
--
-- BUG 2 (Projecao):
--   projecao_22d_sem_corte podia ficar negativa (REF 2851 mostrou
--   -208), mas em produto fisico nao existe -208 unidades. Negativo
--   significa "perda de venda potencial".
--
--   FIX: capar projecao em 0 e adicionar campo separado
--   pecas_perdidas_se_nao_cortar com o valor positivo da perda.
--
-- MUDANCAS NA FUNCAO (vs versao 1.1):
--
-- REMOVIDO: cobertura_dias_ref
-- ADICIONADO: variacoes_em_ruptura[] - lista granular cor+tam+cobertura
--   das variacoes em ruptura critica (cobertura_status IN ('critica','zerada')
--   AND demanda_status='ativa') ordenadas por urgencia
--
-- AJUSTADO: projecao_22d_sem_corte agora capa em 0
-- AJUSTADO: projecao_22d_com_corte agora capa em 0
-- ADICIONADO: pecas_perdidas_se_nao_cortar (valor absoluto da perda)
--
-- Versao -> 1.2 (era 1.1)
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
  SELECT (valor #>> '{}')::int INTO cap_normal  FROM ia_config WHERE chave = 'capacidade_cortes_normal_max';
  SELECT (valor #>> '{}')::int INTO cap_corrida FROM ia_config WHERE chave = 'capacidade_cortes_corrida_max';
  SELECT (valor #>> '{}')::int INTO v_lead_time FROM ia_config WHERE chave = 'lead_time_dias';
  SELECT (valor #>> '{}')::int INTO v_validade  FROM ia_config WHERE chave = 'ordem_os_validade_dias';

  v_lead_time := COALESCE(v_lead_time, 22);
  v_validade  := COALESCE(v_validade, 7);

  v_gerado_em := to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS');
  v_expira_em := to_char((NOW() + (v_validade || ' days')::interval) AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS');

  WITH
  -- HOTFIX 2.1: substitui cobertura_dias_ref por lista granular das
  -- variacoes em ruptura critica daquela ref.
  -- Filtra: demanda_status='ativa' AND cobertura_status IN ('critica','zerada')
  -- (mesma definicao do Card 2 Estoque do Sprint 6.1)
  variacoes_em_ruptura_agg AS (
    SELECT
      ref,
      jsonb_agg(
        jsonb_build_object(
          'cor',                cor,
          'tam',                tam,
          'estoque_atual',      estoque_atual,
          'pecas_em_corte',     pecas_em_corte,
          'vendas_15d',         vendas_15d,
          'vendas_30d',         vendas_30d,
          'velocidade_dia',     velocidade_dia,
          'cobertura_dias',     cobertura_dias,
          'cobertura_projetada_dias', cobertura_projetada_dias,
          'cobertura_status',   cobertura_status
        )
        ORDER BY cobertura_projetada_dias NULLS FIRST, vendas_30d DESC
      ) AS variacoes_em_ruptura,
      COUNT(*) AS qtd_variacoes_em_ruptura
    FROM vw_variacoes_classificadas
    WHERE demanda_status = 'ativa'
      AND cobertura_status IN ('critica', 'zerada')
    GROUP BY ref
  ),
  -- pecas_em_producao continua agregada igual antes
  pecas_em_producao_agg AS (
    SELECT
      ref,
      SUM(pecas_em_corte) AS pecas_em_producao
    FROM vw_variacoes_classificadas
    WHERE demanda_status = 'ativa'
    GROUP BY ref
  ),
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
      'cores',
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

      -- HOTFIX 2.1: granularidade total (lista das variacoes em ruptura)
      'qtd_variacoes_em_ruptura', COALESCE(ver.qtd_variacoes_em_ruptura, 0),
      'variacoes_em_ruptura',     COALESCE(ver.variacoes_em_ruptura, '[]'::jsonb),

      'pecas_em_producao',    COALESCE(pep.pecas_em_producao, 0),

      -- HOTFIX 2.2: projecao capada em 0 + perda explicita
      'projecao_22d_sem_corte',
        CASE
          WHEN r.vendas_30d_total > 0 THEN
            GREATEST(
              0,
              (COALESCE(r.estoque_total, 0) + COALESCE(pep.pecas_em_producao, 0)
                - ROUND((r.vendas_30d_total::numeric / 30.0) * v_lead_time))::int
            )
          ELSE NULL
        END,
      'projecao_22d_com_corte',
        CASE
          WHEN r.vendas_30d_total > 0 THEN
            GREATEST(
              0,
              (COALESCE(r.estoque_total, 0) + COALESCE(pep.pecas_em_producao, 0)
                + COALESCE(r.pecas_a_cortar, 0)
                - ROUND((r.vendas_30d_total::numeric / 30.0) * v_lead_time))::int
            )
          ELSE NULL
        END,
      -- Quanto deixa de vender se nao cortar (valor absoluto da perda)
      'pecas_perdidas_se_nao_cortar',
        CASE
          WHEN r.vendas_30d_total > 0 THEN
            GREATEST(
              0,
              (ROUND((r.vendas_30d_total::numeric / 30.0) * v_lead_time)
                - COALESCE(r.estoque_total, 0)
                - COALESCE(pep.pecas_em_producao, 0))::int
            )
          ELSE 0
        END,

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
  LEFT JOIN variacoes_em_ruptura_agg ver ON ver.ref = r.ref
  LEFT JOIN pecas_em_producao_agg pep    ON pep.ref = r.ref;

  total_cortes := jsonb_array_length(refs_array);

  cap_status := CASE
    WHEN total_cortes <= cap_normal  THEN 'normal'
    WHEN total_cortes <= cap_corrida THEN 'corrida'
    ELSE 'excesso'
  END;

  resultado := jsonb_build_object(
    'gerado_em',         to_jsonb(v_gerado_em),
    'expira_em',         to_jsonb(v_expira_em),
    'validade_dias',     v_validade,
    'lead_time_dias',    v_lead_time,
    'versao',            '1.2',
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
  'Orquestra views do fluxo de corte. v1.2 - Sprint 6.5 Fase 2.1+2.2: '
  'cobertura agora granular (variacoes_em_ruptura[] + qtd_variacoes_em_ruptura), '
  'projecoes capadas em 0, novo campo pecas_perdidas_se_nao_cortar. '
  'Removido cobertura_dias_ref (era media enganosa).';

REVOKE ALL ON FUNCTION fn_ia_cortes_recomendados() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_ia_cortes_recomendados() FROM anon;
GRANT  EXECUTE ON FUNCTION fn_ia_cortes_recomendados() TO service_role;
GRANT  EXECUTE ON FUNCTION fn_ia_cortes_recomendados() TO authenticated;

-- =====================================================================
-- SMOKE TESTS (rodar apos aplicar)
--
-- 1) Versao bumpou pra 1.2?
--    SELECT (fn_ia_cortes_recomendados())->>'versao';
--
-- 2) Conferir REF 2601 - antes mostrava 133.8 dias (errado)
--    Agora deve mostrar lista granular das 15 variacoes em ruptura
--    SELECT
--      x.ref,
--      x.qtd_variacoes_em_ruptura,
--      x.pecas_perdidas_se_nao_cortar,
--      x.projecao_22d_sem_corte,
--      x.projecao_22d_com_corte
--    FROM jsonb_to_recordset(
--      (fn_ia_cortes_recomendados())->'refs'
--    ) AS x(
--      ref text,
--      qtd_variacoes_em_ruptura int,
--      pecas_perdidas_se_nao_cortar int,
--      projecao_22d_sem_corte int,
--      projecao_22d_com_corte int
--    )
--    WHERE x.ref IN ('2601','2700','2708','2851')
--    ORDER BY x.ref;
--
-- 3) Lista granular das variacoes em ruptura da REF 2601:
--    SELECT
--      x.ref,
--      v->>'cor' AS cor,
--      v->>'tam' AS tam,
--      (v->>'estoque_atual')::int AS estoque,
--      (v->>'pecas_em_corte')::int AS em_corte,
--      (v->>'vendas_30d')::int AS vendas_30d,
--      (v->>'cobertura_projetada_dias')::numeric AS cobertura_d
--    FROM jsonb_to_recordset(
--      (fn_ia_cortes_recomendados())->'refs'
--    ) AS x(ref text, variacoes_em_ruptura jsonb),
--    jsonb_array_elements(x.variacoes_em_ruptura) AS v
--    WHERE x.ref = '2601'
--    ORDER BY (v->>'cobertura_projetada_dias')::numeric NULLS FIRST;
--
-- 4) Confirma que nenhuma projecao e negativa:
--    SELECT
--      MIN(projecao_22d_sem_corte) AS min_sem,
--      MIN(projecao_22d_com_corte) AS min_com,
--      MAX(pecas_perdidas_se_nao_cortar) AS max_perda
--    FROM jsonb_to_recordset(
--      (fn_ia_cortes_recomendados())->'refs'
--    ) AS x(
--      projecao_22d_sem_corte int,
--      projecao_22d_com_corte int,
--      pecas_perdidas_se_nao_cortar int
--    );
--    Esperado: min_sem >= 0, min_com >= 0, max_perda > 0
-- =====================================================================
