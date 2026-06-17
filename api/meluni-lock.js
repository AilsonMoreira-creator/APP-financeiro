// ============================================================================
// /api/meluni-lock — trava de presença (1 atendente por vez) pros chats e cards
// de devolução da Meluni. Espelha a trava da Sofia (editando_por/editando_em),
// mas via service-role (o front da Meluni é todo por API). Ailson 16/06/2026.
// POST { tipo: 'conversa'|'devolucao', id, acao: 'claim'|'release', userId }
//  - conversa  -> meluni_conversas  (match id, uuid)
//  - devolucao -> meluni_devolucoes (match convertr_id; fallback id se for uuid)
// claim atômico: pega se livre, já meu, ou obsoleto (>45s sem heartbeat).
// ============================================================================
import { supabase } from './_bling-helpers.js';

const STALE_MS = 45000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAP = {
  conversa: { table: 'meluni_conversas', col: 'id', fb: null },
  devolucao: { table: 'meluni_devolucoes', col: 'convertr_id', fb: 'id' },
};

async function claimOn(table, col, id, userId, staleIso, nowIso) {
  const { data } = await supabase.from(table)
    .update({ editando_por: userId, editando_em: nowIso })
    .eq(col, id)
    .or(`editando_por.is.null,editando_por.eq."${userId}",editando_em.lt.${staleIso}`)
    .select('editando_por');
  return data?.length || 0;
}
async function holderOn(table, col, id) {
  const { data } = await supabase.from(table).select('editando_por').eq(col, id).limit(1).maybeSingle();
  return data?.editando_por || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  const { tipo, id, acao, userId } = req.body || {};
  if (!tipo || !id || !acao || !userId) return res.status(400).json({ ok: false, erro: 'tipo, id, acao, userId obrigatorios' });
  const m = MAP[tipo];
  if (!m) return res.status(400).json({ ok: false, erro: 'tipo invalido' });

  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - STALE_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');

  try {
    if (acao === 'release') {
      await supabase.from(m.table).update({ editando_por: null, editando_em: null }).eq(m.col, id).eq('editando_por', userId);
      if (m.fb && UUID.test(id)) {
        try { await supabase.from(m.table).update({ editando_por: null, editando_em: null }).eq(m.fb, id).eq('editando_por', userId); } catch { /* */ }
      }
      return res.json({ ok: true });
    }

    let n = await claimOn(m.table, m.col, id, userId, staleIso, nowIso);
    if (n === 0 && m.fb && UUID.test(id)) {
      try { n = await claimOn(m.table, m.fb, id, userId, staleIso, nowIso); } catch { /* */ }
    }
    if (n > 0) return res.json({ ok: true, lockPor: userId, souDono: true });

    let h = await holderOn(m.table, m.col, id);
    if (!h && m.fb && UUID.test(id)) { try { h = await holderOn(m.table, m.fb, id); } catch { /* */ } }
    return res.json({ ok: true, lockPor: h, souDono: false });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
