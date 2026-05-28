// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-processar.js — Processa conversas em fila 'processando'
// ═══════════════════════════════════════════════════════════════════════════
//
// Pega conversas em etapa='processando', gera sugestao HSM via template
// (carrinho_abandonado_site_amicia), e avanca pra etapa='aprovar'.
//
// 2 modos:
//
//   MODO CRON (GET sem body ou ?modo=auto):
//     Pega ate cap_diario (config) ORDER BY:
//       - lead_prioritario DESC (★ topo)
//       - tipo_documento CNPJ primeiro
//       - iniciada_em DESC (data mais recente primeiro)
//     Header user-agent precisa ser vercel-cron OU ?force=1.
//
//   MODO MANUAL (POST { conversa_ids: [...] }):
//     Assistente seleciona varios via UI (checkbox) e processa imediatamente.
//     SEM aplicar cap_diario (assistente decide).
//
// Ailson 26/05/2026 sessao tarde — separou popular da fila de gerar msg.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro, getConfig, primeiroNome } from './_lojas-whats-helpers.js';

async function processarConversaUnica(conv, template) {
  // Monta vars SOMENTE com as chaves que o template DECLARA (evita enviar
  // parâmetro a mais → Meta rejeita). visita_site declara {{1}}; carrinho_v2
  // declara {{1}}+{{2}}. Ailson 28/05/2026 (mesma causa do caso Poliana).
  const nome = primeiroNome(conv.nome_cliente);
  const valorPorChave = {
    '1': nome || 'cliente',
    '2': String(conv.qtd_pecas || 0),
  };
  const declaradas = Array.isArray(template.variables) ? template.variables : [];
  const vars = {};
  for (const d of declaradas) {
    const k = String(d?.nome ?? '');
    if (k && valorPorChave[k] !== undefined) vars[k] = valorPorChave[k];
  }
  let textoProposto = template.body_text;
  for (const [k, v] of Object.entries(vars)) {
    textoProposto = textoProposto.replaceAll(`{{${k}}}`, v);
  }

  // Cria sugestao pendente
  const { error: errSug } = await supabase
    .from('lojas_whats_sugestoes')
    .insert({
      conversa_id: conv.id,
      tipo: 'primeira_mensagem',
      template_name: template.name,
      template_vars: vars,
      texto_proposto: textoProposto,
      status: 'pendente',
      motivo_proposta: 'processada_da_fila',
      contexto_ia: {
        carrinho_id: conv.carrinho_id,
        processada_em: new Date().toISOString(),
      },
    });
  if (errSug) throw errSug;

  // Avanca conversa pra 'aprovar'
  const { error: errUpd } = await supabase
    .from('lojas_whats_conversas')
    .update({ etapa: 'aprovar', atualizado_em: new Date().toISOString() })
    .eq('id', conv.id);
  if (errUpd) throw errUpd;

  return true;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const body = req.body || {};
  const conversaIdsManual = Array.isArray(body.conversa_ids) ? body.conversa_ids : null;
  const ehCronAuto = !conversaIdsManual;  // sem ids = modo cron

  // Cron: precisa user-agent vercel-cron ou ?force=1
  if (ehCronAuto && req.method === 'GET') {
    const ua = req.headers['user-agent'] || '';
    const isCron = ua.startsWith('vercel-cron') || !!req.headers['x-vercel-cron'];
    if (!isCron && req.query?.force !== '1') {
      return res.status(403).json({ error: 'Cron only. Use ?force=1 pra teste.' });
    }
  } else if (ehCronAuto && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET (cron) ou POST { conversa_ids } esperado' });
  }

  try {
    // Busca os 2 templates ativos: v2 (carrinho com pecas) + visita_site (zerado)
    // Ailson 27/05/2026: escolhe baseado em qtd_pecas da conversa.
    const { data: templates } = await supabase
      .from('lojas_whats_templates')
      .select('*')
      .in('name', ['carrinho_abandonado_site_amicia_v2', 'visita_site_amicia_v1'])
      .eq('ativo', true);

    const tplCarrinho = templates?.find(t => t.name === 'carrinho_abandonado_site_amicia_v2');
    const tplVisita   = templates?.find(t => t.name === 'visita_site_amicia_v1');

    if (!tplCarrinho || !tplVisita) {
      return res.status(500).json({
        error: 'template_nao_encontrado',
        detalhes: `templates ativos faltando: carrinho=${!!tplCarrinho}, visita=${!!tplVisita}`,
      });
    }

    // Carrega conversas a processar
    let conversas;
    if (conversaIdsManual) {
      // Modo manual: assistente selecionou IDs especificos.
      const { data, error } = await supabase
        .from('lojas_whats_conversas')
        .select('id, nome_cliente, qtd_pecas, carrinho_id, etapa')
        .in('id', conversaIdsManual)
        .eq('etapa', 'processando');
      if (error) throw error;
      conversas = data || [];
    } else {
      // Modo cron: pega N=cap_diario ordenados (PJ primeiro, prioritarios topo, data desc).
      const cap = await getConfig('cap_diario', 2);
      const { data, error } = await supabase
        .from('lojas_whats_conversas')
        .select('id, nome_cliente, qtd_pecas, carrinho_id, etapa, tipo_documento, iniciada_em, lead_prioritario')
        .eq('etapa', 'processando')
        .order('lead_prioritario', { ascending: false })
        .order('tipo_documento', { ascending: false })  // CNPJ antes de CPF (alfabetico inverso)
        .order('iniciada_em', { ascending: false })
        .limit(cap);
      if (error) throw error;
      conversas = data || [];
    }

    if (conversas.length === 0) {
      return res.json({
        ok: true,
        processadas: 0,
        motivo: conversaIdsManual ? 'nenhuma_em_processando' : 'fila_vazia',
      });
    }

    const resultados = { processadas: 0, falhas: [], por_template: {} };
    for (const conv of conversas) {
      try {
        // Regra Ailson 27/05/2026:
        //   qtd_pecas >= 1 → template_v2 (carrinho com pecas)
        //   qtd_pecas <= 0 / null → visita_site (apenas {{1}})
        const pecas = Number(conv.qtd_pecas || 0);
        const template = pecas >= 1 ? tplCarrinho : tplVisita;
        await processarConversaUnica(conv, template);
        resultados.processadas++;
        resultados.por_template[template.name] = (resultados.por_template[template.name] || 0) + 1;
      } catch (e) {
        logErro('processar/unica', e);
        resultados.falhas.push({ conversa_id: conv.id, erro: e.message });
      }
    }

    log('processar', `${resultados.processadas}/${conversas.length} processadas (modo ${ehCronAuto ? 'cron' : 'manual'})`);
    return res.json({
      ok: true,
      modo: ehCronAuto ? 'cron_auto' : 'manual',
      processadas: resultados.processadas,
      por_template: resultados.por_template,
      falhas: resultados.falhas,
    });
  } catch (e) {
    logErro('processar', e);
    return res.status(500).json({ error: e.message });
  }
}
