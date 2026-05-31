// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-clientes-massa — DISPARO em massa (módulo Clientes)
// ═══════════════════════════════════════════════════════════════════════════
// POST { cliente_ids: [...], etapa: 'feedback'|'inativo' }
//
// Template é escolhido pela etapa (Sofia escolhe):
//   feedback → Feedback_v1   |   inativo → Inativos_v1
//
// Pra cada cliente selecionado:
//   1. acha/cria conversa zerada na etapa do módulo (mantém a etapa — não vai pro funil)
//   2. envia o template HSM via Meta (enviarTemplate) — mesmo caminho da Aprovar
//   3. grava a mensagem (saída) e marca primeira_msg_enviada_em (sem mudar a etapa)
//
// Retorna { enviados, erros, total }.
// OBS: loop sequencial; lotes muito grandes podem estourar o tempo da função —
// disparar em blocos menores se necessário.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, normalizarTelefone } from './_lojas-whats-helpers.js';
import { enviarTemplate } from './_lojas-whats-meta-client.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const TEMPLATE_POR_ETAPA = { feedback: 'Feedback_v1', inativo: 'Inativos_v1' };
const LIMITE = 500;

// monta array posicional de variáveis na ordem que o template declara
function montarVars(declaradas, valorPorChave) {
  const arr = [];
  for (const v of (Array.isArray(declaradas) ? declaradas : [])) {
    const k = String(v?.nome ?? '');
    arr.push(valorPorChave[k] !== undefined ? valorPorChave[k] : '');
  }
  return arr;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { cliente_ids, etapa } = req.body || {};
    if (!Array.isArray(cliente_ids) || cliente_ids.length === 0) {
      return res.status(400).json({ error: 'cliente_ids_obrigatorio' });
    }
    if (cliente_ids.length > LIMITE) {
      return res.status(400).json({ error: `limite_${LIMITE}_excedido` });
    }
    const etapaFinal = (etapa === 'inativo') ? 'inativo' : 'feedback';
    const templateName = TEMPLATE_POR_ETAPA[etapaFinal];

    // template precisa existir e estar ativo (Ailson cria Feedback_v1 / Inativos_v1)
    const { data: tpl } = await supabase
      .from('lojas_whats_templates')
      .select('name, language, variables')
      .eq('name', templateName)
      .eq('ativo', true)
      .maybeSingle();
    if (!tpl) return res.status(400).json({ error: `template_${templateName}_inexistente_ou_inativo` });
    const language = tpl.language || 'pt_BR';
    const declaradas = tpl.variables;

    const agora = new Date().toISOString();
    let enviados = 0;
    const erros = [];

    for (const clienteId of cliente_ids) {
      try {
        const { data: cli } = await supabase
          .from('lojas_clientes')
          .select('telefone_principal, razao_social, comprador_nome')
          .eq('id', clienteId)
          .maybeSingle();
        if (!cli) { erros.push({ clienteId, erro: 'cliente_nao_encontrado' }); continue; }
        const tel = normalizarTelefone(cli.telefone_principal);
        if (!tel) { erros.push({ clienteId, erro: 'telefone_invalido' }); continue; }
        const nome = cli.razao_social || cli.comprador_nome || null;

        // acha/cria conversa não-terminal
        let conversaId;
        const { data: existentes } = await supabase
          .from('lojas_whats_conversas')
          .select('id')
          .eq('cliente_id', clienteId)
          .not('etapa', 'in', '(vendeu,perdida)')
          .order('atualizado_em', { ascending: false })
          .limit(1);
        if (existentes && existentes.length > 0) {
          conversaId = existentes[0].id;
        } else {
          const { data: nova, error: eN } = await supabase
            .from('lojas_whats_conversas')
            .insert({ cliente_id: clienteId, telefone: tel, nome_cliente: nome, etapa: etapaFinal })
            .select('id').single();
          if (eN) { erros.push({ clienteId, erro: eN.message }); continue; }
          conversaId = nova.id;
        }

        // vars (posicional) — {{1}} = 1º nome
        const primeiroNome = (nome || 'cliente').split(' ')[0];
        const vars = montarVars(declaradas, { '1': primeiroNome });

        // envia HSM
        let metaResp, metaMsgId;
        try {
          metaResp = await enviarTemplate(tel, templateName, vars, language);
          metaMsgId = metaResp?.messages?.[0]?.id || null;
        } catch (e) {
          erros.push({ clienteId, erro: 'meta_falhou: ' + e.message });
          continue;
        }

        // grava mensagem de saída
        await supabase.from('lojas_whats_mensagens').insert({
          conversa_id: conversaId,
          direcao: 'saida',
          autor: 'sofia_ia',
          tipo_midia: 'template',
          texto: null,
          template_name: templateName,
          template_vars: { '1': primeiroNome },
          meta_message_id: metaMsgId,
          status: 'enviando',
          meta_response: metaResp,
          enviada_em: agora,
        });

        // marca enviada — SEM mudar a etapa (fica em feedback/inativo)
        await supabase.from('lojas_whats_conversas').update({
          primeira_msg_enviada_em: agora,
          ultima_atividade_em: agora,
          ultima_msg_direcao: 'saida',
          atualizado_em: agora,
        }).eq('id', conversaId);

        enviados++;
      } catch (e) {
        erros.push({ clienteId, erro: e.message });
      }
    }

    return res.status(200).json({ ok: true, enviados, erros, total: cliente_ids.length });
  } catch (e) {
    console.error('[lojas-whats-clientes-massa]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
