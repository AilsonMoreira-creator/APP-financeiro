// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-debug-template — TEMPORARIO (Ailson 27/05/2026)
// ═══════════════════════════════════════════════════════════════════════════
// Endpoint de DEBUG para identificar por que Meta rejeita visita_site_amicia_v1.
// Recebe conversa_id por query string e tenta enviar o template, retornando
// SEM mascarar tudo que a Meta devolveu (sucesso ou erro).
//
// GET /api/lojas-whats-debug-template?conversa_id=701e235b-...
//
// REMOVER apos diagnostico.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors } from './_lojas-whats-helpers.js';
import { enviarTemplate, listarTemplates } from './_lojas-whats-meta-client.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // action=list_meta → lista templates direto da Meta (fonte da verdade)
  if (req.query?.action === 'list_meta') {
    try {
      const tpls = await listarTemplates();
      const resumo = tpls.map(t => ({
        name: t.name,
        language: t.language,
        status: t.status,
        category: t.category,
        id: t.id,
      }));
      return res.status(200).json({ ok: true, total: tpls.length, templates: resumo });
    } catch (e) {
      return res.status(200).json({ ok: false, erro: e.message, metaResponse: e.metaResponse || null });
    }
  }

  const conversa_id = req.query?.conversa_id;
  if (!conversa_id) return res.status(400).json({ error: 'conversa_id_ou_action_obrigatorio' });

  try {
    const { data: conv } = await supabase
      .from('lojas_whats_conversas')
      .select('id, telefone, nome_cliente, qtd_pecas')
      .eq('id', conversa_id)
      .maybeSingle();
    if (!conv) return res.status(404).json({ error: 'conversa_nao_encontrada' });

    const templateName = req.query?.template || 'visita_site_amicia_v1';
    const { data: tpl } = await supabase
      .from('lojas_whats_templates')
      .select('name, body_text, language, variables, status, ativo, botoes, meta_template_id, category')
      .eq('name', templateName)
      .maybeSingle();
    if (!tpl) return res.status(404).json({ error: 'template_nao_encontrado', templateName });

    const primeiroNome = (conv.nome_cliente || 'cliente').split(' ')[0];
    const valorPorChave = { '1': primeiroNome, '2': String(conv.qtd_pecas || 0) };
    const declaradas = Array.isArray(tpl.variables) ? tpl.variables : [];
    const vars = [];
    for (const v of declaradas) {
      const k = String(v?.nome ?? '');
      if (k && valorPorChave[k] !== undefined) vars.push(valorPorChave[k]);
    }

    const ctx = {
      conv: {
        id: conv.id,
        telefone: conv.telefone,
        nome_cliente: conv.nome_cliente,
        qtd_pecas: conv.qtd_pecas,
      },
      template_summary: {
        name: tpl.name,
        language: tpl.language,
        status: tpl.status,
        ativo: tpl.ativo,
        category: tpl.category,
        meta_template_id: tpl.meta_template_id,
        variables_declared: declaradas,
        botoes: tpl.botoes,
      },
      vars_que_serao_enviadas: vars,
      meta_phone_id: process.env.META_WA_PHONE_ID ? '[set]' : '[MISSING]',
      meta_token_present: !!process.env.META_WA_ACCESS_TOKEN,
    };

    try {
      const resp = await enviarTemplate(conv.telefone, tpl.name, vars, tpl.language || 'pt_BR');
      return res.status(200).json({
        ok: true,
        sucesso: true,
        contexto: ctx,
        meta_response: resp,
      });
    } catch (e) {
      return res.status(200).json({
        ok: true,
        sucesso: false,
        contexto: ctx,
        erro: {
          message: e.message,
          status: e.status,
          metaResponse: e.metaResponse || null,
          stack: (e.stack || '').split('\n').slice(0, 5),
        },
      });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: (e.stack || '').split('\n').slice(0, 5) });
  }
}
