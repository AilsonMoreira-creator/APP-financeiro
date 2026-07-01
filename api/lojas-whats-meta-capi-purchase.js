// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-meta-capi-purchase.js — Dispara Purchase event pra Meta CAPI
// ═══════════════════════════════════════════════════════════════════════════
//
// Sprint Attribution Sofia (Ailson 25/05/2026).
// Chamado quando uma venda no Mire dá match com uma conversa Sofia que
// veio de anuncio Instagram (Click-to-WhatsApp).
//
// Meta Conversions API server-side event "Purchase" inclui:
//   - user_data hashed (SHA256): phone, email, name, external_id
//   - ctwa_clid (Click-to-WhatsApp Click ID) — chave de attribution CTWA
//   - custom_data: value, currency, order_id
//   - action_source: "business_messaging"
//
// POST body: {
//   conversa_id: uuid (obrigatorio),
//   venda_info: {
//     valor: 1234.56,
//     numero_pedido: '123',
//     venda_id: uuid (opcional),
//     categoria: 'atacado' | 'varejo'
//   },
//   tipo_match: 'telefone' | 'documento' | 'manual'
// }
//
// Idempotencia: usa event_id = hash do (conversa_id + numero_pedido).
// Se ja foi enviado (capi_purchase_enviado=true) NAO reenvia.
// ═══════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { supabase, setCors, log, logErro } from './_lojas-whats-helpers.js';

const META_GRAPH_VERSION = 'v21.0';

// Pixel B2B correto = dataset "✓ PIXEL AMICIA B2B | Convertr" (1636287600816161),
// usado pela conta Amicia conv cartao. A env var META_CAPI_PIXEL_B2B_ID estava
// apontando pro pixel errado (App Vesti/Site Misturados, parado desde 26/05),
// por isso os 13 Purchase anteriores foram pro pixel errado. Ailson 01/07/2026.
const PIXEL_B2B_ID = '1636287600816161';

// Pagina FB por tras dos anuncios CTWA da conta Amicia conv cartao (626487585630124).
// Obrigatoria em user_data.page_id quando action_source=business_messaging/whatsapp
// (Meta subcode 2804069). O WABA via env estava errado (era o da Meluni). Ailson 01/07/2026.
const PAGE_ID_B2B = '113310001265359';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const body = req.body || {};

    // ─── Fluxo MANUAL (vendedora informa venda via formulario) ───────────────
    // POST { manual:true, dados_manual:{telefone, valor, numero_pedido, ...}, vendedora_nome }
    if (body.manual === true) {
      const { dados_manual, vendedora_nome } = body;
      if (!vendedora_nome) return res.status(400).json({ error: 'vendedora_nome_obrigatorio' });
      if (!dados_manual?.telefone) return res.status(400).json({ error: 'dados_manual.telefone_obrigatorio' });
      if (!dados_manual?.valor || dados_manual.valor <= 0) {
        return res.status(400).json({ error: 'dados_manual.valor obrigatorio (>0)' });
      }
      if (!dados_manual?.numero_pedido) {
        return res.status(400).json({ error: 'dados_manual.numero_pedido_obrigatorio (necessario pra idempotencia)' });
      }
      const resultado = await dispararPurchaseManual({ dados_manual, vendedora_nome });
      const httpStatus = resultado.status === 'enviado' ? 200
                       : resultado.status === 'duplicado' ? 200 : 500;
      return res.status(httpStatus).json(resultado);
    }

    // ─── Fluxo AUTO (cron de match Sofia x Mire) ─────────────────────────────
    const { conversa_id, venda_info, tipo_match } = body;
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id_obrigatorio' });
    if (!venda_info?.valor || venda_info.valor <= 0) {
      return res.status(400).json({ error: 'venda_info.valor obrigatorio (>0)' });
    }
    if (!['telefone', 'documento', 'manual'].includes(tipo_match)) {
      return res.status(400).json({ error: 'tipo_match invalido', validos: ['telefone','documento','manual'] });
    }

    const resultado = await dispararPurchase({ conversa_id, venda_info, tipo_match });
    return res.status(resultado.status === 'enviado' ? 200 : 500).json(resultado);
  } catch (e) {
    logErro('capi-purchase', e);
    return res.status(500).json({ error: e.message });
  }
}

export async function dispararPurchase({ conversa_id, venda_info, tipo_match }) {
  // 1. Carrega conversa
  const { data: conv } = await supabase
    .from('lojas_whats_conversas')
    .select('id, telefone, nome_cliente, documento, tipo_documento, ctwa_clid, origem_lead, capi_purchase_enviado, capi_purchase_event_id')
    .eq('id', conversa_id)
    .maybeSingle();
  if (!conv) {
    return { status: 'falhou', erro: 'conversa_nao_encontrada' };
  }

  // 2. Idempotencia
  if (conv.capi_purchase_enviado) {
    log('capi', `conv=${conversa_id} ja enviado capi (${conv.capi_purchase_event_id}) — skip`);
    return { status: 'duplicado', conversa_id, event_id_anterior: conv.capi_purchase_event_id };
  }

  // 3. Variaveis Meta
  const pixelId = PIXEL_B2B_ID;
  const token = process.env.META_ADS_TOKEN || process.env.META_WA_ACCESS_TOKEN;
  if (!pixelId) {
    return { status: 'falhou', erro: 'META_CAPI_PIXEL_B2B_ID nao configurado em env' };
  }
  if (!token) {
    return { status: 'falhou', erro: 'token Meta nao configurado em env (META_ADS_TOKEN ou META_WA_ACCESS_TOKEN)' };
  }

  // 4. Monta event_id deterministico (idempotencia no lado Meta tambem)
  const eventId = crypto.createHash('sha256')
    .update(`${conversa_id}|${venda_info.numero_pedido || ''}|${venda_info.valor}`)
    .digest('hex')
    .slice(0, 32);

  // 5. Hashing pra Meta (SHA256 lowercase trim)
  const sha = (v) => v ? crypto.createHash('sha256')
    .update(String(v).toLowerCase().trim()).digest('hex') : null;

  // Telefone normalizado pra E.164 sem '+' (Meta espera digits only, com codigo pais)
  const telDigits = (conv.telefone || '').replace(/\D/g, '');
  const telE164 = telDigits.startsWith('55') ? telDigits : `55${telDigits.slice(-11)}`;

  // Nome separa primeiro / ultimo
  const nomePartes = (conv.nome_cliente || '').trim().split(/\s+/);
  const firstName = nomePartes[0] || null;
  const lastName = nomePartes.length > 1 ? nomePartes.slice(-1)[0] : null;

  const user_data = {
    ph: sha(telE164),                                  // phone hash
    external_id: sha(conv.documento),                  // CPF/CNPJ hash (se tiver)
    fn: sha(firstName),                                 // first name hash
    ln: sha(lastName),                                  // last name hash
  };
  // Roteia pela presenca de ctwa_clid:
  //  • TEM ctwa_clid → lead CTWA (clique em anuncio WhatsApp) → business_messaging
  //  • NAO tem       → carrinho abandonado do site → website (Meta nao exige ctwa_clid)
  const temCtwa = !!conv.ctwa_clid;
  if (temCtwa) {
    user_data.ctwa_clid = conv.ctwa_clid;              // NAO hashed (Meta exige plain)
    // page_id obrigatorio quando action_source=business_messaging/whatsapp (Meta subcode 2804069).
    user_data.page_id = PAGE_ID_B2B;                   // Pagina FB dos anuncios CTWA da Amicia
  }
  // Remove campos null
  for (const k of Object.keys(user_data)) {
    if (user_data[k] === null || user_data[k] === undefined) delete user_data[k];
  }

  // 6. Payload final
  const eventData = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: temCtwa ? 'business_messaging' : 'website',
    user_data,
    custom_data: {
      currency: 'BRL',
      value: Number(venda_info.valor),
      order_id: venda_info.numero_pedido || null,
      content_category: venda_info.categoria || 'atacado',
    },
  };
  if (temCtwa) {
    eventData.messaging_channel = 'whatsapp';          // obrigatorio p/ business_messaging (subcode 2804063)
  } else {
    eventData.event_source_url = 'https://amicialoja.com.br/';  // recomendado p/ website
  }

  const payload = { data: [eventData] };

  // 7. POST pra Meta
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
  let respJson, ok;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    respJson = await r.json();
    ok = r.ok;
  } catch (e) {
    logErro('capi-purchase/fetch', e);
    await salvarAudit({
      conversa_id, venda_info, tipo_match, pixelId, eventId,
      payload, response: { erro: e.message }, status: 'falhou', erro: e.message,
      ctwaClid: conv.ctwa_clid,
      origemCapi: 'auto_cron',
    });
    return { status: 'falhou', erro: e.message };
  }

  // 8. Audit
  await salvarAudit({
    conversa_id, venda_info, tipo_match, pixelId, eventId,
    payload, response: respJson, status: ok ? 'enviado' : 'falhou',
    erro: ok ? null : JSON.stringify(respJson).slice(0, 500),
    ctwaClid: conv.ctwa_clid,
    origemCapi: 'auto_cron',
  });

  if (!ok) {
    logErro('capi-purchase/meta', new Error(JSON.stringify(respJson)));
    return { status: 'falhou', erro: respJson?.error?.message || 'meta_retornou_erro', response: respJson };
  }

  // 9. Marca conversa como enviado
  await supabase.from('lojas_whats_conversas').update({
    capi_purchase_enviado: true,
    capi_purchase_enviado_em: new Date().toISOString(),
    capi_purchase_event_id: eventId,
    atualizado_em: new Date().toISOString(),
  }).eq('id', conversa_id);

  log('capi-purchase', `conv=${conversa_id} valor=R$${venda_info.valor} match=${tipo_match} ctwa=${conv.ctwa_clid ? 'sim' : 'nao'} event_id=${eventId.slice(0,8)} ok`);
  return {
    status: 'enviado',
    conversa_id,
    event_id: eventId,
    valor: venda_info.valor,
    response: respJson,
  };
}

// ─── Fluxo MANUAL: vendedora informa venda via formulario (sem conversa Sofia) ─
// Usado quando cliente comprou via anuncio Meta mas nao passou por Sofia OU
// passou e o cron de match nao pegou. Vendedora preenche dados do cliente
// (telefone, nome opcional, CPF opcional, valor, numero pedido) e o evento
// Purchase vai pro Meta com user_data hashed pra advanced matching.
//
// Sem ctwa_clid (Vanessa nunca tera). Sem ligacao com conversa Sofia.
// Idempotencia: event_id = sha256('manual|telefone|numero_pedido|valor)
export async function dispararPurchaseManual({ dados_manual, vendedora_nome }) {
  const {
    telefone, nome_cliente, documento,
    valor, numero_pedido, categoria,
  } = dados_manual;

  // 1. Variaveis Meta
  const pixelId = PIXEL_B2B_ID;
  const token = process.env.META_ADS_TOKEN || process.env.META_WA_ACCESS_TOKEN;
  if (!pixelId) return { status: 'falhou', erro: 'META_CAPI_PIXEL_B2B_ID nao configurado em env' };
  if (!token) return { status: 'falhou', erro: 'token Meta nao configurado em env (META_ADS_TOKEN ou META_WA_ACCESS_TOKEN)' };

  // 2. event_id deterministico (idempotencia Meta-side + nossa)
  const eventId = crypto.createHash('sha256')
    .update(`manual|${telefone}|${numero_pedido}|${valor}`)
    .digest('hex')
    .slice(0, 32);

  // 3. Idempotencia nossa: ja tem evento manual com esse event_id?
  const { data: jaExiste } = await supabase
    .from('lojas_whats_capi_eventos')
    .select('id, status, enviado_em')
    .eq('meta_event_id', eventId)
    .maybeSingle();
  if (jaExiste && jaExiste.status === 'enviado') {
    log('capi-purchase-manual', `event_id ja enviado (${eventId.slice(0,8)}) — skip`);
    return { status: 'duplicado', event_id: eventId, enviado_em_anterior: jaExiste.enviado_em };
  }

  // 4. Hashing pra Meta
  const sha = (v) => v ? crypto.createHash('sha256')
    .update(String(v).toLowerCase().trim()).digest('hex') : null;

  // Telefone E.164 sem '+'
  const telDigits = String(telefone || '').replace(/\D/g, '');
  const telE164 = telDigits.startsWith('55') ? telDigits : `55${telDigits.slice(-11)}`;

  // Nome separa primeiro / ultimo (opcional)
  const nomePartes = (nome_cliente || '').trim().split(/\s+/).filter(Boolean);
  const firstName = nomePartes[0] || null;
  const lastName = nomePartes.length > 1 ? nomePartes.slice(-1)[0] : null;

  const user_data = {
    ph: sha(telE164),
    external_id: sha(documento),
    fn: sha(firstName),
    ln: sha(lastName),
  };
  // Envio manual NUNCA tem ctwa_clid → action_source=website (Meta nao exige ctwa_clid).
  // Sem page_id/messaging_channel (esses sao so do business_messaging).
  for (const k of Object.keys(user_data)) {
    if (user_data[k] === null || user_data[k] === undefined) delete user_data[k];
  }

  // 5. Payload
  const eventData = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: 'website',
    event_source_url: 'https://amicialoja.com.br/',
    user_data,
    custom_data: {
      currency: 'BRL',
      value: Number(valor),
      order_id: numero_pedido,
      content_category: categoria || 'varejo',
    },
  };
  const payload = { data: [eventData] };

  // 6. POST pra Meta
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`;
  let respJson, ok;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    respJson = await r.json();
    ok = r.ok;
  } catch (e) {
    logErro('capi-purchase-manual/fetch', e);
    await salvarAudit({
      conversa_id: null,
      venda_info: { valor, numero_pedido, categoria },
      tipo_match: 'manual', pixelId, eventId,
      payload, response: { erro: e.message }, status: 'falhou', erro: e.message,
      ctwaClid: null,
      origemCapi: 'manual_vendedora_externa',
      vendedoraNome: vendedora_nome,
      dadosManual: dados_manual,
    });
    return { status: 'falhou', erro: e.message };
  }

  // 7. Audit
  await salvarAudit({
    conversa_id: null,
    venda_info: { valor, numero_pedido, categoria },
    tipo_match: 'manual', pixelId, eventId,
    payload, response: respJson, status: ok ? 'enviado' : 'falhou',
    erro: ok ? null : JSON.stringify(respJson).slice(0, 500),
    ctwaClid: null,
    origemCapi: 'manual_vendedora_externa',
    vendedoraNome: vendedora_nome,
    dadosManual: dados_manual,
  });

  if (!ok) {
    logErro('capi-purchase-manual/meta', new Error(JSON.stringify(respJson)));
    return { status: 'falhou', erro: respJson?.error?.message || 'meta_retornou_erro', response: respJson };
  }

  log('capi-purchase-manual', `vend=${vendedora_nome} tel=${telDigits.slice(-4)} valor=R$${valor} pedido=${numero_pedido} event_id=${eventId.slice(0,8)} ok`);
  return {
    status: 'enviado',
    event_id: eventId,
    valor: Number(valor),
    vendedora_nome,
    response: respJson,
  };
}

async function salvarAudit({ conversa_id, venda_info, tipo_match, pixelId, eventId, payload, response, status, erro, ctwaClid, origemCapi, vendedoraNome, dadosManual }) {
  // user_data hashed jamais salvar plain — payload ja vem com hashes,
  // mas removo pra evitar contaminacao no audit log
  const payloadSafe = JSON.parse(JSON.stringify(payload));
  
  try {
    await supabase.from('lojas_whats_capi_eventos').insert({
      conversa_id: conversa_id || null,
      venda_id: venda_info.venda_id || null,
      venda_categoria: venda_info.categoria || null,
      numero_pedido: venda_info.numero_pedido || null,
      meta_pixel_id: pixelId,
      meta_event_id: eventId,
      tipo_match,
      ctwa_clid: ctwaClid || null,
      valor: venda_info.valor,
      request_payload: payloadSafe,
      meta_response: response,
      status,
      erro,
      origem_capi: origemCapi || 'auto_cron',
      vendedora_nome: vendedoraNome || null,
      dados_manual: dadosManual || null,
    });
  } catch (e) {
    // Se for unique violation no event_id, ja foi enviado antes — ok
    if (e.code !== '23505') {
      logErro('capi-purchase/audit', e);
    }
  }
}
