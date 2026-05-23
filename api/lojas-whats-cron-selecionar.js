// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-cron-selecionar.js — Seleciona carrinhos abandonados pra Sofia
// ═══════════════════════════════════════════════════════════════════════════
// Lê lojas_leads_carrinho, aplica filtros e cria fila de aprovação pra Tamara.
//
// FILTROS (configurável em lojas_whats_config):
//   - status = 'aguardando_atribuicao'      (Sofia só pega novos, não atropela)
//   - convertido_em IS NULL                  (ignora quem já comprou)
//   - ultimo_carrinho_em >= hoje - 15d       (recente)
//   - qtd_pecas_ultimo_carrinho > 6          (carrinho relevante)
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
    const cap = await getConfig('cap_diario', 30);
    const dias = await getConfig('filtro_carrinhos_dias', 15);
    const minPecasPJ = await getConfig('filtro_min_pecas_pj', 0);
    const minPecasPF = await getConfig('filtro_min_pecas_pf', 1);

    // 2. Conta sugestões já criadas hoje pra respeitar cap
    const hojeStr = new Date().toISOString().slice(0, 10);
    const { count: criadasHoje } = await supabase
      .from('lojas_whats_sugestoes')
      .select('*', { count: 'exact', head: true })
      .gte('criada_em', hojeStr);
    const restante = Math.max(0, cap - (criadasHoje || 0));

    if (restante === 0) {
      log('selecionar', `cap diario atingido (${criadasHoje}/${cap}) — pulando`);
      return res.status(200).json({
        ok: true,
        motivo: 'cap_atingido',
        criadas_hoje: criadasHoje,
        cap_diario: cap,
        selecionados: 0
      });
    }

    // 3. Busca candidatos com filtros + ordenação (PJ valor desc, depois PF data desc)
    //    Filtro de peças é POR TIPO_PESSOA, então fazemos em JS depois do SELECT.
    //    NÃO uso .eq().eq()... porque preciso de ordenação composta com tipo_pessoa.
    //    Pra simplicidade, busco com SELECT e ordeno em JS.
    const { data: leadsRaw, error: errLeads } = await supabase
      .from('lojas_leads_carrinho')
      .select(`
        id, first_name, nome_completo,
        telefone_norm, tipo_pessoa, taxvat_norm,
        qtd_pecas_ultimo_carrinho, valor_ultimo_carrinho,
        ultimo_carrinho_em,
        ja_e_cliente_lojas_id, vendedora_atribuida_id, vendedora_dona_id,
        status, convertido_em
      `)
      .eq('status', 'aguardando_atribuicao')
      .is('convertido_em', null)
      .gte('ultimo_carrinho_em', new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString())
      .order('ultimo_carrinho_em', { ascending: false })
      .limit(500); // pega um lote grande pra filtrar/ordenar em JS

    if (errLeads) throw errLeads;
    log('selecionar', `${leadsRaw?.length || 0} leads brutos do banco`);

    // 4. Filtros adicionais em JS:
    //    - Min peças POR TIPO_PESSOA (PJ qualquer / PF >=1, configurável)
    //    - Telefone válido (regex flexível: aceita com ou sem 55)
    //    - Não duplicar com conversa Sofia ativa
    const candidatos = [];
    for (const lead of leadsRaw || []) {
      // Filtro min peças por tipo
      const pecas = Number(lead.qtd_pecas_ultimo_carrinho || 0);
      if (lead.tipo_pessoa === 'PJ' && pecas < minPecasPJ) continue;
      if (lead.tipo_pessoa === 'PF' && pecas < minPecasPF) continue;
      if (!['PJ', 'PF'].includes(lead.tipo_pessoa)) continue;
      // Telefone válido
      const telE164 = normalizarTelefone(lead.telefone_norm);
      if (!telE164 || !telefoneValido(telE164)) continue;
      lead._telE164 = telE164;
      lead._primeiroNome = primeiroNome(lead.first_name || lead.nome_completo);
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

    // 5. Filtra os que JÁ têm conversa Sofia ativa (não duplicar)
    const telefones = candidatos.map(c => c._telE164);
    const { data: convAtivas } = await supabase
      .from('lojas_whats_conversas')
      .select('telefone, etapa')
      .in('telefone', telefones)
      .not('etapa', 'in', '(perdida,vendeu)');
    const telefonesComConvAtiva = new Set((convAtivas || []).map(c => c.telefone));
    const candidatosUnicos = candidatos.filter(c => !telefonesComConvAtiva.has(c._telE164));
    log('selecionar', `${candidatosUnicos.length} candidatos únicos (${candidatos.length - candidatosUnicos.length} já em fila)`);

    // 6. Ordena: PJ primeiro (por valor desc), depois PF (por data desc)
    candidatosUnicos.sort((a, b) => {
      const aPJ = a.tipo_pessoa === 'PJ' ? 1 : 0;
      const bPJ = b.tipo_pessoa === 'PJ' ? 1 : 0;
      if (aPJ !== bPJ) return bPJ - aPJ; // PJ primeiro
      if (aPJ === 1) {
        // Ambos PJ → ordena por valor desc
        return Number(b.valor_ultimo_carrinho || 0) - Number(a.valor_ultimo_carrinho || 0);
      }
      // Ambos PF → ordena por data desc (já vem da query, mas reforça)
      return new Date(b.ultimo_carrinho_em) - new Date(a.ultimo_carrinho_em);
    });

    // 7. Aplica cap
    const selecionados = candidatosUnicos.slice(0, restante);
    log('selecionar', `${selecionados.length} selecionados (restante hoje: ${restante})`);

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dry_run: true,
        cap_diario: cap,
        criadas_hoje: criadasHoje,
        restante_hoje: restante,
        leads_brutos: leadsRaw?.length || 0,
        candidatos_validos: candidatosUnicos.length,
        seriam_selecionados: selecionados.length,
        preview: selecionados.slice(0, 10).map(s => ({
          nome: s._primeiroNome,
          tel: s._telE164,
          tipo: s.tipo_pessoa,
          pecas: s.qtd_pecas_ultimo_carrinho,
          valor: Number(s.valor_ultimo_carrinho || 0),
          ultimo_carrinho: s.ultimo_carrinho_em
        }))
      });
    }

    // 8. Busca template HSM ativo (carrinho_abandonado_site_amicia)
    const { data: template } = await supabase
      .from('lojas_whats_templates')
      .select('*')
      .eq('name', 'carrinho_abandonado_site_amicia')
      .maybeSingle();
    if (!template) {
      return res.status(500).json({
        error: 'template_nao_encontrado',
        detalhes: 'carrinho_abandonado_site_amicia não está cadastrado em lojas_whats_templates'
      });
    }

    // 9. Pra cada selecionado: cria conversa + sugestão
    const resultados = { criadas: 0, falhas: [] };
    for (const lead of selecionados) {
      try {
        const conversaId = await criarConversaESugestao(lead, template);
        if (conversaId) resultados.criadas++;
      } catch (e) {
        logErro('selecionar/criar', e);
        resultados.falhas.push({ lead_id: lead.id, erro: e.message });
      }
    }

    return res.status(200).json({
      ok: true,
      cap_diario: cap,
      criadas_hoje_antes: criadasHoje,
      restante_hoje: restante,
      leads_brutos: leadsRaw?.length || 0,
      candidatos_validos: candidatosUnicos.length,
      selecionados: selecionados.length,
      criadas: resultados.criadas,
      falhas: resultados.falhas
    });
  } catch (e) {
    logErro('selecionar', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── HELPER: cria conversa + sugestão pra 1 lead ──────────────────────────

async function criarConversaESugestao(lead, template) {
  // Renderiza template (substitui {{1}} e {{2}})
  const vars = {
    '1': lead._primeiroNome,
    '2': String(lead.qtd_pecas_ultimo_carrinho || 0)
  };
  let textoProposto = template.body_text;
  for (const [k, v] of Object.entries(vars)) {
    textoProposto = textoProposto.replaceAll(`{{${k}}}`, v);
  }

  // Calcula prioridade (PJ valor alto = 90+, PF = 50-89)
  let prioridade = 50;
  if (lead.tipo_pessoa === 'PJ') {
    const valor = Number(lead.valor_ultimo_carrinho || 0);
    if (valor > 5000) prioridade = 99;
    else if (valor > 2000) prioridade = 90;
    else prioridade = 80;
  } else {
    const pecas = Number(lead.qtd_pecas_ultimo_carrinho || 0);
    prioridade = Math.min(89, 50 + Math.floor(pecas / 2));
  }

  // 1. Cria conversa em 'processando'
  const { data: conversa, error: errConv } = await supabase
    .from('lojas_whats_conversas')
    .insert({
      cliente_id: lead.ja_e_cliente_lojas_id,
      carrinho_id: lead.id,
      telefone: lead._telE164,
      nome_cliente: lead.nome_completo || lead.first_name,
      tipo_documento: lead.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF',
      etapa: 'processando',
      valor_carrinho: lead.valor_ultimo_carrinho,
      qtd_pecas: lead.qtd_pecas_ultimo_carrinho,
      prioridade,
      vendedora_atribuida_id: lead.vendedora_atribuida_id || lead.vendedora_dona_id,
      iniciada_em: new Date().toISOString(),
      ultima_atividade_em: new Date().toISOString()
    })
    .select('id')
    .single();
  if (errConv) throw errConv;

  // 2. Cria sugestão pendente
  const { error: errSug } = await supabase
    .from('lojas_whats_sugestoes')
    .insert({
      conversa_id: conversa.id,
      tipo: 'primeira_mensagem',
      template_name: template.name,
      template_vars: vars,
      texto_proposto: textoProposto,
      status: 'pendente',
      prioridade,
      motivo_proposta: 'cron_selecao_carrinho_abandonado',
      contexto_ia: {
        lead_id: lead.id,
        ja_e_cliente: !!lead.ja_e_cliente_lojas_id,
        ultimo_carrinho_em: lead.ultimo_carrinho_em
      }
    });
  if (errSug) {
    // Rollback: deleta conversa criada
    await supabase.from('lojas_whats_conversas').delete().eq('id', conversa.id);
    throw errSug;
  }

  // 3. Avança conversa pra 'aprovar' (Tamara vê na fila)
  await supabase
    .from('lojas_whats_conversas')
    .update({ etapa: 'aprovar', atualizado_em: new Date().toISOString() })
    .eq('id', conversa.id);

  return conversa.id;
}
