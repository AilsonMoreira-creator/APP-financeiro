// Página de Exclusão de Dados do Usuário (Meta exige URL distinta da política).
// GET  -> HTML com instruções de exclusão (serve como "URL de instruções").
// POST -> trata o signed_request da Meta e devolve {url, confirmation_code}
//         (serve como "Data Deletion Callback URL", caso troque o seletor depois).
const BASE = 'https://app-financeiro-brown.vercel.app';
const EMAIL = 'contato@meluniloja.com.br';

function b64urlToJson(s) {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    // signed_request vem em form-urlencoded (campo signed_request)
    let signed = (req.body && req.body.signed_request) || '';
    if (!signed && typeof req.body === 'string') {
      const m = req.body.match(/signed_request=([^&]+)/);
      if (m) signed = decodeURIComponent(m[1]);
    }
    let userId = null;
    if (signed && signed.includes('.')) {
      const payload = b64urlToJson(signed.split('.')[1] || '');
      userId = payload && payload.user_id ? payload.user_id : null;
    }
    const code = 'del_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    // url = página de acompanhamento do status da solicitação
    res.status(200).json({ url: `${BASE}/api/meluni-exclusao-dados?code=${code}`, confirmation_code: code });
    return;
  }

  // GET -> instruções (HTML)
  const code = (req.query && req.query.code) || '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Exclusão de Dados — Meluni</title>
<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;margin:40px auto;padding:0 20px;color:#222;line-height:1.6}h1{font-size:24px}code{background:#f2f2f2;padding:2px 6px;border-radius:4px}a{color:#2c3e50}</style>
</head><body>
<h1>Exclusão de Dados do Usuário — Meluni</h1>
<p>A <strong>Meluni</strong> (CNPJ 30.281.427/0001-76) respeita o seu direito de solicitar a exclusão dos seus dados pessoais, conforme a LGPD (Lei nº 13.709/2018).</p>
<p>Isso inclui dados tratados quando você fala com a gente pelo <strong>Instagram Direct</strong> ou <strong>WhatsApp</strong> (nome/usuário, histórico da conversa e mídias enviadas).</p>
<h2>Como pedir a exclusão</h2>
<ol>
<li>Envie um e-mail para <a href="mailto:${EMAIL}?subject=Exclus%C3%A3o%20de%20dados">${EMAIL}</a> com o assunto <strong>"Exclusão de dados"</strong>.</li>
<li>Informe o <strong>@ do seu Instagram</strong> ou o <strong>telefone do WhatsApp</strong> usado no contato, para localizarmos seus dados.</li>
</ol>
<p>Concluímos a exclusão em até <strong>15 dias</strong>, salvo dados que a lei exige manter. Você recebe a confirmação no mesmo e-mail.</p>
${code ? `<p>Código da sua solicitação: <code>${code}</code></p>` : ''}
<p>Detalhes em nossa <a href="https://meluniloja.com.br/pagina/privacidade">Política de Privacidade</a>.</p>
</body></html>`);
}
