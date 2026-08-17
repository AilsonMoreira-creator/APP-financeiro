/**
 * wms-preparar-lote.js — PREPARA os documentos antes do clique (Ailson 17/08)
 *
 * O clique em imprimir não pode disparar dezenas de chamadas. Este worker
 * busca as etiquetas com antecedência e guarda em wms_documentos; a impressão
 * depois só monta o PDF/ZPL com o que já está guardado.
 *
 * REGRA DELE: a SHEIN fica fora do preparo — baixar a etiqueta dela muda o
 * status do pedido no marketplace ("aguardando coleta"), então só no clique
 * final, quando a mercadoria vai sair de verdade.
 *
 * Trabalho fatiado e retomável: cada rodada pega até `limite` pedidos que
 * ainda não têm documento guardado. Rodar de novo continua de onde parou.
 *
 * GET ?limite=120[&contas=exitus,lumia,muniam][&incluir_shein=1]
 */
import { supabase, blingFetch, refreshBlingToken } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';
import crypto from 'crypto';

export const config = { maxDuration: 300 };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 32);
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

/**
 * Etiqueta de FLEX vem do MERCADO LIVRE, não do Bling (17/08). Pedimos em
 * ZPL, que é o formato nativo da térmica, em lotes de 40 shipments.
 * Devolve { pedido_id: {formato:'ZPL', conteudo} }.
 */
async function etiquetasDoMl(lista, conta) {
  const out = {};
  const token = await getValidToken(BRAND[conta]).catch(() => null);
  if (!token) return out;
  const h = { Authorization: `Bearer ${token}` };

  // pedido → shipment
  const shipDe = {};
  for (const p of lista) {
    if (!p.numero_loja) continue;
    try {
      const r = await fetch(`https://api.mercadolibre.com/orders/${p.numero_loja}`, { headers: h });
      const j = await r.json();
      if (j?.shipping?.id) shipDe[String(j.shipping.id)] = p.pedido_id;
    } catch { /* segue */ }
    await espera(120);
  }
  const sids = Object.keys(shipDe);
  for (let i = 0; i < sids.length; i += 40) {
    const fatia = sids.slice(i, i + 40);
    try {
      const r = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${fatia.join(',')}&response_type=zpl2`, { headers: h });
      if (!r.ok) continue;
      const txt = await r.text();
      // o ML devolve as etiquetas concatenadas: cada uma começa em ^XA
      const partes = txt.split(/(?=\^XA)/).filter(x => x.trim().startsWith('^XA'));
      fatia.forEach((sid, idx) => {
        if (partes[idx]) out[String(shipDe[sid])] = { formato: 'ZPL', conteudo: partes[idx], bytes: partes[idx].length };
      });
    } catch { /* segue */ }
    await espera(200);
  }
  return out;
}

/** baixa o arquivo da etiqueta e devolve {formato, conteudo, bytes} */
async function baixarDocumento(link) {
  const r = await fetch(link);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {            // ZIP do Bling
    const { unzipSync } = await import('fflate');
    const z = unzipSync(bytes);
    const nomeZ = Object.keys(z).find(n => /\.txt$|zpl/i.test(n));
    if (nomeZ) return { formato: 'ZPL', conteudo: Buffer.from(z[nomeZ]).toString('utf8'), bytes: z[nomeZ].length };
    const nomeP = Object.keys(z).find(n => /\.pdf$/i.test(n));
    if (nomeP) return { formato: 'PDF', conteudo: Buffer.from(z[nomeP]).toString('base64'), bytes: z[nomeP].length };
    return null;
  }
  if (bytes[0] === 0x25) return { formato: 'PDF', conteudo: Buffer.from(bytes).toString('base64'), bytes: bytes.length };
  if (String.fromCharCode(bytes[0], bytes[1]) === '^X') return { formato: 'ZPL', conteudo: Buffer.from(bytes).toString('utf8'), bytes: bytes.length };
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const limite = Math.min(parseInt(req.query?.limite) || 120, 300);
  const contas = String(req.query?.contas || 'exitus,lumia,muniam').split(',').map(c => c.trim());
  const incluirShein = req.query?.incluir_shein === '1';
  const inicio = Date.now();
  const r = { preparados: 0, ja_tinham: 0, sem_etiqueta: 0, erros: 0, por_conta: {}, shein_de_fora: 0 };

  try {
    // quem precisa de etiqueta e está PRONTO
    let sel = supabase.from('wms_pedidos')
      .select('pedido_id, conta, numero, numero_loja, canal_geral, ml_logistic_type, print_estado, print_etiqueta')
      .eq('print_estado', 'PRONTO').eq('print_etiqueta', true)
      .in('conta', contas)
      .is('etiqueta_impressa_em', null)
      .order('data_pedido', { ascending: true }).limit(600);
    const { data: candidatos } = await sel;

    // já guardados não repetem (idempotência)
    const ids = (candidatos || []).map(p => p.pedido_id);
    const guardados = new Set();
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from('wms_documentos')
        .select('pedido_id').eq('tipo', 'ETIQUETA').in('pedido_id', ids.slice(i, i + 300));
      (data || []).forEach(d => guardados.add(String(d.pedido_id)));
    }

    const fila = [];
    for (const p of (candidatos || [])) {
      if (guardados.has(String(p.pedido_id))) { r.ja_tinham++; continue; }
      if (!incluirShein && /shein/i.test(p.canal_geral || '')) { r.shein_de_fora++; continue; }
      fila.push(p);
      if (fila.length >= limite) break;
    }

    // as 3 contas em PARALELO (tokens e limites independentes)
    const porConta = {};
    for (const p of fila) (porConta[p.conta] = porConta[p.conta] || []).push(p);

    await Promise.all(Object.entries(porConta).map(async ([conta, listaInicial]) => {
      let lista = listaInicial;
      const c = r.por_conta[conta] = { fila: lista.length, flex: 0, ok: 0, sem_etiqueta: 0, erro: 0 };
      let token;
      try { token = await refreshBlingToken(conta); } catch { c.erro = lista.length; return; }
      const h = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

      // FLEX: a etiqueta é do ML, o Bling não tem. Resolve antes, em lote.
      const flex = lista.filter(p => p.ml_logistic_type === 'self_service');
      if (flex.length) {
        const doMl = await etiquetasDoMl(flex, conta);
        for (const p of flex) {
          const d = doMl[String(p.pedido_id)];
          if (!d) continue;
          await supabase.from('wms_documentos').upsert({
            pedido_id: p.pedido_id, conta, tipo: 'ETIQUETA', formato: d.formato,
            conteudo: d.conteudo, bytes: d.bytes, hash: hash(d.conteudo), origem: 'ml', erro: null,
          }, { onConflict: 'pedido_id,tipo' });
          c.ok++; r.preparados++;
        }
        const resolvidos = new Set(Object.keys(doMl));
        lista = lista.filter(p => !resolvidos.has(String(p.pedido_id)));
      }

      // demais: Bling em lote de 20 (rápido); se recusar, cai pra individual
      for (let i = 0; i < lista.length; i += 20) {
        if (Date.now() - inicio > 250000) { c.aviso = 'tempo esgotado — rode de novo pra continuar'; break; }
        const fatia = lista.slice(i, i + 20);
        const links = {};
        try {
          const url = `https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=PDF&${fatia.map(p => `idsVendas[]=${p.pedido_id}`).join('&')}`;
          const rr = await blingFetch(url, h);
          const j = typeof rr.json === 'function' ? await rr.json().catch(() => ({})) : {};
          for (const e of (j?.data || [])) {
            if (!e?.id || !e?.link) continue;
            links[String(e.id)] = e.link;
            const doPedido = fatia.find(p => String(p.pedido_id) === String(e.id));
            if (doPedido) links[String(doPedido.pedido_id)] = e.link;
          }
        } catch { /* cai no individual */ }
        await espera(340);

        for (const p of fatia) {
          if (Date.now() - inicio > 260000) break;
          let link = links[String(p.pedido_id)];
          if (!link) {
            try {
              const rr = await blingFetch(`https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=PDF&idsVendas[]=${p.pedido_id}`, h);
              const j = typeof rr.json === 'function' ? await rr.json().catch(() => ({})) : {};
              link = j?.data?.[0]?.link;
              await espera(340);
            } catch { /* segue */ }
          }
          if (!link) {
            c.sem_etiqueta++; r.sem_etiqueta++;
            await supabase.from('wms_pedidos').update({
              print_estado: 'AGUARDA_LOGISTICA', print_motivo: 'etiqueta ainda não gerada no Bling',
            }).eq('pedido_id', p.pedido_id);
            continue;
          }
          try {
            const doc = await baixarDocumento(link);
            if (!doc) { c.erro++; r.erros++; continue; }
            await supabase.from('wms_documentos').upsert({
              pedido_id: p.pedido_id, conta, tipo: 'ETIQUETA',
              formato: doc.formato, conteudo: doc.conteudo, bytes: doc.bytes,
              hash: hash(doc.conteudo), origem: 'bling', erro: null,
            }, { onConflict: 'pedido_id,tipo' });
            c.ok++; r.preparados++;
          } catch (e) {
            c.erro++; r.erros++;
            await supabase.from('wms_documentos').upsert({
              pedido_id: p.pedido_id, conta, tipo: 'ETIQUETA', erro: String(e.message).slice(0, 200),
            }, { onConflict: 'pedido_id,tipo' });
          }
        }
      }
    }));

    r.segundos = Math.round((Date.now() - inicio) / 1000);
    r.faltam = Math.max(0, (candidatos || []).length - r.ja_tinham - r.preparados - r.sem_etiqueta - r.shein_de_fora);
    return res.status(200).json(r);
  } catch (e) {
    return res.status(500).json({ erro: e.message, parcial: r });
  }
}
