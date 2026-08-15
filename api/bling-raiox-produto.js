/**
 * bling-raiox-produto.js — RAIO-X DE UMA REFERÊNCIA (Ailson 15/08/2026)
 *
 * Tudo que a tela do card precisa pra decisão, numa chamada só:
 *  - peças vendidas no período (7d padrão · mês · 30d) e a comparação
 *  - ranking de cores do produto no mesmo período
 *  - ranking por canal (top 5, conta + canal) com tendência 15d × 15d anteriores
 *  - Mercado Livre FULL (só Exitus tem): vendas 7d e 15d com comparação
 *  - devoluções 30d: total, % sobre as vendas, ranking de tamanho e de cor,
 *    sempre com o % dentro do que aquele tamanho/cor vendeu (o bege pode ser o
 *    mais devolvido só por ser o mais vendido — a tela mostra os dois lados)
 *
 * SOMENTE LEITURA. GET ?ref=02601[&periodo=7d|mes|30d]
 */
import { createClient } from '@supabase/supabase-js';
import { chaveCor, canonizarCor } from './_bling-helpers.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export const config = { maxDuration: 60 };
const n = (v) => Number(v) || 0;
const refNorm = (r) => String(r || '').replace(/^0+/, '');
const dia = (d) => new Date(d).toISOString().slice(0, 10);
const hojeBRT = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);

/** vendas da REF num intervalo → linhas achatadas por item */
async function linhas(ref, de, ate) {
  const { data } = await supabase.from('bling_vendas_detalhe')
    .select('conta, canal_geral, canal_detalhe, data_pedido, pedido_id, itens')
    .gte('data_pedido', de).lte('data_pedido', ate).limit(20000);
  const out = [];
  for (const v of (data || [])) {
    for (const it of (v.itens || [])) {
      if (refNorm(it.ref) !== refNorm(ref)) continue;
      out.push({
        conta: v.conta, canal: v.canal_geral, detalhe: v.canal_detalhe || v.canal_geral,
        data: String(v.data_pedido).slice(0, 10), pedido_id: v.pedido_id,
        cor: it.cor || '—', tam: String(it.tamanho || '—').toUpperCase(),
        qtd: n(it.quantidade) || 1,
      });
    }
  }
  return out;
}

const somaQtd = (arr) => arr.reduce((t, x) => t + x.qtd, 0);

// Rótulo do canal do jeito que ele lê a operação (15/08): "ML Exitus",
// "ML Full Exitus", "Shein Lumia" — o "ML Clássico" do Bling é só o Mercado
// Livre normal daquela conta (o Full tem canal próprio).
const CONTA_NOME = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
function rotuloCanal(l) {
  const base = String(l.detalhe || l.canal || '')
    .replace(/ML Clássico/i, 'ML')
    .replace(/Mercado Livre/i, 'ML')
    .trim();
  const conta = CONTA_NOME[l.conta] || l.conta || '';
  return conta ? `${base} ${conta}` : base;
}

function rankear(arr, chave, rotulo) {
  const m = {};
  for (const l of arr) {
    const k = chave(l);
    m[k] = m[k] || { chave: k, rotulo: rotulo(l), qtd: 0 };
    m[k].qtd += l.qtd;
  }
  return Object.values(m).sort((a, b) => b.qtd - a.qtd);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ?diag_nf=1&conta=exitus — as notas de ENTRADA (devolução) estão acessíveis?
  if (req.query?.diag_nf === '1') {
    const { blingFetch, refreshBlingToken } = await import('./_bling-helpers.js');
    const conta = String(req.query?.conta || 'exitus');
    const desde = dia(new Date(Date.now() - 30 * 86400000));
    const token = await refreshBlingToken(conta);
    const h = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
    const r = await blingFetch(`https://api.bling.com.br/Api/v3/nfe?tipo=0&dataEmissaoInicial=${desde}&limite=20`, h);
    const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
    const lista = j?.data || [];
    const out = { conta, http: r.status, qtd: lista.length, amostra: lista.slice(0, 5) };
    if (lista[0]?.id) {
      await new Promise(x => setTimeout(x, 400));
      const rd = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${lista[0].id}`, h);
      const jd = typeof rd.json === 'function' ? await rd.json().catch(() => ({})) : {};
      const d = jd?.data || {};
      out.detalhe = { chaves: Object.keys(d), natureza: d.naturezaOperacao, itens: (d.itens || []).slice(0, 3) };
    }
    return res.status(200).json(out);
  }

  const ref = String(req.query?.ref || '').trim();
  if (!ref) return res.status(400).json({ erro: 'use ?ref=' });
  const periodo = String(req.query?.periodo || '7d');

  try {
    const hoje = hojeBRT();
    const desde = (dias) => dia(new Date(Date.now() - dias * 86400000));

    // janela escolhida
    const de = periodo === 'mes' ? hoje.slice(0, 8) + '01'
      : periodo === '30d' ? desde(30) : desde(7);
    const dias = periodo === 'mes' ? (Number(hoje.slice(8, 10)) || 1) : (periodo === '30d' ? 30 : 7);

    // busca o bloco maior uma vez (45d cobre janela + 15×15 + devoluções 30d)
    const todas = await linhas(ref, desde(45), hoje);
    const noPeriodo = todas.filter(l => l.data >= de && l.data <= hoje);
    const anterior = todas.filter(l => l.data >= dia(new Date(Date.now() - 2 * dias * 86400000)) && l.data < de);

    const vendas = {
      periodo, dias, de, ate: hoje,
      pecas: somaQtd(noPeriodo),
      pedidos: new Set(noPeriodo.map(l => l.pedido_id)).size,
      pecas_periodo_anterior: somaQtd(anterior),
      media_dia: Math.round((somaQtd(noPeriodo) / Math.max(1, dias)) * 10) / 10,
    };
    vendas.variacao_pct = vendas.pecas_periodo_anterior
      ? Math.round(((vendas.pecas - vendas.pecas_periodo_anterior) / vendas.pecas_periodo_anterior) * 1000) / 10
      : null;

    // cores (mesma janela, cores unificadas)
    const cores = rankear(noPeriodo, l => chaveCor(l.cor), l => canonizarCor(l.cor))
      .map(c => ({ ...c, pct: Math.round((c.qtd / Math.max(1, vendas.pecas)) * 1000) / 10 }));

    // canais top 5 + tendência 15d × 15d anteriores
    const ult15 = todas.filter(l => l.data >= desde(15));
    const ant15 = todas.filter(l => l.data >= desde(30) && l.data < desde(15));
    const q15 = {}, qA = {};
    for (const l of ult15) { const k = rotuloCanal(l); q15[k] = (q15[k] || 0) + l.qtd; }
    for (const l of ant15) { const k = rotuloCanal(l); qA[k] = (qA[k] || 0) + l.qtd; }
    const canais = rankear(noPeriodo, rotuloCanal, rotuloCanal)
      .slice(0, 5)
      .map(c => {
        const a = q15[c.chave] || 0, b = qA[c.chave] || 0;
        return {
          canal: c.rotulo, qtd: c.qtd,
          pct: Math.round((c.qtd / Math.max(1, vendas.pecas)) * 1000) / 10,
          ult15: a, ant15: b,
          tendencia: b ? Math.round(((a - b) / b) * 1000) / 10 : (a ? 100 : 0),
        };
      });

    // Mercado Livre FULL (só Exitus tem)
    const ehFull = (l) => /full/i.test(l.detalhe) && l.conta === 'exitus';
    const full7 = somaQtd(todas.filter(l => ehFull(l) && l.data >= desde(7)));
    const full7ant = somaQtd(todas.filter(l => ehFull(l) && l.data >= desde(14) && l.data < desde(7)));
    const full15 = somaQtd(todas.filter(l => ehFull(l) && l.data >= desde(15)));
    const full15ant = somaQtd(todas.filter(l => ehFull(l) && l.data >= desde(30) && l.data < desde(15)));
    const full = {
      vende: full15 > 0 || somaQtd(todas.filter(ehFull)) > 0,
      d7: full7, d7_anterior: full7ant,
      d7_var: full7ant ? Math.round(((full7 - full7ant) / full7ant) * 1000) / 10 : (full7 ? 100 : null),
      d15: full15, d15_anterior: full15ant,
      d15_var: full15ant ? Math.round(((full15 - full15ant) / full15ant) * 1000) / 10 : (full15 ? 100 : null),
    };

    // ── DEVOLUÇÕES 30d (Mercado Livre: pedido cancelado/estornado) ──
    const vendas30 = todas.filter(l => l.data >= desde(30));
    const idsML = [...new Set(vendas30.filter(l => /mercado/i.test(l.canal)).map(l => l.pedido_id))];
    const devLinhas = [];
    for (let i = 0; i < idsML.length; i += 300) {
      const { data: tx } = await supabase.from('ml_pedido_taxas')
        .select('pedido_id, status_ml')
        .in('pedido_id', idsML.slice(i, i + 300))
        .in('status_ml', ['cancelled', 'partially_refunded', 'refunded']);
      const devolvidos = new Set((tx || []).map(t => String(t.pedido_id)));
      for (const l of vendas30) if (devolvidos.has(String(l.pedido_id))) devLinhas.push(l);
    }
    // ── TikTok: reembolso no repasse (API do canal) ──
    const idsTts = [...new Set(vendas30.filter(l => /tiktok/i.test(l.canal)).map(l => l.pedido_id))];
    if (idsTts.length) {
      const { data: bl } = await supabase.from('bling_vendas_detalhe')
        .select('pedido_id, numero_pedido_loja').in('pedido_id', idsTts);
      const porLoja = {};
      (bl || []).forEach(x => { if (x.numero_pedido_loja) porLoja[String(x.numero_pedido_loja)] = String(x.pedido_id); });
      const ordens = Object.keys(porLoja);
      for (let i = 0; i < ordens.length; i += 300) {
        const { data: rp } = await supabase.from('tts_repasse')
          .select('order_id, reembolsos').in('order_id', ordens.slice(i, i + 300)).neq('reembolsos', 0);
        const devolvidosTts = new Set((rp || []).map(x => porLoja[String(x.order_id)]));
        for (const l of vendas30) if (devolvidosTts.has(String(l.pedido_id))) devLinhas.push(l);
      }
    }

    // ── demais canais (Shein, Shopee, Magalu): NOTA DE DEVOLUÇÃO do Bling ──
    // (ML e TikTok não entram aqui — já vieram da API do canal, sem dobrar)
    const { data: devBling } = await supabase.from('bling_devolucoes')
      .select('ref, cor, tam, qtd, canal, data_nota')
      .eq('ref', refNorm(ref)).gte('data_nota', desde(30));
    for (const d of (devBling || [])) {
      devLinhas.push({
        conta: '-', canal: d.canal || 'Bling', detalhe: d.canal || 'Bling',
        data: d.data_nota, pedido_id: `nf-${d.canal}-${d.data_nota}`,
        cor: d.cor || '—', tam: String(d.tam || '—').toUpperCase(), qtd: n(d.qtd) || 1,
      });
    }

    const vendidas30 = somaQtd(vendas30);
    const devolvidas = somaQtd(devLinhas);

    const porTam = (arr) => {
      const m = {};
      for (const l of arr) { m[l.tam] = (m[l.tam] || 0) + l.qtd; }
      return m;
    };
    const vendTam = porTam(vendas30), devTam = porTam(devLinhas);
    const tamanhos = Object.entries(devTam).sort((a, b) => b[1] - a[1]).map(([tam, q]) => ({
      tam, devolvidas: q,
      pct_das_devolucoes: Math.round((q / Math.max(1, devolvidas)) * 1000) / 10,
      vendidas: vendTam[tam] || 0,
      // o número que importa: quanto do que VENDEU naquele tamanho voltou
      pct_do_que_vendeu: Math.round((q / Math.max(1, vendTam[tam] || 1)) * 1000) / 10,
    }));

    const chaveC = (l) => chaveCor(l.cor);
    const vendCor = {}, devCor = {}, rotCor = {};
    for (const l of vendas30) { const k = chaveC(l); vendCor[k] = (vendCor[k] || 0) + l.qtd; rotCor[k] = canonizarCor(l.cor); }
    for (const l of devLinhas) { const k = chaveC(l); devCor[k] = (devCor[k] || 0) + l.qtd; }
    const coresDev = Object.entries(devCor).sort((a, b) => b[1] - a[1]).map(([k, q]) => ({
      cor: rotCor[k] || k, devolvidas: q,
      pct_das_devolucoes: Math.round((q / Math.max(1, devolvidas)) * 1000) / 10,
      vendidas: vendCor[k] || 0,
      pct_do_que_vendeu: Math.round((q / Math.max(1, vendCor[k] || 1)) * 1000) / 10,
    }));

    return res.status(200).json({
      ref: refNorm(ref), vendas, cores, canais, full,
      devolucoes: {
        janela: '30 dias',
        fonte: 'Mercado Livre e TikTok pela API do canal · demais canais pelas notas de devolução do Bling',
        por_canal: (() => {
          const m = {};
          for (const l of devLinhas) { const k = l.conta === '-' ? (l.canal || 'Bling') : rotuloCanal(l); m[k] = (m[k] || 0) + l.qtd; }
          return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([canal, qtd]) => ({ canal, qtd }));
        })(),
        vendidas30, devolvidas,
        pct: Math.round((devolvidas / Math.max(1, vendidas30)) * 1000) / 10,
        tamanhos, cores: coresDev,
      },
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
