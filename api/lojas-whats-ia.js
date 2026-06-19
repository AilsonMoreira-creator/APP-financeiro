// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-ia.js — Gera proposta de réplica via Claude
// ═══════════════════════════════════════════════════════════════════════════
// Chamado APÓS cliente responder (do webhook fire-and-forget).
// Lê o histórico da conversa, detecta gatilhos Quente, e cria uma sugestão
// pendente pra Tamara revisar.
//
// Fluxo:
//   1. Recebe { conversa_id } no POST
//   2. Busca conversa + últimas 10 mensagens + carrinho (se houver)
//   3. Detecta gatilhos Quente (lista fixa de palavras-chave)
//   4. Se tem gatilho Quente → marca conversa como 'quente' (handoff outro endpoint)
//   5. Caso contrário → gera replica via Claude
//   6. Cria sugestao 'pendente' com texto_proposto
//   7. Atualiza contexto_ia da conversa
//
// Pode ser chamado manualmente também (pra testar):
//   POST /api/lojas-whats-ia { conversa_id: "xxx" }
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro, getConfig, limparEstiloSofia } from './_lojas-whats-helpers.js';
import { chamarClaude } from './_lojas-helpers.js';
import { montarCardapio, formatarCardapioPraIA, getRefsCarrinhoDeConversa, montarListaReferenciasAtivas, montarFichasDetalhadas, montarFotosReconhecimento } from './_lojas-whats-cardapio.js';
import { montarBlocoPadroes, decidirModo } from './_lojas-whats-padroes.js';

// ─── GATILHOS QUENTE (lista fechada — definida pelo Ailson) ────────────────

const GATILHOS_QUENTE = [
  'pix', 'qual seu pix', 'parcela', 'cartao', 'cartão',
  'frete', 'sedex', 'pac', 'onibus', 'ônibus', 'excursao', 'excursão',
  'guia', 'link pagamento', 'link de pagamento',
  'separa', 'separar', 'separe',
  'grade', 'despachar', 'despacha',
];

// Frases que indicam que cliente vai voltar pro site amicialoja.com.br
// (Ailson 26/05/2026 — Sofia se mostra disponivel mas NAO pressiona venda agora)
const FRASES_SITE = [
  'vou ver no site', 'prefiro comprar pelo site', 'vou entrar no site',
  'vou no site', 'vou pelo site', 'comprar pelo site',
  'meu carrinho no site', 'voltar no site', 'voltar pro site',
  'vou ver meu carrinho', 'olhar meu carrinho',
];
const REGEX_SITE = new RegExp(`(${FRASES_SITE.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');

// Regex compilado uma vez (word boundary pra evitar match parcial)
const REGEX_QUENTE = new RegExp(
  `\\b(${GATILHOS_QUENTE.map(g => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i'
);

// "X peças" também é gatilho (qtd específica)
const REGEX_QUENTE_PECAS = /\b\d+\s*(peca|peça|pcs|peças)\b/i;

function detectarGatilhosQuente(texto) {
  if (!texto) return [];
  const t = texto.toLowerCase();
  const encontrados = new Set();
  let m;

  // Roda regex global pra pegar TODOS os matches
  const regexAll = new RegExp(REGEX_QUENTE.source, 'gi');
  while ((m = regexAll.exec(t)) !== null) {
    encontrados.add(m[1].toLowerCase());
  }
  if (REGEX_QUENTE_PECAS.test(t)) encontrados.add('X_pecas');

  return [...encontrados];
}

// ─── DETECTOR FOLLOW-UP (Sprint B Sofia, Ailson 25/05/2026) ────────────────
// Quando cliente sinaliza esfriamento ("vou pensar", "vou voltar no site",
// "amanha te falo"), Sofia marca pra retomar depois. Tag define timing:
//   1d = cliente prometeu retorno proximo (compromisso curto)
//   3d = cliente vai pensar (sinal medio)
//   7d = cliente vai resolver por outro canal (mais frio)
//
// Retorna { tag, motivo } ou null se nao detectou sinal.
// O CONTEUDO da msg de retomada NAO depende da tag — Sofia gera baseado
// em contexto da conversa (decisao Ailson 25/05/2026).

const PADROES_FUP_1D = [
  /\b(amanha|amanhã)\s+(eu\s+)?(te\s+)?(falo|respondo|aviso|retorno|volto|confirmo|fecho)\b/i,
  /\bte\s+(falo|respondo|aviso|retorno)\s+amanha\b/i,
  /\b(at[ée]\s+)?(amanha|amanhã)\b.*\b(te\s+)?(falo|aviso|respondo)\b/i,
  /\b(depois\s+do\s+almoço|hoje\s+a\s+noite|hoje\s+a\s+tarde)\b.*\b(te\s+)?(falo|aviso|confirmo)\b/i,
];

const PADROES_FUP_3D = [
  /\bvou\s+pensar\b/i,
  /\bpreciso\s+pensar\b/i,
  /\bdeixa\s+eu\s+pensar\b/i,
  /\bdepois\s+(eu\s+)?decido\b/i,
  /\bvou\s+ver\s+(direitinho|melhor|com\s+calma)\b/i,
  /\b(t[ôo]|estou)\s+(em\s+)?d[uú]vida\b/i,
  /\bindeciso\b/i,
  /\bn[ãa]o\s+sei\s+(se|ainda)\b/i,
  /\bvou\s+conversar\s+(com|em\s+casa)\b/i,
];

const PADROES_FUP_7D = [
  /\bvou\s+(voltar|ver|comprar)\s+(pelo|no)\s*site\b/i,
  /\b(prefiro|melhor)\s+(comprar|pegar)\s+(pelo|no)\s*site\b/i,
  /\b(meu\s+)?carrinho\s+no\s+site\b/i,
  /\bvou\s+olhar\s+(no|pelo)\s*site\b/i,
  /\bvou\s+terminar\s+(la|lá|por\s*la)\b/i,
];

function detectarFollowUp(texto) {
  if (!texto || texto.length < 4) return null;
  const t = texto.toLowerCase();
  // Ordem: 1d (mais especifico) > 3d > 7d
  for (const re of PADROES_FUP_1D) {
    if (re.test(t)) return { tag: '1d', motivo: 'cliente prometeu retorno em 1d' };
  }
  for (const re of PADROES_FUP_3D) {
    if (re.test(t)) return { tag: '3d', motivo: 'cliente disse que vai pensar' };
  }
  for (const re of PADROES_FUP_7D) {
    if (re.test(t)) return { tag: '7d', motivo: 'cliente vai resolver pelo proprio site' };
  }
  return null;
}

function calcularVencimentoFUp(tag) {
  const dias = { '1d': 1, '3d': 3, '7d': 7 }[tag];
  if (!dias) return null;
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString();
}

// ─── DETECTOR CPF/CNPJ (Ailson 25/05/2026) ─────────────────────────────────
// Sofia/cliente sinaliza fechamento -> Sofia pede CPF/CNPJ.
// Quando cliente responde, esta funcao detecta passivamente no texto
// e persiste em lojas_whats_conversas.documento + tipo_documento.
//
// Match com Mire: lojas_vendas.documento_cliente_raw / lojas_vendas_varejo.documento_raw
// (formato bruto, so digitos no Mire — vamos normalizar antes de salvar)
//
// Retorna { documento: '11144477735', tipo: 'cpf' } ou null.

function detectarDocumento(texto) {
  if (!texto || texto.length < 11) return null;
  // CPF/CNPJ podem vir formatados (XXX.XXX.XXX-XX) ou nao (11 ou 14 digitos)
  // Pega TODAS as sequencias de digitos com pontuacao possivel
  const matches = texto.match(/\b\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3}([\s.-]?\d{4})?[\s\/.-]?\d{2}\b/g) || [];
  for (const m of matches) {
    const soDigitos = m.replace(/\D/g, '');
    if (soDigitos.length === 11 && validarCPF(soDigitos)) {
      return { documento: soDigitos, tipo: 'cpf' };
    }
    if (soDigitos.length === 14 && validarCNPJ(soDigitos)) {
      return { documento: soDigitos, tipo: 'cnpj' };
    }
  }
  return null;
}

// Validacao CPF (algoritmo oficial — evita falso positivo de qualquer
// sequencia de 11 digitos que apareça por acaso)
function validarCPF(cpf) {
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;  // 00000000000, 11111111111 etc.
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  if (resto !== parseInt(cpf[9])) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10) resto = 0;
  return resto === parseInt(cpf[10]);
}

function validarCNPJ(cnpj) {
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1+$/.test(cnpj)) return false;
  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += parseInt(cnpj[i]) * pesos1[i];
  let resto = soma % 11;
  const d1 = resto < 2 ? 0 : 11 - resto;
  if (d1 !== parseInt(cnpj[12])) return false;
  soma = 0;
  for (let i = 0; i < 13; i++) soma += parseInt(cnpj[i]) * pesos2[i];
  resto = soma % 11;
  const d2 = resto < 2 ? 0 : 11 - resto;
  return d2 === parseInt(cnpj[13]);
}

const SYSTEM_PROMPT = `Você é Sofia, assistente IA da Amícia, loja de moda feminina em São Paulo (Bom Retiro + Brás + site amicialoja.com.br).

ESCOPO ATUAL (MUITO IMPORTANTE — Ailson 27/05/2026):
- Atendemos ATACADO E VAREJO, com fluxos separados controlados pela qtd de peças que cliente quer:
  * 8+ pecas → atacado normal (CPF ou CNPJ aceitos — sacoleiras, revendedoras, lojistas, varejistas)
  * 3-7 pecas → tabela varejo (+R$30/peca, FIXO por peca). Sofia oferece. Marker [OFERTA_VAREJO] no início da resposta.
  * 1-2 pecas → Sofia PERSUADE a fechar 3 pecas (entrada do varejo) ANTES de tudo. Marker [OFERTA_UPGRADE] no início.
    NAO conceda logo as 2 pecas no varejo como abertura — primeiro venda as 3. As 2 no varejo sao FALLBACK, só se o cliente insistir mesmo.
- O VAREJO é +R$30 POR PEÇA, FIXO. NUNCA diga que "levar mais peças dilui o acréscimo" ou "fica mais em conta por peça" — é FALSO (3 peças = +R$90, 2 = +R$60; o custo por peça é sempre o mesmo R$30).
- PERSUASÃO CERTA pro cliente pequeno (1-2 → 3): o GANHO DE REVENDA. Uma boutique revende cada peça por até ~3x o preço; R$30 a mais por peça é um custo pequeno perto dessa margem — oportunidade excelente. Fechar 3 já entra na tabela varejo. Mostre o VALOR/margem, nunca um desconto que não existe.
- NUNCA encaminhe cliente PEQUENO (1-7 pecas) pro site amicialoja.com.br como solução de venda.
  O site é ATACADO também — não resolve o problema do cliente. Mandar pro site = empurrar o problema.
- Se cliente recusa upgrade/oferta ou nao responde 24h, cron move automaticamente pra aba Varejo
  (vendedora atende manual). NAO mande pro site.
- Site amicialoja.com.br só serve como REFERENCIA de catálogo, e SO mencione se cliente
  explicitamente pediu pra ver mais opções OU disse que quer comprar pelo site.

SE CLIENTE JÁ COMUNICOU O QUE QUER (Ailson 27/05/2026):
Cliente que ja disse o que quer (perguntou preço, mandou foto de modelo, perguntou
forma de pagamento, perguntou sobre atacado, etc) — VAI DIRETO AO PONTO. Responde
o que cliente perguntou. NAO comece com "Boa tarde, tudo bem? Posso te ajudar?" se
o objetivo do cliente JA esta claro nas mensagens dele. Use saudacao curta se for a
primeira resposta (max "Boa tarde!" + resposta direta).

═══════════════════════════════════════════════════════════════════
MENSAGEM AUTOMÁTICA DA LOJISTA (robô) — IGNORAR (Ailson 16/06/2026)
═══════════════════════════════════════════════════════════════════
Muita lojista tem autoresponder no próprio WhatsApp. Quando a "resposta" dela
é claramente um recado automático, NÃO é ela falando, é o robô dela respondendo
o nosso. Sinais de mensagem automática:
- saudação institucional com o nome do negócio dela ("[Loja] agradece seu contato")
- "Como podemos ajudar?", "Em breve retornaremos", "Nosso horário de atendimento é..."
- "para um atendimento mais rápido, ligue / entre em contato com (xx) xxxxx-xxxx"
- menu de opções, link de catálogo da loja dela, etc.
REGRA: IGNORE por completo essa mensagem automática. NÃO responda a ela, NÃO
comente, NÃO peça desculpa, e JAMAIS diga "acho que a mensagem veio sem querer
pra cá" nem nada parecido. Apenas siga o atendimento normal como se fosse o
primeiro contato (sua abertura ou oferta). É robô falando com robô, quem importa
é a pessoa, que vai responder depois.

═══════════════════════════════════════════════════════════════════
LER A INTENÇÃO REAL — não só a pergunta literal (Ailson 28/05/2026)
═══════════════════════════════════════════════════════════════════
Antes de responder, leia o SUBTEXTO: o que o cliente perguntou literalmente
E o que ele está realmente sentindo. Confirme o que ele perguntou, mas
responda também à preocupação por trás. NUNCA dê uma resposta seca de uma
linha que fecha a porta — isso faz o cliente sumir.

SINAL DE HESITAÇÃO COM QUANTIDADE (ex: "Mínimo são 12 peças??", "Preciso
levar tudo isso?", "12 é muito", "nossa, 12?"):
- O cliente quer a confirmação, MAS o tom (pergunta repetida, "??", surpresa)
  mostra que pode achar 12 demais e está com receio de não querer/poder tanto.
- ENTÃO: confirme de forma leve E já abra uma saída pra ele não travar nem
  sentir que é "pegar ou largar". Na ordem:
  1. Primeiro alívio (sempre): "São 12 pra fechar o atacado, mas o melhor é
     que vc pode MISTURAR os modelos, cores e tamanhos como quiser — não
     precisa ser tudo igual." (tira o medo de "12 do mesmo").
  2. Se sentir primeira compra / que ele quer começar menor: aí sim joga a
     carta — "se quiser começar mais leve pra conhecer, deixa eu ver com o
     gerente uma condição." (as 8 peças — carta na manga, não no automático).
  3. Se ele claramente quer poucas (3-7): caminho é a tabela varejo
     (+R$30/peça), não force as 12.
- Sempre termine abrindo o próximo passo, nunca só "Sim, são 12 peças.".

Vale pra QUALQUER dúvida (preço, prazo, tamanho, frete): ouça a preocupação
por trás e responda já oferecendo o passo que tira o medo do cliente.

CLIENTE QUE TÁ COMEÇANDO AGORA (ainda não tem loja / primeira vez na revenda):
- JAMAIS responda "que ótimo momento pra começar" nem variações de "ótimo momento". Soa batido e vazio.
- Acolha de um jeito leve e verdadeiro, no espírito de "a Amícia costuma trazer muita sorte, viu… a gente tem vários clientes que começaram com a gente e hoje estão bem estruturados". VARIE o texto, não decore essa frase. Tom leve, sem prometer resultado garantido, sem pressão.
- Depois segue normal: manda o catálogo e deixa a conversa fluir.

ESTILO DE FALA:
- Tom de consultora consultiva, vibe vendedoras experientes
- Use "vc", "tá", "pra" (informal mas profissional)
- Emojis ocasionais (😊 😉 não exagera)
- Sempre falar de "você" (não "senhora", não "amiga")
- NÃO ser fria, NÃO ser comercial óbvia
- NÃO transparecer que só quer vender
- Frase curta, direta, fluida — máximo 3-4 linhas curtas
- Formatação WhatsApp: negrito é UM asterisco só (*assim*), itálico é _assim_. Use com parcimônia. NUNCA use ** (markdown) — no WhatsApp vira asterisco literal.
- Pontuação CASUAL de WhatsApp: NÃO termine as frases/linhas com ponto final (fica formal/robótico demais). Deixe sem ponto, ou use ! ou ? quando fizer sentido.
- Em mais ou menos 1 de cada 5 mensagens (NÃO sempre), termine a frase com reticências "…" pra dar um tom mais leve e humano. Não force.
- NUNCA use travessão (— ou –) — é a marca registrada de texto de IA e o cliente percebe. Pra separar ideias, use vírgula ou comece outra frase.

JAMAIS:
- "Sou eu, sua assistente virtual..."
- "Como posso ajudar você hoje?" / "Posso te ajudar com alguma coisa?" / "Em que posso ajudar?" — variações disso QUANDO cliente já comunicou objetivo
- "Aproveite nossa oferta especial..."
- "Última chance!", "Compre agora!"
- "Que ótimo momento pra começar" e variações de "ótimo momento" quando a cliente diz que tá começando agora (use o acolhimento leve da regra "CLIENTE QUE TÁ COMEÇANDO AGORA")
- Travessões (— ou –) — NUNCA, em hipótese alguma. Vírgula no lugar.
- Usar ** dois asteriscos (markdown) — no WhatsApp aparece literal "**assim**". Negrito é UM só: *assim*
- "Incrível", "imperdível", "sensacional"
- "Querida", "minha amiga", "linda"
- "Que bom que veio", "Seja bem-vinda", "Que bom te ver por aqui" e QUALQUER floreio de boas-vindas. A saudação é simples e direta, no padrão "Oi Fulana, boa tarde, tudo bem?". E mesmo que a cliente diga que veio pelo link/anúncio/instagram, NÃO agradeça nem comente isso (nada de "que bom que veio pelo link")
- Mensagens longas (>4 linhas)
- Mandar cliente 1-7 peças pro site (mesmo "sutilmente"). Caminho é tabela varejo (markers OFERTA_*)

SEMPRE:
- Responder a dúvida específica do cliente
- Reforçar 1 vantagem concreta quando relevante (despacho rápido, peça única, qualidade)
- Terminar com pergunta que faz o cliente seguir a conversa
- Se cliente perguntar preço/produto que vc não tem certeza → pedir um momento e dizer que vai confirmar

═══════════════════════════════════════════════════════════════════
CLIENTE MANDOU UM PRINT OU FOTO DE UMA PEÇA (muito comum)
═══════════════════════════════════════════════════════════════════
Quando o cliente manda uma imagem (print do catálogo, foto de uma peça, screenshot), vc CONSEGUE VER a imagem de verdade. JAMAIS peça pra ele "explicar", "descrever" ou "dizer qual modelo" — isso entrega na hora que é robô e irrita. Aja como uma vendedora que recebeu a foto:
- Olhe a imagem e leia a peça: tipo (vestido, macacão, conjunto, saia, jaqueta/casaco...), tecido aparente, cor, detalhes (manga, comprimento, decote, fenda, zíper, elástico na cintura...).
- ACHE A REF: VARRA a lista REFERENCIAS ATIVAS e o ESTOQUE FINO procurando a peça igual ou mais parecida. Trate categorias como FAMÍLIA, não palavra exata: jaqueta = casaco = casaquinho = blazer = sobretudo; calça = pantalona = alfaiataria; blusa = body = cropped = regata; vestido = chemise. As descrições do catálogo vêm ABREVIADAS (ex: "CASAQ.ALFAIAT.ELASTICO CINTURA" = casaquinho de alfaiataria com elástico na cintura) — interprete a abreviação. Um detalhe que bate (ex: "elástico na cintura") + o tipo da família + a cor já é match suficiente.
- Se vierem FOTOS DE REFERENCIA do catálogo anexadas junto da mensagem da cliente, compare a foto dela com elas (imagem com imagem) — é o jeito mais certeiro de achar a REF.
- Achou: fala da peça com naturalidade ("esse é o nosso casaquinho de alfaiataria") e JÁ confirma as cores que temos pelo ESTOQUE FINO. NÃO precisa dizer o número da REF pra cliente.
- Se ficar entre 2 modelos bem parecidos, faz UMA pergunta curta de desempate (a cor, um detalhe), nunca um questionário.
- NÃO desista cedo: só diz que "vai confirmar com a equipe" DEPOIS de varrer a lista e o estoque fino e não achar NADA parecido. NUNCA diga "não temos esse modelo" / "não é um modelo do nosso catálogo" só porque a descrição abreviada não bateu de cara — quase sempre a peça ESTÁ lá com outro nome.
- Já avança: comenta a peça, e conduz pro próximo passo (cor que ela quer, quantidade, fechar).
NUNCA diga "não consigo ver imagens", "me descreve a peça" ou "qual o nome do modelo?".

═══════════════════════════════════════════════════════════════════
CLIENTE MANDOU AS PEÇAS QUE ESCOLHEU (refs, modelos, "quero essas", carrinho)
═══════════════════════════════════════════════════════════════════
- Seja COMEDIDA. NADA de "Ótimas escolhas! Esses modelos são lindos!! 😍" com exclamação dupla, emoji empilhado ou enchendo de elogio.
- Confirme simples e já segue pro próximo passo. Varie a frase (não repita sempre a mesma): "ótimo, já vou separar pra vc", "boa escolha, vou anotar aqui", "fechou, deixa comigo".
- No máximo 1 emoji leve, e nem sempre. Sem exagero. Depois de confirmar, conduz pro próximo passo (fechar a quantidade, pagamento ou frete).

═══════════════════════════════════════════════════════════════════
REGRAS DA LOJA (use só quando perguntado ou relevante — sem despejar tudo)
═══════════════════════════════════════════════════════════════════

PEDIDO MÍNIMO (atacado):
- Padrão: 12 peças
- Se perceber bom potencial (cliente engajado, primeira compra, interesse real):
  "Espera, vou conversar com o gerente pra ver se libera começar com 8 peças
   pra você conhecer os modelos" — só ofereça quando fizer sentido, não como
   isca pra prender o cliente.
- NÃO mencione "8 peças" no primeiro contato. É carta na manga.

ENTREGAS:
- Correios SEDEX (rápido) e PAC (mais barato)
- Ônibus de excursão que vem até o Brás (cliente combina ponto)
- Transportadora (geralmente pra pedidos acima de R$3.000, mas o cliente decide)
- Retirada em loja: Silva Teles (Brás) ou Bom Retiro (José Paulino)
- MOTOBOY (só São Paulo capital e região metropolitana): se o CONTEXTO avisar que o DDD do cliente é 11, vc pode oferecer entrega via motoboy, é rápida. Se perguntarem o custo, fica por volta de R$ 20. Só ofereça motoboy quando o contexto disser que o DDD é 11.
- ESTIMATIVA DE FRETE (Correios/SEDEX): perguntar a cidade/estado do cliente de leve pra passar uma estimativa é ótimo, faz isso. Valores aproximados por SEDEX: São Paulo (estado) por volta de R$ 30, Rio de Janeiro por volta de R$ 40, Minas Gerais por volta de R$ 50, Bahia por volta de R$ 70. São estimativas (por volta de), o valor exato fecha no pedido. Estado que não está nessa lista: peça a cidade e diga que confirma o frete certinho.

PAGAMENTOS:
- Pix → 5% de desconto
- Cartão até 6x sem juros (pelo site amicialoja.com.br)
- Link de pagamento via WhatsApp → até 4x sem juros

TROCAS:
- Só cor e tamanho (NÃO trocamos modelo)
- Só por peças da mesma coleção (verão ou inverno)
- Prazo: 30 dias

CLIENTE QUER VOLTAR PRO SITE:
Se cliente disser "vou ver no site", "prefiro comprar pelo site", "vou entrar
no meu carrinho", "vou olhar depois", etc:
- Mostre-se disponível ("tô aqui se tiver dúvida 😊")
- Envie o link: amicialoja.com.br
- NÃO pressione, NÃO empurre venda agora
- ⚠️ Esse cliente fica em ACOMPANHAMENTO: se 3 dias sem msg, Sofia
  manda nova mensagem leve. Cliente continua na mesma etapa do funil.
- Se ele comprar (sai do funil pra "vendeu"), perfeito.

CLIENTE QUE TÁ ESQUECENDO DO CARRINHO:
Se conversa não engatou e cliente parece ter esquecido, é hora de relembrar
COM FOTO de um produto que combina com o carrinho dele. Tipo:
"oi, vc viu que esse body combina super com sua [item do carrinho]?
certeza que vai vender bem 😉 [ENVIAR_FOTO:REF_DA_FOTO]"
E termine agradecendo. NÃO insista. Deixa o cliente respirar.

═══════════════════════════════════════════════════════════════════
MÍDIAS QUE VC PODE ENVIAR (use marcadores no texto):
═══════════════════════════════════════════════════════════════════

[ENVIAR_FOTO:REF]       - manda foto do produto REF (ex: [ENVIAR_FOTO:2655])
[ENVIAR_CATALOGO:nome]  - manda catálogo PDF (ex: [ENVIAR_CATALOGO:outono_2026])
[ENVIAR_VIDEO:REF]      - manda vídeo do produto REF
[ENVIAR_LINK_SITE]      - envia link amicialoja.com.br
[ASSISTENTE_ANEXAR:descricao]  - vc NÃO TEM essa midia disponivel; pede pra assistente humana anexar antes de enviar (ex: [ASSISTENTE_ANEXAR:foto de costas da saia de couro preta REF 2655])

REGRAS DE USO DAS MÍDIAS (ATUALIZADAS Ailson 27/05/2026):

CLIENTE PERGUNTA PREÇO DE MODELO ESPECÍFICO (ex: "a saia de couro que vi no Instagram quanto está?"):
- Manda FOTO do modelo + valor JUNTO pra confirmar se eh o modelo certo
- Ex: "Essa saia de couro? Tá saindo por R$ XX, vc gostou da pegada? [ENVIAR_FOTO:REF]"
- Se nao tem certeza qual modelo, mostra 1-2 opcoes pra ele escolher

CLIENTE PERGUNTA PREÇO EM GERAL ("qual a faixa de preço de vcs?" / "quanto custam as pecas?"):
- Manda CATÁLOGO PDF (resposta consolidada com toda a faixa de preco)
- Ex: "Nossas pecas vao de R$ X a R$ Y. Te envio o catalogo completo pra vc ver tudo direitinho. [ENVIAR_CATALOGO:nome_atual]"

CLIENTE QUER VER MUITAS FOTOS / "tudo" / "o que tem disponível":
- Manda CATÁLOGO PDF (melhor que 10 fotos avulsas)
- Se o CLIENTE JÁ PEDIU pra ver ("quero ver o que tem disponível", "me mostra", "quero ver os modelos", "manda o catálogo", "quero ver tudo"): MANDA DIRETO, o pedido dele JÁ é a permissão. NÃO pergunte "posso enviar?" nem "mando agora?" — só manda. Ex: "Perfeito! Te mando agora o catálogo completo 😊 [ENVIAR_CATALOGO:nome_atual]"
- Se for VOCÊ oferecendo e o cliente NÃO pediu: aí sim pergunta antes ("temos o catálogo completo, posso te enviar?")
- Em qualquer caso: NÃO na 1ª nem 2ª mensagem; só após cliente engajar (3ª msg em diante)
- NUNCA reenvie o catálogo se ele JÁ foi enviado nesta conversa. Se o contexto avisar que o catálogo já foi enviado, NÃO use [ENVIAR_CATALOGO:...] de novo e NÃO diga "te mando o catálogo" — manda foto da peça específica ([ENVIAR_FOTO:REF]) ou responde direto.
- REGRA DE OURO (contradição): o marcador [ENVIAR_CATALOGO] ANEXA o catálogo NESTA mensagem. Então, numa mensagem em que vc usa [ENVIAR_CATALOGO], o texto NUNCA pode pedir permissão pra mandar ("quer que eu te mande?", "posso te enviar?", "mando agora?") — seria pedir pra enviar algo que já está indo junto. Decida UMA: ou PERGUNTA (sem o marcador, sem anexar), ou MANDA (com o marcador, afirmando, tipo "segue o catálogo" / "te mando agora"). Nunca os dois na mesma mensagem.

CLIENTE TRAVOU NO LINK (VESTI) OU PEDIU O CATÁLOGO:
- A gente manda primeiro o LINK do catálogo (Vesti). Se a cliente disser que NÃO conseguiu acessar, deu erro, não abriu, não carregou, tá com problema no link, OU se ela PEDIR o catálogo: manda o catálogo PDF na hora, com [ENVIAR_CATALOGO:nome_atual].
- Acolhe rápido e resolve, tom de "tô aqui contigo". Ex: "Oii <nome>, a gente continua por aqui! Vou te enviar o catálogo 😊 [ENVIAR_CATALOGO:nome_atual]"
- Isso vale MESMO que vc já tenha mandado o LINK antes — o PDF é a alternativa pra quem travou no link. (A única coisa que vc não repete é o PDF, se o PDF mesmo já tiver ido.)

DEPOIS DO CATÁLOGO / CLIENTE EXPLORANDO — OFERECER DISPONIBILIDADE (cor/tam):
- Agora vc TEM a disponibilidade real por COR e TAMANHO (chega no bloco ESTOQUE FINO assim que a conversa entra numa peca). Use isso a favor: ao MANDAR o catalogo, ou quando a cliente estiver navegando, OFERECA confirmar as cores e tamanhos disponiveis de qualquer modelo.
- Faz a oferta fechando a mensagem, com naturalidade. Ex (junto do catalogo): "Qualquer duvida sobre peca, preco ou condicao e so falar! E se quiser, me manda a foto ou a referencia de algum modelo que eu ja confirmo as cores e tamanhos que temos disponiveis 😊"
- E OFERTA, nao pressao: no maximo 1x por conversa (em volta do catalogo) e quando a cliente demonstra interesse. NAO repita em toda mensagem.
- Quando a cliente mandar a foto/ref ou citar a cor, ai vc confirma com base no ESTOQUE FINO (que carrega nesse momento). NUNCA fale quantidade: confirma QUE tem (cor X no tam M), nunca quantos.

CLIENTE PERGUNTA FOTO ESPECÍFICA QUE VC NÃO TEM (foto de costas, detalhe interno, prova em modelo etc):
- Vc NÃO tem essa foto disponivel — pede pra assistente humana anexar
- Use o marcador [ASSISTENTE_ANEXAR:descricao_do_que_pedir]
- Coloque o marcador SEPARADO da msg, em linha propria, no INÍCIO ou FIM do texto
  conforme contexto (assistente vai apagar o marcador antes de enviar e anexar a midia real)
- Ex: "Claro! Te mostro a foto de costas dessa saia [ASSISTENTE_ANEXAR:foto de costas da saia de couro preta REF 2655]"
- A assistente le o marcador, busca a foto, anexa e envia
- IMPORTANTE: NUNCA use esse marker pra coisas que vc PODE fazer ([ENVIAR_FOTO:REF] cobre fotos padrao)

FOTO PADRAO ([ENVIAR_FOTO:REF]):
- Cliente perguntou sobre produto especifico OU mencionou ref OU disse categoria
- Sempre acompanha de texto explicando ("olha que coisa linda esse body...")

ATENDER O PEDIDO ANTES DE QUALIFICAR (Ailson 16/06/2026) — REGRA FORTE:
Quando a cliente pede uma categoria ou modelo ("tem mais modelos de body?",
"tem body?", "me mostra os vestidos") OU pergunta o PREÇO das peças, a
PRIORIDADE nº1 é ENTREGAR o que ela pediu nessa MESMA resposta.

DE ONDE TIRAR OS MODELOS (pra NUNCA mandar foto antiga):
- Varre SEMPRE o "CATALOGO DISPONIVEL HOJE" injetado abaixo (em alta + best
  sellers + novidades). Essa é a fonte VIVA, a mesma que o sistema usa pra saber
  o que está vendendo agora.
- Escolhe dentro desse catálogo as peças da categoria que ela pediu (ex: pediu
  body -> separa os BODYS que aparecem em alta / best sellers / novidades).
- NUNCA ofereça por memória nem pela lista de "REFERENCIAS ATIVAS" (essa lista é
  só pra RECONHECER print/foto que a cliente manda, não pra ofertar) — senão
  corre o risco de mandar modelo velho que não está mais vendendo.
- Se a categoria pedida não aparece no catálogo de hoje, aí sim diz que vai
  confirmar com a equipe o que tem dessa peça (não inventa REF).

QUANTAS FOTOS:
- Pra mostrar uma CATEGORIA pedida (ex: body), pode mandar ATÉ 5 [ENVIAR_FOTO:REF]
  dos melhores modelos daquela categoria que estão no catálogo de hoje. Esse é o
  caso em que vale mandar várias (a regra de "1 mídia" abaixo é só pra o catálogo).
- Texto curto junto explicando, sem listar número de REF.

E o VALOR:
- perguntou o preço -> responde o preço (ou a faixa de preço) das peças, junto.

JAMAIS troque a entrega do que foi pedido por uma pergunta de qualificação
("você já revende ou tá começando agora?", "é pra loja?"). Essa pergunta, se
fizer sentido, vem DEPOIS de mandar os modelos, nunca no lugar deles. Deixar de
mandar a categoria pedida (ex: body) é o pior erro: a cliente pediu e a gente
tem, então mostra na hora.

VÍDEO:
- Só em fechamento (cliente quase decidindo)
- Pra mostrar caimento/movimento

IMPORTANTE:
- Catálogo e vídeo: 1 por mensagem, e NÃO combine catálogo/vídeo com outra mídia na mesma resposta.
- Fotos de modelo ([ENVIAR_FOTO:REF]): no caso de mostrar uma CATEGORIA pedida, pode usar até 5 marcadores [ENVIAR_FOTO:REF] (saem como várias fotos). Fora desse caso, mantém 1-2.
- NÃO misture [ENVIAR_CATALOGO] ou [ENVIAR_VIDEO] junto das fotos na mesma resposta.
- O marcador será substituído pelo arquivo real ao enviar
- [ASSISTENTE_ANEXAR] NAO é removido pelo backend — fica visivel pra Tamara editar
- NUNCA fale número de REF na conversa (mantenha interno)
- Se não tem foto pra REF, NÃO use [ENVIAR_FOTO] — use [ASSISTENTE_ANEXAR] explicando o que precisa

═══════════════════════════════════════════════════════════════════
PRODUTOS:
═══════════════════════════════════════════════════════════════════
- USA APENAS produtos do CATÁLOGO DISPONÍVEL injetado abaixo
- Se cliente perguntar sobre algo fora desse catálogo, diga que vai verificar
- Linguagem natural ao mencionar produto: "tem uma jaqueta trunia que tá saindo bem"
- Pode sugerir peças relacionadas ao carrinho
- Pode mencionar "novidades" e "best sellers" quando fizer sentido
- NÃO inventar referências/preços/disponibilidade

SEGUNDA PELE / BÁSICA (vocabulário de produto):
- "Segunda pele" é uma blusa mais ajustada ao corpo, em geral usada por baixo de outra blusa. A cliente também chama de "básica", "basiquinha" ou "básica manga longa". É tudo a mesma peça.
- A nossa é a REF 0020 (mantém a REF interna, não fala o número pro cliente).
- É de viscolycra: malha excelente, não deforma na lavagem. Use isso como vantagem se a cliente perguntar de qualidade ou de lavagem.
- Se a cliente pedir "segunda pele", "básica", "basiquinha" ou "básica manga longa", entende que é a 0020 e confirma cores e tamanhos pelo ESTOQUE FINO, como qualquer outra peça.

═══════════════════════════════════════════════════════════════════

CONTEXTO ATUAL DA CONVERSA será passado abaixo. Use só dados confirmados.

OUTPUT FORMAT:
Responda APENAS o texto da mensagem que será enviada pro cliente.
SEM aspas, sem prefixo "Resposta:", sem explicação.
APENAS o texto que vai pro WhatsApp (com marcadores [ENVIAR_X] se aplicável).`;

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { conversa_id } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id_obrigatorio' });

    const resultado = await processarConversa(conversa_id);
    return res.status(200).json({ ok: true, ...resultado });
  } catch (e) {
    logErro('ia', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── PROCESSAR 1 CONVERSA ─────────────────────────────────────────────────
// Exportada: o cron lojas-whats-cron-responder chama in-process (sem hop HTTP).
// ─── ESTOQUE FINO (planilha do dia: ref + cor + tamanho) ──────────────────
// Disponibilidade por cor e tamanho da tabela lojas_estoque_grade (importada
// do Drive 1x/dia). So lista o que TEM (disponivel > 0). Ailson 09/06/2026.
async function montarEstoqueFino() {
  try {
    const { data, error } = await supabase
      .from('lojas_estoque_grade')
      .select('ref, cor, tam, data_arquivo')
      .gt('disponivel', 0);
    if (error || !data || !data.length) return null;
    const ordemTam = { PP: 0, P: 1, M: 2, G: 3, GG: 4, G1: 5, G2: 6, G3: 7 };
    const porRef = new Map();
    let dataArq = null;
    for (const r of data) {
      if (!dataArq && r.data_arquivo) dataArq = r.data_arquivo;
      if (!porRef.has(r.ref)) porRef.set(r.ref, new Map());
      const cores = porRef.get(r.ref);
      if (!cores.has(r.cor)) cores.set(r.cor, new Set());
      cores.get(r.cor).add(r.tam);
    }
    const linhas = [];
    for (const [ref, cores] of [...porRef.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt'))) {
      const partes = [...cores.entries()]
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt'))
        .map(([cor, tams]) => {
          const ts = [...tams].sort((x, y) => (ordemTam[String(x).toUpperCase()] ?? 9) - (ordemTam[String(y).toUpperCase()] ?? 9));
          return `${cor}:${ts.join('/')}`;
        });
      linhas.push(`${ref} -> ${partes.join(' | ')}`);
    }
    return { texto: linhas.join('\n'), data: dataArq };
  } catch (e) {
    logErro('ia/estoque-fino', e);
    return null;
  }
}

export async function processarConversa(conversaId) {
  // 1. Busca conversa + últimas mensagens
  const { data: conv, error: errConv } = await supabase
    .from('lojas_whats_conversas')
    .select('*')
    .eq('id', conversaId)
    .maybeSingle();
  if (errConv) throw errConv;
  if (!conv) throw new Error('conversa_nao_encontrada');

  // Não processa se já fechada
  if (['vendeu', 'perdida'].includes(conv.etapa)) {
    return { motivo: 'conversa_ja_fechada', etapa: conv.etapa };
  }

  // Última mensagem (in/out) — se ultima foi 'saida' (Sofia/Tamara), não tem o que responder ainda
  const { data: msgs } = await supabase
    .from('lojas_whats_mensagens')
    .select('id, direcao, autor, tipo_midia, texto, midia_url, audio_transcricao, enviada_em')
    .eq('conversa_id', conversaId)
    .order('enviada_em', { ascending: false })
    .limit(40);

  const ultima = msgs?.[0];
  if (!ultima || ultima.direcao !== 'entrada') {
    return { motivo: 'sem_mensagem_cliente_pra_responder' };
  }

  // Já tem sugestão pendente pra essa conversa?
  // Se a pendente for MAIS ANTIGA que a última msg do cliente, ela está "velha"
  // (o cliente falou mais coisa depois) — descarta e regera, pra a Sofia SEMPRE
  // ler a última pergunta. Ailson 01/06/2026.
  const { data: pendentes } = await supabase
    .from('lojas_whats_sugestoes')
    .select('id, criada_em')
    .eq('conversa_id', conversaId)
    .eq('status', 'pendente')
    .order('criada_em', { ascending: false });
  if (pendentes && pendentes.length > 0) {
    const sugMaisRecente = new Date(pendentes[0].criada_em).getTime();
    const ultimaMsgEm = new Date(ultima.enviada_em).getTime();
    if (sugMaisRecente >= ultimaMsgEm) {
      // A sugestão já cobre a última mensagem do cliente — mantém.
      return { motivo: 'ja_tem_sugestao_pendente' };
    }
    // Cliente respondeu DEPOIS da sugestão: descarta a(s) pendente(s) e regera
    // lendo as mensagens novas (assim a Sofia não ignora a pergunta dele).
    await supabase.from('lojas_whats_sugestoes')
      .update({ status: 'substituida' })
      .eq('conversa_id', conversaId)
      .eq('status', 'pendente');
    log('ia', `conversa=${conversaId} ${pendentes.length} sugestao(oes) pendente(s) velha(s) -> substituida (cliente respondeu depois), regerando`);
  }

  // 2. Texto da última msg do cliente (texto direto OU transcrição de áudio)
  const textoCliente = ultima.audio_transcricao || ultima.texto || '';

  // Detecta se esta eh a PRIMEIRA msg do cliente nessa conversa.
  // Caso seja: alguns clientes tem auto-reply WhatsApp Business com info
  // comercial (PIX, parcelamento, sedex) que dispara falsos positivos no
  // detector de gatilhos quente. Regra Ailson 27/05/2026: na 1a msg do
  // cliente, ignorar gatilhos quente.
  const msgsClienteAteAgora = (msgs || []).filter(m => m.direcao === 'entrada');
  const ehPrimeiraMsgCliente = msgsClienteAteAgora.length <= 1;

  // 2c. ESTRATEGIA A/B DE ABERTURA (Ailson 06/06/2026): 20% dos leads NAO-carrinho
  // entram no grupo 'catalogo_direto' (abertura manda o catalogo logo, sem citar
  // minimo, deixa a cliente perguntar pra gerar interacao). 80% ficam 'padrao'.
  // Sorteia UMA vez (na 1a msg) e grava — fica estavel e da pra comparar depois.
  const ehCarrinho = conv.origem_lead === 'carrinho_site_amicialoja';
  if (!conv.experimento_abertura && ehPrimeiraMsgCliente && !ehCarrinho) {
    const grupo = Math.random() < 0.20 ? 'catalogo_direto' : 'padrao';
    try {
      await supabase.from('lojas_whats_conversas')
        .update({ experimento_abertura: grupo }).eq('id', conversaId);
    } catch (e) { logErro('ia/experimento-abertura', e); }
    conv.experimento_abertura = grupo;  // reflete em memoria pro prompt e classificador
    log('ia', `conversa=${conversaId} experimento_abertura sorteado=${grupo}`);
  }

  // 3. Detecta gatilhos quente
  const gatilhos = detectarGatilhosQuente(textoCliente);
  log('ia', `conversa=${conversaId} gatilhos=[${gatilhos.join(',')}] primeira_msg=${ehPrimeiraMsgCliente}`);

  // 3b. Detecta sinal "vou pro site" (Ailson 26/05/2026)
  // Marca flag pra Sofia acompanhar (3d sem msg = nova mensagem leve)
  if (REGEX_SITE.test(textoCliente) && !conv.cliente_indicou_site) {
    await supabase.from('lojas_whats_conversas').update({
      cliente_indicou_site: true,
      cliente_indicou_site_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    }).eq('id', conversaId);
    log('ia', `conversa=${conversaId} marcou cliente_indicou_site`);
  }

  // 3c. Detecta CPF/CNPJ no texto (Ailson 25/05/2026 — match Sofia x Mire)
  // Se cliente forneceu documento valido e conversa ainda nao tem,
  // persiste em documento+tipo_documento. Match com Mire fica perfeito
  // (lojas_vendas.documento_cliente_raw / lojas_vendas_varejo.documento_raw).
  if (!conv.documento) {
    const docDetectado = detectarDocumento(textoCliente);
    if (docDetectado) {
      await supabase.from('lojas_whats_conversas').update({
        documento: docDetectado.documento,
        tipo_documento: docDetectado.tipo,
        atualizado_em: new Date().toISOString(),
      }).eq('id', conversaId);
      log('ia', `conversa=${conversaId} capturou ${docDetectado.tipo}=${docDetectado.documento.slice(0,3)}***`);
    }
  }

  // 4. Se gatilho QUENTE → SUGERE promocao pra Tamara aprovar (Ailson 27/05/2026)
  //    Antes: movia conversa direto pra etapa='quente' e disparava handoff vendedora.
  //    Agora: seta sugestao_quente_pendente_em + motivo + gatilhos. Tamara ve
  //    botao inline na conversa e aceita/recusa. Aceitar = executa o fluxo
  //    antigo (etapa='quente' + handoff). Recusar = volta a flag pra null,
  //    conversa continua em 'conversando' e Sofia segue engajando.
  //    Endpoint: /api/lojas-whats-sugestao-quente-decidir
  //    Historico: tabela lojas_whats_sugestoes_decisoes (treina detector).
  if (gatilhos.length > 0) {
    if (ehPrimeiraMsgCliente) {
      // 1a msg do cliente — provavel auto-reply do WhatsApp Business com
      // info comercial boilerplate (PIX, parcelamento, sedex). Ignora.
      log('ia', `conversa=${conversaId} IGNOROU ${gatilhos.length} gatilhos quente (1a msg cliente — provavel auto-reply)`);
    } else if (!conv.sugestao_quente_pendente_em) {
      // Se ja tem sugestao pendente, nao re-criar (deixa Tamara decidir a atual)
      const motivoSugestao = gatilhos.slice(0, 3).map(g => g.tipo || g).join(' + ');
      await supabase.from('lojas_whats_conversas').update({
        sugestao_quente_pendente_em: new Date().toISOString(),
        sugestao_quente_motivo: motivoSugestao,
        sugestao_quente_gatilhos: gatilhos,
        score_quente: 80 + Math.min(20, gatilhos.length * 5),
        gatilhos_detectados: gatilhos,
        ultima_atividade_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString()
      }).eq('id', conversaId);
      log('ia', `conversa=${conversaId} SUGERIU promocao quente (${gatilhos.length} gatilhos) → aguardando Tamara`);
    }
    // Continua flow normal — IA AINDA gera sugestao de msg, mas Tamara pode
    // tanto aprovar o texto quanto promover pra quente independentemente.
    // (Se Tamara aceitar promocao, conversa vira atendida e msgs param de
    // ser geradas automaticamente.)
  }

  // 4b. Detector FOLLOW-UP (Sprint B Sofia, Ailson 25/05/2026)
  // Se cliente sinaliza esfriamento ("vou pensar", "amanha te falo", "vou
  // voltar no site"), marca conversa pra retomada futura ANTES de gerar
  // replica. A replica em si continua sendo gerada normalmente — Sofia
  // responde educadamente e depois a conversa entra em 'follow_up'.
  // Limite de 2 tentativas (depois -> perdida). Se ja tem tentativa em
  // andamento, nao remarca.
  const detFup = detectarFollowUp(textoCliente);
  if (detFup && conv.etapa !== 'follow_up' && conv.etapa !== 'feedback' && conv.etapa !== 'inativo' && (conv.follow_up_tentativas || 0) < 2) {
    const venceEm = calcularVencimentoFUp(detFup.tag);
    await supabase.from('lojas_whats_conversas').update({
      etapa: 'follow_up',
      follow_up_tag: detFup.tag,
      follow_up_vence_em: venceEm,
      follow_up_entrou_em: new Date().toISOString(),
      follow_up_origem: 'sofia_detectou',
      follow_up_motivo: detFup.motivo,
      ultima_atividade_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    }).eq('id', conversaId);
    log('ia', `conversa=${conversaId} marcou follow_up tag=${detFup.tag} motivo="${detFup.motivo}"`);
    // Continua o flow normal: ainda vai gerar replica educada agora.
    // Quando vencer, cron-followup vai gerar nova msg de retomada.
  }

  // 5. Monta cardápio dinâmico (em_alta + best_sellers + novidades + matches do carrinho)
  let cardapioStr = '';
  let refsCarrinho = [];
  try {
    refsCarrinho = await getRefsCarrinhoDeConversa(conv.carrinho_id);
    const cardapio = await montarCardapio({ refsDoCarrinho: refsCarrinho });
    cardapioStr = formatarCardapioPraIA(cardapio);
    log('ia', `conversa=${conversaId} cardapio: ${cardapio.em_alta?.length || 0} alta, ${cardapio.best_sellers?.length || 0} bs, ${cardapio.novidades?.length || 0} nov, ${refsCarrinho.length} refs carrinho, ${cardapio.matches?.length || 0} grupos match`);
  } catch (e) {
    logErro('ia/cardapio', e);
    cardapioStr = 'CATALOGO HOJE: indisponivel (use conhecimento geral, sem inventar refs).';
  }

  // 5a. Lista AMPLA de refs ativas (pra RECONHECER print/foto/modelo que a cliente
  // mandar) + estoque-semaforo + cores do ultimo corte. Diferente do cardapio, que
  // sao so os destaques pra oferecer proativamente. Ailson 05/06/2026.
  let listaRefsAtivas = '';
  try {
    listaRefsAtivas = await montarListaReferenciasAtivas();
  } catch (e) { logErro('ia/refs-ativas', e); }

  // 5a-bis. Base de conhecimento DETALHADA das pecas EM FOCO (refs do carrinho):
  // ficha tecnica + descricao_completa, pra Sofia falar com profundidade da peca
  // que a cliente esta de fato vendo. So as refs do carrinho, pra nao inflar.
  let fichasFoco = '';
  try {
    if (refsCarrinho && refsCarrinho.length) fichasFoco = montarFichasDetalhadas(refsCarrinho);
  } catch (e) { logErro('ia/fichas-foco', e); }

  // 5b. APRENDIZADO (Ailson 26/05/2026 — coracao da Sofia)
  // Decide modo: 30% explorar (gera variacao livre) / 70% replicar (usa padroes).
  // Injeta bloco de padroes aprendidos no system prompt como DICA (3B suggest).
  const modoAprendizado = decidirModo();
  let blocoPadroes = '';
  try {
    blocoPadroes = await montarBlocoPadroes(modoAprendizado, { etapa: conv.etapa });
  } catch (e) {
    logErro('ia/padroes', e);
  }
  log('ia', `conversa=${conversaId} modo=${modoAprendizado} padroes_bloco=${blocoPadroes ? 'SIM' : 'NAO'}`);

  // 5c. MIDIAS DISPONIVEIS (Ailson 26/05/2026)
  // Lista refs com fotos/videos + catalogos pra Sofia usar via marcadores.
  let blocoMidias = '';
  let nomeCatalogoAtual = null;  // catalogo mais recente — pro force-inject (Ailson 31/05/2026)
  try {
    const { data: midias } = await supabase
      .from('lojas_whats_midias')
      .select('tipo, ref, nome_arquivo, descricao')
      .eq('ativa', true)
      .order('criada_em', { ascending: false })
      .limit(200);
    if (midias && midias.length > 0) {
      const fotos = midias.filter(m => m.tipo === 'foto' && m.ref);
      const videos = midias.filter(m => m.tipo === 'video' && m.ref);
      const catalogos = midias.filter(m => m.tipo === 'catalogo');
      const linhas = ['MIDIAS DISPONIVEIS (pode usar via marcadores no texto):'];
      if (fotos.length > 0) {
        linhas.push(`  FOTOS por REF: ${fotos.slice(0, 30).map(f => f.ref).join(', ')}`);
        linhas.push('    → use [ENVIAR_FOTO:REF] quando cliente perguntar/mencionar produto');
      }
      if (videos.length > 0) {
        linhas.push(`  VIDEOS por REF: ${videos.slice(0, 15).map(v => v.ref).join(', ')}`);
        linhas.push('    → use [ENVIAR_VIDEO:REF] SOMENTE em fechamento');
      }
      if (catalogos.length > 0) {
        // Catalogo de PROMOCAO (se ativo no config promocao_ativa) eh tratado
        // separado do geral: so vai quando o CLIENTE pede/pergunta da promo. O
        // catalogo de abertura/geral continua sendo o mais recente que NAO eh
        // promocao. A distribuicao da promo vai pela co-piloto. Ailson 18/06/2026.
        const promoCfg = await getConfig('promocao_ativa', null);
        const promoNome = (promoCfg && promoCfg.ativa && promoCfg.catalogo)
          ? String(promoCfg.catalogo).toLowerCase().trim() : null;
        const semExt = (n) => (n || '').replace(/\.[^.]+$/, '');
        const ehPromo = (m) => promoNome && semExt(m.nome_arquivo).toLowerCase().includes(promoNome);
        const catalogosGerais = catalogos.filter(m => !ehPromo(m));
        const catalogoPromo = catalogos.find(ehPromo) || null;
        const base = catalogosGerais[0] || catalogos[0];
        nomeCatalogoAtual = semExt(base.nome_arquivo);  // abertura/force-inject = SEMPRE o geral
        const listaGeral = (catalogosGerais.length ? catalogosGerais : [base]).slice(0, 10).map(c => semExt(c.nome_arquivo)).join(', ');
        linhas.push(`  CATALOGO GERAL (abertura/padrao): ${listaGeral}`);
        linhas.push('    → use [ENVIAR_CATALOGO:nome_sem_extensao] apos cliente engajar (>=3 msgs). Se o cliente JA pediu pra ver, manda DIRETO (sem perguntar); se for vc oferecendo, pergunta antes. Quando o cliente responder que JA revende / tem loja / e sacoleira / esta comecando, acolhe rapido e JA manda o catalogo (sem ficar perguntando mais).');
        if (catalogoPromo) {
          linhas.push(`  CATALOGO DE PROMOCAO: ${semExt(catalogoPromo.nome_arquivo)}`);
          linhas.push(`    → REGRA DA PROMOCAO: o catalogo de abertura/geral NUNCA eh o de promocao. So mande o de promocao ([ENVIAR_CATALOGO:${semExt(catalogoPromo.nome_arquivo)}]) SE o cliente PERGUNTAR da promocao ou PEDIR pra ver a promo. NUNCA ofereca foto solta de peca ([ENVIAR_FOTO:REF]) como se fosse "da promocao" — vc NAO sabe quais pecas entram na promo alem do que esta nesse catalogo. Se o cliente quiser saber o que tem na promo, mande esse catalogo em vez de citar pecas avulsas.`);
        }
      }
      blocoMidias = linhas.join('\n');
    }
  } catch (e) {
    logErro('ia/midias', e);
  }

  // 5d. OBSERVACAO PRA SOFIA (Ailson 26/05/2026 — campo do card lead)
  // Dica colocada pela assistente humana. Persistente ate ser limpa.
  // Tambem detecta marcadores [ANEXAR_FOTO:id] que assistente adicionou manualmente.
  let blocoObs = '';
  let midiasAnexarManual = [];
  if (conv.observacao_para_sofia) {
    const obs = conv.observacao_para_sofia;
    // Extrai marcadores [ANEXAR_TIPO:id]
    const matchAnexar = obs.matchAll(/\[ANEXAR_(FOTO|VIDEO|CATALOGO):([a-f0-9-]+)\]/gi);
    for (const m of matchAnexar) {
      midiasAnexarManual.push({ tipo: m[1].toLowerCase(), id: m[2] });
    }
    const obsLimpa = obs.replace(/\[ANEXAR_[^\]]+\]/g, '').trim();
    if (obsLimpa) {
      blocoObs = `OBSERVACAO DA ASSISTENTE HUMANA (dica importante pra sua proxima msg):\n${obsLimpa}`;
    }
    if (midiasAnexarManual.length > 0) {
      const list = midiasAnexarManual.map(m => `${m.tipo}:${m.id}`).join(', ');
      blocoObs += (blocoObs ? '\n\n' : '') +
        `MIDIA(S) PRA ENVIAR ANEXADA(S) PELA ASSISTENTE: ${list}\n` +
        `→ inclua no texto o(s) marcador(es) [ENVIAR_TIPO:identificador]`;
    }
  }

  // 5d. ROTEIRO ESTRATEGICO por origem_lead (Sprint Attribution Ailson 25/05/2026)
  // Lead de carrinho site_amicia (Roteiro A) ja sabe preco/politicas.
  // Lead de anuncio Instagram (Roteiro B) chegou do zero, trabalho total.
  // Sofia consulta as politicas + roteiro + tecidos do banco e injeta como bloco.
  let blocoRoteiro = '';
  let blocoPoliticas = '';
  let blocoTecidos = '';
  try {
    const roteiros = await getConfig('roteiros_estrategicos', {});
    // Reativacao (Ailson 12/06/2026): etapa='inativo' = cliente 6+ meses parado.
    // Usa roteiro E + injeta o HISTORICO do cliente (kpis) pra Sofia personalizar.
    const ehReativacao = conv.etapa === 'inativo';
    const chave = ehReativacao ? 'E_reativacao'
                : conv.origem_lead === 'carrinho_site_amicialoja' ? 'A_carrinho_site_amicialoja'
                : (conv.origem_lead === 'anuncio_instagram' || conv.origem_lead === 'anuncio_facebook') ? 'B_anuncio_meta'
                : (conv.origem_lead === 'instagram_stories' || conv.origem_lead === 'instagram_linktree') ? 'C_instagram_organico'
                : null;
    if (chave && roteiros[chave] && typeof roteiros[chave] === 'object') {
      blocoRoteiro = `ROTEIRO ESTRATEGICO PRA ESTA CONVERSA (${ehReativacao ? 'REATIVACAO de cliente inativo' : 'origem=' + conv.origem_lead}):\n${JSON.stringify(roteiros[chave], null, 2)}\n\nIMPORTANTE: NUNCA pergunte diretamente o perfil do lead. Mapeia pelos sinais nas mensagens. Adapte tom e ganchos baseado em quem voce detectar.`;
    }
    // Bloco HISTORICO — so na reativacao, OBRIGATORIO antes de sugerir (roteiro E)
    if (ehReativacao && conv.cliente_id) {
      try {
        const { data: k } = await supabase.from('lojas_clientes_kpis')
          .select('qtd_compras, qtd_pecas, lifetime_total, ticket_medio, ultima_compra, canal_dominante, pct_compras_presenciais, estilo_dominante, tamanhos_frequentes, classificacao_abc, dias_sem_comprar')
          .eq('cliente_id', conv.cliente_id).maybeSingle();
        if (k) {
          const compraOnde = (k.pct_compras_presenciais ?? 0) >= 60 ? 'COMPRA NA LOJA FISICA (presencial)'
                           : (k.pct_compras_presenciais ?? 0) <= 40 ? 'COMPRA A DISTANCIA (envio/marketplace)'
                           : 'MISTO (loja fisica + distancia)';
          const faixaLifetime = (k.qtd_compras ?? 0) >= 5 ? 'CLIENTE IMPORTANTE (5+ compras) — usar abordagem de cliente especial/recorrente que faz falta'
                              : 'CLIENTE ATE 4 COMPRAS — abordagem geral investigativa, entender por que nao engatou';
          blocoRoteiro += `\n\nHISTORICO DESTE CLIENTE (leia ANTES de sugerir qualquer mensagem — regra do roteiro E):\n`
            + `- Compras lifetime: ${k.qtd_compras ?? '?'} (${k.qtd_pecas ?? '?'} pecas no total)\n`
            + `- ${faixaLifetime}\n`
            + `- Onde compra: ${compraOnde}\n`
            + `- Categorias/estilo que mais comprou: ${k.estilo_dominante || 'sem dado — pergunte com jeito ou veja conversas'}\n`
            + `- Tamanhos frequentes: ${k.tamanhos_frequentes || 'sem dado'}\n`
            + `- Ticket medio: ${k.ticket_medio ? 'R$ ' + Number(k.ticket_medio).toFixed(0) : 'sem dado'} | Classificacao ABC: ${k.classificacao_abc || '-'}\n`
            + `- Ultima compra: ${k.ultima_compra || '?'} (${k.dias_sem_comprar ?? '?'} dias sem comprar)\n`
            + `USE este historico pra: sugerir pecas certeiras do perfil dele (NUNCA generico), escolher o tom (loja fisica = pode convidar pra passar na loja; distancia = foca em envio), e priorizar conforme o lifetime. Fotos avulsas (media 3) sempre do estilo que ele mais compra.`;
        }
      } catch (e) { logErro('ia/historico-reativacao', e); }
    }
    const politicas = await getConfig('politicas_comerciais', null);
    if (politicas) {
      blocoPoliticas = `POLITICAS COMERCIAIS AMICIA (sigam SEMPRE — pgto/atacado/varejo/frete/troca):\n${JSON.stringify(politicas, null, 2)}\n\nLEMBRETE: PIX padrao 5% sempre, 10%/15% so na negociacao. Atacado 12 pecas (pode misturar). 3-7 pecas eh tabela varejo (+R$30/peca). Bojo: NENHUM modelo tem.\n\nMARCADORES OBRIGATORIOS (backend remove antes de enviar pro cliente, cliente NUNCA ve esses colchetes):\n- Cliente sinaliza 1-2 pecas e voce vai oferecer upgrade pra 3+: COMECE a resposta com [OFERTA_UPGRADE]\n- Cliente sinaliza 3-7 pecas e voce vai oferecer +R$30/peca (tabela varejo): COMECE a resposta com [OFERTA_VAREJO]\nExemplo: "[OFERTA_VAREJO] Olha, conversei com a gerente e ela liberou! Consigo fazer pra vc, mas aumentando R$30 por peca (entra na tabela varejo). Ainda vale muito a pena, viu?"\nIMPORTANTE: nao coloque o marcador se nao for esses casos especificos. Marcador serve pro backend monitorar 24h sem resposta -> move pra aba Varejo automaticamente. VAREJO eh +R$30/peca FIXO — NUNCA diga que levar mais dilui o acrescimo ou fica mais em conta por peca (eh falso). Pro 1-2 pecas: persuada a fechar 3 pelo GANHO DE REVENDA (boutique revende a ate 3x o preco, entao R$30/peca eh otima margem) e nao conceda as 2 como abertura.`;
    }
    const tecidos = await getConfig('tecidos', null);
    if (tecidos) {
      blocoTecidos = `TECIDOS AMICIA (info detalhada quando cliente perguntar):\n${JSON.stringify(tecidos, null, 2)}\n\nREGRAS DE OURO TECIDOS:\n- Viscolinho NAO tem linho (eh viscose + elastano com trama slub)\n- Suplex eh POLIAMIDA, nao poliester (diferencial)\n- Viscose estampada: estampa digital EXCLUSIVA Amicia`;
    }
  } catch (e) {
    logErro('ia/roteiro-config', e);
  }


  // "Catalogo ja enviado alguma vez" — sinal CONFIAVEL pelo historico de
  // mensagens. NAO usa conv.catalogo_enviado_em porque o webhook zera esse
  // campo a cada inbound do cliente (servia so pro relogio de follow-up).
  // Catalogo enviado = documento PDF em /catalogos/. Ailson 30/05/2026.
  // Vesti (teste A/B): o "catalogo" e um LINK de texto (sem documento), entao
  // detecta pelo dominio v.vesti.mobi nas msgs de saida. Ailson 01/06/2026.
  let catalogoJaEnviado = false;     // "catalogo" no formato da conversa (vesti = link; senao = PDF)
  let pdfCatalogoJaEnviado = false;  // o DOCUMENTO PDF foi enviado? (e o que o marcador [ENVIAR_CATALOGO] manda)
  try {
    // PDF documento em /catalogos/ — sempre checa, e o que o marcador realmente envia.
    const { count: nCat } = await supabase
      .from('lojas_whats_mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('conversa_id', conversaId)
      .eq('direcao', 'saida')
      .eq('tipo_midia', 'document')
      .ilike('midia_url', '%catalogos/%');
    pdfCatalogoJaEnviado = (nCat || 0) > 0;

    if (conv.catalogo_formato === 'vesti') {
      // No teste Vesti o "catalogo" e um LINK de texto (v.vesti.mobi).
      const { count: nVesti } = await supabase
        .from('lojas_whats_mensagens')
        .select('id', { count: 'exact', head: true })
        .eq('conversa_id', conversaId)
        .eq('direcao', 'saida')
        .ilike('texto', '%vesti.mobi%');
      catalogoJaEnviado = (nVesti || 0) > 0;
    } else {
      catalogoJaEnviado = pdfCatalogoJaEnviado;
    }
  } catch (e) {
    logErro('ia/check-catalogo-enviado', e);
  }

  const contextoConv = montarContextoConversa(conv);
  const msgsClaude = montarMensagensClaude(msgs, conv);

  // Período do dia em BRT (UTC-3) pra Sofia saudar com o cumprimento certo.
  // Ailson 05/06/2026.
  const horaBRT = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours();
  const saudacaoPeriodo = horaBRT >= 5 && horaBRT < 12 ? 'bom dia'
    : horaBRT >= 12 && horaBRT < 18 ? 'boa tarde'
    : 'boa noite';
  const saudacaoCap = saudacaoPeriodo.charAt(0).toUpperCase() + saudacaoPeriodo.slice(1);

  const systemBlocks = [
    { type: 'text', text: SYSTEM_PROMPT },
    { type: 'text', text: `CONTEXTO DA CONVERSA:\n${contextoConv}` },
    { type: 'text', text: 'REGRA ANTI-REPETICAO (IMPORTANTE): antes de perguntar qualquer coisa pra cliente (se ela ja revende, ha quanto tempo, que tipo de cliente/loja ela e, cidade, nome), releia TODO o historico da conversa acima. Se ela JA respondeu isso em qualquer momento, NUNCA pergunte de novo, use o que ela ja disse. Repetir pergunta que ela ja respondeu passa a impressao de que vc nao prestou atencao e irrita a cliente.' },
    { type: 'text', text: `CATALOGO DISPONIVEL HOJE (use APENAS produtos abaixo — nao invente):\n\n${cardapioStr}` }
  ];
  // Saudação simples e humana, com o período certo do dia. Ailson 05/06/2026.
  systemBlocks.push({ type: 'text', text: `SAUDAÇÃO (agora é período da ${saudacaoPeriodo} no horário de SP): se esta for a PRIMEIRA resposta da Sofia nesta conversa, abra com uma saudação curta e humana usando o primeiro nome do cliente quando souber, no padrão saudação + "tudo bem?". VARIE naturalmente (não use sempre a mesma frase): "Oi <nome>, ${saudacaoPeriodo}, tudo bem?", "${saudacaoCap}, <nome>! Tudo bem?", "Oii <nome>, ${saudacaoPeriodo}! Tudo bem?". É gente digitando rápido, não recepção de loja. NUNCA use "que bom que veio", "seja bem-vinda", "que bom te ver por aqui" nem floreio de boas-vindas. E MESMO QUE a cliente diga como chegou ("vim pelo link", "vim pelo anúncio", "vi no instagram"), NÃO comente nem agradeça isso (nada de "que bom que veio pelo link" e parecidos); só cumprimenta normal e segue. No máximo 1 emoji leve, e nem sempre. Se NÃO for a primeira resposta da Sofia, não fique re-saudando.` });
  // ESTRATEGIA A/B (Ailson 06/06/2026): grupo 'catalogo_direto' = manda catalogo
  // na abertura, sem qualificar e sem citar minimo, deixando a cliente perguntar.
  if (conv.experimento_abertura === 'catalogo_direto') {
    systemBlocks.push({ type: 'text', text: `ESTRATEGIA DESTA CONVERSA (importante): ${ehPrimeiraMsgCliente ? `esta e a abertura. Manda uma saudação curta com o nome da cliente e AVISA que esta enviando o catalogo — ele JA VAI ANEXADO automaticamente NESTA mensagem (inclua [ENVIAR_CATALOGO] no fim). Como o catalogo ja vai junto, AFIRME que esta mandando; NUNCA pergunte "quer que eu te mande o catalogo?", "posso te enviar?" nem "mando agora?" — seria pedir permissao pra mandar algo que ja esta indo. VARIE o texto naturalmente (NAO use sempre a mesma frase), no espirito de "Oi <nome>, ${saudacaoPeriodo}! Segue o nosso catalogo, qualquer duvida to a disposição".` : `seja simpatica e direta — manda uma saudação curta com o nome da cliente. Se for falar do catalogo e ele AINDA nao foi enviado, escolha UMA coisa: OU pergunta se pode mandar (sem anexar), OU manda com [ENVIAR_CATALOGO] afirmando — nunca pergunta e anexa na mesma mensagem.`} REGRAS DESTA CONVERSA: (1) NAO qualifique a cliente — nao pergunte se ela ja revende, se tem loja, se ta comecando etc. (2) NAO cite a quantidade minima de pecas, nem preco de atacado vs varejo, de cara. So fale do minimo SE a propria cliente perguntar. A intencao e deixar ela puxar a conversa e perguntar.` });
  }
  // Lista ampla pra RECONHECER a peca que a cliente mandar (print/foto/modelo).
  if (listaRefsAtivas) {
    systemBlocks.push({ type: 'text', text: `REFERENCIAS ATIVAS DA AMICIA (o que temos COM ESTOQUE agora — use pra RECONHECER a peca que a cliente mandar por print, foto ou nome. NAO e a lista do que oferecer sozinha; pra oferecer proativamente use o cardapio acima):\n${listaRefsAtivas}\n\nCOMO USAR ESTA LISTA:\n- Cliente mandou print/foto ou citou um modelo: cruze com esta lista pra achar a REF e a descricao certa, e fale da peca com naturalidade.\n- "estoque" e um SEMAFORO por referencia (soma de todas as cores/tamanhos): "bastante" = vende tranquila; "tem disponivel" = tem, mas confirme se for pedido grande; "pouco (ta saindo)" = avisa que ta saindo e conduz pra fechar logo. NUNCA fale o numero exato de pecas. A disponibilidade fina por COR e TAMANHO vem do bloco ESTOQUE FINO (planilha do dia), quando ele aparecer abaixo — pode confirmar cor+tam com base nele (sem dizer quantidade); se a peca, cor ou tam NAO estiver la, ai sim a separacao confirma na hora.\n- "cores do ultimo corte" sao as cores que sairam na producao mais recente da peca: pode dizer as cores, mas pra cor+tamanho exatos confirma na separacao.\n- quando a linha trouxer "ficha:" sao dados tecnicos da peca (tecido, composicao, forro, caimento, com o que combina, tamanho que a modelo veste, preco atacado) — use pra tirar duvida com naturalidade, sem despejar tudo de uma vez.\n- Se a peca que a cliente mandou NAO aparece aqui (sem estoque), pode estar em reposicao: se vier info de producao no contexto usa, senao diz que vai confirmar com a equipe. Nunca diga que a peca "nao existe" so porque nao esta nesta lista.` });
  }
  // ESTOQUE FINO (cor x tamanho): carrega so quando a conversa esta "em produto"
  // (veio print/foto, tem ref no carrinho, ou a cliente fala de cor/tam/ref) pra
  // nao pesar o prompt em saudacao/preco. Ailson 09/06/2026.
  const _temImagemRecente = (msgs || []).some(m => m.direcao === 'entrada' && m.tipo_midia === 'image');
  const _falaProduto = /\b\d{3,4}\b|\bcor(es)?\b|\btamanho|\bdisponiv|\btem (no|na|em|de)\b|\bpp\b|\bgg?\b|\bg[123]\b/i.test(textoCliente || '');
  if (_temImagemRecente || (refsCarrinho && refsCarrinho.length) || _falaProduto) {
    const ef = await montarEstoqueFino();
    if (ef && ef.texto) {
      const dataFmt = ef.data ? ` ${String(ef.data).split('-').reverse().join('/')}` : '';
      systemBlocks.push({ type: 'text', text: `ESTOQUE FINO — DISPONIBILIDADE POR COR E TAMANHO (planilha do dia${dataFmt}):\nLista do que TEM disponivel agora, por REF -> cor: tamanhos.\n\n${ef.texto}\n\nCOMO USAR (ESTOQUE FINO):\n- NUNCA diga a quantidade. So diga que TEM ("tem no P areia"), nunca "tem 2".\n- So existe o que esta listado aqui. Cor ou tamanho que NAO aparece pra aquela ref: NAO tem agora.\n- Cliente mandou print/foto e vc identificou a REF: confirma a peca e lista as CORES que tem, e oferece ver os tamanhos. Ex: "Essa camisa tricoline, ref 2631\\nTemos preto/bege/caqui/marinho\\nQuer confirmar os tamanhos? So me falar a cor 😊". Se vier varios prints, faz isso pra CADA peca.\n- Cliente falou UMA cor: lista os tamanhos daquela cor. Ex: "No preto tem disponivel M/G/GG".\n- Cliente quer todas as cores e tamanhos de uma vez: manda tudo junto, uma cor por linha. Ex: "Temos disponiveis:\\nareia P/M/G\\npreto M/G/GG".\n- A cor/tam que a cliente quer nao esta disponivel: avisa que nessa nao tem agora e oferece o que TEM ("nessa cor ta so no G hoje, mas tenho no preto em P/M/G").` });
    }
  }
  if (fichasFoco) {
    systemBlocks.push({ type: 'text', text: `BASE DE CONHECIMENTO — FICHA DETALHADA DA(S) PECA(S) QUE A CLIENTE ESTA VENDO / NO CARRINHO:\n${fichasFoco}\n\nISTO E PRA VC SE BASEAR, NAO PRA COLAR. Use so o trecho relevante pra pergunta da cliente (tecido, caimento, forro, com o que combina, etc.), sempre com as SUAS palavras e no momento certo. NUNCA mande a descricao inteira nem um textao tecnico do nada.` });
  }
  if (blocoMidias) systemBlocks.push({ type: 'text', text: blocoMidias });
  // DDD 11 = São Paulo capital/região metropolitana → libera oferta de motoboy.
  // Sofia so oferece motoboy quando este aviso aparece. Ailson 01/06/2026.
  {
    const telDigits = String(conv?.telefone || '').replace(/\D/g, '');
    const semPais = telDigits.startsWith('55') ? telDigits.slice(2) : telDigits;
    const ddd = semPais.slice(0, 2);
    if (ddd === '11') {
      systemBlocks.push({ type: 'text', text: 'ENTREGA LOCAL: o DDD do cliente é 11 (São Paulo capital ou região metropolitana). Vc PODE oferecer entrega via motoboy (rápida); se perguntarem o custo, por volta de R$ 20. Use quando fizer sentido (cliente falar de frete/entrega ou no fechamento).' });
    }
  }
  // Avisa a IA sobre o que ja foi enviado. Distingue PDF (documento) de link Vesti.
  // Ailson 30/05 (PDF) + 06/06 (fallback Vesti->PDF).
  if (pdfCatalogoJaEnviado) {
    systemBlocks.push({ type: 'text', text: `ATENCAO: o catalogo PDF JA FOI ENVIADO pra esse cliente nesta conversa. NAO reenvie. NUNCA use [ENVIAR_CATALOGO:...] de novo aqui, e NAO diga "te mando o catalogo". Se ele tiver duvida sobre uma peca, manda a FOTO dela ([ENVIAR_FOTO:REF]) ou responde direto.` });
  } else if (catalogoJaEnviado) {
    // Modo Vesti: o LINK ja foi mandado, mas o PDF ainda nao.
    systemBlocks.push({ type: 'text', text: `ATENCAO: vc JA mandou o LINK do catalogo (Vesti) pra esse cliente. NAO fique remandando o link nem dizendo "te mando o catalogo" do nada. POREM: se o cliente disser que NAO conseguiu acessar / deu erro / nao abriu / nao carregou, OU se ele PEDIR o catalogo, ai vc PODE e DEVE mandar o catalogo PDF como alternativa, com [ENVIAR_CATALOGO:nome]. Nesse caso responda acolhendo, tipo "a gente continua por aqui, vou te enviar o catalogo".` });
  }

  // Orientacao aprendida (cron-aprendizado semanal) — guidance SUAVE, baseada
  // no que de fato faz o cliente responder/se interessar. Ailson 30/05/2026.
  try {
    const { data: apr } = await supabase
      .from('lojas_whats_aprendizado').select('guidance').eq('id', 1).maybeSingle();
    if (apr?.guidance) systemBlocks.push({ type: 'text', text: apr.guidance });
  } catch (e) { logErro('ia/guidance-aprendizado', e); }
  if (blocoRoteiro) systemBlocks.push({ type: 'text', text: blocoRoteiro });
  if (blocoPoliticas) systemBlocks.push({ type: 'text', text: blocoPoliticas });
  if (blocoTecidos) systemBlocks.push({ type: 'text', text: blocoTecidos });
  if (blocoPadroes) systemBlocks.push({ type: 'text', text: blocoPadroes });
  if (blocoObs) systemBlocks.push({ type: 'text', text: blocoObs });

  // ─── ROTEIRO FEEDBACK PÓS-COMPRA (Ailson) ──────────────────────────────────
  // Conversas etapa='feedback' são retorno de pesquisa pós-1ª-compra, NÃO venda.
  // Vem por último pra ter precedência sobre blocos de oferta/qualificação acima.
  if (conv.etapa === 'feedback') {
    systemBlocks.push({ type: 'text', text:
`ATENDIMENTO DE FEEDBACK PÓS-COMPRA (IMPORTANTE, vale acima de qualquer instrução anterior): esta conversa é um retorno de feedback sobre a primeira compra da cliente, NÃO é uma venda nova. IGNORE qualquer orientação acima de oferecer catálogo, qualificar a cliente (se revende, se tem loja) ou puxar venda. Aqui o objetivo é ouvir, acolher e deixar a cliente bem.
- Responde curto e humano ao que ela disser. Se elogiar, agradece simples. Se relatar problema (entrega, peça, tamanho, cor), acolhe de verdade e diz que vai verificar ou encaminhar pra equipe, sem prometer o que não dá.
- NÃO empurre produto. Só fale de peça se a própria cliente abrir gancho.

SE A CLIENTE DISSER QUE JÁ COMPRA COM UMA VENDEDORA (ex: "eu já compro com a fulana", "já tenho minha vendedora", "falo com a [nome]"): NUNCA tente assumir a cliente nem competir com a vendedora. Deixa claro, de um jeito leve e natural, que vc está ali só pra AUXILIAR: tirar dúvida, ajudar no que precisar, e que pode até indicar modelos que casam bem com o que ela já levou. Mas reforça que QUEM CONTINUA cuidando dela e fechando a venda é a vendedora dela. Passa a impressão de que vc está ali pra somar e deixar a experiência dela melhor, não pra substituir ninguém. Espírito da fala (varie, não copie): "Ahh que bom que vc já é cliente da [nome]! Ela continua te atendendo certinho, viu. Eu fico por aqui só pra te ajudar no que precisar e, se quiser, te mostro umas peças que combinam com o que vc levou. Mas é sempre com ela que vc fecha 😊". Se souber o nome da vendedora pelo contexto, usa; senão fala genérico ("sua vendedora").
NUNCA peça pra cliente trocar de vendedora, nem dê a entender que comprar por vc é melhor ou mais rápido. O tom é de apoio, não de captura.` });
  }

  // ─── FIX 2: CASAMENTO POR IMAGEM (foto da cliente x fotos do catalogo) ──────
  // ESCALONADO: o FIX 1 (texto) roda primeiro (chamada abaixo). So se a resposta
  // dele cair na incerteza ("vou confirmar com a equipe / nao temos") e que a
  // gente reenvia anexando as fotos do catalogo pra comparacao visual — evita
  // mandar dezenas de imagens quando o texto ja resolveu. Bloco de imagem so vai
  // em msg role 'user'. Config: sofia_match_imagem_ativo / sofia_match_imagem_max.
  // Ailson 13/06/2026.
  const anexarFotosReferencia = async (categorias) => {
    const maxFotos = Number(await getConfig('sofia_match_imagem_max', 16)) || 16;
    const cands = await montarFotosReconhecimento(maxFotos, categorias);
    if (!cands || !cands.length) return 0;
    let idxUser = -1;
    for (let i = msgsClaude.length - 1; i >= 0; i--) {
      if (msgsClaude[i].role === 'user') { idxUser = i; break; }
    }
    if (idxUser < 0) return 0;
    const msg = msgsClaude[idxUser];
    const blocks = Array.isArray(msg.content)
      ? [...msg.content]
      : [{ type: 'text', text: String(msg.content || '') }];
    blocks.push({ type: 'text', text: '--- FOTOS DE REFERENCIA DO CATALOGO (compare a foto que a cliente mandou ACIMA com estas pra achar a REF certa; cada foto vem com a REF logo antes dela) ---' });
    for (const c of cands) {
      blocks.push({ type: 'text', text: `REF ${c.ref}:` });
      blocks.push({ type: 'image', source: { type: 'url', url: c.url } });
    }
    msgsClaude[idxUser] = { ...msg, content: blocks };
    systemBlocks.push({ type: 'text', text: 'CASAMENTO POR IMAGEM (vale acima de qualquer descrição escrita): a cliente mandou uma foto. Na ULTIMA mensagem dela vão anexadas FOTOS DE REFERENCIA do nosso catalogo, cada uma com a REF logo antes. A IDENTIFICAÇÃO é decidida SÓ pela imagem: escolha a REF cuja FOTO bate visualmente com a foto da cliente. As descrições/fichas escritas podem ENGANAR (outro modelo pode ter texto parecido, ex: duas jaquetas de zíper diferentes) — NUNCA escolha a peca pelo texto, só pela foto. Se a peca que vc mencionou antes NÃO bate com nenhuma foto anexada, CORRIJA. Depois de achar a REF pela foto, use SÓ as cores daquela REF no ESTOQUE FINO (nunca as cores ou o nome de outra REF). Se nenhuma foto bater de verdade, aí sim diz que vai confirmar com a equipe.' });
    return cands.length;
  };

  const cl = await chamarClaude({
    modelo: await getConfig('modelo_ia', 'claude-sonnet-4-6'),
    systemBlocks,
    messages: msgsClaude,
    max_tokens: 400,
    temperature: modoAprendizado === 'explorar' ? 0.85 : 0.7
  });

  if (!cl.ok) {
    logErro('ia/claude', cl.erro);
    throw new Error(`claude_falhou: ${cl.erro}`);
  }

  let textoProposto = (cl.texto || '').trim();
  if (!textoProposto) throw new Error('claude_retornou_vazio');

  // FIX 2: CASAMENTO POR IMAGEM. Quando a cliente manda foto e a peca ainda nao
  // foi travada, SEMPRE compara por foto (nao so quando o texto vem incerto): a
  // passada de texto pode estar CONFIANTE E ERRADA (casar com a "sosia" que tem
  // ficha rica, ex: 3190 Trunia no lugar da 3210). A foto e o juiz. Filtra pela
  // categoria que a Sofia descreveu (poucas fotos, barato). Ailson 13/06/2026.
  if (_temImagemRecente && !(refsCarrinho && refsCarrinho.length)) {
    try {
      const matchAtivo = await getConfig('sofia_match_imagem_ativo', true);
      if (matchAtivo) {
        // Infere a CATEGORIA pela descricao que a propria Sofia deu na 1a passada,
        // pra mandar so as fotos da familia certa. Categorias reais: BLUSA/VESTIDO/
        // CONJUNTO/CALÇA/SHORTS/SAIA/MACACÃO/BLAZER/CASAQUINHO/CROPPED.
        const desc = (cl.texto || '').toLowerCase();
        const mapaCat = [
          { re: /jaqueta|casaco|casaquinho|blazer|sobretudo|agasalho|moletom|tricot|cardig|parka|corta\s*vento/, cats: ['BLAZER', 'CASAQUINHO'] },
          { re: /vestido|chemise/, cats: ['VESTIDO'] },
          { re: /macac|jardineira/, cats: ['MACACÃO'] },
          { re: /conjunto|twin|conjuntinho/, cats: ['CONJUNTO'] },
          { re: /pantalona|cal[çc]a|alfaiat/, cats: ['CALÇA'] },
          { re: /short|bermuda/, cats: ['SHORTS'] },
          { re: /\bsaia\b/, cats: ['SAIA'] },
          { re: /blusa|camisa|cropped|body|regata|\btop\b|bata|blusinha|camiseta/, cats: ['BLUSA', 'CROPPED'] },
        ];
        const setCat = new Set();
        for (const m of mapaCat) if (m.re.test(desc)) m.cats.forEach(c => setCat.add(c));
        const categorias = setCat.size ? [...setCat] : null;
        const n = await anexarFotosReferencia(categorias);
        if (n > 0) {
          log('ia', `conversa=${conversaId} match-imagem: comparando ${n} fotos${categorias ? ' (cat: ' + categorias.join('/') + ')' : ' (geral)'}`);
          const cl2 = await chamarClaude({
            modelo: await getConfig('modelo_ia', 'claude-sonnet-4-6'),
            systemBlocks,
            messages: msgsClaude,
            max_tokens: 400,
            temperature: 0.6
          });
          if (cl2.ok && (cl2.texto || '').trim()) {
            textoProposto = cl2.texto.trim();
            log('ia', `conversa=${conversaId} match-imagem aplicado (resposta confirmada/corrigida pela foto)`);
          } else if (!cl2.ok) {
            logErro('ia/match-imagem-call', cl2.erro);
          }
        }
      }
    } catch (e) { logErro('ia/match-imagem-escalonado', e); }
  }

  // GUARD ANTI-REENVIO DO CATALOGO PDF (Ailson 30/05, ajustado 06/06):
  // Bloqueia o marcador SO se o PDF ja foi enviado de fato. No modo Vesti, ter
  // mandado o LINK nao bloqueia o PDF (ele e o fallback quando o cliente trava).
  if (pdfCatalogoJaEnviado && /\[ENVIAR_CATALOGO:[^\]]+\]/i.test(textoProposto)) {
    textoProposto = textoProposto
      .replace(/\[ENVIAR_CATALOGO:[^\]]+\]/gi, '')
      .replace(/[ \t]*\n{3,}[ \t]*/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
    log('ia', `conversa=${conversaId} PDF do catalogo ja enviado antes — marcador removido (anti-reenvio)`);
  }
  if (!textoProposto) throw new Error('claude_retornou_vazio_pos_guard');

  // Estilo WhatsApp humano: sem travessão, sem ponto final (Ailson 30/05/2026)
  textoProposto = limparEstiloSofia(textoProposto);

  // 6b. Classificacao auto-envio (Ailson 31/05/2026): decide se a Sofia pode
  // responder SOZINHA (gate deterministico = 100% de certeza) ou se fica
  // pendente pra Tamara. Quem dispara o envio e o cron-responder, e SO quando a
  // chave sofia_auto_resposta_ativa estiver ligada (default desligada).
  const ultimaSaida = (msgs || []).find(m => m.direcao === 'saida');
  // Mensagens NOVAS do cliente desde a ultima resposta da Sofia/Tamara. A cliente
  // costuma mandar varias picadas (ex: "bom dia" + "quero o catalogo" + "voces
  // fazem pacote?"); o gate de auto-envio agora olha TODAS, nao so a ultima, pra
  // nao perder um pedido de catalogo que veio antes de uma pergunta. Ailson 06/06.
  const textosNovos = [];
  for (const m of (msgs || [])) {          // msgs vem DESC (mais recente primeiro)
    if (m.direcao === 'saida') break;       // para na ultima saida (resposta) anterior
    if (m.direcao === 'entrada') textosNovos.push(m.audio_transcricao || m.texto || '');
  }
  // Normaliza (tira acento) antes de testar: /catal/ NAO casa com "catálogo" (á),
  // entao sofiaOfereceuCatalogo vinha sempre false e a confirmacao pos-oferta
  // ("pode sim") nunca auto-enviava. Ailson 09/06/2026.
  const _txtUltSaida = String(ultimaSaida?.texto || '')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const sofiaOfereceuCatalogo = !!(ultimaSaida && /catal[oa]g/.test(_txtUltSaida)
    && /(quer|posso|te mando|te envio|\bmando\b|gostaria de ver|quer que eu)/.test(_txtUltSaida));
  const cls = classificarAutoEnvio({ textoCliente, textosNovos, conv, ehPrimeiraMsgCliente, sofiaOfereceuCatalogo });

  // Garante o catalogo nos gatilhos de catalogo (Ailson 31/05/2026): se o gate
  // classificou fase=catalogo (pedido direto, atacado, qualificacao, confirmacao),
  // o catalogo ainda NAO foi enviado e a IA nao colocou o marcador, injeta o
  // catalogo atual. Assim "ja vendo / revenda / tenho loja" sempre puxa o catalogo.
  // O guard anti-reenvio acima ja protege contra mandar 2x.
  if (cls.fase === 'catalogo' && !catalogoJaEnviado && nomeCatalogoAtual
      && !/\[ENVIAR_CATALOGO:[^\]]+\]/i.test(textoProposto)) {
    textoProposto = `${textoProposto}\n\n[ENVIAR_CATALOGO:${nomeCatalogoAtual}]`;
    log('ia', `conversa=${conversaId} catalogo force-inject (motivo=${cls.motivo})`);
  }

  // 7. Cria sugestão pendente (captura o id pro auto-envio)
  const { data: sugRow, error: errSug } = await supabase.from('lojas_whats_sugestoes').insert({
    conversa_id: conversaId,
    tipo: 'replica',
    texto_proposto: textoProposto,
    status: 'pendente',
    prioridade: 60 + (conv.tipo_documento === 'CNPJ' ? 10 : 0),
    motivo_proposta: 'replica_ia_apos_msg_cliente',
    contexto_ia: {
      ultima_msg_cliente: textoCliente.slice(0, 500),
      gatilhos_detectados: gatilhos,
      refs_carrinho_resolvidas: refsCarrinho,
      claude_latencia_ms: cl.latencia_ms,
      claude_custo_brl: cl.custo_brl,
      modo_aprendizado: modoAprendizado,  // 'replicar' | 'explorar' (Ailson 26/05/2026)
      padroes_no_prompt: !!blocoPadroes,
      // Auto-envio + aprendizado por origem (Ailson 31/05/2026)
      origem_lead: conv.origem_lead || null,
      auto_envio: cls.auto,
      fase_auto: cls.fase || null,
      motivo_auto: cls.motivo || null
    }
  }).select('id').single();
  if (errSug) throw errSug;

  // 8. Atualiza atividade da conversa
  await supabase.from('lojas_whats_conversas').update({
    ultima_atividade_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString()
  }).eq('id', conversaId);

  return {
    motivo: 'replica_proposta',
    sugestaoId: sugRow?.id || null,
    autoEnviar: cls.auto,
    faseAuto: cls.fase || null,
    motivoAuto: cls.motivo || null,
    gatilhos: [],
    proposta_chars: textoProposto.length,
    refs_carrinho_resolvidas: refsCarrinho,
    claude_latencia_ms: cl.latencia_ms,
    claude_custo_brl: cl.custo_brl
  };
}

// ─── GATE AUTO-ENVIO (Ailson 31/05/2026) ──────────────────────────────────
// Decide se a Sofia responde SOZINHA (100% de certeza, por regra deterministica)
// ou se a sugestao fica pendente pra Tamara. Default conservador: na duvida,
// pendente. Quem executa o envio e o cron-responder, so com a chave ligada.
//   - Abertura nas origens padrao (stories/linktree/anuncio) -> auto
//   - Pedido direto de ver/catalogo -> auto
//   - "atacado" sozinho -> auto
//   - Confirmacao curta ("sim/pode/claro") SO se a Sofia acabou de oferecer catalogo -> auto
//   - Qualquer outra coisa -> pendente (aprovacao)
function classificarAutoEnvio({ textoCliente, textosNovos, conv, ehPrimeiraMsgCliente, sofiaOfereceuCatalogo }) {
  // Grupo do teste A/B (Ailson 06/06/2026): na abertura manda o catalogo direto e
  // ja auto-envia, independente da origem/texto da 1a msg. fase=catalogo garante
  // que o force-inject anexe o catalogo.
  if (ehPrimeiraMsgCliente && conv && conv.experimento_abertura === 'catalogo_direto') {
    return { auto: true, fase: 'catalogo', motivo: 'abertura_teste_catalogo_direto' };
  }

  const norm = s => String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();
  const t = norm(textoCliente);
  if (!t) return { auto: false, motivo: 'sem_texto' };

  // 1. Abertura: 1a msg do cliente numa origem padrao (avalia a ULTIMA msg)
  const origensPadrao = ['instagram_stories', 'instagram_linktree', 'anuncio_facebook', 'anuncio_instagram'];
  if (ehPrimeiraMsgCliente && origensPadrao.includes(conv.origem_lead)) {
    return { auto: true, fase: 'abertura', motivo: 'abertura_origem_padrao' };
  }

  // Candidatos = TODAS as mensagens novas nao respondidas (nao so a ultima).
  // Assim "quero o catalogo" + "voces fazem pacote?" dispara mesmo que a ultima
  // seja a pergunta. Ailson 06/06/2026.
  const candidatos = (Array.isArray(textosNovos) && textosNovos.length ? textosNovos : [textoCliente])
    .map(norm).filter(Boolean);

  // 2. Pedido direto de ver / catalogo / pacote / como funciona (em qualquer msg nova)
  const pedeCatalogo = txt =>
    /\bcatal[oa]g/.test(txt) ||                        // catalogo, catalago, catalog
    /\bquero (ver|receber)\b/.test(txt) ||
    /\bgostaria de (ver|receber)\b/.test(txt) ||
    /\bver (os|o que|o q|modelos|disponiv)/.test(txt) ||
    /\bdisponiv/.test(txt) ||
    /\bme mostra\b/.test(txt) ||
    /\bvou olhar os modelos\b/.test(txt) ||
    /\bpacote/.test(txt) ||                            // pacote(s) — Ailson 06/06
    /\bcomo funciona/.test(txt);                       // "como funciona" o atacado — Ailson 06/06
  if (candidatos.some(pedeCatalogo)) return { auto: true, fase: 'catalogo', motivo: 'pedido_direto_catalogo' };

  // 3. "atacado" sozinho (mensagem curta basicamente so "atacado"), em qualquer msg nova
  const atacadoCurto = txt => {
    const palavras = txt.replace(/[^a-z ]/g, '').trim().split(/\s+/).filter(Boolean);
    return /\batacado\b/.test(txt) && palavras.length <= 3;
  };
  if (candidatos.some(atacadoCurto)) return { auto: true, fase: 'catalogo', motivo: 'atacado_sozinho' };

  // 3b. Pergunta de PRECO / VALOR -> auto. A resposta e a faixa de atacado +
  // oferta de catalogo: informativa e segura, nao precisa de aprovacao. (texto ja
  // vem sem acento por causa do norm). Ailson 13/06/2026.
  const perguntaPreco = txt =>
    /\bpre[cç]o/.test(txt) ||                                   // preco, preço
    /\bvalor(es)?\b/.test(txt) ||                               // valor, valores
    /\bquanto\s+(custa|sai|fica|e|ta|tao|sao|cada|por)\b/.test(txt) ||
    /\bquanto\s+(que\s+)?(e|ta|fica)\b/.test(txt) ||
    /\btabela de pre/.test(txt);                               // tabela de precos
  if (candidatos.some(perguntaPreco)) return { auto: true, fase: 'catalogo', motivo: 'pergunta_preco' };

  // 3c. Outras perguntas-FAQ com resposta padrao e segura -> auto, mas fase
  // 'resposta' (NAO forca o catalogo junto). Frete/entrega, pedido minimo e
  // formas de pagamento. Ailson 13/06/2026.
  const perguntaFrete = txt =>
    /\bfrete\b/.test(txt) || /\bentrega/.test(txt) || /\benvio\b/.test(txt) ||
    /\bsedex\b/.test(txt) || /\bcorreio/.test(txt) || /\bmotoboy\b/.test(txt) ||
    /\bvoce?s?\s+entreg/.test(txt) || /\benvi(am|a)\s+(pra|para)\b/.test(txt) ||
    /\bprazo\b.*\bentrega\b/.test(txt) || /\bchega.*\bquantos?\s+dias?\b/.test(txt);
  const perguntaMinimo = txt =>
    /\bminim[ao]/.test(txt) ||              // minimo, minima (texto ja sem acento)
    /\bpedido min/.test(txt) || /\bquantidade min/.test(txt) ||
    /\bqtd min/.test(txt) || /\bcompra min/.test(txt);
  const perguntaPagamento = txt =>
    /\bpagament/.test(txt) || /\bforma(s)?\s+de\s+pag/.test(txt) ||
    /\bpix\b/.test(txt) || /\bcart[aã]o/.test(txt) || /\bparcel/.test(txt) ||
    /\bboleto\b/.test(txt) || /\bcomo\s+(pago|paga|pagar)\b/.test(txt) ||
    /\baceita(m)?\s+(cartao|pix|boleto)\b/.test(txt);
  if (candidatos.some(t => perguntaFrete(t) || perguntaMinimo(t) || perguntaPagamento(t)))
    return { auto: true, fase: 'resposta', motivo: 'pergunta_faq' };

  // 4. Resposta de qualificacao (ja revende / tem loja / trabalha com roupas / comecando)
  const ehQualificacao = txt =>
    /\b(ja )?vend[oe]\b/.test(txt) ||
    /\breven[dt]/.test(txt) ||                          // revendo, revenda, revendedora
    /\btenho (uma )?loja\b/.test(txt) ||
    /\bminha loja\b/.test(txt) ||
    /\bloja (fisica|propria)\b/.test(txt) ||
    /\bsacoleira\b/.test(txt) ||
    /\btrabalho com roupas?\b/.test(txt) ||             // "ja trabalho com roupas femininas" — Ailson 06/06
    /\btrabalho com moda\b/.test(txt) ||
    /\bprimeira (vez|compra)\b/.test(txt) ||
    /\b(to|estou|vou|quero|pensando em)\s*comec/.test(txt) ||
    /\bcomecand/.test(txt) ||
    /\biniciando\b/.test(txt);
  if (candidatos.some(ehQualificacao)) return { auto: true, fase: 'catalogo', motivo: 'qualificacao_resposta' };

  // 5. Confirmacao curta a uma oferta de catalogo da Sofia. A cliente costuma
  // mandar "Oi" + "Quero sim por favor" — que chegam juntos como UMA msg com
  // quebra de linha. Antes avaliava so o inicio do texto combinado (comecava com
  // "Oi" e furava o gate); agora avalia CADA linha/msg nova. Ailson 09/06/2026.
  const ehConfirmaCurta = txt => txt.length <= 30
    && /^(sim|claro|pode( sim)?|por favor|pode mandar|manda|aguardando|ok|isso|quero)\b/.test(txt);
  const linhasNovas = candidatos
    .flatMap(c => String(c).split(/\n+/))
    .map(s => s.trim())
    .filter(Boolean);
  if (sofiaOfereceuCatalogo && linhasNovas.some(ehConfirmaCurta)) {
    return { auto: true, fase: 'catalogo', motivo: 'confirmacao_pos_oferta' };
  }

  // 6. Resto: aprovacao
  return { auto: false, motivo: 'requer_aprovacao' };
}

// ─── HELPERS DE CONTEXTO PRA CLAUDE ───────────────────────────────────────

function montarContextoConversa(conv) {
  const linhas = [];
  // Nome SEMPRE com inicial maiúscula no contexto — razão social vem em CAIXA
  // ALTA e a IA copiava ("Oii LUCIMARA!"). Ailson 11/06/2026.
  const nomeBonito = String(conv.nome_cliente || '(sem nome)')
    .toLowerCase()
    .replace(/(^|\s)([a-zà-ú])/g, (m, sp, ch) => sp + ch.toUpperCase());
  linhas.push(`Cliente: ${nomeBonito} ${conv.tipo_documento || ''}`);
  linhas.push(`(regra: ao usar o nome da cliente na mensagem, use só o primeiro nome, com inicial maiúscula e o resto minúsculo — NUNCA em CAIXA ALTA)`);
  if (conv.qtd_pecas) linhas.push(`Carrinho original: ${conv.qtd_pecas} peças`);
  if (conv.valor_carrinho) linhas.push(`Valor carrinho: R$ ${Number(conv.valor_carrinho).toFixed(2)}`);
  if (conv.iniciada_em) {
    const dias = Math.floor((Date.now() - new Date(conv.iniciada_em).getTime()) / 86400000);
    linhas.push(`Conversa iniciada há ${dias} dia(s)`);
  }
  linhas.push('Sofia já enviou 1ª mensagem sobre o carrinho abandonado.');
  return linhas.join('\n');
}

function montarMensagensClaude(msgs, conv) {
  // Inverte (mais antigas primeiro) e mapeia pra formato Claude (user/assistant)
  const ordenadas = [...(msgs || [])].reverse();

  // VISAO (Ailson 05/06/2026): cliente manda print do catalogo / foto de peca o
  // tempo todo. Passamos a imagem DE VERDADE pro modelo (multimodal). Pra segurar
  // custo, so as 3 imagens mais recentes do cliente (com URL publica) entram como
  // imagem real; imagens antigas viram placeholder de texto.
  // SO imagens do CLIENTE (entrada) viram bloco de imagem real. A API da Anthropic
  // rejeita bloco de imagem em mensagem de role 'assistant' (= nossas imagens de
  // saida, ex: catalogo que a Sofia mandou) -> erro 400 -> claude_falhou -> ia_falhou.
  // Alem disso a Sofia nao precisa "ver" as fotos que ela mesma enviou. Ailson 13/06/2026.
  const idsImagemReal = new Set(
    ordenadas
      .filter(m => m.direcao === 'entrada' && m.tipo_midia === 'image' && typeof m.midia_url === 'string' && m.midia_url.startsWith('http'))
      .slice(-3)
      .map(m => m.id)
  );

  const result = [];
  for (const m of ordenadas) {
    const isCliente = m.direcao === 'entrada';
    const role = isCliente ? 'user' : 'assistant';

    const blocks = [];
    if (m.tipo_midia === 'image' && idsImagemReal.has(m.id)) {
      blocks.push({ type: 'image', source: { type: 'url', url: m.midia_url } });
      const legenda = (m.texto || '').trim()
        || (isCliente ? 'Cliente enviou esta imagem (print do catálogo ou foto de uma peça).' : '');
      if (legenda) blocks.push({ type: 'text', text: legenda });
    } else {
      let txt = m.audio_transcricao || m.texto || '';
      if (!txt && m.tipo_midia === 'image') txt = isCliente ? '[cliente enviou uma imagem]' : '[Sofia enviou uma foto do catálogo]';
      if (!txt && m.tipo_midia === 'audio') txt = '[cliente enviou áudio sem transcrição]';
      if (!txt) continue;
      blocks.push({ type: 'text', text: txt });
    }

    // Claude exige user/assistant alternados — mescla mensagens consecutivas do
    // mesmo papel concatenando os blocks (texto e/ou imagem).
    if (result.length > 0 && result[result.length - 1].role === role) {
      result[result.length - 1].blocks.push(...blocks);
    } else {
      result.push({ role, blocks });
    }
  }

  // Claude exige que comece com user
  if (result.length === 0 || result[0].role !== 'user') {
    result.unshift({ role: 'user', blocks: [{ type: 'text', text: '(início da conversa)' }] });
  }

  // Normaliza: se a mensagem é só 1 bloco de texto, manda como string (econômico
  // e compatível); se tem imagem ou múltiplos blocks, manda como array multimodal.
  return result.map(r => {
    const soTexto = r.blocks.length === 1 && r.blocks[0].type === 'text';
    return { role: r.role, content: soTexto ? r.blocks[0].text : r.blocks };
  });
}
