/**
 * lojas-leads-observacao.js — Vendedora salva texto livre sobre o lead
 *
 * GET ?lead_id=X — busca observação atual
 * POST { lead_id, texto } — salva/atualiza observação
 *
 * Texto fica em lojas_leads_carrinho.observacoes_ia.texto_livre.
 * Outros campos do JSONB ficam preservados (não sobrescreve tudo).
 *
 * Sessão Ailson 12/05/2026 — Onda 3 (Detalhe do lead).
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // ─── GET: ler observação atual ────────────────────────────────────
  if (req.method === 'GET') {
    const lead_id = req.query?.lead_id;
    if (!lead_id) return res.status(400).json({ error: 'lead_id obrigatório' });

    const { data, error } = await supabase
      .from('lojas_leads_carrinho')
      .select('observacoes_ia')
      .eq('id', lead_id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Lead não encontrado' });

    return res.json({
      ok: true,
      texto_livre: data.observacoes_ia?.texto_livre || '',
      atualizado_em: data.observacoes_ia?.texto_livre_atualizado_em || null,
      atualizado_por: data.observacoes_ia?.texto_livre_atualizado_por || null,
    });
  }

  // ─── POST: salvar texto livre ─────────────────────────────────────
  if (req.method === 'POST') {
    const { lead_id, texto } = req.body || {};
    if (!lead_id) return res.status(400).json({ error: 'lead_id obrigatório' });
    if (typeof texto !== 'string') return res.status(400).json({ error: 'texto obrigatório (string)' });

    // Lê obs atuais pra preservar campos
    const { data: atual } = await supabase
      .from('lojas_leads_carrinho')
      .select('observacoes_ia')
      .eq('id', lead_id)
      .maybeSingle();

    const obsAtuais = atual?.observacoes_ia || {};
    const novoTexto = texto.trim().slice(0, 2000); // limite 2k chars

    const novasObs = {
      ...obsAtuais,
      texto_livre: novoTexto || null,
      texto_livre_atualizado_em: new Date().toISOString(),
      texto_livre_atualizado_por: auth.userId,
    };

    const { error } = await supabase
      .from('lojas_leads_carrinho')
      .update({ observacoes_ia: novasObs, atualizado_em: new Date().toISOString() })
      .eq('id', lead_id);

    if (error) return res.status(500).json({ error: error.message });

    return res.json({ ok: true, texto_livre: novoTexto });
  }

  return res.status(405).json({ error: 'Use GET ou POST' });
}
