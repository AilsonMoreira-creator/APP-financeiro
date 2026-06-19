// Diagnóstico do token do Instagram (META_IG_ACCESS_TOKEN).
// GET /api/meluni-ig-debug?igsid=...
// v2: lista paginas do System User (+ vinculo IG) e re-tenta o lookup do nome
// usando o TOKEN DA PAGINA ligada ao @meluni.loja.
const GRAPH = 'https://graph.facebook.com/v21.0';
const MELUNI_IG_ID = '17841467501146555'; // @meluni.loja (IG professional account id)

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
  if (!token) { res.status(200).json({ ok:false, motivo:'META_IG_ACCESS_TOKEN ausente' }); return; }
  const enc = encodeURIComponent(token);

  // 1) paginas que o System User enxerga, com vinculo IG e token da pagina
  const contas = await g(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${enc}`);

  // monta lista resumida (sem expor tokens)
  const pages = [];
  let pageTokenMeluni = null, pageInfoMeluni = null;
  const arr = (contas.body && contas.body.data) || [];
  for (const p of arr) {
    const ig = p.instagram_business_account || null;
    pages.push({ page_id: p.id, page_name: p.name, temToken: !!p.access_token, ig: ig ? { id: ig.id, username: ig.username } : null });
    if (ig && String(ig.id) === MELUNI_IG_ID && p.access_token) { pageTokenMeluni = p.access_token; pageInfoMeluni = { page_id:p.id, page_name:p.name, ig_username: ig.username }; }
  }
  // fallback: primeira pagina com IG e token, se nao casar o id exato
  if (!pageTokenMeluni) {
    for (const p of arr) { if (p.instagram_business_account && p.access_token) { pageTokenMeluni = p.access_token; pageInfoMeluni = { page_id:p.id, page_name:p.name, ig_username:(p.instagram_business_account.username||null), _fallback:true }; break; } }
  }

  // 2) lookup do IGSID usando o TOKEN DA PAGINA
  let lookupComPagina = null;
  if (pageTokenMeluni) {
    const encP = encodeURIComponent(pageTokenMeluni);
    lookupComPagina = await g(`${GRAPH}/${igsid}?fields=name,username&access_token=${encP}`);
  }

  res.status(200).json({
    ok: true,
    igsid,
    contas_status: contas.status,
    contas_erro: (contas.body && contas.body.error) || null,
    qtdPaginas: pages.length,
    pages,
    paginaMeluni: pageInfoMeluni,
    lookupComPagina,
  });
}
