// ═══════════════════════════════════════════════════════════════════════════
// RANKING DE VENDAS PRA AGENCIA TIKTOK SHOP (Ailson 24/07/2026)
// Gera um PDF A4 de 2 paginas com o top 20 de um periodo + refs extras no
// final: miniatura (bucket produtos/), titulo, descricao leve (tecido + cores
// disponiveis) e qtd vendida. Ref sem venda no periodo sai como LANCAMENTO.
//
// GET /api/bling-ranking-tiktok            -> baixa o PDF (maio/2026 default)
// GET /api/bling-ranking-tiktok?dry=1      -> JSON com os dados (debug)
// params opcionais: de=YYYY-MM-DD  ate=YYYY-MM-DD (fim EXCLUSIVO)
//   excluir=2798,2927,...   extras=3223,3220,...   titulo=Maio%2F2026
// Defaults = o combinado com a agencia em 24/07/2026 (sem tecido pra escalar
// ficam fora; lancamentos 3223/3220/3209/3186 entram no fim, total 24).
// ═══════════════════════════════════════════════════════════════════════════
import PDFDocument from 'pdfkit';
import { supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };

const SB_URL = process.env.SUPABASE_URL || 'https://bxxawglmlqoswwyhpeil.supabase.co';
const EXCLUIR_DEFAULT = ['2798', '2927', '3150', '376', '2851', '3228'];
const EXTRAS_DEFAULT = ['3223', '3220', '3209', '3186'];

const normRef = (r) => String(r || '').replace(/\D/g, '').replace(/^0+/, '');

function tecidoDoTitulo(t) {
  const s = String(t || '').toLowerCase();
  if (s.includes('viscolinho')) return 'Viscolinho';
  if (s.includes('linho') && s.includes('elastano')) return 'Linho com elastano';
  if (s.includes('linho')) return 'Linho';
  if (s.includes('couro')) return 'Couro ecológico';
  if (s.includes('poliamida')) return 'Malha poliamida';
  if (s.includes('viscolycra')) return 'Viscolycra';
  if (s.includes('malha')) return 'Malha';
  if (s.includes('viscose')) return 'Viscose';
  return null;
}

async function buscarFoto(refN) {
  const nomes = [`${refN}.jpg`, `${refN.padStart(4, '0')}.jpg`, `${refN}.png`];
  for (const n of nomes) {
    try {
      const r = await fetch(`${SB_URL}/storage/v1/object/public/produtos/${n}`);
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* tenta o proximo */ }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  try {
    const de = q.de || '2026-05-01';
    const ate = q.ate || '2026-06-01';
    const excluir = new Set((q.excluir ? String(q.excluir).split(',') : EXCLUIR_DEFAULT).map(normRef));
    const extras = (q.extras ? String(q.extras).split(',') : EXTRAS_DEFAULT).map(normRef);
    const tituloPeriodo = q.titulo || 'Maio/2026';

    // ── 1. Vendas do periodo, agregadas por ref ─────────────────────────────
    const { data: vendas, error } = await supabase.rpc('fn_vendas_produtos', { p_data_inicio: de, p_data_fim: ate });
    if (error) throw error;
    const porRef = new Map(); // refN -> { qtd, titulo }
    for (const v of (vendas || [])) {
      const rn = normRef(v.ref);
      if (!rn) continue;
      const cur = porRef.get(rn) || { qtd: 0, titulo: '' };
      cur.qtd += Number(v.qtd) || 0;
      if (!cur.titulo || (v.desc_limpa && v.desc_limpa.length > cur.titulo.length)) cur.titulo = v.desc_limpa || cur.titulo;
      porRef.set(rn, cur);
    }

    const top = [...porRef.entries()]
      .filter(([rn]) => !excluir.has(rn) && !extras.includes(rn))
      .sort((a, b) => b[1].qtd - a[1].qtd)
      .slice(0, 20)
      .map(([rn, d]) => ({ ref: rn, titulo: d.titulo, qtd: d.qtd, lancamento: false }));

    // ── 2. Extras no final (sem venda no periodo = LANCAMENTO) ──────────────
    for (const rn of extras) {
      const d = porRef.get(rn);
      let titulo = d?.titulo || '';
      if (!titulo) {
        const { data: be } = await supabase.from('bling_estoque').select('titulo').eq('ref', rn).limit(1).maybeSingle();
        titulo = (be?.titulo || `REF ${rn}`).replace(/\s*\(ref[^)]*\)/i, '').replace(/\s*\(0*\d{3,5}\)/, '').replace(/Cor:.*$/i, '').trim();
      }
      top.push({ ref: rn, titulo, qtd: d?.qtd || 0, lancamento: !(d?.qtd > 0) });
    }

    // ── 3. Descricao leve: tecido (do titulo) + cores disponiveis no estoque ─
    const refsAll = top.map(i => i.ref);
    const { data: cores } = await supabase.from('bling_estoque')
      .select('ref, cor_label, qtd').in('ref', refsAll).gt('qtd', 0);
    const coresPorRef = new Map();
    for (const c of (cores || [])) {
      if (!c.cor_label) continue;
      const m = coresPorRef.get(c.ref) || new Map();
      m.set(c.cor_label, (m.get(c.cor_label) || 0) + Number(c.qtd || 0));
      coresPorRef.set(c.ref, m);
    }
    for (const item of top) {
      const partes = [];
      const tec = tecidoDoTitulo(item.titulo);
      if (tec) partes.push(tec);
      const cm = coresPorRef.get(item.ref);
      if (cm && cm.size) {
        const nomes = [...cm.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
        const vis = nomes.slice(0, 4).join(', ') + (nomes.length > 4 ? ` +${nomes.length - 4}` : '');
        partes.push(`Cores: ${vis}`);
      }
      item.descricao = partes.join('  ·  ');
    }

    if (q.dry === '1') return res.status(200).json({ ok: true, de, ate, itens: top });

    // ── 4. Fotos (paralelo) ─────────────────────────────────────────────────
    const fotos = await Promise.all(top.map(i => buscarFoto(i.ref)));

    // ── 5. PDF A4, 12 itens por pagina = 2 paginas ──────────────────────────
    const probe = q.probe === '1'; // valida a geracao sem mandar o binario
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Ranking de Vendas ${tituloPeriodo} - Amicia` } });
    let probeChunks = null;
    if (probe) {
      probeChunks = [];
      doc.on('data', (c) => probeChunks.push(c));
      doc.on('end', () => {
        const buf = Buffer.concat(probeChunks);
        res.status(200).json({ ok: true, pdf_bytes: buf.length, itens: top.length, fotos_ok: fotos.filter(Boolean).length });
      });
    } else {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="ranking-amicia-${de.slice(0, 7)}-tiktok.pdf"`);
      doc.pipe(res);
    }

    const W = 595.28, ML = 40, MR = 40;
    const INK = '#2c3e50', MUT = '#8a9aa4', ACC = '#4a7fa5', BG = '#f7f4f0', BD = '#e8e2da';
    const PER_PAGE = 12;

    const header = (pag) => {
      doc.rect(0, 0, W, pag === 1 ? 64 : 46).fill(INK);
      doc.fill('#ffffff').font('Helvetica-Bold').fontSize(pag === 1 ? 16 : 12)
        .text(`Ranking de Vendas — ${tituloPeriodo}`, ML, pag === 1 ? 14 : 12);
      doc.font('Helvetica').fontSize(pag === 1 ? 9.5 : 8.5).fillColor('#cdd8e0')
        .text(pag === 1
          ? 'Amícia  ·  atacado moda feminina  ·  seleção pra estratégia TikTok Shop (20 mais vendidos + 4 lançamentos)'
          : `Amícia  ·  continuação  ·  página ${pag}/2`, ML, pag === 1 ? 38 : 28);
      return (pag === 1 ? 64 : 46) + 10;
    };

    let pag = 1, y = header(1);
    const rowH = (842 - 74 - 24) / PER_PAGE; // ~62pt

    top.forEach((item, idx) => {
      if (idx > 0 && idx % PER_PAGE === 0) {
        doc.addPage(); pag += 1; y = header(pag);
      }
      const thumbW = 38, thumbH = rowH - 12;
      // zebra
      if (idx % 2 === 0) doc.rect(ML - 8, y - 3, W - ML - MR + 16, rowH - 2).fill(BG);
      // rank
      doc.fillColor(idx < 20 ? ACC : '#b06a1a').font('Helvetica-Bold').fontSize(13)
        .text(String(idx + 1), ML, y + rowH / 2 - 12, { width: 22, align: 'center' });
      // foto
      const fx = ML + 28;
      if (fotos[idx]) {
        try { doc.image(fotos[idx], fx, y, { fit: [thumbW, thumbH], align: 'center', valign: 'center' }); }
        catch { doc.rect(fx, y, thumbW, thumbH).fill(BD); }
      } else {
        doc.rect(fx, y, thumbW, thumbH).fill(BD);
      }
      // textos
      const tx = fx + thumbW + 12, tw = W - MR - tx - 92;
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10)
        .text(`REF ${item.ref}  ·  ${item.titulo}`, tx, y + 4, { width: tw, height: 26, ellipsis: true });
      doc.fillColor(MUT).font('Helvetica').fontSize(8.5)
        .text(item.descricao || ' ', tx, y + 30, { width: tw, height: 20, ellipsis: true });
      // qtd / lancamento
      if (item.lancamento) {
        doc.roundedRect(W - MR - 84, y + rowH / 2 - 12, 82, 20, 5).fill('#fdf1e3');
        doc.fillColor('#b06a1a').font('Helvetica-Bold').fontSize(8.5)
          .text('LANÇAMENTO', W - MR - 84, y + rowH / 2 - 6, { width: 82, align: 'center' });
      } else {
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(13)
          .text(Number(item.qtd).toLocaleString('pt-BR'), W - MR - 84, y + rowH / 2 - 13, { width: 82, align: 'right' });
        doc.fillColor(MUT).font('Helvetica').fontSize(7.5)
          .text('peças vendidas', W - MR - 84, y + rowH / 2 + 3, { width: 82, align: 'right' });
      }
      y += rowH;
    });

    doc.fillColor(MUT).font('Helvetica').fontSize(7.5)
      .text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} · vendas Bling Exitus (situação Atendido) de ${de} a ${ate} (exclusivo) · refs sem tecido pra escala não listadas`, ML, 842 - 22, { width: W - ML - MR, align: 'center' });

    doc.end();
  } catch (e) {
    console.error('[ranking-tiktok]', e?.message || e);
    if (!res.headersSent) res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
