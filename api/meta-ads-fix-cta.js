/**
 * meta-ads-fix-cta.js — Corrige o erro Meta #1815630 em criativos de vídeo.
 *
 *   "Há muitos parâmetros na chamada para ação: Remova o parâmetro 'link'
 *    do valor do tipo de chamada para ação WHATSAPP_MESSAGE."
 *
 * Estratégia cirúrgica (não reconstrói nada):
 *   1. Lê object_story_spec / asset_feed_spec do criativo do anúncio.
 *   2. Clona TUDO e remove SÓ a chave `value.link` de qualquer call_to_action
 *      WHATSAPP_MESSAGE — preserva vídeo, texto, headline, thumbnail e a
 *      mensagem de boas-vindas do WhatsApp.
 *   3. Cria criativo novo já corrigido.
 *   4. Troca o criativo no anúncio.
 *
 * Auth:   ?token=<CRON_SECRET>  (ou header X-Cron-Secret)
 * Method: GET = DRY-RUN (não altera nada) | POST = APLICA
 * Params (query OU body):
 *   account   (allowlist, default 338013328231048 Amícia B2B)
 *   ad_ids    CSV (query) ou array (body); default = 4 vídeos da sofia_lojistas
 *
 * Sessão Ailson 28/05/2026 — destravar publicação dos vídeos CTWA B2B.
 */
import { setCors } from './_lojas-helpers.js';

const META_API_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

const CONTAS_VALIDAS = {
  '943539471358534': 'Meluni B2C',
  '338013328231048': 'Amícia B2B',
  '626487585630124': 'Amícia Cartão',
};

// 4 anúncios de vídeo com o erro (campanha amicia_b2b_whatsapp_crm-sofia_lojistas)
const DEFAULT_AD_IDS = [
  '120246410669820223', // ad_video_amicia_BB_B_v1
  '120246410655170223', // ad_video_amicia_BB_A_v1
  '120246422497420223', // ad_video_amicia_BB_A_v2
  '120246422514980223', // ad_video_amicia_BB_B_v2
];

async function graph(token, path, { method = 'GET', params = {}, body = null } = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const opts = { method };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url.toString(), opts);
  const json = await r.json();
  if (json.error) {
    const e = new Error(json.error.message || 'Graph API error');
    e.graph = json.error;
    throw e;
  }
  return json;
}

// Remove value.link de todo call_to_action WHATSAPP_MESSAGE, em qualquer nível.
function stripWhatsappLink(node, counter) {
  if (Array.isArray(node)) {
    for (const item of node) stripWhatsappLink(item, counter);
    return counter;
  }
  if (node && typeof node === 'object') {
    if (
      node.type === 'WHATSAPP_MESSAGE' &&
      node.value && typeof node.value === 'object' && 'link' in node.value
    ) {
      counter.links.push(node.value.link);
      delete node.value.link;
      counter.removed += 1;
    }
    for (const k of Object.keys(node)) stripWhatsappLink(node[k], counter);
  }
  return counter;
}

async function fixAd(token, account, adId, apply) {
  const ad = await graph(token, adId, {
    params: { fields: 'name,creative{id,name,object_story_spec,asset_feed_spec,instagram_user_id}' },
  });
  const creative = ad.creative || {};
  const out = {
    ad_id: adId, ad_name: ad.name, old_creative_id: creative.id,
    removed: 0, removed_links: [], new_creative_id: null, applied: false, note: null,
  };

  if (!creative.object_story_spec && !creative.asset_feed_spec) {
    out.note = 'Criativo sem spec legível — pulado.';
    return out;
  }

  const spec = creative.object_story_spec
    ? JSON.parse(JSON.stringify(creative.object_story_spec)) : undefined;
  const afs = creative.asset_feed_spec
    ? JSON.parse(JSON.stringify(creative.asset_feed_spec)) : undefined;

  const counter = { removed: 0, links: [] };
  if (spec) stripWhatsappLink(spec, counter);
  if (afs) stripWhatsappLink(afs, counter);
  out.removed = counter.removed;
  out.removed_links = counter.links;

  if (counter.removed === 0) {
    out.note = 'Nenhum link no CTA WHATSAPP_MESSAGE — já pode estar ok.';
    return out;
  }
  if (!apply) {
    out.note = 'DRY-RUN: nada alterado. Use POST para aplicar.';
    return out;
  }

  const payload = { name: `${creative.name || ad.name || 'creative'} — wa-fix` };
  if (spec) payload.object_story_spec = spec;
  if (afs) payload.asset_feed_spec = afs;
  if (creative.instagram_user_id) payload.instagram_user_id = creative.instagram_user_id;

  const created = await graph(token, `act_${account}/adcreatives`, { method: 'POST', body: payload });
  out.new_creative_id = created.id;

  await graph(token, adId, { method: 'POST', body: { creative: { creative_id: created.id } } });
  out.applied = true;
  out.note = 'Criativo corrigido e trocado no anúncio.';
  return out;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (dry-run) ou POST (aplicar) apenas' });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return res.status(500).json({ error: 'CRON_SECRET não configurado' });
  const tokenRecebido = req.query.token || req.headers['x-cron-secret'];
  if (tokenRecebido !== cronSecret) return res.status(401).json({ error: 'não autorizado (token inválido)' });

  const META_ADS_TOKEN = process.env.META_ADS_TOKEN;
  if (!META_ADS_TOKEN) return res.status(500).json({ error: 'META_ADS_TOKEN ausente nas env vars' });

  const p = { ...(req.body || {}), ...req.query };
  const account = String(p.account || '338013328231048');
  if (!CONTAS_VALIDAS[account]) {
    return res.status(400).json({ error: `conta inválida: ${account}`, validas: CONTAS_VALIDAS });
  }

  let adIds = DEFAULT_AD_IDS;
  if (Array.isArray(p.ad_ids) && p.ad_ids.length) adIds = p.ad_ids.map(String);
  else if (typeof p.ad_ids === 'string' && p.ad_ids.trim()) adIds = p.ad_ids.split(',').map((s) => s.trim());

  const apply = req.method === 'POST';
  const results = [];
  for (const adId of adIds) {
    try {
      results.push(await fixAd(META_ADS_TOKEN, account, adId, apply));
    } catch (err) {
      results.push({ ad_id: adId, error: err.message, graph: err.graph || null });
    }
  }

  return res.status(200).json({
    ok: true,
    mode: apply ? 'APPLIED' : 'DRY-RUN (use POST para aplicar)',
    account: `${account} (${CONTAS_VALIDAS[account]})`,
    count: results.length,
    results,
  });
}
