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
import { parseMarcadoresMidia, resolverMidia, enviarMidiaSofia } from './_lojas-whats-midia-sender.js';

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
  const textoFinalBruto = acao === 'editar_aprovar' && textoEditado
    ? textoEditado
    : sug.texto_proposto;

  // PARSER MIDIAS (Ailson 26/05/2026)
  // Sofia pode ter colocado marcadores [ENVIAR_FOTO:2655] etc no texto.
  // Limita a 1 midia (regra dele).
  // Pra primeira_mensagem (template HSM) NAO usa marcadores — template tem
  // estrutura propria. So aplica em reply de texto.
  let textoFinal = textoFinalBruto;
  let midiaParaEnviar = null;
  if (sug.tipo !== 'primeira_mensagem') {
    const parsed = parseMarcadoresMidia(textoFinalBruto);
    textoFinal = parsed.textoLimpo;
    if (parsed.marcadores.length > 0) {
      try {
        midiaParaEnviar = await resolverMidia(parsed.marcadores[0]);
        if (!midiaParaEnviar) {
          log('aprovar', `marcador ${parsed.marcadores[0].matchCompleto} nao resolveu — midia nao existe`);
        }
      } catch (e) {
        logErro('aprovar/parse-midia', e);
      }
    }
  }

  // Envia via Meta
  let metaResp = null;
  let metaMsgId = null;
  let erroEnvio = null;
  let erroMetaResponse = null;

  try {
    if (sug.tipo === 'primeira_mensagem' && sug.template_name) {
      // Envia HSM (template aprovado pela Meta).
      // template_vars vem como { "1": "Maria", "2": "8" } — converte pra array ordenado
      const vars = ordenarVarsTemplate(sug.template_vars);
      metaResp = await enviarTemplate(sug.conversa.telefone, sug.template_name, vars);
    } else {
      // Réplica: texto livre (só funciona dentro da janela 24h)
      // Se tem midia, envia midia COM o texto como caption (foto/video) ou
      // envia texto primeiro e depois midia (catalogo PDF).
      if (midiaParaEnviar && (midiaParaEnviar.tipo === 'foto' || midiaParaEnviar.tipo === 'video')) {
        // Caption junto com a midia (1 só request — limite 1 midia por msg)
        const r = await enviarMidiaSofia({
          telefone: sug.conversa.telefone,
          midia: midiaParaEnviar,
          caption: textoFinal,
          conversaId: sug.conversa.id,
          mensagemId: null,  // preenche depois
          decididaPor: 'ia_automatica',
        });
        if (!r.ok) throw new Error(r.erro || 'envio_midia_falhou');
        metaResp = { messages: [{ id: r.message_id }], _midia: true };
      } else {
        // Sem midia OU catalogo (PDF nao tem caption): envia texto
        metaResp = await enviarTexto(sug.conversa.telefone, textoFinal);

        // Catalogo: envia documento PDF depois do texto (separado)
        if (midiaParaEnviar && midiaParaEnviar.tipo === 'catalogo') {
          const r = await enviarMidiaSofia({
            telefone: sug.conversa.telefone,
            midia: midiaParaEnviar,
            conversaId: sug.conversa.id,
            mensagemId: null,
            decididaPor: 'ia_automatica',
          });
          if (!r.ok) log('aprovar', `catalogo enviado com erro: ${r.erro}`);
        }
      }
    }
    metaMsgId = metaResp?.messages?.[0]?.id || null;
  } catch (e) {
    erroEnvio = e.message;
    erroMetaResponse = e.metaResponse || null;
    logErro('aprovar/envio-meta', e);
    if (erroMetaResponse) {
      console.error('[lojas-whats/aprovar/envio-meta] metaResponse:', JSON.stringify(erroMetaResponse));
    }
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
    const detalhe = erroMetaResponse ? ` :: ${JSON.stringify(erroMetaResponse)}` : '';
    throw new Error(`meta_falhou: ${erroEnvio}${detalhe}`);
  }

  // Persiste mensagem enviada
  const tipoMidiaMsg = sug.tipo === 'primeira_mensagem'
    ? 'template'
    : (midiaParaEnviar
        ? (midiaParaEnviar.tipo === 'foto' ? 'image'
           : midiaParaEnviar.tipo === 'video' ? 'video' : 'document')
        : 'text');

  // Ailson 25/05/2026: salva URL publica da midia pra frontend mostrar miniatura
  let midiaUrlMsg = null;
  if (midiaParaEnviar?.storage_path) {
    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(midiaParaEnviar.storage_path);
    midiaUrlMsg = pub?.publicUrl || null;
  }

  const { data: msgRow, error: errMsg } = await supabase
    .from('lojas_whats_mensagens')
    .insert({
      conversa_id: sug.conversa.id,
      direcao: 'saida',
      autor: 'sofia_ia',
      tipo_midia: tipoMidiaMsg,
      texto: textoFinal,
      midia_url: midiaUrlMsg,
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

  // Backfill: atualiza lojas_whats_midias_usos com mensagem_id real
  if (midiaParaEnviar && msgRow?.id) {
    await supabase
      .from('lojas_whats_midias_usos')
      .update({ mensagem_id: msgRow.id })
      .eq('conversa_id', sug.conversa.id)
      .is('mensagem_id', null)
      .order('enviada_em', { ascending: false })
      .limit(1);
  }

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

  // Avança conversa pra etapa apropriada baseado no tipo de sugestao.
  // Ailson 25/05/2026: bug — antes forcava 'enviada' SEMPRE, mesmo quando
  // a sugestao era replica em uma conversa ja 'conversando'. Agora:
  //   - primeira_mensagem (HSM): aprovar -> ENVIADA (espera cliente responder)
  //   - replica (cliente ja respondeu antes): mantem etapa atual (Conversando,
  //     follow_up, ou outra) — so atualiza timestamps.
  // Caso esfecial: se conversa estava em 'follow_up' e replica foi aprovada,
  // tambem mantem follow_up (Sofia esta no flow de retomada).
  const updatesConv = {
    ultima_atividade_em: agora,
    atualizado_em: agora,
  };
  if (sug.tipo === 'primeira_mensagem') {
    updatesConv.etapa = 'enviada';
    updatesConv.primeira_msg_enviada_em = agora;
  }
  // Ailson 27/05/2026: fix Neuma — catalogo enviado via aprovar tambem
  // precisa marcar catalogo_enviado_em pra cron-catalogo FASE 1 (6h) e
  // FASE 2 (24h) dispararem. Antes so o mensagem-enviar.js marcava;
  // aprovar.js (que e o fluxo das sugestoes Sofia aprovadas) nao.
  if (midiaParaEnviar && midiaParaEnviar.tipo === 'catalogo') {
    updatesConv.catalogo_enviado_em = agora;
    updatesConv.catalogo_followup_6h_em = null;
  }
  // Pra replica em outras etapas: NAO toca em etapa
  await supabase.from('lojas_whats_conversas')
    .update(updatesConv)
    .eq('id', sug.conversa.id);

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
