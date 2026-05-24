// ═══════════════════════════════════════════════════════════════════════════
// _lojas-whats-handoff-ia.js — Gera contexto rico pra vendedora via IA
// ═══════════════════════════════════════════════════════════════════════════
//
// Quando assistente clica "Enviar vendedora" no card quente, este helper:
//   1. Le ultimas 10 mensagens da conversa
//   2. Le info do carrinho (qtd_pecas, valor, items)
//   3. Manda pra Claude Haiku extrair:
//      - resumo_conversa: 2-3 frases "Cliente Maria, interesse em vestidos
//                         de viscose, pediu pix com 5% off, ja viu fotos do 2655"
//      - modelos_interesse: array ["2655 Macacao", "VESTIDO viscose"]
//      - mensagem_sugerida: msg pronta pra vendedora enviar pelo WhatsApp
//                          (tom Sofia, tu, sem amicia mencao excessiva, etc)
//
// Tudo persistido em lojas_whats_handoffs antes de retornar.
// Vendedora ve no card direto, sem precisar abrir conversa pra entender contexto.
//
// Ailson 26/05/2026 (sessao tarde)
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro } from './_lojas-whats-helpers.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODELO_HAIKU = 'claude-haiku-4-5-20251001';

function fmtMoneyBR(n) {
  if (!Number(n)) return null;
  return Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Gera contexto IA pro handoff. NAO bloqueia em caso de erro (handoff segue
 * com campos vazios se Haiku falhar).
 *
 * @param {string} conversaId
 * @returns {Promise<{resumo_conversa, pecas_info, modelos_interesse, mensagem_sugerida}>}
 */
export async function gerarContextoHandoff(conversaId) {
  const inicio = Date.now();
  const fallback = {
    resumo_conversa: null,
    pecas_info: null,
    modelos_interesse: [],
    mensagem_sugerida: null,
  };

  if (!ANTHROPIC_KEY) return fallback;

  try {
    // 1. Pega conversa + ultimas msgs
    const { data: conv } = await supabase
      .from('lojas_whats_conversas')
      .select('id, nome_cliente, telefone, tipo_documento, etapa, qtd_pecas, valor_carrinho, gatilhos_detectados, items_html_raw, carrinho_id')
      .eq('id', conversaId)
      .maybeSingle();
    if (!conv) return fallback;

    const { data: msgs } = await supabase
      .from('lojas_whats_mensagens')
      .select('direcao, autor, texto, enviada_em')
      .eq('conversa_id', conversaId)
      .not('texto', 'is', null)
      .order('enviada_em', { ascending: false })
      .limit(10);
    const msgsOrdenadas = (msgs || []).reverse();

    // 2. Pecas info pre-formatado (deterministico — nao depende de IA)
    const pecasInfo = (() => {
      const p = conv.qtd_pecas ? `${conv.qtd_pecas} peças` : null;
      const v = conv.valor_carrinho ? fmtMoneyBR(conv.valor_carrinho) : null;
      if (p && v) return `${p} · ${v}`;
      return p || v || null;
    })();

    // 3. Monta historico em texto
    const historico = msgsOrdenadas.map(m => {
      const quem = m.direcao === 'entrada' ? 'CLIENTE' :
                   (m.autor === 'sofia_ia' ? 'SOFIA' : 'ASSISTENTE');
      return `${quem}: ${(m.texto || '').slice(0, 300)}`;
    }).join('\n');

    if (historico.trim().length === 0) {
      return { ...fallback, pecas_info: pecasInfo };
    }

    // 4. Prompt unico — pede 3 coisas em JSON pra economizar tokens
    const prompt = `Analise essa conversa de WhatsApp entre uma assistente IA (Sofia, loja Amicia moda feminina atacado) e uma cliente. Extraia 3 informacoes em JSON valido (sem markdown):

{
  "resumo_conversa": "2-3 frases pra vendedora bater olho. Inclui o que cliente quer, objecoes, e estado emocional. Direto, sem floreios. Max 200 chars.",
  "modelos_interesse": ["Lista de produtos/categorias que cliente demonstrou interesse durante a conversa. Inclui REFs numericas se mencionadas e categorias (VESTIDO, MACACAO, BLUSA, etc). Max 5 itens. Vazio [] se nao identificou."],
  "mensagem_sugerida": "Mensagem pronta pra vendedora enviar pelo WhatsApp continuando o atendimento. Tom: 'tu', humano, profissional mas casual. SEM mencionar 'sou nova vendedora' ou similar — cliente nao precisa saber que mudou de pessoa. Continua de onde a Sofia parou. Max 250 chars. NAO usa emojis. NAO usa 'imperdível/incrível/sensacional/travessao'. SEM R$ em sacolas."
}

CONTEXTO:
- Cliente: ${conv.nome_cliente || 'sem nome'} (${conv.tipo_documento || 'PF'})
- Carrinho: ${pecasInfo || 'sem info'}
- Etapa: ${conv.etapa}
- Gatilhos: ${JSON.stringify(conv.gatilhos_detectados || [])}

HISTORICO DA CONVERSA (ordem cronologica):
"""
${historico}
"""`;

    // 5. Chama Haiku
    const r = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO_HAIKU,
        max_tokens: 600,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'Claude erro');
    const txt = (j.content?.[0]?.text || '').replace(/```json|```/g, '').trim();

    let parsed = {};
    try { parsed = JSON.parse(txt); } catch (e) {
      logErro('handoff-ia/parse', new Error(`JSON invalido: ${txt.slice(0, 100)}`));
      return { ...fallback, pecas_info: pecasInfo };
    }

    log('handoff-ia', `conversa=${conversaId} duracao=${Date.now() - inicio}ms`);

    return {
      resumo_conversa: typeof parsed.resumo_conversa === 'string'
        ? parsed.resumo_conversa.slice(0, 400) : null,
      pecas_info: pecasInfo,
      modelos_interesse: Array.isArray(parsed.modelos_interesse)
        ? parsed.modelos_interesse.slice(0, 5).map(String) : [],
      mensagem_sugerida: typeof parsed.mensagem_sugerida === 'string'
        ? parsed.mensagem_sugerida.slice(0, 500) : null,
    };
  } catch (e) {
    logErro('handoff-ia', e);
    return fallback;
  }
}
