// ============================================================================
// MELUNI — setup do webhook de Instagram (uma vez). Faz, via API, o que se faria
// no painel do app: (1) assina o app no objeto 'instagram' apontando pro nosso
// callback (meluni-ig-webhook) com o verify_token; (2) inscreve a Página da
// Meluni no app pros eventos de mensagem/comentário.
// Usa o App access token (APP_ID|META_WA_APP_SECRET) e o System User token.
// Idempotente — pode rodar de novo sem problema. Ailson 18/06/2026.
// ============================================================================
const GRAPH = 'https://graph.facebook.com/v21.0';
const APP_ID = '1862054317831156';            // app "claude"
const PAGE_ID = '937666662772306';            // Página Meluni (IG @meluni.loja)
const CALLBACK = 'https://app-financeiro-brown.vercel.app/api/meluni-ig-webhook';
const enc = encodeURIComponent;

async function meta(method, path, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${GRAPH}${path}?${qs}`, { method });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* nao json */ }
  return { ok: r.ok, status: r.status, json: j };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const token = process.env.META_WA_ACCESS_TOKEN;
  const secret = process.env.META_WA_APP_SECRET;
  const verify = process.env.META_WA_VERIFY_TOKEN;
  if (!token || !secret || !verify) {
    return res.status(200).json({ ok: false, erro: 'faltou META_WA_ACCESS_TOKEN / META_WA_APP_SECRET / META_WA_VERIFY_TOKEN' });
  }
  const appToken = `${APP_ID}|${secret}`;
  const out = { ok: true, callback: CALLBACK };

  // 1) assina o app no objeto 'instagram' (DMs + comentários)
  const sub = await meta('POST', `/${APP_ID}/subscriptions`, {
    object: 'instagram',
    callback_url: CALLBACK,
    verify_token: verify,
    fields: 'messages,comments',
    access_token: appToken,
  });
  out.assinatura_app = sub.ok ? sub.json : { erro: sub.json?.error?.message || sub.status };

  // confere as assinaturas atuais do app
  const lst = await meta('GET', `/${APP_ID}/subscriptions`, { access_token: appToken });
  out.assinaturas_atuais = lst.ok ? (lst.json?.data || []) : { erro: lst.json?.error?.message || lst.status };

  // 2) pega o Page access token da Meluni e inscreve a Página no app
  const pg = await meta('GET', `/${PAGE_ID}`, { fields: 'access_token,name', access_token: token });
  if (pg.ok && pg.json?.access_token) {
    const pageToken = pg.json.access_token;
    const subPage = await meta('POST', `/${PAGE_ID}/subscribed_apps`, {
      subscribed_fields: 'messages,messaging_postbacks,message_reactions,comments',
      access_token: pageToken,
    });
    out.inscricao_pagina = subPage.ok ? subPage.json : { erro: subPage.json?.error?.message || subPage.status };
  } else {
    out.inscricao_pagina = { erro: pg.json?.error?.message || ('sem access_token da página (status ' + pg.status + ')') };
  }

  return res.status(200).json(out);
}
