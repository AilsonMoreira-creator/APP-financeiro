# 🚀 Sprint 3 · Briefing Completo (auto-contido)

> **Este documento é tudo que você precisa pra começar o Sprint 3 do OS Amícia.**
> Lê ele inteiro (15 min) antes de qualquer código. Não precisa abrir outros arquivos —
> mas eles estão listados no final se quiser confirmar algo.

---

## 📌 Leitura obrigatória antes de tudo

Você é o Claude que vai implementar o Sprint 3 do OS Amícia — o **sistema operacional
de decisão** do app financeiro do Grupo Amícia (confecção feminina, ~R$1.2M/mês em
marketplace).

Antes de **qualquer** código, confirme comigo que leu este arquivo inteiro devolvendo:
1. Qual a missão do Sprint 3 em uma frase
2. Quais são os 3 endpoints novos você vai criar
3. O que acontece se o Claude der timeout
4. Qual é o orçamento mensal hoje

Só depois da minha confirmação, começa.

---

## 1. Quem é o Ailson e como ele trabalha

- **Nome:** Ailson Moreira, dono do Grupo Amícia, São Paulo
- **Linguagem:** Português brasileiro sempre. Direto, técnico, hands-on.
- **Estilo preferido:** opinião clara > análise neutra; "minha recomendação é X porque Y".
- **Canal:** Safari mobile + iPhone + MacBook. Interfaces mobile têm limitações (ver seção 13).
- **Ambiente:** roda SQL no Supabase SQL Editor. **Nunca peça pra ele colar service_role no chat.**

---

## 2. Missão do Sprint 3 em uma frase

**Ativar o cérebro:** pegar o JSON que a `fn_ia_cortes_recomendados()` já gera
e passar pelo Claude Sonnet 4.6 pra gerar insights em linguagem natural, com cron
automático 2x/dia, fallback determinístico se Claude falhar, e UI mínima pra ver
os insights aparecerem no módulo OS Amícia.

---

## 3. Estado atual (o que está PRONTO)

### ✅ Sprint 1 (pronto, não mexer)

Infra do OS Amícia:
- 7 tabelas em Supabase: `ia_insights`, `ia_feedback`, `ia_config` (55 chaves),
  `ia_usage`, `ia_sazonalidade` (5 datas de 2026), `ml_vendas_lucro_snapshot`,
  `calc_historico_snapshot`
- RLS ativo (deny-anon)
- 3 endpoints serverless criados:
  - `/api/ia-config` — GET/PUT thresholds (admin-only no PUT) · **pronto**
  - `/api/ia-status` — GET painel admin · **pronto**
  - `/api/ia-disparar` — POST placeholder · **Sprint 3 vai substituir o corpo**
- Helper compartilhado `/api/_ia-helpers.js` com:
  - `supabase` (service role)
  - `validarAdmin(req)` · header `X-User`
  - `getConfig(chave, fallback)`
  - `setCors(res)`
  - `ANTHROPIC_PRICING`
  - `calcularCustoBRL({modelo, input_tokens, output_tokens, ...})`
  - `gastoMesAtual()`
  - `temOrcamento()` · true se gasto mês < orçamento
- Módulo React isolado em `src/os-amicia/OsAmicia.jsx` (shell com 4 tabs + painel saúde)
- 5 alterações em `src/App.tsx` atrás do feature flag `VITE_OS_AMICIA_ENABLED`

### ✅ Sprint 2 (pronto e validado em produção com dado real)

O cérebro de decisão do fluxo de corte:
- **10 views SQL** em `sql/os-amicia/05_views_corte.sql`
- **1 função** `fn_ia_cortes_recomendados()` em `sql/os-amicia/06_fn_cortes_recomendados.sql`
- **Validado em produção** 21/04 01:55 — retornou 4 refs reais do catálogo
  (2277 Saia Linho, 2601 Vestido Midi Fenda, 2832 Macacão, 2851 sem estoque)

### 🎯 Sprint 3 (é você)

Escrito abaixo na seção 8.

---

## 4. Credenciais e ambiente

### 4.1 GitHub
```
Token: [pedir ao Ailson no primeiro mensagem — ele cola o ghp_xxx]
User:  AilsonMoreira-creator
Email: Exclusivo@amicialoja.com.br
Repo:  AilsonMoreira-creator/APP-financeiro
Branch ativa: os-amicia-fase1
```

**Clonar e entrar na branch:**
```bash
git clone https://<TOKEN>@github.com/AilsonMoreira-creator/APP-financeiro.git
cd APP-financeiro
git checkout os-amicia-fase1
git config user.email "Exclusivo@amicialoja.com.br"
git config user.name "AilsonMoreira-creator"
```

Último commit do Sprint 2: `c7caf20` (docs do HANDOFF_SPRINT3).
**Nunca crie branch nova.** Tudo na `os-amicia-fase1` até merge final.

### 4.2 Vercel
- Preview URL: `app-financeiro-brown.vercel.app` (production deployment)
- Preview branch: `app-financeiro-git-os-am-542748-ailsonmoreira-creators-projects.vercel.app`
- Env vars já configuradas em **Preview + Production**:
  - `SUPABASE_URL`
  - `SUPABASE_KEY` (é a service_role — padrão estabelecido do app, não é anon)
  - `ANTHROPIC_API_KEY` (mesma que o SAC usa)
- Env vars só em Preview:
  - `VITE_OS_AMICIA_ENABLED=true`

**Você vai precisar adicionar no Sprint 3:**
- `CRON_SECRET` (gerar com `openssl rand -hex 32` ou similar) — Preview + Production

### 4.3 Supabase
- URL: vive no env `SUPABASE_URL`
- Acesso write via `SUPABASE_KEY` (service role)
- **Você NUNCA pede service role no chat.** Ailson roda SQL no SQL Editor.
- Para rodar SQL, Ailson precisa que você entregue o conteúdo em link raw do GitHub
  ou blocos copiáveis no chat.

### 4.4 Anthropic
- Modelo: **Claude Sonnet 4.6** (string exata em `ia_config`: `claude-sonnet-4-6`)
- Config atual (ver `ia_config`):
  - `claude_temperatura`: 0.3
  - `claude_max_tokens`: 1500
  - `claude_timeout_s`: 30
  - `claude_prompt_caching_ativar_em_dias`: 30 (não ativar no Sprint 3)
- Preço hardcoded no `_ia-helpers.js` (já existe — ajustar se mudar):
  - Input: $3/Mtok · Output: $15/Mtok
- Taxa USD→BRL: `5.25` em `ia_config.taxa_usd_brl` (admin atualiza manualmente)
- **Orçamento: R$80/mês** em `ia_config.orcamento_brl_mensal`. Estimativa Fase 1: ~R$23/mês.

---

## 5. Catálogo completo de dados (tabelas Supabase)

### 5.1 Tabelas que você VAI USAR no Sprint 3

#### `ia_insights` (Sprint 1, vazia)
Onde grava cada insight gerado pelo Claude ou fallback.

Schema relevante:
```
id UUID PRIMARY KEY DEFAULT gen_random_uuid()
escopo TEXT       CHECK (escopo IN ('estoque','producao','marketplaces','home','pergunta_livre'))
categoria TEXT                -- 'ruptura_critica', 'corte_curva_a', etc.
card_id TEXT                  -- 'producao_card_1' por exemplo
severity TEXT DEFAULT 'info'  CHECK IN ('critico','atencao','positiva','oportunidade','info')
confidence TEXT DEFAULT 'alta' CHECK IN ('alta','media','baixa')
score INTEGER                 -- 0..100
titulo TEXT NOT NULL
resumo TEXT                   -- ≤2 frases
impacto TEXT                  -- ≤1 frase
acao_sugerida TEXT            -- ≤1 frase
chaves JSONB                  -- { ref, cor, tam, sala, curva } quando relevante
origem TEXT                   -- 'claude_sonnet_4_6' ou 'fallback_deterministico'
gerado_em TIMESTAMPTZ DEFAULT NOW()
arquivado_em TIMESTAMPTZ
```

Retenção: 90d em "arquivado" → limpeza mensal. No Sprint 3 só insere, não limpa.

#### `ia_usage` (Sprint 1, tem registros de placeholder)
Auditoria de custo e rate limit por dia e por mês.

```
id UUID PRIMARY KEY
data DATE
ano_mes TEXT                  -- 'YYYY-MM' — usado pra rollup mensal
tipo TEXT                     -- 'cron' | 'pergunta_livre' | 'fallback'
modelo TEXT                   -- 'claude-sonnet-4-6' | 'fallback_deterministico'
input_tokens INTEGER
output_tokens INTEGER
cache_read_tokens INTEGER DEFAULT 0
cache_write_tokens INTEGER DEFAULT 0
custo_usd NUMERIC
custo_brl NUMERIC
user_id TEXT                  -- quem disparou (ou 'cron')
created_at TIMESTAMPTZ DEFAULT NOW()
```

#### `ia_config` (Sprint 1, 55 chaves populadas)
Todos os thresholds e configs. Ler com `getConfig(chave, fallback)` do helper.

Chaves relevantes pro Sprint 3:
```
cron_horarios_brt = ["07:00","14:00"]
claude_modelo = "claude-sonnet-4-6"
claude_temperatura = 0.3
claude_max_tokens = 1500
claude_timeout_s = 30
orcamento_brl_mensal = 80
orcamento_brl_alerta_pct = 75
taxa_usd_brl = 5.25
pergunta_livre_max_dia = 5
pergunta_livre_min_chars = 10
pergunta_livre_max_chars = 500
```

#### `ia_feedback` (Sprint 1, vazia)
Usuário avalia insights com Sim/Parcial/Não. **Sprint 3 só precisa do endpoint /api/ia-feedback.**

```
id UUID
insight_id UUID REFERENCES ia_insights
user_id TEXT
resposta TEXT  CHECK IN ('sim','parcial','nao')
nota TEXT                     -- comentário livre
created_at TIMESTAMPTZ
```

### 5.2 Função que você VAI CHAMAR

#### `fn_ia_cortes_recomendados()`
Retorna JSONB consolidado. Formato:

```json
{
  "versao": "1.0",
  "gerado_em": "2026-04-21T07:00:00",
  "capacidade_semanal": {
    "status": "normal|corrida|excesso",
    "total_cortes": 4,
    "limite_normal": 15,
    "limite_corrida": 20
  },
  "refs": [
    {
      "ref": "2277",
      "descricao": "SAIA DE LINHO ELASTANO BOTÕES FORRADO",
      "severidade": "alta|media|baixa",
      "confianca_ref": "alta|media|baixa",
      "motivo": "demanda_ativa_e_critico|demanda_ativa_e_atencao|ruptura_disfarcada",
      "curva": "A|B|outras",
      "pecas_a_cortar": 713,
      "pecas_estimadas_proximo_corte": 750,
      "rolos_estimados": 13,
      "rolos_efetivos": 52,
      "sala_recomendada": "Antonio|Adalecio|Chico|null",
      "rendimento_sala": 55.5,
      "rendimento_fallback": "N1_ref_propria|N2_categoria|null",
      "confianca_sala": "alta|media|null",
      "categoria_peca": "grande|pequena_media",
      "max_modulos": 6|8,
      "grade": [{"tam":"M","proporcao_pct":27.3}, ...],
      "cores": [{"cor":"Bege","rolos":6,"tendencia":"alta","participacao_pct":35.6}, ...],
      "qtd_variacoes_ativas": 28,
      "qtd_variacoes_atencao": 2,
      "qtd_variacoes_criticas": 90,
      "vendas_30d_total": 1811,
      "estoque_total": 1884
    }
  ]
}
```

**Como chamar via Supabase client JS:**
```js
const { data, error } = await supabase.rpc('fn_ia_cortes_recomendados');
// data é o JSONB inteiro
```

### 5.3 Tabelas que você NÃO PODE ESCREVER

Restrição dura (mantida do Sprint 1 + 2):
- ❌ Fora de `ia_*`, `ml_vendas_lucro_snapshot`, `calc_historico_snapshot`
- ❌ `ordens_corte` tem cinco campos já preparados (`origem`, `insight_id`, `aprovada_por`,
  `aprovacao_tipo`, `validade_ate`) pro Sprint 6, mas **não inserir aqui ainda**

### 5.4 Todas as tabelas existentes (pra não reinventar)

```
amicia_data              bling_resultados         bling_tokens
bling_vendas_detalhe     calc_historico_snapshot  ia_config
ia_feedback              ia_insights              ia_sazonalidade
ia_usage                 ml_conversations         ml_conversions
ml_estoque_ref_atual     ml_estoque_snapshot      ml_estoque_total_mensal
ml_messages              ml_pending_questions     ml_qa_history
ml_qa_history_posvenda   ml_question_locks        ml_response_queue
ml_scf_ref_map           ml_sku_ref_map           ml_stock_alerts
ml_stock_offers          ml_tokens                ml_vendas_lucro_snapshot
ordens_corte             ordens_corte_historico
```

Módulo SAC (o outro sistema que usa Claude) vive em: `ml_conversations`, `ml_messages`,
`ml_qa_history`, `ml_qa_history_posvenda`, `ml_pending_questions`, `ml_question_locks`,
`ml_response_queue`, `ml_stock_alerts`, `ml_stock_offers`. **Não interferir.**

---

## 6. Arquivos existentes que você vai tocar

```
api/
  _ia-helpers.js           ← EXISTE · importe dele (supabase, validarAdmin, getConfig, setCors,
                             calcularCustoBRL, gastoMesAtual, temOrcamento, ANTHROPIC_PRICING)
  ia-config.js             ← EXISTE · não mexer
  ia-status.js             ← EXISTE · não mexer
  ia-disparar.js           ← SUBSTITUIR corpo (hoje é placeholder)
  ia-cron.js               ← CRIAR (novo · motor do Sprint 3)
  ia-feed.js               ← CRIAR (novo · listagem de insights)
  ia-feedback.js           ← CRIAR (novo · thumbs-up/down)

src/os-amicia/
  OsAmicia.jsx             ← EDITAR · popular a tab "Produção" com feed real
                             (hoje é shell com 4 tabs vazias)

sql/os-amicia/
  05_views_corte.sql       ← EXISTE · não mexer
  06_fn_cortes_recomendados.sql  ← EXISTE · não mexer
  HANDOFF_SPRINT4.md       ← CRIAR ao fim do sprint

vercel.json                ← EDITAR · adicionar entries de cron + CRON_SECRET
```

**Nenhum arquivo do App.tsx deve ser modificado no Sprint 3.** As 5 linhas atrás
do feature flag já foram estabelecidas no Sprint 1 e são contrato intocável.

---

## 7. As 8 regras do prompt de sistema do Claude

Essas 8 regras são o **prompt de sistema** que você vai mandar pro Claude Sonnet 4.6
na `/api/ia-cron`. Elas são não-negociáveis. Copiar literal:

1. Toda análise termina em ação concreta (não "considerar", "avaliar"; sim "cortar 6 rolos hoje")
2. Estoque zerado não é critério pra produção — sempre cruzar com demanda
3. Margem é desempate, nunca decisor único
4. Produção em oficina detalha cor+tam (confiança alta)
5. Respeite a confiança que vem no input — não invente certeza
6. Linguagem direta, números concretos, sem adjetivos vagos
7. Brevidade: `resumo` ≤2 frases, `acao_sugerida` ≤1 frase, `impacto` ≤1 frase
8. Nomes de produtos e refs vindos do input são autoridade — não traduzir, não abreviar

**Regra bônus (do HANDOFF_SPRINT2):** marca "Amícia" NUNCA aparece em insights (é
interna). Refs vêm sem zero à esquerda (2277, não 02277) porque a função já normaliza.

---

## 8. Plano de execução do Sprint 3 (10 passos)

### Passo 0 — Validação de pré-requisitos (ANTES de qualquer código)

Peça pro Ailson rodar no SQL Editor e cole o resultado:

```sql
-- (a) A função existe e executa?
SELECT proname FROM pg_proc WHERE proname = 'fn_ia_cortes_recomendados';
-- Esperado: 1 linha

-- (b) Retorna JSON válido?
SELECT jsonb_array_length((fn_ia_cortes_recomendados())->'refs') AS total;
-- Esperado: número >= 0 (em 21/04 deu 4)

-- (c) ia_insights está vazia?
SELECT COUNT(*) FROM ia_insights;
-- Esperado: 0 (primeira execução do OS)

-- (d) Orçamento disponível?
SELECT COALESCE(SUM(custo_brl), 0) AS gasto_mes
FROM ia_usage
WHERE ano_mes = to_char(NOW(), 'YYYY-MM');
-- Esperado: próximo de 0 (só tem registros de placeholder do Sprint 1)
```

**Se algum falhar:** PARE e pergunte ao Ailson. Não tente "corrigir" — Sprint 2 já
foi validado em produção, qualquer discrepância precisa investigação.

### Passo 1 — Criar `api/ia-cron.js` (o motor)

Endpoint que **orquestra tudo**. Fluxo:

```
1. Valida auth (cron secret via query ?token= OU header X-Cron-Secret)
2. Chama supabase.rpc('fn_ia_cortes_recomendados') → recebe JSONB
3. Se total de refs == 0 → grava "tudo saudável" em ia_insights e retorna 200
4. Se temOrcamento() == false → pula Claude, vai direto pro fallback determinístico
5. Tenta Claude Sonnet 4.6 com prompt sistema das 8 regras + JSONB como input
   - Timeout 30s (ver claude_timeout_s)
   - Se timeout → 1 retry com temperatura 0.1
   - Se ainda falhar → fallback determinístico
6. Parseia JSON de saída do Claude (array de insights com 8 campos)
7. Valida: escopo, severity, confidence, titulo obrigatórios
8. Grava cada insight em ia_insights com origem='claude_sonnet_4_6'
9. Grava consumo em ia_usage
10. Retorna { ok, total_insights_gerados, custo_brl, modo: 'claude'|'fallback' }
```

**Auth model:**
- Via cron Vercel: query `?token=<CRON_SECRET>` (Vercel mete em URL)
- Via /api/ia-disparar interno: header `X-Cron-Secret` = env `CRON_SECRET`
- Sem auth → 401

**Chamada Claude (via fetch, não instale SDK):**
```js
const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-5',  // ou o string exato que o ia_config retornar
    max_tokens: 1500,
    temperature: 0.3,
    system: PROMPT_SISTEMA,
    messages: [{ role: 'user', content: JSON.stringify(inputJson) }]
  }),
  signal: AbortSignal.timeout(30000)
});
```

**IMPORTANTE sobre o nome do modelo:** `claude-sonnet-4-6` é o string em `ia_config`
mas **verifique se é esse mesmo que a API Anthropic aceita**. Na dúvida, procure o
SAC (`ml-*.js` files) pra ver qual string ele usa — o SAC já chama Claude Sonnet 4.6
em produção e é a fonte da verdade.

**Formato esperado da resposta do Claude (prompt diz pra retornar assim):**
```json
[
  {
    "escopo": "producao",
    "categoria": "corte_curva_a",
    "severity": "critico",
    "confidence": "alta",
    "titulo": "REF 2277 precisa de corte urgente",
    "resumo": "Saia Linho tem 90 variações críticas com 28 vendas ativas.",
    "impacto": "Risco de stockout em 7 dias na curva A.",
    "acao_sugerida": "Cortar 713 pç na sala Antonio (55.5 pç/rolo, 13 rolos).",
    "chaves": {"ref":"2277","sala":"Antonio","curva":"A"}
  }
]
```

### Passo 2 — Fallback determinístico (dentro de ia-cron.js)

Se Claude falhar (timeout ou erro) ou orçamento estourou, gera insights por template
a partir do JSONB puro da função. Um insight por ref:

```js
function gerarFallback(ref) {
  const acao = ref.sala_recomendada
    ? `Cortar ${ref.pecas_a_cortar} pç em ${ref.sala_recomendada} (${ref.rendimento_sala} pç/rolo, ${ref.rolos_estimados} rolos).`
    : `Investigar ref sem sala recomendada. ${ref.qtd_variacoes_criticas} variações em estado crítico.`;
  return {
    escopo: 'producao',
    categoria: ref.sala_recomendada ? 'corte_recomendado' : 'investigar_ref',
    severity: ref.severidade === 'alta' ? 'critico' : ref.severidade === 'media' ? 'atencao' : 'info',
    confidence: 'media',  // fallback é sempre média no máximo
    titulo: `REF ${ref.ref} · ${ref.descricao.slice(0, 50)}`,
    resumo: `${ref.qtd_variacoes_ativas} variações ativas, ${ref.qtd_variacoes_criticas} críticas. Vendas 30d: ${ref.vendas_30d_total} peças.`,
    impacto: `Curva ${ref.curva}. Severidade ${ref.severidade}.`,
    acao_sugerida: acao,
    chaves: { ref: ref.ref, sala: ref.sala_recomendada, curva: ref.curva },
    origem: 'fallback_deterministico'
  };
}
```

### Passo 3 — Atualizar `vercel.json` com os crons

Dois entries:
```json
{
  "crons": [
    { "path": "/api/ia-cron?token=$CRON_SECRET&janela=manha", "schedule": "0 10 * * *" },
    { "path": "/api/ia-cron?token=$CRON_SECRET&janela=tarde", "schedule": "0 17 * * *" }
  ]
}
```

**Importante sobre horários:** `0 10 * * *` UTC = **07:00 BRT**, `0 17 * * *` UTC = **14:00 BRT**.
Não é 08h/18h (alguns PDFs antigos do projeto mencionam esses horários — ignorar, o
certo é 07h/14h BRT conforme `ia_config.cron_horarios_brt`).

**Parâmetro `janela`:** pode só logar no insight (útil pra admin saber se é o cron
da manhã ou tarde). Não muda comportamento.

### Passo 4 — Substituir corpo de `api/ia-disparar.js`

O arquivo existe como placeholder. Substituir pra que ele:
1. Valide admin (já faz)
2. Chame internamente `/api/ia-cron` com header `X-Cron-Secret`
3. Retorne o resultado do cron (não 202 mais — 200 com payload)

### Passo 5 — Criar `api/ia-feed.js`

GET que retorna lista de insights. Filtros via query:
```
GET /api/ia-feed?area=producao&limit=20
GET /api/ia-feed?area=producao&desde=2026-04-20
```

Admin-only na v1.0. SELECT em `ia_insights ORDER BY gerado_em DESC`.

### Passo 6 — Criar `api/ia-feedback.js`

POST que grava `ia_feedback`. Body: `{ insight_id, resposta: 'sim'|'parcial'|'nao', nota? }`.

Validar admin (user vira user_id no registro).

### Passo 7 — Popular tab "Produção" no OsAmicia.jsx

Shell já existe em `src/os-amicia/OsAmicia.jsx`. Adicionar:
- `useEffect` chama `/api/ia-feed?area=producao` ao abrir
- Renderiza lista de insights (card por insight com titulo, resumo, impacto, acao_sugerida)
- Botão "Disparar agora" → POST `/api/ia-disparar`
- Botões Sim/Parcial/Não em cada card → POST `/api/ia-feedback`
- Mostrar `confidence` com ícone (🟢 alta · 🟡 media · 🔴 baixa)
- Mostrar `severity` com cor (vermelho crítico, amarelo atenção, verde positiva, azul info)

**Paleta do app** (usar — decisão #design do HANDOFF_SPRINT2):
- Base: `#2c3e50` (cinza-azulado escuro) · `#4a7fa5` (azul médio)
- Fundo: `#f7f4f0` (off-white) · `#e8e2da` (bege claro)
- Alertas: vermelho
- Fonte: Georgia serif nos títulos

**Não importe nada do App.tsx.** Se precisar de algum helper, duplique dentro de
`src/os-amicia/`. Essa separação é contrato do Sprint 1 (decisão #6 HANDOFF).

### Passo 8 — Smoke test na preview

1. Deploy pra preview (push na branch aciona auto-deploy no Vercel)
2. Login como admin no preview
3. Abre módulo OS Amícia → tab Produção → clica "Disparar agora"
4. Espera alguns segundos, refresh, vê insights aparecerem
5. Clica Sim em um → confirma que gravou em `ia_feedback` (SELECT no Supabase)
6. Rodar SQL:
   ```sql
   SELECT escopo, severity, confidence, titulo, acao_sugerida, origem, gerado_em
   FROM ia_insights
   ORDER BY gerado_em DESC
   LIMIT 10;

   SELECT tipo, modelo, input_tokens, output_tokens, custo_brl, created_at
   FROM ia_usage
   WHERE data = CURRENT_DATE
   ORDER BY created_at DESC;
   ```
7. Esperado: insights gravados, custo registrado (~R$0.10-R$0.50 na primeira chamada)

### Passo 9 — Teste do fallback determinístico

Só pra ter certeza que fallback funciona:
1. No Vercel, seta temporariamente `ANTHROPIC_API_KEY` com valor inválido
2. Dispara cron manual via `/api/ia-disparar`
3. Confirma que insights foram gravados com `origem='fallback_deterministico'`
4. Reverte a env var pro valor correto

### Passo 10 — Commit, push, handoff Sprint 4

```bash
git add api/ia-cron.js api/ia-disparar.js api/ia-feed.js api/ia-feedback.js \
        src/os-amicia/OsAmicia.jsx vercel.json \
        sql/os-amicia/HANDOFF_SPRINT4.md
git commit -m "feat(os-amicia): Sprint 3 — cron + Claude Sonnet 4.6 + fallback + UI mínima"
git push origin os-amicia-fase1
```

HANDOFF_SPRINT4.md segue a mesma estrutura deste briefing. Sprint 4 é views de
Marketplaces (13 views + função `fn_ia_marketplaces_insights()` + Card 1 Lucro do Mês).

---

## 9. Critérios de sucesso (checklist binário)

Antes de declarar Sprint 3 fechado, **todos** devem ser ✅:

- [ ] `/api/ia-cron` responde 200 em call autenticada com `CRON_SECRET` correto
- [ ] `/api/ia-cron` retorna 401 sem token
- [ ] Função `fn_ia_cortes_recomendados()` é chamada e JSONB é processado
- [ ] Claude Sonnet 4.6 é chamado e retorna JSON válido com 8 campos por insight
- [ ] Insights são gravados em `ia_insights` com `origem='claude_sonnet_4_6'`
- [ ] `ia_usage` grava tokens + custo BRL corretamente
- [ ] Fallback determinístico funciona quando Claude falha (testado no Passo 9)
- [ ] `vercel.json` tem 2 entries de cron (07h + 14h BRT via UTC)
- [ ] `/api/ia-disparar` deixa de ser placeholder e funciona
- [ ] `/api/ia-feed?area=producao` retorna lista ordenada por data DESC
- [ ] `/api/ia-feedback` grava respostas em `ia_feedback`
- [ ] Tab Produção do OsAmicia.jsx mostra insights + botão Disparar + botões feedback
- [ ] Smoke test no preview: disparar manual → insights aparecem na UI
- [ ] Commit + push na `os-amicia-fase1`
- [ ] `HANDOFF_SPRINT4.md` gerado
- [ ] **Orçamento consumido ≤ R$1 no teste** (queremos estimativa de Fase 1 em ~R$23/mês)

---

## 10. Regras duras (o que NÃO fazer)

Violação = refazer.

- ❌ **Não importar nada do `App.tsx`** dentro de `src/os-amicia/`
- ❌ **Não escrever em tabelas** fora de `ia_*`, `ml_vendas_lucro_snapshot`,
  `calc_historico_snapshot`. **Inclui `ordens_corte` — Sprint 6, não agora.**
- ❌ **Não mexer em policies/RLS** de tabelas pré-existentes
- ❌ **Não fazer refactor** do `App.tsx` — as 5 linhas atrás do feature flag são contrato
- ❌ **Não instalar SDK da Anthropic** — fetch nativo resolve, minimiza dependências
- ❌ **Não deploy em Production** — Sprint 3 vive 100% em preview até decisão explícita
- ❌ **Não pedir service role no chat** — Ailson roda SQL no SQL Editor
- ❌ **Não criar branch nova** — tudo em `os-amicia-fase1`
- ❌ **Não alterar `fn_ia_cortes_recomendados()`** — se precisar mexer, abra um Sprint
  2.5 em commit separado com justificativa
- ❌ **Não ativar Prompt Caching** ainda — `claude_prompt_caching_ativar_em_dias=30`,
  depende do prompt estabilizar primeiro
- ❌ **Não citar "Amícia" nos insights gerados** — marca interna

---

## 11. Problemas conhecidos do ambiente

### 11.1 Parser do Supabase SQL Editor (mobile) quebra com comentários longos

Linhas de comentário SQL com 50+ caracteres `=` seguidos disparam erro `42601:
operator too long`. **Não usar delimitadores `-- ===...===` nos arquivos SQL que
o Ailson vai rodar no SQL Editor.** Use comentários curtos e separação por linha
em branco. (Sprint 2 teve que corrigir isso — commits `9f2d4cc` e `39cb393`.)

### 11.2 Flag `alerta_duplicata` "sticky" em `ml_estoque_ref_atual`

Refs 2277, 2601, 2832 (top sellers) aparecem com `alerta_duplicata=true` mesmo
após o cron consolidar os MLBs duplicados. Isso joga `confianca_ref='media'` nas
views. **Não é bug do Sprint 2/3** — é do `ml-estoque-cron.js` que não reseta
a flag. **Impacto mínimo no Sprint 3**: insights podem marcar confiança média
sem necessidade. Se incomodar muito o Ailson, abrir issue separada.

### 11.3 Duplicata "Verde Água" vs "Verde Agua" (com/sem acento)

Views do Sprint 2 fazem `LOWER(TRIM())` mas não removem acentos. Cores com acento
variável aparecem duplicadas no output do corte (ver saída real da ref 2601).
Correção sugerida é habilitar extensão `unaccent` no Postgres e trocar por
`LOWER(TRIM(unaccent(cor)))`. **Não priorizar no Sprint 3 — abrir ticket separado.**

### 11.4 REF sem estoque no ML pode aparecer com campos null

Ref 2851 no teste real de 21/04 veio com `descricao=""`, `sala_recomendada=null`,
`rendimento_sala=null`. **Seu código do fallback + parsing do Claude precisa
lidar com null graciosamente.** A função de fallback que mostrei no Passo 2 já
trata isso via `ref.sala_recomendada ? ... : ...`.

### 11.5 O módulo SAC (ml-*.js) também usa Claude Sonnet 4.6

- Compartilha `ANTHROPIC_API_KEY` no Vercel
- **Compete pelo mesmo orçamento mensal** — monitorar `gastoMesAtual()`
- Serve de referência pra formato de chamada fetch, parsing, tratamento de erro.
  Arquivo bom pra olhar: qualquer `ml-*.js` que tenha `anthropic.com/v1/messages`
  no grep

---

## 12. Como chamar a função do Postgres no código Node

A função `fn_ia_cortes_recomendados()` foi criada com `SECURITY DEFINER` e
`GRANT EXECUTE TO service_role, authenticated`. Chamada via supabase-js:

```js
import { supabase } from './_ia-helpers.js';

const { data, error } = await supabase.rpc('fn_ia_cortes_recomendados');
if (error) throw new Error(`fn_ia_cortes_recomendados falhou: ${error.message}`);
// data é o JSONB inteiro
// data.refs é o array
// data.capacidade_semanal é o objeto de status
```

**Não faça `from('vw_cortes_recomendados_semana').select('*')` direto** — as views
leem dados e a consolidação final tem lógica JSON que só a função faz (capacity
status + normalização de nulls). Sempre passa pela função.

---

## 13. Como apresentar ao Ailson no mobile

Quando mandar código SQL pra ele rodar:
- **Use link raw do GitHub** sempre que possível (ele já conhece o fluxo):
  `https://raw.githubusercontent.com/AilsonMoreira-creator/APP-financeiro/os-amicia-fase1/<path>`
- **Não cole SQL com `-- ===...===`** em comentários (parser quebra)
- **Blocos de até ~50 linhas** colam bem no mobile; acima disso, prefira link raw

Quando pedir resultado de query:
- Queries curtas (uma pergunta por vez) funcionam melhor
- Se ele mandar screenshot, você consegue ler bem

Quando apresentar findings:
- Começa com conclusão (TL;DR)
- Números concretos, não adjetivos
- Sinaliza o que é bug vs feature vs edge case
- Opinião clara ao final (não "temos opções A, B ou C, o que prefere?")

---

## 14. Mini-glossário Amícia

- **Marcas do grupo:** Exitus, Lumia, Muniam (marketplaces), Amícia (wholesale B2B), Meluni (B2C DTC)
- **Ideris:** hub de estoque central. Espelha estoque pros 11 canais de marketplace.
- **ML Lumia:** uma das 3 contas ML. Como todos os canais espelham, **é o "proxy de leitura"**
  do estoque no app.
- **Salas de corte:** Antonio, Adalecio, Chico. **Cortam o tecido** (produzem peças cruas).
- **Oficinas:** Dilmo, Hugo, Joaquim, Roberto Belém. **Costuram** as peças cortadas.
- **Enfesto:** um corte de tecido. "1 corte = 1 ref inteira com todas as cores juntas."
- **Rolo:** unidade de tecido. Rendimento é "peças produzidas ÷ rolos usados".
- **Curva A:** top 10 refs em venda. Curva B: posições 11-20.
- **Grade:** distribuição de tamanhos (ex: P=15%, M=27%, G=31%, GG=26%).
- **Lead time:** 22 dias fixos (uniforme, oficinas só têm data de saída).
- **Cobertura alvo:** 28 dias (22 lead + 6 folga).
- **Meluni:** marca B2C. Persona: mulheres 24-45, classes C+/B/B+, Sul/Sudeste.

---

## 15. Primeira mensagem ao Ailson

Depois de clonar e ler este briefing, sua primeira mensagem deve ser:

> Lido. Missão: [parafraseia a seção 2]. Vou criar 3 endpoints novos
> (`ia-cron.js`, `ia-feed.js`, `ia-feedback.js`) + substituir `ia-disparar.js`
> + popular tab Produção no OsAmicia.jsx + atualizar vercel.json.
>
> Se Claude der timeout, 1 retry com temp 0.1, aí fallback determinístico
> que usa o próprio JSONB da função.
>
> Orçamento atual: R$80/mês, com alerta em 75%.
>
> Antes de escrever código, preciso do resultado do Passo 0 no SQL Editor:
> [cola as 4 queries da seção 8 Passo 0]

Só **depois** do resultado do Passo 0 você começa a escrever o `ia-cron.js`.

---

## 16. Se tiver dúvida, leia (nesta ordem)

1. Este briefing (`SPRINT3_BRIEFING.md`) — 99% das respostas estão aqui
2. `sql/os-amicia/HANDOFF_SPRINT2.md` — bíblia histórica, decisões travadas
3. `sql/os-amicia/HANDOFF_SPRINT3.md` — contexto adicional do final do Sprint 2,
   especialmente seção 13 (achados do smoke test real)
4. `docs/pacote-os-amicia/02_PROMPT_MESTRE_OS_Amicia.md` seção 6 — endpoints +
   integração Claude oficial (pode ter info desatualizada; briefing atual vence)
5. `api/_ia-helpers.js` — todos os helpers que você vai usar
6. `api/ia-config.js`, `api/ia-status.js` — padrão de endpoint do OS
7. Qualquer `api/ml-*.js` que chame Anthropic — referência real de código

---

## 17. Critério definitivo de "Sprint 3 entregue"

Ailson clica "Disparar agora" na tab Produção do OS Amícia no preview. Em ~10
segundos, aparecem 3-6 cards com insights em português claro sobre quais refs
cortar esta semana, onde, quanto, com que grade e que cores. Ele lê, clica 👍
em um, 👎 em outro, e fecha. Cron roda sozinho às 07h na quarta de manhã.

Isso é acender a luz.

---

**Força. O cérebro está pronto, falta ligar.** 🧠⚡
