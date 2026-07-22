/**
 * bling-estoque-webhook.js — Recebe o callback "Alteração de estoque" do Bling
 * (evento stock.updated) e atualiza public.bling_estoque em tempo real.
 *
 * Segurança:
 *  - gate por ?key= (env BLING_WEBHOOK_SECRET);
 *  - em vez de confiar no saldo do payload, RE-CONSULTA o saldo real do depósito
 *    Geral na API do Bling pro produto que mudou. Assim o endpoint é à prova de
 *    injeção (só reflete o valor verdadeiro do Bling) e só mexe em refs já
 *    mapeadas em bling_estoque (ou seja, refs da calculadora).
 *
 * Responde 2xx sempre que possível (Bling exige <5s; senão re-tenta e, ao fim,
 * desabilita o webhook).
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 10 };
const API = 'https://api.bling.com.br/Api/v3';
const CONTA = 'exitus';

export default async function handler(req, res) {
  const respond = (obj) => res.status(200).json(obj);
  try {
    // auth por segredo na URL
    const secret = process.env.BLING_WEBHOOK_SECRET;
    if (secret && String(req.query.key || '') !== secret) return res.status(401).json({ error: 'unauthorized' });

    if (req.method !== 'POST') return respond({ ok: true, ignored: 'method' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    // Só estoque físico. Estoque virtual herda config mas não deve duplicar aqui.
    const evento = String(body.event || '');
    if (evento.includes('virtual')) return respond({ ok: true, ignored: 'virtual_stock', evento });

    const data = body.data || body; // envelope {…, data} ou payload direto
    const produtoId = String(data?.produto?.id ?? data?.id ?? data?.idProduto ?? data?.estoque?.produto?.id ?? data?.produtoId ?? '');
    const codigo = String(data?.produto?.codigo ?? data?.codigo ?? data?.sku ?? '');
    if (!produtoId && !codigo) return respond({ ok: true, ignored: 'sem produto id/codigo', produtoId, codigo });

    // Só age em produto que já rastreamos (refs da calculadora em bling_estoque)
    let q = supabase.from('bling_estoque').select('ref,cor_norm,tam,cor_label,qtd,qtd_lumia,qtd_muniam,bling_sku,bling_produto_id');
    q = produtoId ? q.eq('bling_produto_id', produtoId) : q.eq('bling_sku', codigo);
    const { data: linhas } = await q;
    if (!linhas || !linhas.length) return respond({ ok: true, ignored: 'produto não rastreado', produtoId, codigo });
    const pid = produtoId || linhas[0].bling_produto_id;
    if (!pid) return respond({ ok: true, ignored: 'sem id pra consultar saldo' });

    // depósito geral do config
    const { data: cfg } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-estoque-config').maybeSingle();
    const depositoId = cfg?.payload?.deposito_geral || null;

    // RE-CONSULTA o saldo real na API (não confia no payload)
    const token = await refreshBlingToken(CONTA);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const r = await blingFetch(`${API}/estoques/saldos?idsProdutos[]=${encodeURIComponent(pid)}`, headers);
    const j = await r.json().catch(() => ({}));
    const s = (j.data || [])[0];
    if (!s) return respond({ ok: true, ignored: 'saldo não retornado', pid });
    let saldo = null;
    const deps = s.depositos || [];
    const dep = depositoId ? deps.find(d => String(d.id ?? d.deposito?.id) === String(depositoId)) : null;
    if (dep) saldo = dep.saldoFisico ?? dep.saldo ?? dep.deposito?.saldoFisico ?? null;
    if (saldo == null) saldo = s.saldoFisicoTotal ?? s.estoqueAtual ?? null;
    if (saldo == null) return respond({ ok: true, ignored: 'sem saldo geral', pid });
    const qtd = Math.max(0, Math.round(Number(saldo) || 0));

    // Atualiza só o que mudou + log de auditoria
    let mudou = 0;
    for (const ln of linhas) {
      if ((ln.qtd ?? null) === qtd) continue;
      await supabase.from('bling_estoque').update({ qtd, atualizado_em: new Date().toISOString(), atualizado_por: 'bling_webhook' })
        .eq('ref', ln.ref).eq('cor_norm', ln.cor_norm).eq('tam', ln.tam);
      // Log em VENDAVEL (Ailson 22/07/2026): o webhook muda so o Geral Exitus;
      // os filhos entram identicos nos dois lados pro "de/ficou" ser o vendavel.
      const filhosLn = (Number(ln.qtd_lumia) || 0) + (Number(ln.qtd_muniam) || 0);
      await supabase.from('bling_estoque_logs').insert({ ref: ln.ref, cor_norm: ln.cor_norm, tam: ln.tam, cor_label: ln.cor_label, qtd_anterior: ln.qtd == null ? null : ln.qtd + filhosLn, qtd_nova: qtd + filhosLn, delta: (ln.qtd == null ? qtd : qtd - ln.qtd), motivo: 'webhook estoque Bling', usuario: null, origem: 'webhook' });
      mudou++;
    }
    return respond({ ok: true, produtoId: pid, qtd, atualizadas: mudou });
  } catch (e) {
    console.error('bling-webhook:', e.message || e);
    // Responde 200 mesmo em erro pra não fazer o Bling desabilitar o webhook
    return respond({ ok: false, erro: e.message || String(e) });
  }
}
