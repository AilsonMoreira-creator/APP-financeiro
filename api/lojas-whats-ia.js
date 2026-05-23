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

// ─── GATILHOS QUENTE (lista fechada — definida pelo Ailson) ────────────────

const GATILHOS_QUENTE = [
  'pix', 'qual seu pix', 'parcela', 'cartao', 'cartão',
  'frete', 'sedex', 'pac', 'onibus', 'ônibus', 'excursao', 'excursão',
  'guia', 'link pagamento', 'link de pagamento',
  'separa', 'separar', 'separe',
  'grade', 'despachar', 'despacha',
];

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

// ─── SYSTEM PROMPT da Sofia ────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é Sofia, assistente IA da Amícia, loja de moda feminina em São Paulo (Bom Retiro + Brás + site amicialoja.com.br).

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
- "Como posso ajudar você hoje?"
- "Aproveite nossa oferta especial..."
- "Última chance!", "Compre agora!"
- Travessões longos (—)
- "Incrível", "imperdível", "sensacional"
- "Querida", "minha amiga", "linda"
- Listar produtos / "temos várias opções"
- Mensagens longas (>4 linhas)

SEMPRE:
- Responder a dúvida específica do cliente
- Reforçar 1 vantagem concreta quando relevante (despacho rápido, peça única, qualidade)
- Terminar com pergunta que faz o cliente seguir a conversa
- Se cliente perguntar preço/produto que vc não tem certeza → pedir um momento e dizer que vai confirmar

CONTEXTO ATUAL DA CONVERSA será passado pra vc. Use somente os dados confirmados.

OUTPUT FORMAT:
Responda APENAS o texto da mensagem que será enviada pro cliente.
SEM aspas, sem prefixo "Resposta:", sem explicação.
APENAS o texto que vai pro WhatsApp.`;

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

async function processarConversa(conversaId) {
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

  // 3. Detecta gatilhos quente
  const gatilhos = detectarGatilhosQuente(textoCliente);
  log('ia', `conversa=${conversaId} gatilhos=[${gatilhos.join(',')}]`);

  // 4. Se gatilho QUENTE → atualiza conversa pra etapa quente (handoff em outro endpoint)
  if (gatilhos.length > 0) {
    await supabase.from('lojas_whats_conversas').update({
      etapa: 'quente',
      score_quente: 80 + Math.min(20, gatilhos.length * 5),
      gatilhos_detectados: gatilhos,
      quente_desde: new Date().toISOString(),
      ultima_atividade_em: new Date().toISOString(),
      atualizado_em: new Date().toISOString()
    }).eq('id', conversaId);
    // NÃO gera sugestão — handoff vai assumir
    return {
      motivo: 'promovido_quente',
      gatilhos,
      proxima_acao: 'handoff_vendedora'
    };
  }

  // 5. Gera réplica via Claude
  const contextoConv = montarContextoConversa(conv);
  const msgsClaude = montarMensagensClaude(msgs, conv);

  const cl = await chamarClaude({
    modelo: await getConfig('modelo_ia', 'claude-sonnet-4-6'),
    systemBlocks: [
      { type: 'text', text: SYSTEM_PROMPT },
      { type: 'text', text: `CONTEXTO DA CONVERSA:\n${contextoConv}` }
    ],
    messages: msgsClaude,
    max_tokens: 400,
    temperature: 0.7
  });

  if (!cl.ok) {
    logErro('ia/claude', cl.erro);
    throw new Error(`claude_falhou: ${cl.erro}`);
  }

  const textoProposto = (cl.texto || '').trim();
  if (!textoProposto) throw new Error('claude_retornou_vazio');

  // 6. Cria sugestão pendente
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
      claude_latencia_ms: cl.latencia_ms,
      claude_custo_brl: cl.custo_brl
    }
  });
  if (errSug) throw errSug;

  // 7. Atualiza atividade da conversa
  await supabase.from('lojas_whats_conversas').update({
    ultima_atividade_em: new Date().toISOString(),
    atualizado_em: new Date().toISOString()
  }).eq('id', conversaId);

  return {
    motivo: 'replica_proposta',
    gatilhos: [],
    proposta_chars: textoProposto.length,
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
