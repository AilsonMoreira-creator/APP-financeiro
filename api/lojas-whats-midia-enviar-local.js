// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-midia-enviar-local.js — Envia foto do dispositivo SEM guardar
// na biblioteca. Ailson 04/06/2026.
// ═══════════════════════════════════════════════════════════════════════════
//
// Fluxo (frontend):
//   1. presign (tipo='foto') -> uploadUrl + storage_path
//   2. PUT direto no storage (bucket sofia-midias)
//   3. POST aqui { conversa_id, storage_path, mime_type, nome_arquivo, texto? }
//
// Aqui: baixa do storage, sobe pra Meta, envia na conversa e registra a msg.
// NAO cria item em lojas_whats_midias (nao polui a biblioteca). O arquivo
// fica no storage so pra ter miniatura no chat.
//
// POST body: {
//   conversa_id, storage_path, mime_type, nome_arquivo,
//   texto?,                 // caption opcional (vai junto da foto)
//   autor?,                 // 'assistente' (default)
//   usuario?                // audit
// }
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro } from './_lojas-whats-helpers.js';
import { uploadMidiaParaMeta, enviarMidia } from './_lojas-whats-meta-client.js';

const MAX_BYTES = 5 * 1024 * 1024;  // limite imagem WhatsApp Cloud API

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST esperado' });

  try {
    const { conversa_id, storage_path, mime_type, nome_arquivo, texto, autor = 'assistente', usuario } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id obrigatorio' });
    if (!storage_path) return res.status(400).json({ error: 'storage_path obrigatorio' });
    if (!mime_type || !mime_type.startsWith('image/')) {
      return res.status(415).json({ error: 'so foto (image/*) por aqui' });
    }

    // Carrega conversa
    const { data: conv } = await supabase.from('lojas_whats_conversas')
      .select('id, telefone, etapa').eq('id', conversa_id).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'conversa nao encontrada' });
    if (!conv.telefone) return res.status(400).json({ error: 'conversa sem telefone valido' });

    // Baixa do storage (o frontend ja subiu via presign)
    const { data: blob, error: errDl } = await supabase.storage
      .from('sofia-midias')
      .download(storage_path);
    if (errDl) return res.status(404).json({ error: 'arquivo nao encontrado no storage: ' + errDl.message });
    const buf = Buffer.from(await blob.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: 'foto acima de 5MB (limite do WhatsApp)' });
    }

    // Sobe pra Meta e envia
    let metaResp, metaMsgId;
    try {
      const mediaId = await uploadMidiaParaMeta(buf, mime_type, nome_arquivo || 'foto.jpg');
      const payload = { id: mediaId };
      const cap = (texto || '').trim();
      if (cap) payload.caption = cap;
      metaResp = await enviarMidia(conv.telefone, 'image', payload);
      metaMsgId = metaResp?.messages?.[0]?.id || null;
    } catch (e) {
      logErro('midia-enviar-local/meta', e);
      return res.status(502).json({ error: 'envio_meta_falhou: ' + e.message });
    }

    // URL publica pro chat mostrar a miniatura
    let midiaUrlMsg = null;
    try {
      const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(storage_path);
      midiaUrlMsg = pub?.publicUrl || null;
    } catch { /* sem url, segue */ }

    const agora = new Date().toISOString();
    const { data: msgRow, error: errIns } = await supabase
      .from('lojas_whats_mensagens')
      .insert({
        conversa_id,
        direcao: 'saida',
        autor,
        enviada_modo: 'manual',
        enviada_login: usuario || null,
        tipo_midia: 'image',
        texto: (texto || '').trim() || null,
        midia_url: midiaUrlMsg,
        meta_message_id: metaMsgId,
        status: 'enviando',
        meta_response: metaResp,
        enviada_em: agora,
      })
      .select('id').single();
    if (errIns) logErro('midia-enviar-local/insert', errIns);

    // Atualiza atividade da conversa (paridade com mensagem-enviar)
    await supabase.from('lojas_whats_conversas')
      .update({ ultima_atividade_em: agora, atualizado_em: agora })
      .eq('id', conversa_id);

    log('midia-enviar-local', `conv=${conversa_id} foto local enviada por ${usuario || autor} msg=${msgRow?.id}`);
    return res.json({ ok: true, message_id: metaMsgId, mensagem_id: msgRow?.id || null });
  } catch (e) {
    logErro('midia-enviar-local', e);
    return res.status(500).json({ error: e.message });
  }
}
