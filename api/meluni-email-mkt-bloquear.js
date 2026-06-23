// ============================================================================
// /api/meluni-email-mkt-bloquear — marca/desmarca carrinho(s) pra NÃO receber
// e-mail mkt (carimba email_mkt_bloqueado_em). Reversível (bloquear:false zera).
// Modos:
//   { carrinho_id, bloquear }            -> 1 carrinho
//   { carrinho_ids: [...], bloquear }    -> lista de carrinhos
//   { todos: true, de?, ate?, bloquear } -> todos os elegíveis (opcional por período)
// Ailson 19/06/2026 · bulk 23/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

async function carimbar(ids, valor) {
  let n = 0;
  for (const lote of chunk(ids, 200)) {
    const { error } = await supabase.from('meluni_carrinhos')
      .update({ email_mkt_bloqueado_em: valor })
      .in('id', lote);
    if (error) throw error;
    n += lote.length;
  }
  return n;
}

async function idsElegiveis(de, ate) {
  const ids = [];
  let off = 0;
  for (;;) {
    let q = supabase.from('vw_meluni_email_elegiveis').select('id').order('id', { ascending: true });
    if (de) q = q.gte('data_carrinho', de);
    if (ate) q = q.lt('data_carrinho', ate);
    const { data, error } = await q.range(off, off + 999);
    if (error) throw error;
    const lote = data || [];
    ids.push(...lote.map(r => r.id));
    if (lote.length < 1000) break;
    off += 1000;
  }
  return ids;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erro: 'use POST' });

  const { carrinho_id, carrinho_ids, todos, de, ate, bloquear } = req.body || {};
  const valor = bloquear === false ? null : new Date().toISOString();

  try {
    if (todos) {
      const ids = await idsElegiveis(de || null, ate || null);
      const n = ids.length ? await carimbar(ids, valor) : 0;
      return res.json({ ok: true, n, bloqueado: valor !== null });
    }
    if (Array.isArray(carrinho_ids) && carrinho_ids.length) {
      const n = await carimbar(carrinho_ids, valor);
      return res.json({ ok: true, n, bloqueado: valor !== null });
    }
    if (carrinho_id) {
      const { error } = await supabase.from('meluni_carrinhos')
        .update({ email_mkt_bloqueado_em: valor })
        .eq('id', carrinho_id);
      if (error) throw error;
      return res.json({ ok: true, carrinho_id, n: 1, bloqueado: valor !== null });
    }
    return res.status(400).json({ ok: false, erro: 'informe carrinho_id, carrinho_ids ou todos' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
