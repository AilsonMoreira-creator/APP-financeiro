/**
 * wms-etiquetas.js — O MAÇO DE ETIQUETAS CASADAS (Ailson 12/08/2026)
 *
 * A ideia dele: em vez de imprimir etiquetas em ordem aleatória no Bling,
 * imprimir NF (DANFE simplificada) + etiqueta de transporte AGRUPADAS por
 * REF e localização — o casamento peça↔etiqueta acontece na arara, uma REF
 * por vez. Formato 10x15 (térmica).
 *
 * GET ?previa=1&contas=muniam&loja=todas&tipo=nf_transporte[&ref=2277][&corte=1]
 *   → JSON dos grupos (ref, loc, pedidos, com/sem NF) na ordem de impressão
 * GET ?pdf=1&mesmos filtros
 *   → PDF único: separador de REF (10x15) + DANFE + etiqueta ML por pedido
 *
 * Fontes: DANFE via Bling (linkDanfe — precisa do escopo NF-e na conta;
 * hoje só a Muniam tem). Etiqueta de transporte: Mercado Livre via API
 * oficial (shipment_labels em lote). Outros canais: fase 2.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { supabase, blingFetch, refreshBlingToken } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 300 };

const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
const n = (v) => Number(v) || 0;

async function pedidosFiltrados(q) {
  const contas = String(q.contas || 'todas');
  const loja = String(q.loja || 'todas');
  const tipo = String(q.tipo || 'nf_transporte');
  const ref = String(q.ref || '').replace(/^0+/, '');
  // corte=HH:MM (Ailson 12/08): só pedidos que entraram até o horário de corte
  // de HOJE — mesma lógica da lista de separação
  const corte = String(q.corte || '');
  let limiteCorte = null;
  if (/^\d{1,2}:\d{2}$/.test(corte)) {
    const [hh, mm] = corte.split(':').map(Number);
    const agora = new Date();
    const hojeBRT = new Date(agora.getTime() - 3 * 3600000).toISOString().slice(0, 10);
    limiteCorte = new Date(`${hojeBRT}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00-03:00`).getTime();
  }

  let sel = supabase.from('wms_pedidos')
    .select('conta, pedido_id, numero, numero_loja, canal_geral, ml_logistic_type, itens, status_wms, data_pedido')
    .in('status_wms', ['aberto', 'em_separacao'])
    .order('data_pedido', { ascending: true }).limit(400);
  if (contas !== 'todas') sel = sel.in('conta', contas.split(','));
  const { data: peds } = await sel;

  const out = [];
  for (const p of (peds || [])) {
    const canal = String(p.canal_geral || '');
    const flex = p.ml_logistic_type === 'self_service';
    const full = p.ml_logistic_type === 'fulfillment';
    if (full) continue; // equipe não encosta
    if (tipo === 'flex' && !flex) continue;
    if (tipo === 'meluni' && canal !== 'Meluni') continue;
    if (tipo === 'nf_transporte' && (flex || canal === 'Meluni')) continue;
    if (loja !== 'todas' && canal !== loja) continue;
    if (limiteCorte && new Date(p.data_pedido).getTime() > limiteCorte) continue;
    const it0 = (p.itens || [])[0] || {};
    const r = String(it0.ref || '?').replace(/^0+/, '');
    if (ref && r !== ref) continue;
    out.push({ ...p, ref: r, loc: String(it0.estoque || '—').toUpperCase() });
  }
  // ordem de impressão: REF → localização → data (ordem dele 12/08)
  out.sort((a, b) => a.ref.localeCompare(b.ref) || a.loc.localeCompare(b.loc) || String(a.data_pedido).localeCompare(String(b.data_pedido)));
  return out;
}

// links de etiqueta do Bling (só existem depois de gerada/casada no Bling)
async function linksEtiqueta(peds, tokenPorConta) {
  const mapa = {};
  for (const conta of new Set(peds.map(p => p.conta))) {
    if (!tokenPorConta[conta]) continue;
    const hb = { Authorization: 'Bearer ' + tokenPorConta[conta], Accept: 'application/json' };
    const ids = peds.filter(p => p.conta === conta).map(p => p.pedido_id);
    for (let i = 0; i < ids.length; i += 20) {
      const fatia = ids.slice(i, i + 20);
      const url = `https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=PDF&${fatia.map(id => `idsVendas[]=${id}`).join('&')}`;
      try {
        const r = await blingFetch(url, hb);
        const j = await r.json().catch(() => ({}));
        for (const e of (j?.data || [])) { if (e?.id && e?.link) mapa[String(e.id)] = e.link; }
      } catch { /* sem etiqueta nesta fatia */ }
      await new Promise(r2 => setTimeout(r2, 400));
    }
  }
  return mapa;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  try {
    const peds = await pedidosFiltrados(q);

    if (q.previa === '1') {
      const tk = {};
      for (const c of new Set(peds.map(p => p.conta))) tk[c] = await refreshBlingToken(c).catch(() => null);
      const links = await linksEtiqueta(peds.slice(0, 200), tk);
      const grupos = {};
      let prontas = 0;
      for (const p of peds) {
        const k = `${p.ref}·${p.loc}`;
        grupos[k] = grupos[k] || { loc: p.loc, ref: p.ref, pedidos: 0, prontas: 0, contas: new Set(), canais: new Set() };
        grupos[k].pedidos++;
        grupos[k].contas.add(p.conta);
        grupos[k].canais.add(p.canal_geral);
        if (links[String(p.pedido_id)]) { grupos[k].prontas++; prontas++; }
      }
      return res.status(200).json({
        total_pedidos: peds.length,
        prontas,
        aguardando: peds.length - prontas,
        grupos: Object.values(grupos).map(g => ({ ...g, contas: [...g.contas], canais: [...g.canais] })),
        nota: peds.length > 60 ? 'Acima de 60 pedidos a geração demora alguns minutos — considere gerar por REF.' : null,
      });
    }

    if (q.pdf !== '1' && q.debug !== '1') return res.status(400).json({ erro: 'use ?previa=1 ou ?pdf=1' });
    if (!peds.length) return res.status(404).json({ erro: 'nenhum pedido nos filtros' });
    const lote = peds.slice(0, 80);

    // tokens por conta (Bling) e por marca (ML)
    const tokenBling = {}; const tokenMl = {};
    for (const c of new Set(lote.map(p => p.conta))) {
      tokenBling[c] = await refreshBlingToken(c).catch(() => null);
      tokenMl[c] = await getValidToken(BRAND[c]).catch(() => null);
    }

    // ETIQUETA PELO BLING (12/08: PROVADO na Lumia, pedido Shein 70898) —
    // serve TODOS os marketplaces desde que a etiqueta já exista no Bling
    const linkBlingDe = await linksEtiqueta(lote, tokenBling);

    // shipment_ids do ML por pedido (RESERVA — só pros que o Bling não deu)
    const shipDe = {};
    for (const p of lote) {
      if (linkBlingDe[String(p.pedido_id)]) continue; // já tem etiqueta do Bling
      if (p.canal_geral !== 'Mercado Livre' || !tokenMl[p.conta] || !p.numero_loja) continue;
      try {
        const r = await fetch(`https://api.mercadolibre.com/orders/${p.numero_loja}`, { headers: { Authorization: `Bearer ${tokenMl[p.conta]}` } });
        const j = await r.json();
        if (j?.shipping?.id) shipDe[p.pedido_id] = { sid: String(j.shipping.id), conta: p.conta };
      } catch (e) { if (q.debug === '1') console.log('ship err', e.message); }
      await new Promise(r2 => setTimeout(r2, 120));
    }
    const dbg = { pedidos: lote.length, por_logistica: {}, shipments: Object.keys(shipDe).length, etiquetas_baixadas: 0, erros_etiqueta: [] };
    for (const p of lote) dbg.por_logistica[p.ml_logistic_type || p.canal_geral] = (dbg.por_logistica[p.ml_logistic_type || p.canal_geral] || 0) + 1;
    // etiquetas ML em lote por conta (PDF multi-página, uma por shipment, na ordem pedida)
    const etiquetaPdfPorSid = {};
    for (const conta of Object.keys(tokenMl)) {
      const sids = Object.values(shipDe).filter(x => x.conta === conta).map(x => x.sid);
      for (let i = 0; i < sids.length; i += 40) {
        const fatia = sids.slice(i, i + 40);
        try {
          const r = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${fatia.join(',')}&response_type=pdf`, { headers: { Authorization: `Bearer ${tokenMl[conta]}` } });
          if (r.ok && String(r.headers.get('content-type')).includes('pdf')) {
            const bytes = new Uint8Array(await r.arrayBuffer());
            const doc = await PDFDocument.load(bytes);
            fatia.forEach((sid, idx) => { if (idx < doc.getPageCount()) etiquetaPdfPorSid[sid] = { doc, pagina: idx }; });
            dbg.etiquetas_baixadas += Math.min(fatia.length, doc.getPageCount());
          } else {
            const txt = await r.text().catch(() => '');
            dbg.erros_etiqueta.push(`${conta} http ${r.status}: ${txt.slice(0, 220)}`);
          }
        } catch (e) { dbg.erros_etiqueta.push(`${conta}: ${e.message}`); }
      }
    }

    dbg.etiquetas_bling = Object.keys(linkBlingDe).length;
    if (q.debug === '1') return res.status(200).json(dbg);

    // monta o PDF final: separadores 10x15 + DANFE + etiqueta na ordem
    // 12/08 (ordem dele): a folha de impressão é SÓ etiqueta — nada de
    // pendências ou avisos no papel. Pedido sem etiqueta pronta não entra
    // (evita separador órfão); o que falta aparece na TELA.
    const prontos = lote.filter(p => linkBlingDe[String(p.pedido_id)] || (p.canal_geral === 'Mercado Livre' && tokenMl[p.conta]));
    if (!prontos.length) {
      return res.status(404).json({
        erro: 'Nenhuma etiqueta pronta nesses filtros.',
        detalhe: 'A etiqueta só existe depois de gerada no Bling (nasce junto com a NF). Pedidos ainda abertos não têm etiqueta.',
        pedidos_no_filtro: lote.length,
      });
    }

    const saida = await PDFDocument.create();
    const fonte = await saida.embedFont(StandardFonts.HelveticaBold);
    const fonteN = await saida.embedFont(StandardFonts.Helvetica);
    const P10x15 = [283.5, 425.2]; // 100x150mm em pt
    const semNf = []; const semEtiqueta = [];
    let grupoAtual = '';

    for (const p of prontos) {
      const k = `${p.ref}·${p.loc}`;
      if (k !== grupoAtual) {
        grupoAtual = k;
        const pg = saida.addPage(P10x15);
        const qtdG = prontos.filter(x => `${x.ref}·${x.loc}` === k).length;
        pg.drawText(`REF ${p.ref}`, { x: 24, y: 320, size: 54, font: fonte, color: rgb(0.17, 0.24, 0.31) });
        pg.drawText(`LOC ${p.loc}`, { x: 24, y: 262, size: 42, font: fonte, color: rgb(0.29, 0.50, 0.65) });
        pg.drawText(`${qtdG} pedido(s)`, { x: 24, y: 220, size: 24, font: fonteN });
        pg.drawText(String((p.itens?.[0]?.descLimpa || '')).slice(0, 34), { x: 24, y: 185, size: 13, font: fonteN, color: rgb(0.35, 0.35, 0.35) });
      }

      // DANFE do pedido (Bling, se a conta tem escopo)
      let danfeOk = false;
      if (tokenBling[p.conta]) {
        try {
          const hb = { Authorization: 'Bearer ' + tokenBling[p.conta], Accept: 'application/json' };
          const detR = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.pedido_id}`, hb);
          const det = detR.ok ? await detR.json() : {};
          const nfId = det?.data?.notaFiscal?.id;
          if (nfId) {
            const nfR = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, hb);
            const nf = nfR.ok ? await nfR.json() : {};
            const link = nf?.data?.linkDanfe || nf?.data?.linkPDF;
            if (link) {
              const dR = await fetch(link);
              if (dR.ok) {
                const dBytes = new Uint8Array(await dR.arrayBuffer());
                try {
                  const dDoc = await PDFDocument.load(dBytes);
                  const pgs = await saida.copyPages(dDoc, dDoc.getPageIndices());
                  pgs.forEach(pg => saida.addPage(pg));
                  danfeOk = true;
                } catch { /* link não era pdf */ }
              }
            }
          }
        } catch { /* sem danfe */ }
      }
      if (!danfeOk) semNf.push(p.numero);

      // etiqueta: Bling primeiro (qualquer marketplace), ML como reserva
      let etqOk = false;
      const linkB = linkBlingDe[String(p.pedido_id)];
      if (linkB) {
        try {
          const eR = await fetch(linkB);
          if (eR.ok) {
            const eDoc = await PDFDocument.load(new Uint8Array(await eR.arrayBuffer()));
            const pgs = await saida.copyPages(eDoc, eDoc.getPageIndices());
            pgs.forEach(pg => saida.addPage(pg));
            etqOk = true;
          }
        } catch { /* cai no fallback */ }
      }
      const sh = shipDe[p.pedido_id];
      if (etqOk) { /* pronto */ }
      else if (sh && etiquetaPdfPorSid[sh.sid]) {
        const { doc, pagina } = etiquetaPdfPorSid[sh.sid];
        const [pg] = await saida.copyPages(doc, [pagina]);
        saida.addPage(pg);
      } else {
        semEtiqueta.push(p.numero);
      }
    }

    const bytes = await saida.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=etiquetas-${new Date().toISOString().slice(0, 10)}.pdf`);
    return res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
