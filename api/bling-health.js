/**
 * bling-health.js — Painel de saúde da integração Bling
 * GET: retorna status de cada conta (último sucesso, erro, token, pedidos hoje)
 * POST: força sync manual de uma conta específica
 */
import { supabase, refreshBlingToken } from './_bling-helpers.js';

const CONTAS = ['exitus', 'lumia', 'muniam'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // POST: força sync manual
  if (req.method === 'POST') {
    const { action, conta } = req.body || {};

    if (action === 'refresh_token' && conta) {
      try {
        await refreshBlingToken(conta);
        return res.json({ ok: true, msg: `Token ${conta} renovado` });
      } catch (e) {
        return res.status(400).json({ ok: false, error: e.message });
      }
    }

    if (action === 'sync_now') {
      // Chama o cron endpoint internamente
      try {
        const host = req.headers.host || 'app-financeiro-brown.vercel.app';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const r = await fetch(`${protocol}://${host}/api/bling-cron`, { method: 'GET' });
        const data = await r.json();
        return res.json({ ok: true, msg: 'Sync disparado', result: data });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message });
      }
    }

    return res.status(400).json({ error: 'action inválida' });
  }

  // GET: retorna saúde de cada conta
  try {
    const hoje = new Date().toISOString().slice(0, 10);
    const health = {};

    // 1. Status do último cron
    let cronStatus = null;
    try {
      const { data } = await supabase.from('amicia_data')
        .select('payload, updated_at').eq('user_id', 'bling-cron-status').maybeSingle();
      cronStatus = data;
    } catch {}

    // 2. Para cada conta: token, pedidos hoje, último sucesso/erro
    for (const conta of CONTAS) {
      const info = { conta, token_status: 'desconhecido', token_expires: null, pedidos_hoje: 0, last_run: null, last_success: null, last_error: null, novos_ultimo_ciclo: 0, erros_ultimo_ciclo: 0 };

      // Token
      try {
        const { data: tk } = await supabase.from('bling_tokens')
          .select('expires_at, updated_at').eq('conta', conta).maybeSingle();
        if (tk) {
          const exp = new Date(tk.expires_at);
          const now = new Date();
          const hoursLeft = (exp - now) / 3600000;
          if (hoursLeft > 24) info.token_status = 'valido';
          else if (hoursLeft > 0) info.token_status = 'expira_breve';
          else info.token_status = 'expirado';
          info.token_expires = tk.expires_at;
        } else {
          info.token_status = 'sem_token';
        }
      } catch {}

      // Pedidos hoje
      try {
        const { count } = await supabase.from('bling_vendas_detalhe')
          .select('id', { count: 'exact', head: true })
          .eq('conta', conta).eq('data_pedido', hoje);
        info.pedidos_hoje = count || 0;
      } catch {}

      // Status do último cron
      if (cronStatus?.payload?.por_conta?.[conta]) {
        const cc = cronStatus.payload.por_conta[conta];
        info.last_run = cronStatus.payload.last_run;
        info.novos_ultimo_ciclo = cc.novosInseridos || 0;
        info.erros_ultimo_ciclo = cc.erros || 0;
        if (cc.last_success) info.last_success = cc.last_success;
        if (cc.last_error) info.last_error = cc.last_error;
      }

      health[conta] = info;
    }

    // Contagem total de pedidos nos últimos 7 dias
    let total_7d = 0;
    try {
      const seteDias = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const { count } = await supabase.from('bling_vendas_detalhe')
        .select('id', { count: 'exact', head: true })
        .gte('data_pedido', seteDias);
      total_7d = count || 0;
    } catch {}

    return res.json({
      ok: true,
      last_cron: cronStatus?.payload?.last_run || null,
      duracao_ultimo: cronStatus?.payload?.duracao || null,
      total_7d,
      contas: health,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
