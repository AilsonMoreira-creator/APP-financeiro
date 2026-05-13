/**
 * lojas-leads-listar.js — Lista leads de carrinho abandonado Convertr
 *
 * GET ?escopo=<escopo>
 *
 * Escopos:
 *   - cnpj_publico (default): leads PJ na fila pública (todas vendedoras veem)
 *      • status NOT IN ('convertido','perdido_30d','sem_carrinho_valido')
 *      • tipo_pessoa = 'PJ'
 *      • ja_e_cliente_lojas_id IS NULL (cliente existente vai pra rota
 *        diferente — recompra_abandonada nas sugestões da vendedora dona)
 *   - cpf_aguardando (admin only): leads PF aguardando atribuição manual
 *      • status = 'aguardando_atribuicao'
 *      • tipo_pessoa = 'PF'
 *   - cpf_atribuidos: leads PF já atribuídos a vendedoras
 *      • status NOT IN ('convertido','perdido_30d','sem_carrinho_valido')
 *      • vendedora_atribuida_id IS NOT NULL
 *      • Vendedora: filtra pelos atribuídos a ELA
 *      • Admin: vê todos
 *
 * Retorna sempre o badge geral (qtd PJ sem msg) pra header.
 *
 * Auth:
 *   - admin: pode todos escopos
 *   - vendedora: pode cnpj_publico e cpf_atribuidos (filtrado por id dela)
 *
 * Sessão Ailson 12/05/2026 — Onda 2 (Módulo Leads Carrinho).
 */
import { supabase, validarUsuario, setCors } from './_lojas-helpers.js';

const ESCOPOS_VALIDOS = ['cnpj_publico', 'cpf_aguardando', 'cpf_atribuidos', 'meus_carrinhos'];

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' });

  const auth = await validarUsuario(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const escopo = req.query?.escopo || 'cnpj_publico';
  if (!ESCOPOS_VALIDOS.includes(escopo)) {
    return res.status(400).json({ error: `Escopo inválido. Use: ${ESCOPOS_VALIDOS.join(', ')}` });
  }

  // Permissões de escopo
  if (escopo === 'cpf_aguardando' && !auth.isAdmin) {
    return res.status(403).json({ error: 'Apenas admin pode ver CPFs aguardando atribuição' });
  }

  try {
    // ─── Monta query base ─────────────────────────────────────────
    let q = supabase
      .from('lojas_leads_carrinho')
      .select(`
        id, convertr_customer_id, email,
        first_name, last_name, nome_completo,
        telefone_raw, telefone_norm, taxvat_raw, taxvat_norm,
        tipo_pessoa, razao_social, uf_inferida,
        access_count, ultimo_carrinho_em,
        ja_e_cliente_lojas_id,
        vendedora_dona_id, vendedora_atribuida_id, vendedora_atendendo_id,
        atribuido_em,
        status, lock_expira_em,
        ultima_msg_enviada_em, ultima_msg_vendedora_id,
        qtd_pecas_ultimo_carrinho, valor_ultimo_carrinho, valor_max_carrinho,
        qtd_carrinhos_com_valor,
        observacoes_ia,
        criado_em
      `);

    if (escopo === 'cnpj_publico') {
      // FILA PÚBLICA (regra Ailson 12/05/2026):
      // - PJ (qualquer valor > 0)
      // - PF com 12+ peças (atacado mínimo)
      // - SEM ja_e_cliente_lojas_id (clientes existentes vão pra recompra
      //   abandonada na carteira da vendedora dona)
      q = q
        .is('ja_e_cliente_lojas_id', null)
        .not('status', 'in', '("convertido","perdido_30d","sem_carrinho_valido","aguardando_atribuicao")')
        .gt('valor_ultimo_carrinho', 0)
        .or('tipo_pessoa.eq.PJ,and(tipo_pessoa.eq.PF,qtd_pecas_ultimo_carrinho.gte.12)');
    } else if (escopo === 'cpf_aguardando') {
      // CPFs com VALOR mas MENOS de 12 peças — aguardam admin atribuir caso a caso
      q = q
        .eq('tipo_pessoa', 'PF')
        .eq('status', 'aguardando_atribuicao')
        .gt('valor_ultimo_carrinho', 0)
        .lt('qtd_pecas_ultimo_carrinho', 12);
    } else if (escopo === 'cpf_atribuidos') {
      q = q
        .eq('tipo_pessoa', 'PF')
        .not('vendedora_atribuida_id', 'is', null)
        .not('status', 'in', '("convertido","perdido_30d","sem_carrinho_valido","aguardando_atribuicao")')
        .gt('valor_ultimo_carrinho', 0);
      // Vendedora: filtra os atribuídos a ELA
      if (!auth.isAdmin && auth.vendedoraId) {
        q = q.eq('vendedora_atribuida_id', auth.vendedoraId);
      }
    } else if (escopo === 'meus_carrinhos') {
      // Leads que JÁ recebi mensagem da vendedora — vão pra carteira dela
      // (filtro "🛒 Carrinhos" na MinhaCarteira). Ailson 12/05/2026.
      // Admin: vê todos com mensagem enviada (visão geral).
      // Vendedora: vê apenas os que ELA mandou mensagem.
      q = q
        .eq('status', 'mensagem_enviada')
        .not('ultima_msg_vendedora_id', 'is', null);
      if (!auth.isAdmin && auth.vendedoraId) {
        q = q.eq('ultima_msg_vendedora_id', auth.vendedoraId);
      }
    }

    q = q.order('ultima_msg_enviada_em', { ascending: false, nullsFirst: false });

    // Ordenação solicitada — Ailson 13/05/2026
    // ?ordenar=valor (default) | recentes
    const ordenar = req.query?.ordenar || 'valor';
    if (ordenar === 'recentes') {
      q = q.order('ultimo_carrinho_em', { ascending: false, nullsFirst: false });
    } else {
      // 'valor' (default) — maior valor primeiro
      q = q.order('valor_ultimo_carrinho', { ascending: false, nullsFirst: false });
    }

    const { data: leads, error } = await q;
    if (error) {
      console.error('[lojas-leads-listar] erro query leads:', error);
      return res.status(500).json({ error: error.message });
    }

    // ─── Buscar último evento (items_parsed) de cada lead ──────────
    const leadIds = (leads || []).map(l => l.id);
    let eventosByLead = new Map();

    if (leadIds.length > 0) {
      const { data: eventos, error: errEv } = await supabase
        .from('lojas_lead_carrinho_eventos')
        .select('lead_id, items_count, total, items_parsed, created_at_convertr')
        .in('lead_id', leadIds)
        .gt('total', 0)
        .order('created_at_convertr', { ascending: false });

      if (!errEv && eventos) {
        // Pega o mais recente por lead
        for (const e of eventos) {
          if (!eventosByLead.has(e.lead_id)) {
            eventosByLead.set(e.lead_id, e);
          }
        }
      }
    }

    // ─── Buscar nomes de vendedoras referenciadas ──────────────────
    const vendedoraIds = new Set();
    for (const l of leads || []) {
      if (l.vendedora_dona_id) vendedoraIds.add(l.vendedora_dona_id);
      if (l.vendedora_atribuida_id) vendedoraIds.add(l.vendedora_atribuida_id);
      if (l.vendedora_atendendo_id) vendedoraIds.add(l.vendedora_atendendo_id);
      if (l.ultima_msg_vendedora_id) vendedoraIds.add(l.ultima_msg_vendedora_id);
    }

    let vendedorasMap = new Map();
    if (vendedoraIds.size > 0) {
      const { data: vds } = await supabase
        .from('lojas_vendedoras')
        .select('id, nome, loja')
        .in('id', Array.from(vendedoraIds));
      if (vds) vds.forEach(v => vendedorasMap.set(v.id, v));
    }

    // ─── Enriquecer cada lead ──────────────────────────────────────
    const agora = Date.now();
    const leadsEnriquecidos = (leads || []).map(l => {
      const evt = eventosByLead.get(l.id);
      const lockAtivo = l.lock_expira_em && new Date(l.lock_expira_em).getTime() > agora;

      const vName = id => vendedorasMap.get(id)?.nome || null;
      const vLoja = id => vendedorasMap.get(id)?.loja || null;

      // Formatar telefone pra wa.me — só dígitos com 55 (Brasil)
      // Ex: "(35) 99193-4610" → "5535991934610"
      const formatarWa = (tel) => {
        if (!tel) return null;
        const norm = tel.replace(/\D/g, '');
        if (norm.length === 12 || norm.length === 13) {
          if (norm.substring(0, 2) === '55') return norm;
        }
        if (norm.length === 10 || norm.length === 11) {
          return '55' + norm;
        }
        return null;
      };

      return {
        ...l,
        // dados do carrinho (último evento com valor)
        ultimo_evento: evt ? {
          items_count: evt.items_count,
          total: evt.total,
          items_parsed: evt.items_parsed || [],
          created_at: evt.created_at_convertr,
        } : null,
        // Telefone formatado pra wa.me — pronto pra abrir conversa direto
        telefone_wa: formatarWa(l.telefone_norm || l.telefone_raw),
        // nomes amigáveis das vendedoras
        vendedora_dona_nome: vName(l.vendedora_dona_id),
        vendedora_dona_loja: vLoja(l.vendedora_dona_id),
        vendedora_atribuida_nome: vName(l.vendedora_atribuida_id),
        vendedora_atribuida_loja: vLoja(l.vendedora_atribuida_id),
        vendedora_atendendo_nome: vName(l.vendedora_atendendo_id),
        vendedora_atendendo_loja: vLoja(l.vendedora_atendendo_id),
        ultima_msg_vendedora_nome: vName(l.ultima_msg_vendedora_id),
        // estados derivados
        lock_ativo: lockAtivo,
        lock_e_minha: lockAtivo && l.vendedora_atendendo_id === auth.vendedoraId,
      };
    });

    // ─── Badge geral (sempre da fila pública) ──────────────────────
    const { data: badgeData } = await supabase
      .from('vw_lojas_leads_pj_pendentes')
      .select('*')
      .maybeSingle();

    // ─── Envios hoje da vendedora (limite diário 1 PJ + 2 PF) ──────
    let enviosHoje = { qtd_pj_hoje: 0, qtd_pf_hoje: 0 };
    if (auth.vendedoraId) {
      const { data: env } = await supabase
        .rpc('envios_hoje_da_vendedora', { p_vendedora_id: auth.vendedoraId })
        .maybeSingle();
      if (env) enviosHoje = env;
    }

    // Limites Ailson 12/05/2026: 1 PJ + 1 PF por dia
    const LIMITE_PJ_DIA = 1;
    const LIMITE_PF_DIA = 1;

    return res.json({
      ok: true,
      escopo,
      qtd: leadsEnriquecidos.length,
      leads: leadsEnriquecidos,
      badge: badgeData || {
        qtd_pj_com_carrinho_sem_msg: 0,
        qtd_pj_alto_valor: 0,
        soma_valor_pendente: 0,
      },
      // Pra vendedora saber quanto pode mandar ainda hoje
      envios_hoje: enviosHoje,
      limites_diarios: {
        pj: LIMITE_PJ_DIA,
        pf: LIMITE_PF_DIA,
        pj_restante: Math.max(0, LIMITE_PJ_DIA - (enviosHoje.qtd_pj_hoje || 0)),
        pf_restante: Math.max(0, LIMITE_PF_DIA - (enviosHoje.qtd_pf_hoje || 0)),
      },
    });
  } catch (e) {
    console.error('[lojas-leads-listar] exception:', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}
