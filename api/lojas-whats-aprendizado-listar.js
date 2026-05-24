// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-aprendizado-listar.js — Endpoint pra UI Aprendizado IA
// ═══════════════════════════════════════════════════════════════════════════
//
// Lista padroes + resumos + KPIs pra aba "🧠 Aprendizado IA" do Sofia.
//
// Action:
//   - 'overview'   (default): KPIs + ultimo resumo + top 10 padroes
//   - 'padroes'   : lista completa de padroes (filtra por tipo/recomendacao)
//   - 'resumos'   : historico de resumos gerados
//   - 'resumir_agora': dispara cron-resumir manualmente
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const action = req.query?.action || req.body?.action || 'overview';

    if (action === 'overview') {
      const [{ count: totalEventos }, { count: totalPadroes }, { count: totalResumos }] = await Promise.all([
        supabase.from('lojas_whats_aprendizado_eventos').select('*', { count: 'exact', head: true }),
        supabase.from('lojas_whats_aprendizado_padroes').select('*', { count: 'exact', head: true }).eq('ativo', true),
        supabase.from('lojas_whats_aprendizado_resumos').select('*', { count: 'exact', head: true }),
      ]);

      const { count: padroesUsar } = await supabase
        .from('lojas_whats_aprendizado_padroes')
        .select('*', { count: 'exact', head: true })
        .eq('ativo', true).eq('recomendacao', 'usar');
      const { count: padroesEvitar } = await supabase
        .from('lojas_whats_aprendizado_padroes')
        .select('*', { count: 'exact', head: true })
        .eq('ativo', true).eq('recomendacao', 'evitar');

      const { data: ultimoResumo } = await supabase
        .from('lojas_whats_aprendizado_resumos')
        .select('id, ate_data, atendimentos_analisados, vendas_neste_periodo, taxa_conversao_geral, resumo_ia, criado_em')
        .order('criado_em', { ascending: false })
        .limit(1).maybeSingle();

      const { data: topPadroes } = await supabase
        .from('lojas_whats_aprendizado_padroes')
        .select('tipo, chave, contexto, amostras, sucessos, taxa_sucesso, recomendacao, ultima_revisao_em')
        .eq('ativo', true)
        .gte('amostras', 3)
        .order('amostras', { ascending: false })
        .order('taxa_sucesso', { ascending: false })
        .limit(15);

      return res.json({
        kpis: {
          eventos_total: totalEventos || 0,
          padroes_ativos: totalPadroes || 0,
          padroes_usar: padroesUsar || 0,
          padroes_evitar: padroesEvitar || 0,
          resumos_total: totalResumos || 0,
        },
        ultimo_resumo: ultimoResumo,
        top_padroes: topPadroes || [],
      });
    }

    if (action === 'padroes') {
      const tipo = req.query?.tipo;          // palavra | emoji | horario | etc
      const recomendacao = req.query?.recomendacao;  // usar | evitar | experimentar
      let qb = supabase
        .from('lojas_whats_aprendizado_padroes')
        .select('id, tipo, chave, contexto, amostras, sucessos, taxa_sucesso, recomendacao, ultima_revisao_em')
        .eq('ativo', true)
        .order('amostras', { ascending: false })
        .limit(200);
      if (tipo) qb = qb.eq('tipo', tipo);
      if (recomendacao) qb = qb.eq('recomendacao', recomendacao);
      const { data, error } = await qb;
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ padroes: data || [] });
    }

    if (action === 'resumos') {
      const { data } = await supabase
        .from('lojas_whats_aprendizado_resumos')
        .select('id, ate_data, atendimentos_analisados, vendas_neste_periodo, taxa_conversao_geral, resumo_ia, custo_estimado_usd, criado_em')
        .order('criado_em', { ascending: false })
        .limit(20);
      return res.json({ resumos: data || [] });
    }

    if (action === 'resumir_agora') {
      // Trigger cron-resumir com force=1
      const baseUrl = req.headers['x-forwarded-host']
        ? `https://${req.headers['x-forwarded-host']}`
        : (req.headers['host'] ? `https://${req.headers['host']}` : '');
      if (!baseUrl) return res.status(500).json({ error: 'baseUrl indisponivel' });
      const r = await fetch(`${baseUrl}/api/lojas-whats-cron-resumir?force=1`, {
        headers: { 'user-agent': 'vercel-cron' },
      });
      const j = await r.json();
      return res.status(r.status).json(j);
    }

    return res.status(400).json({ error: `action invalida: ${action}` });
  } catch (e) {
    console.error('[aprendizado-listar] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
