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
import { chamarClaude } from './_lojas-helpers.js';

// Usa Sonnet via chamarClaude (caminho COMPROVADO da Sofia). O Haiku
// (claude-haiku-4-5-20251001) estava sendo REJEITADO pela API → handoff
// sempre voltava sem contexto (resumo/mensagem null). Sonnet aqui custa
// centavos (poucos handoffs/dia) e garante a geração. Ailson 28/05/2026.
const MODELO_HANDOFF = 'claude-sonnet-4-6';

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

  if (!conversaId) return fallback;

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

    // 4. Prompt — esqueleto JSON LIMPO + regras separadas (prompt antigo
    // embutia instrucoes gigantes dentro do JSON exemplo, o que fazia o modelo
    // devolver JSON invalido/truncado → fallback. Ailson 28/05/2026.
    const temPecas = Number(conv.qtd_pecas || 0) > 0;
    const prompt = `Voce prepara o repasse de uma conversa de WhatsApp (loja Amicia, moda feminina atacado) da assistente IA Sofia pra uma vendedora humana assumir.

DADOS: Cliente ${conv.nome_cliente || 'sem nome'} (${conv.tipo_documento || 'PF'}). Carrinho: ${pecasInfo || 'sem info'}. Pecas definidas: ${temPecas ? 'SIM' : 'NAO'}. Gatilhos: ${JSON.stringify(conv.gatilhos_detectados || [])}.

HISTORICO (ordem cronologica):
"""
${historico}
"""

Devolva SOMENTE um JSON valido (sem markdown, sem nenhum texto fora do JSON), exatamente com estas 3 chaves:
{"resumo_conversa":"...","modelos_interesse":["..."],"mensagem_sugerida":"..."}

Conteudo de cada chave:
- resumo_conversa: 2-3 frases pra vendedora bater o olho (o que a cliente quer, objecoes, estado). Max 200 chars.
- modelos_interesse: array com ate 5 produtos/categorias que a cliente demonstrou interesse (REFs numericas e categorias tipo VESTIDO, MACACAO, BLUSA). [] se nao houver.
- mensagem_sugerida: mensagem pronta pra vendedora enviar assumindo o atendimento. Max 400 chars. Siga TODAS as regras abaixo.

REGRAS da mensagem_sugerida:
1. Saudacao + primeiro nome da cliente (ex: "Oii Heloise!").
2. Apresente-se: "Aqui e a [VENDEDORA], da Amicia" — use LITERALMENTE o texto [VENDEDORA], nao invente nome.
3. Cite NOMINALMENTE pecas/modelos reais do historico (ex: "a calca de couro e a jaqueta de couro", "o 2655"). NUNCA generico tipo "os modelos que voce viu". Se so houver categoria, nomeie a categoria (ex: "as blusas de renda").
4. Acao com urgencia: "ja estou separando aqui pra voce" sempre que houver peca/tipo citavel.
5. Termine com um gancho leve (ex: "quer que eu ja confirme o pedido?").
Tom "tu", humano, caloroso. Max 1 emoji. SEM travessao, SEM "imperdivel/incrivel/sensacional", SEM R$ em sacolas.`;

    // 5. Chama Claude (Sonnet via helper comprovado)
    const cl = await chamarClaude({
      modelo: MODELO_HANDOFF,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000,
      temperature: 0.3,
    });
    if (!cl.ok) {
      logErro('handoff-ia/claude', new Error(cl.erro || 'chamarClaude falhou'));
      return { ...fallback, pecas_info: pecasInfo };
    }
    const txt = (cl.texto || '').replace(/```json|```/g, '').trim();

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
