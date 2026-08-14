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

  // 13/08 (chave dada por ele): a FILA DE IMPRESSÃO é a SITUAÇÃO DA NF, não o
  // status do funil — "Autorizada sem DANFE" (situação 5) = precisa imprimir;
  // "Emitida DANFE" (6) = já saiu, inclusive se a Sthefany imprimiu no painel.
  // Por isso buscamos: (1) quem já tem NF (últimos 7 dias, qualquer status) e
  // (2) quem ainda está no funil sem NF (aparece como "aguardando").
  const hojeBRT = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const desde7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const COLS = 'conta, pedido_id, numero, numero_loja, canal_geral, ml_logistic_type, itens, status_wms, data_pedido, etiqueta_impressa_em, finalizado_em, nf_id';

  let q1 = supabase.from('wms_pedidos').select(COLS)
    .not('nf_id', 'is', null)
    .neq('status_wms', 'cancelado')
    .gte('data_pedido', desde7)
    .order('data_pedido', { ascending: false }).limit(500);
  if (contas !== 'todas') q1 = q1.in('conta', contas.split(','));

  let q2 = supabase.from('wms_pedidos').select(COLS)
    .is('nf_id', null)
    .in('status_wms', ['aberto', 'em_separacao'])
    .order('data_pedido', { ascending: true }).limit(300);
  if (contas !== 'todas') q2 = q2.in('conta', contas.split(','));

  const [{ data: comNf }, { data: semNf }] = await Promise.all([q1, q2]);
  const peds = [...(comNf || []), ...(semNf || [])];

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
  // ORDEM DE IMPRESSÃO (regra dele 13/08): localização A → todas as refs
  // daquela localização ordenadas por MAIOR QUANTIDADE → localização B → …
  // Com ?por_empresa=1 as empresas saem inteiras, uma depois da outra
  // (Exitus → Lumia → Muniam), cada uma com esse mesmo critério interno.
  const ORDEM_CONTA = { exitus: 0, lumia: 1, muniam: 2 };
  const qtdPorGrupo = {};
  for (const p of out) {
    const k = `${q.por_empresa === '1' ? p.conta : ''}|${p.loc}|${p.ref}`;
    qtdPorGrupo[k] = (qtdPorGrupo[k] || 0) + 1;
  }
  const chaveDe = (p) => `${q.por_empresa === '1' ? p.conta : ''}|${p.loc}|${p.ref}`;
  const locOrdem = (l) => (l === '—' ? 'zzz' : l); // sem localização por último
  out.sort((a, b) =>
    (q.por_empresa === '1' ? (ORDEM_CONTA[a.conta] ?? 9) - (ORDEM_CONTA[b.conta] ?? 9) : 0)
    || locOrdem(a.loc).localeCompare(locOrdem(b.loc))
    || (qtdPorGrupo[chaveDe(b)] - qtdPorGrupo[chaveDe(a)])
    || a.ref.localeCompare(b.ref)
    || String(a.data_pedido).localeCompare(String(b.data_pedido))
  );
  return out;
}

// SITUAÇÃO DA NF POR PEDIDO (12/08, achado do Ailson): o Bling diferencia
// "Autorizada" (situação 5 = SEM DANFE impressa) de "Emitida DANFE"
// (situação 6 = já impressa) — vale inclusive quando a Sthefany imprime
// pelo painel. A listagem de NFs traz numeroPedidoLoja, que casa com o
// numero_loja do wms_pedidos sem precisar abrir pedido por pedido.
async function situacaoPorNfId(contas, tokenPorConta, desde) {
  const mapa = {};
  for (const conta of contas) {
    if (!tokenPorConta[conta]) continue;
    const hb = { Authorization: 'Bearer ' + tokenPorConta[conta], Accept: 'application/json' };
    for (let pagina = 1; pagina <= 8; pagina++) {
      const url = `https://api.bling.com.br/Api/v3/nfe?tipo=1&dataEmissaoInicial=${desde}&limite=100&pagina=${pagina}`;
      let j = {};
      try {
        const r = await blingFetch(url, hb);
        j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
      } catch { break; }
      const lista = j?.data || [];
      for (const nf of lista) if (nf?.id) mapa[String(nf.id)] = nf.situacao;
      if (lista.length < 100) break;
      await new Promise(r2 => setTimeout(r2, 350));
    }
  }
  return mapa;
}

// preenche wms_pedidos.nf_id dos que ainda não têm (única fonte é o detalhe
// do pedido); limitado por chamada pra respeitar o rate limit do Bling
async function preencherNfIds(peds, tokenPorConta, maximo = 40) {
  const alvo = peds.filter(p => !p.nf_id).slice(0, maximo);
  for (const p of alvo) {
    if (!tokenPorConta[p.conta]) continue;
    try {
      const hb = { Authorization: 'Bearer ' + tokenPorConta[p.conta], Accept: 'application/json' };
      const r = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.pedido_id}`, hb);
      const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
      const nfId = j?.data?.notaFiscal?.id;
      if (nfId) {
        p.nf_id = nfId;
        await supabase.from('wms_pedidos').update({ nf_id: nfId, nf_checado_em: new Date().toISOString() }).eq('pedido_id', p.pedido_id);
      }
    } catch { /* segue */ }
    await new Promise(r2 => setTimeout(r2, 350));
  }
}

// links de etiqueta do Bling (só existem depois de gerada/casada no Bling)
/**
 * ATENÇÃO (13/08, regra do Ailson): puxar a etiqueta MUDA O ESTADO NO
 * MARKETPLACE — na Shein o pedido vira "aguardando coleta" só de baixar o
 * arquivo, mesmo sem imprimir, e isso confunde a equipe. Por isso esta função
 * só pode ser chamada no MOMENTO REAL da impressão (?zpl=1 / ?pdf=1), nunca
 * na prévia, no debug ou em cron. O parâmetro `motivo` documenta a origem.
 */
async function linksEtiqueta(peds, tokenPorConta, motivo = 'impressao') {
  if (motivo !== 'impressao') {
    console.warn('[etiquetas] chamada bloqueada fora da impressão:', motivo);
    return {};
  }
  const mapa = {};
  for (const conta of new Set(peds.map(p => p.conta))) {
    if (!tokenPorConta[conta]) continue;
    const hb = { Authorization: 'Bearer ' + tokenPorConta[conta], Accept: 'application/json' };
    const ids = peds.filter(p => p.conta === conta).map(p => p.pedido_id);
    // ATENÇÃO (13/08): se UM id do lote não tiver logística cadastrada, o
    // Bling rejeita o LOTE INTEIRO. Então: tenta em lote (rápido quando todos
    // têm) e, se falhar, cai pra individual — assim um pedido sem etiqueta
    // não esconde os que estão prontos.
    for (let i = 0; i < ids.length; i += 20) {
      const fatia = ids.slice(i, i + 20);
      let achouNoLote = false;
      try {
        const url = `https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=PDF&${fatia.map(id => `idsVendas[]=${id}`).join('&')}`;
        const r = await blingFetch(url, hb);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        for (const e of (j?.data || [])) { if (e?.id && e?.link) { mapa[String(e.id)] = e.link; achouNoLote = true; } }
      } catch { /* cai no individual */ }
      await new Promise(r2 => setTimeout(r2, 350));
      if (!achouNoLote) {
        for (const id of fatia) {
          try {
            const r = await blingFetch(`https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=PDF&idsVendas[]=${id}`, hb);
            const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
            const link = j?.data?.[0]?.link;
            if (link) mapa[String(id)] = link;
          } catch { /* segue */ }
          await new Promise(r2 => setTimeout(r2, 340));
        }
      }
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
      const contasSet = new Set(peds.map(p => p.conta));
      for (const c of contasSet) tk[c] = await refreshBlingToken(c).catch(() => null);
      // PRÉVIA LEVE (13/08): classifica SÓ pela situação da NF — consultar a
      // etiqueta de cada pedido derrubava a tela por tempo. A etiqueta é
      // buscada de verdade só na hora de gerar (PDF/ZPL).
      const desdeNf = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      await preencherNfIds(peds.filter(p => !p.nf_id && p.status_wms !== 'aberto'), tk, 20);
      const sitDe = await situacaoPorNfId([...contasSet], tk, desdeNf);
      const links = {};
      const grupos = {};
      let prontas = 0, jaImpressas = 0, semEtiqueta = 0;
      for (const p of peds) {
        const k = `${q.por_empresa === '1' ? p.conta + '·' : ''}${p.loc}·${p.ref}`;
        grupos[k] = grupos[k] || { loc: p.loc, ref: p.ref, empresa: q.por_empresa === '1' ? p.conta : null, pedidos: 0, prontas: 0, impressas: 0, contas: new Set(), canais: new Set() };
        grupos[k].pedidos++;
        grupos[k].contas.add(p.conta);
        grupos[k].canais.add(p.canal_geral);
        // REGRA (13/08): situação 6 = DANFE já emitida → já impressa;
        // situação 5 = autorizada sem DANFE → PRECISA IMPRIMIR (se a etiqueta
        // já existe no Bling); sem NF ainda → aguardando
        const sit = p.nf_id ? sitDe[String(p.nf_id)] : null;
        if (sit === 6 || p.etiqueta_impressa_em) { grupos[k].impressas++; jaImpressas++; }
        else if (sit === 5) { grupos[k].prontas++; prontas++; }
        else semEtiqueta++;
      }
      return res.status(200).json({
        total_pedidos: peds.length,
        prontas,
        ja_impressas: jaImpressas,
        aguardando: semEtiqueta,
        grupos: Object.values(grupos).map(g => ({ ...g, contas: [...g.contas], canais: [...g.canais] })),
        nota: peds.length > 60 ? 'Acima de 60 pedidos a geração demora alguns minutos — considere gerar por REF.' : null,
      });
    }

    // ── MODO ZPL (13/08): a etiqueta do Bling vem em ZPL dentro de um ZIP —
    // é o formato NATIVO da térmica. Com o QZ Tray na máquina da expedição,
    // mandamos o ZPL direto: mais rápido e mais nítido que PDF.
    if (q.zpl === '1') {
      const { unzipSync } = await import('fflate');
      const tk = {};
      const contasSet = new Set(peds.map(p => p.conta));
      for (const c of contasSet) tk[c] = await refreshBlingToken(c).catch(() => null);
      const links = await linksEtiqueta(peds.slice(0, 120), tk, 'impressao');
      await preencherNfIds(peds.filter(p => links[String(p.pedido_id)]), tk, 60);
      const sitDe = await situacaoPorNfId([...contasSet], tk, new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));

      const alvo = peds.filter(p => links[String(p.pedido_id)]
        && (q.reimprimir === '1'
          || (!p.etiqueta_impressa_em && sitDe[String(p.nf_id)] === 5)));

      const blocos = []; const idsOk = []; let grupoAtual = '';
      for (const p of alvo.slice(0, 120)) {
        const k = `${q.por_empresa === '1' ? p.conta + '·' : ''}${p.loc}·${p.ref}`;
        if (k !== grupoAtual) {
          grupoAtual = k;
          const qtd = alvo.filter(x => `${q.por_empresa === '1' ? x.conta + '·' : ''}${x.loc}·${x.ref}` === k).length;
          // etiqueta separadora 10x15 em ZPL (203dpi: 812x1218 pontos)
          blocos.push({ tipo: 'separador', ref: p.ref, loc: p.loc, empresa: p.conta, pedidos: qtd, zpl:
            `^XA^CI28^PW812^LL1218^LH0,0
^FO40,120^A0N,110,110^FD${q.por_empresa === '1' ? String(p.conta).toUpperCase() : ''}^FS
^FO40,260^A0N,170,170^FDLOC ${p.loc}^FS
^FO40,460^A0N,170,170^FDREF ${p.ref}^FS
^FO40,680^A0N,80,80^FD${qtd} etiqueta(s)^FS
^FO40,800^A0N,50,50^FD${String(p.itens?.[0]?.descLimpa || '').slice(0, 30).replace(/[\^~]/g, '')}^FS
^FO40,900^GB730,6,6^FS
^XZ` });
        }
        try {
          const r = await fetch(links[String(p.pedido_id)]);
          const bytes = new Uint8Array(await r.arrayBuffer());
          let zpl = null;
          if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
            const z = unzipSync(bytes);
            const nomeZpl = Object.keys(z).find(n => /\.txt$|zpl/i.test(n));
            if (nomeZpl) zpl = Buffer.from(z[nomeZpl]).toString('utf8');
          } else if (String.fromCharCode(bytes[0], bytes[1]) === '^X') {
            zpl = Buffer.from(bytes).toString('utf8');
          }
          if (zpl) { blocos.push({ tipo: 'etiqueta', pedido: p.numero, ref: p.ref, loc: p.loc, zpl }); idsOk.push(p.pedido_id); }
        } catch { /* pula essa etiqueta */ }
        await new Promise(r2 => setTimeout(r2, 120));
      }
      return res.status(200).json({ total: idsOk.length, blocos, ids: idsOk });
    }

    // ── marcar como impressas depois que a térmica confirmou
    if (q.marcar === '1' && q.ids) {
      const ids = String(q.ids).split(',').map(x => parseInt(x)).filter(Boolean);
      const lote = `T${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
      if (ids.length) {
        await supabase.from('wms_pedidos')
          .update({ etiqueta_impressa_em: new Date().toISOString(), etiqueta_lote: lote })
          .in('pedido_id', ids);
      }
      return res.status(200).json({ marcados: ids.length, lote });
    }

    if (q.pdf !== '1' && q.debug !== '1') return res.status(400).json({ erro: 'use ?previa=1, ?zpl=1 ou ?pdf=1' });
    if (!peds.length) return res.status(404).json({ erro: 'nenhum pedido nos filtros' });
    const lote = peds.slice(0, 80);

    // tokens por conta (Bling) e por marca (ML)
    const tokenBling = {}; const tokenMl = {};
    for (const c of new Set(lote.map(p => p.conta))) {
      tokenBling[c] = await refreshBlingToken(c).catch(() => null);
      tokenMl[c] = await getValidToken(BRAND[c]).catch(() => null);
    }

    // ETIQUETA PELO BLING — só quando é impressão de verdade (o debug não
    // pode disparar isso: mexeria no status da Shein sem imprimir nada)
    const linkBlingDe = q.debug === '1' ? {} : await linksEtiqueta(lote, tokenBling, 'impressao');

    // shipment_ids do ML por pedido (RESERVA — só pros que o Bling não deu)
    const shipDe = {};
    for (const p of (q.debug === '1' ? [] : lote)) {
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
    // TRAVA (12/08, pedido dele): pedido com etiqueta JÁ IMPRESSA fica de fora
    // por padrão — só entra com ?reimprimir=1 (escolha consciente na tela)
    const desdeNf2 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    await preencherNfIds(lote, tokenBling, 60);
    const sitDe2 = await situacaoPorNfId([...new Set(lote.map(p => p.conta))], tokenBling, desdeNf2);
    // situação 5 = autorizada sem DANFE (imprime) · 6 = já emitida (não)
    const podeImprimir = (p) => q.reimprimir === '1'
      || (!p.etiqueta_impressa_em && sitDe2[String(p.nf_id)] === 5);
    const prontos = lote.filter(p => podeImprimir(p)
      && (linkBlingDe[String(p.pedido_id)] || (p.canal_geral === 'Mercado Livre' && tokenMl[p.conta])));
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
      const k = `${q.por_empresa === '1' ? p.conta + '·' : ''}${p.loc}·${p.ref}`;
      if (k !== grupoAtual) {
        grupoAtual = k;
        const pg = saida.addPage(P10x15);
        const qtdG = prontos.filter(x => `${q.por_empresa === '1' ? x.conta + '·' : ''}${x.loc}·${x.ref}` === k).length;
        if (q.por_empresa === '1') {
          pg.drawText(String(p.conta).toUpperCase(), { x: 24, y: 378, size: 26, font: fonte, color: rgb(0.45, 0.42, 0.36) });
        }
        pg.drawText(`LOC ${p.loc}`, { x: 24, y: 320, size: 48, font: fonte, color: rgb(0.17, 0.24, 0.31) });
        pg.drawText(`REF ${p.ref}`, { x: 24, y: 262, size: 48, font: fonte, color: rgb(0.29, 0.50, 0.65) });
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

    // REGISTRO: o que entrou neste PDF fica marcado como impresso (com lote),
    // pra ninguém imprimir duas vezes nem esquecer nenhum
    const lotePdf = `L${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
    const idsImpressos = [];
    for (const p of prontos) {
      if (linkBlingDe[String(p.pedido_id)] || shipDe[p.pedido_id]) idsImpressos.push(p.pedido_id);
    }
    if (idsImpressos.length) {
      await supabase.from('wms_pedidos')
        .update({ etiqueta_impressa_em: new Date().toISOString(), etiqueta_lote: lotePdf })
        .in('pedido_id', idsImpressos);
    }

    const bytes = await saida.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=etiquetas-${new Date().toISOString().slice(0, 10)}.pdf`);
    return res.status(200).send(Buffer.from(bytes));
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
