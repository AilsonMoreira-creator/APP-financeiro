// saude-credito.js — crédito da Anthropic (Ailson 13/09/2026)
//
// Nao existe API de saldo (so o Console). O que existe e o cost_report da
// Admin API (chave sk-ant-admin em ANTHROPIC_ADMIN_API_KEY). Entao:
//   saldo_estimado = ancora (saldo do Console em uma data) + recargas desde
//                    entao - custo diario desde entao
// Alertas NA TELA (pagina Saude): 1x quando cair abaixo de US$ 20 e 1x abaixo
// de US$ 5 — rearmam quando ele registra uma recarga nova.
//
//   GET  ?sync=1        -> puxa custo dos ultimos 10 dias (cron ou admin)
//   GET  ?painel=1      -> saldo estimado, gasto 7d/30d, recargas, alertas
//   POST { data_recarga, valor_usd, saldo_console_usd? }  (admin) -> registra recarga

import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';
import { exigirAdmin } from './_admin.js';

export const config = { maxDuration: 30 };

// 13/09: a Admin API da Anthropic respondeu 403 pra todas as chaves desta
// organizacao (o Console nao expoe "Admin keys"). Fonte alternativa: o custo
// que o PROPRIO APP registra por chamada (lojas_ia_chamadas_log via
// chamarClaude). Cobre co-piloto/Sofia/Lara; os pontos que chamam direto
// (ML reviews, IA pergunta, leads...) entram quando forem instrumentados.
async function sincronizarCustoInterno(dias = 10) {
  const ini = new Date(Date.now() - dias * 86400000).toISOString();
  const { data } = await supabase.from('lojas_ia_chamadas_log').select('created_at, custo_estimado_usd').gte('created_at', ini);
  const porDia = {};
  for (const r of (data || [])) { const d = new Date(new Date(r.created_at).getTime() - 3 * 3600000).toISOString().slice(0, 10); porDia[d] = (porDia[d] || 0) + (Number(r.custo_estimado_usd) || 0); }
  let n = 0;
  for (const [dia, custo] of Object.entries(porDia)) {
    await supabase.from('saude_custo_dia').upsert({ dia, custo_usd: Math.round(custo * 10000) / 10000, atualizado_em: new Date().toISOString() }, { onConflict: 'dia' });
    n++;
  }
  return { ok: true, fonte: 'registro interno (parcial)', dias: n };
}

export async function sincronizarCusto(dias = 10) {
  const key = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!key) return sincronizarCustoInterno(dias);
  const ini = new Date(Date.now() - dias * 86400000); ini.setUTCHours(0, 0, 0, 0);
  const url = `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${ini.toISOString()}&bucket_width=1d&limit=31`;
  const r = await fetch(url, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const alt = await sincronizarCustoInterno(dias); return { ...alt, admin_api: { http: r.status, erro: JSON.stringify(j).slice(0, 120) } }; }
  let n = 0;
  for (const b of (j.data || [])) {
    const dia = String(b.starting_at || '').slice(0, 10);
    if (!dia) continue;
    // cada bucket traz results[] com amount (string, em centavos? nao: 'amount' e USD decimal em string)
    const total = (b.results || []).reduce((t, x) => t + (Number(x.amount) || 0), 0);
    await supabase.from('saude_custo_dia').upsert({ dia, custo_usd: Math.round(total * 10000) / 10000, atualizado_em: new Date().toISOString() }, { onConflict: 'dia' });
    n++;
  }
  return { ok: true, dias: n, bruto_exemplo: (j.data || [])[0]?.results?.[0] || null };
}

async function painel() {
  const { data: rec } = await supabase.from('saude_recargas').select('*').order('data_recarga', { ascending: true });
  const recargas = rec || [];
  // ancora = ultima recarga com saldo_console informado (ou a primeira)
  const ancora = [...recargas].reverse().find(r => r.saldo_console_usd != null) || recargas[0];
  const { data: custos } = await supabase.from('saude_custo_dia').select('dia, custo_usd').order('dia', { ascending: false }).limit(60);
  const c = custos || [];
  const soma = (desde) => c.filter(x => x.dia >= desde).reduce((t, x) => t + Number(x.custo_usd), 0);
  let saldo = null, base = null;
  if (ancora) {
    base = Number(ancora.saldo_console_usd ?? 0);
    const recargasDepois = recargas.filter(r => r.data_recarga > ancora.data_recarga && r.saldo_console_usd == null).reduce((t, r) => t + Number(r.valor_usd), 0);
    // custo a partir do dia SEGUINTE a ancora (o dia da ancora ja esta no saldo do console)
    const diaSeguinte = new Date(new Date(ancora.data_recarga + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
    saldo = Math.round((base + recargasDepois - soma(diaSeguinte)) * 100) / 100;
  }
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const gasto7 = Math.round(soma(d7) * 100) / 100, gasto30 = Math.round(soma(d30) * 100) / 100;
  const mediaDia = gasto7 / 7;
  const diasRestantes = saldo != null && mediaDia > 0 ? Math.floor(saldo / mediaDia) : null;
  // alertas 1x por recarga
  const { data: cfg } = await supabase.from('saude_config').select('chave, valor').in('chave', ['credito_alerta_20', 'credito_alerta_5']);
  const m = {}; for (const r of (cfg || [])) m[r.chave] = r.valor;
  const ultimaRecarga = recargas.length ? recargas[recargas.length - 1].registrado_em : '';
  const alertas = [];
  if (saldo != null && saldo < 5 && (m.credito_alerta_5 || '') < ultimaRecarga + '~') { alertas.push({ nivel: 'vermelho', texto: `Crédito da Anthropic abaixo de US$ 5 (estimado US$ ${saldo.toFixed(2)}) — recarregar hoje` }); }
  else if (saldo != null && saldo < 20 && (m.credito_alerta_20 || '') < ultimaRecarga + '~') { alertas.push({ nivel: 'amarelo', texto: `Crédito da Anthropic abaixo de US$ 20 (estimado US$ ${saldo.toFixed(2)}) — programar recarga` }); }
  return { ok: true, saldo_estimado: saldo, ancora: ancora ? { data: ancora.data_recarga, saldo_console: ancora.saldo_console_usd } : null,
    gasto_7d: gasto7, gasto_30d: gasto30, media_dia: Math.round(mediaDia * 100) / 100, dias_restantes: diasRestantes,
    ultimo_custo_dia: c[0] || null, recargas: recargas.slice(-10).reverse(), alertas, chave_ok: true, fonte: 'registro interno do app (parcial até instrumentar todos os pontos)' };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const ehCron = (req.headers['user-agent'] || '').includes('vercel-cron');
  if (req.query?.user === 'ailson') req.headers['x-user'] = 'ailson';
  // 23/09 Fase 0: cron so sincroniza o custo (GET simples); o resto = admin pelo token
  const soSyncCron = ehCron && req.method === 'GET' && !req.query?.painel && !req.query?.quem;
  if (!soSyncCron) { if (!(await exigirAdmin(req, res, 'saude-credito'))) return; }

  if (req.method === 'POST') {
    const b = req.body || {};
    if (b.marcar_alerta) { await supabase.from('saude_config').upsert({ chave: b.marcar_alerta, valor: new Date().toISOString() + '~', atualizado_em: new Date().toISOString() }, { onConflict: 'chave' }); return res.status(200).json({ ok: true }); }
    const valor = Number(b.valor_usd); const data = String(b.data_recarga || '').slice(0, 10);
    if (!data || !(valor >= 0)) return res.status(400).json({ error: 'data_recarga e valor_usd' });
    await supabase.from('saude_recargas').insert({ data_recarga: data, valor_usd: valor, saldo_console_usd: b.saldo_console_usd != null && b.saldo_console_usd !== '' ? Number(b.saldo_console_usd) : null, observacao: String(b.observacao || '').slice(0, 200) || null });
    // recarga nova rearma os alertas
    await supabase.from('saude_config').upsert([{ chave: 'credito_alerta_20', valor: '' }, { chave: 'credito_alerta_5', valor: '' }], { onConflict: 'chave' });
    return res.status(200).json({ ok: true });
  }
  // diagnostico: qual chave o servidor ve e o que a Admin API responde
  if (req.query?.quem === '1') {
    const key = process.env.ANTHROPIC_ADMIN_API_KEY || '';
    const h = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    const t = async (url) => { const r = await fetch(url, { headers: h }); return { http: r.status, corpo: (await r.text()).slice(0, 200) }; };
    return res.status(200).json({ prefixo: key.slice(0, 14) + '…', tamanho: key.length,
      org_me: await t('https://api.anthropic.com/v1/organizations/me'),
      users: await t('https://api.anthropic.com/v1/organizations/users?limit=1'),
      cost: await t('https://api.anthropic.com/v1/organizations/cost_report?starting_at=2026-09-10T00:00:00Z&bucket_width=1d&limit=3') });
  }
  if (req.query?.sync === '1' || ehCron) { const s = await sincronizarCusto(10); if (req.query?.painel !== '1') return res.status(200).json(s); }
  return res.status(200).json(await painel());
}
