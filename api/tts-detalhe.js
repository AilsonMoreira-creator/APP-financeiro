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

    const vendasLiq = (linhas || []).filter(l => n(l.venda) > 0);
    const devolucoes = (linhas || []).filter(l => n(l.venda) <= 0);

    const soma = (arr, f) => r2(arr.reduce((t, l) => t + f(l), 0));
    const fin = {
      venda: soma(vendasLiq, l => n(l.venda)),
      desconto_vendedor: soma(vendasLiq, l => n(l.desconto_vendedor)),
      desconto_plataforma: soma(vendasLiq, l => n(l.desconto_plataforma)),
      comissao: soma(vendasLiq, l => n(l.comissao_plataforma)),
      afiliado_creator: soma(vendasLiq, l => Math.abs(n(l.bruto?.affiliate_commission_amount))),
      afiliado_ads: soma(vendasLiq, l => Math.abs(n(l.bruto?.affiliate_ads_commission_amount)) + Math.abs(n(l.bruto?.affiliate_partner_commission_amount))),
      taxa_transacao: soma(vendasLiq, l => n(l.taxa_transacao)),
      frete_real: soma(vendasLiq, l => n(l.frete_real)),
      frete_cliente: soma(vendasLiq, l => n(l.frete_cobrado_cliente)),
      subsidio_frete: soma(vendasLiq, l => n(l.subsidio_frete)),
      recebido: soma(vendasLiq, l => n(l.settlement)),
    };
    // "outra despesa se aparecer": o que o settlement não explica pelas linhas
    fin.outros_ajustes = r2(fin.recebido - (fin.venda - fin.desconto_plataforma - fin.comissao
      - fin.afiliado_creator - fin.afiliado_ads - fin.taxa_transacao
      - fin.frete_real + fin.frete_cliente + fin.subsidio_frete));

    const dev = {
      qtd: devolucoes.length,
      estorno_cliente: soma(devolucoes, l => n(l.reembolsos)),
      frete_reverso: soma(devolucoes, l => n(l.frete_real)),
      total_debitado: soma(devolucoes, l => n(l.settlement)),
    };

    // canais (identificáveis só após liquidar)
    const canais = { organico: { pedidos: 0, vendas: 0, comissao: 0 },
      afiliado: { pedidos: 0, vendas: 0, comissao: 0 },
      afiliado_ads: { pedidos: 0, vendas: 0, comissao: 0 } };
    for (const l of vendasLiq) {
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
    const prazos = vendasLiq
      .filter(l => l.data_pedido && l.data_repasse)
      .map(l => (new Date(l.data_repasse) - new Date(l.data_pedido)) / 86400000);
    const { data: dep30 } = await supabase.from('tts_repasse')
      .select('settlement, order_id, venda').gt('venda', 0)
      .gte('data_repasse', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));

    const liquidacao = {
      liquidados: idsLiquidados.size,
      recebido: fin.recebido,
      em_aberto: emAbertoIds.length,
      em_aberto_vendas: r2(vendasEmAberto),
      em_aberto_previsto: r2(vendasEmAberto * ratio),
      ratio_pago_pct: r2(ratio * 100),
      prazo_medio_dias: prazos.length ? Math.round(prazos.reduce((a, b) => a + b, 0) / prazos.length) : null,
      depositado_30d: r2((dep30 || []).reduce((t, x) => t + n(x.settlement), 0)),
      depositado_30d_pedidos: (dep30 || []).length,
    };

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
