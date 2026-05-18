/**
 * lojas-feedback-selecionar.js — Seleciona cliente pro modal de fechamento
 *
 * POST (sem body necessário, usa X-User pra identificar vendedora)
 *
 * Retorna o TOP 1 candidato (via fn lojas_feedback_candidatos) + sorteia
 * templates de intro/close/alternativas, e CRIA a linha inicial em
 * lojas_feedback_diario (iniciado_em=NOW, sem respostas).
 *
 * Idempotência: se já existe feedback iniciado hoje pra essa vendedora,
 * retorna o mesmo (não recria). Isso permite vendedora reabrir o app sem
 * perder progresso.
 *
 * Frontend só dispara esse endpoint quando vendedora abrir a 7ª sugestão
 * do dia (sinal de conclusão). Backend filtra elegibilidade.
 *
 * Sessão Ailson 18/05/2026 — Sprint A "Modal Fechamento".
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

// Templates de intro (6 variações)
const TEMPLATES_INTRO = [
  { id: 'intro_a', texto: 'Ô {nome}! Antes de bater ponto, conta rapidinho 👀' },
  { id: 'intro_b', texto: '{nome}, ajuda a IA aqui ⚡' },
  { id: 'intro_c', texto: 'Manda bala, {nome} 🚀 só uma coisinha antes' },
  { id: 'intro_d', texto: '{nome}! Bora aprender junto? 💡' },
  { id: 'intro_e', texto: 'Ó {nome}, conta pra mim como foi com algumas clientes' },
  { id: 'intro_f', texto: '{nome} 💜 me ajuda numa rapidinha' },
];

// Fechamentos da Q3 (6 variações)
const TEMPLATES_Q3_CLOSE = [
  { id: 'close_promessa', texto: 'Tá quase! Última, prometo 😄' },
  { id: 'close_falta_uma', texto: 'Bora, falta só uma 🎯' },
  { id: 'close_te_libero', texto: 'Última e te libero 🙏' },
  { id: 'close_ia_promete', texto: 'Promessa de IA: é a última! 🤖' },
  { id: 'close_indo_embora', texto: 'Tô indo embora, falta só essa 👋' },
  { id: 'close_juro', texto: 'Juro juradinho que é a última 😅' },
];

// Sets de alternativas (3 variações, mesma semântica de opções)
const ALTERNATIVAS_SETS = {
  set_1: {
    q1: [
      { id: 'respondeu',     label: 'Respondeu',     emoji: '✅' },
      { id: 'sem_resposta',       label: 'Sem resposta', emoji: '💭' },
      { id: 'ignorou',       label: 'Ignorou',       emoji: '❌' },
      { id: 'vou_insistir',  label: 'Vou insistir',  emoji: '💪' },
    ],
    q2: [
      { id: 'com_certeza', label: 'Com certeza', emoji: '💚' },
      { id: 'talvez',      label: 'Talvez',      emoji: '🤔' },
      { id: 'dificil',     label: 'Difícil',     emoji: '💔' },
      { id: 'ja_era',      label: 'Já era',      emoji: '🪦' },
    ],
    q3: [
      { id: 'mandar_outra',   label: 'Vou mandar outra msg',       emoji: '📅' },
      { id: 'esperar',        label: 'Vou esperar ela aparecer',   emoji: '👀' },
      { id: 'outro_canal',    label: 'Vou tentar por outro canal', emoji: '📞' },
      { id: 'deixar_quieta',  label: 'Vou deixar quieta',          emoji: '☮️' },
    ],
  },
  set_2: {
    q1: [
      { id: 'respondeu',     label: 'Topou',        emoji: '🔥' },
      { id: 'sem_resposta',       label: 'Sumiu',        emoji: '👻' },
      { id: 'ignorou',       label: 'Sem clima',    emoji: '😐' },
      { id: 'vou_insistir',  label: 'Vou retomar',  emoji: '🔄' },
    ],
    q2: [
      { id: 'com_certeza', label: 'Volta sim',  emoji: '💚' },
      { id: 'talvez',      label: 'Quem sabe',  emoji: '🤔' },
      { id: 'dificil',     label: 'Tá frio',    emoji: '🧊' },
      { id: 'ja_era',      label: 'Foi-se',     emoji: '🪦' },
    ],
    q3: [
      { id: 'mandar_outra',   label: 'Reabordar próximo dia', emoji: '📅' },
      { id: 'esperar',        label: 'Deixar fluir',          emoji: '👀' },
      { id: 'outro_canal',    label: 'Trocar canal',          emoji: '📞' },
      { id: 'deixar_quieta',  label: 'Liberar a cliente',     emoji: '☮️' },
    ],
  },
  set_3: {
    q1: [
      { id: 'respondeu',     label: 'Engajou',         emoji: '💬' },
      { id: 'sem_resposta',       label: 'Fria',            emoji: '❄️' },
      { id: 'ignorou',       label: 'Bloqueou',        emoji: '🚫' },
      { id: 'vou_insistir',  label: 'Tô insistindo',   emoji: '💪' },
    ],
    q2: [
      { id: 'com_certeza', label: 'Fiel mesmo', emoji: '💚' },
      { id: 'talvez',      label: 'Vai e vem',  emoji: '🤔' },
      { id: 'dificil',     label: 'Custosa',    emoji: '💔' },
      { id: 'ja_era',      label: 'Perdida',    emoji: '🪦' },
    ],
    q3: [
      { id: 'mandar_outra',   label: 'Bato de novo',    emoji: '📅' },
      { id: 'esperar',        label: 'Tô na pista',     emoji: '👀' },
      { id: 'outro_canal',    label: 'Pego no balcão',  emoji: '📞' },
      { id: 'deixar_quieta',  label: 'Pula essa',       emoji: '☮️' },
    ],
  },
};

function sortear(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Use POST' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // Admin não tem modal (modal é da vendedora)
  if (auth.isAdmin || !auth.vendedoraId) {
    return res.status(403).json({ error: 'Endpoint apenas para vendedoras' });
  }

  const vendedoraId = auth.vendedoraId;
  const hojeISO     = new Date().toISOString().slice(0, 10);

  try {
    // ───────────────────────────────────────────────────────────────
    // 1. Idempotência: já existe feedback iniciado hoje?
    // ───────────────────────────────────────────────────────────────
    const { data: existing, error: errExist } = await supabase
      .from('lojas_feedback_diario')
      .select('id, cliente_id, sugestao_id, data_sugestao, prioridade_origem, template_intro, template_q3_close, resposta_q1, resposta_q2, resposta_q3, motivo_encerramento')
      .eq('vendedora_id', vendedoraId)
      .eq('data_pergunta', hojeISO)
      .order('iniciado_em', { ascending: false })
      .limit(1);

    if (errExist) {
      return res.status(500).json({ error: errExist.message });
    }

    if (existing?.length > 0) {
      const f = existing[0];
      // Se já tá finalizado, sinaliza pro frontend não reabrir
      if (f.motivo_encerramento) {
        return res.json({
          ok: true,
          ja_respondeu_hoje: true,
          motivo_encerramento: f.motivo_encerramento,
        });
      }
      // Caso contrário, retorna o mesmo registro pra retomar
      const { data: cli } = await supabase
        .from('lojas_clientes')
        .select('apelido, comprador_nome')
        .eq('id', f.cliente_id)
        .maybeSingle();
      return res.json({
        ok: true,
        retomado: true,
        feedback_id:        f.id,
        cliente_id:         f.cliente_id,
        cliente_nome:       cli?.apelido || cli?.comprador_nome || 'Cliente',
        sugestao_id:        f.sugestao_id,
        data_sugestao:      f.data_sugestao,
        prioridade_origem:  f.prioridade_origem,
        template_intro:     TEMPLATES_INTRO.find(t => t.id === f.template_intro)    || TEMPLATES_INTRO[0],
        template_q3_close:  TEMPLATES_Q3_CLOSE.find(t => t.id === f.template_q3_close) || sortear(TEMPLATES_Q3_CLOSE),
        alternativas:       ALTERNATIVAS_SETS.set_1, // fallback estável
        ja_respondidas:     { q1: f.resposta_q1, q2: f.resposta_q2, q3: f.resposta_q3 },
      });
    }

    // ───────────────────────────────────────────────────────────────
    // 2. Chama fn SQL pra pegar candidatos elegíveis
    // ───────────────────────────────────────────────────────────────
    const { data: candidatos, error: errCand } = await supabase
      .rpc('lojas_feedback_candidatos', {
        p_vendedora_id:  vendedoraId,
        p_data_pergunta: hojeISO,
        p_limit:         5,
      });

    if (errCand) {
      return res.status(500).json({ error: errCand.message });
    }

    if (!candidatos || candidatos.length === 0) {
      return res.json({
        ok: true,
        sem_candidatos: true,
        motivo: 'Sem clientes elegíveis hoje (todas perguntadas recentemente, sem sugestões D-1 enviadas, ou em trilha winback)',
      });
    }

    const escolhido = candidatos[0];

    // ───────────────────────────────────────────────────────────────
    // 3. Sorteia templates (anti-repetição últimos 3 dias)
    // ───────────────────────────────────────────────────────────────
    const data3d = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    const { data: usados } = await supabase
      .from('lojas_feedback_diario')
      .select('template_intro')
      .eq('vendedora_id', vendedoraId)
      .gte('data_pergunta', data3d);
    const introsUsados = new Set((usados || []).map(u => u.template_intro));
    const introsLivres = TEMPLATES_INTRO.filter(t => !introsUsados.has(t.id));
    const introEscolhido = sortear(introsLivres.length > 0 ? introsLivres : TEMPLATES_INTRO);
    const closeEscolhido = sortear(TEMPLATES_Q3_CLOSE);
    const setEscolhido   = sortear(['set_1', 'set_2', 'set_3']);

    // ───────────────────────────────────────────────────────────────
    // 4. Cria registro inicial em lojas_feedback_diario
    // ───────────────────────────────────────────────────────────────
    const { data: criado, error: errCriar } = await supabase
      .from('lojas_feedback_diario')
      .insert({
        vendedora_id:      vendedoraId,
        cliente_id:        escolhido.cliente_id,
        sugestao_id:       escolhido.sugestao_id,
        data_sugestao:     escolhido.data_sugestao,
        data_pergunta:     hojeISO,
        prioridade_origem: escolhido.prioridade_origem,
        template_intro:    introEscolhido.id,
        template_q3_close: closeEscolhido.id,
        iniciado_em:       new Date().toISOString(),
      })
      .select('id')
      .single();

    if (errCriar) {
      return res.status(500).json({ error: errCriar.message });
    }

    return res.json({
      ok: true,
      feedback_id:        criado.id,
      cliente_id:         escolhido.cliente_id,
      cliente_nome:       escolhido.cliente_nome,
      sugestao_id:        escolhido.sugestao_id,
      data_sugestao:      escolhido.data_sugestao,
      prioridade_origem:  escolhido.prioridade_origem,
      template_intro:     introEscolhido,
      template_q3_close:  closeEscolhido,
      alternativas:       ALTERNATIVAS_SETS[setEscolhido],
      alternativas_set:   setEscolhido,
    });
  } catch (e) {
    console.error('[lojas-feedback-selecionar] erro:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}
