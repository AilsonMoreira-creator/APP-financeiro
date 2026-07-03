// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-aprovar.js — Endpoint da Tamara: aprovar / editar / dispensar
// ═══════════════════════════════════════════════════════════════════════════
// Tamara entra em /lojas/whats/aprovar, vê a fila de sugestões pendentes
// (geradas pelo cron-selecionar), e pode:
//
//   - APROVAR (envia direto a sugestão original)
//   - EDITAR + APROVAR (muda texto e envia)
//   - DISPENSAR (descarta só a sugestão; conversa NÃO vira perdida)
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
//   - 'dispensar'      → sugestao=dispensada (etapa da conversa intacta)
// ═══════════════════════════════════════════════════════════════════════════

import {
  supabase,
  setCors,
  log,
  logErro,
  primeiroNome,
  getConfig
} from './_lojas-whats-helpers.js';
import { enviarTemplate, enviarTexto, enviarTextoFracionado } from './_lojas-whats-meta-client.js';
import { parseMarcadoresMidia, resolverMidia, enviarMidiaSofia, uploadMidiaSofiaComoMediaId } from './_lojas-whats-midia-sender.js';

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

export async function processarUma(sugestaoId, acao, textoEditado, aprovadaPor) {
  // 1. Busca sugestão + conversa
  const { data: sug, error: errSug } = await supabase
    .from('lojas_whats_sugestoes')
    .select(`
      *,
      conversa:lojas_whats_conversas (id, telefone, etapa, nome_cliente, catalogo_formato)
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
  // Apenas descarta a sugestão. NÃO mexe na etapa da conversa: muitas vezes a
  // Tamara/Ailson só quer limpar a sugestão pra mandar uma mensagem manual, sem
  // perder o lead. Pra marcar como perdida de propósito, usar o seletor de etapa.
  // Ailson 13/06/2026.
  if (acao === 'dispensar') {
    await supabase.from('lojas_whats_sugestoes').update({
      status: 'dispensada',
      aprovada_por: aprovadaPor,
      aprovada_em: agora,
      atualizada_em: agora
    }).eq('id', sugestaoId);

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
  let textoMsgPrincipal = null; // se fracionado: registro principal = so a parte 1
  let midiaParaEnviar = null;
  let midiasExtras = []; // fotos adicionais (showcase de categoria, ate 5) — Ailson 16/06/2026
  let extrasEnviadas = []; // {midia, message_id} das extras realmente enviadas — pra gravar no historico
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
      // fotos extras (so quando o primeiro tambem e foto — showcase de categoria)
      if (parsed.marcadores.length > 1 && parsed.marcadores[0].tipo === 'foto') {
        for (const mk of parsed.marcadores.slice(1)) {
          if (mk.tipo !== 'foto') continue;
          try {
            const mx = await resolverMidia(mk);
            if (mx) midiasExtras.push(mx);
          } catch (e) { logErro('aprovar/parse-midia-extra', e); }
        }
      }
    }
  }

  // OFERTA varejo/upgrade: Sofia marca [OFERTA_VAREJO] (3-7 peças, varejo que
  // vendemos) ou [OFERTA_UPGRADE] (1-2 peças, varejo abaixo do mínimo). Os dois
  // são público varejo e alimentam a aba Varejo (sinal de qualidade de campanha).
  // Remove o marcador do texto e seta oferta_varejo_em; o cron-varejo move pra
  // aba em 24h sem resposta. Ailson 07/06/2026 — antes só o mensagem-enviar.js
  // (envio manual) tratava, então a aba ficava sempre vazia no fluxo da Sofia.
  let setOfertaVarejo = false;
  if (sug.tipo !== 'primeira_mensagem') {
    const reOferta = /^\s*\[(OFERTA_VAREJO|OFERTA_UPGRADE)\]\s*/i;
    if (reOferta.test(textoFinalBruto)) {
      setOfertaVarejo = true;
      textoFinal = textoFinal.replace(reOferta, '').trim();
    }
  }

  // Envia via Meta
  let metaResp = null;
  let metaMsgId = null;
  let erroEnvio = null;
  let erroMetaResponse = null;
  let headerMidiaPath = null; // storage_path da foto do header (template _img) — Ailson 03/07/2026
  let tplEnviadoReal = null;  // nome do template que realmente saiu (fallback texto incluso)

  try {
    if (sug.tipo === 'primeira_mensagem' && sug.template_name) {
      // Envia HSM (template aprovado pela Meta).
      // Filtra template_vars pelas variáveis DECLARADAS pelo template — mandar
      // parâmetro a mais faz a Meta rejeitar (#132000). Ex: visita_site_amicia_v1
      // declara só {{1}}, mas a sugestão pode ter vindo com {1,2} do cron.
      // Ailson 28/05/2026 (mesma causa-raiz do caso Poliana).
      const { data: tplDecl } = await supabase
        .from('lojas_whats_templates')
        .select('variables')
        .eq('name', sug.template_name)
        .maybeSingle();
      const vars = ordenarVarsTemplate(sug.template_vars, tplDecl?.variables);
      // Template _img: a foto da peça vem da biblioteca Mídias (contexto_ia.
      // header_midia_id). Sobe pra Meta como media_id na hora do envio. Se a
      // mídia sumiu/falhar, cai pro v2 texto (mesmo corpo e vars) pra não
      // travar a abertura. Ailson 02/07/2026.
      let tplParaEnviar = sug.template_name;
      let optsEnvio = {};
      if (sug.contexto_ia?.header_midia_id) {
        try {
          const { data: midia } = await supabase
            .from('lojas_whats_midias')
            .select('id, storage_path, mime_type, nome_arquivo')
            .eq('id', sug.contexto_ia.header_midia_id)
            .eq('ativa', true)
            .maybeSingle();
          if (!midia) throw new Error('midia_header_nao_encontrada');
          const mediaId = await uploadMidiaSofiaComoMediaId(midia);
          optsEnvio = { headerImageId: mediaId };
          headerMidiaPath = midia.storage_path; // pro chat mostrar a foto (midia_url)
        } catch (e) {
          logErro('aprovar/header-img-fallback', e);
          if (tplParaEnviar.startsWith('carrinho_abandonado_site_amicia_img')) {
            tplParaEnviar = 'carrinho_abandonado_site_amicia_v2'; // mesmo corpo/vars, sem header
          }
          optsEnvio = {};
          headerMidiaPath = null;
        }
      }
      try {
        metaResp = await enviarTemplate(sug.conversa.telefone, tplParaEnviar, vars, 'pt_BR', optsEnvio);
      } catch (eImg) {
        // Meta rejeitou o HSM com foto (ex: template sem header, midia invalida):
        // reenvia na hora como v2 texto (mesmo corpo/vars) pra nao travar o lead.
        // Ailson 03/07/2026 (caso Linha Direta / img_v1 sem header).
        if (tplParaEnviar.startsWith('carrinho_abandonado_site_amicia_img')) {
          logErro('aprovar/img-envio-fallback-texto', eImg);
          tplParaEnviar = 'carrinho_abandonado_site_amicia_v2';
          headerMidiaPath = null; // caiu pro texto: nao gravar foto que nao foi
          metaResp = await enviarTemplate(sug.conversa.telefone, tplParaEnviar, vars, 'pt_BR', {});
        } else {
          throw eImg;
        }
      }
      tplEnviadoReal = tplParaEnviar; // grava no historico o template que FOI (fallback incluso)
    } else {
      // Réplica: texto livre (só funciona dentro da janela 24h)
      // Se tem midia, envia midia COM o texto como caption (foto/video) ou
      // envia texto primeiro e depois midia (catalogo PDF).
      if (midiaParaEnviar && (midiaParaEnviar.tipo === 'foto' || midiaParaEnviar.tipo === 'video' || midiaParaEnviar.tipo === 'cores')) {
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
        // fotos extras do showcase de categoria — 1 por mensagem, sem caption
        for (const mx of midiasExtras) {
          try {
            const rx = await enviarMidiaSofia({
              telefone: sug.conversa.telefone,
              midia: mx,
              conversaId: sug.conversa.id,
              mensagemId: null,
              decididaPor: 'ia_automatica',
            });
            if (rx.ok) extrasEnviadas.push({ midia: mx, message_id: rx.message_id });
            else log('aprovar', `foto extra ${mx.ref} nao enviou: ${rx.erro}`);
          } catch (e) { logErro('aprovar/foto-extra-envio', e); }
        }
      } else if (midiaParaEnviar && midiaParaEnviar.tipo === 'catalogo' && sug.conversa.catalogo_formato === 'vesti') {
        // VESTI (teste A/B) — Ailson 04/06/2026: catalogo VIRTUAL em 2 mensagens,
        // SEM PDF e SEM a fala generica do catalogo (que era pensada pro PDF).
        //   Msg 1 = explica como funciona | Msg 2 = link.
        // A fala da Sofia (textoFinal, ex: "Manda ver...") e DESCARTADA aqui.
        // O registro principal (abaixo) vira a Msg 1 como texto puro (sem doc),
        // entao nao aparece mais o card de PDF fantasma no chat.
        const vmsg1 = await getConfig('vesti_msg1',
          'Esse é o nosso catálogo virtual 😊 lá vc vê todos os modelos com foto, o valor de cada peça e o que tá em estoque na hora. Dá pra montar o pedido e finalizar a compra por lá mesmo');
        const vmsg2 = await getConfig('vesti_msg2',
          'É só abrir aqui ó: https://v.vesti.mobi/amicia\n\nQualquer dúvida sobre preço ou modelo me chama que eu te ajudo');
        textoFinal = vmsg1;
        metaResp = await enviarTexto(sug.conversa.telefone, vmsg1);
        try {
          const respVesti = await enviarTexto(sug.conversa.telefone, vmsg2);
          await supabase.from('lojas_whats_mensagens').insert({
            conversa_id: sug.conversa.id,
            direcao: 'saida',
            autor: 'sofia_ia',
            tipo_midia: 'text',
            texto: vmsg2,
            meta_message_id: respVesti?.messages?.[0]?.id || null,
            status: 'enviando',
            enviada_em: agora,
          });
          log('aprovar', `conversa=${sug.conversa.id} catalogo VESTI (2 msgs, sem PDF) enviado`);
        } catch (e) {
          logErro('aprovar/vesti-link', e);
        }
      } else {
        // Sem midia OU catalogo PDF padrao (PDF nao tem caption): envia texto.
        // Ailson 12/06/2026: fracionado como humano (3+ linhas vira 2 mensagens)
        const frac = await enviarTextoFracionado({
          telefone: sug.conversa.telefone, texto: textoFinal,
          conversaId: sug.conversa.id, supabase,
        });
        metaResp = frac.metaResp;
        textoMsgPrincipal = frac.textoPrimeiraParte;
        if (midiaParaEnviar && midiaParaEnviar.tipo === 'catalogo') {
          // Padrao: envia documento PDF depois do texto (separado)
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
    // DEBUG TEMPORARIO: salva o metaResponse no texto_editado pra inspecao
    // via SQL (logs Vercel truncados). Remover apos diagnostico.
    const debugBlob = erroMetaResponse
      ? '[DEBUG_META_FAIL] ' + JSON.stringify(erroMetaResponse).slice(0, 2000)
      : '[DEBUG_META_FAIL_NO_RESP] ' + (erroEnvio || '').slice(0, 500);
    await supabase.from('lojas_whats_sugestoes').update({
      status: 'falhou',
      texto_editado: debugBlob,
      aprovada_por: aprovadaPor,
      aprovada_em: agora,
      atualizada_em: agora
    }).eq('id', sugestaoId);
    const detalhe = erroMetaResponse ? ` :: ${JSON.stringify(erroMetaResponse)}` : '';
    throw new Error(`meta_falhou: ${erroEnvio}${detalhe}`);
  }

  // Persiste mensagem enviada
  // VESTI: catalogo virtual nao envia documento PDF, entao o registro principal
  // NAO pode virar 'document' (gerava card de PDF fantasma no chat). Ailson 04/06/2026.
  const ehVestiCatalogo = midiaParaEnviar?.tipo === 'catalogo' && sug.conversa.catalogo_formato === 'vesti';
  const tipoMidiaMsg = sug.tipo === 'primeira_mensagem'
    ? 'template'
    : (midiaParaEnviar && !ehVestiCatalogo
        ? (midiaParaEnviar.tipo === 'foto' ? 'image'
           : midiaParaEnviar.tipo === 'video' ? 'video' : 'document')
        : 'text');

  // Ailson 25/05/2026: salva URL publica da midia pra frontend mostrar miniatura
  let midiaUrlMsg = null;
  if (midiaParaEnviar?.storage_path && !ehVestiCatalogo) {
    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(midiaParaEnviar.storage_path);
    midiaUrlMsg = pub?.publicUrl || null;
  }
  // Ailson 03/07/2026: HSM _img — foto do header vira midia_url pro chat mostrar
  if (!midiaUrlMsg && headerMidiaPath) {
    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(headerMidiaPath);
    midiaUrlMsg = pub?.publicUrl || null;
  }

  const { data: msgRow, error: errMsg } = await supabase
    .from('lojas_whats_mensagens')
    .insert({
      conversa_id: sug.conversa.id,
      direcao: 'saida',
      autor: 'sofia_ia',
      tipo_midia: tipoMidiaMsg,
      texto: textoMsgPrincipal || textoFinal,
      midia_url: midiaUrlMsg,
      template_name: tplEnviadoReal || sug.template_name,
      template_vars: sug.template_vars,
      meta_message_id: metaMsgId,
      status: 'enviando',
      meta_response: metaResp,
      enviada_em: agora
    })
    .select('id')
    .single();
  if (errMsg) logErro('aprovar/insert-msg', errMsg);

  // Fotos extras do showcase (ex: 5 bodys) — grava 1 registro por foto pra TODAS
  // aparecerem no historico do painel (Ailson 16/06/2026). enviada_em incrementado
  // 1s por foto pra ordenar logo depois da principal.
  if (extrasEnviadas.length > 0) {
    const baseMs = Date.parse(agora);
    const linhasExtras = extrasEnviadas.map((ex, i) => {
      let url = null;
      if (ex.midia?.storage_path) {
        const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(ex.midia.storage_path);
        url = pub?.publicUrl || null;
      }
      return {
        conversa_id: sug.conversa.id,
        direcao: 'saida',
        autor: 'sofia_ia',
        tipo_midia: 'image',
        texto: null,
        midia_url: url,
        meta_message_id: ex.message_id || null,
        status: 'enviando',
        enviada_em: new Date(baseMs + (i + 1) * 1000).toISOString(),
      };
    });
    const { error: errExtras } = await supabase.from('lojas_whats_mensagens').insert(linhasExtras);
    if (errExtras) logErro('aprovar/insert-msg-extras', errExtras);
  }

  // Backfill: atualiza lojas_whats_midias_usos com mensagem_id real
  // (vesti nao envia midia, entao nao ha uso pra casar)
  if (midiaParaEnviar && !ehVestiCatalogo && msgRow?.id) {
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
  // Marcador OFERTA detectado → dispara timer pra aba Varejo (cron-varejo, 24h).
  if (setOfertaVarejo) updatesConv.oferta_varejo_em = agora;
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

// ─── HELPER: template_vars { "1":"Maria","2":"8" } → ["Maria","8"] ──────────
// Se `declaradas` (template.variables) vier, usa SOMENTE as chaves declaradas,
// na ordem declarada — evita enviar parâmetro a mais pra Meta. Sem `declaradas`,
// cai no comportamento antigo (todas as chaves, ordenadas).

function ordenarVarsTemplate(varsObj, declaradas) {
  if (!varsObj || typeof varsObj !== 'object') return [];
  if (Array.isArray(declaradas) && declaradas.length > 0) {
    return declaradas
      .map(d => String(d?.nome ?? ''))
      .filter(k => k)
      .map(k => String(varsObj[k] ?? ''));
  }
  // Fallback: ordena por chave numérica
  const keys = Object.keys(varsObj).sort((a, b) => Number(a) - Number(b));
  return keys.map(k => String(varsObj[k] ?? ''));
}
