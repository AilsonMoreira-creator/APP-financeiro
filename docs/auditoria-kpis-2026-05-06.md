# Auditoria — Função `lojas_recalcular_kpis_cliente`
**Data:** 06/05/2026 (sessão noite)
**Motivo:** restauração feita hoje cedo pra resolver canal Vesti perdeu lógica de média_dias_compras.

---

## 📌 Linha do tempo

1. **01/05/2026** — Sprint instala `sql/lojas-media-dias-e-conversoes.sql`. Função ganha:
   - Cálculo de `media_dias_compras` (média ponderada últimas 10 datas, recentes pesam mais, filtro gap ≥3d)
   - Flag `media_dias_confiavel` (TRUE se ≥8 datas distintas)
   - Status custom: cliente com média confiável usa `0.8x / 1.2x / 2x / 4x` (com floor 30 / ceiling 90)

2. **04/05/2026** — Sprint Vesti (commit `bb2f7db`) usa essa função correta. Tudo rodando bem.

3. **06/05/2026 manhã** — Bug Vesti descoberto (41 clientes ficaram `fisico_dominante`). Eu rodei `sql/fix-recalcular-kpis-canal-vesti.sql` que pega função "canônica" do `sql/lojas-modulo-schema.sql`. **Essa versão canônica NUNCA TEVE a lógica de média_dias** — é a base original do schema.

4. **Resultado:** função em produção AGORA não calcula `media_dias_compras` nem `media_dias_confiavel`. Status volta pra faixas hardcoded 45/90/180/365 pra todo cliente.

---

## 🔴 Estado atual (em produção)

### Função `lojas_recalcular_kpis_cliente` instalada
- ✅ TEM Camada 1 Vesti (canal_cadastro='vesti' → vesti_dominante)
- ✅ TEM canal_dominante calculado certo
- ✅ TEM perfil presença
- ❌ NÃO calcula `media_dias_compras`
- ❌ NÃO calcula `media_dias_confiavel`
- ❌ NÃO usa fórmula custom de status (volta pra 45/90/180/365 fixo)
- ❌ NÃO atualiza colunas `media_dias_compras` e `media_dias_confiavel` no UPSERT

### Coluna `lojas_clientes_kpis.media_dias_compras`
- ✅ Existe (criada em 01/05)
- ⚠️ Tem dados antigos (do último cálculo correto antes de hoje)
- ❌ Está congelada — clientes recalculados hoje têm valor desatualizado ou NULL

### Coluna `lojas_clientes_kpis.media_dias_confiavel`
- ✅ Existe
- ⚠️ Mesmo cenário: dados velhos, não atualiza mais

### Coluna `lojas_clientes_kpis.status_atual`
- ⚠️ Calculada com regra rígida 45/90/180/365 pra TODO cliente
- 🔴 Cliente que compra a cada 60d virou "atenção" aos 45d (cedo demais)
- 🔴 Cliente que compra a cada 20d só vira "atenção" aos 45d (tarde demais)

---

## 📊 Impacto silencioso em outros pontos

### IA de sugestões (`api/lojas-ia.js`)
- Lê `status_atual` da tabela. **Não lê** `media_dias_compras` direto (apenas menciona no prompt).
- 🔴 IA está agrupando clientes em status errados → mensagens em momento inadequado.

### Cron de geração de sugestões (07:00 BRT)
- Roda baseado em `status_atual`. Mesma situação acima.

### Card "Conversões" no Dashboard
- Conta mensagens enviadas pra cliente que comprou em até 15d.
- ⚠️ Mensagem foi disparada baseado em status errado → conversões podem estar inflando ou não acontecendo conforme deveriam.

### Card "Carteira vendedora"
- Mostra distribuição de status. Distribuição atual está distorcida pela regra fixa.

### Trigger `trg_canal_cadastro_change` (instalado hoje cedo)
- ✅ Funciona — chama a função instalada
- ⚠️ Mas a função que chama não calcula media_dias

### Outros lugares chamam recalcular
- `sql/lojas-backfill-canal-vesti.sql` linha 52 — script one-shot (não roda mais)
- `sql/lojas-import-vesti-batch.sql` linha 156 — script de importação one-shot
- Trigger Realtime em UPDATE canal_cadastro — ativo

---

## ✅ O que NÃO foi afetado

- Cadastro de clientes (`lojas_clientes`) intocado
- Vendas (`lojas_vendas`) intocadas
- Sacolas, devolutivas, conversões — sem mudança
- Frontend não quebrou (todos os campos que ele lê continuam existindo)
- Cron Drive importer — independente, não afeta
- Cron receitas — independente
- SAC IA, raio-X, curadoria — independentes
- Salas de Corte, Oficinas, Ficha Técnica — independentes

---

## 🛠️ Como restaurar (sem recalcular geral)

### Estratégia A — Reinstalar função "completa" (recomendado)
Criar SQL que combina:
- Base da versão antiga (`sql/lojas-media-dias-e-conversoes.sql` linhas 92-309)
- + Camada 1 Vesti da versão atual

Resultado: função volta a calcular `media_dias_compras` E mantém canal_dominante correto.

**Importante:** rodar essa função NÃO recalcula clientes existentes. Só passa a calcular certo a partir do próximo gatilho:
- Cliente faz nova compra → trigger? (depende se existe)
- Cliente muda canal_cadastro → `trg_canal_cadastro_change` chama
- Manual: `SELECT lojas_recalcular_kpis_cliente('uuid')` cliente por cliente

### Estratégia B — Recalcular tudo (você descartou)
`SELECT lojas_recalcular_kpis_todos()` recalcula todos clientes. Você não quer isso.

### Estratégia C — Recálculo gradual
Não rodar nada. Cliente vai recalculando conforme natural:
- Próxima venda dele
- Próxima vez que canal_cadastro muda
- ⚠️ Clientes inativos podem ficar meses com KPI velho

---

## 📋 Recomendação

1. **Hoje** — só auditoria (este documento). Sem mudanças.
2. **Amanhã/depois** — Estratégia A (reinstalar função correta sem recalcular)
3. **Conforme bate na tela** — recalcular cliente individual via UI (botão "recalcular este cliente" no card)
4. **Quando achar tempo** — implementar atenção especial COM a função correta

---

## ❓ Validar com Ailson

- [ ] Cron diário 07:00 BRT roda mesmo? (`api/lojas-cron-ia-diario.js` ou similar). Se sim, gerou mensagens hoje com status errado?
- [ ] Há quanto tempo `media_dias_compras` está congelada na tabela?
- [ ] Quer recalcular cliente-a-cliente sob demanda ou esperar gatilho natural?
