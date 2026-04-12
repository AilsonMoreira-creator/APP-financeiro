# PROJETO AMÍCIA FINANCEIRO — CONTEXTO COMPLETO
## Atualizado: 13/04/2026

---

## DADOS DO PROJETO
- **App:** React/Vite + Supabase + Vercel PWA
- **Repo:** github.com/AilsonMoreira-creator/APP-financeiro (branch main)
- **Deploy:** app-financeiro-brown.vercel.app
- **Git email:** exclusivo@amicialoja.com.br
- **Owner:** Ailson, Grupo Amícia (moda feminina, SP) — 3 marcas: Exitus, Lumia, Muniam
- **Infra:** Vercel Pro + Supabase Pro

---

## 🏠 TELA HOME (NOVA)
- Tela inicial com cards dos módulos disponíveis pro usuário
- Saudação dinâmica (Bom dia/Boa tarde/Boa noite) + nome + data por extenso
- KPIs reais: faturamento Bling do dia, cortes oficinas, última ficha, último boleto
- SVGs originais do app em cada card
- Hover: eleva card, barra colorida no topo, seta →, fundo KPI
- Click em "Amícia" no nav volta pra home
- Só mostra módulos que o usuário tem acesso

**Módulo padrão por usuário:**
- Dropdown no cadastro de usuários: 🏠 Tela inicial ou 📌 Módulo específico
- Campo `moduloPadrao` no objeto do usuário
- Admin padrão: "home"

---

## 📊 MÓDULO BLING — ARQUITETURA CRON+CACHE+RPC

### Cron (api/bling-cron.js)
- Roda a cada 10min via Vercel Cron
- Busca pedidos do Bling v3 (45 dias: mês atual + anterior)
- 350ms delay entre requests (rate limit 3 req/s)
- Salva em `bling_vendas_detalhe` (Supabase) via upsert
- Backfill progressivo: pedidos já cacheados são skipados
- Timeout safety 280s → continua no próximo ciclo

### Canal Detection (FIX RECENTE)
- A listagem do Bling v3 NÃO retorna nome da loja
- Fix: busca do endpoint de detalhe (`ped.loja`) + fallback `lojaMap` + `contato.nome`
- parseCanal() detecta: ML, Shopee, Shein, TikTok, Magalu, Meluni, Amazon
- Debug log no primeiro pedido de cada conta/data
- Botão "🗑 Reprocessar Tudo" no health panel limpa cache e reimporta

### ⚡ RPCs no Banco (OTIMIZAÇÃO NOVA)
**ANTES:** puxava 15000+ linhas do Supabase → agregava no servidor (~2s)
**AGORA:** 3 RPCs Postgres rodam em paralelo → retornam ~300 linhas (~100ms)

SQL em `sql/bling-views.sql`:
- `fn_vendas_resumo(p_data_inicio, p_data_fim)` — pedidos/bruto/frete por dia/conta/canal
- `fn_vendas_produtos(p_data_inicio, p_data_fim)` — itens por ref/cor/tamanho por dia
- `fn_vendas_total(p_data_inicio, p_data_fim)` — contagem e bruto total

⚠️ **PENDENTE:** Ailson precisa rodar `sql/bling-views.sql` no SQL Editor do Supabase

### Endpoint (api/bling-vendas-cache.js)
- POST: recebe data_inicio/data_fim
- Chama 3 RPCs em paralelo
- Retorna objeto agregado no formato que o frontend espera
- Frontend em BlingContent usa agregarPeriodo() pra filtrar/visualizar

### Max Rows Supabase
- Aumentado pra 30.000 em Settings → API → Max Rows
- Necessário pra queries diretas (embora RPCs não sejam afetados pelo limite)

### Painel de Saúde Bling
- `api/bling-health.js` — GET (status) + POST (sync_now, refresh_token, reprocess_all, reprocess_conta)
- Frontend em Config do Bling: último cron, duração, pedidos 7d, status token/erros por conta

### Visual Bling
- Cores bege: Exitus=#d4c8a8, Lumia=#b8a88a, Muniam=#8a7560 com texto #4a3a2a

---

## 🎧 MÓDULO SAC — PERGUNTAS ML (PRÉ-VENDA)

### Visual (ATUALIZADO)
- "💬 Perguntas" sem badge (era "Respostas")
- Badge vermelho SÓ em Pendentes e Estoque
- Ausência: tab só aparece se tiver mensagens
- ⚡Rápidas e 🔄Sync movidos pro header
- Botão ✕ pra arquivar perguntas
- Container 900px (era 700)
- 🤖 Robô SVG no tab IA
- Cores bege nas BrandTag (iguais ao Bling)
- Filtro de marcas escondido quando tab=posvenda

### Fluxo de Estoque Inteligente
- handleStockFlow() no ml-webhook.js (PRIORIDADE 0, antes da IA)
- Roda SEMPRE (não só fora do horário)
- Cores padrão: Preto, Bege, Figo, Marrom, etc (com aliases)
- Config editável: SAC → Config → 🎨 Cores Disponíveis pra Estoque
- Fluxo: aguardando_cor → aguardando_confirmacao → confirmado → alerta
- Alertas auto-arquivam após 48h via cron

---

## 📦 MÓDULO SAC — PÓS-VENDA ML

### Visual (ATUALIZADO)
- Filtros status+marca em 1 linha só (sem duplicar)
- "Treinar IA Pós-Venda" movido pra Config → nova aba "📚 Pós-Venda"
- Removido texto "0 abertas · 0 não lidas"
- Botão 🔄 no final da linha de filtros

---

## 📸 FOTOS DE PRODUTOS (NOVO)

### Arquitetura
- **Storage:** Supabase Storage (bucket "produtos", público)
- **Upload:** via `api/produto-foto.js` (base64 → Supabase Storage)
- **Resize:** no browser pra 600×800 (3:4), JPEG 82%, max ~150KB
- **Formatos:** JPEG, PNG, WebP (Canva)
- **No produto:** salva só a URL (`foto: "https://...supabase.co/..."`)

### Onde aparece
- ✅ Calculadora → CalcFormProd: upload à esquerda (118×157), trocar/remover
- ✅ Calculadora → CalcLista: coluna thumbnail (38×50)
- ✅ Bling → Top 20: thumbnail (38×50) cruzando REF com produtos cadastrados
- 🔜 Oficinas: futuro (revertido por enquanto)

### API (api/produto-foto.js)
- POST: ref + image_base64 + content_type → upload → retorna URL pública
- DELETE: ref → remove foto do bucket
- Upsert: remove foto antiga automaticamente ao trocar

⚠️ **PENDENTE:** Criar bucket "produtos" no Supabase Storage (público)

---

## 🔄 CONVERSÕES (PERGUNTAS→VENDAS)

- `api/ml-conversions-cron.js` — Cron 30min
- Busca pedidos pagos 48h via ML API `/orders/search`
- Cruza buyer_id com perguntas dos últimos 3 dias
- Dashboard integrado no SAC: KPIs + lista conversões
- ⚠️ Reautorização das 3 contas ML pendente (escopo Orders)

---

## PAINÉIS DE SAÚDE

- **Bling:** `api/bling-health.js` — Config → 🩺 Saúde da Integração
- **SAC:** `api/ml-health.js` — Config → 🩺 Saúde

---

## TABELAS SUPABASE

| Tabela | Descrição |
|--------|-----------|
| amicia_data | Dados gerais (creds, config, cron status) |
| ml_tokens | Tokens ML por marca |
| ml_qa_history | Histórico perguntas/respostas pré-venda |
| ml_qa_history_posvenda | Histórico pós-venda |
| ml_pending_questions | Perguntas pendentes |
| ml_question_locks | Locks de atendimento |
| ml_stock_alerts | Alertas de estoque |
| ml_stock_offers | Ofertas de estoque (fluxo cor) |
| ml_conversations | Conversas pós-venda |
| ml_messages | Mensagens pós-venda |
| ml_conversions | Perguntas → vendas |
| bling_tokens | Tokens Bling por conta |
| bling_resultados | Resultados consolidados por dia |
| bling_vendas_detalhe | Cache de pedidos detalhados (principal) |

---

## CRONS (vercel.json)

| Cron | Frequência | Arquivo |
|------|-----------|---------|
| bling-cron | */10 min | api/bling-cron.js |
| ml-messages-sync | */5 min | api/ml-messages-sync.js |
| ml-conversions-cron | */30 min | api/ml-conversions-cron.js |
| ml-sync | 1x/dia 8h | api/ml-sync.js |

---

## ARQUIVOS PRINCIPAIS

```
src/App.tsx          — App principal (módulos, home, bling, oficinas, calc, usuarios)
src/MLPerguntas.jsx  — SAC pré-venda (perguntas ML)
src/MLPosVenda.jsx   — SAC pós-venda (mensagens ML)
api/bling-cron.js    — Cron importação Bling
api/bling-vendas-cache.js — Endpoint leitura via RPCs
api/bling-health.js  — Health panel Bling
api/produto-foto.js  — Upload fotos produtos
api/ml-webhook.js    — Webhook ML (estoque inteligente + IA)
api/ml-answer.js     — Resposta automática ML
api/ml-questions.js  — Listagem perguntas ML
api/ml-messages-sync.js — Sync mensagens pós-venda
api/ml-conversions-cron.js — Cron conversões + expire ofertas + archive alertas
api/ml-health.js     — Health panel SAC
sql/bling-views.sql  — 3 RPCs Postgres pra agregação
```

---

## PENDENTES PRIORITÁRIOS

1. **🔴 SQL RPCs Bling** — Rodar `sql/bling-views.sql` no Supabase SQL Editor
2. **🔴 Bucket Supabase Storage** — Criar bucket "produtos" (público) pra fotos
3. **🔴 Reautorizar 3 contas ML** — Escopos: Orders, Post Purchase, Messages
4. **🟡 Shopee** — Aguardando partner_id/partner_key do Ailson
5. **🟡 Canal Bling** — Reprocessamento em andamento (cron reimportando com fix)
6. **🟢 Connection pooling** — Trocar URL Supabase pra porta 6543
7. **🟢 RLS nas tabelas** — Boa prática, prioridade baixa

---

## CUSTOS API
- Claude Haiku 4.5: $1 input / $5 output por milhão de tokens
- Dashboard: console.anthropic.com → Usage/Cost
