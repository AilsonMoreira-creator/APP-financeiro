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

      // Tenta DOIS endpoints diferentes:
      // 1. /packs/{pack_id} - estrutura de mensagens
      // 2. /orders/{pack_id} - em ML, pack_id geralmente == order_id em pos-venda
      // Se um falhar, tenta o outro. Loga JSON cru pra debug.
      let recoveredSeller = null;
      let recoveredBuyer = null;
      const tentativasLog = [];

      const endpoints = [
        // Se ja temos seller_id, usa endpoint mais especifico:
        ...(conv.seller_id ? [`${ML_API}/packs/${conv.pack_id}/sellers/${conv.seller_id}`] : []),
        // Generico:
        `${ML_API}/packs/${conv.pack_id}`,
        // Em ML pos-venda, pack_id frequentemente == order_id:
        `${ML_API}/orders/${conv.pack_id}`,
      ];

      for (const url of endpoints) {
        if (recoveredSeller && recoveredBuyer) break;
        try {
          const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          const body = await r.json().catch(() => ({}));
          tentativasLog.push({ url, status: r.status, keys: Object.keys(body || {}).slice(0, 20) });

          if (!r.ok) continue;

          // Tenta MUITOS caminhos possiveis (ML retorna estruturas diferentes
          // em /packs vs /orders vs /packs/sellers):
          const trySeller = body.seller_id
            || body.seller?.id
            || body.from?.user_id
            || body.user_id
            || body.order?.seller?.id
            || body.pack?.seller_id
            || body.messages?.[0]?.from?.user_id
            || body.messages?.[0]?.to?.user_id;

          const tryBuyer = body.buyer_id
            || body.buyer?.id
            || body.to?.user_id
            || body.order?.buyer?.id
            || body.pack?.buyer_id
            || body.messages?.[0]?.from?.user_id  // pode ser inverso
            || body.messages?.[0]?.to?.user_id;

          if (!recoveredSeller && trySeller) recoveredSeller = trySeller;
          if (!recoveredBuyer && tryBuyer && tryBuyer !== recoveredSeller) recoveredBuyer = tryBuyer;

          // Se conseguiu ambos, da pra parar
          if (recoveredSeller && recoveredBuyer) {
            tentativasLog.push({ sucesso: true, url_que_resolveu: url });
            break;
          }
        } catch (e) {
          tentativasLog.push({ url, erro: e.message });
        }
      }

      // Log estruturado: vai aparecer no Vercel pra debug se ainda falhar
      console.log('[ml-messages-reply] fallback API ML', {
        conversation_id: conv.id,
        pack_id: conv.pack_id,
        seller_original: conv.seller_id,
        buyer_original: conv.buyer_id,
        recoveredSeller,
        recoveredBuyer,
        tentativas: tentativasLog,
      });

      if (recoveredSeller && recoveredBuyer) {
        sellerId = recoveredSeller;
        buyerId  = recoveredBuyer;

        // Auto-corrige no banco pra nao precisar buscar de novo
        await supabase.from('ml_conversations').update({
          seller_id: String(recoveredSeller),
          buyer_id:  String(recoveredBuyer),
          updated_at: new Date().toISOString(),
        }).eq('id', conv.id);
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

      // Detecta erros de negocio do ML e devolve mensagem amigavel pro usuario
      // em vez do codigo cru. Esses NAO sao bugs do app - sao regras do ML.
      const errMsg = String(err.message || err.error || '').toLowerCase();
      let mensagemAmigavel = null;

      if (errMsg.includes('blocked_by_mediation') || errMsg.includes('mediation')) {
        mensagemAmigavel = 'Conversa em Mediacao no ML - mensagens diretas estao bloqueadas. Responda pelo painel de Mediacoes do Mercado Livre.';
      } else if (errMsg.includes('conversation_closed') || errMsg.includes('closed')) {
        mensagemAmigavel = 'Conversa ja foi fechada pelo ML (passou do prazo de resposta ou foi encerrada).';
      } else if (errMsg.includes('blocked') && errMsg.includes('user')) {
        mensagemAmigavel = 'Comprador bloqueou ou foi bloqueado - nao da pra enviar mensagem.';
      } else if (mlRes.status === 403) {
        mensagemAmigavel = 'Sem permissao pra enviar mensagem nessa conversa (token expirou ou conversa nao pertence a essa conta).';
      } else if (mlRes.status === 429) {
        mensagemAmigavel = 'Limite de mensagens ML estourado - aguarde alguns minutos.';
      }

      return res.status(mlRes.status).json({
        error: mensagemAmigavel || 'Erro do Mercado Livre',
        codigo_ml: errMsg || `HTTP ${mlRes.status}`,
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
