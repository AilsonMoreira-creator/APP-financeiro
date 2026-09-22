/**
 * ml-full-sku.js — troca dos SKUs das variacoes dos anuncios do FULL (Exitus) pro padrao
 * unificado do Bling (Ailson, 22/09/2026). Os anuncios do Full ficaram com SKUs antigos
 * (sem vinculo no Bling) porque o Full emitia a NF sozinho; com a opcao "comprar do
 * deposito" dentro do anuncio do Full, esses SKUs passaram a aparecer em pedidos normais.
 *
 * GET  ?anuncio=MLB123                -> SO LEITURA: lista as variacoes do ML, o SKU atual e o
 *                                        SKU do Bling casado por REF + cor + tamanho (full_estoque_cache
 *                                        da o ref/cor/tam de cada variation_id; bling_estoque da o SKU).
 * GET  ?anuncio=MLB123&aplicar=1      -> aplica no ML (PUT /items/{id} variations[].seller_custom_field
 *                                        + atributo SELLER_SKU) SO nas variacoes com casamento unico e
 *                                        SKU diferente. Exige X-User ailson. Grava antes/depois em app_erros? nao —
 *                                        em ml_full_sku_log.
 */
import { supabase } from './_ml-helpers.js';
import { tokenDe, mlGet } from './_ml-sale-lib.js';
export const config = { maxDuration: 60 };
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normTam = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.query?.todos) {   // SO LEITURA: resumo de todos os anuncios do Full da Exitus
    const { data: fc } = await supabase.from('full_estoque_cache').select('anuncio').ilike('conta', 'exitus');
    const ids = [...new Set((fc || []).map(x => x.anuncio).filter(Boolean))];
    const base = process.env.APP_BASE_URL || 'https://app-financeiro-brown.vercel.app';
    const out = [];
    for (const id of ids) { try { const r = await fetch(`${base}/api/ml-full-sku?anuncio=${id}&resumo=1`); const j = await r.json(); out.push({ anuncio: id, ref: j.ref, variacoes: j.variacoes, ja_igual: j.ja_igual, trocar: j.trocar, sem_casamento: j.sem_casamento, duplicado: j.duplicado, ambiguo: j.ambiguo, pendentes: (j.linhas || []).map(l => `${l.situacao}: ${l.cor}/${l.tam} ${l.sku_atual}→${l.sku_bling || (l.candidatos || []).join('|') || '?'}`) }); } catch (e) { out.push({ anuncio: id, erro: String(e?.message || e) }); } }
    return res.status(200).json({ ok: true, anuncios: out });
  }
  const anuncio = String(req.query?.anuncio || '').toUpperCase();
  const aplicar = String(req.query?.aplicar || '') === '1';
  if (!anuncio) return res.status(400).json({ ok: false, erro: 'anuncio' });
  if (aplicar && String(req.headers['x-user'] || '') !== 'ailson') return res.status(403).json({ ok: false, erro: 'so ailson aplica' });
  try {
    const token = await tokenDe('exitus');
    const it = await mlGet(token, `/items/${anuncio}?include_attributes=all`);
    if (!it.ok) return res.status(200).json({ ok: false, erro: `ML ${it.http}`, corpo: it.body });
    const vars = it.body?.variations || [];
    if (req.query?.bruto) return res.status(200).json({ ok: true, chaves_item: Object.keys(it.body || {}), variacao0: vars[0] || null });
    const { data: fc } = await supabase.from('full_estoque_cache').select('variation_id, ref, cor, tam, cor_original').eq('anuncio', anuncio);
    const porVar = Object.fromEntries((fc || []).map(x => [String(x.variation_id), x]));
    const ref = (fc || []).map(x => x.ref).find(r => /^\d+$/.test(String(r || '')));
    const { data: be } = ref ? await supabase.from('bling_estoque').select('cor_norm, cor_label, tam, bling_sku').eq('ref', ref) : { data: [] };
    const chaveB = {};
    for (const b of be || []) { if (!b.bling_sku) continue; const k = norm(b.cor_norm || b.cor_label) + '|' + normTam(b.tam); (chaveB[k] = chaveB[k] || []).push(b.bling_sku); }
    const linhas = [], mudar = [];
    for (const v of vars) {
      const cor = (v.attribute_combinations || []).find(a => /cor/i.test(a.name || a.id))?.value_name;
      const tam = (v.attribute_combinations || []).find(a => /tamanho|size/i.test(a.name || a.id))?.value_name;
      const sellerSkuAttr = (v.attributes || []).find(a => a.id === 'SELLER_SKU')?.value_name;
      const atual = v.seller_custom_field || sellerSkuAttr || null;
      const fcv = porVar[String(v.id)];
      const candidatos = [...new Set([
        ...(chaveB[norm(fcv?.cor) + '|' + normTam(fcv?.tam)] || []),
        ...(chaveB[norm(fcv?.cor_original) + '|' + normTam(fcv?.tam)] || []),
        ...(chaveB[norm(cor) + '|' + normTam(tam)] || []),
      ])];
      let situacao = 'sem casamento';
      if (candidatos.length === 1) situacao = candidatos[0] === atual ? 'ja igual' : 'trocar';
      else if (candidatos.length > 1) situacao = candidatos.includes(atual) ? 'ja igual' : 'ambiguo';
      const linha = { variation_id: v.id, cor, tam, sku_atual: atual, sku_bling: candidatos.length === 1 ? candidatos[0] : null, candidatos, situacao, estoque_ml: v.available_quantity };
      linhas.push(linha);
      if (situacao === 'trocar') mudar.push({ id: v.id, seller_custom_field: candidatos[0], attributes: [{ id: 'SELLER_SKU', value_name: candidatos[0] }] });
    }
    // o mesmo SKU do Bling proposto pra DUAS variacoes do ML (ex.: "Marrom" e "Marrom-escuro" caindo
    // na mesma cor do Bling) -> ambiguo: nao aplica em nenhuma das duas, pra nao gerar SKU repetido
    const contagem = {};
    for (const l of linhas) { if (l.situacao === 'trocar') contagem[l.sku_bling] = (contagem[l.sku_bling] || 0) + 1; if (l.sku_atual) contagem[l.sku_atual] = (contagem[l.sku_atual] || 0) + 1; }
    for (const l of linhas) if (l.situacao === 'trocar' && contagem[l.sku_bling] > 1) l.situacao = 'duplicado';
    const mudarOk = mudar.filter(m => contagem[m.seller_custom_field] === 1); mudar.length = 0; mudar.push(...mudarOk);
    const resumo = { anuncio, ref, titulo: it.body?.title, status: it.body?.status, variacoes: vars.length, duplicado: linhas.filter(l => l.situacao === 'duplicado').length, ja_igual: linhas.filter(l => l.situacao === 'ja igual').length, trocar: mudar.length, sem_casamento: linhas.filter(l => l.situacao === 'sem casamento').length, ambiguo: linhas.filter(l => l.situacao === 'ambiguo').length };
    if (!aplicar) return res.status(200).json({ ok: true, ...resumo, linhas: req.query?.resumo ? linhas.filter(l => l.situacao !== 'ja igual') : linhas });
    if (!mudar.length) return res.status(200).json({ ok: true, ...resumo, aplicado: 0 });
    // aplica em lotes de 20 variacoes (PUT parcial so com as que mudam)
    const resultados = [];
    for (let i = 0; i < mudar.length; i += 20) {
      const lote = mudar.slice(i, i + 20);
      const r = await fetch(`https://api.mercadolibre.com/items/${anuncio}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ variations: lote }) });
      const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t.slice(0, 300); }
      resultados.push({ lote: i / 20 + 1, http: r.status, ok: r.ok, erro: r.ok ? undefined : (j?.message || j?.cause || j) });
      await supabase.from('ml_full_sku_log').insert({ anuncio, ref, lote: i / 20 + 1, http: r.status, ok: r.ok, variacoes: lote, resposta: r.ok ? null : j, usuario: 'ailson' });
    }
    return res.status(200).json({ ok: resultados.every(x => x.ok), ...resumo, aplicado: mudar.length, resultados });
  } catch (e) { return res.status(500).json({ ok: false, erro: String(e?.message || e) }); }
}
