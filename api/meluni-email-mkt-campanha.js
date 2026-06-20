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

const CAMPOS = ['assunto', 'titulo', 'criativo_url', 'cta_label', 'cta_url', 'cupom', 'cupom_validade', 'utm', 'assinatura'];

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
      const { data, error } = await supabase.from('meluni_email_campanhas')
        .select('id,assunto,titulo,status,criado_em')
        .order('criado_em', { ascending: false }).limit(50);
      if (error) throw error;
      return res.json({ ok: true, campanhas: data || [] });
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
