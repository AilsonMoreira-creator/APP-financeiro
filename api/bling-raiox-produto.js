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
    for (const l of ult15) { const k = `${l.detalhe} · ${l.conta}`; q15[k] = (q15[k] || 0) + l.qtd; }
    for (const l of ant15) { const k = `${l.detalhe} · ${l.conta}`; qA[k] = (qA[k] || 0) + l.qtd; }
    const canais = rankear(noPeriodo, l => `${l.detalhe} · ${l.conta}`, l => `${l.detalhe} · ${l.conta}`)
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
        janela: '30 dias', fonte: 'Mercado Livre (pedidos cancelados/estornados)',
        vendidas30, devolvidas,
        pct: Math.round((devolvidas / Math.max(1, vendidas30)) * 1000) / 10,
        tamanhos, cores: coresDev,
      },
    });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
