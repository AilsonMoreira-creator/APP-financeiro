/**
 * lojas-curadoria-listar-excluidas.js
 *
 * Lista REFs que foram vetadas. Modal "Ver excluidas" usa pra mostrar
 * com botao "Reativar".
 *
 * Sprint Ailson 04/05/2026.
 *
 * GET /api/lojas-curadoria-listar-excluidas?tipo=...
 *
 * Auth: so admin.
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status || 403).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin' });

  const tipo = req.query.tipo || 'novidade_manual';
  if (!['best_seller', 'em_alta', 'novidade_manual'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo invalido' });
  }

  try {
    const { data: exclusoes, error } = await supabase
      .from('lojas_curadoria_exclusoes')
      .select('ref, motivo, excluida_em, excluida_por')
      .eq('tipo', tipo)
      .order('excluida_em', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });

    // Hidrata com descricao
    const refs = (exclusoes || []).map(e => e.ref);
    let prodMap = new Map();
    if (refs.length > 0) {
      const { data: produtos } = await supabase
        .from('lojas_produtos')
        .select('ref, descricao')
        .in('ref', refs);
      prodMap = new Map((produtos || []).map(p => [p.ref, p]));
    }

    const itens = (exclusoes || []).map(e => ({
      ref: e.ref,
      descricao: prodMap.get(e.ref)?.descricao || '(produto não encontrado)',
      motivo: e.motivo,
      excluida_em: e.excluida_em,
      excluida_por: e.excluida_por,
    }));

    return res.json({ tipo, itens, total: itens.length });
  } catch (e) {
    console.error('[lojas-curadoria-listar-excluidas] erro:', e?.message);
    return res.status(500).json({ error: e?.message || 'Erro' });
  }
}
