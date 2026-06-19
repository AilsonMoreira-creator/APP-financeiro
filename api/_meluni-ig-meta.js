// ============================================================================
// MELUNI — cliente Meta Instagram da LARA (envio no Direct).
// ----------------------------------------------------------------------------
// O envio do Direct usa o TOKEN DA PÁGINA ligada a @meluni.loja (o mesmo que
// resolve nome no webhook), NÃO o System User direto — senão a Graph devolve
// (#100) "page not linked / not professional". Derivamos via /me/accounts a
// partir de META_IG_ACCESS_TOKEN, casando instagram_business_account.id ===
// MELUNI_IG_ID. Cache de 50min, com 1 refresh forçado se o token cair.
// Mantido separado do _meluni-whats-meta.js (WhatsApp) de propósito.
// Ailson 19/06/2026.
// ============================================================================
const GRAPH = 'https://graph.facebook.com/v21.0';
const MELUNI_IG_ID = '17841467501146555'; // @meluni.loja
const enc = encodeURIComponent;

let _pageTokenCache = { token: null, ts: 0 };
const TTL_MS = 50 * 60 * 1000;

async function tokenPaginaMeluni(force = false) {
  if (!force && _pageTokenCache.token && (Date.now() - _pageTokenCache.ts) < TTL_MS) {
    return _pageTokenCache.token;
  }
  const su = process.env.META_IG_ACCESS_TOKEN;
  if (!su) throw new Error('META_IG_ACCESS_TOKEN ausente');
  const r = await fetch(`${GRAPH}/me/accounts?fields=id,access_token,instagram_business_account{id}&access_token=${enc(su)}`);
  const j = await r.json().catch(() => null);
  const pages = j?.data || [];
  let pg = pages.find(p => p.instagram_business_account && String(p.instagram_business_account.id) === MELUNI_IG_ID && p.access_token);
  if (!pg) pg = pages.find(p => p.instagram_business_account && p.access_token); // fallback: 1ª página com IG+token
  if (pg && pg.access_token) {
    _pageTokenCache = { token: pg.access_token, ts: Date.now() };
    return pg.access_token;
  }
  throw new Error('token de pagina Meluni nao encontrado em /me/accounts');
}

function ehErroDeToken(err) {
  const c = err?.code;
  const m = String(err?.message || '').toLowerCase();
  return c === 190 || c === 102 || c === 463 || c === 467 || c === 10
    || /access token|expired|session|page is not linked/.test(m);
}

// texto livre no Direct (janela de 24h da última msg do cliente).
// recipient = IGSID (externo_id da conversa). Usa o token da página.
export async function enviarTextoIG(igsid, texto) {
  const url = `${GRAPH}/${MELUNI_IG_ID}/messages`;
  const payload = { recipient: { id: String(igsid) }, message: { text: texto } };

  const tentar = async (tk) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* nao json */ }
    return { ok: r.ok, status: r.status, json: j, raw: txt };
  };

  let tk = await tokenPaginaMeluni();
  let resp = await tentar(tk);

  // token velho/embaralhado -> refaz 1x com refresh forçado
  if (!resp.ok && ehErroDeToken(resp.json?.error)) {
    const tk2 = await tokenPaginaMeluni(true);
    if (tk2 && tk2 !== tk) { tk = tk2; resp = await tentar(tk); }
  }

  if (!resp.ok) {
    const e = resp.json?.error || {};
    throw new Error(`IG send ${resp.status}: ${e.message || resp.raw}`);
  }
  return {
    message_id: resp.json?.message_id || resp.json?.messages?.[0]?.id || null,
    recipient_id: resp.json?.recipient_id || null,
    raw: resp.json,
  };
}

export { tokenPaginaMeluni };
