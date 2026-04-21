# HANDOFF · Sprint 6.1 · OS Amícia · Tab Estoque

> Sub-sprint do Sprint 6 (Frontend das áreas) — recortado pra entregar Tab Estoque sem arrastar Modal Explicar / Feedback UI / ordens_corte (que ficam pra 6.2/6.3/6.4).
> Decisões travadas com Ailson em 21/04/2026.

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
