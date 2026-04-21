# 📦 OS Amícia · Handoff para Sprint 2

**Gerado em:** 21/04/2026 (madrugada)
**Autor:** sessão de implementação Sprint 1
**Destinatário:** próximo chat / Claude que pegar o Sprint 2

> **Leia esse arquivo primeiro, inteiro, antes de escrever qualquer código.**
> Depois leia, nesta ordem: `sql/os-amicia/README.md`, `sql/os-amicia/DEPLOY.md`,
> e só então o Prompt Mestre (`02_PROMPT_MESTRE_OS_Amicia.md` do pacote original).

---

## 1. Status atual

✅ **Sprint 1 CONCLUÍDO** e validado em preview em 21/04/2026.

Entregue:
- 7 tabelas novas no Supabase (`ia_insights`, `ia_feedback`, `ia_config`,
  `ia_usage`, `ia_sazonalidade`, `ml_vendas_lucro_snapshot`,
  `calc_historico_snapshot`) + índices + triggers `updated_at`
- 55 configs iniciais em `ia_config` (pode ser alterado sem deploy)
- 5 datas de sazonalidade em `ia_sazonalidade` (ano 2026)
- RLS ativo com deny-anon em tabelas sensíveis
- 3 endpoints serverless: `/api/ia-config` (GET/PUT), `/api/ia-status` (GET),
  `/api/ia-disparar` (POST — placeholder até Sprint 3)
- Helper compartilhado `/api/_ia-helpers.js`
- Módulo React isolado em `src/os-amicia/OsAmicia.jsx`
- 5 alterações no `src/App.tsx`, todas **atrás do feature flag `VITE_OS_AMICIA_ENABLED`**
- Documentação: README + DEPLOY.md na pasta `sql/os-amicia/`

**Branch:** `os-amicia-fase1`
**2 commits:** `0194684` (feat inicial) + `a2a0890` (fix SUPABASE_KEY)
**Preview Vercel:** `app-financeiro-git-os-am-542748-ailsonmoreira-creators-projects.vercel.app`
**Status preview:** funcionando — smoke test OK (ícone aparece, módulo abre, painel responde)

---

## 2. Credenciais

### 🔐 GitHub

```
Token: [pedir ao Ailson no primeiro mensagem do próximo chat]
Email: Exclusivo@amicialoja.com.br
User:  AilsonMoreira-creator
Repo:  AilsonMoreira-creator/APP-financeiro
```

**⚠️ Este token foi usado em 3+ chats já. Recomendado rotacionar quando fechar
o Sprint 2.** Settings → Developer settings → Personal access tokens → Tokens
(classic) → Generate new token.

### 🤖 Anthropic API

Chave oficial **já está no Vercel** como `ANTHROPIC_API_KEY` (usada também pelo SAC).
Marcada em **Preview e Production**. Confirma em: Vercel → Settings → Environment Variables.

A chave que o Ailson colou no chat durante a sessão de 21/04 **não está sendo usada**
(o Vercel já tinha a oficial). Ailson pode revogar no console.anthropic.com/settings/keys
sem impacto.

### 🗄️ Supabase

- `SUPABASE_URL` — já existe no Vercel
- `SUPABASE_KEY` — **esta é a service_role** (padrão do app, não é a anon).
  Já existia antes do OS Amícia (usada por `ml-skumap-*`, `_ml-helpers.js`)
- O helper `_ia-helpers.js` aceita tanto `SUPABASE_KEY` quanto
  `SUPABASE_SERVICE_ROLE_KEY` por compatibilidade

**Nunca pedir pra Ailson colar a service role no chat.** Ele roda SQLs direto
no SQL Editor do Supabase (padrão estabelecido na Fase A e reforçado no Sprint 1).

### 🚩 Feature flag

`VITE_OS_AMICIA_ENABLED=true` — só em **Preview** no Vercel. Não marcar
Production até merge + decisão explícita do Ailson.

---

## 3. Estado do repo

```
AilsonMoreira-creator/APP-financeiro
├── main                  ← produção (não tem nada do OS ainda)
└── os-amicia-fase1       ← branch ativa do OS Amícia
```

Tamanho do App.tsx em 21/04: **8.981 linhas** (cresceu ~20 linhas do Sprint 1).

Árvore criada pelo Sprint 1:
```
api/
├── _ia-helpers.js          ← cliente supabase service role + validarAdmin + custo
├── ia-config.js            ← GET/PUT thresholds (admin-only no PUT)
├── ia-status.js            ← GET painel admin
└── ia-disparar.js          ← POST placeholder (Sprint 3 ativa)

sql/os-amicia/
├── 01_tables.sql           ← 7 tabelas + índices + triggers
├── 02_seed_ia_config.sql   ← 55 configs
├── 03_seed_ia_sazonalidade.sql  ← 5 datas
├── 04_policies.sql         ← RLS deny-anon
├── README.md               ← ordem de execução
└── DEPLOY.md               ← checklist smoke test

src/os-amicia/
├── OsAmicia.jsx            ← shell 4 tabs + painel saúde
└── README.md               ← princípios arquiteturais

src/App.tsx (5 mudanças, todas com feature flag):
├── linha ~9:    import OsAmicia from './os-amicia/OsAmicia'
├── linha ~213:  const SvgOSAmicia = ({size=32}) => (...)
├── linha ~491:  spread condicional no array `modules`
├── linha ~3932: "osamicia" em TODOS_MODULOS
├── linha ~8854: spread condicional no array `homeModules`
└── linha ~8927: {active==="osamicia" && ...}
```

---

## 4. Decisões travadas (últimas 3 sessões)

Estas decisões complementam/corrigem o Prompt Mestre original:

### Produto

1. **Custo = campo único (custo total)**, não componentes separados.
   Mata divergência "7 vs 9 componentes". `calc_historico_snapshot` guarda
   apenas `custo_total`, não o breakdown.

2. **Rendimento de Sala de Corte em 2 níveis de fallback (nunca manual):**
   - **N1**: ref com ≥1 corte histórico → usa rendimento próprio, confiança alta
   - **N2**: ref sem histórico → busca palavra-chave no título e usa média da
     categoria com piso de 2 cortes, confiança média
   - **Nunca N3**: OS sempre sugere rolos, nunca só "quantidade de peças"
   - Palavras-chave (ordem importa, 1º match vence):
     vestido · macacão/macacao · calça/calca · bermuda · shorts/short · saia ·
     blusa · top · cropped · regata · camisa · conjunto · jaqueta · casaco · blazer
   - Isso está em `ia_config` nas chaves `rendimento_n1_min_cortes_ref`,
     `rendimento_n2_min_cortes_categoria`, `rendimento_categorias_chaves`

3. **Tamanho "Único" fora do OS.** Em cortes novos, o OS não sugere Único.
   Cortes antigos com Único continuam válidos, só não são propostos pelo OS.

4. **Fase A preparou os 5 campos da Fase B em `ordens_corte`.**
   `origem`, `insight_id`, `aprovada_por`, `aprovacao_tipo`, `validade_ate`
   **já existem** no schema. Não precisa ALTER TABLE.

5. **Calculadora aplicar bug** — o botão "Aplicar Regras" no tab Regras da
   Calculadora só faz `alert()`, não persiste. **Bug conhecido.** Decisão:
   fix via Opção A (setState no pai + upsert em chave `calc-regras`) no
   Sprint 4 junto com migração pra `ia_config`.

### Arquitetura

6. **Módulo 100% independente do App.tsx.** Pasta `src/os-amicia/` tem código
   próprio. Imports de funções do App.tsx = proibido. Debounce/merge/save
   replicados dentro do próprio módulo quando necessário.

7. **Branch separada + feature flag** (3 camadas de defesa: branch, flag, RLS).

8. **SQLs versionados no repo**, não aplicados via código. Ailson roda manual
   no SQL Editor pra ter visibilidade total do que muda.

9. **Histórico de vendas 14 meses já está implementado** (mencionado mas não
   documentado no Prompt Mestre original). Vive em `amicia_data` user_id
   `historico_vendas`. Fonte de Jan/2025–Fev/2026, 50 refs, 10 canais,
   com Ago/25 e Nov/25 extrapolados × 0.85. Acessado por `HistoricoVendas.jsx`
   dentro de Bling → Produtos → 📊 Histórico.

10. **Ideris é hub dos 11 canais de marketplace.** App lê estoque apenas do
    ML Lumia via `/api/ml-estoque` — como Ideris espelha, 1 canal = todos.
    Sync catálogo Bling também lê só Lumia (catálogo Lumia = universo completo).

---

## 5. Pendências conhecidas

### 🟡 Não bloqueiam Sprint 2, mas devem ser tratadas

- **Rotacionar chave Anthropic colada no chat** (ou revogar se não for usar)
- **Rotacionar token GitHub** depois de fechar Sprint 2
- **Bug da Calculadora `aplicar()`** — fix no Sprint 4 (documentado acima)
- **Warnings pré-existentes no build** (Duplicate key "border" linhas 2980/3092).
  NÃO foram introduzidos pelo Sprint 1. Não resolver aqui.
- **App.tsx com 8.981 linhas** — refactor algum dia, não agora

### 🔵 Verificações que valem fazer antes do Sprint 2

- [ ] `bling_vendas_detalhe` existe como **tabela Supabase**? Ou é só cache
      em memória / localStorage? O Sprint 2 depende disso como tabela real.
      **Rodar a query de reconhecimento abaixo.**
- [ ] `ml_ref_atual` e `ml_sku_ref_map` existem? Schemas?
- [ ] Logar como usuário não-admin no preview e confirmar que OS não aparece
      (admin-only na v1.0)

---

## 6. Plano do Sprint 2

**Objetivo:** 10 views SQL + função `fn_ia_cortes_recomendados()` do fluxo de corte.

**Duração estimada:** 1 sessão longa ou 2 curtas.

### Passo 0 — Query de reconhecimento (ANTES de escrever qualquer view)

Rodar no SQL Editor do Supabase:

```sql
-- Conferir se bling_vendas_detalhe existe e quais colunas tem
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'bling_vendas_detalhe'
ORDER BY ordinal_position;

-- Conferir existência das outras tabelas esperadas
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'bling_vendas_detalhe', 'ml_ref_atual', 'ml_sku_ref_map',
    'ml_scf_ref_map', 'bling_resultados', 'amicia_data'
  );

-- Se bling_vendas_detalhe não existir, ver se os dados estão só em cache:
SELECT column_name FROM information_schema.columns
WHERE table_name LIKE '%bling%' OR table_name LIKE '%venda%'
ORDER BY table_name, ordinal_position;
```

**Se `bling_vendas_detalhe` não existir como tabela**, PARAR e perguntar ao
Ailson antes de prosseguir — pode ser necessário criar primeiro ou usar outra
fonte (possivelmente `historico_vendas` do `amicia_data`).

### Passo 1 — Criar arquivo `sql/os-amicia/05_views_corte.sql`

Implementar 10 views **na ordem** (dependências importam):

1. `vw_variacoes_classificadas` — base ref+cor+tam com métricas e 3 classificações
2. `vw_refs_elegiveis_corte` — refs com variação crítica + demanda ativa
3. `vw_tamanhos_em_gap_por_ref` — tamanhos específicos em gap + proporção
4. `vw_grade_otimizada_por_ref` — aplica regra 6/8 módulos (via `ia_config`)
5. `vw_distribuicao_cores_por_ref` — participação + rolos por cor
6. `vw_rendimento_sala_corte` — **cuidado aqui**: cruza ref × sala × tecido,
   e implementa o fallback N1→N2 por categoria (ver decisão #2 acima)
7. `vw_projecao_22_dias_por_ref` — cenários A/B/C
8. `vw_ranking_curvas_bling` — classifica A/B/C
9. `vw_tendencia_cor_catalogo` — tendência agregada
10. `vw_cortes_recomendados_semana` — consolidadora final + semáforo

Todas as views leem thresholds de `ia_config` via LATERAL JOIN ou subquery,
nunca hardcoded. Ex:
```sql
LEFT JOIN LATERAL (
  SELECT (valor::int) AS cobertura_alvo
  FROM ia_config WHERE chave = 'cobertura_alvo_dias'
) AS cfg_ca ON true
```

### Passo 2 — Criar `sql/os-amicia/06_fn_cortes_recomendados.sql`

Função `fn_ia_cortes_recomendados()` que orquestra as 10 views e devolve
JSON pronto pro Claude consumir:

```sql
CREATE OR REPLACE FUNCTION fn_ia_cortes_recomendados()
RETURNS jsonb AS $$
...
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Passo 3 — Testar direto no SQL Editor

```sql
SELECT fn_ia_cortes_recomendados();
```

Retorno esperado: JSON com array de refs recomendadas, cada uma com grade,
cores, rolos sugeridos, sala recomendada, confiança.

### Passo 4 — Commit e push

Branch `os-amicia-fase1` — não criar nova.

### Passo 5 — Atualizar `handoff-sprint2.md` pra o Sprint 3

Sprint 3 é onde a mágica acontece: cron 07h/14h + integração Claude Sonnet 4.6
+ fallback determinístico.

---

## 7. Arquivos-chave (onde está o quê)

Se precisar de referência rápida:

| Precisa saber... | Arquivo |
|---|---|
| Schema das 7 tabelas | `sql/os-amicia/01_tables.sql` |
| Thresholds ajustáveis | `sql/os-amicia/02_seed_ia_config.sql` |
| Padrão de endpoint serverless | `api/bling-health.js` (exemplo existente) |
| Como validar admin | `api/_ia-helpers.js` → `validarAdmin()` |
| Schema da `ordens_corte` (Fase A) | `sql/ordens_corte_schema.sql` |
| Cliente Supabase no frontend | `src/supabase.js` |
| Módulo Oficinas (cortes) | `src/App.tsx` linha ~3519 (`OficinasContent`) |
| Módulo Salas de Corte | `src/App.tsx` linha ~5362 (`SalasCorteContent`) |
| Módulo Bling | `src/App.tsx` linha ~4488 (`BlingContent`) |
| Módulo Calculadora | `src/App.tsx` linha ~6196 (`CalculadoraContent`) |
| Ordem de Corte (Fase A UI) | `src/OrdemDeCorte.jsx` |
| Fila de Corte (Fase A UI) | `src/FilaDeCorte.jsx` |
| Histórico de Vendas 14 meses | `src/HistoricoVendas.jsx` |

---

## 8. O que NÃO mexer

Regras duras:

- ❌ **Não importar nada do App.tsx dentro de `src/os-amicia/`.**
  Se precisar de dados, receba via props OU consulte Supabase direto.
- ❌ **Não escrever em tabelas que não sejam `ia_*`, `ml_vendas_lucro_snapshot`,
  `calc_historico_snapshot`** (exceto INSERT em `ordens_corte` ao aprovar
  sugestão — mas isso é Sprint 6, não 2).
- ❌ **Não mexer em policies/RLS de tabelas pré-existentes.**
- ❌ **Não fazer refactor do App.tsx.** Aquelas 5 linhas atrás do feature flag
  são o contrato. Se precisar mexer na 6ª, parar e perguntar ao Ailson.
- ❌ **Não alterar `TAMANHOS_DETALHE` ou `TAMANHOS_PADRAO`** existentes.
- ❌ **Não fazer deploy em Production.** Sprint 2 vive 100% em preview.

---

## 9. Como abrir o próximo chat

Sugestão de abertura (copiar e colar):

> "Sprint 1 do OS Amícia concluído e validado em preview. Agora partir pro
> Sprint 2 — views SQL do fluxo de corte. Usar branch `os-amicia-fase1` que
> já existe. Leia primeiro o arquivo `sql/os-amicia/HANDOFF_SPRINT2.md`
> do repo (isso te dá 100% do contexto). Começar pela query de reconhecimento
> do `bling_vendas_detalhe`. Meu token GitHub ainda é o mesmo, pode clonar."

O Claude que pegar vai:
1. Clonar o repo via token
2. Fazer `git checkout os-amicia-fase1`
3. Ler este arquivo
4. Rodar a query de reconhecimento
5. Começar as views

Deve levar ~15 min só pra ficar contextualizado, então vale ele passar por
isso antes de escrever uma linha.

---

## 10. Critérios de sucesso do Sprint 2

Antes de declarar Sprint 2 fechado:

- [ ] `SELECT fn_ia_cortes_recomendados()` devolve JSON válido no SQL Editor
- [ ] JSON tem pelo menos 1 ref real do catálogo (testar com ref conhecida como 02277)
- [ ] Cortes sugeridos respeitam todas as regras de `ia_config` (grade, curvas, rolos, cores)
- [ ] Fallback N1→N2 de rendimento funciona (testar com ref nova sem histórico)
- [ ] Todas as 10 views existem no Supabase e não quebraram tabelas existentes
- [ ] Nenhum arquivo fora de `sql/os-amicia/` e `api/` foi tocado
- [ ] Commit + push na `os-amicia-fase1`
- [ ] Smoke test: abrir preview → nada quebrou visualmente

---

**Boa sorte, próximo Claude. Infra tá de pé, agora é construir o cérebro. 🧠**
