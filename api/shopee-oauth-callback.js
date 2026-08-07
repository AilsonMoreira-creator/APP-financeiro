/**
 * shopee-oauth-callback.js — autorização da loja Shopee (Ailson 07/08/2026)
 *
 * Um endereço só faz as duas pontas:
 *   1. Sem ?code  → redireciona pro Shopee pra loja autorizar
 *   2. Com ?code  → troca o code por access_token/refresh_token e salva em
 *                   shopee_auth (o refresh depois é automático)
 *
 * Precisa das env vars SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY na Vercel.
 * O Redirect URL cadastrado no console valida só o DOMÍNIO, então este path
 * funciona sem precisar mexer lá.
 *
 * Query opcional: ?conta=exitus (rótulo pra sabermos de qual conta é a loja)
 */
import crypto from 'crypto';
import { supabase } from './_bling-helpers.js';

const HOST = 'https://partner.shopeemobile.com';

function assinar(partnerKey, base) {
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex');
}

function pagina(titulo, corpo, cor = '#1e8e4e') {
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${titulo}</title></head>
    <body style="font-family: Georgia, serif; max-width: 620px; margin: 40px auto; padding: 0 20px; color: #2c3e50;">
      <h2 style="color:${cor}">${titulo}</h2>${corpo}
    </body></html>`;
}

export default async function handler(req, res) {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;

  if (!partnerId || !partnerKey) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(pagina('Faltam as credenciais',
      '<p>Cadastre <b>SHOPEE_PARTNER_ID</b> e <b>SHOPEE_PARTNER_KEY</b> nas variáveis de ambiente da Vercel e faça um novo deploy.</p>', '#c0392b'));
  }

  const conta = String(req.query?.conta || 'exitus').toLowerCase();
  const code = req.query?.code;
  const shopId = req.query?.shop_id;
  const base = `https://${req.headers.host}`;
  const redirect = `${base}/api/shopee-oauth-callback?conta=${encodeURIComponent(conta)}`;

  // ── 1. Sem code: manda pro Shopee autorizar ────────────────────────────
  if (!code) {
    const path = '/api/v2/shop/auth_partner';
    const ts = Math.floor(Date.now() / 1000);
    const sign = assinar(partnerKey, `${partnerId}${path}${ts}`);
    const url = `${HOST}${path}?partner_id=${partnerId}&timestamp=${ts}&sign=${sign}&redirect=${encodeURIComponent(redirect)}`;
    return res.redirect(302, url);
  }

  // ── 2. Com code: troca por tokens e salva ──────────────────────────────
  try {
    const path = '/api/v2/auth/token/get';
    const ts = Math.floor(Date.now() / 1000);
    const sign = assinar(partnerKey, `${partnerId}${path}${ts}`);
    const url = `${HOST}${path}?partner_id=${partnerId}&timestamp=${ts}&sign=${sign}`;

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, shop_id: Number(shopId), partner_id: Number(partnerId) }),
    });
    const d = await r.json();

    if (d.error) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(400).send(pagina('A Shopee recusou a autorização',
        `<p><b>${d.error}</b></p><p>${d.message || ''}</p>
         <p style="font-size:13px;color:#5a6b7d">Se falar em permissão, habilite no console as APIs de <b>order</b> e <b>payment</b> (ou abra um ticket pedindo acesso) e tente de novo.</p>`, '#c0392b'));
    }

    await supabase.from('shopee_auth').upsert({
      shop_id: Number(shopId), conta,
      access_token: d.access_token, refresh_token: d.refresh_token,
      expira_em: new Date(Date.now() + (Number(d.expire_in) || 14400) * 1000).toISOString(),
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'shop_id' });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(pagina('Loja autorizada ✓',
      `<p>Conta <b>${conta}</b> · shop_id <b>${shopId}</b></p>
       <p>O token foi salvo e passa a renovar sozinho. Pode fechar esta janela e me avisar no chat.</p>`));
  } catch (e) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(pagina('Erro ao trocar o código', `<p>${e.message}</p>`, '#c0392b'));
  }
}
