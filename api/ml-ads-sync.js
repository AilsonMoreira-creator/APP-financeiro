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

const dorme = (ms) => new Promise(r => setTimeout(r, ms));

async function ml(path, token) {
  // o billing tem rate limit apertado (429 local_rate_limited): até 4
  // tentativas com espera crescente
  for (let t = 0; t < 4; t++) {
    const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 429) { await dorme(3000 + t * 4000); continue; }
    const b = await r.json().catch(() => ({}));
    return r.ok ? b : { _erro: r.status, _msg: b?.message };
  }
  return { _erro: 429, _msg: 'rate limit apos 4 tentativas' };
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

    // classifica TODOS os charges do mês por grupo. CVV*/BVV* (tarifa de venda
    // e de cobrança) ficam FORA — já entram pelo payment (charge_tarifas), e
    // somar de novo seria dupla contagem.
    const grupo = (st) => {
      const base = st.replace(/^B/, '');
      if (base === 'PADS') return 'ads';
      if (['CFFE', 'CXDE', 'CXDI', 'CFFI'].includes(base) || base.startsWith('CXD') || base.startsWith('CFF')) return base.includes('D') && base !== 'CXDI' && base !== 'CXDE' ? 'devolucao' : 'envio_fatura';
      if (base === 'CFONPN' || base === 'CVVFN') return 'parcelamento';
      if (['CFWA', 'CFCBI'].includes(base)) return 'full_servicos';
      if (base.startsWith('CVV') || base.startsWith('CVM')) return null; // já no payment
      return 'outros';
    };
    // LIMITAÇÃO MAPEADA (10/08): o details do período aberto pagina por offset
    // com teto offset+limit ≤ 10.000 — sem sort, sem cursor (last_id é só
    // informativo), sem filtro por documento. Varremos as 10k rows alcançáveis
    // (cronológicas): cobre o mês corrente até a fatura quinzenal encher; no
    // fechamento (dia ~18) o dataset esvazia e o alcance volta. A resposta
    // expõe a cobertura. Plano definitivo: API de reports do billing.
    const somas = {}; let charges = 0, paginas = 0; const errosApi = [];
    let cobertura = null;
    for (const key of chaves) {
      for (let offset = 0; offset <= 9000; offset += 1000) {
        if (Date.now() - t0 > 260000) break;
        const d = await ml(`/billing/integration/periods/key/${key}/group/ML/details?document_type=BILL&limit=1000&offset=${offset}`, token);
        if (d._erro) { errosApi.push(`off ${offset}: ${d._erro} ${d._msg || ''}`); break; }
        const rows = d.results || [];
        cobertura = { alcancadas: offset + rows.length, total: d.total || null };
        for (const row of rows) {
          const ci = row.charge_info || {};
          if (!String(ci.creation_date_time || '').startsWith(mes)) continue;
          const st = String(ci.detail_sub_type || '');
          const g = grupo(st);
          if (!g) continue;
          const v = Number(ci.detail_amount) || 0;
          charges++;
          somas[g] = (somas[g] || 0) + (st.startsWith('B') ? -v : v);
        }
        paginas++;
        if (rows.length === 0) break;
        await dorme(1800);
      }
    }

    for (const g of Object.keys(somas)) {
      somas[g] = Math.round(somas[g] * 100) / 100;
      await supabase.from('ml_billing_mensal').upsert(
        { mes, conta: 'exitus', tipo: g, valor: somas[g], atualizado_em: new Date().toISOString() },
        { onConflict: 'mes,conta,tipo' });
    }
    if (somas.ads > 0) {
      await supabase.from('ml_ads_manual').upsert(
        { mes, valor: somas.ads, atualizado_em: new Date().toISOString() }, { onConflict: 'mes' });
    }
    return res.status(200).json({ ok: true, mes, periodos: chaves, paginas, charges_no_mes: charges, somas, cobertura, erros_api: errosApi });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
