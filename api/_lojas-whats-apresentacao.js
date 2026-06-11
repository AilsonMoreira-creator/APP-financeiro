/**
 * _lojas-whats-apresentacao.js — Abertura com vídeo da Tamara (teste A/B).
 *
 * Pro grupo `apresentacao_grupo`, a PRIMEIRA resposta da Sofia é o vídeo de
 * apresentação (mídia ref "apresentação") com a legenda logo abaixo. Depois
 * disso o fluxo segue normal (Sofia oferece o catálogo ou o cliente pede).
 *
 * Chamado pelo cron-responder antes de gerar a réplica normal.
 */
import { supabase, getConfig, log } from './_lojas-whats-helpers.js';
import { enviarMidiaSofia } from './_lojas-whats-midia-sender.js';

function primeiroNome(nome) {
  // Inicial maiúscula, resto minúsculo (LUCIMARA → Lucimara). Ailson 11/06/2026.
  const p = String(nome || '').trim().split(/\s+/)[0] || '';
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '';
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
    autor: 'sofia_ia',
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
