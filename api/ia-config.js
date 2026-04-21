/**
 * ia-config.js — Lê e atualiza thresholds do OS Amícia.
 *
 * GET /api/ia-config
 *   Lê TODOS os configs (sem validação admin — só leitura).
 *
 * GET /api/ia-config?chave=cobertura_alvo_dias
 *   Lê 1 config específico.
 *
 * PUT /api/ia-config
 *   Body: { chave, valor, descricao? }
 *   Admin-only.
 */
import { supabase, validarAdmin, setCors } from './_ia-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { chave } = req.query;
    try {
      if (chave) {
        const { data, error } = await supabase
          .from('ia_config')
          .select('*')
          .eq('chave', chave)
          .maybeSingle();
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'chave não encontrada' });
        return res.json({ ok: true, config: data });
      }
      const { data, error } = await supabase
        .from('ia_config')
        .select('*')
        .order('chave', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, configs: data || [] });
    } catch (e) {
      return res.status(500).json({ error: e.message || 'erro interno' });
    }
  }

  if (req.method === 'PUT') {
    const admin = await validarAdmin(req);
    if (!admin.ok) return res.status(admin.status).json({ error: admin.error });

    const { chave, valor, descricao } = req.body || {};
    if (!chave) return res.status(400).json({ error: 'chave obrigatória' });
    if (valor === undefined) return res.status(400).json({ error: 'valor obrigatório' });

    try {
      const upsertData = {
        chave,
        valor,
        updated_by: admin.user.usuario,
      };
      if (descricao !== undefined) upsertData.descricao = descricao;

      const { data, error } = await supabase
        .from('ia_config')
        .upsert(upsertData, { onConflict: 'chave' })
        .select()
        .maybeSingle();

      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, config: data });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'método não suportado' });
}
