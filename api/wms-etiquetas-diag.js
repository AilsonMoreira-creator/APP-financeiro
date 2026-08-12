/**
 * wms-etiquetas-diag.js — a API do Bling entrega NF (DANFE) + etiqueta de
 * transporte por pedido? (Ailson 11/08/2026 — ondas de separação por maço de
 * etiquetas casadas, ordenadas por REF ou só Flex)
 *
 * GET ?conta=exitus&limite=2  → pega pedidos atendidos recentes do
 * wms_pedidos, abre o detalhe no Bling e caça: notaFiscal (id → /nfe/{id},
 * procurando link do DANFE) e transporte/etiqueta. Só leitura.
 */
import https from 'node:https';
import { supabase, blingFetch, refreshBlingToken } from './_bling-helpers.js';

// GET com BODY JSON (schema histórico do /logisticas/etiquetas — o guia dele
// 12/08 confirma; fetch/undici recusam body em GET, o https nativo envia)
function getComBody(url, headers, bodyObj) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const body = JSON.stringify(bodyObj);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (r) => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, contentType: r.headers['content-type'], corpo: Buffer.concat(chunks) }));
    });
    req.on('error', (e) => resolve({ status: 0, erro: e.message }));
    req.write(body);
    req.end();
  });
}

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus');
  const limite = Math.min(parseInt(req.query?.limite) || 2, 4);
  try {
    const token = await refreshBlingToken(conta);
    const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' };

    // ?emitir=1&pedido_id=X — TESTE DE EMISSÃO (12/08, rollout Muniam):
    // replica o clique manual dele: gerar NF do pedido → enviar pra SEFAZ.
    // Anti-duplicidade: aborta se o pedido já aponta uma NF.
    if (req.query?.emitir === '1' && req.query?.pedido_id) {
      const pid = String(req.query.pedido_id);
      const saida = { conta, pedido_id: pid, passos: [] };
      const detR = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${pid}`, headers);
      const det = detR.ok && typeof detR.json === 'function' ? await detR.json() : {};
      // SEGURANÇA (12/08): se o detalhe não vier (429/erro), ABORTA — presumir
      // "sem NF" aqui geraria nota duplicada. Falha fechada, nunca aberta.
      if (!det?.data || !Object.keys(det.data).length) {
        saida.passos.push({ passo: 'checagem', resultado: `ABORTADO — não consegui ler o pedido (http ${detR.status}). Nada gerado.` });
        return res.status(200).json(saida);
      }
      const jaTem = det?.data?.notaFiscal?.id;
      saida.numero_pedido = det?.data?.numero;
      if (jaTem) {
        saida.passos.push({ passo: 'checagem', resultado: `JÁ TEM NF (id ${jaTem}) — nada gerado` });
        return res.status(200).json(saida);
      }
      saida.passos.push({ passo: 'checagem', resultado: 'sem NF — ok pra gerar' });

      // grade de candidatos — PARA no primeiro que não for 404 de rota
      // (evita gerar NF duplicada). O /gerar-nfe do v3 respondeu 404 em 12/08.
      const candidatos = [
        ['a', 'POST', `https://api.bling.com.br/Api/v3/pedidos/vendas/${pid}/gerar-nfe`, '{}'],
        ['b', 'POST', `https://api.bling.com.br/Api/v3/pedidos/vendas/${pid}/gerar-nota-fiscal`, '{}'],
        ['c', 'POST', `https://api.bling.com.br/Api/v3/pedidos/vendas/${pid}/notas-fiscais`, '{}'],
        ['d', 'POST', 'https://api.bling.com.br/Api/v3/nfe', JSON.stringify({ idPedidoVenda: Number(pid), tipo: 1, finalidade: 1 })],
        ['e', 'POST', `https://api.bling.com.br/Api/v3/nfe/pedidos-vendas/${pid}`, '{}'],
      ];
      let ger = {}; let nfId = null;
      for (const [tag, metodo, url, body] of candidatos) {
        const r = await fetch(url, { method: metodo, headers: { ...headers, 'Content-Type': 'application/json' }, body });
        const j = await r.json().catch(() => ({}));
        const rota404 = r.status === 404 && String(j?.error?.message || '').includes('Não encontrado');
        saida.passos.push({ passo: `gerar[${tag}]`, http: r.status, resposta: JSON.stringify(j).slice(0, 260) });
        if (!rota404) { ger = j; nfId = j?.data?.id || j?.data?.idNotaFiscal || null; break; }
        await new Promise(r2 => setTimeout(r2, 350));
      }
      if (!nfId) return res.status(200).json(saida);

      const envR = await fetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}/enviar`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' });
      const env = await envR.json().catch(() => ({}));
      saida.passos.push({ passo: 'enviar-sefaz', http: envR.status, resposta: JSON.stringify(env).slice(0, 400) });

      await new Promise(r => setTimeout(r, 4000));
      const nfR = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, headers);
      const nf = nfR.ok ? await nfR.json() : {};
      const n = nf?.data || {};
      saida.passos.push({ passo: 'situacao-final', situacao: n.situacao, numero: n.numero, serie: n.serie, chave: (n.chaveAcesso || '').slice(0, 12) + '…', linkDanfe: n.linkDanfe ? 'TEM' : null });
      saida.nf_id = nfId;
      return res.status(200).json(saida);
    }

    // ?dump_pedido=1&pedido_id=X — estrutura crua do pedido (pra montar a NF)
    if (req.query?.dump_pedido === '1' && req.query?.pedido_id) {
      const r = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${req.query.pedido_id}`, headers);
      const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
      const d = j?.data || {};
      if (!Object.keys(d).length) {
        return res.status(200).json({ http: r.status, ok: r.ok, corpo: JSON.stringify(j).slice(0, 300), aviso: 'detalhe vazio (429/rate limit?) — checagem de NF NÃO é confiável assim' });
      }
      const it0 = (d.itens || [])[0] || {};
      // naturezas de operação disponíveis (a NF precisa apontar uma)
      const natR = await blingFetch('https://api.bling.com.br/Api/v3/naturezas-operacoes?limite=10', headers);
      const nat = await natR.json().catch(() => ({}));
      return res.status(200).json({
        pedido_chaves: Object.keys(d),
        numero: d.numero, data: d.data, totalProdutos: d.totalProdutos, total: d.total,
        contato: d.contato,
        loja: d.loja, numeroLoja: d.numeroLoja,
        item_exemplo: it0,
        itens_qtd: (d.itens || []).length,
        transporte: d.transporte,
        naturezas: (nat?.data || []).map(x => ({ id: x.id, descricao: x.descricao, padrao: x.padrao })),
      });
    }

    // ?logistica_teste=1&pedido_id=X — rotas candidatas de etiqueta no Bling
    if (req.query?.logistica_teste === '1') {
      const pid = String(req.query?.pedido_id || '');
      const t = {};
      for (const [nome, url] of [
        ['logisticas', 'https://api.bling.com.br/Api/v3/logisticas?limite=3'],
        ['etq_idsVendas_colchete', `https://api.bling.com.br/Api/v3/logisticas/etiquetas?idsVendas[]=${pid}&formato=PDF`],
        ['etq_idsVendas_simples', `https://api.bling.com.br/Api/v3/logisticas/etiquetas?idsVendas=${pid}&formato=PDF`],
        ['etq_idsObjetos', `https://api.bling.com.br/Api/v3/logisticas/etiquetas?idsObjetos[]=${pid}&formato=PDF`],
        ['objetos_lista', 'https://api.bling.com.br/Api/v3/logisticas/objetos?limite=3'],
        ['remessas_lista', 'https://api.bling.com.br/Api/v3/logisticas/remessas?limite=3'],
      ]) {
        try {
          const r = await blingFetch(url, headers);
          const j = await r.json().catch(() => ({}));
          t[nome] = { http: r.status, corpo: JSON.stringify(j).slice(0, 350) };
        } catch (e) { t[nome] = { erro: e.message }; }
        await new Promise(r2 => setTimeout(r2, 350));
      }
      // schema histórico: GET com body {idsVendas:[...]} — nas duas variações de formato
      for (const fmt of ['PDF', 'ZPL']) {
        const r = await getComBody(`https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=${fmt}`, headers, { idsVendas: [Number(pid)] });
        const ct = String(r.contentType || '');
        t[`etq_body_${fmt}`] = {
          http: r.status, contentType: ct,
          corpo: ct.includes('pdf') ? `BINÁRIO PDF ${r.corpo?.length} bytes 🎯` : String(r.corpo || r.erro || '').slice(0, 350),
        };
        await new Promise(r2 => setTimeout(r2, 400));
      }
      return res.status(200).json({ conta, pedido_id: pid, tentativas: t });
    }

    // pedidos recentes finalizados (têm NF) e um flex se houver
    const { data: peds } = await supabase.from('wms_pedidos')
      .select('pedido_id, numero, numero_loja, canal_geral, ml_logistic_type, status_wms')
      .eq('conta', conta).eq('status_wms', 'finalizado')
      .order('data_pedido', { ascending: false }).limit(limite);

    const saida = [];
    for (const p of (peds || [])) {
      const item = { pedido: p.numero, numero_loja: p.numero_loja, canal: p.canal_geral, logistica: p.ml_logistic_type };
      // 1. detalhe do pedido: referências de NF e transporte
      const detR = await blingFetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${p.pedido_id}`, headers);
      const det = detR.ok ? await detR.json() : {};
      const d = det?.data || {};
      item.notaFiscal_ref = d.notaFiscal || null;
      item.transporte_chaves = d.transporte ? Object.keys(d.transporte) : null;
      item.transporte_etiqueta = d.transporte?.etiqueta || null;
      item.transporte_volumes = (d.transporte?.volumes || []).map(v => ({ id: v.id, servico: v.servico, codigoRastreamento: v.codigoRastreamento }));

      // 2. a NF em si (link do DANFE?)
      const nfId = d.notaFiscal?.id;
      if (nfId) {
        const nfR = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, headers);
        const nf = nfR.ok ? await nfR.json() : {};
        const n = nf?.data || {};
        item.nfe = { chaves: Object.keys(n), situacao: n.situacao, numero: n.numero,
          linkDanfe: n.linkDanfe || n.linkPDF || n.linkPdf || n.link || null,
          xml: n.xml ? 'tem' : null };
      }

      // 3. candidatos de etiqueta de logística (rotas possíveis do v3)
      const idObj = d.transporte?.volumes?.[0]?.id;
      if (idObj) {
        for (const rota of [
          `https://api.bling.com.br/Api/v3/logisticas/objetos/${idObj}`,
          `https://api.bling.com.br/Api/v3/logisticas/etiquetas?idsObjetos[]=${idObj}`,
        ]) {
          try {
            const rR = await blingFetch(rota, headers);
            const r = await rR.json().catch(() => ({}));
            item[rota.includes('etiquetas') ? 'rota_etiquetas' : 'rota_objeto'] =
              r?.data ? JSON.stringify(r.data).slice(0, 400) : JSON.stringify(r).slice(0, 250);
          } catch (e) { item[rota.includes('etiquetas') ? 'rota_etiquetas' : 'rota_objeto'] = `erro: ${String(e.message).slice(0, 120)}`; }
        }
      }
      saida.push(item);
      await new Promise(r => setTimeout(r, 400));
    }
    return res.status(200).json({ conta, pedidos: saida });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
