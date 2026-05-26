// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-capi-stats.js — Stats CAPI Meta Ads pra Dashboard Sofia
// ═══════════════════════════════════════════════════════════════════════════
// Sprint Attribution Sofia (Ailson 25/05/2026).
// Filtros: data_inicio, data_fim (YYYY-MM-DD)
// Retorna agregados de eventos CAPI enviados pra Meta.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, logErro } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const default30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const dataInicio = req.query.data_inicio || default30;
    const dataFim = req.query.data_fim || hoje;

    const inicioISO = `${dataInicio}T00:00:00-03:00`;
    const fimISO = `${dataFim}T23:59:59-03:00`;

    // 1. Total enviados + valor + breakdown por match + ctwa + origem
    const { data: enviados, error: errEnv } = await supabase
      .from('lojas_whats_capi_eventos')
      .select('id, valor, tipo_match, ctwa_clid, venda_categoria, enviado_em, conversa_id, numero_pedido, origem_capi, vendedora_nome, dados_manual')
      .eq('status', 'enviado')
      .gte('enviado_em', inicioISO)
      .lte('enviado_em', fimISO);
    if (errEnv) throw errEnv;

    const { count: falhados } = await supabase
      .from('lojas_whats_capi_eventos')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'falhou')
      .gte('enviado_em', inicioISO)
      .lte('enviado_em', fimISO);

    const total = enviados.length;
    const valor_total = enviados.reduce((s, e) => s + Number(e.valor || 0), 0);
    const match_telefone = enviados.filter(e => e.tipo_match === 'telefone').length;
    const match_documento = enviados.filter(e => e.tipo_match === 'documento').length;
    const com_ctwa_clid = enviados.filter(e => e.ctwa_clid).length;
    const sem_ctwa_clid = total - com_ctwa_clid;
    const atacado = enviados.filter(e => e.venda_categoria === 'atacado');
    const varejo = enviados.filter(e => e.venda_categoria === 'varejo');

    // Origem: auto vs manual
    const auto_match = enviados.filter(e => (e.origem_capi || 'auto_match') === 'auto_match');
    const manual_vendedora = enviados.filter(e => e.origem_capi === 'manual_vendedora');
    // Breakdown por vendedora (so manual)
    const porVendedora = {};
    for (const e of manual_vendedora) {
      const v = e.vendedora_nome || '?';
      if (!porVendedora[v]) porVendedora[v] = { qtd: 0, valor: 0 };
      porVendedora[v].qtd++;
      porVendedora[v].valor += Number(e.valor || 0);
    }
    const manual_por_vendedora = Object.entries(porVendedora)
      .map(([nome, v]) => ({ vendedora_nome: nome, qtd: v.qtd, valor: v.valor }))
      .sort((a, b) => b.qtd - a.qtd);

    // 2. Diario (serie temporal)
    const porDia = {};
    for (const e of enviados) {
      const dia = e.enviado_em.slice(0, 10);
      if (!porDia[dia]) porDia[dia] = { qtd: 0, valor: 0 };
      porDia[dia].qtd++;
      porDia[dia].valor += Number(e.valor || 0);
    }
    const serie_diaria = Object.entries(porDia)
      .map(([dia, v]) => ({ dia, qtd: v.qtd, valor: v.valor }))
      .sort((a, b) => a.dia.localeCompare(b.dia));

    // 3. Últimas 20 conversões (pra listar no dashboard)
    const ultimos20 = enviados.slice(-20).reverse();
    // So buscar conversas pros que tem conversa_id (auto). Manuais nao tem.
    const ultimasIds = ultimos20.map(e => e.conversa_id).filter(Boolean);
    let mapConv = {};
    if (ultimasIds.length > 0) {
      const { data: convs } = await supabase
        .from('lojas_whats_conversas')
        .select('id, nome_cliente, telefone, origem_lead')
        .in('id', ultimasIds);
      mapConv = Object.fromEntries((convs || []).map(c => [c.id, c]));
    }
    const detalhes = ultimos20.map(e => {
      const conv = e.conversa_id ? mapConv[e.conversa_id] : null;
      const dm = e.dados_manual || {};
      return {
        enviado_em: e.enviado_em,
        valor: Number(e.valor),
        numero_pedido: e.numero_pedido,
        tipo_match: e.tipo_match,
        ctwa_clid: e.ctwa_clid ? `${e.ctwa_clid.slice(0, 8)}...` : null,
        venda_categoria: e.venda_categoria,
        origem_capi: e.origem_capi || 'auto_match',
        vendedora_nome: e.vendedora_nome || null,
        // Auto: nome vem da conversa. Manual: nome vem do dados_manual
        cliente_nome: conv?.nome_cliente || dm.nome_cliente || null,
        origem_lead: conv?.origem_lead || null,
      };
    });

    return res.status(200).json({
      periodo: { inicio: dataInicio, fim: dataFim, dias: Math.round((new Date(dataFim) - new Date(dataInicio)) / 86400000) + 1 },
      kpis: {
        total_eventos: total,
        valor_total,
        falhados: falhados || 0,
        match_telefone,
        match_documento,
        com_ctwa_clid,
        sem_ctwa_clid,
        atacado: { qtd: atacado.length, valor: atacado.reduce((s, e) => s + Number(e.valor || 0), 0) },
        varejo: { qtd: varejo.length, valor: varejo.reduce((s, e) => s + Number(e.valor || 0), 0) },
        auto_match: { qtd: auto_match.length, valor: auto_match.reduce((s, e) => s + Number(e.valor || 0), 0) },
        manual_vendedora: { qtd: manual_vendedora.length, valor: manual_vendedora.reduce((s, e) => s + Number(e.valor || 0), 0) },
      },
      manual_por_vendedora,
      serie_diaria,
      ultimos: detalhes,
    });
  } catch (e) {
    logErro('capi-stats', e);
    return res.status(500).json({ error: e.message });
  }
}
