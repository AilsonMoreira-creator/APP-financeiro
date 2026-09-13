// saude-template-criar.js — cadastra o template `alerta_saude_app` na WABA da
// Sofia (Ailson 12/09/2026). Categoria UTILITY (alerta operacional, nao
// marketing). 4 variaveis: nivel, codigo, resumo, sugestao.
//   GET /api/saude-template-criar?user=ailson   -> cria
//   GET /api/saude-template-criar?user=ailson&status=1 -> consulta status

import { validarUsuario, setCors } from './_lojas-helpers.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const NOME = 'alerta_saude_app_v2';   // v1 rejeitada: variavel {{3}} 'solta' numa linha sem texto

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  // aceita ?user=ailson (mesmo atalho do cron diario) pra rodar do navegador/curl
  if (req.query?.user === 'ailson') req.headers['x-user'] = 'ailson';
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
      text: 'Alerta de saúde do app Amícia.\nNível do alerta: {{1}}.\nCódigo do incidente: {{2}}.\nO que foi detectado: {{3}}.\nSugestão: {{4}}.\nPara investigar, abra o Claude e informe o código do incidente.',
      example: { body_text: [['VERMELHO', 'INC-0914-1', 'banco em 92% das conexoes e Storage 7 vezes acima do normal', 'fechar a tela de fotos no PC e chamar o Claude com o codigo']] },
    }],
  };
  const r = await fetch(`${GRAPH}/${WABA}/message_templates`, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return res.status(200).json({ http: r.status, resposta: j });
}
