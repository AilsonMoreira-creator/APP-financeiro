/**
 * bling-localizacao-popular.js — Preenche o campo Estoque > Localização no Bling.
 *
 * A localização do produto no estoque é anotada no título, entre parênteses,
 * logo depois da ref (ex: "Vestido ... (ref 02782) (H) Cor:PRETO;Tamanho:P").
 * O Relatório de Separação de Vendas só consegue ordenar o picking se a letra
 * estiver no campo próprio (estoque.localizacao), então este endpoint copia a
 * letra do título pro campo, em todas as variações. Ailson 19/07/2026.
 *
 * Fonte: tabela bling_localizacao_fila (sku, ref, localizacao + flags por conta).
 * Idempotente e retomável: marca feito_<conta> e pula quem já está certo no Bling.
 *
 * Auth: header x-vercel-cron (cron) OU ?key=<KEY> (manual).
 * Uso:
 *   /api/bling-localizacao-popular?key=KEY&conta=muniam&limite=3   -> teste curto
 *   /api/bling-localizacao-popular?key=KEY&conta=muniam&dry=1      -> simula, não escreve
 *   /api/bling-localizacao-popular?key=KEY&conta=muniam            -> drena por ~50s
 *   /api/bling-localizacao-popular?key=KEY&conta=muniam&ref=2782   -> só uma ref
 *
 * Chamar de novo até "restantes" chegar a 0 (cada chamada tem teto de tempo).
 * No PUT, omite camposCustomizados (sem permissão; preserva os existentes).
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };
const API = 'https://api.bling.com.br/Api/v3';
const KEY = 'blocz9k4m2x';
const CONTAS = ['muniam', 'lumia', 'exitus']; // ordem de teste pedida: muniam primeiro
const BUDGET_MS = 50000;

function autorizado(req) {
  return req.headers['x-vercel-cron'] !== undefined
    || (req.headers['user-agent'] || '').startsWith('vercel-cron')
    || req.query.key === KEY;
}

// Acha o id do produto nessa conta. exitus já vem pré-cacheado do bling_estoque;
// lumia/muniam busca por codigo (SKU) e guarda no cache pra não repetir.
async function resolverPid(conta, row, headers, pace) {
  const cached = row['pid_' + conta];
  if (cached) return cached;
  await pace();
  const r = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(row.sku)}`, headers);
  if (r.status === 429) { const e = new Error('rate'); e.rate = true; throw e; }
  const j = await r.json().catch(() => ({}));
  const arr = j.data || [];
  // Só aceita match EXATO de codigo. O gtin-drain caía pro arr[0] quando não
  // achava, mas aqui isso gravaria a localização num produto errado — prefiro
  // pular e registrar erro. Ailson 19/07/2026.
  const hit = arr.find(p => String(p.codigo) === String(row.sku)) || null;
  const pid = hit?.id || null;
  if (pid) {
    await supabase.from('bling_localizacao_fila')
      .update({ ['pid_' + conta]: pid }).eq('sku', row.sku);
  }
  return pid;
}

async function popularConta(conta, { refFilter, limite, dry, budgetMs }) {
  const out = { conta, dry: !!dry, escritos: 0, ja_ok: 0, erros: 0, abortou: null, restantes: null, amostra: [] };
  let token;
  try { token = await refreshBlingToken(conta); }
  catch (e) { out.abortou = 'token: ' + e.message; return out; }
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

  let q = supabase.from('bling_localizacao_fila').select('*').eq('feito_' + conta, false);
  if (refFilter) q = q.eq('ref', refFilter);
  const { data: pend } = await q.order('localizacao').order('sku').limit(limite || 500);
  if (!pend || !pend.length) { out.restantes = 0; return out; }

  let last = 0;
  const pace = async () => { const w = 380 - (Date.now() - last); if (w > 0) await new Promise(s => setTimeout(s, w)); last = Date.now(); };
  const ini = Date.now();

  for (const row of pend) {
    if (Date.now() - ini > budgetMs) break;
    if (limite && (out.escritos + out.ja_ok + out.erros) >= limite) break;

    let pid;
    try { pid = await resolverPid(conta, row, headers, pace); }
    catch (e) { if (e.rate) { await new Promise(s => setTimeout(s, 1300)); continue; } out.erros++; continue; }
    if (!pid) {
      out.erros++;
      await supabase.from('bling_localizacao_fila')
        .update({ erro_msg: `produto não encontrado na conta ${conta}` }).eq('sku', row.sku);
      continue;
    }

    let feito = false;
    for (let t = 1; t <= 3 && !feito; t++) {
      try {
        await pace();
        const rg = await blingFetch(`${API}/produtos/${pid}`, headers);
        if (rg.status === 429) { await new Promise(s => setTimeout(s, 1300)); continue; }
        const jg = await rg.json().catch(() => ({}));
        const prod = jg.data;
        if (!prod) { out.erros++; feito = true; break; }

        const atual = String(prod.estoque?.localizacao || '').trim();
        if (atual === row.localizacao) {
          if (!dry) await supabase.from('bling_localizacao_fila')
            .update({ ['feito_' + conta]: true, erro_msg: null, atualizado_em: new Date().toISOString() }).eq('sku', row.sku);
          out.ja_ok++; feito = true; break;
        }

        if (out.amostra.length < 5) {
          out.amostra.push({ sku: row.sku, titulo: String(row.titulo || '').slice(0, 60), de: atual || '(vazio)', para: row.localizacao });
        }

        if (dry) { out.escritos++; feito = true; break; } // simulação: não escreve

        prod.estoque = { ...(prod.estoque || {}), localizacao: row.localizacao };
        delete prod.camposCustomizados;
        await pace();
        const rp = await fetch(`${API}/produtos/${pid}`, { method: 'PUT', headers, body: JSON.stringify(prod) });
        if (rp.status === 429) { await new Promise(s => setTimeout(s, 1300)); continue; }
        if (rp.status === 403) {
          out.abortou = 'escopo não autorizado (403) — habilite Produtos:alteração e reconecte esta conta';
          return out;
        }
        if (!rp.ok) {
          const tp = await rp.text().catch(() => '');
          out.erros++;
          await supabase.from('bling_localizacao_fila')
            .update({ erro_msg: `PUT ${rp.status}: ${tp.slice(0, 150)}` }).eq('sku', row.sku);
          feito = true; break;
        }

        await supabase.from('bling_localizacao_fila')
          .update({ ['feito_' + conta]: true, erro_msg: null, atualizado_em: new Date().toISOString() }).eq('sku', row.sku);
        out.escritos++; feito = true; break;
      } catch (e) {
        out.erros++;
        feito = true; break;
      }
    }
  }

  let q2 = supabase.from('bling_localizacao_fila').select('sku', { count: 'exact', head: true }).eq('feito_' + conta, false);
  if (refFilter) q2 = q2.eq('ref', refFilter);
  const { count } = await q2;
  out.restantes = count ?? null;
  return out;
}

export default async function handler(req, res) {
  if (!autorizado(req)) return res.status(403).json({ error: 'nao autorizado' });

  const contaParam = req.query.conta;
  const contas = contaParam ? [contaParam] : CONTAS;
  for (const c of contas) {
    if (!CONTAS.includes(c)) return res.status(400).json({ error: `conta invalida: ${c}`, validas: CONTAS });
  }

  const refFilter = req.query.ref || null;
  const limite = req.query.limite ? Number(req.query.limite) : null;
  const dry = req.query.dry === '1';
  const budgetMs = contas.length > 1 ? Math.floor(BUDGET_MS / contas.length) : BUDGET_MS;

  const resultados = [];
  for (const conta of contas) {
    resultados.push(await popularConta(conta, { refFilter, limite, dry, budgetMs }));
  }

  return res.status(200).json({ ok: true, resultados });
}
