/** drive-diag.js — SO LEITURA: qual conta Google e quais permissoes o servidor tem no Drive. */
import { getGoogleAccessToken as getAccessToken } from './_lojas-drive-helpers.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const t = await getAccessToken();
    const info = await (await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${t}`)).json();
    const about = await (await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName),storageQuota', { headers: { Authorization: `Bearer ${t}` } })).json();
    return res.status(200).json({ ok: true, escopos: String(info.scope || '').split(' '), conta: about.user, quota: about.storageQuota });
  } catch (e) { return res.status(500).json({ ok: false, erro: String(e?.message || e) }); }
}
