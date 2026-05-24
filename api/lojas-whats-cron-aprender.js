// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-aprender.js — Coração da Sofia: aprendizado contínuo
// ═══════════════════════════════════════════════════════════════════════════
//
// Roda 1x por dia (02h BRT, ANTES do cron-selecionar). Faz 3 etapas:
//
//   1. EXTRAI FEATURES das mensagens Sofia em conversas que TERMINARAM
//      nas últimas 24h. Usa Claude Haiku (~$0.0001/msg).
//      Features extraídas:
//        - palavras: ['pix','frete','12 peças']
//        - emojis: ['🔥','💰']
//        - faixa_horario: '9-11' | '11-13' | '13-15' | '15-17' | '17-19' | '19-21'
//        - etapa_no_envio: etapa da conversa no momento do envio
//        - tipo: 'texto' | 'catalogo' | 'foto_avulsa' | 'pergunta'
//        - mencionou: { preco, frete, pix, catalogo, urgencia }
//        - comprimento: 'curta'(<50) | 'media'(50-150) | 'longa'(>150)
//        - tom: 'formal' | 'casual' | 'urgente'
//
//   2. ATRIBUI CONTRIBUIÇÃO via decay (1A escolha Ailson):
//        última msg pesa 0.50
//        anterior      0.30
//        2 antes       0.15
//        3 antes       0.05
//        outras        0.00
//      Insere em lojas_whats_aprendizado_eventos.
//
//   3. RE-AGREGA padrões via função SQL lojas_whats_reaggregate_padroes.
//      Atualiza lojas_whats_aprendizado_padroes com novos amostras/sucessos.
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODELO_EXTRACAO = 'claude-haiku-4-5-20251001';

const CONTRIBUICAO_DECAY = [0.50, 0.30, 0.15, 0.05];

function faixaHorarioBRT(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const brt = new Date(d.getTime() - 3 * 3600 * 1000);
  const h = brt.getUTCHours();
  if (h < 9) return 'antes_9';
  if (h < 11) return '9-11';
  if (h < 13) return '11-13';
  if (h < 15) return '13-15';
  if (h < 17) return '15-17';
  if (h < 19) return '17-19';
  if (h < 21) return '19-21';
  return 'depois_21';
}

/**
 * Extrai features de uma mensagem Sofia via Claude Haiku.
 * Retorna JSON com palavras/emojis/tipo/mencionou/comprimento/tom.
 */
async function extrairFeaturesViaClaude(textoMsg) {
  if (!textoMsg || textoMsg.trim().length === 0) return {};

  const prompt = `Analisa esta mensagem da Sofia (assistente IA de uma loja de moda feminina) enviada a uma cliente no WhatsApp. Retorna APENAS JSON valido (sem markdown):

{
  "palavras": ["palavra1","palavra2"],
  "emojis": ["emoji1","emoji2"],
  "tipo": "texto" | "catalogo" | "foto_avulsa" | "pergunta",
  "mencionou": {
    "preco": true/false,
    "frete": true/false,
    "pix": true/false,
    "catalogo": true/false,
    "urgencia": true/false,
    "promocao": true/false
  },
  "comprimento": "curta" | "media" | "longa",
  "tom": "formal" | "casual" | "urgente"
}

Regras:
- palavras: 3-8 palavras-chave significativas (substantivos, verbos de acao). NAO inclui artigos/preposicoes.
- emojis: cada emoji distinto. Exclui o emoji da Sofia padrao (oi).
- tipo: "catalogo" se enviou lista de produtos com links. "foto_avulsa" se mandou 1 foto. "pergunta" se a msg eh interrogativa. Senao "texto".
- comprimento: <50 chars = curta. 50-150 = media. >150 = longa.
- tom: "urgente" se tem !! ou palavras urgentes. "formal" se voce/vc nao aparece. Senao "casual".

MENSAGEM:
"""${textoMsg.slice(0, 2000)}"""`;

  try {
    const r = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO_EXTRACAO,
        max_tokens: 400,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || 'Claude API erro');
    const txt = j.content?.[0]?.text || '{}';
    // Remove possiveis markdown fences
    const limpo = txt.replace(/```json|```/g, '').trim();
    return JSON.parse(limpo);
  } catch (e) {
    console.warn('[cron-aprender] erro extracao features:', e.message);
    return {};
  }
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const ua = req.headers['user-agent'] || '';
  const ehCron = ua.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({ error: 'Cron only. Use ?force=1 pra teste.' });
  }
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY nao definida' });
  }

  const tInicio = Date.now();
  const limite = parseInt(req.query?.limite || '100', 10);  // max conversas/run
  let conversasProcessadas = 0;
  let msgsProcessadas = 0;
  let eventosInseridos = 0;
  let erros = 0;

  try {
    // Conversas em estado FINAL (vendeu/perdida/atendida) das ultimas 48h
    // que AINDA NAO tem evento de aprendizado.
    // 48h pra garantir cobertura mesmo se cron pulou um dia.
    const corte = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: conversas } = await supabase
      .from('lojas_whats_conversas')
      .select('id, etapa, atualizado_em')
      .in('etapa', ['vendeu', 'perdida', 'atendida'])
      .gte('atualizado_em', corte)
      .limit(limite);

    for (const cv of conversas || []) {
      // Pula se ja processada (algum evento existente dessa conversa)
      const { count } = await supabase
        .from('lojas_whats_aprendizado_eventos')
        .select('*', { count: 'exact', head: true })
        .eq('conversa_id', cv.id);
      if ((count || 0) > 0) continue;

      // Carrega mensagens Sofia (direcao=saida) dessa conversa, ordenadas
      const { data: msgs } = await supabase
        .from('lojas_whats_mensagens')
        .select('id, texto, enviada_em')
        .eq('conversa_id', cv.id)
        .eq('direcao', 'saida')
        .not('enviada_em', 'is', null)
        .order('enviada_em', { ascending: true });

      if (!msgs || msgs.length === 0) continue;

      // Atribui contribuicao via DECAY (1A): ultima msg pesa mais
      // Indices reversos da lista: ultima = 0, anterior = 1, ...
      const total = msgs.length;
      conversasProcessadas++;

      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        const idxReverso = total - 1 - i;  // 0 = ultima
        const contribuicao = idxReverso < CONTRIBUICAO_DECAY.length
          ? CONTRIBUICAO_DECAY[idxReverso]
          : 0;

        // Extrai features da msg via Claude
        let features = {};
        try {
          features = await extrairFeaturesViaClaude(m.texto);
        } catch (e) { erros++; }

        // Anota metadados deterministicos
        features.faixa_horario = faixaHorarioBRT(m.enviada_em);
        features.etapa_no_envio = cv.etapa;  // simplificacao: usa etapa final

        // Insere evento
        const { error: errIns } = await supabase
          .from('lojas_whats_aprendizado_eventos')
          .insert({
            mensagem_id: m.id,
            conversa_id: cv.id,
            features_msg: features,
            features_resposta: {},  // TODO fase 2: extrai da msg resposta cliente
            outcome_conversa: cv.etapa,
            contribuicao,
            modo: 'replicar',  // default; cron-ia marca exploracao quando aplicavel
            registrado_em: new Date().toISOString(),
          });
        if (errIns) {
          if (!String(errIns.message).includes('duplicate')) erros++;
        } else {
          eventosInseridos++;
        }
        msgsProcessadas++;
      }
    }

    // Re-agrega padroes (SQL function)
    let padroesAtualizados = 0;
    try {
      const { data: agg } = await supabase
        .rpc('lojas_whats_reaggregate_padroes').maybeSingle();
      padroesAtualizados = agg?.padroes_atualizados || 0;
    } catch (e) {
      console.warn('[cron-aprender] erro reagregacao:', e.message);
    }

    return res.json({
      ok: true,
      duracao_ms: Date.now() - tInicio,
      conversas_processadas: conversasProcessadas,
      msgs_processadas: msgsProcessadas,
      eventos_inseridos: eventosInseridos,
      padroes_atualizados: padroesAtualizados,
      erros,
      custo_estimado_usd: msgsProcessadas * 0.0001,
    });
  } catch (e) {
    console.error('[cron-aprender] exception:', e);
    return res.status(500).json({ error: e.message, duracao_ms: Date.now() - tInicio });
  }
}
