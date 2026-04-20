// api/ordens-corte-get.js — Busca 1 ordem completa por id
// GET /api/ordens-corte-get?id=<uuid>
//
// Usado pelo modal matrix da Análise/Lista do Salas de Corte
// quando funcionário clica no ícone de uma linha vinculada.
//
// Retorna: { ordem: {...} } ou 404 se não existir

import { supabase, setCors } from './_ordens-corte-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id obrigatório' });

    const { data, error } = await supabase
      .from('ordens_corte')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('get erro:', error);
      return res.status(500).json({ error: error.message });
    }
    if (!data) return res.status(404).json({ error: 'ordem não encontrada' });

    return res.status(200).json({ ordem: data });
  } catch (e) {
    console.error('get catch:', e);
    return res.status(500).json({ error: e?.message || 'erro interno' });
  }
}
