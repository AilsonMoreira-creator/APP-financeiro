/**
 * bling-webhook-pedidos.js — Recebe os eventos de PEDIDO DE VENDA (order.*) e
 * NOTA FISCAL (invoice.*) do Bling v3 e espelha em wms_pedidos NA HORA — o
 * atendido/cancelado/NF autorizada chega por push, sem varredura.
 *
 * Desenho (22/08, pedido dele — "o Bling ficou lento com as chamadas"):
 *  - resposta 2xx em <5s SEMPRE (regra do Bling; senão re-tenta 3 dias e
 *    DESABILITA o webhook) → nada de chamada ao Bling aqui dentro; só banco.
 *  - idempotente por eventId (tabela bling_webhook_eventos, unique).
 *  - conta (exitus/lumia/muniam) APRENDIDA sozinha: o companyId do evento é
 *    casado com o pedido no espelho (que já sabe a conta) e memorizado.
 *  - seguranca: HMAC sha256 do Bling (X-Bling-Signature-256 + client secret)
 *    quando conferivel, + gate ?key= (mesmo padrao do webhook de estoque).
 *  - pedido NOVO (ainda fora do espelho) fica registrado como pendente — o
 *    sync existente continua criando a linha completa; aqui é o tempo real
 *    da SITUACAO, que é o que a fila de impressao consome.
 */
import crypto from 'crypto';
import { supabase } from './_bling-helpers.js';

export const config = { maxDuration: 10 };

async function lerRaw(req) {
  try {
    if (req.readable) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      if (chunks.length) return Buffer.concat(chunks).toString('utf8');
    }
  } catch { /* stream ja consumido */ }
  return null;
}

export default async function handler(req, res) {
  const respond = (obj) => res.status(200).json(obj);
  try {
    const secret = process.env.BLING_WEBHOOK_SECRET;
    if (secret && String(req.query.key || '') !== secret) return res.status(401).json({ error: 'unauthorized' });
    if (req.method !== 'POST') return respond({ ok: true, ignored: 'method' });

    const raw = await lerRaw(req);
    let body = req.body;
    if (!body && raw) { try { body = JSON.parse(raw); } catch { body = {}; } }
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    // HMAC oficial do Bling (melhor esforco: precisa do corpo cru)
    let hmacOk = null;
    const assinatura = String(req.headers['x-bling-signature-256'] || '');
    const clientSecret = process.env.BLING_CLIENT_SECRET || process.env.BLING_SECRET || '';
    if (assinatura && clientSecret) {
      const base = raw ?? JSON.stringify(body);
      const calc = 'sha256=' + crypto.createHmac('sha256', clientSecret).update(base, 'utf8').digest('hex');
      hmacOk = calc === assinatura;
    }

    const eventId = String(body.eventId || '');
    const evento = String(body.event || '');
    const companyId = String(body.companyId ?? '');
    const data = body.data || {};
    const recursoId = String(data.id ?? '');
    if (!evento || !recursoId) return respond({ ok: true, ignored: 'sem evento/id' });

    // idempotencia: evento repetido responde 200 e nao reaplica
    const { error: eIns } = await supabase.from('bling_webhook_eventos').insert({
      event_id: eventId || `${evento}:${recursoId}:${Date.now()}`,
      evento, company_id: companyId, recurso_id: recursoId,
      payload: body, detalhe: hmacOk === false ? 'hmac_nao_confere' : (hmacOk ? 'hmac_ok' : 'hmac_sem_base'),
    });
    if (eIns && /duplicate|unique/i.test(eIns.message)) return respond({ ok: true, duplicado: true });

    // resolve a CONTA: mapa aprendido -> pedido no espelho -> nf no espelho
    let conta = null;
    if (companyId) {
      const { data: m } = await supabase.from('bling_webhook_eventos')
        .select('conta').eq('company_id', companyId).not('conta', 'is', null).limit(1);
      conta = m?.[0]?.conta || null;
    }

    let aplicado = false; let detalhe = '';
    if (evento.startsWith('order.')) {
      const upd = { atualizado_em: new Date().toISOString() };
      const sitId = data?.situacao?.id ?? data?.idSituacao ?? data?.situacao;
      if (sitId != null && Number.isFinite(Number(sitId))) {
        upd.situacao_bling = Number(sitId);
        if (data?.situacao?.nome) upd.situacao_nome = String(data.situacao.nome).toLowerCase();
      }
      if (evento === 'order.deleted') { upd.status_wms = 'cancelado'; }
      const { data: linhas } = await supabase.from('wms_pedidos')
        .update(upd).eq('pedido_id', recursoId).select('conta, numero');
      if (linhas?.length) {
        aplicado = true; conta = conta || linhas[0].conta;
        detalhe = `pedido ${linhas[0].numero}: ${Object.keys(upd).filter(k => k !== 'atualizado_em').join(',') || 'toque'}`;
      } else detalhe = 'pedido fora do espelho (novo) — sync cria';
    } else if (evento.startsWith('invoice.') || evento.startsWith('consumer_invoice.')) {
      const upd = { nf_checado_em: new Date().toISOString() };
      const sitNf = data?.situacao?.id ?? data?.situacao;
      if (sitNf != null && Number.isFinite(Number(sitNf))) upd.nf_situacao = Number(sitNf);
      const { data: linhas } = await supabase.from('wms_pedidos')
        .update(upd).eq('nf_id', recursoId).select('conta, numero');
      if (linhas?.length) {
        aplicado = true; conta = conta || linhas[0].conta;
        detalhe = `nf do pedido ${linhas[0].numero}: sit ${upd.nf_situacao ?? '?'}`;
      } else detalhe = 'nf fora do espelho — sync cria';
    } else detalhe = 'evento nao tratado';

    // memoriza o par companyId->conta e o resultado (fora do caminho critico)
    supabase.from('bling_webhook_eventos')
      .update({ conta, aplicado, detalhe })
      .eq('event_id', eventId || '').then(() => {}, () => {});

    return respond({ ok: true, evento, aplicado });
  } catch (e) {
    // 200 mesmo em erro interno: o Bling nao pode desabilitar o webhook por
    // um soluço nosso — o evento fica na tabela pra reprocesso
    return respond({ ok: true, erro_interno: String(e?.message || e).slice(0, 120) });
  }
}
