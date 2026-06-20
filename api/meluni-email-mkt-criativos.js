// ============================================================================
// /api/meluni-email-mkt-criativos — pasta de criativos reutilizáveis.
//   GET                         -> { ok, criativos:[{id,nome,url,path,criado_em}] }
//   POST { acao:'salvar', nome, url, path }   -> { ok, criativo }
//   POST { acao:'renomear', id, nome }        -> { ok }
//   POST { acao:'excluir', id }               -> { ok }   (só remove do banco;
//        o arquivo no storage fica, pra não quebrar e-mails já enviados)
// Ailson 20/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('meluni_email_criativos')
        .select('id,nome,url,path,criado_em').order('criado_em', { ascending: false }).limit(120);
      if (error) throw error;
      return res.json({ ok: true, criativos: data || [] });
    }

    if (req.method === 'POST') {
      const { acao, id, nome, url, path, criado_por } = req.body || {};

      if (acao === 'salvar') {
        if (!url) return res.status(400).json({ ok: false, erro: 'url obrigatória' });
        const row = { nome: (nome || 'Criativo').trim(), url, path: path || null, criado_por: criado_por || null };
        const { data, error } = await supabase.from('meluni_email_criativos').insert(row).select().maybeSingle();
        if (error) throw error;
        return res.json({ ok: true, criativo: data });
      }

      if (acao === 'renomear') {
        if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatório' });
        const { error } = await supabase.from('meluni_email_criativos')
          .update({ nome: (nome || 'Criativo').trim() }).eq('id', id);
        if (error) throw error;
        return res.json({ ok: true });
      }

      if (acao === 'excluir') {
        if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatório' });
        const { error } = await supabase.from('meluni_email_criativos').delete().eq('id', id);
        if (error) throw error;
        return res.json({ ok: true });
      }

      return res.status(400).json({ ok: false, erro: 'acao inválida' });
    }

    return res.status(405).json({ ok: false, erro: 'use GET ou POST' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
