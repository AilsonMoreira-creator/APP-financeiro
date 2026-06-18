// Diagnóstico do token Meta atual (o do WhatsApp/Lara, META_WA_ACCESS_TOKEN).
// Mostra quem é o token, de qual app, quais escopos tem, quando expira, e se
// já cobre Instagram (mensagens/comentários) + quais Páginas/IG ele enxerga.
// Serve pra saber se o token que já está no Vercel basta pro Direct/comentários,
// ou se precisa de um novo (OAuth / regenerar com permissões de IG).
const GRAPH = 'https://graph.facebook.com/v21.0';

async function gget(path) {
  try {
    const r = await fetch(`${GRAPH}${path}`);
    const t = await r.text();
    let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* nao json */ }
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) { return { ok: false, status: 0, json: { error: { message: String(e?.message || e) } } }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const token = process.env.META_WA_ACCESS_TOKEN;
  const secret = process.env.META_WA_APP_SECRET;
  if (!token) return res.status(200).json({ ok: false, erro: 'META_WA_ACCESS_TOKEN ausente no Vercel' });

  const enc = encodeURIComponent;
  const out = { ok: true };

  const me = await gget(`/me?fields=id,name&access_token=${enc(token)}`);
  out.me = me.ok ? me.json : { erro: me.json?.error?.message || me.status };

  const app = await gget(`/app?fields=id,name&access_token=${enc(token)}`);
  out.app = app.ok ? app.json : { erro: app.json?.error?.message || app.status };
  const appId = app.json?.id || null;

  let scopes = [];
  if (appId && secret) {
    const dbg = await gget(`/debug_token?input_token=${enc(token)}&access_token=${enc(appId + '|' + secret)}`);
    const d = dbg.ok ? dbg.json?.data : null;
    if (d) {
      scopes = d.scopes || [];
      out.token = {
        tipo: d.type, app_id: d.app_id, valido: d.is_valid,
        expira_em: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : 'long-lived/sem expiração',
        escopos: scopes,
      };
    } else {
      out.token = { erro: dbg.json?.error?.message || ('status ' + dbg.status) };
    }
  } else {
    out.token = { erro: 'faltou app_id (do /app) ou META_WA_APP_SECRET pra rodar o debug_token' };
  }

  const igScopes = [
    'instagram_basic', 'instagram_manage_messages', 'instagram_manage_comments',
    'instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments',
    'pages_messaging', 'pages_manage_metadata', 'pages_show_list',
  ];
  out.escopos_instagram_presentes = scopes.filter(s => igScopes.includes(s));
  out.cobre_instagram = out.escopos_instagram_presentes.length > 0;

  const accts = await gget(`/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=${enc(token)}`);
  out.paginas = accts.ok ? (accts.json?.data || []) : { erro: accts.json?.error?.message || accts.status };

  return res.status(200).json(out);
}
