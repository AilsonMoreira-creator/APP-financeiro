/**
 * bling-gtin-gerar.js — Gera GTIN-13 (EAN-13 interno) por SKU e grava no Bling.
 *
 * Esquema interno (faixa "2" reservada pela GS1 p/ uso interno):
 *   2 + REF(5 díg) + VARIAÇÃO(6 díg) + dígito verificador  = 13 díg
 *   ex: ref 2655, variação 1 -> 2026550000015
 * O dígito verificador é o padrão EAN-13 (peso 1/3 alternado).
 *
 * Canônico em gtin_map (sku -> gtin): gera 1x e reusa nas 3 contas Bling
 * (Exitus/Lumia/Muniam), porque o produto físico é o mesmo.
 *
 * SEGURO: dry-run por padrão. Só escreve com ?confirmar=1.
 * Escrita = GET /produtos/{id} -> seta gtin -> PUT (devolve o mesmo objeto,
 * pra não zerar outros campos).
 *
 * Uso:
 *   GET /api/bling-gtin-gerar?ref=2655                      -> DRY (gera + mostra plano + 1 produto cru)
 *   GET /api/bling-gtin-gerar?ref=2655&confirmar=1&limite=1 -> escreve só a 1ª variação (teste)
 *   GET /api/bling-gtin-gerar?ref=2655&confirmar=1          -> escreve todas
 *   &conta=exitus|lumia|muniam (default exitus)
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 120 };
const API = 'https://api.bling.com.br/Api/v3';

function ean13Check(d12) { let s = 0; for (let i = 0; i < 12; i++) { const n = +d12[i] || 0; s += (i % 2 === 0) ? n : n * 3; } return (10 - (s % 10)) % 10; }
function buildGtin(refDig, varNum) { const ref5 = String(refDig).slice(0, 5).padStart(5, '0'); const v6 = String(varNum).padStart(6, '0'); const d12 = '2' + ref5 + v6; return d12 + ean13Check(d12); }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const conta = (req.query.conta || 'exitus').toLowerCase();
  const refDig = String(req.query.ref || '').replace(/\D/g, '').replace(/^0+/, '');
  const confirmar = req.query.confirmar === '1';
  const limite = req.query.limite ? Math.max(1, parseInt(req.query.limite, 10)) : null;
  const usuario = req.query.usuario || 'gtin-gerar';
  if (!refDig) return res.status(400).json({ error: 'informe ?ref=2655' });
  if (refDig.length > 5) return res.status(400).json({ error: 'ref com mais de 5 dígitos não cabe no esquema' });

  try {
    // variações da base (já sincronizadas do Exitus)
    const { data: vars, error: eV } = await supabase.from('bling_estoque')
      .select('bling_sku,bling_produto_id,cor_label,tam,gtin')
      .eq('ref', refDig).not('bling_produto_id', 'is', null);
    if (eV) return res.status(500).json({ error: eV.message });
    if (!vars || !vars.length) return res.status(404).json({ error: `nenhuma variação na base pra ref ${refDig}` });

    const ordT = { P: 1, M: 2, G: 3, GG: 4, G1: 5, G2: 6, G3: 7 };
    vars.sort((a, b) => String(a.cor_label || '').localeCompare(String(b.cor_label || '')) || (ordT[String(a.tam || '').toUpperCase()] || 99) - (ordT[String(b.tam || '').toUpperCase()] || 99));

    // gtins já gerados pra essa ref (reusa; novos pegam o próximo número)
    const { data: mapRows } = await supabase.from('gtin_map').select('sku,gtin').eq('ref', refDig);
    const mapaSku = {}; let maxVar = 0;
    (mapRows || []).forEach(r => { mapaSku[r.sku] = r.gtin; const v = parseInt(String(r.gtin).slice(6, 12), 10) || 0; if (v > maxVar) maxVar = v; });

    const plano = []; const novosMap = [];
    for (const v of vars) {
      const sku = v.bling_sku;
      let gtin = mapaSku[sku]; let origem = 'mapa';
      if (!gtin) { maxVar++; gtin = buildGtin(refDig, maxVar); origem = 'novo'; novosMap.push({ sku, gtin, ref: refDig, cor: v.cor_label || null, tam: v.tam || null, gerado_por: usuario }); }
      plano.push({ sku, produto_id: v.bling_produto_id, cor: v.cor_label, tam: v.tam, gtin_atual: v.gtin || null, gtin_novo: gtin, origem });
    }

    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

    // ── DRY: mostra o plano + 1 produto cru (pra confirmar o shape do PUT) ──
    if (!confirmar) {
      let amostra = null;
      try {
        const r = await blingFetch(`${API}/produtos/${plano[0].produto_id}`, headers);
        const j = await r.json().catch(() => ({}));
        amostra = { status: r.status, keys: j.data ? Object.keys(j.data) : null, gtin_atual: j.data?.gtin ?? null, data: j.data || null };
      } catch (e) { amostra = { erro: e.message }; }
      return res.status(200).json({ ok: true, modo: 'DRY (nada gravado)', conta, ref: refDig, total: plano.length, novos: novosMap.length, reusados: plano.length - novosMap.length, plano, amostra_produto_get: amostra });
    }

    // ── CONFIRMAR: grava mapa canônico + escreve no Bling ──
    if (novosMap.length) {
      const { error: eMap } = await supabase.from('gtin_map').upsert(novosMap, { onConflict: 'sku' });
      if (eMap) return res.status(500).json({ error: 'falha ao gravar gtin_map: ' + eMap.message });
    }

    const alvo = limite ? plano.slice(0, limite) : plano;
    const resultado = [];
    for (const p of alvo) {
      try {
        const rg = await blingFetch(`${API}/produtos/${p.produto_id}`, headers);
        const jg = await rg.json().catch(() => ({}));
        const prod = jg.data;
        if (!prod) { resultado.push({ sku: p.sku, ok: false, motivo: `GET HTTP ${rg.status}` }); continue; }
        if (String(prod.gtin || '') === p.gtin_novo) { resultado.push({ sku: p.sku, gtin: p.gtin_novo, ok: true, obs: 'já estava' }); continue; }
        prod.gtin = p.gtin_novo;
        const rp = await fetch(`${API}/produtos/${p.produto_id}`, { method: 'PUT', headers, body: JSON.stringify(prod) });
        const tp = await rp.text().catch(() => '');
        if (!rp.ok) { resultado.push({ sku: p.sku, gtin: p.gtin_novo, ok: false, motivo: `PUT HTTP ${rp.status}`, detalhe: tp.slice(0, 300) }); continue; }
        await supabase.from('bling_estoque').update({ gtin: p.gtin_novo }).eq('bling_produto_id', p.produto_id);
        resultado.push({ sku: p.sku, gtin: p.gtin_novo, ok: true });
      } catch (e) { resultado.push({ sku: p.sku, ok: false, motivo: e.message }); }
      await new Promise(s => setTimeout(s, 350));
    }
    const ok = resultado.filter(r => r.ok).length;
    return res.status(200).json({ ok: true, modo: 'GRAVADO', conta, ref: refDig, escritos: ok, total_alvo: alvo.length, resultado });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
