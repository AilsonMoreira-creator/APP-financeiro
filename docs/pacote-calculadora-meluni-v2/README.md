# 📊 Pacote Calculadora Meluni v2 · Documentação Base

Esta pasta contém a especificação de design e o preview interativo da
**versão 2 da calculadora Meluni** + nova tela "Análise de Cenários — Meluni".

Foi gerado em sessão de design colaborativo com o Ailson em 09/05/2026,
para implementação posterior em outra sessão.

> **Nota:** o módulo Calculadora é antigo e estável. Esta v2 só altera o
> card Meluni (sem mexer em Lumia / Exitus / Muniam) e adiciona a nova
> tela de análise como overlay/modal acessada por botão.

---

## Arquivos e quando usar cada um

| Arquivo | O que é | Quando abrir |
|---|---|---|
| `01_HANDOFF_Calculadora_Meluni_v2.md` | Especificação técnica completa: regras de negócio, schema Supabase, fórmulas, edge cases, wireframes ASCII, acceptance criteria e prompt pronto pra colar em chat de implementação. | Sempre — é a "bíblia" da feature |
| `02_Preview_Calculadora_Meluni_v2.html` | Preview visual e funcional (todos cálculos rodando) da nova estrutura. Aplica a paleta do app (#2c3e50, #4a7fa5, #f7f4f0, #e8e2da) e tipografia Georgia. | Antes de implementar — pra alinhar visual e UX |

## Como abrir o HTML

Basta abrir `02_Preview_Calculadora_Meluni_v2.html` em qualquer browser
moderno. O preview é totalmente standalone (sem dependências externas) e
permite editar todos os inputs em tempo real para testar cenários.

## Escopo da entrega (3 blocos)

1. **Card Meluni v2** (dentro do módulo Calculadora atual)
   - Separa margem bruta antes do ads do lucro líquido
   - ROAS vira input editável
   - Botão "📊 Analisar cenários" no rodapé
   - Toggle "fonte da margem" (cadastro vs vendas reais)

2. **Tela "Análise de Cenários — Meluni"** (nova, abre via botão)
   - Bloco "Dados reais do período" (CPC + Conversão manuais)
   - Simulador de 5 cenários (Pessimista → Best case)
   - Engenharia reversa com 2 ROAS (break-even + lucro alvo)

3. **NÃO incluído nesta entrega:** integração com Meta Marketing API.
   Os dados de CPC e Conversão são digitados manualmente. A integração
   API fica pra Fase 2 do roadmap (depois que o pixel for arrumado —
   ver auditoria Convertr).

## Roadmap pós-implementação

| Onda | Feature |
|---|---|
| **1** (esta entrega) | Card Meluni v2 + Tela de Análise (manual) |
| 2 | Conector Meta Marketing API (auto-popular CPC e Conversão) |
| 3 | Card "Health do Pixel" (compara Meta vs backend) |
| 4 | Replicar simulador para Lumia/Exitus/Muniam |
| 5 | Histórico de cenários salvos (snapshots semanais) |
| 6 | Conector Google Analytics 4 |

---

**Branch sugerida para implementação:** `feature/calculadora-meluni-v2`
