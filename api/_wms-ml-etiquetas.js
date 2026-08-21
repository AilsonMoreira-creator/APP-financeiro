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
          sid = jp?.shipment?.id || null;
          const ordId = jp?.orders?.[0]?.id;
          if (!sid && ordId) {
            const ro = await fetch(`https://api.mercadolibre.com/orders/${ordId}`, { headers: h });
            if (ro.ok) sid = (await ro.json())?.shipping?.id || null;
          }
        }
      }
      if (sid) shipDe[String(sid)] = p.pedido_id;
    } catch { /* segue */ }
    await espera(120);
  }
  const sids = Object.keys(shipDe);

  // RESERVA: se o ZPL não vier utilizável, pega o PDF em lote — o ML devolve
  // UMA PÁGINA POR ETIQUETA, na ordem dos shipment_ids.
  const pdfEmLote = async (fatia) => {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const r = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${fatia.join(',')}&response_type=pdf&label_type=label`, { headers: h });
      if (!r.ok) return;
      const bytes = new Uint8Array(await r.arrayBuffer());
      const doc = await PDFDocument.load(bytes);
      for (let idx = 0; idx < fatia.length && idx < doc.getPageCount(); idx++) {
        const uma = await PDFDocument.create();
        const [pg] = await uma.copyPages(doc, [idx]);
        uma.addPage(pg);
        const b64 = Buffer.from(await uma.save()).toString('base64');
        const pedido = shipDe[fatia[idx]];
        if (pedido) out[String(pedido)] = { formato: 'PDF', conteudo: b64, bytes: b64.length };
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
          const conteudo = Buffer.from(z[nome]).toString('utf8');
          const sidNoNome = (String(nome).match(/(\d{6,})/) || [])[1];
          textos.push({ sid: sidNoNome, conteudo });
        }
      } else {
        const txt = Buffer.from(bytes).toString('utf8');
        textos = txt.split(/(?=\^XA)/).filter(x => x.trim().startsWith('^XA')).map(conteudo => ({ sid: null, conteudo }));
      }
      textos.forEach((t, idx) => {
        const sid = (t.sid && shipDe[t.sid]) ? t.sid : fatia[idx];
        const pedido = shipDe[sid];
        if (pedido && t.conteudo) out[String(pedido)] = { formato: 'ZPL', conteudo: t.conteudo, bytes: t.conteudo.length };
      });
    } catch { /* segue */ }
    if (!fatia.some(sid => out[String(shipDe[sid])])) await pdfEmLote(fatia);
    await espera(200);
  }
  return out;
}
