// api/ordens-corte-buscar-ref.js — Autocomplete de referência
// GET /api/ordens-corte-buscar-ref?q=02277
//
// Busca em amicia_data user_id='ailson_cortes' → payload.produtos
// Filtra por ref começando com q (case-insensitive, ignorando zeros à esquerda)
// Usado pelo modal "+ Nova ordem"
//
// Retorna: { produtos: [{ref, descricao, marca, tecido}], total }

import { supabase, setCors } from './_ordens-corte-helpers.js';

const MAX_RESULTS = 10;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.status(200).json({ produtos: [], total: 0 });

    const { data, error } = await supabase
      .from('amicia_data')
      .select('payload')
      .eq('user_id', 'ailson_cortes')
      .maybeSingle();
    if (error) {
      console.error('buscar-ref erro:', error);
      return res.status(500).json({ error: error.message });
    }

    const produtos = data?.payload?.produtos || [];
    const qNorm = q.replace(/^0+/, '').toLowerCase();

    // Match: ref começa com q OU ref normalizada (sem zero) começa com qNorm
    const matches = produtos
      .filter(p => {
        if (!p?.ref) return false;
        const refStr = String(p.ref).trim();
        const refNorm = refStr.replace(/^0+/, '').toLowerCase();
        return refStr.toLowerCase().startsWith(q.toLowerCase()) || refNorm.startsWith(qNorm);
      })
      .slice(0, MAX_RESULTS)
      .map(p => ({
        ref: p.ref,
        descricao: p.descricao || '',
        marca: p.marca || '',
        tecido: p.tecido || null,
      }));

    return res.status(200).json({ produtos: matches, total: matches.length });
  } catch (e) {
    console.error('buscar-ref catch:', e);
    return res.status(500).json({ error: e?.message || 'erro interno' });
  }
}
