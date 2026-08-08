/**
 * tts-callback.js — recebe a autorização da loja no TikTok Shop.
 * É a URL de redirecionamento cadastrada no Partner Center:
 *   https://app-financeiro-brown.vercel.app/api/tts-callback
 *
 * Fluxo: o Ailson abre o "link de autorização" logado na loja → o TikTok
 * redireciona pra cá com ?code= → trocamos o code por access_token → buscamos
 * o shop_cipher (obrigatório em quase toda chamada) → gravamos em tts_auth.
 *
 * ?conta=exitus  (default) — permite autorizar outras lojas depois.
 * Ailson 08/08/2026.
 */
import { supabase } from './_bling-helpers.js';
import { ctxTts, AUTH_HOST, chamarTts } from './_tts-api.js';

const pagina = (titulo, msg, ok = true) => `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titulo}</title></head>
<body style="font-family:Georgia,serif;background:#f7f4f0;color:#2c3e50;padding:40px;max-width:640px;margin:0 auto">
<h2 style="color:${ok ? '#1f7a48' : '#c0392b'}">${titulo}</h2>
<div style="font-size:15px;line-height:1.6">${msg}</div>
</body></html>`;

export default async function handler(req, res) {
  const ctx = ctxTts();
  if (!ctx) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(pagina('Faltam as variáveis de ambiente',
      'Cadastre <b>TIKTOK_APP_KEY</b> e <b>TIKTOK_APP_SECRET</b> na Vercel e faça um novo deploy antes de autorizar.', false));
  }

  const code = req.query?.code || req.query?.auth_code;
  const conta = String(req.query?.conta || 'exitus').toLowerCase();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (!code) {
    return res.status(400).send(pagina('Sem código de autorização',
      'O TikTok não mandou o parâmetro <code>code</code>. Abra o link de autorização de novo, já logado na loja.', false));
  }

  try {
    // 1. troca o code pelo token
    const url = `${AUTH_HOST}/api/v2/token/get?app_key=${ctx.appKey}&app_secret=${ctx.appSecret}`
      + `&auth_code=${encodeURIComponent(code)}&grant_type=authorized_code`;
    const d = await (await fetch(url)).json();
    const t = d?.data;
    if (!t?.access_token) {
      return res.status(400).send(pagina('O TikTok recusou o código',
        `Resposta: <pre style="white-space:pre-wrap">${JSON.stringify(d)}</pre>
         O código expira em poucos minutos — gere um link novo e tente de novo.`, false));
    }

    const authParcial = { access_token: t.access_token, shop_cipher: null };

    // 2. shop_cipher: sem ele a maioria das chamadas da API não funciona
    let shop = {};
    try {
      const lojas = await chamarTts('/seller/202309/shops', {}, authParcial, ctx);
      shop = lojas?.data?.shops?.[0] || {};
    } catch { /* segue sem cipher; dá pra buscar depois */ }

    const registro = {
      conta,
      seller_name: t.seller_name || null,
      shop_id: shop.id ? String(shop.id) : (t.seller_base_region || 'sem-shop-id'),
      shop_name: shop.name || null,
      shop_cipher: shop.cipher || null,
      access_token: t.access_token,
      refresh_token: t.refresh_token || null,
      expira_em: t.access_token_expire_in ? new Date(t.access_token_expire_in * 1000).toISOString() : null,
      refresh_expira_em: t.refresh_token_expire_in ? new Date(t.refresh_token_expire_in * 1000).toISOString() : null,
      atualizado_em: new Date().toISOString(),
    };
    const { error } = await supabase.from('tts_auth').upsert(registro, { onConflict: 'conta,shop_id' });
    if (error) throw new Error(error.message);

    return res.status(200).send(pagina('Loja autorizada ✓',
      `Conta: <b>${conta}</b><br>Loja: <b>${shop.name || t.seller_name || '—'}</b><br>
       shop_cipher: ${shop.cipher ? 'capturado ✓' : '<b style="color:#c0392b">não veio</b> (dá pra buscar depois)'}<br><br>
       Pode fechar esta página e me avisar no chat.`));
  } catch (e) {
    return res.status(500).send(pagina('Deu erro ao autorizar', String(e.message || e), false));
  }
}
