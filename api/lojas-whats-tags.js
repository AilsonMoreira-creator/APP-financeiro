/**
 * lojas-whats-tags.js — Tags de conversa Sofia (Ailson 07/07/2026).
 *
 * lojas_whats_conversas tem RLS read-only pro anon, então os writes de tag
 * passam por aqui (service role). Leitura das defs o front faz direto
 * (lojas_whats_tags tem policy de select aberta).
 *
 *   GET                          → lista defs
 *   POST   {def}                 → cria def (id, nome, cor, congela_auto)
 *   DELETE {id}                  → exclui def não-fixa (e limpa dos cards)
 *   PATCH  {conversa_id, tags, reposicao_alerta_em?} → grava tags na conversa
 */
import { supabase, setCors } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('lojas_whats_tags')
        .select('*').order('ordem').order('criada_em');
      if (error) throw error;
      return res.status(200).json({ ok: true, tags: data || [] });
    }

    if (req.method === 'POST') {
      const { id, nome, cor, congela_auto } = req.body || {};
      if (!id || !nome || !cor) return res.status(400).json({ ok: false, erro: 'id, nome e cor obrigatórios' });
      const { error } = await supabase.from('lojas_whats_tags').insert({
        id: String(id).slice(0, 30), nome: String(nome).slice(0, 40), cor,
        congela_auto: !!congela_auto, requer_ref: false, fixa: false, ordem: 100,
      });
      if (error) return res.status(400).json({ ok: false, erro: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatório' });
      const { data: def } = await supabase.from('lojas_whats_tags').select('fixa').eq('id', id).single();
      if (!def) return res.status(404).json({ ok: false, erro: 'tag não existe' });
      if (def.fixa) return res.status(400).json({ ok: false, erro: 'tag fixa não pode ser excluída' });
      await supabase.from('lojas_whats_tags').delete().eq('id', id);
      // Limpa a tag dos cards que a usam (senão vira chip fantasma)
      const { data: usam } = await supabase.from('lojas_whats_conversas')
        .select('id, tags').contains('tags', JSON.stringify([{ id }])).limit(2000);
      for (const c of (usam || [])) {
        const novas = (c.tags || []).filter(t => t.id !== id);
        await supabase.from('lojas_whats_conversas').update({ tags: novas }).eq('id', c.id);
      }
      return res.status(200).json({ ok: true, limpas: (usam || []).length });
    }

    if (req.method === 'PATCH') {
      const { conversa_id, tags, reposicao_alerta_em } = req.body || {};
      if (!conversa_id || !Array.isArray(tags)) {
        return res.status(400).json({ ok: false, erro: 'conversa_id e tags (array) obrigatórios' });
      }
      const limpas = tags
        .filter(t => t && typeof t.id === 'string')
        .slice(0, 6)
        .map(t => (t.ref ? { id: t.id.slice(0, 30), ref: String(t.ref).slice(0, 12) } : { id: t.id.slice(0, 30) }));
      const upd = { tags: limpas, atualizado_em: new Date().toISOString() };
      if (reposicao_alerta_em === null) upd.reposicao_alerta_em = null;
      const { error } = await supabase.from('lojas_whats_conversas').update(upd).eq('id', conversa_id);
      if (error) return res.status(400).json({ ok: false, erro: error.message });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, erro: 'método não suportado' });
  } catch (e) {
    console.error('[lojas-whats-tags]', e?.message);
    return res.status(500).json({ ok: false, erro: e?.message });
  }
}
