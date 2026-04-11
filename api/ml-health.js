/**
 * ml-health.js — Painel de saúde do SAC
 * GET: retorna status de cada conta ML (token, perguntas, IA, webhook, crons)
 */
import { supabase, BRANDS } from './_ml-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const now = new Date();
    const h24 = new Date(now - 24 * 3600000).toISOString();
    const h7d = new Date(now - 7 * 86400000).toISOString();
    const health = {};

    for (const brand of BRANDS) {
      const info = {
        brand,
        token_status: 'sem_token',
        token_expires: null,
        perguntas_24h: 0,
        ia_auto_24h: 0,
        ia_low_24h: 0,
        ausencia_24h: 0,
        estoque_pendentes: 0,
        erros_24h: 0,
        ultimo_webhook: null,
      };

      // Token status
      try {
        const { data: tk } = await supabase.from('ml_tokens')
          .select('access_token, expires_at, updated_at')
          .eq('brand', brand).maybeSingle();
        if (tk?.access_token) {
          const exp = new Date(tk.expires_at);
          const hoursLeft = (exp - now) / 3600000;
          if (hoursLeft > 1) info.token_status = 'valido';
          else if (hoursLeft > 0) info.token_status = 'expira_breve';
          else info.token_status = 'expirado';
          info.token_expires = tk.expires_at;
        }
      } catch {}

      // Perguntas 24h (total)
      try {
        const { count } = await supabase.from('ml_pending_questions')
          .select('id', { count: 'exact', head: true })
          .eq('brand', brand).gte('received_at', h24);
        info.perguntas_24h = count || 0;
      } catch {}

      // IA auto 24h
      try {
        const { count } = await supabase.from('ml_qa_history')
          .select('id', { count: 'exact', head: true })
          .eq('brand', brand).eq('answered_by', '_auto_ia').gte('answered_at', h24);
        info.ia_auto_24h = count || 0;
      } catch {}

      // IA low confidence 24h
      try {
        const { count } = await supabase.from('ml_qa_history')
          .select('id', { count: 'exact', head: true })
          .eq('brand', brand).eq('answered_by', '_auto_ia_low').gte('answered_at', h24);
        info.ia_low_24h = count || 0;
      } catch {}

      // Ausência 24h
      try {
        const { count } = await supabase.from('ml_qa_history')
          .select('id', { count: 'exact', head: true })
          .eq('brand', brand).eq('answered_by', '_auto_absence').gte('answered_at', h24);
        info.ausencia_24h = count || 0;
      } catch {}

      // Último webhook recebido
      try {
        const { data } = await supabase.from('ml_pending_questions')
          .select('received_at')
          .eq('brand', brand)
          .order('received_at', { ascending: false }).limit(1);
        info.ultimo_webhook = data?.[0]?.received_at || null;
      } catch {}

      // Estoque ofertas pendentes
      try {
        const { count } = await supabase.from('ml_stock_offers')
          .select('id', { count: 'exact', head: true })
          .eq('brand', brand).in('status', ['aguardando_confirmacao', 'aguardando_cor']);
        info.estoque_pendentes = count || 0;
      } catch {}

      health[brand] = info;
    }

    // Conversões 7d
    let conversoes_7d = 0;
    let conversoes_valor = 0;
    try {
      const { data } = await supabase.from('ml_conversions')
        .select('order_value').gte('order_at', h7d);
      conversoes_7d = data?.length || 0;
      conversoes_valor = (data || []).reduce((s, c) => s + parseFloat(c.order_value || 0), 0);
    } catch {}

    // Alertas de estoque pendentes (total)
    let alertas_pendentes = 0;
    try {
      const { count } = await supabase.from('ml_stock_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendente');
      alertas_pendentes = count || 0;
    } catch {}

    // Config: IA ativa? Ausência ativa? Horários?
    let config_status = {};
    try {
      const { data } = await supabase.from('amicia_data')
        .select('payload').eq('user_id', 'ml-perguntas-config').maybeSingle();
      const cfg = data?.payload?.config || {};
      config_status = {
        ia_enabled: cfg.ai_enabled || false,
        ia_auto_enabled: cfg.ai_auto_enabled || false,
        absence_enabled: cfg.absence_enabled || false,
        stock_colors_count: (cfg.stock_colors || []).length || 7,
      };
    } catch {}

    // Pós-venda: conversas abertas
    let posvenda_abertas = 0;
    try {
      const { count } = await supabase.from('ml_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'aberto');
      posvenda_abertas = count || 0;
    } catch {}

    return res.json({
      ok: true,
      contas: health,
      conversoes_7d,
      conversoes_valor,
      alertas_pendentes,
      posvenda_abertas,
      config: config_status,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
