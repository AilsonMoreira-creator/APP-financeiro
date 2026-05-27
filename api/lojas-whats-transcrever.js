// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-transcrever — STT de audios de cliente via Whisper
// ═══════════════════════════════════════════════════════════════════════════
// POST { mensagem_id } — busca msg, baixa audio do midia_url (URL publica
// do Supabase Storage que o webhook ja salvou), envia pra Whisper API,
// salva audio_transcricao na tabela. Sofia IA consome automaticamente
// quando gera proxima sugestao (lojas-whats-ia.js ja le essa coluna).
//
// Disparado fire-and-forget pelo webhook lojas-whats. Nao bloqueia resposta
// pra Meta. Idempotente: se audio_transcricao ja existe, retorna sem
// chamar Whisper de novo (economiza credito).
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro } from './_lojas-whats-helpers.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';
const TIMEOUT_MS = 30000;  // 30s max pra evitar travar funcao

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { mensagem_id } = req.body || {};
    if (!mensagem_id) return res.status(400).json({ error: 'mensagem_id_obrigatorio' });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY nao configurada' });
    }

    // 1. Busca a msg + checa se ja foi transcrita (idempotencia)
    const { data: msg, error: errBusca } = await supabase
      .from('lojas_whats_mensagens')
      .select('id, tipo_midia, midia_url, audio_transcricao, conversa_id')
      .eq('id', mensagem_id)
      .maybeSingle();
    if (errBusca) throw errBusca;
    if (!msg) return res.status(404).json({ error: 'mensagem_nao_encontrada' });
    if (msg.tipo_midia !== 'audio') {
      return res.status(400).json({ error: 'msg_nao_eh_audio', tipo_atual: msg.tipo_midia });
    }
    if (msg.audio_transcricao) {
      return res.status(200).json({ ok: true, ja_transcrita: true, texto: msg.audio_transcricao });
    }
    if (!msg.midia_url || !msg.midia_url.startsWith('http')) {
      return res.status(400).json({ error: 'midia_url_invalida_ou_pendente' });
    }

    // 2. Baixa o audio do Supabase Storage (URL publica)
    const audioRes = await fetch(msg.midia_url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!audioRes.ok) {
      throw new Error(`download_audio_falhou status=${audioRes.status}`);
    }
    const audioBlob = await audioRes.blob();
    if (audioBlob.size === 0) throw new Error('audio_vazio');
    if (audioBlob.size > 25 * 1024 * 1024) {
      // Whisper limite = 25MB. Audio WhatsApp tipico = ~50KB-2MB, dificilmente passa.
      throw new Error(`audio_grande_demais size=${audioBlob.size}`);
    }

    // 3. Envia pra Whisper
    const form = new FormData();
    // Whisper precisa de filename com extensao reconhecida. WhatsApp manda .opus
    // dentro de container .ogg. 'audio.ogg' funciona pra Whisper detectar.
    form.append('file', audioBlob, 'audio.ogg');
    form.append('model', WHISPER_MODEL);
    form.append('language', 'pt');
    form.append('response_format', 'json');

    const whisperRes = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!whisperRes.ok) {
      const errTxt = await whisperRes.text().catch(() => '');
      throw new Error(`whisper_falhou status=${whisperRes.status} body=${errTxt.slice(0, 200)}`);
    }
    const whisperJson = await whisperRes.json();
    const texto = (whisperJson.text || '').trim();
    if (!texto) {
      log('transcrever', `audio msg=${mensagem_id} retornou vazio (silencio ou ruido)`);
      // Salva string especial pra Sofia nao tentar de novo + saber que tentou
      await supabase
        .from('lojas_whats_mensagens')
        .update({ audio_transcricao: '[audio inaudivel]' })
        .eq('id', mensagem_id);
      return res.status(200).json({ ok: true, texto: '[audio inaudivel]' });
    }

    // 4. Salva transcricao
    const { error: errUp } = await supabase
      .from('lojas_whats_mensagens')
      .update({ audio_transcricao: texto })
      .eq('id', mensagem_id);
    if (errUp) throw errUp;

    log('transcrever', `msg=${mensagem_id} (${texto.length}c) "${texto.slice(0, 50)}${texto.length > 50 ? '...' : ''}"`);
    return res.status(200).json({ ok: true, texto, tamanho: texto.length });
  } catch (e) {
    logErro('transcrever', e);
    return res.status(500).json({ error: e.message });
  }
}
