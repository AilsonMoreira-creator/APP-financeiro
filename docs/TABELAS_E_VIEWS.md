# 📋 Tabelas e Views — Supabase do App Financeiro Amícia

> Referência completa de todas as tabelas, chaves do `amicia_data` e views do banco.
> Última atualização: 26/04/2026 (Sprint 8 fechada)

---

## 🗂️ Índice rápido

- [Como ler este doc](#como-ler-este-doc)
- [1. Núcleo do app — `amicia_data`](#1-núcleo-do-app--amicia_data-key-value)
- [2. Confecção (Cortes / Oficinas / Salas)](#2-confecção)
- [3. Mercado Livre — Estoque](#3-mercado-livre--estoque)
- [4. Mercado Livre — SAC (Perguntas + Pós-Venda)](#4-mercado-livre--sac)
- [5. Bling (vendas e catálogo)](#5-bling)
- [6. IA Pergunta + Insights](#6-ia-pergunta--insights)
- [7. Views — leitura agregada](#7-views)
- [8. Storage (não é tabela, mas é referência)](#8-storage)
- [Convenções globais](#convenções-globais)

---

## Como ler este doc

O Supabase do app tem **3 camadas distintas** que parecem todas "tabelas" mas funcionam diferente:

1. **Tabela-curinga `amicia_data`** — chave-valor (`user_id` + `payload` JSON). Cada `user_id` é tipo uma "tabela lógica" diferente. A maioria do app está aqui.
2. **Tabelas reais SQL** (`ml_conversations`, `ordens_corte`, `bling_vendas_detalhe` etc.) — schemas tradicionais com colunas, índices e foreign keys.
3. **Views** (prefixo `vw_`) — só leitura, agregam dados das tabelas pra IA e dashboards.

Cada item abaixo tem: **nome · tipo · propósito · onde é usado · regra crítica** (quando relevante).

---

## 1. Núcleo do app — `amicia_data` (key-value)

A tabela `amicia_data` tem 2 colunas: `user_id` (chave) e `payload` (JSONB). Cada chave guarda uma "área" do app inteira como JSON. Tudo passa por aqui.

| user_id | Propósito | Quem escreve | Notas |
|---|---|---|---|
| `amicia-admin` | **Cadastro principal financeiro** — `produtos`, `oficinasCAD`, `tecidosCAD`, `boletosShared`, configs gerais. Núcleo do app. | **ADMIN-ONLY** save | Auto-save/flush/pagehide bloqueado pra non-admin. Sprint 8 separou cortes daqui. |
| `ailson_cortes` | **Cortes ativos** (multi-user merge) — array de cortes com matriz PMG/G1-G3, oficina, prazo, qtd, qtdEntregue, entregue, data_entrega. | Multi-user (merge) | Non-admin preserva `produtos`/`oficinasCAD` do remoto pra não sobrescrever. |
| `usuarios` | Lista de usuários do app (login + perfis + módulos liberados). | Admin-only | Login respeita módulos: corte→oficinas, financeiro→boletos. |
| `agenda` | Eventos da agenda (separado pra ter Realtime + flush próprios). | Multi-user (Realtime) | Canal Realtime: `sync-agenda`. |
| `salas-corte` | Cortes nas 3 salas internas (Antonio, Adalecio, Chico) + yield tracking. | Multi-user | Alerta yield <5% abaixo da média histórica. |
| `ficha-tecnica` | Cadastro de produto: REF, foto, fornecedor, valor, custo, margem, markup, fluxo cascata Silva Teles → Bom Retiro +R$10 → Varejo +R$40. | Admin | Escreve no bucket `produtos/{REF}.jpg`. |
| `calc-meluni` | Calculadora Meluni (preços B2C). | Admin | Snapshot diário em `calc_historico_snapshot` quando muda. |
| `bling-creds` | Tokens OAuth Bling (3 contas: Exitus, Lumia, Muniam). | Admin | NÃO confundir com `bling_tokens` (tabela real diferente). |
| `bling-catalogo-skus` | Catálogo de SKUs sincronizado do Bling (lê só Lumia, conforme regra). | Cron | Lumia = universo completo de refs. |
| `bling-cron-status` | Status de execução do cron de import Bling. | Cron | Última execução, sucesso/erro. |
| `bling-produtos-sync-status` | Status do sync de catálogo de produtos. | Cron | |
| `ml-perguntas-config` | Config do módulo SAC: prompt IA, thresholds, ausência, IA enabled, etc. | Admin via UI | Lido pelo SAC e crons de IA. |
| `ml-estoque-status` | Status do cron de estoque ML (última sync, quantas refs). | Cron | |
| `ml-estoque-historico-diario` | Snapshot diário do total de estoque pra histórico/gráfico. | Cron | |
| `ml-last-sync` | Marca temporal da última sync do ML (compatibilidade). | Cron | |
| `ia-pergunta-config` | Config do módulo IA Pergunta: rate_limit_users (default 50/dia), modelo, prompt. | Admin | Padrão SAC: config como user_id pra evitar tabela extra. |
| `backup-diario` | Backup completo do `amicia-admin.payload` rotacionado diariamente. | Cron | Recovery em caso de corrupção. |
| `historico_vendas` | **Dados históricos importados manualmente via JSON** — vendas mês-a-mês jan/2025 a fev/2026 (14 meses), por canal, com qtd de produtos vendidos por REF. Usado pelo módulo Histórico Vendas (`HistoricoVendas.jsx`). | Importação manual (admin) | Estrutura: `{ _meta: {refsTotal, mesesTotal, periodo, canais}, refs: { "2601": { refDisplay, descricao, vendas: { "2025-01": {shein_lumia,...} } } } }`. **Snapshot estático** — não atualiza automaticamente. |
| `cron` | Status genérico de execução de crons internos. | Cron | |

**Regras importantes:**
- **Multi-user save (Sprint 7):** auto-save/flush/pagehide só rodam pra admin no `amicia-admin` e `usuarios`. Non-admin tem `pending_sync` limpo automaticamente — **Supabase sempre vence**.
- **PENDENTE:** separar `boletosShared` em payload próprio pra "financeiro" poder salvar sem ser admin.

---

## 2. Confecção

Fluxo do produto: **TECIDO** (cadastro) → **ENFESTO** (camadas pra render) → **CORTE** [engloba `ordens_corte` + **SALAS DE CORTE**: Antonio, Adalecio, Chico — peças cortadas por REF, matriz PMG/GG/G1-G3] → **OFICINA** (costureira externa monta a peça, prazo de entrega) → **ENTREGUE**.

> ⚠️ **Importante:** Salas de Corte são **parte da etapa Corte** (não vêm depois). Oficina é a etapa **final** antes da entrega. Confundir essa ordem leva a erros nas queries de status e nos dashboards.

### Tabelas reais

| Tabela | Propósito | Campos-chave | Observações |
|---|---|---|---|
| **`ordens_corte`** | Ordens de corte com status `na_sala` / `em_oficina` / `entregue`. Auditoria do fluxo confecção. | `id`, `ref`, `sala`, `oficina`, `qtd_total`, `matriz` (jsonb PMG-G3), `status`, `data_entrega`, `created_by` | Index composto `(ref, sala, status)` pra busca rápida "tem ordem na_sala pra essa ref+sala?" |
| **`ordens_corte_historico`** | Auditoria — toda mudança de status grava aqui. | `ordem_id`, `status_anterior`, `status_novo`, `quem`, `quando` | Permanente, nunca deleta. |

### `amicia_data` relacionados (já listados acima)

- `ailson_cortes` — cortes ativos rodando (mais usado)
- `salas-corte` — yield das 3 salas
- `ficha-tecnica` — cadastro do produto

### Views especializadas

(ver seção [7. Views](#7-views) — `vw_ia_*`, `vw_top_movers_*`, `vw_distribuicao_cores_por_ref`)

---

## 3. Mercado Livre — Estoque

Arquitetura: o **Ideris é o hub** que espelha estoque nos 11 canais. O app lê **só ML Lumia** via `/api/ml-estoque` — como Ideris espelha, um canal = todos.

### Tabelas

| Tabela | Propósito | Update | Notas |
|---|---|---|---|
| **`ml_estoque_snapshot`** | Snapshot bruto: 1 linha por variação ativa na Lumia (SKU = ref+cor+tam). | Sobrescreve a cada 6h (DELETE+INSERT) | Chave única: SKU (universal Bling/ML/Ideris). |
| **`ml_estoque_ref_atual`** | **Resolvido por REF** — agregado por ref pros cards da tela. Anti-duplicidade pra refs com 2 MLBs. | Cron após snapshot + join com mapa SKU→ref | 1 linha por ref ativa da Calculadora. |
| **`ml_estoque_total_mensal`** | Total geral do mês — usado pro gráfico de tendência 12m. | Upsert no 1º do mês | |
| **`ml_sku_ref_map`** | Mapa **SKU → REF** construído de `bling_vendas_detalhe`. | Persistente, append-only | Mesmo se a ref sair dos pedidos recentes, associação continua. |
| **`ml_scf_ref_map`** | Mapa **SCF → REF** (`scf` = seller_custom_field, código Ideris/Bling do produto-pai). | Persistente | Ex: `z23041912028` → ref `2277`. |

### Tabelas de alertas e ofertas

| Tabela | Propósito |
|---|---|
| **`ml_stock_alerts`** | Alertas de estoque baixo gerados pelo SAC (cliente perguntou e não tinha). |
| **`ml_stock_offers`** | Ofertas alternativas oferecidas pela IA quando produto X faltou (sugere Y similar). |

---

## 4. Mercado Livre — SAC

**SAC = Pré-venda (Perguntas) + Pós-Venda (Mensagens)**. Webhook ML escreve em tempo real, cron faz discovery do que escapou.

### Pré-venda (Perguntas)

| Tabela | Propósito | Notas |
|---|---|---|
| **`ml_pending_questions`** | Perguntas pendentes a responder. | Status: `pendente`, `respondida`, `arquivada`. |
| **`ml_qa_history`** | Histórico de perguntas/respostas pré-venda — alimenta a IA com exemplos reais. | Treinamento via UI Config → "Treinar IA". |
| **`ml_question_locks`** | Lock multi-user: quando vendedor X abre uma pergunta, trava por N min pros outros não responderem. | TTL automático. |
| **`ml_response_queue`** | Fila de respostas geradas pela IA esperando aprovação humana ou envio automático. | Delay 2min, baixa confiança vai pra pendente. |
| **`ml_conversions`** | Conversões — quando uma pergunta virou venda. Métrica chave do SAC. | Cron 7d pega vendas que vieram de perguntas. |

### Pós-Venda

| Tabela | Propósito | Notas |
|---|---|---|
| **`ml_conversations`** | 1 conversa por pack/pedido. Tag: `urgente`, `atencao`, `normal`, `resolvido`. | **REGRA Sprint 8:** webhook/cron precisam ter `seller_id` E `buyer_id` populados — fallback `/orders/{id}` se `/packs/{id}` 404. |
| **`ml_messages`** | Mensagens individuais dentro de cada conversa. | `from_type`: `buyer` ou `seller`. Idempotência por `message_id`. |
| **`ml_qa_history_posvenda`** | Treinamento IA pós-venda — separado do pré-venda (contextos diferentes). | UI: Config → "Treinar IA Pós-Venda". |

### Tokens

| Tabela | Propósito |
|---|---|
| **`ml_tokens`** | Tokens OAuth Mercado Livre (3 marcas: Exitus, Lumia, Muniam). Refresh automático. |

---

## 5. Bling

| Tabela | Propósito | Notas |
|---|---|---|
| **`bling_vendas_detalhe`** | Cache de vendas detalhadas do Bling (substitui chamadas pesadas que batiam no rate limit). | Janela 45d. Fonte do `ml_sku_ref_map`. |
| **`bling_resultados`** | Resultados consolidados de import diário Bling (status "Atendido" — soma 3 marcas, desconta 10% devolução). | 1 linha por dia. |
| **`bling_tokens`** | Tokens OAuth Bling — mesma função que `bling-creds` no `amicia_data`. | Verificar duplicação: pode ter migrado pra `amicia_data` em algum sprint. |

⚠️ **Atenção:** `bling-creds` (key-value) e `bling_tokens` (tabela real) podem coexistir por legado. Confirmar qual é fonte de verdade antes de mexer.

### `amicia_data` relacionados

- `bling-creds`, `bling-catalogo-skus`, `bling-cron-status`, `bling-produtos-sync-status` (ver seção 1)

---

## 6. IA Pergunta + Insights

Módulo "IA Pergunta" é o botão global de fazer pergunta livre pra IA. Sprint 8.

### Tabelas

| Tabela | Propósito | Notas |
|---|---|---|
| **`ia_pergunta_historico`** | Log de TODAS as perguntas feitas. Admin vê tudo, funcionário vê só as próprias. | Categoria: `estoque`, `producao`, `produto`, `ficha`, `outros`. `r_bloqueado=true` se filtrou R$ pra non-admin. |
| **`ia_insights`** | Histórico de insights gerados (cron + perguntas livres). | Sprint 1 OS Amícia. |
| **`ia_feedback`** | Feedback do admin sobre cada insight: Sim/Parcial/Não/Editar. | Aprende com correções. |
| **`ia_config`** | Chave-valor pra thresholds ajustáveis sem deploy. | Substitui hardcode em código. |
| **`ia_usage`** | Rate limit + custo da Anthropic API (controle financeiro). | |
| **`ia_sazonalidade`** | 5 datas hardcoded editáveis (ex: Black Friday, Dia das Mães) usadas pelos cálculos de IA. | Editável pelo admin. |
| **`ia_sugestoes_arquivadas`** | Sugestões que foram arquivadas pelo admin (não excluídas, ficam pra histórico). | |

### Funções SQL

- **`fn_ia_pergunta_pool_hoje()`** — conta perguntas de não-admin do dia (timezone BRT) pra rate limit (default 50/dia, era 15).
- **`fn_ia_pergunta_stats_dia()`** — estatísticas agregadas pro painel admin.

### `amicia_data` relacionado

- `ia-pergunta-config` (ver seção 1)

---

## 7. Views

Todas as views começam com prefixo `vw_`. **Read-only**, não escreve.

### Vendas e canais

| View | Propósito |
|---|---|
| **`vw_vendas_mensais_24m`** | Vendas mensais 24 meses (gráficos de tendência). |
| **`vw_canais_comparativo`** | Comparativo entre canais (ML / Shein / Shopee / lojas físicas). |
| **`vw_lucro_marketplace_mes`** | Lucro do marketplace por mês. |
| **`vw_margem_por_produto_canal`** | Margem por produto × canal (onde vende melhor). |

### Top movers (produtos que aceleraram)

| View | Propósito |
|---|---|
| **`vw_top_movers_unificado`** | Top movers consolidado todas as contas. |
| **`vw_top_movers_unificado_15d`** | Top movers janela 15d (curto prazo). |
| **`vw_top_movers_por_conta`** | Top movers separado por conta Bling. |
| **`vw_top_movers_cruzamento`** | Cruzamento: produto × conta onde acelerou. |

### Estoque (saúde, ruptura, excesso)

| View | Propósito |
|---|---|
| **`vw_estoque_saude_geral`** | Saúde geral do estoque (semáforo). |
| **`vw_estoque_ruptura_critica`** | Refs em ruptura crítica (vende muito + estoque zero/baixo). |
| **`vw_estoque_ruptura_disfarcada`** | Ruptura disfarçada — tem estoque mas não tem variação que vende. |
| **`vw_estoque_excesso`** | Estoque parado/excessivo. |
| **`vw_estoque_tendencia_12m`** | Tendência 12 meses. |
| **`vw_distribuicao_cores_por_ref`** | Distribuição cores por ref (qual cor mais vende). |
| **`vw_ranking_cores_catalogo`** | Ranking de cores do catálogo geral. |

### Bling — concentração e queda

| View | Propósito |
|---|---|
| **`vw_contas_bling_7v7`** | Compara 7 dias atuais vs 7 dias anteriores por conta Bling. |
| **`vw_contas_bling_concentracao_queda`** | Detecta concentração de queda em uma conta específica. |

### Variações classificadas + plano de ajuste

| View | Propósito |
|---|---|
| **`vw_variacoes_classificadas`** | Variações classificadas como `principal` / `complementar` / `nicho`. |
| **`vw_oportunidades_margem`** | Oportunidades de melhorar margem. |
| **`vw_plano_ajuste_gradual`** | Sugestões de ajuste gradual de preço/estoque. |

### IA Pergunta (Sprint 8 — exclusivas do módulo)

| View | Propósito |
|---|---|
| **`vw_ia_curva_abc_ranking`** | **Curva ABC por POSIÇÃO** no ranking (não Pareto): pos 1-10=A, 11-20=B, 21+=C. Janela 45d. **Não substitui** `vw_ranking_curvas_bling` (essa continua sendo OS Amícia com regra própria). |
| **`vw_ia_variacoes_em_ruptura`** | Pré-junta `vw_variacoes_classificadas` com `vw_distribuicao_cores_por_ref` filtrando `classificacao='principal'`. Otimiza queries da IA. |

---

## 8. Storage

Não é tabela, mas é referência crítica:

| Bucket | Conteúdo | Path | Notas |
|---|---|---|---|
| **`produtos`** | Foto principal do produto. | `{REF}.jpg` (sem zero esquerda) | Helper `resolverFotoUrl(ref)` tenta variantes: `orig`, sem zero, pad4, pad5, qualquer extensão (jpg/png/webp). Upload via Ficha Técnica + Calculadora; leitura via `FotoProd` em todos os módulos. |

Tem limite **30k linhas** por bucket no plano atual.

---

## Convenções globais

### REF — formato com/sem zero

⚠️ **Regra crítica:** banco usa REF **SEM zero à esquerda** (LTRIM, ex: `"2790"`), mas Bling/ML mostram **COM zero** (ex: `"02790"`).

```js
// Sempre normalizar antes de query:
const refSemZero = String(ref).replace(/^0+/, '') || '0';
```

### user_ids do amicia_data — naming

- Hífen separador: `bling-creds`, `ml-estoque-status`, `salas-corte`
- Mas alguns legados usam underscore: `ailson_cortes`
- Quando criar novo: **usar hífen** (padrão Sprint 7+)

### Realtime channels

4 canais de Realtime ativos:

- `sync-financeiro` (amicia-admin)
- `sync-oficinas` (ailson_cortes)
- `sync-usuarios` (usuarios)
- `sync-agenda` (agenda)

### Idempotência

Todos os SQLs em `sql/os-amicia/*.sql` são **idempotentes** (`IF NOT EXISTS` em tabelas, `CREATE OR REPLACE` em views/funções). Pode rodar 2× sem quebrar.

### Anti-duplicação

- `ml_estoque_ref_atual` tem anti-dup pra refs com 2 MLBs (algumas refs aparecem em 2 anúncios)
- `ml_messages` upsert com `onConflict: 'message_id'` (Sprint 8)

### Retenção de dados

| Tabela | Retenção |
|---|---|
| `bling_vendas_detalhe` | 45 dias (cache) |
| `ml_vendas_lucro_snapshot` | 24 meses (limpeza manual ou cron futuro) |
| `calc_historico_snapshot` | Permanente (não cresce muito) |
| `ordens_corte_historico` | Permanente (auditoria) |
| `ia_pergunta_historico` | Permanente |
| `backup-diario` | Rotação diária |

---

## Como manter este doc

Quando criar/migrar tabela:

1. Editar este doc na seção correta (domínio).
2. Atualizar: nome, propósito, regra crítica.
3. Se for view, criar arquivo SQL em `sql/os-amicia/NN_nome.sql`.
4. Commit junto com a migração.

Quando deprecar tabela: marcar com ~~strikethrough~~ e nota explicando substituição. Não deletar do doc por 2 sprints (referência histórica).
