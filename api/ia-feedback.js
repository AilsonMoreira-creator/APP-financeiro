/**
 * ia-feedback.js — Admin registra feedback sobre um insight (Sprint 3).
 *
 * POST /api/ia-feedback
 *   Header: X-User: <usuario admin>
 *   Body: { insight_id, resposta: 'sim'|'parcial'|'nao'|'editar', nota? }
 *
 * Admin-only. Valida FK com ia_insights. CHECK de resposta no banco.
 *
 * GET /api/ia-feedback?insight_id=<uuid>
 *   Retorna todos os feedbacks do insight (admin-only).
 */
import { supabase, validarAdmin, setCors } from './_ia-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const admin = await validarAdmin(req);
  if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

  // GET: listar feedbacks de um insight
  if (req.method === 'GET') {
    const { insight_id } = req.query || {};
    if (!insight_id) {
      return res.status(400).json({ error: 'insight_id obrigatório' });
    }

    try {
      const { data, error } = await supabase
        .from('ia_feedback')
        .select('*')
        .eq('insight_id', insight_id)
        .order('created_at', { ascending: false });

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, total: data?.length || 0, feedbacks: data || [] });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'erro interno' });
    }
  }

  // POST: gravar feedback
  if (req.method === 'POST') {
    const { insight_id, resposta, nota } = req.body || {};

    if (!insight_id) return res.status(400).json({ error: 'insight_id obrigatório' });
    if (!resposta) return res.status(400).json({ error: 'resposta obrigatória' });

    const respostasValidas = ['sim', 'parcial', 'nao', 'editar'];
    if (!respostasValidas.includes(resposta)) {
      return res.status(400).json({ error: `resposta deve ser: ${respostasValidas.join(', ')}` });
    }

    try {
      // Confirma FK (insight existe) antes de inserir pra devolver erro amigável
      const { data: insight, error: errCheck } = await supabase
        .from('ia_insights')
        .select('id')
        .eq('id', insight_id)
        .maybeSingle();

      if (errCheck) return res.status(500).json({ error: errCheck.message });
      if (!insight) return res.status(404).json({ error: 'insight_id não encontrado' });

      const payload = {
        insight_id,
        resposta,
        nota: nota ? String(nota).slice(0, 2000) : null,
        user_id: admin.user.usuario,
      };

      const { data, error } = await supabase
        .from('ia_feedback')
        .insert(payload)
        .select()
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });

      return res.json({ ok: true, feedback: data });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'erro interno' });
    }
  }

  return res.status(405).json({ error: 'GET ou POST only' });
}
