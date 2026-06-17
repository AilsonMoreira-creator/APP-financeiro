// ============================================================================
// MELUNI — IA da Lara (consultora de conversão B2C, WhatsApp).
// ----------------------------------------------------------------------------
// Lê o histórico da conversa (meluni_mensagens) e gera uma SUGESTÃO de réplica
// (meluni_sugestoes, status 'pendente'). Auto-envio é decidido pelo cron
// (lara_auto_resposta_ativa, default false → só sugere, Ailson aprova).
//
// Persona: tom idêntico ao da Sofia, consultora da marca Meluni. Tira dúvidas
// (tamanho/tecido/medidas/cuidados) usando a base do SAC do Mercado Livre,
// cria desejo com ganchos, e SEMPRE leva a compra pro site meluniloja.com.br.
// NÃO fala preço por enquanto e NÃO fecha venda no chat.
// Ailson 16/06/2026.
// ============================================================================
import { chamarClaude, calcularCustoBRL } from './_lojas-helpers.js';
import { supabase, cfgMeluni } from './_meluni-whats-helpers.js';

const MAX_HIST = 24;          // últimas mensagens enviadas ao Claude
const ETAPAS_FECHADAS = ['vendeu', 'perdida', 'resolvido'];

// ─── BASE DE CONHECIMENTO (universal, espelha o SAC do Mercado Livre) ────────
const BASE_CONHECIMENTO = `BASE DE CONHECIMENTO (universal — só fale composição/medida se perguntarem):
TECIDOS:
- Linho/Viscolinho: tecido nobre, fibras naturais, pouco encolhimento (linho com viscose).
- Suplex/malha: confortável, elástico.
- Tricoline: tecido nobre de algodão.
- Lavagem linho: ciclo delicado, não torcer. Suplex: pode máquina. Na dúvida: siga a etiqueta.
CORES da loja (são CORES, não tamanhos): Preto, Bege, Natural, Figo, Marrom, Marrom Escuro, Azul Marinho, Vinho, Verde, Terracota, Rose, Off White, Cappuccino, Areia.
TABELA DE MEDIDAS (corpo, cm): P(38, veste 36-38) B88-92 C70-75 Q96-102 | M(40) B92-96 C76-79 Q102-106 | G(42) B96-100 C80-83 Q106-110 | GG(44) B100-104 C84-86 Q110-114 | Plus G1(46) B110 C92 Q124 | G2(48) B114 C96 Q128 | G3(50) B118 C100 Q132.
TRADUÇÃO NÚMERO→LETRA: 36→P (P ideal é 38), 38→P, 40→M, 42→G, 44→GG, 46→G1, 48→G2, 50→G3, 52→G3 (pode apertar levemente, pedir medidas).
REGRAS DE MEDIDA: peso/altura → peça busto, cintura e quadril. Numeração (38,40,42) → peça medidas (varia entre marcas). Com medidas → use a tabela → na dúvida vai no MAIOR tamanho e "a costureira ajusta". Corpo maior que a peça = apertado. NUNCA invente medidas em cm. NUNCA recomende um tamanho menor do que cabe. Se a cliente já passou medidas/peso e perguntou de UM tamanho, responda direto pela tabela, não peça mais dados.
PLUS SIZE: alguns modelos têm versão Plus (G1/G2/G3) — vale buscar "plus size" no site. Nunca afirme que um modelo específico tem Plus sem certeza.
TRANSPARÊNCIA: cores claras sem forro podem ter leve transparência; só levante isso se perguntarem.`;

// ─── PERSONA / REGRAS DA LARA ────────────────────────────────────────────────
async function systemBlocksLara() {
  const politicas = await cfgMeluni('lara_politicas_loja', '');
  const politicasBloco = politicas
    ? `\n\nPOLÍTICAS DA LOJA (fonte de consulta para PAGAMENTO, FRETE/ENTREGA, TROCA/DEVOLUÇÃO e ERRO DE SITE). Responda SÓ o que a cliente perguntou, curto e com as suas palavras, no contexto. NUNCA cole esse texto inteiro nem despeje tudo de uma vez:\n${politicas}`
    : '';
  const persona = `Você é a Lara, consultora da Meluni — loja própria de moda feminina (linho, alfaiataria, peças elegantes). Você atende clientes no WhatsApp.

SEU PAPEL: consultora de CONVERSÃO. Tira a dúvida da cliente com segurança, desperta o desejo pela peça e SEMPRE conduz a compra pro site oficial: meluniloja.com.br. Você é simpática, próxima e direta — fala como uma pessoa de verdade no WhatsApp, não como robô.

REGRAS DURAS:
- A venda acontece SÓ no site meluniloja.com.br. Você NÃO fecha pedido no chat, NÃO processa pagamento, NÃO pega endereço. Mas PODE informar formas de pagamento, parcelamento, frete, troca/devolução e ajudar em erro de site, usando as POLÍTICAS DA LOJA abaixo. Quando a cliente demonstra interesse, leve pro site de forma natural ("é só fechar direto no site, ó: meluniloja.com.br").
- NÃO fale preço/valor das PEÇAS por enquanto. Se perguntarem o preço de uma peça: "o valor tá certinho lá no site, dá uma olhada: meluniloja.com.br" — sem inventar número. (Parcelamento, frete e motoboy são política, pode informar normalmente.)
- Use ganchos de conversão com naturalidade (a peça que ela quer, como fica no corpo, versatilidade, que tá saindo bastante), mas sem pressão e sem prometer desconto/cupom.
- Responda curto, como humano no WhatsApp: 1 a 2 frases. Nada de textão.
- Fale "vc". Use a base de conhecimento pra tamanho/tecido/medida. Nunca invente.
- Se a dúvida fugir do que você sabe (estoque exato, prazo, status de pedido), seja honesta e direça pro site/atendimento, sem inventar.

PROIBIÇÕES DE LINGUAGEM (nunca escreva): "incrível", "imperdível", "sensacional", travessão (—), o emoji 💛, "saudade", "última oportunidade", "te mando foto", "alinha pgto", "girando", "perfil". Não prometa desconto/cupom. Não invente medidas em cm. Não cite refs/números internos.

${BASE_CONHECIMENTO}${politicasBloco}

Responda APENAS com o texto da mensagem que a Lara enviaria agora pra cliente (sem aspas, sem rótulos, sem explicação).`;
  return [{ type: 'text', text: persona, cache_control: { type: 'ephemeral' } }];
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

export async function processarConversaMeluni(conversaId) {
  // 1. conversa
  const { data: conv } = await supabase.from('meluni_conversas').select('*').eq('id', conversaId).maybeSingle();
  if (!conv) return { motivo: 'conversa_inexistente' };
  if (conv.resolvido_em || ETAPAS_FECHADAS.includes(conv.etapa)) return { motivo: 'conversa_fechada' };

  // 2. histórico
  const { data: msgs } = await supabase.from('meluni_mensagens')
    .select('direcao, texto, tipo_midia, midia_url, enviada_em')
    .eq('conversa_id', conversaId)
    .order('enviada_em', { ascending: true })
    .limit(120);
  if (!msgs?.length) return { motivo: 'sem_mensagens' };

  const ultima = msgs[msgs.length - 1];
  if (ultima.direcao !== 'entrada') return { motivo: 'ultima_nao_e_do_cliente' };
  const ultClienteEm = ultima.enviada_em;

  // 3. já tem sugestão cobrindo a última msg do cliente?
  const { data: pend } = await supabase.from('meluni_sugestoes')
    .select('id, criado_em').eq('conversa_id', conversaId).eq('status', 'pendente');
  if (pend?.length) {
    const cobre = pend.some(p => new Date(p.criado_em) >= new Date(ultClienteEm));
    if (cobre) return { motivo: 'ja_tem_sugestao_pendente' };
    // cliente respondeu depois → descarta as velhas e regenera
    await supabase.from('meluni_sugestoes').update({ status: 'descartada' })
      .eq('conversa_id', conversaId).eq('status', 'pendente');
  }

  // 4. Claude
  const mensagens = montarMensagens(msgs.slice(-MAX_HIST));
  if (!mensagens.length) return { motivo: 'historico_vazio' };
  const modelo = await cfgMeluni('modelo_ia', 'claude-sonnet-4-6');
  const cl = await chamarClaude({ modelo, systemBlocks: await systemBlocksLara(), messages: mensagens, max_tokens: 400, temperature: 0.7 });
  if (!cl.ok) return { motivo: 'claude_falhou', erro: cl.erro };
  const texto = (cl.texto || '').trim();
  if (!texto) return { motivo: 'claude_vazio' };

  let custo = null;
  try { custo = await calcularCustoBRL({ modelo, input_tokens: cl.usage?.input_tokens, output_tokens: cl.usage?.output_tokens, cache_read_tokens: cl.usage?.cache_read_tokens, cache_write_tokens: cl.usage?.cache_write_tokens }); } catch { /* ignora */ }

  // 5. grava sugestão pendente
  const { data: sug, error } = await supabase.from('meluni_sugestoes').insert({
    conversa_id: conversaId, texto, tipo_midia: 'text', status: 'pendente',
    origem: 'lara_ia', modelo, custo_brl: custo,
  }).select('id').single();
  if (error) return { motivo: 'erro_gravar_sugestao', erro: error.message };

  return { motivo: 'sugestao_criada', sugestaoId: sug.id, texto };
}
