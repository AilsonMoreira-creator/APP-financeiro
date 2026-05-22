/**
 * ml-estoque-audit.js — Auditoria estoque app vs ML Lumia LIVE
 *
 * GET /api/ml-estoque-audit?ref=2708
 *   → audita 1 ref especifica
 *
 * GET /api/ml-estoque-audit?ref=all&limit=20
 *   → audita todas as refs (com limite default 20 pra nao estourar quota ML)
 *
 * GET /api/ml-estoque-audit?ref=all&limit=999
 *   → audita todas (cuidado: pode ser lento)
 *
 * GET /api/ml-estoque-audit?diff_only=1&ref=all
 *   → só lista refs com divergencia (>= 5 pecas de diff total ou variacoes
 *     que aparecem em ML mas nao no app, ou vice-versa)
 *
 * Resposta:
 * {
 *   ok, total_refs_auditadas, total_com_divergencia,
 *   refs: [{
 *     ref, descricao,
 *     mlbs: [{ mlb, status, ml_total, app_total }],
 *     total_ml, total_app, diff_total,
 *     variacoes_diff: [{ cor, tam, ml_qtd, app_qtd, diff }],
 *     variacoes_so_ml: [...], variacoes_so_app: [...],
 *     status_audit: 'ok' | 'divergencia' | 'erro'
 *   }]
 * }
 */
import { supabase, getValidToken } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';
export const config = { maxDuration: 300 };

function normRef(r) { return String(r || '').replace(/\D/g, '').replace(/^0+/, '').trim(); }
function normCor(s) { return String(s || '').toLowerCase().trim(); }
function normTam(s) { return String(s || '').toUpperCase().trim(); }

function extractColorSize(combos) {
  const result = { cor: null, tamanho: null };
  for (const a of (combos || [])) {
    if (a.id === 'COLOR' || a.id === 'MAIN_COLOR') result.cor = a.value_name || null;
    else if (a.id === 'SIZE') result.tamanho = a.value_name || null;
  }
  return result;
}

// Busca o estado LIVE de um MLB no ML (variacoes com qtd)
async function fetchMlbLive(mlbId, token) {
  try {
    const r = await fetch(
      `${ML_API}/items/${mlbId}?attributes=id,title,status,available_quantity,seller_custom_field,variations`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!r.ok) return { mlb: mlbId, erro: `HTTP ${r.status}`, status: null, variations: [], total: 0 };
    const item = await r.json();
    const variations = (item.variations || []).map(v => {
      const { cor, tamanho } = extractColorSize(v.attribute_combinations);
      return { cor, tamanho, qtd: v.available_quantity || 0, variation_id: v.id };
    });
    return {
      mlb: mlbId,
      titulo: item.title || '',
      status: item.status,
      seller_custom_field: item.seller_custom_field || '',
      variations,
      total: item.available_quantity || variations.reduce((a, v) => a + v.qtd, 0),
    };
  } catch (e) {
    return { mlb: mlbId, erro: e.message, status: null, variations: [], total: 0 };
  }
}

// Audita 1 ref: compara ml_estoque_ref_atual com ML live
async function auditarRef(refRow, token) {
  const ref = refRow.ref;
  const mlbsEncontrados = (refRow.mlbs_encontrados || []).map(m => m.item_id || m.mlb || m);
  // Variacoes do app (consolidadas em ml_estoque_ref_atual)
  const appVars = refRow.variations || [];
  // Indexa app por chave cor|tam
  const appByKey = new Map();
  let appTotal = 0;
  for (const v of appVars) {
    const k = `${normCor(v.cor)}|${normTam(v.tam)}`;
    appByKey.set(k, (appByKey.get(k) || 0) + (v.qtd || 0));
    appTotal += v.qtd || 0;
  }

  // Busca cada MLB no ML live
  const mlbs = [];
  let totalMlSomado = 0;
  // mlByKey: chave cor|tam -> { max_qtd_entre_mlbs, mlbs_que_tem }
  const mlByKey = new Map();

  for (const mlbId of mlbsEncontrados) {
    const liveData = await fetchMlbLive(mlbId, token);
    mlbs.push({
      mlb: mlbId,
      titulo: liveData.titulo,
      status: liveData.status,
      total: liveData.total,
      erro: liveData.erro || null,
    });
    if (liveData.erro || liveData.status !== 'active') continue;

    for (const v of liveData.variations) {
      const k = `${normCor(v.cor)}|${normTam(v.tamanho)}`;
      // Aplica MESMA REGRA do cron: pega MAIOR entre MLBs (dedupe espelho Ideris)
      const cur = mlByKey.get(k);
      if (!cur || v.qtd > cur.qtd) {
        mlByKey.set(k, { cor: v.cor, tam: v.tamanho, qtd: v.qtd });
      }
    }
    totalMlSomado += liveData.total;
  }

  // Total ML APLICANDO MESMO DEDUPE DO CRON (espelho)
  let totalMlDedupe = 0;
  for (const v of mlByKey.values()) totalMlDedupe += v.qtd;

  // Compara variacao por variacao
  const allKeys = new Set([...appByKey.keys(), ...mlByKey.keys()]);
  const variacoes_diff = [];
  const variacoes_so_ml = [];
  const variacoes_so_app = [];
  for (const k of allKeys) {
    const appQ = appByKey.get(k) || 0;
    const mlV = mlByKey.get(k);
    const mlQ = mlV ? mlV.qtd : 0;
    const [cor, tam] = k.split('|');
    if (appQ === 0 && mlQ > 0) {
      variacoes_so_ml.push({ cor: mlV.cor, tam: mlV.tam, ml_qtd: mlQ });
    } else if (appQ > 0 && mlQ === 0) {
      variacoes_so_app.push({ cor, tam, app_qtd: appQ });
    } else if (appQ !== mlQ) {
      variacoes_diff.push({ cor: mlV?.cor || cor, tam: mlV?.tam || tam, ml_qtd: mlQ, app_qtd: appQ, diff: mlQ - appQ });
    }
  }

  const diff_total = totalMlDedupe - appTotal;
  const tem_divergencia =
    Math.abs(diff_total) >= 5 ||
    variacoes_so_ml.length > 0 ||
    variacoes_so_app.length > 0 ||
    variacoes_diff.some(v => Math.abs(v.diff) >= 5);

  return {
    ref,
    descricao: refRow.descricao,
    mlbs,
    total_ml_somado: totalMlSomado,   // soma raw (dobra duplicatas)
    total_ml_dedupe: totalMlDedupe,    // soma aplicando regra do cron
    total_app: appTotal,
    diff_total,
    qtd_variacoes_diff: variacoes_diff.length,
    qtd_variacoes_so_ml: variacoes_so_ml.length,
    qtd_variacoes_so_app: variacoes_so_app.length,
    variacoes_diff: variacoes_diff.slice(0, 20),
    variacoes_so_ml: variacoes_so_ml.slice(0, 20),
    variacoes_so_app: variacoes_so_app.slice(0, 20),
    status_audit: tem_divergencia ? 'divergencia' : 'ok',
    tem_divergencia,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const refParam = req.query?.ref;
    const limitParam = parseInt(req.query?.limit, 10) || 20;
    const diffOnly = req.query?.diff_only === '1';

    if (!refParam) {
      return res.status(400).json({ error: 'use ?ref=2708 ou ?ref=all' });
    }

    // Carrega refs alvo
    let refs;
    if (refParam === 'all') {
      const { data } = await supabase.from('ml_estoque_ref_atual')
        .select('ref, descricao, qtd_total, variations, mlbs_encontrados, alerta_duplicata, sem_dados, updated_at')
        .eq('sem_dados', false)
        .order('qtd_total', { ascending: false })
        .limit(limitParam);
      refs = data || [];
    } else {
      const refNorm = normRef(refParam);
      const { data } = await supabase.from('ml_estoque_ref_atual')
        .select('ref, descricao, qtd_total, variations, mlbs_encontrados, alerta_duplicata, sem_dados, updated_at')
        .eq('ref', refNorm)
        .maybeSingle();
      if (!data) return res.json({ ok: false, error: 'ref nao encontrada', ref: refNorm });
      refs = [data];
    }

    const token = await getValidToken('Lumia');
    const resultados = [];

    for (const refRow of refs) {
      const audit = await auditarRef(refRow, token);
      if (diffOnly && !audit.tem_divergencia) continue;
      resultados.push(audit);
      await new Promise(r => setTimeout(r, 200)); // throttle ML
    }

    return res.json({
      ok: true,
      total_auditadas: refs.length,
      total_com_divergencia: resultados.filter(r => r.tem_divergencia).length,
      diff_only: diffOnly,
      refs: resultados,
    });
  } catch (e) {
    console.error('[ml-estoque-audit] erro:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
