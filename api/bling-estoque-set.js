/**
 * bling-estoque-set.js — Escreve o saldo no Bling (app -> Bling) por BALANÇO.
 *
 * Chamado pelo botão Salvar do modal de ajuste. Seta o saldo absoluto no
 * depósito geral (operacao 'B' = balanço → vira o saldo atual no Bling).
 *
 * POST body: { conta?, ref, cor_norm, tam, qtd, deposito? }
 *  - resolve o id do produto via bling_estoque (bling_produto_id) ou /produtos?codigo=sku
 *  - depósito: usa amicia_data 'bling-estoque-config'.deposito_geral (ou detecta)
 */
import { refreshBlingToken, blingFetch, supabase } from './_bling-helpers.js';

export const config = { maxDuration: 60 };
const API = 'https://api.bling.com.br/Api/v3';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const conta = (body.conta || 'exitus').toLowerCase();
  const ref = String(body.ref || '').replace(/\D/g, '').replace(/^0+/, '');
  const cor_norm = String(body.cor_norm || '');
  const tam = String(body.tam || '').toUpperCase().trim();
  const qtd = Math.max(0, Math.round(Number(body.qtd)));
  if (!ref || !cor_norm || !tam || isNaN(qtd)) return res.status(400).json({ error: 'ref, cor_norm, tam, qtd obrigatórios' });

  try {
    const token = await refreshBlingToken(conta);
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };

    // ── id do produto ──
    const { data: lin } = await supabase.from('bling_estoque')
      .select('bling_produto_id,bling_sku').eq('ref', ref).eq('cor_norm', cor_norm).eq('tam', tam).maybeSingle();
    let produtoId = lin?.bling_produto_id || null;
    if (!produtoId && lin?.bling_sku) {
      const rp = await blingFetch(`${API}/produtos?codigo=${encodeURIComponent(lin.bling_sku)}`, headers);
      const jp = await rp.json().catch(() => ({}));
      produtoId = jp.data?.[0]?.id || null;
    }
    if (!produtoId) return res.status(404).json({ error: 'produto não encontrado no Bling (rode a leitura primeiro pra mapear o SKU)' });

    // ── depósito geral ──
    let depositoId = body.deposito ? String(body.deposito) : null;
    if (!depositoId) {
      const { data: cfg } = await supabase.from('amicia_data').select('payload').eq('user_id', 'bling-estoque-config').maybeSingle();
      depositoId = cfg?.payload?.deposito_geral || null;
    }
    if (!depositoId) {
      const rd = await blingFetch(`${API}/depositos?pagina=1&limite=100`, headers);
      const jd = await rd.json().catch(() => ({}));
      const deps = jd.data || [];
      const pick = deps.find(d => d.padrao === true) || deps.find(d => /geral/i.test(d.descricao || '')) || deps[0];
      depositoId = pick ? String(pick.id) : null;
    }
    if (!depositoId) return res.status(502).json({ error: 'depósito geral não encontrado' });

    // ── POST balanço ──
    const r = await fetch(`${API}/estoques`, {
      method: 'POST', headers,
      body: JSON.stringify({ produto: { id: Number(produtoId) }, deposito: { id: Number(depositoId) }, operacao: 'B', quantidade: qtd }),
    });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = txt; }
    if (!r.ok) return res.status(502).json({ error: `Bling HTTP ${r.status}`, detalhe: data, produtoId, depositoId });

    // ── Espelho + log server-side (Ailson 02/07/2026) ──
    // Cliente novo manda espelhar:true e o endpoint mesmo grava bling_estoque
    // + bling_estoque_logs APÓS o 200 do Bling (1 fetch em vez de 4 do celular,
    // e sem risco de gravar no Bling e o espelho falhar no cliente).
    // Cliente antigo (sem a flag) segue espelhando por conta própria — evita
    // log duplicado enquanto tiver PWA velho aberto.
    let anterior = null;
    if (body.espelhar === true) {
      const { data: atualRow } = await supabase.from('bling_estoque')
        .select('qtd').eq('ref', ref).eq('cor_norm', cor_norm).eq('tam', tam).maybeSingle();
      anterior = atualRow ? atualRow.qtd : null;
      const { error: e1 } = await supabase.from('bling_estoque').upsert({
        ref, cor_norm, tam,
        cor_label: body.cor_label || null,
        qtd,
        bling_produto_id: produtoId || null,
        atualizado_em: new Date().toISOString(),
        atualizado_por: body.usuario || null,
      }, { onConflict: 'ref,cor_norm,tam' });
      if (e1) return res.status(200).json({ ok: true, ref, cor_norm, tam, qtd, produtoId, depositoId, espelho_erro: e1.message });
      await supabase.from('bling_estoque_logs').insert({
        ref, cor_norm, tam,
        cor_label: body.cor_label || null,
        qtd_anterior: anterior,
        qtd_nova: qtd,
        delta: (anterior == null ? qtd : qtd - anterior),
        motivo: body.motivo || null,
        usuario: body.usuario || null,
        origem: 'manual',
      });
    }

    return res.status(200).json({ ok: true, ref, cor_norm, tam, qtd, anterior, produtoId, depositoId });
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
