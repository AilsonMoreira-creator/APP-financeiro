// _wms-ml-etiquetas.js — etiquetas direto da API do MERCADO LIVRE (20/08)
//
// Arquitetura aprovada pelo Ailson (doc de análise 20/08, item 2): para
// pedidos do ML a fonte PRIMÁRIA da etiqueta é o ZPL2 ORIGINAL da API
// (/shipment_labels?response_type=zpl2) — formato nativo da Zebra, zero
// transformação. A DANFE vem separada (linkPDF do Bling). A casada do
// Bling (PDF deitado cortado) vira FALLBACK quando a API do ML falhar.
//
// ATENÇÃO: baixar a etiqueta pela API MARCA o envio como "printed" no
// painel do ML — por isso esta função só pode rodar no momento real da
// impressão (ou no preparo do Flex, que sempre funcionou assim).
import { getValidToken } from './_ml-helpers.js';

const espera = (ms) => new Promise(r => setTimeout(r, ms));
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

/**
 * lista = [{ pedido_id, numero_loja }] da MESMA conta.
 * Devolve { pedido_id: { formato:'ZPL'|'PDF', conteudo, bytes } }.
 */
export async function etiquetasDoMl(lista, conta) {
  const out = {};
  const token = await getValidToken(BRAND[conta]).catch(() => null);
  if (!token) return out;
  const h = { Authorization: `Bearer ${token}` };

  // pedido → shipment
  // 21/08 (diag dos pedidos 9585/9586 muniam): compra em CARRINHO faz o
  // Bling gravar o numeroLoja como PACK id — /orders/{pack} dá 404
  // "Order do not exists". Fallback: /packs/{id} → primeira order → shipment.
  const shipDe = {};
  for (const p of lista) {
    if (!p.numero_loja) continue;
    try {
      let sid = null;
      const r = await fetch(`https://api.mercadolibre.com/orders/${p.numero_loja}`, { headers: h });
      if (r.ok) {
        const j = await r.json();
        sid = j?.shipping?.id || null;
      }
      if (!sid) {
        const rp = await fetch(`https://api.mercadolibre.com/packs/${p.numero_loja}`, { headers: h });
        if (rp.ok) {
          const jp = await rp.json();
          // a ORDER de dentro do pack tem o shipment VIGENTE (o do pack pode
          // ser um envio antigo cancelado quando o comprador mudou a entrega)
          const ordId = jp?.orders?.[0]?.id;
          if (ordId) {
            const ro = await fetch(`https://api.mercadolibre.com/orders/${ordId}`, { headers: h });
            if (ro.ok) sid = (await ro.json())?.shipping?.id || null;
          }
          if (!sid) sid = jp?.shipment?.id || null;
        }
      }
      if (sid) shipDe[String(sid)] = p.pedido_id;
    } catch { /* segue */ }
    await espera(120);
  }
  const sids = Object.keys(shipDe);

  // RESERVA: se o ZPL não vier utilizável, pega o PDF — 25/08: UM POR VEZ.
  // O lote casava página↔pedido por POSIÇÃO (uma página faltante deslocava
  // tudo e a etiqueta de um colava no par de outro). Um request por shipment
  // garante o casamento; e o shipment é consultado antes: envio programado
  // (buffered/data futura) volta marcado pra ser SEGURADO no lote normal.
  const pdfEmLote = async (fatia) => {
    try {
      const { PDFDocument } = await import('pdf-lib');
      for (const sid of fatia) {
        const pedido = shipDe[sid];
        if (!pedido || out[String(pedido)]) continue;
        try {
          const rS = await fetch(`https://api.mercadolibre.com/shipments/${sid}`, { headers: h });
          const jS = rS.ok ? await rS.json() : null;
          if (jS && (jS.substatus === 'buffered')) {
            const dataLim = jS?.shipping_option?.estimated_handling_limit?.date || null;
            out[String(pedido)] = { formato: 'AGENDADO', agendado_em: dataLim ? String(dataLim).slice(0, 10) : null };
            await espera(150); continue;
          }
          const r = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${sid}&response_type=pdf&label_type=label`, { headers: h });
          if (r.ok) {
            const bytes = new Uint8Array(await r.arrayBuffer());
            const doc = await PDFDocument.load(bytes);
            if (doc.getPageCount() >= 1) {
              const uma = await PDFDocument.create();
              const [pg] = await uma.copyPages(doc, [0]);
              uma.addPage(pg);
              const b64 = Buffer.from(await uma.save()).toString('base64');
              out[String(pedido)] = { formato: 'PDF', conteudo: b64, bytes: b64.length };
            }
          }
        } catch { /* este sid fica sem etiqueta */ }
        await espera(150);
      }
    } catch { /* sem etiqueta */ }
  };

  for (let i = 0; i < sids.length; i += 40) {
    const fatia = sids.slice(i, i + 40);
    try {
      const r = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${fatia.join(',')}&response_type=zpl2&label_type=label`, { headers: h });
      if (!r.ok) continue;
      // o ML entrega o ZPL DENTRO DE UM ZIP (um arquivo por etiqueta)
      const bytes = new Uint8Array(await r.arrayBuffer());
      let textos = [];
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        const { unzipSync } = await import('fflate');
        const z = unzipSync(bytes);
        for (const nome of Object.keys(z)) {
          const arq = Buffer.from(z[nome]).toString('utf8');
          const sidNoNome = (String(nome).match(/(\d{6,})/) || [])[1];
          // 26/08 (caso 155915: um ARQUIVO trouxe o lote inteiro — 11 blocos
          // ^XA — e foi atribuido a UM pedido, que reimprimiu as etiquetas de
          // todo mundo): a unidade de pareamento e o BLOCO, nunca o arquivo.
          // O sid do nome so vale quando o arquivo tem um unico bloco.
          const blocosArq = arq.split(/(?=\^XA)/).filter(x => x.trim().startsWith('^XA'));
          for (const b of blocosArq) textos.push({ sid: blocosArq.length === 1 ? sidNoNome : null, conteudo: b });
        }
      } else {
        const txt = Buffer.from(bytes).toString('utf8');
        textos = txt.split(/(?=\^XA)/).filter(x => x.trim().startsWith('^XA')).map(conteudo => ({ sid: null, conteudo }));
      }
      // 25/08 (teste em escala): o casamento por POSICAO (fatia[idx]) podia
      // colar a etiqueta de um pedido no par de OUTRO quando o zip vinha fora
      // de ordem ou com item a menos. Agora o shipment id tem que aparecer no
      // NOME ou DENTRO do proprio ZPL — sem prova, a etiqueta e descartada
      // (o par nao sai e o pedido fica pendente, nunca sai trocado).
      textos.forEach((t) => {
        let sid = (t.sid && shipDe[t.sid]) ? t.sid : null;
        if (!sid && t.conteudo) sid = fatia.find(s => t.conteudo.includes(String(s))) || null;
        const pedido = sid ? shipDe[sid] : null;
        if (pedido && t.conteudo) {
          const ja = out[String(pedido)];
          const conteudo = (ja && ja.formato === 'ZPL') ? ja.conteudo + t.conteudo : t.conteudo;
          out[String(pedido)] = { formato: 'ZPL', conteudo, bytes: conteudo.length };
        }
      });
    } catch { /* segue */ }
    // 25/08 (protecao pedida por ele: NUNCA mais etiqueta esticada por PDF sem
    // necessidade): quem ficou sem ZPL no lote ganha uma SEGUNDA tentativa de
    // ZPL individual (request de 1 sid = casamento direto). So quem falhar as
    // duas cai na reserva em PDF — e mesmo assim 1 a 1, do pedido certo.
    const semZpl = fatia.filter(sid => !out[String(shipDe[sid])]);
    for (const sid of semZpl) {
      try {
        const r1 = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${sid}&response_type=zpl2&label_type=label`, { headers: h });
        if (r1.ok) {
          const b1 = new Uint8Array(await r1.arrayBuffer());
          let conteudo = null;
          if (b1[0] === 0x50 && b1[1] === 0x4b) {
            const { unzipSync } = await import('fflate');
            const z1 = unzipSync(b1);
            const nomes = Object.keys(z1);
            if (nomes.length) conteudo = Buffer.from(z1[nomes[0]]).toString('utf8');
          } else {
            const t1 = Buffer.from(b1).toString('utf8');
            if (t1.includes('^XA')) conteudo = t1;
          }
          if (conteudo && conteudo.includes('^XA')) {
            out[String(shipDe[sid])] = { formato: 'ZPL', conteudo, bytes: conteudo.length };
          }
        }
      } catch { /* fica pra reserva */ }
      await espera(180);
    }
    const aindaSemNada = fatia.filter(sid => !out[String(shipDe[sid])]);
    if (aindaSemNada.length) await pdfEmLote(aindaSemNada);
    await espera(200);
  }
  return out;
}
