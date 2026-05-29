/**
 * meta-ads-criar-ad-video.js — Cria UM ad de vídeo via Graph API direta.
 *
 * Motivo: o MCP Meta Ads da Anthropic retorna INTERNAL error ao criar ads
 * de vídeo na conta Meluni B2C (943539471358534) — e os tools auxiliares
 * (ads_create_creative / ads_get_ad_videos) ainda estão em rollout gradual
 * pra essa conta. Esse endpoint contorna fazendo a chamada direta com o
 * META_ADS_TOKEN server-side, em 2 passos (creative isolado -> ad com
 * creative_id), que é o caminho com maior chance de driblar a restrição.
 *
 * Auth: ?token=<CRON_SECRET>  (ou header X-Cron-Secret)
 * Method: POST (params via query OU body JSON)
 *
 * Params:
 *   account            (allowlist)        ex 943539471358534
 *   adset_id                              ex 120248240103910310
 *   ad_name                               ex ad_video_2773_A_curve
 *   page_id                               ex 937666662772306
 *   instagram_user_id                     ex 17841467501146555
 *   video_id                              ex 2136537630224470
 *   image_hash         (thumbnail)        ex bf838977e98871...
 *   title                                 headline
 *   message                               primary text
 *   link                                  destino
 *   cta                (default SHOP_NOW)
 *   status             (default PAUSED)
 *
 * Sessão Ailson 28/05/2026 — desbloquear ads de vídeo ref2773 curve.
 */
import { setCors } from './_lojas-helpers.js';

const META_API_VERSION = 'v21.0';
const CONTAS_VALIDAS = {
  '943539471358534': 'Meluni B2C',
  '338013328231048': 'Amícia B2B',
  '626487585630124': 'Amícia Cartão',
};

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  // ── Auth ──────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: 'CRON_SECRET não configurado no ambiente' });
  }
  const tokenRecebido = req.query.token || req.headers['x-cron-secret'];
  if (tokenRecebido !== cronSecret) {
    return res.status(401).json({ error: 'não autorizado (token inválido)' });
  }

  const META_ADS_TOKEN = process.env.META_ADS_TOKEN;
  if (!META_ADS_TOKEN) {
    return res.status(500).json({ error: 'META_ADS_TOKEN ausente nas env vars' });
  }

  // ── Params (query OU body) ───────────────────────────────────────────────
  const p = { ...(req.body || {}), ...req.query };
  const {
    account,
    adset_id,
    ad_name,
    page_id,
    instagram_user_id,
    video_id,
    image_hash,
    title,
    message,
    link,
    cta = 'SHOP_NOW',
    status = 'PAUSED',
  } = p;

  if (!account || !CONTAS_VALIDAS[account]) {
    return res.status(400).json({ error: 'account inválido ou fora da allowlist', contas_validas: CONTAS_VALIDAS });
  }
  for (const [k, v] of Object.entries({ adset_id, ad_name, page_id, video_id, title, message, link })) {
    if (!v) return res.status(400).json({ error: `parâmetro obrigatório ausente: ${k}` });
  }

  // ── object_story_spec do vídeo ───────────────────────────────────────────
  const videoData = {
    video_id,
    title,
    message,
    call_to_action: { type: cta, value: { link } },
  };
  if (image_hash) videoData.image_hash = image_hash;

  const objectStorySpec = { page_id, video_data: videoData };
  if (instagram_user_id) objectStorySpec.instagram_user_id = instagram_user_id;

  const base = `https://graph.facebook.com/${META_API_VERSION}/act_${account}`;
  const passos = [];

  try {
    // ── Passo 1: criar creative isolado ────────────────────────────────────
    const creativeBody = new URLSearchParams();
    creativeBody.set('name', `creative_${ad_name}`);
    creativeBody.set('object_story_spec', JSON.stringify(objectStorySpec));
    creativeBody.set('access_token', META_ADS_TOKEN);

    const r1 = await fetch(`${base}/adcreatives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: creativeBody.toString(),
    });
    const d1 = await r1.json();
    passos.push({ passo: 'criar_creative', http: r1.status, resposta: d1 });

    if (d1.error || !d1.id) {
      return res.status(502).json({ ok: false, etapa: 'criar_creative', meta_error: d1.error || d1, passos });
    }
    const creativeId = d1.id;

    // ── Passo 2: criar ad com creative_id ──────────────────────────────────
    const adBody = new URLSearchParams();
    adBody.set('name', ad_name);
    adBody.set('adset_id', adset_id);
    adBody.set('status', status);
    adBody.set('creative', JSON.stringify({ creative_id: creativeId }));
    adBody.set('access_token', META_ADS_TOKEN);

    const r2 = await fetch(`${base}/ads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: adBody.toString(),
    });
    const d2 = await r2.json();
    passos.push({ passo: 'criar_ad', http: r2.status, resposta: d2 });

    if (d2.error || !d2.id) {
      return res.status(502).json({ ok: false, etapa: 'criar_ad', creative_id: creativeId, meta_error: d2.error || d2, passos });
    }

    return res.status(200).json({
      ok: true,
      ad_id: d2.id,
      ad_name,
      adset_id,
      creative_id: creativeId,
      status,
      account_nome: CONTAS_VALIDAS[account],
      passos,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err), passos });
  }
}
