/**
 * lojas-leads-conversoes-listar.js — Lista conversões de leads
 *
 * GET ?periodo=mes_atual|7d|30d|all
 *
 * - Admin: vê TODAS conversões (site + manual/Whats)
 * - Vendedora: vê APENAS conversões SITE (canal_pedido='site'), pois
 *   no Whats ela já sabe que vendeu (regra Ailson 13/05/2026)
 *
 * Retorno: lista enriquecida (nome lead, valor, vendedora_credito_nome,
 * canal_pedido, data_venda).
 *
 * Sessão Ailson 13/05/2026 — Onda 4.
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // ─── Determina range do período ─────────────────────────────────
  const periodo = req.query?.periodo || '30d';
  const hoje = new Date();
  let dataInicio;
  if (periodo === 'mes_atual') {
    dataInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  } else if (periodo === '7d') {
    dataInicio = new Date(hoje.getTime() - 7 * 86400000);
  } else if (periodo === 'all') {
    dataInicio = new Date('2024-01-01');
  } else {
    // default '30d'
    dataInicio = new Date(hoje.getTime() - 30 * 86400000);
  }
  const dataInicioStr = dataInicio.toISOString().slice(0, 10);

  try {
    let q = supabase
      .from('lojas_conversoes')
      .select(`
        id, vendedora_id, lead_id, cliente_nome,
        data_mensagem, data_venda, dias_ate_compra, valor_venda,
        origem_tipo, canal_pedido, pedido_mire_id,
        status_no_envio, registrado_em
      `)
      .eq('origem_tipo', 'lead_carrinho')
      .gte('data_venda', dataInicioStr)
      .order('data_venda', { ascending: false });

    // Vendedora: apenas SITE
    if (!auth.isAdmin) {
      if (!auth.vendedoraId) {
        return res.status(403).json({ error: 'Vendedora não identificada' });
      }
      q = q.eq('canal_pedido', 'site').eq('vendedora_id', auth.vendedoraId);
    }

    const { data: conversoes, error } = await q;
    if (error) {
      console.error('[lojas-leads-conversoes-listar] erro:', error);
      return res.status(500).json({ error: error.message });
    }

    // Enriquecer com nomes de vendedoras
    const vIds = Array.from(new Set((conversoes || []).map(c => c.vendedora_id).filter(Boolean)));
    let vMap = new Map();
    if (vIds.length > 0) {
      const { data: vs } = await supabase
        .from('lojas_vendedoras')
        .select('id, nome, loja')
        .in('id', vIds);
      if (vs) vs.forEach(v => vMap.set(v.id, v));
    }

    const enriquecidas = (conversoes || []).map(c => ({
      ...c,
      vendedora_nome: vMap.get(c.vendedora_id)?.nome || null,
      vendedora_loja: vMap.get(c.vendedora_id)?.loja || null,
    }));

    // Agregados
    const total = enriquecidas.length;
    const valor_total = enriquecidas.reduce((s, c) => s + Number(c.valor_venda || 0), 0);
    const por_canal = {
      site: enriquecidas.filter(c => c.canal_pedido === 'site').length,
      manual: enriquecidas.filter(c => c.canal_pedido === 'manual').length,
    };

    return res.json({
      ok: true,
      periodo,
      data_inicio: dataInicioStr,
      total,
      valor_total: Math.round(valor_total * 100) / 100,
      por_canal,
      conversoes: enriquecidas,
    });
  } catch (e) {
    console.error('[lojas-leads-conversoes-listar] exception:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}
