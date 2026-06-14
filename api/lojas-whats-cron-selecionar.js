// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-selecionar.js — Seleciona carrinhos abandonados pra Sofia
// ═══════════════════════════════════════════════════════════════════════════
// Lê lojas_leads_carrinho, aplica filtros e cria fila de aprovação pra Tamara.
//
// FILTROS (configurável em lojas_whats_config):
//   - status = 'aguardando_atribuicao'      (Sofia só pega novos, não atropela)
//   - convertido_em IS NULL                  (ignora quem já comprou)
//   - ultimo_carrinho_em >= hoje - 15d       (recente)
//   - qtd_pecas_ultimo_carrinho dentro dos filtros PF/PJ
//     (PF: 1-6 / PJ: 0-0 — config em lojas_whats_config)
//   - telefone valido (10-11 ou 12-13 digitos BR)
//   - SEM conversa Sofia ativa pra esse telefone (sem duplicar)
//
// PRIORIZAÇÃO:
//   1. PJ valor desc
//   2. PF data desc
//
// CAP DIARIO: lojas_whats_config.cap_diario (default 30)
//
// CADA CANDIDATO SELECIONADO:
//   1. Cria conversa em etapa='processando' (briefly)
//   2. Renderiza template {{1}}=nome, {{2}}=peças
//   3. Cria sugestao pendente (vai pra fila Tamara)
//   4. Conversa avança pra etapa='aprovar'
//
// COMO É CHAMADO:
//   - Cron Vercel (vercel.json schedule) — diariamente cedo
//   - Botão "Selecionar agora" no UI Tamara
//   - GET retorna estado da fila atual
//   - POST executa seleção
//
// Body POST opcional: { dry_run: true } — preview sem persistir
// ═══════════════════════════════════════════════════════════════════════════

import {
  supabase,
  setCors,
  log,
  logErro,
  normalizarTelefone,
  telefoneValido,
  primeiroNome,
  getConfig
} from './_lojas-whats-helpers.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    // GET com ?executar=1 ou cron header da Vercel = executa também
    if (req.query.executar === '1' || req.headers['user-agent']?.includes('vercel-cron')) {
      return await executarSelecao(req, res);
    }
    return await resumoFila(req, res);
  }
  if (req.method === 'POST') {
    return await executarSelecao(req, res);
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}

// ─── GET: resumo da fila atual ────────────────────────────────────────────

async function resumoFila(req, res) {
  try {
    // Quantos foram criados hoje (cap diário)
    const hojeStr = new Date().toISOString().slice(0, 10);

    const [{ count: sugHojeTotal }, { count: sugPendentes }, { count: sugAprovadas }, { count: sugEnviadas }, { count: convTotal }] = await Promise.all([
      supabase.from('lojas_whats_sugestoes').select('*', { count: 'exact', head: true }).gte('criada_em', hojeStr),
      supabase.from('lojas_whats_sugestoes').select('*', { count: 'exact', head: true }).eq('status', 'pendente'),
      supabase.from('lojas_whats_sugestoes').select('*', { count: 'exact', head: true }).eq('status', 'aprovada'),
      supabase.from('lojas_whats_sugestoes').select('*', { count: 'exact', head: true }).eq('status', 'enviada').gte('enviada_em', hojeStr),
      supabase.from('lojas_whats_conversas').select('*', { count: 'exact', head: true })
    ]);

    const cap = await getConfig('cap_diario', 30);
    return res.status(200).json({
      ok: true,
      data: {
        cap_diario: cap,
        criadas_hoje: sugHojeTotal || 0,
        restante_hoje: Math.max(0, cap - (sugHojeTotal || 0)),
        fila_pendentes: sugPendentes || 0,
        fila_aprovadas_aguardando_envio: sugAprovadas || 0,
        enviadas_hoje: sugEnviadas || 0,
        conversas_total: convTotal || 0
      }
    });
  } catch (e) {
    logErro('selecionar/resumo', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── POST: executar seleção ───────────────────────────────────────────────

async function executarSelecao(req, res) {
  try {
    // Parse body (Vercel parseia JSON por padrão)
    const body = req.body || {};
    const dryRun = body.dry_run === true;

    // 1. Lê configs
    // REFATOR (Ailson 26/05/2026 sessao tarde): cron-selecionar agora SO POPULA
    // a fila (etapa 'processando') sem cap diario e sem gerar IA. O processamento
    // virou responsabilidade do cron-processar (e endpoint manual pra assistente).
    const dias = await getConfig('filtro_carrinhos_dias', 15);
    const minPecasPJ = await getConfig('filtro_min_pecas_pj', 0);
    const minPecasPF = await getConfig('filtro_min_pecas_pf', 1);
    const maxPecasPJ = await getConfig('filtro_max_pecas_pj', 0);  // PJ qtd=0 (carrinho vazio)
    const maxPecasPF = await getConfig('filtro_max_pecas_pf', 6);  // PF 1-6 pec

    // 3. Busca candidatos com filtros + ordenação (CNPJ primeiro, depois data desc)
    //    Ailson 28/05/2026: Sofia passa a atender TODOS os carrinhos que iriam
    //    pro mod Lojas/Carrinhos (CNPJ Publico + CPF Aguardando), marcados como
    //    PRIORITARIOS ⭐. Os que ja iam pra Sofia (PJ vazio + PF zerado/1-6)
    //    continuam normais (sem estrela). Os de prioridade SUMEM do mod Lojas
    //    via filtro do listar.
    //
    //    Exclui leads que ja estao sendo trabalhados por vendedora:
    //    msg enviada, lock ativo, ou ja com dona.
    const nowIso = new Date().toISOString();
    const { data: leadsRaw, error: errLeads } = await supabase
      .from('lojas_leads_carrinho')
      .select(`
        id, first_name, nome_completo,
        telefone_norm, tipo_pessoa, taxvat_norm, taxvat_raw,
        qtd_pecas_ultimo_carrinho, valor_ultimo_carrinho,
        ultimo_carrinho_em, last_access, primeira_visita_em,
        ja_e_cliente_lojas_id, vendedora_atribuida_id, vendedora_dona_id,
        vendedora_atendendo_id, lock_expira_em, ultima_msg_enviada_em,
        status, convertido_em
      `)
      .not('status', 'in', '("convertido","perdido_30d","sem_carrinho_valido")')
      .is('convertido_em', null)
      .is('ultima_msg_enviada_em', null)        // vendedora ainda nao mandou msg
      .is('vendedora_atribuida_id', null)        // sem dona atribuida
      .or(`vendedora_atendendo_id.is.null,lock_expira_em.lt.${nowIso}`)  // sem lock ativo
      .limit(2000);

    if (errLeads) throw errLeads;
    log('selecionar', `${leadsRaw?.length || 0} leads brutos do banco`);

    // 4. Filtros adicionais em JS — 2 caminhos:
    //    CAMINHO A (normal, sem estrela): leads que ja iam pra Sofia hoje
    //      - PJ qtd in [minPJ..maxPJ] (default: vazio/zerado)
    //      - PF qtd in [minPF..maxPF] (default: 0-6, incluindo zerado/NULL)
    //
    //    CAMINHO B (PRIORITARIO ⭐): leads que iriam pro mod Lojas/Carrinhos
    //      - CNPJ Publico: ja_e_cliente_lojas_id null + status != aguardando_atribuicao
    //                      + valor > 0 + (PJ qualquer OU PF 12+)
    //      - CPF Aguardando: tipo='PF' + status=aguardando_atribuicao + valor>0 + qtd<12
    //
    //    Lead vai pra Sofia se passa em A OR B. Se passa em B (independente de A), e prioritario.
    //    Janela de dias aplicada igual pra ambos. Telefone valido obrigatorio.
    const limiteData = Date.now() - dias * 24 * 60 * 60 * 1000;
    const candidatos = [];
    for (const lead of leadsRaw || []) {
      const pecas = Number(lead.qtd_pecas_ultimo_carrinho || 0);
      const valor = Number(lead.valor_ultimo_carrinho || 0);
      const statusOk = lead.status !== 'aguardando_atribuicao'; // (cnpj publico exige)

      // ── CAMINHO B (prioritario): leads que iriam pro mod Lojas ──
      let passaB = false;
      if (valor > 0) {
        // CNPJ Publico: cliente novo, status promovido, PJ ou PF 12+
        if (!lead.ja_e_cliente_lojas_id && statusOk &&
            (lead.tipo_pessoa === 'PJ' || (lead.tipo_pessoa === 'PF' && pecas >= 12))) {
          passaB = true;
        }
        // CPF Aguardando: PF status aguardando_atribuicao com <12 pec
        if (lead.tipo_pessoa === 'PF' && lead.status === 'aguardando_atribuicao' && pecas < 12) {
          passaB = true;
        }
      }

      // ── CAMINHO A (normal): filtros qtd_pecas atuais ──
      let passaA = false;
      if (lead.status === 'aguardando_atribuicao') {
        if (lead.tipo_pessoa === 'PJ' && pecas >= minPecasPJ && pecas <= maxPecasPJ) passaA = true;
        else if (lead.tipo_pessoa === 'PF' && pecas >= minPecasPF && pecas <= maxPecasPF) passaA = true;
      }

      if (!passaA && !passaB) continue;
      if (lead.tipo_pessoa !== 'PJ' && lead.tipo_pessoa !== 'PF') continue;

      // Data de referencia + janela
      const dataRef = lead.ultimo_carrinho_em || lead.last_access || lead.primeira_visita_em;
      if (!dataRef) continue;
      const dataMs = new Date(dataRef).getTime();
      if (isNaN(dataMs) || dataMs < limiteData) continue;
      lead._dataRef = dataRef;
      // Telefone valido
      const telE164 = normalizarTelefone(lead.telefone_norm);
      if (!telE164 || !telefoneValido(telE164)) continue;
      lead._telE164 = telE164;
      lead._primeiroNome = primeiroNome(lead.first_name || lead.nome_completo);
      lead._prioritario = passaB;   // ⭐ se passa no caminho B (mod Lojas)
      candidatos.push(lead);
    }

    if (candidatos.length === 0) {
      return res.status(200).json({
        ok: true,
        motivo: 'sem_candidatos',
        leads_brutos: leadsRaw?.length || 0,
        selecionados: 0
      });
    }

    // 5. Filtra telefone que JÁ teve QUALQUER conversa Sofia (qualquer etapa).
    //    Ailson 14/06/2026: cada telefone/carrinho é contatado UMA vez só.
    //    Antes excluía só conversa ativa (etapa != perdida/vendeu), o que fazia
    //    leads 'perdida' (sem resposta em 3d) voltarem pra fila enquanto ainda
    //    estavam dentro da janela de 5d. Agora bloqueia se existe qualquer conversa.
    const telefones = candidatos.map(c => c._telE164);
    const { data: convExistentes } = await supabase
      .from('lojas_whats_conversas')
      .select('telefone')
      .in('telefone', telefones);
    const telefonesJaTrabalhados = new Set((convExistentes || []).map(c => c.telefone));
    const candidatosUnicos = candidatos.filter(c => !telefonesJaTrabalhados.has(c._telE164));
    log('selecionar', `${candidatosUnicos.length} candidatos únicos (${candidatos.length - candidatosUnicos.length} já tiveram conversa)`);

    // 6. Ordena: CNPJ primeiro, depois empate por data mais recente
    //    (Ailson sessao tarde 26/05/2026 — fila visivel pra assistente)
    candidatosUnicos.sort((a, b) => {
      const aPJ = a.tipo_pessoa === 'PJ' ? 1 : 0;
      const bPJ = b.tipo_pessoa === 'PJ' ? 1 : 0;
      if (aPJ !== bPJ) return bPJ - aPJ; // PJ primeiro
      // Empate por tipo: data mais recente primeiro
      return new Date(b._dataRef) - new Date(a._dataRef);
    });

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dry_run: true,
        leads_brutos: leadsRaw?.length || 0,
        candidatos_validos: candidatosUnicos.length,
        preview: candidatosUnicos.slice(0, 20).map(s => ({
          nome: s._primeiroNome,
          tel: s._telE164,
          tipo: s.tipo_pessoa,
          pecas: s.qtd_pecas_ultimo_carrinho || 0,
          valor: Number(s.valor_ultimo_carrinho || 0),
          data_ref: s._dataRef,
          tem_carrinho: !!s.ultimo_carrinho_em
        }))
      });
    }

    // 7. Cria 1 conversa por candidato em etapa 'processando' (sem cap, sem IA).
    //    A geracao de mensagem (template HSM + sugestao) eh feita depois por:
    //      - cron-processar (auto: pega cap_diario/dia)
    //      - endpoint /api/lojas-whats-processar (manual: assistente seleciona)
    const resultados = { criadas: 0, falhas: [] };
    for (const lead of candidatosUnicos) {
      try {
        const conversaId = await criarConversaNaFila(lead);
        if (conversaId) resultados.criadas++;
      } catch (e) {
        logErro('selecionar/criar', e);
        resultados.falhas.push({ lead_id: lead.id, erro: e.message });
      }
    }

    return res.status(200).json({
      ok: true,
      leads_brutos: leadsRaw?.length || 0,
      candidatos_validos: candidatosUnicos.length,
      criadas_em_processando: resultados.criadas,
      falhas: resultados.falhas
    });
  } catch (e) {
    logErro('selecionar', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── HELPER: cria conversa em 'processando' (fila) — sem IA, sem cap ──────
// Ailson 26/05/2026 sessao tarde — separou popular da fila de gerar msg.

async function criarConversaNaFila(lead) {
  // Prioritario (★) quando passa pelo CAMINHO B do filtro (mod Lojas).
  // Ailson 28/05/2026: substitui regra antiga (PJ > R$5k).
  const leadPrioritario = lead._prioritario === true;

  const agora = new Date().toISOString();
  const { data: conversa, error: errConv } = await supabase
    .from('lojas_whats_conversas')
    .insert({
      cliente_id: lead.ja_e_cliente_lojas_id,
      carrinho_id: lead.id,
      telefone: lead._telE164,
      nome_cliente: lead.nome_completo || lead.first_name,
      tipo_documento: lead.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF',
      documento: lead.taxvat_raw || null,  // Ailson 27/05/2026
      etapa: 'processando',
      valor_carrinho: lead.valor_ultimo_carrinho,
      qtd_pecas: lead.qtd_pecas_ultimo_carrinho,
      lead_prioritario: leadPrioritario,
      vendedora_atribuida_id: lead.vendedora_atribuida_id || lead.vendedora_dona_id,
      iniciada_em: agora,
      ultima_atividade_em: agora,
      origem_lead: 'carrinho_site_amicialoja',  // Sprint Attribution Ailson 25/05/2026
      origem_lead_confianca: 1.0,
    })
    .select('id')
    .single();
  if (errConv) throw errConv;
  return conversa.id;
}
