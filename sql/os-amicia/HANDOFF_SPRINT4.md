# 🚀 Sprint 4 · Briefing Completo (auto-contido)

> **Este documento é tudo que você precisa pra começar o Sprint 4 do OS Amícia.**
> Lê ele inteiro (20 min) antes de qualquer código. Não precisa abrir outros arquivos —
> mas eles estão listados no final se quiser confirmar algo.

---

## 📌 Leitura obrigatória antes de tudo

Você é o Claude que vai implementar o Sprint 4 do OS Amícia — **Marketplaces**
— o segundo cérebro do app financeiro do Grupo Amícia (confecção feminina,
~R$1.2M/mês em marketplace).

Antes de **qualquer** código, confirme comigo que leu este arquivo inteiro devolvendo:
1. Qual a missão do Sprint 4 em uma frase
2. Quais são as 13 views que você vai criar
3. Qual o impacto do Card 1 ser "admin-only rígido" na arquitetura
4. O que acontece quando o Claude falha (já validado no Sprint 3, você só herda)
5. Cola as queries do Passo 0 pra eu rodar

Só depois da minha confirmação, começa.

---

## 1. Quem é o Ailson e como ele trabalha

- **Nome:** Ailson Moreira, dono do Grupo Amícia, São Paulo
- **Linguagem:** Português brasileiro sempre. Direto, técnico, hands-on
- **Estilo preferido:** opinião clara > análise neutra; "minha recomendação é X porque Y"
- **Canal:** Safari mobile + iPhone + MacBook. Interfaces mobile têm limitações
- **Ambiente:** roda SQL no Supabase SQL Editor. **Nunca peça pra ele colar service_role no chat**
- **Dica de ouro:** Ailson já executou 3 sprints. Ele está confortável com git/terminal/Vercel mas prefere que você guie explicitamente. Escreve "olha a tela X pra eu tirar print" ao invés de "verifica se tá tudo ok"

---

## 2. Missão do Sprint 4 em uma frase

**Replicar o que o Sprint 3 fez pra Produção, agora pra Marketplaces:** criar 13 views
SQL que cruzam Bling × Calculadora × ML × Shein × Shopee × Shein × TikTok × Meluni,
uma função `fn_ia_marketplaces_insights()` orquestradora, e **generalizar o `ia-cron`
do Sprint 3 pra aceitar `?escopo=producao|marketplaces`**. No fim, a tab Marketplaces
do OsAmicia.jsx popula com feed real via Claude Sonnet 4.6.

---

## 3. Estado atual (o que está PRONTO · NÃO MEXER)

### ✅ Sprint 1 (pronto · Fase 1 de infra)

- 7 tabelas em Supabase: `ia_insights`, `ia_feedback`, `ia_config` (55 chaves populadas),
  `ia_usage`, `ia_sazonalidade` (5 datas 2026), `ml_vendas_lucro_snapshot`,
  `calc_historico_snapshot`
- RLS ativo (deny-anon)
- 3 endpoints serverless (ver `api/`)
- Helper `/api/_ia-helpers.js` com `supabase`, `validarAdmin`, `getConfig`, `setCors`,
  `ANTHROPIC_PRICING`, `calcularCustoBRL`, `gastoMesAtual`, `temOrcamento`
- Módulo React isolado em `src/os-amicia/OsAmicia.jsx` (shell + 4 tabs + painel saúde)
- 5 linhas atrás do feature flag `VITE_OS_AMICIA_ENABLED` em `src/App.tsx` — **contrato intocável**

### ✅ Sprint 2 (pronto · cérebro SQL do corte)

- 10 views SQL em `sql/os-amicia/05_views_corte.sql` (~960 linhas)
- Função `fn_ia_cortes_recomendados()` em `sql/os-amicia/06_fn_cortes_recomendados.sql`
- Validado em produção com dado real (21/04 01:55 → 4 refs · 28/04 → 5 refs)

### ✅ Sprint 3 (pronto · cérebro IA da produção · **validado com dado real**)

**Código entregue:**
- `api/ia-cron.js` (~340 linhas) — motor: RPC → Claude → fallback → insert
- `api/ia-feed.js` — GET admin-only, filtros area/status/limit/desde
- `api/ia-feedback.js` — POST sim/parcial/nao/editar + GET por insight
- `api/ia-disparar.js` — substitui placeholder, chama `/api/ia-cron` via `X-Cron-Secret`
- `vercel.json` — +2 entries de cron (07h + 14h BRT via UTC 10/17)
- `src/os-amicia/OsAmicia.jsx` — TabProducao + CardInsight componentes
- `sql/os-amicia/HANDOFF_SPRINT4.md` — este arquivo

**Métricas reais do smoke test (21/04 12:37 BRT):**
- 5 insights Claude gerados em 22.9s
- `input_tokens: 4023 · output_tokens: 1457 · custo_brl: R$ 0,1781`
- Projeção: 2×/dia × 30d = **~R$ 10,80/mês** (orçamento R$ 80, folga 86%)
- Fallback determinístico testado na mesma sessão (Claude falhou JSON truncado em tentativa anterior com 9 refs, ia-cron caiu gracioso)

**Commits do Sprint 3 (last ref: `933b333`):**
```
933b333 chore(os-amicia): faxina pos smoke test Sprint 3
6a8ad17 diag(os-amicia): endpoint ia-diag-call
d410749 diag(os-amicia): enriquecer resposta do 401
720927c diag(os-amicia): endpoint publico ia-diag-env
eca7a38 diag(os-amicia): env_check no ia-status
d0abdf5 feat(os-amicia): Sprint 3 — cron + Claude + fallback + UI
```

### 🎯 Sprint 4 (é você)

Escopo detalhado na seção 8.

---

## 4. Credenciais e ambiente

### 4.1 GitHub
```
Token: [pedir ao Ailson no primeiro mensagem — ele cola o ghp_xxx]
User:  AilsonMoreira-creator
Email: Exclusivo@amicialoja.com.br
Repo:  AilsonMoreira-creator/APP-financeiro
Branch ativa: os-amicia-fase1
Último commit Sprint 3: 933b333
```

**Clonar e entrar na branch:**
```bash
git clone https://<TOKEN>@github.com/AilsonMoreira-creator/APP-financeiro.git
cd APP-financeiro
git checkout os-amicia-fase1
git config user.email "Exclusivo@amicialoja.com.br"
git config user.name "AilsonMoreira-creator"
```

**Nunca crie branch nova.** Tudo em `os-amicia-fase1` até merge final da Fase 1.

### 4.2 Vercel

- **Preview URL:** `app-financeiro-git-os-am-542748-ailsonmoreira-creators-projects.vercel.app`
- **Production URL:** `app-financeiro-brown.vercel.app` (não usar, Sprint 4 vive em preview)
- **Env vars já configuradas em Preview+Production (projeto `app-financeiro`):**
  - `SUPABASE_URL`
  - `SUPABASE_KEY` (service_role — padrão do app)
  - `ANTHROPIC_API_KEY`
  - `CRON_SECRET` (criado no Sprint 3 · 64 chars hex · **NÃO trocar sem aviso**)
- **Env var só em Preview:** `VITE_OS_AMICIA_ENABLED=true`
- **Deployment Protection:** **DESABILITADA** (foi o bloqueio final do Sprint 3 — se reativar, o ia-cron volta a dar 401 mesmo com secret correto)

### 4.3 Supabase

- URL vive em `SUPABASE_URL`
- Write via `SUPABASE_KEY` (service role)
- Ailson roda SQL no SQL Editor · **nunca pede service role no chat**
- Pra rodar SQL: entregar em link raw do GitHub ou bloco copiável ≤ 50 linhas

### 4.4 Anthropic

- **Modelo:** `claude-sonnet-4-6` (string exata · já validado com API real no Sprint 3)
- **Endpoint:** `https://api.anthropic.com/v1/messages`
- **Headers:** `x-api-key: $ANTHROPIC_API_KEY`, `anthropic-version: 2023-06-01`, `Content-Type: application/json`
- **Preços (USD/Mtok):** input $3 · output $15 · cache_read $0.30 · cache_write $3.75
- **Taxa USD→BRL:** `5.25` em `ia_config.taxa_usd_brl` (admin atualiza manual)
- **Orçamento mensal:** R$ 80 (`ia_config.orcamento_brl_mensal`). Alerta em 75%
- **Gasto real Sprint 3:** R$ 0,18/disparo → projeção ~R$ 10,80/mês
- **Sprint 4 deve continuar na mesma faixa** de custo (Marketplaces tem mais refs mas menos insights por card)

### 4.5 Config do Claude no ia_config (já populado)

```
claude_modelo = "claude-sonnet-4-6"
claude_temperatura = 0.3
claude_max_tokens = 1500        ← subir pra 2500 se Sprint 4 gerar mais texto (ver observação 11.7)
claude_timeout_s = 30
cron_horarios_brt = ["07:00","14:00"]
orcamento_brl_mensal = 80
orcamento_brl_alerta_pct = 75
taxa_usd_brl = 5.25
```

---

## 5. Catálogo de dados

### 5.1 Tabelas que você VAI USAR no Sprint 4

#### `bling_vendas_detalhe` (já existe, populada há meses)

Fonte primária de vendas. Estrutura relevante:
```
id                BIGINT PK
numero            TEXT           -- número do pedido Bling
data              DATE           -- data do pedido
total             NUMERIC        -- valor total
frete             NUMERIC
loja_id           TEXT           -- identifica canal (ML/Shein/Shopee/TikTok/Meluni)
loja_nome         TEXT           -- nome humano ("ML Lumia", "Shein Exitus", etc.)
canal             TEXT           -- normalizado (ML|SHEIN|SHOPEE|TIKTOK|MELUNI|OUTROS)
conta_bling       TEXT           -- exitus | lumia | muniam
status            TEXT           -- "Atendido" = faturado
itens             JSONB          -- array: [{ref,cor,tamanho,quantidade,valor,codigo,descLimpa,descricao}]
created_at        TIMESTAMPTZ
```

**Observações críticas:**
- `itens` é array JSONB. Use `jsonb_array_elements(itens) AS item` pra expandir
- `item->>'ref'` vem com zero à esquerda ("02601") — normalizar com `LTRIM(..., '0')`
- `item->>'tamanho'` (não "tam") — é o nome da chave de tamanho no bling
- `item->>'cor'` em PascalCase ("Preto", "Bege") — fazer `LOWER(TRIM())` em joins
- `status='Atendido'` é o filtro padrão (Bling só sincroniza já-faturado)
- `valor` é preço UNITÁRIO real (não total), mas quantidade pode ser >1

#### `amicia_data` (já existe — é o payload principal do app)

Tabela chave-valor com payload JSON do app. Pra Marketplaces, vamos ler 2 linhas:
```
user_id='calculadora'  → payload com margens/custos por produto×canal
user_id='config'       → pode ter configurações gerais (ex: margens globais)
```

**IMPORTANTE:** a tabela `amicia_data` tem coluna `payload` (não `data`). Se errar, o
insert/select falha silenciosamente. Sempre `.select('payload').eq('user_id', 'X')`.

#### `ml_estoque_ref_atual` (já existe, do Sprint 2)

Estoque atual por ref com variations JSONB. Pouco usado em Marketplaces, mas útil pra
classificar quais refs da venda têm estoque pra continuar vendendo.

#### `ml_vendas_lucro_snapshot` (criado Sprint 1 · vazia)

Snapshot diário do lucro. Deve ser populado por `fn_ia_snapshot_lucro_vendas_diario()`
que você precisa criar no Sprint 4 (ver seção 8).

Schema:
```
id                UUID PK
data_ref          DATE           -- dia do snapshot
lucro_bruto_brl   NUMERIC
devolucao_pct     NUMERIC DEFAULT 0.10
lucro_liquido_brl NUMERIC        -- lucro_bruto × (1-devolucao_pct)
receita_bruta_brl NUMERIC
por_canal         JSONB          -- {ML: X, Shein: Y, Shopee: Z, ...}
top_produtos     JSONB          -- top 5 que mais lucraram
created_at        TIMESTAMPTZ DEFAULT NOW()
```

#### `calc_historico_snapshot` (criado Sprint 1 · vazia)

Snapshot de mudanças na Calculadora (quem mexeu em custo/margem). Alimenta o Card 6
(Margem por canal). Por ora pode seguir vazio — Sprint 4 só lê `amicia_data.payload`
direto (onde vive a Calculadora).

#### `ia_insights` (Sprint 1 · 10 linhas do smoke Sprint 3)

Mesmo schema do Sprint 3. Sprint 4 vai gravar com `escopo='marketplaces'`.
Já aceita: `escopo IN ('estoque','producao','marketplaces','home','pergunta_livre')`.

#### `ia_usage` (Sprint 1 · 2 linhas do smoke Sprint 3)

Mesmo schema. `tipo` tem `CHECK IN ('cron','pergunta_livre','retry')` — **não
aceita 'fallback'** (pegadinha descoberta no Sprint 3). Marque todo cron como
`tipo='cron'` e identifique fallback via `modelo='fallback_deterministico'`.

### 5.2 Função que você VAI CRIAR

#### `fn_ia_marketplaces_insights()` — orquestra as 13 views

Formato de saída análogo ao `fn_ia_cortes_recomendados()`:

```json
{
  "versao": "1.0",
  "gerado_em": "2026-04-28T07:00:00",
  "lucro_mes": {
    "lucro_liquido_brl": 187430.50,
    "receita_bruta_brl": 892145.20,
    "lucro_bruto_brl": 208256.11,
    "devolucao_global_pct": 0.10,
    "comparacao_mes_anterior_mesmo_dia": { "valor": 172000, "pct": 9.0 },
    "comparacao_mes_anterior_fechado": { "valor": 245000, "pct": -23.5 },
    "comparacao_mesmo_mes_ano_anterior": { "valor": 160000, "pct": 17.1 },
    "por_canal": [
      { "canal": "ML", "lucro_brl": 98000, "participacao_pct": 52.3 },
      { "canal": "Shein", "lucro_brl": 42000, "participacao_pct": 22.4 },
      ...
    ],
    "top_produtos": [
      { "ref": "2277", "descricao": "SAIA...", "lucro_brl": 12450, "unidades": 87 }
    ]
  },
  "canais_performance": [...],       // Card 3
  "contas_bling": [...],             // Card 4
  "top_movers": {                    // Card 5
    "unificado": [...],
    "por_conta": { "exitus": [...], "lumia": [...], "muniam": [...] },
    "cruzamento": [...]
  },
  "margem_ajuste_gradual": [...],    // Card 6
  "oportunidades_margem": [...]      // Card 7
}
```

**Chamada via Supabase client JS:**
```js
const { data, error } = await supabase.rpc('fn_ia_marketplaces_insights');
// data é o JSONB inteiro
```

### 5.3 Tabelas que você NÃO PODE ESCREVER

- ❌ Qualquer tabela fora de `ia_*`, `ml_vendas_lucro_snapshot`, `calc_historico_snapshot`
- ❌ `bling_vendas_detalhe` — só leitura (mantida pelo bling-cron)
- ❌ `amicia_data` — só leitura (é o payload principal do app, mexe outro módulo)
- ❌ `ordens_corte` — é do Sprint 6, não toca

---

## 6. Arquivos existentes que você vai tocar

```
api/
  _ia-helpers.js           ← EXISTE · use como sempre
  ia-config.js             ← EXISTE · não mexer
  ia-status.js             ← EXISTE · talvez adicione totais de marketplaces
  ia-disparar.js           ← EXISTE · ajustar pra aceitar body { escopo: 'marketplaces' }
  ia-cron.js               ← EXISTE · REFATORAR pra aceitar ?escopo=
  ia-feed.js               ← EXISTE · já aceita filtro area=marketplaces (pronto)
  ia-feedback.js           ← EXISTE · não mexer

src/os-amicia/
  OsAmicia.jsx             ← EDITAR · popular tab Marketplaces (copiar TabProducao como template)
                             NÃO apaga TabProducao/CardInsight existentes

sql/os-amicia/
  05_views_corte.sql       ← EXISTE · não mexer
  06_fn_cortes_recomendados.sql ← EXISTE · não mexer
  07_views_marketplaces.sql     ← CRIAR (novo · 13 views)
  08_fn_marketplaces_insights.sql ← CRIAR (novo · função orquestradora)
  HANDOFF_SPRINT5.md       ← CRIAR ao fim do sprint

vercel.json                ← EDITAR · +2 entries cron (07h + 14h BRT pra marketplaces)
                             OU manter 2 existentes e passar ?escopo=both — decisão do Sprint 4
```

**Nenhum arquivo do `App.tsx` deve ser modificado no Sprint 4.**

---

## 7. As 8 regras do prompt de sistema do Claude (mesmas do Sprint 3)

Pra Marketplaces, o prompt de sistema mantém as 8 regras do Sprint 3 com ajustes:

1. Toda análise termina em ação concreta ("aumentar preço em R$ X", "pausar canal Y")
2. Estoque zerado não é critério — sempre cruzar com demanda/lucro
3. Margem é decisor principal aqui (diferente de Produção — é aqui que margem importa)
4. **Canal × Conta** detalha quando dados permitem (ML Exitus × ML Lumia × ML Muniam)
5. Respeite a confiança que vem no input — não invente certeza
6. Linguagem direta, números concretos, sem adjetivos vagos
7. Brevidade: resumo ≤ 2 frases, acao_sugerida ≤ 1 frase, impacto ≤ 1 frase
8. Refs e canais do input são autoridade — não traduzir, não abreviar

**Regra bônus (mantida):** marca "Amícia" NUNCA aparece em insights (é interna).

**Regras específicas do Sprint 4:**
- Não misturar lucro do mês (admin-only) com insights regulares
- **Lojas físicas não entram** nesta versão (só Marketplaces)
- Refs vêm sem zero à esquerda (função já normaliza)
- Top movers sempre mostra direção: "↑+47%" ou "↓-23%"

---

## 8. Plano de execução do Sprint 4 (12 passos)

### Passo 0 — Validação de pré-requisitos (ANTES de qualquer código)

Peça pro Ailson rodar no SQL Editor e cole o resultado:

```sql
-- (a) Função do Sprint 2 ainda existe e roda?
SELECT proname FROM pg_proc WHERE proname = 'fn_ia_cortes_recomendados';
-- Esperado: 1 linha

-- (b) Sprint 3 deixou insights ativos?
SELECT escopo, COUNT(*) AS total, MAX(created_at) AS ultimo
FROM ia_insights
GROUP BY escopo;
-- Esperado: 'producao' com >=10, sem 'marketplaces'

-- (c) Calculadora tem payload?
SELECT jsonb_typeof(payload), jsonb_array_length(
  CASE WHEN jsonb_typeof(payload->'produtos') = 'array'
       THEN payload->'produtos'
       ELSE '[]'::jsonb END
) AS n_produtos_calculadora
FROM amicia_data
WHERE user_id = 'calculadora';
-- Esperado: jsonb_typeof = 'object', n_produtos > 0 (deve ter dezenas)

-- (d) Bling tem vendas do mês atual?
SELECT COUNT(*) AS pedidos_mes, SUM(total) AS receita_bruta_mes
FROM bling_vendas_detalhe
WHERE data >= date_trunc('month', CURRENT_DATE)
  AND status = 'Atendido';
-- Esperado: COUNT > 0, SUM > 0 (deve ser dezenas de milhares de reais)

-- (e) Orçamento disponível?
SELECT COALESCE(SUM(custo_brl), 0) AS gasto_mes
FROM ia_usage
WHERE ano_mes = to_char(NOW(), 'YYYY-MM');
-- Esperado: <= R$ 5 (se Sprint 3 foi testado só 1-2 vezes)
```

**Se algum falhar:** PARE e pergunte ao Ailson. Não tente "corrigir" — Sprint 3 foi
validado em produção, discrepância precisa investigação.

### Passo 1 — Criar `sql/os-amicia/07_views_marketplaces.sql` (as 13 views)

As 13 views em ordem de dependência (igual Sprint 2 foi estruturado):

```
1. vw_calculadora_normalizada           -- extrai ref+canal+lucro_unitario da calculadora
2. vw_vendas_com_lucro                  -- bling × calculadora = cada venda com lucro_unitario
3. vw_lucro_mes_por_canal               -- agrega por canal (M, Shein, Shopee, TikTok, Meluni, Outros)
4. vw_lucro_liquido_marketplace_mes     -- aplica devolucao 10% → Card 1 admin
5. vw_vendas_mensais_24m                -- agregação 24m → Card 2
6. vw_canais_comparativo_7v7            -- 7v7 e 30v30 com desvio → Card 3
7. vw_contas_bling_7v7                  -- Exitus × Lumia × Muniam → Card 4
8. vw_top_movers_unificado              -- camada 1 do Card 5
9. vw_top_movers_por_conta              -- camada 2 do Card 5
10. vw_top_movers_cruzamento            -- camada 3 (assimetrias) → Card 5
11. vw_margem_por_produto_canal         -- faixa de margem → Card 6
12. vw_plano_ajuste_gradual             -- degraus (30d+R$79) → Card 6
13. vw_oportunidades_margem             -- alta margem + baixa venda → Card 7
```

**Premissas de normalização (iguais ao Sprint 2):**
- `ref: LTRIM(ref, '0')`
- `cor: LOWER(TRIM(cor))`
- `canal: UPPER(TRIM(canal))` quando fazer lookup

**⚠️ Pegadinha descoberta no Sprint 2 (5.1 do HANDOFF):** o parser SQL do Supabase
SQL Editor **mobile** quebra com comentários contendo `=` repetido (50+ vezes seguidas).
Commits `9f2d4cc` e `39cb393` tiveram que remover delimitadores `-- ===...===`.
**NÃO use esse padrão** — use `-- -- -- Titulo -- -- --` ou linha em branco pra separar.

### Passo 2 — Criar `sql/os-amicia/08_fn_marketplaces_insights.sql`

Função orquestradora com `SECURITY DEFINER` e `GRANT EXECUTE TO service_role, authenticated`.

Retorna JSONB único com estrutura da seção 5.2.

**Referência:** copiar estrutura de `06_fn_cortes_recomendados.sql` (já no repo).

### Passo 3 — Refatorar `api/ia-cron.js` pra aceitar `?escopo=`

**Hoje** o ia-cron:
- Chama `fn_ia_cortes_recomendados()` hardcoded
- Grava insight "tudo saudável" com `escopo: 'producao'` hardcoded
- Prompt de sistema específico pra cortes

**Vai virar:**
- Ler `req.query.escopo || 'producao'` (default mantém comportamento Sprint 3)
- Switch pra escolher função e prompt:
  - `producao` → `fn_ia_cortes_recomendados` + PROMPT_CORTE (já existe)
  - `marketplaces` → `fn_ia_marketplaces_insights` + PROMPT_MARKETPLACES (novo)
- Escopo do insert e do "tudo saudável" vira dinâmico

**Importante:** mantém a lógica de auth, retry, fallback, ia_usage — tudo igual.
Só abstrai o "de onde vem o JSON" e "qual prompt usar".

### Passo 4 — Ajustar `vercel.json` (decisão de arquitetura)

**Duas opções (minha recomendação é A):**

**Opção A — 4 crons separados (+2):**
```json
{ "path": "/api/ia-cron?token=$CRON_SECRET&janela=manha&escopo=producao", "schedule": "0 10 * * *" },
{ "path": "/api/ia-cron?token=$CRON_SECRET&janela=tarde&escopo=producao", "schedule": "0 17 * * *" },
{ "path": "/api/ia-cron?token=$CRON_SECRET&janela=manha&escopo=marketplaces", "schedule": "15 10 * * *" },
{ "path": "/api/ia-cron?token=$CRON_SECRET&janela=tarde&escopo=marketplaces", "schedule": "15 17 * * *" }
```
Separados por 15min pra evitar paralelismo. Falha de um não afeta outro.

**Opção B — 2 crons que chamam os 2 escopos em sequência:**
Requer novo endpoint `ia-cron-all` que chama `ia-cron` 2x. Mais código, menos granular.

**Recomendação: Opção A** — simpler, mais robusta, mais fácil de debugar.

### Passo 5 — Ajustar `api/ia-disparar.js` pra aceitar body `{ escopo }`

Hoje aceita POST sem body. Vai aceitar `{ "escopo": "marketplaces" }`.

```js
const { escopo = 'producao' } = req.body || {};
// valida: escopo IN ('producao', 'marketplaces')
// passa ?escopo=<valor> na chamada interna pro ia-cron
```

### Passo 6 — Popular tab Marketplaces no `OsAmicia.jsx`

Shell já existe. Adicionar:
- Componente `TabMarketplaces` (copia `TabProducao` como template, troca endpoints)
- Card 1 (Lucro do Mês) renderiza em **destaque acima** da lista de insights
- Chama `/api/ia-feed?area=marketplaces` pro feed
- Botão "Disparar agora" → POST `/api/ia-disparar` body `{ escopo: 'marketplaces' }`

**⚠️ Card 1 admin-only rígido:**
- Frontend: mostra só se `usuarioLogado.admin === true`
- Backend: `/api/ia-feed` já valida admin, mas Card 1 usa endpoint próprio
  `/api/ia-lucro-mes` (CRIAR) que **além de validar admin valida nada mais** —
  dupla validação é decisão de segurança (regra 5.5 do HANDOFF_SPRINT2)

### Passo 7 — Criar `api/ia-lucro-mes.js` (admin-only rígido)

GET que retorna só o bloco `lucro_mes` do JSONB de `fn_ia_marketplaces_insights()`.

Validação dupla:
1. `validarAdmin(req)` (helper existente)
2. Double-check: `admin.user.admin === true` (redundância proposital)

```js
export default async function handler(req, res) {
  setCors(res);
  if (req.method !== 'GET') return res.status(405).json(...);

  const admin = await validarAdmin(req);
  if (!admin.ok || admin.user.admin !== true) {
    return res.status(403).json({ error: 'Forbidden · admin only' });
  }

  const { data, error } = await supabase.rpc('fn_ia_marketplaces_insights');
  if (error) return res.status(500).json({ error: error.message });

  return res.json({ ok: true, lucro_mes: data?.lucro_mes || null });
}
```

### Passo 8 — Smoke test no preview (mesma metodologia do Sprint 3)

1. Push pra branch aciona auto-deploy Vercel Preview
2. Ailson abre `app-financeiro-git-os-am-542748-...` logado como admin
3. Módulo OS Amícia → tab Marketplaces → clica "Disparar agora"
4. Esperar ~15-30s (Marketplaces tem input maior que Produção)
5. Validar:
   - Alerta verde "Disparo concluído: modo claude, N insights, custo R$ X"
   - Card 1 "Lucro Líquido do Mês" aparece no topo com número em destaque
   - Cards 2-7 aparecem abaixo em lista
6. SQL de validação:
   ```sql
   SELECT severity, confidence, titulo, categoria, origem, modelo, created_at
   FROM ia_insights
   WHERE escopo = 'marketplaces'
   ORDER BY created_at DESC LIMIT 10;

   SELECT tipo, modelo, input_tokens, output_tokens, custo_brl
   FROM ia_usage
   WHERE data = CURRENT_DATE
     AND modelo = 'claude-sonnet-4-6'
   ORDER BY created_at DESC LIMIT 3;
   ```
7. Esperado: 5-7 insights novos com `escopo='marketplaces'`, custo ~R$ 0,20-0,40

### Passo 9 — Teste de não-admin vendo Card 1

1. Logar como usuário não-admin (pedir pro Ailson criar um de teste se não tiver)
2. Abrir módulo OS Amícia → tab Marketplaces
3. **Esperado:** Cards 2-7 aparecem, Card 1 **NÃO aparece**
4. Tentar bater direto em `/api/ia-lucro-mes` com header `X-User: <nao-admin>`
5. **Esperado:** HTTP 403 `Forbidden · admin only`

### Passo 10 — Teste do fallback (mesmo do Sprint 3)

1. No Vercel, trocar `ANTHROPIC_API_KEY` pra valor inválido temporariamente
2. Disparar manual → confirmar `origem='fallback_deterministico'`
3. Reverter a key
4. Disparar de novo → deve voltar pra `origem='cron'`

### Passo 11 — Rodar em produção às 07h e confirmar

- Próximo cron 07:00 BRT (10:00 UTC) vai rodar **sozinho**
- De manhã, Ailson confirma:
  - Tab Produção tem insights novos (do Sprint 3 · escopo='producao')
  - Tab Marketplaces tem insights novos (do Sprint 4 · escopo='marketplaces')
  - `ia_usage` ganhou 2 linhas novas (uma por escopo)

### Passo 12 — Commit, push, handoff Sprint 5

```bash
git add sql/os-amicia/07_views_marketplaces.sql \
        sql/os-amicia/08_fn_marketplaces_insights.sql \
        api/ia-cron.js api/ia-disparar.js api/ia-lucro-mes.js \
        src/os-amicia/OsAmicia.jsx vercel.json \
        sql/os-amicia/HANDOFF_SPRINT5.md
git commit -m "feat(os-amicia): Sprint 4 — Marketplaces views + cron generalizado + Card 1 admin"
git push origin os-amicia-fase1
```

HANDOFF_SPRINT5.md segue mesma estrutura deste briefing. Sprint 5 é Home Geral +
realtime + pergunta livre.

---

## 9. Critérios de sucesso (checklist binário)

Antes de declarar Sprint 4 fechado, **todos** devem ser ✅:

- [ ] 13 views criadas em `07_views_marketplaces.sql` e rodadas no Supabase
- [ ] `fn_ia_marketplaces_insights()` criada e testada (retorna JSONB válido)
- [ ] `/api/ia-cron?escopo=marketplaces` responde 200 com `CRON_SECRET`
- [ ] `/api/ia-cron?escopo=producao` ainda funciona (regressão zero no Sprint 3)
- [ ] Claude Sonnet 4.6 gera insights em linguagem natural pra Marketplaces
- [ ] Insights gravam com `escopo='marketplaces'` em `ia_insights`
- [ ] `ia_usage` grava tokens + custo por escopo
- [ ] Fallback determinístico funciona pra Marketplaces (gera ao menos 1 insight por card)
- [ ] `vercel.json` tem 4 entries de cron (2 producao + 2 marketplaces)
- [ ] `/api/ia-disparar` aceita body `{escopo}` e roteia corretamente
- [ ] `/api/ia-lucro-mes` devolve só pra admin (valida dupla)
- [ ] Tab Marketplaces mostra Card 1 (se admin) + feed + disparo + feedback
- [ ] Usuário não-admin não vê Card 1 (nem por request direto)
- [ ] Smoke test no preview: disparar manual gera insights em ambas tabs
- [ ] Orçamento consumido ≤ R$ 1 no teste (Fase 1 total estimado ~R$ 23/mês)
- [ ] Commit + push na `os-amicia-fase1`
- [ ] `HANDOFF_SPRINT5.md` gerado

---

## 10. Regras duras (o que NÃO fazer)

Violação = refazer.

- ❌ **Não importar nada do `App.tsx`** dentro de `src/os-amicia/`
- ❌ **Não escrever em tabelas fora de `ia_*`**, `ml_vendas_lucro_snapshot`, `calc_historico_snapshot`
- ❌ **Não mexer em policies/RLS** de tabelas pré-existentes
- ❌ **Não fazer refactor** do `App.tsx`
- ❌ **Não instalar SDK da Anthropic** — fetch nativo já validado
- ❌ **Não deploy em Production** — Sprint 4 vive 100% em preview
- ❌ **Não pedir service role no chat**
- ❌ **Não criar branch nova**
- ❌ **Não alterar `fn_ia_cortes_recomendados()`**
- ❌ **Não mudar as 8 regras do prompt de sistema** sem me perguntar
- ❌ **Não ativar Prompt Caching** ainda (depende do prompt estabilizar)
- ❌ **Não citar "Amícia"** nos insights gerados
- ❌ **Não reativar Deployment Protection** do projeto (ver 11.1)
- ❌ **Não deixar Card 1 (Lucro Mês) vazar pra não-admin** — regra de segurança

---

## 11. Problemas conhecidos do ambiente (ATUALIZADO COM APRENDIZADOS SPRINT 3)

### 11.1 Deployment Protection bloqueia chamadas internas · CRÍTICO

**O que é:** O Vercel tem um recurso "Vercel Authentication" que protege deploys de
Preview com SSO obrigatório. Mesmo se o `fetch()` é feito de dentro do próprio deploy
(ex: `ia-disparar` chamando `ia-cron`), o gateway bloqueia com HTML de login.

**Como descobri no Sprint 3:** depois de 5 tentativas com `CRON_SECRET` correto, o
ia-cron continuava retornando 401. Criei `api/ia-diag-call.js` que chamava o fluxo
interno e capturei o body completo da resposta — era HTML do Vercel SSO, não 401 do
meu código.

**Solução aplicada:** no Vercel, Project `app-financeiro` → Settings → Deployment
Protection → **desabilitar "Vercel Authentication"** (ou mudar pra "Only Production
Deployments").

**IMPORTANTE:** Se o Ailson por acaso reativar essa proteção, o Sprint 4 vai quebrar
do mesmo jeito. Deixar **desabilitado** até todo Sprint da Fase 1 fechar.

### 11.2 Parser do Supabase SQL Editor (mobile) quebra com comentários longos

Linhas de comentário SQL com 50+ caracteres `=` seguidos disparam erro `42601:
operator too long`. **Não usar delimitadores `-- ===...===` nos arquivos SQL.**
Herdado do Sprint 2 (commits `9f2d4cc` e `39cb393`).

### 11.3 Flag `alerta_duplicata` "sticky" em `ml_estoque_ref_atual`

Refs 2277, 2601, 2832 (top sellers) aparecem com `alerta_duplicata=true` mesmo após
o cron consolidar os MLBs duplicados. Isso joga `confianca_ref='media'` nas views do
Sprint 2. **Claude respeita isso via regra #5 do prompt** e não forja certeza — é o
comportamento correto. **Não é bug do Sprint 3/4**, mas fica documentado como dívida.

Se quiser eliminar isso algum dia: consertar `ml-estoque-cron.js` pra zerar a flag
quando a duplicação é resolvida.

### 11.4 Duplicata "Verde Água" vs "Verde Agua" (com/sem acento)

Views do Sprint 2 fazem `LOWER(TRIM())` mas não removem acentos. Solução sugerida:
habilitar extensão `unaccent` no Postgres e usar `LOWER(TRIM(unaccent(cor)))`.

**Pra Sprint 4:** aplicar `unaccent` nas novas views de Marketplaces desde o início
se extensão já estiver instalada. Se não, manter consistência com Sprint 2 e abrir
ticket separado.

### 11.5 Refs com dados faltantes (caso 2851 do Sprint 3)

Algumas refs vêm com `descricao=""`, `sala_recomendada=null`, campos null. O Sprint 3
lidou graciosamente:
- Fallback usa ternário: `ref.descricao ? ... : 'REF N'`
- Claude reconheceu padrão e marcou como `investigar_ref` com `confianca: alta`

Pra Marketplaces, possível análogo: ref vendida mas sem linha na Calculadora. Tratar
com `NULLIF`, `COALESCE`, fallback explícito.

### 11.6 SAC também usa Claude Sonnet 4.6 — compartilha orçamento

- `ml-*.js` (módulo SAC) e `ia-cron.js` (OS) dividem `ANTHROPIC_API_KEY`
- Gasto somado é visível em `SELECT SUM(custo_brl) FROM ia_usage` + estimativa SAC
- Sprint 3 consumiu R$ 0,18/disparo × 2/dia = R$ 10,80/mês
- Sprint 4 deve ficar em faixa similar
- Com SAC rodando a todo momento, monitorar via `gastoMesAtual()` antes de chamar Claude
  (já está implementado — se `temOrcamento() === false`, cai direto pro fallback)

### 11.7 `claude_max_tokens=1500` pode ser pouco pra Marketplaces

No Sprint 3, com 9 refs, o Claude retornou JSON truncado (`Unterminated string at
position 3870`). Caiu pro fallback gracioso. Com 5 refs, funcionou perfeito.

**Pra Marketplaces:** o JSON de entrada é maior (7 cards × várias refs cada). Eu
recomendo subir `claude_max_tokens` pra **2500 ou 3000** antes do primeiro disparo:

```sql
UPDATE ia_config
SET valor = '2500'::jsonb, updated_at = NOW()
WHERE chave = 'claude_max_tokens';
```

Se ainda trucar, subir pra 4000. Custo marginal — output tokens custam $15/Mtok,
então diferença entre 1500 e 3000 é ~$0.02/disparo.

### 11.8 Env var `CRON_SECRET` precisa estar no Projeto, não Team Shared

**Como descobri no Sprint 3:** Ailson criou `CRON_SECRET` em Vercel Team Settings →
Shared Variables. Essa aba **não sincroniza** automaticamente com projetos. O runtime
não recebeu a var.

**Solução:** criar env vars em **Project: app-financeiro → Settings → Environment
Variables** (não em Team Shared). Triple-check: marcar Production + Preview + Development.

Se for rotacionar `CRON_SECRET` algum dia:
1. Gerar novo valor: `openssl rand -hex 32` (terminal Mac)
2. Atualizar em Vercel (projeto, não team)
3. **Redeploy sem cache** do último deploy de preview (env vars não entram em
   deploys existentes sem rebuild)

### 11.9 Ailson usa Safari/Chrome mobile + Mac alternado

Quando ele pedir debug, considerar que:
- **Safari mobile:** limitado em DevTools
- **Chrome mobile:** DevTools razoável, mas lento
- **Chrome Mac:** DevTools completo, melhor pra Network tab
- Prefira **endpoints de diagnóstico com URL pública** (como `ia-diag-env.js` do
  Sprint 3) ao invés de instruir navegação pelo DevTools
- Sempre tiver possibilidade de tirar print, peça print e decodifique visualmente

---

## 12. Como chamar a função do Postgres no código Node

A função `fn_ia_marketplaces_insights()` deve ser criada com `SECURITY DEFINER` e
`GRANT EXECUTE TO service_role, authenticated`. Chamada:

```js
import { supabase } from './_ia-helpers.js';

const { data, error } = await supabase.rpc('fn_ia_marketplaces_insights');
if (error) throw new Error(`fn_ia_marketplaces_insights falhou: ${error.message}`);
// data.lucro_mes é o objeto admin-only
// data.canais_performance é array
// data.top_movers é objeto com 3 camadas
```

**Não faça `from('vw_lucro_marketplace_mes').select('*')` direto** — sempre passa
pela função (lógica de consolidação + validação).

---

## 13. Como apresentar ao Ailson no mobile (mesmas regras do Sprint 3)

- **Blocos SQL ≤ 50 linhas** colam bem no mobile; acima disso, link raw do GitHub:
  `https://raw.githubusercontent.com/AilsonMoreira-creator/APP-financeiro/os-amicia-fase1/<path>`
- **Uma pergunta por vez** em queries
- **Se precisa screenshot:** peça print, ele tira e manda
- **Findings:** começa com conclusão (TL;DR), números concretos, sem adjetivos vagos
- **Opinião clara ao final** — "minha recomendação é X porque Y", não "temos opções A/B/C"

---

## 14. Mini-glossário Amícia (atualizado)

- **Marcas do grupo:** Exitus, Lumia, Muniam (marketplaces), Amícia (wholesale B2B), Meluni (B2C DTC)
- **Ideris:** hub de estoque central. Espelha estoque pros 11 canais
- **ML Lumia:** uma das 3 contas ML, **proxy de leitura** do estoque
- **Canais:** ML, Shein, Shopee, TikTok, Meluni, Outros (Magalu agrupado)
- **3 contas Bling:** Exitus (~50% volume), Lumia (~30%), Muniam (~20%)
- **Salas de corte:** Antonio, Adalecio, Chico (quem corta tecido)
- **Oficinas:** Dilmo, Hugo, Joaquim, Roberto Belém (quem costura)
- **Enfesto:** 1 corte = 1 ref inteira com todas as cores juntas
- **Curva A:** top 10 refs em venda. B: 11-20. Outras: 21+
- **Lead time:** 22 dias fixos
- **Cobertura alvo:** 28 dias (22 lead + 6 folga, reduzido de 35 pra liberar capital)
- **Devolução global:** 10% (aplicado sobre lucro bruto)
- **Calculadora:** módulo do app onde Ailson registra custo/margem por produto×canal
- **Card 1 (Lucro Mês):** admin-only rígido · pergunta #1 do dono

---

## 15. Primeira mensagem ao Ailson

Depois de clonar e ler este briefing, sua primeira mensagem deve ser:

> Lido o SPRINT4_BRIEFING. Missão: [parafraseia seção 2]. Vou criar 13 views SQL +
> 1 função orquestradora + refatorar `ia-cron.js` pra aceitar `?escopo=` +
> adicionar endpoint `/api/ia-lucro-mes` admin-only rígido + popular tab Marketplaces.
>
> Mantém 100% do Sprint 3 intacto — a refatoração do ia-cron é aditiva, Sprint 3 é
> o "caminho default" (escopo=producao).
>
> Se Claude der timeout/erro, mesma estratégia do Sprint 3: retry com temp=0.1, depois
> fallback determinístico. Já validado com dado real em 21/04.
>
> Orçamento atual: [X] já consumido de R$80/mês. Sprint 4 estimativa: ~R$ 0,30/disparo,
> ~R$ 18/mês adicional. Total projetado Fase 1: ~R$ 29/mês.
>
> Antes de escrever código, preciso do resultado do Passo 0:
> [cola as 5 queries da seção 8 Passo 0]

Só **depois** do resultado do Passo 0 você começa a escrever SQL.

---

## 16. Se tiver dúvida, leia (nesta ordem)

1. Este briefing (`HANDOFF_SPRINT4.md`) — 99% das respostas
2. `sql/os-amicia/SPRINT3_BRIEFING.md` — contexto do cron + Claude (irmão mais velho)
3. `sql/os-amicia/HANDOFF_SPRINT2.md` — bíblia histórica, decisões travadas
4. `docs/pacote-os-amicia/02_PROMPT_MESTRE_OS_Amicia.md` — especificação original
   (tem desatualizações; **briefing atual vence sempre**)
5. `api/_ia-helpers.js` — helpers
6. `api/ia-cron.js` — motor do Sprint 3, referência de estrutura
7. `api/ml-ai.js` (SAC) — outra referência real de chamada Anthropic
8. `sql/os-amicia/05_views_corte.sql` — template das 10 views do corte

---

## 17. Critério definitivo de "Sprint 4 entregue"

Ailson abre OS Amícia → tab Marketplaces no preview. Vê o Card 1 em destaque:

> **💰 Lucro Líquido do Mês**
> **R$ 187.430,50** (em verde, Calibri 28pt)
> Projetado líquido · +9,0% vs mês anterior mesmo dia

Abaixo, 5-7 cards de insights em português claro sobre canais subindo/caindo,
margens pra ajustar, oportunidades de pegada perdida.

Ele lê, clica 👍 em um, 👎 em outro, fecha. Cron roda sozinho às 07h15 e 14h15
amanhã e gera insights frescos.

**Isso é acender a segunda luz.** 🧠💰

---

## 18. Perguntas frequentes que o Ailson pode fazer

**Q: "Posso rodar só Marketplaces agora e deixar Produção parada?"**
R: Sim, mas não recomendado. Os 2 crons convivem. Se rolar 07h Produção + 07h15
Marketplaces, Ailson abre o app e tem insights das 2 áreas.

**Q: "Sprint 4 quebra o Sprint 3?"**
R: Não deve. A refatoração do `ia-cron.js` mantém `escopo='producao'` como default.
Mesmo se o front do Sprint 3 continuar chamando `/api/ia-cron` sem passar `?escopo=`,
funciona igual. **Smoke test do Passo 8 valida regressão.**

**Q: "Card 1 é sensível mesmo? Não posso mostrar pro contador?"**
R: Regra do briefing original: admin-only rígido. Se Ailson quiser expandir pro
contador no futuro, criar role novo (`financeiro_pleno`) e ajustar frontend + endpoint.
**Não vaza pra "usuário comum" nunca.**

**Q: "E se o Claude ficar alucinando números?"**
R: Regra #8 do prompt: números do input são autoridade. O JSONB da função já tem
TODOS os números que a IA precisa (receita, lucro, variações pct). Se ele inventar,
abrir ticket "prompt engineering Sprint 4.5" e reforçar regra.

**Q: "Custo de tokens vai explodir com input maior?"**
R: Input é cobrado $3/Mtok. JSONB de Marketplaces ~10-15KB tokens. ~$0.05/disparo
em input + ~$0.20 em output = R$ 1,30/disparo máximo. 2×/dia × 30d = R$ 78/mês **apenas
marketplaces**. Vai bater no limite. **Por isso a recomendação de Prompt Caching**
(11.7 do HANDOFF_SPRINT3) — ativar depois do prompt estabilizar (30d). Quando ativar,
input cai pra $0.30/Mtok = 10x mais barato.

---

**Segunda luz aguardando acender. Primeira luz já ilumina às 07h BRT todo dia.** 🧠💡⚡
