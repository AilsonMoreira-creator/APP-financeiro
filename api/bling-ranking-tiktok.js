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
const EXCLUIR_DEFAULT = ['2798', '2927', '3150', '376', '2851', '3228', '2891'];  // 2891 retirada 26/07
const EXTRAS_DEFAULT = ['3223', '3220', '3209', '3186', '1628'];  // 1628 (corrigido de 1678) 26/07

const normRef = (r) => String(r || '').replace(/\D/g, '').replace(/^0+/, '');

// Espelho do BLING_COR_HEX do modulo (App.tsx) — manter em sincronia.
// Salvia corrigida 25/07/2026 (mais clara que pistache, mais escura que menta).
const COR_HEX = { 'preto':'#222222','natural':'#d4c8a8','branco':'#f5f0e8','areia':'#c8b88a','verde':'#4a8a4a','verde agua':'#5ab8a0','verde militar':'#5a6b4a','verde salvia':'#a3b899','verde pistache':'#a9c47f','verde menta':'#b8e0cc','verde escuro':'#2d5a2d','terracota':'#b85c38','rose':'#d4a0a0','caqui':'#8a7a5a','cinza':'#999999','marrom':'#6b4226','marrom escuro':'#4a2a12','azul':'#3a6aa5','azul marinho':'#1a3a6a','azul-marinho':'#1a3a6a','azul claro':'#7ab0d4','azul serenity':'#5b9bd5','amarelo':'#f0c040','amarelo manteiga':'#e8d080','bege':'#d4c0a0','bege claro':'#e8d8c0','caramelo':'#b87a3a','figo':'#6a3a5a','off white':'#f0e8d8','creme':'#e8d8c0','cappuccino':'#8a6a4a','vermelho':'#c0392b','roxo':'#6a2d8a','laranja':'#e67e22','bordo':'#6a1a2a','burgundy':'#6a1a2a','rosa':'#d48aa0','nude':'#c8a890','vinho':'#5a1a2a','preto mescla':'#3a3a3a','marrom mescla':'#7a5a42','caramelo mescla':'#c08a52','natural mescla':'#cfc4a4','azul mescla':'#5a7a9a' };
const corKeyN = (c) => String(c || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
const corHex = (c) => COR_HEX[corKeyN(c)] || '#a89f94';
// Cores PRINCIPAIS da estrategia TikTok (Ailson 25/07/2026): quando ativas no
// modelo, aparecem PRIMEIRO nas bolinhas (nesta ordem); o resto completa por
// estoque desc e vira "+x".
const CORES_PRINCIPAIS = ['bege', 'preto', 'azul claro', 'verde salvia', 'rosa', 'amarelo'];
const ORDEM_TAM = ['PP','P','M','G','GG','XG','XGG','EG','EGG','U','G1','G2','G3','G4','G5'];
const ordTam = (t) => { const i = ORDEM_TAM.indexOf(String(t || '').toUpperCase()); return i < 0 ? 99 : i; };

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
    // Cores e tamanhos ATIVOS = mesmos chips do card do modulo (vendavel > 0,
    // Exitus + Lumia + Muniam). Ailson 25/07/2026.
    const { data: linhasEst } = await supabase.from('bling_estoque')
      .select('ref, cor_label, tam, qtd, qtd_lumia, qtd_muniam').in('ref', refsAll);
    const coresPorRef = new Map(), tamPorRef = new Map();
    for (const c of (linhasEst || [])) {
      const vend = (Number(c.qtd) || 0) + (Number(c.qtd_lumia) || 0) + (Number(c.qtd_muniam) || 0);
      if (vend <= 0) continue;
      if (c.cor_label) {
        const m = coresPorRef.get(c.ref) || new Map();
        m.set(c.cor_label, (m.get(c.cor_label) || 0) + vend);
        coresPorRef.set(c.ref, m);
      }
      if (c.tam) {
        const t = tamPorRef.get(c.ref) || new Set();
        t.add(String(c.tam).toUpperCase());
        tamPorRef.set(c.ref, t);
      }
    }
    for (const item of top) {
      const tec = tecidoDoTitulo(item.titulo);
      const ts = [...(tamPorRef.get(item.ref) || [])].sort((a, b) => ordTam(a) - ordTam(b));
      item.info = [tec, ts.length ? ts.join(' ') : null].filter(Boolean).join('  ·  ');
      const cm = coresPorRef.get(item.ref);
      const todas = cm ? [...cm.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n) : [];
      const princ = [], resto = [];
      for (const n of todas) (CORES_PRINCIPAIS.includes(corKeyN(n)) ? princ : resto).push(n);
      princ.sort((a, b) => CORES_PRINCIPAIS.indexOf(corKeyN(a)) - CORES_PRINCIPAIS.indexOf(corKeyN(b)));
      item.cores = [...princ, ...resto];
      item.descricao = item.info + (item.cores.length ? '  ·  Cores: ' + item.cores.join(', ') : '');
    }

    // Preco de venda TikTok da CALCULADORA (payload prs "ref|tiktok") + niveis
    // de desconto pra agencia saber ate onde pode ir. Ailson 25/07/2026.
    const { data: calcRow } = await supabase.from('amicia_data').select('payload').eq('user_id', 'calc-meluni').maybeSingle();
    const prs = calcRow?.payload?.prs || {};
    for (const item of top) {
      const rn = item.ref;
      const bruto = prs[`${rn}|tiktok`] ?? prs[`${rn.padStart(4, '0')}|tiktok`] ?? prs[`0${rn}|tiktok`];
      const p = Number(bruto);
      item.preco = isFinite(p) && p > 0 ? p : null;
    }

    if (q.dry === '1') return res.status(200).json({ ok: true, de, ate, itens: top });

    // ── 4. Fotos (paralelo) ─────────────────────────────────────────────────
    const fotos = await Promise.all(top.map(i => buscarFoto(i.ref)));

    // ── 5. PDF A4, 12 itens por pagina = 2 paginas ──────────────────────────
    const probe = q.probe === '1'; // valida a geracao sem mandar o binario
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: 'Ranking de Vendas - Grupo Meluni - Exitus' } });
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
    const PER_PAGE = Math.max(8, Math.ceil(top.length / 3)); // 3 paginas, cards grandes (26/07/2026)

    const header = (pag) => {
      doc.rect(0, 0, W, pag === 1 ? 64 : 46).fill(INK);
      doc.fill('#ffffff').font('Helvetica-Bold').fontSize(pag === 1 ? 16 : 12)
        .text('Ranking de Vendas — Grupo Meluni · Exitus', ML, pag === 1 ? 14 : 12);
      doc.font('Helvetica').fontSize(pag === 1 ? 9.5 : 8.5).fillColor('#cdd8e0')
        .text(pag === 1
          ? 'Atacado moda feminina  ·  vendas da conta Exitus  ·  seleção pra estratégia TikTok Shop'
          : `Grupo Meluni · Exitus  ·  página ${pag}/${Math.ceil(top.length / PER_PAGE)}`, ML, pag === 1 ? 38 : 28);
      return (pag === 1 ? 64 : 46) + 10;
    };

    let pag = 1, y = header(1);
    const rowH = (842 - 74 - 24) / PER_PAGE; // ~62pt

    top.forEach((item, idx) => {
      if (idx > 0 && idx % PER_PAGE === 0) {
        doc.addPage(); pag += 1; y = header(pag);
      }
      const thumbW = 54, thumbH = rowH - 14;
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
      const colW = 118, colX = W - MR - colW;
      const tx = fx + thumbW + 12, tw = colX - tx - 10;
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10.5)
        .text(`REF ${item.ref}  ·  ${item.titulo}`, tx, y + 4, { width: tw, height: 24, ellipsis: true, lineBreak: true });
      doc.fillColor(MUT).font('Helvetica').fontSize(9)
        .text(item.info || ' ', tx, y + 30, { width: tw, height: 12, ellipsis: true });
      // bolinhas de cor (principais primeiro) + nome, ate 6 cores
      let cx = tx; const cy = y + 50;
      const visiveis = (item.cores || []).slice(0, 6);
      doc.font('Helvetica').fontSize(8);
      let mostradas = 0;
      visiveis.forEach((nome) => {
        const nomeW = doc.widthOfString(nome);
        if (cx + 10 + nomeW + 11 > tx + tw) return;
        doc.circle(cx + 3.6, cy, 3.6).lineWidth(0.5).fillAndStroke(corHex(nome), '#b8ae9e');
        doc.fillColor(MUT).text(nome, cx + 10, cy - 4, { lineBreak: false });
        cx += 10 + nomeW + 11;
        mostradas += 1;
      });
      if ((item.cores || []).length > mostradas) {
        doc.fillColor(MUT).font('Helvetica-Bold').text(`+${item.cores.length - mostradas} cores`, cx, cy - 4, { lineBreak: false });
      }
      // coluna direita: qtd/lancamento + precos TikTok
      if (item.lancamento) {
        doc.roundedRect(colX + colW - 84, y + 2, 84, 17, 5).fill('#fdf1e3');
        doc.fillColor('#b06a1a').font('Helvetica-Bold').fontSize(8.5)
          .text('LANÇAMENTO', colX + colW - 84, y + 7, { width: 84, align: 'center' });
      } else {
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(12)
          .text(`${Number(item.qtd).toLocaleString('pt-BR')} pçs`, colX, y + 2, { width: colW, align: 'right' });
        doc.fillColor(MUT).font('Helvetica').fontSize(7)
          .text('vendidas', colX, y + 15, { width: colW, align: 'right' });
      }
      if (item.preco) {
        const fmt = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const py = y + 30;
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
          .text(`TikTok  ${fmt(item.preco)}`, colX, py, { width: colW, align: 'right' });
        doc.fillColor(MUT).font('Helvetica').fontSize(8)
          .text(`-5%  ${fmt(item.preco * 0.95)}`, colX, py + 13, { width: colW, align: 'right' });
        doc.fillColor('#b06a1a').font('Helvetica').fontSize(8)
          .text(`-10%  ${fmt(item.preco * 0.90)}`, colX, py + 25, { width: colW, align: 'right' });
      }
      y += rowH;
    });

    doc.fillColor(MUT).font('Helvetica').fontSize(7.5)
      .text(`Gerado em ${new Date().toLocaleDateString('pt-BR')} · vendas da conta Exitus (pedidos atendidos) · cores e tamanhos = disponíveis em estoque`, ML, 842 - 22, { width: W - ML - MR, align: 'center' });

    doc.end();
  } catch (e) {
    console.error('[ranking-tiktok]', e?.message || e);
    if (!res.headersSent) res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
