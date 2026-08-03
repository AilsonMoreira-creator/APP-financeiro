// ============================================================================
// /api/meluni-templates-carrinho — templates usados na aba CARRINHO da Lara
// (botão Templates da aba). Ailson 03/08/2026.
//
//   GET -> { ok, carrinho: [{versao, name, body, com_foto}], newsletter: {...} }
//     - grupo "carrinho abandonado": lara_templates_carrinho (texto) +
//       lara_templates_carrinho_img (com foto). INFORMATIVOS: a foto que sai
//       neles é A DO PRODUTO do carrinho (dinâmica, montada a cada envio) —
//       não existe criativo fixo pra trocar.
//     - grupo "newsletter": lara_template_newsletter — tem criativo FIXO
//       trocável (sample_url); o disparo manda essa foto no header.
//
//   POST { sample_url }                        -> troca o criativo da newsletter
//   POST { imagem_base64, content_type }       -> sobe imagem no bucket
//        sofia-midias (campanhas/newsletter-{ts}.ext) e troca o criativo.
// ============================================================================
import { supabase, cfgMeluni, setCfgMeluni } from './_meluni-whats-helpers.js';

const BUCKET = 'sofia-midias';
const CFG_NEWS = 'lara_template_newsletter';

async function lerNews() {
  const v = await cfgMeluni(CFG_NEWS, null);
  if (!v) return null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    try { const o = JSON.parse(t); if (o && typeof o === 'object') return o; } catch { /* string simples */ }
    return { template: t, com_nome: true };
  }
  return typeof v === 'object' ? v : null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    if (req.method === 'GET') {
      const tplsBase = ((await cfgMeluni('lara_templates_carrinho', {})) || {}).templates || {};
      const tplsImg = ((await cfgMeluni('lara_templates_carrinho_img', {})) || {}).templates || {};
      const carrinho = [
        ...Object.entries(tplsBase).map(([versao, t]) => ({ versao, name: t?.name || null, body: t?.body || null, com_foto: false })),
        ...Object.entries(tplsImg).map(([versao, t]) => ({ versao, name: t?.name || null, body: t?.body || null, com_foto: true })),
      ];
      const news = await lerNews();
      return res.status(200).json({
        ok: true,
        carrinho,
        newsletter: news ? { template: news.template || null, com_nome: news.com_nome !== false, sample_url: news.sample_url || null } : null,
      });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const news = (await lerNews()) || {};
      let novaUrl = String(body?.sample_url || '').trim() || null;

      if (!novaUrl && body?.imagem_base64) {
        const ct = String(body.content_type || 'image/jpeg');
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
        const b64 = String(body.imagem_base64).replace(/^data:[^;]+;base64,/, '');
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 4.5 * 1024 * 1024) return res.status(400).json({ ok: false, erro: 'imagem acima de 4.5MB' });
        const path = `campanhas/newsletter-${Date.now()}.${ext}`;
        const { error: eUp } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true });
        if (eUp) return res.status(500).json({ ok: false, erro: 'upload: ' + eUp.message });
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        novaUrl = pub?.publicUrl || null;
      }
      if (!novaUrl) return res.status(400).json({ ok: false, erro: 'mande sample_url ou imagem_base64' });

      await setCfgMeluni(CFG_NEWS, { ...news, sample_url: novaUrl });
      return res.status(200).json({ ok: true, sample_url: novaUrl, template: news.template || null });
    }

    return res.status(405).json({ ok: false, erro: 'use GET ou POST' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
