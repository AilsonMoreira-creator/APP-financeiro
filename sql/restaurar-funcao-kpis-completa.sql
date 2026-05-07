-- ═══════════════════════════════════════════════════════════════════════════
-- Reinstalar lojas_recalcular_kpis_cliente — VERSAO COMPLETA
-- Sessao Ailson 06/05/2026 (noite).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- HISTORICO:
-- 1. 01/05/2026: sql/lojas-media-dias-e-conversoes.sql instala versao com
--    media_dias_compras + status custom (faixas baseadas no ciclo do cliente)
-- 2. 04/05/2026: sprint Vesti adiciona Camada 1 (canal_cadastro='vesti'
--    prevalece). Versao em producao tinha as 2 coisas juntas.
-- 3. 06/05/2026 cedo: bug Vesti descoberto. Eu rodei
--    sql/fix-recalcular-kpis-canal-vesti.sql que pegou a versao "canonica"
--    do schema principal — ESSA NAO TINHA media_dias_compras. Perdeu 75
--    linhas de logica.
-- 4. 06/05/2026 noite: Ailson auditou (docs/auditoria-kpis-2026-05-06.md)
--    e quer restaurar SEM recalcular tudo (so vai funcionar pra novos
--    gatilhos: nova venda, mudanca canal_cadastro, recalcs manuais).
--
-- ESTA VERSAO:
-- ✅ Camada 1: canal_cadastro='vesti' prevalece (vesti_dominante)
-- ✅ Camada 2: canal_cadastro='convertr' prevalece (convertr_dominante)
-- ✅ Camada 3: cliente sem vendas usa canal_cadastro como fallback
-- ✅ Camada 4: regra 70% normal
-- ✅ media_dias_compras: media ponderada das ultimas 10 datas distintas
--    (filtro gap >=3d pra ignorar parcelados)
-- ✅ media_dias_confiavel: TRUE quando >=5 datas distintas (Ailson 06/05/2026:
--    relaxado de 8 pra 5 — com 8 so 1.3% dos clientes (84/6231) eram cobertos.
-- ✅ Status custom quando confiavel: limite_atencao = GREATEST(30, LEAST(90,
--    media * 0.8)) e demais limites proporcionais (1.2x sem ativ, 2x inativo,
--    4x arquivo). Fallback 45/90/180/365 quando nao confiavel.
-- ✅ Atualiza colunas media_dias_compras e media_dias_confiavel no UPSERT
--
-- DEPOIS DE RODAR:
-- - Funcao instalada certa, mas dados existentes ficam como estao
-- - Conforme cliente faz nova venda OU canal_cadastro muda, recalcula com
--   regra correta
-- - Recalc manual sob demanda: SELECT lojas_recalcular_kpis_cliente('uuid')
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
  -- Vars media ponderada
  v_media_dias numeric(6,2);
  v_media_confiavel boolean;
  v_qtd_datas_unicas int;
  v_limite_atencao int;
  v_limite_sematividade int;
  v_limite_inativo int;
  v_limite_arquivo int;
  v_fator numeric;
BEGIN
  -- ─── Agrega vendas ────────────────────────────────────────────────────
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
    COALESCE(SUM(valor_liquido) FILTER (WHERE canal_origem IN ('vesti', 'convertr')), 0),
    COUNT(*) FILTER (WHERE forma_pagamento = 'presencial'),
    COUNT(*) FILTER (WHERE forma_pagamento = 'distancia'),
    COUNT(*) FILTER (WHERE forma_pagamento = 'cheque')
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

  -- ─── Canal dominante (LOGICA EM CAMADAS Ailson 28/04/2026) ────────────
  -- 1. Cliente vesti antigo (canal_cadastro=vesti) prevalece
  -- 2. Cliente convertr antigo prevalece
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

  -- ─── Perfil presença ──────────────────────────────────────────────────
  v_perfil := CASE
    WHEN (v_qtd_pres + v_qtd_dist + v_qtd_fiel) = 0 THEN 'desconhecido'
    WHEN v_qtd_pres::float / (v_qtd_pres + v_qtd_dist + v_qtd_fiel) >= 0.7 THEN 'presencial_dominante'
    WHEN v_qtd_dist::float / (v_qtd_pres + v_qtd_dist + v_qtd_fiel) >= 0.7 THEN 'remota_dominante'
    WHEN v_qtd_fiel::float / (v_qtd_pres + v_qtd_dist + v_qtd_fiel) >= 0.7 THEN 'fiel_cheque'
    ELSE 'hibrida'
  END;

  v_paga_cheque := v_qtd_fiel > 0;

  -- ─── Tem sacola ativa? ────────────────────────────────────────────────
  SELECT EXISTS(
    SELECT 1 FROM lojas_sacola
    WHERE cliente_id = p_cliente_id AND ativo = true
  ) INTO v_tem_sacola;

  -- ─── MEDIA DIAS ENTRE COMPRAS (Ailson 01/05/2026) ─────────────────────
  -- Decisoes:
  -- (1) lojas_vendas pode ter MULTIPLAS linhas no mesmo dia (pedido
  --     parcelado, dividido por loja/canal). DISTINCT data_venda agrupa
  --     em VISITAS reais.
  -- (2) Filtra gaps < 3 dias — sao compras parceladas/mesma ida a loja
  --     que viraram registros separados.
  -- (3) Usa ultimas 10 datas distintas pra capturar tendencia atual mas
  --     evitar comportamento muito antigo.
  -- Confiavel quando >=5 datas distintas (Ailson 06/05/2026: relaxado de 8 pra 5).
  WITH datas_unicas AS (
    SELECT DISTINCT data_venda
    FROM lojas_vendas
    WHERE cliente_id = p_cliente_id
    ORDER BY data_venda DESC
    LIMIT 10
  ),
  ordenadas AS (
    SELECT data_venda,
           ROW_NUMBER() OVER (ORDER BY data_venda ASC) AS pos
    FROM datas_unicas
  ),
  gaps AS (
    SELECT
      (b.data_venda - a.data_venda)::numeric AS dias,
      a.pos AS peso
    FROM ordenadas a
    JOIN ordenadas b ON b.pos = a.pos + 1
    WHERE (b.data_venda - a.data_venda) >= 3
  )
  SELECT
    CASE WHEN SUM(peso) > 0 THEN ROUND(SUM(dias * peso) / SUM(peso), 2) ELSE NULL END
  INTO v_media_dias
  FROM gaps;

  SELECT COUNT(DISTINCT data_venda)
  INTO v_qtd_datas_unicas
  FROM lojas_vendas
  WHERE cliente_id = p_cliente_id;

  v_media_confiavel := (v_qtd_datas_unicas >= 5 AND v_media_dias IS NOT NULL);

  -- ─── STATUS COM FORMULA CUSTOM (quando media confiavel) ───────────────
  IF v_tem_sacola THEN
    v_status := 'separandoSacola';
  ELSIF v_dias_sem IS NULL THEN
    v_status := 'arquivo';
  ELSIF v_media_confiavel AND v_media_dias > 0 THEN
    -- Limite atencao = media * 0.8 com piso 30 e teto 90
    v_limite_atencao := GREATEST(30, LEAST(90, ROUND(v_media_dias * 0.8)::int));
    -- Recalcula proporcional pra demais limites
    v_fator := v_limite_atencao / 0.8;
    v_limite_sematividade := ROUND(v_fator * 1.2)::int;
    v_limite_inativo      := ROUND(v_fator * 2)::int;
    v_limite_arquivo      := ROUND(v_fator * 4)::int;

    v_status := CASE
      WHEN v_dias_sem <= v_limite_atencao      THEN 'ativo'
      WHEN v_dias_sem <= v_limite_sematividade THEN 'atencao'
      WHEN v_dias_sem <= v_limite_inativo      THEN 'semAtividade'
      WHEN v_dias_sem <= v_limite_arquivo      THEN 'inativo'
      ELSE 'arquivo'
    END;
  ELSE
    -- Fallback: faixas fixas pra cliente com <8 visitas distintas
    v_status := CASE
      WHEN v_dias_sem <= 45  THEN 'ativo'
      WHEN v_dias_sem <= 90  THEN 'atencao'
      WHEN v_dias_sem <= 180 THEN 'semAtividade'
      WHEN v_dias_sem <= 365 THEN 'inativo'
      ELSE 'arquivo'
    END;
  END IF;

  -- ─── Fase ciclo de vida ───────────────────────────────────────────────
  v_dias_desde_1a := CASE WHEN v_primeira IS NULL THEN NULL
                          ELSE (CURRENT_DATE - v_primeira)::int END;
  v_fase := CASE
    WHEN v_dias_desde_1a IS NULL THEN 'sem_compras_ainda'
    WHEN v_dias_desde_1a <= 14   THEN 'nova_aguardando'
    WHEN v_dias_desde_1a = 15    THEN 'nova_checkin_pronto'
    WHEN v_dias_desde_1a <= 30   THEN 'nova_em_analise'
    ELSE 'normal'
  END;

  -- ─── Upsert ───────────────────────────────────────────────────────────
  INSERT INTO lojas_clientes_kpis (
    cliente_id, qtd_compras, qtd_pecas, lifetime_total, ticket_medio,
    primeira_compra, ultima_compra, dias_sem_comprar,
    qtd_compras_fisicas, qtd_compras_vesti, qtd_compras_convertr,
    lifetime_fisico, lifetime_marketplace, canal_dominante,
    perfil_presenca, pct_compras_presenciais, paga_com_cheque,
    fase_ciclo_vida, status_atual,
    media_dias_compras, media_dias_confiavel,
    ultima_atualizacao
  ) VALUES (
    p_cliente_id, v_qtd_compras, v_qtd_pecas, v_lifetime, v_ticket,
    v_primeira, v_ultima, v_dias_sem,
    v_qtd_fisicas, v_qtd_vesti, v_qtd_convertr,
    v_lifetime_fisico, v_lifetime_marketplace, v_canal_dominante,
    v_perfil,
    CASE WHEN v_qtd_compras > 0 THEN v_qtd_pres::numeric * 100 / v_qtd_compras ELSE 0 END,
    v_paga_cheque,
    v_fase, v_status,
    v_media_dias, v_media_confiavel,
    now()
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
    media_dias_compras = EXCLUDED.media_dias_compras,
    media_dias_confiavel = EXCLUDED.media_dias_confiavel,
    ultima_atualizacao = now();
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- VALIDACAO (rode 1 cliente pra testar antes de tudo)
-- ═══════════════════════════════════════════════════════════════════════════
-- Pega 1 cliente com >=8 visitas pra validar fluxo completo:
-- SELECT c.id, c.nome, k.qtd_compras, k.media_dias_compras, k.media_dias_confiavel,
--        k.dias_sem_comprar, k.status_atual
-- FROM lojas_clientes c
-- JOIN lojas_clientes_kpis k ON k.cliente_id = c.id
-- WHERE k.qtd_compras >= 8
-- LIMIT 5;
--
-- Roda recalc no primeiro:
-- SELECT lojas_recalcular_kpis_cliente('<UUID>');
--
-- Confere se media_dias_compras passou a ter valor:
-- SELECT media_dias_compras, media_dias_confiavel, status_atual
-- FROM lojas_clientes_kpis WHERE cliente_id = '<UUID>';
