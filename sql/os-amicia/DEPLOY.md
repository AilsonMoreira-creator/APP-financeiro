# 🚀 OS Amícia · Deploy Sprint 1

**Branch:** `os-amicia-fase1`
**Data:** 21/04/2026

## Passo a passo (Ailson, execução manual)

### 1️⃣ Rodar os SQLs no Supabase

Entrar em **Supabase → SQL Editor → New query** e rodar **nesta ordem**:

1. `sql/os-amicia/01_tables.sql` (cria 7 tabelas + índices + triggers)
2. `sql/os-amicia/02_seed_ia_config.sql` (popula 44 configs iniciais)
3. `sql/os-amicia/03_seed_ia_sazonalidade.sql` (5 datas sazonais)
4. `sql/os-amicia/04_policies.sql` (RLS deny-anon)

**Verificação rápida** após os 4:

```sql
SELECT
  (SELECT count(*) FROM ia_config) AS configs,
  (SELECT count(*) FROM ia_sazonalidade WHERE ativo) AS datas,
  (SELECT count(*) FROM ia_insights) AS insights_zero,
  (SELECT count(*) FROM ia_feedback) AS feedbacks_zero;
```

Esperado: `configs=44 · datas=5 · insights_zero=0 · feedbacks_zero=0`

### 2️⃣ Environment variables no Vercel

**Vercel → Settings → Environment Variables** do projeto `APP-financeiro`.

Adicionar 3 variáveis, **marcando somente o ambiente Preview** (NÃO marcar
Production — o módulo fica escondido na prod até merge):

| Nome | Valor | Ambiente |
|---|---|---|
| `ANTHROPIC_API_KEY` | a chave que você me passou | ☑ Preview |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key do Supabase | ☑ Preview |
| `VITE_OS_AMICIA_ENABLED` | `true` | ☑ Preview |

**Onde pegar a service role key:** Supabase → Settings → API → `service_role` (a chave secreta, não a anon).

### 3️⃣ Aguardar deploy automático da branch

O Vercel detecta a branch nova e cria preview em URL tipo:

```
app-financeiro-brown-git-os-amicia-fase1-<seu-usuário>.vercel.app
```

Ou visualizar em **Vercel → Deployments → branch os-amicia-fase1**.

### 4️⃣ Smoke test no preview

Entrar na URL de preview, logar como admin, testar:

- [ ] Ícone "OS" aparece no menu (entre Bling e Usuários)
- [ ] Card "OS Amícia" aparece na Home (depois do Bling, fundo bege)
- [ ] Clicar abre o módulo com cabeçalho + 4 tabs (Home / Estoque / Produção / Marketplaces)
- [ ] Aba Home mostra painel "🩺 Saúde da Integração" com:
  - Próximo cron: `07:00` ou `14:00`
  - Insights ativos: `0`
  - Gasto Anthropic: `R$ 0,00 de R$ 80 (0%)`
- [ ] Abas Estoque/Produção/Marketplaces mostram placeholder "entra no Sprint 6"

E o mais importante — **testar que nada velho quebrou**:

- [ ] Oficinas: criar/editar/excluir corte → continua salvando em `ailson_cortes`
- [ ] Bling: sync funciona normal
- [ ] Calculadora: editar preço salva em `calc-meluni`
- [ ] Salas de Corte: lançar corte funciona
- [ ] **Ordem de Corte: criar ordem manual funciona** (teste crítico — campos `origem`, `insight_id`, etc estão NOT NULL DEFAULT na Fase A, então ordens manuais devem passar com default `'manual'`)

### 5️⃣ Produção

**Por enquanto NÃO setar `VITE_OS_AMICIA_ENABLED=true` em Production.**

O módulo fica na produção como código morto (feature flag off), invisível.
Quando aprovar o preview e quiser subir pra prod:

1. Merge PR `os-amicia-fase1` → `main` no GitHub
2. Vercel → Env Vars → adicionar `VITE_OS_AMICIA_ENABLED=true` **em Production**
3. Vercel → Deployments → Redeploy
4. OS aparece na prod

Se der problema, basta remover a env var de Production e redeploy → módulo some.

## 🛡️ Linhas de defesa ativas

Este Sprint 1 já entrega 3 camadas de segurança:

1. **Branch separada** → main intacta até merge
2. **Feature flag** → mesmo no main, sem env var o módulo não aparece
3. **RLS deny-anon** → se alguém tentar ler `ia_insights` ou `ml_vendas_lucro_snapshot`
   pelo frontend direto (anon key), bloqueia. Só service role acessa.

## ❗ Se algo quebrar

- Rollback SQL: cada arquivo tem bloco DROP comentado no final (descomenta e roda)
- Rollback código: `git checkout main` — tudo do OS Amícia vive em arquivos novos, exceto ~4 alterações no App.tsx que são protegidas por `VITE_OS_AMICIA_ENABLED`
- Rollback Vercel: desligar env var `VITE_OS_AMICIA_ENABLED` → redeploy

## ▶️ Próximo sprint

**Sprint 2** — views SQL do fluxo de corte (1-10).
Quando terminar o smoke test aqui e estiver tudo verde, abrir novo chat com contexto:
- "Sprint 1 aprovado e em preview. Partir pro Sprint 2 — views do fluxo de corte."
- Usar o mesmo branch `os-amicia-fase1`.
