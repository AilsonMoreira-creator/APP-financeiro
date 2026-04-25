/**
 * ml-messages-reply.js — Envia resposta pós-venda no ML
 */
import { supabase, getValidToken, setCors } from './_ml-helpers.js';

const ML_API = 'https://api.mercadolibre.com';

export default async function handler(req, res) {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const { conversation_id, text, sent_via = 'manual' } = req.body;
    if (!conversation_id || !text) return res.status(400).json({ error: 'Falta conversation_id ou text' });

    // Busca conversa
    const { data: conv, error: convErr } = await supabase
      .from('ml_conversations')
      .select('*')
      .eq('id', conversation_id)
      .single();

    if (convErr || !conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    const token = await getValidToken(conv.brand);

    // Sanitiza texto pra evitar 'Unexpected exception parsing json string' do ML:
    // 1. Converte quebras de linha (\n \r) e tabs em espaco. ML as vezes
    //    rejeita \n em text.plain de pos-venda. Preservar legibilidade
    //    convertendo em espaco eh mais seguro que remover (vira "você?Fico").
    // 2. Remove control chars que nao tem representacao textual.
    // 3. Remove zero-width chars (vem colado do clipboard, teclado emoji iOS).
    const textoLimpo = String(text)
      .replace(/\r\n/g, ' ').replace(/[\r\n\t]/g, ' ')   // line breaks -> space
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // outros control chars
      .replace(/[\u200B-\u200F\uFEFF]/g, '') // zero-width chars
      .replace(/ {2,}/g, ' ')                // colapsa espacos duplicados gerados
      .trim();

    if (!textoLimpo) {
      return res.status(400).json({ error: 'Texto vazio depois da limpeza' });
    }

    // user_id PRECISA ser STRING no body (com aspas) - documentacao ML PT-BR.
    // Erro 'Unexpected exception parsing json string' acontecia por enviar
    // Number em vez de String em user_id.
    // Ref: https://developers.mercadolivre.com.br/pt_br/mensagens-post-venda
    let sellerId = conv.seller_id;
    let buyerId  = conv.buyer_id;

    // FALLBACK (25/04): conversas antigas podem ter sido salvas sem seller_id
    // ou buyer_id (campos vazios/null). Em vez de bloquear, buscamos via API
    // ML pelo pack_id e auto-corrigimos no banco.
    const sellerVazio = !sellerId || String(sellerId).trim() === '';
    const buyerVazio  = !buyerId  || String(buyerId).trim() === '';

    if (sellerVazio || buyerVazio) {
      if (!conv.pack_id) {
        return res.status(500).json({
          error: 'seller_id/buyer_id ausentes E pack_id tambem - impossivel recuperar',
          conversation_id: conv.id,
        });
      }

      try {
        // Endpoint /packs/{pack_id}/sellers/{seller_id} retorna a conversa
        // completa com sender/receiver. Mas se seller_id ta vazio, primeiro
        // tenta /packs/{pack_id} que tambem expoe a info.
        const packRes = await fetch(
          `${ML_API}/packs/${conv.pack_id}` + (conv.seller_id ? `/sellers/${conv.seller_id}` : ''),
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (packRes.ok) {
          const packData = await packRes.json();
          // ML retorna estruturas diferentes em /packs/{id} vs /packs/{id}/sellers/{seller_id}.
          // Tentamos varios caminhos:
          const recoveredSeller = packData.seller_id
            || packData.seller?.id
            || packData.from?.user_id
            || conv.seller_id;
          const recoveredBuyer  = packData.buyer_id
            || packData.buyer?.id
            || packData.to?.user_id
            || conv.buyer_id;

          if (recoveredSeller && recoveredBuyer) {
            sellerId = recoveredSeller;
            buyerId  = recoveredBuyer;

            // Auto-corrige no banco pra nao precisar buscar de novo
            await supabase.from('ml_conversations').update({
              seller_id: String(recoveredSeller),
              buyer_id:  String(recoveredBuyer),
              updated_at: new Date().toISOString(),
            }).eq('id', conv.id);

            console.log('[ml-messages-reply] auto-corrigiu seller/buyer_id', {
              conversation_id: conv.id,
              pack_id: conv.pack_id,
              seller: recoveredSeller,
              buyer: recoveredBuyer,
            });
          }
        }
      } catch (recoverErr) {
        console.error('[ml-messages-reply] fallback API ML falhou:', recoverErr.message);
      }
    }

    // Se ainda assim continua faltando, ai sim retorna erro
    const sellerIdStr = String(sellerId || '').trim();
    const buyerIdStr  = String(buyerId  || '').trim();

    if (!sellerIdStr || !buyerIdStr) {
      return res.status(500).json({
        error: 'seller_id ou buyer_id ausente na conversa (e fallback API ML nao recuperou)',
        seller_id: conv.seller_id,
        buyer_id: conv.buyer_id,
        pack_id: conv.pack_id,
      });
    }

    const mlBody = {
      from: { user_id: sellerIdStr },
      to: { user_id: buyerIdStr },
      text: textoLimpo,
    };

    // Envia no ML (usa sellerIdStr que ja foi recuperado se preciso)
    const mlRes = await fetch(
      `${ML_API}/messages/packs/${conv.pack_id}/sellers/${sellerIdStr}?tag=post_sale`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(mlBody),
      }
    );

    if (!mlRes.ok) {
      const err = await mlRes.json().catch(() => ({}));
      // Log completo pro Vercel capturar a causa raiz
      console.error('[ml-messages-reply] ML API error:', {
        status: mlRes.status,
        pack_id: conv.pack_id,
        seller_id: conv.seller_id,
        buyer_id: conv.buyer_id,
        brand: conv.brand,
        conversation_id: conv.id,
        text_length: textoLimpo.length,
        body_sent: mlBody,
        error_body: err,
      });
      return res.status(mlRes.status).json({
        error: 'ML API error',
        status: mlRes.status,
        detail: err,
      });
    }

    const mlData = await mlRes.json();

    // Salva mensagem no Supabase (usando texto limpo, igual ao que foi enviado)
    const msgId = mlData.id || `sent_${Date.now()}`;
    await supabase.from('ml_messages').insert({
      conversation_id: conv.id,
      pack_id: conv.pack_id,
      message_id: String(msgId),
      brand: conv.brand,
      from_type: 'seller',
      from_id: conv.seller_id,
      text: textoLimpo,
      date_created: new Date().toISOString(),
      sent_via,
    });

    // Atualiza conversa
    await supabase.from('ml_conversations').update({
      last_message_text: textoLimpo,
      last_message_from: 'seller',
      last_message_at: new Date().toISOString(),
      unread_count: 0,
      updated_at: new Date().toISOString(),
    }).eq('id', conv.id);

    return res.json({ success: true, message_id: msgId });
  } catch (err) {
    console.error('[ml-messages-reply]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
