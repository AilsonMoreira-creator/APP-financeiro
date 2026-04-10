import { supabase, isOutsideBusinessHours, isInAISchedule, getAILowConfidenceMsg, getAbsenceMessage } from './_ml-helpers.js';

export default async function handler(req, res) {
  try {
    const results = {};

    // 1. Check business hours config
    try {
      const { data } = await supabase
        .from('amicia_data')
        .select('payload')
        .eq('user_id', 'ml-perguntas-config')
        .single();
      results.config_found = !!data?.payload?.config;
      results.ai_auto_enabled = data?.payload?.config?.ai_auto_enabled || false;
      results.schedule = data?.payload?.config?.schedule || 'NOT_FOUND';
      results.absence_enabled = data?.payload?.config?.absence_enabled || false;
    } catch (e) {
      results.config_error = e.message;
    }

    // 2. Check isOutsideBusinessHours
    try {
      results.outside_business_hours = await isOutsideBusinessHours();
    } catch (e) {
      results.outside_hours_error = e.message;
    }

    // 3. Check isInAISchedule
    try {
      results.in_ai_schedule = await isInAISchedule();
    } catch (e) {
      results.ai_schedule_error = e.message;
    }

    // 4. Check tokens
    try {
      const { data: tokens } = await supabase
        .from('ml_tokens')
        .select('brand, seller_id, expires_at');
      results.tokens = (tokens || []).map(t => ({
        brand: t.brand,
        seller_id: t.seller_id,
        expired: new Date(t.expires_at) < new Date(),
      }));
    } catch (e) {
      results.tokens_error = e.message;
    }

    // 5. Check Anthropic key
    results.has_anthropic_key = !!process.env.ANTHROPIC_API_KEY;

    // 6. Current time in SP
    const now = new Date();
    results.server_time_utc = now.toISOString();
    results.sp_time = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).toLocaleString('pt-BR');

    // 7. Recent webhook activity
    try {
      const { data: recent } = await supabase
        .from('ml_pending_questions')
        .select('question_id, brand, status, received_at')
        .order('received_at', { ascending: false })
        .limit(5);
      results.recent_webhooks = recent || [];
    } catch (e) {
      results.webhooks_error = e.message;
    }

    return res.json(results);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
