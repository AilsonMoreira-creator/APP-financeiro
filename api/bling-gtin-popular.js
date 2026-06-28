/**
 * bling-gtin-popular.js — Gera os GTIN-13 no gtin_map SEM escrever no Bling.
 * Instantâneo (só banco). É o 1º passo do botão: reserva os códigos.
 * A escrita no Bling fica por conta do drain (bling-gtin-drain) + cron.
 *
 * Uso:
 *   GET /api/bling-gtin-popular?ref=2655   -> popula uma ref
 *   GET /api/bling-gtin-popular?todos=1    -> popula todas as refs com variação sem gtin
 *
 * Esquema: 2 + REF(5) + VAR(6) + verificador (EAN-13 interno).
 * Reusa o que já existe no mapa; novos pegam o próximo VAR (append-only).
 */
import { supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };

function ean13Check(d12) { let s = 0; for (let i = 0; i < 12; i++) { const n = +d12[i] || 0; s += (i % 2 === 0) ? n : n * 3; } return (10 - (s % 10)) % 10; }
function buildGtin(refDig, varNum) { const ref5 = String(refDig).slice(0, 5).padStart(5, '0'); const v6 = String(varNum).padStart(6, '0'); const d12 = '2' + ref5 + v6; return d12 + ean13Check(d12); }
const ordT = { P: 1, M: 2, G: 3, GG: 4, G1: 5, G2: 6, G3: 7 };

async function popularRef(refDig) {
  const { data: varsRaw } = await supabase.from('bling_estoque')
    .select('bling_sku,bling_produto_id,cor_label,tam').eq('ref', refDig).not('bling_produto_id', 'is', null);
  const vars = (varsRaw || []).filter(v => v.cor_label && String(v.tam || '').trim());
  if (!vars.length) return { ref: refDig, gerados: 0, total: 0 };
  vars.sort((a, b) => String(a.cor_label || '').localeCompare(String(b.cor_label || '')) || (ordT[String(a.tam || '').toUpperCase()] || 99) - (ordT[String(b.tam || '').toUpperCase()] || 99));

  const { data: mapRows } = await supabase.from('gtin_map').select('sku,gtin').eq('ref', refDig);
  const mapaSku = {}; let maxVar = 0;
  (mapRows || []).forEach(r => { mapaSku[r.sku] = r.gtin; const v = parseInt(String(r.gtin).slice(6, 12), 10) || 0; if (v > maxVar) maxVar = v; });

  const novos = [];
  for (const v of vars) {
    if (mapaSku[v.bling_sku]) continue;
    maxVar++;
    novos.push({ sku: v.bling_sku, gtin: buildGtin(refDig, maxVar), ref: refDig, cor: v.cor_label || null, tam: v.tam || null, gerado_por: 'popular', pid_exitus: v.bling_produto_id });
  }
  if (novos.length) await supabase.from('gtin_map').upsert(novos, { onConflict: 'sku' });
  return { ref: refDig, gerados: novos.length, total: vars.length };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.query.todos === '1') {
      const { data: refs } = await supabase.from('bling_estoque').select('ref').not('cor_label', 'is', null);
      const uniq = [...new Set((refs || []).map(r => r.ref).filter(Boolean))];
      let totalGer = 0; const det = [];
      for (const rf of uniq) { const r = await popularRef(rf); totalGer += r.gerados; if (r.gerados) det.push(r); }
      return res.status(200).json({ ok: true, modo: 'todos', refs: uniq.length, gerados: totalGer, detalhe: det });
    }
    const refDig = String(req.query.ref || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!refDig) return res.status(400).json({ error: 'informe ?ref=2655 ou ?todos=1' });
    const r = await popularRef(refDig);
    return res.status(200).json({ ok: true, ...r });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
