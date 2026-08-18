/**
 * full-envio.js — travas de 72h, geração da remessa e PDF (Ailson 17/08/2026)
 *
 * POST ?acao=confirmar        { ref, linhas:[{cor,tam,qtd}] }  → trava 72h
 * POST ?acao=fora_da_semana   { ref }                          → REF fora
 * GET  ?acao=pendentes                                         → o que está travado
 * POST ?acao=gerar            { data_envio, por }              → remessa + PDF
 * GET  ?acao=pdf&remessa=123                                   → baixa o PDF
 *
 * O PDF sai com UMA MATRIZ POR REFERÊNCIA (cores nas linhas, tamanhos nas
 * colunas), no mesmo padrão das matrizes das Oficinas e do WMS.
 */
import { supabase } from './_bling-helpers.js';

export const config = { maxDuration: 120 };
const n = (v) => Number(v) || 0;
const HORAS72 = 72 * 3600 * 1000;
const ORDEM_TAM = { PP: 0, P: 1, M: 2, G: 3, GG: 4, G1: 5, G2: 6, G3: 7 };

async function montarPdf(remessa, decisoes) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // agrupa por REF → cor → tam
  const porRef = {};
  for (const d of decisoes) {
    if (!n(d.qtd_enviada)) continue;
    const r = porRef[d.ref] = porRef[d.ref] || { cores: {}, tams: new Set(), total: 0 };
    r.cores[d.cor] = r.cores[d.cor] || {};
    r.cores[d.cor][d.tam] = n(d.qtd_enviada);
    r.tams.add(d.tam);
    r.total += n(d.qtd_enviada);
  }

  const A4 = [595.28, 841.89];
  let pg = doc.addPage(A4);
  let y = A4[1] - 50;
  const dataBr = String(remessa.data_envio).split('-').reverse().join('/');

  pg.drawText('ENVIO PARA O FULL', { x: 40, y, size: 18, font: bold, color: rgb(0.17, 0.24, 0.31) });
  pg.drawText(`Envio previsto: ${dataBr}`, { x: 40, y: y - 20, size: 11, font: fonte, color: rgb(0.35, 0.42, 0.5) });
  pg.drawText(`${remessa.total_pecas} peças · ${remessa.total_skus} SKUs · remessa #${remessa.id}`,
    { x: 40, y: y - 35, size: 11, font: fonte, color: rgb(0.35, 0.42, 0.5) });
  y -= 62;

  for (const [ref, dados] of Object.entries(porRef)) {
    const tams = [...dados.tams].sort((a, b) => (ORDEM_TAM[a] ?? 9) - (ORDEM_TAM[b] ?? 9));
    const cores = Object.keys(dados.cores).sort();
    const alturaBloco = 42 + (cores.length + 1) * 20;
    if (y - alturaBloco < 50) { pg = doc.addPage(A4); y = A4[1] - 50; }

    pg.drawText(`REF ${ref}`, { x: 40, y, size: 14, font: bold, color: rgb(0.17, 0.24, 0.31) });
    pg.drawText(`${dados.total} peças`, { x: 480, y, size: 11, font: bold, color: rgb(0.29, 0.5, 0.65) });
    y -= 20;

    // cabeçalho da matriz
    const x0 = 40, larguraCor = 150, larguraCel = 52;
    pg.drawRectangle({ x: x0, y: y - 4, width: larguraCor + tams.length * larguraCel + larguraCel, height: 18, color: rgb(0.29, 0.5, 0.65) });
    pg.drawText('COR', { x: x0 + 6, y, size: 9, font: bold, color: rgb(1, 1, 1) });
    tams.forEach((t, i) => pg.drawText(t, { x: x0 + larguraCor + i * larguraCel + 16, y, size: 9, font: bold, color: rgb(1, 1, 1) }));
    pg.drawText('TOTAL', { x: x0 + larguraCor + tams.length * larguraCel + 8, y, size: 9, font: bold, color: rgb(1, 1, 1) });
    y -= 20;

    for (const cor of cores) {
      let totalCor = 0;
      pg.drawText(String(cor).slice(0, 22), { x: x0 + 6, y, size: 10, font: fonte, color: rgb(0.17, 0.24, 0.31) });
      tams.forEach((t, i) => {
        const q = n(dados.cores[cor][t]);
        totalCor += q;
        if (q) pg.drawText(String(q), { x: x0 + larguraCor + i * larguraCel + 18, y, size: 11, font: bold, color: rgb(0.17, 0.24, 0.31) });
        else pg.drawText('—', { x: x0 + larguraCor + i * larguraCel + 20, y, size: 9, font: fonte, color: rgb(0.7, 0.7, 0.7) });
      });
      pg.drawText(String(totalCor), { x: x0 + larguraCor + tams.length * larguraCel + 12, y, size: 11, font: bold, color: rgb(0.29, 0.5, 0.65) });
      pg.drawLine({ start: { x: x0, y: y - 5 }, end: { x: x0 + larguraCor + (tams.length + 1) * larguraCel, y: y - 5 }, thickness: 0.4, color: rgb(0.9, 0.88, 0.85) });
      y -= 20;
    }
    y -= 16;
  }
  return Buffer.from(await doc.save());
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-User');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const acao = String(req.query?.acao || '');
  const usuario = String(req.headers['x-user'] || req.query?.user || 'equipe');

  try {
    // ── o que está travado (pra tela principal saber o que entra no envio) ──
    if (acao === 'pendentes') {
      const { data } = await supabase.from('full_travas')
        .select('*').is('usada_em', null).gt('vence_em', new Date().toISOString());
      const refs = {};
      for (const t of (data || [])) {
        const r = refs[t.ref] = refs[t.ref] || { ref: t.ref, tipo: t.tipo, pecas: 0, skus: 0, vence_em: t.vence_em };
        if (t.tipo === 'confirmado') { r.pecas += n(t.qtd); r.skus++; }
      }
      return res.status(200).json({ refs: Object.values(refs) });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});

    // ── trava de 72h: confirma as quantidades da REF ──
    if (acao === 'confirmar') {
      const ref = String(body.ref || '').replace(/^0+/, '');
      const vence = new Date(Date.now() + HORAS72).toISOString();
      await supabase.from('full_travas').delete().eq('ref', ref).is('usada_em', null);
      const linhas = (body.linhas || []).filter(l => n(l.qtd) > 0).map(l => ({
        ref, cor: l.cor, tam: l.tam, tipo: 'confirmado', qtd: n(l.qtd),
        vence_em: vence, criado_por: usuario,
      }));
      if (linhas.length) await supabase.from('full_travas').insert(linhas);
      return res.status(200).json({ ok: true, travados: linhas.length, vence_em: vence });
    }

    if (acao === 'fora_da_semana') {
      const ref = String(body.ref || '').replace(/^0+/, '');
      await supabase.from('full_travas').delete().eq('ref', ref).is('usada_em', null);
      await supabase.from('full_travas').insert({
        ref, tipo: 'fora_da_semana', vence_em: new Date(Date.now() + HORAS72).toISOString(), criado_por: usuario,
      });
      return res.status(200).json({ ok: true });
    }

    // ── gera a remessa: grava decisões (aprendizado) e monta o PDF ──
    if (acao === 'gerar') {
      if (!body.data_envio) return res.status(400).json({ erro: 'informe a data prevista de envio' });

      const { data: travas } = await supabase.from('full_travas')
        .select('*').eq('tipo', 'confirmado').is('usada_em', null).gt('vence_em', new Date().toISOString());
      if (!travas?.length) return res.status(400).json({ erro: 'nenhuma referência confirmada' });

      const totalPecas = travas.reduce((s, t) => s + n(t.qtd), 0);
      const { data: remessa } = await supabase.from('full_remessas').insert({
        data_envio: body.data_envio, gerado_por: usuario,
        total_skus: travas.length, total_pecas: totalPecas,
        // 1ª checagem 24h depois da data informada (domingo não conta)
        proxima_checagem: new Date(new Date(body.data_envio).getTime() + 24 * 3600 * 1000).toISOString(),
      }).select().single();

      // decisões: o que o sistema sugeriu × o que foi enviado (aprendizado)
      const decisoes = travas.map(t => ({
        remessa_id: remessa.id, ref: t.ref, cor: t.cor, tam: t.tam,
        qtd_enviada: n(t.qtd), decidido_por: t.criado_por,
      }));
      await supabase.from('full_decisoes').insert(decisoes);
      await supabase.from('full_travas').update({ usada_em: new Date().toISOString() })
        .in('id', travas.map(t => t.id));

      return res.status(200).json({ ok: true, remessa_id: remessa.id, pecas: totalPecas, skus: travas.length });
    }

    // ── PDF de uma remessa ──
    if (acao === 'pdf') {
      const id = req.query?.remessa;
      const { data: remessa } = await supabase.from('full_remessas').select('*').eq('id', id).maybeSingle();
      if (!remessa) return res.status(404).json({ erro: 'remessa não encontrada' });
      const { data: decisoes } = await supabase.from('full_decisoes').select('*').eq('remessa_id', id);
      const pdf = await montarPdf(remessa, decisoes || []);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="full-${remessa.data_envio}.pdf"`);
      return res.status(200).send(pdf);
    }

    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
