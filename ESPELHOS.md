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


---

## SOMBRAS POR DOMÍNIO (19/09/2026) — migração do `amicia_data`

Diferente dos espelhos acima (que protegem contra PERDA), as sombras existem pra
**tirar os dados do monólito aberto `amicia_data`** sem "dia D". Enquanto o app
ainda grava em `amicia_data`, um gatilho no banco (`trg_amicia_data_sombra`)
copia cada gravação pra tabela do domínio certo, já com metadados de
sincronização. Todas FECHADAS (RLS sem policy): só a chave de serviço lê.

| Domínio | Tabela | Vem de (amicia_data.user_id → chave) |
|---|---|---|
| Financeiro | `financeiro_sombra` | amicia-admin → receitasPorMes, auxDataPorMes, categoriasPorMes, boletosShared, fixosConfig, fixosNomesFunc, prestadores; despesas-config.* |
| Oficinas | `oficinas_sombra` | amicia-admin → produtos, produtosExcluidos, oficinasCAD, tecidosCAD, logTroca; ailson_cortes.*; passadoria-config.*; caseado-config.*; cortes-cores-manuais.* |
| Sala de corte | `salas_corte_sombra` | salas-corte.* |
| Calculadora | `calculadora_sombra` | calc-meluni.* |
| Folha | `folha_sombra` | folha-pagamento.* |
| Ficha técnica | `ficha_tecnica_sombra` | ficha-tecnica.* |
| Config pequena | `app_config_sombra` | agenda.*, wms-config.*, ml-perguntas-config.*, bling-estoque-config.*, bling-estoque-arquivadas.* |

Esquema igual em todas: `chave` (pk), `valor` jsonb, `origem_user_id`,
`origem_atualizado` (payload._updated), `hash` (md5), `versao`, `atualizado_em`.
Rota `*` prefixa a chave com a origem (`passadoria-config.nomes`) pra não colidir.
Cada mudança de hash gera linha em `sombra_historico` (histórico completo).
Rotas em `sombra_rotas` — pra roteirar chave nova, é só inserir uma linha.

**Plano de virada (uma área por vez, com flag e reversão):**
1. leitura pela API do domínio (`/api/financeiro`, `/api/sala-corte`…) lendo a sombra,
   conferida contra `amicia_data` pelo hash;
2. escrita pelo servidor (dual-write), sombra vira a fonte;
3. só depois: fechar `amicia_data` pra chave anônima e apagar a chave migrada.

Já migrados pra tabela própria e fechada: `bling_credenciais`, `ga4_tokens`,
`app_usuarios` (hash das senhas). `qz-sign-key` fica em amicia_data por decisão dele.
