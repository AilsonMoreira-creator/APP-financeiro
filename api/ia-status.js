/**
 * ia-status.js — Painel admin de saúde do OS Amícia.
 *
 * GET /api/ia-status
 *   Devolve:
 *     - último cron (sucesso/erro, duração)
 *     - insights ativos (contagem por severity)
 *     - gasto Anthropic do mês + % do orçamento
 *     - próxima execução prevista
 *     - uso de perguntas livres do dia
 *
 * Admin-only.
 */
import { supabase, validarAdmin, setCors, gastoMesAtual, getConfig } from './_ia-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const admin = await validarAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  try {
    // Contagem de insights ativos por severity
    const { data: insightsAtivos } = await supabase
      .from('ia_insights')
      .select('severity')
      .eq('status', 'ativo');

    const severityCount = { critico: 0, atencao: 0, positiva: 0, oportunidade: 0, info: 0 };
    (insightsAtivos || []).forEach(i => {
      if (severityCount[i.severity] !== undefined) severityCount[i.severity]++;
    });

    // Último cron (se houver ao menos 1 insight)
    const { data: ultimoInsight } = await supabase
      .from('ia_insights')
      .select('created_at, cron_run_id, origem')
      .eq('origem', 'cron')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Uso mensal
    const gasto_brl = await gastoMesAtual();
    const orcamento_brl = Number(await getConfig('orcamento_brl_mensal', 80));
    const pct_orcamento = orcamento_brl > 0 ? Math.round((gasto_brl / orcamento_brl) * 100) : 0;

    // Perguntas livres de hoje
    const hoje = new Date().toISOString().slice(0, 10);
    const { data: perguntasHoje } = await supabase
      .from('ia_usage')
      .select('id')
      .eq('data', hoje)
      .eq('tipo', 'pergunta_livre');
    const perguntas_hoje = perguntasHoje?.length || 0;
    const perguntas_max = Number(await getConfig('pergunta_livre_max_dia', 5));

    // Próxima execução do cron
    const horarios = await getConfig('cron_horarios_brt', ['07:00', '14:00']);
    const agoraBRT = new Date(Date.now() - 3 * 60 * 60 * 1000); // UTC−3 aproximado
    const [hrNow, mnNow] = [agoraBRT.getUTCHours(), agoraBRT.getUTCMinutes()];
    let proximoHorario = null;
    for (const h of horarios) {
      const [hr, mn] = h.split(':').map(Number);
      if (hr > hrNow || (hr === hrNow && mn > mnNow)) {
        proximoHorario = h;
        break;
      }
    }
    if (!proximoHorario) proximoHorario = `${horarios[0]} (amanhã)`;

    return res.json({
      ok: true,
      ultimo_cron: ultimoInsight ? {
        created_at: ultimoInsight.created_at,
        cron_run_id: ultimoInsight.cron_run_id,
      } : null,
      proximo_cron_brt: proximoHorario,
      insights_ativos: {
        total: (insightsAtivos || []).length,
        por_severity: severityCount,
      },
      anthropic: {
        gasto_brl_mes: Math.round(gasto_brl * 100) / 100,
        orcamento_brl_mes: orcamento_brl,
        pct_orcamento,
        alerta_amarelo: pct_orcamento >= Number(await getConfig('orcamento_brl_alerta_pct', 75)),
      },
      perguntas_livres: {
        hoje: perguntas_hoje,
        max_dia: perguntas_max,
        restantes: Math.max(0, perguntas_max - perguntas_hoje),
      },
      // Probe diagnóstico: só booleans, não vaza valores.
      env_check: {
        supabase_url: !!process.env.SUPABASE_URL,
        supabase_key: !!process.env.SUPABASE_KEY,
        anthropic_api_key: !!process.env.ANTHROPIC_API_KEY,
        cron_secret: !!process.env.CRON_SECRET,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
