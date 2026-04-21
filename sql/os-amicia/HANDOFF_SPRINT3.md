# 📦 OS Amícia · Handoff para Sprint 3

**Gerado em:** 21/04/2026 (madrugada)
**Autor:** sessão de implementação Sprint 2
**Destinatário:** próximo chat / Claude que pegar o Sprint 3

> **Leia esse arquivo primeiro, inteiro, antes de escrever qualquer código.**
> Depois leia, nesta ordem: `sql/os-amicia/HANDOFF_SPRINT2.md` (histórico),
> `docs/pacote-os-amicia/README.md` (índice), e seção 6 do Prompt Mestre
> (endpoints + integração Claude — é a sua seção).

---

## 1. Status atual

✅ **Sprint 2 CONCLUÍDO** e validado em ambiente Postgres 16 local em 21/04/2026.

Entregue:
- **10 views SQL** em `sql/os-amicia/05_views_corte.sql` (~960 linhas)
  1. `vw_variacoes_classificadas` — base ref+cor+tam
  2. `vw_refs_elegiveis_corte` — gatekeeper de demanda
  3. `vw_tamanhos_em_gap_por_ref` — tamanhos com gap + proporção
  4. `vw_grade_otimizada_por_ref` — aplica 6/8 módulos
  5. `vw_distribuicao_cores_por_ref` — participação + multiplicador de tendência
  6. `vw_rendimento_sala_corte` — fallback N1→N2 (decisão #2 HANDOFF_SPRINT2)
  7. `vw_projecao_22_dias_por_ref` — 3 cenários A/B/C
  8. `vw_ranking_curvas_bling` — classifica A/B/outras
  9. `vw_tendencia_cor_catalogo` — alta/estável/queda agregado
  10. `vw_cortes_recomendados_semana` — consolidadora final (saída pro Claude)
- **Função orquestradora** `fn_ia_cortes_recomendados()` em
  `sql/os-amicia/06_fn_cortes_recomendados.sql` com `SECURITY DEFINER`
  e GRANT EXECUTE pra `service_role` + `authenticated`
- **HANDOFF_SPRINT3.md** (este arquivo)

**Branch:** `os-amicia-fase1`
**Commits novos (Sprint 2):** ver `git log --oneline -5`
**Validação:** Postgres 16 local com seed sintético — ver seção 4.

---

## 2. Decisão de escopo durante o Sprint 2

No início do sprint surgiu dúvida sobre se seria necessário criar uma nova
tabela `ml_estoque_snapshot` (e endpoint + cron) pra popular estoque pras
views. Após investigação do repo, descobriu-se que **toda infra de estoque já
existe**:

- `ml_estoque_ref_atual` — estoque atual por ref com `variations` jsonb
  `[{sku, cor, tam, qtd}, ...]`
- `ml_estoque_snapshot` — estoque atual por SKU
- `ml_estoque_total_mensal` — histórico mensal
- `/api/ml-estoque-cron.js` (641 linhas) — cron que popula as 3 via ML Lumia API
- `/api/ml-estoque.js` — endpoint de leitura (já consumido pelo módulo Bling no app)

**Sprint 2 voltou ao escopo original** — 10 views + 1 função. Zero infra nova.

**Fonte de estoque das views:** `ml_estoque_ref_atual` (consolidada por ref,
anti-duplicação resolvida pelo cron existente).

---

## 3. Descobertas importantes do mapa de dados

### Shape do `bling_vendas_detalhe.itens` (jsonb array)

```json
[{
  "ref": "02601",              // ← com zero à esquerda
  "cor": "Preto",              // ← PascalCase (precisa LOWER pra join)
  "tamanho": "GG",             // ← nota: "tamanho", não "tam"
  "quantidade": 1,
  "valor": 93.9,               // ← preço unitário REAL (não só total!)
  "codigo": "I82gqdf40xdd16",  // SKU interno
  "descLimpa": "Vestido Midi de Linho...",
  "descricao": "Vestido Midi... (ref 02601) (A) Cor:PRETO;Tamanho:GG"
}]
```

**Importante:** NÃO há coluna `status` (faturado/cancelado). A tabela parece
conter só pedidos "Atendido" já filtrados (consistente com a regra de negócio
do Grupo Amícia documentada). **Assumimos toda linha = venda válida.**

### Shape do `ml_estoque_ref_atual.variations` (jsonb array)

```json
[{"sku":"SK01","cor":"Preto","tam":"P","qtd":0}, ...]
```

Nota a inconsistência: bling usa `tamanho`, ml_estoque usa `tam`. As views
normalizam ambos pro alias `tam`.

### Shape do `amicia_data` (JSONBs por `user_id`)

- `user_id='salas-corte'` → `{salas, cortes, logs}`
  - `cortes[]`: `{id, data, sala, ref, descricao, marca, qtdRolos, qtdPecas,
    rendimento, status, alerta, visto}`
  - Status: `"pendente"` ou `"concluido"`
- `user_id='ailson_cortes'` → `{cortes}` (cortes enviados pras **oficinas**,
  NÃO pras salas de corte — são coisas diferentes!)

### Normalização aplicada em todas as views

- **ref**: `LTRIM(ref, '0')` — bling tem `"02601"`, salas-corte tem `"2601"`
- **cor**: join via `LOWER(TRIM(cor))`, output preserva grafia original do ML
- **tam**: `UPPER(TRIM())`, alias unificado

---

## 4. Validação local feita no Sprint 2

Postgres 16 local, banco `osamicia_test`, seed sintético com REF 2277
(vestido) e 2601. Resultados obtidos:

**10 CREATE VIEW sem erro** + **CREATE FUNCTION sem erro**.

**Teste 1 — execução com DB vazio:**
```json
{"refs":[], "capacidade_semanal":{"status":"normal","total_cortes":0,...}}
```

**Teste 2 — execução com seed (REF 2277 + REF 2601):**
```json
{
  "refs": [{
    "ref": "2277",
    "descricao": "Vestido Midi de Linho Cintura Alta",
    "severidade": "alta",
    "motivo": "demanda_ativa_e_critico",
    "pecas_a_cortar": 21,
    "sala_recomendada": "Antonio",
    "rendimento_sala": 28.5,
    "rendimento_fallback": "N1_ref_propria",
    "confianca_sala": "alta",
    "categoria_peca": "grande",
    "max_modulos": 6,
    "grade": [{"tam":"M","proporcao_pct":69}, {"tam":"G","proporcao_pct":31}],
    "cores": [
      {"cor":"Preto","rolos":3,"tendencia":"estavel","participacao_pct":75.9},
      {"cor":"Bege","rolos":3,"tendencia":"estavel","participacao_pct":24.1}
    ],
    ...
  }],
  "capacidade_semanal":{"status":"normal","total_cortes":1,...}
}
```

**Observações validadas:**
- ✅ Fallback N1→N2: REF 2277 × Antonio → N1 (2 cortes próprios, alta);
  REF 2601 × Antonio → N2 (0 cortes próprios, cai pra média "vestido" na sala)
- ✅ Filtragem de refs não elegíveis: REF 99999 (saudável) não aparece;
  REF 2601 filtrada porque tinha corte pendente de 100pç já cobrindo demanda
- ✅ Detecção "Vestido" → peça grande → max 6 módulos
- ✅ Piso de 3 rolos/cor domina quando rolos_estimados é baixo
- ✅ Grafia de cor preservada ("Preto", "Bege" — não "preto", "bege")

---

## 5. Credenciais (inalteradas desde Sprint 1)

### GitHub
```
Token: [pedir ao Ailson no primeiro mensagem do próximo chat]
Email: Exclusivo@amicialoja.com.br
User:  AilsonMoreira-creator
Repo:  AilsonMoreira-creator/APP-financeiro
Branch: os-amicia-fase1
```

### Supabase
- `SUPABASE_URL`, `SUPABASE_KEY` já no Vercel (Preview + Production)
- Service role = `SUPABASE_KEY` (padrão estabelecido)
- **Nunca pedir pro Ailson colar service role no chat** — ele roda SQL no
  SQL Editor

### Anthropic
- `ANTHROPIC_API_KEY` já no Vercel (usada pelo SAC também)
- Modelo: Claude Sonnet 4.6 (`claude-sonnet-4-6` em `ia_config`)

### Feature flag
- `VITE_OS_AMICIA_ENABLED=true` — só em **Preview**, nunca Production ainda.

---

## 6. Plano do Sprint 3

**Objetivo:** Cron automatizado 07h/14h BRT + integração Claude Sonnet 4.6
com fallback determinístico.

**Duração estimada:** 1 sessão longa ou 2 médias.

### Passo 0 — Validação de pré-requisitos

Rodar no SQL Editor do Supabase (confirmar que Sprint 2 foi aplicado):

```sql
-- Função existe?
SELECT proname FROM pg_proc WHERE proname = 'fn_ia_cortes_recomendados';

-- Todas as 10 views existem?
SELECT viewname FROM pg_views
WHERE viewname LIKE 'vw_%'
  AND viewname IN (
    'vw_variacoes_classificadas','vw_refs_elegiveis_corte',
    'vw_tamanhos_em_gap_por_ref','vw_grade_otimizada_por_ref',
    'vw_distribuicao_cores_por_ref','vw_rendimento_sala_corte',
    'vw_projecao_22_dias_por_ref','vw_ranking_curvas_bling',
    'vw_tendencia_cor_catalogo','vw_cortes_recomendados_semana'
  )
ORDER BY viewname;
-- Esperado: 10 linhas

-- Função executa?
SELECT fn_ia_cortes_recomendados();
-- Esperado: JSONB com {refs:[...], capacidade_semanal:{...}, versao, gerado_em}

-- REF 02277 aparece?
SELECT elem FROM jsonb_array_elements((fn_ia_cortes_recomendados())->'refs') elem
WHERE elem->>'ref' = '2277';
```

### Passo 1 — Endpoint `/api/ia-cron` (cron principal)

Criar `api/ia-cron.js`:

- Autenticação: header `x-cron-secret` ou query param `?token=` validado contra
  env `CRON_SECRET` (setar no Vercel)
- Chama `fn_ia_cortes_recomendados()` → recebe JSONB
- Passa pro Claude Sonnet 4.6 com prompt de sistema fixo (8 regras do Prompt
  Mestre seção 6)
- Parseia JSON de saída (array de insights com 8 campos)
- Grava cada insight em `ia_insights` (tabela do Sprint 1)
- Grava uso em `ia_usage` (tokens + custo)
- Retorna resumo pra UI / logs

**Prompt de sistema** (vive em `ia_config` se possível, ou hardcoded no Sprint 3):
Consultar seção 6 do Prompt Mestre. As 8 regras:
1. Toda análise termina em ação concreta
2. Estoque zerado não é critério pra produção — sempre cruzar com demanda
3. Margem é desempate, nunca decisor único
4. Produção em oficina detalha cor+tam (confiança alta)
5. Respeite a confiança do input — não invente certeza
6. Linguagem direta, números concretos, sem adjetivos vagos
7. Brevidade: resumo ≤2 frases, ação ≤1 frase, impacto ≤1 frase
8. Nomes de produtos e refs vindos do input são autoridade

### Passo 2 — Fallback determinístico

Se chamada Claude falhar (timeout 30s, 1 retry com temp 0.1, aí fallback):
- Gerar insights a partir do JSONB puro da função
- Template-based: "REF {ref} precisa de corte — {pecas_a_cortar} peças
  distribuídas em {grade}. Sala: {sala_recomendada}."
- Marcar `confidence = 'media'` e `source = 'fallback'` em `ia_insights`

### Passo 3 — Cron Vercel (`vercel.json`)

Adicionar entries em `vercel.json`:
```json
{
  "crons": [
    {"path": "/api/ia-cron?token=$CRON_SECRET&janela=manha", "schedule": "0 10 * * *"},
    {"path": "/api/ia-cron?token=$CRON_SECRET&janela=tarde", "schedule": "0 17 * * *"}
  ]
}
```
(10h UTC = 07h BRT, 17h UTC = 14h BRT)

### Passo 4 — Endpoint `/api/ia-disparar` (atualizar placeholder do Sprint 1)

Admin dispara cron manualmente. Validação: `isAdmin()` via `validarAdmin()`
do `_ia-helpers.js`. Chama `/api/ia-cron` internamente (sem cron secret,
com admin token).

### Passo 5 — Endpoint `/api/ia-feed` (GET)

Retorna lista de `ia_insights` filtrada por `?area=producao` (ou estoque,
marketplaces, home). Admin-only na v1.

### Passo 6 — UI mínima no OsAmicia.jsx

Aba "Produção" do módulo OS Amícia (já tem tabs, só falta conteúdo):
- Lista de insights (`fetch /api/ia-feed?area=producao`)
- Botão "Disparar agora" (chama `/api/ia-disparar`)
- Feedback thumbs-up/down/partial (POST `/api/ia-feedback`)

### Passo 7 — Orçamento + Telemetria

- `ia_usage`: gravar tokens de entrada, saída, custo USD, custo BRL
  (via `taxa_usd_brl` do ia_config)
- Painel admin em `/api/ia-status`: uso do mês, % do orçamento, próximo cron
- Bloquear chamadas se `orcamento_brl_mensal` estourado (hoje R$80)

### Passo 8 — Commit e push

Branch `os-amicia-fase1` — não criar nova.

### Passo 9 — Atualizar HANDOFF_SPRINT4.md

Sprint 4 = views dos Marketplaces (13 views + função `fn_ia_marketplaces_insights()`).

---

## 7. Arquivos-chave (onde está o quê) — atualizado

| Precisa saber... | Arquivo |
|---|---|
| Schema das 7 tabelas do OS | `sql/os-amicia/01_tables.sql` |
| Thresholds (55 chaves) | `sql/os-amicia/02_seed_ia_config.sql` |
| **10 views do corte** | `sql/os-amicia/05_views_corte.sql` (Sprint 2) |
| **Função orquestradora corte** | `sql/os-amicia/06_fn_cortes_recomendados.sql` (Sprint 2) |
| Padrão de endpoint serverless | `api/bling-health.js` (exemplo existente) |
| Validar admin | `api/_ia-helpers.js` → `validarAdmin()` |
| Cliente Supabase serverless | `api/_ml-helpers.js` (`supabase`) |
| Cliente Supabase frontend | `src/supabase.js` |
| Shell do OS no frontend | `src/os-amicia/OsAmicia.jsx` |
| Tabela ml_estoque_ref_atual | populada por `api/ml-estoque-cron.js` |
| Todas as tabelas Supabase | ver seção 8 abaixo |

---

## 8. Catálogo completo de tabelas Supabase (confirmado via grep em 21/04)

```
amicia_data              bling_resultados         bling_tokens
bling_vendas_detalhe     ia_config                ia_feedback
ia_insights              ia_sazonalidade          ia_usage
calc_historico_snapshot  ml_conversations         ml_conversions
ml_estoque_ref_atual     ml_estoque_snapshot      ml_estoque_total_mensal
ml_messages              ml_pending_questions     ml_qa_history
ml_qa_history_posvenda   ml_question_locks        ml_response_queue
ml_scf_ref_map           ml_sku_ref_map           ml_stock_alerts
ml_stock_offers          ml_tokens                ml_vendas_lucro_snapshot
ordens_corte             ordens_corte_historico
```

---

## 9. Decisões técnicas do Sprint 2 (não revisitar)

1. **Views regulares (não materialized)** — volume baixo (~50 refs ativas),
   cron roda 2x/dia, frescor > cache. Migrar pra materialized só se lento.
2. **Leitura de `ia_config` via `#>> '{}'`** — robusto contra edits humanos
   que salvem number como string JSONB. Usado em 30 leituras.
3. **`LTRIM(ref, '0')`** — padroniza refs entre bling (`"02601"`) e
   salas-corte (`"2601"`). Aplicado em todas as views.
4. **Ordem de criação:** view 9 vem antes da 5 (dependência) — numeração
   oficial preservada, mas ordem de CREATE ajustada com NOTA explicativa.
5. **Cortes pendentes estimam peças via `rendimento_pecas_por_rolo_default`**
   quando `qtdPecas` é null. Chave em `ia_config`, valor inicial 20.
6. **"1 corte = 1 ref inteira"** (decisão HANDOFF_SPRINT2 #definicao_de_corte).
   Total de cortes da semana = quantidade de linhas em
   `vw_cortes_recomendados_semana`.
7. **Tamanho "Único" filtrado** em `vw_variacoes_classificadas` (decisão #3
   HANDOFF_SPRINT2). Cortes antigos com Único continuam válidos, só não são
   propostos pelo OS.
8. **Grafia de cor preservada**: prioridade `cor_display_venda > cor_display_estoque > lowercase_key`.
   Output sempre na grafia mais amigável disponível.

---

## 10. O que NÃO mexer no Sprint 3

- ❌ Não importar nada do `App.tsx` dentro de `src/os-amicia/`
- ❌ Não escrever em tabelas que não sejam `ia_*`, `ml_vendas_lucro_snapshot`,
  `calc_historico_snapshot` (exceto INSERT em `ordens_corte` ao aprovar
  sugestão — mas isso é Sprint 6, não 3)
- ❌ Não mexer em policies/RLS de tabelas pré-existentes
- ❌ Não fazer refactor do `App.tsx` — as 5 linhas atrás do feature flag são
  o contrato
- ❌ Não fazer deploy em Production — Sprint 3 vive 100% em preview
- ❌ Não alterar as 10 views do Sprint 2 sem bumping versão da função

---

## 11. Como abrir o próximo chat

Sugestão de abertura (copiar e colar):

> "Sprint 2 do OS Amícia concluído e validado com seed sintético em Postgres
> local. Agora partir pro Sprint 3 — cron 07h/14h + Claude Sonnet 4.6 + fallback
> determinístico. Usar branch `os-amicia-fase1` que já existe. Leia primeiro
> `sql/os-amicia/HANDOFF_SPRINT3.md` do repo (isso te dá 100% do contexto).
> Começa pela query de validação de pré-requisitos do Passo 0. Meu token GitHub
> ainda é o mesmo."

Deve levar ~10 min só pra ficar contextualizado.

---

## 12. Critérios de sucesso do Sprint 3

Antes de declarar Sprint 3 fechado:

- [ ] `/api/ia-cron` responde 200 em call autenticada
- [ ] `fn_ia_cortes_recomendados()` é chamada, Claude é chamado, insights são
  gravados em `ia_insights`
- [ ] Fallback determinístico funciona se Claude timeout (testar com `ANTHROPIC_API_KEY` inválida temporária)
- [ ] Cron agendado no `vercel.json` (07h/14h BRT)
- [ ] `ia_usage` grava tokens e custo
- [ ] `/api/ia-disparar` deixa de ser placeholder
- [ ] `/api/ia-feed?area=producao` retorna lista
- [ ] Tab Produção do OsAmicia.jsx mostra insights e botão Disparar
- [ ] Smoke test no preview: disparar manual, ver insight aparecer na UI
- [ ] Commit + push na `os-amicia-fase1`
- [ ] `HANDOFF_SPRINT4.md` gerado

---

**Boa sorte, próximo Claude. A infra tá pronta, o cérebro tá construído,
agora é acender a luz. 🧠💡**
