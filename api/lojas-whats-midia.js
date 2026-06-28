// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-midia.js — Listar / excluir / atualizar midias Sofia
// ═══════════════════════════════════════════════════════════════════════════
//
// GET  ?action=listar [&tipo=foto|video|catalogo] [&q=texto]
//   Lista midias ativas com url publica
// POST ?action=editar { id, ref?, descricao?, tags? }
//   Edita metadados
// DELETE ?id=xxx
//   Soft delete? NAO — Ailson quer LIBERAR ESPACO. Hard delete Storage + DB.
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // LISTAR
    if (req.method === 'GET') {
      const tipo = req.query?.tipo;
      const q = (req.query?.q || '').trim().toLowerCase();

      let qb = supabase
        .from('lojas_whats_midias')
        .select('id, tipo, ref, nome_arquivo, storage_path, size_bytes, mime_type, descricao, tags, categoria_inferida, enviada_count, ultima_enviada_em, criada_em')
        .eq('ativa', true)
        .order('criada_em', { ascending: false })
        .limit(500);
      if (tipo) qb = qb.eq('tipo', tipo);
      const { data, error } = await qb;
      if (error) return res.status(500).json({ error: error.message });

      let midias = data || [];
      if (q) {
        midias = midias.filter(m =>
          (m.nome_arquivo || '').toLowerCase().includes(q) ||
          (m.descricao || '').toLowerCase().includes(q) ||
          (m.ref || '').toLowerCase().includes(q)
        );
      }

      // Adiciona url publica em cada
      for (const m of midias) {
        const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(m.storage_path);
        m.url_publica = pub?.publicUrl;
      }

      // Stats
      const totalBytes = midias.reduce((s, m) => s + (m.size_bytes || 0), 0);
      const porTipo = { foto: 0, cores: 0, video: 0, catalogo: 0 };
      midias.forEach(m => { porTipo[m.tipo] = (porTipo[m.tipo] || 0) + 1; });

      return res.json({
        midias,
        stats: { total: midias.length, total_bytes: totalBytes, por_tipo: porTipo },
      });
    }

    // EDITAR
    if (req.method === 'POST') {
      const { id, ref, descricao, tags } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id obrigatorio' });
      const upd = { atualizada_em: new Date().toISOString() };
      if (ref !== undefined) {
        upd.ref = ref || null;
        // Re-infere categoria se ref mudou
        if (ref) {
          try {
            const { data: catData } = await supabase.rpc('lojas_whats_inferir_categoria', { p_ref: ref });
            upd.categoria_inferida = catData || null;
          } catch {}
        } else {
          upd.categoria_inferida = null;
        }
      }
      if (descricao !== undefined) upd.descricao = descricao || null;
      if (tags !== undefined) upd.tags = Array.isArray(tags) ? tags : [];
      const { data, error } = await supabase
        .from('lojas_whats_midias').update(upd).eq('id', id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, midia: data });
    }

    // EXCLUIR (hard delete — libera espaco no Supabase Storage)
    if (req.method === 'DELETE') {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ error: 'id obrigatorio' });

      const { data: midia, error: errSel } = await supabase
        .from('lojas_whats_midias').select('storage_path').eq('id', id).maybeSingle();
      if (errSel) return res.status(500).json({ error: errSel.message });
      if (!midia) return res.status(404).json({ error: 'midia nao encontrada' });

      // Remove do Storage
      const { error: errStg } = await supabase.storage
        .from('sofia-midias').remove([midia.storage_path]);
      if (errStg) {
        console.warn('[midia-delete] erro storage:', errStg.message);
        // Continua mesmo assim — banco eh fonte da verdade
      }

      // Remove do banco
      const { error: errDel } = await supabase
        .from('lojas_whats_midias').delete().eq('id', id);
      if (errDel) return res.status(500).json({ error: errDel.message });

      return res.json({ ok: true, storage_removed: !errStg });
    }

    return res.status(405).json({ error: 'Metodo nao suportado' });
  } catch (e) {
    console.error('[midia] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
