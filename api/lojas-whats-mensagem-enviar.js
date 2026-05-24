// ═══════════════════════════════════════════════════════════════════════════
// lojas-whats-mensagem-enviar.js — Assistente envia msg manual via Sofia
// ═══════════════════════════════════════════════════════════════════════════
//
// Permite a assistente HUMANA mandar uma mensagem direta na conversa
// (sem passar pela Sofia/IA gerar). Útil quando precisa intervir
// rapidamente ou enviar algo personalizado.
//
// POST body: {
//   conversa_id,
//   texto,                  // pode conter marcadores [ENVIAR_FOTO:X] etc
//   midia_id?,              // opcional, anexa midia DA BIBLIOTECA pelo ID
//   autor?                  // 'assistente' (default) | 'sofia_ia'
//   usuario?                // nome de quem enviou (audit)
// }
//
// Ailson 26/05/2026
// ═══════════════════════════════════════════════════════════════════════════

import { supabase, setCors, log, logErro } from './_lojas-whats-helpers.js';
import { enviarTexto } from './_lojas-whats-meta-client.js';
import { parseMarcadoresMidia, resolverMidia, enviarMidiaSofia } from './_lojas-whats-midia-sender.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST esperado' });

  try {
    const { conversa_id, texto, midia_id, autor = 'assistente', usuario } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id obrigatorio' });
    if (!texto && !midia_id) return res.status(400).json({ error: 'texto ou midia_id obrigatorio' });

    // Carrega conversa
    const { data: conv } = await supabase.from('lojas_whats_conversas')
      .select('id, telefone, etapa').eq('id', conversa_id).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'conversa nao encontrada' });
    if (!conv.telefone) return res.status(400).json({ error: 'conversa sem telefone valido' });

    // PARSER MIDIAS no texto (assistente pode usar [ENVIAR_FOTO:X])
    let textoLimpo = texto || '';
    let midiaFinal = null;

    if (midia_id) {
      // midia escolhida explicitamente
      const { data: m } = await supabase.from('lojas_whats_midias')
        .select('id, tipo, ref, nome_arquivo, storage_path, mime_type, size_bytes, descricao')
        .eq('id', midia_id).eq('ativa', true).maybeSingle();
      if (!m) return res.status(404).json({ error: 'midia_id invalido' });
      midiaFinal = m;
    } else if (texto) {
      const parsed = parseMarcadoresMidia(texto);
      textoLimpo = parsed.textoLimpo;
      if (parsed.marcadores.length > 0) {
        midiaFinal = await resolverMidia(parsed.marcadores[0]);
      }
    }

    // Envia via Meta
    let metaResp = null;
    let metaMsgId = null;
    let tipoMidiaMsg = 'text';

    try {
      if (midiaFinal && (midiaFinal.tipo === 'foto' || midiaFinal.tipo === 'video')) {
        const r = await enviarMidiaSofia({
          telefone: conv.telefone,
          midia: midiaFinal,
          caption: textoLimpo,
          conversaId: conv.id,
          decididaPor: 'assistente_anexou',
        });
        if (!r.ok) throw new Error(r.erro || 'envio_midia_falhou');
        metaResp = { messages: [{ id: r.message_id }] };
        tipoMidiaMsg = midiaFinal.tipo === 'foto' ? 'image' : 'video';
      } else {
        if (textoLimpo) {
          metaResp = await enviarTexto(conv.telefone, textoLimpo);
        }
        if (midiaFinal && midiaFinal.tipo === 'catalogo') {
          // catalogo separado
          await enviarMidiaSofia({
            telefone: conv.telefone, midia: midiaFinal,
            conversaId: conv.id, decididaPor: 'assistente_anexou',
          });
          tipoMidiaMsg = 'document';
        }
      }
      metaMsgId = metaResp?.messages?.[0]?.id || null;
    } catch (e) {
      logErro('msg-enviar/meta', e);
      return res.status(502).json({ error: 'envio_meta_falhou: ' + e.message });
    }

    // Persiste mensagem
    const agora = new Date().toISOString();
    const { data: msgRow, error: errIns } = await supabase
      .from('lojas_whats_mensagens')
      .insert({
        conversa_id,
        direcao: 'saida',
        autor,
        tipo_midia: tipoMidiaMsg,
        texto: textoLimpo || null,
        meta_message_id: metaMsgId,
        status: 'enviando',
        meta_response: metaResp,
        enviada_em: agora,
      })
      .select('id').single();
    if (errIns) logErro('msg-enviar/db', errIns);

    // Atualiza atividade conversa
    await supabase.from('lojas_whats_conversas').update({
      ultima_atividade_em: agora, atualizado_em: agora,
    }).eq('id', conversa_id);

    log('msg-enviar', `conversa=${conversa_id} autor=${autor} midia=${midiaFinal?.id || 'no'}`);
    return res.json({ ok: true, message_id: metaMsgId, mensagem_id: msgRow?.id });
  } catch (e) {
    console.error('[msg-enviar] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
