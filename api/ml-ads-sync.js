/**
 * ml-ads-sync.js — gasto de PUBLICIDADE (Product Ads) do Mercado Livre,
 * automático via billing (Ailson 10/08/2026).
 *
 * Ele habilitou o escopo; as rotas de métricas do Advertising não existem
 * mais nesses formatos, mas o BILLING lista cada charge com sub_type
 * `PADS · Tarifa por campanha de publicidade de Product Ads`. Os "períodos"
 * do billing NÃO são meses-calendário (o aberto acumula meses), então:
 * varre os details dos períodos recentes, filtra PADS por creation_date_time
 * dentro do mês e grava o total em ml_ads_manual (que o ml-detalhe já lê).
 * Sub_types que começam com B são cancelamentos — entram subtraindo.
 *
 * Só a EXITUS tem Ads (dito por ele em 10/08).
 *
 * GET ?mes=YYYY-MM (default: mês corrente) · cron diário 06:40 BRT
 */
import { supabase } from './_bling-helpers.js';
import { getValidToken } from './_ml-helpers.js';

export const config = { maxDuration: 300 };
const API = 'https://api.mercadolibre.com';

async function ml(path, token) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const b = await r.json().catch(() => ({}));
  return r.ok ? b : { _erro: r.status, _msg: b?.message };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const mes = /^\d{4}-\d{2}$/.test(req.query?.mes || '')
    ? req.query.mes
    : new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 7);
  const t0 = Date.now();

  try {
    const token = await getValidToken('Exitus');
    if (!token) return res.status(400).json({ erro: 'sem token exitus' });

    const per = await ml('/billing/integration/monthly/periods?group=ML&document_type=BILL&offset=0&limit=4', token);
    if (per._erro) return res.status(400).json({ etapa: 'periods', ...per });

    // períodos cujo intervalo alcança o mês pedido
    const chaves = (per.results || [])
      .filter(p => (p.period?.date_from || '').slice(0, 7) <= mes && (p.period?.date_to || '9999').slice(0, 7) >= mes)
      .map(p => p.key);
    if (!chaves.length && per.results?.[0]) chaves.push(per.results[0].key);

    let bruto = 0, cancelado = 0, charges = 0, paginas = 0;
    for (const key of chaves) {
      let offset = 0, total = null;
      while ((total === null || offset < total) && Date.now() - t0 < 260000) {
        const d = await ml(`/billing/integration/periods/key/${key}/group/ML/details?document_type=BILL&limit=1000&offset=${offset}`, token);
        if (d._erro) break;
        total = d.total ?? total;
        for (const row of (d.results || [])) {
          const ci = row.charge_info || {};
          const st = String(ci.detail_sub_type || '');
          if (!st.includes('PADS')) continue;
          if (!String(ci.creation_date_time || '').startsWith(mes)) continue;
          const v = Number(ci.detail_amount) || 0;
          charges++;
          if (st.startsWith('B')) cancelado += v; else bruto += v;
        }
        offset += 1000; paginas++;
      }
    }

    const valor = Math.round((bruto - cancelado) * 100) / 100;
    if (charges > 0) {
      await supabase.from('ml_ads_manual').upsert(
        { mes, valor, atualizado_em: new Date().toISOString() }, { onConflict: 'mes' });
    }
    return res.status(200).json({ ok: true, mes, periodos: chaves, paginas, charges_pads_no_mes: charges, bruto, cancelado, valor_gravado: charges > 0 ? valor : null });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
