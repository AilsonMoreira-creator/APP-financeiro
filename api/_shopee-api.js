/**
 * _shopee-api.js — cliente compartilhado da API da Shopee (Ailson 08/08/2026).
 * Saiu do shopee-sync.js pra o comparador de preços usar a mesma assinatura,
 * o mesmo refresh de token e o mesmo tratamento de erro.
 */
import crypto from 'crypto';
import { supabase } from './_bling-helpers.js';

export const HOST = 'https://partner.shopeemobile.com';

export function ctxShopee() {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  if (!partnerId || !partnerKey) return null;
  return { partnerId, partnerKey };
}

function assinarLoja(partnerKey, partnerId, path, ts, token, shopId) {
  return crypto.createHmac('sha256', partnerKey)
    .update(`${partnerId}${path}${ts}${token}${shopId}`).digest('hex');
}

/** Busca a loja autorizada (por conta, ex 'exitus') e renova o token se preciso. */
export async function authShopee(conta = null) {
  let q = supabase.from('shopee_auth').select('*');
  if (conta) q = q.eq('conta', conta);
  const { data: auth } = await q.limit(1).maybeSingle();
  if (!auth) return { erro: conta ? `loja ${conta} não autorizada` : 'nenhuma loja autorizada' };

  const ctx = ctxShopee();
  if (!ctx) return { erro: 'faltam SHOPEE_PARTNER_ID/KEY' };

  if (auth.expira_em && new Date(auth.expira_em).getTime() < Date.now() + 60000) {
    const path = '/api/v2/auth/access_token/get';
    const ts = Math.floor(Date.now() / 1000);
    const sign = crypto.createHmac('sha256', ctx.partnerKey).update(`${ctx.partnerId}${path}${ts}`).digest('hex');
    const r = await fetch(`${HOST}${path}?partner_id=${ctx.partnerId}&timestamp=${ts}&sign=${sign}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: auth.refresh_token, shop_id: Number(auth.shop_id), partner_id: Number(ctx.partnerId) }),
    });
    const d = await r.json();
    if (!d.access_token) return { erro: 'falha ao renovar token', detalhe: d };
    auth.access_token = d.access_token;
    await supabase.from('shopee_auth').update({
      access_token: d.access_token, refresh_token: d.refresh_token || auth.refresh_token,
      expira_em: new Date(Date.now() + (Number(d.expire_in) || 14400) * 1000).toISOString(),
      atualizado_em: new Date().toISOString(),
    }).eq('shop_id', auth.shop_id);
  }
  return { auth, ctx };
}

export async function chamarShopee(path, params, auth, ctx) {
  const ts = Math.floor(Date.now() / 1000);
  const sign = assinarLoja(ctx.partnerKey, ctx.partnerId, path, ts, auth.access_token, auth.shop_id);
  const qs = new URLSearchParams({
    partner_id: String(ctx.partnerId), timestamp: String(ts), sign,
    access_token: auth.access_token, shop_id: String(auth.shop_id), ...params,
  });
  const r = await fetch(`${HOST}${path}?${qs}`);
  return r.json();
}
