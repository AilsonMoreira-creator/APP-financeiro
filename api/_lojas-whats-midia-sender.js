// ═══════════════════════════════════════════════════════════════════════════
// _lojas-whats-midia-sender.js — Parser de marcadores + envio real
// ═══════════════════════════════════════════════════════════════════════════
//
// Sofia gera texto com marcadores tipo [ENVIAR_FOTO:2655].
// Este helper:
//   1. Detecta marcadores no texto
//   2. Resolve cada um pra uma midia da biblioteca
//   3. Remove marcadores do texto
//   4. Devolve { textoLimpo, midiasParaEnviar: [...] }
//   5. enviarMidiasDaSofia(...) faz o envio real via Cloud API
//   6. Registra usos em lojas_whats_midias_usos pro aprendizado
//
// REGRAS (Ailson 26/05/2026):
//   - Maximo 1 midia por mensagem (regra dele)
//   - Se IA usar 2+ marcadores, pega o PRIMEIRO e ignora os outros
//
// Marcadores suportados:
//   [ENVIAR_FOTO:REF]       → tipo='foto', ref=REF
//   [ENVIAR_VIDEO:REF]      → tipo='video', ref=REF
//   [ENVIAR_CATALOGO:nome]  → tipo='catalogo', nome= match no nome_arquivo
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro } from './_lojas-whats-helpers.js';
import { uploadMidiaParaMeta, enviarMidia } from './_lojas-whats-meta-client.js';

const REGEX_MARCADOR = /\[ENVIAR_(FOTO|VIDEO|CATALOGO|CORES):\s*([^\]]+)\]/gi;

/**
 * Parse marcadores no texto.
 * Limita a 1 mídia (regra Ailson). Marcadores extras são descartados.
 */
export function parseMarcadoresMidia(texto) {
  if (!texto) return { textoLimpo: '', marcadores: [] };
  const marcadores = [];
  let textoLimpo = texto;

  let m;
  REGEX_MARCADOR.lastIndex = 0;
  while ((m = REGEX_MARCADOR.exec(texto)) !== null) {
    marcadores.push({
      tipo: m[1].toLowerCase(),  // foto | video | catalogo
      identificador: m[2].trim(),
      matchCompleto: m[0],
    });
  }

  // Remove TODOS marcadores do texto (mesmo se descartar alem do primeiro).
  // IMPORTANTE: preservar quebras de linha (paragrafos). O /\s+/g antigo
  // colapsava \n\n em 1 espaco -> a Sofia mandava tudo num bloco so, mesmo
  // sem marcador. Agora colapsa so espacos/tabs e limita a 1 linha em branco
  // entre paragrafos. Ailson 30/05/2026.
  textoLimpo = texto
    .replace(REGEX_MARCADOR, '')
    .replace(/[ \t]+/g, ' ')           // espacos/tabs repetidos -> 1 espaco (nao mexe em \n)
    .replace(/[ \t]*\n[ \t]*/g, '\n')  // tira espaco em volta das quebras
    .replace(/\n{3,}/g, '\n\n')        // no maximo 1 linha em branco entre paragrafos
    .trim();

  // Regra de midias (Ailson 16/06/2026):
  //  - catalogo/video: 1 por mensagem (pega o primeiro, ignora o resto)
  //  - fotos de modelo / cores: ate 5, com legenda (foto de cores leva
  //    cores+tamanhos na legenda embaixo). Ailson 28/06/2026.
  // Se houver QUALQUER catalogo/video, manda so o primeiro marcador (nao mistura).
  const temNaoFoto = marcadores.some(m => m.tipo !== 'foto' && m.tipo !== 'cores');
  const saida = temNaoFoto ? marcadores.slice(0, 1) : marcadores.slice(0, 5);
  return { textoLimpo, marcadores: saida };
}

/**
 * Resolve marcador -> midia da biblioteca.
 * Retorna null se nao encontrar.
 */
export async function resolverMidia(marcador) {
  const tipoMap = { foto: 'foto', video: 'video', catalogo: 'catalogo', cores: 'cores' };
  const tipo = tipoMap[marcador.tipo];
  if (!tipo) return null;

  // Pra foto/video: busca por ref. Pra catalogo: busca por nome_arquivo (partial).
  let qb = supabase
    .from('lojas_whats_midias')
    .select('id, tipo, ref, nome_arquivo, storage_path, mime_type, size_bytes, descricao')
    .eq('tipo', tipo)
    .eq('ativa', true)
    .limit(1);

  if (tipo === 'catalogo') {
    qb = qb.ilike('nome_arquivo', `%${marcador.identificador}%`);
  } else {
    qb = qb.eq('ref', marcador.identificador);
  }

  const { data } = await qb.maybeSingle();
  return data || null;
}

/**
 * Envia midia via WhatsApp Cloud API:
 *   1. Baixa binary do Supabase Storage (signed url)
 *   2. POST /media → media_id
 *   3. POST /messages com media_id (e caption opcional pra image/video)
 *
 * Tipos WhatsApp: image (foto), video (video), document (catalogo PDF)
 *
 * Retorna { ok, message_id, midia_id, erro }
 */
export async function enviarMidiaSofia({ telefone, midia, caption, conversaId, mensagemId, decididaPor }) {
  try {
    // 1. Baixa do Supabase
    const { data: blob, error: errDl } = await supabase.storage
      .from('sofia-midias')
      .download(midia.storage_path);
    if (errDl) throw new Error('storage download: ' + errDl.message);
    const buf = Buffer.from(await blob.arrayBuffer());

    // 2. Upload pra Meta
    const mediaId = await uploadMidiaParaMeta(buf, midia.mime_type, midia.nome_arquivo);

    // 3. Envia mensagem com media_id
    const tipoWaMap = { foto: 'image', video: 'video', catalogo: 'document', cores: 'image' };
    const tipoWa = tipoWaMap[midia.tipo];
    const payload = { id: mediaId };
    if (caption && (tipoWa === 'image' || tipoWa === 'video')) {
      payload.caption = caption;
    }
    if (tipoWa === 'document') {
      payload.filename = midia.nome_arquivo;
    }

    const resp = await enviarMidia(telefone, tipoWa, payload);

    // Carimba catalogo_enviado_em no CHOKEPOINT: vale pra QUALQUER caminho de
    // envio (IA aprovada, abertura/apresentacao, anexo manual, cron). Antes so o
    // aprovar.js marcava, entao catalogo enviado na apresentacao ou anexado a mao
    // ficava com catalogo_enviado_em NULL e os follow-ups 6h/24h nao disparavam.
    // Ailson 28/06/2026 (analise vendas: NULL em todas as conversas com PDF).
    if (midia.tipo === 'catalogo' && conversaId) {
      try {
        await supabase.from('lojas_whats_conversas').update({
          catalogo_enviado_em: new Date().toISOString(),
          catalogo_followup_6h_em: null,
        }).eq('id', conversaId);
      } catch (e) { logErro('midia-sender/stamp-catalogo', e); }
    }

    // 4. Registra uso pro aprendizado
    try {
      await supabase.from('lojas_whats_midias_usos').insert({
        midia_id: midia.id,
        conversa_id: conversaId,
        mensagem_id: mensagemId,
        decidida_por: decididaPor || 'ia_automatica',
        enviada_em: new Date().toISOString(),
      });

      // Incrementa contadores na midia
      const { data: midiaAtual } = await supabase.from('lojas_whats_midias')
        .select('enviada_count').eq('id', midia.id).maybeSingle();
      await supabase.from('lojas_whats_midias').update({
        enviada_count: (midiaAtual?.enviada_count || 0) + 1,
        ultima_enviada_em: new Date().toISOString(),
      }).eq('id', midia.id);
    } catch (e) {
      logErro('midia-sender/auditoria', e);
    }

    log('midia-sender', `enviada midia=${midia.id} tipo=${midia.tipo} message_id=${resp?.messages?.[0]?.id}`);
    return { ok: true, message_id: resp?.messages?.[0]?.id, midia_id: midia.id };
  } catch (e) {
    logErro('midia-sender/envio', e);
    return { ok: false, erro: e.message };
  }
}
