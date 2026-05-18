-- ═══════════════════════════════════════════════════════════════════════════
-- FEEDBACK DIÁRIO DA VENDEDORA + APRENDIZADO IA EM CLIENTES ATIVOS
-- Sessão Ailson 18/05/2026 — Sprint A "Modal Fechamento + Sinais Passivos"
--
-- Objetivo:
--   1) Capturar feedback estruturado da vendedora ao fechar o dia
--      (3 perguntas progressivas sobre 1 cliente: ESTADO → PERCEPÇÃO → AÇÃO)
--   2) Capturar TODAS as vendas em D+1 a D+5 após qualquer sugestão (não só
--      conversões oficiais) pra IA aprender padrão "venda aconteceu depois
--      de X evento", incluindo clientes ATIVOS que hoje são invisíveis.
--   3) Avisar vendedora quando sua cliente comprou no site sem msg (organica)
--      pra ela anotar comissão — clima comemorativo (usa lojas_avisos existente).
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. lojas_feedback_diario — respostas do modal de fechamento
-- ───────────────────────────────────────────────────────────────────────────
-- Uma linha por (vendedora, cliente, dia). Captura até 3 respostas
-- progressivas. Q3 pode ser NULL se early-exit por 2 negativas ou abandono.
--
-- Negativas:
--   Q1: 'sem_resposta', 'ignorou'         (cliente não engajou)
--   Q2: 'dificil', 'ja_era'          (vendedora vê como caso difícil/morto)
-- Se Q1 e Q2 ambas negativas → modal pula Q3 (motivo_encerramento='2_negativas').
CREATE TABLE IF NOT EXISTS lojas_feedback_diario (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedora_id          uuid NOT NULL REFERENCES lojas_vendedoras(id) ON DELETE CASCADE,
  cliente_id            uuid NOT NULL REFERENCES lojas_clientes(id)   ON DELETE CASCADE,
  -- Sugestão original (sem FK pra preservar histórico se arquivada)
  sugestao_id           uuid,
  data_sugestao         date NOT NULL,
  data_pergunta         date NOT NULL,
  -- Critério usado pra escolher esse cliente (auditoria do algoritmo)
  prioridade_origem     text NOT NULL CHECK (prioridade_origem IN (
    'atencao_6plus','atencao_3plus','editou_muito','cliente_novo','aleatorio'
  )),
  -- Respostas (Q1 sempre preenchida; Q2 e Q3 podem ser NULL)
  resposta_q1           text CHECK (resposta_q1 IN (
    'respondeu','sem_resposta','ignorou','vou_insistir'
  )),
  resposta_q2           text CHECK (resposta_q2 IN (
    'com_certeza','talvez','dificil','ja_era'
  )),
  resposta_q3           text CHECK (resposta_q3 IN (
    'mandar_outra','esperar','outro_canal','deixar_quieta'
  )),
  -- Auditoria de templates (pra A/B futuro e variação)
  template_intro        text NOT NULL,   -- ex: 'template_a','template_b'...
  template_q3_close     text,            -- ex: 'close_promessa_ia','close_juro_juradinho'
  -- Estado final
  motivo_encerramento   text CHECK (motivo_encerramento IN (
    'completo','2_negativas','abandonou'
  )),
  iniciado_em           timestamptz NOT NULL DEFAULT now(),
  finalizado_em         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- 1 cliente por vendedora por dia (anti-duplicata)
CREATE UNIQUE INDEX IF NOT EXISTS uq_feedback_vend_cli_dia
  ON lojas_feedback_diario(vendedora_id, cliente_id, data_pergunta);

CREATE INDEX IF NOT EXISTS idx_feedback_vendedora_data
  ON lojas_feedback_diario(vendedora_id, data_pergunta DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_sugestao
  ON lojas_feedback_diario(sugestao_id) WHERE sugestao_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_feedback_cliente_recente
  ON lojas_feedback_diario(cliente_id, data_pergunta DESC);

COMMENT ON TABLE lojas_feedback_diario IS
  'Respostas do modal de fechamento do dia (3 perguntas progressivas sobre 1 cliente). '
  'Disparado quando vendedora abre a 7ª sugestão do dia. Sample-based: 1 cliente/vendedora/dia. '
  'Anti-fadiga: mesmo cliente não pode ser perguntado 2x em 21 dias.';

COMMENT ON COLUMN lojas_feedback_diario.prioridade_origem IS
  'Critério usado pelo algoritmo de seleção. Ordem decrescente: atencao_6plus > '
  'atencao_3plus > editou_muito > cliente_novo > aleatorio.';

COMMENT ON COLUMN lojas_feedback_diario.resposta_q1 IS
  'ESTADO: "Como foi com cliente?" — respondeu/sem_resposta/ignorou/vou_insistir. '
  'Negativas: sem_resposta, ignorou.';

COMMENT ON COLUMN lojas_feedback_diario.resposta_q2 IS
  'PERCEPÇÃO: "Tu acha que ela ainda compra?" — com_certeza/talvez/dificil/ja_era. '
  'Negativas: dificil, ja_era.';

COMMENT ON COLUMN lojas_feedback_diario.resposta_q3 IS
  'AÇÃO: "E o teu plano?" — mandar_outra/esperar/outro_canal/deixar_quieta. '
  'NULL se early-exit (Q1+Q2 negativas) ou abandono.';

ALTER TABLE lojas_feedback_diario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_feedback_diario_select" ON lojas_feedback_diario;
DROP POLICY IF EXISTS "lojas_feedback_diario_modify" ON lojas_feedback_diario;
CREATE POLICY "lojas_feedback_diario_select" ON lojas_feedback_diario FOR SELECT USING (true);
CREATE POLICY "lojas_feedback_diario_modify" ON lojas_feedback_diario FOR ALL    USING (true) WITH CHECK (true);


-- ───────────────────────────────────────────────────────────────────────────
-- 2. lojas_aprendizado_vendas — vendas D+1 a D+5 pós sugestão (todos status)
-- ───────────────────────────────────────────────────────────────────────────
-- Diferenças vs lojas_conversoes:
--   • Captura TODOS os status no envio (ativo incluído) — conversoes só atenção+
--   • Janela CURTA 1-5 dias — conversoes é 0-15 dias
--   • Inclui match de produto (ref_sugerida × refs_compradas) — novo sinal
--   • Tabela de aprendizado, NÃO mexe na métrica de conversão do dashboard
--
-- Sobreposição: cliente atenção que comprou em D+3 entra nas duas tabelas.
-- Conversoes = métrica do negócio. Aprendizado = combustível pra IA.
CREATE TABLE IF NOT EXISTS lojas_aprendizado_vendas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedora_id      uuid NOT NULL REFERENCES lojas_vendedoras(id) ON DELETE CASCADE,
  cliente_id        uuid NOT NULL REFERENCES lojas_clientes(id)   ON DELETE CASCADE,
  -- Sugestão original (sem FK)
  sugestao_id       uuid,
  data_sugestao     date NOT NULL,
  -- Venda
  venda_id          uuid,                  -- referencia a lojas_vendas
  data_venda        date NOT NULL,
  dias_ate_compra   int NOT NULL CHECK (dias_ate_compra BETWEEN 1 AND 5),
  valor_venda       numeric(12,2),
  -- Status do cliente NA HORA do envio (importante: pode ter mudado depois)
  status_no_envio   text NOT NULL CHECK (status_no_envio IN (
    'ativo','atencao','semAtividade','inativo'
  )),
  -- Match de produto
  ref_sugerida      text,                  -- ref que IA destacou na msg (pode ser NULL)
  refs_compradas    text[],                -- todas refs do pedido
  produto_match     text CHECK (produto_match IN (
    'total','parcial','nenhum','sem_ref'
  )),
  -- Snapshot
  cliente_nome      text,
  registrado_em     timestamptz NOT NULL DEFAULT now()
);

-- Evita duplicar mesma sugestão→venda se cron rodar várias vezes
CREATE UNIQUE INDEX IF NOT EXISTS uq_aprendizado_sug_venda
  ON lojas_aprendizado_vendas(sugestao_id, venda_id)
  WHERE sugestao_id IS NOT NULL AND venda_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_aprendizado_vendedora_data
  ON lojas_aprendizado_vendas(vendedora_id, data_venda DESC);

CREATE INDEX IF NOT EXISTS idx_aprendizado_cliente
  ON lojas_aprendizado_vendas(cliente_id);

CREATE INDEX IF NOT EXISTS idx_aprendizado_status
  ON lojas_aprendizado_vendas(status_no_envio);

COMMENT ON TABLE lojas_aprendizado_vendas IS
  'Vendas D+1 a D+5 após qualquer sugestão (todos status incluindo ativo). '
  'Janela curta força causalidade. Inclui match de produto (ref sugerida × '
  'refs compradas). NÃO substitui lojas_conversoes — é tabela complementar '
  'pra IA aprender padrões sem afetar métricas de conversão.';

COMMENT ON COLUMN lojas_aprendizado_vendas.produto_match IS
  'total = todas refs sugeridas estão no pedido. parcial = pelo menos 1. '
  'nenhum = sugeriu refs mas comprou outras. sem_ref = msg não citou ref '
  'específica (saudação genérica).';

COMMENT ON COLUMN lojas_aprendizado_vendas.dias_ate_compra IS
  'Janela 1-5 dias (não 0): D+0 confunde com walk-in da loja. '
  'D+5 limite força causalidade — vendas após isso podem ser ruído.';

ALTER TABLE lojas_aprendizado_vendas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lojas_aprendizado_vendas_select" ON lojas_aprendizado_vendas;
DROP POLICY IF EXISTS "lojas_aprendizado_vendas_modify" ON lojas_aprendizado_vendas;
CREATE POLICY "lojas_aprendizado_vendas_select" ON lojas_aprendizado_vendas FOR SELECT USING (true);
CREATE POLICY "lojas_aprendizado_vendas_modify" ON lojas_aprendizado_vendas FOR ALL    USING (true) WITH CHECK (true);


-- ───────────────────────────────────────────────────────────────────────────
-- 3. View pra admin: status do feedback por sugestão (badge nas 7 cards)
-- ───────────────────────────────────────────────────────────────────────────
-- Usada no admin pra mostrar badge em cada uma das 7 sugestões do dia.
-- Retorna: completo / parcial_2 / parcial_1 / early_exit / abandonou / nao_perguntada
CREATE OR REPLACE VIEW vw_lojas_feedback_status_sugestao AS
SELECT
  f.sugestao_id,
  f.vendedora_id,
  f.cliente_id,
  f.data_pergunta,
  f.prioridade_origem,
  f.motivo_encerramento,
  f.resposta_q1,
  f.resposta_q2,
  f.resposta_q3,
  f.iniciado_em,
  f.finalizado_em,
  CASE
    WHEN f.motivo_encerramento = 'completo'         AND f.resposta_q3 IS NOT NULL THEN 'completo'
    WHEN f.motivo_encerramento = '2_negativas'                                    THEN 'early_exit'
    WHEN f.motivo_encerramento = 'abandonou'        AND f.resposta_q2 IS NOT NULL THEN 'parcial_2'
    WHEN f.motivo_encerramento = 'abandonou'        AND f.resposta_q1 IS NOT NULL THEN 'parcial_1'
    WHEN f.resposta_q1 IS NOT NULL AND f.resposta_q2 IS NULL                      THEN 'aguardando'
    ELSE 'desconhecido'
  END AS status_badge
FROM lojas_feedback_diario f;

COMMENT ON VIEW vw_lojas_feedback_status_sugestao IS
  'Status do feedback por sugestão pra renderizar badge no admin. '
  'completo=verde, early_exit=cinza (consciente), parcial_*=laranja, '
  'abandonou=amarelo. Sugestões sem registro nessa view = não foi sorteada '
  'pra perguntar nesse dia.';


-- ───────────────────────────────────────────────────────────────────────────
-- 4. Avisos de venda site orgânica (NÃO cria tabela nova — usa lojas_avisos)
-- ───────────────────────────────────────────────────────────────────────────
-- Cron lojas-leads-conversoes-cron já detecta caso 'organica' (compra no site
-- sem msg). Vamos estender pra: se cliente tem vendedora_responsavel (via
-- absorção forte ou última compra), criar aviso com texto comemorativo.
--
-- Não precisa de schema change. Usaremos prefixo no texto pra identificar:
--   "[VENDA_SITE_ORGANICA] 🎉 Cleide..."
-- Frontend renderiza diferente (cor festiva, ícone troféu) quando detecta prefixo.
--
-- Idempotência: o cron deve checar se já existe aviso pendente/consumido
-- pra mesma (vendedora_id, cliente_id, data_disparo=data_venda+1d).


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Helper: clientes elegíveis pro modal de fechamento (algoritmo seleção)
-- ───────────────────────────────────────────────────────────────────────────
-- Retorna até N candidatos ordenados por prioridade, JÁ filtrados de
-- exclusões. Frontend/backend pega o TOP 1.
--
-- Filtros aplicados:
--   ✓ Sugestão de D-1 (ou D mais recente onde vendedora completou 7)
--   ✓ Vendedora clicou em "Enviar WhatsApp" (lojas_acoes.tipo_acao='mensagem_enviada')
--   ✓ Sugestão enviada antes das 20h (deu tempo de saber resultado)
--   ✗ EXCLUI cliente em trilha_winback ativa
--   ✗ EXCLUI cliente que já comprou em D+0 a D+1 (IA já sabe)
--   ✗ EXCLUI cliente perguntado nos últimos 21 dias
CREATE OR REPLACE FUNCTION lojas_feedback_candidatos(
  p_vendedora_id uuid,
  p_data_pergunta date DEFAULT CURRENT_DATE,
  p_limit int DEFAULT 5
)
RETURNS TABLE (
  cliente_id        uuid,
  cliente_nome      text,
  sugestao_id       uuid,
  data_sugestao     date,
  prioridade_origem text,
  prioridade_rank   int
)
LANGUAGE sql
STABLE
AS $$
WITH
-- D-1: dia anterior ao dia da pergunta (sugestão foi feita ontem)
parametros AS (
  SELECT
    p_vendedora_id  AS vendedora_id,
    p_data_pergunta AS data_pergunta,
    (p_data_pergunta - INTERVAL '1 day')::date AS data_sugestao_alvo,
    (p_data_pergunta - INTERVAL '21 days')::date AS limite_anti_repeticao
),
-- Sugestões da vendedora em D-1 que ela ENVIOU antes das 20h
candidatos_base AS (
  SELECT
    s.id            AS sugestao_id,
    s.cliente_id,
    s.data_geracao
  FROM lojas_sugestoes_diarias s
  CROSS JOIN parametros p
  WHERE s.vendedora_id = p.vendedora_id
    AND s.data_geracao = p.data_sugestao_alvo
    AND s.alvo_tipo    = 'cliente'      -- ignora grupos
    AND s.cliente_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM lojas_acoes a
      WHERE a.sugestao_id = s.id
        AND a.tipo_acao = 'mensagem_enviada'
        AND a.created_at::time < TIME '20:00:00'
    )
),
-- Filtra excluídos
candidatos_filtrados AS (
  SELECT c.*
  FROM candidatos_base c
  CROSS JOIN parametros p
  WHERE NOT EXISTS (
    -- Já perguntado nos últimos 21 dias (qualquer vendedora)
    SELECT 1 FROM lojas_feedback_diario f
    WHERE f.cliente_id = c.cliente_id
      AND f.data_pergunta >= p.limite_anti_repeticao
  )
  AND NOT EXISTS (
    -- Cliente em trilha winback ativa (view já filtra status='ativa')
    SELECT 1 FROM vw_lojas_trilhas_winback_ativas t
    WHERE t.cliente_id = c.cliente_id
  )
  AND NOT EXISTS (
    -- Cliente já comprou em D+0 ou D+1 (IA já sabe que converteu)
    SELECT 1 FROM lojas_vendas v
    WHERE v.cliente_id = c.cliente_id
      AND v.data_venda >= c.data_geracao
      AND v.data_venda <= (c.data_geracao + INTERVAL '1 day')::date
  )
),
-- KPIs do cliente pra calcular prioridade (status_atual, qtd_edits)
candidatos_com_kpi AS (
  SELECT
    cf.*,
    cli.apelido       AS cliente_nome,
    kpi.status_atual,
    kpi.dias_sem_comprar,
    kpi.media_dias_compras,
    -- Quantas vezes vendedora editou essa sugestão
    (SELECT COUNT(*) FROM lojas_edicoes_mensagens e WHERE e.sugestao_id = cf.sugestao_id) AS qtd_edits,
    -- Cliente novo: <= 1 compra histórica
    COALESCE(kpi.qtd_compras, 0) AS qtd_compras
  FROM candidatos_filtrados cf
  JOIN lojas_clientes cli ON cli.id = cf.cliente_id
  LEFT JOIN lojas_clientes_kpis kpi ON kpi.cliente_id = cf.cliente_id
)
-- Classifica por prioridade
SELECT
  cliente_id,
  cliente_nome,
  sugestao_id,
  data_geracao AS data_sugestao,
  CASE
    WHEN status_atual IN ('semAtividade','inativo')
      OR (media_dias_compras IS NOT NULL AND dias_sem_comprar >= media_dias_compras * 6)
                                              THEN 'atencao_6plus'
    WHEN status_atual = 'atencao'
      OR (media_dias_compras IS NOT NULL AND dias_sem_comprar >= media_dias_compras * 3)
                                              THEN 'atencao_3plus'
    WHEN qtd_edits >= 3                       THEN 'editou_muito'
    WHEN qtd_compras <= 1                     THEN 'cliente_novo'
    ELSE                                           'aleatorio'
  END AS prioridade_origem,
  CASE
    WHEN status_atual IN ('semAtividade','inativo')
      OR (media_dias_compras IS NOT NULL AND dias_sem_comprar >= media_dias_compras * 6)
                                              THEN 1
    WHEN status_atual = 'atencao'
      OR (media_dias_compras IS NOT NULL AND dias_sem_comprar >= media_dias_compras * 3)
                                              THEN 2
    WHEN qtd_edits >= 3                       THEN 3
    WHEN qtd_compras <= 1                     THEN 4
    ELSE                                           5
  END AS prioridade_rank
FROM candidatos_com_kpi
ORDER BY prioridade_rank ASC, qtd_edits DESC, dias_sem_comprar DESC NULLS LAST
LIMIT p_limit;
$$;

COMMENT ON FUNCTION lojas_feedback_candidatos IS
  'Retorna candidatos elegíveis pro modal de fechamento, já ordenados por '
  'prioridade. Backend pega o TOP 1. Filtros: clicou em enviar, antes 20h, '
  '21d anti-repetição, sem trilha winback ativa, não comprou em D+0/D+1.';


-- ═══════════════════════════════════════════════════════════════════════════
-- FIM — Sprint A: Feedback + Aprendizado
-- Próximos: cron de aprendizado D+1..D+5, endpoint selecionar/registrar,
--           componente modal, badges no admin.
-- ═══════════════════════════════════════════════════════════════════════════
