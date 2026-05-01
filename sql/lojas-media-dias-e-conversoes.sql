-- ═══════════════════════════════════════════════════════════════════════════
-- MEDIA DIAS ENTRE COMPRAS + ARQUIVO DE CONVERSÕES
-- Sessão Ailson 01/05/2026
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Adiciona coluna media_dias_compras em kpis
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE lojas_clientes_kpis
  ADD COLUMN IF NOT EXISTS media_dias_compras numeric(6,2);

-- Coluna auxiliar pra saber se a média é "confiável" (>= 5 compras)
ALTER TABLE lojas_clientes_kpis
  ADD COLUMN IF NOT EXISTS media_dias_confiavel boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_kpis_media_dias
  ON lojas_clientes_kpis(media_dias_compras);

COMMENT ON COLUMN lojas_clientes_kpis.media_dias_compras IS
  'Média ponderada de dias entre compras (últimas 5 compras, recentes pesam mais). '
  'Usada pra calcular status custom: cliente trimestral (média 90d) só entra em '
  'atenção em 72d (90 × 0.8), não em 45d. Recalculada no cron de KPIs.';

COMMENT ON COLUMN lojas_clientes_kpis.media_dias_confiavel IS
  'TRUE quando cliente tem >=5 compras. Quando FALSE, usa faixas default '
  '(45/90/180/365) sem aplicar fórmula custom.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Tabela de arquivo de conversões (histórico permanente)
-- ───────────────────────────────────────────────────────────────────────────
-- Conversão = mensagem enviada pra cliente status atencao/semAtividade/inativo
-- e cliente comprou da MESMA vendedora em até 15 dias depois.
-- Cron diário de KPIs grava aqui pra preservar histórico mesmo se mensagem
-- ou venda forem deletadas/arquivadas depois.
CREATE TABLE IF NOT EXISTS lojas_conversoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedora_id      uuid NOT NULL REFERENCES lojas_vendedoras(id) ON DELETE CASCADE,
  cliente_id        uuid NOT NULL REFERENCES lojas_clientes(id)   ON DELETE CASCADE,
  -- Mensagem original (pode ter sido arquivada — guardamos snapshot)
  mensagem_id       uuid,                  -- referencia a lojas_acoes (sem FK pra preservar)
  data_mensagem     date NOT NULL,
  status_no_envio   text NOT NULL CHECK (status_no_envio IN ('atencao','semAtividade','inativo')),
  -- Venda que converteu
  venda_id          uuid,                  -- referencia a lojas_vendas
  data_venda        date NOT NULL,
  dias_ate_compra   int NOT NULL CHECK (dias_ate_compra >= 0 AND dias_ate_compra <= 15),
  valor_venda       numeric(12,2),
  -- Snapshot do cliente (pra historico estavel)
  cliente_nome      text,
  -- Auditoria
  registrado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversoes_vendedora_data
  ON lojas_conversoes(vendedora_id, data_venda DESC);
CREATE INDEX IF NOT EXISTS idx_conversoes_cliente
  ON lojas_conversoes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_conversoes_mensagem
  ON lojas_conversoes(mensagem_id);
-- Evita duplicar mesma conversão (mensagem→venda) se cron rodar várias vezes
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversoes_msg_venda
  ON lojas_conversoes(mensagem_id, venda_id)
  WHERE mensagem_id IS NOT NULL AND venda_id IS NOT NULL;

ALTER TABLE lojas_conversoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_conversoes_select" ON lojas_conversoes;
DROP POLICY IF EXISTS "lojas_conversoes_modify" ON lojas_conversoes;
CREATE POLICY "lojas_conversoes_select" ON lojas_conversoes FOR SELECT USING (true);
CREATE POLICY "lojas_conversoes_modify" ON lojas_conversoes FOR ALL    USING (true) WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. View consolidada de conversões por vendedora x período
-- ───────────────────────────────────────────────────────────────────────────
-- Usada pelo dashboard pra mostrar card "Conversões" com filtros de período.
-- Frontend filtra por vendedora_id + data_venda.
CREATE OR REPLACE VIEW vw_lojas_conversoes_dashboard AS
SELECT
  vendedora_id,
  data_venda,
  status_no_envio,
  dias_ate_compra,
  valor_venda,
  cliente_id,
  cliente_nome
FROM lojas_conversoes
ORDER BY data_venda DESC;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Reescreve lojas_recalcular_kpis_cliente pra calcular media_dias_compras
--    e usar status custom quando tem >=5 compras
-- ───────────────────────────────────────────────────────────────────────────
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
  -- Novas vars pra média ponderada
  v_media_dias numeric(6,2);
  v_media_confiavel boolean;
  v_limite_atencao int;
  v_limite_sematividade int;
  v_limite_inativo int;
  v_limite_arquivo int;
  v_fator numeric;
  v_qtd_datas_unicas int;
BEGIN
  -- Agrega vendas
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

  -- Canal dominante
  v_canal_dominante := CASE
    WHEN v_qtd_compras = 0 THEN NULL
    WHEN v_qtd_fisicas >= GREATEST(v_qtd_vesti, v_qtd_convertr) THEN 'fisico'
    WHEN v_qtd_vesti >= v_qtd_convertr                          THEN 'vesti_dominante'
    ELSE 'convertr_dominante'
  END;

  -- Perfil presença
  v_perfil := CASE
    WHEN v_qtd_compras = 0                                      THEN 'desconhecido'
    WHEN v_qtd_pres::numeric / v_qtd_compras >= 0.8             THEN 'presencial'
    WHEN v_qtd_pres::numeric / v_qtd_compras <= 0.2 AND v_qtd_dist > 0 THEN 'remota'
    WHEN v_qtd_fiel >= v_qtd_compras / 2                        THEN 'fiel_cheque'
    ELSE 'hibrida'
  END;

  v_paga_cheque := v_qtd_fiel > 0;

  SELECT EXISTS (
    SELECT 1 FROM lojas_pedidos_sacola
    WHERE cliente_id = p_cliente_id AND ativo = true
  ) INTO v_tem_sacola;

  -- ═══ MÉDIA PONDERADA DOS DIAS ENTRE COMPRAS ═══════════════════════════════
  -- IMPORTANTE: lojas_vendas pode ter MULTIPLAS linhas no mesmo dia
  -- (pedido parcelado, divididos por loja/canal, etc). Pra contar VISITAS
  -- reais, agrupamos por data_venda primeiro (DISTINCT data).
  -- Usa as ultimas 5 DATAS distintas. Pesos crescentes pras mais recentes.
  -- Confiavel quando >=5 datas distintas (= 5 visitas reais).
  WITH datas_unicas AS (
    SELECT DISTINCT data_venda
    FROM lojas_vendas
    WHERE cliente_id = p_cliente_id
    ORDER BY data_venda DESC
    LIMIT 5
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
    WHERE (b.data_venda - a.data_venda) > 0
  )
  SELECT
    CASE WHEN SUM(peso) > 0 THEN ROUND(SUM(dias * peso) / SUM(peso), 2) ELSE NULL END
  INTO v_media_dias
  FROM gaps;

  -- Quantidade de DATAS DISTINTAS, nao linhas. Cliente confiavel = >=5
  -- visitas reais E media calculada com sucesso.
  SELECT COUNT(DISTINCT data_venda)
  INTO v_qtd_datas_unicas
  FROM lojas_vendas
  WHERE cliente_id = p_cliente_id;

  v_media_confiavel := (v_qtd_datas_unicas >= 5 AND v_media_dias IS NOT NULL);

  -- ═══ STATUS COM FÓRMULA CUSTOM (quando média confiável) ═══════════════════
  IF v_tem_sacola THEN
    v_status := 'separandoSacola';
  ELSIF v_dias_sem IS NULL THEN
    v_status := 'arquivo';
  ELSIF v_media_confiavel AND v_media_dias > 0 THEN
    -- Limite atenção = média × 0.8 com piso 30 e teto 90
    v_limite_atencao := GREATEST(30, LEAST(90, ROUND(v_media_dias * 0.8)::int));
    -- Recalcula proporcional pra demais limites (mantém razão)
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
    -- Default: faixas fixas
    v_status := CASE
      WHEN v_dias_sem <= 45  THEN 'ativo'
      WHEN v_dias_sem <= 90  THEN 'atencao'
      WHEN v_dias_sem <= 180 THEN 'semAtividade'
      WHEN v_dias_sem <= 365 THEN 'inativo'
      ELSE 'arquivo'
    END;
  END IF;

  -- Fase ciclo de vida
  v_dias_desde_1a := CASE WHEN v_primeira IS NULL THEN NULL
                          ELSE (CURRENT_DATE - v_primeira)::int END;
  v_fase := CASE
    WHEN v_dias_desde_1a IS NULL THEN 'sem_compras_ainda'
    WHEN v_dias_desde_1a <= 14   THEN 'nova_aguardando'
    WHEN v_dias_desde_1a = 15    THEN 'nova_checkin_pronto'
    WHEN v_dias_desde_1a <= 30   THEN 'nova_em_analise'
    ELSE 'normal'
  END;

  -- Upsert
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

-- Rodar UMA VEZ pra recalcular todos os clientes com a nova fórmula:
--   SELECT lojas_recalcular_kpis_todos();
-- (já existente — não precisa alterar)


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Atualizar CHECK de lojas_sugestoes_diarias.tipo
-- ───────────────────────────────────────────────────────────────────────────
-- Adiciona 'inativo' e 'semAtividade' (nova distribuição). Mantém 'reativar'
-- por compatibilidade com sugestões antigas no histórico.
ALTER TABLE lojas_sugestoes_diarias DROP CONSTRAINT IF EXISTS lojas_sugestoes_diarias_tipo_check;
ALTER TABLE lojas_sugestoes_diarias ADD CONSTRAINT lojas_sugestoes_diarias_tipo_check
  CHECK (tipo IN (
    'reativar','atencao','novidade','followup','followup_nova','sacola',
    'reposicao','aviso_admin','inativo','semAtividade'
  ));
