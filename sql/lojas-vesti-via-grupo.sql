-- ═══════════════════════════════════════════════════════════════════════════
-- LOJAS — Reconhecer clientes Vesti via coluna GRUPO da carga inicial Futura
-- ═══════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA: relatorio_vendas_clientes_br do Futura tem coluna Q='GRUPO' que
-- marca clientes Vesti com 'VESTI'. Parser nao lia. IA nunca identificava
-- cliente Vesti porque lojas_vendas nao tinha esse historico (so 40 vendas
-- pos-Mire), e canal_dominante calculava 'fisico_dominante' por default.
--
-- FIX em 4 partes (esta migration cobre 2-4):
--   1. Parser corrigido (commit) → novas importacoes setam canal_cadastro
--   2. Funcao recalcular_kpis_cliente: fallback pra canal_cadastro quando
--      cliente nao tem vendas em lojas_vendas (carga inicial agregada)
--   3. Reler CSV original NAO eh possivel daqui — parser corrigido vai pegar
--      na proxima importacao automatica. Por agora, o fallback ja resolve
--      pra clientes que tinham vendas Vesti pos-Mire.
--   4. Recalcular KPIs de TODOS os clientes pra refletir nova logica
--
-- IDEMPOTENTE.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Atualiza a funcao com fallback pro canal_cadastro
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
  v_dias_sem := CASE WHEN v_ultima IS NULL THEN NULL ELSE (CURRENT_DATE - v_ultima)::int END;

  -- Canal dominante — LOGICA EM CAMADAS (Opcao A, Ailson 28/04/2026):
  --   1. canal_cadastro=vesti SEMPRE prioriza 'vesti_dominante' mesmo com
  --      compras Mire mistas. Razao: cliente Vesti tende a continuar Vesti;
  --      melhor IA mencionar Vesti com falso-positivo do que esquecer.
  --   2. Mesma logica pra convertr.
  --   3. Sem vendas em lojas_vendas → assume fisico (default).
  --   4. Tem vendas → calcula 70%+ normalmente.
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
    WHEN v_qtd_fiel::float / (v_qtd_pres + v_qtd_dist + v_qtd_fiel) >= 0.5 THEN 'fiel_cheque'
    ELSE 'hibrida'
  END;

  v_paga_cheque := EXISTS (
    SELECT 1 FROM lojas_vendas
    WHERE cliente_id = p_cliente_id AND forma_pagamento_categoria = 'fiel_confianca'
  );

  v_tem_sacola := EXISTS (
    SELECT 1 FROM lojas_pedidos_sacola
    WHERE cliente_id = p_cliente_id AND status = 'ativa'
  );

  v_dias_desde_1a := CASE WHEN v_primeira IS NULL THEN NULL ELSE (CURRENT_DATE - v_primeira)::int END;

  v_fase := CASE
    WHEN v_dias_desde_1a IS NULL THEN 'desconhecido'
    WHEN v_dias_desde_1a <= 14 THEN 'nova_aguardando'
    WHEN v_dias_desde_1a = 15 THEN 'nova_checkin_pronto'
    WHEN v_dias_desde_1a <= 30 THEN 'nova_em_analise'
    ELSE 'normal'
  END;

  v_status := CASE
    WHEN v_tem_sacola                THEN 'separandoSacola'
    WHEN v_dias_sem IS NULL          THEN 'arquivo'
    WHEN v_dias_sem <= 45            THEN 'ativo'
    WHEN v_dias_sem <= 90            THEN 'atencao'
    WHEN v_dias_sem <= 180           THEN 'semAtividade'
    ELSE 'inativo'
  END;

  INSERT INTO lojas_clientes_kpis (
    cliente_id, qtd_compras, qtd_pecas, lifetime_total, ticket_medio,
    primeira_compra, ultima_compra, dias_sem_comprar,
    qtd_compras_fisicas, qtd_compras_vesti, qtd_compras_convertr,
    lifetime_total_fisico, lifetime_total_marketplace, canal_dominante,
    qtd_compras_presencial, qtd_compras_distancia, qtd_compras_fiel,
    perfil_presenca, paga_com_cheque,
    fase_ciclo_vida, status_atual, ultima_atualizacao
  ) VALUES (
    p_cliente_id, v_qtd_compras, v_qtd_pecas, v_lifetime, v_ticket,
    v_primeira, v_ultima, v_dias_sem,
    v_qtd_fisicas, v_qtd_vesti, v_qtd_convertr,
    v_lifetime_fisico, v_lifetime_marketplace, v_canal_dominante,
    v_qtd_pres, v_qtd_dist, v_qtd_fiel,
    v_perfil, v_paga_cheque,
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
    lifetime_total_fisico = EXCLUDED.lifetime_total_fisico,
    lifetime_total_marketplace = EXCLUDED.lifetime_total_marketplace,
    canal_dominante = EXCLUDED.canal_dominante,
    qtd_compras_presencial = EXCLUDED.qtd_compras_presencial,
    qtd_compras_distancia = EXCLUDED.qtd_compras_distancia,
    qtd_compras_fiel = EXCLUDED.qtd_compras_fiel,
    perfil_presenca = EXCLUDED.perfil_presenca,
    paga_com_cheque = EXCLUDED.paga_com_cheque,
    fase_ciclo_vida = EXCLUDED.fase_ciclo_vida,
    status_atual = EXCLUDED.status_atual,
    ultima_atualizacao = now();
END;
$$ LANGUAGE plpgsql;

-- 2. Recalcula TODOS os clientes (de uma vez — ja existe a funcao helper)
SELECT lojas_recalcular_kpis_todos();

-- 3. Validacao: distribuicao de canal_dominante apos fix
SELECT canal_dominante, COUNT(*) AS qtd_clientes
FROM lojas_clientes_kpis
GROUP BY canal_dominante
ORDER BY qtd_clientes DESC;

-- 4. Carteira da Vanessa — clientes Vesti
SELECT
  c.apelido,
  c.canal_cadastro,
  k.qtd_compras,
  k.qtd_compras_vesti,
  k.canal_dominante,
  k.status_atual,
  k.dias_sem_comprar
FROM lojas_clientes c
JOIN lojas_clientes_kpis k ON k.cliente_id = c.id
JOIN lojas_vendedoras v ON v.id = c.vendedora_id
WHERE v.nome ILIKE 'Vanessa'
  AND k.canal_dominante = 'vesti_dominante'
ORDER BY k.lifetime_total DESC;
