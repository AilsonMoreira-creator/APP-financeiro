/**
 * full-chegada-cron.js — detecta a chegada da remessa no Full (Ailson 17/08)
 *
 * A Cris informa a data prevista de envio ao gerar o PDF. A partir de 24h
 * depois (e de novo em 48h, 72h e 96h, pulando domingo), o app compara o
 * saldo atual do Full com a foto do momento do envio.
 *
 * Regra dele: SKU com +3 peças ou mais = chegou. 70% dos SKUs confirmados
 * = remessa recebida (por amostragem, porque na hora de lançar ela pode
 * ajustar quantidades).
 */
import { supabase } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 300 };
const n = (v) => Number(v) || 0;
const chaveCor = (c) => String(c || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const resumo = { verificadas: 0, recebidas: 0, detalhe: [] };
  try {
    const { data: remessas } = await supabase.from('full_remessas')
      .select('*').eq('status', 'em_transito')
      .lte('proxima_checagem', new Date().toISOString()).limit(5);

    const token = await getValidToken('Exitus');
    const h = { Authorization: `Bearer ${token}` };
    const me = await (await fetch('https://api.mercadolibre.com/users/me', { headers: h })).json();

    for (const r of (remessas || [])) {
      resumo.verificadas++;
      const { data: dec } = await supabase.from('full_decisoes').select('*').eq('remessa_id', r.id);
      const refs = [...new Set((dec || []).map(d => d.ref))];

      // saldo atual do Full por cor+tam das REFs da remessa
      const atual = {};
      for (const ref of refs.slice(0, 12)) {
        const { data: est } = await supabase.from('bling_estoque')
          .select('bling_sku').in('ref', [ref, ref.padStart(5, '0')]).limit(4);
        for (const e of (est || [])) {
          if (!e.bling_sku) continue;
          const b = await (await fetch(`https://api.mercadolibre.com/users/${me.id}/items/search?seller_sku=${encodeURIComponent(e.bling_sku)}&logistic_type=fulfillment`, { headers: h })).json();
          for (const itemId of (b?.results || []).slice(0, 1)) {
            const it = await (await fetch(`https://api.mercadolibre.com/items/${itemId}`, { headers: h })).json();
            for (const v of (it.variations || [])) {
              const combo = v.attribute_combinations || [];
              const cor = (combo.find(a => /cor|color/i.test(a.id || a.name)) || {}).value_name;
              const tam = (combo.find(a => /size|tamanho/i.test(a.id || a.name)) || {}).value_name;
              if (cor && tam) atual[`${ref}|${chaveCor(cor)}|${String(tam).toUpperCase()}`] = n(v.available_quantity);
            }
          }
          await new Promise(x => setTimeout(x, 150));
          break;   // um SKU por REF basta pra alcançar o anúncio
        }
      }

      let confirmados = 0, avaliados = 0;
      for (const d of (dec || [])) {
        const k = `${d.ref}|${chaveCor(d.cor)}|${String(d.tam).toUpperCase()}`;
        if (atual[k] === undefined) continue;
        avaliados++;
        // subiu 3 ou mais em relação à foto do envio? então chegou
        if (atual[k] - n(d.estoque_full) >= 3) confirmados++;
      }
      const pct = avaliados ? confirmados / avaliados : 0;
      const recebida = pct >= 0.7;

      const proxima = new Date(Date.now() + 24 * 3600 * 1000);
      if (proxima.getDay() === 0) proxima.setDate(proxima.getDate() + 1);   // domingo não conta
      await supabase.from('full_remessas').update({
        status: recebida ? 'recebida' : (r.checagens >= 3 ? 'parcial' : 'em_transito'),
        skus_confirmados: confirmados,
        recebida_em: recebida ? new Date().toISOString() : null,
        checagens: n(r.checagens) + 1,
        proxima_checagem: recebida ? null : proxima.toISOString(),
      }).eq('id', r.id);

      if (recebida) resumo.recebidas++;
      resumo.detalhe.push({ remessa: r.id, avaliados, confirmados, pct: Math.round(pct * 100), recebida });
    }
    return res.status(200).json(resumo);
  } catch (e) { return res.status(500).json({ erro: e.message, resumo }); }
}
