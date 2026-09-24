// ============================================================================
// /api/meluni-email-mkt-auto — liga/desliga o DISPARO AUTOMÁTICO de e-mail.
//   GET            -> { ok, ativo: {id,assunto,titulo,auto_disparo_em} | null }
//   POST { id, ativo:true|false }
//     ativo=true  -> marca ESSE template como o automático (exclusivo: zera os outros)
//     ativo=false -> desliga o automático desse template
// O cron meluni-email-mkt-auto-cron usa o template com auto_disparo=true.
// Ailson 24/06/2026.
// ============================================================================
import { travaAcao } from './_trava.js';   // 24/09 Fase 1 WhatsApp
import { supabase } from './_bling-helpers.js';

export default async function handler(req, res) {
  // 24/09 Fase 1 WhatsApp: envio exige token com o modulo (ou CRON_SECRET). Modo: saude_config.trava_whats (aviso|ativo)
  if (req.method !== 'OPTIONS' && !(await travaAcao(req, res, { modulo: 'meluni', chave: 'trava_whats', contexto: 'meluni-email-mkt-auto', trocarUsuario: false }))) return;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('meluni_email_campanhas')
        .select('id, assunto, titulo, auto_disparo_em')
        .eq('auto_disparo', true).limit(1).maybeSingle();
      if (error) throw error;
      return res.json({ ok: true, ativo: data || null });
    }

    if (req.method === 'POST') {
      const id = req.body?.id;
      const ativo = req.body?.ativo === true;
      if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatorio' });

      if (ativo) {
        // exclusivo: zera o atual antes de marcar o novo (respeita o índice único)
        const off = await supabase.from('meluni_email_campanhas')
          .update({ auto_disparo: false }).eq('auto_disparo', true);
        if (off.error) throw off.error;
        const on = await supabase.from('meluni_email_campanhas')
          .update({ auto_disparo: true, auto_disparo_em: new Date().toISOString() })
          .eq('id', id).select('id, assunto, titulo, auto_disparo_em').maybeSingle();
        if (on.error) throw on.error;
        return res.json({ ok: true, ativo: on.data || null });
      } else {
        const off = await supabase.from('meluni_email_campanhas')
          .update({ auto_disparo: false }).eq('id', id);
        if (off.error) throw off.error;
        return res.json({ ok: true, ativo: null });
      }
    }

    return res.status(405).json({ ok: false, erro: 'use GET ou POST' });
  } catch (e) {
    return res.status(500).json({ ok: false, erro: String(e?.message || e) });
  }
}
