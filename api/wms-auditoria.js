// wms-auditoria.js — CONFERÊNCIA dos chips da tela de impressão contra as
// fontes (Ailson 07/09/2026).
//
//   Régua dele:
//   · Bling: NF+transporte + NF agendadas + Cancelados = notas AUTORIZADAS
//     (situação 5) que existem no Bling e ainda não foram impressas.
//   · ML: Flex, Etiquetas liberadas e Envios Agora conferidos contra o que o
//     Mercado Livre diz que está pronto pra sair (ready_to_ship).
//
//   GET ?contas=exitus,lumia,muniam  → { bling: {...}, ml: {...} }
//   Só leitura. Lista as DIFERENÇAS número por número — o que o Bling/ML tem
//   e o app não enxerga, e o contrário.

import { createClient } from '@supabase/supabase-js';
import { blingFetch, refreshBlingToken } from './_bling-helpers.js';
import { getValidToken, supabase as sbMl } from './_ml-helpers.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);
const BRAND = { exitus: 'Exitus', lumia: 'Lumia', muniam: 'Muniam' };
const espera = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const contas = String(req.query?.contas || 'exitus,lumia,muniam').split(',').map(c => c.trim()).filter(c => BRAND[c]);
  const hojeBRT = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const dias = Math.min(parseInt(req.query?.dias, 10) || 5, 10);
  const desde = new Date(Date.now() - dias * 86400000 - 3 * 3600000).toISOString().slice(0, 10);
  const inicio = Date.now();
  const saida = { hoje: hojeBRT, janela_desde: desde, bling: { por_conta: {}, total_bling: 0, total_app: 0, diferencas: [] }, ml: { por_conta: {}, diferencas: [] } };

  // ── espelho: tudo que pode entrar nos chips ──
  const { data: peds } = await supabase.from('wms_pedidos')
    .select('pedido_id, conta, numero, numero_loja, canal_geral, nf_id, nf_situacao, status_wms, print_regra, print_estado, ml_logistic_type, ml_ship_status, ml_ship_substatus, ml_agendado_em, etiqueta_impressa_em, nf_agendada_impressa_em')
    .gte('criado_em', new Date(Date.now() - (dias + 2) * 86400000).toISOString())
    .limit(4000);
  const porNf = new Map();
  const porLoja = new Map();
  for (const p of (peds || [])) {
    if (p.nf_id) porNf.set(`${p.conta}|${p.nf_id}`, p);
    if (p.numero_loja) porLoja.set(`${p.conta}|${p.numero_loja}`, p);
  }
  const chipDe = (p) => {
    // mesma leitura dos chips da tela (simplificada; a régua oficial é a do wms-etiquetas)
    if (p.ml_ship_status === 'cancelled' || p.status_wms === 'cancelado') return 'cancelados';
    const agendadoFuturo = p.ml_agendado_em && String(p.ml_agendado_em).slice(0, 10) > hojeBRT;
    const agendadoChegou = p.ml_agendado_em && String(p.ml_agendado_em).slice(0, 10) <= hojeBRT;
    if (agendadoChegou) return p.etiqueta_impressa_em ? 'ja_impressa' : 'agendado_dia_chegou';
    if (p.print_regra === 'MELI_AGENDADO' || agendadoFuturo || p.ml_ship_substatus === 'buffered') return p.nf_agendada_impressa_em ? 'agendada_ja_impressa' : 'nf_agendada';
    if (p.ml_logistic_type === 'fulfillment') return 'full';
    if (p.ml_logistic_type === 'self_service') return 'flex';
    if (p.canal_geral === 'Meluni') return 'meluni';
    // finalizado NAO exclui: o Bling marca atendido quando a NF nasce
    if (p.etiqueta_impressa_em || p.nf_situacao === 6) return 'ja_impressa';
    return 'nf_transporte';
  };

  // ── BLING: notas autorizadas (sit 5) por conta ──
  for (const conta of contas) {
    const c = { notas_autorizadas_bling: 0, fora_do_wms_sem_loja: 0, no_app: { nf_transporte: 0, nf_agendada: 0, cancelados: 0, ja_impressa: 0, flex: 0, full: 0, meluni: 0, agendada_ja_impressa: 0, agendado_dia_chegou: 0 }, nao_encontradas_no_app: [], por_loja_fora_do_app: {}, erro: null };
    saida.bling.por_conta[conta] = c;
    try {
      const token = await refreshBlingToken(conta);
      const h = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
      for (let pag = 1; pag <= 8; pag++) {
        const r = await blingFetch(`https://api.bling.com.br/Api/v3/nfe?situacao=5&tipo=1&dataEmissaoInicial=${desde}&dataEmissaoFinal=${hojeBRT}&pagina=${pag}&limite=100`, h);
        const j = typeof r.json === 'function' ? await r.json().catch(() => ({})) : {};
        const lista = j?.data || [];
        for (const nf of lista) {
          const p = porNf.get(`${conta}|${nf.id}`);
          // nota sem loja (balcao/atacado) nunca e do WMS — fica fora do comparavel
          if (!p && !(nf.loja?.id)) { c.fora_do_wms_sem_loja++; continue; }
          // 07/09: nota emitida CONTRA o Mercado Livre (EBAZAR, CNPJ 03007331) e
          // venda FULL — o ML despacha do armazem dele; nunca passa pelo WMS
          const docContato = String(nf.contato?.numeroDocumento || '').replace(/\D/g, '');
          if (!p && (docContato.startsWith('03007331') || /ebazar/i.test(nf.contato?.nome || ''))) { c.full_fora_do_wms = (c.full_fora_do_wms || 0) + 1; continue; }
          c.notas_autorizadas_bling++;
          if (!p) {
            const lj = String(nf.loja?.id || 'sem_loja');
            c.por_loja_fora_do_app[lj] = (c.por_loja_fora_do_app[lj] || 0) + 1;
            if (c.nao_encontradas_no_app.length < 5) c.nao_encontradas_no_app.push({ nf_id: nf.id, numero_nf: nf.numero, loja_id: nf.loja?.id, emissao: nf.dataEmissao });
            continue;
          }
          const chip = chipDe(p);
          c.no_app[chip] = (c.no_app[chip] || 0) + 1;
        }
        if (lista.length < 100) break;
        await espera(400);
      }
      saida.bling.total_bling += c.notas_autorizadas_bling;
      saida.bling.total_app += c.no_app.nf_transporte + c.no_app.nf_agendada + c.no_app.cancelados + c.no_app.agendado_dia_chegou;
      for (const [lj, n] of Object.entries(c.por_loja_fora_do_app)) saida.bling.diferencas.push({ conta, loja_id: lj, notas: n, motivo: 'notas autorizadas no Bling que o app não tem no espelho (loja fora do WMS?)' });
      // notas que o app tem em sit 5 mas o Bling nao listou (impressa/cancelada por fora, ou fora da janela)
      for (const p of (peds || [])) {
        if (p.conta !== conta || p.nf_situacao !== 5 || p.etiqueta_impressa_em) continue;
        // (só reportamos se o Bling devolveu alguma coisa — senão é falha de leitura)
      }
    } catch (e) { c.erro = String(e?.message || e); }
    await espera(300);
  }

  // ── ML: ready_to_ship por conta → Flex / liberadas / agora ──
  for (const conta of contas) {
    const c = { ready_to_ship_ml: 0, no_app: { flex: 0, etiqueta_liberada: 0, agora: 0, nf_transporte: 0, agendada_futura: 0, ja_impressa: 0, coletado_ou_painel: 0, outro: 0 }, nao_encontrados_no_app: [], erro: null };
    saida.ml.por_conta[conta] = c;
    try {
      const brand = BRAND[conta];
      const { data: tk } = await sbMl.from('ml_tokens').select('seller_id').eq('brand', brand).maybeSingle();
      const token = await getValidToken(brand);
      const h = { Authorization: `Bearer ${token}` };
      const vistos = new Set();
      for (let offset = 0; offset < 400; offset += 50) {
        const dFrom = new Date(Date.now() - 10 * 86400000).toISOString();
        const r = await fetch(`https://api.mercadolibre.com/orders/search?seller=${tk?.seller_id}&shipping.status=ready_to_ship&order.date_created.from=${encodeURIComponent(dFrom)}&sort=date_desc&limit=50&offset=${offset}`, { headers: h });
        if (!r.ok) { c.erro = `orders/search http ${r.status}`; break; }
        const j = await r.json().catch(() => ({}));
        const results = j?.results || [];
        for (const o of results) {
          const chave = String(o.pack_id || o.id);
          if (vistos.has(chave)) continue;
          vistos.add(chave);
          c.ready_to_ship_ml++;
          const p = porLoja.get(`${conta}|${chave}`);
          const { data: ag } = await supabase.from('wms_agora').select('id, atendido_em').eq('conta', conta).eq('numero_loja', chave).maybeSingle();
          if (ag) { c.no_app.agora++; continue; }
          if (!p) {
            // 07/09: confere no ML antes de acusar — pack dividido, nao pago,
            // cancelado e Full nao sao pendencia do WMS
            const tags = Array.isArray(o.tags) ? o.tags : [];
            if (tags.includes('not_paid') || o.status === 'cancelled') { c.lixo_ml = (c.lixo_ml || 0) + 1; continue; }
            let sh = null;
            try { const rs = await fetch(`https://api.mercadolibre.com/shipments/${o.shipping?.id}`, { headers: h }); sh = rs.ok ? await rs.json() : null; } catch { sh = null; }
            if (!sh || sh.status === 'cancelled' || sh.logistic_type === 'fulfillment' || sh.substatus === 'pack_splitted') { c.lixo_ml = (c.lixo_ml || 0) + 1; continue; }
            c.nao_encontrados_no_app.push({ pedido_ml: chave, data: o.date_created, status_envio: sh.status, substatus: sh.substatus, logistica: sh.logistic_type });
            continue;
          }
          if (p.etiqueta_impressa_em) { c.no_app.ja_impressa++; continue; }
          const sub = p.ml_ship_substatus || '';
          if (p.ml_logistic_type === 'self_service') c.no_app.flex++;
          else if (p.ml_agendado_em && String(p.ml_agendado_em).slice(0, 10) > hojeBRT) c.no_app.agendada_futura++;
          else if (p.ml_agendado_em && sub === 'ready_to_print') c.no_app.etiqueta_liberada++;
          else if (p.ml_agendado_em) c.no_app.coletado_ou_painel++;          // in_hub, ready_for_pickup, printed...
          else if (!p.ml_agendado_em && sub === 'ready_to_print') c.no_app.nf_transporte++;
          else if (!p.ml_agendado_em) c.no_app.coletado_ou_painel++;
          else c.no_app.outro++;
        }
        if (results.length < 50) break;
        await espera(250);
      }
      for (const x of c.nao_encontrados_no_app) saida.ml.diferencas.push({ conta, ...x, motivo: 'pronto pra sair no ML e o app não tem no espelho' });
    } catch (e) { c.erro = String(e?.message || e); }
  }

  saida.segundos = Math.round((Date.now() - inicio) / 1000);
  return res.status(200).json(saida);
}
