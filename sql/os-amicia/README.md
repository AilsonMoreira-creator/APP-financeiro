# OS Amícia · Fase 1 · Infra SQL

**Ordem obrigatória** de execução no Supabase SQL Editor:

```
01_tables.sql              →  cria 7 tabelas + índices + triggers
02_seed_ia_config.sql      →  popula thresholds iniciais
03_seed_ia_sazonalidade.sql →  popula 5 datas sazonais
04_policies.sql            →  ativa RLS + deny anon
```

## Como rodar

1. Supabase → **SQL Editor** → New query
2. Abrir cada arquivo **nesta ordem**
3. Colar conteúdo inteiro → **Run**
4. Conferir no painel de Tables (esquerda) que as 7 tabelas apareceram:
   - `ia_insights`
   - `ia_feedback`
   - `ia_config`
   - `ia_usage`
   - `ia_sazonalidade`
   - `ml_vendas_lucro_snapshot`
   - `calc_historico_snapshot`

## Verificar se deu certo

Cole e rode esta query depois de todos os 4 arquivos:

```sql
SELECT
  (SELECT count(*) FROM ia_config) AS configs_seedadas,
  (SELECT count(*) FROM ia_sazonalidade WHERE ativo) AS datas_sazonais,
  (SELECT count(*) FROM ia_insights) AS insights_ja_criados,
  (SELECT count(*) FROM ia_feedback) AS feedbacks_ja_registrados;
```

Resultado esperado logo após o seed:
```
configs_seedadas     | 44
datas_sazonais       | 5
insights_ja_criados  | 0
feedbacks_ja_registrados | 0
```

## O que NÃO muda

Nenhum dado existente é tocado. `ordens_corte` (tabela da Fase A) já tem
os campos que a Fase B precisa (`origem`, `insight_id`, `aprovada_por`,
`aprovacao_tipo`, `validade_ate`) — schema atual foi preparado pra isso.

## Rollback

Cada arquivo tem bloco DROP comentado no final. Descomentar e rodar
desfaz tudo (exceto campos de `ordens_corte` que estão integrados à Fase A).

---

**Próximo passo:** após rodar os 4 SQLs, configurar as env vars do Vercel
(`ANTHROPIC_API_KEY` + `SUPABASE_SERVICE_ROLE_KEY` + `VITE_OS_AMICIA_ENABLED=true`)
e fazer deploy de preview da branch `os-amicia-fase1`.
