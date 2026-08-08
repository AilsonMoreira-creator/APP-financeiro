/**
 * tts-pedidos.js — pedidos REAIS do TikTok Shop (Ailson 08/08/2026).
 *
 * A busca é POST /order/202309/orders/search (a listagem é POST, não GET — foi
 * o que o erro 36009010 "Invalid method" da sondagem mostrou) e o detalhe vem
 * de GET /order/202309/orders?ids=..., que traz o que interessa pro lucro:
 * preço do item, desconto do vendedor x desconto da plataforma e as taxas.
 *
 * ?dias=7  janela  ·  ?limite=N  ·  ?cru=1 devolve a resposta crua
 */
import { authTts, chamarTts } from './_tts-api.js';

export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus').toLowerCase();
  const dias = Math.min(90, Math.max(1, parseInt(req.query?.dias) || 7));
  const limite = Math.min(50, Math.max(1, parseInt(req.query?.limite) || 10));

  const a = await authTts(conta);
  if (a.erro) return res.status(400).json(a);
  const { auth, ctx } = a;

  const fim = Math.floor(Date.now() / 1000);
  const ini = fim - dias * 86400;

  // ?combo=1 -> itens em que os DOIS descontos incidem juntos, pra descobrir se
  // o TikTok separa direito e se a conta é soma simples ou desconto sobre
  // desconto (a suspeita do Ailson: o desconto da plataforma vem POR CIMA do
  // dele). Ailson 08/08/2026.
  if (req.query?.combo === '1') {
    let token = null, ids = [], p = 0;
    while (p < 20) {
      const pg = await chamarTts('/order/202309/orders/search',
        { page_size: '50', ...(token ? { page_token: token } : {}) }, auth, ctx,
        { method: 'POST', body: { create_time_ge: ini, create_time_lt: fim } });
      if (pg?.code !== 0) return res.status(400).json({ etapa: 'search', resposta: pg });
      (pg.data?.orders || []).forEach(o => ids.push(o.id));
      token = pg.data?.next_page_token; p++;
      if (!token) break;
    }
    const linhas = [];
    let soma_bate = 0, soma_nao_bate = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const det = await chamarTts('/order/202309/orders', { ids: ids.slice(i, i + 50).join(',') }, auth, ctx);
      if (det?.code !== 0) continue;
      for (const o of (det.data?.orders || [])) {
        if (String(o.status || '').toUpperCase() === 'CANCELLED') continue;
        for (const it of (o.line_items || [])) {
          const orig = Number(it.original_price) || 0;
          const dv = Number(it.seller_discount) || 0;
          const dp = Number(it.platform_discount) || 0;
          const venda = Number(it.sale_price) || 0;
          if (orig <= 0 || (dv <= 0 && dp <= 0)) continue;
          const bate = Math.abs((orig - dv - dp) - venda) < 0.02;
          bate ? soma_bate++ : soma_nao_bate++;
          if (linhas.length < 30) linhas.push({
            produto: String(it.product_name || '').slice(0, 38), sku: it.seller_sku,
            original: orig, desc_meu: dv, desc_tiktok: dp, vendido: venda,
            conta_bate: bate, pct_meu: Math.round(dv / orig * 100), pct_tiktok: Math.round(dp / orig * 100),
          });
        }
      }
    }
    return res.status(200).json({ ok: true, formula_soma_simples_bate_em: soma_bate, nao_bate: soma_nao_bate, linhas });
  }

  // ?resumo=1 -> percorre TODAS as páginas da janela e devolve a distribuição
  // do desconto DO VENDEDOR e do desconto DA PLATAFORMA por item, em % do preço
  // original. Serve pra conferir se o desconto dele é só 5/10/15% e se todo o
  // resto sai do bolso do TikTok. Amostra grátis (preço 0) fica de fora — o
  // Ailson definiu que brinde não abate lucro. Ailson 08/08/2026.
  if (req.query?.resumo === '1') {
    let token = null, ids = [], paginas = 0;
    while (paginas < 20) {
      const pg = await chamarTts('/order/202309/orders/search',
        { page_size: '50', ...(token ? { page_token: token } : {}) }, auth, ctx,
        { method: 'POST', body: { create_time_ge: ini, create_time_lt: fim } });
      if (pg?.code !== 0) return res.status(400).json({ etapa: 'search', resposta: pg });
      (pg.data?.orders || []).forEach(o => ids.push(o.id));
      token = pg.data?.next_page_token;
      paginas++;
      if (!token) break;
    }

    const porFaixaVend = {}, porFaixaPlat = {};
    let itens = 0, amostras = 0, cancelados = 0;
    let somaOriginal = 0, somaVendido = 0, somaDescVend = 0, somaDescPlat = 0;
    const foraDoPadrao = [];
    const PADRAO = [0, 5, 10, 15];

    for (let i = 0; i < ids.length; i += 50) {
      const det = await chamarTts('/order/202309/orders', { ids: ids.slice(i, i + 50).join(',') }, auth, ctx);
      if (det?.code !== 0) continue;
      for (const o of (det.data?.orders || [])) {
        if (String(o.status || '').toUpperCase() === 'CANCELLED') { cancelados++; continue; }
        for (const it of (o.line_items || [])) {
          const orig = Number(it.original_price) || 0;
          if (orig <= 0) { amostras++; continue; }
          const dv = Number(it.seller_discount) || 0;
          const dp = Number(it.platform_discount) || 0;
          itens++; somaOriginal += orig; somaVendido += Number(it.sale_price) || 0;
          somaDescVend += dv; somaDescPlat += dp;
          const pv = Math.round((dv / orig) * 100), pp = Math.round((dp / orig) * 100);
          porFaixaVend[pv] = (porFaixaVend[pv] || 0) + 1;
          porFaixaPlat[pp] = (porFaixaPlat[pp] || 0) + 1;
          if (!PADRAO.includes(pv) && dv > 0.5 && foraDoPadrao.length < 25) {
            foraDoPadrao.push({ pedido: o.id, sku: it.seller_sku, produto: String(it.product_name || '').slice(0, 45),
              original: orig, vendido: it.sale_price, desc_vendedor: dv, pct: pv });
          }
        }
      }
    }
    return res.status(200).json({
      ok: true, janela_dias: dias, pedidos: ids.length, itens_pagos: itens,
      amostras_gratis_ignoradas: amostras, cancelados,
      total_preco_original: Math.round(somaOriginal * 100) / 100,
      total_vendido: Math.round(somaVendido * 100) / 100,
      desconto_do_vendedor: Math.round(somaDescVend * 100) / 100,
      desconto_da_plataforma: Math.round(somaDescPlat * 100) / 100,
      pct_vendedor: Math.round((somaDescVend / somaOriginal) * 1000) / 10,
      pct_plataforma: Math.round((somaDescPlat / somaOriginal) * 1000) / 10,
      faixas_desconto_vendedor: porFaixaVend,
      faixas_desconto_plataforma: porFaixaPlat,
      fora_do_padrao_5_10_15: foraDoPadrao,
    });
  }

  const lista = await chamarTts('/order/202309/orders/search',
    { page_size: String(limite) }, auth, ctx,
    { method: 'POST', body: { create_time_ge: ini, create_time_lt: fim } });

  if (lista?.code !== 0) return res.status(400).json({ etapa: 'search', resposta: lista });
  const ids = (lista.data?.orders || []).map(o => o.id).slice(0, limite);
  if (!ids.length) return res.status(200).json({ ok: true, pedidos: 0, aviso: 'nenhum pedido na janela', total: lista.data?.total_count });

  const det = await chamarTts('/order/202309/orders', { ids: ids.join(',') }, auth, ctx);
  if (req.query?.cru === '1') return res.status(200).json({ busca: lista, detalhe: det });
  if (det?.code !== 0) return res.status(400).json({ etapa: 'detalhe', resposta: det });

  const pedidos = (det.data?.orders || []).map(o => ({
    id: o.id, status: o.status,
    criado: o.create_time ? new Date(o.create_time * 1000).toISOString().slice(0, 16) : null,
    total_pago: o.payment?.total_amount,
    subtotal: o.payment?.sub_total,
    frete: o.payment?.shipping_fee,
    desconto_vendedor: o.payment?.seller_discount,
    desconto_plataforma: o.payment?.platform_discount,
    itens: (o.line_items || []).map(i => ({
      sku: i.seller_sku, nome: i.product_name,
      preco_original: i.original_price, preco_vendido: i.sale_price,
      desc_vendedor: i.seller_discount, desc_plataforma: i.platform_discount,
    })),
  }));
  return res.status(200).json({ ok: true, total_na_janela: lista.data?.total_count, pedidos });
}
