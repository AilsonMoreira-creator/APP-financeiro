/**
 * tts-detalhe.js — dados da tela "Detalhar" do card TikTok (Ailson 09/08/2026).
 *
 * GET /api/tts-detalhe?janela=mes|30|60|90   (admin, X-User)
 *
 * Junta duas fontes:
 *  · API de pedidos do TikTok (ao vivo) — contagem, status, amostras
 *    (is_sample_order), cancelados, estados de entrega e top produtos;
 *  · tts_repasse (sincronizada 2x/dia) — o lado financeiro: liquidação,
 *    decomposição de despesas, devoluções e canais (orgânico × afiliado ×
 *    afiliado ads — a API do TikTok NÃO separa live de vitrine, então
 *    "orgânico" cobre os dois).
 *
 * O "em aberto" usa o ratio médio de pedido pago (settlement/venda, 90 dias),
 * o mesmo da view v3.5.
 */
import { supabase, validarAdmin, setCors } from './_ia-helpers.js';
import { authTts, chamarTts } from './_tts-api.js';

export const config = { maxDuration: 300 };
const n = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const r2 = (x) => Math.round(x * 100) / 100;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const admin = await validarAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });
  if (admin.user?.admin !== true) return res.status(403).json({ error: 'Acesso restrito a admin' });

  const conta = String(req.query?.conta || 'exitus').toLowerCase();
  const janela = String(req.query?.janela || 'mes');

  const agora = new Date();
  let iniDate;
  if (janela === 'mes') iniDate = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1));
  else iniDate = new Date(Date.now() - Math.min(90, parseInt(janela) || 30) * 86400000);
  const ini = Math.floor(iniDate.getTime() / 1000);
  const fim = Math.floor(Date.now() / 1000);
  const iniIso = iniDate.toISOString().slice(0, 10);

  const a = await authTts(conta);
  if (a.erro) return res.status(400).json(a);
  const { auth, ctx } = a;

  try {
    // ── 1. pedidos ao vivo da API ────────────────────────────────────────────
    let token = null, ids = [];
    for (let p = 0; p < 20; p++) {
      const pg = await chamarTts('/order/202309/orders/search',
        { page_size: '50', ...(token ? { page_token: token } : {}) }, auth, ctx,
        { method: 'POST', body: { create_time_ge: ini, create_time_lt: fim } });
      if (pg?.code !== 0) return res.status(400).json({ etapa: 'search', resposta: pg });
      (pg.data?.orders || []).forEach(o => ids.push(o.id));
      token = pg.data?.next_page_token;
      if (!token) break;
    }

    const pedidos = [];
    for (let i = 0; i < ids.length; i += 50) {
      const det = await chamarTts('/order/202309/orders', { ids: ids.slice(i, i + 50).join(',') }, auth, ctx);
      if (det?.code === 0) (det.data?.orders || []).forEach(o => pedidos.push(o));
    }

    const resumo = {
      pedidos_total: pedidos.length, cancelados: 0, amostras: 0,
      pagaveis: 0, unidades: 0, vendas: 0,
    };
    const porEstado = {}, porProduto = {}, idsPagaveis = new Set();

    for (const o of pedidos) {
      const cancelado = String(o.status || '').toUpperCase() === 'CANCELLED';
      const amostra = o.is_sample_order === true;
      if (cancelado) { resumo.cancelados++; continue; }
      if (amostra) { resumo.amostras++; continue; }
      resumo.pagaveis++;
      idsPagaveis.add(String(o.id));
      const uf = (o.recipient_address?.district_info || []).find(d => d.address_level === 'L1')?.address_name;
      if (uf) porEstado[uf] = (porEstado[uf] || 0) + 1;
      for (const it of (o.line_items || [])) {
        resumo.unidades++;
        const v = n(it.sale_price);
        resumo.vendas += v;
        const nome = String(it.product_name || 'sem nome').slice(0, 60);
        porProduto[nome] = porProduto[nome] || { un: 0, vendas: 0 };
        porProduto[nome].un++;
        porProduto[nome].vendas += v;
      }
    }
    resumo.vendas = r2(resumo.vendas);
    resumo.ticket_medio = resumo.pagaveis ? r2(resumo.vendas / resumo.pagaveis) : 0;

    // ── 2. lado financeiro (tts_repasse) ─────────────────────────────────────
    const { data: linhas, error } = await supabase.from('tts_repasse')
      .select('*').eq('conta', conta).gte('data_pedido', iniIso);
    if (error) throw new Error(error.message);

    // Uma venda devolvida ANTES de liquidar vem numa linha só: venda cheia +
    // gross_sales_refund igual e settlement 0. Isso NÃO é venda paga — é
    // devolução (descoberto em 09/08: era a maior parte do "outros").
    const vendaLiqDe = (l) => n(l.venda) + n(l.bruto?.gross_sales_refund_amount);
    const vendasLiq = (linhas || []).filter(l => n(l.venda) > 0 && vendaLiqDe(l) > 0.01);
    const devolvidasNaLinha = (linhas || []).filter(l => n(l.venda) > 0 && vendaLiqDe(l) <= 0.01);
    const devolucoes = (linhas || []).filter(l => n(l.venda) <= 0);

    const soma = (arr, f) => r2(arr.reduce((t, l) => t + f(l), 0));
    const fin = {
      // venda JA LIQUIDA de devolucoes (refund parcial abatido linha a linha)
      venda: soma(vendasLiq, l => vendaLiqDe(l)),
      desconto_vendedor: soma(vendasLiq, l => n(l.desconto_vendedor)),
      desconto_plataforma: soma(vendasLiq, l => n(l.desconto_plataforma)),
      comissao: soma(vendasLiq, l => n(l.comissao_plataforma)),
      afiliado_creator: soma(vendasLiq, l => Math.abs(n(l.bruto?.affiliate_commission_amount))),
      afiliado_ads: soma(vendasLiq, l => Math.abs(n(l.bruto?.affiliate_ads_commission_amount)) + Math.abs(n(l.bruto?.affiliate_partner_commission_amount))),
      taxa_transacao: soma(vendasLiq, l => n(l.taxa_transacao)),
      frete_real: soma(vendasLiq, l => n(l.frete_real)),
      frete_cliente: soma(vendasLiq, l => n(l.frete_cobrado_cliente)),
      subsidio_frete: soma(vendasLiq, l => n(l.subsidio_frete)),
      // o que o TikTok DEBITA de frete (shipping_fee_amount) já vem líquido do
      // subsídio dele e inclui a taxa fixa por item
      frete_debitado: soma(vendasLiq, l => Math.abs(n(l.bruto?.shipping_fee_amount))),
      recebido: soma(vendasLiq, l => n(l.settlement)),
    };
    // Aritmética PROVADA nos statements (09/08): settlement = (venda − desconto
    // do vendedor) − taxas. O desconto DA PLATAFORMA fica FORA — o TikTok banca.
    // O resíduo abaixo é o que os campos nomeados não explicam; medido em 09/08,
    // é POSITIVO e bate com o FRETE PAGO PELO CLIENTE (que o TikTok repassa)
    // mais tarifas/subsídios miúdos — por isso a linha se chama assim na tela.
    fin.frete_cliente_e_ajustes = r2(fin.recebido - (fin.venda - fin.desconto_vendedor - fin.comissao
      - fin.afiliado_creator - fin.afiliado_ads - fin.taxa_transacao - fin.frete_debitado));

    const todasDev = [...devolucoes, ...devolvidasNaLinha];
    const refundParcial = soma(vendasLiq, l => Math.abs(n(l.bruto?.gross_sales_refund_amount)));
    const dev = {
      qtd: todasDev.length,
      valor_devolvido: r2(soma(devolvidasNaLinha, l => n(l.venda)) + refundParcial),
      estorno_cliente: soma(todasDev, l => n(l.reembolsos)),
      frete_reverso: soma(todasDev, l => n(l.frete_real)),
      // o que sai do bolso de verdade com devolucao (settlement negativo)
      total_debitado: soma(todasDev, l => n(l.settlement)),
    };
    fin.devolucoes_debito = r2(Math.abs(Math.min(dev.total_debitado, 0)));

    // canais (identificáveis só após liquidar)
    const canais = { organico: { pedidos: 0, vendas: 0, comissao: 0 },
      afiliado: { pedidos: 0, vendas: 0, comissao: 0 },
      afiliado_ads: { pedidos: 0, vendas: 0, comissao: 0 } };
    for (const l of vendasLiq) {
      // (devolvidas na propria linha ficam fora dos canais e das vendas pagas)
      const ads = Math.abs(n(l.bruto?.affiliate_ads_commission_amount)) + Math.abs(n(l.bruto?.affiliate_partner_commission_amount));
      const cre = Math.abs(n(l.bruto?.affiliate_commission_amount));
      const c = ads > 0 ? canais.afiliado_ads : (cre > 0 ? canais.afiliado : canais.organico);
      c.pedidos++; c.vendas = r2(c.vendas + n(l.venda)); c.comissao = r2(c.comissao + ads + cre);
    }

    // liquidação: pagos × em aberto, depósitos 30d, prazo médio
    const idsLiquidados = new Set(vendasLiq.map(l => String(l.order_id)));
    const emAbertoIds = [...idsPagaveis].filter(id => !idsLiquidados.has(id));
    let vendasEmAberto = 0;
    for (const o of pedidos) {
      if (!emAbertoIds.includes(String(o.id))) continue;
      for (const it of (o.line_items || [])) vendasEmAberto += n(it.sale_price);
    }
    let ratio = 0.727;
    {
      const { data: rr } = await supabase.from('tts_repasse')
        .select('venda, settlement').gt('venda', 0)
        .gte('data_pedido', new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
      if (rr?.length) {
        const sv = rr.reduce((t, x) => t + n(x.venda), 0);
        const ss = rr.reduce((t, x) => t + n(x.settlement), 0);
        if (sv > 0) ratio = ss / sv;
      }
    }
    // prazo médio SEMPRE dos últimos 90 dias (estável mesmo com a janela "mês",
    // que no começo do mês não tem nada liquidado)
    const { data: pz } = await supabase.from('tts_repasse')
      .select('data_pedido, data_repasse').gt('venda', 0)
      .gte('data_pedido', new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
    const prazos = (pz || [])
      .filter(l => l.data_pedido && l.data_repasse)
      .map(l => (new Date(l.data_repasse) - new Date(l.data_pedido)) / 86400000);
    const { data: dep30 } = await supabase.from('tts_repasse')
      .select('settlement, order_id, venda').gt('venda', 0)
      .gte('data_repasse', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));

    // liquidação em atraso: pedido em aberto há mais de 30% além do prazo médio
    const prazoMedio = prazos.length ? prazos.reduce((a, b) => a + b, 0) / prazos.length : null;
    const limiteAtraso = prazoMedio ? prazoMedio * 1.3 : null;
    let atrasoQtd = 0, atrasoVendas = 0;
    if (limiteAtraso) {
      for (const o of pedidos) {
        if (!emAbertoIds.includes(String(o.id))) continue;
        const idadeDias = (Date.now() / 1000 - n(o.create_time)) / 86400;
        if (idadeDias > limiteAtraso) {
          atrasoQtd++;
          for (const it of (o.line_items || [])) atrasoVendas += n(it.sale_price);
        }
      }
    }

    // ── previsto DETALHADO pela régua validada (Ailson 11/08: comissão 6% ·
    // frete 6% + R$6/pedido − o que o cliente pagou · afiliado pela média
    // real). O TikTok não expõe as deduções antes do repasse (rotas testadas:
    // respondem vazias até liquidar) — então prevemos linha a linha e o
    // statement confirma. Régua conferida nos liquidados: 6,02% exato.
    // ── PREVISTO OFICIAL DO TIKTOK (12/08, path trazido pelo Ailson): GET
    // /finance/202507/orders/unsettled devolve por pedido o est_settlement_
    // amount, breakdown de comissão (platform + sfp = a taxa fixa de R$ 6 da
    // régua dele, nomeada!), afiliados, frete e o motivo de não ter liquidado.
    // A régua interna vira RESERVA só pros pedidos que ainda não apareceram lá
    const estOficial = {};
    {
      let pt = null;
      for (let pg = 0; pg < 8; pg++) {
        const q = { page_size: 50, sort_field: 'order_create_time' };
        if (pt) q.page_token = pt;
        const u = await chamarTts('/finance/202507/orders/unsettled', q, auth, ctx).catch(() => null);
        if (!u || u.code !== 0) break;
        for (const t of (u.data?.transactions || [])) {
          if (t.type !== 'ORDER' || !t.order_id) continue;
          const fee = t.fee_tax_breakdown?.fee || {};
          const rb = t.revenue_breakdown || {};
          const sub = Math.abs(n(rb.subtotal_before_discount_amount));
          const descS = Math.abs(n(rb.seller_discount_amount));
          const receita = sub > 0 ? r2(sub - descS) : n(t.est_revenue_amount);
          // 12/08 (ele pegou): (1) o TOTAL oficial de taxas traz componentes
          // além dos campos nomeados — usar est_fee_tax_amount inteiro, não a
          // soma de campos escolhidos ("comissão está ficando menor");
          // (2) est_shipping_cost vem 0 até o TikTok apurar (perto da
          // entrega) — o líquido oficial vem INFLADO nesses; entra o piso da
          // régua (6% − pago pelo cliente) e o líquido corrige junto
          const afil = Math.abs(n(fee.affiliate_commission_amount)) + Math.abs(n(fee.affiliate_ads_commission_amount)) + Math.abs(n(fee.affiliate_partner_commission_amount));
          const feeTotal = Math.abs(n(t.est_fee_tax_amount));
          let frete = Math.abs(n(t.est_shipping_cost_amount));
          let liq = n(t.est_settlement_amount);
          if (frete < 0.01) {
            const freteCli = Math.abs(n(t.shipping_cost_breakdown?.customer_paid_shipping_fee_amount));
            const freteRegua = r2(Math.max(0, 0.06 * receita - freteCli));
            frete = freteRegua;
            liq = r2(liq - freteRegua);
          }
          estOficial[t.order_id] = {
            liquido: liq,
            receita,
            desconto: descS,
            comissao: r2(Math.max(0, feeTotal - afil)),
            afiliado: afil,
            frete,
            quando: t.estimated_settlement || null,
          };
        }
        pt = u.data?.next_page_token;
        if (!pt) break;
      }
    }

    const prev = { base: 0, frete_cliente: 0, pedidos: 0, desconto: 0 };
    const ofc = { pedidos: 0, liquido: 0, receita: 0, comissao: 0, afiliado: 0, frete: 0, desconto: 0 };
    const vendaAbPorId = {}; // venda líquida por pedido aberto (pro CMV proporcional)
    for (let i = 0; i < emAbertoIds.length; i += 50) {
      const det = await chamarTts('/order/202309/orders', { ids: emAbertoIds.slice(i, i + 50).join(',') }, auth, ctx);
      for (const o of (det?.data?.orders || [])) {
        if (String(o.status || '').toUpperCase() === 'CANCELLED') continue;
        const oid = String(o.id);
        const of2 = estOficial[oid];
        if (of2) {
          ofc.pedidos++; ofc.liquido += of2.liquido; ofc.receita += of2.receita;
          ofc.comissao += of2.comissao; ofc.afiliado += of2.afiliado; ofc.frete += of2.frete;
          ofc.desconto += of2.desconto;
          vendaAbPorId[oid] = of2.receita;
          continue;
        }
        prev.pedidos++;
        const baseLiq = n(o.payment?.original_total_product_price) - n(o.payment?.seller_discount);
        prev.base += baseLiq;
        prev.desconto += n(o.payment?.seller_discount);
        prev.frete_cliente += n(o.payment?.shipping_fee);
        vendaAbPorId[oid] = baseLiq;
      }
    }
    let comissaoPct = 0.0602, afiliadoPct = 0.03;
    {
      const { data: rg } = await supabase.from('tts_repasse')
        .select('venda, comissao_plataforma, comissao_afiliado').gt('venda', 0)
        .gte('data_pedido', new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
      const sv = (rg || []).reduce((t, x) => t + n(x.venda), 0);
      if (sv > 0) {
        comissaoPct = (rg || []).reduce((t, x) => t + Math.abs(n(x.comissao_plataforma)), 0) / sv;
        afiliadoPct = (rg || []).reduce((t, x) => t + Math.abs(n(x.afiliado ?? x.comissao_afiliado)), 0) / sv;
      }
    }
    // régua SÓ pros pedidos sem dado oficial; oficial entra por cima
    const prevComissao = r2(prev.base * comissaoPct + ofc.comissao);
    const prevFrete = r2(Math.max(0, prev.base * 0.06 + 6 * prev.pedidos - prev.frete_cliente) + ofc.frete);
    const prevAfiliado = r2(prev.base * afiliadoPct + ofc.afiliado);
    const prevLiquido = r2((prev.base - prev.base * comissaoPct - Math.max(0, prev.base * 0.06 + 6 * prev.pedidos - prev.frete_cliente) - prev.base * afiliadoPct) + ofc.liquido);
    prev.base = r2(prev.base + ofc.receita);
    prev.pedidos = prev.pedidos + ofc.pedidos;

    const liquidacao = {
      liquidados: idsLiquidados.size,
      recebido: fin.recebido,
      em_aberto: emAbertoIds.length,
      em_aberto_vendas: r2(vendasEmAberto),
      em_aberto_previsto: prev.pedidos > 0 ? prevLiquido : r2(vendasEmAberto * ratio),
      previsto_detalhe: prev.pedidos > 0 ? {
        base: r2(prev.base), pedidos: prev.pedidos,
        comissao: prevComissao, comissao_pct: r2(comissaoPct * 100),
        frete: prevFrete, frete_cliente: r2(prev.frete_cliente),
        afiliado: prevAfiliado, afiliado_pct: r2(afiliadoPct * 100),
        liquido: prevLiquido,
        oficial_pedidos: ofc.pedidos, oficial_liquido: r2(ofc.liquido),
        regua_pedidos: prev.pedidos - ofc.pedidos,
      } : null,
      ratio_pago_pct: r2(ratio * 100),
      prazo_medio_dias: prazoMedio != null ? Math.round(prazoMedio) : null,
      atraso_limite_dias: limiteAtraso != null ? Math.round(limiteAtraso) : null,
      em_atraso: atrasoQtd,
      em_atraso_vendas: r2(atrasoVendas),
      depositado_30d: r2((dep30 || []).reduce((t, x) => t + n(x.settlement), 0)),
      depositado_30d_pedidos: (dep30 || []).length,
    };

    // ── CMV das vendas liquidadas (custo via Bling numero_pedido_loja → ref) ─
    const cmv = { exato: 0, un_com_custo: 0, estimado: 0, vendas_sem_vinculo: 0 };
    if (idsLiquidados.size) {
      const { data: blg } = await supabase.from('bling_vendas_detalhe')
        .select('numero_pedido_loja, itens')
        .in('numero_pedido_loja', [...idsLiquidados].slice(0, 300));
      const refs = new Set(); const linhasB = []; const matcheados = new Set();
      for (const b of (blg || [])) {
        matcheados.add(String(b.numero_pedido_loja));
        for (const it of (b.itens || [])) {
          const ref = String(it.ref || '').replace(/^0+/, '');
          const un = Number(it.quantidade) || 0;
          if (ref && un > 0) { refs.add(ref); linhasB.push({ ref, un }); }
        }
      }
      const custos = {};
      if (refs.size) {
        const { data: cs } = await supabase.from('vw_calc_custos')
          .select('ref_norm, custo_producao').in('ref_norm', [...refs]);
        (cs || []).forEach(c => { custos[c.ref_norm] = Number(c.custo_producao) || 0; });
      }
      for (const l of linhasB) {
        if (custos[l.ref] > 0) { cmv.exato += custos[l.ref] * l.un; cmv.un_com_custo += l.un; }
      }
      // liquidadas sem vínculo no Bling (meses sem backfill): estima pela
      // proporção custo/venda das que têm custo — e diz isso na tela
      let vendaMatch = 0, vendaSem = 0;
      for (const l of vendasLiq) {
        if (matcheados.has(String(l.order_id))) vendaMatch += n(l.venda);
        else { vendaSem += n(l.venda); cmv.vendas_sem_vinculo++; }
      }
      if (vendaSem > 0 && vendaMatch > 0 && cmv.exato > 0) {
        cmv.estimado = r2(cmv.exato / vendaMatch * vendaSem);
      }
      cmv.exato = r2(cmv.exato);
    }
    cmv.total = r2(cmv.exato + cmv.estimado);

    // régua do Ailson: imposto 11% + agência 5% sobre a venda — agora sobre a
    // venda LIQUIDA de devoluções (venda devolvida não gera imposto)
    fin.imposto = r2(fin.venda * 0.11);
    fin.agencia = r2(fin.venda * 0.05);
    fin.liquido_pos_imposto = r2(fin.recebido - fin.devolucoes_debito - fin.imposto - fin.agencia);
    fin.cmv = cmv;
    // custo de operação: R$ 5 fixos por UNIDADE vendida (Ailson 10/08) —
    // unidades exatas do vínculo Bling + 1/venda pros sem vínculo
    fin.custo_operacao_un = cmv.un_com_custo + cmv.vendas_sem_vinculo;
    fin.custo_operacao = r2(5 * fin.custo_operacao_un);
    fin.resultado_final = r2(fin.liquido_pos_imposto - cmv.total - fin.custo_operacao);

    // ── DRE DO MÊS COMPLETO = liquidado (real) + em aberto (régua validada) ──
    // (Ailson 12/08: "preciso dos dados gerais do mês, não recorte esperando o
    // futuro"). A parte prevista usa a régua conferida nos repasses; quando a
    // rota Unsettled Transactions do TikTok abrir, ela assume o lugar
    if (prev.pedidos > 0) {
      const mc = { previsto: {} };
      // VENDA LÍQUIDA DOS DESCONTOS DELE nas duas pontas (12/08, pergunta
      // dele confirmada): liquidado entra venda − desconto_vendedor; abertos
      // já vêm líquidos (subtotal − desconto no oficial; payment na régua)
      const vendaLiqReal = r2(fin.venda - Math.abs(fin.desconto_vendedor || 0));
      mc.venda_total = r2(vendaLiqReal + prev.base);
      mc.descontos_abatidos = r2(Math.abs(fin.desconto_vendedor || 0) + ofc.desconto + prev.desconto);
      mc.pct_real = r2(100 * vendaLiqReal / (mc.venda_total || 1));
      // CMV e unidades dos pedidos em aberto via Bling (mesmo caminho do real)
      let cmvAb = 0, unAb = 0, semVinc = 0;
      {
        const { data: blg2 } = await supabase.from('bling_vendas_detalhe')
          .select('numero_pedido_loja, itens').in('numero_pedido_loja', emAbertoIds.slice(0, 300));
        const refs2 = new Set(); const linhas2 = []; const match2 = new Set();
        for (const b of (blg2 || [])) {
          match2.add(String(b.numero_pedido_loja));
          for (const it of (b.itens || [])) {
            const ref = String(it.ref || '').replace(/^0+/, '');
            const un = Number(it.quantidade) || 0;
            if (ref && un > 0) { refs2.add(ref); linhas2.push({ ref, un }); }
          }
        }
        const custos2 = {};
        if (refs2.size) {
          const { data: cs2 } = await supabase.from('vw_calc_custos')
            .select('ref_norm, custo_producao').in('ref_norm', [...refs2]);
          (cs2 || []).forEach(c => { custos2[c.ref_norm] = Number(c.custo_producao) || 0; });
        }
        for (const l of linhas2) { if (custos2[l.ref] > 0) { cmvAb += custos2[l.ref] * l.un; unAb += l.un; } }
        semVinc = Math.max(0, prev.pedidos - match2.size);
        // pedidos abertos SEM vínculo no Bling entravam com CMV ZERO e
        // diluíam o % do mês (o 37% que ele pegou) — agora estimam pela
        // proporção custo/venda das liquidadas
        let vendaSemVinc = 0;
        for (const [oid, v] of Object.entries(vendaAbPorId)) {
          if (!match2.has(oid)) vendaSemVinc += n(v);
        }
        const pctLiq = fin.venda > 0 && cmv.total > 0 ? cmv.total / fin.venda : 0.42;
        mc.cmv_estimado_abertos = r2(vendaSemVinc * pctLiq);
        cmvAb += vendaSemVinc * pctLiq;
      }
      mc.cmv_total = r2(cmv.total + cmvAb);
      const unTotal = fin.custo_operacao_un + unAb + semVinc;
      mc.custo_operacao = r2(5 * unTotal);
      mc.comissao = r2(Math.abs(fin.comissao || 0) + prevComissao);
      mc.afiliados = r2(Math.abs(fin.afiliado_creator || 0) + Math.abs(fin.afiliado_ads || 0) + prevAfiliado);
      mc.frete = r2(Math.abs(fin.frete_debitado || 0) + prevFrete);
      mc.desconto_vendedor = r2(Math.abs(fin.desconto_vendedor || 0));
      mc.recebido = r2(fin.recebido + prevLiquido);
      mc.desconto_plataforma = r2(Math.abs(fin.desconto_plataforma || 0));
      mc.imposto = r2(mc.venda_total * 0.11);
      mc.agencia = r2(mc.venda_total * 0.05);
      mc.resultado_final = r2(mc.recebido - (fin.devolucoes_debito || 0) - mc.imposto - mc.agencia - mc.cmv_total - mc.custo_operacao);
      mc.margem_pct = r2(100 * mc.resultado_final / (mc.venda_total || 1));
      mc.previsto = { venda: r2(prev.base), liquido: prevLiquido, pedidos: prev.pedidos };
      fin.mes_completo = mc;
    }

    return res.status(200).json({
      ok: true, janela, de: iniIso, ate: new Date().toISOString().slice(0, 10),
      resumo, liquidacao, detalhamento: fin, devolucoes: dev, canais,
      estados: Object.entries(porEstado).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([uf, ped]) => ({ uf, pedidos: ped })),
      top_produtos: Object.entries(porProduto).sort((a, b) => b[1].vendas - a[1].vendas).slice(0, 6)
        .map(([nome, d]) => ({ nome, un: d.un, vendas: r2(d.vendas) })),
      nota_canais: 'A API do TikTok não separa live de vitrine — "orgânico" cobre os dois. Canal identificável só após o repasse liquidar.',
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'erro interno' });
  }
}
