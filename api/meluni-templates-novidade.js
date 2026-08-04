// ============================================================================
// /api/meluni-templates-novidade — gestão dos templates de campanha da Lara
// (aba Clientes, botão Templates). Ailson 03/08/2026.
//
//   GET  -> { ok, idioma, templates: [{ versao, name, body, sample_url }] }
//   POST { versao, sample_url }            -> troca o criativo por URL direta
//   POST { versao, imagem_base64, content_type } -> sobe a imagem no bucket
//        sofia-midias (campanhas/{versao}-{ts}.ext), troca o sample_url e
//        devolve a URL nova. O PRÓXIMO disparo daquele template já sai com o
//        criativo novo (o headerImage é lido da config a cada envio).
//
// Obs: isso troca a imagem QUE A GENTE MANDA no header do template (por envio).
// O corpo/nome do template continua o aprovado na Meta.
// ============================================================================
import { supabase, cfgMeluni, setCfgMeluni } from './_meluni-whats-helpers.js';

const CFG_KEY = 'lara_templates_novidade';
const BUCKET = 'sofia-midias';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const spec = (await cfgMeluni(CFG_KEY, null)) || { templates: {} };
    const tpls = spec.templates || {};

    if (req.method === 'GET') {
      // uso real nos ultimos 30 dias (meluni_mensagens por nome de template)
      const nomes = Object.values(tpls).map(t => t?.name).filter(Boolean);
      const uso = {};
      if (nomes.length) {
        const desde = new Date(Date.now() - 30 * 86400000).toISOString();
        const { data: msgs } = await supabase.from('meluni_mensagens')
          .select('template_usado').in('template_usado', nomes).gte('enviada_em', desde).limit(10000);
        (msgs || []).forEach(m => { uso[m.template_usado] = (uso[m.template_usado] || 0) + 1; });
      }
      const lista = Object.entries(tpls).map(([versao, t]) => ({
        versao,
        name: t?.name || null,
        body: t?.body || null,
        sample_url: t?.header?.format === 'IMAGE' ? (t?.header?.sample_url || null) : null,
        tem_imagem: t?.header?.format === 'IMAGE',
        status: t?.status || 'ativo', // ativo | inativo | arquivado (Ailson 03/08/2026)
        uso_30d: uso[t?.name] || 0,
      }));
      return res.status(200).json({ ok: true, idioma: spec.idioma || 'pt_BR', padrao: spec.padrao || null, templates: lista });
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
      const versao = String(body?.versao || '').trim();
      if (!versao || !tpls[versao]) return res.status(400).json({ ok: false, erro: 'versao invalida' });

      // define o template PADRAO da campanha manual (Ailson 04/08/2026)
      if (body?.acao === 'padrao') {
        if (!tpls[versao]) return res.status(400).json({ ok: false, erro: 'versao invalida' });
        await setCfgMeluni(CFG_KEY, { ...spec, padrao: versao });
        return res.status(200).json({ ok: true, padrao: versao });
      }

      // troca de STATUS (ativo | inativo | arquivado) — Ailson 03/08/2026
      if (body?.status) {
        const st = String(body.status);
        if (!['ativo', 'inativo', 'arquivado'].includes(st)) return res.status(400).json({ ok: false, erro: 'status invalido' });
        const novoSpec = { ...spec, templates: { ...tpls, [versao]: { ...tpls[versao], status: st } } };
        await setCfgMeluni(CFG_KEY, novoSpec);
        return res.status(200).json({ ok: true, versao, status: st });
      }

      let novaUrl = String(body?.sample_url || '').trim() || null;

      if (!novaUrl && body?.imagem_base64) {
        const ct = String(body.content_type || 'image/jpeg');
        const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
        const b64 = String(body.imagem_base64).replace(/^data:[^;]+;base64,/, '');
        const buf = Buffer.from(b64, 'base64');
        if (buf.length > 4.5 * 1024 * 1024) return res.status(400).json({ ok: false, erro: 'imagem acima de 4.5MB' });
        const path = `campanhas/${versao}-${Date.now()}.${ext}`;
        const { error: eUp } = await supabase.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true });
        if (eUp) return res.status(500).json({ ok: false, erro: 'upload: ' + eUp.message });
        const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
        novaUrl = pub?.publicUrl || null;
      }
      if (!novaUrl) return res.status(400).json({ ok: false, erro: 'mande sample_url ou imagem_base64' });

      const novoSpec = { ...spec, templates: { ...tpls } };
      novoSpec.templates[versao] = {
        ...tpls[versao],
        header: { ...(tpls[versao].header || {}), format: 'IMAGE', sample_url: novaUrl },
      };
      await setCfgMeluni(CFG_KEY, novoSpec);
      return res.status(200).json({ ok: true, versao, sample_url: novaUrl });
    }

    return res.status(405).json({ ok: false, erro: 'use GET ou POST' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
