// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-conversoes.js — KPIs de conversao pra aba Sofia (LojasWhats)
// ═══════════════════════════════════════════════════════════════════════════
//
// Endpoint isolado pra UI Sofia. NAO toca em handleConversoesDashboard nem
// no CardConversoes existente (que mantem regra propria de exibir so status
// atencao/+3M/+6M).
//
// Fonte: lojas_conversoes (mesma tabela, com nova coluna atendido_por).
//
// Filtros:
//   - data_inicio, data_fim (formato YYYY-MM-DD; default = ultimos 30 dias)
//   - atendido_por: 'sofia' | 'vendedora' | null (todos)
//   - canal_pedido: 'site' | 'manual' | null (todos)
//
// Resposta:
//   {
//     periodo: { inicio, fim, dias },
//     kpis: {
//       total, valor_total,
//       sofia_site:      { qtd, valor },   // ≤5d apos msg Sofia, venda site
//       sofia_loja:      { qtd, valor },   // ≤15d apos msg Sofia, venda loja
//       vendedora_site:  { qtd, valor },
//       vendedora_loja:  { qtd, valor },
//     },
//     por_vendedora: [{ vendedora_id, vendedora_nome, qtd, valor }],
//     detalhe: [{ data_venda, cliente_nome, valor_venda, dias_ate_compra,
//                 canal_pedido, atendido_por, vendedora_nome }]
//   }
//
// Compatibilidade:
//   - Conversoes antigas sem atendido_por (retroativas) aparecem em
//     "vendedora_*" por default (eram todas vendedora_id != null antes).
//   - Conversoes com origem_tipo='cliente' (sugestao IA) sao filtradas FORA
//     desse endpoint — Sofia so atende lead_carrinho, nao carteira.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── Parse de filtros ──────────────────────────────────
    const hoje = new Date();
    const hojeStr = hoje.toISOString().slice(0, 10);
    const default30dAtras = new Date(hoje.getTime() - 30 * 86400000)
      .toISOString().slice(0, 10);

    const dataInicio = req.query?.data_inicio || req.body?.data_inicio || default30dAtras;
    const dataFim    = req.query?.data_fim    || req.body?.data_fim    || hojeStr;
    const fAtendido  = req.query?.atendido_por || req.body?.atendido_por || null;
    const fCanal     = req.query?.canal_pedido || req.body?.canal_pedido || null;

    // Valida formato data (YYYY-MM-DD)
    const reData = /^\d{4}-\d{2}-\d{2}$/;
    if (!reData.test(dataInicio) || !reData.test(dataFim)) {
      return res.status(400).json({ error: 'data_inicio/data_fim devem ser YYYY-MM-DD' });
    }

    // ── Query base ───────────────────────────────────────
    // IMPORTANTE: filtra origem_tipo='lead_carrinho'. Sofia so atende
    // leads de carrinho abandonado (site Amicia). Sugestoes IA da
    // carteira (origem_tipo='cliente') sao gerenciadas pelo card
    // separado no Dashboard Lojas (CardConversoes).
    let query = supabase
      .from('lojas_conversoes')
      .select('id, vendedora_id, cliente_nome, valor_venda, data_venda, data_mensagem, dias_ate_compra, canal_pedido, atendido_por, sofia_conversa_id, lead_id, status_no_envio')
      .eq('origem_tipo', 'lead_carrinho')
      .gte('data_venda', dataInicio)
      .lte('data_venda', dataFim)
      .order('data_venda', { ascending: false });

    if (fAtendido === 'sofia' || fAtendido === 'vendedora') {
      query = query.eq('atendido_por', fAtendido);
    }
    if (fCanal === 'site' || fCanal === 'manual') {
      query = query.eq('canal_pedido', fCanal);
    }

    const { data: rows, error } = await query;
    if (error) {
      console.error('[lojas-whats-conversoes] erro query:', error);
      return res.status(500).json({ error: error.message });
    }

    // ── Carrega nomes vendedoras ─────────────────────────
    const { data: vends } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome');
    const nomeVendedora = (vid) => {
      if (!vid) return null;
      const v = (vends || []).find(x => x.id === vid);
      return v?.nome || '?';
    };

    // ── Agregados ────────────────────────────────────────
    let total = 0;
    let valorTotal = 0;
    const kpis = {
      sofia_site:     { qtd: 0, valor: 0 },
      sofia_loja:     { qtd: 0, valor: 0 },
      vendedora_site: { qtd: 0, valor: 0 },
      vendedora_loja: { qtd: 0, valor: 0 },
    };
    const mapVendedora = new Map();

    for (const r of rows || []) {
      const v = Number(r.valor_venda || 0);
      total++;
      valorTotal += v;

      // Bucket por atendido_por + canal
      // Fallback: conversoes antigas sem atendido_por → assume 'vendedora'
      const ap = r.atendido_por || 'vendedora';
      const isSite = r.canal_pedido === 'site';
      const bucketKey = `${ap}_${isSite ? 'site' : 'loja'}`;
      if (kpis[bucketKey]) {
        kpis[bucketKey].qtd++;
        kpis[bucketKey].valor += v;
      }

      // Ranking por vendedora (só conversoes onde vendedora levou credito)
      if (r.vendedora_id) {
        const k = r.vendedora_id;
        if (!mapVendedora.has(k)) {
          mapVendedora.set(k, {
            vendedora_id: k,
            vendedora_nome: nomeVendedora(k),
            qtd: 0, valor: 0,
            site: 0, loja: 0,
          });
        }
        const slot = mapVendedora.get(k);
        slot.qtd++;
        slot.valor += v;
        if (isSite) slot.site++;
        else slot.loja++;
      }
    }

    // Round 2 casas decimais
    valorTotal = Math.round(valorTotal * 100) / 100;
    for (const k of Object.keys(kpis)) {
      kpis[k].valor = Math.round(kpis[k].valor * 100) / 100;
    }
    const porVendedora = Array.from(mapVendedora.values())
      .map(v => ({ ...v, valor: Math.round(v.valor * 100) / 100 }))
      .sort((a, b) => b.qtd - a.qtd);

    // ── Detalhe (top 50 mais recentes pra tabela) ────────
    const detalhe = (rows || []).slice(0, 50).map(r => ({
      id: r.id,
      data_venda: r.data_venda,
      data_mensagem: r.data_mensagem,
      cliente_nome: r.cliente_nome,
      valor_venda: r.valor_venda,
      dias_ate_compra: r.dias_ate_compra,
      canal_pedido: r.canal_pedido,
      atendido_por: r.atendido_por || 'vendedora',
      vendedora_id: r.vendedora_id,
      vendedora_nome: nomeVendedora(r.vendedora_id),
      sofia_conversa_id: r.sofia_conversa_id,
      lead_id: r.lead_id,
    }));

    // ── Origens de lead (Instagram/Ads) — funil do periodo ──────────────
    // Ailson 30/05/2026: cada card de origem (Stories / Linktree / Meta Ads)
    // mostra recebidas (conversas iniciadas no periodo por essa origem),
    // convertidos (etapa='vendeu' — unico sinal de venda por conversa; a
    // tabela lojas_conversoes nao liga em origem_lead) e % conversao.
    const fimMais1 = new Date(new Date(dataFim).getTime() + 86400000)
      .toISOString().slice(0, 10);
    const { data: convOrigens } = await supabase
      .from('lojas_whats_conversas')
      .select('origem_lead, etapa')
      .in('origem_lead', ['instagram_stories', 'instagram_linktree', 'anuncio_facebook', 'anuncio_instagram'])
      .gte('iniciada_em', dataInicio)
      .lt('iniciada_em', fimMais1);

    const origens = {
      stories:  { recebidas: 0, convertidos: 0, pct: 0 },
      linktree: { recebidas: 0, convertidos: 0, pct: 0 },
      meta_ads: { recebidas: 0, convertidos: 0, pct: 0 },
    };
    const grupoOrigem = (o) =>
      o === 'instagram_stories'  ? 'stories'  :
      o === 'instagram_linktree' ? 'linktree' :
      (o === 'anuncio_facebook' || o === 'anuncio_instagram') ? 'meta_ads' : null;
    for (const c of convOrigens || []) {
      const g = grupoOrigem(c.origem_lead);
      if (!g) continue;
      origens[g].recebidas++;
      if (c.etapa === 'vendeu') origens[g].convertidos++;
    }
    for (const k of Object.keys(origens)) {
      const o = origens[k];
      o.pct = o.recebidas > 0 ? Math.round((o.convertidos / o.recebidas) * 1000) / 10 : 0;
    }

    return res.json({
      periodo: {
        inicio: dataInicio,
        fim: dataFim,
        dias: Math.round((new Date(dataFim) - new Date(dataInicio)) / 86400000) + 1,
      },
      filtros: { atendido_por: fAtendido, canal_pedido: fCanal },
      total,
      valor_total: valorTotal,
      kpis,
      origens,
      por_vendedora: porVendedora,
      detalhe,
    });
  } catch (e) {
    console.error('[lojas-whats-conversoes] excecao:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}
