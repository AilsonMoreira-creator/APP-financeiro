/**
 * plano-fabricacao.js — PLANO DE FABRICAÇÃO dos marketplaces (Ailson 25/09/2026)
 *
 * Pra cada REF da marca (padrão Meluni) que vendeu nos últimos 30 dias no Bling
 * (Exitus + Lumia + Muniam), por COR (só as do ranking de cores do Bling) × TAMANHO:
 *
 *   venda diária  = vendas 30d ÷ 30
 *   demanda       = venda diária × (1 + crescimento) × dias de cobertura
 *   base          = estoque Bling (vendável: Exitus + Lumia + Muniam) + peças nas oficinas
 *   FABRICAR      = demanda − (uso × base)        (nunca negativo, arredonda pra cima)
 *
 * "uso" = quanto do estoque atual (com oficina) ele aceita consumir no ciclo.
 * Ex.: 25% → no fim do ciclo sobram 75% da base e todas as vendas foram cobertas.
 *
 * Oficinas = cortes não entregues e ainda não somados ao estoque (mesma regra da
 * coluna "Estoque proj." do card do Bling Estoque).
 *
 * GET ?marca=meluni&cobertura=75&crescimento=20&uso=25[&json=1][&ref=2277]
 *   → PDF A4 (padrão) ou JSON (json=1). SOMENTE LEITURA.
 */
import PDFDocument from 'pdfkit';
import { supabase, chaveCor, canonizarCor } from './_bling-helpers.js';

export const config = { maxDuration: 60 };

const n = (v) => Number(v) || 0;
const refNorm = (r) => String(r || '').replace(/\D/g, '').replace(/^0+/, '');
const TAM_ORDEM = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG', 'EG', 'EXG', 'G1', 'G2', 'G3', 'U', 'UNICO', 'ÚNICO'];
const ordTam = (t) => { const i = TAM_ORDEM.indexOf(t); if (i >= 0) return i; const x = parseInt(t, 10); return Number.isFinite(x) ? 100 + x : 500; };
const diaBRT = (off = 0) => new Date(Date.now() - 3 * 3600000 - off * 86400000).toISOString().slice(0, 10);

async function todas(q, passo = 1000, max = 60000) {
  const out = [];
  for (let de = 0; de < max; de += passo) {
    const { data, error } = await q().range(de, de + passo - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < passo) break;
  }
  return out;
}

export async function montarPlano({ marca = 'meluni', cobertura = 75, crescimento = 20, uso = 25, soRef = null } = {}) {
  const hoje = diaBRT(0), ini30 = diaBRT(30), ini90 = diaBRT(90);

  // 1) cadastro: descrição e marca por REF
  const { data: gav } = await supabase.from('amicia_data').select('user_id, payload').in('user_id', ['amicia-admin', 'ailson_cortes']);
  const cad = {};
  for (const g of gav || []) for (const p of (g.payload?.produtos || [])) {
    const r = refNorm(p.ref); if (!r) continue;
    if (!cad[r]) cad[r] = { descricao: String(p.descricao || '').trim(), marca: String(p.marca || '').trim() };
  }
  const cortes = (gav || []).find((g) => g.user_id === 'ailson_cortes')?.payload?.cortes || [];

  // 2) vendas 90d (ranking de cores) e 30d (plano) — itens do Bling (3 contas)
  const pedidos = await todas(() => supabase.from('bling_vendas_detalhe').select('data_pedido, itens').gte('data_pedido', ini90).lte('data_pedido', hoje + 'T23:59:59'));
  const rankCor = {}; const v30 = {}; const labelCor = {};
  for (const p of pedidos) {
    const d = String(p.data_pedido).slice(0, 10);
    for (const it of (p.itens || [])) {
      const k = chaveCor(it.cor); if (!k) continue;
      const q = n(it.quantidade) || 1;
      rankCor[k] = (rankCor[k] || 0) + q;
      if (!labelCor[k]) labelCor[k] = canonizarCor(it.cor);
      if (d < ini30) continue;
      const r = refNorm(it.ref); const t = String(it.tamanho || '').toUpperCase().trim();
      if (!r || !t) continue;
      const key = `${r}|${k}|${t}`;
      v30[key] = (v30[key] || 0) + q;
    }
  }
  const top = Object.entries(rankCor).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k]) => k);
  const topSet = new Set(top);

  // 3) estoque vendável (Exitus + Lumia + Muniam)
  const est = {};
  const estRows = await todas(() => supabase.from('bling_estoque').select('ref, cor_norm, cor_label, tam, qtd, qtd_lumia, qtd_muniam'));
  for (const e of estRows) {
    const r = refNorm(e.ref), k = chaveCor(e.cor_norm || e.cor_label), t = String(e.tam || '').toUpperCase().trim();
    if (!r || !k || !t) continue;
    est[`${r}|${k}|${t}`] = (est[`${r}|${k}|${t}`] || 0) + n(e.qtd) + n(e.qtd_lumia) + n(e.qtd_muniam);
    if (!labelCor[k] && e.cor_label) labelCor[k] = canonizarCor(e.cor_label);
  }

  // 4) oficinas: cortes não entregues e não somados ao estoque
  const { data: ins } = await supabase.from('bling_cortes_inseridos').select('ref_norm, corte_id').eq('status', 'ok');
  const inseridos = new Set((ins || []).map((x) => `${refNorm(x.ref_norm)}|${x.corte_id}`));
  const of = {};
  for (const c of cortes) {
    if (c?.arquivado === true || c?.entregue === true) continue;
    const r = refNorm(c.ref); if (!r || inseridos.has(`${r}|${c.id}`)) continue;
    const cores = c.detalhes?.cores || [], tams = c.detalhes?.tamanhos || [];
    for (const co of cores) {
      const folhas = n(co.folhas); if (folhas <= 0) continue;
      const k = chaveCor(co.nome);
      for (const tm of tams) {
        const grade = n(tm.grade); if (grade <= 0) continue;
        const ov = c.detalhes?.celulas?.[`${co.nome}|${tm.tam}`];
        const qtd = (ov == null || ov === '') ? folhas * grade : (parseInt(ov, 10) || 0);
        const t = String(tm.tam || '').toUpperCase().trim();
        of[`${r}|${k}|${t}`] = (of[`${r}|${k}|${t}`] || 0) + qtd;
      }
    }
  }

  // 5) plano por REF da marca que vendeu em 30 dias
  const fator = (1 + crescimento / 100) * cobertura / 30;
  const refsVendidas = new Set(Object.keys(v30).map((k) => k.split('|')[0]));
  const semCadastro = [], outraMarca = [];
  const refs = [];
  for (const r of refsVendidas) {
    if (soRef && r !== refNorm(soRef)) continue;
    const c = cad[r];
    if (!c) { semCadastro.push(r); continue; }
    if (marca && !c.marca.toLowerCase().includes(String(marca).toLowerCase())) { outraMarca.push(r); continue; }
    const coresRef = new Set(), tamsRef = new Set();
    for (const src of [v30, est, of]) for (const key of Object.keys(src)) {
      const [rr, k, t] = key.split('|'); if (rr !== r || !topSet.has(k)) continue;
      if (src === est && n(src[key]) <= 0 && !v30[key] && !of[key]) continue;
      coresRef.add(k); tamsRef.add(t);
    }
    const cores = [...coresRef].sort((a, b) => top.indexOf(a) - top.indexOf(b));
    const tams = [...tamsRef].sort((a, b) => ordTam(a) - ordTam(b));
    const cel = {}; let totFab = 0, totV30 = 0, totBase = 0;
    for (const k of cores) for (const t of tams) {
      const key = `${r}|${k}|${t}`;
      const vend = n(v30[key]), e = Math.max(0, n(est[key])), o = n(of[key]);
      const demanda = vend * fator;
      const fab = Math.max(0, Math.ceil(demanda - (uso / 100) * (e + o)));
      cel[`${k}|${t}`] = { v30: vend, est: e, of: o, demanda: Math.round(demanda), fabricar: fab };
      totFab += fab; totV30 += vend; totBase += e + o;
    }
    if (!cores.length) continue;
    refs.push({ ref: r, descricao: c.descricao, cores: cores.map((k) => ({ k, nome: labelCor[k] || k })), tams, cel, total_fabricar: totFab, vendas_30d: totV30, base: totBase });
  }
  refs.sort((a, b) => b.total_fabricar - a.total_fabricar || b.vendas_30d - a.vendas_30d);
  return {
    parametros: { marca, cobertura, crescimento, uso, periodo_vendas: `${ini30} a ${hoje}` },
    ranking_cores: top.map((k) => labelCor[k] || k),
    refs, total_fabricar: refs.reduce((a, x) => a + x.total_fabricar, 0),
    fora: { sem_cadastro: semCadastro, outra_marca: outraMarca.length },
  };
}

// ── PDF A4 ─────────────────────────────────────────────────────────────────
const INK = '#2c3e50', AZUL = '#4a7fa5', MUTED = '#7a8894', LINHA = '#e8e2da', CREME = '#f7f4f0';
const br = (iso) => String(iso).split('-').reverse().join('/');

export function desenharPdf(plano) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'Plano de fabricação · marketplaces' } });
  const W = 595.28, H = 841.89, M = 36, CW = W - 2 * M;
  const P = plano.parametros;
  let y = 40;
  const agora = new Date(Date.now() - 3 * 3600000);
  const dois = (x) => String(x).padStart(2, '0');
  const gerado = `${dois(agora.getUTCDate())}/${dois(agora.getUTCMonth() + 1)}/${agora.getUTCFullYear()}`;

  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(AZUL).text(`${String(P.marca || '').toUpperCase()} · MARKETPLACES (BLING)`, M, y, { characterSpacing: 1.5 });
  y += 14;
  doc.font('Times-Bold').fontSize(22).fillColor(INK).text('Plano de fabricação', M, y);
  y += 30;
  const [pi, pf] = String(P.periodo_vendas).split(' a ');
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(
    `Vendas de ${br(pi)} a ${br(pf)}  ·  +${P.crescimento}% de crescimento  ·  cobertura de ${P.cobertura} dias  ·  usar ${P.uso}% do estoque atual (com oficinas)  ·  gerado em ${gerado}`,
    M, y, { width: CW });
  y += 22;

  // resumo
  doc.roundedRect(M, y, CW, 50, 7).fillColor(CREME).fill();
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Total a fabricar', M + 14, y + 10);
  doc.font('Times-Bold').fontSize(20).fillColor(INK).text(`${plano.total_fabricar.toLocaleString('pt-BR')} peças`, M + 14, y + 22);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Referências', M + 210, y + 10);
  doc.font('Times-Bold').fontSize(20).fillColor(INK).text(String(plano.refs.length), M + 210, y + 22);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Como ler cada célula: o número grande é o que fabricar; embaixo, estoque + oficinas hoje.', M + 290, y + 12, { width: CW - 300 });
  y += 62;
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Cores do ranking Bling: ${plano.ranking_cores.join(' · ')}`, M, y, { width: CW });
  y += 22;

  const novaPagina = () => { doc.addPage({ size: 'A4', margin: 0 }); y = 40; };

  for (const r of plano.refs) {
    const nC = r.cores.length, nT = r.tams.length;
    const col0 = 36, cw = Math.min(62, (CW - col0) / Math.max(1, nC)), rh = 30;
    const altura = 34 + 18 + nT * rh + 10;
    if (y + altura > H - 40) novaPagina();

    doc.font('Times-Bold').fontSize(12.5).fillColor(INK).text(`REF ${r.ref}`, M, y, { continued: true })
      .font('Helvetica').fontSize(9.5).fillColor(MUTED).text(`   ${r.descricao || ''}`);
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(`vendeu ${r.vendas_30d} em 30 dias · estoque + oficinas ${r.base}`, M, y + 16);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(r.total_fabricar ? AZUL : MUTED)
      .text(r.total_fabricar ? `fabricar ${r.total_fabricar.toLocaleString('pt-BR')}` : 'nada a fabricar', M, y + 2, { width: CW, align: 'right' });
    y += 34;

    // cabeçalho das cores
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK);
    r.cores.forEach((c, i) => doc.text(c.nome, M + col0 + i * cw, y, { width: cw - 2, align: 'center', height: 16, ellipsis: true }));
    y += 18;
    doc.moveTo(M, y - 3).lineTo(M + col0 + nC * cw, y - 3).lineWidth(0.6).strokeColor(LINHA).stroke();

    for (const t of r.tams) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(t, M, y + 9, { width: col0 - 6 });
      r.cores.forEach((c, i) => {
        const x = M + col0 + i * cw;
        const v = r.cel[`${c.k}|${t}`] || { fabricar: 0, est: 0, of: 0 };
        if (v.fabricar > 0) doc.roundedRect(x + 3, y + 2, cw - 6, rh - 4, 4).fillColor('#eef3f8').fill();
        doc.font('Helvetica-Bold').fontSize(11.5).fillColor(v.fabricar > 0 ? INK : '#b6bec6')
          .text(v.fabricar > 0 ? String(v.fabricar) : '—', x, y + 4, { width: cw, align: 'center', lineBreak: false });
        doc.font('Helvetica').fontSize(6.5).fillColor(MUTED)
          .text(`${v.est} + ${v.of}`, x, y + 18, { width: cw, align: 'center', lineBreak: false });
      });
      y += rh;
      doc.moveTo(M, y).lineTo(M + col0 + nC * cw, y).lineWidth(0.4).strokeColor(LINHA).stroke();
    }
    y += 16;
  }

  if (y > H - 70) novaPagina();
  doc.font('Helvetica').fontSize(7).fillColor('#a0aab3').text(
    `Fabricar = venda diária × (1 + ${P.crescimento}%) × ${P.cobertura} dias − ${P.uso}% de (estoque + oficinas). ` +
    'Venda diária = vendas dos últimos 30 dias ÷ 30 (Exitus + Lumia + Muniam). Estoque = vendável no Bling. ' +
    'Oficinas = cortes não entregues e ainda não somados ao estoque. Só entram as cores do ranking Bling.',
    M, H - 46, { width: CW });
  return doc;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const q = req.query || {};
    const plano = await montarPlano({
      marca: q.marca == null ? 'meluni' : String(q.marca),
      cobertura: n(q.cobertura) || 75, crescimento: q.crescimento == null ? 20 : n(q.crescimento),
      uso: q.uso == null ? 25 : n(q.uso), soRef: q.ref || null,
    });
    if (q.json === '1') return res.status(200).json(plano);
    const doc = desenharPdf(plano);
    const chunks = []; doc.on('data', (c) => chunks.push(c));
    const fim = new Promise((r) => doc.on('end', r));
    doc.end(); await fim;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="plano-fabricacao.pdf"');
    return res.status(200).send(Buffer.concat(chunks));
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
