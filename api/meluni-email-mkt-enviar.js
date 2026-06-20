// ============================================================================
// /api/meluni-email-mkt-enviar — envio MANUAL / teste de UM e-mail via Resend.
//   POST { email, campanha, carrinho? } -> { ok, id } | { ok:false, erro }
// Usa o mesmo render do preview (api/_meluni-email-mkt-template.js).
// O disparo em massa virá em endpoint próprio; este é o envio avulso.
// Ailson 20/06/2026.
// ============================================================================
import { renderEmailHtml, primeiroNome, aplicarTokens } from './_meluni-email-mkt-template.js';

const FROM = 'Meluni <marketing@news.meluniloja.com.br>';
const REPLY = 'contato@meluniloja.com.br';

const CARRINHO_AMOSTRA = { nome: 'Maria', valor: 289.9, resumo: 'Vestido de Linho e mais 1 peça', itens: [{ qtd: 1 }, { qtd: 1 }] };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'Use POST.' });

  try {
    const { email, campanha = {}, carrinho } = req.body || {};
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
      return res.status(400).json({ ok: false, erro: 'E-mail inválido.' });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(400).json({ ok: false, erro: 'Configure o RESEND_API_KEY na Vercel (Production) antes de enviar.' });
    }

    const dest = String(email).toLowerCase().trim();
    const cart = carrinho || CARRINHO_AMOSTRA;
    const nome = primeiroNome(cart?.nome);

    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const base = `${proto}://${host}`;
    const unsubscribeUrl = `${base}/api/meluni-email-mkt-descadastro?e=${encodeURIComponent(dest)}`;

    const html = renderEmailHtml({ campanha, carrinho: cart, unsubscribeUrl });
    const assunto = aplicarTokens(campanha.assunto, nome) || 'Suas peças continuam aqui';

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [dest],
        reply_to: REPLY,
        subject: assunto,
        html,
        headers: {
          'List-Unsubscribe': `<mailto:${REPLY}?subject=unsubscribe>, <${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({ ok: false, erro: j?.message || j?.error?.message || `Resend retornou ${r.status}.` });
    }
    return res.status(200).json({ ok: true, id: j?.id || null });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
