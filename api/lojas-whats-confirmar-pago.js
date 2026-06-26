// lojas-whats-confirmar-pago.js — Confirma pagamento de um lead da etapa "atendida"
//
// Fluxo (botao "confirmar pago" no card, modal de valor):
//   1. Grava vendeu_valor + move o card pra etapa "vendeu"
//   2. Se a origem for anuncio Meta (facebook/instagram) OU houver ctwa_clid,
//      dispara o evento Purchase pra Meta (CAPI) pra campanha aprender.
//      Reaproveita dispararPurchase() (idempotente — nao envia 2x).
//
// POST body: { conversa_id, valor, usuario? }
// Resposta : { ok, etapa:'vendeu', valor, capi:{status,...} }

import { supabase, setCors, log, logErro } from './_lojas-whats-helpers.js';
import { dispararPurchase } from './lojas-whats-meta-capi-purchase.js';

// origens que representam venda vinda de anuncio Meta (manda CAPI)
const ORIGENS_META = new Set(['anuncio_facebook', 'anuncio_instagram']);

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    const { conversa_id, valor, usuario } = req.body || {};
    if (!conversa_id) return res.status(400).json({ error: 'conversa_id obrigatorio' });

    const valorNum = Number(valor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      return res.status(400).json({ error: 'valor invalido (precisa ser > 0)' });
    }

    // 1. Carrega a conversa
    const { data: conv, error: e1 } = await supabase
      .from('lojas_whats_conversas')
      .select('id, etapa, origem_lead, ctwa_clid, nome_cliente')
      .eq('id', conversa_id)
      .single();
    if (e1 || !conv) return res.status(404).json({ error: 'conversa nao encontrada' });

    // 2. Grava venda + move pra "vendeu"
    const agora = new Date().toISOString();
    const { error: e2 } = await supabase
      .from('lojas_whats_conversas')
      .update({
        etapa: 'vendeu',
        vendeu_em: agora,
        vendeu_valor: valorNum,
        vendeu_canal: 'manual_sofia',
        unread_count: 0,
        ultima_atividade_em: agora,
        atualizado_em: agora,
      })
      .eq('id', conversa_id);
    if (e2) {
      logErro('confirmar-pago/update', e2);
      return res.status(500).json({ error: 'falha ao gravar a venda' });
    }

    log('confirmar-pago',
      `conv=${conversa_id} valor=R$${valorNum} por=${usuario || '?'} origem=${conv.origem_lead || '?'}`);

    // 3. CAPI Purchase — so pra venda de anuncio Meta (ou que tenha ctwa_clid)
    let capi = { status: 'nao_aplicavel' };
    const ehMeta = ORIGENS_META.has(conv.origem_lead) || !!conv.ctwa_clid;
    if (ehMeta) {
      try {
        capi = await dispararPurchase({
          conversa_id,
          venda_info: { valor: valorNum },
          tipo_match: 'manual_confirmar_pago',
        });
      } catch (err) {
        logErro('confirmar-pago/capi', err);
        capi = { status: 'falhou', erro: String(err?.message || err) };
      }
    }

    return res.status(200).json({ ok: true, etapa: 'vendeu', valor: valorNum, capi });
  } catch (err) {
    logErro('confirmar-pago', err);
    return res.status(500).json({ error: 'erro_interno' });
  }
}
