/**
 * tts-shops.js — busca as lojas autorizadas no TikTok Shop e grava o
 * shop_cipher, que é exigido em quase toda chamada da API.
 * Serve também de diagnóstico: ?cru=1 devolve a resposta crua do TikTok.
 * Ailson 08/08/2026.
 */
import { supabase } from './_bling-helpers.js';
import { authTts, chamarTts } from './_tts-api.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const conta = String(req.query?.conta || 'exitus').toLowerCase();
  const a = await authTts(conta);
  if (a.erro) return res.status(400).json(a);
  const { auth, ctx } = a;

  // ?perm=1 -> lista CRUA das permissões que o TikTok concedeu ao app
  if (req.query?.perm === '1') {
    const r = await chamarTts('/seller/202309/permissions', {}, { access_token: auth.access_token }, ctx);
    return res.status(200).json(r);
  }

  // ?sondar=1 -> testa vários endpoints pra descobrir QUAIS escopos passaram
  // (o TikTok não tem introspecção de token; a única forma é bater e ver o erro)
  if (req.query?.sondar === '1') {
    const alvos = [
      ['authorization', '/authorization/202309/shops', {}],
      ['seller/shops', '/seller/202309/shops', {}],
      ['seller/permissions', '/seller/202309/permissions', {}],
      ['order/search', '/order/202309/orders/search', { page_size: '1' }],
      ['product/list', '/product/202309/products/search', { page_size: '1' }],
      ['finance/statements', '/finance/202309/statements', { page_size: '1' }],
      ['customer_service', '/customer_service/202309/conversations', { page_size: '1' }],
    ];
    const out = {};
    for (const [nome, path, params] of alvos) {
      try {
        const r = await chamarTts(path, params, { access_token: auth.access_token }, ctx);
        out[nome] = { code: r?.code, message: String(r?.message || '').slice(0, 90) };
      } catch (e) { out[nome] = { erro: String(e.message).slice(0, 90) }; }
    }
    return res.status(200).json({ conta, sondagem: out });
  }

  // O endpoint certo é /seller/202309/shops — o /authorization/202309/shops
  // exige um escopo que este app não tem (sondagem de 08/08 devolveu 105005 nele
  // e Success neste). Aqui NÃO se manda shop_cipher: é ele que devolve o cipher.
  const d = await chamarTts('/seller/202309/shops', {}, { access_token: auth.access_token }, ctx);
  if (req.query?.cru === '1') return res.status(200).json({ resposta: d });

  const shops = d?.data?.shops || [];
  if (!shops.length) {
    return res.status(400).json({ erro: 'nenhuma loja voltou', code: d?.code, message: d?.message, resposta: d });
  }

  const s = shops[0];
  const { error } = await supabase.from('tts_auth').update({
    shop_id: String(s.id), shop_name: s.name || null, shop_cipher: s.cipher || null,
    atualizado_em: new Date().toISOString(),
  }).eq('id', auth.id);
  if (error) return res.status(500).json({ erro: error.message });

  return res.status(200).json({
    ok: true, conta,
    lojas: shops.map(x => ({ id: String(x.id), nome: x.name, regiao: x.region, cipher: x.cipher ? 'ok' : null })),
  });
}
