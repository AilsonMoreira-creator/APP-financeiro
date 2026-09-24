// saude-template-criar.js — cadastra o template `alerta_saude_app` na WABA da
// Sofia (Ailson 12/09/2026). Categoria UTILITY (alerta operacional, nao
// marketing). 4 variaveis: nivel, codigo, resumo, sugestao.
//   GET /api/saude-template-criar?user=ailson   -> cria
//   GET /api/saude-template-criar?user=ailson&status=1 -> consulta status

import { validarUsuario, setCors } from './_lojas-helpers.js';
import { exigirAdmin } from './_admin.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const NOME = 'alerta_saude_app_v3';   // v1/v2 rejeitadas pela Meta — v3 minimo: so o aviso, detalhes na pagina Saude

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  // aceita ?user=ailson (mesmo atalho do cron diario) pra rodar do navegador/curl
  if (req.query?.user === 'ailson') req.headers['x-user'] = 'ailson';
  // 23/09 Fase 0: cria template na Meta -> admin pelo token
  if (!(await exigirAdmin(req, res, 'saude-template-criar'))) return;
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
      text: 'Amícia: o sistema registrou um alerta de nível {{1}} (ocorrência {{2}}). Abra o app em Configurações, seção Saúde, para ver o relatório.',
      example: { body_text: [['vermelho', 'INC-0914-1']] },
    }],
  };
  const r = await fetch(`${GRAPH}/${WABA}/message_templates`, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return res.status(200).json({ http: r.status, resposta: j });
}
