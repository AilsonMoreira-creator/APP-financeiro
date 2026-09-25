// lojas-whats-conversoes-pdf.js — Relatório de vendas da Sofia em PDF A4 (Ailson 24/09/2026)
//
// Mesmo jeito do PDF do Dashboard Meluni: o PDF é gerado no servidor (pdfkit),
// igual em qualquer aparelho; a tela compartilha (celular) ou baixa (computador).
//
//   POST { f: <resposta do /api/lojas-whats-funil-leads do período>,
//          gasto: { b2b: número|null, cartao: número|null }, periodoTxt, vendedoraTxt }
//   → application/pdf (uma folha A4)
//
// Critérios (os mesmos da tela Conversão):
//   Vendas pela Sofia = leads que fecharam pedido (etapa Vendeu), por data da venda, 1ª compra
//   Recompras         = vendas novas de clientes que já compraram via Sofia
//   Site direto       = pedidos CONVERTR sem conversa Vendeu da mesma cliente no período
//   Carrinhos         = leads de carrinho abandonado iniciados no período · convertidos = vendas deles
//   Total             = Sofia + recompras + site direto  ·  ROAS = total / gasto Meta Ads

import PDFDocument from 'pdfkit';

export const config = { maxDuration: 30 };

const INK = '#2c3e50', AZUL = '#4a7fa5', MUTED = '#7a8894', LINHA = '#e8e2da', CREME = '#f7f4f0';
const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v) => Number(v) || 0;
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) + '%' : '—');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });

  const { f = {}, gasto = {}, periodoTxt = '', vendedoraTxt = '' } = req.body || {};
  const origens = Array.isArray(f.origens) ? f.origens : [];
  const rec = f.recorrentes || {};
  const site = f.site_direto_periodo || { qtd: 0, valor: 0 };

  // Sofia (1ª compra) = soma das origens, sem as recompras
  const sofiaQtd = origens.reduce((a, o) => a + n(o.vendas_periodo), 0);
  const sofiaVal = origens.reduce((a, o) => a + n(o.valor_vendas_periodo), 0);
  const recQtd = n(rec.qtd), recVal = n(rec.valor);
  const siteQtd = n(site.qtd), siteVal = n(site.valor);
  const totalQtd = sofiaQtd + recQtd + siteQtd;
  const totalVal = sofiaVal + recVal + siteVal;

  const car = origens.find((o) => o.origem === 'carrinho_site_amicialoja') || {};
  const carTotal = n(car.total), carConv = n(car.vendas_periodo), carVal = n(car.valor_vendas_periodo);
  const carDia = Array.isArray(f.carrinhos_dia) ? f.carrinhos_dia : [];
  const carMedia = carDia.length ? carTotal / carDia.length : null;

  const gB2b = gasto?.b2b == null ? null : n(gasto.b2b);
  const gCartao = gasto?.cartao == null ? null : n(gasto.cartao);
  const gTotal = gB2b == null && gCartao == null ? null : n(gB2b) + n(gCartao);
  const roas = gTotal && gTotal > 0 ? totalVal / gTotal : null;

  const agora = new Date(Date.now() - 3 * 3600000);
  const dois = (x) => String(x).padStart(2, '0');
  const geradoEm = `${dois(agora.getUTCDate())}/${dois(agora.getUTCMonth() + 1)}/${agora.getUTCFullYear()}, ${dois(agora.getUTCHours())}:${dois(agora.getUTCMinutes())}`;

  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Amícia · Sofia · Vendas · ${periodoTxt}` } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const pronto = new Promise((resolve) => doc.on('end', resolve));

  const W = 595.28, M = 44, CW = W - 2 * M;
  let y = 46;

  // ── cabeçalho ──
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(AZUL).text('AMÍCIA · SOFIA', M, y, { characterSpacing: 1.5 });
  y += 14;
  doc.font('Times-Bold').fontSize(24).fillColor(INK).text('Relatório de vendas', M, y);
  y += 32;
  doc.font('Helvetica').fontSize(10).fillColor(MUTED)
    .text(`Período: ${periodoTxt}${vendedoraTxt ? '   ·   vendedora: ' + vendedoraTxt : ''}   ·   gerado em ${geradoEm}`, M, y);
  y += 26;

  // ── faixa principal: total · Meta Ads · ROAS ──
  const hH = 84;
  doc.roundedRect(M, y, CW, hH, 8).fillColor(CREME).fill();
  const col = CW / 3;
  const destaque = [
    ['Vendas totais', brl(totalVal), `${totalQtd} pedido${totalQtd === 1 ? '' : 's'}`],
    ['Investimento Meta Ads', gTotal == null ? '—' : brl(gTotal), 'contas Amícia'],
    ['ROAS', roas == null ? '—' : roas.toFixed(2).replace('.', ',') + 'x', 'vendas ÷ investimento'],
  ];
  destaque.forEach(([t, v, s], i) => {
    const x = M + i * col;
    if (i > 0) doc.moveTo(x, y + 16).lineTo(x, y + hH - 16).lineWidth(0.6).strokeColor(LINHA).stroke();
    doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(t, x + 16, y + 16, { width: col - 32 });
    doc.font('Times-Bold').fontSize(i === 2 ? 24 : 19).fillColor(i === 2 ? AZUL : INK).text(v, x + 16, y + 32, { width: col - 32, lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(s, x + 16, y + 60, { width: col - 32, lineBreak: false });
  });
  y += hH + 30;

  // ── de onde vieram as vendas ──
  doc.font('Times-Bold').fontSize(14).fillColor(INK).text('De onde vieram as vendas', M, y);
  y += 22;
  const linhas = [
    ['Vendas pela Sofia', '1ª compra via WhatsApp, inclui carrinhos do site', sofiaQtd, sofiaVal],
    ['Recompras', 'clientes que já tinham comprado via Sofia', recQtd, recVal],
    ['Vendas diretas no site', 'pedidos no site sem conversa antes', siteQtd, siteVal],
  ];
  const maxL = Math.max(1, ...linhas.map((l) => l[3]));
  for (const [t, s, q, v] of linhas) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(t, M, y, { width: 220 });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(s, M, y + 14, { width: 220 });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`${q} pedido${q === 1 ? '' : 's'}`, M + 225, y + 3, { width: 80, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(brl(v), M + 310, y + 2, { width: 100, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(pct(v, totalVal), M + 412, y + 4, { width: 30, align: 'right' });
    const bx = M + 452, bw = CW - 452, frac = v / maxL;
    doc.roundedRect(bx, y + 5, bw, 7, 3.5).fillColor('#ece7e0').fill();
    if (frac > 0) doc.roundedRect(bx, y + 5, Math.max(4, bw * frac), 7, 3.5).fillColor(AZUL).fill();
    y += 34;
    doc.moveTo(M, y - 7).lineTo(W - M, y - 7).lineWidth(0.5).strokeColor(LINHA).stroke();
  }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Total', M, y);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`${totalQtd} pedidos`, M + 225, y + 1, { width: 80, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(brl(totalVal), M + 310, y, { width: 100, align: 'right' });
  y += 22;
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(
    'Os carrinhos abandonados do site entram em "Vendas pela Sofia": a Sofia chama a cliente, envia catálogo e tira dúvidas, e muitas fecham o pedido por ela.',
    M, y, { width: CW });
  y += 30;

  // ── carrinhos abandonados ──
  doc.font('Times-Bold').fontSize(14).fillColor(INK).text('Carrinhos abandonados', M, y);
  y += 22;
  const cbw = (CW - 30) / 4, cbh = 50;
  [
    ['Carrinhos abordados', String(carTotal), 'leads de carrinho'],
    ['Média por dia', carMedia == null ? '—' : carMedia.toFixed(1).replace('.', ','), `em ${carDia.length || '—'} dias`],
    ['Convertidos', String(carConv), `${pct(carConv, carTotal)} dos carrinhos`],
    ['Valor recuperado', brl(carVal), 'vendas desses carrinhos'],
  ].forEach(([t, v, s2], i2) => {
    const x = M + i2 * (cbw + 10);
    doc.roundedRect(x, y, cbw, cbh, 6).lineWidth(0.7).strokeColor(LINHA).fillColor('#ffffff').fillAndStroke();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(t, x + 10, y + 9, { width: cbw - 20, lineBreak: false });
    doc.font('Times-Bold').fontSize(14.5).fillColor(INK).text(v, x + 10, y + 21, { width: cbw - 20, lineBreak: false });
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(s2, x + 10, y + 38, { width: cbw - 20, lineBreak: false });
  });
  y += cbh + 14;

  // grafico de barras: carrinhos que chegaram por dia
  if (carDia.length) {
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Carrinhos que chegaram por dia', M, y);
    y += 14;
    const gh = 70, maxQ = Math.max(1, ...carDia.map((d2) => n(d2.qtd)));
    const passo = CW / carDia.length, bw = Math.max(2, Math.min(18, passo * 0.7));
    doc.moveTo(M, y + gh).lineTo(W - M, y + gh).lineWidth(0.5).strokeColor(LINHA).stroke();
    // 24/09: data de TODOS os dias, na vertical (so pula 1 sim/1 nao se passar de ~2 meses)
    const rotuloCada = carDia.length > 62 ? 2 : 1;
    carDia.forEach((d2, k) => {
      const q = n(d2.qtd), h = (q / maxQ) * (gh - 12);
      const cx = M + k * passo + (passo - bw) / 2;
      if (q > 0) doc.rect(cx, y + gh - h, bw, h).fillColor(AZUL).fill();
      if (q > 0 && passo >= 12) doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(String(q), cx - 6, y + gh - h - 9, { width: bw + 12, align: 'center', lineBreak: false });
      if (k % rotuloCada === 0) {
        const dt = String(d2.data || '');
        const lx = cx + bw / 2 - 3, ly = y + gh + 27;
        doc.save();
        doc.rotate(-90, { origin: [lx, ly] });
        doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(`${dt.slice(8, 10)}/${dt.slice(5, 7)}`, lx, ly, { width: 26, align: 'left', lineBreak: false });
        doc.restore();
      }
    });
    y += gh + 40;
  } else {
    y += 16;
  }

  // ── investimento ──
  doc.font('Times-Bold').fontSize(14).fillColor(INK).text('Investimento em anúncios', M, y);
  y += 22;
  const inv = [
    ['Meta Ads · Amícia B2B', gB2b],
    ['Meta Ads · Amícia Cartão', gCartao],
  ];
  for (const [t, v] of inv) {
    doc.font('Helvetica').fontSize(10.5).fillColor(INK).text(t, M, y);
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(v == null ? '—' : brl(v), M + 310, y, { width: 100, align: 'right' });
    y += 20;
    doc.moveTo(M, y - 5).lineTo(M + 410, y - 5).lineWidth(0.5).strokeColor(LINHA).stroke();
  }
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text('Total investido', M, y);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(INK).text(gTotal == null ? '—' : brl(gTotal), M + 310, y, { width: 100, align: 'right' });
  y += 20;
  if (gTotal && totalQtd) {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(`Custo por pedido: ${brl(gTotal / totalQtd)}   ·   investimento sobre vendas: ${(100 * gTotal / Math.max(1, totalVal)).toFixed(1).replace('.', ',')}%`, M, y + 4);
  }

  // ── rodapé ──
  doc.font('Helvetica').fontSize(7.5).fillColor('#a0aab3').text(
    'Critérios iguais aos da tela Conversão da Sofia: vendas pela data da venda; recompra = nova compra de cliente que já comprou via Sofia; ' +
    'site direto = pedido no site sem conversa com a Sofia no período; carrinhos = leads de carrinho abandonado iniciados no período.',
    M, 800, { width: CW, align: 'left' },
  );

  doc.end();
  await pronto;
  const buf = Buffer.concat(chunks);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="sofia-vendas-${(periodoTxt || 'periodo').replace(/[^0-9a-z]+/gi, '-')}.pdf"`);
  return res.status(200).send(buf);
}
