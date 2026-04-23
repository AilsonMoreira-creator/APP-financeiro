-- OS Amícia · Sprint 2 · Função orquestradora do fluxo de corte
-- Versão: 1.0 · Data: 21/04/2026
--
-- RODAR DEPOIS de 05_views_corte.sql.
-- Idempotente: usa CREATE OR REPLACE FUNCTION.
--
-- Função `fn_ia_cortes_recomendados()`:
--   Orquestra as 10 views do fluxo de corte e devolve um JSONB único
--   pronto pro Claude Sonnet 4.6 consumir (via /api/ia-cron no Sprint 3).
--
-- Formato de saída (compatível com regra #5: "respeite a confiança"):
--   {
--     "gerado_em": "<ISO timestamp>",
--     "versao": "1.0",
--     "capacidade_semanal": {
--       "total_cortes": N,
--       "status": "normal|corrida|excesso",
--       "limite_normal": 15,
--       "limite_corrida": 20
--     },
--     "refs": [
--       {
--         "ref": "2601",
--         "descricao": "Vestido Midi de Linho...",
--         "severidade": "alta|media|baixa",
--         "confianca_ref": "alta|media|baixa",
--         "motivo": "demanda_ativa_e_critico | ruptura_disfarcada | ...",
--         "curva": "A|B|outras",
--         "pecas_a_cortar": 248,
--         "rolos_estimados": 12,
--         "rolos_efetivos": 13,
--         "sala_recomendada": "Antonio",
--         "rendimento_sala": 27.5,
--         "rendimento_fallback": "N1_ref_propria|N2_categoria",
--         "confianca_sala": "alta|media",
--         "grade": [{"tam":"M","proporcao_pct":40}, ...],
--         "cores": [{"cor":"Preto","participacao_pct":35,"tendencia":"alta","rolos":5}, ...],
--         "categoria_peca": "grande|pequena_media",
--         "max_modulos": 6,
--         "vendas_30d_total": 520,
--         "estoque_total": 84
--       }
--     ]
--   }
--
-- SECURITY DEFINER: função roda com privilégios do owner pra conseguir
-- ler as tabelas mesmo que o caller seja um role restrito. As views
-- leem de tabelas base (bling_vendas_detalhe, ml_estoque_ref_atual,
-- amicia_data) que têm RLS — essa função é o "bypass controlado".
--
-- Caller esperado: /api/ia-cron (service role via SUPABASE_KEY).

CREATE OR REPLACE FUNCTION fn_ia_cortes_recomendados()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  resultado       jsonb;
  refs_array      jsonb;
  total_cortes    int;
  cap_normal      int;
  cap_corrida     int;
  cap_status      text;
BEGIN
  -- Lê thresholds de capacidade direto do ia_config
  SELECT (valor #>> '{}')::int INTO cap_normal  FROM ia_config WHERE chave = 'capacidade_cortes_normal_max';
  SELECT (valor #>> '{}')::int INTO cap_corrida FROM ia_config WHERE chave = 'capacidade_cortes_corrida_max';

  -- Monta array de refs recomendadas (ordenadas pela view 10 — curva A primeiro, depois peças)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'ref',                  ref,
      'descricao',            descricao,
      'severidade',           severidade,
      'confianca_ref',        confianca_ref,
      'motivo',               motivo_elegibilidade,
      'curva',                COALESCE(curva, 'outras'),
      'pecas_a_cortar',       pecas_a_cortar,
      'pecas_estimadas_proximo_corte', pecas_estimadas_proximo_corte,
      'rolos_estimados',      rolos_totais_estimados,
      'rolos_efetivos',       rolos_efetivos,
      'sala_recomendada',     sala_recomendada,
      'rendimento_sala',      rendimento_sala_pc_por_rolo,
      'rendimento_fallback',  rendimento_fallback,
      'confianca_sala',       confianca_sala,
      'grade',                COALESCE(grade, '[]'::jsonb),
      'cores',                COALESCE(cores, '[]'::jsonb),
      'categoria_peca',       categoria_peca,
      'max_modulos',          max_modulos,
      'qtd_variacoes_ativas',     qtd_ativa,
      'qtd_variacoes_criticas',   qtd_criticas,
      'qtd_variacoes_atencao',    qtd_atencao,
      'vendas_30d_total',     vendas_30d_total,
      'estoque_total',        estoque_total
    )
  ), '[]'::jsonb)
  INTO refs_array
  FROM vw_cortes_recomendados_semana;

  -- Total de cortes = número de refs recomendadas (1 corte = 1 ref inteira, decisão do HANDOFF)
  total_cortes := jsonb_array_length(refs_array);

  -- Semáforo de capacidade
  cap_status := CASE
    WHEN total_cortes <= cap_normal  THEN 'normal'
    WHEN total_cortes <= cap_corrida THEN 'corrida'
    ELSE 'excesso'
  END;

  -- Monta resultado final
  resultado := jsonb_build_object(
    'gerado_em',         to_jsonb(to_char(NOW() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI:SS')),
    'versao',            '1.0',
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
  'Orquestra as 10 views do fluxo de corte e devolve JSONB consolidado. '
  'Ordem da saída: curva A → curva B → outras, peças DESC. '
  'Chamada pelo /api/ia-cron no Sprint 3.';

-- Permissões: service role pode executar. Anon não.
-- RLS não se aplica a functions, mas o EXECUTE é controlado.
REVOKE ALL ON FUNCTION fn_ia_cortes_recomendados() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_ia_cortes_recomendados() FROM anon;
GRANT  EXECUTE ON FUNCTION fn_ia_cortes_recomendados() TO service_role;
GRANT  EXECUTE ON FUNCTION fn_ia_cortes_recomendados() TO authenticated;

-- SMOKE TEST (rodar manualmente no SQL Editor depois de aplicar)
--
-- 1) Função existe?
--    SELECT proname, pg_get_function_result(oid)
--    FROM pg_proc WHERE proname = 'fn_ia_cortes_recomendados';
--
-- 2) Executa e retorna JSON válido?
--    SELECT fn_ia_cortes_recomendados();
--
-- 3) Quantas refs foram recomendadas?
--    SELECT jsonb_array_length((fn_ia_cortes_recomendados())->'refs');
--
-- 4) REF 02277 aparece? (teste canônico do HANDOFF)
--    SELECT elem
--    FROM jsonb_array_elements((fn_ia_cortes_recomendados())->'refs') elem
--    WHERE elem->>'ref' = '2277';
--
-- 5) Status de capacidade:
--    SELECT (fn_ia_cortes_recomendados())->'capacidade_semanal';
--
