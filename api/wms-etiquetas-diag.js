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

    // ?transmitir=1&nf_id=X[&pedido_id=Y] — envia à SEFAZ uma NF JÁ GERADA
    // (idempotente: consulta a situação antes; não reenvia autorizada)
    if (req.query?.transmitir === '1' && req.query?.nf_id) {
      const nfId = String(req.query.nf_id);
      const out = { conta, nf_id: nfId, passos: [] };
      const aR = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, headers);
      const a = typeof aR.json === 'function' ? await aR.json().catch(() => ({})) : {};
      const sit = a?.data?.situacao;
      out.passos.push({ passo: 'situacao-antes', situacao: sit, numero: a?.data?.numero, serie: a?.data?.serie });
      if (sit === undefined) { out.passos.push({ passo: 'abortado', motivo: `não consegui ler a NF (http ${aR.status})` }); return res.status(200).json(out); }
      if (sit === 5) { out.passos.push({ passo: 'abortado', motivo: 'já AUTORIZADA — nada a fazer' }); return res.status(200).json(out); }
      if (sit === 8) { out.passos.push({ passo: 'abortado', motivo: 'aguardando protocolo — não reenviar' }); return res.status(200).json(out); }

      const eR = await fetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}/enviar?enviarEmail=false`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
      });
      const e = await eR.json().catch(() => ({}));
      out.passos.push({ passo: 'enviar-sefaz', http: eR.status, resposta: JSON.stringify(e).slice(0, 300) });

      await new Promise(r => setTimeout(r, 6000));
      const bR = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, headers);
      const b = typeof bR.json === 'function' ? await bR.json().catch(() => ({})) : {};
      const d2 = b?.data || {};
      const NOME_SIT = { 1: 'pendente', 4: 'REJEITADA', 5: 'AUTORIZADA', 8: 'aguardando protocolo', 9: 'denegada', 11: 'bloqueada' };
      out.passos.push({ passo: 'situacao-final', situacao: d2.situacao, nome: NOME_SIT[d2.situacao] || '?', numero: d2.numero, serie: d2.serie, chave: String(d2.chaveAcesso || '').slice(0, 20) + '…', linkDanfe: d2.linkDanfe ? 'TEM' : null });

      if (req.query?.pedido_id) {
        const etqR = await blingFetch(`https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=PDF&idsVendas[]=${req.query.pedido_id}`, headers);
        const etq = typeof etqR.json === 'function' ? await etqR.json().catch(() => ({})) : {};
        out.passos.push({ passo: 'etiqueta', http: etqR.status, tem_link: !!etq?.data?.[0]?.link });
      }
      return res.status(200).json(out);
    }

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

      // FLUXO OFICIAL (guia dele 12/08): gerar-nfe A PARTIR DO PEDIDO — o
      // Bling monta a nota com as regras fiscais dele; o app NÃO reconstrói
      // nada. Envio à SEFAZ só com ?sefaz=1 (default: gera e para, pra ele
      // conferir no painel).
      const gerR = await fetch(`https://api.bling.com.br/Api/v3/pedidos/vendas/${pid}/gerar-nfe`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
      });
      const ger = await gerR.json().catch(() => ({}));
      saida.passos.push({ passo: 'gerar-nfe', http: gerR.status, resposta: JSON.stringify(ger).slice(0, 400) });
      const nfId = ger?.data?.id || ger?.data?.idNotaFiscal || null;
      if (!nfId) return res.status(200).json(saida);
      saida.nf_id = nfId;

      // situação da nota gerada (nunca assumir autorizada por HTTP 200)
      const nf1R = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, headers);
      const nf1 = typeof nf1R.json === 'function' ? await nf1R.json().catch(() => ({})) : {};
      saida.passos.push({ passo: 'situacao-apos-gerar', situacao: nf1?.data?.situacao, numero: nf1?.data?.numero, serie: nf1?.data?.serie });

      if (req.query?.sefaz !== '1') {
        saida.passos.push({ passo: 'sefaz', resultado: 'NÃO enviada (rode com &sefaz=1 depois de conferir no painel)' });
        return res.status(200).json(saida);
      }

      const envR = await fetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}/enviar?enviarEmail=false`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}',
      });
      const env = await envR.json().catch(() => ({}));
      saida.passos.push({ passo: 'enviar-sefaz', http: envR.status, resposta: JSON.stringify(env).slice(0, 300) });

      await new Promise(r => setTimeout(r, 4000));
      const nfR = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${nfId}`, headers);
      const nf = nfR.ok ? await nfR.json() : {};
      const n = nf?.data || {};
      saida.passos.push({ passo: 'situacao-final', situacao: n.situacao, numero: n.numero, serie: n.serie, chave: (n.chaveAcesso || '').slice(0, 12) + '…', linkDanfe: n.linkDanfe ? 'TEM' : null });
      // a etiqueta já nasceu junto?
      const etqR = await blingFetch(`https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=PDF&idsVendas[]=${pid}`, headers);
      const etq = typeof etqR.json === 'function' ? await etqR.json().catch(() => ({})) : {};
      saida.passos.push({ passo: 'etiqueta', http: etqR.status, tem_link: !!etq?.data?.[0]?.link });
      return res.status(200).json(saida);
    }

    // ?etq_inspect=1&pedido_id=X — abre o PDF da etiqueta e diz o que tem
    // dentro (é casada NF+transporte? quantas páginas? que tamanho?)
    if (req.query?.etq_inspect === '1' && req.query?.pedido_id) {
      const { PDFDocument } = await import('pdf-lib');
      const pid = String(req.query.pedido_id);
      const r = await blingFetch(`https://api.bling.com.br/Api/v3/logisticas/etiquetas?formato=PDF&idsVendas[]=${pid}`, headers);
      const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
      const link = j?.data?.[0]?.link;
      if (!link) return res.status(200).json({ http: r.status, corpo: JSON.stringify(j).slice(0, 300), aviso: 'sem link de etiqueta' });
      const dR = await fetch(link);
      const bytes = new Uint8Array(await dR.arrayBuffer());
      const saida = { pedido_id: pid, bytes: bytes.length, tipo: String(dR.headers.get('content-type')), link_expira_em: '1h' };

      // o Bling entrega ZIP (achado 13/08) — abrir e inspecionar cada arquivo
      const ehZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      saida.formato = ehZip ? 'ZIP' : 'PDF direto';
      const arquivos = {};
      if (ehZip) {
        const { unzipSync } = await import('fflate');
        const z = unzipSync(bytes);
        for (const nome of Object.keys(z)) arquivos[nome] = z[nome];
      } else { arquivos['(direto)'] = bytes; }

      saida.conteudo = [];
      for (const [nome, buf] of Object.entries(arquivos)) {
        const item = { arquivo: nome, bytes: buf.length };
        try {
          const doc = await PDFDocument.load(buf);
          item.paginas = doc.getPageCount();
          item.tamanhos = doc.getPages().map(pg => {
            const { width, height } = pg.getSize();
            return `${Math.round(width / 2.8346)}x${Math.round(height / 2.8346)}mm`;
          });
        } catch (e) { item.nao_e_pdf = String(e.message).slice(0, 60); }
        const txt = Buffer.from(buf).toString('latin1');
        item.marcas = {
          danfe: /DANFE|DOCUMENTO AUXILIAR|CHAVE DE ACESSO/i.test(txt),
          transporte: /DESTINAT|REMETENTE|Destinat|CEP/i.test(txt),
        };
        saida.conteudo.push(item);
      }
      return res.status(200).json(saida);
    }

    // ?nf_lista=1 — formato real da listagem de NFs (situação 5 x 6, chaves)
    if (req.query?.nf_lista === '1') {
      const out = {};
      for (const [tag, url] of [
        ['com_filtros', `https://api.bling.com.br/Api/v3/nfe?tipo=1&dataEmissaoInicial=${new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)}&limite=5`],
        ['so_limite', 'https://api.bling.com.br/Api/v3/nfe?limite=5'],
      ]) {
        const r = await blingFetch(url, headers);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        const lista = j?.data || [];
        out[tag] = {
          http: r.status, qtd: lista.length,
          chaves: lista[0] ? Object.keys(lista[0]) : null,
          amostra: lista.slice(0, 3).map(n => ({ numero: n.numero, situacao: n.situacao, numeroPedidoLoja: n.numeroPedidoLoja, dataEmissao: n.dataEmissao })),
          erro: lista.length ? null : JSON.stringify(j).slice(0, 250),
        };
        await new Promise(r2 => setTimeout(r2, 400));
      }
      return res.status(200).json({ conta, ...out });
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
