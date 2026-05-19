/**
 * lojas-previsao-pontual-stats.js
 *
 * Endpoint admin pra ler estatisticas do sistema de previsao pontual.
 * Retorna: total disparadas, acertos, erros, em aberto, breakdown por vendedora
 * e por padrao de cliente (pontual/previsivel/atrasador/etc).
 *
 * Ailson 19/05/2026.
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Admin only' });

  try {
    // Stats agregadas
    const { data: stats, error: errStats } = await supabase
      .from('vw_lojas_previsao_pontual_stats')
      .select('*')
      .maybeSingle();
    if (errStats) throw errStats;

    // Breakdown por vendedora (ultimos 30d)
    const { data: porVend, error: errVend } = await supabase
      .from('lojas_sugestoes_diarias')
      .select('vendedora_id, metadados_ia, lojas_vendedoras!inner(nome)')
      .eq('tipo', 'previsao_pontual')
      .gte('data_geracao', new Date(Date.now() - 30*86400e3).toISOString().slice(0,10));
    if (errVend) throw errVend;

    const breakdown = {};
    (porVend || []).forEach(r => {
      const nome = r.lojas_vendedoras?.nome || '???';
      if (!breakdown[nome]) breakdown[nome] = { total: 0, acertos: 0, erros: 0, em_aberto: 0 };
      breakdown[nome].total++;
      const resultado = r.metadados_ia?.resultado;
      if (resultado === 'acertou') breakdown[nome].acertos++;
      else if (resultado === 'errou') breakdown[nome].erros++;
      else breakdown[nome].em_aberto++;
    });

    // Calibracao: distribuicao de padroes
    const { data: padroes, error: errPad } = await supabase
      .from('lojas_clientes_calibracao_janela')
      .select('padrao')
      .gte('predicoes_avaliadas', 1);
    if (errPad) throw errPad;

    const distPadroes = {};
    (padroes || []).forEach(p => {
      const k = p.padrao || 'sem_classificacao';
      distPadroes[k] = (distPadroes[k] || 0) + 1;
    });

    // Candidatos elegiveis HOJE
    const { data: elegiveis, error: errEleg } = await supabase
      .from('vw_lojas_clientes_pontuais')
      .select('apelido, vendedora_nome, score_final, dias_pra_proxima, canal_dominante')
      .eq('elegivel', true)
      .order('score_final', { ascending: false })
      .limit(20);
    if (errEleg) throw errEleg;

    return res.status(200).json({
      stats: stats || { total_disparadas: 0, acertos: 0, erros: 0, em_aberto: 0, pct_acerto: null },
      por_vendedora: breakdown,
      distribuicao_padroes: distPadroes,
      elegiveis_hoje: elegiveis || [],
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
