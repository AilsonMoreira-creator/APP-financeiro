/**
 * _lojas-whats-apresentacao.js — Abertura com vídeo da Tamara (teste A/B).
 *
 * Pro grupo `apresentacao_grupo`, a PRIMEIRA resposta da Sofia é o vídeo de
 * apresentação (mídia ref "apresentação") com a legenda logo abaixo. Depois
 * disso o fluxo segue normal (Sofia oferece o catálogo ou o cliente pede).
 *
 * Chamado pelo cron-responder antes de gerar a réplica normal.
 */
import { supabase, getConfig, log, logErro, primeiroNome } from './_lojas-whats-helpers.js';
import { enviarMidiaSofia } from './_lojas-whats-midia-sender.js';
import { enviarTexto } from './_lojas-whats-meta-client.js';

// primeiroNome agora vem do _lojas-whats-helpers.js já sanitizado (remove
// emoji/símbolos; nome só emoji vira ''). Ailson 02/07/2026.

function saudacaoBRT() {
  // Hora em BRT (UTC-3) sem depender do TZ do servidor
  const h = (new Date().getUTCHours() + 21) % 24;
  if (h < 12) return 'bom dia';
  if (h < 18) return 'boa tarde';
  return 'boa noite';
}

/**
 * Abertura TEXTO + FOTOS (braço B do A/B — Ailson 11/06/2026):
 * 1ª mensagem: texto curto do atacado (config apresentacao_texto_msg).
 * Na sequência: as fotos ativas com ref='abertura' (as 4 que o Ailson subiu
 * nas Mídias — troca de foto = só retaguear no módulo Mídias).
 * Depois disso a Sofia espera a interação e segue o fluxo normal.
 */
export async function enviarAberturaTextoFotos(conversaId, telefone, nomeCliente) {
  // 1) texto curto (config editável; {nome} e {saudacao} são placeholders)
  const tpl = await getConfig(
    'apresentacao_texto_msg',
    'Oii {nome}, {saudacao}!!\n\nNosso atacado são 12 peças, pode misturar os modelos à vontade'
  );
  const nome = primeiroNome(nomeCliente);
  let texto = String(tpl).replace('{nome}', nome).replace('{saudacao}', saudacaoBRT());
  texto = texto.replace(/\bOii\s+,/, 'Oii,').replace(/[ \t]{2,}/g, ' ').trim();

  let r;
  try {
    r = await enviarTexto(telefone, texto);
  } catch (e) {
    return { ok: false, erro: 'envio_texto_falhou: ' + e.message };
  }
  await supabase.from('lojas_whats_mensagens').insert({
    conversa_id: conversaId,
    direcao: 'saida',
    autor: 'sofia_ia', enviada_modo: 'auto', enviada_login: null,
    tipo_midia: 'texto',
    texto,
    meta_message_id: r?.messages?.[0]?.id || null,
    status: 'enviando',
    enviada_em: new Date().toISOString(),
  });

  // 2) fotos da abertura (ref='abertura', ativas, ordem do nome: 1.jpg, 2.jpg…)
  const { data: fotos } = await supabase
    .from('lojas_whats_midias')
    .select('*')
    .eq('tipo', 'foto')
    .eq('ativa', true)
    .eq('ref', 'abertura')
    .order('nome_arquivo', { ascending: true });
  let fotosOk = 0;
  for (const midia of (fotos || [])) {
    try {
      const rm = await enviarMidiaSofia({
        telefone, midia, caption: null, conversaId,
        mensagemId: null, decididaPor: 'apresentacao_texto_fotos',
      });
      if (!rm.ok) { logErro('apresentacao-fotos', new Error(rm.erro || 'falha')); continue; }
      let midiaUrl = null;
      try {
        const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(midia.storage_path);
        midiaUrl = pub?.publicUrl || null;
      } catch {}
      await supabase.from('lojas_whats_mensagens').insert({
        conversa_id: conversaId,
        direcao: 'saida',
        autor: 'sofia_ia', enviada_modo: 'auto', enviada_login: null,
        tipo_midia: 'image',
        texto: null,
        midia_url: midiaUrl,
        meta_message_id: rm.message_id || null,
        status: 'enviando',
        enviada_em: new Date().toISOString(),
      });
      fotosOk++;
    } catch (e) {
      logErro('apresentacao-fotos', e);
    }
  }

  log('apresentacao', `conversa=${conversaId} abertura texto+fotos enviada (${fotosOk} fotos)`);
  return { ok: true, fotos: fotosOk };
}

export async function enviarAberturaApresentacao(conversaId, telefone, nomeCliente) {
  // 1) pega o vídeo de apresentação ativo (ref "apresentação")
  const { data: midia } = await supabase
    .from('lojas_whats_midias')
    .select('*')
    .eq('tipo', 'video')
    .eq('ativa', true)
    .ilike('ref', 'apresenta%')
    .order('criada_em', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!midia) return { ok: false, erro: 'midia_apresentacao_nao_encontrada' };

  // 2) monta a legenda (config editável; {nome} = primeiro nome, sem nome some)
  const tpl = await getConfig('apresentacao_msg', 'Oii {nome} vídeo rapidinho da Tamara com algumas informações');
  const nome = primeiroNome(nomeCliente);
  let caption = String(tpl).replace('{nome}', nome);
  caption = caption.replace(/\bOii\s+,/, 'Oii,').replace(/\s{2,}/g, ' ').trim();

  // 3) envia o vídeo COM a legenda (1 mensagem; legenda aparece logo abaixo)
  const r = await enviarMidiaSofia({
    telefone,
    midia,
    caption,
    conversaId,
    mensagemId: null,
    decididaPor: 'apresentacao_auto',
  });
  if (!r.ok) return { ok: false, erro: r.erro || 'envio_video_falhou' };

  // 4) registra a mensagem de saída (pro chat mostrar + ultima_msg_direcao)
  let midiaUrl = null;
  try {
    const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(midia.storage_path);
    midiaUrl = pub?.publicUrl || null;
  } catch {}
  await supabase.from('lojas_whats_mensagens').insert({
    conversa_id: conversaId,
    direcao: 'saida',
    autor: 'sofia_ia', enviada_modo: 'auto', enviada_login: null,
    tipo_midia: 'video',
    texto: caption,
    midia_url: midiaUrl,
    meta_message_id: r.message_id || null,
    status: 'enviando',
    enviada_em: new Date().toISOString(),
  });

  log('apresentacao', `conversa=${conversaId} abertura com vídeo enviada`);
  return { ok: true };
}
