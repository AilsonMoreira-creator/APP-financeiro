// MELUNI — diagnóstico do encanamento de mensagens do Instagram.
// Mostra: dados da Página + IG vinculado, quais apps estão inscritos na Página
// (subscribed_apps) e com quais campos, e as assinaturas do app no objeto
// instagram. Serve pra ver se a @meluni.loja está de fato conectada pra DM.
const GRAPH = 'https://graph.facebook.com/v21.0';
const APP_ID = '1862054317831156';
const PAGE_ID = '937666662772306';
const IG_ID = '17841467501146555';
const enc = encodeURIComponent;

async function gget(path, params) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${GRAPH}${path}?${qs}`);
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* nao json */ }
  return { ok: r.ok, status: r.status, json: j };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const token = process.env.META_WA_ACCESS_TOKEN;
  const secret = process.env.META_WA_APP_SECRET;
  const out = { ok: true };

  const pg = await gget(`/${PAGE_ID}`, {
    fields: 'name,access_token,instagram_business_account{id,username},connected_instagram_account{id,username}',
    access_token: token,
  });
  out.pagina = pg.ok ? { name: pg.json?.name, instagram_business_account: pg.json?.instagram_business_account, connected_instagram_account: pg.json?.connected_instagram_account, tem_page_token: !!pg.json?.access_token } : { erro: pg.json?.error?.message || pg.status };

  const pageToken = pg.json?.access_token;
  if (pageToken) {
    const sa = await gget(`/${PAGE_ID}/subscribed_apps`, { access_token: pageToken });
    out.subscribed_apps = sa.ok ? (sa.json?.data || []) : { erro: sa.json?.error?.message || sa.status };
  } else {
    out.subscribed_apps = { erro: 'sem page token' };
  }

  if (APP_ID && secret) {
    const subs = await gget(`/${APP_ID}/subscriptions`, { access_token: `${APP_ID}|${secret}` });
    out.app_subscriptions = subs.ok ? (subs.json?.data || []).filter(s => s.object === 'instagram') : { erro: subs.json?.error?.message || subs.status };
  }

  // a conta IG enxerga conversas? (se messaging estiver ligado, /conversations responde)
  const conv = await gget(`/${IG_ID}/conversations`, { platform: 'instagram', access_token: token });
  out.ig_conversations_probe = conv.ok
    ? { ok: true, qtd: (conv.json?.data || []).length }
    : { erro: conv.json?.error?.message || conv.status, code: conv.json?.error?.code || null };

  return res.status(200).json(out);
}
