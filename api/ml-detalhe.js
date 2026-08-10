/**
 * ml-detalhe.js — dados da tela "Detalhar" do card Mercado Livre no OS Amícia
 * (Ailson 10/08/2026). SOMA AS 3 CONTAS (Exitus, Lumia, Muniam).
 *
 * GET /api/ml-detalhe?janela=mes|30|60|90   (admin, X-User)
 *
 * Fonte: ml_pedido_taxas (alimentada pelo ml-taxas-sync 3x/dia + completar).
 * Regra dele (10/08): o DRE usa o líquido JÁ DEFINIDO no Mercado Pago
 * (net_recebido, conhecido na aprovação) — NÃO espera a liberação; o
 * money_release serve pra CONFIRMAR os repasses (seção própria).
 * Imposto 11% sobre a venda; SEM agência (os 5% são só do TikTok).
 */
import { supabase, validarAdmin, setCors } from './_ia-helpers.js';

export const config = { maxDuration: 120 };
const n = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
const r2 = (x) => Math.round(x * 100) / 100;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const admin = await validarAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });
  if (admin.user?.admin !== true) return res.status(403).json({ error: 'Acesso restrito a admin' });

  const janela = String(req.query?.janela || 'mes');
  const hojeBrt = new Date(Date.now() - 3 * 3600000);
  const ini = janela === 'mes'
    ? `${hojeBrt.toISOString().slice(0, 7)}-01`
    : new Date(Date.now() - Math.min(90, parseInt(janela) || 30) * 86400000).toISOString().slice(0, 10);

  try {
    // pagina a janela inteira (mês pode passar de 1000 linhas)
    const rows = [];
    for (let off = 0; off < 5000; off += 1000) {
      const { data, error } = await supabase.from('ml_pedido_taxas')
        .select('conta, pedido_id, data_pedido, preco_produtos, full_price, sale_fee, desconto_vendedor, desconto_plataforma, status_ml, itens, net_recebido, release_date, release_status, pago_em, frete_vendedor, frete_comprador, logistic_type')
        .gte('data_pedido', ini).range(off, off + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }

    const cancelado = (r) => ['cancelled', 'invalid'].includes(String(r.status_ml || ''));
    const validos = rows.filter(r => !cancelado(r));
    const cancelados = rows.filter(cancelado);

    // ── resumo de vendas (3 contas somadas + quebra) ─────────────────────────
    const resumo = { pedidos: validos.length, unidades: 0, vendas: 0, cancelados: cancelados.length };
    const porConta = {}, porLog = {};
    for (const r of validos) {
      const un = (r.itens || []).reduce((t, i) => t + n(i.qtd), 0) || 1;
      resumo.unidades += un;
      resumo.vendas += n(r.preco_produtos);
      const c = porConta[r.conta] || (porConta[r.conta] = { pedidos: 0, vendas: 0 });
      c.pedidos++; c.vendas = r2(c.vendas + n(r.preco_produtos));
      const lg = r.logistic_type === 'fulfillment' ? 'full'
        : r.logistic_type === 'self_service' ? 'flex'
        : r.logistic_type ? 'outros' : 'sem_dado';
      const l = porLog[lg] || (porLog[lg] = { pedidos: 0, vendas: 0 });
      l.pedidos++; l.vendas = r2(l.vendas + n(r.preco_produtos));
    }
    resumo.vendas = r2(resumo.vendas);
    resumo.ticket_medio = resumo.pedidos ? r2(resumo.vendas / resumo.pedidos) : 0;

    // ── repasses: liberado × a liberar (confirmação, ótica money_release) ────
    const comMp = validos.filter(r => r.net_recebido !== null);
    const hoje = hojeBrt.toISOString().slice(0, 10);
    const liberados = comMp.filter(r => r.release_status === 'released' || (r.release_date && r.release_date <= hoje));
    const aLiberar = comMp.filter(r => !liberados.includes(r));
    const soma = (arr, f) => r2(arr.reduce((t, x) => t + f(x), 0));
    const proxima = aLiberar.map(r => r.release_date).filter(Boolean).sort()[0] || null;
    const prazos = comMp.filter(r => r.pago_em && r.release_date)
      .map(r => (new Date(r.release_date) - new Date(r.pago_em)) / 86400000).filter(d => d >= 0);
    const repasses = {
      cobertura: `${comMp.length} de ${validos.length} pedidos com dado do Mercado Pago`,
      cobertura_pct: validos.length ? r2(comMp.length / validos.length * 100) : 0,
      liberados: liberados.length, liberado_valor: soma(liberados, r => n(r.net_recebido)),
      a_liberar: aLiberar.length, a_liberar_valor: soma(aLiberar, r => n(r.net_recebido)),
      proxima_liberacao: proxima,
      prazo_medio_dias: prazos.length ? Math.round(prazos.reduce((a, b) => a + b, 0) / prazos.length) : null,
    };

    // ── DRE (dos pedidos com net; o valor JÁ é conhecido — não espera) ───────
    const fin = {
      venda: soma(comMp, r => n(r.preco_produtos)),
      sale_fee: soma(comMp, r => n(r.sale_fee)),
      frete_vendedor: soma(comMp, r => n(r.frete_vendedor)),
      frete_comprador: soma(comMp, r => n(r.frete_comprador)),
      desconto_vendedor: soma(comMp, r => n(r.desconto_vendedor)),
      desconto_plataforma: soma(comMp, r => n(r.desconto_plataforma)),
      liquido_mp: soma(comMp, r => n(r.net_recebido)),
    };
    // resíduo: o que o líquido do MP não explica pelas linhas conhecidas
    // (frete do comprador que transita, parcelamento, arredondamento)
    fin.ajustes = r2(fin.liquido_mp - (fin.venda - fin.sale_fee - fin.frete_vendedor - fin.desconto_vendedor));
    fin.imposto = r2(fin.venda * 0.11);
    fin.total_pos_imposto = r2(fin.liquido_mp - fin.imposto);

    // ── CMV via Bling (pedido_id → itens.ref → custos) ───────────────────────
    const cmv = { exato: 0, un_com_custo: 0, estimado: 0, sem_vinculo: 0 };
    {
      const ids = comMp.map(r => r.pedido_id).filter(Boolean);
      const refsUn = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data: blg } = await supabase.from('bling_vendas_detalhe')
          .select('pedido_id, itens').in('pedido_id', ids.slice(i, i + 200));
        for (const b of (blg || [])) for (const it of (b.itens || [])) {
          const ref = String(it.ref || '').replace(/^0+/, '');
          const un = Number(it.quantidade) || 0;
          if (ref && un > 0) refsUn.push({ ref, un, pedido: b.pedido_id });
        }
      }
      const refs = [...new Set(refsUn.map(x => x.ref))];
      const custos = {};
      for (let i = 0; i < refs.length; i += 300) {
        const { data: cs } = await supabase.from('vw_calc_custos')
          .select('ref_norm, custo_producao').in('ref_norm', refs.slice(i, i + 300));
        (cs || []).forEach(c => { custos[c.ref_norm] = n(c.custo_producao); });
      }
      const comBling = new Set(refsUn.map(x => x.pedido));
      for (const x of refsUn) {
        if (custos[x.ref] > 0) { cmv.exato += custos[x.ref] * x.un; cmv.un_com_custo += x.un; }
      }
      let vendaMatch = 0, vendaSem = 0;
      for (const r of comMp) {
        if (comBling.has(r.pedido_id)) vendaMatch += n(r.preco_produtos);
        else { vendaSem += n(r.preco_produtos); cmv.sem_vinculo++; }
      }
      if (vendaSem > 0 && vendaMatch > 0 && cmv.exato > 0) cmv.estimado = r2(cmv.exato / vendaMatch * vendaSem);
      cmv.exato = r2(cmv.exato);
    }
    cmv.total = r2(cmv.exato + cmv.estimado);
    fin.cmv = cmv;
    fin.resultado_final = r2(fin.total_pos_imposto - cmv.total);

    return res.status(200).json({
      ok: true, janela, de: ini, ate: hoje,
      resumo, por_conta: porConta, por_logistica: porLog,
      repasses, detalhamento: fin,
      cancelamentos: { qtd: cancelados.length, valor: soma(cancelados, r => n(r.preco_produtos)) },
      nota: 'DRE calculado sobre os pedidos com dado do Mercado Pago (cobertura acima). O líquido já é definitivo na aprovação; a liberação só confirma o depósito.',
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'erro interno' });
  }
}
