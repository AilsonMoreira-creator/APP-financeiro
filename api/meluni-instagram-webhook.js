// ============================================================================
// MELUNI — webhook do Instagram Direct (SAC, canal 'direct_insta').
// ----------------------------------------------------------------------------
// ESQUELETO config-driven: ainda NAO esta plugado na Meta. Quando o Ailson
// confirmar (amanha) os escopos + IG Business Account ID + Page ID + verify
// token, e so preencher meluni_config chave 'instagram' e apontar o webhook do
// app pra ca (ou desviar no webhook unico por payload.object === 'instagram').
//
// meluni_config['instagram'].valor (jsonb) esperado:
//   { verify_token, token, ig_id, page_id, ativo }
//
// GET  -> verificacao do webhook (hub.challenge)
// POST -> ingere DM: cria/acha conversa (origem='sac', canal='direct_insta',
//         externo_id=IGSID) e grava a mensagem de entrada. (Resposta da Lara
//         entra depois, quando a IA do modulo estiver pronta.)
// Ailson 13/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

async function getCfgInsta() {
  const { data } = await supabase.from('meluni_config').select('valor').eq('chave', 'instagram').maybeSingle();
  return data?.valor || {};
}

// envio de DM (usado quando a Lara for responder) — no-op seguro sem token
async function enviarInstagram(igsid, texto) {
  const cfg = await getCfgInsta();
  if (!cfg.token || !cfg.ig_id) return { ok: false, motivo: 'sem token/ig_id em meluni_config.instagram' };
  const r = await fetch(`${GRAPH}/${cfg.ig_id}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: igsid }, message: { text: texto } }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, resp: j };
}

async function acharOuCriarConversa(igsid, nome) {
  const { data: existente } = await supabase.from('meluni_conversas')
    .select('id').eq('canal', 'direct_insta').eq('externo_id', igsid).maybeSingle();
  if (existente?.id) return existente.id;
  const { data: nova } = await supabase.from('meluni_conversas').insert({
    origem: 'sac', canal: 'direct_insta', externo_id: igsid,
    nome_cliente: nome || null, etapa: 'conversando',
    ultima_msg_direcao: 'entrada', ultima_msg_em: new Date().toISOString(),
  }).select('id').single();
  return nova?.id || null;
}

export default async function handler(req, res) {
  const cfg = await getCfgInsta();

  // ── verificacao (GET) ──
  if (req.method === 'GET') {
    const q = req.query || {};
    const mode = q['hub.mode'], token = q['hub.verify_token'], challenge = q['hub.challenge'];
    if (mode === 'subscribe' && cfg.verify_token && token === cfg.verify_token) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ ok: false, erro: 'verify_token invalido ou config ausente' });
  }

  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use GET/POST' });

  try {
    const body = req.body || {};
    if (body.object !== 'instagram') return res.status(200).json({ ok: true, ignorado: 'nao e evento instagram' });

    let ingeridas = 0;
    for (const entry of body.entry || []) {
      for (const ev of entry.messaging || []) {
        const igsid = ev.sender?.id;
        const texto = ev.message?.text;
        if (!igsid || ev.message?.is_echo) continue; // ignora echo (mensagens enviadas por nos)
        const conversaId = await acharOuCriarConversa(igsid, null);
        if (!conversaId) continue;
        await supabase.from('meluni_mensagens').insert({
          conversa_id: conversaId, direcao: 'entrada',
          tipo_midia: texto ? 'text' : 'outro', texto: texto || null,
          autor: igsid, enviada_em: new Date().toISOString(),
        });
        await supabase.from('meluni_conversas').update({
          ultima_msg_direcao: 'entrada', ultima_msg_em: new Date().toISOString(),
          etapa: 'conversando',
        }).eq('id', conversaId);
        ingeridas++;
      }
    }
    return res.status(200).json({ ok: true, ingeridas });
  } catch (e) {
    console.error('[meluni-instagram-webhook] ERRO:', e?.message || e);
    return res.status(200).json({ ok: false, erro: e?.message || String(e) }); // 200 pra Meta nao reenfileirar infinito
  }
}

export { enviarInstagram };
