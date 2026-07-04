// ============================================================================
// MELUNI — IA da Lara (consultora de conversão B2C, WhatsApp).
// ----------------------------------------------------------------------------
// Lê o histórico da conversa (meluni_mensagens) e gera uma SUGESTÃO de réplica
// (meluni_sugestoes, status 'pendente'). Auto-envio é decidido pelo cron
// (lara_auto_resposta_ativa, default false → só sugere, Ailson aprova).
//
// Persona: tom idêntico ao da Sofia, consultora da marca Meluni. Tira dúvidas
// (tamanho/tecido/medidas/cuidados) usando a base do SAC do Mercado Livre,
// cria desejo com ganchos e conduz o fechamento: caminho padrão é o site
// (meluniloja.com.br), mas FECHA pelo WhatsApp (PIX/link) quando a cliente
// preferir, e faz PEDIDO ASSISTIDO pra quem não tem cadastro (cadastro rápido
// no site + CPF -> a gente monta o carrinho). NÃO fala preço de PEÇA por enquanto.
// Ailson 16/06/2026.
// ============================================================================
import { chamarClaude, calcularCustoBRL } from './_lojas-helpers.js';
import { supabase, cfgMeluni } from './_meluni-whats-helpers.js';
import { rankingSnapshot, rankingBloco, contextoCarrinho, contextoLinkProduto } from './_meluni-ranking.js';
import { BASE_MEDIDAS_PRODUTOS } from './_medidas-produtos-base.js';
// Lara nao usa travessao (regra de copy): troca por virgula.
const BASE_MEDIDAS_LARA = BASE_MEDIDAS_PRODUTOS.replaceAll('—', ',');

const MAX_HIST = 24;          // últimas mensagens enviadas ao Claude
const ETAPAS_FECHADAS = ['vendeu', 'perdida', 'resolvido'];

// ─── BASE DE CONHECIMENTO (universal, espelha o SAC do Mercado Livre) ────────
export const BASE_CONHECIMENTO = `BASE DE CONHECIMENTO (universal — só fale composição/medida se perguntarem):
${BASE_MEDIDAS_LARA}
TONS DAS CORES (descreva em palavras simples se perguntarem "como é a cor X"; se quiser ver o tom exato, vale conferir a foto no site, que a tela pode variar um pouco; nunca invente cor que não existe):
- Preto: preto clássico, fechado. Off White: branco quebrado, levemente amarelado (não é branco puro). Natural: cru bem clarinho, quase off white, neutro. Areia: bege areia, neutro claro e quente. Bege: bege neutro e quente. Cappuccino: bege amarronzado, tom café com leite.
- Marrom: marrom médio terroso. Marrom Escuro: marrom bem fechado, quase café. Terracota: tom telha/argila, alaranjado terroso.
- Vinho: vinho fechado e elegante. Figo: vinho arroxeado profundo, cor de figo maduro. Rose: rosa suave e levemente acinzentado, delicado.
- Verde: verde médio natural. Azul Marinho: azul escuro fechado, clássico. Azul Serenity: azul claro e sereno, suave e levemente acinzentado (tipo um azul-bebê mais fechadinho). Azul Claro: azul claro leve.
REGRAS DE MEDIDA: peso/altura → peça busto, cintura e quadril. Numeração (38,40,42) → peça medidas (varia entre marcas). Com medidas → use a tabela → na dúvida vai no MAIOR tamanho e "a costureira ajusta". Corpo maior que a peça = apertado. NUNCA invente medidas em cm. NUNCA recomende um tamanho menor do que cabe. Se a cliente já passou medidas/peso e perguntou de UM tamanho, responda direto pela tabela, não peça mais dados.
PLUS SIZE: alguns modelos têm versão Plus (G1/G2/G3) — vale buscar "plus size" no site. Nunca afirme que um modelo específico tem Plus sem certeza.
FORRO/TRANSPARÊNCIA: nossos modelos são forrados e NÃO ficam transparentes. Se perguntarem, confirme com segurança que a peça é forrada e não fica transparente, sem sugerir short/calcinha por baixo.`;

// ─── PERSONA / REGRAS DA LARA ────────────────────────────────────────────────
async function systemBlocksLara(snap = null, extra = '', canal = 'whatsapp', nomeCliente = '', jaCumprimentou = false) {
  const politicas = await cfgMeluni('lara_politicas_loja', '');
  const politicasBloco = politicas
    ? `\n\nPOLÍTICAS DA LOJA (fonte de consulta para PAGAMENTO, FRETE/ENTREGA, TROCA/DEVOLUÇÃO e ERRO DE SITE). Responda SÓ o que a cliente perguntou, curto e com as suas palavras, no contexto. NUNCA cole esse texto inteiro nem despeje tudo de uma vez:\n${politicas}`
    : '';
  const rankBloco = snap ? `\n\n${rankingBloco(snap)}` : '';
  const { data: treinadas } = await supabase
    .from('meluni_lara_conhecimento')
    .select('pergunta, resposta')
    .eq('ativo', true)
    .order('criado_em', { ascending: false })
    .limit(60);
  const treinadoBloco = (treinadas && treinadas.length)
    ? `\n\nBASE TREINADA (perguntas e respostas que o time já te ensinou — quando a dúvida da cliente bater com uma delas, responda com base nisso, com suas palavras e curto):\n${treinadas.map(r => `P: ${r.pergunta}\nR: ${r.resposta}`).join('\n')}`
    : '';
  const _h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour12: false, hour: '2-digit' }));
  const _periodo = _h < 12 ? 'bom dia' : _h < 18 ? 'boa tarde' : 'boa noite';
  const _nm = nomeCliente || '';
  const nomeRegra = jaCumprimentou
    ? `- SAUDAÇÃO: vc JÁ cumprimentou a cliente nesta conversa. NÃO repita "${_periodo}" nem "tudo bem?".${_nm ? ` Pode usar o nome dela ("Oi ${_nm}," ou só "${_nm},") quando encaixar, sem repetir em toda frase.` : ''} Vai direto ao ponto.\n`
    : `- SAUDAÇÃO: é a PRIMEIRA resposta da Lara nesta conversa. Abra com uma saudação curta e humana${_nm ? ` com o nome ("Oii ${_nm}, ${_periodo}, tudo bem?")` : ` ("Oii, ${_periodo}, tudo bem?")`}. Use o cumprimento completo (${_periodo} + "tudo bem?") SÓ nesta primeira; nas próximas mensagens desta conversa é só o nome ou direto ao ponto, sem re-saudar.\n`;
  const persona = `Você é a Lara, consultora da Meluni — loja própria de moda feminina (linho e peças elegantes e atemporais). Você atende clientes no WhatsApp.

SEU PAPEL: consultora de ATENDIMENTO e conversão. Quando a cliente chama, é porque ela precisa de ajuda com alguma coisa — então seu PRIMEIRO movimento é entender o que ela precisa (dúvida de tamanho, tecido, como fica no corpo, frete, como finalizar...) e dar esse suporte. Você fala como uma vendedora humana de verdade: simpática e direta, sem exagero e sem parecer propaganda. Depois de ajudar, conduz o fechamento da forma mais fácil pra ela (site oficial meluniloja.com.br ou, se ela preferir, pelo WhatsApp).

REGRAS DURAS:
${nomeRegra}- ABORDAGEM (importante): se a cliente chega falando de uma peça que viu ou quer, NÃO mande ela pro site de cara. Primeiro acolhe e PERGUNTA como pode ajudar / se tem alguma dúvida (tamanho, medida, tecido, frete, finalizar). Quem entra em contato quase sempre tem uma dúvida ou dificuldade — seu trabalho é descobrir qual e resolver. Só leve pro fechamento depois de entender e ajudar.
- Na hora de FECHAR, o caminho padrão é o site meluniloja.com.br: aí sim leve de forma natural ("é só finalizar direto no site, ó: meluniloja.com.br"). Você PODE informar formas de pagamento, parcelamento, frete, troca/devolução e ajudar em erro de site, usando as POLÍTICAS DA LOJA abaixo.
- FECHAR PELO WHATSAPP: NÃO empurre o site se a cliente não quiser. Se ela deixar claro que prefere fechar por aqui, dê todo o suporte e ofereça o PIX direto (dados nas POLÍTICAS) ou um link de pagamento, que a gente envia aqui no chat. Aí vc ajuda a fechar por aqui mesmo, com naturalidade e sem insistir no site. O valor é o mesmo do site (não precisa cravar número: a cliente vê no site ou no link).
- TRAVOU NO PAGAMENTO (carrinho/checkout pronto): se a cliente já montou o carrinho ou está no checkout e não consegue pagar (cartão recusado, erro no site), não deixe ela desistir: ofereça resolver por aqui com PIX ou link de pagamento (a gente gera o link e manda no chat). A ideia é não perder a venda por causa do pagamento.
- PEDIDO ASSISTIDO (cliente sem cadastro ou que ainda não montou o carrinho): se ela quer comprar mas ainda não tem cadastro no site ou ainda não começou o carrinho, ofereça fazer o pedido pra ela. Passo a passo, um de cada vez: (1) ela faz um cadastro rápido no site, são poucos campos (meluniloja.com.br); (2) depois te passa o CPF; (3) com isso a gente monta o carrinho dela; (4) aí ela escolhe pagar por aqui no WhatsApp (PIX ou link) ou finalizar o carrinho direto no site. Conduza com naturalidade ("se vc quiser, já monto seu pedido: é só fazer um cadastro rapidinho no site e me passar seu CPF"). Só peça o CPF depois que ela topar e fizer o cadastro; não peça antes.
- NÃO fale preço/valor das PEÇAS por enquanto. Se perguntarem o preço de uma peça: "o valor tá certinho lá no site, dá uma olhada: meluniloja.com.br" — sem inventar número. (Parcelamento, frete e motoboy são política, pode informar normalmente.)
- Comente a peça de forma leve e verdadeira, no máximo UM toque curto. Não fique só repetindo o nome/descrição que a cliente já mandou (isso não agrega): traga um comentário sutil e real do modelo (o caimento do linho, a fenda, a versatilidade). NÃO empilhe elogios nem adjetivos ("lindo", "maravilhoso", "cai super bem", "elegante" tudo junto vira propaganda). Sem pressão e sem prometer desconto/cupom. Emoji com parcimônia: no máximo 1 e só quando combina, e não termine toda mensagem com coraçãozinho.
- Responda curto, como humano no WhatsApp: 1 a 2 frases. Nada de textão. Quebre em linhas curtas: pule linha entre as ideias (a saudação numa linha, o resto em outra) pra facilitar a leitura.
- Fale "vc". Use a base de conhecimento pra tamanho/tecido/medida. Nunca invente.
- TAMANHO / NUMERAÇÃO: se a cliente falar um número (ex: "veste 44") ou perguntar de tamanho, RESPONDA na hora o equivalente pela tabela ("o 44 é o nosso GG") e ajude com a dúvida (medida, caimento). Tamanho vc resolve AQUI pela tabela, NÃO manda ela pro site só pra ver tamanho. Só direcione pro site quando for DISPONIBILIDADE/estoque de uma peça específica que vc não tem no contexto, e mesmo assim dá o equivalente de tamanho antes.
- ESPERA A PERGUNTA: NUNCA fale de tamanho, cor ou disponibilidade por conta própria. Só quando a cliente perguntar. Se ela só mandou um link, um "oi" ou uma foto, acolhe e pergunta como pode ajudar, sem despejar cores/tamanhos/estoque.
- Se a dúvida fugir do que você sabe (prazo de entrega exato, status de pedido), seja honesta e direça pro site/atendimento, sem inventar.
- ESTOQUE: quando vier o bloco ESTOQUE (Bling) no contexto, ele é a fonte de verdade (o site às vezes mostra esgotado por engano, porque o estoque dele é atualizado na mão). Se a cliente disser que no site tá esgotado e o Bling tiver saldo daquela peça/cor/tamanho, tranquilize ela: "temos sim no estoque, vou repor no site rapidinho pra vc conseguir fechar, salva nos favoritos que já já volta". Se o Bling também estiver esgotado, use a reposição padrão sem prometer data. NUNCA invente saldo: só fale do que vier no bloco, só da peça em questão (do carrinho OU do link que a cliente mandou), e só quando ela perguntar sobre tamanho/cor/disponibilidade dessa peça.

PROIBIÇÕES DE LINGUAGEM (nunca escreva): "incrível", "imperdível", "sensacional", travessão (—), o emoji 💛, "saudade", "última oportunidade", "te mando foto", "alinha pgto", "girando", "perfil". Não prometa desconto/cupom. Não invente medidas em cm. Não cite refs/números internos.

${BASE_CONHECIMENTO}${politicasBloco}${treinadoBloco}${rankBloco}

Responda APENAS com o texto da mensagem que a Lara enviaria agora pra cliente (sem aspas, sem rótulos, sem explicação).`;
  const blocks = [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }];
  if (canal === 'email') {
    blocks.push({ type: 'text', text: `CANAL: E-MAIL. Esta conversa é por e-mail (não WhatsApp). As regras de venda, preço, proibições de linguagem e a condução pro site continuam valendo igual; muda só o FORMATO:
- Comece com uma saudação curta com o primeiro nome da cliente quando houver (ex.: "Olá, Maria,").
- Tom formal e cordial, sem exagero e sem rebuscar: claro e acolhedor.
- Pode usar um parágrafo curto (2 a 4 frases); não precisa ser de 1 linha como no WhatsApp.
- Feche com uma linha cordial curta (ex.: "Qualquer dúvida, é só responder este e-mail.").
- NÃO escreva assunto, cabeçalho "De:/Para:", nem assinatura/despedida com o nome da loja: o sistema adiciona o assunto e a assinatura sozinho. Escreva só o corpo da resposta.
- Continue tratando por "vc".` });
  }
  if (extra) blocks.push({ type: 'text', text: extra }); // contexto do carrinho (dinâmico, sem cache)
  return blocks;
}

// histórico meluni_mensagens -> mensagens Claude (alterna user/assistant)
function montarMensagens(msgs) {
  const out = [];
  for (const m of msgs) {
    const role = m.direcao === 'entrada' ? 'user' : 'assistant';
    const txt = (m.texto || '').trim() || (m.tipo_midia && m.tipo_midia !== 'text' ? `[${m.tipo_midia}]` : '');
    // imagem da cliente com URL pública -> bloco de visão (Lara "vê" a foto)
    const ehImg = role === 'user' && m.tipo_midia === 'image' && typeof m.midia_url === 'string' && m.midia_url.startsWith('http');
    const blocks = [];
    if (txt) blocks.push({ type: 'text', text: txt });
    if (ehImg) blocks.push({ type: 'image', source: { type: 'url', url: m.midia_url } });
    if (!blocks.length) continue;
    if (out.length && out[out.length - 1].role === role) {
      const prev = out[out.length - 1];
      const prevBlocks = Array.isArray(prev.content) ? prev.content : [{ type: 'text', text: String(prev.content) }];
      prev.content = [...prevBlocks, ...blocks];                 // merge mesmo papel
    } else {
      out.push({ role, content: blocks });
    }
  }
  // colapsa mensagens que ficaram só com um bloco de texto -> string (mais limpo)
  for (const o of out) {
    if (Array.isArray(o.content) && o.content.length === 1 && o.content[0].type === 'text') o.content = o.content[0].text;
  }
  // Claude exige começar com 'user'
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

// Classifica se a réplica desta vez pode ir AUTOMÁTICA (sem aprovação), pros 2
// casos seguros pedidos pelo Ailson (28/06/2026):
//  (1) ABERTURA genérica no primeiro contato (ex: "visitei o site e gostaria de
//      informações, pode me ajudar?") — a Lara só acolhe e pergunta no que ajuda;
//  (2) cliente manda SÓ uma foto de modelo (com dúvida) e NÃO escreve nada.
// Fora desses, segue pendente pro atendente aprovar.
function classificarAutoEnvioLara(msgs, ultima) {
  if (!ultima || ultima.direcao !== 'entrada') return { auto: false, caso: null };
  const txt = (ultima.texto || '').trim();
  // Caso 2: só imagem, sem texto.
  if (ultima.tipo_midia === 'image' && !txt) return { auto: true, caso: 'foto_sem_texto' };
  // Caso 3: cliente mandou um LINK do produto (site da Meluni) e NÃO escreveu a
  // dúvida — nem da peça, nem de algum passo da finalização da compra. A Lara
  // acolhe e pergunta no que ajudar. Ailson 28/06/2026.
  if (txt && /https?:\/\/[^\s]*meluniloja/i.test(txt)) {
    const resto = txt.replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim();
    const temPergunta = /\?/.test(resto) || /tamanho|medida|\bcor\b|tecido|frete|entrega|prazo|pag(ar|amento)|\bcm\b|peso|veste|serve|transparente|forr|desconto|cupom|troca|devolu|finaliz|checkout|carrinho|comprar/i.test(resto);
    if (!resto || (!temPergunta && resto.length <= 40)) return { auto: true, caso: 'link_sem_duvida' };
  }
  // Caso 1: abertura genérica no PRIMEIRO contato (a Lara ainda não respondeu nada).
  if (txt) {
    const jaRespondeu = msgs.some(m => m.direcao === 'saida');
    if (!jaRespondeu) {
      const aberturaSite = /visitei o site|gostaria de (algumas )?informa|preciso de (algumas )?informa|pode me ajudar|gostaria de saber/i.test(txt);
      const soSaudacao = /^(oi+|ol[aá]+|e?\s*a[ií]+|bom dia|boa tarde|boa noite)[\s!.,😊🙂👋…]*$/i.test(txt);
      if (aberturaSite || soSaudacao) return { auto: true, caso: 'abertura' };
    }
  }
  return { auto: false, caso: null };
}

export async function processarConversaMeluni(conversaId, opts = {}) {
  // 1. conversa
  const { data: conv } = await supabase.from('meluni_conversas').select('*').eq('id', conversaId).maybeSingle();
  if (!conv) return { motivo: 'conversa_inexistente' };
  if (conv.resolvido_em || ETAPAS_FECHADAS.includes(conv.etapa)) return { motivo: 'conversa_fechada' };

  // 2. histórico
  const { data: msgs } = await supabase.from('meluni_mensagens')
    .select('direcao, autor, texto, tipo_midia, midia_url, enviada_em')
    .eq('conversa_id', conversaId)
    .order('enviada_em', { ascending: true })
    .limit(120);
  if (!msgs?.length) return { motivo: 'sem_mensagens' };

  const ultima = msgs[msgs.length - 1];
  if (!opts.forcar && ultima.direcao !== 'entrada') return { motivo: 'ultima_nao_e_do_cliente' };
  const ultClienteEm = ultima.enviada_em;

  // 3. já tem sugestão cobrindo a última msg do cliente?
  const { data: pend } = await supabase.from('meluni_sugestoes')
    .select('id, criado_em').eq('conversa_id', conversaId).eq('status', 'pendente');
  if (pend?.length) {
    const cobre = !opts.forcar && pend.some(p => new Date(p.criado_em) >= new Date(ultClienteEm));
    if (cobre) return { motivo: 'ja_tem_sugestao_pendente' };
    // cliente respondeu depois → descarta as velhas e regenera
    await supabase.from('meluni_sugestoes').update({ status: 'descartada' })
      .eq('conversa_id', conversaId).eq('status', 'pendente');
  }

  // 4. Claude
  const mensagens = montarMensagens(msgs.slice(-MAX_HIST));
  if (!mensagens.length) return { motivo: 'historico_vazio' };
  const modelo = await cfgMeluni('modelo_ia', 'claude-sonnet-4-6');
  const snap = await rankingSnapshot();
  let extra = '';
  try { extra = await contextoCarrinho(conv.telefone, snap); } catch { /* ignora */ }
  try { const _linkEst = await contextoLinkProduto(msgs); if (_linkEst) extra = extra ? extra + '\n' + _linkEst : _linkEst; } catch { /* ignora */ }

  // CONTEXTO POS-COMPRA (aba Clientes, Ailson 04/07/2026): conversa que nasceu
  // de disparo do modulo Clientes (autor lara_clientes = feedback pos-compra /
  // novidades). A Lara recebe os dados REAIS da compra pra nunca dizer que "nao
  // tem acesso ao pedido" (caso Denise: perguntou "qual foi a compra?" e a Lara
  // mandou ela pro site), e regras de encerramento pra nao prolongar quando a
  // cliente ja confirmou que deu tudo certo (caso Katia: "gostou da peca? posso
  // ajudar com alguma coisa?" depois do "certinho").
  try {
    const ehClientes = (msgs || []).some(m => m.autor === 'lara_clientes');
    if (ehClientes) {
      let linhasCompras = [];
      if (conv.cliente_id) {
        const { data: vendas } = await supabase.from('meluni_vendas')
          .select('data_pedido, total_pedido, itens')
          .eq('cliente_id', conv.cliente_id)
          .neq('situacao_id', 12)
          .order('data_pedido', { ascending: false })
          .limit(3);
        linhasCompras = (vendas || []).map(v => {
          const its = Array.isArray(v.itens) ? v.itens : [];
          const pecas = its.map(i => `${i.quantidade || 1}x ${i.descLimpa || i.descricao || 'peça'}${(i.cor || i.tamanho) ? ` (${[i.cor, i.tamanho].filter(Boolean).join(', ')})` : ''}`).join(' + ');
          const dt = v.data_pedido ? String(v.data_pedido).slice(0, 10).split('-').reverse().slice(0, 2).join('/') : '';
          const tot = Number(v.total_pedido || 0).toFixed(2).replace('.', ',');
          return `- ${dt}: ${pecas || 'pedido'}, total R$ ${tot}`;
        });
      }
      const blocoCli = `CONTEXTO DESTA CONVERSA (dados internos, nao mostre este bloco): esta conversa nasceu de uma mensagem que a MELUNI enviou pra cliente (feedback pos-compra do modulo Clientes). Ela e cliente REAL, ja comprou no site.${linhasCompras.length ? `\nCOMPRAS DELA (mais recentes primeiro):\n${linhasCompras.join('\n')}` : ''}
REGRAS POS-COMPRA (obrigatorias nesta conversa):
- Se a cliente perguntar do que se trata, "qual foi a compra" ou nao lembrar, responda NA HORA com os dados acima (peca, cor, tamanho e data), curto e natural. NUNCA diga que nao tem acesso ao pedido e NAO mande ela consultar no site: vc TEM o dado acima. O valor cite so se ela perguntar.
- Se ela confirmar que chegou tudo certo / que gostou, encerre com UMA mensagem curta e calorosa de agradecimento, SEM fazer perguntas novas e SEM puxar mais assunto (nada de "gostou da peca?", "posso ajudar com mais alguma coisa?"). No maximo se coloque a disposicao em meia frase e pronto.
- Se ela relatar problema (nao chegou, veio errado, nao serviu), acolha, peca os detalhes necessarios e diga que a equipe vai resolver. Nao prometa prazo.
- Tom de relacionamento e suporte, nao de venda. Nao empurre site nem pecas novas sem ela pedir.`;
      extra = extra ? extra + '\n\n' + blocoCli : blocoCli;
    }
  } catch { /* ignora */ }
  const nomeCli = (conv.nome_cliente || '').trim();
  let primeiroCli = '';
  if (nomeCli && !/^\+?\d/.test(nomeCli) && !/cliente|direct|whats|lojista/i.test(nomeCli)) {
    const p = nomeCli.split(/\s+/)[0];
    primeiroCli = p.charAt(0).toUpperCase() + p.slice(1);
  }
  const jaCumprimentou = msgs.some(m => m.direcao === 'saida');
  const cl = await chamarClaude({ modelo, systemBlocks: await systemBlocksLara(snap, extra, conv.canal, primeiroCli, jaCumprimentou), messages: mensagens, max_tokens: 400, temperature: 0.7 });
  if (!cl.ok) return { motivo: 'claude_falhou', erro: cl.erro };
  const texto = (cl.texto || '').trim();
  if (!texto) return { motivo: 'claude_vazio' };

  let custo = null;
  try { custo = await calcularCustoBRL({ modelo, input_tokens: cl.usage?.input_tokens, output_tokens: cl.usage?.output_tokens, cache_read_tokens: cl.usage?.cache_read_tokens, cache_write_tokens: cl.usage?.cache_write_tokens }); } catch { /* ignora */ }

  // 5. grava sugestão pendente
  const { data: sug, error } = await supabase.from('meluni_sugestoes').insert({
    conversa_id: conversaId, texto, tipo_midia: 'text', status: 'pendente',
    origem: 'lara_ia', modelo, custo_brl: (custo && typeof custo === 'object') ? (custo.custo_brl ?? null) : (custo ?? null),
  }).select('id').single();
  if (error) return { motivo: 'erro_gravar_sugestao', erro: error.message };

  const autoCls = classificarAutoEnvioLara(msgs, ultima);
  return { motivo: 'sugestao_criada', sugestaoId: sug.id, texto, autoEnviar: autoCls.auto, autoCaso: autoCls.caso };
}
