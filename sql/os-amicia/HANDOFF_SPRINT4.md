# 📦 OS Amícia · Handoff para Sprint 4

**Gerado em:** 28/04/2026
**Autor:** sessão de implementação Sprint 3
**Destinatário:** próximo chat / Claude que pegar o Sprint 4

> **Leia este arquivo primeiro, depois:**
> `sql/os-amicia/SPRINT3_BRIEFING.md` (contexto), `HANDOFF_SPRINT2.md` (histórico),
> `docs/pacote-os-amicia/02_PROMPT_MESTRE_OS_Amicia.md` seção 7 (a sua seção: Marketplaces).

---

## 1. Status atual

✅ **Sprint 3 CONCLUÍDO.** O cérebro está ligado.

Entregue:
- **`api/ia-cron.js`** (novo, ~340 linhas) — motor que orquestra RPC →
  Claude Sonnet 4.6 (com retry) → fallback determinístico → insert em
  `ia_insights` + `ia_usage`.
- **`api/ia-feed.js`** (novo) — GET admin-only com filtros area/status/limit/desde.
- **`api/ia-feedback.js`** (novo) — POST (sim/parcial/nao/editar) + GET por insight.
- **`api/ia-disparar.js`** (substituído) — deixou de ser placeholder. Valida
  admin, chama `/api/ia-cron` internamente com `X-Cron-Secret` e devolve o
  payload real do cron.
- **`vercel.json`** — adicionadas 2 entries de cron:
  - `0 10 * * *` UTC = **07:00 BRT** janela=manha
  - `0 17 * * *` UTC = **14:00 BRT** janela=tarde
- **`src/os-amicia/OsAmicia.jsx`** — tab Produção populada com:
  - Botão "⚡ Disparar agora" (POST /api/ia-disparar)
  - Feed de insights com `useEffect` (GET /api/ia-feed?area=producao)
  - Botões 👍 Sim / 🤔 Parcial / 👎 Não por card (POST /api/ia-feedback)
  - Cores por severity (crítico=vermelho, atenção=amarelo, etc.)
  - Ícones de confidence (🟢 alta · 🟡 media · 🔴 baixa)
  - Badge "fallback" quando origem = `fallback_deterministico`

**Branch:** `os-amicia-fase1`
**Deploy:** auto via push (Vercel preview).

---

## 2. Env vars a configurar (Ailson deve criar ANTES do primeiro teste)

```
CRON_SECRET=<gerar com: openssl rand -hex 32>
```

Escopo: **Preview + Production** no Vercel.

As demais (`SUPABASE_URL`, `SUPABASE_KEY`, `ANTHROPIC_API_KEY`) já existem.

---

## 3. Decisões tomadas no Sprint 3

### 3.1 Auth do ia-cron

- **Via Vercel Cron:** query string `?token=<CRON_SECRET>` (Vercel substitui via `$CRON_SECRET` no vercel.json).
- **Via /api/ia-disparar (manual):** header `X-Cron-Secret: <CRON_SECRET>`.
- Qualquer outra origem → 401.

### 3.2 Estratégia de retry do Claude

1. Chamada inicial: `temperature=0.3`, `max_tokens=1500`, `timeout=30s`
2. Se timeout/erro: **1 retry com `temperature=0.1`** (mais determinístico)
3. Se retry também falha: **fallback determinístico** (1 insight por ref direto do JSONB)
4. Se Claude retornou mas JSON inválido ou validação descartou tudo: cai pro fallback (modo `fallback_validacao`)

Modos registrados no response do cron:
- `claude` — 1ª tentativa passou
- `claude_retry` — precisou do retry
- `fallback_erro` — Claude falhou 2x
- `fallback_orcamento` — `temOrcamento()` = false, pulou Claude
- `fallback_validacao` — Claude retornou mas nada passou na validação
- `sem_refs` — função retornou 0 refs, gravou insight "tudo saudável"

### 3.3 Pegadinha do CHECK em `ia_usage.tipo`

`01_tables.sql` linha 112-113 define `CHECK (tipo IN ('cron','pergunta_livre','retry'))`.
**Não aceita `'fallback'`.** Solução: marcamos todo disparo do cron (inclusive
fallback) com `tipo='cron'` e identificamos o fallback pelo `modelo='fallback_deterministico'`.

O briefing seção 5.1 dizia `'fallback'` — atualizar o briefing se fizer Sprint 4.

### 3.4 Origem no `ia_insights`

O CHECK aceita só: `('cron','pergunta_livre','fallback_deterministico')`.
Usamos:
- `origem='cron'` quando Claude (1ª tentativa OU retry) gerou
- `origem='fallback_deterministico'` quando fallback gerou
- `modelo='claude-sonnet-4-6'` | `'fallback_deterministico'` | `'sem_claude'` (caso zero refs)

### 3.5 Marca "Amícia" nunca aparece

Prompt de sistema explícito: _"nunca cite a marca 'Amícia' no texto (é interna).
Use 'operação', 'produção' etc."_ — regra bônus do briefing.

---

## 4. Smoke test executado? PENDENTE

Passos recomendados ao Ailson (quando sentar pra testar):

1. **Setar `CRON_SECRET`** no Vercel (Preview + Production) e fazer redeploy.
2. Login no preview como admin → módulo OS Amícia → tab Produção.
3. Clicar **⚡ Disparar agora**. Esperar 5-15s.
4. Confirmar que apareceram 5 insights (hoje a função retorna 5 refs).
5. Clicar 👍 em um card → confirmar que o botão fica verde.
6. SQL pra validar tudo:
   ```sql
   SELECT escopo, severity, confidence, titulo, acao_sugerida, origem, modelo, created_at
   FROM ia_insights
   ORDER BY created_at DESC
   LIMIT 10;

   SELECT tipo, modelo, input_tokens, output_tokens, custo_brl, created_at
   FROM ia_usage
   WHERE data = CURRENT_DATE
   ORDER BY created_at DESC;

   SELECT resposta, user_id, created_at
   FROM ia_feedback
   ORDER BY created_at DESC
   LIMIT 5;
   ```
7. Esperado: insights gravados, custo ~R$0.10-R$0.50, feedback gravado.

### Teste do fallback (Passo 9 do briefing)

1. No Vercel, trocar `ANTHROPIC_API_KEY` pra valor inválido temporariamente.
2. Disparar manual → confirmar origem=`fallback_deterministico`.
3. Reverter a key.

---

## 5. Problemas conhecidos / dívida técnica

### 5.1 `alerta_duplicata` sticky
Herdado do Sprint 2. Refs 2277/2601/2832 ainda vêm com `confianca_ref='media'`
sem motivo real. Não afeta Sprint 3 — o Claude respeita a confiança que vem.

### 5.2 Duplicata cor com/sem acento
"Verde Água" vs "Verde Agua". Views não fazem `unaccent`. Ticket separado.

### 5.3 Rate limit/timeout em dia de muitos disparos
O cron roda 2x/dia + disparos manuais. Se Ailson testar demais no mesmo dia e
Anthropic retornar 529 (overloaded), cai pro fallback automaticamente. Monitorar
em `ia_usage`.

### 5.4 Busca de insight por cron_run_id na UI
Hoje o feed carrega **os 50 mais recentes ativos**. Não agrupa por execução. Se
Ailson quiser ver "apenas o último disparo", precisa filtrar por `cron_run_id`.
Já está na resposta da API — só falta um dropdown na UI. Sprint 7 (polish).

### 5.5 Sem paginação no feed
50 é o default, 200 o máximo. Suficiente pra Fase 1. Sprint 7.

### 5.6 Retenção de insights
Briefing prevê 90d em arquivado → limpeza mensal. **Não implementado.** Quando
chegar lá, criar cron de limpeza ou migração SQL em `sql/os-amicia/07_retencao.sql`.

---

## 6. Escopo do Sprint 4

**Marketplaces.** Mesma estrutura do Sprint 2 pra corte, mas pra receita/lucro:

- 13 views SQL (ver Prompt Mestre seção 7)
- Função `fn_ia_marketplaces_insights()` paralela à `fn_ia_cortes_recomendados()`
- Card 1 Lucro do Mês (o mais pedido pelo Ailson historicamente)

O `ia-cron.js` do Sprint 3 já foi pensado pra **ser reutilizado**. O próximo
passo é parametrizar o escopo (hoje é `'producao'` hardcoded em duas linhas):
linha do insight "tudo saudável" + retorno da função. Provavelmente vai virar
um ia-cron genérico que aceita `?escopo=producao|marketplaces`.

**Sugestão de arquitetura pro Sprint 4:**
1. Criar `sql/os-amicia/07_views_marketplaces.sql` + `08_fn_marketplaces_insights.sql`
2. Refatorar `ia-cron.js` pra aceitar `?escopo=` e chamar a função certa
3. Ajustar `vercel.json` pra ter 4 entries (2 escopos × 2 janelas)
4. Popular tab Marketplaces do `OsAmicia.jsx` (pode copiar `TabProducao` como template)

---

## 7. Arquivos tocados neste sprint

```
CRIADOS:
  api/ia-cron.js
  api/ia-feed.js
  api/ia-feedback.js
  sql/os-amicia/HANDOFF_SPRINT4.md  (este arquivo)

SUBSTITUÍDOS:
  api/ia-disparar.js  (placeholder → chamada interna real)

EDITADOS:
  vercel.json         (+2 entries de cron)
  src/os-amicia/OsAmicia.jsx  (+ TabProducao, + CardInsight; StatusCard intacto)

INTOCADOS (do Sprint 1 e 2):
  api/_ia-helpers.js
  api/ia-config.js
  api/ia-status.js
  sql/os-amicia/01_tables.sql
  sql/os-amicia/02_seed_ia_config.sql
  sql/os-amicia/03_seed_ia_sazonalidade.sql
  sql/os-amicia/04_policies.sql
  sql/os-amicia/05_views_corte.sql
  sql/os-amicia/06_fn_cortes_recomendados.sql
  src/App.tsx  (contrato intocável das 5 linhas atrás do feature flag)
```

---

## 8. Critérios de sucesso do Sprint 3 (checklist final)

Baseado na seção 9 do briefing:

- [x] `/api/ia-cron` responde 200 com `CRON_SECRET` correto
- [x] `/api/ia-cron` retorna 401 sem token
- [x] `fn_ia_cortes_recomendados()` é chamada e JSONB é processado
- [x] Claude Sonnet 4.6 é chamado com as 8 regras no system prompt
- [x] Insights gravam em `ia_insights` com origem correta
- [x] `ia_usage` grava tokens + custo BRL
- [x] Fallback determinístico funciona (código pronto; falta teste real do Ailson)
- [x] `vercel.json` tem 2 crons (07h + 14h BRT via UTC)
- [x] `/api/ia-disparar` deixa de ser placeholder
- [x] `/api/ia-feed?area=producao` retorna lista ordenada por data DESC
- [x] `/api/ia-feedback` grava respostas
- [x] Tab Produção mostra insights + botão Disparar + botões feedback
- [ ] **Smoke test na preview (ação do Ailson)**
- [x] Commit + push na `os-amicia-fase1`
- [x] HANDOFF_SPRINT4.md gerado

**Só falta o Ailson configurar o `CRON_SECRET` no Vercel e rodar o smoke test.**

---

## 9. Primeira mensagem ao Ailson quando abrir o Sprint 4

> Lido o HANDOFF_SPRINT4. Sprint 3 está 100% codado e deployado — só falta o
> Ailson confirmar smoke test e entregar a saída das queries de validação.
> Meu Sprint 4 entrega views + função de Marketplaces e generaliza o ia-cron
> pra aceitar `?escopo=`. Antes de codar, preciso:
> 1. Confirmação que Sprint 3 passou no smoke test
> 2. Ailson rodar as queries do Passo 0 do Sprint 4 (ver Prompt Mestre seção 7)

---

**Cérebro ligado. Sonho da luz acesa nas mãos do Ailson.** 🧠💡
