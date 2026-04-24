/**
 * ia-pergunta-admin.js — Endpoints auxiliares do painel admin
 * ════════════════════════════════════════════════════════════════════════
 *
 * GET /api/ia-pergunta-admin?acao=stats
 *   → JSON das stats do dia (fn_ia_pergunta_stats_dia)
 *
 * GET /api/ia-pergunta-admin?acao=historico&user_id=X&periodo=hoje
 *   → Histórico filtrado. Se !admin, só vê as próprias.
 *   periodo: 'hoje' | '7d' | '30d'
 *
 * GET /api/ia-pergunta-admin?acao=top_semana
 *   → Top 10 perguntas mais frequentes
 *
 * GET /api/ia-pergunta-admin?acao=users_duplicados
 *   → Alerta do bug de nomes duplicados
 *
 * Auth: header X-User-Id (numérico). Se admin → vê tudo; senão só as suas.
 * ════════════════════════════════════════════════════════════════════════
 */

import { setCors, supabase } from './_ia-helpers.js';
import { resolverUsuario } from './_ia-pergunta-helpers.js';


export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  const userId = req.headers['x-user-id'] || req.query.requester_id;
  const u = await resolverUsuario(userId);
  if (!u.ok) return res.status(u.status).json({ ok: false, error: u.error });
  const { user } = u;

  const acao = req.query.acao || 'stats';

  try {
    if (acao === 'stats') {
      if (!user.admin) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { data } = await supabase.rpc('fn_ia_pergunta_stats_dia');
      return res.status(200).json({ ok: true, stats: data });
    }

    if (acao === 'top_semana') {
      if (!user.admin) return res.status(403).json({ ok: false, error: 'Admin only' });
      const limite = Math.min(50, Number(req.query.limite) || 10);
      const { data } = await supabase.rpc('fn_ia_pergunta_top_semana', { limite });
      return res.status(200).json({ ok: true, top: data || [] });
    }

    if (acao === 'users_duplicados') {
      if (!user.admin) return res.status(403).json({ ok: false, error: 'Admin only' });
      const { data } = await supabase.rpc('fn_ia_pergunta_users_duplicados');
      return res.status(200).json({ ok: true, duplicados: data || [] });
    }

    if (acao === 'historico') {
      // Funcionário só vê as próprias. Admin pode filtrar por user_id query ou ver todas.
      const filtroUserId = user.admin
        ? (req.query.user_id ? Number(req.query.user_id) : null)
        : user.id;

      const periodo = req.query.periodo || 'hoje';
      const desde = calcularDesde(periodo);

      let query = supabase
        .from('ia_pergunta_historico')
        .select('id, user_id, user_name, user_is_admin, pergunta, resposta, categoria, ref_detectada, tokens_in, tokens_out, custo_brl, tempo_ms, r_bloqueado, erro, created_at')
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .limit(Math.min(200, Number(req.query.limite) || 50));

      if (filtroUserId) query = query.eq('user_id', filtroUserId);

      const { data, error } = await query;
      if (error) return res.status(500).json({ ok: false, error: error.message });

      // Agrupa por user pra facilitar render no admin
      const porUser = {};
      for (const row of (data || [])) {
        const key = row.user_id;
        if (!porUser[key]) {
          porUser[key] = {
            user_id: row.user_id,
            user_name: row.user_name,
            is_admin: row.user_is_admin,
            total: 0,
            perguntas: [],
          };
        }
        porUser[key].total++;
        porUser[key].perguntas.push(row);
      }

      return res.status(200).json({
        ok: true,
        historico: data || [],
        agrupado: Object.values(porUser),
        total: (data || []).length,
        periodo,
      });
    }

    if (acao === 'pool_hoje') {
      // Qualquer user pode saber quantas restam do pool (não é info sensível)
      const { data: cfg } = await supabase
        .from('amicia_data')
        .select('payload')
        .eq('user_id', 'ia-pergunta-config')
        .maybeSingle();
      const limite = Number(cfg?.payload?.config?.rate_limit_users ?? 15);
      const { data: usado } = await supabase.rpc('fn_ia_pergunta_pool_hoje');
      return res.status(200).json({
        ok: true,
        usado: Number(usado || 0),
        limite,
        restante: Math.max(0, limite - Number(usado || 0)),
      });
    }

    return res.status(400).json({ ok: false, error: `Ação "${acao}" desconhecida` });
  } catch (e) {
    console.error('[ia-pergunta-admin]', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}


function calcularDesde(periodo) {
  const agora = new Date();
  const hojeBRT = new Date(agora.getTime() - 3 * 3600000); // aprox BRT
  const inicio = new Date(hojeBRT);
  if (periodo === '7d') inicio.setDate(inicio.getDate() - 7);
  else if (periodo === '30d') inicio.setDate(inicio.getDate() - 30);
  else inicio.setHours(0, 0, 0, 0); // hoje
  return inicio.toISOString();
}
