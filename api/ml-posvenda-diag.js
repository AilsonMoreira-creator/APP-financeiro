/**
 * ml-posvenda-diag.js — Diagnóstico do módulo pós-venda
 *
 * Roda 4 queries no Supabase + verifica configuração
 * Retorna JSON com tudo que precisamos pra debugar.
 *
 * GET /api/ml-posvenda-diag
 *   (sem auth - apenas leitura, sem dados sensíveis expostos)
 */
import { supabase, BRANDS, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const result = {
    timestamp: new Date().toISOString(),
    diagnostico: {},
  };

  // ── 1: Conversas em ml_conversations ──
  try {
    const { data: convs, error } = await supabase
      .from('ml_conversations')
      .select('brand, status')
      .order('brand');

    if (error) throw error;

    const porMarca = {};
    for (const c of (convs || [])) {
      const key = `${c.brand}_${c.status || 'sem_status'}`;
      porMarca[key] = (porMarca[key] || 0) + 1;
    }

    // Mais recente
    const { data: ultima } = await supabase
      .from('ml_conversations')
      .select('brand, last_message_at, item_title')
      .order('last_message_at', { ascending: false })
      .limit(1);

    result.diagnostico.conversas = {
      total: (convs || []).length,
      por_marca_status: porMarca,
      ultima_recebida: ultima?.[0] || null,
    };
  } catch (e) {
    result.diagnostico.conversas = { ERRO: e.message };
  }

  // ── 2: Mensagens em ml_messages ──
  try {
    const { data: msgs, error } = await supabase
      .from('ml_messages')
      .select('brand, date_created');

    if (error) throw error;

    const porMarca = {};
    for (const m of (msgs || [])) {
      porMarca[m.brand] = (porMarca[m.brand] || 0) + 1;
    }

    const datas = (msgs || []).map(m => m.date_created).filter(Boolean).sort();

    result.diagnostico.mensagens = {
      total: (msgs || []).length,
      por_marca: porMarca,
      primeira: datas[0] || null,
      ultima: datas[datas.length - 1] || null,
    };
  } catch (e) {
    result.diagnostico.mensagens = { ERRO: e.message };
  }

  // ── 3: Tokens das 3 marcas ──
  try {
    const { data: tokens, error } = await supabase
      .from('ml_tokens')
      .select('brand, seller_id, expires_at, updated_at');

    if (error) throw error;

    const agora = Date.now();
    result.diagnostico.tokens = (tokens || []).map(t => ({
      brand: t.brand,
      seller_id: t.seller_id,
      expires_at: t.expires_at,
      minutos_restantes: t.expires_at
        ? Math.round((new Date(t.expires_at).getTime() - agora) / 60000)
        : null,
      ultima_atualizacao: t.updated_at,
    }));
  } catch (e) {
    result.diagnostico.tokens = { ERRO: e.message };
  }

  // ── 4: Probe REAL no ML — tenta listar mensagens não lidas das 3 contas ──
  // Isso confirma se as credenciais funcionam E se HÁ pendências no ML
  result.diagnostico.probe_ml_unread = {};
  for (const brand of BRANDS) {
    try {
      const token = await getValidToken(brand);
      const r = await fetch(
        `${ML_API}/messages/unread?role=seller&tag=post_sale&limit=5`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await r.json().catch(() => ({}));

      result.diagnostico.probe_ml_unread[brand] = {
        http_status: r.status,
        ok: r.ok,
        // Estrutura comum: { results: [...], paging: { total } } ou erro
        total_pendentes: data?.paging?.total ?? data?.total ?? null,
        primeira_amostra: Array.isArray(data?.results) && data.results.length > 0
          ? {
              pack_id: data.results[0].pack_id || data.results[0].id || null,
              has_unread: data.results[0].has_unread || data.results[0].unread || null,
              total_messages: data.results[0].total_messages || null,
            }
          : null,
        erro: data?.error || data?.message || null,
        keys_resposta: Object.keys(data || {}).slice(0, 10),
      };
    } catch (e) {
      result.diagnostico.probe_ml_unread[brand] = { ERRO: e.message };
    }
  }

  // ── 5: Última sync do cron ──
  try {
    const { data: lastSync } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'ml-last-sync')
      .single();
    result.diagnostico.ultima_sync_perguntas = lastSync?.payload || null;
  } catch (e) {}

  return res.status(200).json(result);
}
