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

import { supabase, setCors, log, logErro, getConfig } from './_lojas-whats-helpers.js';
import { chamarClaude } from './_lojas-helpers.js';
import { montarCardapio, formatarCardapioPraIA, getRefsCarrinhoDeConversa } from './_lojas-whats-cardapio.js';
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

JAMAIS:
- "Sou eu, sua assistente virtual..."
- "Como posso ajudar você hoje?" / "Posso te ajudar com alguma coisa?" / "Em que posso ajudar?" — variações disso QUANDO cliente já comunicou objetivo
- "Aproveite nossa oferta especial..."
- "Última chance!", "Compre agora!"
- Travessões longos (—)
- "Incrível", "imperdível", "sensacional"
- "Querida", "minha amiga", "linda"
- Mensagens longas (>4 linhas)
- Mandar cliente 1-7 peças pro site (mesmo "sutilmente"). Caminho é tabela varejo (markers OFERTA_*)

SEMPRE:
- Responder a dúvida específica do cliente
- Reforçar 1 vantagem concreta quando relevante (despacho rápido, peça única, qualidade)
- Terminar com pergunta que faz o cliente seguir a conversa
- Se cliente perguntar preço/produto que vc não tem certeza → pedir um momento e dizer que vai confirmar

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
    .select('id, direcao, autor, tipo_midia, texto, audio_transcricao, enviada_em')
    .eq('conversa_id', conversaId)
    .order('enviada_em', { ascending: false })
    .limit(20);

  const ultima = msgs?.[0];
  if (!ultima || ultima.direcao !== 'entrada') {
    return { motivo: 'sem_mensagem_cliente_pra_responder' };
  }

  // Já tem sugestão pendente pra essa conversa?
  const { count: pendCount } = await supabase
    .from('lojas_whats_sugestoes')
    .select('*', { count: 'exact', head: true })
    .eq('conversa_id', conversaId)
    .eq('status', 'pendente');
  if (pendCount > 0) {
    return { motivo: 'ja_tem_sugestao_pendente' };
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
  if (detFup && conv.etapa !== 'follow_up' && (conv.follow_up_tentativas || 0) < 2) {
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
        linhas.push(`  CATALOGOS: ${catalogos.slice(0, 10).map(c => c.nome_arquivo.replace(/\.[^.]+$/, '')).join(', ')}`);
        linhas.push('    → use [ENVIAR_CATALOGO:nome_sem_extensao] apos cliente engajar (>=3 msgs). Se o cliente JA pediu pra ver, manda DIRETO (sem perguntar); se for vc oferecendo, pergunta antes.');
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
                : conv.origem_lead === 'anuncio_instagram'        ? 'B_anuncio_instagram'
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


  const contextoConv = montarContextoConversa(conv);
  const msgsClaude = montarMensagensClaude(msgs, conv);

  const systemBlocks = [
    { type: 'text', text: SYSTEM_PROMPT },
    { type: 'text', text: `CONTEXTO DA CONVERSA:\n${contextoConv}` },
    { type: 'text', text: `CATALOGO DISPONIVEL HOJE (use APENAS produtos abaixo — nao invente):\n\n${cardapioStr}` }
  ];
  if (blocoMidias) systemBlocks.push({ type: 'text', text: blocoMidias });
  if (blocoRoteiro) systemBlocks.push({ type: 'text', text: blocoRoteiro });
  if (blocoPoliticas) systemBlocks.push({ type: 'text', text: blocoPoliticas });
  if (blocoTecidos) systemBlocks.push({ type: 'text', text: blocoTecidos });
  if (blocoPadroes) systemBlocks.push({ type: 'text', text: blocoPadroes });
  if (blocoObs) systemBlocks.push({ type: 'text', text: blocoObs });

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

  const textoProposto = (cl.texto || '').trim();
  if (!textoProposto) throw new Error('claude_retornou_vazio');

  // 7. Cria sugestão pendente
  const { error: errSug } = await supabase.from('lojas_whats_sugestoes').insert({
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
      padroes_no_prompt: !!blocoPadroes
    }
  });
  if (errSug) throw errSug;

  // 8. Atualiza atividade da conversa
  await supabase.from('lojas_whats_conversas').update({
    ultima_atividade_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString()
  }).eq('id', conversaId);

  return {
    motivo: 'replica_proposta',
    gatilhos: [],
    proposta_chars: textoProposto.length,
    refs_carrinho_resolvidas: refsCarrinho,
    claude_latencia_ms: cl.latencia_ms,
    claude_custo_brl: cl.custo_brl
  };
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
  const result = [];
  for (const m of ordenadas) {
    const isCliente = m.direcao === 'entrada';
    const role = isCliente ? 'user' : 'assistant';
    let conteudo = m.audio_transcricao || m.texto || '';
    if (!conteudo && m.tipo_midia === 'image') conteudo = '[cliente enviou imagem]';
    if (!conteudo && m.tipo_midia === 'audio') conteudo = '[cliente enviou áudio sem transcrição]';
    if (!conteudo) continue;

    // Claude exige user/assistant alternados — mescla mensagens consecutivas
    if (result.length > 0 && result[result.length - 1].role === role) {
      result[result.length - 1].content += '\n' + conteudo;
    } else {
      result.push({ role, content: conteudo });
    }
  }
  // Claude exige que comece com user
  if (result.length === 0 || result[0].role !== 'user') {
    result.unshift({ role: 'user', content: '(início da conversa)' });
  }
  return result;
}
