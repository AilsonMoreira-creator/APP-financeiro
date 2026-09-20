/**
 * cron-despachante.js — roda a cada minuto pelo Vercel e dispara os jobs da tabela
 * cron_agenda que vencem naquele minuto. (Ailson, 20/09/2026 — o Vercel limita 100
 * crons no vercel.json; a agenda no banco nao tem limite e ganha log/desligar.)
 *
 * modo por job:
 *   sombra -> NAO chama o endpoint; so registra "dispararia agora" no cron_agenda_log
 *             (o cron equivalente do vercel.json continua valendo). Serve pra provar
 *             que o despachante bate com o padrao atual antes de virar.
 *   ativo  -> chama o endpoint (GET, User-Agent 'vercel-cron/despachante', que os
 *             endpoints ja aceitam) e registra http/duracao/erro.
 *
 * Trava de duplicidade: (nome, minuto) e unico no log — se o Vercel chamar duas
 * vezes no mesmo minuto, o segundo nao dispara.
 *
 * GET ?status=1        -> agenda com ultimo estado (pra tela de Saude)
 * GET ?rodar=<nome>    -> dispara um job agora (X-User ailson), ignorando a agenda
 */
import { supabase } from './_ml-helpers.js';

export const config = { maxDuration: 60 };

const BASE = process.env.APP_BASE_URL || 'https://app-financeiro-brown.vercel.app';

// ── cron de 5 campos: min hora dia mes dow ────────────────────────────────────
function campoBate(expr, valor, min, max, dow = false) {
  for (const parte of String(expr).split(',')) {
    let [faixa, passo] = parte.split('/');
    passo = passo ? parseInt(passo, 10) : 1;
    let ini, fim;
    if (faixa === '*') { ini = min; fim = max; }
    else if (faixa.includes('-')) { const [a, b] = faixa.split('-').map(Number); ini = a; fim = b; }
    else { ini = fim = Number(faixa); if (passo > 1) fim = max; }
    if (dow) { if (ini === 7) ini = 0; if (fim === 7) fim = 0; }
    for (let v = ini; v <= fim; v += passo) if (v === valor) return true;
  }
  return false;
}
export function cronBate(expressao, d) {
  const [mi, ho, dm, mo, dw] = String(expressao).trim().split(/\s+/);
  return campoBate(mi, d.minuto, 0, 59) && campoBate(ho, d.hora, 0, 23) && campoBate(dm, d.dia, 1, 31)
    && campoBate(mo, d.mes, 1, 12) && campoBate(dw, d.dow, 0, 6, true);
}
function agoraEm(fuso) {
  const now = new Date();
  if (fuso === 'BRT') {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(now).map(x => [x.type, x.value]));
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    return { minuto: +p.minute, hora: +p.hour % 24, dia: +p.day, mes: +p.month, dow, chave: `${p.year}-${p.month}-${p.day} ${String(+p.hour % 24).padStart(2, '0')}:${p.minute} BRT` };
  }
  return { minuto: now.getUTCMinutes(), hora: now.getUTCHours(), dia: now.getUTCDate(), mes: now.getUTCMonth() + 1, dow: now.getUTCDay(), chave: now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' };
}

async function disparar(job, modo, minuto) {
  const t0 = Date.now();
  // trava (nome, minuto)
  const { error: dup } = await supabase.from('cron_agenda_log').insert({ nome: job.nome, minuto, modo, ok: null });
  if (dup) return { nome: job.nome, pulado: 'ja disparado neste minuto' };
  let ok = null, http = null, erro = null, corpo = null;
  if (modo === 'ativo') {
    try {
      const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), Math.min(job.timeout_s || 290, 55) * 1000);
      const r = await fetch(`${BASE}${job.caminho}`, { headers: { 'User-Agent': 'vercel-cron/despachante', 'X-Cron-Despachante': '1' }, signal: ctrl.signal });
      clearTimeout(tm);
      http = r.status; ok = r.ok; corpo = (await r.text().catch(() => '')).slice(0, 400);
    } catch (e) { ok = false; erro = String(e?.name === 'AbortError' ? 'timeout do despachante (job pode ter continuado)' : (e?.message || e)).slice(0, 300); }
  }
  const dur = Date.now() - t0;
  await supabase.from('cron_agenda_log').update({ ok, http, duracao_ms: dur, erro, corpo }).eq('nome', job.nome).eq('minuto', minuto);
  await supabase.from('cron_agenda').update({ ultima_execucao: new Date().toISOString(), ultimo_ok: ok, ultimo_http: http, ultima_duracao_ms: dur, ultimo_erro: erro }).eq('nome', job.nome);
  return { nome: job.nome, modo, ok, http, ms: dur };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const q = req.query || {};
    if (q.status) {
      const { data } = await supabase.from('cron_agenda').select('*').order('modulo').order('nome');
      const { data: log } = await supabase.from('cron_agenda_log').select('*').order('disparado_em', { ascending: false }).limit(q.log ? Number(q.log) : 100);
      return res.status(200).json({ ok: true, agenda: data || [], log: log || [] });
    }
    if (q.rodar) {
      if (String(req.headers['x-user'] || '') !== 'ailson') return res.status(403).json({ ok: false, erro: 'so ailson' });
      const { data: job } = await supabase.from('cron_agenda').select('*').eq('nome', q.rodar).maybeSingle();
      if (!job) return res.status(404).json({ ok: false, erro: 'job nao encontrado' });
      return res.status(200).json(await disparar(job, 'ativo', `manual ${new Date().toISOString()}`));
    }
    const { data: jobs } = await supabase.from('cron_agenda').select('*').eq('ativo', true);
    const ag = { UTC: agoraEm('UTC'), BRT: agoraEm('BRT') };
    const vencem = (jobs || []).filter(j => { try { return cronBate(j.expressao, ag[j.fuso === 'BRT' ? 'BRT' : 'UTC']); } catch { return false; } });
    // dispara em paralelo (cada um com sua trava)
    const resultados = await Promise.all(vencem.map(j => disparar(j, j.modo === 'ativo' ? 'ativo' : 'sombra', ag[j.fuso === 'BRT' ? 'BRT' : 'UTC'].chave)));
    return res.status(200).json({ ok: true, minuto: ag.UTC.chave, jobs_ativos: (jobs || []).length, venceram: vencem.length, resultados });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
