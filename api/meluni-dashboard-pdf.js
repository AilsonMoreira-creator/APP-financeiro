// meluni-dashboard-pdf.js — PDF de verdade do Dashboard Meluni (Ailson 08/09/2026)
//
// O "imprimir" do Safari no iPhone não serve (prendia numa aba, cortava a 2ª
// página, imprimia a URL no rodapé e por fim saiu em branco). Aqui o PDF é
// gerado no servidor com pdfkit — um arquivo, igual em qualquer aparelho,
// que o front compartilha direto (WhatsApp/e-mail) ou baixa.
//
//   POST { d: <payload do meluni-dashboard>, gasto: <número|null>, periodoTxt }
//   → application/pdf (uma folha A4: cards horizontais em 2 colunas + dia a dia)

import PDFDocument from 'pdfkit';

export const config = { maxDuration: 30 };

const ROXO = '#9b59b6', INK = '#1f2d3a', MUTED = '#6b7c8a', LINHA = '#e3e8ee', LILAS = '#f6f0f9';
const brl = (v) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (v) => Number(v) || 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });

  const { d = {}, gasto = null, periodoTxt = '' } = req.body || {};
  const vendasQtd = n(d.vendas?.qtd), vendasSoma = n(d.vendas?.soma);
  const devSoma = n(d.devolucoes?.soma), devQtd = n(d.devolucoes?.qtd);
  const totalCli = n(d.clientes?.total);
  const serie = Array.isArray(d.serie) ? d.serie : [];
  const g = gasto == null ? null : n(gasto);
  const roas = g && g > 0 ? vendasSoma / g : null;
  const cpa = g && vendasQtd ? g / vendasQtd : null;
  const agora = new Date(Date.now() - 3 * 3600000);
  const geradoEm = `${String(agora.getUTCDate()).padStart(2, '0')}/${String(agora.getUTCMonth() + 1).padStart(2, '0')}/${agora.getUTCFullYear()}, ${String(agora.getUTCHours()).padStart(2, '0')}:${String(agora.getUTCMinutes()).padStart(2, '0')}`;

  const cards = [
    ['Vendas', brl(vendasSoma), `${vendasQtd} pedidos`, false],
    ['Devoluções', brl(devSoma), `${devQtd} devoluções · ${vendasSoma ? (100 * devSoma / vendasSoma).toFixed(1) : '0.0'}% do vendido`, false],
    ['Valor real (vendas - devol.)', brl(d.valor_real), '', true],
    ['Ticket médio', brl(d.ticket), '', false],
    ['Clientes novos', String(d.clientes?.novos ?? 0), totalCli ? `${Math.round(100 * n(d.clientes?.novos) / totalCli)}% do período` : '', false],
    ['Clientes recorrentes', String(d.clientes?.recorrentes ?? 0), totalCli ? `${Math.round(100 * n(d.clientes?.recorrentes) / totalCli)}% já compraram antes` : '', true],
    ['Carrinhos abandonados', String(n(d.carrinhos?.qtd)), d.carrinhos?.conversao_pct != null ? `${n(d.carrinhos?.convertidos)} recuperados · ${Math.round(n(d.carrinhos?.conversao_pct))}%` : '', false],
    ['Gasto Meta Ads', g == null ? '—' : brl(g), 'conta Meluni', false],
    ['ROAS (venda / gasto)', roas == null ? '—' : roas.toFixed(2) + 'x', '', true],
    ['CPA (gasto / pedidos)', cpa == null ? '—' : brl(cpa), 'custo por pedido', false],
    ['Gasto / venda (ACOS)', (g && vendasSoma) ? (100 * g / vendasSoma).toFixed(1) + '%' : '—', '', false],
    ['Pedidos por dia', serie.length ? (vendasQtd / serie.length).toFixed(1) : '—', `${serie.length} dias no período`, false],
    ['Venda por dia', serie.length ? brl(vendasSoma / serie.length) : '—', 'média do período', false],
  ];

  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Meluni · Dashboard · ${periodoTxt}` } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const pronto = new Promise((resolve) => doc.on('end', resolve));

  const W = 595.28, M = 36;
  let y = M;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(ROXO).text('MELUNI · E-COMMERCE', M, y, { characterSpacing: 1 });
  y += 14;
  doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('Dashboard de vendas', M, y);
  y += 26;
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(`Período: ${periodoTxt}   ·   gerado em ${geradoEm}`, M, y);
  y += 22;

  // cards horizontais, 2 colunas
  const gap = 12, cw = (W - 2 * M - gap) / 2, ch = 56;
  cards.forEach((c, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + col * (cw + gap), yy = y + row * (ch + 9);
    const [label, valor, sub, destaque] = c;
    doc.roundedRect(x, yy, cw, ch, 6).lineWidth(destaque ? 1.2 : 0.8).strokeColor(destaque ? ROXO : LINHA).fillColor(destaque ? LILAS : '#ffffff').fillAndStroke();
    const wTxt = cw - 118;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#4a5a68').text(label, x + 12, yy + (sub ? 12 : 21), { width: wTxt, height: 13, lineBreak: false, ellipsis: true });
    if (sub) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(sub, x + 12, yy + 30, { width: wTxt, height: 12, lineBreak: false, ellipsis: true });
    doc.font('Helvetica-Bold').fontSize(17).fillColor(INK).text(valor, x + cw - 112, yy + 19, { width: 100, align: 'right', lineBreak: false });
  });
  y += Math.ceil(cards.length / 2) * (ch + 9) + 14;

  // dia a dia
  doc.font('Helvetica-Bold').fontSize(14).fillColor(ROXO).text('Dia a dia', M, y);
  y += 22;
  const cols = [
    { t: 'Dia', w: 50 }, { t: 'Pedidos', w: 60, r: true }, { t: 'Vendas', w: 90, r: true },
    { t: 'Devoluções', w: 90, r: true }, { t: 'Carrinhos', w: 65, r: true }, { t: 'Vendas (relativo)', w: W - 2 * M - 355 },
  ];
  let x = M;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(MUTED);
  cols.forEach((c) => { doc.text(c.t, x, y, { width: c.w - 6, align: c.r ? 'right' : 'left', lineBreak: false }); x += c.w; });
  y += 13;
  doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(LINHA).stroke();
  y += 4;
  const maxV = Math.max(1, ...serie.map(s => n(s.vendas_valor)));
  const rowH = 20;
  for (const s of serie) {
    if (y > 800) { doc.addPage(); y = M; }
    const dt = String(s.data || ''); const dd = dt.length >= 10 ? `${dt.slice(8, 10)}/${dt.slice(5, 7)}` : dt;
    const vals = [dd, String(n(s.vendas_qtd)), brl(s.vendas_valor), brl(s.devol_valor), String(n(s.carrinhos_qtd))];
    x = M;
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    vals.forEach((v, i) => { doc.text(v, x, y + 5, { width: cols[i].w - 6, align: cols[i].r ? 'right' : 'left', lineBreak: false }); x += cols[i].w; });
    const bw = cols[5].w - 8, bh = 9, frac = n(s.vendas_valor) / maxV;
    doc.roundedRect(x, y + 6, bw, bh, 4).fillColor('#ece3f2').fill();
    if (frac > 0) doc.roundedRect(x, y + 6, Math.max(4, bw * frac), bh, 4).fillColor(ROXO).fill();
    y += rowH;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.4).strokeColor('#eef1f4').dash(2, { space: 2 }).stroke().undash();
  }

  doc.end();
  await pronto;
  const buf = Buffer.concat(chunks);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="meluni-dashboard-${(periodoTxt || 'periodo').replace(/[^0-9a-z]+/gi, '-')}.pdf"`);
  return res.status(200).send(buf);
}
