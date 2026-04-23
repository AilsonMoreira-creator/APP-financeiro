# 🚀 Sprint 5 · Briefing Completo (auto-contido)

> **Este documento é tudo que você precisa pra começar o Sprint 5 do OS Amícia.**
> Lê ele inteiro antes de qualquer código. Tudo que aconteceu nos Sprints 1-4
> está resumido aqui — você não precisa abrir chats antigos.

---

## 📌 Leitura obrigatória antes de tudo

Você é o Claude que vai implementar o **Sprint 5 do OS Amícia — UI rica do TabMarketplaces.**

Antes de **qualquer** código, confirme comigo que leu este arquivo inteiro devolvendo:
1. O que já está pronto dos Sprints 1-4 (backend + UI mínima)
2. O que é o Sprint 5 em uma frase
3. Quais 6 cards novos você vai adicionar à UI
4. Como os dados chegam até o React (fluxo API → componente)
5. O que é "Safari mobile ASCII trap" e por que importa

Só depois da confirmação, começa.

---

## 1. Quem é o Ailson e como ele trabalha

- **Nome:** Ailson Moreira, dono do Grupo Amícia, São Paulo
- **Negócio:** confecção feminina, ~R$1,2M/mês em marketplaces (Exitus, Lumia, Muniam)
- **Linguagem:** Português brasileiro sempre. Direto, técnico, hands-on
- **Estilo preferido:** opinião clara > análise neutra; "minha recomendação é X porque Y"
- **Canal:** Safari mobile iPhone + MacBook Safari. Quase tudo testado no celular
- **Ambiente:** roda SQL no Supabase SQL Editor. **Nunca peça pra ele colar service_role no chat**
- **Dica de ouro:** Ailson já executou 4 sprints. Ele está confortável com git/Supabase/Vercel mas prefere que você guie explicitamente. "Abre a tela X pra tirar print" em vez de "verifica se tá tudo ok"

---

## 2. Missão do Sprint 5 em uma frase

**Transformar o TabMarketplaces em dashboard operacional rico**, expondo visualmente
os dados que o Claude já está analisando no backend desde o Sprint 4.

Hoje o TabMarketplaces tem:
- Card 1 (Lucro do Mês) — admin-only, funcional
- Botão "Disparar agora" + feed de insights gerados pelo Claude

Falta adicionar os **Cards 2-7** (gráficos/tabelas visuais), pra o Ailson abrir o app e
ver o estado dos marketplaces rapidamente **sem precisar ler o texto de cada insight.**

---

## 3. O que JÁ está pronto (Sprints 1-4)

### Sprint 1: Casca do módulo
- `src/os-amicia/OsAmicia.jsx` — 4 áreas (Home, Estoque, Produção, Marketplaces)
- Paleta e tipografia oficiais definidas (`C` object)
- Componente `StatusCard`, SVG oficial

### Sprint 2: Views SQL do fluxo de corte
- `sql/os-amicia/05_views_corte.sql` — 10 views (Produção)
- `sql/os-amicia/06_fn_cortes_recomendados.sql` — função orquestradora

### Sprint 3: Cron + IA Produção
- `api/ia-cron.js` — motor geral (agora suporta ?escopo=producao|marketplaces)
- `api/ia-disparar.js` — admin dispara manual
- `api/ia-status.js`, `api/ia-feed.js`, `api/ia-feedback.js`
- `api/_ia-helpers.js` — supabase client + validarAdmin + getConfig
- Vercel crons 10h e 17h (produção)
- TabProducao na UI

### Sprint 4: Marketplaces backend + UI mínima
**SQL (rodar no Supabase se ainda não rodou):**
- `sql/os-amicia/07_views_marketplaces.sql` (828 linhas, ASCII puro)
  - `fn_calc_lucro_real(canal, custo, preco)` ← replica o React
  - 15 views: `vw_calc_*`, `vw_marketplaces_base`, `vw_lucro_marketplace_mes`,
    `vw_vendas_mensais_24m`, `vw_canais_comparativo`, `vw_contas_bling_*`,
    `vw_top_movers_*`, `vw_margem_por_produto_canal`, `vw_plano_ajuste_gradual`,
    `vw_oportunidades_margem`
- `sql/os-amicia/08_fn_marketplaces_insights.sql` (248 linhas)
  - `fn_ia_marketplaces_insights()` — orquestradora pro Claude

**APIs:**
- `api/ia-cron.js` — refactored com `ESCOPOS = { producao, marketplaces }`
  (prompts de sistema + fallback determinístico separados)
- `api/ia-disparar.js` — aceita `{ escopo }` no body
- `api/ia-lucro-mes.js` — endpoint GET admin-only pro Card 1

**UI:**
- `src/os-amicia/OsAmicia.jsx`:
  - `TabMarketplaces` (linha ~719) — botão disparar + feed + Card 1 topo
  - `Card1LucroMes` (linha ~941) — consome `/api/ia-lucro-mes`
  - `KpiMini` (linha ~1106) — mini-card por canal
  - reusa `CardInsight` do TabProducao

**Infra:**
- `vercel.json` — 4 crons ativos:
  - 10h00 produção, 17h00 produção (herdados do Sprint 3)
  - 10h15 marketplaces, 17h15 marketplaces (novos, offset 15min)

### Validações já feitas (dados reais Abril/2026)
- `fn_calc_lucro_real('mercadolivre', 41, 99.89) = 4.93` ✓ bate com card do app
- `vw_calc_custos` ref 2601 = R$41, ref 2700 = R$47 ✓ bate com screenshot
- `vw_lucro_marketplace_mes` Abril/26: ML R$33k, Shein R$25k, Shopee R$11k,
  TikTok R$737, **total ~R$70k lucro líquido** ← já validado via print
- `fn_ia_marketplaces_insights()` retorna JSON com 10 seções, todas com dados reais
- ia-cron com escopo=marketplaces não foi testado end-to-end ainda

---

## 4. O que FALTA fazer no Sprint 5

### Cards visuais a adicionar no TabMarketplaces (em ordem)

**Card 2 · Histórico 24 meses (gráfico)**
- Fonte: `GET /api/ia-marketplaces-dados?card=vendas_mensais_24m` (criar)
- View SQL: `vw_vendas_mensais_24m` (já existe)
- UI: gráfico de linhas empilhadas por canal (recharts ou canvas nativo)
- Eixo Y: unidades totais. Eixo X: mês. 1 linha por canal (ML/Shein/Shopee/TikTok/Meluni)
- Interação: clicar numa linha foca o canal, oculta outros

**Card 3 · Comparativo canais (tabela com variação)**
- Fonte: `GET /api/ia-marketplaces-dados?card=canais_comparativo`
- View SQL: `vw_canais_comparativo` (já existe)
- UI: tabela com 5 linhas (um por canal), colunas: ult7, ant7, var_7v7%, ult30, ant30, var_30v30%
- Cores nas variações (verde ≥ 0, vermelho < 0)

**Card 4 · Contas Bling (tabela + drill-down)**
- Fonte: `GET /api/ia-marketplaces-dados?card=contas_bling`
- Views: `vw_contas_bling_7v7` + `vw_contas_bling_concentracao_queda`
- UI: 3 linhas (Exitus/Lumia/Muniam) com pedidos, receita, variação
- Drill: clicar numa conta expande top 3 refs em queda daquela conta

**Card 5 · Top Movers (3 abas)**
- Fonte: `/api/ia-marketplaces-dados?card=top_movers`
- Views: `vw_top_movers_unificado` + `vw_top_movers_por_conta` + `vw_top_movers_cruzamento`
- UI: 3 abas: "Geral" | "Por conta" | "Cruzamento entre contas"
- Cada aba é uma tabela ordenável com ref/descrição/delta/var%

**Card 6 · Margens (heatmap + plano de ajuste)**
- Fonte: `/api/ia-marketplaces-dados?card=margens`
- Views: `vw_margem_por_produto_canal` + `vw_plano_ajuste_gradual`
- UI: grid de cores por ref × canal (vermelho < R$8, amarelo < R$10, verde ≥ R$10)
- Drill: clicar numa célula mostra o preço sugerido para atingir lucro R$10 e R$14

**Card 7 · Oportunidades de margem**
- Fonte: `/api/ia-marketplaces-dados?card=oportunidades`
- View: `vw_oportunidades_margem`
- UI: lista com ref + descrição + canal + lucro/peça + unidades_30d
- Destaque: refs com lucro ≥ R$15 e unidades < 5 (alto potencial)

### Endpoint único recomendado
Pra não criar 6 endpoints, faz 1 só:

```js
// api/ia-marketplaces-dados.js
// GET ?card=vendas_mensais_24m|canais_comparativo|contas_bling|top_movers|margens|oportunidades
// Não precisa admin (dados agregados, sem valor financeiro absoluto)
// Só admin se card=lucro_marketplace_mes (redireciona pra ia-lucro-mes existente)
```

---

## 5. Como o UI consome dados (fluxo)

```
Componente React (TabMarketplaces.jsx)
  ↓ useEffect + fetch
  GET /api/ia-marketplaces-dados?card=X
  ↓
  api/ia-marketplaces-dados.js (Vercel serverless)
  ↓ supabase.from('vw_X').select()
  ↓
  Postgres (Supabase) executa a view
  ↓ SELECT bling_vendas_detalhe, amicia_data, etc
  ↓
  retorna JSON → renderiza no React
```

Tempo esperado: 200-800ms por endpoint. View complexa (top_movers_cruzamento) pode chegar a 2s.

---

## 6. Armadilhas que você precisa saber

### Safari mobile ASCII trap
O Ailson testa tudo no Safari iPhone. O clipboard do Safari mobile às vezes **corrompe
caracteres Unicode** (`→`, `·`, `─`, travessões) ao colar SQL longo no Supabase SQL Editor.
**Todos os arquivos SQL do projeto são ASCII puro** (sem acentos, sem setas, sem bullets).
Mantém esse padrão. Se for escrever um SQL novo, roda `python3 -c "print(sum(1 for b in
open('f.sql','rb').read() if b>127))"` pra confirmar 0 non-ASCII antes de commitar.

### UI render em mobile
O Ailson usa Safari PWA no iPhone. Layouts com grid `repeat(3,1fr)` ficam bons no mobile só se
`gap=8` e `fontSize ≤ 13`. Pra gráfico do Card 2, recharts funciona mas carrega 200kb+. Se
o bundle ficar grande, prefere canvas nativo ou SVG.

### Safari PWA não tem localStorage persistente em "modo privado"
Não use localStorage pra cachear dados que devem persistir entre sessões — usa só pra cache
durante a mesma sessão. Dados que persistem vão pro Supabase.

### Fórmulas da Calculadora são HARDCODED no React
`CALC_PLATS` e `calcLucroReal` no `src/App.tsx` linhas 6189-6209 são a fonte da verdade.
**Se mudar a fórmula de lucro, tem que mudar em 2 lugares:** React + `fn_calc_lucro_real`
no Postgres (07_views_marketplaces.sql). Isso é conhecido. Sprint 8 planeja externalizar.

### Card 1 é admin-only rígido
Feature existente. Não exponha lucro absoluto pra usuários não-admin. Se criar endpoints
que retornem dados financeiros detalhados (receita, lucro bruto/líquido), **usa o helper
validarAdmin() de `_ia-helpers.js`** com dupla checagem: `validarAdmin()` + `admin.user.admin === true`.

### Filtro ia_feed
O `api/ia-feed.js` aceita `?area=producao|marketplaces`. O TabMarketplaces já usa `area=marketplaces`.
Se criar outras áreas (Estoque no Sprint 6), segue o padrão.

### Realtime (Sprint 7, não agora)
Existe `sync-financeiro` / `sync-oficinas` / `sync-usuarios` / `sync-agenda` no Supabase Realtime.
Insights não são realtime hoje — o usuário precisa dar Pull/F5 ou clicar "Atualizar feed" pra ver
novos. Sprint 7 vai adicionar um channel `ia-insights-live`. **Não faça isso no Sprint 5.**

---

## 7. Passo 0 — Verificar que Sprint 4 está rodando

Antes de qualquer código novo, peça ao Ailson pra rodar essas 3 queries e confirmar:

```sql
-- 1. Views existem?
SELECT viewname FROM pg_views
WHERE schemaname='public' AND viewname LIKE 'vw_%market%'
ORDER BY viewname;
-- Esperado: vw_canais_comparativo, vw_contas_bling_7v7, vw_contas_bling_concentracao_queda,
-- vw_lucro_marketplace_mes, vw_margem_por_produto_canal, vw_marketplaces_base,
-- vw_oportunidades_margem, vw_plano_ajuste_gradual, vw_top_movers_conta,
-- vw_top_movers_cruzamento, vw_top_movers_unificado, vw_vendas_mensais_24m

-- 2. Função orquestradora existe?
SELECT proname FROM pg_proc WHERE proname LIKE '%marketplaces%';
-- Esperado: fn_ia_marketplaces_insights

-- 3. Há insights de marketplace gerados?
SELECT COUNT(*), MIN(created_at), MAX(created_at)
FROM ia_insights WHERE escopo='marketplaces';
-- Se 0: o cron ainda não rodou (ou falha) — investigar antes de começar Sprint 5
```

Se algum falhar, NÃO comece o Sprint 5. Investiga primeiro.

---

## 8. Branch e workflow

- **Branch:** `os-amicia-fase1` (mesma do Sprint 4)
- **Deploy preview Vercel:** `app-financeiro-git-os-am-542748-ailsonmoreira-creators-projects.vercel.app`
- **Git token Ailson:** pedir ao Ailson quando precisar (ele tem configurado no ambiente)
- **Padrão de commit:** `feat(os-amicia): sprint 5 - <descrição curta>`
- **Sempre ASCII-only em SQL**, validar com node --check em JS
- **Sempre confirmar** com Ailson antes de commit gigante (>5 arquivos)

---

## 9. Arquivos relevantes (pra referência rápida)

```
sql/os-amicia/
├── 01_tables.sql                    ← Sprint 1 (tables ia_*)
├── 02_seed_ia_config.sql            ← Sprint 1
├── 03_seed_ia_sazonalidade.sql      ← Sprint 1
├── 04_policies.sql                  ← Sprint 1 (RLS)
├── 05_views_corte.sql               ← Sprint 2 (10 views Produção)
├── 06_fn_cortes_recomendados.sql    ← Sprint 2 (orquestradora Produção)
├── 07_views_marketplaces.sql        ← Sprint 4 (15 views Marketplaces)
├── 08_fn_marketplaces_insights.sql  ← Sprint 4 (orquestradora Marketplaces)
├── DEPLOY.md                         ← ordem de execução
└── HANDOFF_SPRINT5.md               ← este arquivo

api/
├── _ia-helpers.js                   ← Sprint 3 (supabase + validarAdmin + getConfig)
├── ia-cron.js                        ← Sprint 3 + refactor Sprint 4 (ESCOPOS)
├── ia-disparar.js                   ← Sprint 3 + patch Sprint 4 (aceita escopo)
├── ia-status.js                      ← Sprint 3
├── ia-feed.js                        ← Sprint 3
├── ia-feedback.js                    ← Sprint 3
├── ia-lucro-mes.js                  ← Sprint 4 (admin-only Card 1)
└── [Sprint 5 vai criar: ia-marketplaces-dados.js]

src/os-amicia/
├── OsAmicia.jsx                     ← contém TabProducao + TabMarketplaces
└── README.md
```

---

## 10. Template da primeira mensagem do Sprint 5

Quando abrir o próximo chat, começa assim:

> "Oi Claude. Vou abrir o Sprint 5 do OS Amícia — UI rica do TabMarketplaces.
> O handoff está em `sql/os-amicia/HANDOFF_SPRINT5.md` na branch `os-amicia-fase1`.
>
> Lê ele antes de qualquer código e me devolve as 5 confirmações do Passo 0.1.
> Quando confirmar, eu rodo as 3 queries do Passo 0 do SPRINT 5 pra garantir que
> tudo do Sprint 4 está ok, e aí começamos."

Esse prompt garante que o Claude leia o handoff inteiro antes de codar.
