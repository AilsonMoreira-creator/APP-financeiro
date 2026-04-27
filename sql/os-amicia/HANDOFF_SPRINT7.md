# 🚀 HANDOFF — Sprint 7 (Responsividade Mobile)

> **Sobre a numeração:** A ordem cronológica é estranha porque pulamos do **Sprint 6.8** (fechado em 24/04) direto pro **Sprint 8 — IA Pergunta** (que terminou em 26/04). O **Sprint 7 está sendo retomado agora**, depois do Sprint 8. Não é erro: é só o que ficou pra trás na fila e voltamos a ele.

---

## 📖 Leituras obrigatórias antes de começar

A próxima sessão precisa abrir esses arquivos antes de tocar em qualquer linha de código:

1. **`docs/TABELAS_E_VIEWS.md`** — referência completa das 50+ tabelas/views do Supabase, organizada por domínio. Sempre que precisar saber "onde mora X", checa aqui primeiro antes de gastar tokens grepando o código.
2. **`sql/os-amicia/HANDOFF_SPRINT_6_8_FINAL.md`** — último handoff antes desse, contém o estado da OS Amícia (cortes, oficinas, IA insights).
3. **`sql/os-amicia/HANDOFF_REGRAS_SUGESTAO_CORTE.md`** — regras vivas das sugestões da IA, atualizadas até 25/04.
4. **Memórias do Claude** (já carregadas automaticamente) — tem todo o contexto de:
   - Fluxo da confecção: Tecido → Enfesto → Corte (inclui ordens_corte + Salas Antonio/Adalecio/Chico) → Oficina (costureira externa, etapa final)
   - Regra REF com/sem zero à esquerda
   - Padrão de detecção mobile já existente
   - Decisões de design (paleta, tipografia, regras de UI)

**NÃO precisa reler:** esse handoff resume o que importa pra começar.

---

## 🎯 Missão do Sprint 7

Tornar **4 telas responsivas no iPhone**, sem mexer em nada do desktop. Ordem de prioridade (definida pelo Ailson):

1. **Dashboard** ← começar aqui
2. **Lançamentos** (e mudar a aba default pra **Receitas** quando for celular)
3. **Calculadora**
4. **Bling**

### Problema relatado

> "Cards empilham errado ou ficam cortados" no iPhone.

### Restrição inviolável

> **Sem mexer em nada do que existe e está funcionando no desktop.** Se tocar lógica desktop, breakou regra. Toda mudança fica condicionada a `mobile === true`.

---

## 🛠️ Padrão técnico já validado

Existe um detector mobile funcionando em `src/App.tsx` linha 5388 (componente `SalasCorteContent`):

```jsx
const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 900);
useEffect(() => {
  const h = () => setW(window.innerWidth);
  window.addEventListener("resize", h);
  return () => window.removeEventListener("resize", h);
}, []);
const mobile = w < 640;
```

**Reusar exatamente esse padrão** nos 4 componentes-alvo. Aí condicionar todas as mudanças com:

```jsx
{mobile ? <CardMobile/> : <CardDesktop/>}
// ou
style={{ gridTemplateColumns: mobile ? '1fr' : '1fr 1fr 1fr' }}
```

### Mudança específica em Lançamentos

Trocar aba default pra Receitas no celular:

```jsx
const [aba, setAba] = useState(mobile ? 'receitas' : '<aba_atual_default>');
```

Mas precisa **olhar o estado atual antes de mexer** — pode ser que a aba default seja calculada de outro jeito.

---

## 📍 Localização dos componentes-alvo em `src/App.tsx`

| Componente            | Linha   | Tamanho           | Comentário |
|----------------------|---------|--------------------|------------|
| `DashboardContent`   | 1760    | ~225 linhas        | Pequeno, ataque rápido |
| `LancamentosContent` | 1985    | ~2529 linhas       | Maior — ir com calma |
| `BlingContent`       | 4514    | ~1708 linhas       | |
| `CalculadoraContent` | 6222    | ~1051 linhas       | |

---

## ⚠️ Antes de codar — pedir screenshot

Pra Sprint 7 começar com pé direito, **a próxima sessão precisa pedir screenshot do iPhone do Dashboard primeiro**. Sem screenshot:

- Não dá pra saber quais cards quebram (são vários no Dashboard)
- Não dá pra saber se é largura, altura ou ordem
- Risco de ajustar o que não tá quebrado e deixar o que tá

Sequência ideal:
1. Pedir screenshot do Dashboard como tá hoje no iPhone
2. Inspecionar `DashboardContent` (App.tsx:1760)
3. Identificar exatamente quais cards estão quebrando
4. **Mostrar preview HTML antes de commitar** (Ailson prefere ver antes)
5. Aprovado → commit, passa pro próximo módulo
6. Repetir pra Lançamentos / Calculadora / Bling

---

## 📦 Estado atual do repositório

- **Repo:** `AilsonMoreira-creator/APP-financeiro`
- **Branch ativa:** `sprint-8-ia-pergunta` (push direto pra `main`)
- **Último commit:** `0afcab5` — `docs: cria referencia completa de tabelas/views/storage`
- **Penúltimo:** `7342227` — `feat(sac): substitui emojis Templates/Lock/AvatarLoja`
- **Deploy:** `app-financeiro-brown.vercel.app` (build ~1 min)
- **Working dir local:** `/home/claude/repo` (filesystem reseta entre chats — sempre clonar)
- **Token git:** Ailson cola no início de cada chat novo. Se ele esquecer e Claude precisar pushar, pedir gentilmente: "preciso do token git pra fazer push, pode colar?"

---

## 🔑 Lembretes do estilo de trabalho do Ailson

- PT-BR sempre
- Mensagens curtas. Aprova rápido com 👍 quando vê preview bom
- **Restrição inviolável:** "sem mexer em nada que existe e está funcionando"
- Quando bug aparece, antes de codar pedir output específico (screenshot, SELECT) pra diagnóstico preciso
- Build Vercel ~1 min. PWA iPhone tem cache agressivo — Cmd+Shift+R no Mac, ou apagar dados do site no iOS depois do deploy
- Trabalho é iterativo: 1 módulo de cada vez, com preview antes de cada commit

---

## 📋 Critério de fechamento do Sprint 7

Sprint 7 fecha quando:

- [ ] Dashboard responsivo no iPhone (cards não empilham errado)
- [ ] Lançamentos responsivo no iPhone + aba default = Receitas no celular
- [ ] Calculadora responsiva no iPhone
- [ ] Bling responsivo no iPhone
- [ ] Desktop **idêntico** ao que estava antes (validado por screenshot side-by-side)
- [ ] Cada módulo testado pelo Ailson no iPhone real após deploy

---

## 🔮 Sprints futuros provisionados

Depois do Sprint 7 (responsividade), os candidatos pra Sprint 9+ são:

- Integração Convertr (NF-e XML → API endpoint)
- Separar `boletosShared` em payload próprio (multi-user save de financeiro)
- Recriar criativos Meta Ads pra coleção inverno (após análise março fechada)
- Reabilitar Miré MySQL com bancos múltiplos por loja
- Shopee API "Vá ao vivo" (aguardando aprovação)

Mas isso fica pra decidir após Sprint 7 fechado.
