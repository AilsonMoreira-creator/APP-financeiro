// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-ia-disparar-manual
// ═══════════════════════════════════════════════════════════════════════════
// Tamara clica no botao "robo" no chat e pede pra Sofia gerar uma sugestao
// AGORA, sem esperar o ritmo automatico (ex: catalogo 6h, follow_up vencendo).
//
// Logica:
// - Verifica ultima msg do cliente:
//   - <24h (dentro da janela WhatsApp): chama IA normal → gera msg livre
//     como sugestao pendente (Tamara aprova como sempre)
//   - >=24h (fora da janela): retorna lista de templates aprovados pra
//     Tamara escolher manualmente (Meta exige template fora da janela)
//
// POST { conversa_id }
// Resposta:
//   { ok, modo: 'livre' }  ← sugestao criada, ja aparece na fila
//   { ok, modo: 'template', templates: [...] }  ← frontend mostra seletor
//
// Ailson 27/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, logErro } from './_lojas-whats-helpers.js';

const JANELA_24H_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { conversa_id } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id_obrigatorio' });

    // 1. Pega ultima msg do cliente pra detectar janela 24h
    const { data: ultimaBuyer } = await supabase
      .from('lojas_whats_mensagens')
      .select('enviada_em')
      .eq('conversa_id', conversa_id)
      .eq('direcao', 'entrada')
      .order('enviada_em', { ascending: false })
      .limit(1)
      .maybeSingle();

    const dentroJanela = ultimaBuyer &&
      (Date.now() - new Date(ultimaBuyer.enviada_em).getTime()) < JANELA_24H_MS;

    if (dentroJanela) {
      // DENTRO da janela: aciona IA pra gerar sugestao livre
      // (chama endpoint interno pra reusar toda logica de processarConversa)
      const host = req.headers?.host || process.env.VERCEL_URL;
      const proto = host?.includes('localhost') ? 'http' : 'https';
      const r = await fetch(`${proto}://${host}/api/lojas-whats-ia`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversa_id }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(502).json({
          error: 'ia_falhou',
          detalhe: data.error || `HTTP ${r.status}`,
        });
      }
      return res.status(200).json({
        ok: true, modo: 'livre', detalhe: data,
      });
    }

    // FORA da janela: lista templates aprovados pra Tamara escolher
    const { data: templates, error: errTpl } = await supabase
      .from('lojas_whats_templates')
      .select('id, name, language, body, header_type, header_text, footer, components')
      .eq('status', 'aprovado')
      .order('name', { ascending: true });
    if (errTpl) throw errTpl;

    return res.status(200).json({
      ok: true,
      modo: 'template',
      motivo: 'janela 24h expirada — Meta exige template HSM',
      ultima_msg_cliente_em: ultimaBuyer?.enviada_em || null,
      templates: templates || [],
    });
  } catch (e) {
    logErro('ia-disparar-manual', e);
    return res.status(500).json({ error: e.message });
  }
}
