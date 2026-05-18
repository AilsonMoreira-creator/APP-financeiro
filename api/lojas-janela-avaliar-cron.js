/**
 * lojas-janela-avaliar-cron.js
 *
 * Cron noturno (todo dia 03:00 BRT) que:
 *   1. Fecha predicoes 'aguardando' verificando se cliente comprou
 *   2. Expira predicoes muito antigas que nunca foram resolvidas
 *   3. Registra novas predicoes pra clientes que compraram ontem
 *
 * Idempotente. Pode rodar multiplas vezes sem efeitos colaterais.
 *
 * Ailson 18/05/2026.
 */
import { supabase, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  // Vercel cron envia GET, mas aceita ambos
  const inicio = Date.now();
  const resultado = { ok: true, etapas: {} };

  try {
    // ETAPA 1: Avalia predicoes aguardando
    const { data: avaliacao, error: errAval } = await supabase
      .rpc('lojas_avaliar_predicoes_aguardando');
    if (errAval) throw errAval;
    resultado.etapas.avaliacao = avaliacao?.[0] || { avaliadas: 0 };

    // ETAPA 2: Registra predicoes novas pra clientes que compraram nos ultimos 2 dias
    // (cobre se cron pulou um dia)
    const doisDiasAtras = new Date();
    doisDiasAtras.setDate(doisDiasAtras.getDate() - 2);
    const dataLimite = doisDiasAtras.toISOString().slice(0, 10);

    const { data: clientesRecentes, error: errRecentes } = await supabase
      .from('lojas_vendas')
      .select('cliente_id, data_venda')
      .gte('data_venda', dataLimite)
      .not('cliente_id', 'is', null);

    if (errRecentes) throw errRecentes;

    const idsUnicos = [...new Set((clientesRecentes || []).map(v => v.cliente_id))];
    let registradas = 0;

    for (const cliente_id of idsUnicos) {
      const { data: id, error } = await supabase
        .rpc('lojas_registrar_predicao_tempo_real', { p_cliente_id: cliente_id });
      if (!error && id) registradas++;
    }

    resultado.etapas.novas_predicoes = {
      clientes_processados: idsUnicos.length,
      predicoes_registradas: registradas,
    };

    resultado.duracao_ms = Date.now() - inicio;
    return res.status(200).json(resultado);

  } catch (err) {
    console.error('[lojas-janela-avaliar-cron] erro:', err.message);
    return res.status(500).json({
      ok: false,
      error: err.message,
      etapas: resultado.etapas,
    });
  }
}
