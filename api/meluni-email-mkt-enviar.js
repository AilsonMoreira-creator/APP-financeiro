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

// modo de TESTE por GET (protegido por chave) — pra disparo de validação
const TEST_KEY = 'mlk_2f9c7a1e8b';
const SAMPLE_CAMP = {
  assunto: '{{nome}}, suas peças ainda estão no carrinho',
  titulo: 'Vc esqueceu algumas peças',
  corpo: 'Oi, {{nome}}! Vi que vc deixou umas peças no carrinho e elas continuam te esperando. Separei tudo pra facilitar, é só finalizar quando quiser.',
  cupom: 'VOLTE10', cupom_validade: '24 horas',
  cta_label: 'Voltar pro meu carrinho', cta_url: 'https://meluniloja.com.br',
  utm: 'utm_source=email&utm_medium=carrinho&utm_campaign=teste', assinatura: 'Equipe Meluni',
};

async function enviarResend({ to, subject, html, unsubscribeUrl }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [to], reply_to: REPLY, subject, html,
      headers: {
        'List-Unsubscribe': `<mailto:${REPLY}?subject=unsubscribe>, <${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.message || j?.error?.message || `Resend ${r.status}`);
  return j?.id || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── TESTE por GET: /api/meluni-email-mkt-enviar?k=KEY&email=... ──
  if (req.method === 'GET') {
    if ((req.query?.k || '') !== TEST_KEY) return res.status(403).json({ ok: false, erro: 'forbidden' });
    const dest = String(req.query?.email || '').toLowerCase().trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dest)) return res.status(400).json({ ok: false, erro: 'email invalido' });
    if (!process.env.RESEND_API_KEY) return res.status(400).json({ ok: false, erro: 'RESEND_API_KEY ausente na Vercel' });
    try {
      const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const unsubscribeUrl = `${proto}://${host}/api/meluni-email-mkt-descadastro?e=${encodeURIComponent(dest)}`;
      const nome = primeiroNome(CARRINHO_AMOSTRA.nome);
      const html = renderEmailHtml({ campanha: SAMPLE_CAMP, carrinho: CARRINHO_AMOSTRA, unsubscribeUrl });
      const subject = aplicarTokens(SAMPLE_CAMP.assunto, nome) || 'Suas peças continuam aqui';
      const id = await enviarResend({ to: dest, subject, html, unsubscribeUrl });
      return res.status(200).json({ ok: true, id, to: dest });
    } catch (e) {
      return res.status(502).json({ ok: false, erro: String(e?.message || e) });
    }
  }

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
