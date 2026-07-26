// ═══════════════════════════════════════════════════════════════════════════
// TROCA A FOTO DE UMA REF NO BUCKET produtos/ PELA FOTO DO BLING (Ailson 26/07/2026)
// Caso de uso: a foto manual da calculadora ficou ruim e o cadastro do Bling
// tem foto melhor — sobrescreve os objetos existentes (upsert), entao ranking
// TikTok, card do modulo e calculadora (que apontam pras mesmas URLs) trocam
// juntos. Criado pro caso da ref 395.
//
// GET ?ref=395            -> dry: mostra o link achado no Bling, nao grava
// GET ?ref=395&run=1      -> baixa e SOBRESCREVE {ref}.jpg e {pad4}.jpg
// opcional: &conta=exitus (default)
// ═══════════════════════════════════════════════════════════════════════════
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };
const API = 'https://api.bling.com.br/Api/v3';

const linkDoDetalhe = (det) =>
  det?.midia?.imagens?.internas?.[0]?.link
  || det?.midia?.imagens?.externas?.[0]?.link
  || null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const q = req.query || {};
  try {
    const refN = String(q.ref || '').replace(/\D/g, '').replace(/^0+/, '');
    if (!refN) return res.status(400).json({ ok: false, erro: 'use ?ref=NNN' });
    const conta = q.conta || 'exitus';

    // id do produto no espelho do estoque (qualquer variacao da ref serve)
    const { data: linhas } = await supabase.from('bling_estoque')
      .select('bling_produto_id, bling_sku').eq('ref', refN).not('bling_produto_id', 'is', null).limit(1);
    const prodId = linhas?.[0]?.bling_produto_id;
    if (!prodId) return res.status(404).json({ ok: false, erro: `ref ${refN} sem bling_produto_id no espelho` });

    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}` };
    const rd = await blingFetch(`${API}/produtos/${prodId}`, headers);
    const jd = await rd.json().catch(() => null);
    if (rd.status !== 200) return res.status(502).json({ ok: false, erro: `detalhe ${rd.status}` });
    const det = jd?.data || {};
    let link = linkDoDetalhe(det);
    const paiId = det?.variacao?.produtoPai?.id || null;
    if (!link && paiId) {
      const rp = await blingFetch(`${API}/produtos/${paiId}`, headers);
      const jp = await rp.json().catch(() => null);
      if (rp.status === 200) link = linkDoDetalhe(jp?.data || {});
    }
    if (!link) return res.status(404).json({ ok: false, erro: 'produto sem foto no Bling', prodId, paiId });

    if (q.run !== '1') return res.status(200).json({ ok: true, dry: true, refN, prodId, paiId, link });

    const ri = await fetch(link);
    if (!ri.ok) return res.status(502).json({ ok: false, erro: `download foto ${ri.status}` });
    const buf = Buffer.from(await ri.arrayBuffer());

    const destinos = [`${refN}.jpg`, `${refN.padStart(4, '0')}.jpg`];
    const gravados = [];
    for (const nome of destinos) {
      const { error } = await supabase.storage.from('produtos')
        .upload(nome, buf, { contentType: 'image/jpeg', upsert: true });
      if (error) return res.status(500).json({ ok: false, erro: `upload ${nome}: ${error.message}`, gravados });
      gravados.push(nome);
    }
    return res.status(200).json({ ok: true, refN, bytes: buf.length, gravados, link });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: e?.message || String(e) });
  }
}
