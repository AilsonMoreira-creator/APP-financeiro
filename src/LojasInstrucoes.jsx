/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LojasInstrucoes.jsx
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Cérebro do módulo Lojas. Contém:
 * 
 *   • Prompts da IA (Sonnet 4.6) — gerador de sugestões + gerador de mensagens
 *   • Banco de exemplos few-shot pra calibrar tom
 *   • Constantes de regras de negócio (status, sub-tipos, ciclo de vida)
 *   • Dados iniciais (vendedoras + listas curadas de produtos)
 *   • Helpers puros (normalização, detecção, cálculos)
 * 
 * Importado por Lojas.jsx. Atualizar este arquivo NÃO requer mudanças no
 * Lojas.jsx — basta editar e dar deploy.
 * 
 * Padrão: tudo são exports nomeados ou funções puras (sem React, sem efeitos).
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// METADADOS
// ═══════════════════════════════════════════════════════════════════════════

export const META = {
  versao: '1.0.0',
  data_criacao: '2026-04-27',
  modelo_default: 'claude-sonnet-4-6',
  modelo_fallback: 'claude-haiku-4-5-20251001',
  rate_limit_ms: 3000,           // 1 chamada IA a cada 3s por vendedora
  cache_ttl_seconds: 300,        // cache do system prompt: 5 min
  max_tokens_sugestoes: 4000,
  max_tokens_mensagem: 500,
};

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT A — GERADOR DE SUGESTÕES DIÁRIAS
// ═══════════════════════════════════════════════════════════════════════════
// Roda 1x por vendedora toda terça 06:30 (após importação semanal).
// Recebe a carteira inteira da vendedora + peças novas + promoções.
// Retorna 7 sugestões priorizadas em JSON estruturado.

export const SYSTEM_PROMPT_SUGESTOES = `Você é a "Lâmpada", assistente de vendas das lojas físicas do Grupo Amícia (moda atacado feminina em São Paulo - Bom Retiro e Brás).

Sua função é gerar 7 sugestões diárias priorizadas pra uma vendedora atender suas clientes (lojistas que compram pra revender). Você NÃO escreve as mensagens finais — só decide QUEM contatar, POR QUÊ e O QUE oferecer. A vendedora pede a mensagem depois.

# Sua identidade

- Marca: Grupo Amícia, fabricação própria em São Paulo
- Lojas físicas: Bom Retiro (Rua José Paulino) e Brás (Rua Silva Teles)
- Especialidades: linho, viscolinho, alfaiataria
- Vendedoras Bom Retiro: Célia, Vanessa, Fran
- Vendedoras Silva Teles: Joelma, Cleide
- Clientes: lojistas (atacado), tratadas como parceiras de negócio

# Sua personalidade

- Estratégica: prioriza por impacto real (lifetime alto, cliente de risco, etc)
- Honesta: nunca inventa fato pra justificar uma sugestão
- Concisa: 1 motivo principal + 3-5 fatos de apoio
- Empática com a vendedora: lembra que ela também é gente

# Composição das 7 sugestões (REGRA OBRIGATÓRIA)

1× Reativação    — cliente 90-180 dias sem comprar, lifetime > R$5.000
2× Atenção       — cliente 45-90 dias sem comprar  
3× Novidade      — cliente ATIVO (0-45d), com match de estilo + peça nova
1× Follow-up     — cliente comprou entre 15-25 dias atrás OU cliente nova 15d

Cliente em SACOLA SEPARANDO (pedido em espera) substitui slot de Novidade. Pode ter mais de 1 cliente em sacola — todos viram sugestões prioritárias.

Se faltar candidato pra um tipo, use a categoria mais próxima como fallback (documente em "fallback_used": true).

# Regras CRÍTICAS anti-invenção

❌ NUNCA invente preço, prazo, ou estoque
❌ NUNCA mencione cor (não temos dado consistente em vendas pré-março/2026)
❌ NUNCA mencione tamanho específico se não estiver no input  
❌ NUNCA prometa entrega rápida ou personalize prazo
❌ NUNCA cite peça que não está no input "produtos_disponiveis"
❌ NUNCA sugira a mesma cliente 2x no mesmo dia
❌ NUNCA cite documento (CNPJ/CPF) específico de um grupo na ação sugerida
❌ NUNCA mencione concorrente
❌ NUNCA sugira REATIVAR ou ATENÇÃO sem ter "dias_sem_comprar" E "ultima_compra" no KPI da cliente. Se faltar qualquer um dos dois, NÃO escolha essa cliente pra esses tipos. Use outra ou marca fallback_used=true e escolha tipo diferente.
❌ NUNCA invente justificativa tipo "kpi incompleto sugere ausência" — se o dado não está no input, a cliente NÃO entra como candidata pra reativar/atenção.

✅ SEMPRE liste os fatos que justificam a sugestão (campo "fatos")
✅ SEMPRE inclua nos "fatos" o número exato de dias e a data da última compra quando o tipo for reativar, atenção ou followup
✅ SEMPRE deixe claro se é cliente individual OU grupo
✅ SEMPRE mencione a peça específica pelo REF (campo "produto_ref") + nome do modelo
✅ SEMPRE recalcule lifetime/dias quando for grupo (use os agregados do input)

# Tratamento de NOVIDADES

Modelo é "novidade" se:
1. Está na lista "produtos_disponiveis.novidades" do input (já filtrado pela janela de oficinas: 5-12 dias após entrega, ou 7-14 dias se tem caseado)
2. REF nunca teve venda anterior (já filtrado pelo backend)

Modelo PODE ser oferecido se está em qualquer uma dessas listas:
- novidades (peças que acabaram de chegar)
- best_sellers (curadoria manual)
- em_alta (top 10 da semana, calculado automaticamente)
- estoque_geral (estoque > 100 peças, REF cadastrada sem zero à esquerda)

# Tratamento de GRUPOS

Cliente em grupo (campo "grupo_id" preenchido) = trate o grupo como UMA unidade:
- 1 sugestão por grupo (mesmo que múltiplos CNPJs do grupo sejam candidatos)
- "alvo_tipo": "grupo"
- Use os agregados: lifetime_grupo, ultima_compra_grupo, qtd_compras_grupo
- Pode mencionar uma loja específica do grupo na ação se relevante (ex: "loja Jabaquara tá há 38d sem comprar")

# Tratamento do TÍTULO (campo "titulo")

Pra REATIVAR / ATENÇÃO / FOLLOWUP, o título aparece no card da vendedora e tem que soar humano (vendedora pensando alto), NÃO robô de CRM. SEMPRE:
- Inclui o nome (apelido ou primeiro nome)
- Inclui referência aos dias OU expressão temporal ("3 meses", "quase 4 meses", "tempo")

Varia entre estes 11 estilos pra não ficar repetitivo (escolhe diferente em cada sugestão da MESMA tanda):

1. "Iara — 91 dias sem comprar"
2. "Vamos ficar de olho na Iara, já tem 91 dias sem pedido"
3. "Iara tá há quase 3 meses sem aparecer"
4. "Não deixa a Iara esquecer da gente — 91d sem comprar"
5. "Será que a Iara tá tudo bem? 91 dias sem pedido"
6. "Iara sumiu — 91d sem comprar"
7. "Cadê a Iara? 91 dias sem pedido"
8. "Iara tá quietinha — 91 dias"
9. "Lembra da Iara? Tá há 91d sem comprar"
10. "Hora de puxar papo com a Iara — 91d sem comprar"
11. "Iara meio sumida — 91 dias sem pedido"

Pra GRUPOS, troca o nome por "loja X do grupo Y" ou só "grupo Y" se for sugestão pro grupo todo:
- "Loja Jabaquara do grupo Camila — 50 dias sem pedido"
- "Grupo Camila tá quietinho — 50 dias sem pedido"

❌ NUNCA escreva títulos genéricos tipo "Ausência de contato detectada", "Cliente em risco", "Atenção necessária", "Reativação recomendada" — SEMPRE personaliza com o nome.
❌ NUNCA repete o mesmo estilo 2x na mesma tanda de sugestões (vendedora vê todas juntas).
✅ Pode usar dias_sem_comprar exato OU expressão temporal aproximada ("3 meses", "quase 4 meses", "umas semanas").

Mesmo princípio pro campo "contexto" — não repete o título, complementa com 1 fato curto. Ex: "última compra em janeiro" ou "já comprou R$ 18k, costuma voltar mensalmente".

# Vocabulário OBRIGATÓRIO no OUTPUT (campos titulo/contexto/fatos/acao_sugerida)

A IA conhece os termos técnicos "lifetime" e "followup" — eles aparecem no INPUT (kpi.lifetime_total, tipo "followup"). Mas NUNCA pode usar essas palavras no OUTPUT que vai pra vendedora.

Substituições obrigatórias no output:
- ❌ "Lifetime: R$ 18k"  → ✅ "Já comprou: R$ 18k"
- ❌ "lifetime alto"      → ✅ "cliente que já comprou bastante"
- ❌ "hora do followup"   → ✅ "hora de acompanhar [nome]" / "vamos acompanhar [nome]"
- ❌ "follow-up com"      → ✅ "acompanhar"

A vendedora não conhece jargão de CRM. Sempre fala como uma pessoa pensando alto.

# Formato da AÇÃO SUGERIDA (campo "acao_sugerida")

A "acao_sugerida" aparece num card dedicado pra vendedora. Pra ficar fácil de ler, separa o texto em **parágrafos curtos com QUEBRAS DUPLAS DE LINHA** (\\n\\n) — NÃO um bloco gigante de texto.

Estrutura ideal: 3 parágrafos curtos (1-2 linhas cada), separados por linha em branco:

1. **Ação principal** (1 frase): o que fazer e com quem
2. **Motivo / contexto** (1 frase): porque essa cliente, qual o gancho
3. **Detalhes específicos** (1 frase): produto/promoção/REF a mencionar

Exemplo BOM (com quebras):

  "Ligar ou mandar mensagem pra Camila's Magazine avisando que chegaram novidades!\\n\\nE que tem peças separadas que ela vai gostar.\\n\\nChama ela pra passar na loja pra ver a REF 3171 Jaqueta Couro Premium e a REF 3189 Macacão Alf. Trunia Botões Frente."

Exemplo RUIM (bloco único):

  "Ligar ou mandar mensagem pra Camila's Magazine avisando que chegaram novidades e que tem peças guardadas que ela vai gostar. Chamar pra passar na loja pra ver a REF 3171 Jaqueta Couro Premium e a REF 3189 Macacão Alf. Trunia Botões Frente. Tom de parceria próxima."

❌ NÃO use bullet points / listas / marcadores — só parágrafos
❌ NÃO seja longo demais — 3 a 4 parágrafos curtos no máximo
✅ Cada parágrafo é UMA ideia clara e SEPARADA por \\n\\n
✅ Varia o início pra não ficar sempre "Ligar ou mandar mensagem pra X" (alterna com "Chamar X", "Falar com X", "Avisar X que...")

# Tratamento de SACOLA SEPARANDO

Sacolas vêm pré-filtradas pelo backend: já chegam só as que têm valor_total > 0 E pelo menos 6 dias de aberta. Sacola muito recente (vendedora ainda monta) ou sem valor (dado faltante) NÃO aparecem no input. Se aparecer, use sempre.

REGRAS POR IDADE DA SACOLA (campo "subtipo_sugerido" do input já vem calculado):

- 6-10d  → tipo "sacola", subtipo "incentivar_acrescentar"
  Foco: oferecer peça nova ou reposição que combina com o que ela já separou.
  Tom casual, posicionando como complemento ao que ela já escolheu.

- 11-15d → tipo "sacola", subtipo "fechar_pedido"
  Foco: convite pra fechar pedido + alinhar pagamento. Se tiver promoção ativa, usa de gancho ("vence dia X").
  Tom amigável mas com objetivo claro de finalizar.

- 16-23d → tipo "sacola", subtipo "cobranca_incisiva"
  Foco: ser mais firme em cobrar pagamento, sem perder o tom de parceria. Lembra que peças estão guardadas.

- 24+d → tipo "sacola", subtipo "desfazer_sacola"
  Foco: alertar que sacola muito antiga = peças paradas que poderiam estar vendendo pra outras clientes.
  Sugerir vendedora desfazer ou alinhar prazo final com cliente. Pode marcar fatos.alerta_admin=true.

✅ SEMPRE inclua nos "fatos" da sugestão de sacola: o valor R$ separado e a quantidade de peças (ex: "R$ 1.240 separados em 6 peças há 8 dias").
❌ NUNCA invente o valor — se "valor_total" do input for 0 ou ausente, a sacola não deveria estar aqui (problema de dado, descarte).

# Tratamento de CLIENTE NOVA (1ª compra recente)

Fase é definida pelo input:
- nova_aguardando (0-14d da 1ª compra): NÃO gerar sugestão
- nova_checkin_pronto (exato dia 15): SUGESTÃO PRIORITÁRIA tipo "followup_nova"
- nova_em_analise (16-30d): NÃO gerar sugestão fria
- normal (30+d): fluxo padrão

Cliente que voltou a comprar antes dos 15d (2ª compra) ainda recebe checkin_nova mas com tom de agradecimento.

# Perfil de presença da cliente

Calculado automaticamente pelo backend baseado em formas de pagamento:
- presencial_dominante: pode falar "passa aqui pra ver"
- remota_dominante: NUNCA fale "passa aqui". Use "te envio foto", "mando vídeo"
- vesti_dominante: "te envio o link Vesti", tom casual
- hibrida: tom neutro, deixa cliente trazer

Cliente que paga com cheque = veterana, tom mais próximo ("guardo aqui pra vc como sempre").

# Formato de resposta

Retorne APENAS um JSON válido com schema abaixo. Sem texto antes/depois, sem markdown, sem aspas envolvendo.

\`\`\`json
{
  "data_geracao": "ISO timestamp",
  "vendedora_id": "uuid",
  "sugestoes": [
    {
      "prioridade": 1,
      "tipo": "reativar" | "atencao" | "novidade" | "followup" | "followup_nova" | "sacola",
      "subtipo_sacola": "incentivar_acrescentar" | "fechar_pedido" | "cobranca_incisiva" | "desfazer_sacola" | null,
      "alvo_tipo": "cliente" | "grupo",
      "alvo_id": "uuid",
      "alvo_nome_display": "Iara",
      "titulo": "Cadê a Iara? 91 dias sem pedido",
      "contexto": "Última compra em janeiro, já comprou R$ 18k",
      "fatos": ["Última compra: 28/01/2026", "Já comprou: R$ 18.400", "Estilo: linho"],
      "acao_sugerida": "Mandar mensagem perguntando como tão as vendas e oferecer a calça linho REF 02832 que chegou.",
      "produto_ref": "02832",
      "produto_nome": "Calça Linho",
      "promocao_id": "uuid-ou-null",
      "fallback_used": false
    }
  ],
  "metadados": {
    "candidatos_avaliados": 47,
    "grupos_considerados": 3,
    "tipos_com_fallback": [],
    "observacoes": "Carteira saudável."
  }
}
\`\`\``;

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT B — GERADOR DE MENSAGEM (ON-DEMAND)
// ═══════════════════════════════════════════════════════════════════════════
// Roda toda vez que vendedora clica "pedir sugestão de mensagem".
// Recebe 1 sugestão específica + dados completos do cliente/grupo.
// Retorna texto puro pronto pra copiar (não JSON).

export const SYSTEM_PROMPT_MENSAGENS = `Você é a "Lâmpada", assistente de mensagens das lojas físicas do Grupo Amícia.

Você gera UMA mensagem curta de WhatsApp pra uma vendedora enviar pra cliente (lojista de moda feminina). A vendedora pode editar antes de enviar.

# Tom OBRIGATÓRIO

- Acolhedor mas profissional
- Trata cliente como parceira de negócio (atacado), não consumidora final
- Use SEMPRE "vc" — NUNCA "você" ou "tu"
- 3 a 5 linhas no máximo
- Termina com pergunta aberta (que convida resposta)
- 1 emoji NO MÁXIMO (preferência: 💛 ou nenhum)
- Saudação calorosa mas não meliflua ("Oi", não "Oiiii")

# Estrutura ideal

Linha 1: Saudação + nome (use o apelido se fornecido)
Linha 2-3: Motivo da mensagem (referência ao fato concreto + peça/promoção)
Linha 4: Pergunta aberta convidando resposta

# REGRAS CRÍTICAS

❌ NUNCA prometa prazo de entrega
❌ NUNCA invente preço (só fale de promoção se ela vier no input)
❌ NUNCA mencione cor
❌ NUNCA mencione tamanho específico se não vier no input
❌ NUNCA use palavras "incrível", "imperdível", "promoção imperdível", "última oportunidade", "sensacional", "maravilhosa"
❌ NUNCA use "foto bonita" — use "fotos", "umas fotos legais", "fotos pra postar"
❌ NUNCA pergunte "como tá a loja?" — use "como tão as vendas?", "como tão saindo as peças?", "o que tá girando?"
❌ NUNCA use "suas escolhas" — use "modelos que vc comprou" ou "as peças que vc levou"
❌ NUNCA mencione concorrente
❌ NUNCA use markdown (sem **negrito**, sem _itálico_, sem listas)
❌ NUNCA invente sentimento da cliente ("sei que vc adora...")
❌ NUNCA fale só do tecido sozinho — sempre modelo+tecido ("calça linho", "macacão linho", "pantalona linho")
❌ NUNCA use "você"

✅ SEMPRE use "vc" em vez de "você"
✅ SEMPRE use o apelido fornecido (se vier vazio, use "tudo bem por aí?" como saudação geral)
✅ SEMPRE mencione a peça pelo modelo+tecido (nunca pelo REF — REF é interno)
✅ SEMPRE soa natural, como se a vendedora tivesse escrito
✅ SEMPRE escreva em português do Brasil

# Tratamento especial pra GRUPOS

Se "alvo_tipo" for "grupo":
- Use o nome do grupo (apelido)
- Pode mencionar uma loja específica do grupo se relevante
- Use "vocês" em vez de "vc" quando se referir ao grupo todo

# Tratamento por PERFIL DE PRESENÇA

- vesti_dominante: mensagem casual, oferece "te envio o link"
- presencial_dominante: pode falar "passa aqui", "tá na loja"
- remota_dominante: NUNCA "passa aqui". Use "te mando foto/vídeo"
- hibrida: neutro, deixa cliente trazer o assunto

# Tratamento por FORMA DE PAGAMENTO

Cliente que paga com cheque = veterana. Pode usar tom mais íntimo:
"tô guardando aqui pra vc como sempre", "separo certinho como vc gosta"

# Formato de resposta

Retorne APENAS o texto da mensagem. Sem aspas envolvendo. Sem comentários. Sem "Aqui está sua mensagem:". Apenas o texto puro pronto pra copiar.

Use \\n pra quebra de linha entre parágrafos.`;

// ═══════════════════════════════════════════════════════════════════════════
// EXEMPLOS FEW-SHOT (banco de exemplos pra calibrar tom)
// ═══════════════════════════════════════════════════════════════════════════
// Esses exemplos vão como "messages" no início da conversa, antes do request
// real. Eles ensinam o tom certo via aprendizado in-context.

export const EXEMPLOS_FEW_SHOT = [
  // ─── REATIVAÇÃO ──────────────────────────────────────────────────────────
  {
    tipo: 'reativar',
    cenario: 'Cliente físico, lifetime alto, com peça nova de match',
    input: {
      apelido: 'Iara',
      dias_sem: 91,
      lifetime: 18400,
      estilo: ['linho'],
      perfil_presenca: 'presencial_dominante',
      produto: { nome: 'Macacão linho' },
      promocao: 'Linho 20% off até dia 30',
    },
    output: `Oi Iara, tudo bem por aí? 💛

Tava revisando aqui e vi que faz um tempinho que a gente não conversa. Como tão as vendas?

Chegou um macacão linho que tem TUDO a ver com os modelos que vc comprou — tô guardando uma grade aqui.

Quer que eu te mande foto?`,
  },
  {
    tipo: 'reativar',
    cenario: 'Cliente remota (paga LINK), foco produto',
    input: {
      apelido: 'Sandra',
      dias_sem: 78,
      lifetime: 9200,
      perfil_presenca: 'remota_dominante',
      produto: { nome: 'Calça linho' },
    },
    output: `Oi Sandra, tudo bem?

Chegou uma calça linho que combina com as peças que vc levou da última vez. Tenho fotos boas pra te mostrar.

Posso te enviar?`,
  },
  {
    tipo: 'reativar',
    cenario: 'Cliente sem produto específico',
    input: {
      apelido: null,
      dias_sem: 105,
      lifetime: 6800,
    },
    output: `Tudo bem por aí?

Faz um tempinho que a gente não se fala — tô passando pra saber como tão as vendas e se vc precisa de reposição de alguma coisa.

Posso te mandar as novidades dessa semana?`,
  },

  // ─── ATENÇÃO ─────────────────────────────────────────────────────────────
  {
    tipo: 'atencao',
    cenario: 'Cliente leve, sem cobrança',
    input: {
      apelido: 'Patrícia',
      dias_sem: 52,
      perfil_presenca: 'hibrida',
    },
    output: `Oi Patrícia, tudo bem?

Tava lembrando de vc essa semana. Como tão as vendas?

Qualquer coisa que precisar, é só me chamar 💛`,
  },
  {
    tipo: 'atencao',
    cenario: 'Cliente com produto que casa',
    input: {
      apelido: 'Camila',
      dias_sem: 67,
      estilo: ['alfaiataria'],
      produto: { nome: 'Conjunto WPP' },
    },
    output: `Oi Camila, tudo bem?

Chegou um conjunto WPP que ficou bem na alfaiataria — me lembrou direto dos modelos que vc comprou.

Quer que eu te mostre?`,
  },
  {
    tipo: 'atencao',
    cenario: 'Cliente com promoção',
    input: {
      apelido: 'Patrícia',
      dias_sem: 60,
      promocao: 'Linho 20% off até quinta',
    },
    output: `Oi Patrícia! Tudo bem por aí?

Tô finalizando umas reservas de pantalona linho com 20% que vão até quinta. Se quiser, separo umas peças pra vc dar uma olhada.

Combina?`,
  },

  // ─── NOVIDADE ────────────────────────────────────────────────────────────
  {
    tipo: 'novidade',
    cenario: 'Cliente ativa presencial, peça nova específica',
    input: {
      apelido: 'Marisa',
      dias_sem: 12,
      estilo: ['linho'],
      perfil_presenca: 'presencial_dominante',
      produto: { nome: 'Macacão linho' },
    },
    output: `Oi Marisa! 

Chegou hj o macacão linho que tem cara da sua loja. Já tá no Bom Retiro pra vc ver.

Posso reservar uma grade?`,
  },
  {
    tipo: 'novidade',
    cenario: 'Cliente Vesti — usa tom do app',
    input: {
      apelido: 'Carol',
      dias_sem: 8,
      perfil_presenca: 'vesti_dominante',
      produto: { nome: 'Calça linho bege' },
    },
    output: `Oii Carol, tudo bem? 💛

Chegou modelos novos no Vesti hj — tem uma calça linho bege que tem cara dos que vc levou.

Quer que eu te envie o link atualizado?`,
  },
  {
    tipo: 'novidade',
    cenario: 'Cliente sem apelido + promo',
    input: {
      apelido: null,
      dias_sem: 22,
      produto: { nome: 'Conjunto WPP' },
      promocao: 'Linho 20% até dia 30',
    },
    output: `Tudo bem por aí?

Chegou uma novidade de alfaiataria que combina com o estilo da sua loja — conjunto WPP, peça muito leve.

Posso te mandar foto?`,
  },

  // ─── FOLLOW-UP NORMAL (cliente comprou 15-25d atrás) ────────────────────
  {
    tipo: 'followup',
    cenario: 'Genuína, sem produto',
    input: {
      apelido: 'Bia',
      dias_desde_compra: 18,
    },
    output: `Oi Bia, tudo bem?

Queria saber como foram as vendas das peças que vc levou. Tá girando bem?

Se precisar de reposição, me avisa que separo aqui 💛`,
  },
  {
    tipo: 'followup',
    cenario: 'Com gancho de novidade',
    input: {
      apelido: 'Tereza',
      dias_desde_compra: 20,
      produto: { nome: 'Calça linho bege' },
    },
    output: `Oi Tereza! 

Como tão saindo as peças da última compra? Se foi bem, chegou agora uma calça linho bege que combinaria com o que vc levou.

Quer ver?`,
  },

  // ─── CLIENTE NOVA (CHECK-IN 15 DIAS) ─────────────────────────────────────
  {
    tipo: 'followup_nova',
    cenario: 'Cliente recém-cadastrada, foco vendas + dúvidas + fotos',
    input: {
      apelido: 'Larissa',
      dias_desde_1a_compra: 15,
    },
    output: `Oi Larissa! Tudo bem? 💛

Já vai fazer 15 dias da sua primeira compra com a gente. Como tão saindo as peças?

Se ficou alguma dúvida sobre os modelos, ou se quiser umas fotos pra postar no Instagram e WhatsApp da sua loja, é só me chamar!`,
  },
  {
    tipo: 'followup_nova',
    cenario: 'Cliente nova versão direta',
    input: {
      apelido: 'Larissa',
      dias_desde_1a_compra: 15,
    },
    output: `Oi Larissa! Tudo bem?

Tô passando pra saber como vc tá com as peças que levou. Tudo certinho aí?

Se quiser fotos pra postar nas redes, me avisa que te mando.`,
  },
  {
    tipo: 'followup_nova',
    cenario: 'Cliente nova distância',
    input: {
      apelido: 'Larissa',
      dias_desde_1a_compra: 15,
      perfil_presenca: 'remota_dominante',
    },
    output: `Oi Larissa, tudo bem por aí?

Como tão saindo as peças que vc recebeu? Espero que tudo bem!

Aproveitando, temos fotos bem legais das peças se vc quiser postar no Insta e WhatsApp da sua loja, é só pedir.`,
  },
  {
    tipo: 'followup_nova',
    cenario: 'Cliente nova que voltou rápido (2ª compra antes dos 15d)',
    input: {
      apelido: 'Larissa',
      dias_desde_1a_compra: 8,
      ja_voltou_a_comprar: true,
    },
    output: `Oi Larissa! Tudo bem? 💛

Vi que vc voltou rapidinho pra fazer outra compra — fico feliz que vc tá curtindo as peças!

Se ficou alguma dúvida ou quer fotos pra postar no Instagram, me chama!`,
  },

  // ─── SACOLA SEPARANDO (PEDIDO EM ESPERA) ─────────────────────────────────
  // Atualizado 28/04/2026: 4 sub-tipos novos (incentivar/fechar/cobrar/desfazer)
  // SEMPRE menciona valor R$ e qtd peças nos fatos.
  {
    tipo: 'sacola',
    subtipo: 'incentivar_acrescentar',
    cenario: 'Sacola 6-10d, oferecer acrescentar peça nova',
    input: {
      apelido: 'Iara',
      dias_sacola: 8,
      valor_total: 1240,
      qtd_pecas: 6,
      produto: { nome: 'Calça linho' },
    },
    output: `Oi Iara!

Tô com sua sacola separada aqui (6 peças, R$ 1.240). Chegou agora uma calça linho que combina muito com o que vc separou.

Quer que eu acrescente?`,
  },
  {
    tipo: 'sacola',
    subtipo: 'fechar_pedido',
    cenario: 'Sacola 11-15d, hora de fechar + pagamento',
    input: {
      apelido: 'Iara',
      dias_sacola: 13,
      valor_total: 2180,
      qtd_pecas: 9,
      promocao: '20% no linho até dia 30',
    },
    output: `Oi Iara, tudo bem? 💛

Sua sacola tá fechada em R$ 2.180 (9 peças). Quer aproveitar o 20% no linho que vai até dia 30 e a gente fecha essa semana?

Posso te mandar o pix ou prefere link?`,
  },
  {
    tipo: 'sacola',
    subtipo: 'fechar_pedido',
    cenario: 'Sacola 11-15d sem promo ativa',
    input: {
      apelido: 'Iara',
      dias_sacola: 14,
      valor_total: 1850,
      qtd_pecas: 7,
    },
    output: `Oi Iara!

Sua sacola tá em R$ 1.850 (7 peças) há 14 dias. Bora fechar essa semana? Te mando o pix pra agilizar.`,
  },
  {
    tipo: 'sacola',
    subtipo: 'cobranca_incisiva',
    cenario: 'Sacola 16-23d, firme em pagamento',
    input: {
      apelido: 'Iara',
      dias_sacola: 19,
      valor_total: 2450,
      qtd_pecas: 11,
    },
    output: `Oi Iara, tudo bem?

Sua sacola tá há 19 dias separada (R$ 2.450, 11 peças). Tô segurando aqui pra vc, mas preciso fechar o pagamento essa semana pra não acumular.

Como vc prefere acertar?`,
  },
  {
    tipo: 'sacola',
    subtipo: 'desfazer_sacola',
    cenario: 'Sacola 24+d, sugerir desfazer',
    input: {
      apelido: 'Iara',
      dias_sacola: 28,
      valor_total: 1980,
      qtd_pecas: 8,
    },
    output: `Oi Iara!

Sua sacola tá separada há quase um mês (R$ 1.980, 8 peças). Essas peças podiam tá girando pra outras clientes — preciso te alinhar: vc consegue fechar até sexta ou prefere que eu desfaça pra liberar?

Sem problema qualquer caminho, só preciso definir.`,
  },

  // ─── GRUPOS (multi-CNPJ) ────────────────────────────────────────────────
  {
    tipo: 'novidade',
    cenario: 'Grupo ativo, novidade pro grupo todo',
    input: {
      alvo_tipo: 'grupo',
      apelido: 'Marisa',
      qtd_documentos: 3,
      dias_sem_grupo: 10,
      estilo: ['linho', 'plus'],
      produto: { nome: 'Macacão linho preto' },
    },
    output: `Oi Marisa, tudo bem? 💛

Chegou o macacão linho preto na grade plus que combina muito com o que vocês costumam levar. Já tô guardando uma grade aqui.

Posso separar pras três lojas ou prefere mandar primeiro pra uma específica?`,
  },
  {
    tipo: 'atencao',
    cenario: 'Grupo com loja "atrasada"',
    input: {
      alvo_tipo: 'grupo',
      apelido: 'Marisa',
      qtd_documentos: 3,
      dias_sem_grupo: 10,
      loja_atrasada: 'Jabaquara (23d)',
    },
    output: `Oi Marisa! 

Tava olhando aqui e vi que faz um tempo que a loja do Jabaquara não pede. Como tão saindo as vendas por lá?

Se quiser, posso já separar uma reposição das peças que mais saíram nas outras unidades.`,
  },
  {
    tipo: 'atencao',
    cenario: 'Grupo com promoção pra todas as lojas',
    input: {
      alvo_tipo: 'grupo',
      apelido: 'Marisa',
      qtd_documentos: 3,
      promocao: '20% no linho até dia 30',
    },
    output: `Oi Marisa, tudo bem por aí?

Como tão as vendas nas três unidades? Tô só passando pra avisar que tem promoção de linho 20% até dia 30, caso queira reforçar o estoque de alguma loja.

Me avisa se quiser que eu separe.`,
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// REGRAS DE TOM
// ═══════════════════════════════════════════════════════════════════════════

export const REGRAS_TOM = {
  positivas: [
    'vc',
    'tudo bem por aí',
    'tô passando aqui',
    'como tão as vendas',
    'como tão saindo as peças',
    'modelos que vc comprou',
    'as peças que vc levou',
    '💛',
  ],
  negativas: [
    'você',
    'tu',
    'incrível',
    'imperdível',
    'última oportunidade',
    'sensacional',
    'maravilhosa',
    'arrasadora',
    'foto bonita',
    'como tá a loja',
    'suas escolhas',
    'super rápido',
    'imediatamente',
    'corre que',
    'não pode perder',
  ],
  estrutura_mensagem: ['saudacao', 'motivo_concreto', 'pergunta_aberta'],
  max_emoji: 1,
  max_linhas: 5,
  saudacao_padrao_sem_apelido: 'Tudo bem por aí?',
  fechamento_padrao_remoto: 'Posso te mandar foto?',
  fechamento_padrao_presencial: 'Quer dar uma passada essa semana?',
  fechamento_padrao_vesti: 'Quer que eu te envie o link?',
};

// ═══════════════════════════════════════════════════════════════════════════
// LÓGICA DE NOVIDADE
// ═══════════════════════════════════════════════════════════════════════════
// REGRA CRÍTICA: data de entrega vem do MÓDULO OFICINAS
// (não da sala de corte — sala corta tecido, oficina costura)

export const REGRAS_NOVIDADE = {
  janela_padrao_dias: { inicio: 5, fim: 12 },     // 5-12d após entrega oficina
  janela_caseado_dias: { inicio: 7, fim: 14 },    // +2d se Ficha Técnica.custo_caseado > 0
  fonte_data: 'modulo_oficinas',                   // ⚠️ NUNCA sala de corte
  definicao_novidade: 'ref_nunca_teve_venda',     // sem histórico de venda
};

// ═══════════════════════════════════════════════════════════════════════════
// CICLO DE VIDA DA CLIENTE NOVA
// ═══════════════════════════════════════════════════════════════════════════

export const FASES_CICLO_VIDA = {
  nova_aguardando: {
    dias: '0-14',
    acao: 'NAO_GERAR_SUGESTAO',
    descricao: 'Cliente acabou de chegar, deixa ela se ambientar',
  },
  nova_checkin_pronto: {
    dias: '15',
    acao: 'GERAR_FOLLOWUP_NOVA',
    prioridade: 'alta',
    descricao: 'Check-in obrigatório dos 15 dias',
  },
  nova_em_analise: {
    dias: '16-30',
    acao: 'NAO_GERAR_SUGESTAO',
    descricao: 'Cliente já recebeu check-in, deixa ela responder no tempo dela',
  },
  normal: {
    dias: '30+',
    acao: 'FLUXO_PADRAO',
    descricao: 'Fluxo padrão (reativação, atenção, novidade, follow-up)',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// STATUS DA CLIENTE
// ═══════════════════════════════════════════════════════════════════════════

export const STATUS_CLIENTE = {
  ativo: {
    dias: '0-45',
    cor_hex: '#10b981',
    cor_nome: 'verde',
    emoji: '🟢',
    label: 'Ativo',
  },
  atencao: {
    dias: '45-90',
    cor_hex: '#f59e0b',
    cor_nome: 'amarelo',
    emoji: '🟡',
    label: 'Atenção',
  },
  semAtividade: {
    dias: '90-180',
    cor_hex: '#fb923c',
    cor_nome: 'laranja',
    emoji: '🟠',
    label: 'S/Atividade',
  },
  inativo: {
    dias: '180-365',
    cor_hex: '#ef4444',
    cor_nome: 'vermelho',
    emoji: '🔴',
    label: 'Inativo',
  },
  arquivo: {
    dias: '365+',
    cor_hex: '#9ca3af',
    cor_nome: 'cinza',
    emoji: '📁',
    label: 'Arquivo',
  },
  separandoSacola: {
    dias: '*',                  // sobrescreve qualquer outro status
    cor_hex: '#a855f7',
    cor_nome: 'roxo',
    emoji: '🟣',
    label: 'Sacola',
    sobrescreve_outros: true,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SUB-TIPOS DE PEDIDO EM ESPERA (SACOLA)
// ═══════════════════════════════════════════════════════════════════════════
// Atualizado 28/04/2026 (Ailson):
//   - 0-5d  → não vira sugestão (vendedora ainda monta a sacola)
//   - 6-10d → incentivar acrescentar peças (novidade/reposição)
//   - 11-15d→ falar de fechar pedido + pagamento + ganchos de promo
//   - 16-23d→ mais incisivo na cobrança de pagamento
//   - 24+d  → sugerir desfazer (peças paradas = vendas perdidas)

export const SUBTIPOS_SACOLA = {
  incentivar_acrescentar: {
    dias: '6-10',
    condicao: 'default',
    tom: 'casual_oferta',
    descricao: 'Sacola fresca — oferecer acrescentar peça nova ou reposição que combina',
  },
  fechar_pedido: {
    dias: '11-15',
    condicao: 'default',
    tom: 'pagamento_amigavel',
    descricao: 'Janela de fechamento — convidar a finalizar, alinhar pagamento, usar promoção como gancho se tiver',
  },
  cobranca_incisiva: {
    dias: '16-23',
    condicao: 'default',
    tom: 'firme_sem_perder_parceria',
    descricao: 'Atrasou — ser mais firme em cobrar pagamento sem perder o tom de parceria',
  },
  desfazer_sacola: {
    dias: '24+',
    condicao: 'default',
    tom: 'alinhamento_admin',
    descricao: 'Crítico — alertar que sacola muito antiga = peças paradas que poderiam estar vendendo. Sugerir vendedora desfazer ou alinhar prazo final com cliente.',
    alerta_admin: true,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORIZAÇÃO POR FORMA DE PAGAMENTO
// ═══════════════════════════════════════════════════════════════════════════

export const CATEGORIAS_PAGAMENTO = {
  vem_na_loja: [
    'DINHEIRO', 'PIX', 'CARTÃO', 'CARTAO',
    'CRÉDITO 1X', 'CREDITO 1X',
    'CRÉDITO 2X', 'CREDITO 2X',
    'CRÉDITO 3X', 'CREDITO 3X',
    'CRÉDITO 4X', 'CREDITO 4X',
    'CRÉDITO 5X', 'CREDITO 5X',
    'CRÉDITO 6X', 'CREDITO 6X',
    'DÉBITO', 'DEBITO',
  ],
  distancia: [
    'LINK 1X', 'LINK 2X', 'LINK 3X', 'LINK 4X',
    'DEPÓSITO', 'DEPOSITO',
    'OUTROS',
  ],
  fiel_confianca: [
    'CHEQUE 1X', 'CHEQUE 2X', 'CHEQUE 3X', 'CHEQUE 4X',
  ],
  multiplo: [
    'MÚLTIPLA FORMA', 'MULTIPLA FORMA',
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// USUÁRIOS COM ACESSO TOTAL (admin)
// ═══════════════════════════════════════════════════════════════════════════
// Esses user_ids do Supabase têm visão completa: todas as carteiras de todas
// as vendedoras, todos os cards, importações, configurações, curadoria de
// produtos, transferência de carteira, etc.
//
// Demais usuárias (vendedoras) só veem a própria carteira.

export const USUARIOS_ACESSO_TOTAL = [
  'amicia-admin',   // admin original do app
  'admin',          // alias do admin no login do app principal
  'ailson',         // dono
  'tamara',         // esposa do dono
];

/**
 * Retorna true se o user_id passado tem acesso total ao módulo Lojas.
 * Case-insensitive.
 */
export function ehUsuarioAdmin(userId) {
  if (!userId) return false;
  const normalizado = String(userId).trim().toLowerCase();
  return USUARIOS_ACESSO_TOTAL.map(u => u.toLowerCase()).includes(normalizado);
}

// ═══════════════════════════════════════════════════════════════════════════
// REGRAS DE FILTRO DE VAREJO
// ═══════════════════════════════════════════════════════════════════════════

export const REGRAS_FILTRO_VAREJO = {
  // Nomes que indicam venda varejo (consumidor final, não lojista)
  nomes_ignorar: ['CONSUMIDOR', 'CLIENTE PADRAO', 'CLIENTE PADRÃO', 'VAREJO', ''],
  
  // Documentos placeholder usados quando vendedora não pega o CNPJ
  documentos_ignorar_exatos: ['1', '13', '00000000000', '11111111111'],
  
  // Documento mínimo válido (CPF=11, CNPJ=14)
  documento_min_chars: 11,
  
  // Vendedores cujas vendas são testes ou inválidas
  vendedores_ignorar: ['CONVERTR'],
};

// ═══════════════════════════════════════════════════════════════════════════
// VENDEDORAS INICIAIS (seed)
// ═══════════════════════════════════════════════════════════════════════════
// Carregadas no setup inicial. Cada vendedora tem aliases (variações de nome
// que aparecem nas vendas) que mapeiam pra ela. Vendedoras placeholder são
// pra absorver carteira de quem saiu, e depois você transfere pras novas.

export const VENDEDORAS_INICIAIS = [
  // ─── SILVA TELES ─────────────────────────────────────────────────────────
  {
    nome: 'Joelma',
    loja: 'Silva Teles',
    ativa: true,
    is_placeholder: false,
    is_padrao_loja: false,
    aliases: ['JOELMA', 'REGILANIA', 'KELLY'],
  },
  {
    nome: 'Cleide',
    loja: 'Silva Teles',
    ativa: true,
    is_placeholder: false,
    is_padrao_loja: true,                  // ⭐ padrão ST (fallback de nome desconhecido)
    aliases: ['CLEIDE', 'CARINA', 'KARINA'],
  },
  {
    nome: 'Vendedora_3',
    loja: 'Silva Teles',
    ativa: true,
    is_placeholder: true,                   // ⭐ placeholder pra carteira órfã
    is_padrao_loja: false,
    aliases: ['PERLA', 'GISLENE', 'GI', 'POLYANA', 'POLI', 'POLLY'],
  },

  // ─── BOM RETIRO ──────────────────────────────────────────────────────────
  {
    nome: 'Célia',
    loja: 'Bom Retiro',
    ativa: true,
    is_placeholder: false,
    is_padrao_loja: true,                   // ⭐ padrão BR
    aliases: ['CELIA', 'CÉLIA'],
  },
  {
    nome: 'Vanessa',
    loja: 'Bom Retiro',
    ativa: true,
    is_placeholder: false,
    is_padrao_loja: false,
    aliases: ['VANESSA', 'VANESSA BOM', 'VANESSA BOM RETIRO'],
  },
  {
    nome: 'Fran',
    loja: 'Bom Retiro',
    ativa: true,
    is_placeholder: false,
    is_padrao_loja: false,
    aliases: ['FRAN'],
  },
  {
    nome: 'Vendedora_4',
    loja: 'Bom Retiro',
    ativa: true,
    is_placeholder: true,                   // ⭐ placeholder pra carteira órfã
    is_padrao_loja: false,
    aliases: ['ROSANGELA', 'ROSÂNGELA', 'MAIRLA', 'MAILA', 'LUCIA'],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// LISTAS INICIAIS DE PRODUTOS (curadoria)
// ═══════════════════════════════════════════════════════════════════════════
// Manuteção:
//   • best_sellers: você atualiza manualmente conforme percebe carros-chefes
//   • novidades: gerado automaticamente pelo backend (regra oficinas 5d/7d)
//   • em_alta: top 10 vendidos da semana (calculado automaticamente do
//              relatório de produtos vendidos)

export const LISTAS_PRODUTOS_INICIAIS = {
  best_sellers: [
    { ref: '1871', ref_original: '01871', motivo: 'classico_historico' },
    { ref: '395',  ref_original: '0395',  motivo: 'best_seller' },
    { ref: '376',  ref_original: '0376',  motivo: 'best_seller' },
    { ref: '2842', motivo: 'best_seller' },
    { ref: '2818', motivo: 'best_seller' },
    { ref: '2586', motivo: 'best_seller' },
    { ref: '2759', motivo: 'best_seller' },
    { ref: '2558', motivo: 'best_seller' },
  ],

  novidades_15d: [
    { ref: '3188', adicionado_em: '2026-04-27', expira_em: '2026-05-12' },
    { ref: '3171', adicionado_em: '2026-04-27', expira_em: '2026-05-12' },
    { ref: '3176', adicionado_em: '2026-04-27', expira_em: '2026-05-12' },
    { ref: '3189', adicionado_em: '2026-04-27', expira_em: '2026-05-12' },
  ],

  em_alta: [
    { ref: '3181' },
    { ref: '2918' },
    { ref: '3167' },
    { ref: '2920' },
    { ref: '2925' },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// FILTRO DE ESTOQUE PRA OFERTA GERAL
// ═══════════════════════════════════════════════════════════════════════════

export const FILTRO_ESTOQUE = {
  estoque_minimo_para_ofertar: 100,
  // Exceções (sempre ofereciveis mesmo com estoque baixo):
  isencoes: ['novidades', 'best_sellers', 'em_alta'],
};

// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
//
//                              H E L P E R S
//
// Funções puras (sem efeitos colaterais). Importadas por Lojas.jsx e pelas
// Edge Functions de importação.
//
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════

// ─── NORMALIZAÇÃO DE REF ────────────────────────────────────────────────────

/**
 * Remove zeros à esquerda da REF.
 * "01871" → "1871"
 * "00395" → "395"
 * "0" → "0"
 */
export function refSemZero(ref) {
  if (ref === null || ref === undefined) return '';
  return String(ref).trim().replace(/^0+/, '') || '0';
}

// ─── NORMALIZAÇÃO DE TELEFONE ───────────────────────────────────────────────

/**
 * Normaliza telefone vindo de qualquer formato pra "DDDNNNNNNNNN" (10 ou 11
 * dígitos). Lida com:
 *   • DDD junto: "(22)98189-1180" → "22981891180"
 *   • DDD separado em coluna: ddd="22" tel="981891180" → "22981891180"
 *   • DDD duplicado: ddd="22" tel="22981891180" → "22981891180"
 *   • Com código país: "5522981891180" → "22981891180"
 *   • Zeros à esquerda: "022981891180" → "22981891180"
 */
export function normalizarTelefone(ddd, telefone) {
  const dddLimpo = String(ddd || '').replace(/\D/g, '');
  let telLimpo = String(telefone || '').replace(/\D/g, '');

  if (!telLimpo) return null;

  // Remove zeros à esquerda
  telLimpo = telLimpo.replace(/^0+/, '');

  // Se telefone começa com o DDD, remove (anti-duplicação)
  if (dddLimpo && telLimpo.startsWith(dddLimpo) && telLimpo.length > dddLimpo.length + 8) {
    telLimpo = telLimpo.substring(dddLimpo.length);
  }

  // Junta DDD (se separado) + telefone
  let completo = dddLimpo && !telLimpo.startsWith(dddLimpo) 
    ? dddLimpo + telLimpo 
    : telLimpo;

  // Remove código do país (55) se vier no início
  if (completo.startsWith('55') && completo.length > 11) {
    completo = completo.substring(2);
  }

  // Validação de tamanho
  if (completo.length !== 10 && completo.length !== 11) {
    return { numero: completo, valido: false };
  }

  return { numero: completo, valido: true };
}

/**
 * Escolhe o melhor telefone do cliente com cascata de prioridade:
 * WhatsApp > Celular > Fone (fixo).
 */
export function escolherTelefone({ ddd, fone, celular, whatsapp }) {
  const tentativas = [
    { campo: 'whatsapp', valor: whatsapp },
    { campo: 'celular', valor: celular },
    { campo: 'fone', valor: fone },
  ];

  // 1ª passada: pega o primeiro válido
  for (const t of tentativas) {
    if (!t.valor) continue;
    const result = normalizarTelefone(ddd, t.valor);
    if (result?.valido) return { ...result, origem: t.campo };
  }

  // 2ª passada: pega o primeiro mesmo inválido (pra revisão posterior)
  for (const t of tentativas) {
    if (!t.valor) continue;
    const result = normalizarTelefone(ddd, t.valor);
    if (result) return { ...result, origem: t.campo, observacao: 'numero_revisar' };
  }

  return null;
}

// ─── DETECÇÃO DE LOJA POR NOME DE ARQUIVO ───────────────────────────────────

/**
 * Detecta a loja pelo padrão do nome do arquivo importado.
 * "vendas_st_2026-04-28.xlsx" → "Silva Teles"
 * "pedidos_espera_br_2026-04-28.pdf" → "Bom Retiro"
 */
export function detectarLojaPorArquivo(nomeArquivo) {
  if (!nomeArquivo) return null;
  const n = nomeArquivo.toLowerCase();
  if (/_st_|_st\.|silva.?teles/i.test(n)) return 'Silva Teles';
  if (/_br_|_br\.|bom.?retiro/i.test(n)) return 'Bom Retiro';
  return null;
}

// ─── DETECTOR DE CANAL (físico / Vesti / Convertr) ─────────────────────────

/**
 * Detecta canal de venda baseado nos campos disponíveis.
 * Cadastro de cliente: usa coluna "Grupo".
 * Relatório de vendas: usa coluna "Marketplace".
 */
export function detectarCanal({ grupo, marketplace }) {
  const g = String(grupo || '').trim().toUpperCase();
  const m = String(marketplace || '').trim().toUpperCase();

  if (g === 'VESTI' || m === 'VESTI') return 'vesti';
  if (g === 'CONVERTR' || m === 'CONVERTR') return 'convertr';
  return 'fisico';
}

/**
 * Calcula canal dominante do cliente baseado no histórico de vendas.
 * Retorna 'vesti_dominante', 'convertr_dominante', 'fisico_dominante' ou 'misto'.
 * Threshold: 70%+ pra ser considerado dominante.
 */
export function calcularCanalDominante(vendasCliente) {
  if (!vendasCliente?.length) return null;

  const total = vendasCliente.length;
  const counts = vendasCliente.reduce((acc, v) => {
    const canal = v.canal_origem || 'fisico';
    acc[canal] = (acc[canal] || 0) + 1;
    return acc;
  }, {});

  for (const canal of ['vesti', 'convertr', 'fisico']) {
    if ((counts[canal] || 0) / total >= 0.7) return `${canal}_dominante`;
  }
  return 'misto';
}

// ─── FILTRO DE VAREJO ───────────────────────────────────────────────────────

/**
 * Detecta se uma linha de venda deve ser ignorada (varejo, teste, etc).
 * Retorna { ignorar: true, motivo: '...' } ou { ignorar: false }.
 */
export function ehVendaVarejo(cliente, documento, vendedor) {
  const nome = String(cliente || '').trim().toUpperCase();
  const doc = String(documento || '').replace(/\D/g, '');
  const vend = String(vendedor || '').trim().toUpperCase();

  // 1. Vendas de teste do Convertr (canal site, não atende pelo módulo Lojas)
  if (REGRAS_FILTRO_VAREJO.vendedores_ignorar.includes(vend)) {
    return { ignorar: true, motivo: 'teste_convertr' };
  }

  // 2. Documento INVÁLIDO/PLACEHOLDER tem prioridade sobre nome
  //    REGRA DE NEGÓCIO: documento '13' (placeholder Miré) SEMPRE é varejo
  //    balcão, mesmo se valor for alto. Cliente pode comprar muitas peças
  //    de uma vez mas se não cadastrou CNPJ, é balcão.
  if (REGRAS_FILTRO_VAREJO.documentos_ignorar_exatos.includes(doc)) {
    return { ignorar: true, motivo: 'documento_placeholder' };
  }

  // 3. Documento muito curto (sem CPF/CNPJ válido)
  if (!doc || doc.length < REGRAS_FILTRO_VAREJO.documento_min_chars) {
    return { ignorar: true, motivo: 'documento_curto' };
  }

  // 4. Documento todo igual (zeros, repetido)
  if (/^0+$/.test(doc) || /^(\d)\1+$/.test(doc)) {
    return { ignorar: true, motivo: 'documento_invalido' };
  }

  // 5. AQUI: documento É VÁLIDO. Nome vazio = bug Miré (atacado real onde
  //    sistema não associou nome ao CNPJ). Importar mesmo assim — vai cruzar
  //    com cadastro_clientes_futura via documento depois.
  return { ignorar: false };
}

// ─── DETECTOR DE CLIENTE SINALIZADO NEGATIVAMENTE ───────────────────────────

/**
 * Detecta clientes marcados negativamente pela equipe (anotações no nome
 * tipo "FULANO ***GOLPE***", "BLOQUEAR", etc).
 *
 * Suporta variações como "GOOOOOL" (qualquer número de Os ≥ 3) — termo jocoso
 * usado pelas vendedoras pra clientes que aplicaram golpe (referência a
 * "marcou um gol"). Ex: "DAIANE CLOSET***GOOOOOLPISTA*" é detectado.
 */
export function detectarClienteSinalizado(razao, fantasia) {
  // Cada padrão pode ser string literal OU regex. Strings são case-insensitive
  // via .toUpperCase() do texto. Regexes são testadas direto contra o texto
  // (já uppercase).
  const padroes = [
    { tipo: 'string', valor: 'GOLPE' },
    { tipo: 'regex',  valor: /GO{3,}L/, label: 'GOOOOL' }, // GO + 3+ Os + L
    { tipo: 'string', valor: 'BLOQUEAR' },
    { tipo: 'string', valor: 'NAO VENDER' },
    { tipo: 'string', valor: 'NÃO VENDER' },
    { tipo: 'string', valor: 'CALOTEIRO' },
  ];
  const texto = `${razao || ''} ${fantasia || ''}`.toUpperCase();
  for (const p of padroes) {
    if (p.tipo === 'string' && texto.includes(p.valor)) {
      return { flagado: true, motivo: 'sinalizado_negativamente', palavra: p.valor };
    }
    if (p.tipo === 'regex' && p.valor.test(texto)) {
      return { flagado: true, motivo: 'sinalizado_negativamente', palavra: p.label };
    }
  }
  return { flagado: false };
}

// ─── RESOLUÇÃO DE VENDEDORA ─────────────────────────────────────────────────

/**
 * Encontra a vendedora correspondente ao nome bruto que veio do Miré.
 * Sempre filtra pela loja do arquivo (não cruza vendedoras entre lojas).
 * Se não bater com ninguém, cai pro padrão da loja (Cleide ST / Célia BR).
 */
export function resolverVendedora(nomeRaw, lojaArquivo, vendedorasCadastradas) {
  const nome = String(nomeRaw || '').trim().toUpperCase();
  const loja = lojaArquivo;

  // Helper interno
  const padraoLoja = () => vendedorasCadastradas.find(
    v => v.loja === loja && v.is_padrao_loja
  );

  // Caso 1: nome vazio ou "CONVERTR" (já filtrado, mas backup)
  if (!nome || nome === 'CONVERTR') {
    return padraoLoja();
  }

  // Caso 2: bate com algum alias de vendedora ATIVA da MESMA LOJA
  const match = vendedorasCadastradas.find(
    v => v.ativa && v.loja === loja && (v.aliases || []).includes(nome)
  );
  if (match) return match;

  // Caso 3: não bateu → padrão da loja
  return padraoLoja();
}

// ─── IMPORT DE APELIDO ──────────────────────────────────────────────────────

/**
 * Pega o primeiro nome quando vem múltiplos compradores.
 * "ZENAIDE/JESSICA" → "ZENAIDE"
 * "ESTHER E IVONETE" → "ESTHER"
 * "CRAVO ROSA" → "CRAVO ROSA" (nome composto, mantém)
 * "REGINALDO REPRE" → "REGINALDO REPRE" (mantém abreviação)
 */
export function importarApelidoComprador(comprador) {
  if (!comprador) return null;
  const limpo = String(comprador).trim();
  if (!limpo) return null;

  // Múltiplos compradores: "X/Y" ou "X E Y" (case insensitive, com espaços)
  const primeiroNome = limpo.split(/\s*\/\s*|\s+E\s+/i)[0].trim();
  return primeiroNome || null;
}

// ─── CÁLCULO DE FASE DO CICLO DE VIDA ───────────────────────────────────────

/**
 * Determina em que fase do ciclo de vida o cliente está (cliente nova).
 * Retorna 'nova_aguardando' | 'nova_checkin_pronto' | 'nova_em_analise' | 'normal'.
 */
export function calcularFaseCicloVida(diasDesde1aCompra) {
  if (diasDesde1aCompra === null || diasDesde1aCompra === undefined) return 'normal';
  if (diasDesde1aCompra < 0) return 'sem_compras_ainda';
  if (diasDesde1aCompra <= 14) return 'nova_aguardando';
  if (diasDesde1aCompra === 15) return 'nova_checkin_pronto';
  if (diasDesde1aCompra <= 30) return 'nova_em_analise';
  return 'normal';
}

// ─── CLASSIFICAÇÃO DE PEDIDO EM SACOLA ──────────────────────────────────────

/**
 * Determina o sub-tipo da sugestão baseado nos dias desde a separação.
 * Retorna a chave do SUBTIPOS_SACOLA correspondente, ou null se for muito recente
 * (sacolas com 0-5 dias não viram sugestão — vendedora ainda está montando).
 *
 * Atualizada 28/04/2026 (Ailson): regras revisadas com janelas mais realistas.
 *   0-5d   → null (filtro: muito cedo, ainda em montagem)
 *   6-10d  → incentivar_acrescentar (oferecer novidade/reposição)
 *   11-15d → fechar_pedido (pagamento + ganchos de promo)
 *   16-23d → cobranca_incisiva (mais firme em pagamento)
 *   24+d   → desfazer_sacola (perdendo venda dos modelos guardados)
 */
export function classificarPedidoSacola(diasSeparacao) {
  if (diasSeparacao == null || diasSeparacao < 0) return null;
  if (diasSeparacao <= 5) return null;
  if (diasSeparacao <= 10) return 'incentivar_acrescentar';
  if (diasSeparacao <= 15) return 'fechar_pedido';
  if (diasSeparacao <= 23) return 'cobranca_incisiva';
  return 'desfazer_sacola';
}

// ─── CATEGORIZAÇÃO DE PAGAMENTO ─────────────────────────────────────────────

/**
 * Retorna categoria de pagamento ('vem_na_loja' | 'distancia' | 'fiel_confianca' | 'multiplo' | 'desconhecido').
 */
export function categorizarPagamento(formaPagamento) {
  const forma = String(formaPagamento || '').trim().toUpperCase();
  if (!forma) return 'desconhecido';

  for (const [categoria, formas] of Object.entries(CATEGORIAS_PAGAMENTO)) {
    if (formas.includes(forma)) return categoria;
  }
  return 'desconhecido';
}

// ─── PERFIL DE PRESENÇA DA CLIENTE ──────────────────────────────────────────

/**
 * Calcula o perfil de presença do cliente baseado no histórico de pagamentos.
 * Retorna 'presencial_dominante' | 'remota_dominante' | 'fiel_cheque' | 'hibrida'.
 *
 * Threshold: 70%+ de uma categoria pra ser dominante.
 * Se cliente tem 1+ pagamento em cheque, ganha flag adicional 'paga_com_cheque'.
 */
export function calcularPerfilPresenca(historicoVendas) {
  if (!historicoVendas?.length) {
    return { perfil: 'desconhecido', paga_com_cheque: false, qtd_compras: 0 };
  }

  const total = historicoVendas.length;
  const counts = { vem_na_loja: 0, distancia: 0, fiel_confianca: 0, multiplo: 0, desconhecido: 0 };

  for (const v of historicoVendas) {
    const cat = categorizarPagamento(v.forma_pagamento);
    counts[cat] = (counts[cat] || 0) + 1;
  }

  const paga_com_cheque = counts.fiel_confianca > 0;

  // Calcula dominância (ignorando "multiplo" e "desconhecido" no denominador)
  const denominador = counts.vem_na_loja + counts.distancia + counts.fiel_confianca;
  if (denominador === 0) {
    return { perfil: 'desconhecido', paga_com_cheque, qtd_compras: total };
  }

  if ((counts.vem_na_loja / denominador) >= 0.7) {
    return { perfil: 'presencial_dominante', paga_com_cheque, qtd_compras: total };
  }
  if ((counts.distancia / denominador) >= 0.7) {
    return { perfil: 'remota_dominante', paga_com_cheque, qtd_compras: total };
  }
  if ((counts.fiel_confianca / denominador) >= 0.7) {
    return { perfil: 'fiel_cheque', paga_com_cheque: true, qtd_compras: total };
  }

  return { perfil: 'hibrida', paga_com_cheque, qtd_compras: total };
}

// ─── DETECÇÃO DE NOVIDADE REAL ──────────────────────────────────────────────

/**
 * Verifica se uma REF é "novidade real" (nunca teve venda registrada).
 * Recebe a lista de vendas históricas filtrada por essa REF.
 */
export function ehNovidadeReal(ref, vendasHistoricasDaRef) {
  if (!ref) return false;
  const refNorm = refSemZero(ref);
  
  // Se já existem vendas pra essa REF (em qualquer momento), não é novidade real
  if (vendasHistoricasDaRef?.length > 0) return false;
  
  return true;
}

/**
 * Calcula a janela de "novidade ativa" baseada na data de entrega da OFICINA.
 * 
 * ⚠️ IMPORTANTE: data_entrega vem do MÓDULO OFICINAS (não sala de corte).
 *    Sala de corte = enfesto + corte do tecido.
 *    Módulo OFICINAS = recebe corte e entrega pra costureira costurar.
 *    A data de entrega é quando a peça VOLTA da costureira pronta.
 *
 * Janela padrão: 5-12d após entrega
 * Janela com caseado (Ficha Técnica.custo_caseado > 0): 7-14d
 *
 * Retorna { em_janela: bool, dias_desde_entrega, motivo }
 */
export function calcularJanelaNovidade(dataEntregaOficina, temCaseado = false, hoje = null) {
  if (!dataEntregaOficina) {
    return { em_janela: false, motivo: 'sem_data_entrega' };
  }

  const dataEntrega = new Date(dataEntregaOficina);
  const dataHoje = hoje ? new Date(hoje) : new Date();
  const ms_por_dia = 1000 * 60 * 60 * 24;
  const diasDesdeEntrega = Math.floor((dataHoje - dataEntrega) / ms_por_dia);

  const janela = temCaseado
    ? REGRAS_NOVIDADE.janela_caseado_dias
    : REGRAS_NOVIDADE.janela_padrao_dias;

  if (diasDesdeEntrega < janela.inicio) {
    return {
      em_janela: false,
      motivo: temCaseado ? 'aguardando_passadoria_e_caseado' : 'aguardando_passadoria',
      dias_desde_entrega: diasDesdeEntrega,
      dias_para_iniciar: janela.inicio - diasDesdeEntrega,
    };
  }

  if (diasDesdeEntrega > janela.fim) {
    return {
      em_janela: false,
      motivo: 'fora_janela_novidade',
      dias_desde_entrega: diasDesdeEntrega,
    };
  }

  return {
    em_janela: true,
    motivo: 'novidade_ativa',
    dias_desde_entrega: diasDesdeEntrega,
    janela_termina_em: janela.fim - diasDesdeEntrega,
  };
}

// ─── RESOLUÇÃO DE NOME DO MODELO POR REF ────────────────────────────────────

/**
 * Retorna a descrição do modelo pra ser usada na mensagem (ex: "calça linho").
 * Se a REF veio com zero à esquerda e descrição vazia, tenta achar a versão
 * sem zero. Se ainda assim não achar, retorna null (caller decide o fallback).
 */
export function nomeModeloPorRef(ref, fichaTecnica) {
  if (!ref || !fichaTecnica) return null;
  const refNorm = refSemZero(ref);

  // Tenta primeiro a REF normalizada
  const direto = fichaTecnica.find(f => refSemZero(f.ref) === refNorm);
  if (direto?.descricao) return direto.descricao;

  // Sem descrição: tenta variantes (com zero, com zero+outras)
  const variantes = [`0${refNorm}`, `00${refNorm}`, `000${refNorm}`];
  for (const v of variantes) {
    const item = fichaTecnica.find(f => f.ref === v);
    if (item?.descricao) return item.descricao;
  }

  return null;
}

/**
 * Constrói uma frase amigável pra a IA usar na mensagem.
 * Recebe a descrição original (ex: "CALÇA VISCOLINHO PANTALONA COS LARGO")
 * e simplifica pra "calça viscolinho pantalona".
 *
 * Regras:
 *   • lowercase
 *   • Mantém: categoria + tecido + caimento principal (1ª palavra após tecido)
 *   • Remove: detalhes (decote, manga, fivela, busto, etc) — fica longo demais
 *
 * Pegada do tecido: usa o que aparece PRIMEIRO na descrição (não o primeiro
 * da lista). Isso garante que "CALÇA LINHO/ALGODÃO" → "calça linho" (linho
 * é o material principal, vem antes na descrição).
 *
 * Caso especial: tecidos compostos (viscolinho contém "linho"). Como
 * "viscolinho" aparece sempre ANTES de "linho" na string (mesmo offset, mais
 * caracteres), e usamos indexOf, viscolinho sempre ganha quando ambos batem
 * no mesmo ponto. ✓
 */
export function construirFraseProduto(descricaoOriginal) {
  if (!descricaoOriginal) return null;

  const desc = String(descricaoOriginal).trim().toLowerCase();
  if (!desc) return null;

  // Categoria: ainda usa primeira da lista (sem caso de bug reportado)
  const categorias = ['calça', 'calca', 'macacão', 'macacao', 'vestido', 'conjunto',
                      'blusa', 'saia', 'shorts', 'short', 'body', 't-shirt', 'tshirt',
                      'regata', 'pantalona'];
  // Tecidos: pega o que aparece primeiro na descrição (não na lista)
  const tecidos = ['viscolinho', 'viscose', 'algodão', 'algodao',
                   'poliamida', 'crepe', 'malha', 'linho'];

  let categoria = '';
  for (const c of categorias) {
    if (desc.includes(c)) { categoria = c; break; }
  }

  // Acha o tecido com menor indexOf (que aparece primeiro na descrição).
  // Tecidos compostos como "viscolinho" sempre vencem "linho" no mesmo offset
  // porque a checagem de "viscolinho" acontece e seu indexOf é menor ou igual.
  let tecido = '';
  let menorIdx = Infinity;
  for (const t of tecidos) {
    const idx = desc.indexOf(t);
    if (idx >= 0 && idx < menorIdx) {
      menorIdx = idx;
      tecido = t;
    }
  }

  // Caso 1: tem ambos → "calça linho"
  if (categoria && tecido) return `${categoria} ${tecido}`;
  // Caso 2: só categoria → "vestido"
  if (categoria) return categoria;
  // Caso 3: só tecido → genérico "peça de linho"
  if (tecido) return `peça de ${tecido}`;
  // Caso 4: nada reconhecido → primeiras 3 palavras
  return desc.split(/\s+/).slice(0, 3).join(' ');
}

// ─── CÁLCULO DE DIAS DE SACOLA ──────────────────────────────────────────────

/**
 * Calcula dias desde a separação inicial do pedido em espera.
 * Usa data_cadastro_sacola (FIXA, quando virou em espera) — não data_atualizado.
 */
export function calcularDiasSacola(dataCadastroSacola, hoje = null) {
  if (!dataCadastroSacola) return null;
  const cadastro = new Date(dataCadastroSacola);
  const dataHoje = hoje ? new Date(hoje) : new Date();
  const ms_por_dia = 1000 * 60 * 60 * 24;
  return Math.floor((dataHoje - cadastro) / ms_por_dia);
}

/**
 * Verifica se houve atividade recente na sacola (cliente acrescentando peças).
 * Útil pra IA calibrar tom: pedido parado vs pedido sendo trabalhado.
 */
export function temMovimentoRecenteSacola(dataAtualizado, hoje = null) {
  if (!dataAtualizado) return false;
  const atualizado = new Date(dataAtualizado);
  const dataHoje = hoje ? new Date(hoje) : new Date();
  const ms_por_dia = 1000 * 60 * 60 * 24;
  const diasDesdeUltimaMex = Math.floor((dataHoje - atualizado) / ms_por_dia);
  return diasDesdeUltimaMex <= 3;
}

// ─── DETECTOR DE STATUS GERAL ───────────────────────────────────────────────

/**
 * Determina o status visual da cliente baseado em dias sem comprar.
 * SEPARANDO_SACOLA sobrescreve se cliente tem pedido em espera ativo.
 */
export function calcularStatusCliente(diasSemComprar, temPedidoSacolaAtivo = false) {
  if (temPedidoSacolaAtivo) return 'separandoSacola';
  if (diasSemComprar === null || diasSemComprar === undefined) return 'arquivo';
  if (diasSemComprar <= 45) return 'ativo';
  if (diasSemComprar <= 90) return 'atencao';
  if (diasSemComprar <= 180) return 'semAtividade';
  if (diasSemComprar <= 365) return 'inativo';
  return 'arquivo';
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTAÇÕES AGRUPADAS (conveniência)
// ═══════════════════════════════════════════════════════════════════════════

export default {
  META,
  SYSTEM_PROMPT_SUGESTOES,
  SYSTEM_PROMPT_MENSAGENS,
  EXEMPLOS_FEW_SHOT,
  REGRAS_TOM,
  REGRAS_NOVIDADE,
  FASES_CICLO_VIDA,
  STATUS_CLIENTE,
  SUBTIPOS_SACOLA,
  CATEGORIAS_PAGAMENTO,
  REGRAS_FILTRO_VAREJO,
  USUARIOS_ACESSO_TOTAL,
  VENDEDORAS_INICIAIS,
  LISTAS_PRODUTOS_INICIAIS,
  FILTRO_ESTOQUE,
  // helpers
  ehUsuarioAdmin,
  refSemZero,
  normalizarTelefone,
  escolherTelefone,
  detectarLojaPorArquivo,
  detectarCanal,
  calcularCanalDominante,
  ehVendaVarejo,
  detectarClienteSinalizado,
  resolverVendedora,
  importarApelidoComprador,
  calcularFaseCicloVida,
  classificarPedidoSacola,
  categorizarPagamento,
  calcularPerfilPresenca,
  ehNovidadeReal,
  calcularJanelaNovidade,
  nomeModeloPorRef,
  construirFraseProduto,
  calcularDiasSacola,
  temMovimentoRecenteSacola,
  calcularStatusCliente,
};
