/**
 * ml-estoque.js — Endpoint de leitura
 *
 * GET /api/ml-estoque
 *   → lista geral: todas as refs ativas, total geral, histórico mensal, status
 *   → pros cards + gráfico do topo
 *
 * GET /api/ml-estoque?ref=2410
 *   → detalhe de uma ref: variações completas (cor/tam/sku/qtd) + MLBs encontrados
 *
 * POST /api/ml-estoque  body: { action: "sync_now" }
 *   → dispara o cron em background (botão de sync manual)
 */
import { supabase } from './_ml-helpers.js';

function normRef(r) { return String(r || '').replace(/^0+/, '').trim(); }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── POST: sync manual (dispara cron em background) ──
  if (req.method === 'POST') {
    const { action } = req.body || {};
    if (action === 'sync_now') {
      try {
        const host = req.headers.host || 'app-financeiro-brown.vercel.app';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        // Não espera a resposta (cron pode levar 2-3 min)
        fetch(`${protocol}://${host}/api/ml-estoque-cron`).catch(() => {});
        return res.json({ ok: true, msg: 'Sync disparado. Atualize em ~2-3 min.' });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }
    return res.status(400).json({ error: 'action inválida' });
  }

  // ── GET: leitura ──
  try {
    const refParam = req.query?.ref;

    // Status do último cron
    const { data: statusRow } = await supabase.from('amicia_data')
      .select('payload').eq('user_id', 'ml-estoque-status').maybeSingle();
    const status = statusRow?.payload || null;

    // Detalhe de uma ref específica
    if (refParam) {
      const ref = normRef(refParam);
      const { data: refRow, error } = await supabase.from('ml_estoque_ref_atual')
        .select('*').eq('ref', ref).maybeSingle();
      if (error) throw error;
      if (!refRow) return res.json({ ok: false, error: 'ref não encontrada', ref });

      return res.json({ ok: true, ref: refRow, status });
    }

    // Lista geral
    const [
      { data: refs, error: eRefs },
      { data: historico, error: eHist },
      { data: histDiario },
    ] = await Promise.all([
      supabase.from('ml_estoque_ref_atual')
        .select('ref, descricao, qtd_total, variations, alerta_duplicata, sem_dados, mlb_escolhido, updated_at')
        .order('qtd_total', { ascending: false }),
      supabase.from('ml_estoque_total_mensal')
        .select('ano_mes, qtd_total, qtd_refs, snapshot_date')
        .order('ano_mes', { ascending: false })
        .limit(12),
      supabase.from('amicia_data')
        .select('payload')
        .eq('user_id', 'ml-estoque-historico-diario')
        .maybeSingle(),
    ]);

    if (eRefs) throw eRefs;
    if (eHist) console.error('[ml-estoque] histórico:', eHist.message);

    // Reordena histórico em ordem cronológica ascendente pro frontend
    const historicoOrdenado = (historico || []).slice().reverse();
    const diario = histDiario?.payload?.diario || {};

    const total_geral = (refs || []).reduce((a, r) => a + (r.qtd_total || 0), 0);
    const qtd_refs_ativas = (refs || []).length;
    const qtd_refs_com_estoque = (refs || []).filter(r => !r.sem_dados && r.qtd_total > 0).length;
    const qtd_duplicadas = (refs || []).filter(r => r.alerta_duplicata).length;
    const qtd_sem_dados = (refs || []).filter(r => r.sem_dados).length;

    return res.json({
      ok: true,
      refs: refs || [],
      historico_mensal: historicoOrdenado,
      historico_diario: diario,
      stats: {
        total_geral,
        qtd_refs_ativas,
        qtd_refs_com_estoque,
        qtd_duplicadas,
        qtd_sem_dados,
      },
      status,
    });

  } catch (e) {
    console.error('[ml-estoque] erro:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
