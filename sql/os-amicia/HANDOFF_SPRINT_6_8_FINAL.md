# HANDOFF — Sessão Sprint 6.8.x Amícia (24/abr/2026)

> **PRÓXIMO CHAT: LEIA ESTE DOC COM CALMA ANTES DE MEXER EM QUALQUER COISA.**  
> O código-fonte é massivo e o contexto do negócio é denso. Sem ler isso, você vai cometer erros que já foram feitos e desfeitos hoje.

---

## 🎫 ACESSO

- **Repo:** `AilsonMoreira-creator/APP-financeiro`
- **Branch ativa de trabalho:** `os-amicia-fase1`
- **Branch de produção (Vercel deploy):** `main`
- **Fluxo de push:** `git push origin os-amicia-fase1:main` (push da branch local direto pra main remota)
- **Git token:** pedir ao Ailson ou ver na conversa anterior (formato `ghp_...`)
- **Working dir da sessão anterior:** `/home/claude/deploy`
- **Deploy URL:** `https://app-financeiro-brown.vercel.app`
- **Supabase project:** `bxxawglmlqoswwyhpeil`

### Primeira coisa a fazer no próximo chat

```bash
# Substitua GH_TOKEN pelo token real do Ailson
GH_TOKEN="ghp_..."
cd /home/claude/deploy 2>/dev/null || (mkdir -p /home/claude && cd /home/claude && git clone "https://${GH_TOKEN}@github.com/AilsonMoreira-creator/APP-financeiro.git" deploy)
cd /home/claude/deploy
git checkout os-amicia-fase1 2>/dev/null || git checkout -b os-amicia-fase1
git pull origin main
git log --oneline -15   # confirma que último commit é 50261ae ou posterior
```

---

## 📐 ARQUITETURA DO APP

- **Frontend:** React/Vite, PWA instalável, deployada no Vercel
- **Backend:** Functions serverless em `/api/*.js` (também Vercel)
- **Banco:** Supabase Postgres (service_role em env var `SUPABASE_KEY`)
- **Storage:** bucket `produtos` com `{REF}.jpg`
- **Arquivo mestre:** `src/App.tsx` com **~9.003 linhas**. NÃO REESCREVER. Editar sempre com str_replace e targeted edits.
- **Módulos React separados em src/:**
  - `App.tsx` — shell principal, financeiro, autenticação, Realtime, Supabase
  - `MLPerguntas.jsx` (~1730 linhas) — SAC pré-venda
  - `MLPosVenda.jsx` — SAC pós-venda (reclamações/devoluções)
  - `OrdemDeCorte.jsx` + `OrdemMatrixModal.jsx` — Sala de Corte
  - `FilaDeCorte.jsx`, `HistoricoVendas.jsx`
- **Skill docs:** `/home/claude/deploy/sql/os-amicia/` tem SQL migrations + HANDOFF_SPRINT*.md de sessões passadas

---

## 🏭 CONCEITOS DO NEGÓCIO — LEIA ISSO ANTES DE TOCAR CÓDIGO

### Fluxo físico de produção

```
1. TECIDO (rolos comprados)
        ↓
2. SALA DE CORTE (3 salas: Antonio, Adalecio, Chico)
   - ESTIMATIVA de consumo
   - Define cores, grade de tamanhos, folhas
   - Ref + cor + tamanho → peças cortadas
        ↓
3. MÓDULO OFICINAS (costura)
   - REAL consumo
   - Envia para oficinas externas costurarem
   - Oficina entrega → entra no estoque
        ↓
4. ESTOQUE (físico + ML Full)
        ↓
5. VENDAS (marketplace ou lojas físicas)
```

### Glossário técnico (NÃO CONFUNDIR)

| Termo | O que é | Onde fica |
|---|---|---|
| **Sala de Corte** | Estimativa pré-corte, 3 salas fixas (Antonio, Adalecio, Chico) | Tabela `ordens_corte` no Postgres |
| **Ordem de Corte** | Cada corte individual NA SALA (estimativa) | Tabela `ordens_corte` |
| **Matriz** | Estrutura `{cores: [{nome, folhas}], tamanhos: [{tam, grade}]}` que fica nos cortes | Embutido em `detalhes` dos cortes |
| **Grade** | Quantidade por tamanho (ex: P=5, M=10, G=8) | Campo `grade` dentro da matriz |
| **Módulo Oficinas (cortes)** | REAL de produção — o que foi pra oficina costurar | `amicia_data` user_id=`ailson_cortes` → `payload.cortes[]` |
| **REF** | Código único da peça (5 dígitos, ex: `02790`) | Ponto de cruzamento entre todos os módulos |
| **SKU** | Código único por cor+tamanho da peça (ex: `02790-MAR-M`) | Tabela `ml_sku_ref_map` |
| **SCF** (seller_custom_field) | Código que o ML usa pra identificar anúncio (ex: `z2304224849`) | Tabela `ml_scf_ref_map` mapeia pra REF |

**⚠ AILSON JÁ CORRIGIU O CLAUDE DA SESSÃO ATUAL uma vez sobre isso:** não confundir Sala de Corte (estimativa, `ordens_corte`) com Módulo Oficinas (real, `ailson_cortes.payload.cortes[]`). Pra forecast/previsão, SEMPRE usar `ailson_cortes`.

### Regra AILSON 22/04 (documentada em `sql/os-amicia/14_fase8_cortes_oficinas.sql`)

> "Sempre usar do módulo oficina cortes (com ou sem granularidade). Pode ser que algum corte ainda não tenha preenchido (no futuro isso não vai acontecer)."

Prazo médio produção: **22 dias a partir de `data` do corte no módulo oficinas**.

Ailson confirmou nesta sessão: **100% das REFs TÊM matriz cadastrada no módulo oficina** (mesmo que a SQL em 14_fase8 preveja fallback pra cortes sem matriz).

### Estrutura de um corte em `ailson_cortes.payload.cortes[]`

```js
{
  id: "uuid-...",
  nCorte: 123,                    // número sequencial
  ref: "02790",
  descricao: "Calça linho alfaiataria",
  oficina: "...",                  // nome da oficina externa
  data: "2026-04-10",              // data do cadastro (conta 22 dias a partir daqui)
  qtd: 50,                         // total peças
  qtdEntregue: 0,
  entregue: false,                 // false = em produção
  detalhes: {
    cores: [{nome: "Bege", folhas: 5}, {nome: "Marrom", folhas: 3}],
    tamanhos: [{tam: "P", grade: 5}, {tam: "M", grade: 10}, ...]
  }
}
```

### Como REF é extraída do anúncio ML (cadeia de fallback)

```
ML item_id (MLB...)
    ↓ item.seller_custom_field = "z2304224849" (padrão Lumia/Amícia) ou "(02790)"
    ↓
1º TENTATIVA: lookup em ml_scf_ref_map (caminho PRINCIPAL ~95%)
    ↓ se falha
2º TENTATIVA: regex — aceita "(02790)", "(ref 02790)", "02790"
    ↓ se falha
3º TENTATIVA: SKU das variations → lookup ml_sku_ref_map
```

Durante esta sessão descobriu-se que os **SCF novos** da Amícia (formato `z2304...`) não casam com a regex, só com o mapa. O mapa é populado automaticamente pelos crons.

---

## 🏪 REGRA DE ESTOQUE VINDA DO MERCADO LIVRE

### Arquitetura do estoque ML

**7 cores carro-chefe (definidas em `api/_ml-helpers.js` linha 19-27):**
1. Preto
2. Bege
3. Figo
4. Marrom
5. Marrom Escuro
6. Azul Marinho
7. Vinho

Override possível: `amicia_data` user_id=`ml-perguntas-config` → `config.stock_colors`.

### Fluxo de estoque quando cliente pergunta no ML

Rodado por `api/ml-webhook.js` função `handleStockFlow()`:

**FLUXO A — Cliente fala cor das 7 + tamanho:**
```
"Tem bege no M?" →
  Bot: "Podemos incluir essa peça na cor Bege no tamanho M! Confirme que..."
  Cria ml_stock_offers status='aguardando_confirmacao'
```

**FLUXO B — Cliente fala só tamanho (sem cor):**
```
"Tem M?" →
  Bot: "Podemos verificar! Em qual cor?"
  Cria ml_stock_offers status='aguardando_cor'
```

**FLUXO C — Cliente confirma oferta pendente:**
```
"Sim, quero!" →
  Bot: "Perfeito! Providenciando..."
  Cria ml_stock_alerts pra Ailson ver no app
  ml_stock_offers marcado status='confirmado'
```

**FLUXO FORECAST — Cliente fala cor FORA das 7 (integrado nesta sessão, commit `50261ae`):**
```
"Azul claro no G?" →
  1. Extrai REF via ml_scf_ref_map
  2. Busca ailson_cortes ativos dessa REF
  3. Confere matriz de cores de cada corte
  4. Se achou produção:
     - ≤ 7 dias restantes → "próximos dias (até 7)"
     - 8-21 dias → "próximas semanas"
     - Atrasado (>22) → deixa IA Claude responder
  5. Se não achou → deixa IA Claude responder
  Cria ml_stock_offers status='forecast_informado' com detalhes.corte_id
```

### Crons de estoque

| Cron | Horário | O que faz |
|---|---|---|
| `ml-estoque-cron` | a cada 6h | Sincroniza estoque ML Full via API |
| `bling-produtos-sync` | 6h diário | Popula `ml_scf_ref_map` + `ml_sku_ref_map` via catálogo Bling |
| `bling-cron` | cada 10min | Puxa vendas do Bling |
| `ml-sync` | 8h diário | Puxa perguntas não respondidas (backup do webhook) |
| `ml-messages-sync` | cada 5min | **Discover + sync pós-venda** (criado nesta sessão) |
| `ml-ai-respond` | cada minuto | Processa fila de respostas IA |
| `ml-conversions-cron` | cada 30min | Sincroniza conversions |

---

## 📊 TABELAS E VIEWS DESCOBERTAS (copia isso e usa)

### Tabelas principais

| Tabela | Função | Campos-chave |
|---|---|---|
| `amicia_data` | Catch-all JSON store. Tudo é `user_id` + `payload` jsonb | `user_id`, `payload`, `atualizado_em` |
| `ordens_corte` | Ordens da Sala de Corte (estimativa) | `id`, `ref`, `cores` (json), `grade` (json), `status`, `origem`, `created_at` |
| `ml_conversations` | Conversas pós-venda | `pack_id`, `brand`, `seller_id`, `buyer_id`, `item_id`, `item_title`, `last_message_*`, `status` |
| `ml_messages` | Mensagens individuais pós-venda | `pack_id`, `brand`, `message_id`, `text`, `from_user_id`, `date_created` |
| `ml_pending_questions` | Perguntas pré-venda aguardando resposta | `question_id`, `brand`, `item_id`, `question_text`, `received_at`, `date_created`, `status` |
| `ml_qa_history` | Histórico de respostas pré-venda | `question_id`, `brand`, `answered_at`, `answered_by` |
| `ml_qa_history_posvenda` | Histórico pós-venda | idem |
| `ml_question_locks` | Locks pra evitar dupla resposta | `question_id`, `locked_until` |
| `ml_response_queue` | Fila de respostas agendadas (delay 2min) | `question_id`, `response_text`, `send_at`, `status` |
| `ml_stock_offers` | Ofertas de estoque por cor | `brand`, `item_id`, `question_id`, `cores`, `tamanho`, `status`, `detalhes` (json), `created_at` |
| `ml_stock_alerts` | Clientes que confirmaram interesse (pra Ailson repor) | `brand`, `item_title`, `question_text`, `status`, `promised_at`, `detail` |
| `ml_tokens` | Tokens OAuth das 3 contas ML | `brand`, `seller_id`, `access_token`, `refresh_token`, `expires_at` |
| `ml_sku_ref_map` | Mapa SKU (02790-MAR-M) → REF (02790) | `sku`, `ref` |
| `ml_scf_ref_map` | Mapa seller_custom_field (z2304...) → REF | `scf`, `ref` |
| `ml_estoque_ref_atual` | Estoque atual por REF | `ref`, `qtd_atual`, `timestamp` |
| `ml_estoque_snapshot` | Snapshots históricos | idem com timestamp |
| `ml_estoque_total_mensal` | Agregado mensal | `ref`, `mes`, `qtd` |
| `ml_conversions` | Pedidos ML convertidos | `order_id`, `brand`, `status`, ... |
| `bling_vendas_detalhe` | Vendas Bling detalhadas | `sku`, `ref`, `cor`, `tam`, `qtd`, `data` |
| `ml_vendas_lucro_snapshot` | Snapshot de lucro das vendas | ... |

### Keys do `amicia_data` (JSON store)

| user_id | Payload | Escrita |
|---|---|---|
| `amicia-admin` | Dados financeiro (receitas, boletos, auxData) | **ADMIN ONLY** |
| `ailson_cortes` | `payload.cortes[]` — módulo Oficinas Cortes (REAL) | Multi-user, merge |
| `usuarios` | Cadastro de usuários | Admin only |
| `agenda` | Eventos da agenda | Realtime + flush |
| `salas-corte` | Config das 3 salas | |
| `ficha-tecnica` | Fichas técnicas | |
| `calc-meluni` | Calculadora B2C | |
| `bling-creds` | Credenciais Bling | |
| `ml-perguntas-config` | Config SAC (cores custom, absence, etc) | |
| `ml-last-sync` | Timestamp última sync cron 8h | |
| `backup-diario` | Backup automático | |
| `bling-catalogo-skus` | Cache do catálogo Bling | Via cron |

### Views SQL do OS Amícia (em `sql/os-amicia/`)

| SQL file | O que criou |
|---|---|
| `01_tables.sql` | Tabelas base OS |
| `05_views_corte.sql` | Views de corte |
| `06_fn_cortes_recomendados.sql` | Função recomendação corte |
| `14_fase8_cortes_oficinas.sql` | **Views que cruzam ailson_cortes com vendas — LER ESTE FILE!** |
| `16_fase2_estender_fn_cortes.sql` | Extensão da fn_cortes |
| `30_fn_v18_analise.sql` | **RODADO nesta sessão** — fix modal "Em produção: 0" |

---

## 🔌 ENDPOINTS DE DIAGNÓSTICO (criados nesta sessão)

**Todos são zero-auth, GET, retornam JSON. Use em vez de mexer no SQL Editor.**

| Endpoint | O que faz |
|---|---|
| `/api/ml-posvenda-diag` | Status geral do pós-venda: conversas, mensagens, tokens, probe real no ML |
| `/api/ml-posvenda-discover?dry_run=1` | Simula descoberta de conversas pós-venda |
| `/api/ml-posvenda-discover` | Executa descoberta real (popula ml_conversations) |
| `/api/ml-webhook-activity` | Saúde do webhook (perguntas com timestamps → webhook OK/quebrado) |
| `/api/ml-stock-flow-diag` | Audita fluxo de cor: offers, alerts, perguntas que TERIAM disparado |
| `/api/ml-perguntas-com-cor` | Lista últimas 30 perguntas mencionando cor/tamanho |
| `/api/ml-stock-forecast?item_id=X&cor=Y&tamanho=Z` | Testa forecast individual |
| `/api/ml-stock-forecast-batch` | Roda forecast em TODAS as candidatas da fila de perguntas |
| `/api/ml-cortes-inspect?refs=02832,02708` | Mostra matriz real dos cortes ativos dessas REFs |

**Ailson prefere MUITO isso a rodar SQL manual.** Quando precisar consultar algo, crie um endpoint novo em vez de mandar SQL.

---

## ✅ O QUE FOI RESOLVIDO NESTA SESSÃO (24/abr)

### 1. Financeiro — perda de dados em Lançamentos (CRÍTICO)

**3 brechas encontradas e corrigidas** em `src/App.tsx`:

- **Brecha 1 (commit `04a8a1e`):** `salvarNoSupabase` fazia merge raso por MÊS. Se iPhone tinha cache stale de 1h atrás e MacBook adicionava lançamentos novos, próximo save do iPhone destruía os novos.
  - Fix: merge PROFUNDO dia-a-dia em `receitasPorMes`, por categoria em `auxDataPorMes`
  - Fix: guard anti-stale — se `remote._updated > dbCarregadoTs + 2s`, aborta save e recarrega state
  
- **Brecha 2 (commit `b5a1256`):** `flushSave` (pagehide no iPhone PWA) fazia UPSERT DIRETO sem merge. A cada troca de app = potencial overwrite.
  - Fix: guard `lastUserEditTs` — se não houve edit real desde último load, flushSave não dispara.

- **Brecha 3 (commit `b5a1256`):** `retrySePendente` (30s interval) também upsert direto. Agora chama `salvarNoSupabase` (que tem merge + guards).

- **Brecha 4 (NÃO CRÍTICA, fica pra próximo sprint):** load "Supabase vence" linha 7822 tem merge raso. Só atua em reload, não no uso normal.

**Ailson confirmou:** "financeiro save resolvido".

### 2. Pós-venda (SAC) — módulo nunca recebeu mensagens

**Causa raiz:** o pós-venda dependia 100% do webhook ML (topic=messages). Perguntas têm webhook + cron 8h redundante, mas messages tinha só o webhook. Webhook nunca funcionou pras 3 contas (topic talvez não marcado no ML Devs).

**Solução:** adicionado DISCOVER no cron de 5min (`ml-messages-sync`):
1. GET `/messages/unread?role=seller&tag=post_sale` nas 3 contas
2. Parse pack_id via regex `/\/packs\/(\d+)\//` do campo `resource`
3. INSERT em `ml_conversations` as que ainda não existem (com dados ricos: pack → order → item)
4. Depois sync normal de mensagens das conversas existentes

Commit: `eb4cc7d`. Discover real rodado — descobriu 2 conversas pendentes (Exitus 2 msgs + Lumia 1 msg).

### 3. IA SAC — regras refinadas

**3 novas regras no prompt (api/ml-webhook.js):**

- **Commit `1a703b5`:** NUNCA mencionar devolução/troca em pré-venda (medidas, tamanho, cor, tecido, prazo, frete). Exemplo PROIBIDO: "Pode comprar tranquila, se não servir você abre a devolução". Devolução SÓ se cliente perguntar explicitamente.

- **Commit `53fcd69` + `70171b4`:** Tabela de comprimento de calça:
  - Regular: P 112cm · M 113cm · G 113,5cm · GG 114cm
  - Plus: G1 114cm · G2 114,5cm · G3 115cm
  - Pergunta específica ("qual comprimento da M?") → responde SÓ o tamanho perguntado
  - Pergunta genérica → lista tabela do range relevante
  - Sempre finaliza: "Lembrando que o comprimento pode ter uma leve variação."

### 4. FORECAST DE COR VIA OFICINAS (novo recurso grande)

**Problema:** cliente pede cor FORA das 7 carro-chefe (ex: "azul claro G3"). Antes: IA Claude respondia genérico. Agora: sistema consulta produção real.

**Implementado em 2 fases:**
- **FASE 1 (commits `58261b0` → `b602b08`):** endpoints standalone `/api/ml-stock-forecast*` pra testar isolado.
- **FASE 2 (commit `50261ae`):** integrado ao `ml-webhook.js` função `tryStockForecast()`.

**Pipeline no webhook:**
```
cor não-stock + tamanho (ou só cor)
  ↓
1. Extrai SCF do anúncio ML via API
2. Resolve REF via ml_scf_ref_map → fallback regex
3. Busca ailson_cortes ativos (entregue=false, últimos 30 dias, REF match)
4. Itera cortes, verifica matriz de cores (case-insensitive + partial match)
5. Calcula dias_restantes = 22 - dias_decorridos
6. Resposta:
   - rest ≤ 7 → "próximos dias (até 7)"
   - rest 8-21 → "próximas semanas"
   - rest ≤ 0 ou não achou → return null (deixa IA responder)
7. Grava ml_stock_offers status='forecast_informado' com detalhes
```

---

## ⚠ PENDÊNCIAS (em ordem de prioridade)

### Alta prioridade
1. **Validar forecast em produção** quando Ailson reativar IA SAC. Acompanhar `ml_stock_offers` com `status='forecast_informado'`.
2. **Ailson vai marcar topic `messages`** no ML Devs (cereja — não bloqueante, cron discover cobre).

### Média prioridade
3. **Sprint 7 — Home Geral** do OS Amícia IA Operacional (nunca implementado, só spec).
4. **Sprint 8 — Pergunta livre + polish** do OS Amícia.
5. **2 SCFs órfãos do mapa:** `z2304224849` (Vestido assimétrico, MLB5251023450) e `z23042966436` (Macacão pantalona, MLB5249231836). O cron `bling-produtos-sync` devia popular, mas esses não foram. Investigar se é variant sem cadastro no Bling.

### Baixa prioridade
6. **Brecha 4 do load "Supabase vence" (linha 7822 App.tsx):** merge raso por mês. Não crítico, só atua em reload inicial. Corrigir em sprint futuro.
7. **Expandir patterns do `isColorRequest`** (api/_ml-helpers.js): pelo diag da sessão, perdeu casos tipo "Tem disponibilidade da cor X" e "Há previsão de X". Adicionar mais variantes na regex.

---

## 🎨 PADRÕES DO UI (não esquecer)

- **Paleta OS Amícia:** bege `#EAE0D5`, azul escuro `#373F51`, azul marinho `#1C2533`
- **Paleta App geral:** off-white/bege/cinza/azul (#2c3e50, #4a7fa5, #f7f4f0, #e8e2da), vermelho pra alertas
- **Fonte:** Georgia serif no SAC (Calibri +4px no frontend)
- **Ícones:** 📊Dashboard 📋Lançamentos 🧾Boletos 📅Agenda 🗂️Histórico 📄Relatório
- **Mobile-first** pro módulo lançamento de cortes

---

## 🔑 PREFERÊNCIAS DO AILSON (IMPORTANTE)

1. **Comunicação:** português brasileiro direto, tom familiar
2. **Mobile-first formatting:** respostas cabem no celular, sem blocos gigantes
3. **ODEIA rodar SQL manual** — sempre preferir endpoints que retornam JSON
4. **Componente `ask_user_input_v0` vem embaralhado no app dele** — usar texto simples pra opções
5. **Commits claros** em português com explicação do bug e fix
6. **Quando decisão clara, executar direto** — sem pedir confirmação excessiva
7. **Hands-on técnico** — entende o código, quer detalhes

---

## 🚨 ARMADILHAS QUE O CLAUDE ATUAL CAIU (não repetir)

1. **Confundiu `ordens_corte` (sala) com `ailson_cortes` (oficinas).** São coisas DIFERENTES. Pra forecast, SEMPRE `ailson_cortes.payload.cortes[]`.

2. **Tentou extrair REF só por regex.** Os SCF modernos (`z2304...`) NÃO batem com regex — precisa do `ml_scf_ref_map`.

3. **Assumiu que pergunta de pós-venda tinha pull + webhook.** Não tinha — só webhook. Por isso nunca funcionou.

4. **Usou dynamic import pra messages webhook.** Funciona mas torna debug difícil. Se for mexer, considerar inline.

5. **Mergeava payload financeiro raso por mês.** O merge TEM QUE SER DIA-A-DIA, senão destrói edits de outro device.

---

## 📋 COMMITS DESTA SESSÃO (ordem cronológica)

```
7078187 feat(os-amicia): Sprint 6.8 commit B - botoes novos (pré-sessão)
d82ec63 fix(critical): Realtime sobrescrevia edits locais não-salvos do Lançamentos
04a8a1e fix(critical): merge profundo dia-a-dia no salvarNoSupabase + guard anti-stale
b5a1256 fix(critical): adiciona guards anti-stale em flushSave e retrySePendente
31c0306 feat: endpoint /api/ml-posvenda-diag — diagnostico do modulo pos-venda
ff711f9 feat: endpoint /api/ml-posvenda-discover - descoberta proativa de conversas
2e5203f fix: extrai pack_id do campo 'resource' do /messages/unread
eeea85c diag: endpoint /api/ml-webhook-activity para confirmar se webhook funciona
eb4cc7d feat: ml-messages-sync agora descobre conversas novas via /messages/unread
1a703b5 feat(sac): IA so menciona devolucao se cliente perguntar explicitamente
53fcd69 feat(sac): tabela de comprimento de calca (regular + plus size)
70171b4 feat(sac): comprimento de calca - responde so o tamanho perguntado
13bd531 diag: endpoint /api/ml-stock-flow-diag para auditar fluxo de cor
58261b0 feat: endpoint /api/ml-stock-forecast - previsao baseada em ordens_corte
2a6fd6a fix: ml-stock-forecast usa ailson_cortes em vez de ordens_corte
e85a512 diag: endpoint /api/ml-perguntas-com-cor — lista perguntas reais
e16b582 diag: endpoint /api/ml-stock-forecast-batch — testa todos candidatos
b602b08 fix: forecast usa ml_scf_ref_map pra extrair REF (caminho principal)
f519001 diag: endpoint /api/ml-cortes-inspect — inspeciona matriz de cortes ativos
50261ae feat(sac): integra forecast de cor nao-cadastrada no fluxo do webhook
```

**Último commit de produção:** `50261ae`

---

## 🎯 COMO COMEÇAR A PRÓXIMA CONVERSA

1. **Leia este doc inteiro com calma.** Se não ler, vai repetir erros.
2. Clone/pull o repo (comando no topo).
3. Confira `git log` — último deve ser `50261ae` ou posterior.
4. Se Ailson pediu algo específico, responde direto. Se é vago, pergunta de forma objetiva em TEXTO (não use os botões do ask_user_input_v0).
5. Endpoints `/api/ml-*-diag` são seus melhores amigos pra diagnóstico. Crie novos quando precisar em vez de SQL manual.
6. Mobile-first nas respostas. Curtas, diretas, com estrutura clara.

---

**Boa sorte. Ailson é um cliente técnico ótimo mas cansado de lidar com bugs — evita fazer ele testar várias vezes a mesma coisa.**
