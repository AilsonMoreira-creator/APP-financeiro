# Handoff · Calculadora Meluni v2 + Tela de Análise de Cenários

> **Documento técnico para implementação.** Inclui regras de negócio, schema, fórmulas, wireframes e prompt pronto pra colar em outro chat de implementação.
>
> **Projeto:** App Financeiro Amícia
> **Módulo:** Calculadora (card Meluni) + nova tela "Análise de Cenários — Meluni"
> **Stack:** React + Vite + TypeScript + Supabase + Vercel
> **Branch sugerida:** `feature/calculadora-meluni-v2`
> **Versão:** 2.0 (Meta API removida — fica pra Fase 2)

---

## 1. Contexto e Objetivo

### Problema
A calculadora atual do card Meluni mostra apenas a "última linha" (lucro líquido) **assumindo ROAS 10**. Isso esconde a margem bruta real disponível pra ads e impede simulação de cenários quando o ROAS real é diferente.

A campanha Meta Ads da Meluni (B2C) tem 1 mês rodando com ROAS abaixo do alvo. Sem simulador de cenários, não dá pra:
- Saber qual ROAS de break-even
- Decidir se aceitar ROAS menor é viável
- Projetar quantas visitas/CPC são necessários pra bater meta de R$ 100k
- Avaliar impacto de melhorar margem (subir preço, reduzir CMV) na viabilidade

### Solução
Reestruturar o card Meluni + criar uma **nova tela "Análise de Cenários — Meluni"** acessada por botão.

**Componentes da entrega:**

1. **Card Meluni v2** (dentro do módulo Calculadora) — separa margem bruta (antes do ads) do lucro líquido. ROAS vira input editável. Adiciona botão "Analisar cenários".
2. **Toggle fonte da margem** (no próprio card) — alternar entre média de cadastro vs média ponderada por vendas reais.
3. **Tela "Análise de Cenários — Meluni"** (nova, abre via botão) contendo:
   - **Bloco "Dados reais do período"** — inputs manuais: CPC, Conversão (e opcionais: ticket real, peças real)
   - **Simulador de 5 cenários** — modelagem reversa a partir de meta de vendas
   - **Engenharia reversa de ROAS** — retorna 2 ROAS lado a lado (break-even + lucro alvo)

> **NÃO está nesta entrega:** integração com Meta Marketing API. Os dados de CPC e Conversão são **digitados manualmente** pelo usuário. A integração API fica pra Fase 2 (ver roadmap).

---

## 2. Dados de Negócio (Meluni)

| Variável | Valor atual | Origem |
|---|---|---|
| Ticket médio por produto | R$ 120,00 | Calculadora cadastro |
| Ticket médio por pedido | R$ 160,00 | Site Meluni (média 30d) — pode ser sobrescrito |
| Peças por pedido (média) | 1,33 | Cálculo: ticket pedido / ticket produto — pode ser sobrescrito |
| Margem bruta / produto (cadastro) | R$ 27,00 | (Receita) – (CMV + frete + gateway + imposto) |
| Margem bruta / pedido | R$ 36,00 | margem produto × peças/pedido |
| ROAS alvo original | 10 | (irrealista p/ margem 22,5%) |
| ROAS break-even | 4,46 | meta / margem total disponível |
| ROAS realista B2C moda | 4,5 a 5 | Benchmark mercado |

### Composição da margem (R$ 120 → R$ 27)
```
Receita produto:           R$ 120,00
(-) CMV:                  -R$  65,00
(-) Frete subsidiado:     -R$  12,00
(-) Taxa gateway (3,5%):  -R$   4,20
(-) Imposto (Simples):    -R$  11,80
─────────────────────────────────────
Margem bruta antes ads:    R$  27,00 ← novo destaque
```

---

## 3. Mudanças no Card Meluni (módulo Calculadora)

### 3.1 Nova seção final do card (substitui a atual)

```
┌──────────────────────────────────────────┐
│ MARGEM POR PRODUTO                       │
├──────────────────────────────────────────┤
│ Receita produto:           R$ 120,00     │
│ (-) CMV:                  -R$  65,00     │
│ (-) Frete subsidiado:     -R$  12,00     │
│ (-) Taxa gateway:         -R$   4,20     │
│ (-) Imposto:              -R$  11,80     │
│ ─────────────────────────────────────    │
│ 💰 MARGEM BRUTA ANTES ADS:  R$ 27,00     │ ← destaque novo
│    (disponível p/ ads + lucro)            │
│ ─────────────────────────────────────    │
│ ⚙️ ROAS real:           [10,0  ↕]        │ ← input editável
│ (-) Investimento ads:     -R$ 12,00      │ ← auto = ticket / ROAS
│ ─────────────────────────────────────    │
│ 🟢 LUCRO LÍQUIDO:           R$ 15,00     │ ← cor: verde/amarelo/vermelho
│ ─────────────────────────────────────    │
│ [📊 Analisar cenários e ROAS necessário →] ← BOTÃO NOVO
└──────────────────────────────────────────┘
```

### 3.2 Regras do card

- **ROAS input:** editável (number, 1.0 a 20.0, step 0.1, default 10.0)
- **Investimento ads:** `ticketProduto / roas` (recalcula a cada keystroke)
- **Lucro líquido:** `margemBruta - investimentoAds`
- **Cor do lucro líquido:**
  - `lucro > 0`: verde (`var(--green)`)
  - `lucro === 0`: amarelo (`var(--yellow)`)
  - `lucro < 0`: vermelho (`var(--red)`)
- **Persistência:** salvar `roasReal` no Supabase (chave `calc-meluni`, campo `roas_atual`) — debounce 500ms

### 3.3 Botão "Analisar cenários"

- **Posição:** rodapé do card Meluni (full-width)
- **Estilo:** primary button (background `var(--primary)`, hover `var(--secondary)`)
- **Comportamento:**
  - **Mobile (<768px):** abre tela cheia (full-screen modal/drawer com transição slide-up)
  - **Desktop (≥768px):** abre overlay/modal grande centralizado (com close button no canto superior direito)
- **Padrão escalável:** quando vc validar e quiser replicar pra Lumia/Exitus/Muniam, é só copiar este botão pros outros cards (cada um abre sua tela específica)

### 3.4 Toggle "Fonte da margem"

```
Fonte da margem (média Meluni):
○ Cadastro — média simples dos 35 produtos    R$ 27,00
● Vendas reais — ponderada por volume         aguardando dados
```

**Lógica:**
- **Cadastro:** `Σ margem_cadastro / count(produtos)` — simples
- **Vendas reais:** `Σ(margem_produto × qtd_vendida) / Σ qtd_vendida` (últimos N dias)
  - `N` configurável: 7 / 15 / 30 / 60 / 90 dias (default 30)
  - Mostrar `base: X pedidos` ao lado do toggle
  - Se `base < 100 pedidos`, exibir aviso "amostra pequena, prefira cadastro"
  - Se `|margem_real - margem_cadastro| / margem_cadastro > 0.15`, exibir alerta amarelo: "Diferença >15% entre cadastro e vendas reais — revise precificação ou mix de produtos"

---

## 4. Tela "Análise de Cenários — Meluni"

### 4.1 Header da tela

```
🎯 Análise de Cenários — Meluni              [✕ Voltar à calculadora]
─────────────────────────────────────────────
```

### 4.2 Bloco "Dados reais do período" (TOPO da tela — destaque visual)

Estilo: card com background `var(--primary)` (azul escuro), texto branco. Visualmente destacado.

```
┌────────────────────────────────────────────────────────┐
│ 📥 Dados reais do período (digite manualmente)          │
│ Esses 2 números vão alimentar a engenharia reversa.     │
│                                                          │
│ CPC médio (R$):    [1,20]   Meta Ads → "CPC (link)"     │
│ Conversão (%):     [1,0]    GA4 ou: pedidos÷visitas     │
│ Período:           [30d ▼]  Apenas referência           │
│                                                          │
│ ▸ Sobrescrever ticket / peças (opcional)                │
│   ├─ Ticket médio real:  [   ] (vazio = usa cadastro)   │
│   └─ Peças por pedido:   [   ] (vazio = usa cadastro)   │
└────────────────────────────────────────────────────────┘
```

**Inputs principais (mínimo viável):**

| Campo | Tipo | Default | Origem do dado |
|---|---|---|---|
| `cpc` | number, R$ | 1,20 | Meta Ads Manager → "CPC (link)" |
| `conv` | number, % | 1,0 | GA4 ou cálculo manual: `pedidos / visitas × 100` |
| `periodo` | select | 30 | 7 / 30 / 60 / 90 dias (apenas referência label) |

**Inputs opcionais (sobrescritos do cadastro):**

| Campo | Tipo | Comportamento |
|---|---|---|
| `ticket_real` | number, R$ | Vazio = usa `ticketPedidoCadastro` (160). Preenchido = usa esse valor |
| `pecas_real` | number | Vazio = usa `pecasPedidoCadastro` (1,33). Preenchido = usa esse valor |

**Persistência:** salvar tudo em `dados_reais_periodo` no Supabase. Debounce 500ms.

**Esses inputs alimentam:**
- O simulador de cenários (especificamente os cálculos de margem total — via ticket e peças)
- A engenharia reversa (CPC e Conversão são usados diretamente lá)

### 4.3 Simulador de 5 cenários

**Inputs do simulador:**

```
🎯 Meta de vendas (R$):          [100.000]    ← number, default 100000, step 1000
🧪 Simular aumento de margem:    [0]          ← number, R$/produto, 0 a margemBruta, step 1
   "E se eu subir preço, reduzir CMV ou negociar frete?
    O ganho é aplicado em todos os cenários abaixo."
📦 Resumo da meta (auto):
   X pedidos · Y produtos
   Margem unit: R$ Z · Total: R$ W
```

**Resumo computado (auto):**
- `margemUnit = margemBrutaProduto + aumentoMargem`
- `pedidos = meta / ticketPedido` (usa `ticket_real` se preenchido, senão cadastro)
- `produtos = pedidos × pecasPedido` (usa `pecas_real` se preenchido, senão cadastro)
- `margemTotal = produtos × margemUnit`
- `roasBreakEven = meta / margemTotal`

#### 4.3.1 Tabela de cenários (5 linhas fixas)

| ID | Nome | Conv. default | CPC default |
|---|---|---|---|
| `pessimista` | 🔴 Pessimista | 0,5% | R$ 1,80 |
| `conservador` | 🟠 Conservador | 0,8% | R$ 1,50 |
| `realista` | 🟡 Realista | 1,0% | R$ 1,20 |
| `otimista` | 🟢 Otimista | 1,2% | R$ 1,00 |
| `best` | 🌟 Best case | 1,3% | R$ 0,80 |

**Conversão e CPC de cada linha são editáveis** (input inline na célula).

#### 4.3.2 Colunas calculadas (por linha)

| Coluna | Fórmula |
|---|---|
| Visitas | `pedidos / (conv/100)` |
| Ad spend | `visitas × cpc` |
| ROAS resultante | `meta / adSpend` |
| Lucro líquido | `margemTotal - adSpend` |

#### 4.3.3 Status (badge colorido)

| Condição | Status | Cor |
|---|---|---|
| `lucro > margemTotal × 0.30` | "Lucro forte" | Verde |
| `lucro > 0` | "Lucro magro" | Amarelo |
| `lucro > -margemTotal × 0.30` | **"Atenção"** | Laranja |
| Else | "Prejuízo" | Vermelho |

> ⚠️ **Mudança de nomenclatura:** o status que antes seria "Quase BE" agora é **"Atenção"**.

#### 4.3.4 Strip de resumo (rodapé do simulador)

4 KPIs em destaque:
- Margem bruta / produto (com aumento aplicado)
- Margem total disponível
- ROAS break-even
- Conversão mínima necessária pra ROAS 5 (assumindo CPC R$1,20)

### 4.4 Engenharia Reversa — ROAS Necessário

Bloco com 2 colunas: **Inputs (esquerda)** e **Outputs (direita, em card escuro)**.

#### 4.4.1 Inputs

```
💎 Lucro mínimo desejado (R$):   [0]
   "Quanto vc quer que sobre depois de pagar o ad spend.
    Coloque 0 pra calcular só o break-even."

📥 Dados reais sendo usados:
   CPC:        R$ 1,20    ← lido do bloco "Dados reais do período"
   Conversão:  1,0%       ← lido do bloco "Dados reais do período"
   "Pra mudar, edite acima no bloco 'Dados reais'"
```

> **IMPORTANTE:** o CPC e a Conversão **NÃO são duplicados como inputs aqui**. São **lidos do bloco "Dados reais do período"** lá em cima. Isso evita confusão (uma fonte da verdade) e força o usuário a manter os dados reais sempre atualizados em um único lugar.

#### 4.4.2 Outputs (card escuro à direita)

```
Pra meta de R$ 100.000:

  Visitas necessárias:     62.500
  Ad spend total:          R$ 75.000
  CAC efetivo:             R$ 120,00
  
  ┌────────────────────────────────────┐
  │ 📊 ROAS de break-even (empatar)    │
  │ 4,46                                │
  │ "Ad spend = margem total. Lucro 0." │
  └────────────────────────────────────┘
  
  ┌────────────────────────────────────┐  ← destaque com border-left accent
  │ 🎯 ROAS pra seu lucro alvo         │
  │ X,XX                                │
  │ "Pra sobrar R$ Y de lucro líquido" │
  └────────────────────────────────────┘
  
  Status: ✅ Dentro / ⚠️ Atenção / ❌ Inviável
```

#### 4.4.3 Fórmulas

```typescript
const visitas = pedidos / conv;
const adSpend = visitas * cpc;
const cac = adSpend / pedidos;

// 2 ROAS distintos:
const roasBE = meta / margemTotal;                     // empatar (lucro = 0)
const roasAlvo = meta / (margemTotal - lucroMin);     // pra atingir lucro alvo

// Quando lucroMin = 0, roasAlvo === roasBE
```

#### 4.4.4 Lógica de status

```typescript
const adSpendMaxAlvo = margemTotal - lucroMin;

if (adSpendMaxAlvo <= 0) {
  status = '❌ Lucro mínimo > margem total';
} else if (adSpend < adSpendMaxAlvo * 0.7) {
  status = '✅ Dentro do alvo';
} else if (adSpend < adSpendMaxAlvo) {
  status = '⚠️ Atenção (apertado)';
} else {
  status = '❌ Inviável c/ esses números';
}
```

#### 4.4.5 Hint dinâmico do "ROAS pra lucro alvo"

- Se `lucroMin === 0`: mostrar "Igual ao break-even (vc não pediu lucro mínimo)"
- Se `lucroMin > 0`: mostrar `Pra sobrar R$ {lucroMin} de lucro líquido após ad spend`

---

## 5. Schema de Dados (Supabase)

### 5.1 Extensão da tabela existente `amicia_data` (chave `calc-meluni`)

```jsonc
{
  "user_id": "calc-meluni",
  "data": {
    // === Composição da margem (já existe) ===
    "ticket_produto": 120.00,
    "ticket_pedido": 160.00,
    "pecas_pedido": 1.33,
    "cmv": 65.00,
    "frete_subsidiado": 12.00,
    "taxa_gateway_pct": 0.035,
    "imposto_pct": 0.0983,
    "margem_bruta_calculada": 27.00,  // computed, cached

    // === Card v2 (novo) ===
    "roas_atual": 10.0,             // editado pelo usuário
    "fonte_margem": "cadastro",     // 'cadastro' | 'vendas_reais'
    "periodo_vendas_dias": 30,      // 7/15/30/60/90

    // === Tela de análise (novo) ===
    "dados_reais_periodo": {
      "cpc": 1.20,
      "conv": 1.0,                  // %
      "periodo": 30,
      "ticket_real": null,          // null = usa ticket_pedido cadastro
      "pecas_real": null            // null = usa pecas_pedido cadastro
    },

    "simulador": {
      "meta_vendas": 100000,
      "aumento_margem": 0,          // ← renomeado (era "bonus_margem")
      "cenarios": [
        { "id": "pessimista",  "conv": 0.5, "cpc": 1.80 },
        { "id": "conservador", "conv": 0.8, "cpc": 1.50 },
        { "id": "realista",    "conv": 1.0, "cpc": 1.20 },
        { "id": "otimista",    "conv": 1.2, "cpc": 1.00 },
        { "id": "best",        "conv": 1.3, "cpc": 0.80 }
      ]
    },

    "engenharia_reversa": {
      "lucro_min": 0
      // CPC e conv vêm de dados_reais_periodo
    }
  }
}
```

### 5.2 View pra margem ponderada (quando dados de venda chegarem)

```sql
CREATE OR REPLACE VIEW vw_meluni_margem_real AS
SELECT
  date_trunc('day', v.created_at) as dia,
  SUM(v.qtd) as qtd_total,
  SUM(v.qtd * p.margem_bruta) as margem_total,
  SUM(v.qtd * p.margem_bruta) / NULLIF(SUM(v.qtd), 0) as margem_ponderada
FROM meluni_vendas v
JOIN meluni_produtos p ON p.ref = v.ref
WHERE v.created_at >= NOW() - INTERVAL '90 days'
GROUP BY date_trunc('day', v.created_at);
```

(Adaptar nomes reais das tabelas Meluni quando estiverem definidas.)

---

## 6. Wireframe ASCII completo

```
═══════════════════════════════════════════════════════════════════
  CALCULADORA (módulo existente)
═══════════════════════════════════════════════════════════════════

┌─ CARD MELUNI ───────────────┐  ┌─ CARD LUMIA ────────────────┐
│ 💰 Margem por produto       │  │ ...                         │
│  Receita: 120               │  │                             │
│  -CMV: -65                  │  │  (igual hoje, só altera     │
│  -Frete: -12                │  │   o card Meluni nesta       │
│  -Taxa: -4,20               │  │   entrega)                  │
│  -Imposto: -11,80           │  │                             │
│  ─────────────────────      │  │                             │
│  💰 Bruta antes ads: R$ 27  │  └─────────────────────────────┘
│  ROAS real: [10,0]          │
│  -Ads: -12                  │  ┌─ CARD EXITUS ───────────────┐
│  ─────────────────────      │  │ ...                         │
│  🟢 Lucro: R$ 15            │  └─────────────────────────────┘
│  ─────────────────────      │
│  [📊 Analisar cenários →]   │  ┌─ CARD MUNIAM ───────────────┐
└─────────────────────────────┘  │ ...                         │
                                  └─────────────────────────────┘

  [Toggle fonte da margem (cadastro / vendas reais)]


───────────── Ao clicar no botão, abre essa tela ─────────────


═══════════════════════════════════════════════════════════════════
  🎯 ANÁLISE DE CENÁRIOS — MELUNI       [✕ Voltar à calculadora]
═══════════════════════════════════════════════════════════════════

┌─ 📥 DADOS REAIS DO PERÍODO (digite manualmente) ──────────────┐
│                                                                 │
│  CPC: [1,20]    Conversão: [1,0%]    Período: [30 dias ▼]      │
│                                                                 │
│  ▸ Sobrescrever ticket / peças (opcional)                      │
└────────────────────────────────────────────────────────────────┘

┌─ SIMULADOR DE 5 CENÁRIOS ─────────────────────────────────────┐
│                                                                 │
│ Meta: [100.000]   Aumentar margem: [0]   Resumo: 625 pedidos   │
│                                                                 │
│ Cenário        Conv   CPC    Visitas   Spend   ROAS   Lucro   Status   │
│ 🔴 Pessimista [0.5] [1.80] 125.000   R$225k   0.44  -202k  Prejuízo │
│ 🟠 Conservador[0.8] [1.50]  78.125   R$117k   0.85   -94k  Prejuízo │
│ 🟡 Realista   [1.0] [1.20]  62.500   R$ 75k   1.33   -52k  Prejuízo │
│ 🟢 Otimista   [1.2] [1.00]  52.083   R$ 52k   1.92   -30k  Prejuízo │
│ 🌟 Best case  [1.3] [0.80]  48.077   R$ 38k   2.60   -16k  Prejuízo │
│                                                                 │
│ ┌────────────────────────────────────────────────────────────┐ │
│ │ R$27 margem │ R$22.500 total │ 4,46 BE │ 2,1% conv min   │ │
│ └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘

┌─ ENGENHARIA REVERSA — ROAS NECESSÁRIO ────────────────────────┐
│                                                                 │
│  ┌────────────────────┐   ┌────────────────────────────────┐  │
│  │ Lucro min: [0]     │   │ Pra meta R$ 100.000:           │  │
│  │                    │   │  Visitas: 62.500               │  │
│  │ Dados sendo usados:│   │  Ad spend: R$ 75.000           │  │
│  │  CPC: R$ 1,20      │   │  CAC: R$ 120,00                │  │
│  │  Conv: 1,0%        │   │                                 │  │
│  │  (edite em cima)   │   │  ┌──────────────────────────┐  │  │
│  │                    │   │  │ 📊 ROAS break-even: 4,46 │  │  │
│  │                    │   │  └──────────────────────────┘  │  │
│  │                    │   │  ┌──────────────────────────┐  │  │
│  │                    │   │  │ 🎯 ROAS lucro alvo: 4,46 │  │  │
│  │                    │   │  │ (= BE pq lucro min = 0)  │  │  │
│  │                    │   │  └──────────────────────────┘  │  │
│  │                    │   │                                 │  │
│  │                    │   │  Status: ❌ Inviável c/ esses #│  │
│  └────────────────────┘   └────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

---

## 7. Edge Cases

| Cenário | Comportamento |
|---|---|
| ROAS = 0 | Bloquear input (min=1.0) ou mostrar "∞" como ad spend |
| Conversão = 0 | Visitas = ∞, exibir "—" e status vermelho |
| Meta = 0 | Zerar todos cálculos, exibir "Defina uma meta" |
| Aumento margem > margem bruta | Cap automático em margem bruta (não negativar) |
| Vendas reais sem dados | Forçar fonte = cadastro, esconder toggle "vendas reais" |
| Ad spend > margem total | Lucro negativo, badge "Prejuízo" |
| Período sem vendas | Fallback pra período anterior + aviso |
| Lucro mínimo > margem total | Status "❌ Lucro mínimo > margem total" |
| Lucro mínimo = 0 | ROAS alvo = ROAS BE, hint informa |
| `ticket_real` ou `pecas_real` vazios | Cai pro valor do cadastro (fallback) |
| CPC ou Conv não preenchidos no bloco "Dados reais" | Engenharia reversa mostra "—" e status "Preencha CPC e Conversão acima" |

---

## 8. Acceptance Criteria

### Card Meluni v2 (módulo Calculadora)
- [ ] Margem bruta antes do ads aparece em destaque (highlight amarelo, label claro)
- [ ] ROAS é input number editável (1.0 a 20.0, step 0.1)
- [ ] Investimento ads recalcula a cada keystroke
- [ ] Lucro líquido muda de cor: verde > 0, amarelo = 0, vermelho < 0
- [ ] ROAS persiste no Supabase com debounce 500ms
- [ ] Botão "📊 Analisar cenários e ROAS necessário →" no rodapé do card (full-width, primary)
- [ ] Não quebra a calculadora atual em outros cards (Lumia, Exitus, Muniam)

### Toggle fonte da margem
- [ ] Default: cadastro
- [ ] "Vendas reais" desabilitado se base < 100 pedidos (com tooltip explicativo)
- [ ] Período configurável: 7/15/30/60/90 dias
- [ ] Alerta automático se diferença > 15%

### Tela "Análise de Cenários — Meluni"
- [ ] Abre via botão do card Meluni
- [ ] Mobile (<768px): tela cheia (modal full-screen com slide-up)
- [ ] Desktop (≥768px): overlay grande centralizado
- [ ] Botão "✕ Voltar à calculadora" no topo direito

### Bloco "Dados reais do período"
- [ ] Visualmente destacado (background dark/primary)
- [ ] Inputs principais: CPC (R$), Conversão (%), Período (select)
- [ ] Inputs opcionais (collapsible): ticket real, peças real
- [ ] Vazio nos opcionais = usa cadastro (fallback)
- [ ] Persiste em `dados_reais_periodo` com debounce 500ms
- [ ] CPC e Conv são fonte da verdade pra engenharia reversa (sem duplicação)

### Simulador de cenários
- [ ] 5 linhas com defaults conforme tabela 4.3.1
- [ ] Conv. e CPC editáveis inline na tabela
- [ ] Recalcula em tempo real ao editar qualquer input
- [ ] Status badge com 4 estados (forte/magro/**Atenção**/prejuízo)
- [ ] Aumento de margem aplicado uniformemente em todos cenários
- [ ] Strip de resumo com 4 KPIs no rodapé
- [ ] Tooltip no campo "Simular aumento de margem" explicando o uso
- [ ] Estado persiste no Supabase

### Engenharia reversa
- [ ] Único input pelo usuário: lucro mínimo desejado
- [ ] CPC e Conversão lidos do bloco "Dados reais" (NÃO duplicados como inputs)
- [ ] Display "Dados reais sendo usados" mostra os valores atuais
- [ ] Card escuro à direita com 5 outputs:
  - [ ] Visitas necessárias
  - [ ] Ad spend total
  - [ ] CAC efetivo
  - [ ] **ROAS break-even** (sempre calculado)
  - [ ] **ROAS pra lucro alvo** (depende do lucro mínimo)
- [ ] Hint dinâmico no ROAS alvo
- [ ] Status em 4 níveis (dentro / atenção / inviável / lucro mín > margem)

### Geral
- [ ] Mobile-first (Ailson usa iPhone)
- [ ] Mantém paleta atual (#2c3e50, #4a7fa5, #f7f4f0, #e8e2da)
- [ ] Mantém tipografia Georgia serif
- [ ] Funcionar offline (estado local) e sincronizar quando online
- [ ] Padrão escalável pra replicar em Lumia/Exitus/Muniam depois

---

## 9. Roadmap pós-implementação

| Onda | Feature | Quando |
|---|---|---|
| **1 (esta entrega)** | Card Meluni v2 + Toggle fonte + Tela de análise (Dados reais + Simulador + Eng. reversa) | Agora |
| 2 | Conector **Meta Marketing API** — auto-popular CPC e Conversão (substitui digitação manual) | Após validação Onda 1 |
| 3 | Card "Health do Pixel" (compara Meta vs backend) | Junto com Onda 2 |
| 4 | Replicar simulador para Lumia/Exitus/Muniam (B2B marketplace) | Após validação Meluni |
| 5 | Histórico de cenários salvos (snapshots semanais) | Backlog |
| 6 | Conector Google Analytics 4 (puxar conversão real auto) | Backlog |

---

## 10. PROMPT PRONTO PRA COLAR (outra sessão)

> Cole o bloco abaixo no início do próximo chat de implementação. Anexe também este `.md` e o `preview-calculadora-meluni.html`.

---

```
Contexto: Estou no projeto App Financeiro Amícia (AilsonMoreira-creator/APP-financeiro,
deploy app-financeiro-brown.vercel.app). Stack: React + Vite + TypeScript +
Supabase + Vercel. App.tsx é monolítico (~7580 linhas). Paleta: #2c3e50 (primary),
#4a7fa5 (secondary), #f7f4f0 (bg), #e8e2da (border). Fonte: Georgia serif.

Tarefa: Implementar a versão 2 da calculadora do card Meluni + uma nova tela
de análise de cenários acessada por botão.

ENTREGA EM 3 BLOCOS:

BLOCO 1 — Card Meluni v2 (dentro do módulo Calculadora atual):
  - Reestruturar a "última linha": separar margem bruta antes do ads do lucro
    líquido. ROAS vira input editável (number, 1.0-20.0, step 0.1, default 10.0,
    persiste no Supabase com debounce 500ms na chave 'calc-meluni').
  - Toggle "fonte da margem": cadastro (média simples) vs vendas reais
    (média ponderada por volume, últimos N dias, configurável 7/15/30/60/90).
    Alerta automático se diferença > 15%. Default: cadastro.
  - Adicionar botão "📊 Analisar cenários e ROAS necessário →" no RODAPÉ do card,
    full-width, primary.

BLOCO 2 — Nova tela "Análise de Cenários — Meluni" (abre via botão do Bloco 1):
  - Mobile: full-screen modal com slide-up. Desktop: overlay grande centralizado.
  - Botão "✕ Voltar à calculadora" no topo direito.

  Sub-bloco 2A — "Dados reais do período" (TOPO da tela, destaque visual com
  background dark/primary):
    - Inputs principais: CPC médio (R$), Conversão site (%), Período (select 7/30/60/90)
    - Opcionais (collapsible): ticket real, peças real (vazio = usa cadastro)
    - Persiste em dados_reais_periodo com debounce 500ms

  Sub-bloco 2B — Simulador de 5 cenários:
    - Inputs: meta de vendas (R$), simular aumento de margem (R$/produto, com
      tooltip explicando o uso "ex: subir preço, reduzir CMV")
    - 5 linhas nomeadas: Pessimista (0.5%/R$1.80), Conservador (0.8%/R$1.50),
      Realista (1.0%/R$1.20), Otimista (1.2%/R$1.00), Best case (1.3%/R$0.80)
    - Conv e CPC editáveis inline em cada linha
    - Calcula: visitas, ad spend, ROAS resultante, lucro líquido, status badge
    - Status: "Lucro forte" (verde), "Lucro magro" (amarelo), "Atenção" (laranja),
      "Prejuízo" (vermelho). NOTA: o status laranja chama-se "Atenção", não "Quase BE".
    - Strip de 4 KPIs no rodapé

  Sub-bloco 2C — Engenharia reversa:
    - ÚNICO input: Lucro mínimo desejado (R$)
    - CPC e Conversão NÃO são duplicados aqui — são lidos do Sub-bloco 2A
    - Mostrar visualmente "Dados reais sendo usados: CPC R$X, Conv Y%" pra deixar claro
    - Outputs: visitas, ad spend, CAC, e DOIS ROAS lado a lado:
      * ROAS de break-even (fixo, lucro = 0)
      * ROAS pra lucro alvo (depende do lucro mínimo digitado)
    - Quando lucro mínimo = 0, os 2 ROAS são iguais e hint informa
    - Status em 4 níveis: ✅ dentro do alvo / ⚠️ atenção (apertado) / ❌ inviável /
      ❌ lucro mín > margem total

CONSTRAINTS:
  - NÃO mexer em outros cards da calculadora (Lumia, Exitus, Muniam)
  - NÃO integrar com Meta API nesta entrega (fica pra Fase 2 — usuário digita
    CPC e Conv manualmente)
  - Mobile-first (usuário usa iPhone)
  - Manter padrão de design existente (paleta + Georgia)
  - Persistência via Supabase user_id='calc-meluni'
  - Mudanças cirúrgicas: criar componentes novos, não refatorar código existente
  - Validar visualmente cada sub-bloco antes de seguir pra próximo
  - Edge cases tratados (ver seção 7 do .md anexado)

ARQUIVOS ANEXOS:
  - handoff-implementacao.md (este documento — regras completas, schema, fórmulas,
    acceptance criteria, wireframes)
  - preview-calculadora-meluni.html (mockup funcional — abre no browser, todos
    cálculos funcionando, paleta aplicada, simula a interação completa)

POR FAVOR:
  1. Confirme que leu os 2 arquivos
  2. Me proponha a ordem de implementação (sugiro: Bloco 1 → Sub-bloco 2A →
     Sub-bloco 2B → Sub-bloco 2C)
  3. Me peça o código atual do card Meluni em App.tsx pra eu colar
  4. Implemente uma feature por vez, validando comigo antes de seguir

OBSERVAÇÃO IMPORTANTE: o pixel da Meluni tem problemas conhecidos (auditoria
Convertr mostrou Meta reportando compras que o backend não confirma). Por isso
nesta entrega os dados de CPC e Conversão são DIGITADOS MANUALMENTE pelo usuário
— ele puxa do Meta Ads Manager e GA4. A integração API fica pra Fase 2 do
roadmap, depois que o pixel for arrumado.
```

---

**Fim do documento.** Qualquer dúvida ou ajuste na lógica antes da implementação, voltar pro chat de design original.
