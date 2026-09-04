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
import { etiquetasDoMl } from './_wms-ml-etiquetas.js';
import { getValidToken } from './_ml-helpers.js';
import crypto from 'crypto';

export const config = { maxDuration: 300 };
const espera = (ms) => new Promise(r => setTimeout(r, ms));
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 32);
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };

// 20/08: visual do ZPL pra prévia — renderiza no labelary e guarda; falha
// fica REGISTRADA na linha (tipo PREVIA_PNG com erro) pra não sumir no catch
async function guardarPreviaPng(pedido_id, conta, zpl) {
  try {
    const rz = await fetch('https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'image/png' }, body: zpl,
    });
    if (!rz.ok) {
      await supabase.from('wms_documentos').upsert({ pedido_id, conta, tipo: 'PREVIA_PNG', erro: `labelary http ${rz.status}` }, { onConflict: 'pedido_id,tipo' });
      return;
    }
    const png64 = Buffer.from(await rz.arrayBuffer()).toString('base64');
    await supabase.from('wms_documentos').upsert({
      pedido_id, conta, tipo: 'PREVIA_PNG', formato: 'PNG',
      conteudo: png64, bytes: png64.length, hash: hash(png64), origem: 'labelary', erro: null,
    }, { onConflict: 'pedido_id,tipo' });
  } catch (e2) {
    await supabase.from('wms_documentos').upsert({ pedido_id, conta, tipo: 'PREVIA_PNG', erro: String(e2.message).slice(0, 200) }, { onConflict: 'pedido_id,tipo' });
  }
}

/** baixa o arquivo da etiqueta e devolve {formato, conteudo, bytes} */
async function baixarDocumento(link) {
  const r = await fetch(link);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {            // ZIP do Bling
    const { unzipSync } = await import('fflate');
    const z = unzipSync(bytes);
    const nomeZ = Object.keys(z).find(n => /\.txt$|zpl/i.test(n));
    const nomeP = Object.keys(z).find(n => /\.pdf$/i.test(n));
    if (nomeZ) {
      // 19/08: o zip da casada (Shopee) traz a DANFE em PDF junto do ZPL — era
      // descartada aqui e o pedido preparado saía na térmica sem a nota
      const danfe = nomeP ? Buffer.from(z[nomeP]).toString('base64') : null;
      return { formato: 'ZPL', conteudo: Buffer.from(z[nomeZ]).toString('utf8'), bytes: z[nomeZ].length, danfe };
    }
    if (nomeP) return { formato: 'PDF', conteudo: Buffer.from(z[nomeP]).toString('base64'), bytes: z[nomeP].length };
    return null;
  }
  if (bytes[0] === 0x25) return { formato: 'PDF', conteudo: Buffer.from(bytes).toString('base64'), bytes: bytes.length };
  if (String.fromCharCode(bytes[0], bytes[1]) === '^X') return { formato: 'ZPL', conteudo: Buffer.from(bytes).toString('utf8'), bytes: bytes.length };
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ?debug_flex=1&conta=exitus — por que a etiqueta do Flex não vem?
  if (req.query?.debug_flex === '1') {
    const conta = String(req.query?.conta || 'exitus');
    const { data: lista } = await supabase.from('wms_pedidos')
      .select('pedido_id, numero, numero_loja, ml_logistic_type')
      .eq('conta', conta).eq('print_regra', 'MELI_FLEX').eq('print_estado', 'PRONTO').limit(2);
    const out = { conta, amostra: lista, passos: [] };
    const token = await getValidToken(BRAND[conta]).catch(e => { out.passos.push({ token: e.message }); return null; });
    out.passos.push({ token: token ? 'ok' : 'sem token' });
    if (token && lista?.[0]) {
      const h = { Authorization: `Bearer ${token}` };
      const r1 = await fetch(`https://api.mercadolibre.com/orders/${lista[0].numero_loja}`, { headers: h });
      const j1 = await r1.json();
      out.passos.push({ order: r1.status, shipping_id: j1?.shipping?.id || null, msg: j1?.message || null });
      const sid = j1?.shipping?.id;
      if (sid) {
        for (const tipo of ['zpl2', 'pdf']) {
          const r2 = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${sid}&response_type=${tipo}`, { headers: h });
          const ct = String(r2.headers.get('content-type'));
          const corpo = ct.includes('json') ? (await r2.text()).slice(0, 250) : `(${ct})`;
          out.passos.push({ etiqueta: tipo, http: r2.status, tipo: ct, corpo });
        }
      }
    }
    // roda a função de verdade e mostra o que ela devolveu
    try {
      const teste = await etiquetasDoMl((lista || []).slice(0, 2), conta);
      out.resultado_funcao = Object.entries(teste).map(([pid, d]) => ({ pedido_id: pid, formato: d.formato, bytes: d.bytes }));
      out.qtd = Object.keys(teste).length;
    } catch (e) { out.erro_funcao = String(e.message).slice(0, 300); }
    return res.status(200).json(out);
  }
  const limite = Math.min(parseInt(req.query?.limite) || 120, 300);
  const contas = String(req.query?.contas || 'exitus,lumia,muniam').split(',').map(c => c.trim());
  const incluirShein = req.query?.incluir_shein === '1';
  const inicio = Date.now();
  const r = { preparados: 0, ja_tinham: 0, sem_etiqueta: 0, erros: 0, por_conta: {}, shein_de_fora: 0 };

  try {
    // quem precisa de etiqueta e está PRONTO
    let sel = supabase.from('wms_pedidos')
      .select('pedido_id, conta, numero, numero_loja, canal_geral, ml_logistic_type, print_estado, print_etiqueta')
      // 04/09 (38 presos: "etiqueta ainda nao gerada no Bling"): AGUARDA_LOGISTICA
      // e revisitado a cada preparo — quando o Bling libera a etiqueta, volta PRONTO
      .in('print_estado', ['PRONTO', 'AGUARDA_LOGISTICA']).eq('print_etiqueta', true)
      .in('conta', contas)
      .is('etiqueta_impressa_em', null)
      .order('data_pedido', { ascending: true }).limit(600);
    const { data: candidatos } = await sel;

    // já guardados não repetem (idempotência) — EXCETO quem tem etiqueta ZPL
    // sem DANFE guardada (19/08): o preparo antigo jogava fora a DANFE que
    // vinha no zip da Shopee; esses voltam pra fila pra re-baixar o zip.
    const ids = (candidatos || []).map(p => p.pedido_id);
    const guardados = new Set();
    const temDanfe = new Set();
    const temPrevia = new Set();
    const formatoDe = {};
    for (let i = 0; i < ids.length; i += 300) {
      const { data } = await supabase.from('wms_documentos')
        .select('pedido_id, tipo, formato').in('pedido_id', ids.slice(i, i + 300));
      (data || []).forEach(d => {
        if (d.tipo === 'ETIQUETA') { guardados.add(String(d.pedido_id)); formatoDe[String(d.pedido_id)] = d.formato; }
        if (d.tipo === 'DANFE') temDanfe.add(String(d.pedido_id));
        if (d.tipo === 'PREVIA_PNG') temPrevia.add(String(d.pedido_id));
      });
    }
    // Flex fica FORA do re-preparo: a etiqueta dele vem do ML e não existe
    // DANFE no zip — sem esta exceção o mesmo pedido re-preparava toda rodada
    const ehFlex = new Set((candidatos || []).filter(p2 => p2.ml_logistic_type === 'self_service').map(p2 => String(p2.pedido_id)));
    for (const k of [...guardados]) {
      if (formatoDe[k] === 'ZPL' && !temDanfe.has(k) && !ehFlex.has(k)) guardados.delete(k);   // re-prepara (danfe do zip)
      // ZPL sem visual re-prepara UMA vez: depois a linha PREVIA_PNG existe
      // (com png ou com o erro registrado) e o pedido não volta mais
      else if (formatoDe[k] === 'ZPL' && !temPrevia.has(k)) guardados.delete(k);
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
          if (d.formato === 'ZPL') await guardarPreviaPng(p.pedido_id, conta, d.conteudo);
          c.ok++; c.flex++; r.preparados++;
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
            // 19/08: a DANFE que veio no zip vira documento próprio — na hora
            // de imprimir o par sai do cache, sem depender do linkDanfe
            if (doc.danfe) {
              await supabase.from('wms_documentos').upsert({
                pedido_id: p.pedido_id, conta, tipo: 'DANFE', formato: 'PDF',
                conteudo: doc.danfe, bytes: doc.danfe.length,
                hash: hash(doc.danfe), origem: 'bling', erro: null,
              }, { onConflict: 'pedido_id,tipo' });
            }
            // 20/08 (cron 7:50): o VISUAL do ZPL fica pronto no preparo — a
            // prévia de manhã sai do cache em segundos
            if (doc.formato === 'ZPL') await guardarPreviaPng(p.pedido_id, conta, doc.conteudo);
            // 04/09: estava preso como "aguarda logistica" e o Bling liberou — volta PRONTO
            if (p.print_estado === 'AGUARDA_LOGISTICA') {
              await supabase.from('wms_pedidos').update({ print_estado: 'PRONTO', print_motivo: 'nota autorizada, pronto pra imprimir' }).eq('pedido_id', p.pedido_id);
              r.destravados = (r.destravados || 0) + 1;
            }
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
