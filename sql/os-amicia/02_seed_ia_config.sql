-- =====================================================================
-- OS Amícia · Fase 1 · Seed ia_config (valores iniciais)
-- Versão: 1.0 · Data: 21/04/2026
-- =====================================================================
--
-- RODAR DEPOIS de 01_tables.sql.
--
-- Este arquivo popula ia_config com os valores iniciais das decisões
-- travadas no Prompt Mestre. Admin pode alterar qualquer um sem deploy.
--
-- IDEMPOTENTE: usa ON CONFLICT DO NOTHING.
-- Se quiser FORÇAR novos valores sobre os existentes, troque por
-- ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor.
-- =====================================================================


-- Cron
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('cron_horarios_brt', '["07:00","14:00"]'::jsonb, 'Horários do cron (BRT). Alterável sem deploy.', 'array')
ON CONFLICT (chave) DO NOTHING;


-- Lead time e cobertura
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('lead_time_dias', '22'::jsonb, 'Lead time padrão (oficinas só têm data de saída)', 'number'),
  ('cobertura_alvo_dias', '28'::jsonb, 'Cobertura após corte (22 lead + 6 folga) — reduzida de 35', 'number'),
  ('cobertura_critica_dias', '10'::jsonb, 'Abaixo disso = crítico', 'number'),
  ('cobertura_saudavel_min_dias', '22'::jsonb, 'Limite inferior do saudável', 'number'),
  ('cobertura_saudavel_max_dias', '45'::jsonb, 'Limite superior do saudável', 'number'),
  ('cobertura_excesso_dias', '45'::jsonb, 'Acima disso = excesso (considerar promoção, não cortar)', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Gatekeeper de demanda
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('gatekeeper_vendas_ativa_15d', '6'::jsonb, 'Vendas nos últimos 15d pra variação entrar como ATIVA', 'number'),
  ('gatekeeper_vendas_fraca_min_15d', '1'::jsonb, 'Mínimo pra FRACA (1-5 vendas)', 'number'),
  ('gatekeeper_vendas_fraca_max_15d', '5'::jsonb, 'Máximo pra FRACA', 'number'),
  ('ruptura_disfarcada_min_mes_ant', '12'::jsonb, 'Vendas no mês anterior pra detectar ruptura disfarçada', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Devolução
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('devolucao_global_pct', '10'::jsonb, 'Desconto global de devolução (Full ML não reporta real)', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Grade
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('grade_max_modulos_peca_grande', '6'::jsonb, 'Máximo de módulos pra peça grande (vestido, macacão)', 'number'),
  ('grade_max_modulos_peca_pequena', '8'::jsonb, 'Máximo de módulos pra peça pequena/média', 'number'),
  ('grade_palavras_peca_grande', '["vestido","macacão","macacao"]'::jsonb, 'Palavras-chave que classificam como peça grande', 'array')
ON CONFLICT (chave) DO NOTHING;


-- Capacidade semanal (semáforo)
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('capacidade_cortes_normal_max', '15'::jsonb, 'Até N cortes = 🟢 Normal', 'number'),
  ('capacidade_cortes_corrida_max', '20'::jsonb, 'Até N cortes = 🟡 Corrida (acima disso = 🔴 Excesso)', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Curvas A e B
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('curva_a_min_pecas', '300'::jsonb, 'Curva A: piso de peças estimadas', 'number'),
  ('curva_a_teto_pecas', '750'::jsonb, 'Curva A: teto', 'number'),
  ('curva_b_min_pecas', '200'::jsonb, 'Curva B: piso', 'number'),
  ('curva_b_teto_pecas', '450'::jsonb, 'Curva B: teto', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Distribuição de cores
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('rolos_min_por_cor', '3'::jsonb, 'Mínimo de rolos por cor (exceção: balanceamento 2)', 'number'),
  ('tendencia_cor_alta_pct', '30'::jsonb, 'Aumento mínimo pra cor em alta (%)', 'number'),
  ('tendencia_cor_alta_min_modelos', '5'::jsonb, 'Quantos modelos precisam ter essa alta', 'number'),
  ('tendencia_cor_queda_pct', '30'::jsonb, 'Queda mínima pra alerta (%)', 'number'),
  ('tendencia_cor_queda_min_modelos', '3'::jsonb, 'Quantos modelos precisam ter queda (mais sensível que alta)', 'number'),
  ('multiplicador_cor_alta', '1.2'::jsonb, 'Multiplicador de rolos pra cor em alta', 'number'),
  ('multiplicador_cor_estavel', '1.0'::jsonb, 'Multiplicador pra cor estável', 'number'),
  ('multiplicador_cor_queda', '0.8'::jsonb, 'Multiplicador pra cor em queda', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Pisos de margem
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('margem_piso_urgencia', '0'::jsonb, 'Abaixo de R$0 = urgência máxima', 'number'),
  ('margem_piso_critico', '8'::jsonb, 'Abaixo de R$8 = crítico (nunca furar)', 'number'),
  ('margem_piso_atencao', '10'::jsonb, 'R$10 = atenção passa pra bom', 'number'),
  ('margem_piso_otimo', '14'::jsonb, 'R$14+ = ótimo', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Regras de ajuste de preço
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('ajuste_preco_dias_entre_aumentos', '30'::jsonb, 'Dias mínimos entre aumentos consecutivos', 'number'),
  ('reducao_preco_cobertura_min_dias', '60'::jsonb, 'Cobertura mínima pra redução ser permitida', 'number'),
  ('regra_dura_ml_79', '79'::jsonb, 'Limite duro ML (frete grátis acima) — cuidado com zona proibida', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Rendimento Sala de Corte (decisão do Ailson 21/04)
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('rendimento_n1_min_cortes_ref', '1'::jsonb, 'Piso de cortes históricos da ref pra N1 (confiança alta)', 'number'),
  ('rendimento_n2_min_cortes_categoria', '2'::jsonb, 'Piso pra fallback N2 (média da categoria)', 'number'),
  ('rendimento_categorias_chaves', '["vestido","macacão","macacao","calça","calca","bermuda","shorts","short","saia","blusa","top","cropped","regata","camisa","conjunto","jaqueta","casaco","blazer"]'::jsonb, 'Palavras-chave pra categorizar por título (ordem importa — primeiro match vence)', 'array'),
  ('rendimento_pecas_por_rolo_default', '20'::jsonb, 'Fallback final se nem N1 nem N2 disponíveis (uso em preview apenas)', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Pergunta livre
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('pergunta_livre_max_dia', '5'::jsonb, 'Limite global de perguntas livres por dia (soma de todos)', 'number'),
  ('pergunta_livre_min_chars', '10'::jsonb, 'Tamanho mínimo da pergunta', 'number'),
  ('pergunta_livre_max_chars', '500'::jsonb, 'Tamanho máximo da pergunta', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Orçamento Anthropic
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('orcamento_brl_mensal', '80'::jsonb, 'Limite rígido de custo Anthropic por mês (BRL)', 'number'),
  ('orcamento_brl_alerta_pct', '75'::jsonb, '% do orçamento pra disparar alerta no painel admin', 'number'),
  ('taxa_usd_brl', '5.25'::jsonb, 'Taxa de conversão USD→BRL pra cálculo de custo (admin atualiza)', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Modelo Claude
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('claude_modelo', '"claude-sonnet-4-6"'::jsonb, 'Modelo Anthropic a usar', 'string'),
  ('claude_temperatura', '0.3'::jsonb, 'Temperatura (consistência, não criatividade)', 'number'),
  ('claude_max_tokens', '1500'::jsonb, 'Max tokens por chamada', 'number'),
  ('claude_timeout_s', '30'::jsonb, 'Timeout em segundos', 'number'),
  ('claude_prompt_caching_ativar_em_dias', '30'::jsonb, 'Após N dias de operação, ativar Prompt Caching', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Ordens vindas da IA
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('ordem_os_validade_dias', '7'::jsonb, 'Dias de validade de uma sugestão aprovada antes de expirar', 'number')
ON CONFLICT (chave) DO NOTHING;


-- Home — número de alertas e oportunidades
INSERT INTO ia_config (chave, valor, descricao, tipo) VALUES
  ('home_alertas_criticos_fixos', '5'::jsonb, 'Quantos críticos exibir fixos na Home', 'number'),
  ('home_oportunidades_fixas', '3'::jsonb, 'Quantas oportunidades exibir na Home', 'number'),
  ('home_criticos_score_min', '80'::jsonb, 'Score mínimo pra virar crítico', 'number')
ON CONFLICT (chave) DO NOTHING;
