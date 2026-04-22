# HANDOFF · Sprint 6.1 · OS Amícia · Tab Estoque

> Sub-sprint do Sprint 6 (Frontend das áreas) — recortado pra entregar Tab Estoque sem arrastar Modal Explicar / Feedback UI / ordens_corte (que ficam pra 6.2/6.3/6.4).
> Decisões travadas com Ailson em 21/04/2026.

> **STATUS: ✅ FECHADO (22/04/2026)** — todas as 4 áreas do Tab Estoque entregues, com 4 fases extras de refinamento descobertas durante validação. Branch `os-amicia-fase1` no commit `891f578`. Detalhes completos na seção 8 (Histórico real de execução) e seção 9 (Configuração final do `ia_config`).

---

## 1. Escopo final aprovado

**4 cards no Tab Estoque** (não 6 — Cards 5 e 6 do PROMPT MESTRE adiados):

| Card | Fonte de dados | View criada |
|---|---|---|
| **1 · Saúde geral** | `vw_variacoes_classificadas` agregada por ref | `vw_estoque_saude_geral` |
| **2 · Tendência 12m** | `ml_estoque_total_mensal` | `vw_estoque_tendencia_12m` |
| **3 · Ruptura crítica** | `vw_variacoes_classificadas` filtrada (cobertura crítica + demanda ativa) | `vw_estoque_ruptura_critica` |
| **4 · Ruptura disfarçada** | `vw_variacoes_classificadas` filtrada (demanda_status='ruptura_disfarcada') | `vw_estoque_ruptura_disfarcada` |

**Adiados pra futuro** (com motivo):
- **Card 5 · Cobertura por tecido** — tecido entra mais em produção/análise. Vendas viajam por ref, não por tecido. Quando entrar, vai ler de `amicia_data` user_id='ficha-tecnica'.
- **Card 6 · Reposição sugerida** — duplica a TabProdução existente. Tab Estoque não tem essa linha.

**Card 1 enxuto** (versão final aprovada):
- Linha 2 com 4 mini-cards: refs ativas / % saudáveis / % atenção / % ruptura crítica
- Topo com alerta condicional: "N refs cruzaram pra ruptura nas últimas 24h"
- **Sem** KPI grande de unidades totais (não pediu)
- **Sem** linha de projeção 7d/14d (não pediu)
- **Alerta de 24h fica como TODO Sprint 6.2** — precisa snapshot histórico de cobertura_status por dia que ainda não temos. Por enquanto card renderiza só a linha 2.

---

## 2. Decisões travadas (não revisitar sem motivo)

| # | Decisão | Implicação |
|---|---|---|
| 1 | Tecido vem de Ficha Técnica (`amicia_data` user_id='ficha-tecnica'.payload.produtos[*].tecido) | Sem tabela nova. Entra quando Card 5 voltar. |
| 2 | Card 2 = estoque total mês a mês via `ml_estoque_total_mensal` (Opção A pura, sem tecido) | Limitado ao histórico que a tabela já tem |
| 3 | Card 6 fora — sem duplicação com TabProdução | — |
| 4 | Card 1 = só linha 2 (4 mini-cards) + alerta topo (futuro) | Versão enxuta |
| 5 | Adicionar `escopo='estoque'` no `ia-cron.js` neste sub-sprint, com try/catch isolado e flag `estoque_enabled` em `ia_config` começando em `false` | Cron Corte e Marketplaces seguem intactos. Liga manualmente após validar. |

---

## 3. Plano de execução em 5 fases (1 commit por fase)

| Fase | Arquivo | O que faz |
|---|---|---|
| **1 · SQL views** | `sql/os-amicia/09_views_estoque.sql` | 4 views (esta fase) |
| **2 · Função orquestradora** | `sql/os-amicia/10_fn_estoque_insights.sql` | `fn_ia_estoque_insights()` retorna JSON pro Claude |
| **3 · Cron + flag** | edita `api/ia-cron.js` + `vercel.json` + INSERT em `ia_config` | Adiciona escopo='estoque' isolado, flag desligada |
| **4 · Endpoint dados** | `api/ia-estoque-dados.js` | GET admin-only, roteia por `?card=X` |
| **5 · UI** | `src/os-amicia/EstoqueCards.jsx` + edita `OsAmicia.jsx` | 4 cards + substitui placeholder |

Cada fase é commit isolado em `os-amicia-fase1`. Rollback é por fase.

---

## 4. Critério de "pronto"

- [ ] 4 views novas em `09_views_estoque.sql` rodando no Supabase
- [ ] `fn_ia_estoque_insights()` retornando JSON consistente
- [ ] `ia-cron.js` com `escopo='estoque'` isolado, sem quebrar Corte nem Marketplaces (validar com 1 execução manual antes de ligar)
- [ ] Flag `estoque_enabled` ligada em `ia_config` após validação manual
- [ ] `/api/ia-estoque-dados?card=X` respondendo os 4 cards (admin-only)
- [ ] Tab Estoque renderiza no preview substituindo o placeholder "entra no Sprint 6"
- [ ] QA visual no Safari mobile: 4 cards bonitos, ruptura crítica destacada
- [ ] Custo do mês em `ia_usage` continua < R$ 80
- [ ] Cron de Corte e Marketplaces seguem gerando insights normalmente

---

## 5. Garantia de não-regressão

A maior preocupação é não quebrar o cron de Corte (Sprint 3, em produção) nem o de Marketplaces (Sprint 4, em produção).

Padrão a seguir no `ia-cron.js` (mesmo do Sprint 4):

```js
// 1. Corte (existente, intocado)
const insightsCorte = await gerarInsightsCorte();
await salvarInsights(insightsCorte, 'corte');

// 2. Marketplaces (existente, intocado)
if (ESCOPOS.marketplaces.enabled) {
  try {
    const m = await gerarInsightsMarketplaces();
    await salvarInsights(m, 'marketplaces');
  } catch (err) { console.error('mkt:', err); /* nao propaga */ }
}

// 3. Estoque (NOVO - try/catch isolado + flag em ia_config)
const estoqueOn = await getConfig('estoque_enabled', false);
if (estoqueOn === true) {
  try {
    const e = await gerarInsightsEstoque();
    await salvarInsights(e, 'estoque');
  } catch (err) { console.error('estoque:', err); /* nao propaga */ }
}
```

Se Estoque der erro, Corte e Marketplaces não são afetados.

---

## 6. Itens explicitamente fora deste sub-sprint

- Modal "Explicar esta decisão" (Sprint 6.2)
- Botões feedback Sim/Parcial/Não na UI (Sprint 6.2)
- Tabela `ordens_corte` + tela Sugestão de Corte (Sprint 6.3)
- Validação pixel contra `Preview_OS_Amicia.html` (Sprint 6.4)
- Card 5 Estoque (Cobertura por tecido) — futuro
- Card 6 Estoque (Reposição) — vai pela TabProdução
- Snapshot histórico diário de `cobertura_status` (necessário pro alerta 24h do Card 1)

---

## 7. Próximas fases (depois do commit da Fase 1)

Quando a Fase 1 for confirmada no Supabase via smoke test, partimos pra Fase 2 (`fn_ia_estoque_insights()`). Cada fase só começa quando a anterior é validada.

---

## 8. Histórico real de execução (atualizado 22/04/2026)

O plano original previa **5 fases**. Na execução foram **9 fases** + 1 bugfix lateral + calibração de thresholds. Cada item abaixo tem commit correspondente.

### Fases 1 a 5 (plano original — executadas conforme briefing)

| Fase | Commit | O que entregou |
|---|---|---|
| 1 | `71585a4` + fix `3763a43` | `09_views_estoque.sql` — 4 views base. Fix corrigiu bug `BOOL_OR` que agregava por ref e inflava ruptura pra 97,6%. |
| 2 | `05f68b2` | `10_fn_estoque_insights.sql` — função orquestradora retornando JSONB com 4 chaves pro Claude. |
| 3 | `953d55c` | `api/ia-cron.js` (+206 linhas) com escopo `estoque` isolado, kill switch via flag `estoque_enabled` (default `false`), 2 crons em `vercel.json` (07h30 / 14h30 BRT). |
| 4 | `9ef7eb9` | `api/ia-estoque-dados.js` — endpoint admin-only `?card=X` com cache `s-maxage=60`. |
| 5 | `b89bc8d` + fix alinhamento `20179b0` | `src/os-amicia/EstoqueCards.jsx` (606 linhas) integrado em `OsAmicia.jsx`. Card 2 agrupa por ref com expand local (decisão B opção C). |

### Bugfix lateral (não previsto)

| Commit | Causa | Impacto |
|---|---|---|
| `0e643eb` | Chave `}` extra na linha 589 do `api/ml-webhook.js` (commit pré-existente `0c4d922`) causando `SyntaxError` em rajada | Apenas preview; main estava limpo. Fix de -1 linha validado com `node --check`. |

### Fases 6 a 9 (descobertas durante validação)

A validação visual com dados reais expôs 4 lacunas conceituais que não estavam no briefing:

| Fase | Commit | Descoberta | Solução |
|---|---|---|---|
| 6 | `cf3d3af` + fix ordem colunas `6267523` | Cobertura ignorava peças em corte (estoque ML era a única fonte) | Recriou `vw_variacoes_classificadas` adicionando matriz `detalhes.tamanhos × detalhes.cores` via `jsonb_array_elements` em 2 níveis. Nova coluna `pecas_em_corte` + `cobertura_projetada_dias`. **Bug crítico no fix:** Postgres exige preservar ordem de colunas em `CREATE OR REPLACE VIEW` — colunas novas tiveram que ir pro FINAL após `confianca`. |
| 7 | `c464548` | Variações com 5-10 peças entravam em "excesso" só por ter cobertura > 45d (volume absoluto irrelevante) | Threshold novo `excesso_min_pecas` em `ia_config`. Regra: `cobertura > 45d AND (estoque + corte) >= N peças → excesso`. Granularidade ref+cor+tam (Interpretação 1 de 2 oferecidas). |
| 8 | `eb69635` | **Descoberta arquitetural crítica:** Sprint 2 lia cortes de `amicia_data/salas-corte` (estimativa pré-corte com matriz). Realidade operacional: cortes em produção vivem em `amicia_data/ailson_cortes` (módulo Oficinas Cortes), normalmente **sem matriz** — só `{nCorte, ref, qtd, oficina, data, entregue, pago}`. | Trocou fonte. Lógica em 3 branches: (a) com matriz → granularidade exata; (b) sem matriz mas ref tem `vendas_30d` → distribui proporcional pelas variações ativas; (c) sem matriz e ref sem vendas → fallback uniforme por estoque ML. Filtro: `entregue=false`. CTE `refs_com_venda` decide fonte (vendas OU estoque, **nunca mistura** dentro da mesma ref pra não bagunçar a proporção). |
| 9 | `891f578` | Card 1 mostrava 104 em ruptura crítica, Card 2 listava 90. Causa: `vw_estoque_saude_geral` contava `cobertura_status IN (critica,zerada)` SEM filtro de demanda; `vw_estoque_ruptura_critica` aplicava `demanda_status='ativa'` (Gatekeeper). | Unificou base: todas as 4 contagens (saudável/atenção/crítica/excesso) usam `demanda_status='ativa'`. `variacoes_ruptura_disfarcada` virou métrica complementar via SELECT separado. `unidades_total` preservado sem filtro (deve bater com "Estoque total" do app principal). |

### Calibração de thresholds (sem novo arquivo SQL — só `UPDATE` em `ia_config`)

Após observar dados reais por faixas, 4 thresholds foram ajustados com Ailson:

| Chave | Valor inicial | Valor final | Racional |
|---|---|---|---|
| `cobertura_saudavel_max_dias` | 45 | **60** | Moda feminina com tendência tem variações que vivem 50-55d sem ser "excesso" real |
| `excesso_min_pecas` | 15 | **20** | Volume mínimo mais conservador pra entrar em excesso |
| `gatekeeper_vendas_ativa_15d` | 6 | **8** | Foco em variações com giro real (>=1 venda em ~2 dias). Tira borderline (38 das 90 críticas tinham 6-7 vendas/15d) |
| `gatekeeper_vendas_fraca_max_15d` | 5 | **7** | Mantém continuidade lógica: 1-7 fraca, 8+ ativa |

---

## 9. Configuração final em `ia_config` (estado em 22/04/2026)

```sql
-- Thresholds operacionais validados:
gatekeeper_vendas_ativa_15d        = 8     (>=8 vendas/15d → ativa)
gatekeeper_vendas_fraca_min_15d    = 1
gatekeeper_vendas_fraca_max_15d    = 7
ruptura_disfarcada_min_mes_ant     = 12
cobertura_critica_dias             = 10    (não tocado, calibrado)
cobertura_saudavel_min_dias        = 22    (não tocado)
cobertura_saudavel_max_dias        = 60    (era 45)
excesso_min_pecas                  = 20    (era 15)
devolucao_global_pct               = 10
estoque_enabled                    = false (LIGAR MANUALMENTE quando quiser cron IA)
```

### Estado dos números após todos os refinamentos (com threshold 8/7)

A serem confirmados após `UPDATE` final aplicado. Estimativa baseada em simulação:

- `variacoes_total`: ~280 (antes 330, base mais enxuta com gatekeeper 8)
- `ruptura_critica`: ~52 (antes 90)
- `excesso`: ~120 (antes 149)
- `pct_ruptura_critica`: ~18%
- Card 1 e Card 2 batem exatamente

### Sinal operacional importante levantado

Das 90 variações em ruptura crítica (estado pré-threshold 8), **75 estavam concentradas em 14 refs sem nenhum corte chegando em oficina**. Top 5: 2700, 2851, 2708, 2927, 2891 (todos com 6+ variações zeradas, vendas relevantes, zero peças em corte). Único caso com corte chegando: ref 2601 (51 peças pra 15 variações = ~3 peças/variação, insuficiente). Esse é o tipo de insight que a IA do cron vai destacar quando flag for ligada.

---

## 10. Lacunas de design ↔ implementação descobertas (telas pendentes)

Durante a fase final do Sprint 6.1, Ailson identificou que **2 telas implementadas não batem com o contrato visual** definido em `docs/pacote-os-amicia/`:

### Tela 1 · TabProdução (Sprint 6.5 futuro)

**Contrato visual:** `docs/pacote-os-amicia/05_Tela_Sugestao_Corte.html` (1290 linhas, autocontido)

**Implementado hoje:** versão simplificada feita no Sprint 3, com cards básicos (título, resumo, ação textual, botões Sim/Parcial/Não). Falta tudo que o preview prevê.

**Componentes do preview que não existem na implementação:**
- Pills de status (Crítico / Confiança Alta / SCORE 94)
- Validade ("válida por 7 dias · expira 26/04")
- Bloco "Grade do enfesto" com edit inline (1P/1G/2GG, módulos, peça pequena/média/grande)
- Bloco "Cores e rolos" com edit inline (swatches de cor, qtd de rolos, adicionar/remover)
- Tabela "Estimativa de peças · cor × tamanho" calculada dinamicamente
- Total em evidência ("10 rolos · ≈200 peças estimadas")
- Bloco "Por quê" com justificativa estruturada + link "ver análise completa"
- Aviso de validade 7 dias com aprendizado
- Ações: Sim, Editar (modal), Não, Explicar (modal)
- Bloco "Gerar Ordem de Corte" com animação após Sim/Editar
- 3 modais separados (análise completa, editar, explicar)

**Dependências de backend** (provavelmente faltam no `fn_ia_cortes_recomendados()` atual):
- Score numérico (0-100) por ref
- Validade (timestamp expiração)
- Matriz cor×tamanho calculada (não só ref+cor+rolos)
- Ranking da ref (posição na curva A/B/C)
- Distribuição percentual de cores
- Grade do enfesto (módulos por tamanho com limite por tipo de peça)

**Plano de Sprint 6.5 (esboço):**
1. Auditar `fn_ia_cortes_recomendados()` — o que já retorna vs o que falta
2. Estender SQL pra fornecer todos os dados da UI (score, validade, matriz, ranking)
3. Adaptar/criar endpoint
4. Refazer ProducaoCards.jsx (ou novo SugestaoCorte.jsx) com todos os blocos
5. Modais (análise completa, editar, explicar)
6. Gerar Ordem de Corte

**Estimativa:** ~800-1500 linhas de React + extensões SQL. Sprint próprio dedicado.

**Prioridade Ailson:** **fazer ANTES da Home** (decisão 22/04).

### Tela 2 · Home (Sprint 6.6 futuro)

**Contrato visual:** `docs/pacote-os-amicia/03_Preview_OS_Amicia.html` linhas 872-1030 (área `view-home`)

**Implementado hoje:** desconhecido / provavelmente não bate (não auditado em detalhe).

**5 blocos previstos:**
1. **Cabeçalho** — Saudação ("Bom dia, Ailson"), data, botão "Perguntar à IA" com badge restantes
2. **Termômetro Marketplaces** — Receita acumulada do dia + média 30d + variação 7v7 + canais ativos
3. **Resumo Operacional** — 3 linhas clicáveis pra Estoque/Produção/Marketplaces com counters de problema
4. **Alertas Críticos do Dia** — Top 5 com score (81-94), pills coloridos por área
5. **Oportunidades do Dia** — Top 3 com score (78-84)
6. **Destaque da Semana** — "Melhor notícia" + "Pior notícia" lado a lado

**Plano de Sprint 6.6 (esboço):** definir ao iniciar. Dependências de dados ainda não mapeadas.

---

## 11. Pendências imediatas (próxima sessão)

| Item | Prioridade | Notas |
|---|---|---|
| **Sprint 6.5 — Refazer TabProdução** | **Alta** | Decisão Ailson 22/04: ANTES da Home |
| **Sprint 6.6 — Refazer Home** | Média | Após 6.5 |
| Ligar flag `estoque_enabled = true` | Baixa (manual, quando quiser) | `UPDATE ia_config SET valor = 'true'::jsonb WHERE chave = 'estoque_enabled'`. Próximo cron 07h30/14h30 BRT gera insights via Claude. Custo estimado +R$15/mês. |
| Sprint 6.2 — Modal Explicar Decisão + UI feedback | Média | Estava planejado pré-6.5/6.6 mas Ailson priorizou telas |
| Sprint 6.3 — Tabela `ordens_corte` + tela Sugestão de Corte | Média | Sobrepõe parcial com Sprint 6.5 |

---

## 12. Arquivos novos/alterados no Sprint 6.1 (referência rápida)

```
sql/os-amicia/
  09_views_estoque.sql                  (Fase 1)
  10_fn_estoque_insights.sql            (Fase 2)
  11_seed_estoque_flag.sql              (Fase 3)
  12_fase6_cobertura_com_oficinas.sql   (Fase 6)
  13_fase7_excesso_por_volume.sql       (Fase 7)
  14_fase8_cortes_oficinas.sql          (Fase 8)
  15_fase9_saude_coerente.sql           (Fase 9)

api/
  ia-cron.js                            (Fase 3 - +206 linhas)
  ia-estoque-dados.js                   (Fase 4 - novo)
  ml-webhook.js                         (bugfix 0e643eb - chave extra)

src/os-amicia/
  EstoqueCards.jsx                      (Fase 5 - novo, 606 linhas)
  OsAmicia.jsx                          (Fase 5 - +28 linhas)

vercel.json                             (Fase 3 - +2 crons)
```

Branch: `os-amicia-fase1`. Último commit: `891f578`.

