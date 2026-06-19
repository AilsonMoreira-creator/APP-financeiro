// Diagnóstico do token do Instagram (META_IG_ACCESS_TOKEN).
// GET /api/meluni-ig-debug?igsid=...  (igsid default = conversa de teste)
// Devolve: quem é o token (/me), escopos (/me/permissions) e o resultado cru
// das chamadas de nome no IGSID, com vários conjuntos de fields.
const GRAPH = 'https://graph.facebook.com/v21.0';

async function g(url) {
  try {
    const r = await fetch(url);
    const status = r.status;
    let body;
    try { body = await r.json(); } catch { body = { _naoJson: await r.text().catch(() => '') }; }
    return { status, body };
  } catch (e) {
    return { fetchError: String(e && e.message || e) };
  }
}

export default async function handler(req, res) {
  const token = process.env.META_IG_ACCESS_TOKEN || '';
  const igsid = (req.query && req.query.igsid) || '1947624729286344';

  if (!token) {
    res.status(200).json({ ok: false, motivo: 'META_IG_ACCESS_TOKEN ausente nesta função' });
    return;
  }

  const enc = encodeURIComponent(token);

  const who  = await g(`${GRAPH}/me?fields=id,name,username&access_token=${enc}`);
  const perms = await g(`${GRAPH}/me/permissions?access_token=${enc}`);

  const camposLista = ['name,username', 'username', 'name', 'name,username,profile_pic'];
  const lookups = {};
  for (const campos of camposLista) {
    lookups[campos] = await g(`${GRAPH}/${igsid}?fields=${encodeURIComponent(campos)}&access_token=${enc}`);
  }

  res.status(200).json({
    ok: true,
    igsid,
    tokenLen: token.length,
    who,
    perms,
    lookups,
  });
}
