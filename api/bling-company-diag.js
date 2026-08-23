// /api/bling-company-diag — one-off: descobre o companyId (ID da empresa)
// de cada conta Bling — e o que casa o webhook com exitus/lumia/muniam.
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';

const API = 'https://api.bling.com.br/Api/v3';

export default async function handler(req, res) {
  const saida = {};
  for (const conta of ['exitus', 'lumia', 'muniam']) {
    try {
      const tk = await refreshBlingToken(conta);
      const r = await blingFetch(`${API}/empresas/me/dados-basicos`, tk);
      const j = await r.json().catch(() => ({}));
      saida[conta] = r.ok ? { id: j?.data?.id ?? j?.id ?? null, nome: j?.data?.nome ?? j?.data?.razaoSocial ?? null } : { erro: r.status, corpo: JSON.stringify(j).slice(0, 120) };
    } catch (e) { saida[conta] = { erro: String(e?.message || e).slice(0, 80) }; }
  }
  return res.status(200).json(saida);
}
