/**
 * full-recomendacao.js — a tela do botão FULL no card de produto
 * (Ailson 17/08/2026)
 *
 * Junta tudo que a Cris precisa pra decidir, por cor+tamanho:
 *   estoque no Full · estoque na fábrica (Bling Exitus) · venda/dia de TODAS
 *   as plataformas · tendência · corte chegando · quantidade ideal · possível
 *   · sugerida (já arredondada) — e o motivo em uma frase.
 *
 * GET ?ref=02782
 */
import { supabase } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';
import { lerRegras, calcularLinha } from './_full-motor.js';

export const config = { maxDuration: 120 };
const n = (v) => Number(v) || 0;
const refNorm = (r) => String(r || '').replace(/^0+/, '');
const chaveCor = (c) => String(c || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
const dia = (d) => new Date(d).toISOString().slice(0, 10);

/** venda por cor+tamanho no período, somando TODAS as plataformas */
async function vendaPorSku(ref, dias) {
  const desde = dia(new Date(Date.now() - dias * 86400000));
  const { data } = await supabase.from('bling_vendas_detalhe')
    .select('itens, data_pedido').gte('data_pedido', desde).limit(20000);
  const m = {};
  for (const v of (data || [])) {
    for (const it of (v.itens || [])) {
      if (refNorm(it.ref) !== refNorm(ref)) continue;
      const k = `${chaveCor(it.cor)}|${String(it.tamanho || '').toUpperCase()}`;
      m[k] = (m[k] || 0) + (n(it.quantidade) || 1);
    }
  }
  return m;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ref = String(req.query?.ref || '').trim();
  if (!ref) return res.status(400).json({ erro: 'use ?ref=' });

  try {
    const regras = await lerRegras();
    const hoje = new Date();

    // 1) estoque da fábrica (Bling Exitus) por cor+tamanho
    const { data: estoque } = await supabase.from('bling_estoque')
      .select('cor_label, cor_norm, tam, qtd, bling_sku, bling_produto_id')
      .in('ref', [refNorm(ref), String(ref).padStart(5, '0')]);

    // 2) venda: 14 dias e os 14 anteriores (tendência)
    const [v14, v28] = await Promise.all([vendaPorSku(ref, 14), vendaPorSku(ref, 28)]);

    // 3) estoque atual no Full (ML Exitus) por SKU
    const fullPorSku = {};
    try {
      const token = await getValidToken('Exitus');
      const h = { Authorization: `Bearer ${token}` };
      const me = await (await fetch('https://api.mercadolibre.com/users/me', { headers: h })).json();
      // anúncios Full que carregam os SKUs desta REF
      for (const e of (estoque || [])) {
        if (!e.bling_sku) continue;
        const b = await (await fetch(
          `https://api.mercadolibre.com/users/${me.id}/items/search?seller_sku=${encodeURIComponent(e.bling_sku)}&logistic_type=fulfillment`,
          { headers: h })).json();
        const itemId = (b?.results || [])[0];
        if (!itemId) continue;
        const it = await (await fetch(`https://api.mercadolibre.com/items/${itemId}`, { headers: h })).json();
        const varSku = (it.variations || []).find(v =>
          String(v.seller_custom_field || '') === e.bling_sku
          || (v.attributes || []).some(a => a.id === 'SELLER_SKU' && String(a.value_name) === e.bling_sku));
        const invId = varSku?.inventory_id || it.inventory_id;
        if (!invId) continue;
        const est = await (await fetch(`https://api.mercadolibre.com/inventories/${invId}/stock/fulfillment`, { headers: h })).json();
        fullPorSku[e.bling_sku] = { qtd: n(est?.available_quantity), inventory_id: invId };
        await new Promise(r => setTimeout(r, 120));
      }
    } catch (e) { /* segue sem o Full: a tela avisa */ }

    // 4) corte chegando (Oficinas) — quantas peças e em quantos dias
    const { data: cortes } = await supabase.from('ordens_corte')
      .select('ref, cores, status, created_at, data_entrega')
      .in('ref', [refNorm(ref), String(ref).padStart(5, '0')])
      .neq('status', 'cancelado').order('created_at', { ascending: false }).limit(6);

    // 5) já enviado e ainda em trânsito (não conta duas vezes)
    const { data: transito } = await supabase.from('full_decisoes')
      .select('cor, tam, qtd_enviada, remessa_id, full_remessas!inner(status)')
      .eq('ref', refNorm(ref)).eq('full_remessas.status', 'em_transito');
    const emTransitoPorSku = {};
    for (const t of (transito || [])) {
      emTransitoPorSku[`${chaveCor(t.cor)}|${String(t.tam).toUpperCase()}`] = n(t.qtd_enviada);
    }

    // 6) trava de 72h (o que a Cris já confirmou nesta semana)
    const { data: travas } = await supabase.from('full_travas')
      .select('cor, tam, tipo, qtd, vence_em')
      .eq('ref', refNorm(ref)).is('usada_em', null).gt('vence_em', new Date().toISOString());

    // ── monta as linhas ──
    const linhas = [];
    for (const e of (estoque || [])) {
      const k = `${chaveCor(e.cor_label || e.cor_norm)}|${String(e.tam).toUpperCase()}`;
      const vendaDia = (v14[k] || 0) / 14;
      const vendaAnterior = Math.max(0, (v28[k] || 0) - (v14[k] || 0)) / 14;
      const tendencia = vendaAnterior > 0 ? ((vendaDia - vendaAnterior) / vendaAnterior) * 100 : (vendaDia > 0 ? 100 : 0);

      const noFull = fullPorSku[e.bling_sku];
      const corte = (cortes || []).find(c => (c.cores || []).some(x => chaveCor(x.nome) === chaveCor(e.cor_label)));
      const diasAteCorte = corte?.data_entrega
        ? Math.max(0, Math.ceil((new Date(corte.data_entrega) - hoje) / 86400000)) : 99;

      const linha = calcularLinha({
        cor: e.cor_label || e.cor_norm, tam: e.tam,
        vendaDia,
        estoqueFull: n(noFull?.qtd),
        estoqueFabrica: n(e.qtd),
        emTransito: n(emTransitoPorSku[k]),
        corteChegando: corte ? 1 : 0,
        diasAteCorte,
        jaNoFull: !!noFull,
      }, regras, hoje);

      const trava = (travas || []).find(t => chaveCor(t.cor) === chaveCor(e.cor_label) && String(t.tam).toUpperCase() === String(e.tam).toUpperCase());
      linhas.push({
        ...linha, sku: e.bling_sku,
        tendencia_pct: Math.round(tendencia),
        ja_no_full: !!noFull,
        travado: trava ? { tipo: trava.tipo, qtd: trava.qtd, vence_em: trava.vence_em } : null,
        qtd_enviar: trava?.tipo === 'fora_da_semana' ? 0 : (trava?.qtd ?? linha.qtd_sugerida),
      });
    }

    // ordena: quem mais precisa primeiro
    linhas.sort((a, b) => (b.qtd_sugerida - a.qtd_sugerida) || String(a.cor).localeCompare(String(b.cor)) || String(a.tam).localeCompare(String(b.tam)));

    return res.status(200).json({
      ref: refNorm(ref),
      regras: { cobertura: n(regras.cobertura_dias), basicas: n(regras.cobertura_basicas), transito: n(regras.transito_dias) },
      total_sugerido: linhas.reduce((s, l) => s + n(l.qtd_enviar), 0),
      linhas,
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
