// ============================================================================
// /api/meluni-email-mkt-preview — renderiza o HTML do e-mail.
//   POST { campanha, carrinho? } -> { ok, html }   (preview ao vivo no front)
//   GET  (?titulo=&corpo=&cupom=&criativo_url=...) -> text/html  (teste rápido)
// Usa o mesmo render do envio (api/_meluni-email-mkt-template.js).
// Ailson 20/06/2026.
// ============================================================================
import { renderEmailHtml, EMAIL_DEFAULTS } from './_meluni-email-mkt-template.js';

const CARRINHO_AMOSTRA = { nome: 'Maria', valor: 289.9, resumo: 'Vestido de Linho e mais 1 peça', itens: [{ qtd: 1 }, { qtd: 1 }] };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const q = req.query || {};
      const campanha = {
        assunto: q.assunto || 'Suas peças continuam aqui, {{nome}}',
        titulo: q.titulo || 'Vc esqueceu algo lindo, {{nome}}',
        corpo: q.corpo || 'Oi, {{nome}}! As peças que vc escolheu em linho continuam separadas aqui. Garanta 10% no cupom VOLTE10 antes que ele expire. É só voltar quando quiser.',
        criativo_url: q.criativo_url || '',
        cupom: q.cupom || 'VOLTE10',
        cupom_validade: q.cupom_validade || '24 horas',
        desconto: q.desconto || '10',
        cta_label: q.cta_label || EMAIL_DEFAULTS.cta_label,
        cta_url: q.cta_url || EMAIL_DEFAULTS.cta_url,
        utm: q.utm || EMAIL_DEFAULTS.utm,
        assinatura: q.assinatura || EMAIL_DEFAULTS.assinatura,
      };
      const html = renderEmailHtml({ campanha, carrinho: CARRINHO_AMOSTRA, unsubscribeUrl: '#' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(html);
    }

    if (req.method === 'POST') {
      const { campanha = {}, carrinho } = req.body || {};
      const html = renderEmailHtml({
        campanha,
        carrinho: carrinho || CARRINHO_AMOSTRA,
        unsubscribeUrl: '#',
      });
      return res.json({ ok: true, html });
    }

    return res.status(405).json({ ok: false, erro: 'use GET ou POST' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
