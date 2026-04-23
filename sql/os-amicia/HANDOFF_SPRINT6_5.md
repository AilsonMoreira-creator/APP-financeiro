# HANDOFF Sessão 22/04/2026 (manhã) → Sprint 6.7

Esta sessão resolveu **bugs críticos** no Sprint 6.5 recém-deployado e descobriu
**3 problemas grandes de qualidade** das sugestões de corte que viram **Sprint
6.7** (próxima sessão).

---

## ✅ O que foi feito nesta sessão

### Hotfixes (4 commits)

| Commit | Bug | Fix |
|---|---|---|
| `24f7937` | React error #290 quebrava toda TabProdução | Renomeado prop `ref` → `refNum` (era prop reservada do React) |
| `34b9f38` | Regex de extração de ref do scf falhava em `(ref 02851)` | Nova regex tolerante: `/\(\s*(?:ref\s*)?(\d{3,5})\s*\)/i` |
| `a3b2a6f` → `2587401` | REF 2851 sem dados ML + RUNBOOK criado | Debug+cleanup + INSERT manual em `ml_scf_ref_map` + RUNBOOK |
| `2130249` | Matriz com 7x peças a mais (20.598 em vez de 2.941) | Fórmula corrigida: distribuir por módulos, não multiplicar |

### Documentação criada

- `sql/os-amicia/RUNBOOK.md` — procedimentos manuais recorrentes
  - Seção 1: Cadastrar nova ref no scfMap (com SQL pronto + tabela histórica)
  - Seção 2: Disparar cron ML manualmente
  - Seção 3: Conferir refs sem dados

### Inserções manuais aplicadas no banco (anotar em outro lugar permanente!)

```sql
-- 22/04/2026: REF 2851 (Vestido Midi de Linho com Relevo)
INSERT INTO ml_scf_ref_map (scf, ref) VALUES ('z2304223635j536', '2851')
ON CONFLICT (scf) DO UPDATE SET ref = EXCLUDED.ref;
```

---

## ❌ Problemas pendentes (Sprint 6.7)

### Problema 1 — Cores irrelevantes sendo sugeridas

**Sintoma reportado pelo Ailson na REF 2277:**

App sugere essas cores como "boas" pra incluir no corte:
- 🟡 **Amarelo** (era última posição no ranking; agora nem aparece mais)
- 🔴 **Vermelho** (não está no ranking)
- 🔵 Azul Bebê (em queda -79%)
- ⚪ Azul Claro (sem relevância de vendas)
- 🟣 Verde Sálvia (em queda)
- 🆕 Figo (marcado como "aposta nova")
- 🆕 Offwhite (marcado como "aposta nova")

**Ranking real geral do catálogo (mostrado pelo Ailson):**

| # | Cor | Peças vendidas | % |
|---|---|---|---|
| 1 | Preto | 571 | 20% |
| 2 | Bege | 569 | 19% |
| 3 | Marrom | 346 | 12% |
| 4 | Figo | 269 | 9% |
| 5 | Azul Marinho | 206 | 7% |
| 6 | Caramelo | 131 | 4% |
| 7 | Verde Militar | 115 | 4% |
| 8 | Marrom Escuro | 88 | 3% |
| 9 | Nude | 81 | 3% |
| 10 | Azul Serenity | 81 | 3% |

Bate com poucas das que o app sugere. Diagnóstico provável: a view
`vw_distribuicao_cores_por_ref` está incluindo TODAS cores que tiveram pelo
menos 1 venda, sem filtrar por relevância nem ordenar por volume.

**Onde investigar:**
- `sql/os-amicia/05_views_corte.sql` — view 5 `vw_distribuicao_cores_por_ref`
- Decisão crítica: ranking deve ser **POR REF específica** (não geral) — Ailson
  confirmou que tem dados detalhados por variação no Bling

---

### Problema 2 — Limite de cores por corte

**Regras travadas com Ailson:**

- **Mínimo: 1 cor** por corte
- **Máximo: 6 cores** por corte
- **Cores excedentes** → vão pro próximo corte (mesma ref, novo card)
- **Mas respeita** o piso da curva A (300 peças) ou B (200 peças):
  se o "próximo corte" não bate o mínimo, não gera

**Implicação técnica:** uma ref com 12 cores relevantes pode gerar **2 cards de
sugestão** (corte 1 = top 6 cores, corte 2 = cores 7-12 se atinge o piso).

**Onde mexer:**
- `sql/os-amicia/05_views_corte.sql` — limitar cores via `ROW_NUMBER() OVER (PARTITION BY ref ORDER BY vendas DESC)` e tratar overflow
- `api/_ml-helpers.js` ou função SQL `fn_ia_cortes_recomendados` — gerar 2ª sugestão se necessário
- `src/os-amicia/ProducaoCards.jsx` — agrupar visualmente "Corte 1" e "Corte 2" da mesma ref ou tratar como sugestões independentes

---

### Problema 3 — "Por quê" raso, sem fontes

**Sintoma:** o "Por quê" hoje só diz `"Demanda ativa com cobertura crítica"`.
Nenhuma fonte, número, ou critério visível. Ailson quer **transparência total**:

> "quero saber as fontes... as análises... algo que gere confiança"

**Esperado no Modal Análise Completa (já existe a estrutura):**

- Estoque atual: X peças (fonte: `ml_estoque_ref_atual`)
- Em produção: Y peças (fonte: `salas-corte` + `ailson_cortes` filtrado)
- Venda média/dia: Z peças (fonte: `bling_vendas_detalhe` últimos 30d)
- Cobertura: P dias (cálculo: estoque/venda_dia)
- Lead time: 22d (fonte: `ia_config.lead_time_dias`)
- **Por que essa REF foi escolhida** (critérios técnicos):
  - Curva: A/B/C (fonte: `vw_ranking_curvas_bling`)
  - Cobertura abaixo de threshold X (fonte: `ia_config.cobertura_critica_dias`)
  - Outras refs com mesmo problema mas menor prioridade
- **Por que essas cores** (não outras):
  - Top vendedoras nos últimos 90d
  - Tendência (alta/baixa/estável)
  - Cores excluídas e motivo

**Onde mexer:**
- `sql/os-amicia/16_fase2_estender_fn_cortes.sql` — adicionar mais campos ao payload v1.3
- `src/os-amicia/ProducaoCards.jsx` — ModalAnaliseCompleta enriquecido

---

## 📋 Bug do rendimento — RESOLVIDO mas com nuance

Ailson reportou "55,5 peças/rolo absurdo". Investigamos: **dado tá correto**.

Saia de linho com elastano (REF 2277, sala Antonio, 07/04): 10 rolos → 555 peças.
Rendimento real: 55,5 pç/rolo. Tecido com largura grande + encaixe ótimo permite
isso pra peça pequena (saia midi).

**O bug real era na fórmula da matriz visual**, não no rendimento. Já corrigido
em `2130249`.

**Validação esperada após deploy:**
- REF 2277 com 53 rolos → matriz total ~2.941 peças (era 20.598)
- Bege com 7 rolos → ~388 peças (era 2.720)

---

## 📌 Outros itens em aberto (anteriores a esta sessão)

| Item | Status | Sprint |
|---|---|---|
| Sprint 6.6 (Refazer Home) | Não iniciado | 6.6 |
| Sprint 6.2 (POST feedback Editar/Explicar pra IA aprender) | Não iniciado | 6.2 |
| 4 refs ainda sem dados ML (mesma classe da REF 2851) | Procedimento manual definido no RUNBOOK | Operacional |
| Merge `os-amicia-fase1` → `main` | Aguardando decisão Ailson | Decisão |

---

## 🎯 Plano sugerido pra próxima sessão (Sprint 6.7)

### Ordem de ataque recomendada

**1ª — Investigação SQL** (~30min)

Rodar queries pra confirmar:
- Como a `vw_distribuicao_cores_por_ref` está hoje
- Se tem ranking por REF ou só geral
- Quais cores ela está incluindo pra REF 2277 e por quê
- Como ranking de cor por variação seria estruturado a partir de `bling_vendas_detalhe`

**2ª — Fase A do Sprint 6.7: Corrigir distribuição de cores** (~45min)

- Reescrever view 5 com ranking por REF + filtro por relevância
- Limitar a TOP 6 cores
- Tratar overflow (cores 7+) como "candidato ao próximo corte"

**3ª — Fase B: Geração de múltiplas sugestões** (~45min)

- Estender `fn_ia_cortes_recomendados` pra gerar 2 sugestões por ref quando aplicável
- Validar piso de curva A/B antes de gerar a 2ª

**4ª — Fase C: Modal Análise enriquecido** (~30min)

- Adicionar campos no payload (fontes brutas, critérios)
- UI mostrando cada análise com sua fonte ("Bling vendas 30d", "ia_config", etc)

**5ª — Validar tudo no preview** (~15min)

REF 2277 deve mostrar:
- Cores sugeridas: Preto, Bege, Marrom, Figo, Azul Marinho, Caramelo (top 6)
- Total ~2.941 peças (não 20.598)
- "Por quê" detalhado com fontes

---

## 🔑 Estado final do branch

**Branch:** `os-amicia-fase1`
**Último commit:** `2130249` (fix matriz)
**Total commits desde último merge em main:** 28
**Linhas adicionadas:** ~18.500

**Pra próxima sessão começar bem:**
1. Conferir que preview Vercel deployou commit `2130249`
2. Validar visualmente REF 2277 com matriz corrigida
3. Aí começar Sprint 6.7
