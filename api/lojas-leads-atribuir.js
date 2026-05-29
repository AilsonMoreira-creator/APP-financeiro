/**
 * lojas-leads-atribuir.js — Admin atribui lead CPF a uma vendedora
 *
 * POST { lead_id, vendedora_id }
 *
 * Move um lead PF do status 'aguardando_atribuicao' pra 'novo' com
 * vendedora_atribuida_id setado. Daí em diante, SÓ essa vendedora vê
 * o lead na sua fila de cpf_atribuidos.
 *
 * Auth: admin only.
 *
 * Sessão Ailson 12/05/2026 — Onda 2.2 (Módulo Leads Carrinho).
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
  if (!auth.isAdmin) return res.status(403).json({ error: 'Apenas admin pode atribuir leads' });

  const { lead_id, vendedora_id } = req.body || {};
  if (!lead_id || !vendedora_id) {
    return res.status(400).json({ error: 'lead_id e vendedora_id obrigatórios' });
  }

  try {
    // Valida que a vendedora existe e está ativa
    const { data: vendedora, error: errV } = await supabase
      .from('lojas_vendedoras')
      .select('id, nome, ativa')
      .eq('id', vendedora_id)
      .maybeSingle();

    if (errV || !vendedora) {
      return res.status(404).json({ error: 'Vendedora não encontrada' });
    }
    if (!vendedora.ativa) {
      return res.status(400).json({ error: `Vendedora ${vendedora.nome} está inativa` });
    }

    // Valida que o lead existe e está aguardando atribuição
    const { data: lead, error: errL } = await supabase
      .from('lojas_leads_carrinho')
      .select('id, tipo_pessoa, status, nome_completo')
      .eq('id', lead_id)
      .maybeSingle();

    if (errL || !lead) {
      return res.status(404).json({ error: 'Lead não encontrado' });
    }
    if (lead.tipo_pessoa !== 'PF') {
      return res.status(400).json({ error: 'Atribuição só vale pra CPFs (PF)' });
    }
    if (lead.status !== 'aguardando_atribuicao') {
      return res.status(400).json({
        error: `Lead já está no status '${lead.status}', não pode reatribuir agora`,
      });
    }

    // Atribui o lead à vendedora escolhida pelo admin.
    const { error: errUpd } = await supabase
      .from('lojas_leads_carrinho')
      .update({
        vendedora_atribuida_id: vendedora_id,
        atribuido_em: new Date().toISOString(),
        atribuido_por_user_id: auth.userId,
        status: 'novo',
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', lead_id);

    if (errUpd) {
      console.error('[lojas-leads-atribuir] erro update:', errUpd);
      return res.status(500).json({ error: errUpd.message });
    }

    return res.json({
      ok: true,
      mensagem: `Lead ${lead.nome_completo} atribuído pra ${vendedora.nome}`,
      lead_id,
      vendedora_id,
      vendedora_nome: vendedora.nome,
    });
  } catch (e) {
    console.error('[lojas-leads-atribuir] exception:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}
