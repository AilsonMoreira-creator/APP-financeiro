# ⚠️ ESPELHOS — LEIA ANTES DE MEXER NESTES MÓDULOS

> Aviso interno pra qualquer sessão futura (outro chat, outro dia).
> Ailson, 18/09/2026.

## Por que existem

O app guarda quase tudo num payload único (`amicia_data`), salvo **inteiro** por
cada aparelho. Um aparelho com a tela aberta há mais tempo salva a versão dele por
cima e leva junto o que foi cadastrado em outro lugar. Já aconteceu de verdade:

- cortes sumindo no módulo Oficinas (resolvido com o espelho relacional);
- cores de realce dos tecidos escolhidas no celular em 17/09, perdidas no dia
  seguinte;
- lançamentos de despesa — a razão do espelho de Despesas.

## Regra de ouro

**Mexeu num módulo espelhado? Atualize o espelho junto.** Campo novo no cadastro,
mudança de formato, nova forma de excluir — tudo isso tem que refletir no espelho,
senão ele restaura dado velho ou deixa de proteger o campo novo.

## O que está espelhado hoje

| Módulo / tela | Tabela | Comportamento | Arquivo |
|---|---|---|---|
| Oficinas · cortes | `oficinas_cortes_espelho` | restaura | (no App.tsx) |
| Oficinas · Cadastros › Produtos | `cadastro_produtos_espelho` | restaura | `src/espelhoCadastros.js` |
| Oficinas · Cadastros › Tecidos (inclui a **cor** de realce) | `cadastro_tecidos_espelho` | restaura | `src/espelhoCadastros.js` |
| Oficinas · Cadastros › Oficinas | `cadastro_oficinas_espelho` | restaura | `src/espelhoCadastros.js` |
| Calculadora · cards por REF | `calculadora_cards_espelho` | restaura | `src/espelhoCadastros.js` |
| Agenda · lista de compromissos | `agenda_itens_espelho` | restaura (**sem** o campo `feito`) | `src/espelhoCadastros.js` |
| Lançamentos · células de Despesas | `financeiro_despesas_espelho` | **só avisa** (⚠ com a diferença) | `src/espelhoDespesas.js` |

## Princípios (valem pra todos)

1. **Tabela relacional, fora do payload.** Nunca guardar espelho dentro do
   `amicia_data` — é justamente o que se perde.
2. **O espelho não some por ausência na tela.** Sumiu do payload = suspeita de
   perda, não de exclusão. Só apaga com **lápide explícita** (`excluido_em`,
   gravada por `marcarExcluido`), que vem de um clique de excluir do usuário.
3. **Sem policy de DELETE** nas tabelas de espelho, de propósito.
4. **Comparação por carimbo, não só por valor** — evita falso positivo e evita
   desfazer edição legítima.
5. **Best-effort:** falha no espelho é silenciosa e nunca trava a tela.
6. **RLS ligado**, com as policies da chave anônima criadas junto (as telas leem e
   gravam direto via `supabase.from(...)`).

## Ao adicionar um campo num módulo espelhado

- `src/espelhoCadastros.js` → função `linhaDe()`: inclua o campo novo.
- Migração: coluna nova na tabela do espelho (ou deixe cair no `dados` jsonb, que
  guarda o registro inteiro).
- Se o campo puder ser legitimamente vazio, cuidado com a restauração: ela
  preenche campo vazio a partir do espelho.

## Ao criar um espelho novo

Siga `src/espelhoCadastros.js`. Decida antes: **restaurar** (cadastro pequeno,
muda pouco) ou **só avisar** (dado financeiro, onde o usuário quer decidir).
