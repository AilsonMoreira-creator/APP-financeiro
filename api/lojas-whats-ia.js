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
import { montarCardapio, formatarCardapioPraIA, getRefsCarrinhoDeConversa, montarListaReferenciasAtivas, montarFichasDetalhadas } from './_lojas-whats-cardapio.js';
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
- Olhe a imagem e leia a peça: tipo (vestido, macacão, conjunto, saia...), tecido aparente, cor, detalhes (manga, comprimento, decote, fenda).
- Cruze com o CATALOGO/produtos que vc conhece pra achar o modelo e a REF. Se bater, fala dele com naturalidade ("esse é o nosso macacão de linho").
- Se ficar entre 2 modelos bem parecidos, faz UMA pergunta curta de desempate (a cor, um detalhe), nunca um questionário.
- Se de fato não houver nada parecido no que vc tem, aí sim diz que vai confirmar com a equipe se essa peça específica tá disponível, sem mandar ele explicar.
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

CLIENTE TRAVOU NO LINK (VESTI) OU PEDIU O CATÁLOGO:
- A gente manda primeiro o LINK do catálogo (Vesti). Se a cliente disser que NÃO conseguiu acessar, deu erro, não abriu, não carregou, tá com problema no link, OU se ela PEDIR o catálogo: manda o catálogo PDF na hora, com [ENVIAR_CATALOGO:nome_atual].
- Acolhe rápido e resolve, tom de "tô aqui contigo". Ex: "Oii <nome>, a gente continua por aqui! Vou te enviar o catálogo 😊 [ENVIAR_CATALOGO:nome_atual]"
- Isso vale MESMO que vc já tenha mandado o LINK antes — o PDF é a alternativa pra quem travou no link. (A única coisa que vc não repete é o PDF, se o PDF mesmo já tiver ido.)

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
- Para categoria, 1-2 fotos das melhores opcoes
- Sempre acompanha de texto explicando ("olha que coisa linda esse macacao...")

VÍDEO:
- Só em fechamento (cliente quase decidindo)
- Pra mostrar caimento/movimento

IMPORTANTE:
- 1 mídia por mensagem (não combine 2 marcadores [ENVIAR_*] na mesma resposta)
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
        nomeCatalogoAtual = catalogos[0].nome_arquivo.replace(/\.[^.]+$/, '');
        linhas.push(`  CATALOGOS: ${catalogos.slice(0, 10).map(c => c.nome_arquivo.replace(/\.[^.]+$/, '')).join(', ')}`);
        linhas.push('    → use [ENVIAR_CATALOGO:nome_sem_extensao] apos cliente engajar (>=3 msgs). Se o cliente JA pediu pra ver, manda DIRETO (sem perguntar); se for vc oferecendo, pergunta antes. Quando o cliente responder que JA revende / tem loja / e sacoleira / esta comecando, acolhe rapido e JA manda o catalogo (sem ficar perguntando mais).');
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
    const chave = conv.origem_lead === 'carrinho_site_amicialoja' ? 'A_carrinho_site_amicialoja'
                : (conv.origem_lead === 'anuncio_instagram' || conv.origem_lead === 'anuncio_facebook') ? 'B_anuncio_meta'
                : (conv.origem_lead === 'instagram_stories' || conv.origem_lead === 'instagram_linktree') ? 'C_instagram_organico'
                : null;
    if (chave && roteiros[chave] && typeof roteiros[chave] === 'object') {
      blocoRoteiro = `ROTEIRO ESTRATEGICO PRA ESTA CONVERSA (origem=${conv.origem_lead}):\n${JSON.stringify(roteiros[chave], null, 2)}\n\nIMPORTANTE: NUNCA pergunte diretamente o perfil do lead. Mapeia pelos sinais nas mensagens. Adapte tom e ganchos baseado em quem voce detectar.`;
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
    systemBlocks.push({ type: 'text', text: `ESTRATEGIA DESTA CONVERSA (importante): ${ehPrimeiraMsgCliente ? 'esta e a abertura. ' : ''}seja simpatica e direta — manda uma saudação curta com o nome da cliente e ja oferece o catalogo de forma leve. VARIE o texto naturalmente (NAO use sempre a mesma frase), no espirito de "Oi <nome>, ${saudacaoPeriodo}! Segue o nosso catalogo, qualquer duvida to a disposição". REGRAS DESTA CONVERSA: (1) NAO qualifique a cliente — nao pergunte se ela ja revende, se tem loja, se ta comecando etc. (2) NAO cite a quantidade minima de pecas, nem preco de atacado vs varejo, de cara. So fale do minimo SE a propria cliente perguntar. A intencao e deixar ela puxar a conversa e perguntar. ${ehPrimeiraMsgCliente ? 'Inclua [ENVIAR_CATALOGO] no fim que o catalogo vai anexado automaticamente.' : ''}` });
  }
  // Lista ampla pra RECONHECER a peca que a cliente mandar (print/foto/modelo).
  if (listaRefsAtivas) {
    systemBlocks.push({ type: 'text', text: `REFERENCIAS ATIVAS DA AMICIA (o que temos COM ESTOQUE agora — use pra RECONHECER a peca que a cliente mandar por print, foto ou nome. NAO e a lista do que oferecer sozinha; pra oferecer proativamente use o cardapio acima):\n${listaRefsAtivas}\n\nCOMO USAR ESTA LISTA:\n- Cliente mandou print/foto ou citou um modelo: cruze com esta lista pra achar a REF e a descricao certa, e fale da peca com naturalidade.\n- "estoque" e um SEMAFORO por referencia (soma de todas as cores/tamanhos): "bastante" = vende tranquila; "tem disponivel" = tem, mas confirme se for pedido grande; "pouco (ta saindo)" = avisa que ta saindo e conduz pra fechar logo. NUNCA fale o numero exato de pecas, nem prometa cor/tamanho especifico — a disponibilidade fina por cor e tamanho a separacao confirma na hora de fechar.\n- "cores do ultimo corte" sao as cores que sairam na producao mais recente da peca: pode dizer as cores, mas pra cor+tamanho exatos confirma na separacao.\n- quando a linha trouxer "ficha:" sao dados tecnicos da peca (tecido, composicao, forro, caimento, com o que combina, tamanho que a modelo veste, preco atacado) — use pra tirar duvida com naturalidade, sem despejar tudo de uma vez.\n- Se a peca que a cliente mandou NAO aparece aqui (sem estoque), pode estar em reposicao: se vier info de producao no contexto usa, senao diz que vai confirmar com a equipe. Nunca diga que a peca "nao existe" so porque nao esta nesta lista.` });
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
  const sofiaOfereceuCatalogo = !!(ultimaSaida && /catal[oa]g/i.test(ultimaSaida.texto || '')
    && /(quer|posso|te mando|te envio|\bmando\b|gostaria de ver|quer que eu)/i.test(ultimaSaida.texto || ''));
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

  // 5. Confirmacao curta a uma oferta de catalogo da Sofia (avalia a ULTIMA msg)
  const confirmaCurta = t.length <= 25
    && /^(sim|claro|pode( sim)?|por favor|pode mandar|manda|aguardando|ok|isso|quero)\b/.test(t);
  if (confirmaCurta && sofiaOfereceuCatalogo) {
    return { auto: true, fase: 'catalogo', motivo: 'confirmacao_pos_oferta' };
  }

  // 6. Resto: aprovacao
  return { auto: false, motivo: 'requer_aprovacao' };
}

// ─── HELPERS DE CONTEXTO PRA CLAUDE ───────────────────────────────────────

function montarContextoConversa(conv) {
  const linhas = [];
  linhas.push(`Cliente: ${conv.nome_cliente || '(sem nome)'} ${conv.tipo_documento || ''}`);
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
  const idsImagemReal = new Set(
    ordenadas
      .filter(m => m.tipo_midia === 'image' && typeof m.midia_url === 'string' && m.midia_url.startsWith('http'))
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
      if (!txt && m.tipo_midia === 'image') txt = '[cliente enviou uma imagem]';
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
