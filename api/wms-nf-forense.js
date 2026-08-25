// /api/wms-nf-forense — one-off: busca as NFs dos pedidos passados em
// ?numeros= e devolve os campos de DATA da nota (quando foi emitida/operada)
// pra descobrir QUEM resolveu: a transmissao do robo completando sozinha
// (horario ~9h) ou a equipe no painel (horario posterior).
import { supabase } from './_ml-helpers.js';
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';

export default async function handler(req, res) {
  const numeros = String(req.query.numeros || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!numeros.length) return res.status(400).json({ erro: 'use ?numeros=155502,155537' });
  const { data: peds } = await supabase.from('wms_pedidos')
    .select('numero, conta, nf_id, nf_situacao').in('numero', numeros);
  const saida = [];
  for (const p of (peds || [])) {
    try {
      const tk = await refreshBlingToken(p.conta);
      const r = await blingFetch(`https://api.bling.com.br/Api/v3/nfe/${p.nf_id}`, { Authorization: `Bearer ${tk}` });
      const j = await r.json().catch(() => ({}));
      const d = j?.data || {};
      saida.push({
        pedido: p.numero, conta: p.conta, situacao: d.situacao,
        numero_nf: d.numero, serie: d.serie,
        dataEmissao: d.dataEmissao, dataOperacao: d.dataOperacao,
        chaves_data: Object.keys(d).filter(k => /data|hora/i.test(k)).map(k => `${k}=${d[k]}`),
      });
      await new Promise(rr => setTimeout(rr, 400));
    } catch (e) { saida.push({ pedido: p.numero, erro: String(e?.message || e).slice(0, 80) }); }
  }
  return res.status(200).json(saida);
}
