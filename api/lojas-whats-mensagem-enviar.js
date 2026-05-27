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
    const { conversa_id, texto, midia_id, autor = 'assistente', usuario, vendedora_id } = req.body || {};
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

    // PARSER MARCADORES VAREJO: Sofia usa [OFERTA_VAREJO] ou [OFERTA_UPGRADE]
    // no inicio quando oferece +R$30 (3-7 pecas) ou upgrade 1-2 -> 3 pecas.
    // Backend remove o marcador antes de enviar pro cliente e seta o timer
    // oferta_varejo_em. Cron monitora: 24h sem resposta -> etapa='varejo'.
    let setOfertaVarejo = false;
    const matchOferta = textoLimpo.match(/^\s*\[(OFERTA_VAREJO|OFERTA_UPGRADE)\]\s*/i);
    if (matchOferta) {
      setOfertaVarejo = true;
      textoLimpo = textoLimpo.replace(matchOferta[0], '').trim();
    }

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
    // Ailson 25/05/2026: gera URL publica da midia (se tiver) e salva no
    // campo midia_url da mensagem. Sem isso, frontend nao mostra miniatura.
    let midiaUrlMsg = null;
    if (midiaFinal?.storage_path) {
      const { data: pub } = supabase.storage.from('sofia-midias').getPublicUrl(midiaFinal.storage_path);
      midiaUrlMsg = pub?.publicUrl || null;
    }
    const { data: msgRow, error: errIns } = await supabase
      .from('lojas_whats_mensagens')
      .insert({
        conversa_id,
        direcao: 'saida',
        autor,
        tipo_midia: tipoMidiaMsg,
        texto: textoLimpo || null,
        midia_url: midiaUrlMsg,
        meta_message_id: metaMsgId,
        enviada_por_vendedora_id: vendedora_id || null,
        status: 'enviando',
        meta_response: metaResp,
        enviada_em: agora,
      })
      .select('id').single();
    if (errIns) logErro('msg-enviar/db', errIns);

    // Atualiza atividade conversa
    const updConv = { ultima_atividade_em: agora, atualizado_em: agora };
    if (setOfertaVarejo) {
      // Marcador [OFERTA_VAREJO] ou [OFERTA_UPGRADE] detectado e removido:
      // dispara timer de 24h. Cron monitora — se cliente nao responder em
      // 24h, move conversa pra etapa='varejo'. Webhook (msg-buyer) reseta
      // esse campo qdo cliente responder qualquer coisa.
      updConv.oferta_varejo_em = agora;
      log('msg-enviar', `conversa=${conversa_id} OFERTA detectada → oferta_varejo_em=${agora}`);
    }
    await supabase.from('lojas_whats_conversas').update(updConv).eq('id', conversa_id);

    log('msg-enviar', `conversa=${conversa_id} autor=${autor} midia=${midiaFinal?.id || 'no'}`);
    return res.json({ ok: true, message_id: metaMsgId, mensagem_id: msgRow?.id });
  } catch (e) {
    console.error('[msg-enviar] exception:', e);
    return res.status(500).json({ error: e.message });
  }
}
