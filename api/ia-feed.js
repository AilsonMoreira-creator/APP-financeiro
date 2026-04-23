/**
 * ia-feed.js — Listagem de insights ativos (Sprint 3).
 *
 * GET /api/ia-feed?area=producao&limit=20
 * GET /api/ia-feed?area=producao&desde=2026-04-20
 * GET /api/ia-feed?area=producao&status=ativo
 *
 * Header: X-User: <usuario admin>
 *
 * Admin-only na v1.0. ORDER BY created_at DESC.
 *
 * Parâmetros:
 *   - area:    escopo do insight ('producao'|'estoque'|'marketplaces'|'home')
 *              Default: 'producao' (Sprint 3 só popula essa)
 *   - limit:   teto de registros (default 50, máx 200)
 *   - desde:   filtra por created_at >= (ISO date ou datetime)
 *   - status:  'ativo' | 'arquivado' | 'expirado' | 'todos' (default 'ativo')
 */
import { supabase, validarAdmin, setCors } from './_ia-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const admin = await validarAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  const {
    area = 'producao',
    limit = '50',
    desde = null,
    status = 'ativo',
  } = req.query || {};

  const areasValidas = ['producao', 'estoque', 'marketplaces', 'home', 'pergunta_livre'];
  if (!areasValidas.includes(area)) {
    return res.status(400).json({ error: `area deve ser uma de: ${areasValidas.join(', ')}` });
  }

  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  try {
    let q = supabase
      .from('ia_insights')
      .select('id, escopo, categoria, severity, confidence, titulo, resumo, impacto, acao_sugerida, chaves, payload, status, origem, modelo, cron_run_id, created_at, updated_at')
      .eq('escopo', area)
      .order('created_at', { ascending: false })
      .limit(limitNum);

    if (status !== 'todos') {
      q = q.eq('status', status);
    }

    if (desde) {
      q = q.gte('created_at', desde);
    }

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      ok: true,
      area,
      status,
      limit: limitNum,
      total: data?.length || 0,
      insights: data || [],
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'erro interno' });
  }
}
