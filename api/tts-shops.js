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

  // nesta chamada NÃO se manda shop_cipher (é ela que devolve o cipher)
  const d = await chamarTts('/authorization/202309/shops', {}, { access_token: auth.access_token }, ctx);
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
