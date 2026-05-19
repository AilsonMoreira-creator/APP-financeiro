/**
 * lojas-previsao-pontual-cron.js
 *
 * Cron diário (06:30 BRT) — antes do dia das vendedoras começar.
 * Pra CADA vendedora ativa: chama lojas_gerar_previsao_pontual(vendedora_id)
 * que insere 0-2 sugestoes tipo='previsao_pontual' em lojas_sugestoes_diarias.
 *
 * Tambem chama lojas_avaliar_previsoes_pontuais() pra fechar previsoes
 * passadas e atualizar a calibracao individual dos clientes.
 *
 * Idempotente. Pode rodar varias vezes no dia sem efeitos colaterais.
 *
 * Ailson 19/05/2026.
 */
import { supabase, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Use GET ou POST' });
  }

  const inicio = Date.now();
  const resultado = { ok: true, etapas: {} };

  try {
    // ETAPA 1: avalia previsoes passadas (atualiza calibracao)
    const { data: avaliacao, error: errAval } = await supabase
      .rpc('lojas_avaliar_previsoes_pontuais');
    if (errAval) throw errAval;
    resultado.etapas.avaliacao = avaliacao?.[0] || { avaliadas: 0 };

    // ETAPA 2: pra cada vendedora ativa, gera ate 2 novas previsoes
    const { data: vendedoras, error: errVend } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome')
      .eq('ativa', true);
    if (errVend) throw errVend;

    let totalGeradas = 0;
    const porVendedora = {};

    for (const v of vendedoras || []) {
      const { data: geradas, error } = await supabase
        .rpc('lojas_gerar_previsao_pontual', {
          p_vendedora_id: v.id,
          p_data: new Date().toISOString().slice(0, 10),
          p_max: 2,
        });
      if (error) {
        porVendedora[v.nome] = { erro: error.message };
        continue;
      }
      const qtd = (geradas || []).length;
      totalGeradas += qtd;
      porVendedora[v.nome] = {
        geradas: qtd,
        clientes: (geradas || []).map(g => `${g.apelido} (score ${g.score}, +${g.dias_pra_proxima}d)`),
      };
    }

    resultado.etapas.geracao = {
      total_geradas: totalGeradas,
      vendedoras_processadas: (vendedoras || []).length,
      por_vendedora: porVendedora,
    };

    resultado.duracao_ms = Date.now() - inicio;
    return res.status(200).json(resultado);

  } catch (err) {
    console.error('[lojas-previsao-pontual-cron] erro:', err.message);
    return res.status(500).json({
      ok: false,
      error: err.message,
      etapas: resultado.etapas,
    });
  }
}
