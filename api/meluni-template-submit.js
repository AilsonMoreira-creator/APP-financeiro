// ============================================================================
// /api/meluni-template-submit — submete o template newsletter_apresentacao
// direto na Meta via API (Ailson 03/08/2026). GET ?go=amicia2026
//
// Etapas (cada uma reportada no retorno pra diagnóstico):
//   1. WABA ID: env META_WA_WABA_ID ou descoberto via
//      GET /{phone_id}?fields=whatsapp_business_account
//   2. APP ID (pro upload da amostra do header): via GET /debug_token
//   3. Amostra do header: baixa uma foto do bucket sofia-midias e sobe na
//      Resumable Upload API -> header_handle
//   4. POST /{waba}/message_templates com HEADER IMAGE + BODY {{1}} + botão URL
//
// Requisito do token: whatsapp_business_management (o de envio não basta).
// Se faltar, o erro da etapa diz claramente. Idempotente: se o template já
// existe, a Meta retorna erro de nome duplicado (tratado como ok=ja_existe).
// ============================================================================

const G = 'https://graph.facebook.com/v21.0';
const TOKEN = process.env.META_WA_ACCESS_TOKEN;
const PHONE_ID = process.env.META_WA_PHONE_ID_LARA;

const BODY_TEXT = `Olá, {{1}}! 🤍

Queríamos compartilhar um pouco da essência da Meluni com você.

Acreditamos que a elegância está nas escolhas que permanecem atuais com o tempo. Por isso, desenvolvemos peças com modelagens atemporais, tecidos de qualidade e acabamentos pensados para acompanhar você em diferentes ocasiões.

Convidamos você a conhecer nosso universo e explorar as peças que traduzem esse cuidado em cada detalhe.

Esperamos que sua visita seja inspiradora. ✨`;

async function gj(url, opts = {}) {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.query?.go !== 'amicia2026') return res.status(403).json({ ok: false, erro: 'chave' });
  const etapas = {};
  try {
    // ── 1. WABA ID ──────────────────────────────────────────────────────────
    let waba = process.env.META_WA_WABA_ID || null;
    if (!waba) {
      const { j } = await gj(`${G}/${PHONE_ID}?fields=whatsapp_business_account&access_token=${TOKEN}`);
      waba = j?.whatsapp_business_account?.id || null;
      etapas.waba_lookup = j?.error ? j.error.message : (waba || 'nao veio');
    }
    etapas.waba = waba;
    if (!waba) return res.status(200).json({ ok: false, parou_em: 'waba', etapas });

    // ── 2. APP ID via debug_token ───────────────────────────────────────────
    let appId = process.env.META_APP_ID || null;
    if (!appId) {
      const { j } = await gj(`${G.replace('/v21.0', '')}/debug_token?input_token=${TOKEN}&access_token=${TOKEN}`);
      appId = j?.data?.app_id || null;
      etapas.debug_token = j?.error ? j.error.message : (appId || 'nao veio');
    }
    etapas.app_id = appId;

    // ── 3. amostra do header (upload resumable) ─────────────────────────────
    let headerHandle = null;
    if (appId) {
      try {
        // qualquer imagem pública nossa serve de amostra
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
        const { data: fotos } = await sb.from('meluni_produto_fotos').select('url_publica').eq('sem_foto', false).not('url_publica', 'is', null).limit(1);
        const fotoUrl = fotos?.[0]?.url_publica;
        etapas.foto_amostra = fotoUrl || 'nenhuma';
        if (fotoUrl) {
          const img = await fetch(fotoUrl);
          const buf = Buffer.from(await img.arrayBuffer());
          const ct = img.headers.get('content-type') || 'image/jpeg';
          const sess = await gj(`${G}/${appId}/uploads?file_length=${buf.length}&file_type=${encodeURIComponent(ct)}&access_token=${TOKEN}`, { method: 'POST' });
          etapas.upload_sessao = sess.j?.error ? sess.j.error.message : (sess.j?.id || 'nao veio');
          if (sess.j?.id) {
            const up = await fetch(`${G}/${sess.j.id}`, {
              method: 'POST',
              headers: { Authorization: `OAuth ${TOKEN}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
              body: buf,
            });
            const upj = await up.json().catch(() => ({}));
            headerHandle = upj?.h || null;
            etapas.upload_handle = upj?.error ? upj.error.message : (headerHandle ? 'ok' : JSON.stringify(upj).slice(0, 150));
          }
        }
      } catch (e) { etapas.upload_erro = String(e?.message || e); }
    }

    // ── 4. cria o template ──────────────────────────────────────────────────
    const components = [];
    if (headerHandle) components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [headerHandle] } });
    components.push({ type: 'BODY', text: BODY_TEXT, example: { body_text: [['Maria']] } });
    components.push({ type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Acessar o site', url: 'https://meluniloja.com.br' }] });

    const cria = await gj(`${G}/${waba}/message_templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name: 'newsletter_apresentacao', language: 'pt_BR', category: 'MARKETING', components }),
    });
    etapas.criacao = cria.j;
    const jaExiste = cria.j?.error && /already exists|duplicate/i.test(cria.j.error?.message || '') ;
    const ok = !!cria.j?.id || jaExiste;
    return res.status(200).json({
      ok, ja_existe: jaExiste || undefined,
      template_id: cria.j?.id || null, status_meta: cria.j?.status || null,
      com_header_imagem: !!headerHandle, etapas,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e), etapas });
  }
}
