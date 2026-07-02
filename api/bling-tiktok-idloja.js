// ============================================================================
// BLING — "ID na loja" (TikTok) por variação, conta Exitus.
// Objetivo: puxar o código externo que o Bling guarda no vínculo com a loja
// TikTok (idLoja 205414310) pra cada variação, e comparar com o sku_id do
// TikTok (Check 2 da auditoria TikTok x Bling).
//
// O detalhe de /produtos/{id} NÃO traz o vínculo de loja — ele vive no recurso
// "Produtos → Lojas". Este arquivo tem um modo PROBE pra descobrir a chamada
// certa (só leitura, não grava nada), e depois vira a sync completa.
//
// Uso PROBE: /api/bling-tiktok-idloja?probe=1&id=16666572572&codigo=I42bn25zfz323cklm545
// Ailson 02/07/2026.
// ============================================================================
import { refreshBlingToken, blingFetch } from './_bling-helpers.js';

const API = 'https://api.bling.com.br/Api/v3';
const ID_LOJA_TIKTOK_EXITUS = '205414310';

async function tryCall(label, url, headers) {
  try {
    const r = await blingFetch(url, headers);
    const txt = await r.text().catch(() => '');
    return { label, url, http: r.status, body: txt.slice(0, 1600) };
  } catch (e) {
    return { label, url, erro: String(e?.message || e) };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  const conta = (q.conta || 'exitus').toLowerCase();
  const idLoja = String(q.idLoja || ID_LOJA_TIKTOK_EXITUS);

  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/json' };

    if (q.probe) {
      const id = String(q.id || '');
      const codigo = String(q.codigo || '');
      const out = { conta, idLoja, id, codigo, tentativas: [] };
      out.tentativas.push(await tryCall('A produtos/{id}', `${API}/produtos/${id}`, headers));
      out.tentativas.push(await tryCall('B produtos/{id}?idLoja', `${API}/produtos/${id}?idLoja=${idLoja}`, headers));
      out.tentativas.push(await tryCall('C produtos/lojas/{id}', `${API}/produtos/lojas/${id}`, headers));
      out.tentativas.push(await tryCall('D produtos/lojas?idLoja&idProduto', `${API}/produtos/lojas?idLoja=${idLoja}&idProduto=${id}`, headers));
      out.tentativas.push(await tryCall('E produtos/lojas?idLoja&idsProdutos[]', `${API}/produtos/lojas?idLoja=${idLoja}&idsProdutos[]=${id}`, headers));
      out.tentativas.push(await tryCall('F produtos/lojas?idLoja (lista)', `${API}/produtos/lojas?idLoja=${idLoja}&limite=3`, headers));
      out.tentativas.push(await tryCall('G produtos?idLoja&codigos[]', `${API}/produtos?idLoja=${idLoja}&codigos%5B%5D=${encodeURIComponent(codigo)}`, headers));
      return res.json(out);
    }

    return res.json({ ok: true, msg: 'use ?probe=1&id=IDPRODUTO&codigo=CODIGO pra sondar o vínculo de loja' });
  } catch (e) {
    return res.status(500).json({ conta, erro: String(e?.message || e) });
  }
}
