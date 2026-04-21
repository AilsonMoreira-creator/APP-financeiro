# 📖 Pacote OS Amícia · Documentação Base

Esta pasta contém a especificação oficial do OS Amícia, preservada
integralmente como recebida no ZIP do Ailson (19/04/2026).

**Cuidado**: esta documentação tem alguns pontos **desatualizados** pela
evolução do projeto. A lista de delta está em `HANDOFF_SPRINT2.md`
(pasta `sql/os-amicia/`). Em caso de conflito, o **HANDOFF** vence.

---

## Arquivos e quando usar cada um

| Arquivo | O que é | Quando abrir |
|---|---|---|
| `02_PROMPT_MESTRE_OS_Amicia.md` | Especificação técnica completa (616 linhas, 10 seções, 27 decisões, 7 tabelas, 29 views, 8 endpoints, 26 cards) | Sempre — é a "bíblia" |
| `03_Preview_OS_Amicia.html` | Preview visual navegável das 4 áreas (Home · Estoque · Produção · Marketplaces) | Sprint 6 (frontend) |
| `05_Tela_Sugestao_Corte.html` | Tela específica de Sugestão de Corte — contrato visual da tela que gera ordem de corte | Sprint 6 (frontend) + Sprint 3 (entender output esperado da IA) |

## Como abrir os HTMLs

Clone o repo, depois:

```bash
# Abre no navegador padrão
open docs/pacote-os-amicia/03_Preview_OS_Amicia.html
open docs/pacote-os-amicia/05_Tela_Sugestao_Corte.html
```

Ambos os HTMLs são **autocontidos** (CSS e JS inline), funcionam offline,
sem dependências externas. Navegue pelos fluxos clicando nos botões/tabs.

---

## Seções críticas do Prompt Mestre (ler primeiro)

Se for começar de um sprint específico, leia estas seções:

### Sprint 2 (views SQL de corte)
- **Seção 4** — Regras de negócio (gatekeeper, cobertura, grade, curvas, cores)
- **Seção 5** — Infraestrutura (views 1-10)
- **Seção 7** — Mapa de dados (o que é real × suposição × limitação)

### Sprint 3 (cron + Claude)
- **Seção 6** — Endpoints e integração Claude (8 regras, formato JSON, orçamento)
- **Seção 4** — Regras (tudo que a IA deve respeitar)

### Sprint 4 (views Marketplaces)
- **Seção 3** — Marketplaces (Cards 1-7, especialmente o Card 1 Lucro do Mês)
- **Seção 5** — Views 11-23

### Sprint 6 (frontend)
- **Seção 2** — Identidade visual (paleta, tipografia, tokens)
- **Seção 3** — As 4 áreas e 26 cards (especificação visual)
- Os 2 HTMLs completos — seguir pixel-perfect

### Sprint 7 (Home)
- **Seção 3** — Home (6 blocos)
- **Seção 5** — Views 24-28

### Sprint 8 (pergunta livre + polish)
- **Seção 4** — Pergunta livre (rate limit, orçamento)
- **Seção 10** — Critérios de sucesso

---

## ⚠️ Pontos do Prompt Mestre que estão OBSOLETOS

Ignorar estas informações do documento original — a verdade está no
`HANDOFF_SPRINT2.md`:

| No doc original | Verdade atual |
|---|---|
| "Cron 08h/18h" | **07h/14h BRT** |
| "Mapeamento ML 80%" | **100% mapeado** |
| "Confiança média/baixa em dados ML" | **Alta por padrão** |
| "Oficinas não detalham cor+tam" | **Detalham sim (18/04)** |
| "Cobertura alvo 35 dias" | **28 dias (reduzida)** |
| "Marketplaces tem 6 cards" | **7 cards** (Card 1 Lucro novo) |
| "Bling tem 7 componentes de custo" | **Usar só custo total** (decisão 21/04) |
| "ALTER TABLE em ordens_corte" | **Não precisa** — Fase A já preparou |
| "Excel histórico a alimentar" | **Já feito** — `amicia_data/historico_vendas` |
| "Rendimento por ref+tecido+sala já disponível" | Dado granular no bruto, mas **view precisa ser construída no Sprint 2** |

---

## Ordem recomendada de leitura pra novo chat

1. **`sql/os-amicia/HANDOFF_SPRINT2.md`** ← começa aqui, sempre
2. Seção específica do Prompt Mestre (depende do sprint, ver acima)
3. HTMLs do preview (se Sprint 6)
4. Código-fonte existente (arquivos mencionados no HANDOFF seção 7)

---

**Origem:** Pacote gerado pelo Ailson em 19/04/2026, subido pro repo em
21/04/2026 pra ficar disponível em todos os chats futuros.
