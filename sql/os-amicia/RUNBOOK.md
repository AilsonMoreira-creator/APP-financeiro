# RUNBOOK Operacional — OS Amícia

Procedimentos manuais recorrentes que **não são código** mas precisam ser feitos
quando a IA detecta problemas ou quando coisas mudam no Bling/ML/Ideris.

Este documento existe pra evitar que a gente esqueça regras operacionais e fique
re-investigando o mesmo problema várias vezes.

---

## 📋 Índice

- [1. Cadastrar nova ref no scfMap (anúncios sem dados ML)](#1-cadastrar-nova-ref-no-scfmap)
- [2. Disparar cron ML manualmente](#2-disparar-cron-ml-manualmente)
- [3. Conferir refs sem dados](#3-conferir-refs-sem-dados)

---

## 1. Cadastrar nova ref no scfMap

### Quando usar

Quando uma ref aparece em **TabProdução** com card vazio/quebrado, ou quando
`ml_estoque_ref_atual.sem_dados = true` mesmo a ref vendendo bem no Bling.

**Sintoma típico:** ref que vende bastante (340+ pedidos/mês) mas no app aparece
sem cores, sem cobertura, severidade incorreta.

### Causa

O cron ML lê os anúncios da Lumia e tenta resolver "qual ref pertence cada anúncio"
em 3 caminhos:

1. **scfMap manual** (tabela `ml_scf_ref_map`) — caminho principal
2. **Regex parênteses** (`(02XXX)` ou `(ref 02XXX)`) — fallback
3. **SELLER_SKU em variation.attributes** — fallback

Se nenhum dos 3 funciona pro anúncio, a ref fica órfã.

**Causa MAIS comum:** o anúncio no ML tem `seller_custom_field` com formato
`z2304223635j536` (código Bling-pai do Ideris) — não bate em nenhum regex e
não está no scfMap.

### Procedimento

**Passo 1 — Identificar o `seller_custom_field` (scf-pai) do anúncio no ML**

Disparar o cron com debug ativado (se ainda existir o `debug_2851` no código)
ou consultar a API ML diretamente. O scf vai aparecer como string alfanumérica
tipo `z2304223635j536`, `M-1234567890`, etc.

**Passo 2 — Inserir no `ml_scf_ref_map`**

Roda no Supabase SQL Editor:

```sql
INSERT INTO ml_scf_ref_map (scf, ref)
VALUES ('z2304223635j536', '2851')   -- substitua pelos valores reais
ON CONFLICT (scf) DO UPDATE SET ref = EXCLUDED.ref;
```

**IMPORTANTE:**
- `scf` deve ser **exatamente** o valor do ML (case-sensitive)
- `ref` é a ref interna sem zeros à esquerda (`2851` não `02851`)
- Usa `ON CONFLICT` pra ser idempotente (rodar 2x não dá erro)

**Passo 3 — Disparar cron manualmente** (ver seção 2)

**Passo 4 — Validar**

```sql
SELECT ref, qtd_total, sem_dados, updated_at
FROM ml_estoque_ref_atual
WHERE ref = '2851';   -- deve retornar sem_dados=false e qtd_total > 0
```

E recarregar a TabProdução no app pra ver o card preenchido.

### Histórico de inserções manuais

| Data       | scf                    | ref   | Motivo                                  |
|------------|------------------------|-------|-----------------------------------------|
| 2026-04-22 | `z2304223635j536`      | 2851  | Anúncio MLB4253767015 sem SELLER_SKU    |

---

## 2. Disparar cron ML manualmente

### Quando usar

- Após inserção manual no `ml_scf_ref_map` (seção 1)
- Após mudanças em anúncios no ML que precisam refletir antes do próximo ciclo
- Para debug

### Como fazer

Acessa essa URL no browser (ou `curl`):

**Preview (branch `os-amicia-fase1`):**
```
https://app-financeiro-git-os-am-542748-ailsonmoreira-creators-projects.vercel.app/api/ml-estoque-cron
```

**Produção (branch `main`):**
```
https://app-financeiro-brown.vercel.app/api/ml-estoque-cron
```

**Demora ~13 segundos.** Retorna JSON com resumo das fases.

### O que olhar no JSON

```json
{
  "ok": true,
  "refs_ativas": 41,         // total de refs cadastradas em calc-meluni
  "refs_resolvidas": 37,     // refs com dados ML OK
  "refs_sem_dados": 4,       // refs que nao casaram (precisam de fix manual)
  "scf_map_carregado": 58,   // entradas no ml_scf_ref_map
  "anuncios_com_ref_direta": 69,  // anuncios resolvidos pela regex
  "erros": 0
}
```

**Cron normal roda a cada 6 horas** (`vercel.json` schedule `0 */6 * * *`).

---

## 3. Conferir refs sem dados

### Quando usar

Periodicamente, pra ver quais refs precisam ser cadastradas manualmente no scfMap.

### Query

```sql
SELECT ref, descricao, qtd_total, updated_at
FROM ml_estoque_ref_atual
WHERE sem_dados = true
ORDER BY ref;
```

Para cada ref retornada:

1. Achar o anúncio no ML (busca por SKU no painel Lumia)
2. Anotar o `seller_custom_field` do anúncio-pai (não da variação)
3. Inserir no scfMap (seção 1)
4. Disparar cron (seção 2)

---

## Notas finais

- **Decisão arquitetural:** o caminho via scfMap manual foi escolhido
  intencionalmente em vez de "auto-resolver" tudo via Bling. Razão: dá
  controle preciso sobre o que entra na contagem de estoque, evitando
  matches errados que poderiam virar bugs silenciosos.
- **Limite escalável:** 57 entradas hoje (abril 2026), tendência de crescer
  com novos cadastros. Não há limite técnico — Supabase aguenta milhões.
- **Quem alimenta:** historicamente via endpoint `/api/ml-estoque-import-scf`,
  mas inserção SQL direta funciona igualmente.
