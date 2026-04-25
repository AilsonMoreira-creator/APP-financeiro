# REGRAS DA SUGESTÃO DE CORTE — IA OS AMÍCIA

> **Anexo técnico do HANDOFF principal.**  
> Documenta como a IA de sugestão de corte (OS Amícia) decide **quais REFs cortar, em quais cores, com qual grade**, e onde cada regra está implementada.

---

## ⚠️⚠️⚠️ AVISO CRÍTICO PRA PRÓXIMO CHAT — LEIA ANTES DE TUDO ⚠️⚠️⚠️

**O SQL EM PRODUÇÃO ESTÁ ADIANTE DO REPOSITÓRIO.** Vários commits de SQL foram aplicados direto no banco e nunca voltaram ao repo. Isso causou erros graves em sessão anterior (Sprint 8 IA Pergunta, 25/04) — o assistente afirmou 3 VEZES que regras não estavam implementadas, baseado em arquivos `.sql` desatualizados, quando na verdade já estavam rodando em produção há tempos.

### Discrepâncias conhecidas (estado em 25/04/2026):

| Objeto | No repo | Em produção (real) |
|---|---|---|
| `fn_ia_cortes_recomendados()` | **v1.2** (hotfix cobertura) | **v1.7** (com `tipo_corte`, `fonte_corte_pendente`, limite 5 balanceamentos) |
| `vw_distribuicao_cores_por_ref` | versão básica (linha 437 de `05_views_corte.sql`) | **versão com gates 1+2** (top catálogo + ≥2 var/cor + classificação principal/overflow_cor/excluida) |
| `vw_cortes_recomendados_semana` | versão Sprint 2 | **versão com `tipo_corte`** (tradicional/balanceamento por curva+peças) e filtro `classificacao = 'principal'` |
| `vw_ranking_cores_catalogo` | **NÃO EXISTE NO REPO** | Existe e é gate1 das cores aprovadas |
| `vw_variacoes_vendidas_30d_ref_cor` | **NÃO EXISTE NO REPO** | Existe e é gate2 |
| `ia_sugestoes_arquivadas` | não documentada | Existe, exclui refs arquivadas do corte |
| Chaves `ia_config` | doc parcial | Tem `top_n_cor_principal`, `top_n_cor_overflow`, `boost_ruptura_pct` (não documentadas) |

### REGRAS DE OURO PRA NOVA SESSÃO

1. **NUNCA afirme que uma regra "não está implementada" baseado só nos arquivos do repo.** O Sprint 6.7 estava marcado "pendente" neste mesmo documento mas já tinha sido implementado.
2. **ANTES de propor SQL novo ou afirmar que algo falta, RODE no banco:**
   ```sql
   -- Pra função:
   SELECT pg_get_functiondef(oid)
   FROM pg_proc WHERE proname = '<nome_da_funcao>';
   
   -- Pra view:
   SELECT pg_get_viewdef('<nome_da_view>'::regclass, true);
   
   -- Pra ver chaves de config:
   SELECT chave, valor #>> '{}' FROM ia_config ORDER BY chave;
   ```
3. **Output real do banco supera análise de código.** Se Ailson colar JSON da função, isso é a fonte da verdade.
4. **Restrição inviolável do Ailson:** *"sem mexer em nada do q existe (e esta funcionando)"*. Sempre criar arquivos novos / editar só o que está quebrado.

### O QUE JÁ FOI IMPLEMENTADO (apesar do repo dizer o contrário)

- ✅ **Filtro top do catálogo (gate1):** `vw_distribuicao_cores_por_ref` cruza com `vw_ranking_cores_catalogo`. Verde lima/amarelo/etc saem com `classificacao='excluida'`, motivo `fora_top_catalogo`.
- ✅ **Limite N cores principais:** controlado por `ia_config.top_n_cor_principal` (configurável). Cores de rank > N viram `excluida` com motivo `top_n_excedido`.
- ✅ **Fila de espera (overflow_cor):** entre `top_n_cor_principal` e `top_n_cor_overflow` viram `overflow_cor` (próximo corte).
- ✅ **Tipo de corte (tradicional/balanceamento):** Curva A + ≥300 peças → tradicional. Curva ≠A + ≥200 → tradicional. 80-199 → balanceamento. <80 → não vai.
- ✅ **Limite 5 balanceamentos por janela** aplicado na função v1.7.

### O QUE A IA PERGUNTA (Sprint 8) USA HOJE

Nova view criada nesta sessão:
- `sql/os-amicia/19_vw_ia_curva_abc_ranking.sql` — Curva ABC por POSIÇÃO (1-10=A, 11-20=B, 21+=C), janela 45d, com `dias_ate_zerar_ml_atual` e `dias_ate_zerar_com_oficinas`.

`api/_ia-pergunta-helpers.js` `contextoEstoque(ref?)`:
- **Com REF:** cruza `vw_variacoes_classificadas` (granular cor+tam) com `vw_distribuicao_cores_por_ref` filtrando `classificacao='principal'`. Devolve só variações de cores aprovadas. **Esse é o cruzamento certo — referência canônica de como consumir a regra.**
- **Sem REF:** lê `vw_ia_curva_abc_ranking` direto + `vw_ranking_cores_catalogo` pra top cores.

### COMO MANTER ESTE DOC ATUALIZADO

Se mexer em SQL de produção sem commitar arquivo correspondente no repo, **adiciona uma linha aqui na tabela de discrepâncias acima** com a data e o que mudou. É a única forma de o próximo chat não cair no mesmo poço.

---

## 📌 Como dar dump do estado real (rápido)

Pra próxima sessão começar com fonte da verdade, peça pro Ailson rodar uma vez:

```sql
-- Salva todas as views da OS Amícia em uma string única
SELECT string_agg(
  '-- ' || schemaname || '.' || viewname || E'\n' ||
  'CREATE OR REPLACE VIEW ' || viewname || ' AS' || E'\n' ||
  pg_get_viewdef(schemaname || '.' || viewname, true) || E'\n\n',
  ''
)
FROM pg_views
WHERE schemaname = 'public'
  AND (viewname LIKE 'vw_ia_%'
       OR viewname LIKE 'vw_cortes_%'
       OR viewname LIKE 'vw_variacoes_%'
       OR viewname LIKE 'vw_distribuicao_%'
       OR viewname LIKE 'vw_ranking_%'
       OR viewname LIKE 'vw_grade_%'
       OR viewname LIKE 'vw_rendimento_%'
       OR viewname LIKE 'vw_refs_%'
       OR viewname LIKE 'vw_projecao_%');

-- Salva todas as funções IA
SELECT string_agg(pg_get_functiondef(oid), E'\n\n')
FROM pg_proc
WHERE proname LIKE 'fn_ia_%';
```

Cola o output em arquivos `99_snapshot_views_producao.sql` e `99_snapshot_functions_producao.sql` no repo. Próximo chat lê esses snapshots em vez dos arquivos originais.

---

**Versão atual:** Sprint 6.8 · `fn_ia_cortes_recomendados()` v1.2 (hotfix)  
**Cron:** 2x por dia — 07:00 e 14:00 BRT (`ia-cron.js`)  
**Modelo Claude:** `claude-sonnet-4-6`, temperatura 0.3, max 1500 tokens  
**Orçamento:** R$ 80/mês (hard limit)

---

## 🎯 Pipeline em alto nível

```
Cron dispara (07h ou 14h BRT)
        ↓
ia-cron.js → fn_ia_cortes_recomendados()  (função SQL)
        ↓
  ┌─ Lê bling_vendas_detalhe (últimos 90d)
  ├─ Lê ml_estoque_ref_atual (snapshot atual)
  ├─ Lê amicia_data/ailson_cortes (peças em produção)
  ├─ Lê amicia_data/salas-corte (rendimento histórico)
  ├─ Lê ia_config (thresholds)
  └─ Cruza tudo via 10 views
        ↓
Retorna JSON com top N refs + cores + grade + motivos
        ↓
Claude Sonnet 4.6 formata o "por quê" em linguagem natural
        ↓
Salva em ia_sugestoes_corte → aparece na TabProdução
        ↓
Ailson aprova → gera "Ordem OS" pendente (validade 7 dias)
```

---

## 📊 FONTES DE DADOS (tabelas e views cruzadas)

### Tabelas físicas

| Tabela | Papel no corte | Campos usados |
|---|---|---|
| `bling_vendas_detalhe` | **Fonte de demanda** — vendas reais (Bling) | `itens[].ref`, `itens[].cor`, `itens[].tamanho`, `itens[].quantidade`, `data_pedido` |
| `ml_estoque_ref_atual` | **Fonte de estoque atual** (ML Full, snapshot) | `ref`, `variations[].cor`, `variations[].tam`, `variations[].qty` |
| `amicia_data` user_id `ailson_cortes` | **Fonte de produção real** (oficinas) | `payload.cortes[]` com `ref`, `qtd`, `qtdEntregue`, `entregue`, `detalhes.cores`, `detalhes.tamanhos` |
| `amicia_data` user_id `salas-corte` | **Rendimento histórico** (peças/rolo) | Histórico de cortes por sala/ref pra calcular pc_por_rolo |
| `ia_config` | **Thresholds configuráveis sem deploy** | Todos os parâmetros numéricos abaixo |
| `ia_sazonalidade` | **Ajustes sazonais** (verão/inverno) | Multiplicadores por categoria×mês |
| `ia_sugestoes_corte` | **Saída final** — o que é mostrado no app | JSON da sugestão + status (pendente/aprovada/rejeitada) |

### Views (dependência em cascata)

Definidas em `sql/os-amicia/05_views_corte.sql` (+ extensões nas fases 6-8):

```
vw_variacoes_classificadas      ← BASE. Cruza vendas + estoque + produção por ref+cor+tam.
                                   Classifica cada variação em:
                                   • demanda_status   (ativa | fraca | inativa | ruptura_disfarcada)
                                   • cobertura_status (zerada | critica | atencao | saudavel | excesso)
                                   • confianca        (alta)
                                   Evoluiu em 12 (oficinas), 13 (excesso por volume), 14 (cortes oficinas)
   │
   ├── vw_refs_elegiveis_corte         ← REFs com ao menos 1 variação em ruptura crítica+ativa
   │
   ├── vw_tamanhos_em_gap_por_ref      ← Quais tamanhos estão em gap dentro de cada ref
   │        │
   │        └── vw_grade_otimizada_por_ref ← Define P/M/G/GG/G1/G2/G3 distribution
   │
   ├── vw_distribuicao_cores_por_ref   ← Top cores por REF (ranking próprio por ref, não global)
   │                                     Também lê vw_tendencia_cor_catalogo
   │
   ├── vw_rendimento_sala_corte        ← Peças/rolo histórico por ref ou categoria
   │
   ├── vw_projecao_22_dias_por_ref     ← Quanto vai vender em 22d vs quanto tem em estoque+produção
   │
   ├── vw_ranking_curvas_bling         ← Classifica REFs em curva A/B/C
   │
   └── vw_tendencia_cor_catalogo       ← Cores em alta/baixa no catálogo geral
            │
            └── vw_cortes_recomendados_semana  ← VIEW FINAL que a fn lê

fn_ia_cortes_recomendados()     ← FUNÇÃO que consome todas as views e retorna o JSON
                                   Atualmente versão v1.2 (17_fase2_hotfix_cobertura_projecao.sql)
```

**⚠ IMPORTANTE:** Cada SQL file posterior SOBRESCREVE `vw_variacoes_classificadas` com CREATE OR REPLACE. A versão VIGENTE é sempre a do maior número de arquivo que afeta ela — atualmente `14_fase8_cortes_oficinas.sql`. A função está em `17_fase2_hotfix_cobertura_projecao.sql`.

---

## 🔑 REGRAS DE DECISÃO (com parâmetro e fonte)

### 1. Gatekeeper de demanda (classifica cada variação)

Fonte: `vw_variacoes_classificadas` + `ia_config`

| Status | Regra | Chave ia_config | Valor atual |
|---|---|---|---|
| **ativa** | vendas_15d ≥ 6 | `gatekeeper_vendas_ativa_15d` | 6 |
| **fraca** | 1 ≤ vendas_15d ≤ 5 | `gatekeeper_vendas_fraca_min/max` | 1 / 5 |
| **inativa** | vendas_15d = 0 | (implícito) | — |
| **ruptura_disfarcada** | vendas_15d = 0 **E** vendas_mes_anterior ≥ 12 | `ruptura_disfarcada_min_mes_ant` | 12 |

> **Interpretação:** "ruptura disfarçada" = não vendeu nada em 15d mas vendia bem no mês anterior → provavelmente ficou sem estoque, não perdeu demanda.

### 2. Cobertura (por variação granular)

Fonte: `vw_variacoes_classificadas` + `ia_config`

| Status | Regra (dias de estoque/venda_dia) | Chave | Valor |
|---|---|---|---|
| **zerada** | estoque = 0 | — | — |
| **critica** | cobertura < 10 dias | `cobertura_critica_dias` | 10 |
| **atencao** | 10 ≤ cob < 22 | — | 22 |
| **saudavel** | 22 ≤ cob ≤ 45 | `cobertura_saudavel_min/max_dias` | 22 / 45 |
| **excesso** | cob > 45 | `cobertura_excesso_dias` | 45 |

**HOTFIX v1.2 (22/04):** a cobertura da REF deixou de ser média ponderada (mascarava urgência). Agora a fn retorna **lista granular** de variações em ruptura crítica em `variacoes_em_ruptura[]`.

### 3. Lead time e cobertura-alvo

- **Lead time produção:** 22 dias (`lead_time_dias`)
- **Cobertura-alvo pós-corte:** 28 dias (22 lead + 6 folga) — `cobertura_alvo_dias`

### 4. Projeção de 22 dias

Fonte: `vw_projecao_22_dias_por_ref`

```
projecao_22d_sem_corte = estoque_atual + peças_em_produção - vendas_esperadas_22d
projecao_22d_com_corte = idem + qtd_sugerida_corte
```

**HOTFIX v1.2:** ambos agora CAPADOS EM 0 (produto físico não tem valor negativo). Perda real vai em campo separado `pecas_perdidas_se_nao_cortar`.

### 5. Curvas A/B/C (classifica REFs por volume)

Fonte: `vw_ranking_curvas_bling` + `ia_config`

| Curva | Piso peças estimadas | Teto | Chaves |
|---|---|---|---|
| **A** | 300 | 750 | `curva_a_min_pecas`, `curva_a_teto_pecas` |
| **B** | 200 | 450 | `curva_b_min_pecas`, `curva_b_teto_pecas` |
| **C / outras** | — | — | (não listado) |

**Balanceamento:** REFs entre 80-199 peças caem em "balanceamento" (não atinge piso B mas pode ser cortada se completa outro corte).

**Exceção Ailson:** cores Bege e Preto (carro-chefe) podem bypassar gate de piso quando usadas pra balanceamento.

### 6. Distribuição de cores por REF

Fonte: `vw_distribuicao_cores_por_ref` → `vw_tendencia_cor_catalogo`

**Regra de tendência:**

| Tendência | Critério | Multiplicador rolos |
|---|---|---|
| **Alta** | aumento ≥ 30% em ≥ 5 modelos (cor aparecendo mais) | **1.20** |
| **Normal/Estável** | variação ± 30% | **1.00** |
| **Baixa** | queda ≥ 30% em ≥ 3 modelos (mais sensível que alta) | **0.85** |
| **Nova** | sem histórico suficiente | — |

Chaves: `tendencia_cor_alta_pct`, `tendencia_cor_queda_pct`, `tendencia_cor_alta_min_modelos`, `tendencia_cor_queda_min_modelos`, `multiplicador_cor_*`.

**Mínimo de rolos por cor:** 3 (`rolos_min_por_cor`) — exceção: 2 em casos de balanceamento.

### 7. Limite de cores por corte

Regras travadas com Ailson (Sprint 6.7 pendente implementação):

- **Mínimo:** 1 cor por corte
- **Máximo:** 6 cores por corte
- **Overflow:** cores excedentes geram **corte #2** da mesma REF
- **Condição pro corte #2 existir:** precisa atingir piso de curva (A=300 ou B=200)

### 8. Grade de tamanhos

Fonte: `vw_grade_otimizada_por_ref` + `ia_config`

| Tipo peça | Max módulos | Chave |
|---|---|---|
| **Grande** (vestido, macacão) | 6 | `grade_max_modulos_peca_grande` |
| **Pequena/média** (resto) | 8 | `grade_max_modulos_peca_pequena` |

Classificação por título: palavras-chave em `grade_palavras_peca_grande` = `["vestido","macacão","macacao"]`.

### 9. Rendimento da sala de corte (peças/rolo)

Fonte: `vw_rendimento_sala_corte` + `ia_config`

**Cascata N1 → N2 → N3:**

| Nível | Fonte | Chave piso |
|---|---|---|
| **N1 (alta confiança)** | Histórico da PRÓPRIA REF (≥1 corte) | `rendimento_n1_min_cortes_ref` = 1 |
| **N2 (média confiança)** | Média da CATEGORIA (vestido, calça, saia, etc, ≥2 cortes) | `rendimento_n2_min_cortes_categoria` = 2 |
| **N3 (fallback preview)** | Default hardcoded = 20 pç/rolo | `rendimento_pecas_por_rolo_default` |

Categorias reconhecidas por palavra-chave (ordem = prioridade): `["vestido","macacão","macacao","calça","calca","bermuda","shorts","short","saia","blusa","top","cropped","regata","camisa","conjunto","jaqueta","casaco","blazer"]`.

**Decisão Ailson 21/04:** N1 é obrigatório pra produção real (apenas N1 aparece no corte aprovado). N2/N3 só em preview.

### 10. Capacidade semanal (semáforo)

Fonte: `ia_config`

| Status | Range cortes/semana | Chave |
|---|---|---|
| 🟢 Normal | ≤ 15 | `capacidade_cortes_normal_max` |
| 🟡 Corrida | 16 - 20 | `capacidade_cortes_corrida_max` |
| 🔴 Excesso | 21+ | (implícito) |

### 11. Peças em produção (regra AILSON 22/04)

Fonte: `amicia_data` user_id=`ailson_cortes` (módulo Oficinas Cortes)

> **Regra travada:** "Sempre usar do módulo oficina cortes (com ou sem granularidade). Pode ser que algum corte ainda não tenha preenchido (no futuro isso não vai acontecer)."

**Estratégia de contagem em `vw_variacoes_classificadas` (`14_fase8_cortes_oficinas.sql`):**

- **(a)** Corte tem `detalhes.cores` **E** `detalhes.tamanhos` → usa matriz exata (grade × folhas por célula)
- **(b)** Corte SEM matriz → distribui `qtd` proporcional às vendas dos últimos 30d daquela REF
- **(c)** REF nova sem vendas 30d → distribui uniforme pelas variações em estoque ML atual
- **(d)** Nem b nem c → peças ficam agregadas só no nível da REF sem abertura

**Nota:** Ailson confirmou em sessão anterior que TODAS as REFs atuais já têm matriz — a branch (b/c/d) é defensiva pra cortes antigos.

### 12. Devolução global

Fonte: `ia_config`

Chave `devolucao_global_pct` = **10%**. Desconto aplicado em vendas pra compensar que ML Full não reporta devolução real.

### 13. Margem e ajuste de preço

Fonte: `ia_config`

| Faixa | Valor | Chave |
|---|---|---|
| Urgência máxima | < R$ 0 | `margem_piso_urgencia` |
| Crítico (nunca furar) | < R$ 8 | `margem_piso_critico` |
| Atenção | R$ 10 | `margem_piso_atencao` |
| Ótimo | ≥ R$ 14 | `margem_piso_otimo` |

**Regra dura ML 79:** limite do frete grátis (chave `regra_dura_ml_79`). Evitar zona proibida.

**Entre aumentos:** mínimo 30 dias (`ajuste_preco_dias_entre_aumentos`). Redução só se cobertura ≥ 60d (`reducao_preco_cobertura_min_dias`).

### 14. Home/exibição

- **Críticos fixos:** 5 (`home_alertas_criticos_fixos`)
- **Oportunidades fixas:** 3 (`home_oportunidades_fixas`)
- **Score mínimo pra virar crítico:** 80 (`home_criticos_score_min`)

### 15. Validade da sugestão aprovada

7 dias (`ordem_os_validade_dias`). Passou disso, expira e some da Home.

---

## 🧩 ESTRUTURA FINAL DO JSON RETORNADO

Atual: `fn_ia_cortes_recomendados()` v1.2.

```js
{
  "gerado_em": "2026-04-24T07:00:00",
  "expira_em": "2026-05-01T07:00:00",
  "validade_dias": 7,
  "lead_time_dias": 22,
  "versao": "1.2",
  "capacidade_semanal": {
    "total_cortes_pendentes": 12,
    "status": "normal",  // normal | corrida | excesso
    "cap_normal_max": 15,
    "cap_corrida_max": 20
  },
  "refs": [
    {
      "ref": "02277",
      "nome": "Saia Linho Elastano Midi",
      "curva": "A",
      "severidade": "critica",         // critica | atencao | sugerida
      "confianca": "alta",             // alta | media | baixa
      "variacoes_em_ruptura": [        // HOTFIX v1.2 — lista granular
        {"cor":"Bege","tam":"M","cobertura_dias":3},
        {"cor":"Preto","tam":"G","cobertura_dias":5}
      ],
      "pecas_em_producao": 0,
      "projecao_22d_sem_corte": 0,     // CAPADO em 0 (v1.2)
      "projecao_22d_com_corte": 72,
      "pecas_perdidas_se_nao_cortar": 208,  // valor absoluto da perda
      "cores": [
        {
          "cor": "Bege",
          "participacao_pct": 40,
          "rolos": 4,
          "tendencia": "alta",
          "tendencia_pct": 38,
          "tendencia_label": "alta"    // alta | normal | baixa | nova
        }
      ],
      "matriz_cor_tamanho": [
        {"cor":"Bege","tam":"P","pecas":15},
        {"cor":"Bege","tam":"M","pecas":15},
        ...
      ],
      "rendimento_pc_por_rolo": 55.5,
      "rendimento_nivel": "N1",        // N1 | N2 | N3
      "total_pecas_estimado": 2941,
      "total_rolos": 53
    }
  ]
}
```

---

## ✅ PROBLEMAS RESOLVIDOS (Sprint 6.7 — DONE em algum momento entre 22/04 e 25/04)

> ⚠️ Esta seção dizia "PENDENTE não iniciado" até 25/04 quando descobrimos via `pg_get_functiondef` que tudo já tinha sido implementado em produção (função v1.7) sem o repo ter sido atualizado. Mantemos o histórico abaixo como referência, mas todos os 3 itens estão **resolvidos**.

### ✅ Problema 1: Cores irrelevantes sendo sugeridas — RESOLVIDO

REF 2277 estava sugerindo Amarelo, Vermelho, Azul Bebê, Verde Sálvia — cores em queda ou sem relevância. O ranking **geral** do catálogo não bate com o que aparece no app.

**Onde investigar:** `vw_distribuicao_cores_por_ref` — provavelmente inclui todas as cores com ≥1 venda sem filtrar por relevância nem ordenar por volume específico da REF.

### ✅ Problema 2: Limite de 6 cores não implementado — RESOLVIDO

Foi implementado via `ia_config.top_n_cor_principal` (configurável). A view `vw_distribuicao_cores_por_ref` aplica `ROW_NUMBER() OVER (PARTITION BY ref ORDER BY (gate_ok, score DESC))` e classifica cores como `principal` (entram no corte), `overflow_cor` (fila pro próximo) ou `excluida`.

### ✅ Problema 3: "Por quê" raso — RESOLVIDO (frontend)

O modal `ProducaoCards.jsx` (`ModalAnaliseCompleta`) já consome `ref_.analise{}` com `{valor, fonte/calc}` por campo, `cores_excluidas[]` com motivo, `fila_espera[]`, e `criterios_aplicados{}`. Todos os campos vêm da função SQL v1.7+.

---

## 🧪 COMO TESTAR A FUNÇÃO

```sql
-- Rodar manualmente a função e ver o JSON:
SELECT fn_ia_cortes_recomendados();

-- Ver só capacidade:
SELECT fn_ia_cortes_recomendados() -> 'capacidade_semanal';

-- Ver só a primeira REF:
SELECT fn_ia_cortes_recomendados() -> 'refs' -> 0;

-- Ver config atual (altera sem deploy):
SELECT chave, valor, descricao FROM ia_config ORDER BY chave;
```

**⚠ Ailson odeia rodar SQL manual.** Se precisar validar regularmente, criar endpoint `/api/ia-sugestoes-diag` tipo os do SAC.

---

## 🔗 ARQUIVOS SQL PARA LER QUANDO MEXER

**Ordem sugerida de leitura:**

1. `02_seed_ia_config.sql` (150 linhas) — **TODOS os parâmetros de negócio**
2. `05_views_corte.sql` (918 linhas) — **10 views base**, dependências documentadas no topo
3. `14_fase8_cortes_oficinas.sql` (339 linhas) — **versão atual** de `vw_variacoes_classificadas` (com ailson_cortes)
4. `17_fase2_hotfix_cobertura_projecao.sql` (367 linhas) — **fn atual** v1.2 com variacoes_em_ruptura e projeções capadas
5. `16_fase2_estender_fn_cortes.sql` (371 linhas) — histórico do que v1.1 adicionou à fn (matriz cor×tam, tendência por cor, etc)
6. `HANDOFF_SPRINT6_5.md` — problemas pendentes detalhados
7. `RUNBOOK.md` — procedimentos manuais (cadastrar ref nova no scfMap, disparar cron, etc)

**Arquivos que NÃO são mais a versão vigente** (mas documentam evolução):
- `06_fn_cortes_recomendados.sql` — v1.0 da fn, superada por 16 e 17
- `12_fase6_cobertura_com_oficinas.sql`, `13_fase7_excesso_por_volume.sql` — superadas por 14

---

## 🎯 COMO MEXER NAS REGRAS (sem quebrar)

### Mudar um threshold (rápido, sem deploy)

```sql
UPDATE ia_config
SET valor = '10'::jsonb
WHERE chave = 'gatekeeper_vendas_ativa_15d';
```

Próxima execução do cron já usa o novo valor. Todas as regras numéricas seguem esse padrão.

### Mudar lógica de classificação

Editar a view correspondente em `05_views_corte.sql` (ou a versão mais nova em 12/13/14 pra `vw_variacoes_classificadas`). Rodar o SQL inteiro no Editor. `CREATE OR REPLACE VIEW` é idempotente.

### Mudar estrutura do JSON retornado

Editar `17_fase2_hotfix_cobertura_projecao.sql` (a função atual). Incrementar versão (v1.2 → v1.3). Rodar inteiro no Editor.

**⚠ Se mexer na fn, conferir se o frontend (`ProducaoCards.jsx` + `TabProducao`) lê os campos novos corretamente. Campos novos podem quebrar componentes.**

### Adicionar nova regra / novo campo

1. Se for threshold → só INSERT em `ia_config`.
2. Se for classificação → editar a view `vw_variacoes_classificadas` na versão mais nova (14).
3. Se for novo campo no output → editar a fn v1.2 e subir pra v1.3.
4. Testar rodando `SELECT fn_ia_cortes_recomendados()` e inspecionando o JSON.

---

## 📌 Insight importante sobre o fluxo

O **SAC (ml-webhook)** e a **sugestão de corte (ia-cron)** são sistemas INDEPENDENTES que cruzam:

- SAC lê `ailson_cortes` pra **forecast de cor** (nova feature Sprint 6.8)
- Sugestão de corte lê `ailson_cortes` pra **contar peças em produção**

Se a estrutura de `amicia_data.payload.cortes[]` mudar (ex: Ailson renomear campo `detalhes` pra `matriz`), **os dois sistemas quebram juntos**. Considerar migração coordenada se for mexer.

---

## ⚙️ Crons que alimentam o sistema de corte

| Cron | Frequência | O que faz pra sugestão de corte |
|---|---|---|
| `bling-cron` | 10 min | Popula `bling_vendas_detalhe` (fonte de demanda) |
| `bling-produtos-sync` | 6h diário | Popula `ml_scf_ref_map` (resolve ref a partir de scf) |
| `ml-estoque-cron` | 6h | Popula `ml_estoque_ref_atual` (fonte de estoque) |
| `ia-cron?janela=manha` | 10:00 | Roda sugestão de corte da manhã |
| `ia-cron?janela=tarde` | 17:00 | Roda sugestão de corte da tarde |

Escopos adicionais do cron IA (não só corte): `?escopo=marketplaces` e `?escopo=estoque` rodam em horários escalonados (15 e 30 min após o principal).

---

**Fim do anexo.** Pra contexto geral, ver `HANDOFF_SPRINT_6_8_FINAL.md`.
