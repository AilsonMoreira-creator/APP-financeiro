// saude-template-criar.js — cadastra o template `alerta_saude_app` na WABA da
// Sofia (Ailson 12/09/2026). Categoria UTILITY (alerta operacional, nao
// marketing). 4 variaveis: nivel, codigo, resumo, sugestao.
//   GET /api/saude-template-criar?user=ailson   -> cria
//   GET /api/saude-template-criar?user=ailson&status=1 -> consulta status

import { validarUsuario, setCors } from './_lojas-helpers.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const NOME = 'alerta_saude_app';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const auth = await validarUsuario(req);
  if (!auth.ok || !auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });
  const WABA = process.env.META_WA_WABA_ID;
  const headers = { Authorization: `Bearer ${process.env.META_WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
  if (!WABA) return res.status(500).json({ error: 'META_WA_WABA_ID ausente' });

  if (req.query?.status === '1') {
    const r = await fetch(`${GRAPH}/${WABA}/message_templates?name=${NOME}`, { headers });
    return res.status(200).json(await r.json());
  }
  const body = {
    name: NOME, language: 'pt_BR', category: 'UTILITY',
    components: [{
      type: 'BODY',
      text: 'Alerta de saúde do app Amícia\n\nNível: {{1}}\nCódigo: {{2}}\n\n{{3}}\n\nSugestão: {{4}}\n\nPara investigar, abra o Claude e informe o código.',
      example: { body_text: [['🔴 VERMELHO', '#INC-0914-1', 'banco em 92% das conexões · Storage 7× o normal', 'fechar a tela de fotos no PC e me chamar com o código']] },
    }],
  };
  const r = await fetch(`${GRAPH}/${WABA}/message_templates`, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return res.status(200).json({ http: r.status, resposta: j });
}
