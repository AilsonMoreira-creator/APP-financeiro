# OS Amícia · Módulo

Sistema operacional de decisão do App Financeiro Amícia.

**Fase 1 · Sprint 1 · 21/04/2026** — esta pasta contém apenas a casca do módulo.
Os 4 sprints seguintes vão preencher cada área.

## Princípios arquiteturais deste módulo

1. **Nunca importar do `App.tsx`.** Mesmo com tentação. Qualquer dado
   necessário vem via props ou via Supabase direto.

2. **Nunca escrever em tabelas existentes.** Escritas ficam restritas às
   7 tabelas próprias (`ia_*`, `ml_vendas_lucro_snapshot`, `calc_historico_snapshot`).
   A única exceção é o `INSERT` em `ordens_corte` ao aprovar uma sugestão
   na tela de corte — mas esse insert usa os campos já preparados pela
   Fase A (`origem='os_amicia'` etc).

3. **Feature flag `VITE_OS_AMICIA_ENABLED`** controla visibilidade:
   - `true` no preview (branch `os-amicia-fase1`)
   - `false` na produção até merge aprovado

4. **Endpoint admin-only** via header `X-User` + validação em
   `_ia-helpers.js` contra `amicia_data/usuarios`.

## Estrutura

```
src/os-amicia/
├── OsAmicia.jsx       (shell — cabeçalho + tabs das 4 áreas)
└── (sprints seguintes adicionam Home.jsx, Estoque.jsx, etc)

api/
├── _ia-helpers.js     (cliente Supabase + validarAdmin + custo)
├── ia-config.js       (GET/PUT thresholds)
├── ia-status.js       (GET painel admin)
└── ia-disparar.js     (POST admin dispara cron — placeholder no Sprint 1)

sql/os-amicia/
├── 01_tables.sql             (7 tabelas)
├── 02_seed_ia_config.sql     (thresholds iniciais)
├── 03_seed_ia_sazonalidade.sql (5 datas)
├── 04_policies.sql           (RLS)
└── README.md                 (ordem de execução)
```

## Como rodar localmente

1. Copiar `.env.local.example` → `.env.local`
2. Preencher:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_OS_AMICIA_ENABLED=true`
3. `npm install && npm run dev`

Endpoints admin precisam de `SUPABASE_SERVICE_ROLE_KEY` e `ANTHROPIC_API_KEY`
em variáveis de ambiente do Vercel (ou `.env.local` pra teste local com `vercel dev`).
