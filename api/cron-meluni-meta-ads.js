/**
 * cron-meluni-meta-ads.js — Cron diário que importa insights da Meta Ads
 * (conta Meluni B2C 943539471358534) e popula `meluni_meta_ads_historico`.
 *
 * Schedule em vercel.json: diário 11:00 BRT (= 14:00 UTC).
 *
 * Janela: últimos 10 dias até hoje. Upsert por `data` (idempotente).
 *
 * Env vars (Vercel):
 *   META_ADS_TOKEN — System User token (permanente, gerado no Business Manager amicia.fashion)
 *   SUPABASE_URL + SUPABASE_KEY — já existentes no projeto
 *
 * Padrão da rotina "inserir tabela Meluni" memorizada nas sessões anteriores.
 *
 * Sessão Ailson 18/05/2026 — Onda Meta Ads (System User Token + cron).
 */
import { setCors, supabase } from './_lojas-helpers.js';

const AD_ACCOUNT_ID = '943539471358534';
const META_API_VERSION = 'v21.0';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const userAgent = req.headers['user-agent'] || '';
  const ehCron = userAgent.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
  if (!ehCron && req.query?.force !== '1') {
    return res.status(403).json({
      error: 'Endpoint só é chamado pelo cron Vercel. Use ?force=1 pra teste manual.',
    });
  }

  const tInicio = Date.now();

  const META_ADS_TOKEN = process.env.META_ADS_TOKEN;
  if (!META_ADS_TOKEN) {
    return res.status(500).json({ error: 'META_ADS_TOKEN ausente nas env vars' });
  }

  try {
    // 1. Janela: últimos 10 dias até hoje (inclusive)
    const today = new Date();
    const sinceDate = new Date(today);
    sinceDate.setDate(today.getDate() - 9);

    const sinceStr = sinceDate.toISOString().split('T')[0];
    const untilStr = today.toISOString().split('T')[0];

    // 2. Busca insights diários da Meta Ads
    const timeRange = encodeURIComponent(JSON.stringify({ since: sinceStr, until: untilStr }));
    const url =
      `https://graph.facebook.com/${META_API_VERSION}/act_${AD_ACCOUNT_ID}/insights?` +
      `fields=spend,clicks,impressions,actions,action_values` +
      `&time_range=${timeRange}` +
      `&time_increment=1` +
      `&level=account` +
      `&access_token=${META_ADS_TOKEN}`;

    const metaResp = await fetch(url);
    const metaData = await metaResp.json();

    if (metaData.error) {
      throw new Error(`Meta API erro: ${metaData.error.message} (code ${metaData.error.code})`);
    }

    const days = metaData.data || [];

    // 3. Processa dia a dia + upsert
    const resultado = {
      janela: { since: sinceStr, until: untilStr },
      total_recebidos: days.length,
      inseridos: 0,
      pulados: 0,
      erros: [],
      detalhe: [],
    };

    for (const day of days) {
      const dataRef = day.date_start;
      const gasto = parseFloat(day.spend || 0);
      const cliques = parseInt(day.clicks || 0, 10);

      // Regra memorizada: sem gasto → pula linha
      if (gasto === 0) {
        resultado.pulados++;
        resultado.detalhe.push({ data: dataRef, status: 'pulado', motivo: 'sem_gasto' });
        continue;
      }

      const purchaseAction = (day.actions || []).find((a) => a.action_type === 'purchase');
      const compras = purchaseAction ? parseInt(purchaseAction.value, 10) : 0;

      // Regras NULL memorizadas:
      // sem clique → cpc=NULL ; sem compra → conv=NULL
      const cpc = cliques > 0 ? gasto / cliques : null;
      const conv = cliques > 0 && compras > 0 ? (compras / cliques) * 100 : null;

      const row = {
        data: dataRef,
        cpc,
        conv,
        gasto,
        cliques,
        compras,
        fonte: 'meta_ads_auto',
        observacao: null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('meluni_meta_ads_historico')
        .upsert(row, { onConflict: 'data' });

      if (error) {
        resultado.erros.push({ data: dataRef, erro: error.message });
        resultado.detalhe.push({ data: dataRef, status: 'erro', motivo: error.message });
      } else {
        resultado.inseridos++;
        resultado.detalhe.push({
          data: dataRef,
          status: 'ok',
          gasto: gasto.toFixed(2),
          cliques,
          compras,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      duracao_ms: Date.now() - tInicio,
      ...resultado,
    });
  } catch (err) {
    console.error('[cron-meluni-meta-ads] erro:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || String(err),
      duracao_ms: Date.now() - tInicio,
    });
  }
}
