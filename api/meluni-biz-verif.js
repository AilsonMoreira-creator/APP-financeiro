// Diagnóstico: status de verificação das business portfolios.
// GET /api/meluni-biz-verif  -> consulta verification_status com cada token.
const GRAPH = 'https://graph.facebook.com/v21.0';
const TOKENS = [
  ['IG', process.env.META_IG_ACCESS_TOKEN],
  ['ADS', process.env.META_ADS_TOKEN],
  ['WA', process.env.META_WA_ACCESS_TOKEN],
].filter(([, t]) => !!t);
const BIZ = { amicia_fashion: '1100759877135589', lumia: '1124013878706158' };
const enc = encodeURIComponent;

async function g(url) {
  try {
    const r = await fetch(url);
    let body; try { body = await r.json(); } catch { body = { _naoJson: true }; }
    return { status: r.status, body };
  } catch (e) { return { fetchError: String(e && e.message || e) }; }
}

export default async function handler(req, res) {
  const out = {};
  for (const [rotulo, tk] of TOKENS) {
    const e = enc(tk);
    out[rotulo] = {
      me_businesses: await g(`${GRAPH}/me/businesses?fields=id,name,verification_status&access_token=${e}`),
    };
    for (const [nome, id] of Object.entries(BIZ)) {
      out[rotulo][nome] = await g(`${GRAPH}/${id}?fields=id,name,verification_status&access_token=${e}`);
    }
  }
  res.status(200).json({ ok: true, resultado: out });
}
