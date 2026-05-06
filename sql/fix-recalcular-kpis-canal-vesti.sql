-- ═══════════════════════════════════════════════════════════════════════════
-- Reinstalar lojas_recalcular_kpis_cliente (versão correta com camada Vesti)
-- ═══════════════════════════════════════════════════════════════════════════
-- Sessao Ailson 06/05/2026.
--
-- BUG: a funcao foi sobrescrita por uma versao incompleta em
-- sql/lojas-media-dias-e-conversoes.sql que NAO tinha a 'Camada 1' que
-- prioriza canal_cadastro='vesti' sobre regra dos 70%.
--
-- Resultado: 41 dos 56 clientes Vesti ficaram com canal_dominante='fisico'
-- (sem sufixo _dominante) porque maioria das compras eram em loja Mire.
--
-- FIX: re-instalar a versao do schema principal (sql/lojas-modulo-schema.sql).
--
-- DEPOIS DE RODAR ESTE SQL:
--   1. SELECT lojas_recalcular_kpis_cliente(c.id)
--      FROM lojas_clientes c
--      WHERE c.canal_cadastro = 'vesti' AND c.arquivado_em IS NULL;
--   2. Validar:
--      SELECT canal_dominante, COUNT(*) FROM lojas_clientes_kpis
--      WHERE cliente_id IN (SELECT id FROM lojas_clientes WHERE canal_cadastro='vesti')
--      GROUP BY canal_dominante;
--      Esperado: todos 56 com 'vesti_dominante'
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION lojas_recalcular_kpis_cliente(p_cliente_id uuid)
RETURNS void AS $$
DECLARE
  v_qtd_compras int;
  v_qtd_pecas int;
  v_lifetime numeric(12,2);
  v_ticket numeric(12,2);
  v_primeira date;
  v_ultima date;
  v_dias_sem int;
  v_qtd_fisicas int;
  v_qtd_vesti int;
  v_qtd_convertr int;
  v_lifetime_fisico numeric(12,2);
  v_lifetime_marketplace numeric(12,2);
  v_canal_dominante text;
  v_qtd_pres int;
  v_qtd_dist int;
  v_qtd_fiel int;
  v_perfil text;
  v_paga_cheque boolean;
  v_status text;
  v_fase text;
  v_tem_sacola boolean;
  v_dias_desde_1a int;
BEGIN
  SELECT
    COUNT(*),
    COALESCE(SUM(qtd_pecas), 0),
    COALESCE(SUM(valor_liquido), 0),
    MIN(data_venda),
    MAX(data_venda),
    COUNT(*) FILTER (WHERE canal_origem = 'fisico'),
    COUNT(*) FILTER (WHERE canal_origem = 'vesti'),
    COUNT(*) FILTER (WHERE canal_origem = 'convertr'),
    COALESCE(SUM(valor_liquido) FILTER (WHERE canal_origem = 'fisico'), 0),
    COALESCE(SUM(valor_liquido) FILTER (WHERE canal_origem IN ('vesti','convertr')), 0),
    COUNT(*) FILTER (WHERE forma_pagamento_categoria = 'vem_na_loja'),
    COUNT(*) FILTER (WHERE forma_pagamento_categoria = 'distancia'),
    COUNT(*) FILTER (WHERE forma_pagamento_categoria = 'fiel_confianca')
  INTO
    v_qtd_compras, v_qtd_pecas, v_lifetime, v_primeira, v_ultima,
    v_qtd_fisicas, v_qtd_vesti, v_qtd_convertr,
    v_lifetime_fisico, v_lifetime_marketplace,
    v_qtd_pres, v_qtd_dist, v_qtd_fiel
  FROM lojas_vendas
  WHERE cliente_id = p_cliente_id;

  v_ticket := CASE WHEN v_qtd_compras > 0 THEN v_lifetime / v_qtd_compras ELSE 0 END;
  v_dias_sem := CASE WHEN v_ultima IS NULL THEN NULL
                     ELSE (CURRENT_DATE - v_ultima)::int END;

  -- LOGICA EM CAMADAS (Ailson 28/04/2026):
  -- 1. Cliente vesti antigo (canal_cadastro=vesti) prevalece — vesti_dominante
  -- 2. Cliente convertr antigo prevalece — convertr_dominante
  -- 3. Cliente sem vendas usa canal_cadastro como fallback
  -- 4. Calculo normal de 70%+ pelas vendas
  v_canal_dominante := CASE
    WHEN EXISTS (SELECT 1 FROM lojas_clientes WHERE id = p_cliente_id AND canal_cadastro = 'vesti')
      THEN 'vesti_dominante'
    WHEN EXISTS (SELECT 1 FROM lojas_clientes WHERE id = p_cliente_id AND canal_cadastro = 'convertr')
      THEN 'convertr_dominante'
    WHEN v_qtd_compras = 0 THEN 'fisico_dominante'
    WHEN v_qtd_fisicas::float / v_qtd_compras >= 0.7 THEN 'fisico_dominante'
    WHEN v_qtd_vesti::float / v_qtd_compras >= 0.7 THEN 'vesti_dominante'
    WHEN v_qtd_convertr::float / v_qtd_compras >= 0.7 THEN 'convertr_dominante'
    ELSE 'misto'
  END;

  v_perfil := CASE
    WHEN (v_qtd_pres + v_qtd_dist + v_qtd_fiel) = 0 THEN 'desconhecido'
    WHEN v_qtd_pres::float / (v_qtd_pres + v_qtd_dist + v_qtd_fiel) >= 0.7 THEN 'presencial_dominante'
    WHEN v_qtd_dist::float / (v_qtd_pres + v_qtd_dist + v_qtd_fiel) >= 0.7 THEN 'remota_dominante'
    WHEN v_qtd_fiel::float / (v_qtd_pres + v_qtd_dist + v_qtd_fiel) >= 0.7 THEN 'fiel_cheque'
    ELSE 'hibrida'
  END;

  v_paga_cheque := v_qtd_fiel > 0;

  SELECT EXISTS (
    SELECT 1 FROM lojas_pedidos_sacola
    WHERE cliente_id = p_cliente_id AND ativo = true
  ) INTO v_tem_sacola;

  v_status := CASE
    WHEN v_tem_sacola                THEN 'separandoSacola'
    WHEN v_dias_sem IS NULL          THEN 'arquivo'
    WHEN v_dias_sem <= 45            THEN 'ativo'
    WHEN v_dias_sem <= 90            THEN 'atencao'
    WHEN v_dias_sem <= 180           THEN 'semAtividade'
    WHEN v_dias_sem <= 365           THEN 'inativo'
    ELSE 'arquivo'
  END;

  v_dias_desde_1a := CASE WHEN v_primeira IS NULL THEN NULL
                          ELSE (CURRENT_DATE - v_primeira)::int END;
  v_fase := CASE
    WHEN v_dias_desde_1a IS NULL              THEN 'sem_compras_ainda'
    WHEN v_dias_desde_1a <= 14                THEN 'nova_aguardando'
    WHEN v_dias_desde_1a = 15                 THEN 'nova_checkin_pronto'
    WHEN v_dias_desde_1a <= 30                THEN 'nova_em_analise'
    ELSE 'normal'
  END;

  INSERT INTO lojas_clientes_kpis (
    cliente_id, qtd_compras, qtd_pecas, lifetime_total, ticket_medio,
    primeira_compra, ultima_compra, dias_sem_comprar,
    qtd_compras_fisicas, qtd_compras_vesti, qtd_compras_convertr,
    lifetime_fisico, lifetime_marketplace, canal_dominante,
    perfil_presenca, pct_compras_presenciais, paga_com_cheque,
    fase_ciclo_vida, status_atual, ultima_atualizacao
  ) VALUES (
    p_cliente_id, v_qtd_compras, v_qtd_pecas, v_lifetime, v_ticket,
    v_primeira, v_ultima, v_dias_sem,
    v_qtd_fisicas, v_qtd_vesti, v_qtd_convertr,
    v_lifetime_fisico, v_lifetime_marketplace, v_canal_dominante,
    v_perfil,
    CASE WHEN v_qtd_compras > 0 THEN v_qtd_pres::numeric * 100 / v_qtd_compras ELSE 0 END,
    v_paga_cheque,
    v_fase, v_status, now()
  )
  ON CONFLICT (cliente_id) DO UPDATE SET
    qtd_compras = EXCLUDED.qtd_compras,
    qtd_pecas = EXCLUDED.qtd_pecas,
    lifetime_total = EXCLUDED.lifetime_total,
    ticket_medio = EXCLUDED.ticket_medio,
    primeira_compra = EXCLUDED.primeira_compra,
    ultima_compra = EXCLUDED.ultima_compra,
    dias_sem_comprar = EXCLUDED.dias_sem_comprar,
    qtd_compras_fisicas = EXCLUDED.qtd_compras_fisicas,
    qtd_compras_vesti = EXCLUDED.qtd_compras_vesti,
    qtd_compras_convertr = EXCLUDED.qtd_compras_convertr,
    lifetime_fisico = EXCLUDED.lifetime_fisico,
    lifetime_marketplace = EXCLUDED.lifetime_marketplace,
    canal_dominante = EXCLUDED.canal_dominante,
    perfil_presenca = EXCLUDED.perfil_presenca,
    pct_compras_presenciais = EXCLUDED.pct_compras_presenciais,
    paga_com_cheque = EXCLUDED.paga_com_cheque,
    fase_ciclo_vida = EXCLUDED.fase_ciclo_vida,
    status_atual = EXCLUDED.status_atual,
    ultima_atualizacao = now();
END;
$$ LANGUAGE plpgsql;
