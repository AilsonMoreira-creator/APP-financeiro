// ============================================================================
// MELUNI — cliente Meta WhatsApp da LARA (envio).
// ----------------------------------------------------------------------------
// Mesma WABA/token da Sofia, mas envia pelo phone id da Lara
// (META_WA_PHONE_ID_LARA). Mantido separado do _lojas-whats-meta-client.js de
// propósito: não mexer no client da Sofia (B2B, receita viva). Reaproveita o
// retry transitório no mesmo espírito. Ailson 16/06/2026.
// ============================================================================
const GRAPH = 'https://graph.facebook.com/v21.0';

function phoneIdLara() {
  return process.env.META_WA_PHONE_ID_LARA;
}

async function laraFetch(path, body) {
  const MAX = 3;
  let ultimoErr = null;
  for (let tent = 1; tent <= MAX; tent++) {
    const r = await fetch(`${GRAPH}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch { /* nao json */ }
    if (r.ok) return json;
    const e = json?.error || {};
    const transitorio = e.is_transient === true || e.code === 1 || e.code === 2 || r.status >= 500;
    ultimoErr = new Error(`Meta API ${r.status}: ${e.message || txt}`);
    if (!transitorio || tent === MAX) throw ultimoErr;
    await new Promise(res => setTimeout(res, tent * 1000));
  }
  throw ultimoErr;
}

// texto livre (só dentro da janela 24h; 1ª msg fora da janela exige template)
export async function enviarTextoLara(telefone, texto, opts = {}) {
  const id = phoneIdLara();
  if (!id) throw new Error('META_WA_PHONE_ID_LARA nao configurado');
  return await laraFetch(`/${id}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefone,
    type: 'text',
    text: { preview_url: opts.preview_url !== false, body: texto },
  });
}

// template aprovado (abre conversa fora da janela 24h).
// bodyParams = ordem das variáveis do BODY: leve -> [nome, resumo]; elegante -> [nome].
// botão é URL estática (não dinâmica) -> não precisa de component de button.
export async function enviarTemplateLara(telefone, name, bodyParams = [], opts = {}) {
  const id = phoneIdLara();
  if (!id) throw new Error('META_WA_PHONE_ID_LARA nao configurado');
  const components = [];
  if (bodyParams.length) {
    components.push({ type: 'body', parameters: bodyParams.map(t => ({ type: 'text', text: String(t) })) });
  }
  return await laraFetch(`/${id}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: telefone,
    type: 'template',
    template: {
      name,
      language: { code: opts.language || 'pt_BR' },
      ...(components.length ? { components } : {}),
    },
  });
}

export async function marcarLidaLara(messageId) {
  const id = phoneIdLara();
  if (!id) return null;
  try {
    return await laraFetch(`/${id}/messages`, {
      messaging_product: 'whatsapp', status: 'read', message_id: messageId,
    });
  } catch {
    return null; // falha silenciosa, nao bloqueia
  }
}
