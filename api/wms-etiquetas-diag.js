/**
 * wms-etiquetas-diag.js — a API do Bling entrega NF (DANFE) + etiqueta de
 * transporte por pedido? (Ailson 11/08/2026 — ondas de separação por maço de
 * etiquetas casadas, ordenadas por REF ou só Flex)
 *
 * GET ?conta=exitus&limite=2  → pega pedidos atendidos recentes do
 * wms_pedidos, abre o detalhe no Bling e caça: notaFiscal (id → /nfe/{id},
 * procurando link do DANFE) e transporte/etiqueta. Só leitura.
 */
import { supabase, blingFetch, refreshBlingToken } from './_bling-helpers.js';

export const config = { maxDuration: 120 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus');
  const limite = Math.min(parseInt(req.query?.limite) || 2, 4);
  try {
    const token = await refreshBlingToken(conta);
    const headers = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' };

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
