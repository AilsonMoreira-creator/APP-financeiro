// ============================================================================
// /api/meluni-email-mkt-campanha — salva / lê campanha de e-mail.
//   POST { id?, assunto, titulo, corpo, criativo_url, cta_label, cta_url,
//          cupom, cupom_validade, utm, assinatura, status? } -> { ok, id, campanha }
//   GET  ?id=...  -> { ok, campanha }
//   GET  (lista)  -> { ok, campanhas:[{id,assunto,titulo,status,criado_em}] }
// corpo -> coluna corpo_html (texto cru editável; o template formata no envio).
// Ailson 20/06/2026.
// ============================================================================
import { supabase } from './_bling-helpers.js';

const CAMPOS = ['nome', 'assunto', 'titulo', 'criativo_url', 'cta_label', 'cta_url', 'cupom', 'cupom_validade', 'desconto', 'utm', 'assinatura'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const id = req.query?.id;
      if (id) {
        const { data, error } = await supabase.from('meluni_email_campanhas').select('*').eq('id', id).maybeSingle();
        if (error) throw error;
        return res.json({ ok: true, campanha: data || null });
      }
      // Galeria "Templates salvos" mostra SO templates (Ailson 06/08/2026):
      // cada disparo cria uma linha status='disparo' (antes 'ativa') que
      // poluia a lista com 8 registros vazios.
      const { data, error } = await supabase.from('meluni_email_campanhas')
        .select('id,nome,assunto,titulo,status,criado_em')
        .in('status', ['rascunho', 'salvo'])
        .order('criado_em', { ascending: false }).limit(50);
      if (error) throw error;
      return res.json({ ok: true, campanhas: data || [] });
    }

    if (req.method === 'DELETE') {
      const id = req.query?.id;
      if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatorio' });
      const { error } = await supabase.from('meluni_email_campanhas').delete().eq('id', id);
      if (error) throw error;
      return res.json({ ok: true });
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const row = {};
      for (const k of CAMPOS) if (b[k] !== undefined) row[k] = b[k];
      if (b.corpo !== undefined) row.corpo_html = b.corpo;       // corpo cru -> corpo_html
      if (b.status !== undefined) row.status = b.status;
      if (b.criado_por !== undefined) row.criado_por = b.criado_por;

      if (b.id) {
        const { data, error } = await supabase.from('meluni_email_campanhas')
          .update(row).eq('id', b.id).select().maybeSingle();
        if (error) throw error;
        return res.json({ ok: true, id: b.id, campanha: data });
      }
      if (!row.status) row.status = 'rascunho';
      const { data, error } = await supabase.from('meluni_email_campanhas')
        .insert(row).select().maybeSingle();
      if (error) throw error;
      return res.json({ ok: true, id: data?.id, campanha: data });
    }

    return res.status(405).json({ ok: false, erro: 'use GET ou POST' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
