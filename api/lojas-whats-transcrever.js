// ═══════════════════════════════════════════════════════════════════════════
// /api/lojas-whats-transcrever — STT de audios de cliente via Whisper
// ═══════════════════════════════════════════════════════════════════════════
// Expoe transcreverAudio(mensagem_id) — chamada IN-PROCESS pelo webhook
// (sem hop HTTP fragil entre funcoes Vercel, que estava falhando) e tambem
// pelo handler HTTP (retry manual / backfill). Idempotente: se ja tem
// audio_transcricao, retorna sem chamar Whisper de novo.
//
// Sofia IA consome audio_transcricao automaticamente (lojas-whats-ia.js).
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, log, logErro } from './_lojas-whats-helpers.js';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-1';
const TIMEOUT_MS = 30000;  // 30s max por etapa

// Core reutilizavel. Retorna { ok, texto?, erro?, ja_transcrita? }.
export async function transcreverAudio(mensagem_id) {
  if (!mensagem_id) return { ok: false, erro: 'mensagem_id_obrigatorio' };
  if (!process.env.OPENAI_API_KEY) return { ok: false, erro: 'OPENAI_API_KEY nao configurada' };

  const { data: msg, error: errBusca } = await supabase
    .from('lojas_whats_mensagens')
    .select('id, tipo_midia, midia_url, audio_transcricao, conversa_id')
    .eq('id', mensagem_id)
    .maybeSingle();
  if (errBusca) return { ok: false, erro: errBusca.message };
  if (!msg) return { ok: false, erro: 'mensagem_nao_encontrada' };
  if (msg.tipo_midia !== 'audio') return { ok: false, erro: 'msg_nao_eh_audio' };
  if (msg.audio_transcricao) return { ok: true, texto: msg.audio_transcricao, ja_transcrita: true };
  if (!msg.midia_url || !msg.midia_url.startsWith('http')) return { ok: false, erro: 'midia_url_invalida_ou_pendente' };

  // 1. Baixa o audio do Supabase Storage (URL publica)
  const audioRes = await fetch(msg.midia_url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!audioRes.ok) return { ok: false, erro: `download_audio_falhou status=${audioRes.status}` };
  const audioBlob = await audioRes.blob();
  if (audioBlob.size === 0) return { ok: false, erro: 'audio_vazio' };
  if (audioBlob.size > 25 * 1024 * 1024) return { ok: false, erro: `audio_grande_demais size=${audioBlob.size}` };

  // 2. Envia pra Whisper
  const form = new FormData();
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
    return { ok: false, erro: `whisper_falhou status=${whisperRes.status} body=${errTxt.slice(0, 200)}` };
  }
  const whisperJson = await whisperRes.json();
  const texto = (whisperJson.text || '').trim();

  if (!texto) {
    // Salva marcador pra nao re-tentar infinito
    await supabase
      .from('lojas_whats_mensagens')
      .update({ audio_transcricao: '[audio inaudivel]' })
      .eq('id', mensagem_id);
    log('transcrever', `audio msg=${mensagem_id} vazio (silencio/ruido)`);
    return { ok: true, texto: '[audio inaudivel]' };
  }

  const { error: errUp } = await supabase
    .from('lojas_whats_mensagens')
    .update({ audio_transcricao: texto })
    .eq('id', mensagem_id);
  if (errUp) return { ok: false, erro: errUp.message };

  log('transcrever', `msg=${mensagem_id} (${texto.length}c) "${texto.slice(0, 50)}${texto.length > 50 ? '...' : ''}"`);
  return { ok: true, texto, tamanho: texto.length };
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { mensagem_id } = req.body || {};
    const r = await transcreverAudio(mensagem_id);
    if (!r.ok) {
      const code = r.erro === 'mensagem_nao_encontrada' ? 404
        : r.erro === 'mensagem_id_obrigatorio' ? 400 : 500;
      return res.status(code).json({ error: r.erro });
    }
    return res.status(200).json(r);
  } catch (e) {
    logErro('transcrever', e);
    return res.status(500).json({ error: e.message });
  }
}
