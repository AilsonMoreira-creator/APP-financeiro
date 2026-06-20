// ============================================================================
// /api/meluni-email-mkt-descadastro — opt-out (LGPD + List-Unsubscribe RFC 8058)
//   GET  ?e=email  -> grava + página de confirmação (clique no link do rodapé)
//   POST { e } ou ?e= -> grava + { ok }  (one-click do cliente de e-mail)
// Grava em meluni_email_descadastro (PK email). A view de elegíveis já exclui
// quem está aqui, então não recebe mais.
// Ailson 20/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

function pagina(msg, ok = true) {
  const cor = ok ? '#9b59b6' : '#c0392b';
  return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meluni</title></head>
<body style="margin:0;background:#f7f4f0;font-family:Georgia,'Times New Roman',serif;color:#2c3e50;">
  <div style="max-width:520px;margin:14vh auto 0;padding:28px 24px;text-align:center;">
    <div style="font-size:26px;letter-spacing:6px;color:#2c3e50;margin-bottom:18px;">MELUNI</div>
    <div style="background:#fff;border:1px solid #e8e2da;border-radius:14px;padding:26px 22px;">
      <p style="font-size:16px;line-height:1.6;margin:0;color:${cor};">${msg}</p>
    </div>
    <p style="font-size:12px;color:#9aa4ad;margin-top:16px;">Qualquer coisa, fala com a gente em contato@meluniloja.com.br</p>
  </div>
</body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const raw = (req.query?.e || req.body?.e || '').toString().toLowerCase().trim();
  const oneClick = req.method === 'POST';

  if (!raw || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw)) {
    if (oneClick) return res.status(400).json({ ok: false, erro: 'E-mail inválido.' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(pagina('Link inválido. Se quiser sair da lista, responda qualquer e-mail nosso.', false));
  }

  try {
    await supabase
      .from('meluni_email_descadastro')
      .upsert({ email: raw, origem: oneClick ? 'one-click' : 'link', criado_em: new Date().toISOString() }, { onConflict: 'email' });
  } catch (e) {
    if (oneClick) return res.status(500).json({ ok: false, erro: String(e?.message || e) });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(pagina('Recebemos seu pedido. Se continuar recebendo, responda este e-mail que resolvemos.'));
  }

  if (oneClick) return res.status(200).json({ ok: true });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(pagina('Pronto! Vc não vai mais receber nossos e-mails de carrinho. Sentiremos sua falta.'));
}
