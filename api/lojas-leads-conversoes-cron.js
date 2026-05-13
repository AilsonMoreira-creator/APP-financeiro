/**
 * lojas-leads-conversoes-cron.js — Cron de detecção automática de conversões
 *
 * Roda 1x por dia (madrugada BRT). Cruza:
 *   lojas_vendas (snapshot Miré, atualizado por outro cron) ↔
 *   lojas_leads_carrinho (leads do site Convertr, via doc/CNPJ/CPF)
 *
 * Janela: 14 dias retroativos (default).
 *
 * Pra cada match novo:
 *   - canal_pedido = 'site' se venda foi feita por vendedora 'CONVERTR'
 *   - canal_pedido = 'manual' caso contrário (Whats/loja física)
 *   - Crédito SITE: pra última vendedora que mandou msg no lead (se mandou
 *     dentro da janela). Sem msg = orgânica (não entra em lojas_conversoes).
 *   - Crédito MANUAL: pra vendedora que fez a venda no Miré.
 *
 * Sessão Ailson 13/05/2026 — Onda 4.
 */
import { supabase, setCors } from './_lojas-helpers.js';

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
  const dias = parseInt(req.query?.dias || '14', 10);

  try {
    const { data, error } = await supabase
      .rpc('lojas_leads_detectar_conversoes', { p_dias: dias })
      .maybeSingle();

    if (error) {
      console.error('[lojas-leads-conversoes-cron] erro:', error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      ok: true,
      janela_dias: dias,
      duracao_ms: Date.now() - tInicio,
      conversoes_inseridas: data?.conversoes_inseridas || 0,
      conv_site: data?.conv_site || 0,
      conv_manual: data?.conv_manual || 0,
      conv_organicas: data?.conv_organicas || 0,
      valor_total: data?.valor_total || 0,
    });
  } catch (e) {
    console.error('[lojas-leads-conversoes-cron] exception:', e);
    return res.status(500).json({
      error: e.message || 'Erro interno',
      duracao_ms: Date.now() - tInicio,
    });
  }
}
