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

    // Ailson 28/05/2026: quando flag 'desvio_carrinhos_para_sofia' = true,
    // o admin atribuindo um CPF NAO vai pra vendedora — vai pra Sofia como
    // conversa prioritaria. A vendedora_atribuida_id e gravada na conversa
    // (dona declarada) e nao no lead.
    const { data: cfg } = await supabase
      .from('lojas_whats_config')
      .select('valor')
      .eq('chave', 'desvio_carrinhos_para_sofia')
      .maybeSingle();
    const desvioParaSofia = cfg?.valor === true;

    if (desvioParaSofia) {
      // Busca dados completos do lead pra criar a conversa Sofia
      const { data: leadFull } = await supabase
        .from('lojas_leads_carrinho')
        .select('id, first_name, nome_completo, telefone_norm, tipo_pessoa, taxvat_raw, qtd_pecas_ultimo_carrinho, valor_ultimo_carrinho, ja_e_cliente_lojas_id')
        .eq('id', lead_id)
        .maybeSingle();
      if (!leadFull?.telefone_norm) {
        return res.status(400).json({ error: 'Lead sem telefone valido pra Sofia' });
      }
      // Normaliza pra E.164 (mesma regra do cron-selecionar)
      let tel = String(leadFull.telefone_norm).replace(/\D/g, '');
      if (tel.length === 10 || tel.length === 11) tel = '55' + tel;
      if (tel.length < 12 || tel.length > 13) {
        return res.status(400).json({ error: `Telefone ${leadFull.telefone_norm} invalido pra Sofia` });
      }
      // Checa se ja tem conversa Sofia ativa pra esse telefone
      const { data: convExistente } = await supabase
        .from('lojas_whats_conversas')
        .select('id, etapa')
        .eq('telefone', tel)
        .not('etapa', 'in', '(perdida,vendeu)')
        .maybeSingle();
      if (convExistente) {
        // Ja tem conversa Sofia — so atualiza pra prioritaria + vendedora atribuida
        await supabase.from('lojas_whats_conversas')
          .update({
            lead_prioritario: true,
            vendedora_atribuida_id: vendedora_id,
            atualizado_em: new Date().toISOString(),
          })
          .eq('id', convExistente.id);
        // Atualiza o lead pra sumir do listar Lojas
        await supabase.from('lojas_leads_carrinho')
          .update({ status: 'novo', atualizado_em: new Date().toISOString() })
          .eq('id', lead_id);
        return res.json({
          ok: true,
          desvio_sofia: true,
          conversa_existente: true,
          conversa_id: convExistente.id,
          mensagem: `Lead ${leadFull.nome_completo} ja tinha conversa Sofia — marcada prioritaria, vendedora dona: ${vendedora.nome}`,
        });
      }
      // Cria conversa Sofia nova com prioritario + vendedora dona
      const agora = new Date().toISOString();
      const { data: novaConv, error: errConv } = await supabase
        .from('lojas_whats_conversas')
        .insert({
          cliente_id: leadFull.ja_e_cliente_lojas_id,
          carrinho_id: leadFull.id,
          telefone: tel,
          nome_cliente: leadFull.nome_completo || leadFull.first_name,
          tipo_documento: leadFull.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF',
          documento: leadFull.taxvat_raw || null,
          etapa: 'processando',
          valor_carrinho: leadFull.valor_ultimo_carrinho,
          qtd_pecas: leadFull.qtd_pecas_ultimo_carrinho,
          lead_prioritario: true,                  // ⭐ prioritario (estrela)
          vendedora_atribuida_id: vendedora_id,    // dona escolhida pelo admin
          iniciada_em: agora,
          ultima_atividade_em: agora,
          origem_lead: 'carrinho_site_amicialoja',
          origem_lead_confianca: 1.0,
        })
        .select('id')
        .single();
      if (errConv) {
        console.error('[lojas-leads-atribuir] erro criar conv Sofia:', errConv);
        return res.status(500).json({ error: errConv.message });
      }
      // Atualiza o lead: status='novo' (sai do aguardando_atribuicao). Sem
      // vendedora_atribuida_id no lead — a dona ta na conversa Sofia agora.
      // Lead some do listar Lojas automaticamente (filtro de conv Sofia ativa).
      await supabase.from('lojas_leads_carrinho')
        .update({
          status: 'novo',
          atualizado_em: new Date().toISOString(),
          atribuido_por_user_id: auth.userId,
          atribuido_em: agora,
        })
        .eq('id', lead_id);
      return res.json({
        ok: true,
        desvio_sofia: true,
        conversa_existente: false,
        conversa_id: novaConv.id,
        mensagem: `Lead ${leadFull.nome_completo} desviado pra Sofia como prioritario (dona: ${vendedora.nome})`,
      });
    }

    // Fluxo normal (flag OFF): atribui pra vendedora como sempre
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
      desvio_sofia: false,
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
