/**
 * ml-webhook-activity.js — Diagnóstico de atividade do webhook
 *
 * Verifica timestamps de perguntas recentes pra inferir se o webhook
 * está funcionando em tempo real OU se só o cron diário das 8h tá pegando.
 *
 * Lógica:
 *   - Se perguntas têm timestamps espalhados ao longo do dia → webhook OK
 *   - Se perguntas só têm timestamp ~8h → só cron, webhook quebrado
 *   - Se nenhuma pergunta nas últimas 48h → não dá pra saber, sem dados
 */
import { supabase, setCors } from './_ml-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = { timestamp: new Date().toISOString(), janela: '7 dias' };

  // 1. Últimas perguntas recebidas (received_at = quando entrou no nosso DB)
  try {
    const { data: qs } = await supabase
      .from('ml_pending_questions')
      .select('brand, question_id, received_at, date_created, status')
      .gte('received_at', desde)
      .order('received_at', { ascending: false })
      .limit(50);

    const lista = (qs || []).map(q => ({
      brand: q.brand,
      question_id: q.question_id,
      received_at: q.received_at,
      date_created: q.date_created,
      status: q.status,
      // Diferença entre quando ML criou e quando NOSSO DB recebeu
      delay_minutos: q.received_at && q.date_created
        ? Math.round((new Date(q.received_at).getTime() - new Date(q.date_created).getTime()) / 60000)
        : null,
    }));

    // Agrupar por hora do dia (received_at)
    const horas = {};
    for (const q of lista) {
      const h = new Date(q.received_at).getUTCHours();
      horas[h] = (horas[h] || 0) + 1;
    }

    // Conclusão automática
    const totalPerguntas = lista.length;
    const apenas8h = horas[8] && Object.keys(horas).length <= 2; // só 8 (cron) + talvez 1 outra
    const espalhadas = Object.keys(horas).length >= 4;

    let conclusao;
    if (totalPerguntas === 0) {
      conclusao = 'SEM_DADOS - sem perguntas nas últimas 7 dias pra analisar';
    } else if (espalhadas) {
      conclusao = 'WEBHOOK_OK - perguntas chegam ao longo do dia (tempo real funciona)';
    } else if (apenas8h) {
      conclusao = 'WEBHOOK_QUEBRADO - perguntas só aparecem ~8h UTC = cron diário. Webhook não está chegando.';
    } else {
      conclusao = 'INCONCLUSIVO - poucas amostras, padrão atípico';
    }

    result.perguntas = {
      total: totalPerguntas,
      ultimas_recebidas: lista.slice(0, 10),
      distribuicao_por_hora_utc: horas,
      delay_medio_minutos: lista.filter(q => q.delay_minutos != null).length > 0
        ? Math.round(lista.filter(q => q.delay_minutos != null).reduce((a, q) => a + q.delay_minutos, 0) / lista.filter(q => q.delay_minutos != null).length)
        : null,
      conclusao,
    };
  } catch (e) {
    result.perguntas = { ERRO: e.message };
  }

  // 2. Histórico de respostas (qa_history) - se tem respostas RECENTES, IA tá processando webhook
  try {
    const { data: qa } = await supabase
      .from('ml_qa_history')
      .select('brand, question_id, answered_at, answered_by')
      .gte('answered_at', desde)
      .order('answered_at', { ascending: false })
      .limit(20);

    const lista = (qa || []).map(q => ({
      brand: q.brand,
      answered_at: q.answered_at,
      answered_by: q.answered_by,
    }));

    result.respostas_recentes = {
      total: lista.length,
      ultimas: lista.slice(0, 10),
      // Se a IA respondeu (answered_by ai/_auto/etc), é prova que webhook tá funcionando
      por_tipo_resposta: lista.reduce((acc, q) => {
        const tipo = q.answered_by || 'unknown';
        acc[tipo] = (acc[tipo] || 0) + 1;
        return acc;
      }, {}),
    };
  } catch (e) {
    result.respostas_recentes = { ERRO: e.message };
  }

  // 3. Última sync do cron de perguntas
  try {
    const { data: ls } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'ml-last-sync')
      .single();
    result.ultima_sync_cron_8h = ls?.payload || null;
  } catch (e) {}

  return res.status(200).json(result);
}
