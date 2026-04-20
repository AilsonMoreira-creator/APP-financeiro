# 📋 Spec Resolvida · Fase A · Sala de Corte

**Versão:** 2.0 — substitui `01_ESPECIFICACAO_COMPLETA.md` do ZIP1
**Data:** 20/04/2026
**Status:** Pronta pra implementar

---

## 1. Escopo final (com decisões)

**O que entrega:**

1. Tabela nova `ordens_corte` + auditoria — Supabase
2. **7 endpoints** API novos em `/api/`
3. **2 telas novas:**
   - **Ordem de Corte** (desktop, admin-only) — gerencia ordens
   - **Fila de Corte** (mobile, admin + funcionário) — separa tecido + define sala
4. **2 melhorias na tela existente** Análise/Lista do Salas de Corte:
   - Campo de busca por ref no header
   - Ícone matrix em cada linha de corte que veio de uma ordem (`ordemId` preenchido) — abre modal com detalhes da ordem original

**O que NÃO faz parte (decisões fechadas):**

- ❌ Tela "Análise / Cortes" nova — DESCARTADA
- ❌ Sala recomendada no modal Definir Sala — DESCARTADA
- ❌ Aba "Histórico da ref" no modal Editar Tecido — DESCARTADA
- ❌ Mudança no fluxo "Lançar Corte Manual" — continua igual
- ❌ Mudança no payload `ailson_cortes` (Lista de Cortes do Oficinas) — NÃO TOCA

---

## 2. Fluxo completo (single source of truth)

```
[ADMIN, desktop] → cria Ordem de Corte
   status: aguardando
        ↓
[FUNCIONÁRIO, mobile] → confirma "Tecido separado" na Fila
   status: separado
   separado_por, separado_em preenchidos
        ↓
[FUNCIONÁRIO, mobile] → "Definir sala" na Fila → escolhe Antonio
   status: na_sala
   sala, enviado_sala_em preenchidos
   Ordem some da Fila Mobile
   Ordem vai pro fim da lista da Ordem de Corte (visual discreto)

   ⚡ AUTOMÁTICO no mesmo request:
      cria registro no payload salas-corte com:
      {
        id: Date.now(),
        data: hoje,
        sala: "Antonio",
        ref, descricao, marca,
        qtdRolos: total_rolos,        // soma da matriz
        qtdPecas: null,
        rendimento: null,
        status: "pendente",
        alerta: false,
        visto: true,
        ordemId: <uuid_da_ordem>      // ⟵ NOVO CAMPO no objeto corte
      }

   Atualiza ordens_corte.corte_id = Date.now() usado acima
        ↓
[FUNCIONÁRIO] → vai em Salas de Corte → Análise/Lista
   Vê o corte pendente (mesmo padrão de hoje)
   Clica nele → lança qtd peças → corte vira "concluido"

   ⚡ AUTOMÁTICO no mesmo request:
      busca ordem com corte_id = id do corte
      atualiza ordens_corte.status = 'concluido'
      ordens_corte.concluido_em = NOW()
```

**Fluxo paralelo (não muda nada):**

```
[FUNCIONÁRIO] → "Lançar Corte" no Salas de Corte
   digita {sala, ref, qtdRolos}
   cria corte direto no salas-corte SEM ordemId
   aparece na Lista normalmente, sem ícone matrix
```

---

## 3. Schema (resumo — SQL completo no arquivo `01_ordens_corte_schema.sql`)

**Tabela `ordens_corte`** — 24 colunas. Campos críticos:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | PK auto |
| `ref` | TEXT NOT NULL | vem do cadastro Oficinas |
| `tecido` | TEXT NOT NULL | vem do cadastro Oficinas (única fonte) |
| `grade` | JSONB | `{"P": 1, "G": 1, "GG": 2}` |
| `cores` | JSONB | `[{"nome":"Preto","rolos":3,"hex":"#1c1c1c"}]` |
| `total_rolos` | INTEGER | soma redundante (pra queries rápidas) |
| `status` | TEXT CHECK | `aguardando \| separado \| na_sala \| concluido \| cancelado` |
| `origem` | TEXT CHECK | `manual \| os_amicia` |
| `corte_id` | BIGINT | vínculo ao corte criado em salas-corte |
| `concluido_em` | TIMESTAMPTZ | preenche AUTO quando corte fecha |
| `version` | INTEGER | optimistic locking (incrementa via trigger) |
| `created_at` / `updated_at` | TIMESTAMPTZ | auto-managed |

**Tabela `ordens_corte_historico`** — log de auditoria, FK pra `ordens_corte`.

**RLS:** NÃO habilitado (decisão consciente — app não usa Supabase Auth hoje, controle real é nos endpoints).

**Realtime:** habilitado pra `ordens_corte`.

---

## 4. Endpoints API (7 endpoints)

### `GET /api/ordens-corte-listar`
Query: `?status=&ref=&origem=&pagina=`
- Admin: todas as ordens
- Funcionário: só `aguardando` e `separado` (pra Fila mobile)
- Paginado 50 por página

### `GET /api/ordens-corte-get`
Query: `?id=<uuid>`
- Retorna 1 ordem completa (usado pelo modal matrix da Análise/Lista)

### `POST /api/ordens-corte-criar`
Body: `{ref, grade, cores, grupo?, insight_id?}`
- Lê `amicia_data` user_id `ailson_cortes` → busca produto por ref → puxa `tecido` e `descricao`
- Bloqueia se ref não existe → `400 "Ref não cadastrada em Oficinas"`
- Bloqueia se produto sem tecido → `400 "Sem tecido cadastrado"`
- Calcula `total_rolos` automaticamente (soma de `cores[].rolos`)
- `criada_por` = `usuarioLogado.usuario` (vem do header X-User ou body)
- **Admin-only** (validar no backend)

### `PUT /api/ordens-corte-atualizar`
Body: `{id, version, ...campos}`
- Optimistic locking: `WHERE id = ? AND version = ?` → se update afetar 0 rows, retorna `409 "Ordem foi atualizada por outro usuário, recarregando..."`
- Mudança em `grade`, `cores`, `grupo` exige `motivo_edicao`
- Grava em `ordens_corte_historico`
- **Admin-only**

### `POST /api/ordens-corte-status`
Body: `{id, novoStatus, ...campos}`

Transições válidas:
| De | Pra | Quem | Side effect |
|---|---|---|---|
| `aguardando` | `separado` | Admin/Func | salva `separado_por`, `separado_em` |
| `separado` | `na_sala` | Admin/Func | salva `sala`, `enviado_sala_em` + **CRIA corte no salas-corte** |
| `na_sala` | `concluido` | qualquer | salva `concluido_em`. Chamado **automaticamente** pelo front quando corte vinculado é concluído |
| qualquer | `cancelado` | Admin | igual ao excluir |

**Lógica do "criar corte no salas-corte" (passo crítico):**

```
1. Lê amicia_data WHERE user_id='salas-corte'
2. Pega payload.cortes (array)
3. Cria objeto corte conforme estrutura existente, com ordemId preenchido
4. Faz read-merge-write: append do novo corte + reescreve payload inteiro
   (mesmo padrão do scDb.save existente em App.tsx:5313)
5. UPDATE ordens_corte SET corte_id = <id_do_corte_novo> WHERE id = <ordem_id>
```

**Importante:** o read-merge-write do salas-corte hoje funciona da seguinte forma — se o frontend já tinha um state local com cortes, esse novo corte vinculado vai aparecer no próximo Realtime push. O componente `SalasCorteContent` já tem listener (basta confirmar). Se não tiver, adicionar.

### `DELETE /api/ordens-corte-excluir`
Body: `{id, motivo_exclusao}`
- Soft delete: `status='cancelado'`, `motivo_exclusao` preenchido
- Bloqueia se status `na_sala` ou `concluido` → `400 "Ordens já enviadas/concluídas não podem ser excluídas"`
- Grava em historico
- **Admin-only**

### `GET /api/ordens-corte-buscar-ref`
Query: `?q=02277`
- Lê `amicia_data` user_id `ailson_cortes` → filtra `payload.produtos` por `ref.startsWith(q)`
- Retorna max 10: `[{ref, descricao, marca, tecido}]`
- Usado pelo autocomplete do modal "+ Nova ordem"

---

## 5. Cores no modal "Editar Tecido" (Fila Mobile)

**Fonte única:** `localStorage["amica_bling_cores_top"]`
**Formato:** `{cores: [{nome, hex, qtd}], _updated: timestamp}`
**Já existe:** populado automaticamente pelo módulo Bling Produtos (App.tsx:4476)
**Fallback:** se ainda não foi sincronizado → usa `CORES_RANKING_INICIAL` (lista hardcoded já existente)

UI: mostra as 16 cores como grid de chips clicáveis. Botão `+ add` permite cor manual com cor hex livre.

---

## 6. Melhorias na Análise/Lista do Salas de Corte

Localização do código: `SalasCorteContent` em `src/App.tsx` linha ~5316.

**Mudança 1 — Busca por ref no header:**
- Adicionar `<input>` de busca acima da lista
- Filtra `cortesSala` em runtime: `c.ref.startsWith(busca.trim())`
- Busca limpa = mostra todos

**Mudança 2 — Ícone matrix em cortes vinculados:**
- Em cada linha de `cortesSala`, se `corte.ordemId` existir:
  - Renderizar botão pequeno com ícone matrix (mesmo SVG do mock `04_Tela_Analise_Cortes.html`)
  - Click → fetch `/api/ordens-corte-get?id=<ordemId>` → abre modal mostrando: grade, cores+rolos, matriz cor×tamanho, total rolos, criada em, criada por

**Mudança 3 — Hook de auto-conclusão:**
- No handler `salvarPecas` (App.tsx ~5520) ou equivalente onde corte vira `status:'concluido'`:
- Após o `setCortesSala(...)`, se o corte tinha `ordemId`, chamar:
  ```js
  fetch('/api/ordens-corte-status', {
    method: 'POST',
    body: JSON.stringify({id: corte.ordemId, novoStatus: 'concluido'})
  })
  ```

---

## 7. Multi-user (resumo)

| Ação | Admin | Funcionário |
|---|---|---|
| Ver / Criar / Editar / Excluir Ordem | ✅ | ❌ |
| Confirmar tecido separado (Fila) | ✅ | ✅ |
| Editar cores da ordem (Fila) | ✅ | ✅ |
| Definir sala (Fila) | ✅ | ✅ |
| Lançar Corte Manual (existente) | ✅ | ✅ |
| Lançar qtd peças (existente) | ✅ | ✅ |
| Ver Análise/Lista do Salas de Corte | ✅ | ✅ |

**Validação admin-only** acontece em 2 camadas:
- Frontend: rotas escondidas + botões não renderizados
- Backend: endpoint rejeita request se user não for admin

---

## 8. Concorrência

- **Optimistic locking** via `version` em todos os UPDATEs → rejeita writes obsoletos com 409
- **Realtime channel** `sync-ordens-corte` reescuta a tabela inteira
- **Eco do próprio save:** ignorar updates com `updated_at` dentro de 3s do último save local (mesmo padrão de `sync-oficinas` em App.tsx:7814)

---

## 9. Pré-requisitos

Antes de implementar, garantir:

1. ✅ Branch `os-amicia-fase-a-sala-corte` criada (já mandado pelas instruções do ZIP1)
2. ✅ Vercel preview ativo na branch (deploy automático)
3. ⚠ Rodar `01_ordens_corte_schema.sql` no SQL Editor do Supabase
4. ⚠ Bucket Supabase Storage `produtos` (público) — pendência **antiga** do app (CONTEXTO-APP.md linha 132). Sem isso, fotos viram placeholder 📷 em todos os módulos. Não bloqueia a Fase A funcionar, mas vale criar.

---

# 🧪 PLANO DE TESTE

Cada item passa antes do próximo. Se quebrar, parar e investigar.

## Bloco 1 — SQL (5min)
- [ ] Rodar `01_ordens_corte_schema.sql` no Supabase SQL Editor
- [ ] Verificar mensagem de sucesso (sem erros vermelhos)
- [ ] Descomentar e rodar bloco "VALIDAÇÃO RÁPIDA" no SQL → INSERT funciona, version=1, datas preenchidas
- [ ] UPDATE de teste → version vai pra 2, updated_at atualizado
- [ ] DELETE limpa o teste
- [ ] Confirmar Realtime ativo: Database → Replication → ver `ordens_corte` listado

## Bloco 2 — Endpoints (30min, no Vercel preview)
- [ ] `POST /api/ordens-corte-criar` com payload válido → 201 com ordem
- [ ] `POST` com ref inexistente → 400 "Ref não cadastrada"
- [ ] `POST` com produto sem tecido → 400 "Sem tecido cadastrado"
- [ ] `GET /api/ordens-corte-listar?status=aguardando` → retorna a ordem criada
- [ ] `PUT /api/ordens-corte-atualizar` com version=1 → atualiza, retorna version=2
- [ ] `PUT` com version=1 de novo (depois do passo anterior) → 409
- [ ] `DELETE /api/ordens-corte-excluir` com motivo → soft delete, status='cancelado'
- [ ] `GET /api/ordens-corte-get?id=<uuid>` → retorna 1 ordem completa

## Bloco 3 — UI Ordem de Corte (20min)
- [ ] Login admin → acessa Ordem de Corte
- [ ] Login "corte" (funcionário) → não consegue acessar (rota escondida)
- [ ] Admin clica "+ Nova ordem" → modal abre, autocomplete da ref funciona
- [ ] Admin cria ordem real → aparece no topo da lista, status "Aguardando"
- [ ] Admin clica ✎ → modal de edição abre com dados preenchidos
- [ ] Admin clica ✕ → modal pede motivo, ao confirmar a ordem some
- [ ] Busca por ref filtra a lista corretamente
- [ ] Filtros por status funcionam

## Bloco 4 — UI Fila Mobile (20min, abrir no celular real)
- [ ] Login funcionário no celular → vê Fila de Corte
- [ ] Vê a ordem criada no Bloco 3 na aba "Pra separar"
- [ ] Clica "Confirmar tecido separado" → ordem move pra "Separados"
- [ ] Clica "Editar tecido" → modal abre com 16 cores do Bling
- [ ] Adiciona/remove cor → salva → cores atualizadas
- [ ] Clica "Definir sala" → modal abre com Antonio/Adalecio/Chico (sem "recomendada" destacada)
- [ ] Escolhe Antonio → confirma → ordem some da Fila

## Bloco 5 — Integração crítica (15min — esse é o mais importante)
- [ ] Admin volta na Ordem de Corte → ordem agora com status "Na sala de corte" no fim da lista, visual discreto
- [ ] Admin vai em Salas de Corte → Análise/Lista
- [ ] **Vê o corte novo criado automaticamente:** ref correta, sala Antonio, qtdRolos = total da matriz da ordem
- [ ] Esse corte tem **ícone matrix** ao lado
- [ ] Clica no ícone matrix → modal abre com detalhes completos da ordem original
- [ ] Funcionário lança qtd peças desse corte → corte vira "concluído" no Salas de Corte
- [ ] Admin volta na Ordem de Corte → ordem **agora também está como "Concluída"**

## Bloco 6 — Regressão (10min) — confirmar que não quebrei nada
- [ ] Funcionário faz "Lançar Corte" Manual (sem passar por ordem) → corte aparece na Lista **SEM** ícone matrix
- [ ] Lançar Corte continua funcionando idêntico ao antes
- [ ] Cortes antigos (pré-Fase A) na Lista continuam aparecendo, sem ícone matrix
- [ ] Módulos Bling, SAC, Oficinas, Calculadora, Ficha Técnica, Boletos, Agenda, Lançamentos: todos abrem e funcionam
- [ ] Testar especialmente: criar 1 lançamento financeiro novo, abrir 1 boleto, ver dashboard Bling

## Bloco 7 — Concorrência (10min)
- [ ] Abrir 2 navegadores logados como admin
- [ ] Editar a mesma ordem nos 2
- [ ] Salvar primeiro um → OK
- [ ] Salvar o outro → mensagem 409 "atualizada por outro usuário, recarregando"
- [ ] State local atualizado com versão nova

## Bloco 8 — Go-live (depois de TUDO acima passar)
- [ ] Backup manual do `amicia_data`: exportar JSON das chaves `salas-corte`, `ailson_cortes`, `financeiro`, `usuarios`
- [ ] Confirmar PITR ativo no Supabase Pro (Settings → Database → Point-in-Time Recovery)
- [ ] Merge da branch `os-amicia-fase-a-sala-corte` → `main`
- [ ] Aguardar deploy do Vercel em produção
- [ ] **Monitorar primeiras 24h:** logs Vercel, console errors, feedback do funcionário no chão de fábrica
- [ ] Se algo der errado: reverter via PITR + revert do commit

---

**Grupo Amícia · App Financeiro v6.8**
**Spec Resolvida Fase A · 20/04/2026**
