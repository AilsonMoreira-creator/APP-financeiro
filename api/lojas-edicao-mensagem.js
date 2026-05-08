// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-edicao-mensagem
// ═══════════════════════════════════════════════════════════════════════════
// POST: vendedora editou mensagem da IA. Salva o par original/editada e
// atualiza o perfil de estilo dela (saudacao, tratamento, emojis...).
// Esse perfil vai ser usado no prompt da IA na proxima geracao pra ela
// "aprender" o estilo da vendedora.
// ═══════════════════════════════════════════════════════════════════════════

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { sugestao_id, vendedora_id, original, editada, user_id } = req.body || {};

    if (!vendedora_id) {
      return res.status(400).json({ error: 'vendedora_id obrigatorio' });
    }
    if (!original || !editada) {
      return res.status(400).json({ error: 'original e editada obrigatorios' });
    }
    if (original === editada) {
      // Sem mudanca real, ignora
      return res.json({ ok: true, ignorado: 'sem_mudanca' });
    }

    // 1. Busca cliente_id pela sugestao (se informada)
    let cliente_id = null;
    if (sugestao_id) {
      const { data: sug } = await supabase
        .from('lojas_sugestoes_diarias')
        .select('cliente_id')
        .eq('id', sugestao_id)
        .maybeSingle();
      cliente_id = sug?.cliente_id || null;
    }

    // 2. Salva audit
    await supabase.from('lojas_edicoes_mensagens').insert({
      vendedora_id,
      sugestao_id: sugestao_id || null,
      cliente_id,
      texto_original: original,
      texto_editado: editada,
      user_id: user_id || null,
    });

    // 3. Extrai padroes da edicao
    const padroes = extrairPadroes(editada);

    // 4. Atualiza perfil de estilo (incrementa counters)
    //    APENAS se vendedora NAO esta aprendendo com outra.
    //    Decisao Ailson 07/05/2026 (3b): quando aprende_com != null, IA
    //    busca estilo da REFERENCIA e nao da vendedora. Atualizar contadores
    //    proprios seria desperdicio. Audit (lojas_edicoes_mensagens)
    //    continua gravando pra historico.
    const { data: aprendeRow } = await supabase
      .from('lojas_config')
      .select('valor')
      .eq('chave', `aprende_com.${vendedora_id}`)
      .maybeSingle();
    const aprendeCom = aprendeRow?.valor || null;
    if (!aprendeCom) {
      await atualizarEstilo(vendedora_id, padroes);
    }

    return res.json({ ok: true, padroes, aprende_com: aprendeCom, contadores_atualizados: !aprendeCom });
  } catch (e) {
    console.error('[edicao-mensagem] erro:', e);
    return res.status(500).json({ error: e.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers de extracao de padroes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrai padroes de estilo da mensagem editada:
 *   - Saudacao inicial (primeiras palavras)
 *   - Saudacao final (ultimas palavras)
 *   - Tratamento (palavras de carinho usadas)
 *   - Emojis presentes
 */
function extrairPadroes(texto) {
  const t = String(texto || '').trim();
  const linhas = t.split(/\n+/).filter(Boolean);
  const primeiraLinha = linhas[0] || '';
  const ultimaLinha = linhas[linhas.length - 1] || '';

  return {
    saudacao_inicial: detectarSaudacaoInicial(primeiraLinha),
    saudacao_final: detectarSaudacaoFinal(ultimaLinha),
    tratamento: detectarTratamento(t),
    emojis: detectarEmojis(t),
  };
}

const SAUDACOES_INICIAIS = [
  /^(bom dia|boa tarde|boa noite)/i,
  /^(oiii+|oi|olá|ola|hey)/i,
  /^(e a[ií]+|fala)/i,
];

function detectarSaudacaoInicial(primeiraLinha) {
  const linha = String(primeiraLinha || '').trim();
  if (!linha) return null;
  for (const re of SAUDACOES_INICIAIS) {
    const m = linha.match(re);
    if (m) {
      // Captura a saudacao real escrita (ex: "Oii", "Olá", "Bom dia")
      return m[0].toLowerCase();
    }
  }
  // Fallback: pega primeira palavra se for curta
  const primeiraPalavra = linha.split(/\s+/)[0];
  if (primeiraPalavra && primeiraPalavra.length <= 10) {
    return primeiraPalavra.replace(/[!,.?]/g, '').toLowerCase();
  }
  return null;
}

const SAUDACOES_FINAIS = [
  /\b(bjs|bjos|bjss?)\b/i,
  /\b(beijos|beijo)\b/i,
  /\b(abra[çc]os?)\b/i,
  /\b(at[eé] (mais|j[aá]|logo))\b/i,
  /\b(obrigad[ao])\b/i,
  /\b(valeu)\b/i,
];

function detectarSaudacaoFinal(ultimaLinha) {
  const linha = String(ultimaLinha || '').trim();
  if (!linha) return null;
  for (const re of SAUDACOES_FINAIS) {
    const m = linha.match(re);
    if (m) return m[0].toLowerCase();
  }
  return null;
}

const TRATAMENTOS = [
  /\b(querid[ao]s?)\b/i,
  /\b(lind[ao]s?)\b/i,
  /\b(amig[ao]s?)\b/i,
  /\b(amor)\b/i,
  /\b(flor(zinha)?)\b/i,
  /\b(belez(?:a|inha))\b/i,
];

function detectarTratamento(texto) {
  const found = new Set();
  for (const re of TRATAMENTOS) {
    const m = texto.match(re);
    if (m) found.add(m[0].toLowerCase());
  }
  return Array.from(found);  // pode ter mais de 1 por mensagem
}

// Regex unicode pra detectar emojis (cobre maioria dos casos)
const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu;

function detectarEmojis(texto) {
  const matches = String(texto).match(EMOJI_RE) || [];
  // Conta repeticoes do mesmo emoji
  const counts = {};
  for (const e of matches) {
    counts[e] = (counts[e] || 0) + 1;
  }
  return counts;
}

// ═══════════════════════════════════════════════════════════════════════════
// Atualizacao do perfil de estilo (jsonb counters)
// ═══════════════════════════════════════════════════════════════════════════

async function atualizarEstilo(vendedoraId, padroes) {
  // Busca perfil atual
  const { data: atual } = await supabase
    .from('lojas_estilo_vendedora')
    .select('*')
    .eq('vendedora_id', vendedoraId)
    .maybeSingle();

  // Faz merge dos counters
  const saudacaoInicial = mergeCounter(atual?.saudacao_inicial, padroes.saudacao_inicial ? [padroes.saudacao_inicial] : []);
  const saudacaoFinal = mergeCounter(atual?.saudacao_final, padroes.saudacao_final ? [padroes.saudacao_final] : []);
  const tratamento = mergeCounter(atual?.tratamento, padroes.tratamento || []);
  const emojis = mergeCounterMulti(atual?.emojis, padroes.emojis || {});

  const payload = {
    vendedora_id: vendedoraId,
    saudacao_inicial: saudacaoInicial,
    saudacao_final: saudacaoFinal,
    tratamento,
    emojis,
    qtd_edicoes: (atual?.qtd_edicoes || 0) + 1,
    ultima_edicao_em: new Date().toISOString(),
    ultima_atualizacao: new Date().toISOString(),
  };

  await supabase
    .from('lojas_estilo_vendedora')
    .upsert(payload, { onConflict: 'vendedora_id' });
}

// Incrementa counters: cada item do array vira +1 no objeto.
function mergeCounter(atual, items) {
  const r = { ...(atual || {}) };
  for (const item of items) {
    if (!item) continue;
    r[item] = (r[item] || 0) + 1;
  }
  return r;
}

// Versao "multi": items vem como objeto {item: count}, soma direto.
function mergeCounterMulti(atual, items) {
  const r = { ...(atual || {}) };
  for (const [item, count] of Object.entries(items || {})) {
    r[item] = (r[item] || 0) + count;
  }
  return r;
}
