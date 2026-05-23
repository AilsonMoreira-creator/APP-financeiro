// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-aprovar.js — Endpoint da Tamara: aprovar / editar / dispensar
// ═══════════════════════════════════════════════════════════════════════════
// Tamara entra em /lojas/whats/aprovar, vê a fila de sugestões pendentes
// (geradas pelo cron-selecionar), e pode:
//
//   - APROVAR (envia direto a sugestão original)
//   - EDITAR + APROVAR (muda texto e envia)
//   - DISPENSAR (descarta a sugestão, conversa vai pra perdida)
//   - APROVAR EM LOTE (vários IDs de uma vez)
//
// Métodos:
//   GET  /api/lojas-whats-aprovar              → lista sugestões pendentes
//   GET  /api/lojas-whats-aprovar?id=xxx       → detalhe de 1 sugestão
//   POST /api/lojas-whats-aprovar              → executa ação
//        body: { sugestao_id, acao, texto_editado?, aprovada_por? }
//        body: { sugestao_ids: [...], acao, aprovada_por? } (lote)
//
// AÇÕES:
//   - 'aprovar'        → envia HSM via Meta, marca sugestao=enviada
//   - 'editar_aprovar' → mesma coisa mas com texto_editado
//   - 'dispensar'      → sugestao=dispensada, conversa=perdida
// ═══════════════════════════════════════════════════════════════════════════

import {
  supabase,
  setCors,
  log,
  logErro,
  primeiroNome
} from './_lojas-whats-helpers.js';
import { enviarTemplate, enviarTexto } from './_lojas-whats-meta-client.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    if (req.query.id) return await detalhe(req, res);
    return await listarPendentes(req, res);
  }
  if (req.method === 'POST') {
    return await executarAcao(req, res);
  }
  return res.status(405).json({ error: 'method_not_allowed' });
}

// ─── GET: lista sugestões pendentes pra Tamara ─────────────────────────────

async function listarPendentes(req, res) {
  try {
    const status = req.query.status || 'pendente';
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);

    const { data, error } = await supabase
      .from('lojas_whats_sugestoes')
      .select(`
        id, conversa_id, tipo, template_name, template_vars,
        texto_proposto, texto_editado, status, prioridade,
        motivo_proposta, criada_em,
        conversa:lojas_whats_conversas (
          id, telefone, nome_cliente, tipo_documento, etapa,
          valor_carrinho, qtd_pecas, vendedora_atribuida_id,
          iniciada_em
        )
      `)
      .eq('status', status)
      .order('prioridade', { ascending: false })
      .order('criada_em', { ascending: true })
      .limit(limit);

    if (error) throw error;

    return res.status(200).json({
      ok: true,
      total: data?.length || 0,
      sugestoes: data || []
    });
  } catch (e) {
    logErro('aprovar/listar', e);
    return res.status(500).json({ error: e.message });
  }
}

async function detalhe(req, res) {
  try {
    const { data, error } = await supabase
      .from('lojas_whats_sugestoes')
      .select(`
        *,
        conversa:lojas_whats_conversas (
          *,
          mensagens:lojas_whats_mensagens (
            id, direcao, autor, tipo_midia, texto, midia_url,
            audio_transcricao, status, enviada_em, lida_em
          )
        )
      `)
      .eq('id', req.query.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'nao_encontrada' });
    return res.status(200).json({ ok: true, sugestao: data });
  } catch (e) {
    logErro('aprovar/detalhe', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── POST: executar ação (aprovar / editar+aprovar / dispensar) ────────────

async function executarAcao(req, res) {
  try {
    const body = req.body || {};
    const acao = body.acao;
    const aprovadaPor = body.aprovada_por || 'tamara';

    if (!['aprovar', 'editar_aprovar', 'dispensar'].includes(acao)) {
      return res.status(400).json({ error: 'acao_invalida', validas: ['aprovar', 'editar_aprovar', 'dispensar'] });
    }

    // Suporta lote (sugestao_ids) OU única (sugestao_id)
    const ids = body.sugestao_ids || (body.sugestao_id ? [body.sugestao_id] : []);
    if (ids.length === 0) {
      return res.status(400).json({ error: 'sem_sugestao_id' });
    }

    const resultados = { ok: [], erro: [] };

    for (const id of ids) {
      try {
        const r = await processarUma(id, acao, body.texto_editado, aprovadaPor);
        resultados.ok.push({ id, ...r });
      } catch (e) {
        logErro('aprovar/uma', e);
        resultados.erro.push({ id, erro: e.message });
      }
    }

    return res.status(200).json({
      ok: true,
      processadas: resultados.ok.length,
      falhas: resultados.erro.length,
      resultados
    });
  } catch (e) {
    logErro('aprovar/acao', e);
    return res.status(500).json({ error: e.message });
  }
}

// ─── Processa 1 sugestão ───────────────────────────────────────────────────

async function processarUma(sugestaoId, acao, textoEditado, aprovadaPor) {
  // 1. Busca sugestão + conversa
  const { data: sug, error: errSug } = await supabase
    .from('lojas_whats_sugestoes')
    .select(`
      *,
      conversa:lojas_whats_conversas (id, telefone, etapa, nome_cliente)
    `)
    .eq('id', sugestaoId)
    .maybeSingle();
  if (errSug) throw errSug;
  if (!sug) throw new Error('sugestao_nao_encontrada');
  if (sug.status !== 'pendente') {
    throw new Error(`sugestao_ja_processada (status atual: ${sug.status})`);
  }

  const agora = new Date().toISOString();

  // ─── DISPENSAR ──────────────────────────────────────────
  if (acao === 'dispensar') {
    await supabase.from('lojas_whats_sugestoes').update({
      status: 'dispensada',
      aprovada_por: aprovadaPor,
      aprovada_em: agora,
      atualizada_em: agora
    }).eq('id', sugestaoId);

    // Marca conversa como perdida
    await supabase.from('lojas_whats_conversas').update({
      etapa: 'perdida',
      motivo_perdida: 'dispensada_tamara',
      perdida_em: agora,
      atualizado_em: agora
    }).eq('id', sug.conversa.id);

    return { acao: 'dispensada' };
  }

  // ─── APROVAR ou EDITAR_APROVAR ──────────────────────────
  // Texto final a enviar
  const textoFinal = acao === 'editar_aprovar' && textoEditado
    ? textoEditado
    : sug.texto_proposto;

  // Envia via Meta
  let metaResp = null;
  let metaMsgId = null;
  let erroEnvio = null;

  try {
    if (sug.tipo === 'primeira_mensagem' && sug.template_name) {
      // Envia HSM (template aprovado pela Meta).
      // template_vars vem como { "1": "Maria", "2": "8" } — converte pra array ordenado
      const vars = ordenarVarsTemplate(sug.template_vars);
      metaResp = await enviarTemplate(sug.conversa.telefone, sug.template_name, vars);
    } else {
      // Réplica: texto livre (só funciona dentro da janela 24h)
      metaResp = await enviarTexto(sug.conversa.telefone, textoFinal);
    }
    metaMsgId = metaResp?.messages?.[0]?.id || null;
  } catch (e) {
    erroEnvio = e.message;
    logErro('aprovar/envio-meta', e);
  }

  // Se Meta falhou: marca sugestão como falhou (NÃO marca como enviada)
  if (erroEnvio) {
    await supabase.from('lojas_whats_sugestoes').update({
      status: 'falhou',
      texto_editado: acao === 'editar_aprovar' ? textoEditado : null,
      aprovada_por: aprovadaPor,
      aprovada_em: agora,
      atualizada_em: agora
    }).eq('id', sugestaoId);
    throw new Error(`meta_falhou: ${erroEnvio}`);
  }

  // Persiste mensagem enviada
  const { data: msgRow, error: errMsg } = await supabase
    .from('lojas_whats_mensagens')
    .insert({
      conversa_id: sug.conversa.id,
      direcao: 'saida',
      autor: 'sofia_ia',
      tipo_midia: sug.tipo === 'primeira_mensagem' ? 'template' : 'text',
      texto: textoFinal,
      template_name: sug.template_name,
      template_vars: sug.template_vars,
      meta_message_id: metaMsgId,
      status: 'enviando',
      meta_response: metaResp,
      enviada_em: agora
    })
    .select('id')
    .single();
  if (errMsg) logErro('aprovar/insert-msg', errMsg);

  // Atualiza sugestão
  await supabase.from('lojas_whats_sugestoes').update({
    status: 'enviada',
    texto_editado: acao === 'editar_aprovar' ? textoEditado : null,
    aprovada_por: aprovadaPor,
    aprovada_em: agora,
    enviada_em: agora,
    mensagem_id: msgRow?.id || null,
    atualizada_em: agora
  }).eq('id', sugestaoId);

  // Avança conversa pra etapa='enviada'
  await supabase.from('lojas_whats_conversas').update({
    etapa: 'enviada',
    primeira_msg_enviada_em: agora,
    ultima_atividade_em: agora,
    atualizado_em: agora
  }).eq('id', sug.conversa.id);

  return {
    acao,
    meta_message_id: metaMsgId,
    texto_enviado: textoFinal.slice(0, 80) + (textoFinal.length > 80 ? '...' : '')
  };
}

// ─── HELPER: converte template_vars { "1":"Maria","2":"8" } → ["Maria","8"] ─

function ordenarVarsTemplate(varsObj) {
  if (!varsObj || typeof varsObj !== 'object') return [];
  // Ordena por chave numérica
  const keys = Object.keys(varsObj).sort((a, b) => Number(a) - Number(b));
  return keys.map(k => String(varsObj[k] ?? ''));
}
