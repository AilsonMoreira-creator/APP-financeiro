// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-template-submeter.js — Submete HSM pra aprovacao Meta
// ═══════════════════════════════════════════════════════════════════════════
// Usa META_WA_WABA_ID do env (que precisa ser a WABA da Amicia Fashion,
// NAO uma sandbox de teste).
//
// GET   /api/lojas-whats-template-submeter
//   → lista templates em rascunho (que ainda nao foram submetidos)
//
// POST  /api/lojas-whats-template-submeter
//   body: { name: 'carrinho_abandonado_site_amicia' }
//   → busca template do banco, submete pra Meta, salva resposta
//
// Apos submit bem-sucedido:
//   - status: 'rascunho' → 'pendente_aprovacao'
//   - meta_template_id: id retornado pela Meta
//   - meta_response: payload bruto (debug)
//
// Aprovacao Meta leva 24-48h. Status final ('aprovado'/'rejeitado') vem
// via webhook field 'message_template_status_update'.
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro } from './_lojas-whats-helpers.js';
import { submeterTemplate } from './_lojas-whats-meta-client.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    // Suporte mobile: GET ?submeter=1&name=... executa submit
    // (gambiarra pra Ailson testar pelo Safari sem terminal)
    if (req.query.submeter === '1' && req.query.name) {
      // Injeta name no body pra reaproveitar submeter()
      req.body = { name: req.query.name };
      return submeter(req, res);
    }
    return listarRascunhos(req, res);
  }
  if (req.method === 'POST') return submeter(req, res);

  return res.status(405).json({ error: 'method_not_allowed' });
}

// ─── GET: lista templates em rascunho ─────────────────────────────────────

async function listarRascunhos(req, res) {
  const { data, error } = await supabase
    .from('lojas_whats_templates')
    .select('name, language, category, body_text, status, meta_template_id, atualizado_em')
    .eq('status', 'rascunho')
    .order('atualizado_em', { ascending: false });

  if (error) {
    logErro('template-listar-rascunho', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({
    waba_id: process.env.META_WA_WABA_ID,
    rascunhos: data || [],
    total: data?.length || 0
  });
}

// ─── POST: submete template pra Meta ──────────────────────────────────────

async function submeter(req, res) {
  const { name } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'name_required' });
  }

  // 1. Busca template no banco
  const { data: tpl, error: errBuscar } = await supabase
    .from('lojas_whats_templates')
    .select('*')
    .eq('name', name)
    .maybeSingle();

  if (errBuscar) {
    logErro('template-buscar', errBuscar);
    return res.status(500).json({ error: errBuscar.message });
  }
  if (!tpl) {
    return res.status(404).json({ error: 'template_nao_encontrado', name });
  }
  if (tpl.status !== 'rascunho') {
    return res.status(409).json({
      error: 'template_ja_submetido',
      status_atual: tpl.status,
      meta_template_id: tpl.meta_template_id
    });
  }

  // 2. Header IMAGE (templates _img): se o rascunho aponta uma REF da
  // biblioteca Mídias (header.sample_ref), gera signed URL do sofia-midias
  // pro submeterTemplate baixar e subir como sample. Ailson 02/07/2026.
  if (tpl.header?.format === 'IMAGE' && tpl.header?.sample_ref && !tpl.header?.sample_url) {
    const refNorm = String(tpl.header.sample_ref).replace(/^0+/, '') || '0';
    const variantes = [...new Set([refNorm, refNorm.padStart(4, '0'), refNorm.padStart(5, '0')])];
    const { data: midia } = await supabase
      .from('lojas_whats_midias')
      .select('storage_path')
      .eq('tipo', 'foto')
      .eq('ativa', true)
      .in('ref', variantes)
      .limit(1)
      .maybeSingle();
    if (!midia) {
      return res.status(404).json({ error: 'sample_ref_sem_foto_na_biblioteca', ref: refNorm });
    }
    const { data: signed, error: errSign } = await supabase.storage
      .from('sofia-midias')
      .createSignedUrl(midia.storage_path, 3600);
    if (errSign || !signed?.signedUrl) {
      return res.status(500).json({ error: 'signed_url_falhou', detalhe: errSign?.message });
    }
    tpl.header = { ...tpl.header, sample_url: signed.signedUrl };
  }

  // 3. Submete pra Meta
  log('template-submeter', `name=${name} waba=${process.env.META_WA_WABA_ID}`);
  let metaRes;
  try {
    metaRes = await submeterTemplate(tpl);
  } catch (e) {
    logErro('template-submeter', e);
    // Salva o erro no banco pra historico
    await supabase
      .from('lojas_whats_templates')
      .update({
        meta_response: { erro: e.message, status: e.status, payload: e.metaResponse },
        atualizado_em: new Date().toISOString()
      })
      .eq('name', name);

    return res.status(e.status || 500).json({
      error: 'meta_api_error',
      meta_status: e.status,
      meta_message: e.message,
      meta_response: e.metaResponse,
      dica: e.status === 403
        ? 'Token nao tem permissao na WABA configurada. Confere META_WA_WABA_ID + permissoes do token.'
        : (e.status === 400
            ? 'Payload invalido. Confere body/buttons/variaveis.'
            : null)
    });
  }

  // 3. Salva resposta
  const novoStatus = 'pendente_aprovacao';
  const { error: errSalvar } = await supabase
    .from('lojas_whats_templates')
    .update({
      meta_template_id: metaRes?.id || null,
      status: novoStatus,
      meta_response: metaRes,
      atualizado_em: new Date().toISOString()
    })
    .eq('name', name);

  if (errSalvar) {
    logErro('template-salvar', errSalvar);
    // Nao falha — template ja foi pra Meta, so o banco que falhou
  }

  log('template-submeter', `OK name=${name} id=${metaRes?.id} status=${metaRes?.status}`);

  return res.status(200).json({
    ok: true,
    name,
    meta_template_id: metaRes?.id,
    meta_status: metaRes?.status, // PENDING geralmente
    meta_category: metaRes?.category,
    novo_status_banco: novoStatus,
    aviso: 'Aprovacao leva 24-48h. Status final vem via webhook (message_template_status_update).'
  });
}
