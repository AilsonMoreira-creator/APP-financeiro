# MAPA DE GAPS — IA do Chat (Sprint 8)

> **Para o próximo chat trabalhar.** Levanta perguntas que a IA do chat (`/api/ia-pergunta`) **não sabe responder hoje** e mostra exatamente **qual view/tabela já existente** pode preencher cada gap, sem reinventar lógica de negócio.

**Estado atual dos contextos da IA (em `api/_ia-pergunta-helpers.js`):**

| Contexto | Função | O que consulta hoje |
|---|---|---|
| **estoque** | `contextoEstoque(ref)` | Apenas `ml_estoque_ref_atual` (ref específica ou top 20 ruptura) |
| **producao** | `contextoProducao(ref)` | `amicia_data/ailson_cortes` + `ordens_corte` |
| **produto** | `contextoProduto(ref, isAdmin)` | Apenas `bling_vendas_detalhe` (agregação simples 30d) |
| **ficha** | `contextoFichaTecnica(refOuDesc)` | `amicia_data/ficha-tecnica` |

**Glossário menciona** "Curva A/B/C", "Carro-chefe", "Matriz" — mas a IA **não tem dados** pra responder com números reais. Só sabe definir conceitualmente.

---

## 🚨 GAPS POR CATEGORIA

### 📊 Categoria: **PRODUTO / RANKING / VENDAS**

| # | Pergunta que user faria | IA hoje sabe? | Como cobrir |
|---|---|---|---|
| P1 | "Qual a curva da REF 02277?" | ❌ Não | View `vw_ranking_curvas_bling` → coluna `curva` ('A','B','outras') |
| P2 | "Lista todas as REFs curva A" | ❌ Não | `SELECT ref, pecas_30d FROM vw_ranking_curvas_bling WHERE curva='A' ORDER BY pecas_30d DESC` |
| P3 | "Quantas peças a 02277 vendeu nos últimos 30 dias?" | ⚠ Parcial (calcula on-the-fly toda chamada) | `vw_ranking_curvas_bling.pecas_30d` (já agregado, mais rápido) |
| P4 | "Top 10 mais vendidos do mês" | ⚠ Parcial (faz agregação manual) | Mesmo: `vw_ranking_curvas_bling ORDER BY rank_pecas LIMIT 10` |
| P5 | "Qual REF está bombando essa semana?" | ❌ Não tem janela 7d | **GAP REAL** — view atual só tem 30d. Precisaria estender ou criar view nova |
| P6 | "Ranking de vendas por modelo no Bling" | ⚠ Faz, mas sem classificar curva | Mesma view do P1, retorna tudo |
| P7 | "Produto está em alta ou caindo?" | ❌ Não compara janelas | **GAP REAL** — não existe view de tendência por REF; só `vw_tendencia_cor_catalogo` (que é por cor) |
| P8 | "Faturamento da 02277 mês passado" | ⚠ Tem em `valor_total` mas não agregado por mês | `vw_vendas_mensais_24m` (existe!) ou agregar de `bling_vendas_detalhe` |

### 🎨 Categoria: **CORES**

| # | Pergunta | IA hoje? | Como cobrir |
|---|---|---|---|
| C1 | "Quais cores estão em alta no catálogo?" | ❌ Não | `SELECT cor, pecas_recente, variacao_pct FROM vw_tendencia_cor_catalogo WHERE flag_alta = true` |
| C2 | "Quais cores estão caindo?" | ❌ Não | Mesma view, `WHERE flag_queda = true` |
| C3 | "Qual a tendência da cor Bege?" | ❌ Não | `vw_tendencia_cor_catalogo WHERE cor_key = 'bege'` |
| C4 | "Quais cores são carro-chefe?" | ⚠ Glossário lista 10 hardcoded | Glossário OK, mas se quiser dinâmico: top 10 cores por SUM em `bling_vendas_detalhe` |
| C5 | "Qual cor mais vende na 02277?" | ✅ Sim | `contextoProduto(ref)` já calcula `cor_top` |
| C6 | "Lista cores vendidas em todas as REFs" | ❌ Não | `vw_distribuicao_cores_por_ref` (existe) — agrega cor x ref com participação |
| C7 | "Cor Marrom, vai mais em qual modelo?" | ❌ Não | `vw_distribuicao_cores_por_ref WHERE cor_key='marrom' ORDER BY pecas_cor DESC` |

### 📦 Categoria: **ESTOQUE / COBERTURA**

| # | Pergunta | IA hoje? | Como cobrir |
|---|---|---|---|
| E1 | "Quantos dias de estoque tem a 02277?" | ❌ Não | `vw_variacoes_classificadas` tem `cobertura_dias` por variação |
| E2 | "Quais cores da 02277 estão em ruptura crítica?" | ❌ Não | `vw_variacoes_classificadas WHERE ref=X AND cobertura_status='critica'` |
| E3 | "Tem algum produto em ruptura disfarçada?" | ❌ Não | `vw_estoque_ruptura_disfarcada` (existe — view dedicada) |
| E4 | "Quantas refs em ruptura crítica hoje?" | ❌ Não | `vw_estoque_ruptura_critica` (existe) |
| E5 | "Saúde geral do estoque" | ❌ Não | `vw_estoque_saude_geral` (existe — KPI consolidado) |
| E6 | "Estoque está crescendo ou caindo no mês?" | ❌ Não | `vw_estoque_tendencia_12m` (12 meses de histórico) |
| E7 | "Quanto tem da 02277 bege M?" | ⚠ Parcial (`variations` em JSON) | A IA recebe mas não sabe parsear bem. Precisa ensinar no prompt |
| E8 | "Quais REFs vão acabar nos próximos 7 dias?" | ❌ Não | Filtrar `vw_variacoes_classificadas WHERE cobertura_dias <= 7 AND demanda_status='ativa'` |

### 🏭 Categoria: **PRODUÇÃO / OFICINAS**

| # | Pergunta | IA hoje? | Como cobrir |
|---|---|---|---|
| Pr1 | "A 02277 está em produção?" | ✅ Sim | `contextoProducao(ref)` já cobre |
| Pr2 | "Quantos cortes em andamento hoje?" | ❌ Não | `SELECT COUNT(*) FROM amicia_data.payload->'cortes' WHERE entregue=false` |
| Pr3 | "Quantas peças totais em produção agora?" | ❌ Não | SUM `qtd - qtdEntregue` de `ailson_cortes` |
| Pr4 | "Quanto a oficina Roberto Belém tem?" | ❌ Não filtra por oficina | Filtrar `cortes[]` por `oficina = 'Roberto Belém'` |
| Pr5 | "Cortes atrasados (>22 dias)?" | ❌ Não | Calcular `dias_decorridos > 22 AND entregue=false` em `ailson_cortes` |
| Pr6 | "Capacidade da semana — tá normal/corrida/excesso?" | ❌ Não | `fn_ia_cortes_recomendados()` retorna `capacidade_semanal.status` |
| Pr7 | "Sugestão de corte da IA pra hoje" | ❌ Não | `fn_ia_cortes_recomendados()` direto OU `vw_cortes_recomendados_semana` |
| Pr8 | "Qual o rendimento típico de saia midi?" | ❌ Não | `vw_rendimento_sala_corte` (peças/rolo por categoria) |

### 💰 Categoria: **MARKETPLACES (admin)**

| # | Pergunta | IA hoje? | Como cobrir |
|---|---|---|---|
| M1 | "Lucro do mês no ML?" | ❌ Não | `vw_lucro_marketplace_mes` (existe, admin-only) |
| M2 | "Comparativo de canais (ML vs Shein vs Shopee)?" | ❌ Não | `vw_canais_comparativo` |
| M3 | "Performance Exitus vs Lumia vs Muniam — 7 dias x 7 dias atrás?" | ❌ Não | `vw_contas_bling_7v7` |
| M4 | "Top movers (produtos subindo/caindo)?" | ❌ Não | `vw_top_movers_unificado` |
| M5 | "Margem por produto e canal?" | ❌ Não | `vw_margem_por_produto_canal` |
| M6 | "Que produtos têm margem ruim?" | ❌ Não | `vw_oportunidades_margem` |
| M7 | "Plano de ajuste gradual de preços?" | ❌ Não | `vw_plano_ajuste_gradual` |
| M8 | "Vendas mês a mês (24 meses)" | ❌ Não | `vw_vendas_mensais_24m` |

### 📋 Categoria: **FICHA TÉCNICA / PRODUTO ESPECÍFICO**

| # | Pergunta | IA hoje? | Como cobrir |
|---|---|---|---|
| F1 | "Qual o tecido da 02277?" | ✅ Sim | `contextoFichaTecnica` já cobre |
| F2 | "Qual o preço da 02277 no Brás?" | ✅ Sim | Mesma função (3 preços visíveis pra todos) |
| F3 | "Lista refs de linho" | ❌ Não filtra por tecido | Pode filtrar `payload.fichas` por campo `tecido` |
| F4 | "Quais refs viscolinho têm cobertura crítica?" | ❌ Não cruza ficha + estoque | **Cruzamento NOVO** — pegar refs da ficha por tecido + JOIN em `vw_variacoes_classificadas` |

---

## 🎯 PROPOSTA — 5 funções de contexto novas

Pra cobrir todos os gaps acima sem inventar lógica nova:

### 1. `contextoCurvaRanking(ref?, top?)`
- **Fonte:** `vw_ranking_curvas_bling`
- **Cobre:** P1, P2, P3, P4, P6
- **Comportamento:**
  - Com ref → retorna `{ref, pecas_30d, faturamento_30d, curva, rank_pecas}`
  - Sem ref → top 20 com `curva` agrupada
- **Trigger:** keywords "curva", "bestseller", "top vendidos", "ranking"

### 2. `contextoTendenciaCores(corOpcional?)`
- **Fonte:** `vw_tendencia_cor_catalogo`
- **Cobre:** C1, C2, C3
- **Comportamento:**
  - Com cor → tendência detalhada dessa cor
  - Sem cor → top 10 em alta + 5 em queda
- **Trigger:** keywords "cor em alta", "cor caindo", "tendência cor", "qual cor"

### 3. `contextoCobertura(ref?)`  *(estende `contextoEstoque`)*
- **Fonte:** `vw_variacoes_classificadas`
- **Cobre:** E1, E2, E7, E8
- **Comportamento:**
  - Com ref → todas variações com `cobertura_dias`, `cobertura_status`, `demanda_status`
  - Sem ref → top 30 variações em ruptura crítica
- **Trigger:** keywords "cobertura", "dias de estoque", "vai acabar", "ruptura"

### 4. `contextoSaudeGeral()`  *(novo)*
- **Fontes:** `vw_estoque_saude_geral`, `vw_estoque_ruptura_critica`, `vw_estoque_ruptura_disfarcada`, `vw_estoque_tendencia_12m`
- **Cobre:** E3, E4, E5, E6
- **Comportamento:** retorna KPIs consolidados + lista 10 piores casos
- **Trigger:** keywords "saúde", "geral", "como tá", "panorama"

### 5. `contextoMarketplaces(opcoes)`  *(admin-only)*
- **Fontes:** todas as 16 views de `07_views_marketplaces.sql`
- **Cobre:** M1 a M8
- **Comportamento:** sub-router por palavra-chave (lucro/canal/conta/movers/margem/preco)
- **Trigger:** keywords "lucro", "canal", "shein", "shopee", "exitus", "lumia", "muniam", "margem"

### 6. *(opcional)* `contextoSugestaoCorte()`
- **Fonte:** `fn_ia_cortes_recomendados()` direto (a função que o cron chama)
- **Cobre:** Pr6, Pr7
- **Trigger:** keywords "sugestão de corte", "o que cortar", "produção da semana"
- **Cuidado:** chamar essa função é caro (faz processamento). Cache de 1h recomendado

---

## 🔑 GAPS REAIS (precisam view ou ajuste novo)

Esses **não têm view pronta** e exigem trabalho extra:

| Gap | O que falta |
|---|---|
| **P5** — Top da semana (7 dias) | Criar `vw_ranking_7d` ou estender `vw_ranking_curvas_bling` com janelas múltiplas |
| **P7** — Tendência por REF | Criar `vw_tendencia_ref_catalogo` (espelho da `vw_tendencia_cor_catalogo` mas por REF) |
| **F4** — Cruzar ficha técnica × cobertura | Criar view nova ou fazer join no helper Python |

**Sugestão:** deixar esses pra um momento futuro — não dá pra cobrir 100% sem investir em SQL novo.

---

## 📋 PRA O OUTRO CHAT TRABALHAR

**Tarefa principal:** implementar as 5 funções de contexto acima em `api/_ia-pergunta-helpers.js`.

**Arquivos relevantes:**
- `api/_ia-pergunta-helpers.js` — onde adicionar as funções (linhas 369-660 são os contextos)
- `api/ia-pergunta.js` — endpoint que chama as funções (precisa rotear nova categoria)
- `sql/os-amicia/05_views_corte.sql` — fonte de verdade das views base
- `sql/os-amicia/07_views_marketplaces.sql` — views marketplaces
- `sql/os-amicia/09_views_estoque.sql` — views estoque

**Mudanças no `classificarIntencao` (linha 214):**

Adicionar palavras-chave nas categorias existentes:

```js
estoque: [..., 'cobertura', 'dias de estoque', 'saúde', 'panorama', 'ruptura disfarçada'],
producao: [..., 'sugestão de corte', 'capacidade', 'rendimento', 'oficina'],
produto: [..., 'curva', 'bestseller', 'cor em alta', 'cor caindo', 'tendência'],
marketplaces: ['lucro', 'canal', 'shein', 'shopee', 'exitus', 'lumia', 'muniam', 'movers', 'margem', 'preço'],
```

> **Nota:** "marketplaces" não existe como categoria hoje no enum (`producao|produto|estoque|ficha|outros`). Adicionar nova categoria ao CHECK constraint na tabela `ia_pergunta_historico` ou usar "produto" como fallback.

**Mudanças no `montarPromptSistema` (linha 668):**

Acrescentar instruções de quando IA recebe os novos contextos:

```
RANKING/CURVA — quando "curva_ranking" no contexto:
- Curva A = ≥300 peças/30d, B = ≥200, outras (C) = <200
- Janela é sempre 30 dias — sempre cita a janela na resposta
- "rank_pecas" = posição no ranking geral (1 = mais vendido)

TENDÊNCIA DE COR — quando "tendencia_cores":
- "Em alta" = +30% vs janela anterior em 5+ modelos
- "Em queda" = -30% em 3+ modelos (sensibilidade maior pra alerta)
- "Estável" = entre -30% e +30%

COBERTURA — quando "cobertura_variacoes":
- cobertura_status: zerada | critica (<10d) | atencao (10-22d) | saudavel (22-45d) | excesso (>45d)
- demanda_status: ativa (≥6 vendas/15d) | fraca | inativa | ruptura_disfarcada
- ruptura_disfarcada = vendia bem antes (≥12 mês ant) mas vendas_15d=0 → provavelmente ficou sem estoque
```

---

## 🧪 PERGUNTAS REAIS PRA TESTAR DEPOIS

Lista de **30 perguntas de validação** — testar uma por uma após implementar:

```
PRODUTO/RANKING:
1. Qual a curva da REF 02277?
2. Lista todas as REFs curva A
3. Top 10 mais vendidos do mês
4. Quantas peças a 02601 vendeu nos últimos 30 dias?
5. A 02277 está bombando ou caindo?

CORES:
6. Quais cores estão em alta no catálogo?
7. Quais cores estão caindo?
8. Qual a tendência da cor Bege?
9. Cor Marrom, vai mais em qual modelo?
10. Quais cores são carro-chefe?

ESTOQUE:
11. Quantos dias de estoque tem a 02277?
12. Quais cores da 02277 estão em ruptura crítica?
13. Tem algum produto em ruptura disfarçada?
14. Quantas refs em ruptura crítica hoje?
15. Saúde geral do estoque
16. Estoque está crescendo ou caindo?
17. Quanto tem da 02277 bege M?
18. Quais REFs vão acabar nos próximos 7 dias?

PRODUÇÃO:
19. Quantos cortes em andamento hoje?
20. Quantas peças totais em produção agora?
21. Quanto a oficina Roberto Belém tem?
22. Cortes atrasados?
23. Capacidade da semana tá como?
24. Sugestão de corte da IA pra hoje
25. Qual o rendimento típico de saia midi?

MARKETPLACES (admin):
26. Lucro do mês no ML
27. Comparativo de canais
28. Performance das 3 contas Bling 7v7
29. Quais produtos com margem ruim?
30. Plano de ajuste de preços
```

Anote o resultado de cada uma como ✅/⚠/❌ — isso vira métrica de cobertura final.

---

## 🚦 PRIORIZAÇÃO SUGERIDA

**Fase 1 (rápido, alto impacto):**
- Função 1 (curva/ranking) — cobre 5 perguntas
- Função 2 (tendência cores) — cobre 3 perguntas
- Função 3 (cobertura) — cobre 4 perguntas

**Fase 2 (médio):**
- Função 4 (saúde geral)
- Atualizar prompt + classificarIntencao

**Fase 3 (admin-only, mais trabalho):**
- Função 5 (marketplaces) — sub-router complexo

**Fase 4 (opcional):**
- Função 6 (sugestão de corte) — caro, pensar em cache

---

## 📌 NÃO CRIAR VIEW NOVA SEM CHECAR

Antes de criar qualquer view, fazer:
```bash
grep -rn "vw_NOME" sql/os-amicia/
```

A maioria das coisas que parecem "faltando" já existem. Os SQLs do OS Amícia foram bem desenhados — o trabalho do Sprint 8 é **conectar a IA** ao que já existe, não criar coisas novas.

---

**Fim do mapa.** Próximo chat tem trabalho de plumbing claro: pegar view → criar função helper → rotear no endpoint → ensinar no prompt. Sem precisar entender o negócio do zero.
