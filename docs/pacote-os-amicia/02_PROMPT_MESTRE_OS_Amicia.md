# 🧠 OS Amícia — Prompt Mestre de Implementação

**Versão:** 1.0 · **Data:** 19 de Abril de 2026 · **Status:** Especificação aprovada, pronta pra implementação

---

## 📌 LEIA ANTES DE QUALQUER COISA

Você é o implementador do **OS Amícia**, sistema operacional de decisão do App Financeiro Amícia. Antes de escrever **uma linha de código**, leia este documento inteiro e o **Preview_OS_Amicia_v1.1.html** (abre no navegador). Depois siga o **Sprint Plan** na ordem.

**Nome do módulo:** OS Amícia (não "Módulo IA", não "IA Operacional"). O nome vem de "Sistema Operacional Amícia" — o cérebro que conecta, analisa e recomenda.

**Tagline oficial:** "Sistema operacional de decisão · conecta · analisa · recomenda"

**Princípio fundamental:** toda análise termina em ação concreta. Insights que não terminam em ação são ruído.

**Regra de ouro de dados:** use **sempre o dado real** disponível nos módulos existentes. As suposições são mínimas e estão documentadas na seção 7.

---

## 🗂️ Sumário

1. [Contexto operacional e stack](#1-contexto-operacional-e-stack)
2. [Identidade visual e branding](#2-identidade-visual-e-branding)
3. [As 4 áreas e 26 cards](#3-as-4-áreas-e-26-cards)
4. [Regras de negócio consolidadas](#4-regras-de-negócio-consolidadas)
5. [Infraestrutura Supabase (7 tabelas + 29 views)](#5-infraestrutura-supabase)
6. [Endpoints, prompt do Claude e JSON](#6-endpoints-e-integração-claude)
7. [Mapa de dados: real × suposição × limitação](#7-mapa-de-dados)
8. [Sprint Plan (8 sprints · 10 semanas)](#8-sprint-plan)
9. [27 decisões travadas (referência rápida)](#9-27-decisões-travadas)
10. [Critérios de sucesso e sinais de ajuste](#10-critérios-de-sucesso)

---

## 1. Contexto operacional e stack

### Grupo Amícia

Confecção feminina baseada em São Paulo, operação vertical integrada. Faturamento marketplace ≈ R$ 1,2M/mês distribuído em 3 contas Bling (Exitus, Lumia, Muniam) e 5 canais principais (ML R$600k, Shein R$350k, Shopee R$250k, TikTok em expansão, Meluni B2C em expansão). Também vende em Magalu com baixíssimo volume (~77 peças/mês — tratado como "Outros"). 3 salas de corte internas (Antonio, Adalecio, Chico), ~13 oficinas de costura terceirizadas. Lead time padrão 22 dias. Volume ≈ 15.000 peças/mês em ≈ 3.000 variações ativas (ref+cor+tam). Ticket médio R$ 80/peça. Tecidos principais: linho sem elastano, linho com elastano, couro, verona, tricoline.

### Stack

- **Frontend:** React 18 + TypeScript + Vite
- **Backend:** Vercel Serverless Functions (Node 20)
- **Database:** Supabase Pro (PostgreSQL 15) + Realtime
- **Deploy:** https://app-financeiro-brown.vercel.app
- **Repo:** `AilsonMoreira-creator/APP-financeiro` (branch `main`, criar branch `os-amicia-fase1`)
- **Versão atual do app:** v6.8

### Credenciais (no ZIP de contexto)

Token GitHub, email pra commit e chaves de ambiente estão no segundo ZIP que acompanha este pacote: `02_Contexto_App_OS_Amicia.zip`. Não duplicar aqui por segurança.

### Módulos existentes que o OS Amícia consome

- **Bling** (3 contas): vendas detalhadas, produtos, estoque · `bling_vendas_detalhe`, `ml_ref_atual`, `ml_sku_ref_map`
- **Oficinas** (com detalhamento cor+tam já implementado em 18/04/2026): `amicia_data` user_id `ailson_cortes`
- **Salas de Corte** (rendimento por ref+tecido+sala): `amicia_data` user_id `salas-corte`
- **Calculadora** (Meluni): `amicia_data` user_id `calc-meluni`
- **SAC** (ML Perguntas — base de 91 Q&A treinadas, integração futura na Fase 4)

### Último commit relevante e pré-requisitos

- `d5af257` — Correção do bug filtro marca+canal no ranking Bling (19/04). **Crítico pro OS Amícia** — a Curva A/B depende desse filtro estar correto.
- `92a77c1`, `9cc5cf0`, `d0faa8d`, `772988e` — Sync automático ML `ml_sku_ref_map` (mapeamento 100% completo, sem gaps).

**⚠️ Os PDFs técnicos originais mencionam "80% mapeado" e "confiança média/baixa pra dados ML". Isso está OBSOLETO. Hoje é 100% mapeado, confiança alta por padrão.**

---

## 2. Identidade visual e branding

### Nome e ícone

- **Nome:** OS Amícia
- **Ícone:** SVG quadrado arredondado, fundo bege `#EAE0D5`, quadrado central azul marinho `#1C2533` (**sem texto dentro, só geometria**), 4 nós conectados nos cantos em `#373F51`. Representa hub central conectado às áreas operacionais. SVG completo no Preview (linhas ~790-805).

### Paleta oficial

| Token | Hex | Uso |
|---|---|---|
| `--ia-bg` | `#EAE0D5` | Fundo do ícone, destaques do OS |
| `--ia-dark` | `#373F51` | Nós e linhas do ícone, pills do OS |
| `--ia-darker` | `#1C2533` | Quadrado central do ícone, títulos fortes |
| `--app-bg` | `#f7f4f0` | Fundo geral (mantém identidade do app) |
| `--app-cream` | `#e8e2da` | Bordas, separadores |
| `--app-blue-dark` | `#2c3e50` | Títulos (herdado do app) |
| `--app-blue` | `#4a7fa5` | Links, secundário |
| `--critical` | `#c0392b` | Alertas críticos |
| `--warning` | `#c8a040` | Atenção |
| `--success` | `#27ae60` | Positivo, saudável |

### Tipografia

- **Georgia serif** — texto corrido (mantém padrão do app)
- **Calibri** — números, percentuais, dados tabulares (valores monetários sempre em Calibri)

### Onde o ícone aparece

- **Menu principal do app:** 20px, entre SAC e Bling, label "OS", badge vermelho de contador quando há críticos não lidos
- **Cabeçalho da Home do OS Amícia:** 56px, em fundo bege gradiente, com nome e tagline ao lado
- **Favicon do módulo:** opcional, mesma geometria

### Preview visual como contrato pixel

O arquivo `Preview_OS_Amicia_v1.1.html` (incluso neste ZIP) é o **contrato visual oficial**. Navegar por ele antes de codar. Se o resultado final não se parecer com o preview, algo está errado.

---

## 3. As 4 áreas e 26 cards

Fase 1 entrega **4 áreas** (Financeiro e Lojas físicas ficam pra Fase 2):

### 🏠 Home (6 blocos)

Painel executivo de leitura em 30 segundos. Consome insights de `ia_insights`, não gera próprios.

1. **Cabeçalho** — saudação dinâmica + botão "Perguntar à IA" (rate limit 5/dia)
2. **Termômetro Marketplaces do Dia** — receita acumulada + comparação contra média dia útil + semáforo verde/amarelo/vermelho. Nota explícita: "Lojas físicas não analisadas nesta versão"
3. **Resumo Operacional** — 3 linhas (Estoque, Produção, Marketplaces) com top 1 insight de cada área
4. **Alertas Críticos** — 5 fixos (severity crítica + score ≥80) + botão "Ver mais X"
5. **Oportunidades do Dia** — 3 oportunidades (flexível, número é base)
6. **Destaque da Semana** — melhor notícia + pior notícia agregadas em 7 dias

**Visibilidade:** só admin na v1.0. Schema multi-user preparado.

### 📦 Estoque (6 cards)

1. Saúde geral + projeção fim do mês
2. Tendência mês a mês (últimos 12 meses)
3. **Ruptura crítica** — variações cobertura <10d + demanda ativa
4. **Ruptura disfarçada** — variações que vendiam bem há 30-60d e pararam junto com estoque zerando
5. Cobertura média por tecido (linho s/e, linho c/e, couro, verona, tricoline)
6. **Reposição sugerida da semana** — principal · o que cortar, detalhado por cor+tamanho+rolos

### ✂️ Produção (5 cards)

1. Visão da semana (semáforo 15/20/>20 cortes)
2. Oficinas em queda (<70% da média 12 meses)
3. Oficinas sobrecarregadas (>120% da média)
4. Rendimento de tecido por sala (agora com dado granular **ref+tecido+sala**)
5. Tempo médio de entrega por oficina × lead time padrão 22d
6. Modelos em produção vs demanda projetada

### 🛒 Marketplaces (7 cards — inclui novo Card 1 Lucro do Mês)

**Ordem definida (o Card 1 é o destaque executivo):**

1. **💰 Lucro Líquido Marketplace do Mês** · 🔒 **ADMIN-ONLY RÍGIDO** (detalhado abaixo)
2. Crescimento marketplace 24 meses
3. Canais subindo/caindo acima da média (ML × Shein × Shopee × TikTok × Meluni × Outros-Magalu)
4. Performance das 3 contas Bling (Exitus × Lumia × Muniam)
5. Top movers em 3 camadas (unificado / por conta / cruzamento entre contas)
6. Margem por canal com plano de ajuste gradual em degraus
7. Oportunidades margem alta / venda baixa (pegada perdida, limite 5 por execução)

#### Card 1 — Lucro Líquido Marketplace do Mês (especificação completa)

**Propósito:** responder à pergunta #1 do dono ao abrir o módulo: "quanto tô ganhando esse mês, real?"

**Fórmula:**
```
Para cada venda do Bling no mês corrente:
  lucro_venda = unidades × lucro_ultima_linha_do_canal (da Calculadora)

lucro_bruto_mes = Σ lucro_venda
lucro_liquido_mes = lucro_bruto_mes × (1 - devolucao_global)   // 0,90
```

**Visibilidade:** somente perfil `admin`. **Em hipótese alguma** exposto a outros perfis, nem no futuro, nem em tela derivada, nem na Home, nem em exports. Validação dupla: endpoint rejeita requisição de não-admin + frontend esconde rota.

**Estrutura do card (ver preview):**
- Número principal em Calibri 28pt (verde se positivo)
- Breakdown: receita bruta → lucro somado → (-) devoluções 10% → líquido projetado
- Comparações: mês anterior mesmo dia / mês anterior fechado / mesmo mês ano anterior
- Lucro por canal (6 canais, Magalu agrupado em "Outros")
- Top 5 produtos que mais lucraram
- Análise IA explicativa + banner reforçando visibilidade restrita

**Insights que pode disparar:**
- Crítico: "Lucro projetado R$ Xk abaixo do mês anterior no mesmo dia"
- Atenção: "Concentração de lucro em 1 canal aumentou Xpp"
- Atenção: "Devolução real do mês excede a estimativa global de 10%"
- Positiva: "Lucro do mês superou o mês anterior em X% já no dia Y"
- Oportunidade: "Ref X contribui pouco pro lucro apesar de lucro/peça alto"

---

## 4. Regras de negócio consolidadas

Todas ajustáveis via `ia_config` (exceto onde explicitamente marcado como fixo).

### Gatekeeper de demanda (regra crítica não-negociável)

Estoque zerado **nunca** implica produção. A decisão exige cruzar com demanda recente.

| Status da variação | Critério (últimos 15 dias) | Decisão da IA |
|---|---|---|
| 🔥 Ativa | ≥ 6 vendas | Entra no pipeline completo |
| ⚠️ Fraca | 1 a 5 vendas | Só entra se estoque crítico, confiança média |
| ❌ Inativa | 0 vendas | Ignorada (exceto ruptura disfarçada) |

**Exceção: ruptura disfarçada.** Se `v15d = 0` MAS `v_mes_anterior ≥ 12`, a variação não é ignorada — entra com confiança média e sugestão de investigação.

### Lead time e cobertura

- Lead time padrão: **22 dias** (uniforme, oficinas só têm data de saída)
- Cobertura alvo após corte: **28 dias** (22 lead time + 6 folga) — **reduzido de 35 pra liberar capital**
- Cobertura crítica: <10 dias
- Cobertura atenção: 10-22 dias
- Saudável: 22-45 dias
- Excesso: >45 dias (considerar promoção, não cortar)

### Regras de grade

- **Peça grande** (nome contém "vestido" ou "macacão"): **máx 6 módulos**
- **Peça pequena/média** (todo o resto): **máx 8 módulos**
- Detecção automática só pelo nome; ajuste manual aceitável no momento do risco
- **Princípio de ouro:** sempre buscar a grade MÍNIMA que entrega a proporção

### Definição de corte

- **1 corte = 1 ref inteira com todas as cores juntas no mesmo enfesto**
- Ex: ref 02277 com 5 rolos Bege + 4 Preto + 4 Azul + 3 Figo = **1 corte único**, não 4

### Capacidade semanal (semáforo)

| Cortes | Status | Ação |
|---|---|---|
| ≤ 15 | 🟢 Normal | Equipe absorve sem aperto |
| 16-20 | 🟡 Corrida | Priorizar Curva A, considerar balanceamento depois |
| > 20 | 🔴 Excesso | Procurar sala extra ou adiar balanceamento |

### Curvas

- **Curva A** (top 10 ranking Bling): ≥ 300 peças estimadas, **teto 750** (bem acertivos)
- **Curva B** (posições 11-20): ≥ 200 peças estimadas, **teto 450**
- Abaixo disso = balanceamento (cortes de encaixe entre principais)

### Distribuição de rolos por cor

- Mínimo **3 rolos por cor** (exceção: balanceamento urgente pode ter 2)
- Fator de tendência de cor:
  - **Em alta** (+30% em ≥5 modelos): multiplicador 1.2
  - Estável (-15% a +29%): multiplicador 1.0
  - **Em queda** (-30% em ≥3 modelos): multiplicador 0.8
- Assimetria intencional: 5 modelos pra alta (investimento exige consistência), 3 pra queda (alerta mais sensível)

### Pisos universais de margem (Calculadora)

Aplicam aos 5 canais (ML, Shein, Shopee, TikTok, Meluni) pelo valor na última linha:

| Faixa | Classificação | Pill |
|---|---|---|
| < R$ 0 | Urgência máxima | vermelho intenso |
| R$ 0 a R$ 7,99 | Crítico | vermelho |
| R$ 8 a R$ 9,99 | Atenção | amarelo |
| R$ 10 a R$ 13,99 | Bom | verde |
| ≥ R$ 14 | Ótimo | verde escuro |

### Ajuste de preço

- **Calculadora já entrega 2 degraus pré-calculados** por canal (preço pra lucro ≥R$10 e preço pra lucro ≥R$14). IA consome, não recalcula.
- **Regra dos 30 dias:** aplica APENAS a aumentos consecutivos na mesma peça. Redução de preço é livre, mas só permitida se `cobertura > 60d AND tendência em queda` (evita redução impulsiva).
- **Regra dura R$ 79 ML:** nunca sugerir preço que crie custo de frete grátis sem compensação. Se salto necessário cair na zona proibida, ou vai pra baixo de R$ 79 seguro ou pra cima com margem suficiente.
- **Nunca furar o piso de R$ 8** na última linha.

### Devolução

- **10% global** (configurável em `ia_config`). Justificativa: Bling tem cancelamento individual mas Full ML não reporta devolução real, então estimativa global é mais precisa que dado parcial.

### Cron

- **07:00 BRT** — preparação do dia (expressão cron: `0 10 * * *` UTC)
- **14:00 BRT** — consolidação e planejamento tarde (expressão cron: `0 17 * * *` UTC)
- Ajustável via `ia_config` sem deploy.
- **⚠️ Os PDFs originais mencionam 08h/18h em alguns pontos. IGNORAR — a verdade é 07h/14h.**

### Confiança

- **Alta** (padrão): dado direto da fonte sem cálculo intermediário. Inclui **100% dos dados ML** agora que o mapeamento está completo.
- **Média:** cálculos estáveis com 1+ hipótese (cobertura por variação, sazonalidade <2 anos de base, produção em oficina sem detalhamento por cor)
- **Baixa:** dado parcial ou hipótese forte (ex: produtos sem cadastro completo na Calculadora em algum canal)

### Pergunta livre

- **5 por dia global** (somadas de todos os usuários, mas só admin tem acesso na v1)
- Tamanho: 10-500 caracteres
- Reset à meia-noite BRT
- Bloqueada se orçamento Anthropic mensal estourou

---

## 5. Infraestrutura Supabase

### 7 tabelas novas

| Tabela | Propósito | Retenção |
|---|---|---|
| `ia_insights` | Histórico de todos os insights gerados (cron + perguntas livres) | 90d em "arquivado" → limpeza mensal |
| `ia_feedback` | Respostas Sim/Parcial/Não + nota opcional + user | Permanente |
| `ia_config` | Thresholds e pesos ajustáveis (chave-valor) | Permanente |
| `ia_usage` | Controle de rate limit e custo Anthropic (por dia e por mês) | 12 meses |
| `ia_sazonalidade` | 5 datas hardcoded (Dia das Mães, Black Friday, Natal, Dia dos Namorados, Liquida ML). Admin pode editar | Permanente |
| `ml_vendas_lucro_snapshot` | Lucro real por venda individual, gravado no momento da venda (cron diário) | 24 meses |
| `calc_historico_snapshot` | Snapshot da Calculadora quando valores mudam (trigger ou cron diário detectando diff) | Permanente |

### 29 views SQL

#### Fluxo de Corte (10 views — Estoque + Produção)

1. `vw_variacoes_classificadas` — base unificada por ref+cor+tam com todas as métricas e 3 classificações
2. `vw_refs_elegiveis_corte` — refs com pelo menos 1 variação em crítica/atenção + demanda ativa
3. `vw_tamanhos_em_gap_por_ref` — tamanhos específicos em gap + proporção
4. `vw_grade_otimizada_por_ref` — aplica regras 6/8 módulos e devolve grade mínima
5. `vw_distribuicao_cores_por_ref` — participação ajustada + rolos por cor
6. `vw_rendimento_sala_corte` — peças por rolo médio por **ref × sala × tecido** (dado granular disponível!)
7. `vw_projecao_22_dias_por_ref` — cenários A/B/C de saldo projetado
8. `vw_ranking_curvas_bling` — consulta ranking existente do Bling, classifica A/B/C
9. `vw_tendencia_cor_catalogo` — tendência agregando todos os modelos onde a cor aparece
10. `vw_cortes_recomendados_semana` — consolidadora final + semáforo de capacidade

#### Marketplaces (13 views — antes 12, +1 pro Card 1 Lucro Mês)

11. `vw_marketplaces_base` — view-mãe: vendas cruzadas com custo/margem da Calculadora
12. **`vw_lucro_marketplace_mes`** — NOVO · alimenta Card 1 (Lucro Líquido do Mês)
13. `vw_vendas_mensais_24m` — agregação mensal últimos 24m (Card 2)
14. `vw_canais_comparativo` — 7v7 e 30v30 + desvio vs média (Card 3)
15. `vw_contas_bling_7v7` — performance 3 contas Bling (Card 4)
16. `vw_contas_bling_concentracao_queda` — top 5 produtos que puxaram queda por conta
17. `vw_top_movers_unificado` — Camada 1 do Card 5 (soma das 3 contas)
18. `vw_top_movers_por_conta` — Camada 2 do Card 5 (separado por conta)
19. `vw_top_movers_cruzamento` — Camada 3 do Card 5 (assimetrias entre contas)
20. `vw_margem_por_produto_canal` — lê valor da última linha da Calculadora + classifica faixa (Card 6)
21. `vw_plano_ajuste_gradual` — lê os 2 degraus já pré-calculados na Calculadora + aplica 30d e R$79
22. `vw_oportunidades_margem` — margem alta + venda baixa + pegada perdida (Card 7)
23. `vw_historico_ajustes_precos` — filtra `ia_feedback` para aplicar regra dos 30d

#### Home (5 views)

24. `vw_home_termometro_dia` — receita acumulada do dia + média dia útil + 7v7 + semáforo
25. `vw_home_resumo_operacional` — top 1 insight de cada área (3 linhas)
26. `vw_home_top_criticos` — lista critica com dedup vs Resumo
27. `vw_home_top_oportunidades` — top 3 com diversidade flexível
28. `vw_home_destaque_semana` — melhor e pior notícia agregada 7d

#### Sazonalidade (1 view auxiliar)

29. `vw_sazonalidade_proxima` — próxima data relevante dos próximos 30d (alimenta alertas antecipados)

### Funções principais

- `fn_ia_cortes_recomendados()` — orquestra views 1-10 (Fluxo de Corte), devolve JSON único
- `fn_ia_marketplaces_insights()` — orquestra views 11-23, devolve JSON único
- `fn_ia_home_geral()` — orquestra views 24-28, devolve JSON consolidado
- `fn_ia_snapshot_calculadora_diario()` — roda 1x/dia, detecta mudanças na Calculadora e grava em `calc_historico_snapshot`
- `fn_ia_snapshot_lucro_vendas_diario()` — roda 1x/dia, grava `ml_vendas_lucro_snapshot` das vendas do dia

---

## 6. Endpoints e integração Claude

### 8 endpoints Vercel

| Endpoint | Método | Propósito | Admin-only |
|---|---|---|---|
| `/api/ia-cron` | POST | Cron principal 07h/14h | cron secret |
| `/api/ia-home` | GET | JSON da Home Geral | admin |
| `/api/ia-feed` | GET | Feed filtrado por `?area=` | sim (v1) |
| `/api/ia-pergunta` | POST | Pergunta livre com rate limit | admin (v1) |
| `/api/ia-feedback` | POST | Salva Sim/Parcial/Não + nota | sim (v1) |
| `/api/ia-config` | GET/PUT | Lê/atualiza thresholds | admin |
| `/api/ia-status` | GET | Painel admin (uso, custo, próxima execução) | admin |
| `/api/ia-disparar` | POST | Admin dispara cron manualmente | admin |

### Modelo Claude

- **Claude Sonnet 4.6** — modelo fixo
- **Temperatura:** 0.3 (consistência, não criatividade)
- **max_tokens:** 1500 por chamada (até 15 insights)
- **Timeout:** 30s. Falha → 1 retry com temp 0.1 → fallback determinístico
- **Prompt Caching:** ativar após 30 dias de operação (prompt base estável)

### 8 regras não-negociáveis no prompt de sistema

1. Toda análise termina em ação concreta
2. Estoque zerado não é critério pra produção — sempre cruzar com demanda
3. Margem é desempate, nunca decisor único
4. Produção em oficina agora detalha cor+tam (confiança alta — diferente do PDF original!)
5. Respeite a confiança que vem no input — não invente certeza
6. Linguagem direta, números concretos, sem adjetivos vagos
7. Brevidade: resumo ≤2 frases, ação ≤1 frase, impacto ≤1 frase
8. Nomes de produtos e refs vindos do input são autoridade — não traduzir, não abreviar

### Formato JSON de saída obrigatório

Array de insights, cada um com 8 campos: `escopo`, `severity`, `confidence`, `titulo`, `resumo`, `impacto`, `acao_sugerida`, `chaves` (ref/cor/tam). Sem markdown, sem texto fora do JSON, sem campos extras.

### Orçamento Anthropic

- **Limite rígido: R$ 80/mês**
- Estimativa Fase 1: ~R$ 23/mês
- Ao estourar: cron continua (só fallback determinístico), perguntas livres bloqueadas até próximo mês

---

## 7. Mapa de dados

### ✅ Dados reais (confiança alta, IA usa direto)

| Dado | Fonte |
|---|---|
| Vendas ref+cor+tam+canal+conta por data | `bling_vendas_detalhe` |
| Ranking top 30 refs | Módulo Bling Produtos |
| Histórico mês passado (unidades + faturamento) | Módulo Bling Produtos |
| Estoque ML 100% mapeado | `ml_ref_atual` + `ml_sku_ref_map` |
| Cortes em andamento por cor+tam | `amicia_data` user_id `ailson_cortes` |
| Rendimento por **ref + tecido + sala** | `amicia_data` user_id `salas-corte` |
| Composição detalhada de custo (7 componentes + fixo) | Calculadora |
| Valor venda + lucro última linha por canal (5 canais) | Calculadora |
| 2 degraus pré-calculados (R$10 e R$14) | Calculadora |
| Regras de comissão por faixa | Embutidas na Calculadora |
| Cancelamento individual de venda (exceto Full ML) | Bling |
| 6º canal Magalu (baixo volume, agrupado em "Outros") | Bling |

### 🎯 Suposições controladas (valor inicial em `ia_config`, ajustável)

| Suposição | Valor inicial | Motivação |
|---|---|---|
| Devolução global | 10% | Full ML não reporta devolução real |
| Lead time uniforme | 22 dias | Oficinas só têm data de saída |
| Sazonalidade hardcoded | 5 datas (Dia das Mães, Black Friday, Natal, Dia dos Namorados, Liquida ML) | Admin edita depois |
| Cobertura alvo | 28 dias | Libera capital (era 35 nos PDFs, foi reduzida) |
| Pisos margem | R$ 8 / R$ 10 / R$ 14 | Universais aos 5 canais |
| Curva A | ≥ 300 (teto 750) | Corte típico da oficina |
| Curva B | ≥ 200 (teto 450) | Escala menor |
| Tendência cor alta | +30% em 5+ modelos | Exige consistência antes de investir |
| Tendência cor queda | -30% em 3+ modelos | Mais sensível (alerta mais cedo) |

### ⚠️ Limitações assumidas (IA menciona explicitamente quando impacta)

| Limitação | Mitigação |
|---|---|
| Custo atual usado pra vendas passadas nos primeiros 30d | `calc_historico_snapshot` começa a preencher histórico a partir do go-live |
| Preço efetivo da venda (com promoção aplicada) desconhecido | **Query de reconhecimento no dia 1:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'bling_vendas_detalhe'`. Se houver coluna como `valor_unitario_real` ou `valor_total_venda` ou `desconto_aplicado`, usar. Se não, usar preço cadastrado × quantidade com ressalva |
| Sem histórico de atraso por oficina | "Oficinas em queda <70%" captura padrão estatisticamente |
| Comissão real depende de atualização manual da Calculadora | Risco conhecido documentado; se ML/Shopee mudar comissão, dono atualiza Calculadora e IA recalcula |
| Produtos saídos de linha sem flag | Gatekeeper de demanda filtra naturalmente (sem vendas 15d = inativa) |
| Feriados sem cadastro automático | 5 datas hardcoded + detecção estatística de dia atípico |

**Regra de ouro pro implementador:** antes de fazer query, pergunte-se "isso está nos dados reais acima?". Se sim, use. Se não, veja se é suposição controlada (então use valor de `ia_config`) ou limitação (então marque o insight com `confidence: media/baixa` e mencione a limitação no texto).

---

## 8. Sprint Plan

Total estimado: **10 semanas**. Cada sprint valida em produção antes do próximo começar.

### Sprint 1 — Fundação (1 semana)

- Criar as **7 tabelas novas** no Supabase via SQL Editor
- Popular `ia_config` com valores iniciais (ver seção 4)
- Popular `ia_sazonalidade` com seed das 5 datas
- Endpoints admin mínimos: `/api/ia-config`, `/api/ia-status`, `/api/ia-disparar`
- Criar branch `os-amicia-fase1` no repo
- **Validação:** admin consegue ler/editar config via endpoint

### Sprint 2 — Views Fluxo de Corte (1 semana)

- Implementar views 1-10 na ordem listada (dependências)
- **Rodar query de reconhecimento do Bling primeiro** pra confirmar colunas disponíveis
- Implementar `fn_ia_cortes_recomendados()`
- **Validação:** função consolidadora devolve JSON válido com dados reais, testável direto no SQL Editor

### Sprint 3 — Cron + IA Fluxo de Corte (1 semana)

- Implementar `/api/ia-cron` orquestrando os 5 passos
- Integrar Claude Sonnet 4.6 com prompt de sistema (8 regras) + prompt de usuário montado
- Implementar fallback determinístico (funciona sem Claude)
- Implementar `fn_ia_snapshot_lucro_vendas_diario()` e `fn_ia_snapshot_calculadora_diario()`
- **Validação:** cron roda 07h/14h gerando insights de corte em `ia_insights`

### Sprint 4 — Views Marketplaces (1 semana)

- Implementar views 11-23 (inclui nova `vw_lucro_marketplace_mes`)
- Implementar `fn_ia_marketplaces_insights()`
- **Validação:** Card 1 devolve lucro do mês correto; Cards 2-7 devolvem insights esperados

### Sprint 5 — IA Marketplaces + integração (1 semana)

- Estender cron pra gerar insights das 2 áreas (Corte + Marketplaces)
- **Validação:** 1 execução do cron gera insights de todas as áreas consistentemente

### Sprint 6 — Frontend das áreas (2 semanas)

- Componentes React pra Estoque, Produção, Marketplaces (7 cards, Card 1 admin-only rígido)
- Modal "Explicar esta decisão" (rastreabilidade)
- Botões de feedback Sim/Parcial/Não
- **Validação pixel:** resultado confere com `Preview_OS_Amicia_v1.1.html`

### Sprint 7 — Home Geral (1 semana)

- Views 24-28 + `fn_ia_home_geral()`
- Endpoint `/api/ia-home`
- Componente React da Home (6 blocos)
- Canal Realtime `ia-insights-channel` pra atualização ao vivo
- **Validação:** Home abre em <1,5s, atualiza ao vivo quando novo insight é gerado

### Sprint 8 — Pergunta livre + polish (1 semana)

- Modal "Perguntar à IA" com sugestões dinâmicas
- Endpoint `/api/ia-pergunta` com rate limit e montagem de contexto
- Painel admin completo (thresholds, uso/custo, feedback agregado)
- Testes end-to-end
- **Validação:** 5 perguntas/dia funcionam, custo dentro do orçamento, painel admin completo

---

## 9. 27 decisões travadas

Referência rápida pra consulta durante implementação. Cada uma discutida e aprovada.

### Produto & escopo

1. **Fase 1 = 4 áreas** (Estoque, Produção, Marketplaces, Home). Financeiro + Lojas físicas → Fase 2
2. **Cron 07h/14h BRT** (IGNORAR 08h/18h que aparece em alguns PDFs)
3. **Nome:** OS Amícia (não "Módulo IA")
4. **Ícone:** sem texto, só geometria (quadrado central escuro + 4 nós conectados)
5. **Home só admin na v1.0** — schema multi-user pronto pra expansão
6. **Card 1 de Marketplaces (Lucro Mês) admin-only RÍGIDO** — nunca expor a outros perfis, nem futuro

### Dados & confiança

7. **Mapeamento ML 100%** (commit 92a77c1) — confiança alta padrão em tudo que envolve ML
8. **Oficinas com cor+tam implementado (18/04)** — análise 100% habilitada
9. **Bling 45d de histórico detalhado** + Excel histórico que você vai alimentar em outro chat
10. **Devolução 10% global** em `ia_config` (Full ML não reporta real)
11. **Rendimento Sala de Corte por ref+tecido+sala** (dado granular disponível, melhor que os PDFs previam)
12. **Calculadora sem histórico** → criar `calc_historico_snapshot` a partir do go-live
13. **Produtos saídos de linha sem flag** → gatekeeper resolve
14. **Preço efetivo** → query de reconhecimento no dia 1 decide estratégia
15. **Sazonalidade hardcoded (5 datas)** + editável por admin

### Regras de negócio

16. **Cobertura alvo 28 dias** (reduzida de 35 nos PDFs pra liberar capital)
17. **Pisos margem R$ 8 / R$ 10 / R$ 14** universais aos 5 canais
18. **Tendência cor assimétrica:** 5 modelos alta / 3 modelos queda
19. **Peça grande só por nome** (vestido/macacão) — resto pequena, ajuste manual aceitável
20. **Curva A ≥300 (teto 750)** — top 10 bem acertivos
21. **Curva B ≥200 (teto 450)** — escala menor
22. **30 dias só entre aumentos** — redução livre com sub-regra (cobertura >60d + tendência em queda)
23. **Composição de custo detalhada** disponível (7 componentes + fixo) — 3 insights extras pra Fase 2

### Arquitetura

24. **Pesos da pontuação em `ia_config`** (ajustáveis sem deploy)
25. **Snapshot de lucro por venda** em `ml_vendas_lucro_snapshot`
26. **Snapshot da Calculadora** em `calc_historico_snapshot`
27. **Top 3 oportunidades da Home flexível** — regra de diversidade não obrigatória

---

## 10. Critérios de sucesso

### Metas da Fase 1

| Critério | Meta | Como medir |
|---|---|---|
| Insights gerados/dia | ≥ 8 | Contagem no histórico |
| Taxa de aprovação (Sim + Parcial) | ≥ 60% em 30d | Agregado por categoria |
| Insights críticos de ruptura confirmados | ≥ 70% | Primeiros 20 manualmente |
| Custo Anthropic mensal | < R$ 80 | Tabela de uso |
| Tempo de carregamento da Home | < 1,5s | Performance endpoint |
| Uptime do cron | ≥ 95% | Logs Vercel |

### Sinais de que algo precisa ajuste

- Taxa de Sim abaixo de 50% por 2 semanas → thresholds/prompt ruins
- >30% de críticos arquivados sem feedback → críticos estão virando ruído
- Mesmo insight 5 dias seguidos → falta regra de snooze ou contexto
- Custo passando de R$ 60 por mês → otimizar: ativar Prompt Caching, reduzir top N, checar redundância

### Marcos pra celebrar

- Admin toma 1ª decisão 100% baseada no OS Amícia (sem checagem manual) → **informação é confiável**
- Taxa de aprovação >70% por 2 meses → **calibrado pra operação Amícia**
- Equipe abre o módulo espontaneamente de manhã → **virou hábito**
- 1ª pergunta livre identifica ruptura que teria passado despercebida → **valor do modo híbrido provado**

---

## 📝 Nota final ao implementador

Este documento foi destilado a partir de:
- 216 páginas de especificação em 4 PDFs técnicos
- Preview visual navegável já aprovado
- 8+ rodadas de discussão pra eliminar suposições e travar decisões
- 18 pontos de verificação de dados reais × chutes × limitações

**Você tem tudo que precisa pra começar.** Se em algum momento durante a implementação surgir dúvida sobre "isso é chute ou dado real?", volte à seção 7 (Mapa de dados). Se a dúvida for sobre uma regra de negócio, seção 4. Sobre estrutura técnica, seções 5 e 6.

**Princípios que protegem contra desvios:**
- Se o resultado não se parece com o `Preview_OS_Amicia_v1.1.html`, está errado
- Se um insight não termina em ação concreta, refatorar ou descartar
- Se a IA parece certa de algo com dado parcial, rebaixar confiança
- Se a pontuação gerou ruído, ajustar `ia_config` em vez de mexer no código

Boa implementação. 🚀

---

**Grupo Amícia · App Financeiro v6.8 · OS Amícia v1.0 — Prompt Mestre Executável**
**Gerado em 19 de Abril de 2026**
