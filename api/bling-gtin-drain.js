/**
 * bling-gtin-drain.js — Escreve os GTIN pendentes do gtin_map no Bling.
 * Roda em lote com teto de tempo; o cron (ou disparo manual) chama de novo
 * até zerar. Idempotente e retomável (flags bling_<conta> no gtin_map).
 *
 * Auth: header x-vercel-cron (cron) OU ?key=<KEY> (manual).
 * Uso manual:
 *   /api/bling-gtin-drain?key=KEY                 -> drena as 3 contas (ordem exitus->lumia->muniam)
 *   /api/bling-gtin-drain?key=KEY&conta=exitus    -> só uma conta
 *   /api/bling-gtin-drain?key=KEY&conta=exitus&ref=2655 -> só uma ref (teste controlado)
 *
 * Resolve produto_id por conta: exitus do cache/bling_estoque; lumia/muniam
 * por busca de codigo no Bling (e guarda no gtin_map.pid_<conta>).
 * No PUT, omite camposCustomizados (sem permissão; preserva os existentes).
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };
const API = 'https://api.bling.com.br/Api/v3';
const KEY = 'gtndrn7x2k9';
const CONTAS = ['exitus', 'lumia', 'muniam'];
const BUDGET_MS = 50000;

function autorizado(req) {
  return req.headers['x-vercel-cron'] !== undefined
    || (req.headers['user-agent'] || '').startsWith('vercel-cron')
    || req.query.key === KEY;
}

async function resolverPid(conta, row, headers, pace) {
  if (conta === 'exitus') {
    if (row.pid_exitus) return row.pid_exitus;
    const { data } = await supabase.from('bling_estoque').select('bling_produto_id').eq('bling_sku', row.sku).limit(1).maybeSingle();
    return data?.bling_produto_id || null;
  }
  const cached = row['pid_' + conta];
  if (cached) return cached;
  await pace();
  const r = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(row.sku)}`, headers);
  if (r.status === 429) { const e = new Error('rate'); e.rate = true; throw e; }
  const j = await r.json().catch(() => ({}));
  const arr = j.data || [];
  const hit = arr.find(p => String(p.codigo) === String(row.sku)) || arr[0];
  return hit?.id || null;
}

async function drainConta(conta, refFilter, budgetMs) {
  const out = { conta, escritos: 0, erros: 0, abortou: null, restantes: null };
  let token;
  try { token = await refreshBlingToken(conta); }
  catch (e) { out.abortou = 'token: ' + e.message; return out; }
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

  let q = supabase.from('gtin_map').select('*').eq('bling_' + conta, false);
  if (refFilter) q = q.eq('ref', refFilter);
  const { data: pend } = await q.limit(500);
  if (!pend || !pend.length) { out.restantes = 0; return out; }

  let last = 0;
  const pace = async () => { const w = 380 - (Date.now() - last); if (w > 0) await new Promise(s => setTimeout(s, w)); last = Date.now(); };
  const ini = Date.now();

  for (const row of pend) {
    if (Date.now() - ini > budgetMs) break;
    let pid;
    try { pid = await resolverPid(conta, row, headers, pace); }
    catch (e) { if (e.rate) { await new Promise(s => setTimeout(s, 1300)); continue; } out.erros++; continue; }
    if (!pid) { out.erros++; out.ultimoErro = `sku ${row.sku}: produto não encontrado na conta`; continue; }
    if (!row['pid_' + conta]) await supabase.from('gtin_map').update({ ['pid_' + conta]: pid }).eq('sku', row.sku);

    let feito = false;
    for (let t = 1; t <= 3 && !feito; t++) {
      try {
        await pace();
        const rg = await blingFetch(`${API}/produtos/${pid}`, headers);
        if (rg.status === 429) { await new Promise(s => setTimeout(s, 1300)); continue; }
        const jg = await rg.json().catch(() => ({}));
        const prod = jg.data;
        if (!prod) { out.erros++; feito = true; break; }
        if (String(prod.gtin || '') === row.gtin) {
          await supabase.from('gtin_map').update({ ['bling_' + conta]: true }).eq('sku', row.sku);
          if (conta === 'exitus') await supabase.from('bling_estoque').update({ gtin: row.gtin }).eq('bling_produto_id', pid);
          out.escritos++; feito = true; break;
        }
        prod.gtin = row.gtin;
        delete prod.camposCustomizados;
        await pace();
        const rp = await fetch(`${API}/produtos/${pid}`, { method: 'PUT', headers, body: JSON.stringify(prod) });
        if (rp.status === 429) { await new Promise(s => setTimeout(s, 1300)); continue; }
        if (rp.status === 403) { out.abortou = 'escopo não autorizado (403) — habilite Produtos:alteração e Reconecte esta conta'; return out; }
        if (!rp.ok) { const tp = await rp.text().catch(() => ''); out.erros++; out.ultimoErro = `PUT ${rp.status}: ${tp.slice(0, 120)}`; feito = true; break; }
        await supabase.from('gtin_map').update({ ['bling_' + conta]: true }).eq('sku', row.sku);
        if (conta === 'exitus') await supabase.from('bling_estoque').update({ gtin: row.gtin }).eq('bling_produto_id', pid);
        out.escritos++; feito = true; break;
      } catch (e) { out.erros++; feito = true; break; }
    }
  }

  let q2 = supabase.from('gtin_map').select('sku', { count: 'exact', head: true }).eq('bling_' + conta, false);
  if (refFilter) q2 = q2.eq('ref', refFilter);
  const { count } = await q2;
  out.restantes = count ?? null;
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!autorizado(req)) return res.status(401).json({ error: 'nao autorizado' });

  const refFilter = req.query.ref ? String(req.query.ref).replace(/\D/g, '').replace(/^0+/, '') : null;
  const contaParam = (req.query.conta || '').toLowerCase();
  const contas = CONTAS.includes(contaParam) ? [contaParam] : CONTAS;

  const ini = Date.now();
  const resultado = [];
  for (const c of contas) {
    if (Date.now() - ini > BUDGET_MS) break;
    const restante = BUDGET_MS - (Date.now() - ini);
    resultado.push(await drainConta(c, refFilter, restante));
  }
  return res.status(200).json({ ok: true, resultado });
}
