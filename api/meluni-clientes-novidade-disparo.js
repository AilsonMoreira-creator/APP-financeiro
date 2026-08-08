// Disparo MANUAL de NOVIDADE (aba Clientes da Lara) — manda um template aprovado
// com FOTO no topo + "Oi {nome}" + botão de link, pros clientes selecionados.
// Lê a spec de meluni_config (default 'lara_templates_novidade'); o template
// precisa estar APROVADO na Meta. Lógica em _meluni-novidade-core.js.
//
// POST { ids: [clienteId, ...], cfg?, versao?, dry?: true }
// GET  ?dry=1&versao=preview_verao&ids=id1,id2   → TESTE, não envia nada
//      (o GET só existe no modo seco — sem dry ele recusa)
import { dispararNovidadeParaIds, MAX_POR_CHAMADA } from './_meluni-novidade-core.js';

// Sem isso a Vercel cortava a função no tempo padrão e o front ficava
// pendurado esperando resposta (Ailson 07/08/2026: "ficou enviando até travar").
export const config = { maxDuration: 300 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: só modo seco, pra testar o caminho sem mandar mensagem ──
  if (req.method === 'GET') {
    if (req.query?.dry !== '1') return res.status(405).json({ ok: false, erro: 'GET só com ?dry=1' });
    const ids = String(req.query?.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.status(400).json({ ok: false, erro: 'passe ?ids=id1,id2' });
    const r = await dispararNovidadeParaIds(ids, {
      cfg: req.query?.cfg, versao: req.query?.versao, maxPorChamada: MAX_POR_CHAMADA, dry: true,
    });
    return res.status(r.ok ? 200 : 400).json(r);
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ ok: false, erro: 'sem ids' });

  const r = await dispararNovidadeParaIds(ids, {
    cfg: body?.cfg, versao: body?.versao, maxPorChamada: MAX_POR_CHAMADA, dry: body?.dry === true,
  });
  if (!r.ok) return res.status(400).json(r);
  return res.status(200).json(r);
}
